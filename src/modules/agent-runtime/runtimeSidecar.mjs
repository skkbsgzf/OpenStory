/**
 * OS-195b：运行时 kit 的 sidecar 生命周期与探活归位 agent.runtime 内核。
 *
 * 清单装载仍归底座服务 `src/services/runtimes.mjs`（只留 manifest 装载）；这里的
 * `ensureSidecar`／`probeRuntimeKit`／sidecar 状态是**运行态**，与具体 kit 的进程和
 * 端口绑定，属于 agent.runtime 自己的实现，不再经 protocol 转供叶绕行。
 */
import { spawn } from 'node:child_process'
import { text } from './config.mjs'

/* ---------- sidecar 生命周期（daemon 进程内单例） ---------- */

const sidecars = new Map()

export function sidecarState(kitId) {
  return sidecars.get(kitId) ?? null
}

export function stopAllSidecars() {
  for (const entry of sidecars.values()) {
    try { entry.child?.kill() } catch { /* 已经死了 */ }
  }
  sidecars.clear()
}

async function freePort() {
  const { createServer } = await import('node:http')
  return new Promise((resolvePromise, rejectPromise) => {
    const server = createServer()
    server.once('error', rejectPromise)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close(() => resolvePromise(port))
    })
  })
}

async function healthy(url, timeoutMs = 15000, isAlive = null) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (isAlive && !isAlive()) return false // 子进程先死了就不用等满超时
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(1200) })
      if (res.ok) return true
    } catch { /* 还没起，继续等 */ }
    await new Promise((done) => setTimeout(done, 300))
  }
  return false
}

/** 确保 sidecar 起着：spawn（env 注入端口）→ 探活 → 复用。失败如实报，不静默重启循环。 */
export async function ensureSidecar(kit, { env = process.env } = {}) {
  const existing = sidecars.get(kit.id)
  if (existing?.port && existing.alive) return { ok: true, port: existing.port }
  if (existing?.child) {
    try { existing.child.kill() } catch { /* 已经死了 */ }
    sidecars.delete(kit.id)
  }
  const port = kit.port === 'allocate' ? await freePort() : kit.port
  let child
  try {
    child = spawn(kit.command.cmd, kit.command.args, {
      cwd: kit.command.cwd,
      env: { ...env, OPENSTORY_RUNTIME_PORT: String(port) },
      stdio: ['ignore', 'ignore', 'pipe']
    })
  } catch (error) {
    return { ok: false, message: `运行时 ${kit.id} 拉起失败：${text(error?.message || error)}` }
  }
  child.stderr?.on('data', () => { /* kit 的自述日志不进 daemon 输出；stderr 只用于判死 */ })
  const entry = { child, port, alive: true, startedAt: new Date().toISOString() }
  child.on('exit', () => { entry.alive = false })
  const ok = await healthy(`http://127.0.0.1:${port}${kit.healthPath}`, 15000, () => entry.alive)
  if (!ok) {
    try { child.kill() } catch { /* 已经死了 */ }
    return { ok: false, message: `运行时 ${kit.id} 探活失败（${kit.healthPath}，15s）` }
  }
  sidecars.set(kit.id, entry)
  return { ok: true, port }
}

/** sidecar 是否活着（endpoint 类 kit 无进程概念，恒 false）。 */
export function sidecarRunning(kitId) {
  const entry = sidecars.get(kitId)
  return Boolean(entry?.alive)
}

/* ---------- 安装探测（OS-18：货架状态标） ---------- */

const PROBE_TTL_MS = 60_000
const probeCache = new Map()

/**
 * 可执行探测：`probe.cmd probe.args` 跑起来、看退出码与首行版本。结果缓存 60s。
 * 返回 {installed, version?, message?}。探测失败不抛——货架如实标 missing。
 */
export async function probeRuntimeKit(kit, { force = false } = {}) {
  if (!kit?.probe?.cmd) return { installed: null, message: '未声明 probe' }
  const cacheKey = `${kit.id}:${kit.probe.cmd}`
  const cached = probeCache.get(cacheKey)
  if (!force && cached && Date.now() - cached.at < PROBE_TTL_MS) return cached.result
  const result = await new Promise((resolvePromise) => {
    let child
    const timer = setTimeout(() => {
      try { child?.kill() } catch { /* 已经死了 */ }
      resolvePromise({ installed: false, message: '探测超时（5s）' })
    }, 5000)
    try {
      child = spawn(kit.probe.cmd, kit.probe.args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      clearTimeout(timer)
      resolvePromise({ installed: false, message: `探测失败：${String(error?.message || error)}` })
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk) => { out += chunk })
    child.stderr?.on('data', (chunk) => { out += chunk })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolvePromise({ installed: false, message: `不可执行：${String(error?.message || error)}` })
    })
    child.on('exit', (code) => {
      clearTimeout(timer)
      const firstLine = out.split('\n').map((line) => line.trim()).filter(Boolean)[0] || ''
      resolvePromise(code === 0
        ? { installed: true, version: firstLine.slice(0, 80) }
        : { installed: false, message: `退出码 ${code}${firstLine ? `：${firstLine.slice(0, 80)}` : ''}` })
    })
  })
  probeCache.set(cacheKey, { at: Date.now(), result })
  return result
}

/** 测试钩子：清探测缓存。 */
export function resetProbeCache() {
  probeCache.clear()
}
