/**
 * OS-135② enrich 端点直测：job 语义与错误分支（happy path 全链路在 e2eFactFirst.test.mjs）。
 *
 *   · enrichStatus：job 即身份（内存 Map），未知 jobId＝NOT_FOUND，不校验 root；
 *   · enrichRun：bookId 缺失＝INVALID_ENTRY；事实链为空＝INVALID_ENTRY（先于任何模型调用）；
 *     没配模型端点＝AGENT_UPSTREAM_ERROR（piUpstream 的「还没配置」被包成上游错误如实报）；
 *   · enrichGraph：bookId 不存在／拆解档缺失＝NOT_FOUND（同步、零模型）。
 *
 * LLM 用测试内临时端口的 mock（test/mockLlmServer.mjs）；夹具在系统临时目录。
 * 契约：contracts/fact.mjs enrichRun / enrichStatus / enrichGraph。
 *
 * 跑法：node --test test/enrichPipeline.test.mjs
 */
import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { startMockLlmServer } from './mockLlmServer.mjs'
import { writeE2eBookFixture, E2E_BOOK_ID } from './fixtures/osE2eBook.mjs'

let base = ''
let libRoot = ''
let emptyLibRoot = ''
let daemon = null
let noConfigDaemon = null
let mock = null

before(async () => {
  const { startDaemon } = await import('../daemon.mjs')
  base = await mkdtemp(join(tmpdir(), 'os135-enrich-pipeline-'))
  libRoot = join(base, 'lib')       // 有夹具书
  emptyLibRoot = join(base, 'empty') // 拆解目录为空＝事实链为空
  await writeE2eBookFixture(libRoot)
  await mkdir(join(emptyLibRoot, '拆解'), { recursive: true })
  mock = await startMockLlmServer()
  await writeFile(join(base, 'agent-config.json'), JSON.stringify({
    runtime: '', endpoint: mock.endpoint, model: 'mock', apiKey: '', updatedAt: new Date().toISOString()
  }), 'utf8')
  await writeFile(join(base, 'agent-config-empty.json'), JSON.stringify({
    runtime: '', endpoint: '', model: '', apiKey: '', updatedAt: new Date().toISOString()
  }), 'utf8')
  await mkdir(join(base, 'appdata'), { recursive: true })
  daemon = await startDaemon({
    port: 0,
    root: libRoot,
    extraRoots: [emptyLibRoot],
    preferencesPath: join(base, 'prefs.json'),
    agentConfigPath: join(base, 'agent-config.json'),
    env: { ...process.env, LOCALAPPDATA: join(base, 'appdata') },
    logger: { log: () => {} }
  })
  noConfigDaemon = await startDaemon({
    port: 0,
    root: libRoot,
    preferencesPath: join(base, 'prefs-noconfig.json'),
    agentConfigPath: join(base, 'agent-config-empty.json'),
    env: { ...process.env, LOCALAPPDATA: join(base, 'appdata') },
    logger: { log: () => {} }
  })
})

after(async () => {
  if (daemon) await daemon.close()
  if (noConfigDaemon) await noConfigDaemon.close()
  if (mock) await mock.close()
  await rm(base, { recursive: true, force: true })
})

const post = async (daemonRef, path, body) => {
  const response = await fetch(`http://127.0.0.1:${daemonRef.port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}
const get = async (daemonRef, path) => {
  const response = await fetch(`http://127.0.0.1:${daemonRef.port}${path}`)
  return { status: response.status, body: await response.json() }
}

describe('enrichStatus：job 即身份', () => {
  it('未知 jobId＝404 NOT_FOUND（不校验 root，契约只声明 NOT_FOUND）', async () => {
    const { status, body } = await get(daemon, '/api/enrich/status?jobId=never-issued')
    assert.equal(status, 404)
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'NOT_FOUND')
  })
})

describe('enrichRun：请求闸门', () => {
  it('bookId 缺失＝400 INVALID_ENTRY', async () => {
    const { status, body } = await post(daemon, '/api/enrich/run', { root: libRoot })
    assert.equal(status, 400)
    assert.equal(body.error.code, 'INVALID_ENTRY')
  })

  it('事实链为空＝400 INVALID_ENTRY（先于任何模型调用——mock 一次都没被碰）', async () => {
    const callsBefore = mock.calls.length
    const { status, body } = await post(daemon, '/api/enrich/run', { root: emptyLibRoot, bookId: 'empty-book' })
    assert.equal(status, 400)
    assert.equal(body.error.code, 'INVALID_ENTRY')
    assert.match(body.error.message, /事实链为空/u)
    assert.equal(mock.calls.length, callsBefore, '闸门应在模型调用前拦下')
  })

  it('没配模型端点＝502 AGENT_UPSTREAM_ERROR（不冒充模型回答）', async () => {
    const { status, body } = await post(noConfigDaemon, '/api/enrich/run', { root: libRoot, bookId: E2E_BOOK_ID })
    assert.equal(status, 502)
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'AGENT_UPSTREAM_ERROR')
    assert.match(body.error.message, /端点/u)
  })
})

describe('enrichGraph：派生层读取', () => {
  it('bookId 缺失＝400 INVALID_ENTRY', async () => {
    const { status, body } = await get(daemon, `/api/enrich/graph?root=${encodeURIComponent(libRoot)}`)
    assert.equal(status, 400)
    assert.equal(body.error.code, 'INVALID_ENTRY')
  })

  it('bookId 不存在＝404 NOT_FOUND', async () => {
    const { status, body } = await get(daemon, `/api/enrich/graph?root=${encodeURIComponent(libRoot)}&bookId=no-such-book`)
    assert.equal(status, 404)
    assert.equal(body.error.code, 'NOT_FOUND')
  })

  it('拆解档缺失的库＝404 NOT_FOUND', async () => {
    const { status, body } = await get(daemon, `/api/enrich/graph?root=${encodeURIComponent(emptyLibRoot)}&bookId=empty-book`)
    assert.equal(status, 404)
    assert.equal(body.error.code, 'NOT_FOUND')
  })
})
