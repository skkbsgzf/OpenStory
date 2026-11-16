/**
 * FACT-FIRST 端到端验证（不经真实模型——mock LLM 路由按窗返回合法 JSON）：
 *   起 daemon（fixture 库 + fixture agent-config 指向 mock:8999）
 *   → POST /api/enrich/run → 轮询 enrichStatus → GET /api/enrich/graph
 *   → chapterPut 断言 factStale
 * 跑法：node test/e2e-fact-first.mjs（先起 node test/mock-llm.mjs）
 */
import { spawn } from 'node:child_process'
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'

const ROOT = resolve('test/fixtures/os-e2e')
const PORT = 8810
const BASE = `http://127.0.0.1:${PORT}`

// 夹具全量重建（每次全新状态，不依赖上次运行的残留）
rmSync(ROOT, { recursive: true, force: true })
mkdirSync(join(ROOT, '拆解'), { recursive: true })
mkdirSync(join(ROOT, '正文'), { recursive: true })
for (const [name, body] of [
  ['001-开局.md', '第一章 弹幕预警\n\n沈岚看到弹幕预警：末世只剩三天。林逸说她疯了。'],
  ['002-设局.md', '第二章 反向设局\n\n沈岚识破骗局，决定引导林逸卖房买米。'],
  ['003-收网.md', '第三章 合同收网\n\n沈岚出示合同，当众揭露林逸骗贷。']
]) writeFileSync(join(ROOT, '正文', name), body, 'utf8')
writeFileSync(join(ROOT, '拆解', 'e2e-book.json'), JSON.stringify({
  book: { id: 'e2e-book', title: '端到端测试书', author: 'tester', word_count: 6000 },
  entries: [
    { schema: 'fact.data/v3', id: 'plot-1', layer: 'plot', name: '开局', domain: '测试', status: 'fact',
      provenance: { book: 'e2e-book', book_id: 'e2e-book', mode: 'analyze', extractor: 'fact-chain/v1', chapters: [1] },
      who: ['沈岚', '林逸'],
      events: [
        { index: 1, who: '沈岚', channel: 'perceive', content: '沈岚看到弹幕预警：末世只剩三天。', segments: [{ index: 1, chars: 18 }] },
        { index: 2, who: '林逸', channel: 'say', content: '林逸说别听弹幕胡说，米是刚需。', segments: [{ index: 1, chars: 16 }] }
      ],
      validity: { from: 1, to: 1 } },
    { schema: 'fact.data/v3', id: 'plot-2', layer: 'plot', name: '设局', domain: '测试', status: 'fact',
      provenance: { book: 'e2e-book', book_id: 'e2e-book', mode: 'analyze', extractor: 'fact-chain/v1', chapters: [2] },
      who: ['沈岚'],
      events: [{ index: 1, who: '沈岚', channel: 'decision', content: '沈岚决定反向设局，引导林逸卖房买米。', segments: [{ index: 5, chars: 20 }] }],
      validity: { from: 2, to: 2 } },
    { schema: 'fact.data/v3', id: 'plot-3', layer: 'plot', name: '收网', domain: '测试', status: 'fact',
      provenance: { book: 'e2e-book', book_id: 'e2e-book', mode: 'analyze', extractor: 'fact-chain/v1', chapters: [3] },
      who: ['沈岚', '林逸'],
      events: [{ index: 1, who: '沈岚', channel: 'action', content: '沈岚出示合同，当众揭露林逸骗贷。', segments: [{ index: 9, chars: 18 }] }],
      validity: { from: 3, to: 3 } }
  ]
}, null, 1), 'utf8')
mkdirSync(join(ROOT, '.pinax'), { recursive: true })
writeFileSync(join(ROOT, '.pinax', 'project.json'), JSON.stringify({ spec: 'pinax-project@3', projectId: 'proj_e2e', name: 'E2E', kind: 'novel' }), 'utf8')
// preferences / agent-config 也随夹具重建（allowlist 认这个库；endpoint 型 → mock LLM）
writeFileSync(resolve('test/fixtures/os-e2e-prefs.json'), JSON.stringify({ recentProjects: [{ path: ROOT, name: 'E2E测试库' }] }), 'utf8')
// agent-config：endpoint 型 → mock LLM
writeFileSync('test/fixtures/os-e2e-agent-config.json', JSON.stringify({
  runtime: '', endpoint: 'http://127.0.0.1:8999/v1/chat/completions', model: 'mock', apiKey: '', updatedAt: new Date().toISOString()
}), 'utf8')

// 起 daemon（agentConfigPath 注入 fixture；preferences 指向同一夹具使 allowlist 认这个库）
const prefsPath = resolve('test/fixtures/os-e2e-prefs.json')
const { startDaemon } = await import('../daemon.mjs')
const daemon = await startDaemon({
  port: PORT,
  root: ROOT,
  preferencesPath: prefsPath,
  agentConfigPath: resolve('test/fixtures/os-e2e-agent-config.json')
})
console.log(`daemon on ${BASE}（root=${ROOT}）`)

const api = async (path, body) => {
  const res = await fetch(BASE + path, body
    ? { method: body.method ?? 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body.payload ?? body) }
    : {})
  return res.json()
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

let failures = []
try {
  // ① enrichRun
  console.log('① POST /api/enrich/run …')
  const run = await api('/api/enrich/run', { root: ROOT, bookId: 'e2e-book' })
  console.log('   ', JSON.stringify(run))
  if (!run.ok || !run.jobId) throw new Error('enrichRun 未返回 jobId')

  // ② 轮询 enrichStatus（上限 120s）
  let done = null
  for (let second = 0; second < 120; second += 2) {
    await sleep(2000)
    const status = await api(`/api/enrich/status?jobId=${encodeURIComponent(run.jobId)}`)
    if (second === 0) console.log('   [raw]', JSON.stringify(status).slice(0, 220))
    process.stdout.write(`   [${second}s] ${status.state} · ${status.progress?.length ?? 0} 步\r\n`)
    if (status.state === 'done' || status.state === 'failed') { done = status; break }
  }
  if (!done) throw new Error('120s 内 enrich 未完成')
  if (done.state === 'failed') throw new Error(`enrich 失败：${done.error}`)
  console.log(`② enrich 完成：${JSON.stringify(done.summary).slice(0, 220)}`)

  // ③ enrichGraph
  const graph = await api(`/api/enrich/graph?root=${encodeURIComponent(ROOT)}&bookId=e2e-book`)
  if (!graph.ok) throw new Error(`enrichGraph 失败：${graph.message ?? '?'}`)
  console.log(`③ 因果图：${graph.causalGraph?.nodes?.length ?? 0} 节点 / ${graph.causalGraph?.edges?.length ?? 0} 边 / ${graph.causalGraph?.threads?.length ?? 0} 线`)
  console.log(`   指标：${JSON.stringify(graph.metrics)}`)
  console.log(`   需求：${graph.needs?.filter((n) => n.needs?.length).length ?? 0} 人`)

  // ④ chapterPut 断言 factStale（改正文 mtime → 事实链落后）
  const put = await api('/api/chapter', { method: 'PUT', payload: { root: ROOT, file: '正文/001-开局.md', text: '第一章正文：林逸去了超市。（已改）' } })
  console.log(`④ chapterPut：${JSON.stringify(put).slice(0, 300)}`)
  console.log(`   factStale=${put.factStale}（factEntries=${put.factEntries}）`)

  // 验收断言
  const checks = [
    ['章批五合一', done.summary.chapters === 3],
    ['因果图有边', (graph.causalGraph?.edges?.length ?? 0) > 0],
    ['闭环率可算', graph.metrics?.closedRate !== null && graph.metrics?.closedRate !== undefined],
    ['需求层级有数据', (graph.needs?.filter((n) => n.needs?.length).length ?? 0) > 0],
    ['chapterPut 带 factStale 且正文更新后为 true', put.factStale === true]
  ]
  failures = checks.filter(([, pass]) => !pass)
  checks.forEach(([label, pass]) => console.log(`   ${pass ? '✓' : '✗'} ${label}`))
  if (failures.length) throw new Error(`${failures.length} 项验收未过`)
  console.log('\n端到端全链路：通过')
} catch (error) {
  console.error('\n✗ 端到端失败：', error.message)
  failures.push({ stage: 'e2e', reason: error.message })
} finally {
  await daemon.close().catch(() => {})
  if (failures.length) process.exit(1)
}
