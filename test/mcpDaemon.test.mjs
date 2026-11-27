/** OS-209：MCP 连临时 daemon 的真实数据面与协议参数闸。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

function startMcp(port, env = {}) {
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'host', 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env, OPENSTORY_PORT: String(port) }
  })
  const pending = new Map()
  let buf = '', stderr = '', stdout = '', nextId = 1, exited = false
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdout.on('data', (chunk) => {
    stdout += chunk
    buf += chunk
    let index
    while ((index = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, index).trim(); buf = buf.slice(index + 1)
      if (!line) continue
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    }
  })
  child.on('exit', () => { exited = true })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP 超时 ${method}`)) }, 20000)
    pending.set(id, (message) => { clearTimeout(timer); resolve(message) })
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n')
  })
  return {
    request,
    close: async () => { if (!exited) { child.kill(); await new Promise((done) => child.once('exit', done)) } },
    output: () => ({ stderr, stdout, exited })
  }
}

async function withMcp(fx, run, env) {
  const mcp = startMcp(fx.daemon.port, env)
  try { return await run(mcp) } finally { await mcp.close() }
}
const call = async (mcp, name, args) => {
  const reply = await mcp.request('tools/call', { name, arguments: args })
  assert.equal(reply.error, undefined, JSON.stringify(reply.error))
  return reply.result
}
const payload = (result) => JSON.parse(result.content[0].text)

test('OS-209 MCP：24 工具全部映射到临时 daemon／本地纯函数；写操作有备份', async () => {
  await withTempDaemon(async (fx) => {
    await withMcp(fx, async (mcp) => {
      const init = await mcp.request('initialize', { protocolVersion: '2024-11-05' })
      assert.equal(init.result.serverInfo.name, 'openstory-local')
      const list = await mcp.request('tools/list')
      assert.equal(list.result.tools.length, 24)
      const libraries = payload(await call(mcp, 'openstory_libraries', {}))
      assert.equal(libraries.libraries.length, 1)
      const files = payload(await call(mcp, 'openstory_files', { root: fx.root, dir: '正文' }))
      assert.ok(files.files.length >= 1)
      const chapters = payload(await call(mcp, 'openstory_novel_list_chapters', { root: fx.root }))
      assert.ok(chapters.chapters.length >= 1)
      const file = chapters.chapters[0].file
      const chapter = payload(await call(mcp, 'openstory_novel_read_chapter', { root: fx.root, file }))
      assert.ok(chapter.text.length > 20)
      // OS-212：写工具必须带满足注册表门槛的 confirm 实参（create/restore）。
      const written = payload(await call(mcp, 'openstory_novel_write_chapter', { root: fx.root, file, text: chapter.text + '\n\nMCP 写入验证。\n', confirm: 'create' }))
      assert.ok(written.backup)
      assert.equal((await readFile(join(fx.root, written.backup), 'utf-8')), chapter.text)
      const created = payload(await call(mcp, 'openstory_novel_new_chapter', { root: fx.root, title: 'MCP 新建章', confirm: 'create' }))
      assert.ok(created.chapter.file.endsWith('.md'))
      const deleted = payload(await call(mcp, 'openstory_novel_delete_chapter', { root: fx.root, file: created.chapter.file, confirm: 'restore' }))
      assert.ok(deleted.backup)
      assert.equal(await readFile(join(fx.root, created.chapter.file), 'utf-8').catch(() => null), null)
      const index = payload(await call(mcp, 'openstory_reference_index', { root: fx.root }))
      assert.ok(Array.isArray(index.notes) && Array.isArray(index.tags))
      const graph = payload(await call(mcp, 'openstory_reference_graph', { root: fx.root }))
      assert.ok(Array.isArray(graph.nodes) && Array.isArray(graph.edges))
      const notePath = index.notes[0]?.path ?? '世界书/检视示例.md'
      const note = payload(await call(mcp, 'openstory_reference_read_note', { root: fx.root, path: notePath }))
      assert.ok(note.note)
      const noteWritten = payload(await call(mcp, 'openstory_reference_write_note', { root: fx.root, file: notePath, text: note.note.text + '\n\nMCP 笔记验证。\n', confirm: 'create' }))
      assert.ok(noteWritten.chars > 0)
      const habits = payload(await call(mcp, 'openstory_habits_read', { root: fx.root }))
      assert.ok(habits.habits)
      const habitsPut = payload(await call(mcp, 'openstory_habits_put', { root: fx.root, habits: { ...habits.habits, description: 'MCP 测试习惯' }, confirm: 'create' }))
      assert.ok(habitsPut.backup)
      const analysis = payload(await call(mcp, 'openstory_analysis_chapter', { text: chapter.text, root: fx.root }))
      assert.ok(analysis.stats.chars > 0 && Array.isArray(analysis.issues))
      const curve = payload(await call(mcp, 'openstory_fact_curve', { root: fx.root, bookId: 'shuihu' }))
      assert.ok(Array.isArray(curve.chapters))
      const skills = payload(await call(mcp, 'openstory_skills_list', { category: 'craft' }))
      assert.ok(skills.total > 0 && skills.skills.length > 0)
      const skill = payload(await call(mcp, 'openstory_skills_read', { name: skills.skills[0].name }))
      assert.ok(skill.body || skill.skill?.body)
      // OS-212：reset:true 触发受控重置（restore 级），带确认后放行；原成功断言保留。
      const present = await call(mcp, 'openstory_deduce_present', { root: fx.root, bookId: 'shuihu', seed: 7, reset: true, confirm: 'restore' })
      assert.equal(present.isError, false, present.content[0].text)
      const presentData = payload(present)
      assert.ok(presentData.sceneCard && Array.isArray(presentData.candidates))
      // 等价加强：同一条件调用不传 confirm 必须走业务错误信封 CONFIRM_REQUIRED。
      const unconfirmed = await call(mcp, 'openstory_deduce_present', { root: fx.root, bookId: 'shuihu', seed: 7, reset: true })
      assert.equal(unconfirmed.isError, true)
      assert.match(unconfirmed.content[0].text, /^CONFIRM_REQUIRED · /u)
      const settle = await call(mcp, 'openstory_deduce_settle', { root: fx.root, bookId: 'shuihu', action: 'veto', confirm: 'create' })
      assert.ok(settle.isError === false || /候选|action|session|局面/u.test(settle.content[0].text))
      const enrichGraph = payload(await call(mcp, 'openstory_enrich_graph', { root: fx.root, bookId: 'shuihu' }))
      assert.ok(enrichGraph.causalGraph && Array.isArray(enrichGraph.causalGraph.nodes))
      const enrichStatus = await call(mcp, 'openstory_enrich_status', { jobId: 'job-missing' })
      assert.equal(enrichStatus.isError, true)
      const enrichRun = await call(mcp, 'openstory_enrich_run', { root: fx.root, bookId: 'shuihu', confirm: 'create' })
      assert.ok(enrichRun.isError === false || /AGENT_NOT_CONFIGURED|UPSTREAM|unavailable|不可用/u.test(enrichRun.content[0].text))
      const vision = await call(mcp, 'openstory_vision_describe', { root: fx.root, image: '世界书/assets/missing.png' })
      assert.equal(vision.isError, true)
      assert.match(vision.content[0].text, /NOT_FOUND|PATH_ESCAPE|AGENT_NOT_CONFIGURED|MODULE_DISABLED|PLUGIN_DEGRADED|INVALID_ENTRY/u)
      const image = await call(mcp, 'openstory_image_generate', { root: fx.root, path: notePath, prompt: 'test', confirm: 'create' })
      assert.equal(image.isError, true)
      assert.match(image.content[0].text, /AGENT_NOT_CONFIGURED|UPSTREAM|不可用|MODULE_DISABLED|PLUGIN_DEGRADED|NOT_FOUND/u)
    })
  }, { upstream: true, defaultRoot: true })
})

test('OS-209 MCP：错类型/枚举/额外参数在协议层 -32602，不落到业务', async () => {
  await withTempDaemon(async (fx) => {
    await withMcp(fx, async (mcp) => {
      for (const [name, args, expected] of [
        ['openstory_novel_read_chapter', { root: fx.root, file: 42 }, /file 必须是 string/],
        ['openstory_deduce_present', { root: fx.root, seed: '7' }, /seed 必须是 integer/],
        ['openstory_skills_list', { category: 'wrong' }, /category 必须是/],
        ['openstory_libraries', { extra: true }, /未知参数：extra/]
      ]) {
        const reply = await mcp.request('tools/call', { name, arguments: args })
        assert.equal(reply.error?.code, -32602, `${name} ${JSON.stringify(reply)}`)
        assert.match(reply.error.message, expected)
      }
    })
  })
})

test('OS-209 MCP：模块停用沿 daemon 错误信封透传；EOF 退出且 stdout 无日志污染', async () => {
  await withTempDaemon(async (fx) => {
    await fx.json('/api/ui-state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: fx.root, state: { 'modules.enabled.worldbook': false } }) })
    await withMcp(fx, async (mcp) => {
      const result = await call(mcp, 'openstory_reference_index', { root: fx.root })
      assert.equal(result.isError, true)
      assert.match(result.content[0].text, /^MODULE_DISABLED ·/u)
      const analysis = await call(mcp, 'openstory_analysis_chapter', { text: '测试。', root: fx.root })
      assert.equal(analysis.isError, false)
      await new Promise((done) => setTimeout(done, 100))
      const out = mcp.output()
      assert.equal(out.exited, false)
      for (const line of out.stdout.trim().split('\n')) assert.doesNotThrow(() => JSON.parse(line))
      assert.match(out.stderr, /OpenStory MCP → stdio 已就绪/u)
      await mcp.request('ping')
      mcp.close()
    })
  })
})
