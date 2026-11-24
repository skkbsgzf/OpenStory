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
 * OS-140 布局归一：自持模块收进 src/（host/api/protocol/kernel/modules/services），
 * OS-159 再收紧：仓根零 .mjs，入口直跑 src/host/{daemon,mcp}.mjs——S0.1 用根目录白名单
 * 钉死这条宪法；S1/S2 的扫描面是「src/ 树全部 .mjs」（实现文件都在里面，覆盖面只增不减）。
 *
 * 用法：node tools/acceptance/acceptance.mjs [--json <outPath>]
 * 退出码：0 = 全过；1 = 有 FAIL（新增检查项默认 WARN 不拦截，见 CHECKS 注释）
 */
import { readFileSync, readdirSync, statSync, writeFileSync, mkdirSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, dirname, relative, resolve as pathResolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { NAMING_TABLE, TAB_REGISTRY, LOG_MODULES, computeTabDefs, viewScope } from '../../public/views/registry.mjs'
// OS-150b：S2.1/S2.2 共用同一份说明符扫描器（静态 from／动态 import()／副作用 import／单双引号）。
// 两份正则必分叉——分叉面就是漏检面（analysisModules.mjs 的惰性 import 曾被整段放过）。
import { scanImportSpecs, resolveSpec, auditPublicEdges } from './importScan.mjs'

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

/* OS-140：src/ 树扫描器（递归收集 .mjs，带内容）＋相对说明符 → 仓内路径解析器 */
function walkMjs(dir, prefix) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = `${prefix}/${name}`
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkMjs(full, rel))
    else if (name.endsWith('.mjs')) out.push({ rel, src: readFileSync(full, 'utf-8') })
  }
  return out
}
/* resolveSpec 随扫描器迁到 ./importScan.mjs（OS-150b），仓内只有一份。 */

/* ================================================================
 * S0 布局宪法（OS-140）——仓根只允许入口、包描述、文档
 * ================================================================ */
console.log('\n── S0 布局 ──')

// S0.1 根目录白名单（OS-159 收紧）：根目录下的文件与目录必须落在清单里，多一个都红。
// 入口不再放仓根垫片——`node src/host/daemon.mjs` / `node src/host/mcp.mjs` 直跑实现文件。
const ROOT_FILES = new Set(['AGENTS.md', 'ARCHITECTURE.md', 'LICENSE', 'README.md', 'package.json', 'package-lock.json', '.gitignore'])
const ROOT_DIRS = new Set(['src', 'public', 'test', 'tools', 'docs', 'samples', 'suites', 'runtimes', 'styles', 'genres', 'skills', 'design-system', '.zcode', '.ua', '.cache', 'node_modules'])
const rootEntries = readdirSync(REPO).sort()
const rootStrays = rootEntries.filter((name) => {
  if (ROOT_FILES.has(name) || ROOT_DIRS.has(name)) return false
  // 隐藏的 git 元数据、工具缓存与运行时日志不算布局条目（由别的门禁/纪律管）；
  // .daemon-<port>.log / .daemon-<port>.err.log 是 daemon 运行时产物，不起服务就不是布局的一部分。
  if (['.git', '.cache', '.ua'].includes(name)) return false
  if (/^\.daemon-\d+(\.err)?\.log$/u.test(name)) return false
  return true
})
check('S0.1', 'S0', `根目录白名单（文件 ${ROOT_FILES.size} 项＋目录 ${ROOT_DIRS.size} 项；实测 ${rootEntries.length} 条目，越界 ${rootStrays.length}）`,
  rootStrays.length === 0 && !rootEntries.some((f) => f.endsWith('.mjs')),
  rootStrays.slice(0, 8).map((f) => `根目录多出：${f}${exists(join(REPO, f)) ? '' : ''}`),
  rootStrays.length ? `多出的条目（要建先登记白名单）：${rootStrays.join(', ')}` : '根目录零散落 .mjs，文档全在 docs/')

// S0.2 架构文档数字与实测一致（OS-150）：ARCHITECTURE.md 的生成段（arch-stats 标记之间）
// 必须逐字等于 tools/arch-stats.mjs 的实测输出——文件数/行数从此不再靠人手回填。
// 走 --check 而不是 import 计算函数：验的就是作者/CI 会跑的那条命令与退出码。
let archStatsOk = false
let archStatsEvidence = []
try {
  const out = execFileSync(process.execPath, ['tools/arch-stats.mjs', '--check'], { cwd: REPO, encoding: 'utf-8' })
  archStatsOk = true
  archStatsEvidence = [lineOf('tools/acceptance/acceptance.mjs', 'S0.2 架构文档数字与实测一致'), out.trim().split('\n')[0]]
} catch (error) {
  const detail = String(error.stdout || error.stderr || error.message || '').trim().split('\n').slice(0, 4)
  archStatsEvidence = [`tools/arch-stats.mjs --check 退出码 ${error.status ?? '?'}`, ...detail]
}
check('S0.2', 'S0', '架构文档数字与实测一致（tools/arch-stats.mjs --check 逐字比对生成段）',
  archStatsOk, archStatsEvidence,
  archStatsOk ? '' : 'ARCHITECTURE.md 生成段与实测不符——跑 npm run arch:stats 回写（手改一个数字就会红）')

/* ================================================================
 * S1 Agentic —— MCP / skill / 知识库 / dsh runtime / 多 CLI
 * ================================================================ */
console.log('\n── S1 Agentic ──')

// S1.1 MCP 工具清单与模块覆盖（按前缀归类：每个模块 ≥2 个工具＝有读有写）
const mcpSrc = readRepo('src/host/mcp.mjs')
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
  toolNames.slice(0, 4).map((t) => lineOf('src/host/mcp.mjs', `name: '${t}'`)).filter((s) => !s.endsWith(':?')),
  thinModules.length ? `工具不足 2 个的模块组：${thinModules.join(', ')}` : '各模块组均有读+写工具')

// S1.2 docs/mcp/*.md 对外文档与工具同步（OS-159：对外材料从 mcp/skills/ 归入 docs/mcp/）
const mcpSkillDir = join(REPO, 'docs', 'mcp')
let mcpDocs = []
try { mcpDocs = readdirSync(mcpSkillDir).filter((f) => f.endsWith('.md')) } catch { /* 目录不存在 */ }
const overview = mcpDocs.includes('OVERVIEW.md') ? readRepo('docs/mcp/OVERVIEW.md') : ''
const overviewNum = [...overview.matchAll(/(\d+)\s*个工具/g)].map((m) => Number(m[1]))
const docSync = overviewNum.length === 0 || overviewNum.some((n) => Math.abs(n - toolNames.length) <= 2)
check('S1.2', 'S1', `docs/mcp 对外文档同步（OVERVIEW 声称 ${overviewNum.join('/') || '—'}，实际 ${toolNames.length}）`,
  docSync && mcpDocs.length >= 5, mcpDocs.map((f) => `docs/mcp/${f}`),
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
// OS-140：四件套全部在 src/services/
const dshPieces = ['src/services/dsh-cli.mjs', 'src/services/dsh-bridge.mjs', 'src/services/cli-bridge.mjs', 'src/services/runtimes.mjs']
const dshMissing = dshPieces.filter((f) => !exists(f))
const dshKindReg = grepLine('src/services/runtimes.mjs', /kind\s*===\s*'dsh'|'sidecar',\s*'endpoint',\s*'cli',\s*'dsh'/)
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

// S2.1 扫 src/ 树的 import 图（OS-159 起仓根零垫片，入口实现文件本就在 src/host/ 内，覆盖面只增不减）
const srcMjs = walkMjs(join(REPO, 'src'), 'src')
const scanned = srcMjs
const imports = {}
const importEvidence = {}
for (const { rel, src } of scanned) {
  imports[rel] = []
  importEvidence[rel] = []
  for (const { spec, line } of scanImportSpecs(src)) {
    if (!/^\.{1,2}\//u.test(spec) || !spec.endsWith('.mjs')) continue
    const dep = resolveSpec(rel, spec)
    imports[rel].push(dep)
    importEvidence[rel].push(`${rel}:${line} '${spec}'`)
  }
}
// 模块纪律两套口径合取（OS-142 Host API 升格；都过才算过，只紧不松）：
// ① 新口径（主，路径规则）：src/modules/** 的 import 只许三类——
//      node 内置模块（node: 前缀裸说明符）、src/protocol/**（Host API：index.mjs 七命名空间
//      入口＋各叶子转供件）、自己所在模块目录内的文件（模块内部组合）。
//    扫描覆盖静态 from 与动态 import()、含 .js 相对说明符；node 内置必须带 node: 前缀。
// ② 旧口径（保留）：清单模块（含 services 件与 factGuard）互不耦合，只许引协议层与
//    KERNEL_ALLOW 内部边——旧白名单面继续受保护，防止 services 层退化。
// 豁免唯一且显式点名（不许静默放过；台账在 src/protocol/README.md）：
//    roleplayEngine → public/analysis.mjs：纯函数「AI 味」分析（浏览器侧同源实现），
//    下沉 protocol 留后续批次。
const MODULE_RULE_EXEMPT = new Set([
  'src/modules/roleplay/roleplayEngine.mjs -> public/analysis.mjs'
])
const moduleRuleViolations = []
for (const { rel, src } of srcMjs.filter((f) => f.rel.startsWith('src/modules/'))) {
  const modDir = `${rel.slice(0, rel.lastIndexOf('/'))}/`
  for (const { spec, line } of scanImportSpecs(src)) {
    if (spec.startsWith('node:')) continue // ① node 内置模块
    if (spec.startsWith('./') || spec.startsWith('../')) {
      const dep = resolveSpec(rel, spec)
      if (dep.startsWith('src/protocol/')) continue // ② Host API 协议层
      if (dep.startsWith(modDir)) continue // ③ 模块内部组合
      if (MODULE_RULE_EXEMPT.has(`${rel} -> ${dep}`)) continue // 显式点名豁免
      moduleRuleViolations.push(`${rel}:${line} '${spec}'`)
    } else {
      moduleRuleViolations.push(`${rel}:${line} 裸说明符 '${spec}'（模块只许 node: 前缀内置）`)
    }
  }
}
// 旧口径：协议层从文件名白名单改为路径规则（src/protocol/** 全量＋两份既有底层件）——
// 白名单面只增不减：原七个文件全在覆盖内，新增协议件自动入列。
const isProtocolPath = (rel) => rel.startsWith('src/protocol/') || rel === 'src/api/contracts.mjs' || rel === 'src/kernel/index.mjs' // 底层接口协议层（src/protocol/**＝OS-142 Host API 全家：index.mjs 七命名空间入口＋chapters 正文协议＋chapterNumber 章节号＋chapterWrite 写备份＋changelog 变更日志＋versionGate 版本闸＋plugins 货架聚合＋dependencyGraph 依赖图＋factGuard fact 守卫＋hostWrite 宿主写协议（OS-138 原子写收敛）＋libState 库内状态＋kernelPlumber/authorize/apiErrors/upstream/worldbookContract 五个转供叶子；api/contracts.mjs＝端点契约；kernel/index.mjs＝OS-157 起内核公开面唯一出口，见 S2.4'）
const KERNEL_ALLOW = new Set([
  // OS-79：deduceNarrative 是推演引擎的内部子模块（只做叙事上下文拼装，纯函数），
  // 不是平等功能模块——引擎引它属于内部组合，不是跨模块耦合（OS-142 起同属新口径③）。
  'src/modules/deduce/deduceEngine.mjs -> src/modules/deduce/deduceNarrative.mjs',
  // OS-155：推演链归扮演模块后，engine/index.mjs 是同一模块目录内的出口（八个引擎件的
  // 组合面）——deduceEngine 引它同属模块内部组合（新口径③已放行；此处让旧口径②同口径）。
  'src/modules/deduce/deduceEngine.mjs -> src/modules/deduce/engine/index.mjs'
])
const MODULES = [
  'src/modules/deduce/deduceEngine.mjs', 'src/modules/deduce/deduceSession.mjs', 'src/modules/worldbook/referenceStore.mjs', 'src/services/enrichEngine.mjs',
  'src/protocol/factGuard.mjs', 'src/modules/kb/kbRouter.mjs', 'src/modules/kb/kbAdapter.mjs', 'src/modules/kb/kbHealth.mjs', 'src/services/style-check.mjs', 'src/services/stylePacks.mjs', 'src/services/skills.mjs', 'src/services/genres.mjs'
]
const crossEdges = []
for (const mod of MODULES) {
  for (const dep of imports[mod] || []) {
    if (dep === mod) continue
    if (isProtocolPath(dep)) continue
    if (dep.startsWith('src/kernel/')) continue // 自有内核＝底层（S2.4'），不算模块耦合
    const tag = `${mod} -> ${dep}`
    if (!KERNEL_ALLOW.has(tag)) crossEdges.push(tag)
  }
}
check('S2.1', 'S2', `模块纪律：src/modules/** 只引 node 内置/protocol/**/模块内文件（${srcMjs.filter((f) => f.rel.startsWith('src/modules/')).length} 个模块文件）；清单模块零直接耦合`,
  moduleRuleViolations.length === 0 && crossEdges.length === 0,
  [
    ...moduleRuleViolations.slice(0, 4),
    ...crossEdges.slice(0, 3).map((e) => {
      const [mod, dep] = e.split(' -> ')
      const ev = (importEvidence[mod] || []).find((s) => s.includes(dep))
      return ev || lineOf(mod, dep)
    })
  ].filter(Boolean),
  moduleRuleViolations.length || crossEdges.length
    ? `违规：${[...moduleRuleViolations, ...crossEdges].join('; ')}`
    : '三类来源＋一条显式豁免（roleplayEngine→public/analysis.mjs）；内核能力只经协议层 fact 命名空间取')

// S2.2 前端模块隔离（public/*.mjs 只共享渲染协议）
// OS-143：页签注册表 views/registry.mjs 纳入扫描面——它是纯数据＋纯函数（零 import），
// app.js 经动态 import 消费它；依赖方向永远是壳→表，注册表绝不反向依赖 app.js。
// OS-150a：扫描面改为自动枚举 public/*.mjs 与 public/views/*.mjs（只增不减），
// 新增模块不用回来改清单。
// OS-150b：① 改用与 S2.1 同一份扫描器（./importScan.mjs）——静态 from、动态 import()、
// 副作用 import、单双引号全在面内；② 豁免从「按目标文件全局放行」改为**按边登记**
// （PUBLIC_EDGE_ALLOW，每条带理由）——script.mjs 只放行 scriptFact.mjs 那一条真实合法边。
const publicMjs = [
  ...readdirSync(join(REPO, 'public')).filter((f) => f.endsWith('.mjs')).map((f) => f),
  ...readdirSync(join(REPO, 'public/views')).filter((f) => f.endsWith('.mjs')).map((f) => `views/${f}`)
].sort()
const publicFiles = publicMjs
  .map((f) => `public/${f}`)
  .filter((rel) => exists(rel))
  .map((rel) => ({ rel, src: readRepo(rel) }))
const publicEdgeAudit = auditPublicEdges(publicFiles)
const pubCross = publicEdgeAudit.violations
check('S2.2', 'S2', `前端模块互不 import（自动扫描 public/*.mjs＋views/*.mjs 共 ${publicMjs.length} 个；合法边按条登记）`,
  pubCross.length === 0,
  pubCross.map((edge) => `public/${edge.from.replace(/^public\//u, '')}:${edge.line} '${edge.spec}'`),
  pubCross.length ? `违规：${pubCross.map((edge) => edge.tag).join('; ')}` : '')

// S2.6 豁免表只许反映真实合法边（OS-150b）：登记了却不存在＝腐化，没写理由＝不透明。
// 两条都红——豁免不是橡皮图章，删掉边忘了删登记同样要人看一眼。
const publicEdgeCount = new Set(publicEdgeAudit.edges.map((edge) => edge.tag)).size
check('S2.6', 'S2', `前端豁免按边登记且真实存在（${publicEdgeCount} 条实边；登记 ${publicEdgeAudit.stale.length ? `${publicEdgeAudit.stale.length} 条失效/无理由` : '全部有效'}）`,
  publicEdgeAudit.stale.length === 0,
  publicEdgeAudit.stale.map((row) => `PUBLIC_EDGE_ALLOW: ${row.edge}${row.reason ? '（仓里无此边）' : '（缺理由）'}`),
  publicEdgeAudit.stale.length ? `豁免表失效：${publicEdgeAudit.stale.map((row) => row.edge).join('; ')}` : '每条豁免都有边有理由')

// S2.3 契约驱动架构：daemon 经 endpointFor() 契约分派 + validateResponse() 契约校验
// OS-130 契约分域后，端点形状按域切片在 contracts/<域>.mjs——计数＝contracts.mjs＋contracts/*.mjs 合计
// OS-140：契约层在 src/api/（聚合入口＋七域分片）
// OS-141：daemon 拆分后端点行为迁到 src/api/handlers/ 七域文件——响应校验（validateResponse）
// 跟着实现走，证据行改读 handlers；路由分派（endpointFor）仍在 daemon。
const contractFiles = ['src/api/contracts.mjs',
  ...readdirSync(join(REPO, 'src/api/contracts')).filter((f) => f.endsWith('.mjs')).sort().map((f) => `src/api/contracts/${f}`)]
const contractCount = contractFiles.reduce((sum, rel) => sum + (readRepo(rel).match(/method:/g) || []).length, 0)
const firstSlice = contractFiles.find((rel) => /method:/.test(readRepo(rel))) || contractFiles[0]
const endpointForUse = grepLine('src/host/daemon.mjs', /endpointFor\(req\.method/)
const validateRespUse = grepLine('src/api/handlers/system.mjs', /validateResponse\(/)
check('S2.3', 'S2', `契约驱动架构（contracts ${contractCount} 端点；daemon 契约分派+响应校验）`,
  contractCount > 0 && !!endpointForUse && !!validateRespUse,
  [lineOf(firstSlice, 'method:'), endpointForUse, validateRespUse].filter(Boolean),
  '契约表是模块间调用的唯一底座；新增端点必须先进 contracts（域分片）')

// S2.4' 内核实现唯一（OS-157 退役原 S2.4）：core/ 与 vendor/ 已整体撤除，adapter 已解散——
// 本条收敛为一行：src/** 与仓根两个垫片不得出现 'core/' 路径说明符（静态 from 与动态 import()
// 都算），且内核实现只在 src/kernel/（公开面 index.mjs＋身份 identity.mjs＋错误码 errors.mjs）。
// 这是一条防陈旧 import 回潮的零成本规则；KERNEL_GATEWAY_ALLOW／adapterCoreUse／gatewayRogue
// 随 adapter 解散一并删除。test/*.test.mjs 等测试文件不在扫描范围。
const coreImportRe = /(?:from\s+|import\(\s*)['"](?:\.{1,2}\/)+(core\/[^'"]+)['"]/g
const coreViolators = []
for (const { rel, src } of scanned) {
  for (const m of src.matchAll(coreImportRe)) coreViolators.push(`${rel} -> ${m[1]}`)
}
const kernelSurfaceOk = exists('src/kernel/index.mjs') && exists('src/kernel/identity.mjs') && exists('src/kernel/errors.mjs')
check('S2.4', 'S2', `S2.4' 内核实现唯一（${scanned.length} 个 src/ 模块＋垫片；src/** 无 core/ 路径说明符）`,
  kernelSurfaceOk && coreViolators.length === 0,
  [...coreViolators.slice(0, 4), lineOf('src/kernel/index.mjs', 'export const factStore'), lineOf('src/kernel/errors.mjs', 'export const KERNEL_ERROR_CODES')].filter(Boolean),
  coreViolators.length || !kernelSurfaceOk
    ? `违规进口：${coreViolators.join('; ')}——core/、vendor/ 已退役（OS-157），内核实现只在 src/kernel/，公开面 src/kernel/index.mjs`
    : 'core/ 进口面为零（OS-157 全树自持）；内核实现只在 src/kernel/，公开面 index.mjs 五键（factStore/enrich/ok/fail/writeFileAtomic）')

// S2.5 命名真源表一致（OS-148/G8a·G8d）：五层名字只从 public/views/registry.mjs 的
// NAMING_TABLE 取。跑两条：① 页签条目逐条回表（dir/label/panelLabel 相等）；
// ② 代码里实际写日志的模块名（LOG_MODULES 常量＋任何残留的 module: '中文名' 字面量）
// 全部登在表的 logModule/dirLogModule 列上——漏登或另写一份＝红。
const namingById = new Map(NAMING_TABLE.map((row) => [row.id, row]))
const tabNamingMiss = TAB_REGISTRY
  .filter((entry) => !entry.retired && entry.label)
  .filter((entry) => {
    const row = namingById.get(entry.concept)
    if (!row) return true
    return row.tab !== entry.label
      || (row.panelLabel ?? null) !== (entry.panelLabel ?? null)
      || (row.dirTab === false ? null : row.dir ?? null) !== (entry.dir ?? null)
  })
  .map((entry) => `TAB_REGISTRY:${entry.id}`)
const namingModules = new Set()
for (const row of NAMING_TABLE) {
  if (row.logModule) namingModules.add(row.logModule)
  if (row.dirLogModule) namingModules.add(row.dirLogModule)
}
const logModuleRaw = []
for (const { rel, src } of srcMjs) {
  for (const m of src.matchAll(/module:\s*'([\u4e00-\u9fa5][^']*)'/gu)) logModuleRaw.push({ at: rel, name: m[1] })
}
const logModuleUse = new Set([...Object.values(LOG_MODULES), ...logModuleRaw.map((item) => item.name)])
const logModuleMiss = [...logModuleUse].filter((name) => !namingModules.has(name))
const namingEvidence = [
  ...tabNamingMiss.slice(0, 3),
  ...logModuleMiss.slice(0, 3).map((name) => `日志模块「${name}」未登表`),
  ...logModuleRaw.slice(0, 2).map((item) => `${item.at} module: '${item.name}'（字面量，应走 LOG_MODULES）`),
  lineOf('public/views/registry.mjs', 'NAMING_TABLE = Object.freeze')
].filter(Boolean)
check('S2.5', 'S2',
  `命名真源表一致（${NAMING_TABLE.length} 概念；页签 ${TAB_REGISTRY.filter((e) => !e.retired && e.label).length} 条回表／日志模块 ${logModuleUse.size} 个登表）`,
  tabNamingMiss.length === 0 && logModuleMiss.length === 0,
  namingEvidence,
  tabNamingMiss.length || logModuleMiss.length
    ? `页签层/日志层有名字没走命名表：${[...tabNamingMiss, ...logModuleMiss].join(', ')}`
    : '页签/日志两层都从 NAMING_TABLE 取名（后端经 src/protocol/naming.mjs 只 re-export）')

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

// S3.4 OS-158 前端零浏览器存储：public/**（js/mjs/html）不许出现任何浏览器存储 API 字面，
// 注释也算命中（否则「文档说不用、代码却在用」会蒙混过关）。设置只有一份，在磁盘上；
// 皮肤这类机器级偏好落服务端 ui-preferences.json，界面态落库内 .pinax/ui-state.json。
const BROWSER_STORE = /localStorage|sessionStorage|indexedDB|document\.cookie|caches\.open|CacheStorage|serviceWorker/giu
function walkPublic(dir, prefix) {
  const out = []
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const rel = `${prefix}/${name}`
    const st = statSync(full)
    if (st.isDirectory()) out.push(...walkPublic(full, rel))
    else if (/\.(js|mjs|html)$/iu.test(name)) {
      const src = readFileSync(full, 'utf-8')
      const hits = [...src.matchAll(BROWSER_STORE)].map((m) => {
        const line = src.slice(0, m.index).split('\n').length
        return `${rel}:${line} ${m[0]}`
      })
      if (hits.length) out.push(...hits)
    }
  }
  return out
}
const storeHits = walkPublic(join(REPO, 'public'), 'public')
check('S3.4', 'S3', `前端零浏览器存储（public/** 扫 ${BROWSER_STORE.source.slice(0, 40)}…；命中 ${storeHits.length} 处，允许清单为空）`,
  storeHits.length === 0, storeHits.slice(0, 8),
  storeHits.length ? '浏览器存储按源隔离：换端口就不是同一份设置——全部改落磁盘（皮肤→服务端 ui-preferences.json，界面态→库内 ui-state.json）' : '任何端口打开都是同一份设置')

// S3.5 OS-93c 静态资源 no-store：html/js/css 必须 no-store（迭代密集时旧包会让作者看到老东西）。
const daemonSrc = readRepo('src/host/daemon.mjs')
const noStoreLine = grepLine('src/host/daemon.mjs', /cache-control.*no-store/u)
check('S3.5', 'S3', '静态资源 no-store 断言（html/js/css/mjs 走 no-store，防旧包假象）',
  !!noStoreLine && /\.(html|js|css|mjs)/u.test(daemonSrc) && !!grepLine('src/host/http.mjs', /'no-store'/u),
  [noStoreLine, grepLine('src/host/http.mjs', /'no-store'/u)].filter(Boolean),
  '')

/* ================================================================
 * S4 UX 跳转层级 —— 全局一致性规范（从严）
 * ================================================================ */
console.log('\n── S4 UX 跳转层级 ──')

const appJs = readRepo('public/app.js')
// S4.1 顶部页签可达性（OS-149 改强）：注册表 core:true 且未退场的条目必须三项全通——
//   a) label 真的出现在 computeTabDefs 的推导结果里（注册表即页签名真源，不读源码文本）；
//   b) render 注册名在 app.js 的 VIEW_RENDERERS 有键（装配缺口＝views 里有名字、壳里没函数）；
//   c) viewScope(view) 有作用域（go() 不会把它判成非法视图）。
// OS-150a：分词前先剥注释——块里写一行 `// writeHtmlGone` 不许冒充已注册。
const stripJsComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/[^\n]*/g, ' ')
const coreEntries = TAB_REGISTRY.filter((entry) => entry.core === true && !entry.retired)
const coreLabels = coreEntries.map((entry) => entry.label)
const tabBarCtx = { current: { path: '验收锚点' }, libDirs: ['正文', '参考', '世界书', '剧本', '拆解', '日志'], brief: null, briefGenre: null, settingsOpen: true }
const tabBarLabels = new Set(computeTabDefs(tabBarCtx).map((def) => def.label))
// app.js 的 VIEW_RENDERERS 是速记对象（键＝值）；只认块内的裸标识符 token
const rendererBlock = stripJsComments((appJs.match(/const VIEW_RENDERERS = \{([\s\S]*?)\}/) || [])[1] || '')
const rendererKeys = new Set(rendererBlock.split(/[,\s]+/).map((token) => token.trim())
  .filter((token) => /^[A-Za-z_$][\w$]*$/u.test(token)))
const s41Gaps = coreEntries.map((entry) => {
  const miss = []
  if (!entry.label) miss.push('无label')
  else if (!tabBarLabels.has(entry.label)) miss.push('不在页签栏')
  if (!rendererKeys.has(entry.render)) miss.push(`render未注册(${entry.render})`)
  if (viewScope(entry.view) === null) miss.push('scope为null')
  return { label: entry.label ?? entry.id, miss }
})
const s41Bad = s41Gaps.filter((gap) => gap.miss.length > 0)
check('S4.1', 'S4', `核心模块页签顶栏可达（${coreLabels.join('/')}；注册表 core:true 共 ${coreEntries.length} 条）`,
  coreEntries.length >= 4 && s41Bad.length === 0,
  coreEntries.map((entry) => `public/views/registry.mjs「${entry.label}」→ render:${entry.render}${rendererKeys.has(entry.render) ? '' : '（未注册）'}`),
  s41Bad.length ? `未接通：${s41Bad.map((gap) => `${gap.label}[${gap.miss.join('+')}]`).join(', ')}` : '页签名/渲染注册名/作用域三项均由注册表实测')

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
console.log(`\n验收门禁：${pass} 过 / ${fail} 挂 / ${warns} 警（S0 布局 · S1 Agentic · S2 可插拔 · S3 前端一致性 · S4 UX 层级）`)

if (jsonOut) {
  mkdirSync(dirname(jsonOut), { recursive: true })
  writeFileSync(jsonOut, JSON.stringify({
    schema: 'openstory.acceptance/v1',
    generatedAt: new Date().toISOString(),
    standards: ['S0 布局', 'S1 Agentic', 'S2 可插拔', 'S3 前端一致性', 'S4 UX 跳转层级'],
    summary: { pass, fail, warn: warns },
    checks
  }, null, 2))
  console.log(`报告已写：${relative(REPO, jsonOut) || jsonOut}`)
}
process.exit(fail > 0 ? 1 : 0)
