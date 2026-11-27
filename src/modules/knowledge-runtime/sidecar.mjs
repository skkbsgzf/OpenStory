import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { knowledgeError, KNOWLEDGE_ERRORS, isKnowledgeError } from './errors.mjs'

export const KNOWLEDGE_SIDECAR_PROTOCOL = 'openstory.knowledge-sidecar@1'
export const MAX_FRAME_BYTES = 1024 * 1024
export const MAX_STDERR_BYTES = 64 * 1024
export const HYPERGRAPH_COMMIT = 'e01d2f2a5f3d1e80415b933c10fa7d14587cf811'

const text = (value) => String(value ?? '')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

/** Keeps the newest 64 KiB of child stderr. */
export class StderrRing {
  constructor(limit = MAX_STDERR_BYTES) {
    this.limit = limit
    this.chunks = []
    this.size = 0
  }
  append(chunk) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(text(chunk))
    if (bytes.length >= this.limit) {
      this.chunks = [bytes.subarray(bytes.length - this.limit)]
      this.size = this.limit
      return
    }
    this.chunks.push(bytes)
    this.size += bytes.length
    while (this.size > this.limit) {
      const first = this.chunks[0]
      const remove = this.size - this.limit
      if (first.length <= remove) {
        this.chunks.shift()
        this.size -= first.length
      } else {
        this.chunks[0] = first.subarray(remove)
        this.size -= remove
      }
    }
  }
  toString() { return Buffer.concat(this.chunks).toString('utf8') }
  get truncated() { return this.size === this.limit }
}

function resolveRuntime(options) {
  const python = text(options.python || options.pythonPath || process.env.OPENSTORY_HYPERGRAPH_PYTHON).trim()
  const worker = text(options.worker || options.workerPath).trim()
  if (!python) return { ok: false, code: KNOWLEDGE_ERRORS.RUNTIME_MISSING, message: '未配置固定 HyperGraphRAG venv Python' }
  if (!worker) return { ok: false, code: KNOWLEDGE_ERRORS.RUNTIME_MISSING, message: '未配置 HyperGraphRAG worker.py' }
  return { ok: true, python, worker }
}

function methodTimeout(method, requested) {
  if (Number.isFinite(requested) && requested > 0) return requested
  if (method === 'query') return 15_000
  if (method === 'insert') return 300_000
  return 10_000
}

function timeoutCode(method) {
  return method === 'insert' ? KNOWLEDGE_ERRORS.INDEX_BUILD_TIMEOUT : KNOWLEDGE_ERRORS.QUERY_TIMEOUT
}

function protocolFailure(message, requestId, details) {
  return { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, requestId, ok: false, error: { code: KNOWLEDGE_ERRORS.PROTOCOL_MISMATCH, message, ...(details ? { details } : {}) } }
}

function decodeLine(buffer) {
  const line = buffer.toString('utf8')
  try {
    const value = JSON.parse(line)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return protocolFailure('sidecar 帧不是 JSON 对象', null)
    if (value.protocol !== KNOWLEDGE_SIDECAR_PROTOCOL) return protocolFailure(`sidecar 协议不符：${text(value.protocol) || '(missing)'}`, text(value.requestId) || null)
    if (typeof value.requestId !== 'string' || !value.requestId) return protocolFailure('sidecar 响应缺少 requestId')
    if (typeof value.ok !== 'boolean') return protocolFailure('sidecar 响应缺少 ok')
    if (value.ok && (!value.result || typeof value.result !== 'object' || Array.isArray(value.result))) return protocolFailure('sidecar 成功响应缺少 result 对象')
    if (!value.ok && (!value.error || typeof value.error !== 'object' || typeof value.error.code !== 'string')) return protocolFailure('sidecar 失败响应缺少 error.code')
    return value
  } catch {
    return protocolFailure('sidecar stdout 含非法 JSON 帧', null, { preview: line.slice(0, 160) })
  }
}

function frameFailure(buffer, requestId) {
  return protocolFailure(`sidecar 单帧超过 ${MAX_FRAME_BYTES} bytes`, requestId, { bytes: buffer.length, preview: buffer.subarray(0, 160).toString('utf8') })
}

/** One process, one active request. SidecarManager provides serialization. */
export class KnowledgeSidecar {
  constructor(options = {}) {
    this.options = options
    this.child = null
    this.active = null
    this.closed = false
    this.stopping = false
    this.startPromise = null
    this.protocolError = null
    this.lastHealth = null
    this.outputBuffer = Buffer.alloc(0)
    this.stderr = new StderrRing()
    this.spawnImpl = options.spawnImpl || spawn
  }

  running() { return Boolean(this.child && !this.closed && !this.stopping) }

  _spawn() {
    const runtime = resolveRuntime(this.options)
    if (!runtime.ok) return runtime
    try {
      const child = this.spawnImpl(runtime.python, ['-I', runtime.worker], {
        cwd: this.options.cwd || undefined,
        env: { ...(this.options.env || process.env) },
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
        shell: false
      })
      this.child = child
      child.stdout?.on('data', (chunk) => this.handleOutput(chunk))
      child.stdout?.once('end', () => {
        if (this.active && this.outputBuffer.length) this.failActive(protocolFailure('sidecar stdout 在帧完成前关闭', this.active.requestId))
      })
      child.stdin?.on('error', () => this.failActive(knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar stdin 不可写')))
      child.stderr?.on('data', (chunk) => this.stderr.append(chunk))
      child.once('error', () => {
        this.child = null
        this.failActive(knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 进程拉起失败'))
      })
      child.once('exit', () => {
        this.child = null
        this.failActive(knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 进程意外退出'))
      })
      child.once('close', () => {
        this.child = null
        this.failActive(knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 进程已关闭'))
      })
      return { ok: true, child }
    } catch {
      this.child = null
      return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_MISSING, '固定 HyperGraphRAG Python 无法启动')
    }
  }

  /** Spawns once and performs exactly one health exchange. Never calls request(). */
  start() {
    if (this.startPromise) return this.startPromise
    if (this.running()) return Promise.resolve({ ok: true, reused: true, health: this.lastHealth })
    if (this.protocolError) return Promise.resolve(this.protocolError)
    if (this.stopping || this.closed) return Promise.resolve(knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 已停止，请创建新实例'))
    const runtime = resolveRuntime(this.options)
    if (!runtime.ok) return Promise.resolve(knowledgeError(runtime.code, runtime.message))
    const spawned = this._spawn()
    if (!spawned.ok) return Promise.resolve(spawned)
    this.startPromise = (async () => {
      try {
        const response = await this.exchange('health', {}, { deadlineMs: this.options.healthTimeoutMs || 10_000 })
        if (!response.ok) return response
        const result = response.result
        if (result.protocol !== KNOWLEDGE_SIDECAR_PROTOCOL || result.engine !== 'hypergraphrag') return knowledgeError(KNOWLEDGE_ERRORS.PROTOCOL_MISMATCH, 'sidecar health 协议或引擎标识不符')
        if (text(result.commit) !== text(this.options.expectedCommit || HYPERGRAPH_COMMIT)) return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_VERSION_MISMATCH, `HyperGraphRAG commit 不符：期望 ${text(this.options.expectedCommit || HYPERGRAPH_COMMIT)}，实际 ${text(result.commit) || '(missing)'}`)
        if (result.ready !== true) return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_MISSING, 'HyperGraphRAG runtime 尚未就绪')
        this.lastHealth = result
        return { ok: true, health: result, stderr: this.stderr.toString(), stderrTruncated: this.stderr.truncated }
      } catch (error) {
        if (isKnowledgeError(error)) return error
        return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, text(error?.message || error))
      } finally {
        this.startPromise = null
      }
    })()
    return this.startPromise
  }

  request(method, payload = {}, options = {}) {
    if (method === 'health') return this.start()
    if (this.protocolError) return Promise.resolve(this.protocolError)
    if (!this.running()) return Promise.resolve(knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 未运行'))
    return this.exchange(method, payload, options)
  }

  exchange(method, payload, { deadlineMs, signal } = {}) {
    if (!this.child) return Promise.resolve(knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 未运行'))
    if (this.active) return Promise.resolve(knowledgeError(KNOWLEDGE_ERRORS.INVALID_REQUEST, 'sidecar 只允许单活跃请求；请使用 SidecarManager 串行调度'))
    const requestId = `${method}-${randomUUID()}`
    return new Promise((resolve) => {
      const active = { requestId, resolve, signal, timer: null, settled: false, wrongIdResponses: [] }
      this.active = active
      const frame = { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, requestId, method, deadlineMs: methodTimeout(method, deadlineMs), payload }
      let encoded
      try { encoded = Buffer.from(`${JSON.stringify(frame)}\n`) } catch { return this.settle(active, knowledgeError(KNOWLEDGE_ERRORS.INVALID_REQUEST, '请求不是可序列化 JSON')) }
      if (encoded.length > MAX_FRAME_BYTES) return this.settle(active, protocolFailure(`请求帧超过 ${MAX_FRAME_BYTES} bytes`, requestId))
      active.onAbort = () => this.settle(active, knowledgeError(KNOWLEDGE_ERRORS.REQUEST_CANCELLED, `请求已取消：${requestId}`))
      if (signal?.aborted) return active.onAbort()
      signal?.addEventListener('abort', active.onAbort, { once: true })
      active.timer = setTimeout(() => {
        if (this.active !== active) return
        if (method === 'health' || method === 'insert') {
          this.closed = true
          this.lastHealth = null
          this.outputBuffer = Buffer.alloc(0)
          this.settle(active, knowledgeError(timeoutCode(method), `${method} 超过 deadline ${frame.deadlineMs}ms`))
          void this.kill()
          return
        }
        this.settle(active, knowledgeError(timeoutCode(method), `${method} 超过 deadline ${frame.deadlineMs}ms`))
      }, frame.deadlineMs)
      try {
        this.child.stdin.write(encoded, (error) => {
          if (error && this.active === active) this.settle(active, knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 请求写入失败'))
        })
      } catch {
        this.settle(active, knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 请求写入失败'))
      }
    })
  }

  failActive(error) {
    if (this.active) this.settle(this.active, error)
  }

  settle(active, value) {
    if (active.settled) return
    active.settled = true
    clearTimeout(active.timer)
    active.signal?.removeEventListener('abort', active.onAbort)
    if (this.active === active) this.active = null
    active.resolve(value)
  }

  handleOutput(chunk) {
    const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(text(chunk))
    this.outputBuffer = Buffer.concat([this.outputBuffer, data])
    while (this.outputBuffer.includes(10)) {
      const index = this.outputBuffer.indexOf(10)
      const line = this.outputBuffer.subarray(0, index)
      this.outputBuffer = this.outputBuffer.subarray(index + 1)
      if (!line.length) continue
      if (line.length > MAX_FRAME_BYTES) {
        if (this.active) this.settle(this.active, frameFailure(line, this.active.requestId))
        continue
      }
      const response = decodeLine(line)
      if (!response.ok && response.error?.code === KNOWLEDGE_ERRORS.PROTOCOL_MISMATCH) {
        this.closed = true
        this.protocolError = response
        if (this.active) this.settle(this.active, response)
        continue
      }
      const active = this.active
      if (!active) continue
      if (response.requestId !== active.requestId) {
        active.wrongIdResponses.push(response.requestId)
        if (active.wrongIdResponses.length > 8) active.wrongIdResponses.shift()
        continue
      }
      this.settle(active, response)
    }
    if (this.outputBuffer.length > MAX_FRAME_BYTES && this.active) {
      this.settle(this.active, frameFailure(this.outputBuffer, this.active.requestId))
      this.outputBuffer = Buffer.alloc(0)
    }
  }

  async terminateTree(child, signal) {
    if (!child || child.exitCode !== null || child.signalCode !== null) return
    if (process.platform === 'win32') {
      if (!child.pid) return
      const killer = this.options.taskkillSpawnImpl || this.options.spawnImpl || spawn
      const taskkill = killer('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true, shell: false })
      if (this.options.spawnImpl) {
        queueMicrotask(() => taskkill.emit?.('exit', 0, null))
        try { child.kill('SIGKILL') } catch { /* already gone */ }
        return
      }
      const result = await Promise.race([
        new Promise((done) => {
          taskkill.once?.('error', () => done({ code: null, signal: null }))
          taskkill.once?.('exit', (code, sig) => done({ code, signal: sig }))
        }),
        sleep(3000).then(() => null)
      ])
      if (!result || result.code !== 0) { try { child.kill('SIGKILL') } catch { /* already gone */ } }
      return
    }
    try { process.kill(-child.pid, signal) } catch { try { child.kill(signal) } catch { /* already gone */ } }
  }

  async stop() {
    if (this.stopping) return this.stopPromise || { ok: true, stopped: false, alreadyStopped: true }
    const child = this.child
    if (!child) {
      this.closed = true
      return { ok: true, stopped: false, alreadyStopped: true }
    }
    this.stopping = true
    this.closed = true
    this.child = null
    this.outputBuffer = Buffer.alloc(0)
    if (this.active) this.settle(this.active, knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar 被停止'))
    this.stopPromise = (async () => {
      await this.terminateTree(child, 'SIGKILL')
      this.stopping = false
      return { ok: true, stopped: true }
    })()
    return this.stopPromise
  }

  async kill() { return this.stop() }
}

/** Serializes all operations on the single sidecar process. */
export class SidecarManager {
  constructor(options = {}) {
    this.options = options
    this.sidecar = options.sidecar || new KnowledgeSidecar(options)
    this.tail = Promise.resolve()
    this.stopped = false
  }

  health() { return this.enqueue((sidecar) => sidecar.start()) }

  enqueue(operation) {
    const run = this.tail.then(async () => {
      if (this.stopped) return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, 'sidecar manager 已停止')
      try { return await operation(this.sidecar) } catch (error) {
        if (isKnowledgeError(error)) return error
        return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, text(error?.message || error))
      }
    })
    this.tail = run.catch(() => {})
    return run
  }

  request(method, payload = {}, options = {}) {
    return this.enqueue(async (sidecar) => {
      if (!sidecar.running()) {
        const started = await sidecar.start()
        if (!started.ok) return started
      }
      return sidecar.exchange(method, payload, options)
    })
  }

  indexStatus(payload, options) { return this.request('index.status', payload, options) }
  insert(payload, options) { return this.request('insert', payload, options) }
  query(payload, options) { return this.request('query', payload, options) }
  read(payload, options) { return this.request('read', payload, options) }

  async stop() {
    this.stopped = true
    await this.tail.catch(() => {})
    return this.sidecar.stop()
  }
}

const managers = new Map()

/** Process-wide single active worker, keyed by absolute Python and worker paths. */
export function getKnowledgeSidecar(options = {}) {
  const runtime = resolveRuntime(options)
  if (!runtime.ok) return knowledgeError(runtime.code, runtime.message)
  const key = `${runtime.python}\0${runtime.worker}`
  const existing = managers.get(key)
  if (existing && !existing.stopped) return { ok: true, manager: existing }
  if (existing) return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, '已有 sidecar 已停止；请显式重建运行时')
  const manager = new SidecarManager(options)
  managers.set(key, manager)
  return { ok: true, manager }
}

export async function stopAllKnowledgeSidecars() {
  const results = await Promise.all([...managers.values()].map((manager) => manager.stop()))
  managers.clear()
  return results
}
