/* OpenStory 交付标准验收门禁（OS-67）
 *
 * 对标三方工具链：
 *   · Understand-Anything（.ua 知识图谱）——结构性证据（大修改落地前跑 /understand 增量）
 *   · Rea 证据式分析（D:/refs/rea-out 的 records/evidence 口径）——每条检查带 file:line 证据
 *   · OpenDesign 设计系统契约（design-systems/<slug>/ = manifest.json + DESIGN.md + tokens.css）
 *     ——S3 前端一致性按「语义令牌 + 约定类」口径检查
 *
 * 四条交付标准（作者 2026-11-18 申明）：
 *   S1 Agentic      —— 全功能 MCP/skill/知识库友好，dsh native runtime，多 CLI 支持
 *   S2 可插拔       —— 模块不耦合，只经底层接口协议调用
 *   S3 前端一致性   —— 卡片/页面/组件 CSS 有一致性，语义令牌可配置
 *   S4 UX 跳转层级  —— 插件页面结构遵循全局一致性规范（目前薄弱项，从严检查）
 *
 * 用法：node tools/acceptance/acceptance.mjs [--json <outPath>]
 * 退出码：0 = 全过；1 = 有 FAIL（新增检查项默认 WARN 不拦截，见 CHECKS 注释）
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname, relative, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = pathResolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const argv = process.argv.slice(2)
const jsonIdx = argv.indexOf('--json')
const jsonOut = jsonIdx >= 0 ? argv[jsonIdx + 1] : null

/* ---------- 证据助手（Rea 口径：每条结论带 file:line） ---------- */
const checks = []
function check(id, standard, name, ok, evidence, note) {
  checks.push({ id, standard, name, verdict: ok ? 'PASS' : 'FAIL', note: note || '', evidence: evidence || [] })
  const mark = ok ? '✓' : '✗'
  console.log(`${mark} [${id}] ${name}${note ? ` — ${note}` : ''}`)
  for (const ev of (evidence || []).slice(0, 6)) console.log(`    · ${ev}`)
}
function warn(id, standard, name, evidence, note) {
  checks.push({ id, standard, name, verdict: 'WARN', note: note || '', evidence: evidence || [] })
  console.log(`△ [${id}] ${name}${note ? ` — ${note}` : ''}`)
  for (const ev of (evidence || []).slice(0, 6)) console.log(`    · ${ev}`)
}
function readRepo(rel) { return readFileSync(join(REPO, rel), 'utf-8') }
function lineOf(rel, needle) {
  const lines = readRepo(rel).split('\n')
  const i = lines.findIndex((l) => l.includes(needle))
  return i >= 0 ? `${rel}:${i + 1}` : `${rel}:?`
}
function exists(rel) { try { statSync(join(REPO, rel)); return true } catch { return false } }
function grepLine(rel, re) {
  const lines = readRepo(rel).split('\n')
  for (let i = 0; i < lines.length; i++) if (re.test(lines[i])) return `${rel}:${i + 1}`
  return null
}

/* ================================================================
 * S1 Agentic —— MCP / skill / 知识库 / dsh runtime / 多 CLI
 * ================================================================ */
console.log('\n── S1 Agentic ──')

// S1.1 MCP 工具清单与模块覆盖（按前缀归类：每个模块 ≥2 个工具＝有读有写）
const mcpSrc = readRepo('mcp.mjs')
const toolNames = [...mcpSrc.matchAll(/name:\s*'([a-z_]+)'/g)].map((m) => m[1])
const MODULE_PREFIX = {
  novel: 'openstory_chapter',
  worldbook: 'openstory_ref',
  reference: 'openstory_reference',
  deduce: 'openstory_deduce',
  analysis: 'openstory_analyze',
  habits: 'openstory_habits',
  worldbookEntries: 'openstory_worldbook'
}
const modCoverage = Object.entries(MODULE_PREFIX)
  .map(([mod, prefix]) => [mod, toolNames.filter((t) => t.startsWith(prefix))])
  .filter(([, ts]) => ts.length > 0)
const thinModules = modCoverage.filter(([, ts]) => ts.length < 2).map(([m, ts]) => `${m}(${ts.length})`)
check('S1.1', 'S1', `MCP 工具覆盖模块面（共 ${toolNames.length} 个工具，${modCoverage.length} 模块组）`,
  toolNames.length >= 15 && modCoverage.length >= 4 && thinModules.length === 0,
  toolNames.slice(0, 4).map((t) => lineOf('mcp.mjs', `name: '${t}'`)).filter((s) => !s.endsWith(':?')),
  thinModules.length ? `工具不足 2 个的模块组：${thinModules.join(', ')}` : '各模块组均有读+写工具')

// S1.2 mcp/skills/*.md 对外文档与工具同步
const mcpSkillDir = join(REPO, 'mcp', 'skills')
let mcpDocs = []
try { mcpDocs = readdirSync(mcpSkillDir).filter((f) => f.endsWith('.md')) } catch { /* 目录不存在 */ }
const overview = mcpDocs.includes('OVERVIEW.md') ? readRepo('mcp/skills/OVERVIEW.md') : ''
const overviewNum = [...overview.matchAll(/(\d+)\s*个工具/g)].map((m) => Number(m[1]))
const docSync = overviewNum.length === 0 || overviewNum.some((n) => Math.abs(n - toolNames.length) <= 2)
check('S1.2', 'S1', `mcp/skills 对外文档同步（OVERVIEW 声称 ${overviewNum.join('/') || '—'}，实际 ${toolNames.length}）`,
  docSync && mcpDocs.length >= 5, mcpDocs.map((f) => `mcp/skills/${f}`),
  docSync ? '' : 'OVERVIEW 工具数与 mcp.mjs 不符——改 MCP 后必须同步对外文档')

// S1.3 skills/ 创作知识库包完整性
let skillPacks = 0, skillMissing = []
try {
  for (const d of readdirSync(join(REPO, 'skills'))) {
    if (!statSync(join(REPO, 'skills', d)).isDirectory()) continue
    skillPacks++
    if (!exists(`skills/${d}/SKILL.md`)) skillMissing.push(d)
  }
} catch { /* 无 skills 目录 */ }
check('S1.3', 'S1', `skills/ 知识库包完整（${skillPacks} 包）`,
  skillPacks >= 20 && skillMissing.length === 0, skillMissing.slice(0, 4).map((d) => `skills/${d}/ 缺 SKILL.md`),
  skillMissing.length ? `缺 SKILL.md：${skillMissing.join(', ')}` : '全部包有 SKILL.md')

// S1.4 dsh native runtime 适配（dsh-cli 一次一进程型 + runtimes 注册 dsh kind）
const dshPieces = ['dsh-cli.mjs', 'dsh-bridge.mjs', 'cli-bridge.mjs', 'runtimes.mjs']
const dshMissing = dshPieces.filter((f) => !exists(f))
const dshKindReg = grepLine('runtimes.mjs', /kind\s*===\s*'dsh'|'sidecar',\s*'endpoint',\s*'cli',\s*'dsh'/)
check('S1.4', 'S1', 'dsh native runtime 适配件齐全（dsh-cli 一次一进程型已注册）',
  dshMissing.length === 0 && !!dshKindReg,
  [...dshPieces.filter((f) => exists(f)).map((f) => lineOf(f, 'export')), dshKindReg].filter(Boolean),
  dshMissing.length ? `缺 ${dshMissing.join(', ')}` : 'dsh-cli 型（一次一进程）就位')

// S1.5 多 CLI 派发器（Qoder/Zcode 等）
const cliDispatch = ['.zcode/qoder-agent.mjs', '.zcode/run-gate.mjs']
const cliMissing = cliDispatch.filter((f) => !exists(f))
check('S1.5', 'S1', '外部 CLI 派发器就位（Qoder 子 agent 模式）',
  cliMissing.length === 0, cliDispatch.filter((f) => exists(f)).map((f) => lineOf(f, 'spawn')), cliMissing.length ? `缺 ${cliMissing.join(', ')}` : '')

/* ================================================================
 * S2 可插拔 —— 模块不耦合，只经底层接口协议
 * ================================================================ */
console.log('\n── S2 可插拔 ──')

// S2.1 扫根级模块 import 图
const rootMjs = readdirSync(REPO).filter((f) => f.endsWith('.mjs'))
const imports = {}
for (const f of rootMjs) {
  const src = readRepo(f)
  imports[f] = [...src.matchAll(/from\s+'(\.?\/?[\w./-]+\.mjs)'/g)].map((m) => m[1].replace(/^\.?\//, ''))
}
// 模块 = 可插拔功能件；它们之间不得互相 import。
// 白名单：① 协议层（contracts/changelog/versionGate/plugins/pinaxAdapter——OS-125 起 pinaxAdapter
//        是内核唯一进口＝能力协议面，core/** 只许它引，见 S2.4；vendor 内核 core/pinax/** 是 fact 链底座，见 VENDORED.md）
//        ② deduceSession→deduceEngine（会话容器引引擎＝内核依赖）
const KERNEL_ALLOW = new Set([
  'deduceSession.mjs -> deduceEngine.mjs',
  // OS-79：deduceNarrative 是推演引擎的内部子模块（只做叙事上下文拼装，纯函数），
  // 不是平等功能模块——引擎引它属于内部组合，不是跨模块耦合。
  'deduceEngine.mjs -> deduceNarrative.mjs'
])
const PROTOCOL = new Set(['contracts.mjs', 'chapters.mjs', 'changelog.mjs', 'versionGate.mjs', 'plugins.mjs', 'pinaxAdapter.mjs']) // 底层接口协议层（chapters=文件读写协议；changelog=变更日志协议，所有模块都要记 diff；versionGate=版本比对协议，三套插件规范共用；plugins=三套插件只读聚合层，daemon 与设置页共用同一份清单口径；pinaxAdapter=内核唯一进口，OS-125 解耦③的五组能力出口，见 S2.4）
const MODULES = rootMjs.filter((f) => [
  'deduceEngine.mjs', 'deduceSession.mjs', 'referenceStore.mjs', 'enrichEngine.mjs',
  'factGuard.mjs', 'kbRouter.mjs', 'kbAdapter.mjs', 'kbHealth.mjs', 'style-check.mjs', 'stylePacks.mjs', 'skills.mjs', 'genres.mjs'
].includes(f))
const crossEdges = []
for (const mod of MODULES) {
  for (const dep of imports[mod] || []) {
    if (dep === mod) continue
    if (PROTOCOL.has(dep)) continue
    if (dep.startsWith('core/')) continue // vendor 内核＝底层，不算模块耦合
    const tag = `${mod} -> ${dep}`
    if (!KERNEL_ALLOW.has(tag)) crossEdges.push(tag)
  }
}
check('S2.1', 'S2', '功能模块间零直接耦合（协议层/vendor 内核除外）',
  crossEdges.length === 0,
  crossEdges.slice(0, 6).map((e) => lineOf(e.split(' -> ')[0], e.split(' -> ')[1])),
  crossEdges.length ? `违规边：${crossEdges.join('; ')}` : '模块只引 contracts/chapters 协议层、vendor 内核与白名单')

// S2.2 前端模块隔离（public/*.mjs 只共享 md.mjs 渲染协议）
const publicMjs = ['analysis.mjs', 'charts.mjs', 'graph.mjs', 'reference.mjs', 'storyTree.mjs']
const SHARED_PROTOCOL = new Set(['md.mjs'])
const pubCross = []
for (const f of publicMjs) {
  if (!exists(`public/${f}`)) continue
  const src = readRepo(`public/${f}`)
  for (const m of src.matchAll(/from\s+'\.\/([\w-]+\.mjs)'/g)) {
    const dep = m[1]
    if (dep === f) continue
    if (SHARED_PROTOCOL.has(dep)) continue
    pubCross.push(`${f} -> ${dep}`)
  }
}
check('S2.2', 'S2', '前端分析/图谱/参考/树模块互不 import（md.mjs 渲染协议除外）',
  pubCross.length === 0, pubCross.map((e) => `public/${e}`),
  pubCross.length ? `违规：${pubCross.join('; ')}` : '')

// S2.3 契约驱动架构：daemon 经 endpointFor() 契约分派 + validateResponse() 契约校验
// OS-130 契约分域后，端点形状按域切片在 contracts/<域>.mjs——计数＝contracts.mjs＋contracts/*.mjs 合计
const contractFiles = ['contracts.mjs',
  ...readdirSync(join(REPO, 'contracts')).filter((f) => f.endsWith('.mjs')).sort().map((f) => `contracts/${f}`)]
const contractCount = contractFiles.reduce((sum, rel) => sum + (readRepo(rel).match(/method:/g) || []).length, 0)
const firstSlice = contractFiles.find((rel) => /method:/.test(readRepo(rel))) || contractFiles[0]
const daemonSrc = readRepo('daemon.mjs')
const endpointForUse = grepLine('daemon.mjs', /endpointFor\(req\.method/)
const validateRespUse = grepLine('daemon.mjs', /validateResponse\(/)
check('S2.3', 'S2', `契约驱动架构（contracts ${contractCount} 端点；daemon 契约分派+响应校验）`,
  contractCount > 0 && !!endpointForUse && !!validateRespUse,
  [lineOf(firstSlice, 'method:'), endpointForUse, validateRespUse].filter(Boolean),
  '契约表是模块间调用的唯一底座；新增端点必须先进 contracts（域分片）')

// S2.4 内核唯一进口（OS-125 解耦③）：仓根模块里只有 pinaxAdapter.mjs 可以 import core/**。
// 静态 from 与动态 import() 都算；@pinax/core（npm 包，worldbook/lexicon 契约）不在此列；
// test/*.test.mjs 等非仓根模块不在扫描范围。
const coreImportRe = /(?:from\s+|import\(\s*)['"](?:\.\.?\/)?(core\/[^'"]+)['"]/g
const coreViolators = []
for (const f of rootMjs) {
  if (f === 'pinaxAdapter.mjs') continue
  for (const m of readRepo(f).matchAll(coreImportRe)) coreViolators.push(`${f} -> ${m[1]}`)
}
const adapterCoreUse = grepLine('pinaxAdapter.mjs', /from\s+'(?:\.\/|\.\.\/)?core\//)
check('S2.4', 'S2', `内核唯一进口（${rootMjs.length} 个仓根模块，仅 pinaxAdapter.mjs 引 core/**）`,
  exists('pinaxAdapter.mjs') && !!adapterCoreUse && coreViolators.length === 0,
  [adapterCoreUse, ...coreViolators.slice(0, 5)].filter(Boolean),
  coreViolators.length
    ? `违规进口：${coreViolators.join('; ')}——内核能力只经 pinaxAdapter 五组出口（factStore/deduce/enrich/projectMeta/projectImport）`
    : '内核接触面收敛为 pinaxAdapter 单点（内核换版本只改这一个文件）')

/* ================================================================
 * S3 前端一致性 —— OpenDesign 语义令牌口径
 * ================================================================ */
console.log('\n── S3 前端一致性 ──')

const html = readRepo('public/index.html')
const styleBlock = html.slice(html.indexOf('<style'), html.indexOf('</style>'))
// S3.1 :root 令牌定义区之外不得出现裸色值（渐变艺术/SVG 特例白名单）
const rootEnds = [...styleBlock.matchAll(/\}\s*\n(?=\s*[.#@:\w[])/g)]
// 更直接的做法：逐行扫描——定义区 = 以 --xxx: 开头的行；其余行的裸 hex 即违例
const lines = styleBlock.split('\n')
let inTokenDef = 0
const rawHex = []
for (let i = 0; i < lines.length; i++) {
  const l = lines[i]
  if (/^\s*--[a-z-]+\s*:/i.test(l) || /:root\s*\{/.test(l)) inTokenDef = 3
  if (/^\s*[.#][\w-]+|^\s*@media|^\s*[a-z]+\s*\{/i.test(l.trim()[0] === '@' ? l : l) && !/^\s*--/.test(l)) inTokenDef = Math.max(0, inTokenDef - 1)
  const m = l.match(/#[0-9a-fA-F]{3,8}\b/)
  if (m && inTokenDef === 0 && !/--[a-z-]+\s*:/i.test(l)) {
    rawHex.push(`index.html:${html.split('\n').length ? '' : ''}${i + 1} ${m[0]}`)
  }
}
// 校正为全文件行号
const htmlLines = html.split('\n')
const styleStart = htmlLines.findIndex((l) => l.includes('<style'))
const rawHexFull = rawHex.map((s) => {
  const [, ln, hex] = s.match(/index\.html:(\d+) (#[0-9a-fA-F]+)/) || []
  return `public/index.html:${(Number(ln) || 0) + Math.max(styleStart, 0)} ${hex}`
})
const hexAllow = [/gradient/i] // 未来白名单挂点：当前无
check('S3.1', 'S3', `语义令牌覆盖率（令牌定义区外裸色值 ${rawHexFull.length} 处）`,
  rawHexFull.length <= 8, rawHexFull.slice(0, 8),
  rawHexFull.length ? '裸色值应进 :root 令牌（OpenDesign 口径：tokens.css 单一真源）' : '全部颜色走 var(--*)')

// S3.2 OS-48 回归守卫：侧栏浮层不得挤压正文
const magicPad = grepLine('public/index.html', /\.with-analyze\s+\.doc-scroll\s*\{[^}]*padding-right/)
const refAbs = grepLine('public/index.html', /\.ref-col\s*\{[^}]*position:\s*absolute/)
check('S3.2', 'S3', '侧栏=浮层（正文恒居中，OS-48 宪法）',
  !magicPad && !!refAbs,
  [refAbs, magicPad].filter(Boolean),
  magicPad ? '魔法数 padding-right 回潮——侧栏改回绝对定位' : '')

// S3.3 组件约定类（卡片/折叠/关闭统一）
const convClasses = ['surface-card', 'rm-toggle', 'rm-x', 'shadow-card']
const missingConv = convClasses.filter((c) => !styleBlock.includes(`--${c}`) && !styleBlock.includes(`.${c}`))
check('S3.3', 'S3', '统一组件约定类在样式表有定义（surface-card/rm-toggle/rm-x/shadow-card）',
  missingConv.length === 0,
  convClasses.filter((c) => !missingConv.includes(c)).map((c) => grepLine('public/index.html', new RegExp(`(\\.${c}|--${c})`))).filter(Boolean),
  missingConv.length ? `缺：${missingConv.join(', ')}` : '')

/* ================================================================
 * S4 UX 跳转层级 —— 全局一致性规范（从严）
 * ================================================================ */
console.log('\n── S4 UX 跳转层级 ──')

const appJs = readRepo('public/app.js')
// S4.1 顶部页签可达性：核心模块页签常驻顶栏
const CORE_TABS = ['正文', '世界书', '习惯', '拆解', '推演', '参考']
const tabMiss = CORE_TABS.filter((t) => !appJs.includes(t) && !html.includes(t))
check('S4.1', 'S4', `核心模块页签顶栏可达（${CORE_TABS.join('/')}）`,
  tabMiss.length === 0, [], tabMiss.length ? `缺页签：${tabMiss.join(', ')}` : '')

// S4.2 关闭按钮统一：模块卡关闭走 rm-x；整页关闭 page-close 是合法家族（docs/UX-STRUCTURE.md §三）
const rmXUses = (appJs.match(/rm-x/g) || []).length
const CLOSE_ALLOW = /page-close/
const rogueClose = [...appJs.matchAll(/class="([^"]*close[^"]*)"/g)].map((m) => m[1]).filter((c) => !CLOSE_ALLOW.test(c))
check('S4.2', 'S4', `官方关闭按钮统一（rm-x 引用 ${rmXUses} 处；旁路 close 类 ${rogueClose.length} 处）`,
  rogueClose.length === 0, rogueClose.slice(0, 4).map((s) => lineOf('public/app.js', `class="${s}`)),
  rogueClose.length ? '存在旁路关闭实现——并入 rm-x（模块卡）/page-close（整页）约定' : '关闭走 rm-x + page-close 两级约定')

// S4.3 页面结构清单落盘（跳转层级规范的机械面）
const docExp = exists('docs/UX-STRUCTURE.md')
check('S4.3', 'S4', 'UX 结构清单文档存在（docs/UX-STRUCTURE.md：页签/子页签/入口层级）',
  docExp, docExp ? ['docs/UX-STRUCTURE.md'] : [],
  docExp ? '' : '新功能跳转层级遵循度差的根因是没有全局清单——已随本批补齐' )

/* ---------- 汇总 ---------- */
const pass = checks.filter((c) => c.verdict === 'PASS').length
const fail = checks.filter((c) => c.verdict === 'FAIL').length
const warns = checks.filter((c) => c.verdict === 'WARN').length
console.log(`\n验收门禁：${pass} 过 / ${fail} 挂 / ${warns} 警（S1 Agentic · S2 可插拔 · S3 前端一致性 · S4 UX 层级）`)

if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true })
  writeFileSync(jsonOut, JSON.stringify({
    schema: 'openstory.acceptance/v1',
    generatedAt: new Date().toISOString(),
    standards: ['S1 Agentic', 'S2 可插拔', 'S3 前端一致性', 'S4 UX 跳转层级'],
    summary: { pass, fail, warn: warns },
    checks
  }, null, 2))
  console.log(`报告已写：${relative(REPO, jsonOut) || jsonOut}`)
}
process.exit(fail > 0 ? 1 : 0)
