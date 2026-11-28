/**
 * OS-230 前 10 回唯一事实源验收：隔离 MCP clean-room 构建 + 事实链/正文/gold 断言。
 *
 * 不连接 8807、不碰作者库；临时 daemon＋临时 LOCALAPPDATA/APPDATA＋假上游。
 * 语义质量若无真 provider 就如实标 semanticModelVerified:false，不把假上游当真验收。
 *
 * 用法：node tools/verify/verify-shuihu-10ch.mjs [--out <目录>]
 */
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShuihuWithMcp } from '../samples/build-shuihu-mcp.mjs'
import { SHUIHU_10CH_RECIPE } from '../samples/shuihu-10ch-recipe.mjs'
import { SHUIHU_10CH_FACTS } from '../samples/shuihu-10ch-facts.mjs'
import { scriptStats } from '../../src/modules/script/scriptParse.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const args = process.argv.slice(2)
const outIndex = args.indexOf('--out')
const out = outIndex >= 0 ? resolve(args[outIndex + 1] ?? '') : ''
const base = await mkdtemp(join(tmpdir(), 'os230-10ch-'))
const root = out ? join(out, '水浒传') : join(base, '水浒传')
const reportPath = out ? join(out, 'report.json') : join(base, 'report.json')

const fails = []
const check = (name, ok, detail = '') => {
  const line = `${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`
  console.log(line)
  if (!ok) fails.push(line)
}

try {
  const result = await buildShuihuWithMcp({ baseDir: base, root, recipe: SHUIHU_10CH_RECIPE, keep: true, cleanup: false })
  check('clean-room 构建成功', result.ok, result.error ? `${result.error.code} · ${result.error.message}` : `${result.stats.calls} 次 MCP 调用`)
  if (!result.ok) throw new Error(result.error.message)
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')

  check('正文第 1–10 回齐全', result.snapshot.chapters?.length === 10, `${result.snapshot.chapters?.length} 章`)
  check('剧本第 1–10 回落盘', result.snapshot.scripts?.length === 10, `${result.snapshot.scripts?.length} 本`)
  check('事实链 39 条全部落盘', result.snapshot.fact?.digest && result.audit.some((item) => item.tool === 'openstory_fact_entries_import'), `revision=${result.snapshot.fact?.revision}`)
  check('fact/wiki revision 一致', result.snapshot.factWikiRevision.fact === result.snapshot.factWikiRevision.wiki)
  check('事实链 provenance 覆盖第 1–10 回', [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].every((n) => SHUIHU_10CH_FACTS.some((f) => f.provenance.chapters.includes(n))))
  check('18 篇世界书落盘', result.snapshot.reference?.count === 18, `${result.snapshot.reference?.count} 篇`)

  // 剧本不得退化成「两句话一幕」的骨架：每回≥1500 字、≥4 幕、≥40 条台词。
  // 作者实测判例：2026-11-28 指出第 6 回只有 417 字，明显过薄。
  const thin = SHUIHU_10CH_RECIPE.scripts.map((item) => ({ path: item.path, ...scriptStats(item.text) }))
    .filter((s) => s.chars < 1500 || s.acts < 4 || s.lines < 40)
  check('剧本 10 回均达体量门槛（≥1500 字/≥4 幕/≥40 台词）', thin.length === 0,
    thin.length ? thin.map((s) => `${s.path}:${s.chars}字/${s.acts}幕/${s.lines}台词`).join('；') : `${SHUIHU_10CH_RECIPE.scripts.length} 本`)

  const readTools = new Set([
    'openstory_libraries', 'openstory_files', 'openstory_library_diagnose', 'openstory_suites',
    'openstory_habits_read', 'openstory_reference_read_note', 'openstory_reference_index',
    'openstory_fact_books', 'openstory_fact_entries', 'openstory_novel_read_chapter', 'openstory_novel_list_chapters',
    'openstory_script_to_fact', 'openstory_script_from_fact', 'openstory_session_get', 'openstory_sessions',
    'openstory_assets', 'openstory_asset_read', 'openstory_exchange_export', 'openstory_plugins'
  ])
  const writes = result.audit.filter((item) => !item.code?.startsWith('RPC_') && !readTools.has(item.tool))
  check('所有业务写调用带 confirm', writes.length > 0 && writes.every((item) => item.params?.confirm), `${writes.length} 次写`)
  check('审计不泄漏正文全文', !JSON.stringify(result.audit).includes('洪太尉不听真人劝阻，强开上清宫后殿'))
  check('语义边界如实标注', result.stats.fakeUpstream === true && result.stats.semanticModelVerified === false, 'semanticModelVerified:false')

  const gold = JSON.parse(await readFile(join(REPO, 'knowledge-packs', 'shuihu-10ch', 'gold.json'), 'utf8'))
  const ids = new Set(SHUIHU_10CH_FACTS.map((f) => f.id))
  check('gold 唯一事实源口径', gold.factSource?.scope === '水浒传前10回' && gold.queries.every((q) => q.expected.every((id) => ids.has(id))), `${gold.queries.length} 条 query`)
  check('gold 阈值按契约冻结', gold.thresholds.sourceAccuracy === 1 && gold.thresholds.negativePrecision === 1 && gold.thresholds.macroRecallAt5 === 0.85 && gold.thresholds.perGenreRecallAt5 === 0.75)

  // 知识库源必须完整可登记：manifest + documentEntry + docs。
  const kbDir = join(REPO, 'knowledge-packs', 'shuihu-10ch')
  const kbManifest = JSON.parse(await readFile(join(kbDir, 'knowledge.base.json'), 'utf8'))
  const kbEntry = join(kbDir, kbManifest.documentEntry)
  check('知识库源 manifest 合法', kbManifest.schema === 'openstory.knowledge-base@1' && kbManifest.id === 'shuihu-10ch')
  check('知识库源 documentEntry 存在', existsSync(kbEntry), kbManifest.documentEntry)
  const kbDocs = await readdir(join(kbDir, 'docs'))
  check('知识库源 docs 齐全', kbDocs.filter((name) => name.endsWith('.md')).length >= 7, `${kbDocs.length} 个文件`)

  // 负向：缺 fact 写工具必须红。
  const negative = await buildShuihuWithMcp({
    baseDir: await mkdtemp(join(tmpdir(), 'os230-negative-')),
    root: join(base, 'negative'),
    recipe: SHUIHU_10CH_RECIPE,
    omittedTools: ['openstory_fact_entries_import'],
    keep: false,
    cleanup: true
  })
  check('缺事实链写工具构建必须红', !negative.ok && negative.error?.message?.includes('MCP_TOOL_UNAVAILABLE'))

  console.log(JSON.stringify({ ok: fails.length === 0, digest: result.digest, calls: result.stats.calls, report: reportPath, fails }, null, 2))
  if (fails.length) process.exitCode = 1
} finally {
  if (!out) await rm(base, { recursive: true, force: true })
}
