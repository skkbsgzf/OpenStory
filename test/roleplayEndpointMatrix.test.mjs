/** OS-209：扮演关键动作的真实 HTTP 成功与负向矩阵。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ENDPOINTS, validateResponse } from '../src/api/contracts.mjs'
import { stableEntryId } from '../src/modules/fact/fact/domain/stableId.js'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

const ids = Object.fromEntries(Object.entries(ENDPOINTS).map(([id, endpoint]) => [`${endpoint.method} ${endpoint.path}`, id]))
async function call(fx, method, path, body = {}) {
  const id = ids[`${method} ${path}`]
  const endpoint = ENDPOINTS[id]
  const input = { ...body }
  if (endpoint.request.query?.root || endpoint.request.body?.root) input.root = fx.root
  const url = new URL(`http://127.0.0.1:${fx.daemon.port}${path}`)
  const options = { method }
  if (endpoint.request.query) {
    for (const [key, value] of Object.entries(input)) if (value !== undefined) url.searchParams.set(key, String(value))
  } else if (method !== 'GET') {
    options.headers = { 'content-type': 'application/json' }
    options.body = JSON.stringify(input)
  }
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => null)
  return { id, status: response.status, payload }
}
const ok = (result) => {
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(validateResponse(result.id, result.payload).ok, true, JSON.stringify(validateResponse(result.id, result.payload).errors))
  return result.payload
}

const session = (bookId = 'shuihu') => ({
  schema: 'openstory.deduce-session/v1', bookId, sessionId: 'main', title: 'HTTP 测试局', branchId: 'main', cursor: 1,
  nodes: [{
    id: 'node-1', round: 1, branchId: 'main', choiceId: 'choice-1', prose: '这是待转正的正文。',
    candidates: [{ id: 'choice-1', text: '推门进去', source: '命运' }], beats: [], pending: []
  }],
  buffer: [], archived: [],
  pending: [pendingEntry('http-pending-1')]
})

function pendingEntry(id) {
  const name = 'HTTP 待确认事实'
  const domain = '测试'
  return {
    id: 'pending-1', nodeId: 'node-1', round: 1,
    entry: {
      schema: 'fact.data/v3', id: stableEntryId({ layer: 'plot', domain, name }), layer: 'plot', name, domain, status: 'adopted',
      provenance: { book: 'shuihu', book_id: 'shuihu', mode: 'analyze', extractor: 'test', chapters: [], scenes: [] },
      fingerprint: { vec: null }, events: []
    }
  }
}

test('OS-209 扮演：会话存读、多局 new/switch/delete、最后一局拒删、导出与转正', async () => {
  await withTempDaemon(async (fx) => {
    const saved = ok(await call(fx, 'PUT', '/api/deduce/session', { bookId: 'shuihu', session: session() }))
    assert.equal(saved.session.nodes.length, 1)
    const got = ok(await call(fx, 'GET', '/api/deduce/session', { bookId: 'shuihu', sessionId: 'main' }))
    assert.equal(got.session.pending.length, 1)
    const created = ok(await call(fx, 'POST', '/api/deduce/session/manage', { bookId: 'shuihu', action: 'new', title: '第二局' }))
    assert.notEqual(created.sessionId, 'main')
    const deleted = ok(await call(fx, 'POST', '/api/deduce/session/manage', { bookId: 'shuihu', action: 'delete', sessionId: created.sessionId }))
    assert.equal(deleted.action, 'delete')
    // 新样本自带 main＋MCP 分局：先清掉所有非 main 局，确保下面的「最后一局」是唯一局。
    const beforeCleanup = ok(await call(fx, 'GET', '/api/deduce/sessions', { bookId: 'shuihu' }))
    for (const item of beforeCleanup.sessions.filter((entry) => entry.id !== 'main')) {
      ok(await call(fx, 'POST', '/api/deduce/session/manage', { bookId: 'shuihu', action: 'delete', sessionId: item.id }))
    }
    const switched = ok(await call(fx, 'POST', '/api/deduce/session/manage', { bookId: 'shuihu', action: 'switch', sessionId: 'main' }))
    assert.equal(switched.sessionId, 'main')
    const sessions = ok(await call(fx, 'GET', '/api/deduce/sessions', { bookId: 'shuihu' }))
    assert.equal(sessions.sessions.length, 1, '清掉样本自带分局后，只剩 main')
    assert.equal(sessions.activeId, 'main')
    const onlyDelete = await call(fx, 'POST', '/api/deduce/session/manage', { bookId: 'shuihu', action: 'delete', sessionId: 'main' })
    assert.equal(onlyDelete.status, 400, '最后一局必须拒删')
    const exported = ok(await call(fx, 'POST', '/api/deduce/export', { bookId: 'shuihu', sessionId: 'main' }))
    assert.match(exported.path, /^扮演\/shuihu\/导出\//u)
    assert.match(await readFile(join(fx.root, exported.path), 'utf-8'), /这是待转正的正文/u)
    const promoted = ok(await call(fx, 'POST', '/api/deduce/promote', { bookId: 'shuihu', sessionId: 'main', nodeId: 'node-1', title: '转正测试章' }))
    assert.match(promoted.file, /^正文\//u)
    assert.equal(await readFile(join(fx.root, promoted.file), 'utf-8'), '这是待转正的正文。')
    const badAction = await call(fx, 'POST', '/api/deduce/session/manage', { bookId: 'shuihu', action: 'unknown' })
    assert.equal(badAction.status, 400)
  }, { upstream: true })
})

test('OS-209 扮演：pending dismiss 不落 fact；write 单条 upsert、重复卡 NOT_FOUND', async () => {
  await withTempDaemon(async (fx) => {
    ok(await call(fx, 'PUT', '/api/deduce/session', { bookId: 'shuihu', session: session() }))
    const factPath = join(fx.root, '故事源', 'shuihu.json')
    const before = await readFile(factPath, 'utf-8')
    const dismissed = ok(await call(fx, 'POST', '/api/deduce/pending', { bookId: 'shuihu', sessionId: 'main', pendingId: 'pending-1', action: 'dismiss' }))
    assert.equal(dismissed.session.pending.length, 0)
    assert.equal(await readFile(factPath, 'utf-8'), before)
    const again = await call(fx, 'POST', '/api/deduce/pending', { bookId: 'shuihu', sessionId: 'main', pendingId: 'pending-1', action: 'write' })
    assert.equal(again.status, 404)
    const s2 = session(); s2.pending[0].id = 'pending-2'
    ok(await call(fx, 'PUT', '/api/deduce/session', { bookId: 'shuihu', session: s2 }))
    const written = ok(await call(fx, 'POST', '/api/deduce/pending', { bookId: 'shuihu', sessionId: 'main', pendingId: 'pending-2', action: 'write' }))
    assert.ok(written.revision >= 1)
    const after = JSON.parse(await readFile(factPath, 'utf-8'))
    const entryId = s2.pending[0].entry.id
    assert.ok(after.entries.some((entry) => entry.id === entryId))
    assert.ok(after.entries.length >= JSON.parse(before).entries.length)
    const repeat = await call(fx, 'POST', '/api/deduce/pending', { bookId: 'shuihu', sessionId: 'main', pendingId: 'pending-2', action: 'write' })
    assert.equal(repeat.status, 404)
  }, { upstream: true })
})

test('OS-209 扮演：opening/turn 真经假上游、空事实包拒绝、模型不可用信封', async () => {
  await withTempDaemon(async (fx) => {
    const opening = ok(await call(fx, 'POST', '/api/roleplay/opening', { bookId: 'shuihu', pov: '洪信', premise: '测试前置' }))
    assert.ok(opening.feedback && Array.isArray(opening.options))
    const turn = ok(await call(fx, 'POST', '/api/roleplay/turn', { bookId: 'shuihu', pov: '洪信', playerAction: '向前走', premise: '测试前置' }))
    assert.ok(Array.isArray(turn.beats) && turn.feedback && Array.isArray(turn.options))
    assert.ok(fx.upstreamRequests() >= 2)
    const missingPov = await call(fx, 'POST', '/api/roleplay/opening', { bookId: 'shuihu', pov: '' })
    assert.equal(missingPov.status, 400)
    const { mkdir, mkdtemp, rm, writeFile } = await import('node:fs/promises')
    const { tmpdir } = await import('node:os')
    const { startDaemon } = await import('../src/host/daemon.mjs')
    const base = await mkdtemp(join(tmpdir(), 'os209-empty-role-'))
    const env = { LOCALAPPDATA: join(base, 'appdata'), APPDATA: join(base, 'appdata') }
    const root = join(base, '空库')
    await mkdir(join(root, '.openstory'), { recursive: true }); await mkdir(join(root, '故事源'), { recursive: true })
    await writeFile(join(root, '.openstory', 'project.json'), JSON.stringify({ spec: 'openstory-project@4', schemaVersion: 4, projectId: 'p', name: '空库', kind: 'novel', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), carriers: { primary: 'openstory.carrier.novel', enabled: ['openstory.carrier.novel'], revision: 1 } }), 'utf-8')
    await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
    const preferencesPath = join(base, 'libraries.json'); await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '空库' }] }), 'utf-8')
    const daemon = await startDaemon({ port: 0, root, preferencesPath, env, logger: { log() {} } })
    try {
      const response = await fetch(`http://127.0.0.1:${daemon.port}/api/roleplay/opening`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, pov: '洪信' }) })
      assert.equal(response.status, 400)
      assert.match((await response.json()).error.message, /还没有事实包/u)
    } finally { await daemon.close(); await rm(base, { recursive: true, force: true }) }
  }, { upstream: true })
})
