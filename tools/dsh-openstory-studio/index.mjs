// dsh-openstory-studio — host half.
//
// 目标：把 OpenStory（本机 daemon + public/ 单页工作台）接成 DSH 的一个面板。
// OpenStory 的工作台不是一份静态页面，而是一个长期运行的本机服务：
//   node daemon.mjs --port=8807   （只监听 127.0.0.1）
// 所以宿主侧只做一件事：确保这个 daemon 在 DSH 运行期间活着，并在插件卸载时
// 回收「自己拉起的」那个进程。面板本身由 ./client.js 里的 iframe 呈现。
//
// 生命周期契约（照 dsh-open-design-studio 的已验证形态）：
//   1. apply() 时不阻塞 DSH 启动：后台探活，必要时 spawn daemon。
//   2. 看护：daemon 中途挂掉会被重新拉起（仅当本宿主是占有者）。
//   3. ctx.effect 的 disposer 负责 taskkill 整棵树（只有自己 spawn 的才杀）。
//   4. 多个 DSH 宿主同时加载本插件时，用 state 文件里的 hostPid 做单一占有者
//      裁决：先到者持有，后来者退让；占有者死掉后残留被回收、由活着的宿主接管。
//   5. 已经有手工 `npm start` 起的 daemon 时直接接管（不 spawn、不回收）。
import { spawn, spawnSync } from 'node:child_process'
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { homedir } from 'node:os'

export const name = 'dsh-openstory-studio'

const HERE = dirname(fileURLToPath(import.meta.url))
const DSH_HOME = process.env.DSH_HOME || join(homedir(), '.dsh')

const DEFAULTS = {
  // bundle 放在 <OpenStory 仓库>/tools/dsh-openstory-studio，所以仓库根就是上两级。
  projectDir: resolve(HERE, '..', '..'),
  daemonFile: 'daemon.mjs',
  port: 8807,
  root: '',
  nodeBin: '',
  autoStart: true,
  reapOnDispose: true,
  readyTimeoutMs: 30000,
  watchdogIntervalMs: 15000,
  // 空＝不把 DSH 自己的 profile 透给 OpenStory（保持它单独运行时的行为）。
  dshProfile: '',
  logFile: join(DSH_HOME, 'logs', 'openstory-studio.log'),
  stateFile: join(DSH_HOME, 'openstory', 'studio-plugin-state.json')
}

const state = {
  disposed: false,
  busy: false,
  foreign: false,
  attached: false,
  daemonChild: null,
  ownsDaemon: false,
  settings: null,
  watchdog: null,
  exitHookBound: false
}

// ---------------------------------------------------------------- utilities

function detectNodeBin() {
  const candidates = [
    process.env.OPENSTORY_NODE,
    join(process.env.ProgramFiles || '', 'nodejs', 'node.exe'),
    join(process.env['ProgramFiles(x86)'] || '', 'nodejs', 'node.exe'),
    join(process.env.LOCALAPPDATA || '', 'Programs', 'nodejs', 'node.exe'),
    join(process.env.NVM_SYMLINK || '', 'node.exe')
  ].filter((candidate) => candidate && candidate !== 'node.exe')
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return candidate
    } catch (_) { /* 无权限等跳过 */ }
  }
  return 'node'
}

function resolveSettings(config) {
  const fromEnv = {}
  if (process.env.OPENSTORY_PROJECT_DIR) fromEnv.projectDir = process.env.OPENSTORY_PROJECT_DIR
  if (process.env.OPENSTORY_PORT) fromEnv.port = process.env.OPENSTORY_PORT
  if (process.env.OPENSTORY_ROOT) fromEnv.root = process.env.OPENSTORY_ROOT
  const s = Object.assign({}, DEFAULTS, fromEnv, config || {})
  s.port = Number(s.port) || DEFAULTS.port
  s.root = typeof s.root === 'string' ? s.root : ''
  s.projectDir = resolve(String(s.projectDir || DEFAULTS.projectDir))
  s.daemonPath = join(s.projectDir, s.daemonFile)
  s.baseUrl = 'http://127.0.0.1:' + s.port
  if (!s.nodeBin) s.nodeBin = detectNodeBin()
  return s
}

function log(settings, ...parts) {
  const line = '[' + new Date().toISOString() + '] ' + parts.map((part) => {
    if (part instanceof Error) return part.stack || String(part)
    if (typeof part === 'string') return part
    try { return JSON.stringify(part) } catch (_) { return String(part) }
  }).join(' ')
  try {
    const file = (settings && settings.logFile) || DEFAULTS.logFile
    mkdirSync(dirname(file), { recursive: true })
    appendFileSync(file, line + '\n')
  } catch (_) { /* 日志失败不影响主流程 */ }
  try { console.log('[openstory-studio]', line) } catch (_) { /* 无 console 的宿主 */ }
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms))
}

async function httpJson(url, timeoutMs) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { accept: 'application/json' },
      cache: 'no-store'
    })
    let text = ''
    try { text = await response.text() } catch (_) { /* 空响应 */ }
    return { ok: response.ok, status: response.status, text }
  } catch (error) {
    return { ok: false, status: 0, text: '', error: error && error.message ? error.message : String(error) }
  } finally {
    clearTimeout(timer)
  }
}

// 「活着」的判据：daemon 的 GET /api/libraries 返回 ok。比只探端口更准
// （端口可能被别的进程占着），也比抓整页 index.html 便宜。
async function probeDaemon(settings) {
  const probe = await httpJson(settings.baseUrl + '/api/libraries', 2500)
  if (!probe.ok || probe.status !== 200) return null
  try {
    const body = JSON.parse(probe.text)
    return body && body.ok === true ? body : null
  } catch (_) {
    return null
  }
}

async function waitUntil(fn, timeoutMs, intervalMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (state.disposed) return null
    const value = await fn()
    if (value) return value
    await sleep(intervalMs || 400)
  }
  return null
}

function pipeToLog(stream, settings, tag) {
  if (!stream) return
  stream.setEncoding('utf8')
  stream.on('data', (chunk) => {
    for (const line of String(chunk).split(/\r?\n/)) {
      if (line.trim()) log(settings, tag, line)
    }
  })
  stream.on('error', () => { /* 子进程退出时的 EPIPE 忽略 */ })
}

function killTree(pid, settings) {
  if (!pid) return false
  if (process.platform === 'win32') {
    try {
      const result = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      })
      return Boolean(result && result.status === 0)
    } catch (error) {
      log(settings, 'taskkill failed', error)
      return false
    }
  }
  try { process.kill(pid, 'SIGTERM'); return true } catch (_) { return false }
}

function readState(settings) {
  try { return JSON.parse(readFileSync(settings.stateFile, 'utf8')) } catch (_) { return null }
}

function writeState(settings, patch) {
  try {
    mkdirSync(dirname(settings.stateFile), { recursive: true })
    const next = Object.assign({}, readState(settings) || {}, patch, {
      hostPid: process.pid,
      updatedAt: new Date().toISOString()
    })
    writeFileSync(settings.stateFile, JSON.stringify(next, null, 2))
    return next
  } catch (error) {
    log(settings, 'writeState failed', error)
    return null
  }
}

function isAlive(pid) {
  if (!pid) return false
  try { process.kill(pid, 0); return true } catch (_) { return false }
}

// 单一占有者裁决：桌面端与 web 端两个宿主都会加载本插件，必须只有一个去拉进程。
function assessOwnership(settings) {
  const prev = readState(settings)
  if (!prev) return { kind: 'self', prev: null }
  if (!prev.hostPid || prev.hostPid === process.pid) return { kind: 'self', prev }
  if (isAlive(prev.hostPid)) return { kind: 'foreign', prev }
  // 上一任宿主已经不在了：把它留下的残留清掉，由本宿主接管。
  if (prev.daemonPid) killTree(prev.daemonPid, settings)
  log(settings, 'reclaimed orphans from dead host ' + prev.hostPid, prev)
  return { kind: 'self', prev }
}

// ---------------------------------------------------------------- spawning

function spawnDaemon(settings) {
  if (!existsSync(settings.daemonPath)) {
    throw new Error('OpenStory daemon not found: ' + settings.daemonPath)
  }
  const env = Object.assign({}, process.env)
  // OpenStory 的「DSH 原生」运行时按它自己的设置解析 profile；宿主进程里的
  // DSH_PROFILE=desktop 是 DSH 自己的 profile，透传会让它误用。显式配置才设置。
  if (settings.dshProfile) {
    env.DSH_PROFILE = settings.dshProfile
  } else {
    delete env.DSH_PROFILE
    delete env.DSH_SHELL
    delete env.DSH_SESSION_ID
  }
  env.OPENSTORY_EMBEDDED = '1'

  const args = [settings.daemonPath, '--port=' + settings.port]
  if (settings.root) args.push('--root=' + settings.root)

  const child = spawn(settings.nodeBin, args, {
    cwd: settings.projectDir,
    env,
    windowsHide: true,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: false
  })
  pipeToLog(child.stdout, settings, '[daemon:out]')
  pipeToLog(child.stderr, settings, '[daemon:err]')
  child.on('exit', (code, signal) => log(settings, '[daemon] exited', code, signal))
  child.on('error', (error) => log(settings, '[daemon] spawn error', error))
  log(settings, '[daemon] spawned pid=' + child.pid + ' node=' + settings.nodeBin + ' cwd=' + settings.projectDir)
  return child
}

// ---------------------------------------------------------------- lifecycle

async function ensureDaemon(settings) {
  const health = await probeDaemon(settings)
  if (health) {
    log(settings, 'daemon already up at ' + settings.baseUrl + ', attaching')
    state.attached = true
    state.foreign = false
    return health
  }
  state.attached = false
  if (state.disposed) return null

  const ownership = assessOwnership(settings)
  if (ownership.kind === 'foreign') {
    state.foreign = true
    log(settings, 'another live DSH host owns the daemon (hostPid=' + ownership.prev.hostPid + '), deferring')
    return null
  }
  state.foreign = false

  if (!settings.autoStart) {
    log(settings, 'autoStart disabled, skip spawn')
    return null
  }

  // 先声明占有，避免两个宿主同时 spawn 抢端口。
  writeState(settings, { daemonPid: null, claiming: true })
  state.daemonChild = spawnDaemon(settings)
  state.ownsDaemon = true
  writeState(settings, { daemonPid: state.daemonChild.pid, daemonUrl: settings.baseUrl, claiming: false })
  bindExitHook(settings)

  const ready = await waitUntil(() => probeDaemon(settings), settings.readyTimeoutMs, 500)
  if (!ready) {
    if (state.disposed) return null
    throw new Error('OpenStory daemon did not become healthy within ' + settings.readyTimeoutMs + 'ms at ' + settings.baseUrl)
  }
  log(settings, 'daemon healthy at ' + settings.baseUrl)
  return ready
}

function startWatchdog(settings) {
  if (state.watchdog || !settings.watchdogIntervalMs) return
  state.watchdog = setInterval(async () => {
    if (state.disposed || state.busy) return
    state.busy = true
    try {
      const health = await probeDaemon(settings)
      if (health) return
      const ownership = assessOwnership(settings)
      if (ownership.kind === 'foreign') return
      log(settings, 'watchdog: daemon is down, re-ensuring')
      await ensureDaemon(settings)
    } catch (error) {
      log(settings, 'watchdog error', error)
    } finally {
      state.busy = false
    }
  }, settings.watchdogIntervalMs)
  if (typeof state.watchdog.unref === 'function') state.watchdog.unref()
}

// busy 与看护互斥：ensure 在跑的时候看护不再插一脚，反之亦然。
function runEnsure(settings) {
  state.busy = true
  return ensureDaemon(settings)
    .catch((error) => log(settings, 'ensure failed', error))
    .finally(() => { state.busy = false })
}

function bindExitHook(settings) {
  if (state.exitHookBound) return
  state.exitHookBound = true
  const reap = () => {
    if (!state.settings || !state.settings.reapOnDispose) return
    if (state.ownsDaemon && state.daemonChild) killTree(state.daemonChild.pid, state.settings)
  }
  process.once('exit', reap)
  process.once('SIGINT', () => { reap(); process.exit(130) })
  process.once('SIGTERM', () => { reap(); process.exit(143) })
}

async function shutdown(settings, reason) {
  if (!settings) return
  log(settings, 'shutdown:', reason)
  state.disposed = true
  state.attached = false
  state.foreign = false
  if (state.watchdog) {
    clearInterval(state.watchdog)
    state.watchdog = null
  }
  if (!settings.reapOnDispose) {
    log(settings, 'reapOnDispose disabled, leaving daemon running')
    return
  }
  if (state.ownsDaemon && state.daemonChild) {
    killTree(state.daemonChild.pid, settings)
    state.daemonChild = null
    state.ownsDaemon = false
  }
  writeState(settings, { daemonPid: null, hostPid: null, releasedAt: new Date().toISOString() })
}

// ---------------------------------------------------------------- plugin api

export function apply(ctx, config) {
  const settings = resolveSettings(config)
  state.settings = settings
  state.disposed = false
  log(settings, 'activate (host pid=' + process.pid + ')', {
    projectDir: settings.projectDir,
    port: settings.port,
    nodeBin: settings.nodeBin,
    autoStart: settings.autoStart
  })

  // 客户端面板由 ./client.js 注册；宿主侧只负责进程生命周期。
  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => {
      let disposed = false
      // 看护必须立即启动（而不是等首次 ensure 落定），否则冷启动失败会留下一段无自愈的盲区。
      startWatchdog(settings)
      const ready = runEnsure(settings)
      return () => {
        if (disposed) return
        disposed = true
        return ready.then(() => shutdown(settings, 'plugin dispose'))
      }
    }, 'openstory-studio.lifecycle')
  } else {
    // 无 ctx（被直接 import 做自测）时仍然启动，不阻塞调用方。
    startWatchdog(settings)
    runEnsure(settings)
  }
}

// 供离线自测 / 手动修复使用。
export const __internals = { resolveSettings, probeDaemon, ensureDaemon, shutdown, spawnDaemon, state }
