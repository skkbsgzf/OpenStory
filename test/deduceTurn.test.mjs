/**
 * OS-61 P2 扮演回合层用例（node:test）：结算→成文→缓存区→归档。
 *   node --test test/deduceTurn.test.mjs
 * LLM 用本机桩替换（endpoint 路），不真调模型；无模型路径验「不伪造正文」。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { loadDeduceSession } from '../src/modules/deduce/deduceSession.mjs'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'

const ENTRIES = [
  { schema: 'fact.data/v3', id: 'e1', layer: 'worldview', name: '雾港规则', definition: '雾起时渡口不开船。', status: 'adopted' },
  { schema: 'fact.data/v3', id: 'e2', layer: 'character', name: '林砚', definition: '雾港的摆渡人。', status: 'adopted' },
  { schema: 'fact.data/v3', id: 'e3', layer: 'location', name: '青浦渡口', definition: '故事发生地。', status: 'adopted' }
]

/** 桩 LLM：按调用次序回预设正文，记录请求体供断言（system 提示/输入面）。 */
async function startStubLlm(responses) {
  const calls = []
  const server = createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      let parsed = null
      try { parsed = JSON.parse(body) } catch { /* 记 null */ }
      calls.push(parsed)
      const out = responses[Math.min(calls.length - 1, responses.length - 1)]
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { content: out }, finish_reason: 'stop' }] }))
    })
  })
  await new Promise((done) => server.listen(0, '127.0.0.1', done))
  return { port: server.address().port, calls, close: () => new Promise((done) => server.close(done)) }
}

async function boot({ prose = null } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os61p2-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '故事源'), { recursive: true })
  await writeFile(join(root, '故事源', 'book-1.json'), JSON.stringify({
    book: { id: 'book-1', title: '夹具书' }, entries: ENTRIES, revision: 1
  }), 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  // 无模型用例：agentConfigPath 指向不存在的文件——不吃本机真实配置
  const agentConfigPath = join(base, 'agent-config.json')
  let llm = null
  if (prose) {
    llm = await startStubLlm(prose)
    await writeFile(agentConfigPath, JSON.stringify({ endpoint: `http://127.0.0.1:${llm.port}/v1/chat/completions`, model: 'stub' }), 'utf-8')
  }
  const daemon = await startDaemon({ port: 0, preferencesPath, agentConfigPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const post = (path, body) => fetch(origin + path, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  const present = () => post('/api/deduce/present', { root, bookId: 'book-1', pov: '林砚', seed: 42 }).then((r) => r.json())
  const turn = (body) => post('/api/deduce/turn', { root, bookId: 'book-1', ...body })
  const cleanup = async () => {
    await daemon.close()
    if (llm) await llm.close()
    await rm(base, { recursive: true, force: true })
  }
  return { base, root, origin, post, present, turn, llm, cleanup }
}

test('回合：customText 结算——无模型时 prose 为空但节点正常追加', async () => {
  const ctx = await boot()
  try {
    const presented = await ctx.present()
    assert.equal(presented.ok, true, presented.message)
    const response = await ctx.turn({ customText: '他决定夜渡。' })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.prose, '', '无模型不伪造正文')
    assert.equal(payload.proseError, '模型不可用')
    assert.equal(payload.node.prose, '')
    assert.equal(payload.node.choiceId, 'custom')
    assert.equal(payload.node.round, presented.round)
    assert.ok(payload.node.candidates.some((c) => c.source === '作者' && c.text === '他决定夜渡。'), '自定义内容进候选')
    assert.equal(payload.session.nodes.length, 1)
    assert.equal(payload.session.buffer.nodes.length, 1)
    assert.ok(payload.session.buffer.words > 0, '无正文按候选摘要攒字数')
    assert.equal(validateResponse('deduceTurn', payload).ok, true)
    // 会话落盘；引擎侧真结算了（director-inject 留痕）
    const onDisk = loadDeduceSession(ctx.root, 'book-1')
    assert.equal(onDisk.nodes.length, 1)
    const state = JSON.parse(await readFile(join(ctx.root, '.openstory', 'deduce', 'book-1.json'), 'utf-8'))
    assert.ok(state.log.some((item) => item.kind === 'director-inject'), 'inject 动作进了引擎日志')
  } finally {
    await ctx.cleanup()
  }
})

test('回合：choiceId 走既有结算——lastTurn 候选桥接后可选', async () => {
  const ctx = await boot()
  try {
    const presented = await ctx.present()
    assert.equal(presented.ok, true)
    assert.ok(presented.candidates.length >= 1)
    const choiceId = presented.candidates[0].id
    const payload = await (await ctx.turn({ choiceId })).json()
    assert.equal(payload.ok, true, JSON.stringify(payload))
    assert.equal(payload.node.choiceId, choiceId)
    assert.equal(payload.proseError, '模型不可用')
    assert.equal(payload.session.nodes.length, 1)
    const state = JSON.parse(await readFile(join(ctx.root, '.openstory', 'deduce', 'book-1.json'), 'utf-8'))
    assert.ok(state.log.some((item) => item.kind === 'settle'), 'choose 真结算进了引擎日志')
    // 不在本拍的候选 id＝拒绝，不伪造结算
    const bad = await ctx.turn({ choiceId: '不存在的候选' })
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error.code, 'INVALID_ENTRY')
  } finally {
    await ctx.cleanup()
  }
})

test('回合：regenerate 覆盖同一拍正文，不新增节点（LLM 桩）', async () => {
  // OS-82：present 现在带 llmPort——戏剧候选先消耗一次调用（桩回空 proposals），成文从第二个桩起
  const ctx = await boot({ prose: ['{"proposals":[]}', '雾起了，他推开门。', '雾散了，他转身离开。'] })
  try {
    await ctx.present()
    const first = await (await ctx.turn({ customText: '夜渡' })).json()
    assert.equal(first.ok, true)
    assert.equal(first.node.prose, '雾起了，他推开门。')
    assert.equal(first.proseError, undefined)
    assert.equal(ctx.llm.calls.length, 2, '戏剧候选 1 次＋成文 1 次')
    // 第 0 次是戏剧候选提议（提议器 system 提示）；成文走小说叙述体，输入面带局面与选定内容
    assert.match(ctx.llm.calls[0].messages[0].content, /剧情推演提议器/)
    const call = ctx.llm.calls[1]
    assert.equal(call.messages[0].role, 'system')
    assert.match(call.messages[0].content, /叙述体/)
    assert.doesNotMatch(JSON.stringify(call), /只输出符合要求的 JSON/)
    assert.match(call.messages[1].content, /【当前局面】/)
    assert.match(call.messages[1].content, /夜渡/)
    // 重写：覆盖 prose，节点数/缓存区拍数不变，字数按新正文重算
    const again = await (await ctx.turn({ regenerate: true })).json()
    assert.equal(again.ok, true)
    assert.equal(again.node.id, first.node.id)
    assert.equal(again.node.prose, '雾散了，他转身离开。')
    assert.equal(again.prose, '雾散了，他转身离开。')
    assert.equal(again.session.nodes.length, 1, '不新增节点')
    assert.equal(again.session.buffer.nodes.length, 1)
    assert.equal(again.session.buffer.nodes[0].prose, '雾散了，他转身离开。')
    assert.equal(again.session.buffer.words, '雾散了，他转身离开。'.length)
    assert.equal(ctx.llm.calls.length, 3, '戏剧＋首拍成文＋重写')
    const onDisk = loadDeduceSession(ctx.root, 'book-1')
    assert.equal(onDisk.nodes.length, 1)
    assert.equal(onDisk.nodes[0].prose, '雾散了，他转身离开。')
  } finally {
    await ctx.cleanup()
  }
})

test('回合：缓存区累加与「归档本章」清空', async () => {
  const ctx = await boot()
  try {
    await ctx.present()
    const first = await (await ctx.turn({ customText: '第一拍，他走上渡船。' })).json()
    assert.equal(first.ok, true)
    await ctx.present()
    const second = await (await ctx.turn({ customText: '第二拍，雾涌了过来。' })).json()
    assert.equal(second.ok, true)
    assert.equal(second.session.buffer.nodes.length, 2, '两拍都进缓存区')
    const words = second.session.buffer.words
    assert.ok(words > 0)
    assert.equal(second.session.nodes.length, 2)
    // 归档：路径/字数如实回报，md 含两拍内容
    const archived = await (await ctx.post('/api/deduce/archive', { root: ctx.root, bookId: 'book-1', title: '雾起' })).json()
    assert.equal(archived.ok, true, JSON.stringify(archived))
    assert.equal(archived.path, '扮演/book-1/归档/第1章.md')
    assert.equal(archived.words, words)
    const md = await readFile(join(ctx.root, '扮演', 'book-1', '归档', '第1章.md'), 'utf-8')
    assert.ok(md.includes('# 第1章 雾起'))
    assert.ok(md.includes('第一拍，他走上渡船。'))
    assert.ok(md.includes('第二拍，雾涌了过来。'))
    // 缓存区清空、archived 记录、nodes 全量保留
    const session = (await (await fetch(`${ctx.origin}/api/deduce/session?root=${encodeURIComponent(ctx.root)}&bookId=book-1`)).json()).session
    assert.deepEqual(session.buffer.nodes, [])
    assert.equal(session.buffer.words, 0)
    assert.equal(session.archived.length, 1)
    assert.equal(session.nodes.length, 2)
    // 空缓存区再归档＝拒绝
    const empty = await ctx.post('/api/deduce/archive', { root: ctx.root, bookId: 'book-1' })
    assert.equal(empty.status, 400)
    assert.equal((await empty.json()).error.code, 'INVALID_ENTRY')
  } finally {
    await ctx.cleanup()
  }
})

test('回合：输入闸——没选没写＝400；没会话＝404；没拍可重写＝400', async () => {
  const ctx = await boot()
  try {
    const nothing = await ctx.turn({})
    assert.equal(nothing.status, 400)
    assert.equal((await nothing.json()).error.code, 'INVALID_ENTRY')
    // 还没呈现过一拍：inject/choose 都没有引擎会话
    const noSession = await ctx.turn({ customText: '凭空一拍' })
    assert.equal(noSession.status, 404)
    assert.equal((await noSession.json()).error.code, 'NOT_FOUND')
    const noNode = await ctx.turn({ regenerate: true })
    assert.equal(noNode.status, 400)
    assert.equal((await noNode.json()).error.code, 'INVALID_ENTRY')
    const noChoose = await ctx.turn({ choiceId: 'c0' })
    assert.equal(noChoose.status, 404)
  } finally {
    await ctx.cleanup()
  }
})

test('回合：deduceTurn 契约形状（请求/响应）', () => {
  assert.equal(validateRequest('deduceTurn', { root: '/tmp/x' }).ok, true)
  assert.equal(validateRequest('deduceTurn', { root: '/tmp/x', bookId: 'b', choiceId: 'c0', customText: '自己写', regenerate: true }).ok, true)
  assert.equal(validateRequest('deduceTurn', {}).ok, false, 'root 必填')
  assert.equal(validateRequest('deduceTurn', { root: '/tmp/x', regenerate: 'yes' }).ok, false, 'regenerate 必须是布尔')
  assert.equal(validateResponse('deduceTurn', { ok: true, node: {}, session: {}, prose: '' }).ok, true)
  assert.equal(validateResponse('deduceTurn', { ok: true, node: {}, session: {}, prose: '', proseError: '模型不可用' }).ok, true)
  assert.equal(validateResponse('deduceTurn', { ok: true, session: {}, prose: '' }).ok, false, 'node 必填')
})