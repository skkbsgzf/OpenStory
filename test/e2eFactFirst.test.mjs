/**
 * FACT-FIRST 端到端（node:test 版，OS-135② 自 test/e2e-fact-first.mjs 等价移植）：
 *   起 daemon（系统临时夹具库＋临时端口 mock LLM）→ POST /api/enrich/run
 *   → 轮询 enrichStatus → GET /api/enrich/graph → chapterPut 断言 factStale。
 *
 * 与原脚本的同与异：
 *   · 五条验收断言逐条保留（章批五合一/因果图有边/闭环率可算/需求层级有数据/factStale）；
 *   · 夹具改放系统临时目录（不再写 test/fixtures/os-e2e）；
 *   · mock LLM 改测试内临时端口（原独立脚本固定 8999，node --test 并行会撞）；
 *   · 进 npm test（node --test 只认 *.test.mjs，原脚本此前是孤儿流程）。
 * 夹具数据真相在 test/fixtures/osE2eBook.mjs（与 fact-curve.test.mjs 共用）。
 *
 * 跑法：node --test test/e2eFactFirst.test.mjs（或 npm test）
 */
import { strict as assert } from 'node:assert'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { validateResponse } from '../contracts.mjs'
import { startMockLlmServer } from './mockLlmServer.mjs'
import { writeE2eBookFixture, E2E_BOOK_ID } from './fixtures/osE2eBook.mjs'

let base = ''
let libRoot = ''
let daemon = null
let mock = null

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

before(async () => {
  const { startDaemon } = await import('../daemon.mjs')
  base = await mkdtemp(join(tmpdir(), 'os135-e2e-fact-first-'))
  libRoot = join(base, 'lib')
  await writeE2eBookFixture(libRoot)
  mock = await startMockLlmServer()
  // agent-config：endpoint 型 → 临时端口 mock LLM（放临时目录——loadConfigV2 迁移旧形状会写回）
  await writeFile(join(base, 'agent-config.json'), JSON.stringify({
    runtime: '', endpoint: mock.endpoint, model: 'mock', apiKey: '', updatedAt: new Date().toISOString()
  }), 'utf8')
  await mkdir(join(base, 'appdata'), { recursive: true })
  daemon = await startDaemon({
    port: 0,
    root: libRoot,
    preferencesPath: join(base, 'prefs.json'),
    agentConfigPath: join(base, 'agent-config.json'),
    env: { ...process.env, LOCALAPPDATA: join(base, 'appdata') },
    logger: { log: () => {} }
  })
})

after(async () => {
  if (daemon) await daemon.close()
  if (mock) await mock.close()
  await rm(base, { recursive: true, force: true })
})

const api = async (path, body) => {
  const response = await fetch(`http://127.0.0.1:${daemon.port}${path}`, body === undefined
    ? {}
    : { method: body.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body.payload ?? body) })
  return { status: response.status, body: await response.json() }
}

describe('enrich 全链路：run → status 轮询 → graph（mock LLM）', () => {
  it('① enrichRun 返回 jobId（契约形状）', async () => {
    const { status, body } = await api('/api/enrich/run', { root: libRoot, bookId: E2E_BOOK_ID })
    assert.equal(status, 200, `实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.ok, true)
    assert.ok(body.jobId, 'enrichRun 未返回 jobId')
    assert.equal(validateResponse('enrichRun', body).ok, true)
  })

  it('② enrichStatus 轮询到 done：章批五合一（3 章）＋进度窗非空（原验收①）', async () => {
    // 用上一例的流程重跑一次拿 jobId（用例要自洽，不跨用例共享可变状态）
    const run = await api('/api/enrich/run', { root: libRoot, bookId: E2E_BOOK_ID })
    assert.equal(run.status, 200)
    let done = null
    for (let second = 0; second < 60 && !done; second += 1) {
      await wait(500)
      const polled = await api(`/api/enrich/status?jobId=${encodeURIComponent(run.body.jobId)}`)
      assert.equal(polled.status, 200, `轮询应 200：${JSON.stringify(polled.body)}`)
      assert.equal(validateResponse('enrichStatus', polled.body).ok, true)
      if (polled.body.state === 'done' || polled.body.state === 'failed') done = polled.body
    }
    assert.ok(done, '60s 内 enrich 未完成')
    assert.equal(done.state, 'done', `enrich 失败：${done.error}`)
    assert.equal(done.summary.chapters, 3, '章批五合一：三章库应拆出 3 章')
    assert.ok((done.progress?.length ?? 0) > 0, '进度窗应有记录')
  })

  it('③ enrichGraph：因果图有边＋闭环率可算＋需求层级有数据（原验收②③④，契约形状）', async () => {
    const { status, body } = await api(`/api/enrich/graph?root=${encodeURIComponent(libRoot)}&bookId=${E2E_BOOK_ID}`)
    assert.equal(status, 200, `实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.ok, true)
    assert.equal(validateResponse('enrichGraph', body).ok, true)
    assert.ok((body.causalGraph?.edges?.length ?? 0) > 0, '因果图有边')
    assert.ok(body.metrics?.closedRate !== null && body.metrics?.closedRate !== undefined, '闭环率可算')
    assert.ok((body.needs?.filter((n) => n.needs?.length).length ?? 0) > 0, '需求层级有数据')
    // enrich 的产物应已落到兄弟 wiki（writtenToSidecar）
    assert.equal(body.slots && typeof body.slots === 'object', true, '六槽位应有落档')
  })

  it('④ chapterPut 带 factStale 且正文更新后为 true（原验收⑤，FACT-FIRST 规则 5）', async () => {
    const put = await api('/api/chapter', { method: 'PUT', payload: { root: libRoot, file: '正文/001-开局.md', text: '第一章正文：林逸去了超市。（已改）' } })
    assert.equal(put.status, 200, `实际 ${put.status}：${JSON.stringify(put.body)}`)
    assert.equal(validateResponse('chapterPut', put.body).ok, true)
    assert.equal(put.body.factStale, true, '正文更新后必须如实标过期')
    assert.ok(Number.isInteger(put.body.factEntries) && put.body.factEntries > 0)
  })

  it('⑤ mock LLM 真被调用过（不是静默跳过）', async () => {
    assert.ok(mock.calls.length >= 6, `enrich 至少要走章批/人物/因果/世界/台账/槽位等窗口，实际 ${mock.calls.length} 次`)
  })
})
