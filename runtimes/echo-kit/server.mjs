#!/usr/bin/env node
/**
 * OpenStory 运行时参考套件（echo-kit）——kit 作者的骨架模板。
 *
 * 只需要会说一种话：OpenAI 兼容流式。
 *   GET  /healthz               → 200（daemon 探活）
 *   POST /v1/chat/completions   → 读 OpenAI 请求，按 SSE 吐 delta，data: [DONE] 收尾
 *
 * 端口由 daemon 经 env OPENSTORY_RUNTIME_PORT 注入（manifest 里 port:"allocate"）；
 * 独立跑（node server.mjs）时回落 8911。翻译 DSH/CLI 时，只改「拿到 messages 之后」的那一段。
 */
import { createServer } from 'node:http'

const port = Number(process.env.OPENSTORY_RUNTIME_PORT || 8911)

const server = createServer((req, res) => {
  if (req.method === 'GET' && (req.url || '').split('?')[0] === '/healthz') {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: true, kit: 'echo-kit' }))
    return
  }
  if (req.method !== 'POST' || (req.url || '').split('?')[0] !== '/v1/chat/completions') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: { code: 'NOT_FOUND', message: `echo-kit 只有 /healthz 与 /v1/chat/completions：${req.method} ${req.url}` } }))
    return
  }
  let body = ''
  req.on('data', (chunk) => { body += chunk })
  req.on('end', () => {
    let parsed = {}
    try { parsed = JSON.parse(body || '{}') } catch { parsed = {} }
    const messages = Array.isArray(parsed.messages) ? parsed.messages : []
    const lastUser = [...messages].reverse().find((message) => message.role === 'user')
    const content = `回声（echo-kit）：${String(lastUser?.content ?? '').slice(0, 200)}`
    res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache' })
    const pieces = content.match(/.{1,14}/gsu) || []
    let index = 0
    const timer = setInterval(() => {
      if (index < pieces.length) {
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: pieces[index] } }] })}\n\n`)
        index += 1
        return
      }
      clearInterval(timer)
      res.write('data: [DONE]\n\n')
      res.end()
    }, 8)
  })
})

server.listen(port, '127.0.0.1', () => {
  console.log(`echo-kit listening on http://127.0.0.1:${port}`)
})
