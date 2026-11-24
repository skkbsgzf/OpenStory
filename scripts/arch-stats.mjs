#!/usr/bin/env node
/**
 * OS-150 架构文档数字生成器 —— ARCHITECTURE.md 的「N 文件 / N 行」不再手填
 *
 * 背景：七层分层表的文件数/行数每批新增文件都会漂，两天漂三次且靠人手回填。
 * 本脚本按约定目录扫描，输出一段确定性的 markdown 表；ARCHITECTURE.md 用标记
 * <!-- arch-stats:start --> … <!-- arch-stats:end --> 圈住生成段，验收门禁 S0.2
 * 调 `--check` 逐字比对——手改一个数字就红。
 *
 * 口径（与验收门禁一致，改这里必须同步 tools/acceptance/acceptance.mjs）：
 *   L7  public/ 顶层 *.mjs|*.js|*.html ＋ public/views/*.mjs（不含 public/vendor/）
 *   L6  src/api/contracts.mjs ＋ src/api/contracts/*.mjs
 *   L5  src/host/ 全部 *.mjs
 *   L4  src/modules/ ＋ src/services/ ＋ src/protocol/ 全部 *.mjs
 *   L2  src/kernel/ 全部 *.mjs（OS-157 起 L2/L3 合并为「自有内核」一层，core/ 已退役）
 *   行数＝文件实际行数（末尾换行不计一行）；端点＝契约文件里 /method:/ 出现次数；
 *   测试文件＝test/*.test.mjs 个数。
 *
 * 用法：
 *   node scripts/arch-stats.mjs            打印生成段并回写 ARCHITECTURE.md 标记段（stdout 只有表）
 *   npm run arch:stats                     同上
 *   node scripts/arch-stats.mjs --check    只比对：生成段 ≠ 实测 → 打印差异并 exit 1
 *
 * 退出码：0＝一致/已回写；1＝--check 发现不一致；2＝用法错误或文档缺标记。
 * 零依赖：node:fs / node:path / node:url。输出不含时间戳，同仓同状态两次运行逐字相同。
 */
import { readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOC_REL = 'ARCHITECTURE.md'
const START = '<!-- arch-stats:start -->'
const END = '<!-- arch-stats:end -->'

/* ---------- 分层定义（目录 ＋ 归属判定；顺序即表格顺序） ---------- */
const LAYERS = [
  {
    id: 'L7',
    name: '前端',
    dirs: '`public/`（含 `views/`）',
    roots: ['public'],
    match: (rel) => /^public\/[^/]+\.(?:mjs|js|html)$/.test(rel) || /^public\/views\/[^/]+\.mjs$/.test(rel)
  },
  {
    id: 'L6',
    name: '契约层',
    dirs: '`src/api/contracts/`',
    roots: ['src/api'],
    match: (rel) => rel === 'src/api/contracts.mjs' || /^src\/api\/contracts\/[^/]+\.mjs$/.test(rel)
  },
  {
    id: 'L5',
    name: '宿主层',
    dirs: '`src/host/`',
    roots: ['src/host'],
    match: (rel) => rel.endsWith('.mjs')
  },
  {
    id: 'L4',
    name: '自持层',
    dirs: '`src/{modules,services,protocol}/`',
    roots: ['src/modules', 'src/services', 'src/protocol'],
    match: (rel) => rel.endsWith('.mjs')
  },
  {
    id: 'L2',
    name: '自有内核',
    dirs: '`src/kernel/`',
    roots: ['src/kernel'],
    match: (rel) => rel.endsWith('.mjs')
  }
]

/* ---------- 扫描与计数（排序后再读，保证输出确定） ---------- */
function walk(rootRel, out = []) {
  const abs = join(REPO, rootRel)
  let stat
  try { stat = statSync(abs) } catch { return out }
  if (!stat.isDirectory()) { out.push(rootRel); return out }
  for (const name of readdirSync(abs).sort()) out.push(...walk(`${rootRel}/${name}`, []))
  return out
}

function countLines(rel) {
  const text = readFileSync(join(REPO, rel), 'utf-8')
  if (text === '') return 0
  return text.split('\n').length - (text.endsWith('\n') ? 1 : 0)
}

function collectFiles(roots, match) {
  const seen = new Set()
  for (const root of roots) {
    for (const rel of walk(root)) if (match(rel)) seen.add(rel)
  }
  return [...seen].sort()
}

function layerStats(layer) {
  const files = collectFiles(layer.roots, layer.match)
  return { files, lines: files.reduce((sum, rel) => sum + countLines(rel), 0) }
}

// 千分位（手写，避免 toLocaleString 受运行环境 locale 影响）
function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/* ---------- 生成段落 ---------- */
function buildBlock() {
  const stats = LAYERS.map((layer) => ({ layer, ...layerStats(layer) }))
  const contractFiles = collectFiles(['src/api'], (rel) => rel === 'src/api/contracts.mjs' || /^src\/api\/contracts\/[^/]+\.mjs$/.test(rel))
  const endpoints = contractFiles.reduce((sum, rel) => sum + (readFileSync(join(REPO, rel), 'utf-8').match(/method:/g) || []).length, 0)
  const testFiles = readdirSync(join(REPO, 'test')).filter((name) => name.endsWith('.test.mjs')).length
  const appLines = countLines('public/app.js')

  const lines = [
    START,
    '| 层 | 目录 | 文件数 | 行数 |',
    '|---|---|---:|---:|'
  ]
  for (const { layer, files, lines: lineCount } of stats) {
    lines.push(`| ${layer.id} ${layer.name} | ${layer.dirs} | ${fmt(files.length)} | ${fmt(lineCount)} |`)
  }
  lines.push('| L1 磁盘库 | 库＝文件夹（无代码） | — | — |')
  lines.push('')
  lines.push('| 附加指标 | 实测 |')
  lines.push('|---|---:|')
  lines.push(`| \`public/app.js\` 行数 | ${fmt(appLines)} |`)
  lines.push(`| 契约端点数（\`method:\` 计数） | ${fmt(endpoints)} |`)
  lines.push(`| 测试文件数（\`test/*.test.mjs\`） | ${fmt(testFiles)} |`)
  lines.push(END)
  return `${lines.join('\n')}\n`
}

/* ---------- 文档标记段读写 ---------- */
function normalize(text) {
  return text.replace(/\r\n/g, '\n')
}

// 标记必须独占一行——正文里提到标记名（行内、代码块内）不算生成段，避免被误抓。
const START_RE = /^<!-- arch-stats:start -->[ \t]*$/gm
const END_RE = /^<!-- arch-stats:end -->[ \t]*$/gm

function markerRange(doc) {
  const starts = [...doc.matchAll(START_RE)]
  const ends = [...doc.matchAll(END_RE)]
  if (starts.length !== 1 || ends.length !== 1) return null
  if (ends[0].index < starts[0].index) return null
  return { start: starts[0].index, end: ends[0].index + ends[0][0].length }
}

function extractBlock(doc) {
  const range = markerRange(doc)
  if (!range) return null
  return doc.slice(range.start, range.end)
}

function printDiff(expected, actual) {
  const want = expected.trimEnd().split('\n')
  const got = actual.trimEnd().split('\n')
  console.log('✗ 架构文档数字与实测不一致（scripts/arch-stats.mjs --check）')
  console.log(`  ARCHITECTURE.md 生成段 ${got.length} 行 / 实测 ${want.length} 行，逐字比对不通过`)
  let shown = 0
  const max = Math.max(want.length, got.length)
  for (let i = 0; i < max && shown < 12; i++) {
    if (want[i] === got[i]) continue
    shown++
    console.log(`  行 ${i + 1}:`)
    console.log(`    - 文档: ${got[i] === undefined ? '（缺行）' : got[i]}`)
    console.log(`    + 实测: ${want[i] === undefined ? '（多出此行）' : want[i]}`)
  }
  console.log('  修复：npm run arch:stats')
}

/* ---------- 主流程 ---------- */
function main(argv) {
  const checkOnly = argv.includes('--check')
  const block = buildBlock()
  const docPath = join(REPO, DOC_REL)
  const doc = normalize(readFileSync(docPath, 'utf-8'))
  const current = extractBlock(doc)

  if (checkOnly) {
    if (current === null) {
      console.log(`✗ ${DOC_REL} 缺少唯一的标记行 ${START} … ${END}（各须独占一行且只出现一次）`)
      return 2
    }
    if (current.trimEnd() !== block.trimEnd()) {
      printDiff(block, current)
      return 1
    }
    console.log(`✓ ${DOC_REL} 生成段与实测一致（${block.trimEnd().split('\n').length - 2} 行数据）`)
    return 0
  }

  process.stdout.write(block)
  if (current === null) {
    process.stderr.write(`! ${DOC_REL} 未找到标记 ${START} … ${END}，只打印未回写\n`)
    return 2
  }
  if (current.trimEnd() === block.trimEnd()) {
    process.stderr.write(`· ${DOC_REL} 生成段已是最新\n`)
    return 0
  }
  const range = markerRange(doc)
  const next = normalize(`${doc.slice(0, range.start)}${block}${doc.slice(range.end).replace(/^\n/, '')}`)
  writeFileSync(docPath, next)
  process.stderr.write(`· ${DOC_REL} 生成段已回写\n`)
  return 0
}

process.exitCode = main(process.argv.slice(2))
