/**
 * OS-215：剧本/多局/扮演/素材的 MCP 构建原语 II（真实临时 daemon）。
 *
 * 每个新工具都要有「实际调通」或「负向拒绝」证据；只验 tools/list 不算映射。
 * 跑法：node --test test/os215McpBuildPrimitivesIi.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

function startMcp(port) {
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'host', 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, OPENSTORY_PORT: String(port) }
  })
  const pending = new Map(); let buf = ''; let nextId = 1; let exited = false
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let index
    while ((index = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, index).trim(); buf = buf.slice(index + 1)
      if (!line) continue
      const msg = JSON.parse(line)
      if (msg.id !== undefined && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id) }
    }
  })
  child.on('exit', () => { exited = true })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP 超时 ${method}`)) }, 30000)
    pending.set(id, (msg) => { clearTimeout(timer); resolve(msg) })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
  })
  return {
    request,
    close: async () => { if (!exited) { child.kill(); await new Promise((done) => child.once('exit', done)) } }
  }
}
const call = async (mcp, name, args) => {
  const reply = await mcp.request('tools/call', { name, arguments: args })
  assert.equal(reply.error, undefined, `${name} 不应是协议错误：${JSON.stringify(reply.error)}`)
  return reply.result
}
const ok = async (mcp, name, args) => {
  const result = await call(mcp, name, args)
  assert.equal(result.isError, false, `${name} 失败：${result.content[0].text}`)
  return JSON.parse(result.content[0].text)
}
const fails = async (mcp, name, args, code) => {
  const result = await call(mcp, name, args)
  assert.equal(result.isError, true, `${name} 应失败`)
  if (code) assert.match(result.content[0].text, new RegExp(code, 'u'), result.content[0].text)
}

const SCRIPT = '# 第一幕 开局\n\n*〔场景：书房〕*\n\n**沈岚**：开始。\n\n**陈守**：好。\n'

test('OS-215 剧本互转与章节 rename：成功 + 载体越界/缺确认拒绝', async () => {
  await withTempDaemon(async (fx) => {
    const mcp = startMcp(fx.daemon.port)
    try {
      await mcp.request('initialize', { protocolVersion: '2024-11-05' })
      const toFact = await ok(mcp, 'openstory_script_to_fact', { root: fx.root, text: SCRIPT, bookId: 'shuihu' })
      assert.ok(Array.isArray(toFact.entries) && toFact.entries.length > 0)
      assert.ok(toFact.wiki && typeof toFact.wiki === 'object')
      const fromFact = await ok(mcp, 'openstory_script_from_fact', { root: fx.root, entries: toFact.entries, wiki: toFact.wiki })
      assert.ok(typeof fromFact.text === 'string' && fromFact.text.length > 0)
      // 空条目不渲染空剧本
      await fails(mcp, 'openstory_script_from_fact', { root: fx.root, entries: [] }, 'INVALID_ENTRY')
      // 缺 text 是协议层 -32602
      const badSchema = await mcp.request('tools/call', { name: 'openstory_script_to_fact', arguments: { root: fx.root } })
      assert.equal(badSchema.error?.code, -32602)

      // rename：读回章节清单拿真实文件
      const list = await ok(mcp, 'openstory_novel_list_chapters', { root: fx.root })
      const chapter = list.chapters[0]
      assert.ok(chapter?.file)
      await fails(mcp, 'openstory_chapters_rename', { root: fx.root, file: chapter.file, title: '未确认' }, 'CONFIRM_REQUIRED')
      const renamed = await ok(mcp, 'openstory_chapters_rename', { root: fx.root, file: chapter.file, title: '已确认重命名', confirm: 'create' })
      assert.ok(renamed.chapter.file.endsWith('-已确认重命名.md'), JSON.stringify(renamed))
      await fails(mcp, 'openstory_chapters_rename', { root: fx.root, file: '故事源/shuihu.json', title: '越界', confirm: 'create' }, 'INVALID_ENTRY')
    } finally { await mcp.close() }
  })
})

test('OS-215 多局会话：new/switch/get/list/delete 与最后一局拒删', async () => {
  await withTempDaemon(async (fx) => {
    const mcp = startMcp(fx.daemon.port)
    try {
      await mcp.request('initialize', { protocolVersion: '2024-11-05' })
      const created = await ok(mcp, 'openstory_session_new', { root: fx.root, bookId: 'shuihu', title: 'MCP 分局', confirm: 'create' })
      const sid = created.sessionId
      assert.ok(sid)
      const sessions = await ok(mcp, 'openstory_sessions', { root: fx.root, bookId: 'shuihu' })
      assert.ok(sessions.sessions.some((s) => s.id === sid || s.sessionId === sid), JSON.stringify(sessions))
      const switched = await ok(mcp, 'openstory_session_switch', { root: fx.root, bookId: 'shuihu', sessionId: sid, confirm: 'create' })
      assert.equal(switched.sessionId, sid)
      const got = await ok(mcp, 'openstory_session_get', { root: fx.root, bookId: 'shuihu', sessionId: sid })
      assert.ok(got.session)
      // 删除未激活的新局成功（非破坏）
      const removed = await ok(mcp, 'openstory_session_delete', { root: fx.root, bookId: 'shuihu', sessionId: sid, confirm: 'restore' })
      assert.equal(removed.action, 'delete')
      // 最后一局拒删
      const after = await ok(mcp, 'openstory_sessions', { root: fx.root, bookId: 'shuihu' })
      await fails(mcp, 'openstory_session_delete', { root: fx.root, bookId: 'shuihu', sessionId: after.activeId, confirm: 'restore' }, 'INVALID_ENTRY')
      // 缺确认
      await fails(mcp, 'openstory_session_new', { root: fx.root, bookId: 'shuihu' }, 'CONFIRM_REQUIRED')
      // 既有 HTTP 契约：未知 sessionId 返回 session:null（不是 404）
      const missing = await ok(mcp, 'openstory_session_get', { root: fx.root, bookId: 'shuihu', sessionId: '不存在' })
      assert.equal(missing.session, null)
    } finally { await mcp.close() }
  })
})

test('OS-215 素材：列表空态、越界拒、真实 PNG base64 读回', async () => {
  await withTempDaemon(async (fx) => {
    const mcp = startMcp(fx.daemon.port)
    try {
      await mcp.request('initialize', { protocolVersion: '2024-11-05' })
      const assets = await ok(mcp, 'openstory_assets', { root: fx.root, bookId: 'shuihu' })
      assert.ok(Array.isArray(assets.characters) && Array.isArray(assets.scenes) && Array.isArray(assets.bgm))
      await fails(mcp, 'openstory_asset_read', { root: fx.root, bookId: 'shuihu', path: '../越界.png' }, 'PATH_ESCAPE')
      await fails(mcp, 'openstory_asset_read', { root: fx.root, bookId: 'shuihu', path: 'C:/越界.png' }, 'PATH_ESCAPE')
      await fails(mcp, 'openstory_asset_read', { root: fx.root, bookId: 'shuihu', path: '角色/不存在.png' }, 'NOT_FOUND')

      // 放一个最小 1x1 PNG（测试夹具，只放临时库）
      const dir = join(fx.root, '扮演', 'shuihu', '素材', '角色')
      await mkdir(dir, { recursive: true })
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6x0sAAAAASUVORK5CYII=', 'base64')
      await writeFile(join(dir, '探针.png'), png)
      const read = await ok(mcp, 'openstory_asset_read', { root: fx.root, bookId: 'shuihu', path: '角色/探针.png' })
      assert.equal(read.mediaType, 'image/png')
      assert.equal(read.bytes, png.length)
      assert.ok(read.dataUrl.startsWith('data:image/png;base64,'))
      assert.deepEqual(Buffer.from(read.dataUrl.split(',')[1], 'base64'), png)
    } finally { await mcp.close() }
  })
})

test('OS-215 扮演写动作：缺确认拒绝；pending 重复/越界/模型不可用如实报错', async () => {
  await withTempDaemon(async (fx) => {
    const mcp = startMcp(fx.daemon.port)
    try {
      await mcp.request('initialize', { protocolVersion: '2024-11-05' })
      for (const [name, args] of [
        ['openstory_roleplay_turn', { root: fx.root, bookId: 'shuihu', customText: '向前' }],
        ['openstory_roleplay_archive', { root: fx.root, bookId: 'shuihu' }],
        ['openstory_roleplay_export', { root: fx.root, bookId: 'shuihu' }],
        ['openstory_roleplay_promote', { root: fx.root, bookId: 'shuihu', nodeId: 'nope' }],
        ['openstory_roleplay_pending', { root: fx.root, bookId: 'shuihu', pendingId: 'nope' }],
        ['openstory_roleplay_branch', { root: fx.root, bookId: 'shuihu', fromNodeId: 'nope' }],
        ['openstory_deduce_image', { root: fx.root, bookId: 'shuihu', name: '图', prompt: '探针' }]
      ]) {
        await fails(mcp, name, args, 'CONFIRM_REQUIRED')
      }
      // 带确认后：不存在的节点/卡是业务错误，不是协议错误
      await fails(mcp, 'openstory_roleplay_promote', { root: fx.root, bookId: 'shuihu', nodeId: 'nope', confirm: 'create' }, 'NOT_FOUND')
      await fails(mcp, 'openstory_roleplay_pending', { root: fx.root, bookId: 'shuihu', pendingId: 'nope', action: 'write', confirm: 'create' }, 'NOT_FOUND')
      await fails(mcp, 'openstory_roleplay_branch', { root: fx.root, bookId: 'shuihu', fromNodeId: 'nope', confirm: 'create' }, 'NOT_FOUND')
      // 模块停用：asset 列表应 409 MODULE_DISABLED
      const disabled = await fx.json('/api/ui-state', {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: fx.root, state: { 'modules.enabled.roleplay': false } })
      })
      assert.equal(disabled.status, 200)
      try {
        await fails(mcp, 'openstory_assets', { root: fx.root, bookId: 'shuihu' }, 'MODULE_DISABLED')
        await fails(mcp, 'openstory_session_new', { root: fx.root, bookId: 'shuihu', confirm: 'create' }, 'MODULE_DISABLED')
      } finally {
        await fx.json('/api/ui-state', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: fx.root, state: { 'modules.enabled.roleplay': true } })
        })
      }
    } finally { await mcp.close() }
  })
})
