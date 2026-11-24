/**
 * 页签/路由声明式注册表（OS-143，G4 前端注册协议）。
 *
 * 页签系统以前散在 app.js 的五张表＋两处分发里（DIR_LABELS/DIR_ORDER/PAGE_TO_DIR_LOCAL/
 * DEFAULT_HIDDEN_TABS/RETIRED_DIRS＋renderTabs 扫描＋go 作用域校验）。本文件把它们收成
 * 一张 TAB_REGISTRY：新增一个页签＝给注册表加一条（纯数据），app.js 一行不用动；
 * app.js 从此增量冻结——视图渲染函数只出不进（G5 逐个迁出），页签/路由只经本表声明。
 *
 * 条目形状：
 *   {
 *     id          唯一名（测试与排错用）
 *     concept?    命名表概念 id（OS-148；有它＝dir/label/panelLabel 由 NAMING_TABLE 派生）
 *     kind        'fixed' 固定入口页签 ｜ 'dir' 目录型页签 ｜ 'module' 未来可插拔模块页签
 *     label       页签显示名（无 label ＝ 纯路由条目，只服务 go() 的作用域校验，不进页签栏）
 *     icon?       页签图标字（目录型旧算法取 label 首字，这里显式写死以保真）
 *     dir?        对应库内目录名（write 双角色：固定页签＋声明它依赖的目录）
 *     view        go() 用的视图名（'write' / 'dir:剧本' / 'reference'…）
 *     core?       核心载体页签（OS-88 三载体＋世界书/扮演；验收 S4.1 的顶栏可达面）
 *     retired?    已退场条目（OS-84/86）——computeTabDefs 无条件过滤，任何输入下都不出
 *     dirScan?    目录型页签：由「磁盘目录 × 词表」扫描物化；第一个 dirScan 条目的声明位
 *                 ＝动态目录页签组的插入点（固定页签组之后、扮演之前）
 *     render      渲染函数**注册名**（app.js 侧 VIEW_RENDERERS 映射持有函数本体；本表只存
 *                 名字，绝不 import app.js——依赖方向永远是壳→表）
 *     panelLabel? 「＋增加页签」面板里的显示名（参考在页签栏叫「世界书」、面板里叫「参考」）
 *     readonly?   只读页签（页签上挂「只读」牌）
 *     panel?      出现在「＋增加页签」面板的「常用」区（产物/正文/扮演）
 *     scope?      go() 的视图作用域：'library' 要先打开库 ｜ 'global' 全局页 ｜ 'flow' 建库流程页
 *     visibleWhen?(ctx) 纯函数可见性判定；ctx＝{ current, brief, briefGenre, libDirs,
 *                 settingsOpen, hasDir(name), excluded(Set), entry }
 *   }
 *
 * 硬约束（与 analysisModules.mjs 同门风）：
 *   · 纯数据＋纯函数：零 import、不碰 DOM、不读全局 state、不写任何存储；
 *   · 既有裁定逐项钉在本表里，改行为＝改表＝可测试：
 *       OS-8/36  动态页签＋「＋增加页签」；OS-12 产物首格固定；OS-19 体裁裁剪（excludedPages）；
 *       OS-32    设置是可关闭页签；OS-44/48 参考目录承载世界书、拆解目录承载故事源；
 *       OS-59    习惯走 habits.json 专页；OS-75 剧本走 dir:剧本 专渲染；
 *       OS-84/86 大纲/构思/资料/约束退场（无条件过滤，注册表里留档）；OS-88 只留三载体；
 *       OS-92    词表外目录不出页签（词表＝本表，没条目就没页签）；
 *   · 行为保真锚：renderTabs/go 的旧算法语义（稳定排序、过滤次序、默认隐藏种子）原样保留。
 *
 * 消费方：public/app.js（renderTabs/go/openTabAdd/hiddenTabs/probeRetiredDirs…）。
 */

/* ---------- OS-148（G8a/G8d）：五层命名单一真源表 ----------

   同一个概念在「磁盘目录 / UI 页签 / changelog 模块 / 契约域 / MCP 工具名」五层
   各有一个名字。表就是这五层的对照表——**全仓只有这一份数据**：
   DIR_LABELS / DIR_ORDER / READONLY_DIRS / PAGE_TO_DIR_LOCAL 与 TAB_REGISTRY 里
   的 dir/label/panelLabel 全部由它派生；后端经 src/protocol/naming.mjs 取用（只 re-export，
   不复制一个字面量）。

   为什么表落在本文件而不是独立的 public/naming.mjs：注册表有「零 import」纯度门禁
   （test/tabRegistry.test.mjs 钉死，且 registry 是浏览器侧 leaf 模块），独立成文件就必须
   import，与门禁冲突；而注册表本来就是目录词表/页签名的唯一真源。表放在这里＝既可被
   浏览器直接消费，也可被 Node 侧 src/protocol/naming.mjs 转供，仍然只有一份。

   列：
     id            概念 id（跨层稳定标识；页签条目用 concept 字段指向它）
     dir           磁盘目录名（null＝没有对应目录）
     dirTab        该目录是否由页签条目的 dir 字段承载（缺省 true；false＝有目录但页签不按目录扫）
     tab           页签显示名（null＝没有页签）
     panelLabel    「＋增加页签」面板里的显示名（null＝同 tab）
     dirLabel      DIR_LABELS 词表值（缺省＝tab；null＝不进 DIR_LABELS 词表）
     logModule     changelog 模块名（null＝不写变更日志）
     dirLogModule  按目录推断日志时的历史名（只给「目录名与模块名不一致」的既有实况留档，不迁移）
     contract      契约域文件名（src/api/contracts/<域>.mjs；null＝无独占端点）
     mcpPrefix     MCP 工具名前缀（null＝没有对外工具）
     note          一句实况说明（给人看，不参与任何判定）
   ------------------------------------------------------------------------ */

export const NAMING_TABLE = Object.freeze([
  { id: 'chapters', dir: '正文', tab: '正文', logModule: '正文', contract: 'chapters', mcpPrefix: 'openstory_novel_',
    note: '章节正文；写盘走 /api/chapter（chapters 域）' },
  // OS-44：参考目录承载世界书——目录叫「参考」、页签叫「世界书」、「＋」面板里还叫「参考」。
  { id: 'reference', dir: '参考', tab: '世界书', panelLabel: '参考', dirLabel: null, logModule: '参考', contract: 'reference', mcpPrefix: 'openstory_reference_',
    note: '目录归属另案（G8b）：磁盘目录名是「参考」，页签名是「世界书」' },
  { id: 'worldbook', dir: '世界书', tab: null, dirTab: false, dirLabel: '世界书', contract: null,
    note: '磁盘骨架目录；页签由 reference 承载（OS-44），自身不是页签条目' },
  { id: 'script', dir: '剧本', tab: '剧本', logModule: '剧本', contract: 'chapters',
    note: '剧本就是 剧本/NNN-标题.md，写盘与正文同走 chapters 域；无独占 MCP 工具' },
  // OS-48/G8d：拆解目录承载故事源（Fact 链可视化）——目录名不动，页签改叫故事源。
  { id: 'storysource', dir: '拆解', tab: '故事源', logModule: '拆解', dirLogModule: '故事源', contract: 'fact', mcpPrefix: 'openstory_fact_curve',
    note: '按目录推断的日志名历史实况是「故事源」（moduleOfPath），与显式传的「拆解」并存——不迁移既有库' },
  // OS-86/100：扮演＝推演全形态同一壳；推演/ 是会话与素材目录，页签不按目录扫描。
  { id: 'roleplay', dir: '推演', tab: '扮演', dirTab: false, dirLabel: null, logModule: '推演', contract: 'fact', mcpPrefix: 'openstory_deduce_',
    note: '目录只存会话/导出/素材，页签「扮演」由视图驱动' },
  // OS-59：习惯——规则类内容归 habits.json，专页承载。
  { id: 'habits', dir: '习惯', tab: '习惯', panelLabel: '习惯', dirLabel: null, logModule: '习惯', contract: 'system', mcpPrefix: 'openstory_habits_' },
  // OS-89：日志只读页签；/api/log* 端点在 chapters 域。
  { id: 'log', dir: '日志', tab: '日志', readonly: true, contract: 'chapters',
    note: '只读页签；日志由 changelog 写入，自身不再写变更日志' },
  // OS-12：产物中心（产出物＋多版本＋历史）。
  { id: 'artifacts', tab: '产物', contract: 'system', note: '产物中心：/api/artifacts 盘点＋/api/chapter 预览与恢复' },
  // OS-32：设置页签（主题字号/模块开关/凭据入口）。
  { id: 'settings', tab: '设置', contract: 'system', note: '/api/config 与 /api/ui-state' },
  { id: 'uiState', logModule: '界面状态', contract: 'system', note: '库内界面状态 .pinax/ui-state.json（页签/模块开关/字号档）' },
  { id: 'libraries', contract: 'library', mcpPrefix: 'openstory_libraries', note: '库管理（顶栏入口，非页签）' },
  { id: 'analysis', contract: null, mcpPrefix: 'openstory_analysis_chapter', note: '右栏分析卡片＋MCP 本地计算，不经 daemon 端点' },
  { id: 'enrich', logModule: '拆解', contract: 'fact', mcpPrefix: 'openstory_enrich_', note: '语义增补写旁挂 wiki，变更记在「拆解」日志' },
  { id: 'vision', contract: 'system', mcpPrefix: 'openstory_vision_describe', note: '识图：/api/vision/describe' },
  { id: 'imagegen', contract: 'reference', mcpPrefix: 'openstory_image_generate', note: '生图落条目的 assets/，端点 /api/reference/image' },
  { id: 'kb', contract: 'system', note: '知识库三件套（/api/kb/*）' },
  { id: 'shelf', contract: 'plugins', mcpPrefix: 'openstory_skills_', note: '风格/技能/体裁/套件货架' },
  { id: 'agent', contract: 'agent', note: 'Agent 对话与待确认卡；MCP 不开 agent 对话（硬约束 5）' }
].map(namingRow))

/** 每行补齐七列主体列（缺省 null），列序固定——表要被测试与门禁逐列核对，不许有的行缺列。 */
function namingRow(raw) {
  const row = { id: raw.id }
  for (const key of ['dir', 'tab', 'panelLabel', 'logModule', 'dirLogModule', 'contract', 'mcpPrefix']) {
    row[key] = raw[key] ?? null
  }
  if ('dirLabel' in raw) row.dirLabel = raw.dirLabel
  if (raw.dirTab === false) row.dirTab = false
  if (raw.readonly === true) row.readonly = true
  if (raw.note) row.note = raw.note
  return Object.freeze(row)
}

const namingIndex = new Map(NAMING_TABLE.map((row) => [row.id, row]))

/** 按概念 id 取行（不认识＝null）。 */
export function namingEntry(id) {
  return typeof id === 'string' ? namingIndex.get(id) ?? null : null
}

/** 按磁盘目录名反查（不认识＝null）。 */
export function namingEntryForDir(dir) {
  if (typeof dir !== 'string' || !dir) return null
  return NAMING_TABLE.find((row) => row.dir === dir) ?? null
}

/** 库内路径首段／目录名 → changelog 模块名（不认识的目录＝null，调用方自行兜底）。 */
export function logModuleForDir(dir) {
  const row = namingEntryForDir(dir)
  if (!row) return null
  return row.dirLogModule ?? row.logModule ?? null
}

/** 视图名 → changelog 模块名（模块加载时检索自己的 log 用）。 */
export function logModuleForView(view) {
  if (typeof view !== 'string') return ''
  if (view.startsWith('dir:')) {
    const dir = view.slice(4)
    return namingEntryForDir(dir)?.logModule ?? dir
  }
  const row = namingEntry(registryEntry(view)?.concept)
  return row?.logModule ?? ''
}

/** 概念 id → changelog 模块名表（后端写日志与前端检索共用，避免各抄一份字面量）。 */
export const LOG_MODULES = Object.freeze(Object.fromEntries(
  NAMING_TABLE.filter((row) => row.logModule).map((row) => [row.id, row.logModule])
))

/* ---------- 词表与退场表（由命名表逐键派生，唯一真源）---------- */

/** 一行的 DIR_LABELS 值：显式 dirLabel 优先，null＝不进词表，缺省＝页签名。 */
function dirLabelOf(row) {
  if (row.dirLabel === null) return null
  return row.dirLabel ?? row.tab ?? row.dir ?? null
}

/**
 * 目录名 → 页签标签。
 * OS-88（作者裁定）：demo 只做三种载体——长篇、短篇、剧本。**只保留有真实实现的标签**，
 * 其余（素材/漫画/视频/体验/联机/文档/人物/场景/大纲/构思/资料/约束）一律不进词表：
 * 它们没有专属页面，点进去只是一个裸 textarea，等于凭空许诺。
 * 已实现的真实页面：正文 / 世界书(参考载体) / 剧本 / 习惯 / 故事源(拆解) / 推演 / 日志(只读)。
 */
export const DIR_LABELS = Object.freeze(Object.fromEntries(
  NAMING_TABLE
    .filter((row) => row.dir && dirLabelOf(row) !== null)
    .map((row) => [row.dir, dirLabelOf(row)])
))

/** 目录型页签的排序轨道（OS-8）；不在轨道上的目录排在其后（按磁盘目录序稳定展开）。 */
export const DIR_ORDER = Object.freeze(['chapters', 'worldbook', 'script', 'log']
  .map((id) => namingEntry(id)?.dir)
  .filter(Boolean))

/** 只读目录（页签挂「只读」牌，工作面禁编辑）。 */
export const READONLY_DIRS = new Set(NAMING_TABLE.filter((row) => row.readonly && row.dir).map((row) => row.dir))

/** 页签名 → 库内目录名（体裁 excludedPages 裁剪用；只留真正有 view 的映射）。 */
export const PAGE_TO_DIR_LOCAL = Object.freeze({
  write: namingEntry('chapters')?.dir,
  entries: namingEntry('worldbook')?.dir,
  worldbook: namingEntry('worldbook')?.dir,
  script: namingEntry('script')?.dir
})

/**
 * 默认收起种子（OS-48）：大纲/构思/资料/约束的定位已被「参考」覆盖，
 * 作者没表过态（键不存在）时默认不出这四个页签。
 * 只作种子不落盘——作者一旦在「＋」里勾回或再收起，以作者的选择为准。
 */
export const DEFAULT_HIDDEN_TABS = Object.freeze(['dir:大纲', 'dir:构思', 'dir:资料', 'dir:约束'])

/**
 * OS-84：已退场的旧目录（作者裁定：定位已被「参考」「习惯」覆盖，标签不再进「增加页签」面板）。
 *   · 大纲/构思/资料 → 内容迁进「参考」（referenceStore.ABSORBABLE_DIRS，参考页有迁入入口）
 *   · 约束 → 规则类内容归「习惯」(habits.json)，OS-59 起不再迁入参考
 * 退场只影响**入口**：目录空着就彻底不出现；还有文件的只降级为「旧·待迁」露出，
 * 保证老库里的稿子不会因为标签下架变成 UI 里再也打不开的死文件。
 */
export const RETIRED_DIRS = Object.freeze(['大纲', '构思', '资料', '约束'])

/* ---------- 注册表本体（声明序＝页签栏序；目录型组插在第一个 dirScan 条目位）---------- */

/** 条目上的 dir/label/panelLabel 一律从命名表取（OS-148），本文件不再抄第二份字面量。 */
function tabNaming(id) {
  const row = namingEntry(id)
  if (!row || !row.tab) throw new Error(`命名表缺页签概念：${id}`)
  return {
    concept: id,
    ...(row.dir && row.dirTab !== false ? { dir: row.dir } : {}),
    label: row.tab,
    ...(row.panelLabel ? { panelLabel: row.panelLabel } : {})
  }
}

export const TAB_REGISTRY = Object.freeze([
  // OS-12：页签首格固定＝产物中心（产出物＋多版本＋历史）；「库」上移顶栏。
  { id: 'artifacts', kind: 'fixed', core: true, module: 'artifacts', view: 'artifacts', ...tabNaming('artifacts'), icon: '产', render: 'artifactsHtml', panel: true, closable: true, scope: 'library' },
  // OS-19：正文走 libDirs 判断——体裁声明后（如短故事）没有 正文/ 目录就不出。
  // OS-163：正文归核心模块 chapters；moduleCore 只表达「模块级不可停用」，与本表的页签级 core 是两回事。
  { id: 'write', kind: 'fixed', core: true, module: 'chapters', moduleCore: true, view: 'write', ...tabNaming('chapters'), icon: '章', render: 'writeHtml', panel: true, closable: true, scope: 'library',
    visibleWhen: (ctx) => !ctx.brief || ctx.hasDir(namingEntry('chapters').dir) },
  // 目录型组插入点：从这里到下一个非 dirScan 条目之间，全部按「磁盘目录 × 词表」扫描物化。
  // OS-44：参考目录走专门的笔记系统页，页签名「世界书」；「＋」面板里仍叫「参考」。
  { id: 'reference', kind: 'fixed', core: true, view: 'reference', ...tabNaming('reference'), dirScan: true, icon: '世', render: 'referencePageHtml', closable: true, scope: 'library' },
  // OS-75：剧本页 fork 正文页（dir:剧本 视图，剧本版式渲染）。
  { id: 'script', kind: 'fixed', core: true, module: 'script', moduleCore: true, view: 'dir:剧本', ...tabNaming('script'), dirScan: true, icon: '剧', render: 'dirViewHtml', closable: true, scope: 'library' },
  // OS-48：拆解目录承载故事源（fact 链可视化）——目录名不动，页签改叫故事源。
  { id: 'storySource', kind: 'fixed', core: true, module: 'storysource', view: 'dir:拆解', ...tabNaming('storysource'), dirScan: true, icon: '故', render: 'dirViewHtml', closable: true, scope: 'library' },
  // OS-59：习惯——规则类内容归 habits.json，专页承载。
  { id: 'habits', kind: 'dir', module: 'habits', view: 'habits', ...tabNaming('habits'), dirScan: true, icon: '习', render: 'habitsViewHtml', closable: true, scope: 'library' },
  // OS-89：日志只读页签（模块修改痕迹的自检索载体）。
  { id: 'log', kind: 'dir', view: 'dir:日志', ...tabNaming('log'), dirScan: true, icon: '日', readonly: true, render: 'dirViewHtml', closable: true, scope: 'library' },
  // ── 已退场目录（OS-84/86，作者裁定）：注册表里留档＋无条件过滤，双保险。──
  // OS-86：已退场的旧目录彻底不出现——不管磁盘上还在不在、有多少篇。
  // 作者口径：没被官方认证的标签就是要消失，不做「旧·待迁」降级露出；
  // 内容清理走一次性迁移（大纲/构思/资料→参考，约束→习惯＋参考存档）。
  { id: 'retired-outline', kind: 'dir', view: 'dir:大纲', dir: '大纲', dirScan: true, label: '大纲', retired: true },
  { id: 'retired-brainstorm', kind: 'dir', view: 'dir:构思', dir: '构思', dirScan: true, label: '构思', retired: true },
  { id: 'retired-material', kind: 'dir', view: 'dir:资料', dir: '资料', dirScan: true, label: '资料', retired: true },
  { id: 'retired-constraint', kind: 'dir', view: 'dir:约束', dir: '约束', dirScan: true, label: '约束', retired: true },
  // OS-86/100：扮演——推演全形态（叙事流/剧情树/Agent）同一壳，页签名「扮演」。
  { id: 'deduce', kind: 'fixed', core: true, view: 'deduce', ...tabNaming('roleplay'), icon: '扮', render: 'deduceHtml', panel: true, closable: true, scope: 'library' },
  // OS-32：设置是可关闭页签——跟正文/产物同级，打开才出现，× 关掉回到原页。
  { id: 'settings', kind: 'fixed', view: 'settings', ...tabNaming('settings'), icon: '设', render: 'settingsHtml', closable: true, scope: 'global',
    visibleWhen: (ctx) => Boolean(ctx.settingsOpen) },
  // ── 非页签路由（routeOnly）：只服务 go() 的作用域校验与 render() 的渲染分派。──
  { id: 'libraries', kind: 'fixed', view: 'libraries', concept: 'libraries', render: 'libraryHtml', routeOnly: true, scope: 'global' },
  { id: 'lib-create', kind: 'fixed', view: 'lib-create', render: 'createHtml', routeOnly: true, scope: 'flow' },
  { id: 'lib-import', kind: 'fixed', view: 'lib-import', render: 'importHtml', routeOnly: true, scope: 'flow' },
  { id: 'repair', kind: 'fixed', view: 'repair', render: 'repairHtml', routeOnly: true, scope: 'flow' }
])

/* ---------- 纯函数：页签推导（renderTabs 的旧算法语义，原样收敛在这里）---------- */

function listOf(value) {
  return Array.isArray(value) ? value : []
}

function orderIndexOf(dir) {
  const index = DIR_ORDER.indexOf(dir)
  return index === -1 ? 99 : index
}

/** OS-161：模块可见性。ctx 没给 modulesEnabled（undefined/null）＝全启用——
 *  旧快照与所有不带该字段的调用点一个字不改；给了就只认显式启用的模块（Set / 数组 / 对象）。 */
function moduleVisible(entry, modulesEnabled) {
  if (!entry.module) return true
  // OS-163：模块级 core:true 的页签恒在——即便 ctx 给了只含普通模块的显式启用集合也不裁掉。
  // 这里是注册表自持的标记（zero-import 约束不允许 import 后端 modules 协议）。
  if (entry.moduleCore === true) return true
  if (modulesEnabled === undefined || modulesEnabled === null) return true
  if (modulesEnabled instanceof Set) return modulesEnabled.has(entry.module)
  if (Array.isArray(modulesEnabled)) return modulesEnabled.includes(entry.module)
  return modulesEnabled[entry.module] === true
}

/** 体裁 excludedPages（页签名）→ 库内目录名集合（OS-19 页签裁剪）。 */
export function excludedDirSet(briefGenre) {
  return new Set(listOf(briefGenre?.excludedPages).map((page) => PAGE_TO_DIR_LOCAL[page] ?? page))
}

/**
 * 目录型页签组：磁盘目录 × 注册表词表 → 页签定义。
 * 旧算法语义逐条保留（OS-8/36/84/86/88/92）：
 *   ① 只认注册表里 dirScan 且未退场的条目（词表外目录不出页签——不凭空许诺工作面）；
 *   ② 体裁 excludedPages 裁掉的目录不出；
 *   ③ 按 DIR_ORDER 轨道稳定排序（轨道外一律 99，保持磁盘目录的原相对序）。
 */
export function dirTabDefs({ libDirs, excluded, registry = TAB_REGISTRY, modulesEnabled } = {}) {
  const byDir = new Map(listOf(registry)
    .filter((entry) => entry.dirScan && !entry.retired && entry.dir && moduleVisible(entry, modulesEnabled))
    .map((entry) => [entry.dir, entry]))
  return listOf(libDirs)
    .filter((dir) => !excluded.has(dir) && byDir.has(dir))
    .sort((left, right) => orderIndexOf(left) - orderIndexOf(right))
    .map((dir) => {
      const entry = byDir.get(dir)
      return {
        view: entry.view,
        label: entry.label,
        ic: entry.icon ?? entry.label.slice(0, 1),
        readonly: entry.readonly === true,
        closable: entry.closable !== false
      }
    })
}

/**
 * 页签栏全部候选（隐藏过滤之前）。
 * ctx：{ current, brief, briefGenre, libDirs, settingsOpen }；registry 缺省用 TAB_REGISTRY，
 * 传副本即可做扩展性试验（加一条→页签列表多一项，app.js 不用改）。
 */
export function computeTabDefs(ctx = {}, registry = TAB_REGISTRY) {
  const libDirs = listOf(ctx.libDirs)
  const excluded = excludedDirSet(ctx.briefGenre)
  const hasDir = (name) => libDirs.includes(name)
  // 目录型组：无库时不扫（旧算法整个扫描在 if (state.current) 里）
  const dirDefs = ctx.current ? dirTabDefs({ libDirs, excluded, registry, modulesEnabled: ctx.modulesEnabled }) : []
  const defs = []
  let dirPlaced = false
  for (const entry of listOf(registry)) {
    if (entry.retired) continue // OS-84/86：退场条目无条件过滤——任何输入下都不出页签
    if (!moduleVisible(entry, ctx.modulesEnabled)) continue // OS-161：所属模块停用＝页签消失
    if (entry.dirScan) {
      // 第一个 dirScan 条目的声明位＝目录型组的插入点（固定页签组之后、扮演之前）
      if (!dirPlaced) { defs.push(...dirDefs); dirPlaced = true }
      continue
    }
    if (entry.routeOnly || !entry.label) continue // 纯路由条目不进页签栏
    if (entry.scope === 'library' && !ctx.current) continue // 无库时不出库页签
    if (entry.visibleWhen && !entry.visibleWhen({ ...ctx, libDirs, hasDir, excluded, entry })) continue
    defs.push({
      view: entry.view,
      label: entry.label,
      ic: entry.icon ?? entry.label.slice(0, 1),
      readonly: entry.readonly === true,
      closable: entry.closable !== false
    })
  }
  return defs
}

/** 隐藏过滤（OS-36 的 × 只收页签不动磁盘；hidden＝页签名集合）。 */
export function visibleTabDefs(defs, hidden) {
  const hiddenSet = hidden instanceof Set ? hidden : new Set(listOf(hidden))
  return listOf(defs).filter((def) => !hiddenSet.has(def.view))
}

/* ---------- 纯函数：视图路由（go/render 的注册表驱动面）---------- */

export function registryEntry(view, registry = TAB_REGISTRY) {
  if (typeof view !== 'string') return null
  return listOf(registry).find((entry) => entry.view === view) ?? null
}

/**
 * 视图作用域：'library'（要先打开库）｜ 'global'（设置/库管理）｜ 'flow'（建库/导入流程）。
 * dir:xxx 视图一律按库页对待；未知视图返回 null（调用方按「需要库」处理——旧算法同语义）。
 */
export function viewScope(view, registry = TAB_REGISTRY) {
  if (typeof view === 'string' && view.startsWith('dir:')) return 'library'
  return registryEntry(view, registry)?.scope ?? null
}

/** 视图 → 渲染函数注册名（app.js 侧 VIEW_RENDERERS 持有本体；dir:xxx 统一走 dirViewHtml）。 */
export function renderNameForView(view, registry = TAB_REGISTRY) {
  if (typeof view === 'string' && view.startsWith('dir:')) return 'dirViewHtml'
  return registryEntry(view, registry)?.render ?? null
}

/* ---------- 纯函数：「＋增加页签」面板（OS-36）的注册表面 ---------- */

/** 目录 dir 的活条目（退场条目不算）；无条目＝词表外目录（作者自建的「分镜」等）。 */
export function dirTabEntry(dir, registry = TAB_REGISTRY) {
  return listOf(registry).find((entry) => entry.dir === dir && !entry.retired) ?? null
}

/** 目录 dir 在注册表里有活条目＝「已识别」（旧 DIR_LABELS＋DIR_TO_VIEW 词表检查的收敛）。 */
export function isKnownDir(dir, registry = TAB_REGISTRY) {
  return dirTabEntry(dir, registry) !== null
}

/** 「＋」面板里目录型页签的显示名（参考在页签栏叫「世界书」、面板里叫「参考」）。 */
export function dirPanelLabel(dir, registry = TAB_REGISTRY) {
  const entry = listOf(registry).find((item) => item.dir === dir && !item.retired)
  return entry?.panelLabel || entry?.label || dir
}

/** 面板「常用」区（OS-36）：产物/正文/扮演三个内置页签；need＝勾选要求的库内目录。 */
export function builtinPanelTabs(registry = TAB_REGISTRY) {
  return listOf(registry)
    .filter((entry) => entry.panel && !entry.retired)
    .map((entry) => ({ view: entry.view, label: entry.label, need: entry.dir ?? null }))
}

/**
 * OS-83：「可以新建的业务模块」清单——已识别（词表内）、DIR_ORDER 轨道上、磁盘还没有、未退场。
 * 以前面板只列磁盘已有的目录，「剧本」这种模块在小说库里整块消失——作者以为功能不存在。
 */
export function creatableDirNames(libDirs, registry = TAB_REGISTRY) {
  const onDisk = new Set(listOf(libDirs))
  return DIR_ORDER
    .filter((dir) => Boolean(DIR_LABELS[dir]))
    .filter((dir) => !onDisk.has(dir))
    .filter((dir) => !RETIRED_DIRS.includes(dir))
    .filter((dir) => dir !== '正文' && dir !== '世界书' && dir !== '拆解' && dir !== '人物' && dir !== '场景')
    .map((dir) => ({ dir, label: DIR_LABELS[dir] }))
}
