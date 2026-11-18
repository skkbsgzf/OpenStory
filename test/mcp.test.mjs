/**
 * MCP stdio 协议合规（OS-55）。口径对齐 Pinax 本地 MCP：
 *   · initialize 握手（protocolVersion/serverInfo/instructions）
 *   · tools/list：工具形状（name/title/description/inputSchema）
 *   · tools/call：业务错误＝isError:true 文本；参数缺失＝-32602；未知工具＝-32601
 *   · 未知方法＝-32601；坏 JSON＝-32700；通知不回包
 * 数据面依赖本机 daemon（8807）——不可达时 libraries 工具应回 isError 文本（也算合规）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** 起一个 MCP 子进程，收发 newline-delimited JSON-RPC。 */
function startMcp() {
  const child = spawn(process.execPath, [join(ROOT, 'mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'] })
  const pending = new Map()
  let buf = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let index
    while ((index = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, index).trim()
      buf = buf.slice(index + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message)
          pending.delete(message.id)
        }
      } catch { /* 非 JSON 行忽略 */ }
    }
  })
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n')
  })
  const notify = (method, params) => {
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, ...(params ? { params } : {}) }) + '\n')
  }
  const close = () => child.kill()
  return { request, notify, close }
}

/** 等 daemon 可达（测试环境有时启动慢；不可达不影响协议层断言）。 */
async function daemonAlive() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 800)
    const response = await fetch('http://127.0.0.1:8807/api/libraries', { signal: controller.signal })
    clearTimeout(timer)
    return response.ok
  } catch { return false }
}

test('MCP：initialize 握手（serverInfo/instructions/tools 能力）', async () => {
  const mcp = startMcp()
  try {
    const reply = await mcp.request('initialize', { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'test', version: '0' } })
    assert.equal(reply.error, undefined)
    assert.equal(reply.result.protocolVersion, '2024-11-05')
    assert.equal(reply.result.serverInfo.name, 'openstory-local')
    assert.match(reply.result.instructions, /openstory_libraries/)
    assert.ok(reply.result.capabilities.tools)
  } finally { mcp.close() }
})

test('MCP：tools/list 18 个工具、四模块分组、schema 带 required', async () => {
  const mcp = startMcp()
  try {
    const reply = await mcp.request('tools/list')
    const tools = reply.result.tools
    assert.equal(tools.length, 18)
    const names = tools.map((tool) => tool.name)
    for (const name of ['openstory_libraries', 'openstory_novel_write_chapter', 'openstory_reference_graph', 'openstory_deduce_present', 'openstory_analysis_chapter']) {
      assert.ok(names.includes(name), `缺工具 ${name}`)
    }
    for (const tool of tools) {
      assert.ok(tool.description, `${tool.name} 缺 description`)
      assert.equal(tool.inputSchema.type, 'object')
    }
    const write = tools.find((tool) => tool.name === 'openstory_novel_write_chapter')
    assert.deepEqual(write.inputSchema.required, ['root', 'file', 'text'])
  } finally { mcp.close() }
})

test('MCP：参数缺失 -32602 / 未知工具 -32601 / 未知方法 -32601', async () => {
  const mcp = startMcp()
  try {
    const missing = await mcp.request('tools/call', { name: 'openstory_novel_read_chapter', arguments: { root: 'D:/x' } })
    assert.equal(missing.error.code, -32602)
    assert.match(missing.error.message, /file/)
    const unknownTool = await mcp.request('tools/call', { name: 'nope', arguments: {} })
    assert.equal(unknownTool.error.code, -32601)
    const unknownMethod = await mcp.request('resources/list')
    assert.equal(unknownMethod.error.code, -32601)
  } finally { mcp.close() }
})

test('MCP：通知不回包；ping 有回包', async () => {
  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05' })
    mcp.notify('notifications/initialized')
    const pong = await mcp.request('ping')
    assert.deepEqual(pong.result, {})
  } finally { mcp.close() }
})

test('MCP：openstory_analysis_chapter 真算（本地引擎，不依赖 daemon）', async () => {
  const mcp = startMcp()
  try {
    const reply = await mcp.request('tools/call', {
      name: 'openstory_analysis_chapter',
      arguments: { text: '他笑了。\n\n她却在角落里哭，眼泪一滴一滴砸在地上。与此同时，然而，综上所述，他忽然觉得这一切仿佛宛如犹如一场梦。\n\n夜很冷。风更大了。他握紧刀，指节发白。' }
    })
    assert.equal(reply.error, undefined)
    const payload = JSON.parse(reply.result.content[0].text)
    assert.ok(payload.stats.chars > 40)
    assert.ok(payload.aiSmell.score >= 0)
    assert.ok(Array.isArray(payload.issues))
    assert.ok(Array.isArray(payload.emotion))
  } finally { mcp.close() }
})

test('MCP：业务错误＝isError:true + ERR code 文本（不炸协议）', async () => {
  const mcp = startMcp()
  try {
    // root 不在库清单里（daemon 在跑则业务 NO_LIBRARY；daemon 不在则 DAEMON_UNREACHABLE）——两者都是合规的 isError 文本
    const reply = await mcp.request('tools/call', { name: 'openstory_reference_index', arguments: { root: 'D:/不存在的库' } })
    assert.equal(reply.result.isError, true)
    assert.match(reply.result.content[0].text, /^(NO_LIBRARY|DAEMON_UNREACHABLE|HTTP_\d+) ·/)
  } finally { mcp.close() }
})

test('MCP：daemon 可达时 libraries 返回结构化清单', async () => {
  if (!await daemonAlive()) return // daemon 没跑就跳过数据面
  const mcp = startMcp()
  try {
    const reply = await mcp.request('tools/call', { name: 'openstory_libraries', arguments: {} })
    assert.equal(reply.result.isError, false)
    const payload = JSON.parse(reply.result.content[0].text)
    assert.ok(Array.isArray(payload.libraries))
  } finally { mcp.close() }
})
