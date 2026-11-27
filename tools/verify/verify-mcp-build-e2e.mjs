/**
 * OS-217 门禁：MCP-only《水浒传》clean-room 构建 + 调用审计 + 缺工具负向。
 *
 * 用法：node tools/verify/verify-mcp-build-e2e.mjs [--out <目录>]
 * 不传 --out：全在系统临时目录完成并清理；--out：保留候选库与报告，供 OS-218 使用。
 * 不连接 8807、不读真库；所有库与 LOCALAPPDATA 都是临时夹具。
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShuihuWithMcp } from '../samples/build-shuihu-mcp.mjs'
import { SHUIHU_FULL_RECIPE } from '../samples/shuihu-full-recipe.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

function parse(argv) {
  let out = ''
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') out = resolve(argv[++index] ?? '')
    else throw new Error(`未知参数：${argv[index]}`)
  }
  return { out }
}

const options = parse(process.argv.slice(2))
const base = options.out ? await mkdtemp(join(tmpdir(), 'os217-verify-base-')) : await mkdtemp(join(tmpdir(), 'os217-verify-'))
const root = options.out ? join(options.out, '水浒传') : join(base, '水浒传')
const reportPath = options.out ? join(options.out, 'report.json') : join(base, 'report.json')
const auditPath = options.out ? join(options.out, 'mcp-audit.jsonl') : join(base, 'mcp-audit.jsonl')

try {
  const result = await buildShuihuWithMcp({
    baseDir: base,
    root,
    recipe: SHUIHU_FULL_RECIPE,
    keep: true,
    cleanup: false
  })
  await mkdir(dirname(reportPath), { recursive: true })
  await writeFile(reportPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8')
  await writeFile(auditPath, `${result.audit.map((item) => JSON.stringify(item)).join('\n')}\n`, 'utf8')
  if (!result.ok) throw new Error(`${result.error.code} · ${result.error.message}`)

  // 审计硬断言：业务写入只来自 MCP；所有写调用都带确认；参数正文不落审计全文。
  const writes = result.audit.filter((item) => !item.code.startsWith('RPC_') && ![
    'openstory_libraries', 'openstory_files', 'openstory_library_diagnose', 'openstory_suites',
    'openstory_habits_read', 'openstory_reference_read_note', 'openstory_reference_index',
    'openstory_fact_books', 'openstory_fact_entries', 'openstory_novel_read_chapter', 'openstory_novel_list_chapters',
    'openstory_script_to_fact', 'openstory_script_from_fact', 'openstory_session_get', 'openstory_sessions',
    'openstory_assets', 'openstory_asset_read', 'openstory_exchange_export', 'openstory_plugins'
  ].includes(item.tool))
  if (writes.length === 0) throw new Error('审计里没有写调用')
  for (const item of writes) {
    if (!item.params.confirm) throw new Error(`写调用缺 confirm：${item.tool}`)
  }
  const auditText = JSON.stringify(result.audit)
  if (auditText.includes('openstory_') && auditText.includes('洪太尉不听真人劝阻，强开上清宫后殿')) {
    throw new Error('审计泄漏了正文全文（只能记 hash/长度）')
  }
  if (result.stats.fakeUpstream !== true || result.stats.semanticModelVerified !== false) {
    throw new Error('假上游语义边界标注丢失')
  }

  // 缺任一必需工具，构建必须红。这里用建库工具做最小决定性反例；全套移除矩阵由单测覆盖。
  const negative = await buildShuihuWithMcp({
    baseDir: await mkdtemp(join(tmpdir(), 'os217-negative-')),
    root: join(base, 'negative'),
    omittedTools: ['openstory_library_create'],
    keep: false,
    cleanup: true
  })
  if (negative.ok || negative.error.code !== 'BUILD_FAILED' || !negative.error.message.includes('MCP_TOOL_UNAVAILABLE')) {
    throw new Error('缺建库工具没有让构建变红')
  }

  console.log(JSON.stringify({
    ok: true,
    root: result.root,
    digest: result.digest,
    calls: result.stats.calls,
    tools: result.stats.tools,
    factWikiRevision: result.snapshot.factWikiRevision,
    report: reportPath,
    audit: auditPath,
    fakeUpstream: true,
    semanticModelVerified: false,
    negativeMissingTool: 'PASS'
  }, null, 2))
} finally {
  if (!options.out) await rm(base, { recursive: true, force: true })
}
