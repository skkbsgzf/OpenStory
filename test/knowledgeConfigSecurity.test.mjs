/** OS-229：knowledge 配置端点安全与既有知识库连接兼容的定向测试。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createHandlers } from '../src/modules/knowledge/handlers.mjs'
import { defaultKbConfigPath } from '../src/modules/knowledge/knowledgeAdapter.mjs'
import { API_ERROR_CODES } from '../src/api/contracts.mjs'
import { sendError, sendJson } from '../src/host/http.mjs'

function createResponse() {
  return {
    statusCode: null,
    headers: null,
    body: '',
    writeHead(status, headers) { this.statusCode = status; this.headers = headers },
    end(body) { this.body = body }
  }
}

function createFixture({ env } = {}) {
  const handlers = createHandlers({
    host: {
      apiErrors: API_ERROR_CODES,
      sendError,
      sendJson,
      text: (value) => String(value ?? '')
    }
  })
  return async (id, { request = {}, context = {} } = {}) => {
    const res = createResponse()
    await handlers[id]({ res, request, context: { env, ...context } })
    return { status: res.statusCode, payload: JSON.parse(res.body) }
  }
}

async function withConfig(t, raw, run) {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os229-'))
  const env = { ...process.env, LOCALAPPDATA: base, APPDATA: base }
  const configPath = defaultKbConfigPath(env)
  t.after(async () => { await rm(base, { recursive: true, force: true }) })
  await mkdir(dirname(configPath), { recursive: true })
  await writeFile(configPath, raw, 'utf-8')
  return run({ base, env, configPath })
}

test('kbConfigGet：长密钥只回尾号，短密钥（1～8）全掩码，响应不含明文', async (t) => {
  for (const [key, expected] of [['tiny-secret-tail', '••••tail'], ['12345678', '••••'], ['sk-abcdefgh-tail', '••••tail']]) {
    await withConfig(t, JSON.stringify({ apiKey: key, collections: {} }), async ({ env, configPath }) => {
      const call = createFixture({ env })
      const result = await call('kbConfigGet')
      assert.equal(result.status, 200)
      assert.equal(result.payload.ok, true)
      assert.equal(result.payload.masked, true)
      assert.equal(result.payload.configPath, configPath)
      assert.equal(result.payload.config.apiKeyMasked, expected)
      assert.equal(result.payload.config.apiKeyMasked.includes(key), false)
      assert.equal(JSON.stringify(result.payload).includes(key), false)
    })
  }
})

test('kbConfigPut/kbTest：坏 JSON 回 KB_CONFIG_CORRUPT(500)，原字节逐字不变', async (t) => {
  const secret = 'sk-broken-config-secret'
  const raw = `{"apiKey":"${secret}","baseUrl":"http://127.0.0.1:1",broken`
  await withConfig(t, raw, async ({ env, configPath }) => {
    const call = createFixture({ env })
    const put = await call('kbConfigPut', { request: { baseUrl: 'http://127.0.0.1:2', apiKey: 'replacement' } })
    assert.equal(put.status, 500)
    assert.equal(put.payload.ok, false)
    assert.equal(put.payload.error.code, 'KB_CONFIG_CORRUPT')
    assert.equal(await readFile(configPath, 'utf-8'), raw)
    assert.equal(JSON.stringify(put.payload).includes(secret), false)

    const probe = await call('kbTest', { request: { baseUrl: 'http://127.0.0.1:2' } })
    assert.equal(probe.status, 500)
    assert.equal(probe.payload.error.code, 'KB_CONFIG_CORRUPT')
    assert.equal(await readFile(configPath, 'utf-8'), raw)
    assert.equal(JSON.stringify(probe.payload).includes(secret), false)
  })
})

test('kbConfigPut/kbTest：目录形态的不可读配置同样拒绝，错误不含路径/底层消息', async (t) => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os229-unreadable-'))
  const env = { ...process.env, LOCALAPPDATA: base, APPDATA: base }
  const configPath = defaultKbConfigPath(env)
  t.after(async () => { await rm(base, { recursive: true, force: true }) })
  await mkdir(configPath, { recursive: true })
  const call = createFixture({ env })
  const put = await call('kbConfigPut', { request: { apiKey: 'replacement' } })
  assert.equal(put.status, 500)
  assert.equal(put.payload.error.code, 'KB_CONFIG_CORRUPT')
  assert.equal(JSON.stringify(put.payload).includes(configPath), false)
  assert.equal((await call('kbTest')).payload.error.code, 'KB_CONFIG_CORRUPT')
  assert.equal((await stat(configPath)).isDirectory(), true)
})

test('kbConfigPut：合法配置继续原子写入并支持 __KEEP__，端点形状不变', async (t) => {
  const secret = 'sk-keep-this-secret'
  await withConfig(t, JSON.stringify({ backend: 'weknora', baseUrl: 'http://127.0.0.1:1', apiKey: secret, spaceId: 's1' }), async ({ env, configPath }) => {
    const call = createFixture({ env })
    const result = await call('kbConfigPut', { request: { apiKey: '__KEEP__', collections: { 案例库: 'kb-1' } } })
    assert.equal(result.status, 200)
    assert.equal(result.payload.ok, true)
    assert.ok(result.payload.status)
    const saved = JSON.parse(await readFile(configPath, 'utf-8'))
    assert.equal(saved.apiKey, secret)
    assert.deepEqual(saved.collections, { 案例库: 'kb-1' })
    assert.equal(JSON.stringify(result.payload).includes(secret), false, '配置端点不回显持久化密钥')
  })
})
