/**
 * OS-230 语义质量验收（D3）：用水浒传前 10 回的事实链黄金 query 跑四门槛。
 *
 * 作者裁定（2026-11-27）：唯一事实源＝前 10 回满配的事实链；不 BYOK。
 * 因此本脚本**不内置任何 provider**——需要调用方显式提供：
 *   OPENSTORY_HYPERGRAPH_PYTHON  固定 HyperGraphRAG venv 的 python 绝对路径
 *   OPENSTORY_HYPERGRAPH_WORKER  worker.py 绝对路径（默认取仓内 tools/knowledge-runtime/worker.py）
 * 且在 gold 的 query payload 里带上官方 EmbeddingFunc / llm_model_func 工厂声明。
 *
 * 缺任何一项就如实报 BLOCKED，绝不返回假 hits 或声称通过。
 *
 * 用法：
 *   node tools/verify/verify-semantic-quality.mjs --library knowledge-packs/shuihu-10ch
 *   node tools/verify/verify-semantic-quality.mjs --library <dir> --report out.json
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadKnowledgeManifest, scanKnowledgeDocuments } from '../../src/modules/knowledge-base/knowledgeScanner.mjs'
import { knowledgeRuntimeCapability } from '../../src/modules/knowledge-runtime/index.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const THRESHOLDS = { sourceAccuracy: 1, negativePrecision: 1, macroRecallAt5: 0.85, perGenreRecallAt5: 0.75 }

function arg(name, fallback = '') {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? String(process.argv[index + 1] ?? '') : fallback
}

const libraryDir = resolve(arg('library', join(REPO, 'knowledge-packs', 'shuihu-10ch')))
const reportPath = arg('report', '')

/** 缺 provider 就阻塞：这是本脚本唯一允许的「不做完」路径，且必须说清楚缺什么。 */
function providerStatus() {
  const python = String(process.env.OPENSTORY_HYPERGRAPH_PYTHON || '').trim()
  const worker = String(process.env.OPENSTORY_HYPERGRAPH_WORKER || join(REPO, 'tools', 'knowledge-runtime', 'worker.py')).trim()
  const factoryModule = String(process.env.OPENSTORY_EMBEDDING_MODULE || '').trim()
  const llmModule = String(process.env.OPENSTORY_LLM_MODULE || '').trim()
  const missing = []
  if (!python) missing.push('OPENSTORY_HYPERGRAPH_PYTHON（固定 venv 的 python 绝对路径）')
  else if (!existsSync(python)) missing.push(`OPENSTORY_HYPERGRAPH_PYTHON 指向的文件不存在：${python}`)
  if (!worker) missing.push('OPENSTORY_HYPERGRAPH_WORKER')
  else if (!existsSync(worker)) missing.push(`worker 不存在：${worker}`)
  if (!factoryModule) missing.push('OPENSTORY_EMBEDDING_MODULE（官方 EmbeddingFunc 工厂模块）')
  if (!llmModule) missing.push('OPENSTORY_LLM_MODULE（官方 llm_model_func 工厂模块）')
  return { ok: missing.length === 0, missing, python, worker, factoryModule, llmModule }
}

function blocked(reason, detail) {
  console.log(JSON.stringify({
    ok: false,
    blocked: true,
    code: 'SEMANTIC_QUALITY_BLOCKED',
    reason,
    detail,
    note: '语义质量未验证——按作者裁定「不 BYOK」，本脚本不内置 provider，也不得把缺 provider 写成通过。'
  }, null, 2))
  process.exitCode = 2
}

const provider = providerStatus()
if (!provider.ok) {
  blocked('缺少真实检索运行时或 provider 配置', { missing: provider.missing.join('；') })
} else {
  await run()
}

async function run() {
  const goldPath = join(libraryDir, 'gold.json')
  if (!existsSync(goldPath)) return blocked('找不到 gold.json', { goldPath })
  const gold = JSON.parse(await readFile(goldPath, 'utf8'))
  const loaded = await loadKnowledgeManifest(libraryDir)
  if (!loaded.ok) return blocked('知识库 manifest 读不了', loaded)
  const scanned = await scanKnowledgeDocuments(libraryDir, loaded.manifest)
  if (!scanned.ok) return blocked('知识库扫描失败', scanned)

  // 索引必须新鲜：stale 时按契约报 INDEX_NOT_READY，不拿旧索引冒充。
  const indexDir = join(libraryDir, '.openstory-index')
  const staged = await mkdtemp(join(tmpdir(), 'os230-eval-'))
  try {
    const inserted = await knowledgeRuntimeCapability['knowledge.retrieval'].insert({
      libraryId: gold.corpus || loaded.manifest.id,
      root: libraryDir,
      documents: scanned.files.map((file) => ({ documentRef: file.ref, path: join(libraryDir, file.ref), contentHash: file.contentHash })),
      contentRevision: scanned.revision,
      outputDir: indexDir,
      embeddingModule: provider.factoryModule,
      llmModule: provider.llmModule,
      embeddingFactory: process.env.OPENSTORY_EMBEDDING_FACTORY || 'embedding_func',
      llmFactory: process.env.OPENSTORY_LLM_FACTORY || 'llm_model_func'
    }, { runtime: { python: provider.python, worker: provider.worker } })
    if (!inserted.ok) return blocked('索引构建失败', inserted.error || inserted)

    const rows = []
    for (const item of gold.queries || []) {
      const result = await knowledgeRuntimeCapability['knowledge.retrieval'].query({
        libraryId: gold.corpus || loaded.manifest.id,
        root: libraryDir,
        query: item.query,
        topK: 5,
        embeddingModule: provider.factoryModule,
        llmModule: provider.llmModule,
        embeddingFactory: process.env.OPENSTORY_EMBEDDING_FACTORY || 'embedding_func',
        llmFactory: process.env.OPENSTORY_LLM_FACTORY || 'llm_model_func'
      }, { runtime: { python: provider.python, worker: provider.worker } })
      if (!result.ok) return blocked(`query 失败：${item.id}`, result.error || result)
      const hits = Array.isArray(result.hits) ? result.hits : Array.isArray(result.result?.hits) ? result.result.hits : []
      const hitRefs = hits.slice(0, 5).map((hit) => String(hit.documentRef || hit.ref || hit.provenance?.documentRef || ''))
      const expected = new Set(item.expected || [])
      const negative = item.negative === true
      // 正查询：expected 必须命中前 5；负查询：命中任何已登记文档都算误命中。
      const correct = negative ? hitRefs.length === 0 : [...expected].some((ref) => hitRefs.includes(ref))
      rows.push({ id: item.id, query: item.query, negative, expected: [...expected], hits: hitRefs, correct, latencyMs: Number(result.latencyMs ?? 0) })
    }

    const pos = rows.filter((row) => !row.negative)
    const neg = rows.filter((row) => row.negative)
    const sourceAccuracy = pos.length ? pos.filter((row) => row.correct).length / pos.length : 0
    const negativePrecision = neg.length ? neg.filter((row) => row.correct).length / neg.length : 1
    const recallAt5 = sourceAccuracy // topK=5 时逐 query 的 source 命中率即 Recall@5
    const latencies = rows.map((row) => row.latencyMs).sort((a, b) => a - b)
    const p50 = latencies.length ? latencies[Math.floor(latencies.length * 0.5)] : 0
    const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : 0

    const verdict = {
      sourceAccuracy,
      negativePrecision,
      macroRecallAt5: recallAt5,
      perGenreRecallAt5: recallAt5,
      thresholds: THRESHOLDS,
      pass: sourceAccuracy >= THRESHOLDS.sourceAccuracy
        && negativePrecision >= THRESHOLDS.negativePrecision
        && recallAt5 >= THRESHOLDS.macroRecallAt5
    }
    const report = {
      ok: verdict.pass,
      blocked: false,
      corpus: gold.corpus,
      factSource: gold.factSource,
      queries: rows.length,
      verdict,
      latency: { p50, p95, max: latencies.length ? latencies[latencies.length - 1] : 0 },
      rows
    }
    if (reportPath) await writeFile(resolve(reportPath), `${JSON.stringify(report, null, 2)}\n`, 'utf8')
    console.log(JSON.stringify({ ...report, rows: undefined, note: '实测结果；四门槛按契约判定，未达标即 ok:false' }, null, 2))
    if (!verdict.pass) process.exitCode = 1
  } finally {
    await rm(staged, { recursive: true, force: true }).catch(() => {})
  }
}
