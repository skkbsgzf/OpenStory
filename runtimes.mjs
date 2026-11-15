/**
 * OpenStory Agent 运行时套件装载（OS-9）——od 同型：kit 是资源不是内置。
 *
 * 发现目录（后者按 id 覆盖前者，同风格包口径）：
 *   1) 内置 openstory/runtimes/（随仓的参考套件 echo-kit）；
 *   2) 本机 %LOCALAPPDATA%/PinaxNext/openstory/runtimes/（作者/社区/Agent 丢目录即上新）。
 *
 * schemaVersion 必须精确等于 openstory-runtime-kit@1：别的版本跳过＋warning，不做半懂兼容。
 * 安全把门：id 形态、sidecar 必有 command 且 cmd 非空、endpoint 必有 http(s) url、
 * 端口 allocate/数字、路径字段禁查询串与逃逸；坏 kit 跳过＋warning，不拖垮清单。
 */
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const RUNTIME_KIT_SPEC = 'openstory-runtime-kit@1'
export const DEFAULT_CHAT_PATH = '/v1/chat/completions'
export const DEFAULT_HEALTH_PATH = '/healthz'

function text(value) {
  return String(value ?? '')
}

export function builtinRuntimesDir() {
  return join(HERE, 'runtimes')
}

export function defaultUserRuntimesDir(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'runtimes') : ''
}

function validChatPath(value) {
  const raw = text(value).trim()
  return raw.startsWith('/') && !raw.includes('?') && !raw.includes('..') && raw.length <= 120
}

/** 单 kit 规整：逐项把门，问题随 warning 报。 */
export function normalizeRuntimeKit(raw, { source, dir } = {}) {
  const where = `${source}·${text(dir)}`
  const bad = (code, message) => ({ ok: false, warning: { code, dir: where, message: `${message}：${where}` } })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('RUNTIME_KIT_SHAPE', 'manifest 不是对象')
  if (text(raw.schemaVersion).trim() !== RUNTIME_KIT_SPEC) return bad('RUNTIME_KIT_SPEC', `schemaVersion 必须是 ${RUNTIME_KIT_SPEC}`)
  const id = text(raw.id).trim()
  if (!/^[\w-]{1,40}$/u.test(id)) return bad('RUNTIME_KIT_ID', 'id 非法（只许字母数字-_，≤40 字）')
  const name = text(raw.name).trim()
  if (!name) return bad('RUNTIME_KIT_NAME', '缺 name')
  const kind = text(raw.kind).trim()
  if (!['sidecar', 'endpoint', 'cli', 'dsh'].includes(kind)) return bad('RUNTIME_KIT_KIND', 'kind 只许 sidecar/endpoint/cli/dsh')
  const category = text(raw.category).trim() || (kind === 'cli' ? 'cli' : 'native')
  if (category !== 'native' && category !== 'cli' && category !== 'dsh') return bad('RUNTIME_KIT_CATEGORY', 'category 只许 native/cli/dsh')
  const chatPath = raw.chatPath ? text(raw.chatPath).trim() : DEFAULT_CHAT_PATH
  if (!validChatPath(chatPath)) return bad('RUNTIME_KIT_CHAT_PATH', 'chatPath 必须是站内绝对路径（无查询串/逃逸）')
  const healthPath = raw.healthPath ? text(raw.healthPath).trim() : DEFAULT_HEALTH_PATH
  if (!validChatPath(healthPath)) return bad('RUNTIME_KIT_HEALTH_PATH', 'healthPath 必须是站内绝对路径')

  const kit = {
    id,
    name,
    kind,
    description: text(raw.description).trim(),
    source,
    dir: resolve(text(dir)),
    chatPath,
    healthPath,
    model: text(raw.model).trim(),
    apiKey: text(raw.apiKey).trim(),
    category
  }
  if (kind === 'sidecar') {
    const command = raw.command && typeof raw.command === 'object' ? raw.command : null
    const cmd = text(command?.cmd).trim()
    if (!cmd || cmd.includes('/') || cmd.includes('\\')) return bad('RUNTIME_KIT_COMMAND', 'sidecar 缺 command.cmd（或 cmd 带路径分隔符——用 PATH 上的可执行名＋args）')
    const args = Array.isArray(command.args) ? command.args.map((arg) => text(arg)) : []
    const port = raw.port === undefined || raw.port === 'allocate' ? 'allocate' : Number(raw.port)
    if (port !== 'allocate' && (!Number.isInteger(port) || port <= 0 || port > 65535)) {
      return bad('RUNTIME_KIT_PORT', 'port 只许 "allocate" 或 1-65535')
    }
    kit.command = { cmd, args, cwd: command?.cwd ? resolve(join(text(dir), text(command.cwd))) : text(dir) }
    kit.port = port
  } else if (kind === 'endpoint') {
    let url
    try { url = new URL(text(raw.url).trim()) } catch { return bad('RUNTIME_KIT_URL', 'endpoint 缺合法 url') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return bad('RUNTIME_KIT_URL', 'endpoint url 只支持 http/https')
    kit.url = url.origin
  } else if (kind === 'dsh') {
    // DSH 原生：端点由探测/配置给（manifest.url 可选）；probe 走 dsh-bridge 的探测
    if (raw.url) {
      try {
        const u = new URL(text(raw.url).trim())
        if (u.protocol === 'http:' || u.protocol === 'https:') kit.url = u.origin
      } catch { /* 坏 url 忽略——探测兜底 */ }
    }
  } else {
    // kind:cli——一次性子进程嫁接：probe 必填（安装探测），cliArgs 模板里 {prompt} 占位
    const probe = raw.probe && typeof raw.probe === 'object' ? raw.probe : null
    const probeCmd = text(probe?.cmd).trim()
    if (!probeCmd) return bad('RUNTIME_KIT_PROBE', 'cli kit 必须声明 probe.cmd')
    // 允许 PATH 名或绝对路径（本机 manifest 可信；是否真能执行由 probe 实测）
    kit.probe = { cmd: probeCmd, args: Array.isArray(probe.args) ? probe.args.map((arg) => text(arg)) : [] }
    kit.cliArgs = Array.isArray(raw.cliArgs) ? raw.cliArgs.map((arg) => text(arg)) : ['-p', '{prompt}']
    const timeoutMs = Number(raw.timeoutMs)
    kit.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 900000 ? timeoutMs : 120000
  }
  if (kind !== 'cli' && raw.probe && typeof raw.probe === 'object' && text(raw.probe.cmd).trim()) {
    kit.probe = { cmd: text(raw.probe.cmd).trim(), args: Array.isArray(raw.probe.args) ? raw.probe.args.map((arg) => text(arg)) : [] }
  }
  if (raw.sha256 !== undefined && !/^[0-9a-f]{64}$/iu.test(text(raw.sha256))) return bad('RUNTIME_KIT_SHA', 'sha256 要是 64 位十六进制')
  if (raw.sha256) kit.sha256 = text(raw.sha256).toLowerCase()
  return { ok: true, kit }
}

/** 目录同步扫描（装载清单用；kit 目录里没有 manifest.json 的子目录＝不是 kit，静默跳过）。 */
function scanKitDir(dir, source, warnings) {
  const kits = []
  if (!text(dir).trim() || !existsSync(dir)) return kits
  let names = []
  try {
    names = readdirSync(dir, { withFileTypes: true }).filter((entry) => entry.isDirectory() && !entry.name.startsWith('.')).map((entry) => entry.name)
  } catch (error) {
    warnings.push({ code: 'RUNTIME_DIR_UNREADABLE', dir, message: `运行时目录读不了：${dir}（${text(error?.message || error)}）` })
    return kits
  }
  for (const name of names) {
    const kitDir = join(dir, name)
    const manifestPath = join(kitDir, 'manifest.json')
    if (!existsSync(manifestPath)) continue
    let raw = null
    try {
      raw = JSON.parse(readFileSync(manifestPath, 'utf-8'))
    } catch (error) {
      warnings.push({ code: 'RUNTIME_KIT_UNREADABLE', dir: `${source}·${name}`, message: `manifest 读不了/不是 JSON：${source}·${name}（${text(error?.message || error)}）` })
      continue
    }
    const normalized = normalizeRuntimeKit(raw, { source, dir: kitDir })
    if (!normalized.ok) {
      warnings.push(normalized.warning)
      continue
    }
    kits.push(normalized.kit)
  }
  return kits
}

/** 合并装载：内置＋本机（本机按 id 覆盖内置）。 */
export function loadRuntimeKits(dirs = []) {
  const warnings = []
  const byId = new Map()
  dirs.forEach((dir, index) => {
    const source = index === 0 ? '内置' : '本机'
    for (const kit of scanKitDir(dir, source, warnings)) byId.set(kit.id, kit)
  })
  return { kits: [...byId.values()], warnings }
}

/** kit 内容指纹（预留钉版用；sha256 对 manifest.json 现算）。 */
export async function kitManifestSha256(kitDir) {
  try {
    return createHash('sha256').update(await readFile(join(kitDir, 'manifest.json')), 'utf-8').digest('hex')
  } catch {
    return ''
  }
}

/* ---------- sidecar 生命周期（daemon 进程内单例，od 的 launchSidecar/allocatePort/handoff 同型） ---------- */

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

/**
 * 确保 sidecar 起着：spawn（env 注入端口）→ 探活 → 复用。失败如实报，不静默重启循环。
 */
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
