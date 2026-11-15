/**
 * DSH 原生适配（OS-18）——探测 DSH Desktop，拿到它的 chat 端点就直连。
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
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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

/** DSH kit 的 chat 直连地址：显式 manifest.url 优先，其次探测。 */
export async function resolveDshChat(kit, options = {}) {
  if (kit?.url) return { ok: true, url: `${kit.url}${kit.chatPath || '/v1/chat/completions'}`, source: 'manifest' }
  const detected = await detectDsh(options)
  if (!detected.running) return { ok: false, message: detected.message }
  return { ok: true, url: `${detected.chatBase}${kit?.chatPath || '/v1/chat/completions'}`, source: detected.source }
}
