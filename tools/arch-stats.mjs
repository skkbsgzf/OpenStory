#!/usr/bin/env node
/**
 * C6 架构规模生成器：ARCHITECTURE.md 的数字只从源码与 manifest 实测生成。
 *
 * 分工（不再沿用已退役的 L2 旧层）：
 *   底座＝src/host + src/kernel；契约＝src/api；协议＝src/protocol；
 *   src/modules 按 module.manifest.json 的 class 分为 kernel/workbench/suite，
 *   agentbar/library 两个无 class 的恒启宿主组合面单列；服务与套件资源分别计数；
 *   前端递归计 public/ 的 mjs/js/html/css（vendor 运行时不入源码规模）。
 *   源文件计 .mjs/.js；套件资源计 json/md/css/mjs/js/html；物理行归一 CRLF/LF/CR。
 *
 * 生成段还包含 manifest 清单、端点数与 app.js 上限，避免叙述再手抄当前数字。
 * 用法：node tools/arch-stats.mjs [--check]；退出码 0 一致/已回写，1 不一致，2 用法/标记错误。
 */
import { readFileSync, readdirSync, statSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { hostOwnedEndpointIds } from './acceptance/moduleCoverage.mjs'
import { APP_JS_MAX_LINES } from './number-anchors.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DOC_REL = 'ARCHITECTURE.md'
const START = '<!-- arch-stats:start -->'
const END = '<!-- arch-stats:end -->'
const SOURCE_EXT = /\.(?:mjs|js)$/u
const FRONTEND_EXT = /\.(?:mjs|js|html|css)$/u
const RESOURCE_EXT = /\.(?:mjs|js|json|md|css|html)$/u

function walk(rootRel, out = []) {
  const abs = join(REPO, rootRel)
  if (!existsSync(abs)) return out
  const stat = statSync(abs)
  if (!stat.isDirectory()) { out.push(rootRel); return out }
  for (const name of readdirSync(abs).sort()) out.push(...walk(`${rootRel}/${name}`, []))
  return out
}

export function countPhysicalLines(text) {
  const normalized = String(text).replace(/\r\n?/gu, '\n')
  if (normalized === '') return 0
  return normalized.split('\n').length - (normalized.endsWith('\n') ? 1 : 0)
}

function countLines(rel) {
  return countPhysicalLines(readFileSync(join(REPO, rel), 'utf-8'))
}

function collectFiles(roots, match) {
  const seen = new Set()
  for (const root of roots) {
    for (const rel of walk(root)) if (match(rel)) seen.add(rel)
  }
  return [...seen].sort()
}

function stats(roots, match) {
  const files = collectFiles(roots, match)
  return { files, lines: files.reduce((sum, rel) => sum + countLines(rel), 0) }
}

function fmt(n) {
  return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** 直接读磁盘 manifest；统计工具不装载模块，不执行 activate，也不受运行时导入环影响。 */
export function readManifestInventory(repo = REPO) {
  const modulesDir = join(repo, 'src', 'modules')
  if (!existsSync(modulesDir)) return []
  return readdirSync(modulesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => {
      const file = join(modulesDir, entry.name, 'module.manifest.json')
      if (!existsSync(file)) return null
      try { return JSON.parse(readFileSync(file, 'utf-8')) } catch { return null }
    })
    .filter(Boolean)
    .sort((left, right) => String(left.id).localeCompare(String(right.id), 'en'))
}

function roleOf(manifest) {
  if (manifest.class) return manifest.class
  return ['agentbar', 'library'].includes(manifest.id) ? 'host-composition' : 'unclassified'
}

function moduleRoots(manifests, role) {
  return manifests.filter((manifest) => roleOf(manifest) === role).map((manifest) => `src/modules/${manifest.id}`)
}

function dirsLabel(roots, fallback = '—') {
  return roots.length ? roots.map((root) => `\`${root}/\``).join('＋') : `\`${fallback}\``
}

export function architectureStats(repo = REPO) {
  const manifests = readManifestInventory(repo)
  const groups = Object.fromEntries(['kernel', 'workbench', 'suite', 'host-composition', 'unclassified']
    .map((role) => [role, manifests.filter((manifest) => roleOf(manifest) === role)]))
  const kernelRoots = moduleRoots(manifests, 'kernel')
  const workbenchRoots = moduleRoots(manifests, 'workbench')
  const suiteModuleRoots = moduleRoots(manifests, 'suite')
  const hostRoots = moduleRoots(manifests, 'host-composition')
  const resourceRoots = ['suites', 'styles', 'runtimes', 'genres', 'skills']
  const rows = [
    { name: '底座', roots: ['src/host', 'src/kernel'], match: (rel) => SOURCE_EXT.test(rel) },
    { name: '契约', roots: ['src/api'], match: (rel) => SOURCE_EXT.test(rel) },
    { name: '协议', roots: ['src/protocol'], match: (rel) => SOURCE_EXT.test(rel) },
    { name: `内核件（class: kernel，${groups.kernel.length}）`, roots: kernelRoots, match: (rel) => SOURCE_EXT.test(rel), fallback: 'src/modules/' },
    { name: `工作台（class: workbench，${groups.workbench.length}）`, roots: workbenchRoots, match: (rel) => SOURCE_EXT.test(rel), fallback: 'src/modules/' },
    { name: '宿主组合面（恒启）', roots: hostRoots, match: (rel) => SOURCE_EXT.test(rel), fallback: 'src/modules/' },
    { name: '套件模块（class: suite）', roots: suiteModuleRoots, match: (rel) => SOURCE_EXT.test(rel), fallback: 'src/modules/' },
    { name: '服务', roots: ['src/services'], match: (rel) => SOURCE_EXT.test(rel) },
    { name: '套件资源', roots: resourceRoots, match: (rel) => RESOURCE_EXT.test(rel) },
    { name: '设计令牌', roots: ['design-system'], match: (rel) => RESOURCE_EXT.test(rel) },
    { name: '前端', roots: ['public'], match: (rel) => FRONTEND_EXT.test(rel) && !rel.startsWith('public/vendor/') }
  ].map((row) => ({ ...row, ...stats(row.roots, row.match) }))
  return {
    manifests,
    groups,
    rows,
    viewsFiles: collectFiles(['public/views'], (rel) => rel.endsWith('.mjs')),
    appLines: existsSync(join(repo, 'public/app.js')) ? countPhysicalLines(readFileSync(join(repo, 'public/app.js'), 'utf-8')) : 0,
    endpoints: Object.keys(ENDPOINTS).length,
    testFiles: existsSync(join(repo, 'test')) ? readdirSync(join(repo, 'test')).filter((name) => name.endsWith('.test.mjs')).length : 0
  }
}

export function buildArchitectureBlock() {
  const data = architectureStats()
  const moduleEndpointIds = new Set(data.manifests.flatMap((manifest) => manifest.endpoints ?? []))
  const hostEndpointIds = hostOwnedEndpointIds()
  const moduleOwned = [...moduleEndpointIds].filter((id) => !hostEndpointIds.has(id)).length
  const hostOwned = data.endpoints - moduleOwned
  const kernelCapabilities = data.groups.kernel.flatMap((manifest) => (manifest.capabilities ?? []).map((item) => `${item.id}@${item.version}`))
  const lines = [
    START,
    '| 分工 | 范围 | 文件数 | 行数 |',
    '|---|---|---:|---:|'
  ]
  for (const row of data.rows) {
    lines.push(`| ${row.name} | ${dirsLabel(row.roots, row.fallback)} | ${fmt(row.files.length)} | ${fmt(row.lines)} |`)
  }
  lines.push('| 磁盘库 | 库＝文件夹（无代码） | — | — |', '')
  lines.push('| 附加指标 | 实测 |', '|---|---:|')
  lines.push(`| \`public/app.js\` 行数 | ${fmt(data.appLines)} |`)
  lines.push(`| \`public/views/*.mjs\` 文件数 | ${fmt(data.viewsFiles.length)} |`)
  lines.push(`| 契约端点数（\`ENDPOINTS\` 键数） | ${fmt(data.endpoints)} |`)
  lines.push(`| 测试文件数（\`test/*.test.mjs\`） | ${fmt(data.testFiles)} |`, '')
  lines.push('**模块清单（由 `src/modules/*/module.manifest.json` 自动生成）**', '')
  lines.push('| id | 角色 | 独占端点数 | 页签/入口 | manifest `settings` 项数 |', '|---|---|---:|---|---:|')
  for (const manifest of data.manifests) {
    const endpoints = (manifest.endpoints ?? []).filter((id) => !hostEndpointIds.has(id)).length
    const pages = (manifest.pages ?? []).map((page) => page.id).join(' / ') || '—'
    lines.push(`| ${manifest.id} | ${roleOf(manifest)} | ${endpoints} | ${pages} | ${(manifest.settings ?? []).length} |`)
  }
  const counts = ['kernel', 'workbench', 'suite', 'host-composition', 'unclassified']
    .filter((role) => data.groups[role].length > 0)
    .map((role) => `${data.groups[role].length} ${role}`).join(' + ')
  lines.push('')
  lines.push(`合计 ${data.manifests.length} 份 manifest（${counts}）；${moduleOwned} 个模块独占端点，${hostOwned} 个宿主自有端点，端点覆盖 ${moduleOwned + hostOwned}/${data.endpoints}。`)
  lines.push(`kernel 能力声明：${kernelCapabilities.length ? kernelCapabilities.join(' / ') : '无'}。`)
  lines.push(`\`app.js\` 当前上限 ${fmt(APP_JS_MAX_LINES)} 行（只降不升），当前实测 ${fmt(data.appLines)} 行。`)
  lines.push(END)
  return `${lines.join('\n')}\n`
}

function normalize(text) {
  return text.replace(/\r\n?/gu, '\n')
}

const START_RE = /^<!-- arch-stats:start -->[ \t]*$/gm
const END_RE = /^<!-- arch-stats:end -->[ \t]*$/gm

function markerRange(doc) {
  const starts = [...doc.matchAll(START_RE)]
  const ends = [...doc.matchAll(END_RE)]
  if (starts.length !== 1 || ends.length !== 1 || ends[0].index < starts[0].index) return null
  return { start: starts[0].index, end: ends[0].index + ends[0][0].length }
}

function extractBlock(doc) {
  const range = markerRange(doc)
  return range ? doc.slice(range.start, range.end) : null
}

function printDiff(expected, actual) {
  const want = expected.trimEnd().split('\n')
  const got = actual.trimEnd().split('\n')
  console.log('✗ 架构文档数字与实测不一致（tools/arch-stats.mjs --check）')
  let shown = 0
  for (let i = 0; i < Math.max(want.length, got.length) && shown < 12; i++) {
    if (want[i] === got[i]) continue
    shown++
    console.log(`  行 ${i + 1}:\n    - 文档: ${got[i] ?? '（缺行）'}\n    + 实测: ${want[i] ?? '（多出此行）'}`)
  }
  console.log('  修复：npm run arch:stats')
}

function main(argv) {
  const checkOnly = argv.includes('--check')
  const block = buildArchitectureBlock()
  const doc = normalize(readFileSync(join(REPO, DOC_REL), 'utf-8'))
  const current = extractBlock(doc)
  if (current === null) {
    console.log(`✗ ${DOC_REL} 缺少唯一标记 ${START} … ${END}`)
    return 2
  }
  if (checkOnly) {
    if (current.trimEnd() !== block.trimEnd()) { printDiff(block, current); return 1 }
    console.log(`✓ ${DOC_REL} 生成段与实测一致（${block.trimEnd().split('\n').length - 2} 行数据）`)
    return 0
  }
  process.stdout.write(block)
  if (current.trimEnd() === block.trimEnd()) {
    process.stderr.write(`· ${DOC_REL} 生成段已是最新\n`)
    return 0
  }
  const range = markerRange(doc)
  const next = `${doc.slice(0, range.start)}${block}${doc.slice(range.end).replace(/^\n/, '')}`
  writeFileSync(join(REPO, DOC_REL), next)
  process.stderr.write(`· ${DOC_REL} 生成段已回写\n`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
