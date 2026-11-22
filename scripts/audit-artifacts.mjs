/**
 * 静态盘点器（OS-107）：扫本仓代码，产出「产物 × 转换关系 × 是否默认/统一/封装」矩阵。
 * 纯静态分析（读文件 + grep 契约），不动运行时数据。
 */
import { readFileSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const read = (p) => { try { return readFileSync(p, 'utf-8') } catch { return '' } }
const has = (src, ...needles) => needles.every((n) => src.includes(n))

// OS-130 契约分域后端点形状按域切片在 contracts/*.mjs——文本盘点把聚合入口与分片拼起来读
const readContracts = () => {
  let parts = [read('contracts.mjs')]
  try {
    parts = parts.concat(readdirSync('contracts').filter((f) => f.endsWith('.mjs')).sort().map((f) => read(join('contracts', f))))
  } catch { /* 无分域目录 */ }
  return parts.join('\n')
}

const app = read('public/app.js')
const contracts = readContracts()
const daemon = read('daemon.mjs')
const storySource = read('public/storySource.mjs')
const referenceStore = read('referenceStore.mjs')
const referenceMod = read('public/reference.mjs')
const scriptFact = read('public/scriptFact.mjs')
const deduceSession = read('deduceSession.mjs')
const roleplayEngine = read('roleplayEngine.mjs')

// ── 1) 产物清单（每个产物的存储位置 + 读写端点）──
const artifacts = [
  {
    id: 'chapter',
    name: '正文/章节',
    store: '正文/NNN-标题.md',
    read: contracts.includes("chapterGet: {") && contracts.includes("path: '/api/chapter'"),
    write: daemon.includes('writeChapterWithBackup'),
    judge: 'daemon.writeChapterWithBackup（原子写＋.history 备份）'
  },
  {
    id: 'fact',
    name: '拆解/事实条目',
    store: '拆解/<bookId>.json（fact.data/v3）',
    read: contracts.includes('factEntriesGet'),
    write: daemon.includes('writeFactFile') && contracts.includes('factEntriesImport'),
    judge: '内核 writeFactFile（revision + operationId 幂等）'
  },
  {
    id: 'wiki',
    name: '拆解/wiki 派生',
    store: '拆解/<bookId>.wiki.json',
    read: contracts.includes('factCurveGet') ? '经 curve 读' : false,
    write: daemon.includes('tmpWiki') ? '随 factEntriesImport 一起落' : false,
    judge: '派生档（可删可重建），写随 fact'
  },
  {
    id: 'reference',
    name: '世界书/参考笔记',
    store: '参考/**/*.md（frontmatter）',
    read: contracts.includes('referenceGet'),
    write: has(app, "/api/chapter', {", 'method: \'PUT\'') ? '经 /api/chapter PUT（复用正文通道）' : false,
    judge: 'referenceStore 扫描解析；写复用正文通道'
  },
  {
    id: 'entry-view',
    name: '世界书/拆解词条视图',
    store: '（无独立存储，读 fact）',
    read: has(app, '/api/fact/entries'),
    write: '只读',
    judge: 'referenceEntryDetailHtml（OS-103/105）'
  },
  {
    id: 'graph',
    name: '关系图谱',
    store: '（纯计算）',
    read: contracts.includes('referenceGraphGet'),
    write: '只读',
    judge: 'buildReferenceGraph（notes＋entries＋tags）'
  },
  {
    id: 'story',
    name: '故事源/三形态',
    store: '（纯计算：fact entries ＋ wiki 章纲）',
    read: has(app, '/api/fact/curve') && has(app, '/api/fact/entries'),
    write: '只读',
    judge: 'storySource.layoutStorySource（三形态一次算好）'
  },
  {
    id: 'script',
    name: '剧本',
    store: '剧本/**.md',
    read: contracts.includes('chapterGet') ? '经 files/chapter' : false,
    write: '经 /api/chapter PUT',
    judge: 'scriptFact.mjs 互转（script↔fact）'
  },
  {
    id: 'deduce',
    name: '推演/扮演会话',
    store: '推演/<bookId>/session.json（+sessions/）',
    read: contracts.includes('deduceSessionGet'),
    write: has(deduceSession, 'saveDeduceSession'),
    judge: 'deduceSession（原子写＋.history；多局＋rollingSummary）'
  },
  {
    id: 'roleplay',
    name: '扮演回合',
    store: '（写入 deduce session.nodes）',
    read: contracts.includes('roleplayTurn'),
    write: 'appendNode → saveDeduceSession',
    judge: 'roleplayEngine（主持人＋N 角色；deAiPass 过闸）'
  },
  {
    id: 'uiState',
    name: '界面状态',
    store: '.pinax/ui-state.json',
    read: contracts.includes('uiStateGet'),
    write: contracts.includes('uiStatePut'),
    judge: '本地化（不用 localStorage）'
  },
  {
    id: 'jobs',
    name: '后台任务',
    store: '（进程内 Map）',
    read: contracts.includes('jobsGet'),
    write: contracts.includes('jobCancel'),
    judge: 'jobCenter（重启即清，不留幽灵）'
  }
]

// ── 2) 转换关系矩阵 ──
const conversions = [
  { from: 'fact 条目', to: '世界书词条视图', kind: '读派生', impl: 'refEntriesGroupHtml + referenceEntryDetailHtml', bidirectional: false },
  { from: 'fact 条目', to: '关系图谱节点', kind: '读派生', impl: 'buildReferenceGraph（kind:entry）', bidirectional: false },
  { from: '参考笔记', to: '关系图谱节点', kind: '读派生', impl: 'buildReferenceGraph（kind:reference）', bidirectional: false },
  { from: '参考笔记 [[条目:id]]', to: '图谱边', kind: '读派生', impl: 'addEdge(note, entry, link, 2)', bidirectional: false },
  { from: 'fact 条目', to: '故事源三形态', kind: '读派生', impl: 'layoutStorySource（entries+wiki）', bidirectional: false },
  { from: 'wiki 章纲', to: '故事源/AI上下文', kind: '读派生', impl: 'ssWikiOf(curve.chapters)', bidirectional: false },
  { from: '剧本', to: 'fact 条目', kind: '转换', impl: 'scriptToFact（OS-78，往返验证过）', bidirectional: true },
  { from: 'fact 条目', to: '剧本', kind: '转换', impl: 'factToScript（OS-78，往返验证过）', bidirectional: true },
  { from: 'fact 条目', to: '扮演底座', kind: '读派生', impl: 'loadEntries + chapterLimit 过滤', bidirectional: false },
  { from: '参考笔记 firstChapter', to: 'agent 上下文过滤', kind: '读派生', impl: 'notesVisibleAt(maxChapter)', bidirectional: false },
  { from: '扮演回合', to: '会话节点', kind: '写入', impl: 'appendNode(draft + beats)', bidirectional: false },
  { from: '会话节点', to: '正文章节', kind: '转正', impl: 'deducePromote（createChapter + backup）', bidirectional: false },
  { from: '会话/节点', to: 'Markdown 导出', kind: '导出', impl: 'deduceExport', bidirectional: false },
  { from: '故事源文本', to: 'fact 条目', kind: '**缺失**', impl: '（未实现）', bidirectional: false },
  { from: '世界书笔记', to: '故事源大纲', kind: '**缺失**', impl: '（未实现）', bidirectional: false },
  { from: 'fact 条目', to: '参考笔记', kind: '**缺失**', impl: '（未实现，只能手动新建）', bidirectional: false }
]

// ── 3) 一致性检查 ──
const checks = []
// 3.1 firstChapter 契约是否三处统一
checks.push({
  id: 'firstChapter-contract',
  label: 'firstChapter 在三处消费（世界书筛选/agent上下文/扮演底座）',
  ok: has(referenceStore, 'firstChapter') && has(daemon, 'notesVisibleAt') && has(daemon, 'chapterLimit'),
  detail: 'referenceStore 解析 → daemon notesVisibleAt 过滤 → roleplay present chapterLimit'
})
// 3.2 双份 referenceStore 是否同口径
const pubStore = read('public/referenceStore.mjs')
checks.push({
  id: 'referenceStore-dual',
  label: 'referenceStore 双份（根/public）同口径',
  ok: has(referenceStore, 'refEntriesGroupHtml') === has(pubStore, 'refEntriesGroupHtml') && has(referenceStore, 'notesVisibleAt') && has(pubStore, 'notesVisibleAt'),
  detail: '根目录版 daemon 用；public 版前端用——改一个必须同步另一个'
})
// 3.3 写通道是否统一
checks.push({
  id: 'write-channel',
  label: '文本类写入统一走 writeChapterWithBackup（原子写+备份）',
  ok: daemon.includes('async function writeChapterWithBackup') && (daemon.match(/writeChapterWithBackup\(/g) || []).length >= 3,
  detail: '正文/参考笔记/转正/剧本导入共用'
})
// 3.4 fact 写入是否走内核协议
checks.push({
  id: 'fact-write',
  label: 'fact 写入走内核 writeFactFile（revision+幂等）',
  ok: has(daemon, 'writeFactFile') && has(daemon, 'operationId'),
  detail: '回填/导入/剧本互转共用'
})
// 3.5 会话写入
checks.push({
  id: 'session-write',
  label: '会话写入走 saveDeduceSession（原子写+备份）',
  ok: has(deduceSession, 'atomicWrite') || has(deduceSession, 'saveDeduceSession'),
  detail: '推演/扮演共用容器'
})
// 3.6 视图状态默认统一
checks.push({
  id: 'view-defaults',
  label: '故事源默认形态明确（outline）',
  ok: has(app, "view: 'outline'"),
  detail: 'ss.view 默认 outline；三形态数据同一次算好'
})
// 3.7 世界书双来源是否都有独立入口与详情
checks.push({
  id: 'worldbook-dual-source',
  label: '世界书两来源（笔记/词条）都有列表+详情+图谱',
  ok: has(referenceMod, 'refEntriesGroupHtml') && has(app, 'referenceEntryDetailHtml') && has(app, 'mountEntryGraph') && has(app, 'mountDetailGraph'),
  detail: '笔记：refNav/referenceEditorHtml/mountDetailGraph；词条：refEntriesGroupHtml/referenceEntryDetailHtml/mountEntryGraph'
})
// 3.8 切换状态是否清理干净
checks.push({
  id: 'switch-clean',
  label: '笔记↔词条切换时互斥状态清理',
  ok: has(app, 'ref.activeEntry = \'\'\n') || has(app, "ref.activeEntry = ''"),
  detail: 'openReference 清 activeEntry；词条点击清 activePath（OS-106 修）'
})

// ── 4) 输出 ──
const lines = []
lines.push('# 产物 × 转换关系 静态盘点（OS-107）', '')
lines.push(`生成于 ${new Date().toISOString()}`, '')
lines.push('## 一、产物清单', '')
lines.push('| 产物 | 存储 | 读 | 写 | 判定 |', '|---|---|---|---|---|')
for (const a of artifacts) {
  lines.push(`| ${a.name} | \`${a.store}\` | ${a.read === true ? '✓' : a.read ? a.read : '✗'} | ${a.write === true ? '✓' : a.write ? a.write : '✗'} | ${a.judge} |`)
}
lines.push('', '## 二、转换关系矩阵', '')
lines.push('| 从 | 到 | 类型 | 实现 | 双向 |', '|---|---|---|---|---|')
for (const c of conversions) {
  lines.push(`| ${c.from} | ${c.to} | ${c.kind} | \`${c.impl}\` | ${c.bidirectional ? '✓' : '—'} |`)
}
lines.push('', '## 三、一致性与封装检查', '')
for (const c of checks) {
  lines.push(`- ${c.ok ? '✓' : '✗'} **${c.label}** — ${c.detail}`)
}
lines.push('', `## 四、结论`)
const okCount = checks.filter((c) => c.ok).length
const missing = conversions.filter((c) => c.kind.includes('缺失'))
lines.push(`- 检查项：${okCount}/${checks.length} 通过`)
lines.push(`- 缺失转换：${missing.length} 条（${missing.map((m) => `${m.from}→${m.to}`).join('、')}）`)
lines.push(`- 双向转换：${conversions.filter((c) => c.bidirectional).length} 条（剧本↔fact 是唯一双向）`)

writeFileSync('docs/AUDIT-ARTIFACTS.md', lines.join('\n'), 'utf-8')
console.log(lines.join('\n'))
