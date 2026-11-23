/**
 * SSE 管道（OS-141 daemon 拆分）——Agent 通道流式帧的共用工具。
 *
 * 帧协议（daemon 自有，OS-4/9 起）：notice? → start（回填 sessionId）→ delta* → done；
 * 出错发 error 帧。帧内容经 protocol/agentEvents.mjs 的 projectLegacyFrame 投影
 * （OS-131 canonical 事件 → 旧帧，线上字节不变）；本文件只管「怎么发」，不管「发什么」。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */

/** SSE 响应头（三处 Agent 通道分支共用同一份头，改一处即全部生效）。 */
export function sseOpen(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
}

/** 单帧写出：`data: <json>\n\n`（NDJSON-conformant 的 SSE data 帧）。 */
export function sseFrame(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}
