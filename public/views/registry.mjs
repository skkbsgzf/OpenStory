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

/* ---------- 词表与退场表（自 app.js 原样迁入，唯一真源）---------- */

/**
 * 目录名 → 页签标签。
 * OS-88（作者裁定）：demo 只做三种载体——长篇、短篇、剧本。**只保留有真实实现的标签**，
 * 其余（素材/漫画/视频/体验/联机/文档/人物/场景/大纲/构思/资料/约束）一律不进词表：
 * 它们没有专属页面，点进去只是一个裸 textarea，等于凭空许诺。
 * 已实现的真实页面：正文 / 世界书(参考载体) / 剧本 / 习惯 / 故事源(拆解) / 推演 / 日志(只读)。
 */
export const DIR_LABELS = Object.freeze({
  正文: '正文',
  世界书: '世界书',
  剧本: '剧本',
  日志: '日志',
  // S2：拆解目录承载故事源（Fact 链可视化）——目录名不动，页签改叫故事源
  拆解: '故事源'
})

/** 目录型页签的排序轨道（OS-8）；不在轨道上的目录排在其后（按磁盘目录序稳定展开）。 */
export const DIR_ORDER = Object.freeze(['正文', '世界书', '剧本', '日志'])

/** 只读目录（页签挂「只读」牌，工作面禁编辑）。 */
export const READONLY_DIRS = new Set(['日志'])

/** 页签名 → 库内目录名（体裁 excludedPages 裁剪用；只留真正有 view 的映射）。 */
export const PAGE_TO_DIR_LOCAL = Object.freeze({ write: '正文', entries: '世界书', worldbook: '世界书', script: '剧本' })

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

export const TAB_REGISTRY = Object.freeze([
  // OS-12：页签首格固定＝产物中心（产出物＋多版本＋历史）；「库」上移顶栏。
  { id: 'artifacts', kind: 'fixed', core: true, view: 'artifacts', label: '产物', icon: '产', render: 'artifactsHtml', panel: true, closable: true, scope: 'library' },
  // OS-19：正文走 libDirs 判断——体裁声明后（如短故事）没有 正文/ 目录就不出。
  { id: 'write', kind: 'fixed', core: true, view: 'write', dir: '正文', label: '正文', icon: '章', render: 'writeHtml', panel: true, closable: true, scope: 'library',
    visibleWhen: (ctx) => !ctx.brief || ctx.hasDir('正文') },
  // 目录型组插入点：从这里到下一个非 dirScan 条目之间，全部按「磁盘目录 × 词表」扫描物化。
  // OS-44：参考目录走专门的笔记系统页，页签名「世界书」；「＋」面板里仍叫「参考」。
  { id: 'reference', kind: 'fixed', core: true, view: 'reference', dir: '参考', dirScan: true, label: '世界书', icon: '世', panelLabel: '参考', render: 'referencePageHtml', closable: true, scope: 'library' },
  // OS-75：剧本页 fork 正文页（dir:剧本 视图，剧本版式渲染）。
  { id: 'script', kind: 'fixed', core: true, view: 'dir:剧本', dir: '剧本', dirScan: true, label: '剧本', icon: '剧', render: 'dirViewHtml', closable: true, scope: 'library' },
  // OS-48：拆解目录承载故事源（fact 链可视化）——目录名不动，页签改叫故事源。
  { id: 'storySource', kind: 'fixed', core: true, view: 'dir:拆解', dir: '拆解', dirScan: true, label: '故事源', icon: '故', render: 'dirViewHtml', closable: true, scope: 'library' },
  // OS-59：习惯——规则类内容归 habits.json，专页承载。
  { id: 'habits', kind: 'dir', view: 'habits', dir: '习惯', dirScan: true, label: '习惯', icon: '习', panelLabel: '习惯', render: 'habitsViewHtml', closable: true, scope: 'library' },
  // OS-89：日志只读页签（模块修改痕迹的自检索载体）。
  { id: 'log', kind: 'dir', view: 'dir:日志', dir: '日志', dirScan: true, label: '日志', icon: '日', readonly: true, render: 'dirViewHtml', closable: true, scope: 'library' },
  // ── 已退场目录（OS-84/86，作者裁定）：注册表里留档＋无条件过滤，双保险。──
  // OS-86：已退场的旧目录彻底不出现——不管磁盘上还在不在、有多少篇。
  // 作者口径：没被官方认证的标签就是要消失，不做「旧·待迁」降级露出；
  // 内容清理走一次性迁移（大纲/构思/资料→参考，约束→习惯＋参考存档）。
  { id: 'retired-outline', kind: 'dir', view: 'dir:大纲', dir: '大纲', dirScan: true, label: '大纲', retired: true },
  { id: 'retired-brainstorm', kind: 'dir', view: 'dir:构思', dir: '构思', dirScan: true, label: '构思', retired: true },
  { id: 'retired-material', kind: 'dir', view: 'dir:资料', dir: '资料', dirScan: true, label: '资料', retired: true },
  { id: 'retired-constraint', kind: 'dir', view: 'dir:约束', dir: '约束', dirScan: true, label: '约束', retired: true },
  // OS-86/100：扮演——推演全形态（叙事流/剧情树/Agent）同一壳，页签名「扮演」。
  { id: 'deduce', kind: 'fixed', core: true, view: 'deduce', label: '扮演', icon: '扮', render: 'deduceHtml', panel: true, closable: true, scope: 'library' },
  // OS-32：设置是可关闭页签——跟正文/产物同级，打开才出现，× 关掉回到原页。
  { id: 'settings', kind: 'fixed', view: 'settings', label: '设置', icon: '设', render: 'settingsHtml', closable: true, scope: 'global',
    visibleWhen: (ctx) => Boolean(ctx.settingsOpen) },
  // ── 非页签路由（routeOnly）：只服务 go() 的作用域校验与 render() 的渲染分派。──
  { id: 'libraries', kind: 'fixed', view: 'libraries', render: 'libraryHtml', routeOnly: true, scope: 'global' },
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
export function dirTabDefs({ libDirs, excluded, registry = TAB_REGISTRY } = {}) {
  const byDir = new Map(listOf(registry)
    .filter((entry) => entry.dirScan && !entry.retired && entry.dir)
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
  const dirDefs = ctx.current ? dirTabDefs({ libDirs, excluded, registry }) : []
  const defs = []
  let dirPlaced = false
  for (const entry of listOf(registry)) {
    if (entry.retired) continue // OS-84/86：退场条目无条件过滤——任何输入下都不出页签
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
