/**
 * DSH 原生适配（OS-18）——探测 DSH Desktop，拿到它的 chat 端点就直连。
 *
 * 双模（OS-19）：
 *   A) **CLI stdio（首选）**——本机装了 DeepSeek Harness CLI（`dsh`）就用它，照 od 的
 *      @open-design/dsh-runtime 协议起 `dsh --profile <p> --stdio`（一 run 一进程，JSONL 帧）；
 *   B) **HTTP 端点（备选）**——没有 CLI 但有 OpenAI 兼容桥（env/studio-plugin-state）就直连。
 *
 * 探测顺序（全部只读，本机）：
 *   1) env `DSH_CHAT_ENDPOINT`（显式配置优先）；
 *   2) env `DSH_STUDIO_STATE` 或 %LOCALAPPDATA%\.dsh\open-design\studio-plugin-state.json
 *      里的 {studioUrl, daemonUrl}——OpenDesign 集成的握手文件（已探明格式）；
 *   3) 127.0.0.1:9230（DSH inspector 端口）HTTP 探活——只判「DSH 在跑」。
 *
 * chat 面只认 OpenAI 兼容 `POST <base>/v1/chat/completions`（SSE）——DSH 侧写成桥即可；
 * daemon 不逆向 DSH 私有会话协议。不可达如实报，不伪造。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'



/** 在 PATH 上解析可执行：Windows 优先 .cmd/.exe/.bat 变体。返回实际路径或空串。 */
export function resolveOnPath(cmd, env = process.env) {
  const raw = String(cmd ?? '')
  if (!raw) return ''
  if (path.isAbsolute(raw) || raw.includes('/') || raw.includes('\\')) {
    return fs.existsSync(raw) ? raw : ''
  }
  const exts = process.platform === 'win32'
    ? (path.extname(raw) ? [''] : ['.cmd', '.exe', '.bat', ''])
    : ['']
  for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
    if (!dir.trim()) continue
    for (const ext of exts) {
      const candidate = path.join(dir, raw + ext)
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
      } catch { /* 无权限等跳过 */ }
    }
  }
  return ''
}

/**
 * Windows 友好的 spawn：.cmd/.bat 需经 cmd /c（shell:false 时 Node 不解析 shim）。
 * 传裸名（如 'dsh'）时先在 PATH 上解析成实际文件，再决定是否需要 cmd /c。
 */
export function spawnCommand(cmd, args, options = {}) {
  const env = options.env ?? process.env
  const resolved = resolveOnPath(cmd, env)
  const target = resolved || String(cmd ?? '')
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(target)) {
    return spawn('cmd', ['/c', target, ...args], options)
  }
  return spawn(target, args, options)
}

function text(value) {
  return String(value ?? '')
}

export const DSH_INSPECTOR_PORT = 9230

function readJsonFile(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

/** 从 studio-plugin-state 记录里挑 chat base：优先显式 chatUrl，其次 studioUrl/daemonUrl 的 origin。 */
export function pickChatBase(record) {
  if (!record || typeof record !== 'object') return ''
  const explicit = text(record.chatUrl || record.chatEndpoint).trim()
  if (explicit) return explicit.replace(/\/+$/u, '')
  for (const key of ['studioUrl', 'daemonUrl']) {
    const raw = text(record[key]).trim()
    if (!raw) continue
    try {
      const url = new URL(raw)
      if (url.protocol === 'http:' || url.protocol === 'https:') return url.origin
    } catch { /* 坏值跳过 */ }
  }
  return ''
}

/**
 * 探测 DSH。返回 {running, chatBase?, source, message?}：
 * running＝拿到 chatBase（可直连）；否则若 inspector 端口活着＝{running:false, message:'DSH 在跑但没配 chat 端点'}。
 */
/**
 * dsh CLI 探测：`dsh --version` 或 `dsh --help` 能跑即算装了（一 run 一进程的 stdio 桥前提）。
 * 返回 {installed, version?, message?}。
 * OS-39：内置 60s 缓存——这段代码原来注释里写了缓存但没实现，
 * 结果是每发一条消息都白起一个 `dsh --version` 子进程（几百毫秒白等）。
 */
const cliProbeCache = new Map() // key: cmd → { at, promise }

export function detectDshCli({ env = process.env, dshCmd = null, cacheMs = 60000 } = {}) {
  const cmd = text(dshCmd || env.DSH_CLI || 'dsh')
  const now = Date.now()
  const hit = cliProbeCache.get(cmd)
  if (hit && Number(cacheMs) > 0 && now - hit.at < Number(cacheMs)) return hit.promise
  const promise = detectDshCliUncached({ env, dshCmd: cmd })
  cliProbeCache.set(cmd, { at: now, promise })
  // 失败的探测不缓存（装好之后应该立刻能用）；成功也只在 cacheMs 内复用
  promise.then((result) => { if (!result.installed) cliProbeCache.delete(cmd) }).catch(() => { cliProbeCache.delete(cmd) })
  return promise
}

function detectDshCliUncached({ env = process.env, dshCmd = null } = {}) {
  return new Promise((resolvePromise) => {
    const cmd = text(dshCmd || env.DSH_CLI || 'dsh')
    let child
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }
    const timer = setTimeout(() => {
      try { child?.kill() } catch { /* 已经死了 */ }
      finish({ installed: false, message: 'dsh --version 探测超时（5s）' })
    }, 5000)
    try {
      child = spawnCommand(cmd, ['--version'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ installed: false, message: `dsh 不可执行：${text(error?.message || error)}——需要先装 DeepSeek Harness CLI（npm i -g @deepseek-ai/dsh）` })
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk) => { out += text(chunk) })
    child.stderr?.on('data', (chunk) => { out += text(chunk) })
    child.on('error', (error) => finish({ installed: false, message: `dsh 不可执行：${text(error?.message || error)}——需要先装 DeepSeek Harness CLI（npm i -g @deepseek-ai/dsh）` }))
    child.on('exit', (code) => {
      const firstLine = out.split('\n').map((line) => line.trim()).filter(Boolean)[0] || ''
      finish(code === 0
        ? { installed: true, version: firstLine.slice(0, 80) || 'dsh CLI 就绪', profile: text(env.DSH_PROFILE || 'openstory') }
        : { installed: false, message: `dsh 退出码 ${code}${firstLine ? `：${firstLine.slice(0, 120)}` : ''}——需要先装 DeepSeek Harness CLI（npm i -g @deepseek-ai/dsh）` })
    })
  })
}

/**
 * 模型与推理深度选项（OS-39）：`dsh --profile <p> --models` 会吐一帧 JSON
 *   {v:1,type:"models",models:[{provider,provider_name,id,name,reasoning_options?:[{id,name,default?}]}]}
 * 设置页的「推理深度」下拉就靠它；结果同样缓存（模型是慢变量）。
 */
const modelsCache = new Map() // key: cmd|profile → { at, promise }

export function detectDshModels({ env = process.env, dshCmd = null, profile = null, cacheMs = 300000 } = {}) {
  const cmd = text(dshCmd || env.DSH_CLI || 'dsh')
  const prof = text(profile || env.DSH_PROFILE || 'openstory')
  const key = `${cmd}|${prof}`
  const now = Date.now()
  const hit = modelsCache.get(key)
  if (hit && Number(cacheMs) > 0 && now - hit.at < Number(cacheMs)) return hit.promise
  const promise = detectDshModelsUncached({ cmd, prof })
  modelsCache.set(key, { at: now, promise })
  promise.then((result) => { if (!result.ok) modelsCache.delete(key) }).catch(() => { modelsCache.delete(key) })
  return promise
}

function detectDshModelsUncached({ cmd, prof }) {
  return new Promise((resolvePromise) => {
    let child
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child?.kill() } catch { /* 已经死了 */ }
      resolvePromise(result)
    }
    const timer = setTimeout(() => finish({ ok: false, models: [], message: 'dsh --models 探测超时（10s）' }), 10000)
    try {
      child = spawnCommand(cmd, ['--profile', prof, '--models'], { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ ok: false, models: [], message: `dsh 不可执行：${text(error?.message || error)}` })
      return
    }
    let out = ''
    let err = ''
    child.stdout?.on('data', (chunk) => { out += text(chunk) })
    child.stderr?.on('data', (chunk) => { err += text(chunk) })
    child.on('error', (error) => finish({ ok: false, models: [], message: `dsh 不可执行：${text(error?.message || error)}` }))
    child.on('exit', (code) => {
      if (code !== 0) {
        finish({ ok: false, models: [], message: `dsh --models 退出码 ${code}${err.trim() ? `：${err.trim().slice(0, 200)}` : ''}` })
        return
      }
      // 找第一行能解析成 {type:'models'} 的帧
      const line = out.split('\n').map((row) => row.trim()).filter(Boolean)
        .find((row) => row.startsWith('{') && row.includes('"models"'))
      if (!line) { finish({ ok: false, models: [], message: 'dsh --models 没有返回模型清单' }); return }
      let frame
      try { frame = JSON.parse(line) } catch { finish({ ok: false, models: [], message: 'dsh --models 返回的帧不是合法 JSON' }); return }
      const models = (Array.isArray(frame.models) ? frame.models : []).map((model) => ({
        provider: text(model.provider),
        providerName: text(model.provider_name) || text(model.provider),
        id: text(model.id),
        name: text(model.name) || text(model.id),
        // 推理深度选项（low/medium/high…）；default:true 是 DSH 自己的默认档
        reasoningOptions: (Array.isArray(model.reasoning_options) ? model.reasoning_options : []).map((option) => ({
          id: text(option.id),
          name: text(option.name) || text(option.id),
          default: option.default === true
        })).filter((option) => option.id)
      })).filter((model) => model.id)
      finish({ ok: true, models })
    })
  })
}

/**
 * 分层探测（od 口径）：CLI → profile 就绪 → runtime 插件在册 → 就绪。
 * 每层都能给出「下一步该做什么」——上层 UI 按状态摆卡，不靠手抄命令。
 * 返回 {state, message?, commands?, profile, dshCmd, version}
 *   state: 'ready' | 'no-cli' | 'no-profile' | 'no-runtime'
 */
export async function probeDshStack({ env = process.env, dshCmd = null } = {}) {
  const cmd = text(dshCmd || env.DSH_CLI || 'dsh')
  const profile = text(env.DSH_PROFILE || 'openstory')
  const cli = await detectDshCli({ env, dshCmd: cmd })
  if (!cli.installed) {
    return {
      state: 'no-cli',
      dshCmd: cmd,
      profile,
      message: `没装 DeepSeek Harness CLI（${cli.message ?? 'dsh --version 失败'}）——它是独立 npm 包，随 DSH Desktop 打包的那份在 asar 内不可调用`,
      commands: [`npm i -g @deepseek-ai/dsh@${text(env.DSH_CLI_VERSION || '0.2.2-rc.1')}`]
    }
  }
  // profile 是否存在：$DSH_HOME/profiles/<p> 或默认 ~/.dsh/profiles/<p>
  const dshHome = text(env.DSH_HOME).trim() || join(text(env.USERPROFILE || env.HOME || '.'), '.dsh')
  const profileDir = join(dshHome, 'profiles', profile)
  if (!existsSync(profileDir)) {
    return {
      state: 'no-profile',
      dshCmd: cmd,
      profile,
      version: cli.version,
      message: `dsh CLI 就绪（${cli.version}），但还没有「${profile}」profile——它只是一层插件组合，建它不改动你的 Harness 设置`,
      commands: [`dsh plugin --profile ${profile} add <openstory-dsh-runtime.tgz>`]
    }
  }
  // runtime 插件是否在册（profile 的 package.json dependencies 里有 @open-design/dsh-runtime）
  let profilePkg = null
  try {
    profilePkg = JSON.parse(fs.readFileSync(join(profileDir, 'package.json'), 'utf-8'))
  } catch { /* 无 package.json＝空 profile */ }
  const deps = profilePkg?.dependencies ?? {}
  if (!Object.keys(deps).some((name) => /dsh-runtime$/u.test(name))) {
    return {
      state: 'no-runtime',
      dshCmd: cmd,
      profile,
      version: cli.version,
      message: `「${profile}」profile 还没装 OpenStory 的 DSH 连接组件（runtime 插件）——装上即可用，凭据/模型仍归你 Harness`,
      commands: [`dsh plugin --profile ${profile} add <openstory-dsh-runtime.tgz>`]
    }
  }
  return { state: 'ready', dshCmd: cmd, profile, version: cli.version }
}

/**
 * 一键自愈（od 口径「Setup is always explicit on the first incompatible selection」）：
 * 只在作者点了「修复」后执行——建 profile（首次自动初始化）＋装 runtime 插件 tgz。
 * setupSpec＝kit.setup：{ runtimeTarball }（tgz 绝对路径；可由环境变量覆盖）。
 * 返回 {ok, steps[], message?}。
 */
export async function setupDshStack({ env = process.env, dshCmd = null, runtimeTarball = '' } = {}) {
  const cmd = text(dshCmd || env.DSH_CLI || 'dsh')
  const profile = text(env.DSH_PROFILE || 'openstory')
  const stack = await probeDshStack({ env, dshCmd: cmd })
  if (stack.state === 'ready') return { ok: true, steps: [], message: '已经就绪' }
  const steps = []
  if (stack.state === 'no-cli') {
    return {
      ok: false,
      steps,
      message: `需要先安装 DeepSeek Harness CLI：${(stack.commands ?? []).join(' && ')}（这一步要你自己确认执行——它是全局 npm 安装）`
    }
  }
  const tarball = text(runtimeTarball || env.DSH_RUNTIME_TARBALL).trim()
  if (!tarball || !existsSync(tarball)) {
    return {
      ok: false,
      steps,
      message: `找不到 runtime 组件 tgz${tarball ? `：${tarball}` : ''}——设 DSH_RUNTIME_TARBALL 指向 open-design-dsh-runtime-*.tgz（或本仓 runtimes/dsh/*.tgz）`
    }
  }
  // dsh plugin --profile <p> add <tgz> 会首次初始化 profile（dsh 自身行为）
  const args = ['plugin', '--profile', profile, 'add', tarball]
  const result = await new Promise((resolvePromise) => {
    let child
    try {
      child = spawnCommand(cmd, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })
    } catch (error) {
      resolvePromise({ ok: false, message: `${text(error?.message || error)}` })
      return
    }
    let out = ''
    child.stdout?.on('data', (c) => { out += text(c) })
    child.stderr?.on('data', (c) => { out += text(c) })
    child.on('error', (error) => resolvePromise({ ok: false, message: text(error?.message || error) }))
    child.on('exit', (code) => resolvePromise({ ok: code === 0, code, message: out.trim().slice(0, 1200) }))
  })
  steps.push({ step: 'dsh plugin add', ok: result.ok, detail: result.message })
  if (!result.ok) {
    return { ok: false, steps, message: `装 runtime 组件失败（退出码 ${result.code}）：${result.message}` }
  }
  const after = await probeDshStack({ env, dshCmd: cmd })
  return { ok: after.state === 'ready', steps, state: after.state, message: after.state === 'ready' ? 'DSH 原生就绪' : `装完仍未就绪：${after.message ?? after.state}` }
}

/** 双模总探测：CLI 优先，HTTP 次之。 */
export async function detectDshAny({ env = process.env, fetchImpl = fetch, dshCmd = null } = {}) {
  const cli = await detectDshCli({ env, dshCmd })
  if (cli.installed) {
    return { running: true, mode: 'cli', dshCmd: text(dshCmd || env.DSH_CLI || 'dsh'), profile: cli.profile, source: 'dsh --version', version: cli.version }
  }
  const http = await detectDsh({ env, fetchImpl })
  if (http.running) return { ...http, mode: 'http' }
  return {
    running: false,
    mode: 'none',
    message: `${cli.message ?? 'dsh CLI 未安装'}；也没有可用的 DSH chat 端点（${http.message ?? '未探测到'}）`
  }
}

export async function detectDsh({ env = process.env, fetchImpl = fetch } = {}) {
  const explicit = text(env.DSH_CHAT_ENDPOINT).trim()
  if (explicit) {
    return { running: true, chatBase: explicit.replace(/\/+$/u, ''), source: 'DSH_CHAT_ENDPOINT' }
  }
  const statePath = text(env.DSH_STUDIO_STATE).trim()
    || join(text(env.LOCALAPPDATA || env.APPDATA).trim() || '.', '.dsh', 'open-design', 'studio-plugin-state.json')
  if (existsSync(statePath)) {
    const base = pickChatBase(readJsonFile(statePath))
    if (base) return { running: true, chatBase: base, source: statePath }
  }
  // inspector 只判活：/json/version 常 404，用 TCP 级探活（fetch 任意路径，连上即算活）
  try {
    await fetchImpl(`http://127.0.0.1:${DSH_INSPECTOR_PORT}/json/version`, { signal: AbortSignal.timeout(1200) })
    return { running: false, message: `DSH 在跑（inspector :${DSH_INSPECTOR_PORT}），但没找到 chat 端点——设 DSH_CHAT_ENDPOINT 或在 DSH 侧起 OpenAI 兼容桥`, source: 'inspector' }
  } catch (error) {
    // 连接被拒 vs 有响应但解析失败：ECONNREFUSED 类＝没跑
    const message = text(error?.message || error)
    if (/ECONNREFUSED|fetch failed|could not connect|拒绝/iu.test(message)) {
      return { running: false, message: 'DSH 未运行（inspector :9230 连不上）', source: 'inspector' }
    }
    return { running: false, message: `DSH 探测失败：${message}`, source: 'inspector' }
  }
}

/**
 * DSH kit 的单次执行解析（OS-19 双模）：
 *   CLI 模式 → {ok:true, mode:'cli', dshCmd, profile}
 *   HTTP 模式 → {ok:true, mode:'http', url}
 *   都不可用 → {ok:false, message}（人话，含装 CLI 的指令）。
 *
 * OS-39：CLI 模式先过一遍分层探测（probeDshStack）。原先只测 `dsh --version`，
 * 于是「profile 没初始化」「runtime 插件没装」这种注定失败的 run 也会照发，
 * 失败信息还误导成「请先安装 CLI」。
 */
export async function resolveDshRun(kit, options = {}) {
  if (kit?.url) return { ok: true, mode: 'http', url: `${kit.url}${kit.chatPath || '/v1/chat/completions'}`, source: 'manifest' }
  const any = await detectDshAny(options)
  if (!any.running) return { ok: false, mode: 'none', message: any.message }
  if (any.mode === 'cli') {
    // 分层探测：CLI 装了但 profile/runtime 没就绪时，直接给「下一步该做什么」
    try {
      const stack = await probeDshStack({ env: options.env ?? process.env, dshCmd: any.dshCmd })
      if (stack.state && stack.state !== 'ready') {
        return { ok: false, mode: 'cli', state: stack.state, message: stack.message ?? `DSH 未就绪（${stack.state}）` }
      }
    } catch { /* 探测失败不拦（可能是权限/超时），交给真正的 run 去报 */ }
    return { ok: true, mode: 'cli', dshCmd: any.dshCmd, profile: any.profile ?? 'openstory', source: any.source }
  }
  return { ok: true, mode: 'http', url: `${any.chatBase}${kit?.chatPath || '/v1/chat/completions'}`, source: any.source }
}

/** DSH kit 的 chat 直连地址：显式 manifest.url 优先，其次探测。 */
export async function resolveDshChat(kit, options = {}) {
  if (kit?.url) return { ok: true, url: `${kit.url}${kit.chatPath || '/v1/chat/completions'}`, source: 'manifest' }
  const detected = await detectDsh(options)
  if (!detected.running) return { ok: false, message: detected.message }
  return { ok: true, url: `${detected.chatBase}${kit?.chatPath || '/v1/chat/completions'}`, source: detected.source }
}
