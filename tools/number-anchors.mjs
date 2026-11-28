import { execFileSync } from 'node:child_process'
import { readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { MODULE_MANIFESTS } from '../src/protocol/modules.mjs'
import { countPhysicalLines } from './arch-stats.mjs'
import { coverageReport } from './acceptance/moduleCoverage.mjs'
import { CLEAN_RULES } from './acceptance/cleanGates.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const ANCHORS_FILE = 'docs/number-anchors.json'
export const NUMBER_ANCHORS_SCHEMA = 'openstory.number-anchors/v1'
export const HOST_DOMAIN_MODULE_IDS = Object.freeze(['agentbar', 'deduce', 'library'])
// 历史初始锚保留，后续只许追加更低上限；当前 C6 目标为 10,500 行。
export const APP_JS_LINE_CEILINGS = Object.freeze([11886, 10500])
export const APP_JS_MAX_LINES = APP_JS_LINE_CEILINGS.at(-1)

/**
 * OS-192：这些文档不在本单允许改动范围内（收口归 OS-199），是 C6/D 批的历史快照。
 * 钉在 OS-192 开工时的数值上：断言仍在（不许静默漂移），但不拿新实测要求范围外文件。
 * 范围内文档（ARCHITECTURE/README/AGENTS）继续逐字对当前实测。
 */
export const FROZEN_DOC_ANCHORS = Object.freeze({
  tests: Object.freeze({ total: 836, pass: 834, fail: 0, skipped: 2, ok: true }),
  modules: Object.freeze({ total: 21, workbench: 12, kernel: 7, hostComposition: 2 }),
  endpoints: Object.freeze({ total: 108, moduleOwned: 41, hostOwned: 67, hostDomain: 0 }),
  appJs: Object.freeze({ lines: 10110 }),
  testFiles: 109,
  gateCount: 29
})

const FROZEN_DOCS = new Set([
  'docs/plan/final-audit.md', 'docs/plan/workorder-system-20261124.md',
  'docs/workorders/HANDOFF.md'
])

function fmt(value) {
  return String(value).replace(/\B(?=(\d{3})+(?!\d))/gu, ',')
}

export function collectStaticAnchors(repo = REPO) {
  const coverage = coverageReport()
  const hostDomainManifests = MODULE_MANIFESTS.filter((manifest) => HOST_DOMAIN_MODULE_IDS.includes(manifest.id))
  const hostDomainEndpointIds = [...new Set(hostDomainManifests.flatMap((manifest) => manifest.endpoints))].sort()
  const appJsLines = countPhysicalLines(readFileSync(join(repo, 'public/app.js'), 'utf-8'))
  const testFiles = readdirSync(join(repo, 'test')).filter((name) => name.endsWith('.test.mjs')).length
  const modules = {
    total: MODULE_MANIFESTS.length,
    workbench: MODULE_MANIFESTS.filter((manifest) => manifest.class === 'workbench').length,
    kernel: MODULE_MANIFESTS.filter((manifest) => manifest.class === 'kernel').length,
    hostComposition: MODULE_MANIFESTS.filter((manifest) => !manifest.class).length
  }
  return {
    schema: NUMBER_ANCHORS_SCHEMA,
    appJs: {
      lines: appJsLines,
      maxLines: APP_JS_MAX_LINES,
      convention: 'physical-lines; CRLF/LF normalized; blank and comment lines included; trailing newline not counted'
    },
    modules,
    endpoints: {
      total: Object.keys(ENDPOINTS).length,
      moduleOwned: coverage.claimedEndpointCount,
      hostOwned: coverage.hostEndpointCount,
      hostDomain: hostDomainEndpointIds.length,
      hostDomainIds: hostDomainEndpointIds
    },
    testFiles
  }
}

export function runTestSummary(repo = REPO) {
  const files = readdirSync(join(repo, 'test'))
    .filter((name) => name.endsWith('.test.mjs'))
    .sort()
    .map((name) => `test/${name}`)
  let stdout = ''
  let stderr = ''
  let status = 0
  try {
    stdout = execFileSync(process.execPath, ['--test', ...files], {
      cwd: repo,
      encoding: 'utf-8',
      timeout: 280_000,
      maxBuffer: 32 * 1024 * 1024
    })
  } catch (error) {
    status = error.status ?? 1
    stdout = String(error.stdout || '')
    stderr = String(error.stderr || '')
  }
  const counts = {}
  for (const match of stdout.matchAll(/^(?:#|ℹ)\s+(tests|pass|fail|skipped)\s+(\d+)\s*$/gmu)) {
    counts[match[1]] = Number(match[2])
  }
  const summary = {
    total: counts.tests ?? 0,
    pass: counts.pass ?? 0,
    fail: counts.fail ?? 0,
    skipped: counts.skipped ?? 0
  }
  return {
    ...summary,
    ok: status === 0 && summary.total > 0 && summary.fail === 0,
    command: 'node --test test/*.test.mjs',
    ...(status === 0 ? {} : { exitCode: status, stderr: stderr.slice(0, 2000) })
  }
}

function countGateChecks(repo = REPO) {
  const source = readFileSync(join(repo, 'tools/acceptance/acceptance.mjs'), 'utf-8')
  const ids = new Set([...source.matchAll(/check\('(S\d+\.\d+)'/gu)].map((match) => match[1]))
  for (const rule of CLEAN_RULES) ids.add(rule.id)
  return ids.size
}

export function collectAnchors({ repo = REPO, runTests = true } = {}) {
  return {
    ...collectStaticAnchors(repo),
    gateCount: countGateChecks(repo),
    tests: runTests ? runTestSummary(repo) : null
  }
}

function buildDocChecks(a) {
  const tests = a.tests
  const testSummary = `${tests.total} tests / ${tests.pass} pass / ${tests.skipped} skip / ${tests.fail} fail`
  const endpointTotal = a.endpoints.total
  return [
    { file: 'docs/ACCEPTANCE.md', label: '测试数', expected: `单测门禁（${tests.total} 例` },
    { file: 'docs/ACCEPTANCE.md', label: '门禁数', expected: `（${a.gateCount} 检查` },
    { file: 'docs/PUBLISHING.md', label: '测试汇总', expected: testSummary },
    { file: 'docs/PUBLISHING.md', label: '门禁结果', expected: `${a.gateCount} 过 / 0 挂 / 0 警` },
    { file: 'docs/PUBLISHING.md', label: 'app.js 行数', expected: `\`app.js\` ${fmt(a.appJs.lines)} 行` },
    { file: 'docs/PUBLISHING.md', label: '端点数', expected: `端点 ${endpointTotal}` },
    { file: 'docs/PUBLISHING.md', label: '测试文件数', expected: `测试 ${a.testFiles} 文件` },
    { file: 'docs/plan/final-audit.md', label: '测试汇总', expected: testSummary },
    { file: 'docs/plan/final-audit.md', label: '门禁清单', expected: `## 二、${a.gateCount} 项门禁清单` },
    { file: 'docs/plan/final-audit.md', label: '门禁结果', expected: `${a.gateCount} 过 / 0 挂 / 0 警` },
    { file: 'docs/plan/workorder-system-20261124.md', label: '测试数', expected: `测试 **${tests.total} 例**` },
    { file: 'docs/plan/workorder-system-20261124.md', label: '门禁数', expected: `验收门禁 **${a.gateCount} 项**` },
    { file: 'docs/plan/workorder-system-20261124.md', label: '端点数', expected: `契约端点 **${endpointTotal}**` },
    { file: 'docs/plan/workorder-system-20261124.md', label: 'app.js 行数', expected: `\`app.js\` **${fmt(a.appJs.lines)} 行**` },
    { file: 'docs/plan/workorder-system-20261124.md', label: '测试文件数', expected: `测试文件 **${a.testFiles}**` },
    { file: 'ARCHITECTURE.md', label: '模块端点摘要', expected: `${a.endpoints.moduleOwned} 个模块独占端点，${a.endpoints.hostOwned} 个宿主自有端点，端点覆盖 ${endpointTotal}/${endpointTotal}` },
    { file: 'ARCHITECTURE.md', label: 'library 端点', expected: `| library | host-composition | ${a.endpoints.hostDomain} | — | 0 |` },
    { file: 'ARCHITECTURE.md', label: 'app.js 上限', expected: `\`app.js\` 当前上限 ${fmt(APP_JS_MAX_LINES)} 行（只降不升）` },
    { file: 'README.md', label: '端点覆盖', expected: `端点归属 ${endpointTotal}/${endpointTotal} 有主` },
    { file: 'README.md', label: '宿主域端点', expected: `library 声明 ${a.endpoints.hostDomain} 个宿主域端点` },
    { file: 'README.md', label: 'manifest 数', expected: `${a.modules.total} 份内置 manifest（${a.modules.workbench} workbench＋${a.modules.kernel} kernel＋${a.modules.hostComposition} 宿主组合面）` },
    { file: 'README.md', label: '端点数', expected: `${endpointTotal} 个契约端点` },
    { file: 'README.md', label: '测试数', expected: `${tests.total} 例单测（${tests.pass} 过／${tests.skipped} 跳过）` },
    { file: 'README.md', label: '门禁数', expected: `${a.gateCount} 项验收检查` },
    { file: 'README.md', label: 'app.js 行数', expected: `\`app.js\` ${fmt(a.appJs.lines)} 行` },
    { file: 'docs/LEGACY-ITEMS.md', label: '模块端点数', expected: `${a.endpoints.moduleOwned} 个模块独占端点` },
    { file: 'docs/workorders/COMMON-RULES.md', label: '门禁数', expected: `现有 ${a.gateCount} 项` },
    { file: 'docs/workorders/HANDOFF.md', label: '当前门禁结果', expected: `门禁 ${a.gateCount} 过 / 0 挂 / 0 警` },
    { file: 'docs/workorders/HANDOFF.md', label: '模块端点数', expected: `${a.endpoints.moduleOwned} 个独占端点` },
    { file: 'AGENTS.md', label: '测试数', expected: `全量单测（${tests.total} 例）` },
    { file: 'AGENTS.md', label: '门禁数', expected: `交付标准 S0–S5 门禁（${a.gateCount} 检查` }
  ]
}

export function documentAnchorChecks(anchors, repo = REPO) {
  const frozen = FROZEN_DOC_ANCHORS
  const frozenAnchors = {
    tests: frozen.tests,
    modules: frozen.modules,
    endpoints: frozen.endpoints,
    appJs: frozen.appJs,
    testFiles: frozen.testFiles,
    gateCount: frozen.gateCount
  }
  // 范围外文档用冻结快照，范围内文档用当前实测；同名同 label 只保留一份。
  const live = buildDocChecks(anchors)
  const snapshot = buildDocChecks(frozenAnchors)
  const chosen = [
    ...live.filter((item) => !FROZEN_DOCS.has(item.file)),
    ...snapshot.filter((item) => FROZEN_DOCS.has(item.file))
  ]
  return chosen.map((item) => {
    const source = readFileSync(join(repo, item.file), 'utf-8')
    return { file: item.file, label: item.label, expected: item.expected, found: source.includes(item.expected) }
  })
}

export function auditAnchors(anchors, repo = REPO) {
  const issues = []
  let persisted = null
  try {
    persisted = JSON.parse(readFileSync(join(repo, ANCHORS_FILE), 'utf-8'))
  } catch (error) {
    issues.push(`${ANCHORS_FILE} 读不到或不是合法 JSON：${error.message}`)
  }
  if (persisted && JSON.stringify(persisted) !== JSON.stringify(anchors)) {
    issues.push(`${ANCHORS_FILE} 与实测不符——跑 node tools/number-anchors.mjs 回写`)
  }
  for (const item of documentAnchorChecks(anchors, repo)) {
    if (!item.found) issues.push(`${item.file} 缺当前${item.label}：${item.expected}`)
  }
  if (!anchors.tests.ok) issues.push(`全量测试未全绿：${anchors.tests.total} 例 / ${anchors.tests.fail} 挂`)
  if (anchors.appJs.lines > APP_JS_MAX_LINES) {
    issues.push(`app.js ${anchors.appJs.lines} 行超过上限 ${APP_JS_MAX_LINES} 行`)
  }
  if (APP_JS_LINE_CEILINGS[0] !== 11886) issues.push('app.js 初始上限 11,886 行被篡改')
  for (let index = 1; index < APP_JS_LINE_CEILINGS.length; index++) {
    if (APP_JS_LINE_CEILINGS[index] > APP_JS_LINE_CEILINGS[index - 1]) {
      issues.push('app.js 行数上限只许下调，不许上调')
    }
  }
  return { ok: issues.length === 0, issues }
}

function main(argv) {
  const anchors = collectAnchors()
  if (!argv.includes('--check')) {
    writeFileSync(join(REPO, ANCHORS_FILE), `${JSON.stringify(anchors, null, 2)}\n`)
    console.log(`✓ 已回写 ${ANCHORS_FILE}：${anchors.tests.total} 例／端点 ${anchors.endpoints.total}／app.js ${anchors.appJs.lines} 行`)
    return anchors.tests.ok ? 0 : 1
  }
  const audit = auditAnchors(anchors)
  if (!audit.ok) {
    console.log('✗ 数字锚与文档/实测不一致')
    for (const issue of audit.issues) console.log(`  · ${issue}`)
    return 1
  }
  console.log(`✓ 数字锚一致：${anchors.tests.total} 例／门禁 ${anchors.gateCount}／端点 ${anchors.endpoints.total}／宿主域 ${anchors.endpoints.hostDomain}／app.js ${anchors.appJs.lines}≤${APP_JS_MAX_LINES} 行`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2))
}
