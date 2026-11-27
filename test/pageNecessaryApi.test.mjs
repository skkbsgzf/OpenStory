/** OS-208：页面必要功能端点的真实 HTTP 覆盖（日志/草稿/Agent/任务/偏好/目录/KB/同步）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ENDPOINTS, validateResponse } from '../src/api/contracts.mjs'
import { submitJob } from '../src/host/jobCenter.mjs'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

const idByEndpoint = Object.fromEntries(Object.entries(ENDPOINTS).map(([id, endpoint]) => [`${endpoint.method} ${endpoint.path}`, id]))
async function call(fx, method, path, body = {}) {
  const endpointId = idByEndpoint[`${method} ${path}`]
  assert.ok(endpointId, `未知端点 ${method} ${path}`)
  const isQuery = Boolean(ENDPOINTS[endpointId].request.query)
  const input = { ...body }
  if (isQuery && input.root === undefined && ENDPOINTS[endpointId].request.query.root !== undefined) input.root = fx.root
  const url = new URL(`http://127.0.0.1:${fx.daemon.port}${path}`)
  const options = { method }
  if (isQuery) {
    for (const [key, value] of Object.entries(input)) if (value !== undefined) url.searchParams.set(key, String(value))
  } else if (method !== 'GET') {
    options.headers = { 'content-type': 'application/json' }
    options.body = JSON.stringify(input)
  }
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => null)
  return { status: response.status, payload, endpointId }
}
const ok = (result) => {
  assert.equal(result.status, 200, JSON.stringify(result.payload))
  assert.equal(validateResponse(result.endpointId, result.payload).ok, true)
  return result.payload
}

test('OS-208 日志：写入→列表→单条→恢复→安全备份与恢复留痕', async () => {
  await withTempDaemon(async (fx) => {
    const file = '正文/001-第一回 张天师祈禳瘟疫.md'
    const before = await readFile(join(fx.root, file), 'utf-8')
    const changed = before + '\n\n日志恢复测试追加。\n'
    const put = ok(await call(fx, 'PUT', '/api/chapter', { root: fx.root, file, text: changed, module: '正文' }))
    assert.ok(put.backup)
    const listed = ok(await call(fx, 'GET', '/api/log', { root: fx.root, module: '正文', limit: '5' }))
    assert.ok(listed.entries.length >= 1)
    const entry = listed.entries.find((item) => item.file === file && item.backup)
    assert.ok(entry, '应找到带备份的正文变更')
    const one = ok(await call(fx, 'GET', '/api/log/entry', { root: fx.root, module: '正文', at: entry.at, afterHash: entry.afterHash }))
    assert.equal(one.entry.file, file)
    const badHash = await call(fx, 'GET', '/api/log/entry', { root: fx.root, module: '正文', at: entry.at, afterHash: '0'.repeat(64) })
    assert.equal(badHash.status, 404)
    const restored = ok(await call(fx, 'POST', '/api/log/restore', { root: fx.root, module: '正文', at: entry.at, afterHash: entry.afterHash }))
    assert.ok(restored.safetyBackup)
    assert.equal(await readFile(join(fx.root, file), 'utf-8'), before)
    const after = ok(await call(fx, 'GET', '/api/log', { root: fx.root, module: '正文', limit: '20' }))
    assert.ok(after.entries.some((item) => item.file === file && item.meta?.restoredFrom))
    const summary = ok(await call(fx, 'GET', '/api/log/summary', { root: fx.root }))
    assert.ok(Array.isArray(summary.modules))
  }, { upstream: true })
})

test('OS-208 草稿：upsert→读取→列表→删除；路径注入拒绝；chapters 停用后读被拦、写仍可用', async () => {
  await withTempDaemon(async (fx) => {
    const draft = ok(await call(fx, 'PUT', '/api/draft', { root: fx.root, module: 'chapters', id: 'draft-1', text: '未保存正文', meta: { file: '正文/001.md' } })).draft
    assert.equal(draft.text, '未保存正文')
    const got = ok(await call(fx, 'GET', '/api/draft', { root: fx.root, module: 'chapters', id: 'draft-1' }))
    assert.equal(got.draft.id, 'draft-1')
    const list = ok(await call(fx, 'GET', '/api/draft', { root: fx.root, module: 'chapters' }))
    assert.ok(list.drafts.some((item) => item.id === 'draft-1'))
    const bad = await call(fx, 'PUT', '/api/draft', { root: fx.root, module: '../escape', id: '../x', text: 'normalized' })
    assert.equal(bad.status, 200)
    assert.ok(!bad.payload.draft.module.includes('/') && !bad.payload.draft.module.includes('\\'))
    assert.ok(!bad.payload.draft.id.includes('/') && !bad.payload.draft.id.includes('\\'))
    const deleted = ok(await call(fx, 'PUT', '/api/draft', { root: fx.root, module: 'chapters', id: 'draft-1', delete: true }))
    assert.equal(deleted.draft, null)
    ok(await call(fx, 'PUT', '/api/ui-state', { root: fx.root, state: { 'modules.enabled.chapters': false } }))
    const blocked = await call(fx, 'GET', '/api/draft', { root: fx.root, module: 'chapters', id: 'draft-1' })
    assert.equal(blocked.status, 409)
    assert.equal(blocked.payload.error.code, 'MODULE_DISABLED')
    const hostWrite = await call(fx, 'PUT', '/api/draft', { root: fx.root, module: 'chapters', id: 'draft-2', text: '停用期间仍可暂存' })
    assert.equal(hostWrite.status, 200)
    ok(await call(fx, 'PUT', '/api/ui-state', { root: fx.root, state: { 'modules.enabled.chapters': true } }))
  })
})

test('OS-208 Agent：DSH 缺环境如实空列表、会话创建读取、选择链写入清除、未知技能拒绝', async () => {
  await withTempDaemon(async (fx) => {
    const models = ok(await call(fx, 'GET', '/api/agent/dsh/models', {}))
    assert.ok(Array.isArray(models.models))
    const session = ok(await call(fx, 'POST', '/api/agent/sessions', { root: fx.root, title: 'HTTP 测试会话' })).session
    assert.ok(session.id)
    const got = ok(await call(fx, 'GET', '/api/agent/session', { root: fx.root, id: session.id }))
    assert.equal(got.session.id, session.id)
    // OS-212：humanizer 已归 transform（不进 prompt 注入选择链），method 改用合法 craft 技能 screenplay-craft
    const picks = ok(await call(fx, 'PUT', '/api/agent-picks', { root: fx.root, style: 'de-ai-writing', methods: ['screenplay-craft'] }))
    assert.equal(picks.picks.style, 'de-ai-writing')
    const read = ok(await call(fx, 'GET', '/api/agent-picks', { root: fx.root }))
    assert.equal(read.explicit, true)
    const bad = await call(fx, 'PUT', '/api/agent-picks', { root: fx.root, style: 'not-a-real-skill', methods: [] })
    assert.equal(bad.status, 400)
  })
})

test('OS-208 任务：列表/过滤/取消/重复取消/只清终态/活跃计数', async () => {
  await withTempDaemon(async (fx) => {
    ok(await call(fx, 'GET', '/api/jobs', { root: fx.root, limit: '20' }))
    const job = submitJob({ kind: 'os208-test', label: '取消测试', root: fx.root, run: async ({ signal }) => {
      await new Promise((done) => { signal.addEventListener('abort', done, { once: true }); setTimeout(done, 5000) })
    } })
    const filtered = ok(await call(fx, 'GET', '/api/jobs', { root: fx.root, kind: 'os208-test', state: 'running' }))
    assert.ok(filtered.jobs.some((item) => item.id === job.id))
    assert.equal(filtered.active, 1)
    ok(await call(fx, 'POST', '/api/jobs/cancel', { id: job.id }))
    const again = await call(fx, 'POST', '/api/jobs/cancel', { id: job.id })
    assert.equal(again.status, 409)
    assert.equal(again.payload.error.code, 'ALREADY_SETTLED')
    const missing = await call(fx, 'POST', '/api/jobs/cancel', { id: 'job-missing' })
    assert.equal(missing.status, 404)
    const cleared = ok(await call(fx, 'POST', '/api/jobs/clear', { root: fx.root }))
    assert.ok(cleared.removed >= 1)
    const after = ok(await call(fx, 'GET', '/api/jobs', { root: fx.root }))
    assert.ok(!after.jobs.some((item) => item.id === job.id))
  })
})

test('OS-208 机器偏好：写入→重读→清空；未知皮肤拒绝；路径在临时院子', async () => {
  await withTempDaemon(async (fx) => {
    const saved = ok(await call(fx, 'PUT', '/api/ui-preferences', { skin: 'ink' }))
    assert.equal(saved.preferences.skin, 'ink')
    assert.ok(saved.path.startsWith(fx.appData))
    const read = ok(await call(fx, 'GET', '/api/ui-preferences', {}))
    assert.equal(read.preferences.skin, 'ink')
    const bad = await call(fx, 'PUT', '/api/ui-preferences', { skin: 'not a skin!' })
    assert.equal(bad.status, 400)
    const cleared = ok(await call(fx, 'PUT', '/api/ui-preferences', { skin: '' }))
    assert.notEqual(cleared.preferences.skin, 'ink')
  })
})

test('OS-208 目录：新建幂等、非法名/保留名/路径分隔符拒绝', async () => {
  await withTempDaemon(async (fx) => {
    const made = ok(await call(fx, 'POST', '/api/dir', { root: fx.root, name: '临时目录' }))
    assert.equal(made.created, true)
    const again = ok(await call(fx, 'POST', '/api/dir', { root: fx.root, name: '临时目录' }))
    assert.equal(again.created, false)
    for (const name of ['', '../x', 'a/b', '.hidden', '.openstory']) {
      const bad = await call(fx, 'POST', '/api/dir', { root: fx.root, name })
      assert.equal(bad.status, 400, `${name} 应拒绝`)
    }
  })
})

test('OS-208 知识库：配置写/密钥掩码/__KEEP__/停用不写；连接测试无外部依赖', async () => {
  await withTempDaemon(async (fx) => {
    const saved = ok(await call(fx, 'PUT', '/api/kb/config', { root: fx.root, baseUrl: 'http://127.0.0.1:1', apiKey: 'sk-test-secret-value', collections: { test: 'c1' } }))
    assert.ok(saved.status)
    const read = ok(await call(fx, 'GET', '/api/kb/config', { root: fx.root }))
    assert.equal(read.config.apiKeyMasked, 'sk-tes…alue')
    assert.equal(read.masked, true)
    assert.ok(!JSON.stringify(read).includes('sk-test-secret-value'))
    ok(await call(fx, 'PUT', '/api/kb/config', { root: fx.root, apiKey: '__KEEP__' }))
    const raw = JSON.parse(await readFile(join(fx.appData, 'OpenStory', 'openstory', 'kb-config.json'), 'utf-8'))
    assert.equal(raw.apiKey, 'sk-test-secret-value')
    const tested = ok(await call(fx, 'POST', '/api/kb/test', { root: fx.root }))
    assert.ok(tested.weknora && tested.embedding && Array.isArray(tested.collections))
    const before = raw.apiKey
    ok(await call(fx, 'PUT', '/api/ui-state', { root: fx.root, state: { 'modules.enabled.knowledge': false } }))
    const blocked = await call(fx, 'PUT', '/api/kb/config', { root: fx.root, apiKey: 'should-not-write' })
    assert.equal(blocked.status, 409)
    const after = JSON.parse(await readFile(join(fx.appData, 'OpenStory', 'openstory', 'kb-config.json'), 'utf-8'))
    assert.equal(after.apiKey, before)
    ok(await call(fx, 'PUT', '/api/ui-state', { root: fx.root, state: { 'modules.enabled.knowledge': true } }))
  })
})

test('OS-208 同步检查：返回同源/外部变更结构并刷新快照；未授权 root 拒绝', async () => {
  await withTempDaemon(async (fx) => {
    const sync = ok(await call(fx, 'POST', '/api/sync/check', { root: fx.root }))
    assert.equal(typeof sync.sameSource.wikiStale, 'boolean')
    assert.ok(Array.isArray(sync.external.externalChanges))
    const snapshot = JSON.parse(await readFile(join(fx.root, '.openstory', 'sync-state.json'), 'utf-8'))
    assert.ok(snapshot.checkedAt || snapshot.at || snapshot.generatedAt)
    const bad = await call(fx, 'POST', '/api/sync/check', { root: join(fx.base, 'not-registered') })
    assert.equal(bad.status, 403)
  }, { upstream: true })
})
