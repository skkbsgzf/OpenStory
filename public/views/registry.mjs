/**
 * 页签/路由注册表（OS-143 立表；OS-198 退为视图行为表）。
 *
 * OS-198 起「哪个工作面出现在哪里、什么顺序」只由 manifest 的 slots 决定：
 * 后端把当前库的 slot 投影（`/api/plugins.slots`）交给前端，页签栏/右栏/设置区/宿主动作
 * 一律照投影渲染。本文件只剩**视图行为**——页面 id → 渲染函数注册名、图标、可否关闭、
 * 作用域与可见条件；不再保存页签名、目录归属、模块归属或声明顺序。
 *
 * 宿主自己的路由（库管理、建库、导入、修复、设置）仍在本表登记，因为它们不是模块页面。
 *
 * 硬约束：
 *   · 纯数据＋纯函数：零 import、不碰 DOM、不读全局 state、不写任何存储；
 *   · 目录可见性由命名表派生（`namingEntry(...).dir`），不在条目上另存 `dir` 字段；
 *   · 投影拿不到＝页面如实显示「拿不到工作台清单」，绝不退回硬编码名单。
 *
 * 消费方：public/app.js（renderTabs/go/render/「＋」面板）、src/protocol/naming.mjs、
 * 验收门禁与测试。
 */

/* ---------- OS-148（G8a/G8d；OS-205 收口）：命名单一真源表 ----------

   同一个概念的「磁盘目录 / changelog 模块 / 契约域 / MCP 工具名」各有一个名字，
   表就是这四层的对照表——**这四层全仓只有这一份数据**：
   DIR_LABELS / DIR_ORDER / READONLY_DIRS / PAGE_TO_DIR_LOCAL 与视图行为表的可见条件
   全部由它派生；后端经 src/protocol/naming.mjs 取用（只 re-export，不复制一个字面量）。

   OS-205：模块显示名的权威只有 manifest 的 `name` 与 `pages[].label`，经 /api/plugins
   投影下发；本表**不再保存模块页签名**，避免第二份。tab/panelLabel 两列只留给
   宿主自有页面（settings）。三名一致改由门禁与测试拿 manifest 的显示名去对本表的
   dir 列与 logModule 列（对照真源换了，口径不变）。

   为什么表落在本文件而不是独立的 public/naming.mjs：注册表有「零 import」纯度门禁
   （test/tabRegistry.test.mjs 钉死，且 registry 是浏览器侧 leaf 模块），独立成文件就必须
   import，与门禁冲突；而注册表本来就是目录词表的唯一真源。

   列：
     id            概念 id（跨层稳定标识；视图行为条目用 id 与模块页面 id 对齐）
     dir           磁盘目录名（null＝没有对应目录）
     dirTab        该目录是否由页签条目的 dir 字段承载（缺省 true；false＝有目录但页签不按目录扫）
     tab           页签显示名（仅宿主自有页面用；模块页面取 manifest pages[].label；null＝没有页签）
     panelLabel    「＋增加页签」面板里的显示名（仅宿主自有页面用；null＝同 tab）
     dirLabel      DIR_LABELS 词表值（缺省＝dir；null＝不进 DIR_LABELS 词表）
     logModule     changelog 模块名（null＝不写变更日志）
     dirLogModule  按目录推断日志时的历史名（只给「目录名与模块名不一致」的既有实况留档，不迁移）
     contract      契约域文件名（src/api/contracts/<域>.mjs；null＝无独占端点）
     mcpPrefix     MCP 工具名前缀（null＝没有对外工具）
     note          一句实况说明（给人看，不参与任何判定）
   ------------------------------------------------------------------------ */

export const NAMING_TABLE = Object.freeze([
  { id: 'chapters', dir: '正文', logModule: '正文', contract: 'chapters', mcpPrefix: 'openstory_novel_',
    note: '章节正文；写盘走 /api/chapter（chapters 域）' },
  { id: 'worldbook', dir: '世界书', logModule: '世界书', contract: 'reference', mcpPrefix: 'openstory_reference_',
    note: '世界书显示名（manifest）、磁盘目录名与日志模块名一致' },
  { id: 'script', dir: '剧本', logModule: '剧本', contract: 'chapters',
    note: '剧本就是 剧本/NNN-标题.md，写盘与正文同走 chapters 域；无独占 MCP 工具' },
  { id: 'storysource', dir: '故事源', logModule: '故事源', contract: 'fact', mcpPrefix: 'openstory_fact_curve',
    note: '故事源显示名（manifest）、磁盘目录名与日志模块名一致' },
  // OS-86/100：扮演＝推演全形态同一壳；扮演/ 是会话与素材目录，页签不按目录扫描。
  { id: 'roleplay', dir: '扮演', dirTab: false, dirLabel: null, logModule: '扮演', contract: 'fact', mcpPrefix: 'openstory_deduce_',
    note: '目录只存会话/导出/素材，页签「扮演」由视图驱动' },
  // OS-59：习惯——规则类内容归 habits.json，专页承载。
  { id: 'habits', dir: '习惯', dirLabel: null, logModule: '习惯', contract: 'system', mcpPrefix: 'openstory_habits_' },
  // OS-89：日志只读页签；/api/log* 端点在 chapters 域。
  { id: 'log', dir: '日志', readonly: true, contract: 'chapters',
    note: '只读页签；日志由 changelog 写入，自身不再写变更日志' },
  // OS-12：产物（产出物＋多版本＋历史）。
  { id: 'artifacts', contract: 'system', note: '产物：/api/artifacts 盘点＋/api/chapter 预览与恢复' },
  // OS-32：设置页签（主题字号/模块开关/凭据入口）。
  { id: 'settings', tab: '设置', contract: 'system', note: '/api/config 与 /api/ui-state' },
  { id: 'uiState', logModule: '界面状态', contract: 'system', note: '库内界面状态 .openstory/ui-state.json（页签/模块开关/字号档）' },
  { id: 'libraryStorage', metadataDir: '.openstory', projectSpec: 'openstory-project@4', carrierPrefix: 'openstory.carrier.',
    wikiSchema: 'openstory-wiki-derived@2', tempPrefix: '.openstory-tmp-',
    note: '库标记与运行态的 OpenStory 自有谱系名；旧库由 libraryUpgrade 一次性迁移' },
  { id: 'libraries', contract: 'library', mcpPrefix: 'openstory_libraries', note: '库管理（顶栏入口，非页签）' },
  { id: 'exchange', dir: '导入导出', dirTab: false, dirLabel: null, logModule: '导入导出', contract: 'exchange', note: '顶栏导入导出入口与导出文件的落盘目录同名' },
  { id: 'libraryUpgrade', logModule: '库升级', note: '旧库一次性升级的结构变更日志' },
  { id: 'analysis', contract: null, mcpPrefix: 'openstory_analysis_chapter', note: '右栏分析卡片＋MCP 本地计算，不经 daemon 端点' },
  { id: 'enrich', logModule: '故事源', contract: 'fact', mcpPrefix: 'openstory_enrich_', note: '语义增补写旁挂 wiki，变更记在「故事源」日志' },
  { id: 'imagegen', contract: 'reference', mcpPrefix: 'openstory_image_generate', note: '生图与识图：生图落条目 assets/（/api/reference/image），识图 /api/vision/describe；vision 概念并入本节' },
  { id: 'knowledge', contract: 'system', note: '知识库三件套（/api/kb/*；端点与 MCP 名不动）' },
  { id: 'shelf', contract: 'plugins', mcpPrefix: 'openstory_skills_', note: '风格/技能/体裁/套件货架' },
  { id: 'agent', contract: 'agent', note: 'Agent 对话与待确认卡；MCP 不开 agent 对话（硬约束 5）' }
].map(namingRow))

/** 每行补齐七列主体列（缺省 null），列序固定——表要被测试与门禁逐列核对，不许有的行缺列。 */
function namingRow(raw) {
  const row = { id: raw.id }
  for (const key of ['dir', 'tab', 'panelLabel', 'logModule', 'dirLogModule', 'contract', 'mcpPrefix', 'metadataDir', 'projectSpec', 'carrierPrefix', 'wikiSchema', 'tempPrefix']) {
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
  if (view.startsWith('module:')) return ''
  const row = namingEntry(view) ?? namingEntry(registryEntry(view)?.id)
  return row?.logModule ?? ''
}

/** 概念 id → changelog 模块名表（后端写日志与前端检索共用，避免各抄一份字面量）。 */
export const LOG_MODULES = Object.freeze(Object.fromEntries(
  NAMING_TABLE.filter((row) => row.logModule).map((row) => [row.id, row.logModule])
))

/* ---------- 词表与退场表（由命名表逐键派生，唯一真源）---------- */

/** 一行的 DIR_LABELS 值：显式 dirLabel 优先，null＝不进词表，缺省＝目录名（OS-205：不再回落页签名）。 */
function dirLabelOf(row) {
  if (row.dirLabel === null) return null
  return row.dirLabel ?? row.dir ?? null
}

/**
 * 目录名 → 页签标签。
 * OS-88（作者裁定）：demo 只做三种载体——长篇、短篇、剧本。**只保留有真实实现的标签**，
 * 其余（素材/漫画/视频/体验/联机/文档/人物/场景/大纲/构思/资料/约束）一律不进词表：
 * 它们没有专属页面，点进去只是一个裸 textarea，等于凭空许诺。
 * 已实现的真实页面：正文 / 世界书 / 剧本 / 习惯 / 故事源 / 扮演 / 日志(只读)。
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

/** 页签名 → 库内目录名（体裁 excludedPages 裁剪用；只留真正有 view 的映射）。
 * OS-190a：正名键用页面 id（chapters/worldbook/script）；write/entries 只作旧体裁包的输入别名。 */
export const PAGE_TO_DIR_LOCAL = Object.freeze({
  chapters: namingEntry('chapters')?.dir,
  write: namingEntry('chapters')?.dir,
  worldbook: namingEntry('worldbook')?.dir,
  entries: namingEntry('worldbook')?.dir,
  script: namingEntry('script')?.dir
})

/**
 * 默认收起种子（OS-48）：大纲/构思/资料/约束的定位已被「世界书」覆盖。
 * OS-198 起页签只来自投影，退场目录不再有投影页；此表保留为旧库 ui-state 的一次性输入。
 */
export const DEFAULT_HIDDEN_TABS = Object.freeze(['dir:大纲', 'dir:构思', 'dir:资料', 'dir:约束'])

/** OS-84：已退场的旧目录（历史留档；新页签不再由目录扫描产生）。 */
export const RETIRED_DIRS = Object.freeze(['大纲', '构思', '资料', '约束'])

/* ---------- 视图行为表（OS-198）---------- */

/** 目录可见性从命名表取，不在条目上另存 `dir` 字段。 */
function inDir(concept, ctx) {
  const dir = namingEntry(concept)?.dir
  if (!dir) return false
  if (typeof ctx.hasDir !== 'function' || !ctx.hasDir(dir)) return false
  return !ctx.excluded?.has(dir)
}

const behavior = (entry) => Object.freeze(entry)

/**
 * 页面 id → 视图行为。这里没有页签名、目录归属、模块归属与顺序：
 *   id          模块 manifest 的 pages[].id（宿主路由条目用自身路由 id）
 *   view        前端路由键（目录型仍是 dir:目录；模块页面用页面 id）
 *   render      渲染函数注册名（app.js 的 VIEW_RENDERERS 持有本体）
 *   icon        页签图标字
 *   closable    作者能否用 × 收起（目录/模块页签，不动磁盘）
 *   readonly    只读页签（日志）
 *   scope       go() 作用域：library / global / flow
 *   panel       「＋」面板的常用区
 *   host        宿主自有页签（设置）；不来自模块投影
 *   slotOnly    只为投影三态判定登记的页面（右栏/设置区/宿主动作），不进页签栏
 *   visibleWhen(ctx) 纯函数可见性（目录存在、体裁裁剪、设置是否打开）
 */
export const TAB_REGISTRY = Object.freeze([
  behavior({ id: 'artifacts', view: 'artifacts', render: 'artifactsHtml', icon: '产', core: true, closable: true, scope: 'library', panel: true }),
  behavior({ id: 'chapters', view: 'chapters', render: 'writeHtml', icon: '章', core: true, closable: true, scope: 'library', panel: true,
    visibleWhen: (ctx) => !ctx.brief || inDir('chapters', ctx) }),
  behavior({ id: 'worldbook', view: 'worldbook', render: 'referencePageHtml', icon: '世', core: true, closable: true, scope: 'library',
    visibleWhen: (ctx) => inDir('worldbook', ctx) }),
  behavior({ id: 'script', view: `dir:${namingEntry('script').dir}`, render: 'dirViewHtml', icon: '剧', core: true, closable: true, scope: 'library',
    visibleWhen: (ctx) => inDir('script', ctx) }),
  behavior({ id: 'storysource', view: `dir:${namingEntry('storysource').dir}`, render: 'dirViewHtml', icon: '故', core: true, closable: true, scope: 'library',
    visibleWhen: (ctx) => inDir('storysource', ctx) }),
  behavior({ id: 'habits', view: 'habits', render: 'habitsViewHtml', icon: '习', closable: true, scope: 'library',
    visibleWhen: (ctx) => inDir('habits', ctx) }),
  behavior({ id: 'log', view: `dir:${namingEntry('log').dir}`, render: 'dirViewHtml', icon: '日', readonly: true, closable: true, scope: 'library',
    visibleWhen: (ctx) => inDir('log', ctx) }),
  behavior({ id: 'roleplay', view: 'roleplay', render: 'deduceHtml', icon: '扮', core: true, closable: true, scope: 'library', panel: true }),
  // 设置是宿主自有可关闭页签；不来自模块投影，固定排在模块页签之后。
  behavior({ id: 'settings', view: 'settings', render: 'settingsHtml', icon: '设', host: true, closable: true, scope: 'global',
    visibleWhen: (ctx) => Boolean(ctx.settingsOpen) }),
  // 只为 slot 投影三态判定登记的页面（不进页签栏）。
  behavior({ id: 'analysis', view: 'analysis', slotOnly: 'right' }),
  behavior({ id: 'imagegen', view: 'imagegen', slotOnly: 'settings' }),
  behavior({ id: 'knowledge', view: 'knowledge', slotOnly: 'settings' }),
  behavior({ id: 'exchange', view: 'exchange', slotOnly: 'host-actions' }),
  // 宿主路由（不进页签栏，只服务 go() 的作用域校验与 render() 分派）。
  behavior({ id: 'libraries', view: 'libraries', render: 'libraryHtml', routeOnly: true, scope: 'global' }),
  behavior({ id: 'lib-create', view: 'lib-create', render: 'createHtml', routeOnly: true, scope: 'flow' }),
  behavior({ id: 'lib-import', view: 'lib-import', render: 'importHtml', routeOnly: true, scope: 'flow' }),
  behavior({ id: 'repair', view: 'repair', render: 'repairHtml', routeOnly: true, scope: 'flow' })
])

/** 前端有内置视图的页面 id 集合（OS-198 投影三态 `builtin` 的唯一真源，后端经 naming 取用）。 */
export const BUILTIN_PAGE_IDS = Object.freeze(TAB_REGISTRY.map((entry) => entry.id))

/* ---------- 纯函数：投影 → 页签 ---------- */

function listOf(value) {
  return Array.isArray(value) ? value : []
}
const objOf = (value) => value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
const strOf = (value) => String(value ?? '')

/** 体裁 excludedPages（页签名）→ 库内目录名集合（OS-19 页签裁剪）。 */
export function excludedDirSet(briefGenre) {
  return new Set(listOf(briefGenre?.excludedPages).map((page) => PAGE_TO_DIR_LOCAL[page] ?? page))
}

/** 模块页面路由键：`module:<模块 id>/<页面 id>`。 */
export function moduleView(module, page) {
  return `module:${String(module ?? '').trim()}/${String(page ?? '').trim()}`
}

/** 拆模块页面路由键；不是模块页面＝null。 */
export function parseModuleView(view) {
  if (typeof view !== 'string' || !view.startsWith('module:')) return null
  const [module, page, ...rest] = view.slice(7).split('/')
  if (!module || !page || rest.length) return null
  return { module, page }
}

function tabContext(ctx = {}) {
  const libDirs = listOf(ctx.libDirs)
  return {
    ...ctx,
    libDirs,
    hasDir: (name) => libDirs.includes(name),
    excluded: excludedDirSet(ctx.briefGenre)
  }
}

/**
 * OS-198：照 `/api/plugins.slots.tab` 投影生成页签定义。
 * - 顺序＝投影顺序；内置视图优先于同 id 的 iframe 页面。
 * - `view:'none'` 且前端没有内置视图＝跳过（后端已记启动告警）。
 * - 投影为空对象/缺 tab＝只留宿主设置页；调用方负责把「拿不到投影」与「投影真为空」分开显示。
 */
export function projectedTabDefs({ slots = {}, ctx = {}, registry = TAB_REGISTRY } = {}) {
  const context = tabContext(ctx)
  const byId = new Map(listOf(registry).map((entry) => [entry.id, entry]))
  const defs = []
  for (const placement of listOf(slots?.tab)) {
    const entry = byId.get(placement?.page)
    const iframe = !entry && placement?.view === 'iframe' && placement?.module && placement?.entry
    if (!entry && !iframe) continue
    if (!context.current && (entry?.scope === 'library' || iframe)) continue
    if (entry?.visibleWhen && !entry.visibleWhen(context)) continue
    if (iframe) {
      defs.push({
        view: moduleView(placement.module, placement.page),
        label: placement.label || placement.page,
        ic: (placement.label || placement.page).slice(0, 1),
        closable: true,
        iframe: { module: placement.module, page: placement.page, entry: placement.entry },
        ...(placement.degraded === true ? { degraded: true, missing: listOf(placement.missing) } : {})
      })
      continue
    }
    if (entry.host || entry.slotOnly || entry.routeOnly) continue
    defs.push({
      view: entry.view ?? entry.id,
      label: placement.label || entry.id,
      ic: entry.icon ?? (placement.label || entry.id).slice(0, 1),
      readonly: entry.readonly === true,
      closable: entry.closable !== false,
      ...(placement.degraded === true ? { degraded: true, missing: listOf(placement.missing) } : {})
    })
  }
  const settings = byId.get('settings')
  if (settings?.visibleWhen?.(context)) {
    defs.push({ view: settings.view, label: namingEntry('settings')?.tab ?? '设置', ic: settings.icon, closable: settings.closable !== false })
  }
  return defs
}

/** 隐藏过滤（OS-36 的 × 只收页签不动磁盘；hidden＝视图键集合）。 */
export function visibleTabDefs(defs, hidden) {
  const hiddenSet = hidden instanceof Set ? hidden : new Set(listOf(hidden))
  return listOf(defs).filter((def) => !hiddenSet.has(def.view))
}

/**
 * OS-203：某页面在某 slot 的三态（在不在投影里／是否降级／缺什么）。
 * 停用＝present:false；降级＝present:true＋degraded:true＋missing 数组；健康＝只有 present:true。
 */
export function slotState(slots, slot, page) {
  const items = listOf(slots?.[slot]).filter((item) => objOf(item).page === page)
  const hit = items.find((item) => item.degraded === true) ?? items[0] ?? null
  return {
    present: Boolean(hit),
    degraded: Boolean(hit && hit.degraded === true),
    missing: hit && hit.degraded === true ? listOf(hit.missing) : []
  }
}

/**
 * OS-203a：入口三态属性纯函数。app.js 的 slotAction 只做接线，判定与属性全在这里。
 * 停用（不在投影里）→ hidden；降级（在投影里且 degraded）→ 可见＋原生 disabled＋
 * aria-disabled＋统一 title（文案由调用方注入 missingText）；健康 → 只带 title。
 */
export function slotActionAttrs(state, title = '', options = {}) {
  if (!state || state.present !== true) return ' hidden'
  const opts = objOf(options)
  const esc = typeof opts.esc === 'function' ? opts.esc : strOf
  if (state.degraded === true) {
    const fallback = `缺少所需能力：${listOf(state.missing).map((entry) => strOf(objOf(entry).capability ?? entry)).join('、')}`
    const message = typeof opts.missingText === 'function' ? opts.missingText(state.missing) : fallback
    return ` data-degraded="1" disabled aria-disabled="true" title="${esc(message || title)}"`
  }
  return ` title="${esc(title)}"`
}

/**
 * OS-203：页签按钮 HTML 纯函数（renderTabs 调它，app.js 不再拼页签字符串）。
 * 降级项带 tab-degraded／aria-disabled／title（文案由调用方注入 missingText，registry 不 import）。
 */
export function tabButtonHtml(def, options = {}) {
  const opts = objOf(options)
  const esc = typeof opts.esc === 'function' ? opts.esc : strOf
  const item = objOf(def)
  const degraded = item.degraded === true
  const classes = ['tab', ...(opts.active === true ? ['on'] : []), ...(degraded ? ['tab-degraded'] : [])]
  const fallback = `缺少所需能力：${listOf(item.missing).map((entry) => strOf(objOf(entry).capability ?? entry)).join('、')}`
  const title = degraded ? (typeof opts.missingText === 'function' ? opts.missingText(item.missing, item.requires) : fallback) : ''
  const close = item.closable !== false
    ? `<span class="tab-x" data-action="${item.view === 'settings' ? 'settings-close' : 'tab-hide'}" data-tab-view="${esc(item.view)}" title="收起这个页签（不动磁盘上的东西）">×</span>`
    : ''
  return `<button class="${classes.join(' ')}" data-view="${esc(item.view)}"${degraded ? ' aria-disabled="true"' : ''}${title ? ` title="${esc(title)}"` : ''}><span class="ic">${esc(item.ic)}</span>${esc(item.label)}${item.readonly === true ? '<span class="pill">只读</span>' : ''}${close}</button>`
}

/** 投影里的模块页面条目（iframe 用），找不到＝null。 */
export function modulePagePlacement(view, slots = {}) {
  const wanted = parseModuleView(view)
  if (!wanted) return null
  for (const items of Object.values(slots ?? {})) {
    for (const item of listOf(items)) {
      if (item.module === wanted.module && item.page === wanted.page && item.view === 'iframe' && item.entry) return item
    }
  }
  return null
}

/** 视图是否合法：内置行为表命中，或投影里有同名模块页面。 */
export function viewKnown(view, slots = {}, registry = TAB_REGISTRY) {
  return Boolean(registryEntry(view, registry) || modulePagePlacement(view, slots))
}

/* ---------- 纯函数：视图路由 ---------- */

export function registryEntry(view, registry = TAB_REGISTRY) {
  if (typeof view !== 'string') return null
  return listOf(registry).find((entry) => entry.view === view || entry.id === view) ?? null
}

/**
 * 视图作用域：'library'（要先打开库）｜ 'global'（设置/库管理）｜ 'flow'（建库/导入流程）。
 * dir:xxx 与 module:… 一律按库页对待；未知视图返回 null（调用方按「需要库」处理）。
 */
export function viewScope(view, registry = TAB_REGISTRY) {
  if (typeof view === 'string' && (view.startsWith('dir:') || view.startsWith('module:'))) return 'library'
  return registryEntry(view, registry)?.scope ?? null
}

/** 视图 → 渲染函数注册名（模块页面统一走通用 iframe 视图）。 */
export function renderNameForView(view, registry = TAB_REGISTRY) {
  if (typeof view === 'string' && view.startsWith('dir:')) return 'dirViewHtml'
  if (typeof view === 'string' && view.startsWith('module:')) return 'modulePageHtml'
  return registryEntry(view, registry)?.render ?? null
}

/* ---------- 纯函数：「＋增加页签」面板（OS-36/OS-198）---------- */

/**
 * 「＋」面板的可勾选项：投影里**所有可关闭页签**（含第三方 iframe 页），顺序照投影。
 * OS-198a：从 projectedTabDefs 派生，面板与页签栏共用同一份投影名单，不再各列一套；
 * 宿主自有页签（设置）不进面板；收起后再勾即按投影原位回到页签栏。
 */
export function projectedPanelTabs(slots = {}, registry = TAB_REGISTRY, ctx = {}) {
  const hostViews = new Set(listOf(registry)
    .filter((entry) => entry.host || entry.slotOnly || entry.routeOnly)
    .map((entry) => entry.view ?? entry.id))
  const byView = new Map(listOf(registry).map((entry) => [entry.view ?? entry.id, entry]))
  return projectedTabDefs({ slots, ctx, registry })
    .filter((def) => def.closable !== false && !hostViews.has(def.view))
    .map((def) => ({
      view: def.view,
      label: def.label,
      panel: byView.get(def.view)?.panel === true,
      ...(def.iframe ? { iframe: def.iframe } : {}),
      ...(def.degraded === true ? { degraded: true, missing: def.missing } : {})
    }))
}

/** OS-198a：已退场目录名是死种子——旧库 tabHidden 读时忽略，写时不再追加。 */
export function sanitizeHiddenTabs(saved) {
  const dead = new Set(DEFAULT_HIDDEN_TABS)
  return listOf(saved).filter((view) => !dead.has(view))
}

/** 已识别但库里还没有的业务目录（OS-83）——清单只由命名表与 DIR_ORDER 给。 */
export function creatableDirNames(libDirs, registry = TAB_REGISTRY) {
  const onDisk = new Set(listOf(libDirs))
  const pages = new Set(listOf(registry).map((entry) => entry.id))
  return DIR_ORDER
    .filter((dir) => Boolean(DIR_LABELS[dir]))
    .filter((dir) => !onDisk.has(dir))
    .filter((dir) => !RETIRED_DIRS.includes(dir))
    .filter((dir) => !['chapters', 'worldbook', 'storysource'].includes(namingEntryForDir(dir)?.id))
    .filter((dir) => pages.has(namingEntryForDir(dir)?.id))
    .map((dir) => ({ dir, label: DIR_LABELS[dir] }))
}