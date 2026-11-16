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
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'


/** Windows：.cmd/.bat 不能直接 spawn（shell:false）——用 cmd /c 包一层；其余原样。 */
export function spawnCommand(cmd, args, options = {}) {
  const raw = String(cmd ?? '')
  if (process.platform === 'win32' && /.(?:cmd|bat)$/iu.test(raw)) {
    return spawn('cmd', ['/c', raw, ...args], options)
  }
  return spawn(raw, args, options)
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
 * 返回 {installed, version?, message?}。缓存由调用方管（daemon 货架每请求现探，同上限 60s）。
 */
export function detectDshCli({ env = process.env, dshCmd = null } = {}) {
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
 */
export async function resolveDshRun(kit, options = {}) {
  if (kit?.url) return { ok: true, mode: 'http', url: `${kit.url}${kit.chatPath || '/v1/chat/completions'}`, source: 'manifest' }
  const any = await detectDshAny(options)
  if (!any.running) return { ok: false, mode: 'none', message: any.message }
  if (any.mode === 'cli') {
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
