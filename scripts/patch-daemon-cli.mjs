import fs from 'node:fs'

let src = fs.readFileSync('daemon.mjs', 'utf-8')

// ① imports：cli-bridge / dsh-bridge / probe
const OLD_IMPORT = `import {
  builtinRuntimesDir,
  defaultUserRuntimesDir,
  ensureSidecar,
  loadRuntimeKits,
  sidecarRunning,
  stopAllSidecars
} from './runtimes.mjs'`
const NEW_IMPORT = `import {
  builtinRuntimesDir,
  defaultUserRuntimesDir,
  ensureSidecar,
  loadRuntimeKits,
  probeRuntimeKit,
  sidecarRunning,
  stopAllSidecars
} from './runtimes.mjs'
import { runCliChat } from './cli-bridge.mjs'
import { detectDsh, resolveDshChat } from './dsh-bridge.mjs'`
if (!src.includes(OLD_IMPORT)) throw new Error('import target missing')
src = src.split(OLD_IMPORT).join(NEW_IMPORT)

// ② resolveChatUpstream：无 url 的 cli/dsh 返回 execute 型 upstream
const OLD_RESOLVE = `async function resolveChatUpstream(config, context) {
  const activeKitId = text(config.runtime).trim()
  if (!activeKitId) return piUpstream(config)
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  const kit = kits.find((item) => item.id === activeKitId)
  if (!kit) return fallbackToPi(config, \`运行时套件 \${activeKitId} 不在货架上了\`)
  const headers = kit.apiKey ? { authorization: \`Bearer \${kit.apiKey}\` } : {}
  if (kit.kind === 'endpoint') {
    return { ok: true, url: \`\${kit.url}\${kit.chatPath}\`, headers, model: kit.model, runtimeName: kit.name }
  }
  const up = await ensureSidecar(kit, { env: context.env })
  if (!up.ok) return fallbackToPi(config, \`运行时 \${kit.name} 起不来（\${up.message}）\`)
  return { ok: true, url: \`http://127.0.0.1:\${up.port}\${kit.chatPath}\`, headers, model: kit.model, runtimeName: kit.name }
}`
const NEW_RESOLVE = `async function resolveChatUpstream(config, context) {
  const activeKitId = text(config.runtime).trim()
  if (!activeKitId) return piUpstream(config)
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  const kit = kits.find((item) => item.id === activeKitId)
  if (!kit) return fallbackToPi(config, \`运行时套件 \${activeKitId} 不在货架上了\`)
  const headers = kit.apiKey ? { authorization: \`Bearer \${kit.apiKey}\` } : {}
  if (kit.kind === 'endpoint') {
    return { ok: true, url: \`\${kit.url}\${kit.chatPath}\`, headers, model: kit.model, runtimeName: kit.name }
  }
  if (kit.kind === 'cli') {
    // CLI 嫁接：不走 HTTP——上游是一次性子进程（handleAgentChat 里 execute）
    const probed = await probeRuntimeKit(kit)
    if (probed.installed !== true) {
      return fallbackToPi(config, \`CLI 不可用：\${kit.name}（\${probed.message ?? '未安装'}）\`)
    }
    return { ok: true, execute: 'cli', kit, model: kit.model, runtimeName: kit.name }
  }
  if (kit.kind === 'dsh') {
    const chat = await resolveDshChat(kit, { env: context.env })
    if (!chat.ok) return fallbackToPi(config, \`DSH 不可用：\${chat.message}\`)
    return { ok: true, url: chat.url, headers, model: kit.model, runtimeName: kit.name }
  }
  const up = await ensureSidecar(kit, { env: context.env })
  if (!up.ok) return fallbackToPi(config, \`运行时 \${kit.name} 起不来（\${up.message}）\`)
  return { ok: true, url: \`http://127.0.0.1:\${up.port}\${kit.chatPath}\`, headers, model: kit.model, runtimeName: kit.name }
}`
if (!src.includes(OLD_RESOLVE)) throw new Error('resolve target missing')
src = src.split(OLD_RESOLVE).join(NEW_RESOLVE)

// ③ handleAgentChat：upstream.execute === 'cli' 走 cli-bridge（整段一片 SSE 回吐）
const OLD_URL = `  const targetUrl = new URL(upstream.url)`
const NEW_URL = `  const targetUrl = upstream.url ? new URL(upstream.url) : null`
if (!src.includes(OLD_URL)) throw new Error('url target missing')
src = src.split(OLD_URL).join(NEW_URL)

// ④ 在 fetch 之前插 CLI 分支
const OLD_FETCH = `  let upstreamRes
  try {
    upstreamRes = await fetch(targetUrl, {`
const NEW_FETCH = `  if (upstream.execute === 'cli') {
    // CLI 嫁接：一次性子进程 → 整段一片 SSE（daemon 自有帧协议不变）
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    sseFrame(res, { type: 'start', sessionId, runtime: upstream.runtimeName })
    if (upstream.notice) sseFrame(res, { type: 'notice', text: upstream.notice })
    const cli = await runCliChat(upstream.kit, upstreamMessages)
    if (cli.ok) {
      sseFrame(res, { type: 'delta', text: cli.text })
      await appendSession(sessionsDir, root, sessionId, [{
        t: 'msg', id: newMessageId(), role: 'assistant', content: cli.text, at: new Date().toISOString()
      }])
      sseFrame(res, { type: 'done', sessionId, chars: cli.text.length })
    } else {
      sseFrame(res, { type: 'error', error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: cli.message } })
    }
    return res.end()
  }

  let upstreamRes
  try {
    upstreamRes = await fetch(targetUrl, {`
if (!src.includes(OLD_FETCH)) throw new Error('fetch target missing')
src = src.split(OLD_FETCH).join(NEW_FETCH)

fs.writeFileSync('daemon.mjs', src, 'utf-8')
console.log('daemon patched')
