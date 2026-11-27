/**
 * OpenStory 工作台数据与路由（OS-3 ＋ OS-4）。
 *
 * 全部数据来自本机 daemon（127.0.0.1）：
 *   GET  /api/libraries → 库卡
 *   （OS-54：条目/wiki 视图端点已剔除——fact 数据由扮演/曲线/图谱通道消费）
 *   GET/PUT /api/chapter→ 正文读/写（PUT 同目录 .history 备份）
 *   GET/PUT /api/agent/config            → 模型端点（key 只存 daemon 本机，这里只拿到掩码）
 *   GET/POST /api/agent/sessions…        → 会话（JSONL 在 daemon 侧）
 *   POST /api/agent/chat                 → 流式对话（SSE：start → delta* → done/error）
 *   POST /api/agent/cards[/adopt|/reject]→ 待确认卡（采纳走正文快照闸）
 *
 * v1 边界：Agent 无工具循环（读不到库文件）；正文保存不做跨进程 revision 闸（.history 粗保护）。
 * 这里不内置任何演示数据——读不到就摆空态，不拿假卡片冒充库。
 */

/* OS-113 嵌入模式：DSH 右侧栏的 iframe 里，宿主左侧已经有真正的 DSH 会话。
   这里收掉 OpenStory 自带的 Agent 栏左列（index.html 的 html.os-embed 规则），
   工作台拿回全部宽度；独立打开时行为不变。纯渲染分支，不写库内/浏览器状态。 */
const embeddedView = (() => {
  try {
    return new URLSearchParams(location.search).get('embed') === '1' || window.self !== window.top
  } catch {
    return false
  }
})()
if (embeddedView) document.documentElement.classList.add('os-embed')

/* OS-115 嵌入模式的 Agent 桥：面板 iframe 只是 UI，真正的 Agent 是左侧的 DSH 会话。
   选段的「添加到 Agent / 润笔 / 发给 Agent」在嵌入时 postMessage 给宿主插件
   （tools/dsh-openstory-studio），由它调 DSH 的 inputActions.insertQuote 放进
   **DSH 当前会话的输入框**（引用块）；独立打开时照旧走 OpenStory 自己的 Agent。 */
let dshBridgeSeq = 0
function dshBridgeAvailable() {
  try {
    return embeddedView && window.parent && window.parent !== window
  } catch {
    return false
  }
}

function sendToDshAgent({ quote, hint = '' } = {}) {
  return new Promise((resolve) => {
    const quoteText = String(quote || '').trim()
    if (!quoteText) { resolve({ ok: false, message: '没有选中的内容' }); return }
    if (!dshBridgeAvailable()) { resolve({ ok: false, message: '不在 DSH 面板里' }); return }
    const requestId = `os-${Date.now().toString(36)}-${++dshBridgeSeq}`
    let settled = false
    let timer = null
    const finish = (result) => {
      if (settled) return
      settled = true
      window.removeEventListener('message', onAck)
      if (timer) clearTimeout(timer)
      resolve(result)
    }
    const onAck = (event) => {
      if (event.source !== window.parent) return
      const data = event.data
      if (!data || data.type !== 'openstory/add-to-agent/ack' || data.requestId !== requestId) return
      finish({ ok: data.ok === true, message: text(data.message) })
    }
    window.addEventListener('message', onAck)
    timer = setTimeout(() => finish({ ok: false, message: 'DSH 插件没响应（超时）' }), 2500)
    try {
      window.parent.postMessage({ type: 'openstory/add-to-agent', requestId, quote: quoteText, hint: String(hint || '') }, '*')
    } catch (error) {
      finish({ ok: false, message: `发不出去：${(error && error.message) || error}` })
    }
  })
}

/** 嵌入模式下把「送给 Agent」的结果如实告诉作者；成功不打扰（DSH 输入框里已经能看到引用块）。 */
function reportDshBridge(result) {
  const failed = !result.ok
  if (failed) {
    state.error = `没能添加到 DSH：${result.message || '未知原因'}`
    render()
    return
  }
  if (text(state.error).startsWith('没能添加到 DSH')) {
    state.error = ''
    render()
  }
}

/**
 * 嵌入模式：给 DSH 会话带一行来源（库/章节文件/段号/root）。
 * DSH 会话里挂了 OpenStory 的 MCP（openstory_* 24 工具），模型靠这行知道
 * 该用哪个 root / 哪个文件去读全文、以及能不能写回；否则只能拿这段引用空写。
 */
function openStorySourceNote(kind = 'chapter') {
  const root = text(state.current?.path)
  const name = text(state.current?.name)
  if (kind === 'worldbook') {
    const title = text(state.reference?.note?.title)
    return `〔来源：OpenStory 世界书${title ? `《${title}》` : ''}${root ? ` · root=${root}` : ''} · 可用 openstory_* 工具读写〕 `
  }
  const file = text(state.chapterFile)
  const index = Number(state.sel?.blockIndex)
  const para = Number.isFinite(index) && index >= 0 ? `第 ${index + 1} 段` : ''
  const parts = [
    '来源：OpenStory',
    name ? `《${name}》` : '',
    file ? `正文 ${file}` : '正文',
    para,
    root ? `root=${root}` : '',
    '可用 openstory_* 工具读写'
  ].filter(Boolean)
  return `〔${parts.join(' · ')}〕 `
}

/* OS-92：UI 套件（标签编辑器/表单/卡片/表格…）——三方开发者写页面统一用它 */
let uiKit = {
  chipField: () => '', chipChip: () => '', field: () => '', textInput: () => '',
  select: () => '', toolbar: () => '', card: () => '', emptyState: () => '',
  kvTable: () => '', buttonGroup: () => ''
}
const uiKitReady = import('./ui-kit.mjs').then((mod) => { uiKit = mod; return mod }).catch(() => {})

/* ---------- OS-143：页签/路由声明式注册表（public/views/registry.mjs）----------
   app.js 是经典脚本（index.html 非 module 加载），只能动态 import 注册表；
   boot() 首帧前 await 它，此后 renderTabs/go/openTabAdd/视图分派全部由注册表驱动。
   词表与退场表（DIR_LABELS/DIR_ORDER/READONLY_DIRS/PAGE_TO_DIR_LOCAL/
   RETIRED_DIRS）唯一真源在注册表，这里只留引用壳。
   增量冻结（OS-143）：本文件此后只许减不许增（修 bug 除外），视图渲染函数只出不进。 */
let registryModule = null
/* 注册表词表/退场表的引用壳（真源在 registry.mjs；赋值见上方 registryReady 回调） */
let DIR_LABELS = {}
let DIR_ORDER = []
let READONLY_DIRS = new Set()
let PAGE_TO_DIR_LOCAL = {}
let RETIRED_DIRS = []
const registryReady = import('./views/registry.mjs').then((mod) => {
  registryModule = mod
  DIR_LABELS = mod.DIR_LABELS
  DIR_ORDER = mod.DIR_ORDER
  READONLY_DIRS = mod.READONLY_DIRS
  PAGE_TO_DIR_LOCAL = mod.PAGE_TO_DIR_LOCAL
  RETIRED_DIRS = mod.RETIRED_DIRS
  return mod
}).catch((error) => { console.error('[registry] 页签注册表加载失败', error); return null })

/* ---------- OS-145：设置归一（public/views/settingsAggregation.mjs）----------
   聚合纯函数＋模块设置组渲染都在这张表里；app.js 只负责取数、调用、分发事件。
   动态 import 与上面注册表同门风（app.js 是经典脚本，不能静态 import）。 */
let settingsAggregation = null
const settingsAggregationReady = import('./views/settingsAggregation.mjs').then((mod) => {
  settingsAggregation = mod
  return mod
}).catch((error) => { console.error('[settings] 设置聚合模块加载失败', error); return null })
/* OS-161：工作面纯视图（views/workbenchViews.mjs）——habits/artifacts/故事源的纯 HTML 构造函数住这里 */
let workbenchViews = null
const workbenchViewsReady = import('./views/workbenchViews.mjs').then((mod) => { workbenchViews = mod; return mod })
  .catch((error) => { console.error('[views] 工作面视图模块加载失败', error); return null })
/* OS-163：剧本纯视图（views/scriptViews.mjs）——剧本页/人物卡/块转源码的设置项规范化住这里 */
let scriptViews = null
const scriptViewsReady = import('./views/scriptViews.mjs').then((mod) => { scriptViews = mod; return mod })
  .catch((error) => { console.error('[views] 剧本视图模块加载失败', error); return null })
/* OS-164：世界书纯视图（views/referenceViews.mjs）——词条详情/编辑器/图谱/左栏模块的 HTML 构造住这里 */
let referenceViews = null
const referenceViewsReady = import('./views/referenceViews.mjs').then((mod) => { referenceViews = mod; return mod })
  .catch((error) => { console.error('[views] 世界书视图模块加载失败', error); return null })
let knowledgeBaseViews = null, knowledgeBaseController = null
const knowledgeBaseViewsReady = import('./views/knowledgeBaseViews.mjs').then((mod) => { knowledgeBaseViews = mod; return mod }).catch(() => null)
const knowledgeBaseControllerReady = import('./views/knowledgeBaseController.mjs').then((mod) => { knowledgeBaseController = mod.createKnowledgeBaseController({ state, api, render, esc, text, go, knowledgeBaseViews: () => knowledgeBaseViews }); return mod }).catch(() => null)
/* OS-164：扮演纯视图（views/deduceViews.mjs）——扮演/叙事流的纯 HTML 构造住这里；状态机与打字机留本文件 */
let deduceViews = null
const deduceViewsReady = import('./views/deduceViews.mjs').then((mod) => { deduceViews = mod; return mod })
  .catch((error) => { console.error('[views] 扮演视图模块加载失败', error); return null })
/* OS-161：前端模块 id 清单已退役（OS-198）——页签/右栏/设置只照 `/api/plugins.slots` 投影渲染。 */

/* OS-198：本机模块 iframe 页面（views/modulePageViews.mjs）——app.js 只接线。 */
let modulePageViews = null
const modulePageViewsReady = import('./views/modulePageViews.mjs').then((mod) => { modulePageViews = mod; return mod })
  .catch((error) => { console.error('[module-page] 模块页面视图加载失败', error); return null })

/* OS-149：运行时货架过滤（views/runtimeShelf.mjs）——fixture 套件不进作者可见列表；纯函数在 views/，这里只接线 */
let runtimeShelf = null
const runtimeShelfReady = import('./views/runtimeShelf.mjs').then((mod) => { runtimeShelf = mod; return mod }).catch((error) => { console.error('[runtimes] 运行时货架模块加载失败', error); return null })
/* OS-192：五类货架统一设置面（views/suiteShelfViews.mjs）——app.js 只接线，不持渲染本体 */
let suiteShelfViews = null
const suiteShelfViewsReady = import('./views/suiteShelfViews.mjs').then((mod) => {
  suiteShelfViews = mod.createSuiteShelfViews({ state, esc, text, isDarkSurface })
  return mod
}).catch((error) => { console.error('[shelves] 统一货架视图加载失败', error); return null })


/* C6：前端壳渲染面迁出——行为/API/事件仍留本文件，boot 首帧前await全部factory */
let settingsViews = null
const settingsViewsReady = import('./views/settingsViews.mjs').then((mod) => { settingsViews = mod.createSettingsViews({ state, agent, esc, text, uiKit: () => uiKit, runtimeShelf: () => runtimeShelf, moduleOn, hiddenModules, WORKBENCH_MODULES, scriptPrefs, dirWork, castColorOf, settingsScriptSectionHtml, settingRuntimeKind, probeBadgeLabel, comfyNodeMapText, typographyState, docPrefSlidersHtml, syncPolicy, syncProblemsFrom, warningsHtml, uiMemory, settingsAggregation: () => settingsAggregation, suitesSectionHtml, pluginsOverviewHtml, errorHtml, api, render, loadPlugins, governanceHtml, moduleCard: (id) => governanceViews?.moduleCard?.(id), missingText: (...args) => governanceViews?.missingText?.(...args) }); return settingsViews })
let analysisViews = null
const analysisViewsReady = import('./views/analysisViews.mjs').then((mod) => { analysisViews = mod.createAnalysisViews({ state, esc, hiddenModules, chapterNoFromFile, analyzeEnabled, analyzeModulesFor, analyzeModuleById, chartsModule: () => chartsModule, analysisModules: () => analysisModules, moduleCard: (id) => governanceViews?.moduleCard?.(id), missingText: (...args) => governanceViews?.missingText?.(...args) }); return analysisViews })
let agentViews = null
const agentViewsReady = import('./views/agentViews.mjs').then((mod) => { agentViews = mod.createAgentViews({ state, agent, esc, text, formatAt, getTempSessionId, getTempMode, mdReady: () => mdReady, mdModule: () => mdModule, updateComposerState, updateAgentChip }); return agentViews })
let libraryFlowViews = null
const libraryFlowViewsReady = import('./views/libraryFlowViews.mjs').then((mod) => { libraryFlowViews = mod.createLibraryFlowViews({ state, esc, text, needLibraryHtml, errorHtml, warningsHtml, unitLabel, divideLabel, deliverableLabel, openModal }); return libraryFlowViews })
let syncViews = null
const syncViewsReady = import('./views/syncViews.mjs').then((mod) => { syncViews = mod.createSyncViews({ state, esc, text, formatAt }); return syncViews })
let referencePageViews = null
const referencePageViewsReady = import('./views/referencePageViews.mjs').then((mod) => { referencePageViews = mod.createReferencePageViews({ state, esc, text, moduleOn, registryModule: () => registryModule, refNodeCardHtml, refModulesHtml, dirWork, scriptViews: () => scriptViews, moduleCard: (id) => governanceViews?.moduleCard?.(id), missingText: (...args) => governanceViews?.missingText?.(...args), pageLabel: (page) => (state.plugins?.slots?.tab ?? []).find((item) => item.page === page)?.label ?? '世界书' }); return referencePageViews })
let governanceViews = null // OS-201：治理台视图只接线，渲染与委托都在 views/governanceViews.mjs
const governanceViewsReady = import('./views/governanceViews.mjs').then((mod) => { governanceViews = mod.createGovernanceViews({ state, esc, text, uiKit: () => uiKit, loadPlugins, render, setModuleEnabled, uiSet, uiMemory, settingsAggregation: () => settingsAggregation, navLabel }); return mod }).catch((error) => { console.error('[governance] 治理台视图加载失败', error); return null })

/* OS-147：正文章节清单加载状态机（纯函数在 views/chapterLoad.mjs）——首帧占位必须由本次加载自己收口 */
const chapterLoadReady = import('./views/chapterLoad.mjs').catch((error) => { console.error('[chapters] 章节加载状态机没装上', error); return null })

const state = {
  libraries: [],
  warnings: [],
  preferencesPath: '',
  kindFilter: '全部',
  current: null,
  view: 'libraries',
  entries: [],
  total: 0,
  entryWarnings: [],
  layerFilter: '',
  search: '',
  entry: null,
  entryRevision: null,
  chapterFiles: [],
  chapterFile: '',
  chapterText: '',
  chapterLoaded: false,
  chapterNote: '',
  savedAt: '',
  books: [],
  bookId: '',
  wiki: null,
  loading: false,
  error: '',
  styles: [],
  stylesWarnings: [],
  skin: '',
  libFlow: null,
  create: { parent: '', name: '', primary: 'openstory.carrier.novel', genre: '', length: null, deliverables: [], running: false, result: null, error: '' },
  genres: [],
  brief: null,
  briefGenre: null,
  impo: { root: '', source: '', plan: null, report: null, running: false, error: '' },
  repair: null,
  libDirs: [],
  dirWork: {},
  write: { chapters: [], listLoading: false, mode: 'read', docPrefs: null },
  sel: { text: '', blockIndex: -1, rect: null, busy: false, preview: null, para: -1 },
  scriptModule: null,
  jobs: { list: [], active: 0, open: false, loading: false, pollTimer: null },
  analyze: { open: false, result: null, busy: false, dismissed: {}, activePara: -1, expandOthers: false, fact: null, factRoot: '', factTab: 'emotion', modOpen: {},
    enabled: [], enabledRoot: '', pickerOpen: false, work: {}, workRoot: '', workLoaded: false, workLoading: false },
  deduce: { premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '',
    mode: 'engine', engine: { busy: false, data: null, pov: '', seed: '', error: '', hint: '',
      session: null, sessionLoaded: false, customText: '', draft: null, turnBusy: false, archiveNote: '',
      // OS-86 多局：当前局 id（='main'＝legacy 主线）＋局清单缓存（设置浮层切换/新建/删除用）
      sessionId: 'main', sessions: null,
      // OS-93 开局向导：角色卡/世界书/开头三件套（照酒馆：选人 → 选世界 → 选开头）
      opening: { loaded: false, loading: false, books: [], characters: [], openings: [], selPov: '', selBook: '', selOpen: 'free' },
      // OS-97：playMode='roleplay'（默认，主持人＋N 角色多 agent）｜'engine'（确定性推演）
      playMode: 'roleplay',
      roleplayOptions: [],
      view: 'scene', treePick: null,
      assets: null, assetsLoaded: false, assetBookId: '', bgmOn: false,
      // OS-81 叙事流：纸面模式（关掉立绘背景回纯纸面）/ 贴底跟随 / 序章折叠
      paperMode: false, flowPin: true, introOpen: null } },
  artifacts: { root: '', groups: [], totals: null, loading: false, error: '', previewFile: '', previewText: '', previewLoading: false },
  // 世界书载体（OS-44）：索引 / 当前笔记 / 反链 / 筛选标签
  reference: { loaded: false, loading: false, notes: [], tags: [], tagNotes: {}, stats: null, error: '', activePath: '', activeTag: '', firstChapterFilter: 0, note: null, backlinks: { linked: [], unlinked: [] }, draft: '', view: 'graph', q: '', focus: null, absorb: {}, flash: '', tagFilter: '', from: '', noteText: '', fmLen: 0 },
  // 左内容栏三模块（OS-44）：章节树 / 世界书图谱 / 世界书摘要
  refCol: { graph: null, graphLoading: false, graphError: '', summary: '', summaryBusy: false, summaryError: '', pick: null },
  // 同源版本状态条：POST /api/sync/check 的结果（世界书/故事源共用）。
  // data 是后端原样回包；root 记录这份结果属于哪个库（换库就整块作废重拉）；
  // loaded＝「这个库已经查过一次」（查失败也算，否则每次 render 都会重打失败的后端）；
  // notice/regenBusy 只服务状态条上的「重新生成」入口提示。
  sync: {
    loaded: false, loading: false, data: null, error: '', root: '', notice: '', regenBusy: false, openList: false,
    // OS-115 同步策略（落库内 ui-state，非浏览器缓存）：
    //   checkOn: 'enter'（进页面自动查）| 'manual'（只在设置或点状态条时查）
    //   action:  'remind'（提醒我，手动点同步）| 'auto'（发现不同步自动跑 enrich）| 'silent'（只标状态条）
    policy: null, policyLoaded: false,
    // 进场提示：同一份「不同步指纹」只弹一次，避免每次 render 都骚扰
    prompt: null, promptedFor: '', lastAutoAt: 0,
    // OS-118：本会话已知弹不出原生框——后续「浏览…」直接开内建浏览器，不再等
  },
  // 内建目录浏览器（OS-110/119）：open 时才渲染浮层；fsLastPicked＝本会话记住的
  // 「上次选过的文件夹」（真源在 daemon 的 fs-browse.json，这里只是镜像，免得多打一次请求）
  fsBrowse: null, fsLastPicked: '',
  settings: { userDir: '', section: 'plugins', suiteId: '', open: false, prevView: '', helpOpen: false },
  kbStatus: null,
  kbConfig: null,
  kbMsg: '', tabHidden: {},
  knowledgeBase: { loaded: false, loading: false, error: '', libraries: [], activeLibraryId: '', documents: [], tags: [], activeRef: '', activeTag: '', treeQuery: '', document: null, backlinks: { linked: [], unlinked: [] }, documentLoading: false, graph: null, graphLoading: false, graphError: '', view: 'detail', picked: null, query: '', hits: [], searching: false, searchError: '', indexStatus: 'never-indexed', runtimeAvailable: false, form: null },
  ssJump: null,
  // 产物驳回记录（OS-51）：msgHtml index → true。会话级，不落档
  rejectedMsgs: {},
  suites: [],
  // OS-120：三套插件的统一清单（只读聚合）。loaded 用来区分「还没拉」和「拉回来是空」
  plugins: { loaded: false, slots: null, slotWarnings: [], list: [], byKind: {}, stats: null, warnings: [], error: '' },
  agent: {
    configured: false,
    endpoint: '',
    model: '',
    apiKeyMasked: '',
    configPath: '',
    runtime: '',
    runtimeList: [],
    // 全局配置四块（S4）：GET /api/config 的脱敏结果；probes＝每张卡的测试结果
    config: null,
    dshModels: [],
    probes: {},
    notices: [],
    sessions: [],
    sessionId: '',
    items: [],
    streaming: false,
    controller: null,
    cardError: null,
    lastError: null,
    skills: null,
    skillsError: '',
    picks: null,
    picksExplicit: false
  }
}

const viewEl = document.getElementById('view')

// OS-21：md 渲染器（ESM，按需载入；零依赖自研）
let mdModule = null
async function loadMd() {
  if (!mdModule) mdModule = await import('./md.mjs')
  return mdModule
}
// OS-25：分析引擎（纯计算，插件自管，不走 daemon）
let analysisModule = null
async function loadAnalysis() {
  if (!analysisModule) analysisModule = await import('./analysis.mjs')
  return analysisModule
}
loadAnalysis().catch(() => {})

// S3：分析模块注册表（纯数据＋纯函数；work 级模块的数据口径来自 storySource）
let scriptModulePromise = null
function loadScriptModule() {
  if (!scriptModulePromise) {
    scriptModulePromise = Promise.all([import('./script.mjs'), import('./scriptFormat.mjs'), import('./scriptFact.mjs')]).then(([mod, fmt, fact]) => {
      state.scriptModule = mod
      state.scriptFormat = fmt
      state.scriptFact = fact
      if (state.view === 'dir:剧本') render()
      return mod
    }).catch(() => null)
  }
  return scriptModulePromise
}
loadScriptModule()

let analysisModules = null
async function loadAnalysisModules() {
  if (!analysisModules) analysisModules = await import('./analysisModules.mjs')
  return analysisModules
}
loadAnalysisModules()
  .then(() => {
    if (state.view === 'chapters' && state.analyze.open) renderAnalyzePanel()
    if (state.view === 'dir:故事源') render()
  })
  .catch(() => {})

let mdReady = false
loadMd().then(() => { mdReady = true; if (state.view === 'chapters') render() }).catch(() => {})



function esc(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]))
}

function text(value) {
  return String(value ?? '')
}




function truncate(value, max = 110) {
  const body = text(value).replace(/\s+/gu, ' ').trim()
  return body.length > max ? `${body.slice(0, max)}…` : body
}


function formatAt(value) {
  const raw = text(value).trim()
  if (!raw) return '时间未知'
  const date = new Date(raw)
  if (Number.isNaN(date.getTime())) return raw
  const diff = Date.now() - date.getTime()
  if (diff >= 0 && diff < 60_000) return '刚刚'
  if (diff >= 0 && diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`
  if (diff >= 0 && diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`
  const pad = (number) => String(number).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

async function api(path, options = {}) {
  // allowOkFalse：软空态查询用——响应 200 且 ok:false 时原样返回（不抛），
  // 例如推演 peek 无会话（NO_DEDUCE_SESSION 是合法空态不是错误）。
  const { allowOkFalse, ...fetchOpts } = options
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...fetchOpts
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || (payload?.ok === false && !allowOkFalse)) {
    const error = new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`)
    error.code = payload?.error?.code || ''
    error.details = payload?.error?.details || null
    throw error
  }
  return payload
}

/**
 * 把技术错误翻译成作者能懂的人话（OS-34 原口径，OS-59 补实现——此前只有调用点没有定义，
 * 任何走到它的路径都会 ReferenceError）。
 */
function humanizeAgentError(error) {
  const code = text(error?.code)
  const message = text(error?.message || error)
  if (/^Failed to fetch|NetworkError|ECONNREFUSED|fetch failed/iu.test(message)) {
    return '连不上模型服务——检查本机网络，或设置里的运行时是否可用。'
  }
  if (code === 'DAEMON_UNREACHABLE') return '连不上 OpenStory 服务：daemon 可能没启动。'
  if (code === 'AGENT_UPSTREAM_ERROR') return `模型服务报错：${message.replace(/^AGENT_UPSTREAM_ERROR\s*·\s*/u, '')}`
  if (code === 'NO_LIBRARY') return '这个库不在库清单里——先在顶栏选一个库。'
  if (code === 'REVISION_MISMATCH') return '正文在这个空档被改过了，为了不覆盖你的手改，请重新发起一次。'
  if (/timeout|timed out|ETIMEDOUT/iu.test(message)) return '模型响应超时——可能是任务太大，试着拆小一点再来。'
  return message || '出了点问题，但没有更多信息。'
}

function rememberError(error) {
  state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  state.loading = false
}

/* ---------- 全局后台任务中心（OS-80）----------
 * 作者口径：所有插件的长任务（生图/识图/enrich/导入）都该在一个地方看到进度，
 * 切走页面回来不丢状态。这里是一个悬浮球 + 可展开面板，跨模块共用。
 */
const JOB_KIND_LABEL = { image: '生图', vision: '识图', enrich: '语义富化', import: '导入', screenplay: '剧本' }
const JOB_STATE_LABEL = { queued: '排队', running: '进行中', done: '完成', failed: '失败', cancelled: '已取消' }

/** 确保轮询在跑（有活跃任务时 3s 一次，全静默时 15s 一次）。 */
function ensureJobsPolling() {
  const jobs = state.jobs
  if (jobs.pollTimer) return
  const tick = async () => {
    jobs.pollTimer = null
    try {
      const payload = await api('/api/jobs?limit=30')
      if (payload?.ok) {
        const prev = jobs.list || []
        jobs.list = payload.jobs || []
        jobs.active = payload.active || 0
        renderJobBall()
        // OS-80：生图任务完成 → 自动重载对应笔记（图墙读 frontmatter.images）
        for (const job of jobs.list) {
          if (job.state !== 'done') continue
          const prevSame = prev.find((p) => p.id === job.id)
          if (prevSame?.state === 'done') continue
          const wait = jobs.waitingNotes?.[job.id]
          if (!wait) continue
          delete jobs.waitingNotes[job.id]
          if (state.current?.path === wait.root && state.reference?.activePath === wait.path) {
            openReference(wait.path).catch(() => null)
          }
        }
      }
    } catch { /* 轮询失败静默 */ }
    const interval = state.jobs.active > 0 ? 3000 : 15000
    state.jobs.pollTimer = setTimeout(tick, interval)
  }
  state.jobs.pollTimer = setTimeout(tick, 800)
}

/** 执行一个动作后刷新任务列表（取消/清空共用）。 */
function refreshJobsAfter(action) {
  Promise.resolve()
    .then(() => action())
    .catch(() => null)
    .then(() => new Promise((r) => setTimeout(r, 350)))
    .then(() => api('/api/jobs?limit=30'))
    .then((payload) => {
      if (payload?.ok) {
        state.jobs.list = payload.jobs || []
        state.jobs.active = payload.active || 0
      }
    })
    .catch(() => null)
    .then(() => renderJobBall())
}

/** 悬浮球本体＋展开面板（挂到 body，不随页面重绘丢）。 */
function renderJobBall() {
  let host = document.getElementById('job-ball-host')
  if (!host) {
    host = document.createElement('div')
    host.id = 'job-ball-host'
    document.body.appendChild(host)
  }
  const jobs = state.jobs
  const active = jobs.active || 0
  const list = jobs.list || []
  const hasAny = list.length > 0
  // OS-117：没任务也留一个安静态小球——常驻入口不该忽隐忽现（作者：进度球不见了）
  const dot = active > 0 ? `<span class="jb-count">${active}</span>` : ''
  const running = list.filter((j) => j.state === 'running' || j.state === 'queued')
  const settled = list.filter((j) => ['done', 'failed', 'cancelled'].includes(j.state))
  const row = (job) => {
    const pct = job.state === 'running' ? '<span class="jb-spin"></span>' : job.state === 'done' ? '<span class="jb-ok">✓</span>' : job.state === 'failed' ? '<span class="jb-fail">✕</span>' : '<span class="jb-cancel">–</span>'
    const lastMsg = job.progress?.length ? job.progress[job.progress.length - 1].message : ''
    return `<div class="jb-row" data-job-id="${esc(job.id)}">
      <div class="jb-row-head">
        ${pct}
        <span class="jb-kind">${esc(JOB_KIND_LABEL[job.kind] || job.kind)}</span>
        <span class="jb-label">${esc(job.label)}</span>
        <span class="jb-state ${esc(job.state)}">${esc(JOB_STATE_LABEL[job.state] || job.state)}</span>
        ${['running', 'queued'].includes(job.state) ? `<button class="jb-x" data-action="job-cancel" data-job-id="${esc(job.id)}" title="取消">×</button>` : ''}
      </div>
      ${lastMsg ? `<div class="jb-msg">${esc(lastMsg)}</div>` : ''}
      ${job.error ? `<div class="jb-err">${esc(job.error)}</div>` : ''}
    </div>`
  }
  const idle = !hasAny && !active
  host.innerHTML = `<div class="job-ball-wrap${jobs.open ? ' open' : ''}">
    <button class="job-ball${active > 0 ? ' busy' : ''}${idle ? ' idle' : ''}" data-action="job-ball-toggle" title="${idle ? '后台任务（暂无）' : `后台任务（${active} 进行中 / ${list.length} 总计）`}">
      <span class="jb-ic">◱</span>${dot}
    </button>
    ${jobs.open ? `<div class="job-panel">
      <div class="jb-head">
        <b>后台任务</b><span class="jb-sub">${active} 进行中 · ${settled.length} 已结束</span>
        <button class="jb-clear" data-action="job-clear" title="清空已结束">清空已完成</button>
      </div>
      <div class="jb-list">
        ${running.length ? `<div class="jb-group">进行中</div>${running.map(row).join('')}` : `<div class="jb-empty">${idle ? '暂无后台任务——生图、识图、enrich 这类长活会出现在这里' : '没有进行中的任务'}</div>`}
        ${settled.length ? `<div class="jb-group">已结束</div>${settled.slice(0, 10).map(row).join('')}` : ''}
      </div>
    </div>` : ''}
  </div>`
}

/* ---------- 渲染 ---------- */

/* OS-143：视图渲染函数注册名映射（app.js 侧注册，注册表只存名字——registry 不 import app.js）。
   本体暂留本文件（G5 逐个迁出），此处是出走的唯一插座：迁出后从模块侧重新 register 即可。 */
const VIEW_RENDERERS = {
  libraryHtml, createHtml, importHtml, repairHtml, writeHtml, habitsViewHtml,
  referencePageHtml, deduceHtml, settingsHtml, artifactsHtml, dirViewHtml,
  knowledgeBaseHtml: () => knowledgeBaseController?.html() || '<div class="loading">知识库载入中…</div>',
  modulePageHtml: (view) => modulePageViews?.modulePageHtml(view, {
    slots: state.plugins?.slots ?? {},
    modules: state.plugins?.modules ?? [],
    localModules: state.plugins?.localModules ?? [],
    root: state.current?.path ?? '',
    esc
  }) ?? '<div class="empty">模块页面视图还在载入…</div>'
}
/** 视图 → 渲染函数（注册表给注册名，这里取本体）；未注册＝装配错误，响亮失败。 */
function viewHtml(view, ...args) {
  const modId = registryModule?.registryEntry?.(view)?.id ?? registryModule?.parseModuleView?.(view)?.module ?? ''
  if (modId) { const card = governanceViews?.moduleCard?.(modId); if (card?.status === 'degraded') return governanceViews?.degradedViewHtml?.(card) ?? '' }
  const name = registryModule ? registryModule.renderNameForView(view) : null
  const fn = name ? VIEW_RENDERERS[name] : null
  if (!fn) throw new Error(`viewHtml：视图 ${view} 的渲染器未注册（${name ?? '视图不在注册表'}）`)
  return fn(...args)
}

function render() {
  ensureJobsPolling()
  const current = state.current
  const switchName = document.getElementById('lib-switch-name')
  if (switchName) switchName.textContent = current ? current.name : (state.libraries.length ? '选择库' : '还没有库')
  renderLibSwitchPanel()
  renderTabs()
  // 故事源图表实例只属于图表态；换页/换形态先释放，避免画布挂在已卸的 DOM 上
  if (state.view !== 'dir:故事源') disposeStorySourceChart()
  // 正文页自己管滚动（页头吸顶＋纸面/右栏各自滚），外层不再滚动
  // OS-76：剧本页也用沉浸式排版（与正文页同构：铺满视口、左中右三栏）
  // OS-84：推演全形态（叙事流/剧情树/Agent）同一壳——铺满视口、内容区自己滚
  viewEl.classList.toggle('content-locked', state.view === 'chapters' || state.view === 'dir:剧本'
    || state.view === 'roleplay')
  if (state.view !== 'roleplay') dedTypewriterStop()
  if (state.view.startsWith('module:')) viewEl.innerHTML = viewHtml(state.view, state.view)
  else if (state.view === 'libraries') viewEl.innerHTML = viewHtml('libraries')
  else if (state.view === 'chapters') {
    viewEl.innerHTML = viewHtml('chapters')
    // 版面换了 DOM：批注面板要重挂（否则右栏是空的），标注与吸顶也要重算
    renderAnalyzePanel()
    paintDocAnnotations()
    afterRefColMount()
  }
  else if (state.view === 'habits') {
    viewEl.innerHTML = viewHtml('habits')
  }
  else if (state.view === 'worldbook') {
    viewEl.innerHTML = viewHtml('worldbook')
    // 图谱视图：挂大画布（focus 模式）；笔记视图：详情页右上角小图谱（本词条邻域）
    if ((state.reference.view || 'graph') === 'graph') {
      // 无数据时先拉再重渲——loading 态没有 canvas，mountReferenceGraph 会早退，
      // 之前默认进图谱视图会永远停在「正在构图…」（OS-54）
      if (!state.refCol.graph && !state.refCol.graphLoading) {
        // 不能在外面预设 graphLoading——loadRefGraph 的防重入 guard 会直接 return，
        // then 里 render 又进本分支 = 无限循环（OS-54 修）
        loadRefGraph().then(() => { if (state.view === 'worldbook') render() })
      } else {
        mountReferenceGraph()
      }
    }
    else if (state.reference.activePath && state.reference.note) mountDetailGraph()
    else if (state.reference.activeEntry) mountEntryGraph()
  }
  else if (state.view === 'knowledge-base') viewEl.innerHTML = viewHtml('knowledge-base')
  else if (state.view === 'lib-create') viewEl.innerHTML = viewHtml('lib-create')
  else if (state.view === 'lib-import') viewEl.innerHTML = viewHtml('lib-import')
  else if (state.view === 'repair') viewEl.innerHTML = viewHtml('repair')
  else if (state.view === 'roleplay') {
    viewEl.innerHTML = viewHtml('roleplay')
    // 进入推演页自动续上已有局面（OS-60）：以前进来永远是空态，库里推过的拍看不到，
    // 得手动点「开始推演」——但那会额外推一拍，语义是错的。
    const engine = state.deduce.engine
    // OS-100：扮演模式不做引擎 peek（present 是推演模式的确定性引擎）——
    // 扮演局由 roleplayStarted/开场白驱动，进来只回放会话
    if ((engine.playMode || 'roleplay') !== 'engine') {
      // OS-100：有会话＝这局已经开始过——自动进流（roleplayStarted 是内存态，刷新会丢）
      if (!engine.session && state.current?.path) {
        api('/api/deduce/session?root=' + encodeURIComponent(state.current.path))
          .then((payload) => {
            engine.session = payload.session ?? null
            engine.sessionId = payload.activeId || engine.session?.sessionId || 'main'
            // 会话有拍＝这局进行中；没有拍但向导没显示时也给个空流落点
            if (engine.session) engine.roleplayStarted = true
          })
          .catch(() => {})
          .finally(() => { if (state.view === 'roleplay') render() })
      } else if (engine.session) {
        engine.roleplayStarted = true
      }
    } else if (!engine.data && !engine.busy && !engine.error && state.current?.path) {
      engine.busy = true
      api('/api/deduce/present', { method: 'POST', body: JSON.stringify({ root: state.current.path, peek: true }) })
        .then((payload) => {
          if (payload?.ok === false && payload.code === 'NO_DEDUCE_SESSION') return
          engine.data = payload
          if (Array.isArray(payload.characters)) state.deduce.characters = payload.characters
          deduceRestoreDraft()
        })
        .catch(() => { /* 没有会话就当空态，不报错 */ })
        .finally(() => { engine.busy = false; if (state.view === 'roleplay') render() })
    }
    // 回合层（OS-61 P2）：会话缓存区进度＋续上没写完的正文草稿
    if (!engine.sessionLoaded) {
      engine.sessionLoaded = true
      api(`/api/deduce/session?root=${encodeURIComponent(state.current.path)}`)
        .then((payload) => {
          engine.session = payload.session ?? null
          engine.sessionId = payload.activeId || engine.session?.sessionId || 'main'
          deduceRestoreDraft()
        })
        .catch(() => { /* 读不到会话不拦推演 */ })
        .finally(() => { if (state.view === 'roleplay') render() })
      // OS-86 多局清单：设置浮层里的局列表（切换/新建/删除）
      api(`/api/deduce/sessions?root=${encodeURIComponent(state.current.path)}`)
        .then((payload) => { engine.sessions = { activeId: payload.activeId, sessions: payload.sessions ?? [] } })
        .catch(() => { engine.sessions = null })
      // OS-93 开局三件套：未开局时拉一次（向导用）
      if (!engine.opening.loaded && !engine.opening.loading) {
        engine.opening.loading = true
        api(`/api/deduce/opening?root=${encodeURIComponent(state.current.path)}`)
          .then((payload) => {
            engine.opening = { loaded: true, loading: false, ...payload, selPov: payload.characters?.[0]?.name ?? '', selBook: payload.books?.[0]?.bookId ?? '', selOpen: 'free' }
          })
          .catch(() => { engine.opening.loading = false })
          .finally(() => { if (state.view === 'roleplay') render() })
      }
    }
    // 剧情树（OS-61 P3）：树视图挂 SVG 导图；离开树视图就清理（mode 在 state.deduce 上，不在 engine 上）
    if (state.deduce.mode === 'engine' && engine.view === 'tree') mountDeduceTree()
    else { deduceTreeCleanup?.(); deduceTreeCleanup = null }
    // OS-94/100：偏好与模式从库内 ui-state 复原（纸面/状态牌/扮演模式）
    engine.playMode = uiGet('deducePlayMode', 'roleplay') === 'engine' ? 'engine' : 'roleplay'
    engine.paperMode = uiGet('deducePaperMode', engine.paperMode === true)
    engine.infoOpen = uiGet('deduceInfoOpen', engine.infoOpen)
    // 文游素材（OS-61 P4）：进页拉一次盘点；打字机只在「当前局面」视图挂
    if (!engine.assetsLoaded) {
      engine.assetsLoaded = true
      api(`/api/deduce/assets?root=${encodeURIComponent(state.current.path)}`)
        .then((payload) => {
          engine.assets = { characters: payload.characters || [], scenes: payload.scenes || [], bgm: payload.bgm || [] }
          engine.assetBookId = text(payload.bookId)
        })
        .catch(() => { engine.assets = { characters: [], scenes: [], bgm: [] } })
        .finally(() => { if (state.view === 'roleplay') render() })
    }
    if (state.deduce.mode === 'engine' && engine.view !== 'tree') mountDedFlow()
    else dedTypewriterStop()
  }
  else if (state.view === 'settings') viewEl.innerHTML = viewHtml('settings')
  else if (state.view === 'artifacts') viewEl.innerHTML = viewHtml('artifacts')
  else if (state.view?.startsWith('dir:')) {
    const dir = state.view.slice(4)
    viewEl.innerHTML = viewHtml(state.view, dir)
    if (dir === '故事源') mountStorySourceChart()
    // OS-76：剧本页 fork 正文页——同样的左右栏挂载（图谱/摘要/分析面板）
    if (dir === '剧本') {
      renderAnalyzePanel()
      afterRefColMount()
    }
  }
  // OS-114：窄面板里世界书资料左栏按抽屉处理（宽面板无副作用）
  if (state.view === 'chapters' || state.view === 'dir:剧本') applyNarrowRefDrawer()
}

function errorHtml() {
  return state.error ? `<div class="error-box">${esc(state.error)}</div>` : ''
}

function warningsHtml(warnings) {
  if (!Array.isArray(warnings) || warnings.length === 0) return ''
  const lines = warnings.map((warning) => `<div>${esc(warning.message || warning.code || warning)}</div>`).join('')
  return `<div class="warn-box"><b>提示</b>${lines}</div>`
}

function libraryHtml() {
  const kinds = ['全部', ...new Set(state.libraries.map((library) => library.kind))]
  const visible = state.kindFilter === '全部'
    ? state.libraries
    : state.libraries.filter((library) => library.kind === state.kindFilter)
  const filters = kinds.map((kind) => {
    const count = kind === '全部'
      ? state.libraries.length
      : state.libraries.filter((library) => library.kind === kind).length
    return `<button class="f${state.kindFilter === kind ? ' on' : ''}" data-kind="${esc(kind)}">${esc(kind)}<span class="n"> ${count}</span></button>`
  }).join('')

  const cards = visible.map((library) => {
    const active = state.current?.path === library.path
    const stat = library.count > 0
      ? `${library.count} 条 · ${formatAt(library.at)}`
      : formatAt(library.at)
    return `<button class="card${active ? ' on' : ''}" data-lib-path="${esc(library.path)}">
      <span class="t">${esc(library.name)}<span class="pill">${esc(library.kind)}</span></span>
      <span class="path">${esc(library.path)}</span>
      <span class="stat">${esc(stat)}</span>
    </button>`
  }).join('')

  const empty = state.libraries.length === 0
    ? `<div class="empty-state">
        <h2>从一块空地开始</h2>
        <p>新建一个库（挑主模块建骨架），或把已有的稿子目录导入进来。库清单由 OpenStory 自己维护。</p>
        <div class="repair-actions" style="justify-content:center">
          <button class="btn-primary" data-action="flow-create">＋新建库</button>
          <button class="btn-ghost" data-action="flow-import">导入稿件</button>
        </div>
        <div class="hint">库清单：${esc(state.preferencesPath || '%LOCALAPPDATA%\\OpenStory\\libraries.json')}</div>
      </div>`
    : `<div class="filter">${filters}</div><div class="cards">${cards}</div>`

  return `<div class="lib-wrap">
    <div class="lib-head-row">
      <h1>库管理</h1><span class="sp"></span>
      <button class="btn-ghost" data-action="flow-import">导入稿件</button>
      <button class="btn-primary" data-action="flow-create">＋新建库</button>
    </div>
    <p class="sub">每个库就是磁盘上的一个文件夹，库清单只属于 OpenStory。</p>
    ${errorHtml()}
    ${warningsHtml(state.warnings)}
    ${empty}
  </div>`
}




function needLibraryHtml() {
  return `<div class="empty-state">
    <h2>先选一个库</h2>
    <p>点右上角的「库」切换器选一个库，OpenStory 才会去读那个文件夹。</p>
    <button class="btn-ghost" data-go="libraries">去库管理</button>
  </div>`
}

function unitLabel(unit) { return unit === 'episodes' ? '集' : unit === 'minutes' ? '分钟' : '字' }
function divideLabel(divideBy) { return divideBy === 'chapter' ? '章' : divideBy === 'episode' ? '集' : divideBy === 'scene' ? '场' : '段' }
function deliverableLabel(deliverable) { return deliverable === 'novel' ? '小说' : deliverable === 'script' ? '剧本' : deliverable === 'comic' ? '漫画' : '游戏' }


/* ---------- 写作偏好（OS-21：字号/行高/段距/缩进/自动隔行 → CSS 变量）---------- */

const DOC_PREF_DEFAULTS = { fontSize: 17, lineHeight: 1.9, paraGap: 1, indent: 2, autoGap: true }

function loadDocPrefs() {
  if (state.write.docPrefs) return state.write.docPrefs
  // OS-89：写作偏好落库内 ui-state——换机器/清缓存后仍能复原
  const saved = uiGet('docPrefs', {})
  state.write.docPrefs = { ...DOC_PREF_DEFAULTS, ...(saved && typeof saved === 'object' ? saved : {}) }
  return state.write.docPrefs
}

function applyDocPrefs() {
  const prefs = loadDocPrefs()
  const root = document.documentElement
  // OS-91：字号与行高归「设置 · 主题与字号」的 --doc-font-size 档位统一管，
  // 这里**不再** inline 覆盖它们（否则 inline style 优先级高于 :root[data-doc-fs]，
  // 项目级档位永远不生效——这正是两套字号体系打架的根因）。
  // 段落级参数（段距/缩进/隔行）仍归页面自己的写作偏好。
  root.style.setProperty('--doc-para-gap', `${prefs.paraGap}em`)
  root.style.setProperty('--doc-indent', `${prefs.indent}em`)
  root.dataset.docAutoGap = prefs.autoGap ? 'on' : 'off'
}

function setDocPref(key, value) {
  const prefs = loadDocPrefs()
  prefs[key] = value
  uiSet('docPrefs', { ...prefs }) // OS-89：落库内
  applyDocPrefs()
}

/**
 * 逐块渲染（OS-22 认知修正：默认就能实时编辑，不做阅读/编辑切换）。
 * 每个块输出一个 contenteditable 段落组件——点进去直接改，失焦即按块偏移写回源码并自动保存。
 * 大标题（md 首个 H1）已在文档头显示，正文里跳过。
 */
function renderDocBody(text) {
  if (!mdReady || !mdModule) return `<div class="doc-paper prose"><p>${esc(text)}</p></div>`
  const blocks = mdModule.splitBlocks(text).filter((block) => !/^\s*#\s+/u.test(block.text))
  // 每段外面套一层 .doc-line：竖条批注条放在可编辑块之外（contenteditable 里放按钮会被一起编辑）
  const parts = blocks.map((block, index) => {
    const html = mdModule.renderMarkdown(block.text)
    return `<div class="doc-line" data-line="${index}">
      <button class="doc-gutter" data-action="gutter-jump" data-block-index="${index}" title="第 ${index + 1} 段的批注" aria-label="第 ${index + 1} 段的批注"></button>
      <div class="doc-block" contenteditable="true" spellcheck="false" data-block="${index}" data-start="${block.start}" data-end="${block.end}" data-raw="${esc(block.text)}">${html}</div>
    </div>`
  })
  return `<div class="doc-paper prose" id="doc-reader">${parts.join('')}</div>`
}

function formatBytes(size) {
  const value = Number(size) || 0
  return value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`
}

/** 拉章节清单。OS-22：不整页重绘——只重画左侧章节列表（实时编辑时纸面 DOM 不能被换掉）。
 *  OS-147：首次加载的占位帧里没有 .chapter-rows，收口必须整页重画（只刷行＝什么都不刷）。 */
async function loadWriteChapters({ force = false } = {}) {
  if (!state.current) return
  // OS-89：模块加载时检索自己的 log；必须 await 且在缓存早退之前（早退就再也拉不到）
  await loadModuleLog('正文', { limit: 20 })
  if (state.view === 'chapters' && document.getElementById('ref-col')) renderRefCol() // 日志到位后重排左栏
  const cl = await chapterLoadReady
  if (!cl) { state.write.listLoading = false; state.error = '章节加载状态机没装上（装包不完整）——刷新或重装即可'; render(); return }
  const step = cl.beginChapterLoad(state.write, { force, hasChapters: state.write.chapters.length > 0 })
  if (!step.fetch) return // 缓存命中：页面已由调用方 render() 摆好，本身就是终态
  if (step.paint) { state.write.listLoading = true; render() }
  let payload = null, failure = null
  try { payload = await api(`/api/chapters?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent('正文')}`) }
  catch (error) { failure = error }
  const done = cl.finishChapterLoad(state.write, step.epoch, { ok: !failure })
  if (done.apply) state.write.listLoading = false
  if (done.apply && failure) state.error = `${failure?.code ? `${failure.code} · ` : ''}${text(failure?.message || failure)}`
  else if (done.apply) state.write.chapters = Array.isArray(payload?.chapters) ? payload.chapters : []
  if (done.repaint) render() // 画过占位＝整页重画；否则只刷左栏行（不动纸面/光标）
  else refreshChapterRows()
}

/** 只重画左侧章节行（不动纸面/光标，也不动新建输入框的输入内容）。 */
function refreshChapterRows() {
  const host = document.querySelector('.chapter-rows')
  if (!host) return
  host.innerHTML = chapterRowsHtml(state.write.chapters || [])
}


/* ---------- 沉浸式编辑交互（OS-21）---------- */


/** 版本历史：跳到产物并预选该文件的历史（产物已有 bak/deleted 归一与恢复）。 */
async function openChapterHistory() {
  await openArtifacts({ force: true })
  const inventory = state.artifacts
  const base = state.chapterFile.split('/').pop()
  const hit = inventory.groups.flatMap((group) => group.history ?? []).find((item) => item.originalName === base)
  if (hit) previewArtifact(hit.file)
  else render()
}


/* ---------- 实时逐块编辑（OS-22）：blur 即回写源码并自动保存 ---------- */

let docSaveTimer = null

function setAutosaveChip(text) {
  const chip = document.getElementById('doc-autosave')
  if (chip) chip.textContent = text
  // 世界书详情页自己的保存提示（OS-53 实时编辑）
  const refChip = document.getElementById('ref-autosave')
  if (refChip) refChip.textContent = text
}

/** 块内 HTML → 该块的 Markdown 源码（最小可逆：p→段落、br→换行、strong/em/code 回标记）。 */
function blockHtmlToMd(blockEl) {
  const html = blockEl.innerHTML
  const withInline = html
    .replace(/<strong[^>]*>([\s\S]*?)<\/strong>/giu, '**$1**')
    .replace(/<em[^>]*>([\s\S]*?)<\/em>/giu, '*$1*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/giu, '`$1`')
    .replace(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/giu, '[$2]($1)')
  const lines = withInline
    .replace(/<br\s*\/?>/giu, '\n')
    .split(/<\/p>\s*<p[^>]*>|<p[^>]*>|<\/p>/giu)
    .join('\n')
  const text = lines
    .replace(/<[^>]+>/gu, '')
    .replace(/&nbsp;/gu, ' ')
    .replace(/&lt;/gu, '<')
    .replace(/&gt;/gu, '>')
    .replace(/&quot;/gu, '"')
    .replace(/&#39;/gu, "'")
    .replace(/&amp;/gu, '&')
  return text.split('\n').map((line) => line.trimEnd()).join('\n').trim()
}

/** 剧本块 HTML → 剧本文本（OS-163：本体迁 views/scriptViews.mjs，这里只注入 text 后转交）。 */
function scriptBlockToRaw(blockEl) {
  return scriptViews.scriptBlockToRaw(blockEl, { text })
}

/** 剧本块保存：与 commitDocBlock 同构，只是块转源码和保存目标换掉。 */
async function commitScriptBlock(blockEl) {
  const work = dirWork('剧本')
  if (!work?.loaded || !work.file) return
  const start = Number(blockEl.dataset.start)
  const end = Number(blockEl.dataset.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  const nextBlock = scriptBlockToRaw(blockEl)
  const currentRaw = blockEl.dataset.raw ?? ''
  if (nextBlock === currentRaw) return
  let next = work.text.slice(0, start) + nextBlock + work.text.slice(end)
  // OS-78：自动排版——保存时把整篇规范化（幂等；已规范的行不动）
  if (scriptPrefs().autoFormat && state.scriptFormat?.normalizeScript) {
    const formatted = state.scriptFormat.normalizeScript(next)
    if (formatted.changes.length) next = formatted.text
  }
  work.text = next
  blockEl.dataset.raw = nextBlock
  setAutosaveChip('保存中…')
  try {
    const payload = await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: work.file, text: next })
    })
    work.savedAt = payload.savedAt
    setAutosaveChip('已保存 · 刚刚')
    const chars = document.getElementById('dir-chars')
    if (chars) chars.textContent = `${next.replace(/\s/gu, '').length} 字`
  } catch (error) {
    setAutosaveChip('保存失败')
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/** 当前章节的渲染块列表（与 data-block 的下标一致：已过滤掉 H1）。 */
function renderedBlocks() {
  if (!mdReady || !mdModule) return []
  return mdModule.splitBlocks(state.chapterText).filter((block) => !/^\s*#\s+/u.test(block.text))
}

/** 统一的「改整篇文本 → 落盘 → 重绘」出口（增删块用）。 */
async function writeChapterText(text, note = '') {
  if (!state.current || !state.chapterFile) return
  state.chapterText = text
  setAutosaveChip('保存中…')
  try {
    const payload = await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: state.chapterFile, text })
    })
    state.savedAt = payload.savedAt
    state.chapterNote = note
    render()
    paintDocAnnotations()
    setAutosaveChip('已保存 · 刚刚')
    clearTimeout(docSaveTimer)
    docSaveTimer = setTimeout(() => { loadWriteChapters({ force: true }) }, 1200)
  } catch (error) {
    setAutosaveChip('保存失败')
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

async function commitDocBlock(blockEl) {
  // OS-76：剧本页复用本函数（同一套逐块编辑链路），只是文本转换与保存目标不同
  if (state.view === 'dir:剧本') return commitScriptBlock(blockEl)
  if (!state.current || !state.chapterFile) return
  const start = Number(blockEl.dataset.start)
  const end = Number(blockEl.dataset.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  const nextBlock = blockHtmlToMd(blockEl)
  const currentRaw = blockEl.dataset.raw ?? ''
  if (nextBlock === currentRaw) return
  const text = state.chapterText.slice(0, start) + nextBlock + state.chapterText.slice(end)
  state.chapterText = text
  blockEl.dataset.raw = nextBlock
  setAutosaveChip('保存中…')
  try {
    const payload = await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: state.chapterFile, text })
    })
    state.savedAt = payload.savedAt
    state.chapterNote = ''
    setAutosaveChip('已保存 · 刚刚')
    const chars = document.getElementById('chapter-chars')
    if (chars) chars.textContent = `${text.length} 字`
    // 字数变了同步左侧列表（不阻塞）
    clearTimeout(docSaveTimer)
    docSaveTimer = setTimeout(() => { loadWriteChapters({ force: true }) }, 1500)
  } catch (error) {
    setAutosaveChip('保存失败')
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/** 排版滑块组（正文工作台面板与设置·正文排版共用同一份控件与偏好）。 */
function docPrefSlidersHtml() {
  const prefs = loadDocPrefs()
  const slider = (key, label, min, max, step, unit) => `
    <div class="field"><label>${esc(label)}<span class="count" id="dp-${key}"> ${prefs[key]}${unit}</span></label>
      <input type="range" data-docpref="${key}" min="${min}" max="${max}" step="${step}" value="${prefs[key]}">
    </div>`
  return [
    // OS-91：字号/行高已上收到「设置 · 主题与字号」的项目级档位，这里不再重复给——
    // 两处各摆一套滑杆＝两个真源，改一处另一处不生效，作者实测过这个坑。
    `<div class="field"><label>字号与行高<span class="count"> 去「设置 · 主题与字号」调</span></label>
      <button class="btn-ghost" data-action="open-typography-settings">打开主题设置</button>
    </div>`,
    slider('paraGap', '段距', 0, 2.5, 0.1, 'em'),
    slider('indent', '首行缩进', 0, 3, 0.5, 'em'),
    `<div class="field"><label>自动隔行（段落间空一行）</label>
      <button class="btn-ghost" data-action="docpref-toggle-gap">${prefs.autoGap ? '已开启（点按关闭）' : '已关闭（点按开启）'}</button>
    </div>`
  ].join('')
}

/**
 * 「本章」面板（OS-30）：显示偏好与章操作合成一个入口（正文头只留一个 ⋯）。
 * 面板自管，不进应用设置；显示偏好存本机。
 */
function openDocMore() {
  const hasFile = Boolean(state.chapterFile)
  openModal(`
    <h3>本章</h3>
    <p class="sub">${hasFile ? esc(state.chapterFile) : '未选章节——左侧点一章，或输入标题新建。'}</p>
    <div class="chapter-ops">
      <button class="btn-ghost" data-action="chapter-history"${hasFile ? '' : ' disabled'}>版本历史</button>
      <button class="btn-ghost" data-action="chapter-rename"${hasFile ? '' : ' disabled'}>重命名</button>
      <button class="btn-ghost" data-action="chapter-delete"${hasFile ? '' : ' disabled'}>删除（进 .history）</button>
    </div>
    <div class="modal-sec">
      <h4>显示</h4>
      <p class="sub">只影响正文阅读与编辑的观感，存本机。</p>
      ${docPrefSlidersHtml()}
    </div>
    <div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>
  `)
}


/* ---------- 选区动作（OS-24）：框选 → 润笔 / 与 Agent 讨论 ---------- */

const selBar = { el: null }

function ensureSelBar() {
  if (selBar.el) return selBar.el
  const bar = document.createElement('div')
  bar.className = 'sel-bar'
  bar.dataset.selbar = '1'
  bar.innerHTML = [
    '<button data-action="para-polish">润笔</button>',
    '<button data-action="para-to-agent">添加到 Agent</button>',
    '<button data-action="para-analyze">分析这一段</button>'
  ].join('')
  document.body.appendChild(bar)
  selBar.el = bar
  return bar
}

function hideSelBar() {
  if (selBar.el) selBar.el.classList.remove('on')
  state.sel.rect = null
}

/** 读当前选区；必须落在某个 .doc-block 内才算数。 */
function readDocSelection() {
  const selection = window.getSelection?.()
  if (!selection || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = String(selection).trim()
  if (!text) return null
  const range = selection.getRangeAt(0)
  // startContainer 可能是元素本身（如整块选中），也可能是文本节点
  const startEl = range.startContainer?.nodeType === 3
    ? range.startContainer.parentElement
    : range.startContainer
  const blockEl = startEl?.closest?.('.doc-block')
  if (!blockEl || !blockEl.isConnected) return null
  return { text, blockEl, rect: range.getBoundingClientRect() }
}

/**
 * 整段选中（OS-37）：左键点一行段落＝选中这一段。
 * contenteditable 里光标是给写作用的；「选中一段」是另一种意图（接下来要润笔/问 Agent/分析），
 * 所以这里走 DOM 的 Range 把整段选起来——和鼠标拖选是同一个结果，后面所有动作都复用它。
 */
function selectWholeBlock(blockEl) {
  if (!blockEl) return null
  const range = document.createRange()
  range.selectNodeContents(blockEl)
  const selection = window.getSelection()
  if (!selection) return null
  selection.removeAllRanges()
  selection.addRange(range)
  const rect = range.getBoundingClientRect()
  const index = Number(blockEl.dataset.block)
  state.sel.text = (blockEl.textContent || '').trim()
  state.sel.blockIndex = index
  state.sel.para = index
  state.sel.rect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
  // 视觉上标出「这一段被选中」
  document.querySelectorAll('.doc-block.para-on').forEach((el) => el.classList.remove('para-on'))
  blockEl.classList.add('para-on')
  return { range, rect, index }
}

/** 清掉整段选中态。 */
function clearParaSelection() {
  document.querySelectorAll('.doc-block.para-on').forEach((el) => el.classList.remove('para-on'))
  state.sel.para = -1
}

/**
 * 段落操作浮窗（OS-37 核心）。
 * 作者口径：右键一段≈把这段框选出来，然后给三个动作——润笔 / 添加到 Agent / 分析这一段。
 */
const paraMenu = { el: null }

function ensureParaMenu() {
  if (paraMenu.el) return paraMenu.el
  const menu = document.createElement('div')
  menu.className = 'para-menu'
  menu.dataset.paramenu = '1'
  menu.innerHTML = [
    '<button data-action="para-polish">润笔</button>',
    '<button data-action="para-to-agent">添加到 Agent</button>',
    '<button data-action="para-analyze">分析这一段</button>'
  ].join('')
  document.body.appendChild(menu)
  paraMenu.el = menu
  return menu
}

function showParaMenu(blockEl, x, y) {
  const picked = selectWholeBlock(blockEl)
  if (!picked) return
  const menu = ensureParaMenu()
  menu.classList.add('on')
  // 贴右键位置，越界就翻到里侧
  const rect = menu.getBoundingClientRect()
  const left = Math.min(Math.max(8, x), window.innerWidth - rect.width - 8)
  const top = Math.min(Math.max(8, y), window.innerHeight - rect.height - 8)
  menu.style.left = `${left}px`
  menu.style.top = `${top}px`
}

function hideParaMenu() {
  if (paraMenu.el) paraMenu.el.classList.remove('on')
}

function showSelBar(picked) {
  const bar = ensureSelBar()
  bar.classList.add('on')
  const rect = picked.rect
  const top = Math.max(8, rect.top - 46)
  const left = Math.min(Math.max(8, rect.left + rect.width / 2 - 90), window.innerWidth - 200)
  bar.style.top = `${top}px`
  bar.style.left = `${left}px`
  state.sel.text = picked.text
  state.sel.blockIndex = Number(picked.blockEl.dataset.block)
  state.sel.rect = { top: rect.top, left: rect.left, width: rect.width, height: rect.height }
}

/** 选区上下文：所在块的整段＋前后各一块（给 Agent 足够语境又不淹）。 */
function selectionContext() {
  // 用 renderedBlocks()——与 data-block 同一套下标（已过滤 H1），否则有 H1 时整段错位一格
  const raw = renderedBlocks().map((block) => block.text)
  const index = state.sel.blockIndex
  const near = [raw[index - 1], raw[index], raw[index + 1]].filter((line) => typeof line === 'string' && line.trim())
  return near.join('\n\n')
}

/* ---------- 润笔：选区＋上下文 → Agent → 预览卡 ---------- */

/**
 * 默认临时会话（OS-39）。
 * 作者口径：临时插入一个润笔或分析，应优先在一个「默认固定」的会话上完成，
 * 而不是抢占正在聊的主会话。实现＝每库记一个 tempSessionId（库内 ui-state）：
 *  · 作者可在会话面板里把任意会话标成「临时」（再点一次取消）；
 *  · 没标过就自动用一条叫「临时需求」的会话（首次临时动作时自动创建）。
 */
const TEMP_SESSION_KEY = (root) => `openstory-temp-session::${root || ''}`
const TEMP_MODE_KEY = (root) => `openstory-temp-mode::${root || ''}`

/**
 * 临时需求路由模式（OS-39b，作者裁定为「选项」而非写死）：
 *  · 'fixed'（推荐默认）：润笔/添加到 Agent 都切到固定临时会话再发送——每次添加都会切过去；
 *  · 'current'：跟当前打开的会话走，不切换。
 */
function getTempMode() {
  const root = state.current?.path || ''
  if (!agent.tempModes) agent.tempModes = {}
  if (!(root in agent.tempModes)) {
    // OS-89：落库内 ui-state（同库同机同值，换机器也能复原）
    const saved = text(uiGet('agentTempMode', 'fixed')) || 'fixed'
    agent.tempModes[root] = saved === 'current' ? 'current' : 'fixed'
  }
  return agent.tempModes[root]
}

function setTempMode(mode) {
  const root = state.current?.path || ''
  if (!agent.tempModes) agent.tempModes = {}
  agent.tempModes[root] = mode === 'current' ? 'current' : 'fixed'
  uiSet('agentTempMode', agent.tempModes[root])
}

/** 临时需求路由：fixed 模式先切到固定临时会话，current 模式原地不动。 */
async function routeTemp() {
  if (getTempMode() === 'fixed') await ensureTempSession()
}

function getTempSessionId() {
  const root = state.current?.path || ''
  if (!agent.tempSessions) agent.tempSessions = {}
  if (!(root in agent.tempSessions)) {
    agent.tempSessions[root] = text(uiGet('agentTempSession', ''))
  }
  // 显式钉过就返回钉的那条；没钉过则动态认「临时需求」会话（自动模式也要在面板上标出来）
  const explicit = agent.tempSessions[root]
  if (explicit) return explicit
  const auto = agent.sessions.find((session) => session.title === '临时需求')
  return auto ? auto.id : ''
}

function setTempSessionId(id) {
  const root = state.current?.path || ''
  if (!agent.tempSessions) agent.tempSessions = {}
  agent.tempSessions[root] = id || ''
  uiSet('agentTempSession', id ? id : null)
}

/** 切到（必要时创建）默认临时会话。失败如实抛。 */
async function ensureTempSession() {
  if (agent.streaming) return
  await loadSessions()
  const pinned = getTempSessionId()
  if (pinned) {
    const found = agent.sessions.find((session) => session.id === pinned)
    if (found) {
      if (agent.sessionId !== pinned) await openSession(pinned)
      return
    }
    setTempSessionId('') // 钉住的会话被删了，回退自动
  }
  let found = agent.sessions.find((session) => session.title === '临时需求')
  if (!found) {
    const created = await api('/api/agent/sessions', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, title: '临时需求' })
    })
    found = created.session
    await loadSessions()
  }
  if (found && agent.sessionId !== found.id) await openSession(found.id)
}

/**
 * 润笔（OS-39 重做）：不再弹窗锁屏等 Agent——把这段作为上下文转发给左列 Agent，
 * 作者在 Agent 那边补一句要求、回车即可；回答落在会话里，可「转为待确认卡」写回正文。
 * 临时需求走默认临时会话（默认自动建「临时需求」，也可在会话面板里 📌 钉住某条），
 * 不抢占作者正在聊的主会话。
 */
async function startPolishRequest() {
  const quote = (state.sel.text || '').trim()
  if (!quote || !state.current) return
  if (dshBridgeAvailable()) {
    // 嵌入模式：润笔交给 DSH 会话——引用块 + 来源 + 提示语一起放进 DSH 输入框
    hideSelBar()
    hideParaMenu()
    window.getSelection?.()?.removeAllRanges?.()
    reportDshBridge(await sendToDshAgent({ quote, hint: openStorySourceNote() + '润笔这段，要求：' }))
    return
  }
  if (agent.streaming) {
    rememberAgentError('Agent 正在跑上一步，等它出结果再润笔（DSH 一次只能跑一个）。')
    renderAgent()
    hideSelBar()
    hideParaMenu()
    return
  }
  hideSelBar()
  hideParaMenu()
  window.getSelection?.()?.removeAllRanges?.()
  try {
    await routeTemp()
  } catch (error) {
    rememberAgentError(error)
    renderAgent()
    return
  }
  state.agent.pendingContext = {
    kind: 'polish',
    quote,
    context: selectionContext(),
    label: `润笔 · ${quote.length} 字`
  }
  renderAgent()
  const input = document.getElementById('agent-input')
  if (input) {
    input.value = '润笔这段，要求：'
    input.focus()
    // 光标落到末尾，作者接着写要求
    const end = input.value.length
    input.setSelectionRange?.(end, end)
  }
}

/* ---------- 与 Agent 讨论：选中段落作上下文，进左列会话 ---------- */

async function discussSelection() {
  if (!state.current) return
  if (dshBridgeAvailable()) {
    // 嵌入模式：真正的 Agent 是 DSH 会话，选段作为引用块进 DSH 输入框（附来源，便于调 openstory_* 工具）
    const quote = (state.sel.text || '').trim()
    hideSelBar()
    hideParaMenu()
    window.getSelection?.()?.removeAllRanges?.()
    if (quote) reportDshBridge(await sendToDshAgent({ quote, hint: openStorySourceNote() }))
    return
  }
  if (agent.streaming) {
    rememberAgentError('Agent 正在跑上一步，等它出结果再发。')
    renderAgent()
    hideSelBar()
    hideParaMenu()
    return
  }
  const context = selectionContext()
  hideSelBar()
  hideParaMenu()
  window.getSelection?.()?.removeAllRanges?.()
  try {
    await routeTemp() // fixed 模式＝切到固定临时会话再挂上下文；current 模式原地不动
  } catch (error) {
    rememberAgentError(error)
    renderAgent()
    return
  }
  state.agent.pendingContext = {
    kind: 'discuss',
    quote: state.sel.text,
    context: selectionContext(),
    label: `${state.sel.text.slice(0, 18)}${state.sel.text.length > 18 ? '…' : ''}（${state.sel.text.length} 字）`
  }
  renderAgent()
  const input = document.getElementById('agent-input')
  input?.focus()
}

/* ---------- 分析面板（OS-25/26）：插件自管，纯本地计算 ---------- */

let analyzeScrollTick = 0

/** 图表模块惰性加载（charts.mjs 与 analysis.mjs 同口径：浏览器本地，零依赖）。 */
let chartsModule = null
async function loadCharts() {
  if (!chartsModule) chartsModule = await import('./charts.mjs')
  return chartsModule
}

/**
 * fact 曲线数据（OS-41·对齐故事源线）：库内 故事源/ 的章级 序列/情绪/剧情点/事件数。
 * 按 root 缓存；拉不到（无故事源数据/网络失败）＝fact:null，面板降级到本地词典近似层。
 */
async function loadFactCurve(force = false) {
  const rootPath = state.current?.path ?? ''
  if (!rootPath) return
  if (!force && state.analyze.factRoot === rootPath && state.analyze.fact !== null) return
  if (!force && state.analyze.factRoot === rootPath && state.analyze.fact === null && state.analyze.factTried) return
  state.analyze.factRoot = rootPath
  state.analyze.factTried = true
  try {
    const payload = await api(`/api/fact/curve?${new URLSearchParams({ root: rootPath }).toString()}`)
    state.analyze.fact = payload?.chapters?.length ? payload : null
  } catch {
    state.analyze.fact = null
  }
  if (state.analyze.open) renderAnalyzePanel()
}

/** 章号 ← 文件名（NNN-标题.md 约定，与 daemon/chapters 同口径）。 */
function chapterNoFromFile(file) {
  const m = String(file ?? '').match(/(\d+)/)
  return m ? Number(m[1]) : 0
}

async function runAnalysis() {
  if (!state.chapterLoaded) return
  await loadAnalysis()
  await loadAnalysisModules()
  await loadCharts()
  loadFactCurve()
  state.analyze.busy = true
  renderAnalyzePanel()
  try {
    const paragraphs = analysisParagraphs()
    await loadHabits()
    // S3：本章分析走模块注册表（引擎经 context 注入，保持与 analysis.mjs 的松耦合）
    state.analyze.result = await analysisModules.runModule('chapter-editorial', {
      text: state.chapterText,
      paragraphs,
      habits: state.habits,
      analyze: analysisModule.analyzeChapter
    })
  } catch (error) {
    state.analyze.result = null
    rememberAgentError(error)
  }
  state.analyze.busy = false
  renderAnalyzePanel()
  paintDocAnnotations()
  if (analyzeEnabled().some((id) => analyzeModuleById(id)?.scope === 'work')) loadWorkAnalysis()
}

/**
 * 选区级分析（OS-37→OS-39）：把全章分析引擎收窄到你框住的那一段/那几句。
 * 作者口径：全章分析是全局功能，框选/右键也应该能只针对选中的内容做分析。
 * 复用同一个 analyzeChapter（它本来就接受任意段落数组），结果落独立浮窗，
 * 不覆盖右栏的全章分析结果，也不锁屏。
 */
async function analyzeSelection({ text, label, para = -1 } = {}) {
  const selected = (text ?? state.sel.text ?? '').trim()
  if (!selected) return
  await loadAnalysis()
  state.sel.paraResult = { para, label, text: selected, loading: true, result: null, error: '' }
  hideParaMenu()
  hideSelBar()
  renderParaResult()
  try {
    const result = analysisModule.analyzeChapter(selected, { paragraphs: [selected] })
    state.sel.paraResult = { para, label, text: selected, loading: false, result, error: '' }
  } catch (error) {
    state.sel.paraResult = { para, label, text: selected, loading: false, result: null, error: humanizeAgentError(error) }
  }
  renderParaResult()
}

/** 单段分析结果面板（浮窗，可关）。 */
function renderParaResult() {
  const data = state.sel.paraResult
  const host = document.getElementById('para-result')
  if (!host) return
  if (!data) { host.classList.remove('on'); host.innerHTML = ''; return }
  host.classList.add('on')
  if (data.loading) {
    host.innerHTML = '<div class="pr-head"><b>分析这一段</b><span class="sp"></span><button class="pr-x" data-action="para-result-close">×</button></div><div class="pr-body"><div class="loading">正在分析…</div></div>'
    return
  }
  if (data.error) {
    host.innerHTML = `<div class="pr-head"><b>分析这一段</b><span class="sp"></span><button class="pr-x" data-action="para-result-close">×</button></div><div class="pr-body"><div class="error-box">${esc(data.error)}</div></div>`
    return
  }
  const r = data.result
  if (!r) { host.innerHTML = ''; host.classList.remove('on'); return }
  const stats = r.stats
  const aiClass = r.aiSmell.score >= 50 ? 'bad' : r.aiSmell.score >= 25 ? 'mid' : 'good'
  // 单段的问题清单（引擎按段跑，issues 自然只属于这一段）
  const issueRows = r.issues.map((issue) =>
    `<div class="issue-card sev-${esc(issue.severity)}">
      <div class="ic-head"><span class="ic-tag">${esc(issue.label)}</span></div>
      <div class="ic-detail">${esc(issue.detail)}</div>
    </div>`).join('')
  host.innerHTML = `<div class="pr-head">
      <b>分析这一段</b><span class="count">${data.label || `第 ${data.para + 1} 段`} · ${stats.chars} 字</span>
      <span class="sp"></span><button class="pr-x" data-action="para-result-close" title="关闭">×</button>
    </div>
    <div class="pr-body">
      <div class="analyze-kpis">
        <span><b>${stats.avgSentenceLen}</b> 字/句</span>
        <span><b>${stats.dialogueRatio}%</b> 对白</span>
        <span><b>${stats.sentences}</b> 句</span>
        <span>AI 味 <b class="ai-score ${aiClass}">${r.aiSmell.score}</b></span>
      </div>
      ${r.rhythm?.length > 1 ? `<div class="pr-sec"><h5>句子长度</h5>${sparkline(r.rhythm.map((x) => x.chars), { color: 'var(--ok)' })}</div>` : ''}
      ${r.aiSmell.factors.length ? `<div class="pr-sec"><h5>AI 味构成</h5>${r.aiSmell.factors.map(barRow).join('')}</div>` : ''}
      <div class="pr-sec"><h5>这一段的问题 <span class="count">${r.issues.length}</span></h5>
        ${issueRows || '<p class="sub">这一段没有明显问题。</p>'}</div>
      <div class="ops">
        <button class="btn-ghost" data-action="para-analyze">重新分析</button>
      </div>
    </div>`
}

/** 分析用的段落（与渲染块一致；去掉大标题）。 */
function analysisParagraphs() {  if (!mdReady || !mdModule) return []
  return mdModule.splitBlocks(state.chapterText)
    .filter((block) => !/^\s*#\s+/u.test(block.text))
    .map((block) => block.text)
}

/** 折线（SVG viewBox，零图表库）。 */
function sparkline(values, opts) { return analysisViews?.sparkline(values, opts)  }

function barRow(factor) { return analysisViews?.barRow(factor)  }

/* ---------- 分析模块选装（S3）：注册表在 public/analysisModules.mjs ---------- */

const ANALYZE_ENABLED_KEY = (root) => `openstory-analysis-enabled::${root || ''}`
const ANALYZE_DEFAULT_MODULES = Object.freeze(['chapter-editorial'])

/** 注册表里的模块（未装载时返回空——调用方按「装载中」降级）。 */
function analyzeModulesFor(scope) {
  return analysisModules ? analysisModules.modulesFor(scope) : []
}

function analyzeModuleById(id) {
  return analysisModules ? analysisModules.moduleById(id) : null
}

/**
 * 已启用的分析模块（库内 ui-state，照 hiddenTabs 的键模式）。
 * 键不存在＝作者从未表态 → 只开「本章编辑总评」（保持改造前的默认体验）。
 */
function analyzeEnabled() {
  const root = state.current?.path || ''
  if (state.analyze.enabledRoot !== root) {
    // OS-89：启用的分析模块落库内 ui-state
    const saved = uiGet('analyzeEnabled', null)
    state.analyze.enabled = Array.isArray(saved)
      ? saved.filter((id) => typeof id === 'string')
      : [...ANALYZE_DEFAULT_MODULES]
    state.analyze.enabledRoot = root
  }
  return state.analyze.enabled
}

function toggleAnalyzeModule(id) {
  const mod = analyzeModuleById(id)
  if (!mod) return
  const enabled = [...analyzeEnabled()]
  const at = enabled.indexOf(id)
  if (at >= 0) enabled.splice(at, 1)
  else enabled.push(id)
  state.analyze.enabled = enabled
  const root = state.current?.path || ''
  uiSet('analyzeEnabled', [...enabled]) // OS-89：落库内
  state.analyze.pickerOpen = false
  if (mod.scope === 'chapter') {
    if (at < 0 && !state.analyze.result) runAnalysis()
  } else if (at < 0) {
    delete state.analyze.work[id]
    state.analyze.workLoaded = false
    loadWorkAnalysis()
  }
  renderAnalyzePanel()
}

/** 「＋ 分析」选择器：本章模块 + 整部作品模块，勾选即启用。 */
function analyzePickerHtml() { return analysisViews?.analyzePickerHtml()  }

/** 正文右栏的 work 模块卡：取数→结论，头部带「在故事源中查看」。 */
function analyzeWorkCardHtml(mod) { return analysisViews?.analyzeWorkCardHtml(mod)  }

/** 本章模块需要的外部状态（注册表不读全局 state——由这里注入）。 */
function analyzeChapterView() { return analysisViews?.analyzeChapterView()  }

/**
 * 分析面板（S3 封装化）：模块选择器 + 已选模块渲染。
 * 本章模块吃 analyzeChapter 的结果；work 模块吃 loadWorkAnalysis 拉来的整书数据。
 * 默认只启用 chapter-editorial —— 与改造前的整块面板完全一致。
 */
function analyzePanelHtml() { return analysisViews?.analyzePanelHtml()  }

/**
 * work 级模块的数据（S3）：/api/fact/entries ＋ /api/fact/curve → storySource layout → 模块 run。
 * 论证口径与故事源完全同源（stats.charts 是单一真源），右栏不另算一套。
 */
async function loadWorkAnalysis(force = false) {
  if (!state.chapterLoaded || !state.current) return
  const enabledWork = analyzeEnabled().map(analyzeModuleById).filter((mod) => mod && mod.scope === 'work')
  if (!enabledWork.length) return
  const root = state.current.path
  const sameRoot = state.analyze.workRoot === root
  if (!force && sameRoot && (state.analyze.workLoaded || state.analyze.workLoading)) return
  state.analyze.workRoot = root
  if (!sameRoot || force) {
    state.analyze.work = {}
    state.analyze.workLoaded = false
  }
  state.analyze.workLoading = true
  for (const mod of enabledWork) state.analyze.work[mod.id] = null
  renderAnalyzePanel()
  try {
    const [ss, am] = await Promise.all([ensureStorySourceModule(), loadAnalysisModules()])
    const q = `root=${encodeURIComponent(root)}`
    const [curvePayload, entriesPayload] = await Promise.all([
      api(`/api/fact/curve?${q}`).catch(() => null),
      api(`/api/fact/entries?${q}&limit=500`).catch(() => null)
    ])
    const entries = Array.isArray(entriesPayload?.entries) ? entriesPayload.entries : []
    const wiki = {
      chapterSummaries: (curvePayload?.chapters || []).map((chapter) => ({
        chapter: chapter.no,
        title: chapter.title,
        summary: chapter.summary,
        function: chapter.function,
        emotion: chapter.emotion,
        beats: chapter.beats,
        events: chapter.events,
        foreshadows: chapter.foreshadows
      }))
    }
    const layout = entries.length ? ss.layoutStorySource({ entries, wiki, view: 'chart' }) : null
    const focus = state.sel.text ? { text: state.sel.text.slice(0, 200), paragraph: state.analyze.activePara } : null
    for (const mod of enabledWork) {
      try {
        state.analyze.work[mod.id] = { result: await am.runModule(mod.id, { entries, wiki, layout, focus }) }
      } catch (error) {
        state.analyze.work[mod.id] = { error: text(error?.message || error) }
      }
    }
    state.analyze.workLoaded = true
  } catch (error) {
    for (const mod of enabledWork) state.analyze.work[mod.id] = { error: text(error?.message || error) }
  }
  state.analyze.workLoading = false
  if (state.analyze.open) renderAnalyzePanel()
}

/** 「在故事源中查看」：跳故事源 → 图表形态 → 切到同一个模块。 */
function openStorySourceModule(moduleId) {
  const id = analyzeModulesFor('work').some((mod) => mod.id === moduleId) ? moduleId : 'plot-curve'
  state.ssJump = { module: id }
  go('dir:故事源')
}

/** 故事源条目 → 正文：先切页，等章节清单回来再按章号挑文件（P1 只定位到章）。 */
async function jumpToWriteChapter(no) {
  const chapterNo = Number(no)
  if (!chapterNo || !state.current) return
  go('chapters')
  await loadWriteChapters()
  const file = (state.write.chapters || []).find((chapter) => chapterNoFromFile(chapter.file) === chapterNo)?.file
  if (file) loadChapter(file)
}


function renderAnalyzePanel() {
  const panel = document.getElementById("analyze-panel")
  if (!panel) return
  const open = state.analyze.open && state.chapterLoaded
  panel.classList.toggle("open", open)
  // OS-88：浮层打开＝正文滚动区补右侧内边距（纸面让位），不再压住正文
  panel.closest('.doc-workspace-sticky')?.classList.toggle('has-analyze', open)
  document.querySelector('[data-action="analyze-toggle"]')?.classList.toggle('on', open)
  if (!open) return
  const name = state.chapterFile ? state.chapterFile.split("/").pop() : ""
  panel.innerHTML = '<div class="analyze-head"><span class="rm-title">分析</span><span class="rm-badge">' + esc(name) + '</span><span class="sp"></span><button class="rm-x" data-action="analyze-close" title="关闭" aria-label="关闭">×</button></div>' + analyzePanelHtml()
  paintDocAnnotations()
  syncAnalyzeScroll({ force: true })
}

/** 正文滚动容器（正文页自己滚，不靠外层 .content）。 */
function docScroller() {
  return document.getElementById('doc-scroll')
}

/**
 * 吸顶同步（OS-33）。
 * 右栏是「聚焦式」结构：概览固定，下面是「本段批注」区。正文滚动时只做两件事：
 *   ① 算出当前视口顶部所在的段落；
 *   ② 如果它变了，重画右栏那一段的内容（并高亮左侧对应竖条）。
 * 不滚动右栏——所以「本段批注」永远紧贴概览，永远和你看的段落对齐。
 */
function syncAnalyzeScroll({ force = false } = {}) {
  const scroller = docScroller()
  const panel = document.getElementById('analyze-panel')
  if (!scroller || !panel || !panel.classList.contains('open')) return
  const lines = [...scroller.querySelectorAll('.doc-line')]
  if (!lines.length) return
  // 锚点：视口顶部往下 1/3 处。取「顶部越过这条线的最靠下那一段」＝视口里占面积最大的段。
  // （用 1/3 而不是固定像素，是因为跳转后段顶常落在视口顶部附近十几到一百多像素，固定阈值会漏判。）
  const scrollerRect = scroller.getBoundingClientRect()
  const anchor = scrollerRect.top + scrollerRect.height / 3
  let viewTop = 0
  for (let i = 0; i < lines.length; i += 1) {
    if (lines[i].getBoundingClientRect().top <= anchor) viewTop = i
    else break
  }
  // 若下一段的顶部也已在视口内（且更靠近顶部），说明它才是「正在看的段」
  const nextLine = lines[viewTop + 1]
  if (nextLine && nextLine.getBoundingClientRect().top <= scrollerRect.top + 120) {
    viewTop += 1
  }
  if (!force && state.analyze.activePara === viewTop) return
  state.analyze.activePara = viewTop
  // 重画内容（只换问题区，不动概览滚动位置）
  const keepTop = panel.scrollTop
  const head = panel.querySelector('.analyze-head')
  panel.innerHTML = (head?.outerHTML ?? '') + analyzePanelHtml()
  panel.scrollTop = keepTop
  // 左侧竖条高亮当前段
  scroller.querySelectorAll('.doc-gutter.has-issue').forEach((bar) => {
    bar.classList.toggle('on', Number(bar.dataset.blockIndex) === viewTop)
  })
}

/** 文档内标注（OS-33）：有问题的段落在左侧长出一根可点竖条——点它＝跳到那段＋右栏对齐。 */
function paintDocAnnotations() {
  const result = state.analyze.result
  document.querySelectorAll('.doc-line').forEach((line) => {
    line.classList.remove('has-issue', 'sev-high', 'sev-medium', 'sev-low')
    line.querySelector('.doc-gutter')?.classList.remove('has-issue', 'on', 'sev-high', 'sev-medium', 'sev-low')
  })
  if (!result) return
  const byParagraph = new Map()
  const rank = { high: 3, medium: 2, low: 1 }
  for (const issue of result.issues) {
    if (state.analyze.dismissed[issue.id]) continue
    const list = Array.isArray(issue.paragraphs) && issue.paragraphs.length ? issue.paragraphs : [issue.paragraph]
    for (const n of list) {
      if (!Number.isInteger(n) || n < 0) continue
      const prev = byParagraph.get(n)
      if (!prev || (rank[issue.severity] || 0) > (rank[prev] || 0)) byParagraph.set(n, issue.severity)
    }
  }
  for (const entry of byParagraph) {
    const line = document.querySelector(`.doc-line[data-line="${entry[0]}"]`)
    if (!line) continue
    line.classList.add('has-issue', 'sev-' + entry[1])
    const bar = line.querySelector('.doc-gutter')
    if (bar) bar.classList.add('has-issue', 'sev-' + entry[1])
  }
}

function toggleAnalyzePanel() {
  state.analyze.open = !state.analyze.open
  renderAnalyzePanel()
  if (state.analyze.open) {
    loadCharts().then(() => { if (state.analyze.open) renderAnalyzePanel() }).catch(() => {})
    loadFactCurve()
    loadWorkAnalysis()
    if (!state.analyze.result) runAnalysis()
  }
}

function dismissIssue(issueId) {
  state.analyze.dismissed[issueId] = true
  renderAnalyzePanel()
  paintDocAnnotations()
}

function gotoParagraph(index) {
  const n = Number(index)
  const line = document.querySelector(`.doc-line[data-line="${n}"]`)
  const block = line?.querySelector('.doc-block') || document.querySelectorAll('.doc-block')[n]
  if (!block) return
  const scroller = docScroller()
  // 「点竖条跳转」是精确对齐动作：用即时定位（平滑滚动会和面板重画抢时序，
  // 最终常常停在差一两段的位置，右栏也就对不上）。两帧各校一次，抗布局抖动。
  const align = () => {
    if (!scroller || !line) return
    const delta = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top
    scroller.scrollTop = Math.max(0, scroller.scrollTop + delta - 10)
  }
  if (scroller) {
    align()
    requestAnimationFrame(align)
  } else {
    block.scrollIntoView({ block: 'center' })
  }
  block.classList.add('issue-flash')
  setTimeout(() => block.classList.remove('issue-flash'), 1200)
  // 右栏跟着切到这一段：滚动落位后再同步（两帧 + 一次延时，抗平滑/布局抖动）
  if (state.analyze.open) {
    state.analyze.activePara = -1 // 强制刷新
    requestAnimationFrame(() => {
      align()
      syncAnalyzeScroll({ force: true })
      setTimeout(() => { align(); syncAnalyzeScroll({ force: true }) }, 120)
    })
  }
}

/** 点段落左侧竖条：跳到那段 + 右栏把它的问题卡贴顶。 */
function gutterJump(index) {
  if (!state.analyze.open) {
    state.analyze.open = true
    renderAnalyzePanel()
    if (!state.analyze.result) runAnalysis()
  }
  gotoParagraph(index)
}

/** 让 Agent 改：问题＋所在段落做上下文，交给 Agent 讨论流。 */
function fixIssueWithAgent(issueId) {
  const result = state.analyze.result
  const issue = result ? result.issues.find((item) => item.id === issueId) : null
  if (!issue) return
  const paragraphs = analysisParagraphs()
  const text = paragraphs[issue.paragraph] || ""
  state.agent.pendingContext = {
    quote: issue.excerpt,
    context: text,
    label: issue.label + "（第 " + (Number(issue.paragraph) + 1) + " 段）"
  }
  state.analyze.open = false
  renderAnalyzePanel()
  paintDocAnnotations()
  renderAgent()
  const input = document.getElementById("agent-input")
  if (input) input.focus()
}

async function createChapterFlow() {
  const input = document.getElementById('chapter-new-title')
  await loadPlugins() // 写作套件的默认标题要新鲜（单一装载）
  let title = text(input?.value).trim()
  if (!title) title = text(suiteValue('newChapterTitle', 'writing', '')).trim()
  if (!title) {
    state.error = '先填新章标题（或在设置·套件·写作里配默认标题）。'
    render()
    return
  }
  state.error = ''
  try {
    const payload = await api('/api/chapters', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, dir: '正文', title })
    })
    state.chapterFile = payload.chapter.file
    state.chapterText = ''
    state.chapterLoaded = true
    state.savedAt = ''
    state.chapterNote = `新章已建：${payload.chapter.name}`
    if (input) input.value = ''
    await loadWriteChapters({ force: true })
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  render()
  document.getElementById('chapter-editor')?.focus()
}

async function renameChapterFlow() {
  const current = state.write.chapters.find((chapter) => chapter.file === state.chapterFile)
  const currentTitle = current?.title || (state.chapterFile ? state.chapterFile.split('/').pop()?.replace(/^(\d{1,4}[-_.—、·:：\s]+)/u, '') : '')
  const title = globalThis.prompt?.('重命名章节（保号，只改标题）', currentTitle)
  if (title === null) return
  const next = text(title).trim()
  if (!next || next === currentTitle) return
  state.error = ''
  try {
    const payload = await api('/api/chapters/rename', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, file: state.chapterFile, title: next })
    })
    state.chapterFile = payload.chapter.file
    state.chapterNote = `已重命名为 ${payload.chapter.name}`
    await loadWriteChapters({ force: true })
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  render()
}

async function deleteChapterFlow() {
  const current = state.write.chapters.find((chapter) => chapter.file === state.chapterFile)
  const confirmed = globalThis.confirm?.(`删除《${current?.title || state.chapterFile}》？原稿会挪进 .history 备份，不会真丢。`)
  if (!confirmed) return
  state.error = ''
  try {
    const payload = await api(`/api/chapter?root=${encodeURIComponent(state.current.path)}&file=${encodeURIComponent(state.chapterFile)}`, { method: 'DELETE' })
    state.chapterNote = `已删除（备份：${payload.backup}）`
    state.chapterFile = ''
    state.chapterText = ''
    state.chapterLoaded = false
    state.savedAt = ''
    await loadWriteChapters({ force: true })
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  render()
}

function writeHtml() {
  if (!state.current) return needLibraryHtml()
  if (state.write.listLoading) return '<div class="loading">正在读取章节…</div>'

  const rows = state.write.chapters.map((chapter) => `
    <button class="ch-row${chapter.file === state.chapterFile ? ' on' : ''}" data-chapter-file="${esc(chapter.file)}" title="${esc(chapter.file)}">
      <span class="no">${chapter.no !== null ? String(chapter.no).padStart(2, '0') : '—'}</span>
      <span class="tt">${esc(chapter.title)}</span>
      <span class="sz">${formatBytes(chapter.chars)}</span>
    </button>`).join('')
  const currentChapter = state.write.chapters.find((chapter) => chapter.file === state.chapterFile)
  const idx = state.write.chapters.findIndex((chapter) => chapter.file === state.chapterFile)
  const prev = idx > 0 ? state.write.chapters[idx - 1] : null
  const next = idx >= 0 && idx < state.write.chapters.length - 1 ? state.write.chapters[idx + 1] : null
  const saved = state.savedAt ? `<span class="saved-chip">已保存 · ${esc(formatAt(state.savedAt))}</span>` : ''
  const note = state.chapterNote ? `<span class="count">${esc(state.chapterNote)}</span>` : ''
  applyDocPrefs()
  const editor = state.chapterLoaded
    ? (mdReady ? renderDocBody(state.chapterText) : '<div class="loading">渲染器载入中…</div>')
    : `<div class="empty-state">
        <h2>选一章开始</h2>
        <p>左侧点章节载入；或输入标题新建一章（自动编号）。章节就是 <span class="hint">正文/NNN-标题.md</span> 文件，所有修改都在本机留备份与日志。</p>
      </div>`

  const chapterNo = currentChapter?.no
  // 标题去重：md 里首个 H1 就是章名（如「第一章」），有它就不再拿文件名当大标题
  const mdHeading = (() => {
    const match = String(state.chapterText || '').match(/^\s*#\s+(.+)$/mu)
    return match ? match[1].trim() : ''
  })()
  const docTitle = mdHeading || currentChapter?.title || state.chapterFile?.split('/').pop() || '正文'
  return `<div class="doc-workspace doc-workspace-sticky">
    <header class="doc-head doc-head-immersive">
      <div class="docline">
        <span class="kick">${esc(state.current.name)}</span>
        <span class="docline-sep">·</span>
        <span class="chap-no">${chapterNo !== undefined && chapterNo !== null ? `第 ${chapterNo} 章` : '未编号'}</span>
        <span class="docline-sep">·</span>
        <span id="chapter-chars">${state.chapterText.length} 字</span>
        <span class="docline-sep">·</span>
        <span class="count">${state.chapterMetaAt ? `改于 ${esc(formatAt(state.chapterMetaAt))}` : ''}</span>
        <span class="sp"></span>
        <span class="doc-autosave" id="doc-autosave"></span>
        <button class="doc-drawer-btn" data-action="refcol-toggle" title="世界书" aria-label="世界书">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6h11M2.5 10h11" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="doc-drawer-btn" data-action="analyze-toggle" aria-label="分析本章"${slotAction('right', 'analysis', '分析本章')}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.6A5.4 5.4 0 0 1 13.4 8H8z" fill="currentColor"/></svg></button>
        <button class="doc-icon" data-action="doc-more" title="本章（版本历史 / 重命名 / 删除 / 显示设置）" aria-label="本章">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.4" cy="8" r="1.35" fill="currentColor"/><circle cx="8" cy="8" r="1.35" fill="currentColor"/><circle cx="12.6" cy="8" r="1.35" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="doc-title-row">
        <h1 class="doc-title">${esc(docTitle)}</h1>
        <div class="doc-actions">
          <button class="doc-link" data-action="chapter-nav" data-file="${esc(prev?.file ?? '')}"${prev ? '' : ' disabled'} title="上一章">←</button>
          <button class="doc-link" data-action="chapter-nav" data-file="${esc(next?.file ?? '')}"${next ? '' : ' disabled'} title="下一章">→</button>
        </div>
      </div>
      <div class="doc-mini-meta">${saved}${note}</div>
      ${errorHtml()}
    </header>
    <div class="chapter-grid">
      ${refColHtml()}
      <div class="doc-scroll" id="doc-scroll">
        <div class="chapter-editor-col">${editor}</div>
      </div>
      <aside class="analyze-panel" id="analyze-panel"></aside>
    </div>
  </div>`
}




/* ---------- Agent 左列（OS-4）---------- */

const agent = state.agent

/**
 * 模型 chip（OS-31 修）：运行时清单与 config 是两个独立异步，谁先回来都可能让别人算出空标签。
 * 规则：能说出具体东西才显示，否则整个 chip 收起来——绝不摆一个空药丸。
 */
function updateAgentChip() {
  const chip = document.getElementById('agent-model-chip')
  if (!chip) return
  const kit = agent.runtimeList.find((item) => item.id && item.id === agent.runtime)
  // OS-150b：chip 取值走纯函数——fixture 套件降级显示「内置默认」，绝不把夹具名摆给作者
  const view = runtimeShelf?.agentChipView(kit, agent) ?? { hidden: true, text: '', on: false, title: '' }
  chip.hidden = view.hidden
  chip.textContent = view.text
  chip.classList.toggle('on', view.on)
  chip.title = view.title
}

async function loadAgentRuntimes() {
  try {
    const payload = await api('/api/agent/runtimes')
    agent.runtimeList = Array.isArray(payload.runtimes) ? payload.runtimes : []
    agent.runtime = text(payload.active)
    state.settings.userDir = text(payload.userDir)
  } catch {
    agent.runtimeList = []
  }
}

function updateComposerState() {
  const input = document.getElementById('agent-input')
  const send = document.getElementById('agent-send')
  const libChip = document.getElementById('agent-lib-chip')
  if (!input || !send) return
  input.disabled = !state.current || agent.streaming
  send.disabled = !state.current || !agent.configured || agent.streaming
  // 流式时发送键换成停止键（OS-51）：之前停止按钮没有任何显隐控制，红色 ■ 一直挂在那
  const stopBtn = document.getElementById('agent-stop')
  if (stopBtn) stopBtn.hidden = !agent.streaming
  if (send) send.hidden = Boolean(agent.streaming)
  const polish = agent.pendingContext?.kind === 'polish'
  const modeChip = document.getElementById('agent-mode-chip')
  if (modeChip) {
    // OS-51：模式不再占一颗药丸——只在润笔上下文挂着时显示小灰字
    modeChip.hidden = !polish
    modeChip.textContent = polish ? '润笔' : '对话'
  }
  const styleBtn = document.getElementById('agent-style-btn')
  if (styleBtn) styleBtn.classList.toggle('on', polish)
  input.placeholder = !state.current
    ? '先选一个库，再和 Agent 聊…'
    : !agent.configured
      ? '先点右上角「设置」配置模型端点…'
      : polish
        ? '补一句润笔要求（如：更冷峻、去掉形容词），回车发给 Agent'
        : '问问剧情、要一段正文…（Enter 发送，Shift+Enter 换行）'
  if (libChip) libChip.textContent = state.current ? state.current.name : '未选库'
}

/* ---------- 输入区工具菜单（OS-51）：风格 / ＋，对齐其它 Agent 的输入行 ---------- */

function closeComposerMenus() {
  for (const id of ['agent-style-menu', 'agent-plus-menu']) {
    const el = document.getElementById(id)
    if (el) el.hidden = true
  }
  document.getElementById('agent-style-btn')?.classList.remove('on')
  document.getElementById('agent-plus-btn')?.classList.remove('on')
}

function toggleComposerMenu(which) {
  const menu = document.getElementById(which === 'style' ? 'agent-style-menu' : 'agent-plus-menu')
  const other = document.getElementById(which === 'style' ? 'agent-plus-menu' : 'agent-style-menu')
  if (other) other.hidden = true
  if (!menu) return
  const willOpen = menu.hidden
  closeComposerMenus()
  if (!willOpen) return
  menu.innerHTML = which === 'style' ? genreMenuHtml() : plusMenuHtml()
  if (which === 'style' && !(state.genres || []).length) loadGenres().then(() => { const menu = document.getElementById('agent-style-menu'); if (menu && !menu.hidden) menu.innerHTML = genreMenuHtml() })
  if (which === 'style') refreshAgentSkillsMenu()
  menu.hidden = false
  if (which === 'plus') refreshAgentSkillsMenu()
  document.getElementById(which === 'style' ? 'agent-style-btn' : 'agent-plus-btn')?.classList.add('on')
}

/** 灯泡菜单＝知识库选择链（OS-70 作者模型）：题材 → 风格词条 → 方法论，选完全局生效并裁剪注入。
 * 层级：生效说明 → 知识库标注卡（体裁 agentPolicy 原生标注，每轮注入 prompt 的就是这些）→
 * 题材（单选，写 brief.json）→ 风格词条（style-* 单选，写作只认一种主导文风）→ 方法论（多选）。
 * 与「＋」菜单分工：这里选的是持久知识层，＋ 里是一次性任务工具。 */
function genreMenuHtml() {
  const polish = agent.pendingContext?.kind === 'polish'
  const cur = state.briefGenre
  const picks = state.agent.picks
  const explicit = state.agent.picksExplicit === true
  const skills = Array.isArray(state.agent.skills) ? state.agent.skills : []
  const craft = skills.filter((skill) => skill.category === 'craft')
  const styleSkills = craft.filter((skill) => String(skill.name).startsWith('style-'))
  const methodSkills = craft.filter((skill) => !String(skill.name).startsWith('style-'))
  const autoMethods = methodSkills.filter((skill) => !state.briefGenre || !Array.isArray(skill.genres) || skill.genres.includes('*') || skill.genres.includes(state.briefGenre.id)).map((skill) => skill.name)
  const activeMethods = explicit && picks ? picks.methods : autoMethods
  const activeStyle = explicit && picks ? (picks.style || '') : ''

  // —— 知识库标注卡：当前体裁的原生标注（零自编文案，全部来自 genres/*.json）——
  let kbCard = ''
  if (cur) {
    const pol = cur.agentPolicy || {}
    const kbRow = (k, v) => v ? `<div class="knowledge-row"><span class="knowledge-k">${esc(k)}</span><span class="knowledge-v">${esc(v)}</span></div>` : ''
    const unit = cur.length?.unit === 'episodes' ? '集' : cur.length?.unit === 'minutes' ? '分钟' : '字'
    const div = cur.length?.divideBy === 'chapter' ? '章' : cur.length?.divideBy === 'episode' ? '集' : cur.length?.divideBy === 'scene' ? '场' : ''
    const lenParts = []
    if (cur.length?.total?.target) lenParts.push(`总约 ${cur.length.total.target} ${unit}（${cur.length.total.min ?? '–'}–${cur.length.total.max ?? '–'}）`)
    if (div && cur.length?.perUnit?.target) lenParts.push(`每${div}约 ${cur.length.perUnit.target} ${unit}`)
    kbCard = `<div class="knowledge-card"><div class="knowledge-head">知识库 · ${esc(cur.name)}<span class="knowledge-sub">以下标注每轮注入 Agent</span></div>
      ${kbRow('节奏', pol.pacing)}
      ${kbRow('开篇', pol.openHook)}
      ${kbRow('审阅重点', (pol.reviewFocus || []).join('；'))}
      ${kbRow('禁忌', (pol.forbidden || []).join('；'))}
      ${kbRow('篇幅', lenParts.join('；'))}
      ${(cur.knowledgePacks || []).length ? `<div class="knowledge-row"><span class="knowledge-k">知识包</span><span class="knowledge-v">${cur.knowledgePacks.map((t) => `<span class="knowledge-tag">${esc(t)}</span>`).join('')}</span></div>` : ''}
    </div>`
  }

  // —— 级1 题材 ——
  const genres = Array.isArray(state.genres) ? state.genres : []
  const genreGroups = []
  for (const [tier, label] of [['primary', '主打体裁'], ['extended', '扩展体裁']]) {
    const list = genres.filter((genre) => (genre.tier || 'primary') === tier)
    if (!list.length) continue
    genreGroups.push(`<div class="pop-title">${esc(label)}<span class="pop-hint">单选 · 写进库的简报</span></div>`)
    for (const genre of list) {
      const on = cur?.id === genre.id
      genreGroups.push(`<div class="pop-item genre-item" data-action="genre-pick" data-genre-id="${esc(genre.id)}"><span class="pi-ic">${on ? '✓' : tier === 'primary' ? '✦' : '◇'}</span><span class="genre-main"><b>${esc(genre.name)}${on ? '<i class="on-tag">生效中</i>' : ''}</b><i class="genre-desc">${esc(genre.summary || '')}</i></span></div>`)
    }
  }

  // —— 级2 风格词条（style-* 单选）——
  const styleRows = [`<div class="pop-item genre-item" data-action="pick-style" data-skill-name=""><span class="pi-ic">${activeStyle ? '○' : '✓'}</span><span class="genre-main"><b>不指定</b><i class="genre-desc">中性文风——只按体裁策略写</i></span></div>`]
  for (const skill of styleSkills) {
    const on = activeStyle === skill.name
    styleRows.push(`<div class="pop-item genre-item" data-action="pick-style" data-skill-name="${esc(skill.name)}"><span class="pi-ic">${on ? '✓' : '○'}</span><span class="genre-main"><b>${esc(skill.name)}${on ? '<i class="on-tag">主导文风</i>' : ''}</b><i class="genre-desc">${esc(skill.description || '')}</i></span><button class="skill-peek" data-action="skill-peek" data-skill-name="${esc(skill.name)}" title="看这篇 SKILL.md 全文">…</button></div>`)
  }

  // —— 级3 方法论（多选）——
  const methodRows = methodSkills.map((skill) => {
    const on = activeMethods.includes(skill.name)
    return `<div class="pop-item genre-item" data-action="toggle-method" data-skill-name="${esc(skill.name)}"><span class="pi-ic">${on ? '☑' : '☐'}</span><span class="genre-main"><b>${esc(skill.name)}</b><i class="genre-desc">${esc(skill.description || '')}</i></span><button class="skill-peek" data-action="skill-peek" data-skill-name="${esc(skill.name)}" title="看这篇 SKILL.md 全文">…</button></div>`
  }).join('')

  const foot = []
  if (polish) foot.push(`<div class="pop-item" data-action="clear-agent-context"><span class="pi-ic">✕</span><b>清除当前上下文</b><i>${esc((agent.pendingContext?.label || '').slice(0, 24))}</i></div>`)
  const status = `${esc(state.current?.name || '未选库')} · ${esc(agent.model || (agent.configured ? '已配置' : '未配置端点'))}`
  foot.push(`<div class="pop-foot">会话绑定：${status}</div>`)

  const head = cur
    ? `<div class="pop-note">当前生效 <b>${esc(cur.name)}</b>${activeStyle ? `＋文风 <b>${esc(activeStyle.replace(/^style-/, ''))}</b>` : ''}——之后所有成文与分析按这条链走</div>`
    : '<div class="pop-note">这个库还没声明体裁——从题材选起，往下两级会跟着裁剪</div>'
  return `${head}${kbCard}<div class="pop-div"></div>
    ${genreGroups.join('')}
    <div class="pop-div"></div>
    <div class="pop-title">风格词条<span class="pop-hint">文风复刻包 · 单选主导文风</span></div>
    ${styleSkills.length ? styleRows.join('') : '<div class="pop-item plain"><span class="pi-ic">◇</span><b>还没有风格词条</b><i>openstory/skills/style-* 即上新</i></div>'}
    <div class="pop-div"></div>
    <div class="pop-title">方法论<span class="pop-hint">${explicit ? '已自定义' : '未自定义——按体裁自动匹配'}</span></div>
    ${methodRows}
    <div class="pop-div"></div>
    ${foot.join('')}`
}

/**
 * OS-91：看一篇技能的 SKILL.md 全文。
 * 作者口径：技能既要能被左侧 Agent 发现，也要能被外部 Agent 读——
 * 前者靠面板清单，后者靠 MCP（openstory_skills_list/read）。这里补上「人」这一层：
 * 作者点开就能看这篇配方到底怎么写的、依赖什么工具、产出什么。
 */
async function openSkillPeek(name) {
  if (!name) return
  openModal(`<div class="loading">正在读 ${esc(name)}…</div>`)
  try {
    const payload = await api(`/api/skill?name=${encodeURIComponent(name)}`)
    const skill = payload.skill ?? {}
    const bodyHtml = window.__mdRender
      ? window.__mdRender(text(skill.body))
      : `<pre class="skill-md-raw">${esc(text(skill.body))}</pre>`
    openModal(`<h3>${esc(skill.name || name)}</h3>
      <p class="sub">${esc(skill.description || '')}</p>
      <div class="skill-meta">
        <span class="chip">${esc(skill.category || '—')}</span>
        ${skill.version ? `<span class="count">v${esc(skill.version)}</span>` : ''}
        ${skill.vendor ? `<span class="count">${esc(skill.vendor)}</span>` : ''}
        ${Array.isArray(skill.genres) ? `<span class="count">体裁：${esc(skill.genres.join('／'))}</span>` : ''}
        ${skill.stage ? `<span class="count">阶段：${esc(skill.stage)}</span>` : ''}
      </div>
      ${Array.isArray(skill.tools) && skill.tools.length ? `<p class="sub">用到的工具：${esc(skill.tools.join('、'))}</p>` : ''}
      ${skill.output ? `<p class="sub">产出：${esc(skill.output)}</p>` : ''}
      <div class="skill-md">${bodyHtml}</div>
      <div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>`)
  } catch (error) {
    openModal(`<h3>${esc(name)}</h3><p class="sub">读不出来：${esc(text(error?.message || error))}</p>
      <div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>`)
  }
}

/** 写选择链（风格词条/方法论）：单点 PUT，回来更新本地缓存。 */
async function putAgentPicks(patch) {
  if (!state.current) return
  const cur = state.agent.picksExplicit && state.agent.picks ? state.agent.picks : { style: '', methods: [] }
  const body = { root: state.current.path, style: patch.style !== undefined ? patch.style : cur.style, methods: patch.methods !== undefined ? patch.methods : cur.methods }
  try {
    const payload = await api('/api/agent-picks', { method: 'PUT', body: JSON.stringify(body) })
    state.agent.picks = { style: payload.picks.style || '', methods: payload.picks.methods || [] }
    state.agent.picksExplicit = true
    state.agent.picksFlashAt = Date.now()
  } catch (error) {
    rememberAgentError(`选择链写入失败：${text(error?.message || error)}`)
  }
  closeComposerMenus()
  renderAgent()
}

/** 风格词条单选（空串＝不指定）。 */
async function pickStyle(name) { await putAgentPicks({ style: name }) }

/** 方法论勾选：未自定义时先以体裁自动匹配集为底，再增删这一项（进入显式模式）。 */
async function toggleMethod(name) {
  const skills = Array.isArray(state.agent.skills) ? state.agent.skills : []
  const methodSkills = skills.filter((skill) => skill.category === 'craft' && !String(skill.name).startsWith('style-'))
  const autoMethods = methodSkills.filter((skill) => !state.briefGenre || !Array.isArray(skill.genres) || skill.genres.includes('*') || skill.genres.includes(state.briefGenre.id)).map((skill) => skill.name)
  const base = state.agent.picksExplicit && state.agent.picks ? [...state.agent.picks.methods] : autoMethods
  const methods = base.includes(name) ? base.filter((item) => item !== name) : [...base, name]
  await putAgentPicks({ methods })
}

/** 点选体裁：写 brief.json（体裁策略从此每轮注入 system prompt＋裁剪技法技能与页签）。
 * libDirs 要按新体裁重建——换库时它是被旧体裁 excludedPages 物理滤过的，直接复用会丢目录。 */
async function pickGenre(id) {
  if (!state.current) return
  try {
    const payload = await api('/api/brief', { method: 'PUT', body: JSON.stringify({ root: state.current.path, genre: id }) })
    state.brief = payload.brief ?? null
    state.briefGenre = payload.genre ?? null
    // 磁盘全目录重新拉 → 按新体裁 excludedPages 重滤页签
    try {
      const topPayload = await api(`/api/files?root=${encodeURIComponent(state.current.path)}`)
      const rawDirs = Array.isArray(topPayload.dirs) ? topPayload.dirs : []
      const excluded = new Set((state.briefGenre?.excludedPages ?? []).map((page) => PAGE_TO_DIR_LOCAL[page] ?? page))
      state.libDirs = rawDirs.filter((dir) => !excluded.has(dir))
    } catch { /* 目录拉不到就不动 libDirs，页签保持现状 */ }
    // 当前页签若被新体裁裁掉 → 落回正文
    if (state.view.startsWith('dir:')) {
      const dir = state.view.slice(4)
      if (!(state.libDirs || []).includes(dir)) state.view = 'chapters'
    }
    state.agent.picksFlashAt = Date.now()
    closeComposerMenus()
    render()
  } catch (error) {
    rememberAgentError(`体裁切换失败：${text(error?.message || error)}`)
    closeComposerMenus()
    renderAgent()
  }
}

/** ＋菜单：引用文件 / 指令 / 技能（对齐其它 Agent 的 ＋ 键）。 */
function plusMenuHtml() {
  return `<div class="pop-title">引用文件</div>
    <div class="pop-item" data-action="pick-file" data-dir="正文"><span class="pi-ic">📄</span><b>引用正文</b><i>把一章喂给 Agent</i></div>
    <div class="pop-item" data-action="pick-file" data-dir="${registryModule.namingEntry('worldbook').dir}"><span class="pi-ic">🗂</span><b>引用世界书</b><i>把一篇世界书笔记喂给 Agent</i></div>
    <div class="pop-div"></div>
    <div class="pop-title">指令</div>
    <div class="pop-item" data-action="cmd-fill" data-cmd="请总结当前章节的剧情要点、出场人物与埋下的伏笔。"><span class="pi-ic">☑</span><b>总结本章</b><i>要点+伏笔清单</i></div>
    <div class="pop-item" data-action="cmd-fill" data-cmd="请根据已有章节与世界书资料，续写下一章的正文，用待确认卡交付。"><span class="pi-ic">✎</span><b>续写下一章</b><i>产出走待确认卡</i></div>
    <div class="pop-item" data-action="cmd-fill" data-cmd="列出与本章相关的世界书资料，逐条说明在写作时怎么用。"><span class="pi-ic">◈</span><b>查关联世界书</b><i>图谱优先</i></div>
    <div class="pop-div"></div>
    <div class="pop-title">技能</div>
    ${plusSkillsHtml()}
    <div class="pop-item" data-action="pick-file" data-dir="__more" hidden></div>`
}

/** 技能节（OS-68b）：真技能货架为主列（内置/本机/套件捆绑），套件规范降为次组。 */
function plusSkillsHtml() {
  const catLabel = { craft: '技法', review: '审阅', transform: '改写', extract: '抽取', operate: '操作' }
  const kits = state.suites.filter((kit) => kit.enabled !== false)
  const kitRows = kits.length
    ? `<div class="pop-div"></div><div class="pop-title">套件规范</div>` +
      kits.map((kit) => `<div class="pop-item" data-action="skill-attach" data-kit-name="${esc(kit.name)}" data-kit-desc="${esc((kit.description || '').slice(0, 80))}"><span class="pi-ic">◇</span><b>${esc(kit.name)}</b><i>${esc((kit.description || '').slice(0, 26))}</i></div>`).join('')
    : ''
  // 技能（OS-66 作者口径）：选中＝chip 显示在对话框上方；说明文字不进输入框
  const skills = Array.isArray(state.agent.skills) ? state.agent.skills : null
  if (!skills) return `<div class="pop-item plain"><span class="pi-ic">…</span><b>正在读技能货架</b></div>${kitRows}`
  if (state.agent.skillsError) return `<div class="pop-item plain"><span class="pi-ic">◇</span><b>技能货架读不到</b><i>${esc(state.agent.skillsError)}</i></div>${kitRows}`
  if (!skills.length) return `<div class="pop-item plain"><span class="pi-ic">◇</span><b>货架还没有技能</b><i>openstory/skills/ 丢目录即上新</i></div>${kitRows}`
  const order = { craft: 0, review: 1, transform: 2, extract: 3, operate: 4 }
  const sorted = [...skills].sort((a, b) => (order[a.category] ?? 9) - (order[b.category] ?? 9) || a.name.localeCompare(b.name))
  const rows = sorted.map((skill) => {
    const cat = catLabel[skill.category] || skill.category || '技能'
    const from = skill.source ? `来自${skill.source}` : ''
    return `<div class="pop-item" data-action="skill-attach" data-skill-name="${esc(skill.name)}"><span class="pi-ic">✦</span><b>${esc(skill.name)}</b><i>${esc(cat)}${from ? ` · ${esc(from)}` : ''}${skill.description ? ` — ${esc(skill.description.slice(0, 44))}` : ''}</i></div>`
  }).join('')
  return rows + kitRows
}

/** 打开＋菜单时拉一次技能货架（本地 GET 很快，回来就地重渲菜单）。 */
async function refreshAgentSkillsMenu() {
  try {
    const payload = await api('/api/skills')
    state.agent.skills = Array.isArray(payload.skills) ? payload.skills : []
    state.agent.skillsError = ''
  } catch (error) {
    state.agent.skills = []
    state.agent.skillsError = text(error?.message || error)
  }
  // 两个互斥菜单都可能由本次打开触发刷新——谁开着渲谁（OS-70）
  const plus = document.getElementById('agent-plus-menu')
  if (plus && !plus.hidden) plus.innerHTML = plusMenuHtml()
  const style = document.getElementById('agent-style-menu')
  if (style && !style.hidden) style.innerHTML = genreMenuHtml()
}

/** 点选真技能：拉全文注入【技能规范】，Agent 成文按该技能执行（OS-68b）。 */
async function attachSkillToAgent(name) {
  try {
    const payload = await api(`/api/skill?name=${encodeURIComponent(name)}`)
    const body = payload?.skill?.category === 'operate' ? `使用 openstory_skills_read 按需读取《${name}》并按 tools/confirm 执行。` : text(payload?.skill?.body || '') // OS-212：operate 不注入正文
    agent.pendingContext = { kind: 'skill', quote: name, context: body || `按技能《${name}》执行。`, label: `${payload?.skill?.category === 'operate' ? '操作说明书（按需读取）' : '技能'}：${name}` }
    agent.lastError = null
  } catch (error) {
    agent.lastError = `技能全文读不到：${name}（${text(error?.message || error)}）`
  }
  closeComposerMenus()
  renderAgent()
  document.getElementById('agent-input')?.focus()
}

/** 引用文件：列该目录下的文件，点选喂给 Agent（内容截 2000 字，与世界书 chip 同口径）。 */
async function pickReferenceFile(dir) {
  if (!state.current) return
  try {
    const payload = await api(`/api/files?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent(dir)}`)
    const menu = document.getElementById('agent-plus-menu')
    const files = Array.isArray(payload.files) ? payload.files : []
    if (!menu) return
    // files 端点返回的 file 字段是完整相对路径（含子目录）——之前只取 name 丢了子目录，
    // 拼出来「世界书/绰号.md」而不是「世界书/标签/绰号.md」，读文件必 404（OS-51）
    menu.innerHTML = `<div class="pop-title">${esc(dir)} · 点选引用</div>` +
      (files.length
        ? files.map((file) => {
            const full = text(file.file || file.path || file.name || file)
            const label = full.replace(/\.md$/u, '').replace(new RegExp(`^${dir}/`), '')
            const size = Number(file.size) || 0
            return `<div class="pop-item" data-action="attach-file" data-file="${esc(full)}"><span class="pi-ic">📄</span><b>${esc(label)}</b><i>${size ? Math.round(size / 100) / 10 + ' KB' : ''}</i></div>`
          }).join('')
        : '<div class="pop-item plain"><span class="pi-ic">◇</span><b>这个目录还没有文件</b></div>') +
      '<div class="pop-div"></div><div class="pop-item" data-action="plus-back"><span class="pi-ic">←</span><b>返回</b></div>'
  } catch (error) {
    rememberError(error)
  }
}

/** 引用文件落地：读内容 → 塞 pendingContext（上下文条显示）。 */
async function attachFileToAgent(full) {
  if (!state.current || !full) return
  closeComposerMenus()
  try {
    // 正文走 chapter 通道；其它目录（世界书等）走 reference/note 通道——chapter 端点只认正文/
    const payload = full.startsWith('正文/')
      ? await api(`/api/chapter?root=${encodeURIComponent(state.current.path)}&file=${encodeURIComponent(full)}`)
      : await api(`/api/reference/note?root=${encodeURIComponent(state.current.path)}&path=${encodeURIComponent(full)}`)
    const body = text(payload.chapter?.text ?? payload.note?.text ?? payload.text)
    agent.pendingContext = {
      quote: full,
      context: body.slice(0, 2000),
      label: `文件：${full}（${body.replace(/\s/gu, '').length} 字）`
    }
    renderAgent()
    document.getElementById('agent-input')?.focus()
  } catch (error) {
    rememberError(error)
    renderAgent()
  }
}

async function bootAgentConfig() {
  try {
    const payload = await api('/api/agent/config')
    agent.configured = payload.configured === true
    agent.endpoint = text(payload.endpoint)
    agent.model = text(payload.model)
    agent.apiKeyMasked = text(payload.apiKeyMasked)
    agent.runtime = text(payload.runtime)
    agent.reasoningEffort = text(payload.reasoningEffort)
    agent.chineseReasoning = payload.chineseReasoning !== false
    agent.configPath = text(payload.configPath)
  } catch { /* 读不到就按未配置摆，不拦工作台 */ }
  updateAgentChip()
  updateComposerState()
}

/**
 * 全局配置聚合读（S4）：text/image/vision/agent 四块。旧字段同时镜像到 agent.*，
 * 让 chip / 输入区这些既有调用点不用改。
 */
async function loadGlobalConfig() {
  try {
    const payload = await api('/api/config')
    agent.config = payload
    const textBlock = payload.text ?? {}
    agent.configured = textBlock.configured === true
    agent.endpoint = text(textBlock.endpoint)
    agent.model = text(textBlock.model)
    agent.apiKeyMasked = text(textBlock.apiKeyMasked)
    agent.runtime = text(textBlock.runtime)
    agent.reasoningEffort = text(textBlock.reasoningEffort)
    agent.chineseReasoning = textBlock.chineseReasoning !== false
    agent.configPath = text(payload.configPath)
  } catch { /* 读不到就按未配置摆，不拦工作台 */ }
}

async function loadSessions() {
  if (!state.current) {
    agent.sessions = []
    return
  }
  try {
    const payload = await api(`/api/agent/sessions?root=${encodeURIComponent(state.current.path)}`)
    agent.sessions = Array.isArray(payload.sessions) ? payload.sessions : []
  } catch {
    agent.sessions = []
  }
}

async function reloadThread() {
  if (!agent.sessionId || !state.current) return
  try {
    const payload = await api(`/api/agent/session?root=${encodeURIComponent(state.current.path)}&id=${encodeURIComponent(agent.sessionId)}`)
    agent.items = Array.isArray(payload.items) ? payload.items : []
  } catch { /* 保留本地视图 */ }
}

/**
 * 当前会话持久化（OS-39）：按库分键存本机。
 * 作者口径：不要每次进来都是新会话——默认接着上次那条聊，只有主动点「＋新会话」才开新的。
 * 注意：临时需求会话（润笔/分析走的「临时需求」）不记进这个槽位，
 * 否则刷新后会打开临时会话而不是作者真正在聊的主对话。
 */
const AGENT_SESSION_KEY = (root) => `openstory-agent-session::${root || ''}`

function isTempSession(id) {
  if (!id) return false
  const pinned = getTempSessionId()
  if (pinned && pinned === id) return true
  const session = agent.sessions.find((item) => item.id === id)
  return session?.title === '临时需求'
}

function rememberSession(id) {
  const root = state.current?.path || ''
  // 临时会话不进「上次会话」槽：它由 ui 键 agentTempSession 单独记
  if (id && !isTempSession(id)) uiSet('agentSession', id)
  else if (!id) uiSet('agentSession', null)
}

function recallSession() {
  return text(uiGet('agentSession', ''))
}

async function openSession(id) {
  if (agent.streaming) return
  agent.sessionId = id
  agent.cardError = null
  agent.lastError = null
  rememberSession(id)
  await reloadThread()
  renderAgent()
}

function newSession() {
  if (agent.streaming) return
  agent.sessionId = ''
  agent.items = []
  agent.cardError = null
  agent.lastError = null
  agent.forceNewSession = true // 下一条消息强制新建，不吃 daemon 的「接着上次聊」
  rememberSession('')
  renderAgent()
  document.getElementById('agent-input')?.focus()
}

/**
 * 打开库之后恢复上次会话（OS-39）：优先库内 ui-state 记的那条，
 * 它没了就退到服务端最新的那条（换机器/清了浏览器缓存也能接上）。
 * 临时会话不参与恢复——那是润笔/分析的落脚点，不是作者的对话主线。
 */
async function restoreAgentSession() {
  if (!state.current || agent.sessionId) return
  const remembered = recallSession()
  const usable = agent.sessions.filter((session) => !isTempSession(session.id) && session.title !== '临时需求')
  const candidate = remembered && usable.some((session) => session.id === remembered)
    ? remembered
    : text(usable[0]?.id)
  if (!candidate) return
  agent.sessionId = candidate
  await reloadThread()
}

async function deleteSession(id) {
  if (agent.streaming) return
  try {
    await api(`/api/agent/session?root=${encodeURIComponent(state.current.path)}&id=${encodeURIComponent(id)}`, { method: 'DELETE' })
    if (agent.sessionId === id) newSession()
  } catch (error) {
    rememberAgentError(error)
  }
  await loadSessions()
  renderAgent()
}

async function renameSession(id, currentTitle) {
  const title = globalThis.prompt?.('重命名会话', currentTitle)
  if (title === null) return
  const next = text(title).trim()
  if (!next || next === currentTitle) return
  try {
    await api('/api/agent/session/rename', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, id, title: next })
    })
    await loadSessions()
    renderAgent()
  } catch (error) {
    rememberAgentError(error)
    renderAgent()
  }
}

function rememberAgentError(error) {
  agent.lastError = humanizeAgentError(error)
}

/**
 * 会话标题可用性（OS-31）：历史脏数据里存过 GBK 乱码（U+FFFD 已落盘不可逆），
 * 与其在界面上摆一串方块，不如降级成「会话 · 时间」并让它可双击重命名。
 */
function sessionTitle(session, index) { return agentViews?.sessionTitle(session, index)  }

function sessionsHtml() { return agentViews?.sessionsHtml()  }

/** 当前会话一行：下拉收起时也能看出在聊哪条（含损坏标题的标记）。 */
function renderAgentCurrent() { return agentViews?.renderAgentCurrent()  }

/** 生效知识链常驻提示（OS-71 作者要求「切换要有画面提示」）：
 * 题材 · 文风 · 方法论数，配了才显示（沉默层），点一下＝打开灯泡选择链。
 * 刚切换 1.5s 内加 flash 动画，让「改了什么」一眼可见。 */
function renderKbChain() { return agentViews?.renderKbChain()  }

function toggleAgentSessions() {
  const panel = document.getElementById('agent-sess-panel')
  const btn = document.getElementById('agent-sess-btn')
  if (!panel) return
  const open = !panel.classList.contains('open')
  panel.classList.toggle('open', open)
  btn?.classList.toggle('on', open)
  if (open) renderAgent() // 展开时按最新会话刷新
}

function closeAgentSessions() {
  document.getElementById('agent-sess-panel')?.classList.remove('open')
  document.getElementById('agent-sess-btn')?.classList.remove('on')
}

/**
 * 过程折叠块（OS-42）：思考轨迹＋工具调用收进一个可展开的 <details>，
 * 跟 OpenDesign 的处理一致——过程默认收起（流式时自动展开），正文只留最终答案。
 * 折叠头永远只一句：「思考过程 · 12.3s · 2 次工具」。
 */
/**
 * 过程块（OS-51 重写）：思维链**渐进呈现**。
 *   · 每一段思考是一个独立小节：写完就折叠成一行摘要（保留在原地，可展开回看，不消失）
 *   · 最新一段直播展开；工具行插在段与段之间（按发生顺序）
 *   · 旧落档数据没有 segments（只有拼接的 thinking）→ 走兼容单段渲染
 * 全部收起后 summary 行仍给一句话概览（耗时 + 工具次数 + 段数）。
 */
function processBlockHtml(proc, { live = false } = {}) { return agentViews?.processBlockHtml(proc, { live }) }

/** 工具名的图标与说明（OS-43）：让作者一眼看出「它在干什么」。 */
function toolMeta(name) { return agentViews?.toolMeta(name)  }

/**
 * 工具行（OS-43）：图标＋动词＋对象＋耗时，让「它调了什么工具」有可辨识的形状。
 * 之前只有一行灰字，看不出读/写/搜/跑的区别。
 */
function toolRowHtml(tool) { return agentViews?.toolRowHtml(tool)  }

/** 工具名 → 中文动词（照 OD 的词表口径）。 */
function toolVerb(name) { return agentViews?.toolVerb(name)  }

/** 工具调用里的「对象」：优先文件路径/命令/查询词，取不到就不显示。 */
function toolTarget(tool) { return agentViews?.toolTarget(tool)  }

/**
 * 正文产出框（OS-43）：作者要的「md 框封装 + 自带复制」。
 * 模型按系统提示用 ``` 包起可采纳的正文，但这不该渲染成灰色代码块（那是给代码看的），
 * 而应该是一个「这是正文」的容器：正常小说排版 + 右上角复制。
 * 判定同 proposedFiles：有文件路径 + 有够长的代码块。
 */
function proseOutputHtml(raw, files) { return agentViews?.proseOutputHtml(raw, files)  }

/**
 * 助手正文（OS-43）：无框沉浸式 + Markdown 渲染。
 * 参考 OpenDesign：助手消息没有气泡底色/边框，正文直接落在页面背景上，只有用户消息是气泡。
 * Markdown 走自研 md.mjs（已支持标题/引用/列表/表格/代码/hr/图片/任务列表）。
 */
function assistantBodyHtml(item, streamingThis, files = []) { return agentViews?.assistantBodyHtml(item, streamingThis, files) }

/**
 * 这段回复里是否真的产出了「可采纳的正文」。
 * 只有「有东西可落」时才给采纳入口——每条都摆一个按钮是错的：
 *  - 一句「你好」没有文件可写
 *  - 一段「目录下有这些文件」只是提及
 *  - 一段「统计方法是……」只是说明
 * 判定（沿用历史口径，宁可少给也不误给）：
 *    ① 明确点名了正文文件路径（正文/xxx.md 或 NNN-标题.md）
 *    ② 且回复里有**被明确界定为正文的整段文字**——下面两种形态任选：
 *       a) 代码块（```…```）：最常见，作者可以直接整块复制
 *       b) 引用块（> …）连续 ≥3 行：也是一种「这段是给你抄的」的写法
 *    光有「长段落」不够：统计说明、目录清单也长，但那不是正文。
 */
function proposedFiles(item) { return agentViews?.proposedFiles(item)  }

/**
 * 生效标注（OS-43）：这轮用了什么。
 * 作者要能看出「AI 手里有什么武器」——技能、体裁策略、知识库、中文推理，各自一个图标＋一句话。
 */
function appliedChipsHtml(applied) { return agentViews?.appliedChipsHtml(applied)  }

function msgHtml(item, index) { return agentViews?.msgHtml(item, index)  }

/**
 * 待确认卡（OS-43 历史交互口径）：
 * 只有真动了文件才出现；按钮说「采纳 / 驳回」，不说「采纳写入 / 拒绝」。
 * 采纳后原地变绿药丸「已采纳 · 写入 <文件>」，驳回变灰「已驳回」。
 */
function cardHtml(item) { return agentViews?.cardHtml(item)  }

function threadHtml() { return agentViews?.threadHtml()  }

function renderThread() { return agentViews?.renderThread()  }

function renderContextChip() { return agentViews?.renderContextChip()  }

function renderAgent() { return agentViews?.renderAgent()  }

/**
 * SSE 帧分派（daemon 自有帧协议，OS-39 补齐）：
 *   start → notice? → (thinking | tool | usage | delta)* → done
 *   error 随时可能出现（上游失败/超时/取消）
 */
function handleChatFrame(frame, handlers = {}) {
  const line = frame.split('\n').find((row) => row.startsWith('data:'))
  if (!line) return
  let payload
  try {
    payload = JSON.parse(line.slice(5).trim())
  } catch {
    return
  }
  if (payload?.type === 'start') {
    handlers.onStart?.(payload.sessionId, payload)
  } else if (payload?.type === 'delta') {
    handlers.onDelta?.(text(payload.text))
  } else if (payload?.type === 'thinking') {
    handlers.onThinking?.(text(payload.text))
  } else if (payload?.type === 'tool') {
    handlers.onTool?.({
      phase: payload.phase === 'result' ? 'result' : 'call',
      id: text(payload.id),
      name: text(payload.name),
      input: payload.input ?? null,
      output: text(payload.output),
      isError: payload.isError === true
    })
  } else if (payload?.type === 'usage') {
    handlers.onUsage?.({
      input: Number(payload.input) || 0,
      output: Number(payload.output) || 0,
      total: Number(payload.total) || 0
    })
  } else if (payload?.type === 'done') {
    handlers.onDone?.(payload)
  } else if (payload?.type === 'notice') {
    handlers.onNotice?.(text(payload.text))
  } else if (payload?.type === 'error') {
    handlers.onError?.({ code: payload.error?.code, message: payload.error?.message })
  }
}

/**
 * 走 daemon Agent 通道的一条流式对话（左列对话、推演页、润笔共用）。
 * controller 由调用方持有（停止按钮 abort 它）；帧回调按调用方各自的状态落地。
 */
async function streamChat({ content, sessionId, newSession, controller, ephemeral, onStart, onDelta, onThinking, onTool, onUsage, onDone, onNotice, onError }) {
  try {
    const response = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        root: state.current.path,
        ...(sessionId ? { sessionId } : {}),
        ...(newSession ? { newSession: true } : {}),
        ...(ephemeral ? { ephemeral: true } : {}),
        content
      })
    })
    if (!response.ok || !response.body) {
      let payload = null
      try { payload = await response.json() } catch { payload = null }
      throw Object.assign(new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`), { code: payload?.error?.code || '' })
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let index
      while ((index = buffer.indexOf('\n\n')) >= 0) {
        handleChatFrame(buffer.slice(0, index), { onStart, onDelta, onThinking, onTool, onUsage, onDone, onNotice, onError })
        buffer = buffer.slice(index + 2)
      }
    }
    return { ok: true }
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: true, aborted: true }
    onError?.(error)
    return { ok: false, error }
  }
}

async function sendAgentMessage() {
  if (!state.current || agent.streaming) return
  if (!agent.configured) {
    openSettingsModal('先配好模型端点再开始对话。')
    return
  }
  const input = document.getElementById('agent-input')
  const typed = text(input?.value).trim()
  // OS-24/39：若有选中段落上下文，拼进消息（并在气泡里保留引用）；
  // 润笔类（kind=polish）用「润笔请求/作者要求」的措辞，让 Agent 明确知道这是改写任务
  const ctx = agent.pendingContext
  const polish = ctx?.kind === 'polish'
  const head = polish ? '【润笔请求】' : ctx?.kind === 'skill' ? '【技能规范】' : '【选中段落】'
  const askTag = polish ? '【作者要求】' : '【我的问题】'
  const ctxBlock = ctx ? (ctx.kind === 'skill' ? ctx.context : `【所在段落上下文】\n${ctx.context}`) : ''
  const content = ctx
    ? `${head}\n${ctx.quote}\n\n${ctxBlock}${typed ? `\n\n${askTag}\n${typed}` : ''}`
    : typed
  if (!content) return
  if (input) input.value = ''
  agent.lastError = null
  agent.cardError = null
  agent.items.push({ kind: 'msg', id: 'local-user', role: 'user', content: typed ? content : `${head}${ctx.quote}`, at: '' })
  agent.pendingContext = null
  agent.items.push({ kind: 'msg', id: 'streaming', role: 'assistant', content: '', at: '' })
  agent.streaming = true
  const controller = new AbortController()
  agent.controller = controller
  renderAgent()
  // 等待计时（DSH 一 run 一进程，首字要好几秒）：气泡里显示耗时，避免作者以为卡死
  const startedAt = Date.now()
  // 过程累积（OS-42）：思考轨迹与工具调用攒在消息的 process 上，
  // 与正文分开——正文只留最终答案，过程收在可展开的折叠块里。
  const pendingTools = new Map()
  // 过程记录（OS-51）：segments 让思维链**渐进呈现**——每一段思考/每一次工具都是
  // 一个独立小节，完成后折叠成一行摘要（保留可展开，不消失），最新一段展开直播。
  // 旧字段 thinking（拼接全文）保留给落档兼容，但渲染走 segments。
  const ensureProcess = (last) => {
    if (!last.process) last.process = { thinking: '', tools: [], segments: [], startedAt, lastThinkAt: 0 }
    if (!last.process.segments) last.process.segments = []
    return last.process
  }
  /**
   * 思考分段规则：模型每写完一段思路，要么接着调工具、要么输出正文——两者都是天然段界。
   * 另外：两次 thinking 帧间隔超过 1.2s（模型换了口气）也开新段，避免把不同主题挤进一段。
   */
  const pushThinking = (proc, piece) => {
    const now = Date.now()
    const segs = proc.segments
    const lastSeg = segs[segs.length - 1]
    const gapTooBig = lastSeg && lastSeg.type === 'think' && (now - proc.lastThinkAt) > 1200
    if (!lastSeg || lastSeg.type !== 'think' || lastSeg.closed || gapTooBig) {
      if (lastSeg && lastSeg.type === 'think' && !lastSeg.closed) lastSeg.closed = true
      segs.push({ type: 'think', text: piece, t: now, closed: false })
    } else {
      lastSeg.text += piece
    }
    proc.lastThinkAt = now
    proc.thinking = segs.filter((seg) => seg.type === 'think').map((seg) => seg.text).join('\n\n')
  }
  const closeThinking = (proc) => {
    const lastSeg = proc.segments[proc.segments.length - 1]
    if (lastSeg && lastSeg.type === 'think' && !lastSeg.closed) lastSeg.closed = true
  }
  const waitingTimer = setInterval(() => {
    const last = agent.items[agent.items.length - 1]
    if (last?.kind === 'msg' && last.role === 'assistant' && !last.content) {
      last.waiting = Math.round((Date.now() - startedAt) / 1000)
      if (last.process) last.process.elapsedMs = Date.now() - startedAt
      renderThread()
    }
  }, 1000)
  try {
    await streamChat({
      content,
      sessionId: agent.sessionId || undefined,
      newSession: agent.forceNewSession === true,
      controller,
      onStart: (sessionId, payload) => {
        agent.sessionId = sessionId
        agent.forceNewSession = false
        rememberSession(sessionId) // 记住当前会话：刷新/换库回来接着聊
        // 这轮生效了什么（技能/体裁/KB/中文推理）→ 存到消息上，气泡里显示标注
        if (payload?.applied) {
          const last = agent.items[agent.items.length - 1]
          if (last?.kind === 'msg' && last.role === 'assistant') last.applied = payload.applied
        }
      },
      onDelta: (piece) => {
        const last = agent.items[agent.items.length - 1]
        if (last?.kind === 'msg' && last.role === 'assistant') {
          if (piece) closeThinking(ensureProcess(last)) // 正文开始＝思维链收尾
          last.content += piece
          last.waiting = 0
          last.activity = null
          renderThread()
        }
      },
      onThinking: (piece) => {
        const last = agent.items[agent.items.length - 1]
        if (last?.kind === 'msg' && last.role === 'assistant') {
          const proc = ensureProcess(last)
          pushThinking(proc, piece)
          proc.elapsedMs = Date.now() - startedAt
          last.activity = 'thinking'
          last.waiting = Math.round((Date.now() - startedAt) / 1000)
          renderThread()
        }
      },
      onTool: (payload) => {
        const last = agent.items[agent.items.length - 1]
        if (last?.kind !== 'msg' || last.role !== 'assistant') return
        const proc = ensureProcess(last)
        if (payload.phase === 'call') {
          closeThinking(ensureProcess(last)) // 工具调用＝段界：之前那段思路就此定稿
          pendingTools.set(payload.id || payload.name, { ...payload, at: Date.now() })
        } else {
          const started = pendingTools.get(payload.id || payload.name)
          proc.tools.push({
            id: payload.id,
            name: started?.name || payload.name || 'tool',
            input: started?.input ?? null,
            output: payload.output,
            isError: payload.isError === true,
            elapsedMs: started ? Date.now() - started.at : 0
          })
          pendingTools.delete(payload.id || payload.name)
        }
        proc.elapsedMs = Date.now() - startedAt
        last.activity = payload.phase === 'result' ? 'after-tool' : 'tool'
        last.waiting = Math.round((Date.now() - startedAt) / 1000)
        renderThread()
      },
      onUsage: (usage) => {
        agent.lastUsage = usage
        const last = agent.items[agent.items.length - 1]
        if (last?.kind === 'msg' && last.role === 'assistant') last.usage = usage
      },
      onDone: (payload) => {
        const last = agent.items[agent.items.length - 1]
        if (last?.kind === 'msg' && last.role === 'assistant') {
          if (payload?.truncated) last.truncated = true
          if (agent.lastUsage) last.usage = agent.lastUsage
        }
      },
      onNotice: (noticeText) => {
        agent.notices.push(noticeText)
        renderThread()
      },
      onError: (error) => rememberAgentError(error)
    })
  } finally {
    clearInterval(waitingTimer)
  }
  agent.streaming = false
  agent.controller = null
  await loadSessions()
  await reloadThread() // 以服务器落档为准（停止/新建会话的 sessionId 都在这里回填）
  renderAgent()
}

/* ---------- 弹层（Agent 设置 / 待确认卡）---------- */

function openModal(html) {
  document.getElementById('modal').innerHTML = html
  document.getElementById('overlay').classList.add('open')
}

function closeModal() {
  document.getElementById('overlay').classList.remove('open')
  document.getElementById('modal').innerHTML = ''
}

/* ---------- 设置页签（OS-32：组件页面，可关闭；说明文字收进右上角「!」）---------- */

/* OS-204：设置导航两大域七项只定义在 views/settingsViews.mjs（SETTINGS_NAV）；
   旧 id 收敛表 SETTINGS_REDIRECT 也在那里。app.js 只留治理台跳转标签的晚绑定取表。 */
function navLabel(id) { return settingsViews?.navLabel?.(id) || '' } // OS-201/204：治理台跳转区块名只取导航定义

/**
 * 工作台模块清单（OS-44）：左栏三个 + 右栏分析模块。
 * 作者口径：所有模块都可以在设置里插拔开关自定义。
 */
/**
 * 工作台模块清单（OS-101）。
 * 作者口径：「工作台模块是套件内部的设置项」——不是本体设置。
 * 所以每个模块带 `suite` 归属：它属于哪个业务套件，就在哪个套件的详情里配置。
 * 目前这批都是小说/写作场景的模块 → suite: 'writing'。
 * 将来漫剧套件要加自己的分镜面板模块，就在这里加一条 suite: 'comicdrama'。
 */
const WORKBENCH_MODULES = Object.freeze([
  { id: 'chapters', label: '章节树', slot: '左栏', suite: 'writing', hint: '卷/章两级，写小说时随手切章' },
  // OS-164/G8b：叫法统一取命名表（与页签「世界书」一致）；模块清单在 registry 异步装载前定义，
  // 所以用 getter 动态取表，fallback 与表内值同字，装载前后都不出现「世界书图谱/世界书摘要」旧叫法。
  { id: 'graph', get label() { return registryModule?.namingEntry?.('worldbook')?.graphLabel || '世界书图谱' }, slot: '左栏', suite: 'writing', hint: '世界书与章节/条目的关系图' },
  { id: 'summary', get label() { return registryModule?.namingEntry?.('worldbook')?.summaryLabel || '世界书摘要' }, slot: '左栏', suite: 'writing', hint: 'AI 基于图谱总结本章要点' },
  { id: 'plotCurve', label: '剧情曲线', slot: '右栏', suite: 'writing', hint: '情绪曲线 / 事件密度（需故事源 fact）' },
  { id: 'style', label: '文风分析', slot: '右栏', suite: 'writing', hint: '句长/段长变异系数 + 套话与连接词' },
  { id: 'rhythm', label: '节奏', slot: '右栏', suite: 'writing', hint: '逐段字数起伏' },
  { id: 'aiSmell', label: 'AI 味', slot: '右栏', suite: 'writing', hint: '四因子加权评分' },
  { id: 'annotations', label: '本段批注', slot: '右栏', suite: 'writing', hint: '跟着正文滚动对齐的问题卡' }
])

/** 工作台模块插拔（设置页）。 */
/* ---------- 设置 · 剧本（OS-78）：自动排版与角色配色 ---------- */

/**
 * 剧本设置项（库内 ui-state，与 hiddenTabs 同 pattern）：
 *   autoFormat   —— 自动排版（自由文本 → 规范剧本格式）
 *   castColors   —— 角色专属颜色
 */
function scriptPrefs() {
  return scriptViews.scriptPrefsFrom(uiGet('scriptPrefs', {}))
}

function setScriptPref(name, value) {
  const next = { ...scriptPrefs(), [name]: value }
  uiSet('scriptPrefs', next) // OS-89：落库内 ui-state
  return next
}

/** 剧本设置弹层（OS-78）：右上「…」打开——自动排版开关 / 角色配色开关 / 剧本↔fact 互转。 */
function openScriptSettingsModal() {
  const prefs = scriptPrefs()
  openModal(`<h3>剧本设置</h3>
    <p class="sub">这些设置按库保存；自动排版只影响保存时的规范化，不改你输入的原文。</p>

    <div class="field">
      <label class="cfg-switch">
        <input type="checkbox" id="sm-autoformat"${prefs.autoFormat ? ' checked' : ''}>
        <span>自动排版（自由文本 → 规范剧本格式）</span>
      </label>
      <span class="cfg-note">「洪信：你来了」→「**洪信**：你来了」；「【场景】山道」→「*〔场景：山道〕*」。已规范的行不会被二次包装。</span>
    </div>

    <div class="field">
      <label class="cfg-switch">
        <input type="checkbox" id="sm-castcolors"${prefs.castColors ? ' checked' : ''}>
        <span>角色专属颜色</span>
      </label>
      <span class="cfg-note">按角色名稳定生成，同名角色在任何库都同色。</span>
    </div>

    <hr>

    <div class="field">
      <label>与数据互转</label>
      <div class="row">
        <button class="btn-ghost" data-action="script-to-fact">剧本 → 故事源条目</button>
        <button class="btn-ghost" data-action="fact-to-script">故事源条目 → 剧本</button>
      </div>
      <span class="cfg-note">「剧本 → 故事源」把幕/角色/场景抽成 fact 条目（写入 故事源/）；「故事源 → 剧本」按 fact 反向渲染成剧本文本。</span>
    </div>

    <div class="ded-image-ops">
      <button class="btn-ghost" data-action="close-modal">取消</button>
      <button class="btn-primary" data-action="script-pref-save-modal">保存</button>
    </div>
    <div class="err" id="sm-err"></div>`)
}

/** 剧本↔fact 互转（弹层按钮触发）——方向 A：剧本 → 故事源条目。 */
async function scriptToFactFlow() {
  const work = dirWork('剧本')
  if (!work?.text) return
  const mod = state.scriptFormat
  const sf = state.scriptFact
  if (!mod?.normalizeScript || !sf?.scriptToFact) { alert('互转模块还没加载，稍后再试'); return }
  const errEl = document.getElementById('sm-err')
  try {
    const normalized = mod.normalizeScript(work.text).text
    // OS-83 修：不拿剧本文件名当 bookId——会造出与本书事实包割裂的「第二本书」。
    // 先问服务端本库事实包叫什么（故事源/ 下最新的那份），落到同一本书上。
    const bookId = await resolveLibraryBookId()
    const { entries, wiki, stats } = await sf.scriptToFact(normalized, { bookId, domain: '舞台剧' })
    const payload = await api('/api/fact/entries/import', {
      method: 'POST',
      body: JSON.stringify({
        root: state.current.path,
        bookId,
        title: state.current.name,
        entries,
        wiki
      })
    })
    closeModal()
    state.reference.flash = `已转成 ${payload.entries} 条故事源条目（${bookId}）——去「故事源」看`
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `转失败：${text(error?.message || error)}`
  }
}

/** 方向 B：故事源条目 → 剧本。 */
async function factToScriptFlow() {
  const sf = state.scriptFact
  if (!sf?.factToScript) { alert('互转模块还没加载，稍后再试'); return }
  const errEl = document.getElementById('sm-err')
  try {
    const work = dirWork('剧本')
    // OS-83 修：bookId 不能拿剧本文件名凑（空目录时是 ''，会退化成 'screenplay' 再查成 404）。
    // 故事源事实包按「库」存，不传 bookId 就是本库全量——这才是互转要读的东西。
    const payload = await api(`/api/fact/entries?root=${encodeURIComponent(state.current.path)}&limit=500`)
    if (!payload.ok) throw new Error(payload.error?.message || '读条目失败')
    const { text: scriptText, stats } = sf.factToScript(payload.entries, payload.wiki)
    if (!scriptText.trim()) { if (errEl) errEl.textContent = '这部书还没有可用的故事源条目'; return }
    // 空剧本目录：先落一个文件名，否则 PUT 没有落点（旧实现直接静默失败）
    if (!work.file) {
      const stamp = new Date().toISOString().slice(0, 10)
      work.file = `剧本/${stamp.replace(/-/gu, '')}-${escFileName('由故事源生成')}.md`
    }
    work.text = scriptText
    await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: work.file, text: scriptText })
    })
    work.loaded = true
    closeModal()
    await openDirWork('剧本')
    // OS-87：如实报这次转出了什么——没有台词只有剧情概要时，这是「骨架」不是剧本，
    // 作者得知道接下来要自己写台词，而不是以为转换坏了。
    state.reference.flash = stats?.skeletal
      ? `已按 ${stats.acts} 条剧情梳理出剧本骨架（${stats.sketches} 段剧情概要）——故事源里没有台词/事件明细，台词待你补写`
      : `已转成剧本：${stats?.acts ?? 0} 幕 · ${stats?.lines ?? 0} 句台词`
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `转失败：${text(error?.message || error)}`
  }
}

/** 文件名安全化（去掉路径分隔符与 Windows 保留字符）。 */
function escFileName(name) {
  return text(name).replace(/[\\/:*?"<>|]/gu, '').trim() || '未命名'
}

/** OS-83：解析本库事实包的 bookId（factEntriesGet 不传 bookId 时返回 mtime 最新那本）。 */
async function resolveLibraryBookId() {
  try {
    const payload = await api(`/api/fact/entries?root=${encodeURIComponent(state.current.path)}&limit=1`)
    const resolved = text(payload?.bookId).trim()
    if (resolved) return resolved
  } catch { /* 读不到就退回库名，至少不静默 */ }
  return text(state.current?.name).trim() || 'default'
}

/** OS-143：剧本设置渲染已迁 public/views/settingsAggregation.mjs（scriptSectionHtml），这里只转交依赖。 */
function settingsScriptSectionHtml() {
  return settingsAggregation?.scriptSectionHtml({ state, scriptPrefs, dirWork, castColorOf, esc })
    ?? '<div class="step"><h3>剧本</h3><p class="sub">设置模块正在加载…</p></div>'
}

/**
 * 角色专属色：名字 hash → 稳定色相。
 * 不用随机、不用手写清单——同名角色在任何库、任何会话都同色。
 * 色相步进 47°（与 360 互质附近），相邻名字不撞色；饱和度固定，保证深浅一致。
 */
function castColorOf(name) {
  const s = text(name)
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.codePointAt(i)) % 360
  const hue = (h * 47) % 360
  return {
    hue,
    bg: `hsl(${hue} 62% 92%)`,
    fg: `hsl(${hue} 58% 28%)`,
    bar: `hsl(${hue} 55% 62%)`
  }
}

/**
 * 每个分节的一段自然语言说明——只说「这对你意味着什么」，不写实现细节。
 * 平时收起，点右上角「!」才展开（作者口径：呈现要干净，说明要对人话）。
 */
function runtimeCard(runtime) { return settingsViews?.runtimeCard(runtime)  }

function settingsRuntimeSectionHtml() { return settingsViews?.settingsRuntimeSectionHtml()  }

/**
 * 推理深度（OS-39）：DSH 支持 reasoning_effort，档位由 `dsh --models` 报上来。
 * 只在 DSH 就绪时展示；取不到清单就不摆假选项。
 */
function dshDepthFieldHtml() { return settingsViews?.dshDepthFieldHtml()  }

/* ---------- 设置 · 模型与能力（S4）：对话 / 生图 / 识图 / Agent 默认档 ---------- */

function settingRuntimeKind(id) {
  const key = text(id).trim()
  if (!key) return 'pi'
  const kit = (agent.runtimeList || []).find((item) => item.id === key)
  return kit?.kind ?? 'pi'
}

const cfgValue = (id) => text(document.getElementById(id)?.value).trim()
const cfgRawValue = (id) => text(document.getElementById(id)?.value)
const cfgChecked = (id) => document.getElementById(id)?.checked === true

/** probe 徽标文案：未测试 / 测试中 / ✓ 可达 (312ms) / ✗ 不可达（原因）。 */
function probeBadgeLabel(probe) {
  if (!probe) return '未测试'
  if (probe.state === 'running') return '测试中…'
  if (probe.state === 'ok') return `✓ 可达 (${Number(probe.latencyMs) || 0}ms)`
  if (probe.state === 'fail') return `✗ 不可达（${probe.detail || probe.error || '原因未知'}）`
  return '未测试'
}

/* OS-74：ComfyUI 节点映射的文本互转（"positive:6,negative:7" ⇄ {positive:"6",negative:"7"}） */
function comfyNodeMapText(map) {
  if (!map || typeof map !== 'object') return ''
  return Object.entries(map).filter(([k, v]) => k && v).map(([k, v]) => `${k}:${v}`).join(',')
}
function parseNodeMapText(value) {
  const out = {}
  for (const part of text(value).split(',')) {
    const [k, v] = part.split(':').map((x) => text(x).trim())
    if (k && v) out[k] = v
  }
  return out
}

function cfgBadgeHtml(kind) { return settingsViews?.cfgBadgeHtml(kind)  }

/** 只重画徽标——不在测试过程中整页重渲，免得把还没保存的输入抹掉。 */
function paintProbeBadge(kind) {
  const el = document.querySelector(`[data-probe-badge="${kind}"]`)
  if (!el) return
  const probe = agent.probes[kind]
  const label = probeBadgeLabel(probe)
  el.textContent = label
  el.title = label
  el.className = `cfg-badge${probe?.state ? ` ${probe.state}` : ''}`
}

/** DSH 模型值的传法：provider/id（dsh-cli 认这个形状），没 provider 就裸 id。 */
function dshModelValue(model) { return settingsViews?.dshModelValue(model)  }

function dshModelOptionsHtml(current, emptyLabel) { return settingsViews?.dshModelOptionsHtml(current, emptyLabel)  }

function dshModelFieldHtml(id, label, current, emptyLabel) { return settingsViews?.dshModelFieldHtml(id, label, current, emptyLabel)  }

function settingsModelsSectionHtml() { return settingsViews?.settingsModelsSectionHtml()  }

/** 保存一块配置：PUT /api/config 只传这一块，其余块原样不动。 */
async function saveConfigBlock(block) {
  const errEl = document.getElementById(`mcfg-${block}-err`)
  if (errEl) errEl.textContent = ''
  const body = {}
  if (block === 'text') {
    const isDsh = settingRuntimeKind(text(agent.runtime)) === 'dsh'
    body.text = {}
    if (isDsh) {
      body.text.model = cfgValue('mcfg-text-model')
      body.agent = { subagentModel: cfgValue('mcfg-subagent-model-a') }
      const reasoningEl = document.getElementById('cfg-reasoning')
      if (reasoningEl) body.text.reasoningEffort = reasoningEl.value.trim()
      const chineseEl = document.getElementById('mcfg-chinese')
      if (chineseEl) body.text.chineseReasoning = chineseEl.checked
    } else if (settingRuntimeKind(text(agent.runtime)) === 'cli') {
      body.text.model = cfgValue('mcfg-cli-model')
      body.agent = { subagentModel: cfgValue('mcfg-cli-subagent-model') }
    } else {
      body.text.endpoint = cfgValue('mcfg-endpoint')
      body.text.model = cfgValue('mcfg-model')
      const key = cfgRawValue('mcfg-key')
      if (key.trim()) body.text.apiKey = key
    }
  } else if (block === 'image') {
    const backend = text(document.getElementById('mcfg-image-backend')?.value).trim() === 'comfyui' ? 'comfyui' : 'openai'
    body.image = {
      enabled: cfgChecked('mcfg-image-enabled'),
      backend,
      endpoint: cfgValue('mcfg-image-endpoint'),
      model: cfgValue('mcfg-image-model')
    }
    const key = cfgRawValue('mcfg-image-key')
    if (key.trim()) body.image.apiKey = key
    if (backend === 'comfyui') {
      body.image.comfyUrl = cfgValue('mcfg-comfy-url')
      body.image.comfyWorkflow = cfgValue('mcfg-comfy-workflow')
      body.image.comfyNodeMap = parseNodeMapText(cfgValue('mcfg-comfy-nodemap'))
    }
  } else if (block === 'vision') {
    // OS-76：识图走 DSH 子 agent——只存 enabled / model / profile
    body.vision = {
      enabled: cfgChecked('mcfg-vision-enabled'),
      model: cfgValue('mcfg-vision-model'),
      profile: cfgValue('mcfg-vision-profile')
    }
  } else {
    body.agent = {
      defaultModel: cfgValue('mcfg-default-model'),
      subagentModel: cfgValue('mcfg-subagent-model'),
      profile: cfgValue('mcfg-profile')
    }
  }
  try {
    const payload = await api('/api/config', { method: 'PUT', body: JSON.stringify(body) })
    agent.config = payload
    // 改了配置，上一次的测试结论不再代表这一份，徽标回到「未测试」
    agent.probes[block] = null
    await bootAgentConfig()
    render()
    const noteEl = document.getElementById(`mcfg-${block}-note`)
    if (noteEl) noteEl.textContent = '已保存'
  } catch (error) {
    const box = document.getElementById(`mcfg-${block}-err`)
    if (box) box.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

/** 可行性校验：拿当前输入（可能还没保存）当 overrides 试连；生图必须先确认。 */
async function runConfigProbe(kind) {
  if (kind === 'image' && !globalThis.confirm?.('这会真生成一张图（消耗额度），继续？')) return
  const overrides = {}
  if (kind === 'text') {
    const isDsh = settingRuntimeKind(text(agent.runtime)) === 'dsh'
    overrides.endpoint = isDsh ? text(agent.config?.text?.endpoint) : cfgValue('mcfg-endpoint')
    overrides.model = isDsh ? cfgValue('mcfg-text-model') : cfgValue('mcfg-model')
    const key = isDsh ? '' : cfgRawValue('mcfg-key')
    if (key.trim()) overrides.apiKey = key
  } else {
    overrides.endpoint = cfgValue(`mcfg-${kind}-endpoint`)
    overrides.model = cfgValue(`mcfg-${kind}-model`)
    const key = cfgRawValue(`mcfg-${kind}-key`)
    if (key.trim()) overrides.apiKey = key
  }
  agent.probes[kind] = { state: 'running' }
  paintProbeBadge(kind)
  try {
    const payload = await api('/api/config/probe', { method: 'POST', body: JSON.stringify({ kind, overrides }) })
    agent.probes[kind] = payload.reachable
      ? { state: 'ok', latencyMs: payload.latencyMs }
      : { state: 'fail', detail: payload.detail || '', error: payload.error || '' }
  } catch (error) {
    agent.probes[kind] = { state: 'fail', detail: `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}` }
  }
  paintProbeBadge(kind)
}

/** 皮肤卡片内容（不含 .step 外壳）——供「外观」合并节直接嵌入。 */
function skinCardsHtml() { return settingsViews?.skinCardsHtml()  }

function settingsAppearanceSectionHtml() { return settingsViews?.settingsAppearanceSectionHtml()  }


/**
 * 主题与字号（OS-91）——项目级强制覆盖，管所有页签。
 * 作者口径：「前端 CSS 需要全局化，在全局设置中配置应用，明确规范好有几个大小档位，
 * 正文模块和功能模块的字体大小档位区分开……交给项目级设置去做全局的主题设置，强制覆盖各个页签。」
 *
 * 两条轨道各自独立：
 *   · 功能轨（按钮/表单/卡片/标签/表格）→ 4 档：紧凑 / 标准 / 大 / 特大（改 --ui-scale）
 *   · 正文轨（纸面阅读）→ 5 档：小 / 中 / 大 / 特大 / 巨（改 --doc-font-size）
 * 每个档位都有**实时预览**，改完立刻投影到 documentElement，写进库内 ui-state。
 */
function settingsTypographySectionHtml() { return settingsViews?.settingsTypographySectionHtml()  }

/** 读字号档位（存在库内 ui-state，缺省＝标准/中）。 */
function typographyState() {
  const saved = uiGet('typography', null)
  return {
    ui: saved?.ui || 'comfortable',
    doc: saved?.doc || 'm'
  }
}

/** 把字号档位投影到 documentElement（全站生效）。 */
function applyTypography() {
  const st = typographyState()
  const root = document.documentElement
  root.dataset.fs = st.ui
  root.dataset.docFs = st.doc
}

/** 改一个档位：立即生效 + 落库内 ui-state。 */
function setTypography(kind, value) {
  const st = typographyState()
  if (kind === 'ui') st.ui = value
  if (kind === 'doc') st.doc = value
  uiSet('typography', { ...st }, { immediate: true })
  applyTypography()
  render()
}

/** 外观·写作（OS-21）：正文字号/行高/段距/首行缩进/自动隔行——改完立刻投影到 CSS 变量。 */
function settingsWritingSectionHtml() { return settingsViews?.settingsWritingSectionHtml()  }


/**
 * 「发现与导入」节（OS-28）：应用只管「从哪发现插件」和「怎么把稿子导进来」。
 * 三类货架都是目录制——丢文件即上新，本机覆盖内置。
 */
function settingsDiscoverSectionHtml() { return settingsViews?.settingsDiscoverSectionHtml()  }

/**
 * 「本机与数据」（OS-97 合并）：原来「发现与导入」和「数据与目录」是两节，
 * 但本质是同一件事——文件在哪、怎么进来。合成一节，按「路径 / 导入」两段。
 */
function settingsCombinedDataSectionHtml() { return settingsViews?.settingsCombinedDataSectionHtml()  }

/**
 * 「同步」节（OS-115）：作者口径「每次进入页面发现不同步要有提示去同步；
 * 也可以在设置里设置什么时候同步一次」。
 *
 * 两块：
 *   ① 什么时候检查（进页面自动 / 只在手动点的时候）
 *   ② 发现了不同步怎么办（提醒我 / 自动跑 / 只标状态条）
 * 策略落库内 ui-state（.openstory/ui-state.json），不是浏览器缓存。
 */
/**
 * 「同步」节（OS-115/116）：作者口径「别加那么多提示」。
 * 压成一块：一行策略选择＋一行当前状态。不放说明段落、不重复动作按钮——
 * 「立即同步」已经在世界书/故事源的状态条上有了，这里再放一遍就是重复。
 */
function settingsSyncSectionHtml() { return settingsViews?.settingsSyncSectionHtml()  }

function settingsDataSectionHtml() { return settingsViews?.settingsDataSectionHtml()  }

function settingsAboutSectionHtml() { return settingsViews?.settingsAboutSectionHtml()  }

/**
 * 知识库（OS-97 重做）。
 *
 * 作者口径：「目前你给我绑定的是我本地的知识库。而且怎么去配置、怎么去使用接口、
 * 怎么开、怎么调，我感觉好像也没有完全调通。」
 *
 * 之前这一节是**只读状态牌**：只能看灯，不能改配置、不能测试、不能看分库明细。
 * 现在三件事齐了：
 *   ① 配置表单（baseUrl / apiKey / spaceId / 分库映射），密钥掩码显示、留空则保留原值
 *   ② 连接测试按钮（当场探 WeKnora + embedding，逐项给结果）
 *   ③ 状态区（服务灯 + 六库文档数/解析进度 + 最近检查时间）
 */
function settingsKbSectionHtml() { return settingsViews?.settingsKbSectionHtml()  }

/**
 * 外观（OS-98 合并：皮肤 + 字号）。
 *
 * 作者口径：「外观只放一个——不管是字体还是主题，都是一件事。」
 * 原来「皮肤」和「字号」两节分开，用户要来回点；现在合成一节，
 * 主题在上一块、字号在下一块，改完立刻生效。
 */
function settingsCombinedAppearanceHtml() { return settingsViews?.settingsCombinedAppearanceHtml()  }

/**
 * 引擎与存储（OS-98 合并：模型 / 知识库 / 本机路径）。
 *
 * 作者口径：「不管是模型还是知识库，还是各种引擎、本地的纯存储，
 * 这些东西也都只有一份，全部都结合到一起。」
 * 这四样本质都是「接什么外部能力、文件存哪」——归到一节，用子标题分开。
 */
function settingsCombinedEnginesHtml() { return settingsViews?.settingsCombinedEnginesHtml()  }

function governanceHtml() { return governanceViews?.governanceHtml() } // OS-201：治理台卡片流，一行转交壳

function settingsHtml() { return settingsViews?.settingsHtml()  }

/**
 * OS-95：判断宿主当前是不是暗色面。
 * 读 :root 的 --bg 计算值（皮肤令牌注入在这里），按相对亮度判定。
 * 这是给插件 iframe 决定加载亮/暗令牌表用的——插件页不在宿主的 CSS 作用域里。
 */
function isDarkSurface() {
  try {
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim()
    const hex = bg.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i)
    if (hex) {
      let raw = hex[1]
      if (raw.length === 3) raw = raw.split('').map((c) => c + c).join('')
      const r = parseInt(raw.slice(0, 2), 16)
      const g = parseInt(raw.slice(2, 4), 16)
      const b = parseInt(raw.slice(4, 6), 16)
      // 相对亮度（sRGB 近似）：> 0.5 视为亮底
      const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
      return lum < 0.5
    }
    // rgb()/hsl() 兜底：取数字最大值粗判
    const nums = bg.match(/[0-9.]+/gu)
    if (nums && nums.length >= 3) {
      const [r, g, b] = nums.slice(0, 3).map(Number)
      return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.5
    }
  } catch { /* 读不到就当亮色 */ }
  return false
}

/** 一键修复（od 口径：显式确认后才动 profile）——只支持 DSH。 */
async function runRuntimeSetup(id) {
  const runtime = (agent.runtimeList || []).find((item) => item.id === id)
  const confirmed = globalThis.confirm?.(`为「${runtime?.name ?? id}」装连接组件？

只会：建 openstory profile（首次自动初始化）＋装 runtime 插件 tgz。
凭据、模型、工具、会话都仍归你 Harness 自己所有。`)
  if (!confirmed) return
  const errEl = document.getElementById('settings-err')
  try {
    const payload = await api('/api/agent/runtime/setup', { method: 'POST', body: JSON.stringify({ id }) })
    await loadAgentRuntimes()
    render()
    if (errEl) errEl.textContent = ''
    globalThis.alert?.(payload.message ?? '已就绪')
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

async function selectRuntime(id) {
  const errEl = document.getElementById('settings-err')
  try {
    const payload = await api('/api/agent/runtime', { method: 'PUT', body: JSON.stringify({ id }) })
    agent.runtime = text(payload.active)
    // 换了通道，上一次「测试连接」的结论就不再代表当前配置
    agent.probes.text = null
    await loadAgentRuntimes()
    // 切到 DSH 时要把模型下拉填满（清单缺失＝空下拉＋提示，不摆假选项）
    await loadDshReasoningOptions()
    updateAgentChip()
    updateComposerState()
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

/* ---------- 套件（插件）设置（OS-15：版本/归属/启停/独立设置页）---------- */

/**
 * OS-120：三套插件的统一清单（套件 / 技能 / Agent 运行时）。
 *
 * 作者口径「在插件治理上，dsh 或者 Obsidian 有没有什么可以借鉴的」——
 * DSH 最值得抄的一条是「一份声明」：用户不该为了回答「我装了什么」翻三个地方。
 *
 * 这里只读聚合，失败不阻断设置页（其余两套照常显示）。
 * OS-204：插件相关只此一个装载函数——/api/plugins 已带货架四键，不再单发套件端点。
 */
async function loadPlugins(root = state.current?.path || '') {
  try {
    const payload = await api(`/api/plugins${root ? `?root=${encodeURIComponent(root)}` : ''}`)
    // OS-200：响应整体留一份（moduleGraph／推导字段／货架不再逐字段挑）；缺省值照旧，list 仍是 plugins 的别名。
    state.plugins = {
      loaded: true, slots: {}, slotWarnings: [], list: [], byKind: {}, stats: null,
      modules: [], moduleRoots: [], localModules: [], warnings: [],
      ...payload,
      list: Array.isArray(payload.plugins) ? payload.plugins : []
    }
    // OS-204：套件货架与统一清单端点同源，写进原来的位置。
    state.suites = Array.isArray(payload.suites) ? payload.suites : []
    state.settings.suiteOverrides = Array.isArray(payload.suiteOverrides) ? payload.suiteOverrides : []
    state.settings.suitesUserDir = text(payload.suiteUserDir)
    state.settings.suiteWarnings = Array.isArray(payload.suiteWarnings) ? payload.suiteWarnings : []
  } catch (error) {
    state.plugins = {
      loaded: true, slots: null, slotWarnings: [], list: [], byKind: {}, stats: null,
      modules: [], moduleRoots: [], localModules: [], warnings: [],
      error: (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
    }
    state.suites = []
    state.settings.suiteOverrides = []
    state.settings.suiteWarnings = []
  }
}

function suiteById(id) {
  return state.suites.find((suite) => suite.id === id) ?? null
}

/** 工作台接线读值：套件启用才给值（停用/未装＝回退默认）。 */
function suiteValue(key, id, fallback) {
  const suite = suiteById(id)
  if (!suite || suite.enabled === false) return fallback
  const value = suite.values?.[key]
  return value === undefined || value === null || value === '' ? fallback : value
}

/**
 * 业务套件中心（OS-99 主从两栏，对齐 DSH 插件管理中心）。
 *
 * 作者口径：「业务套件需要拆开做，配齐来源。」
 * 参照 DSH：左边一列是用户接进来的插件（小说是小说、剧本是剧本），右边是选中项详情。
 *
 * 布局：
 *   左列（260px）  套件清单：名称 / 域名标签 / 启用状态点。点选即切换右栏。
 *   右栏           详情：来源信息（内置还是本机、物理路径、自带页、捆绑技能）
 *                 ＋ 能力清单 ＋ 启停开关 ＋ 设置区（schema 表单 或 page iframe）
 */
/**
 * 插件中心主面（OS-101）。
 * 作者口径：「插件中心就是很多套件排列，不是内部排列」——
 * 套件清单已经在**左侧导航**里逐行列出，所以主面不再重复一遍列表，
 * 只渲染「当前选中套件」的详情（来源与身份 / 能力 / 设置 / 工作台模块）。
 */
/**
 * OS-120：插件中心总览——一份清单看全三套。
 *
 * 为什么要有这一屏：套件、技能、Agent 运行时是三套各自独立的 spec，
 * 用户在设置里要先知道「这是什么类型」才能找对入口。这一屏把三套排在一起，
 * 只回答一个问题：我现在装了哪些、各是什么版本、有没有被拦下。
 * 点回各自的详情仍走原有入口——这里不做编辑，只做盘点。
 */
/* OS-192：渲染本体已迁 views/suiteShelfViews.mjs，这里只留装配壳委托（只减不增） */
function pluginsOverviewHtml() { return suiteShelfViews?.suitesSectionHtml() ?? '' }
function suitesSectionHtml() { return suiteShelfViews?.suitesSectionHtml() ?? '' }
function suiteDetailPaneHtml(suite) { return suiteShelfViews?.suiteDetailPaneHtml(suite) ?? '' }
function settingFieldHtml(setting) { return suiteShelfViews?.settingFieldHtml(setting) ?? '' }
function suiteDetailHtml() { return suiteShelfViews?.suitesSectionHtml() ?? '' }

async function saveSuiteValues(id) {
  const suite = suiteById(id)
  const errEl = document.getElementById('suite-err')
  if (!suite) return
  const schema = suite.settingsSchema ?? []
  const values = {}
  for (const setting of schema) {
    const el = document.querySelector(`[data-suite-key="${setting.key}"]`)
    if (!el) continue
    if (setting.type === 'number') {
      const num = Number(el.value)
      if (el.value !== '' && !Number.isFinite(num)) {
        if (errEl) errEl.textContent = `${setting.label} 要填数字。`
        return
      }
      values[setting.key] = el.value === '' ? '' : num
    } else if (setting.type === 'boolean') {
      values[setting.key] = el.value === 'true'
    } else {
      values[setting.key] = el.value
    }
  }
  try {
    await api('/api/suite/settings', { method: 'PUT', body: JSON.stringify({ id, values, root: state.current?.path || '' }) })
    await loadPlugins() // OS-204：写完统一回载，值从同一份清单来
    if (errEl) errEl.textContent = ''
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

async function toggleSuite(id) {
  const suite = suiteById(id)
  try {
    await api('/api/suite/state', { method: 'PUT', body: JSON.stringify({ id, enabled: !(suite?.enabled !== false), root: state.current?.path || '' }) })
    await loadPlugins()
    render()
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/* ---------- 产物（OS-11：全库只读盘点＋预览＋去编辑）---------- */

async function openArtifacts({ force = false } = {}) {
  state.view = 'artifacts'
  const inventory = state.artifacts
  if (!force && inventory.root === state.current?.path && inventory.groups.length) {
    render()
    return
  }
  inventory.loading = true
  inventory.error = ''
  inventory.previewFile = ''
  inventory.previewText = ''
  render()
  try {
    const payload = await api(`/api/artifacts?root=${encodeURIComponent(state.current.path)}`)
    inventory.root = state.current.path
    inventory.groups = Array.isArray(payload.groups) ? payload.groups : []
    inventory.totals = payload.totals ?? null
  } catch (error) {
    inventory.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  inventory.loading = false
  render()
}

async function previewArtifact(file) {
  const inventory = state.artifacts
  inventory.previewFile = file
  inventory.previewLoading = true
  render()
  try {
    const payload = await api(`/api/chapter?root=${encodeURIComponent(state.current.path)}&file=${encodeURIComponent(file)}`)
    inventory.previewText = payload.text
  } catch (error) {
    inventory.previewText = `（预览读不出来：${text(error?.message || error)}）`
  }
  inventory.previewLoading = false
  render()
}

function editArtifact(file) {
  const topDir = file.includes('/') ? file.split('/')[0] : ''
  if (topDir === '正文') {
    go('chapters')
    loadChapter(file)
    return
  }
  if (topDir) {
    openDirWork(topDir).then(() => loadDirFile(topDir, file))
    return
  }
  // 根目录散文件没有归属工作面——留在产物看预览。
}

function groupLabel(dir) {
  if (!dir) return '根目录文件'
  return DIR_LABELS[dir] || dir
}

/* ---------- 世界书载体（OS-44）：Obsidian 式笔记系统 ---------- */

let refModule = null
async function loadRefModule() {
  if (!refModule) refModule = await import('./reference.mjs')
  return refModule
}

/** 拉世界书索引（供世界书页与左栏图谱共用）。 */
async function loadReferences({ force = false } = {}) {
  const ref = state.reference
  if (!state.current) return
  if (ref.loading) return
  if (ref.loaded && !force) return
  ref.loading = true
  ref.error = ''
  try {
    const payload = await api(`/api/reference?root=${encodeURIComponent(state.current.path)}`)
    ref.notes = Array.isArray(payload.notes) ? payload.notes : []
    ref.tags = Array.isArray(payload.tags) ? payload.tags : []
    ref.tagNotes = payload.tagNotes && typeof payload.tagNotes === 'object' ? payload.tagNotes : {}
    ref.stats = payload.stats ?? null
    ref.loaded = true
    // OS-103：世界书第二来源——库内故事源词条（enrich/故事源产物），与笔记同页不同层
    api('/api/fact/entries?root=' + encodeURIComponent(state.current.path))
      .then((fact) => {
        ref.factEntries = Array.isArray(fact.entries) ? fact.entries : []
        if (state.view === 'worldbook') render()
      })
      .catch(() => { ref.factEntries = [] })
    // OS-89：模块加载时自己检索自己的 log（AGENTS.md 第 10 条）
    await loadModuleLog(registryModule.namingEntry('worldbook').logModule, { limit: 20 })
    // OS-48：顺手探旧目录有没有可迁入的内容（迁入按钮按需显示；目录不存在＝0）
    await probeRetiredDirs()
  } catch (error) {
    ref.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  ref.loading = false
  // OS-147：自己收口——早退（ref.loading）时靠这次 render 把占位换成真内容/如实报错
  if (state.view === 'worldbook') render()
}

/**
 * OS-86：探旧目录还剩多少篇——只服务世界书页的「迁入旧目录」按钮（有剩才显示入口）。
 * 页签栏与「增加页签」面板已统一按 RETIRED_DIRS 无条件过滤，不再依赖这个计数。
 * 结果缓存在 state.reference.absorb，按库重置。
 */
async function probeRetiredDirs() {
  if (!state.current?.path) return {}
  const ref = state.reference
  ref.absorb = {}
  await Promise.all(RETIRED_DIRS.map(async (dir) => {
    try {
      const listed = await api(`/api/files?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent(dir)}`)
      ref.absorb[dir] = Array.isArray(listed.files) ? listed.files.length : 0
    } catch { ref.absorb[dir] = 0 }
  }))
  return ref.absorb
}

/** 打开一篇世界书笔记（含反链）。 */
/** 打开一篇世界书笔记（含反链）。from='graph' 时详情页给「← 返回图谱」键。 */
/**
 * 按任意写法找世界书笔记（OS-51）：支持 标题 / 相对路径 / 「参考/」旧路径前缀 / 带或不带 .md。
 * 之前「参考/约束/写作纪律」这种全路径匹配不到（只比对 rel 与 title），点它错弹「新建笔记」。
 */
function findReferenceByRef(ref) {
  const raw = text(ref).trim()
  if (!raw) return null
  const notes = state.reference.notes || []
  const noMd = raw.replace(/\.(?:md|markdown|txt)$/iu, '')
  const relNoPrefix = noMd.replace(/^(?:参考|世界书)[\/]/u, '')
  return notes.find((note) => note.title === raw)
    || notes.find((note) => note.path === raw || note.path === `${raw}.md`)
    || notes.find((note) => note.rel === noMd || note.rel === `${noMd}.md`)
    || notes.find((note) => note.rel.replace(/\.(?:md|markdown|txt)$/iu, '') === relNoPrefix)
    || notes.find((note) => note.title === relNoPrefix.split('/').pop())
    || null
}

async function openReference(path, { from = '' } = {}) {
  const ref = state.reference
  if (!state.current || !path) return
  ref.activePath = path
  // OS-106 修：打开笔记必须清掉 activeEntry——否则词条详情优先级高，点任何笔记都还是词条
  ref.activeEntry = ''
  ref.from = from
  ref.error = ''
  // OS-75：点条目＝进详情页（此前漏切视图，导致图谱视图下点条目无反应）
  ref.view = 'note'
  render()
  try {
    const query = new URLSearchParams({ root: state.current.path, path })
    const payload = await api(`/api/reference/note?${query.toString()}`)
    ref.note = payload.note ?? null
    ref.backlinks = payload.backlinks ?? { linked: [], unlinked: [] }
    ref.draft = text(payload.note?.text)
  } catch (error) {
    ref.note = null
    ref.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  render()
}

/**
 * 世界书详情页（OS-51，作者 Wiki 式分层）：
 *   上半＝左简介（标签 chips＋一句话摘要）＋右关系图谱（本词条邻域）；
 *   下半＝词条详情（完整 Markdown）；
 *   最下＝关联说明（已链接 / 未链接 反链两段）。
 * 标签是笔记的附加数据属性——它出现在简介卡上，不再是标题下方的游离块。
 */
/** 剥 frontmatter，返回 { body, fmLen }（fmLen＝被剥掉的前缀长度，块偏移写回要用）。 */
function stripFrontmatterOf(raw) {
  const source = text(raw)
  if (!source.startsWith('---\n')) return { body: source, fmLen: 0 }
  const end = source.indexOf('\n---', 4)
  if (end === -1) return { body: source, fmLen: 0 }
  const bodyStart = source.indexOf('\n', end + 1) + 1 || source.length
  return { body: source.slice(bodyStart), fmLen: bodyStart }
}

/**
 * 世界书笔记逐块实时渲染（OS-53，作者裁定「直接用实时渲染的词条编辑」）：
 * 与正文页 renderDocBody 同一套组件口径——contenteditable 逐块、失焦写回自动保存。
 * 差异：世界书笔记有 frontmatter（不可编辑），块偏移统一加上 fmLen 才是对全文的偏移；
 * 首个 H1 跳过（标题在详情头显示）；没有批注竖条。
 */
function renderRefDocBody(bodySource) {
  if (!mdReady || !mdModule) return `<div class="ref-prose prose"><p>${esc(bodySource)}</p></div>`
  const blocks = mdModule.splitBlocks(bodySource).filter((block) => !/^\s*#\s+/u.test(block.text))
  const ref = state.reference
  const fmLen = ref.fmLen || 0
  const parts = blocks.map((block, index) => {
    const html = mdModule.renderMarkdown(block.text)
    return `<div class="ref-line" data-line="${index}">
      <div class="doc-block" contenteditable="true" spellcheck="false" data-block="${index}" data-start="${block.start + fmLen}" data-end="${block.end + fmLen}" data-raw="${esc(block.text)}">${html}</div>
    </div>`
  })
  return `<div class="ref-prose prose" id="ref-reader">${parts.join('')}</div>`
}

/** 世界书笔记块失焦写回：按全文偏移拼回 noteText → PUT /api/chapter 自动保存。 */
async function commitRefBlock(blockEl) {
  const ref = state.reference
  if (!state.current || !ref.note || !ref.noteText) return
  const start = Number(blockEl.dataset.start)
  const end = Number(blockEl.dataset.end)
  if (!Number.isFinite(start) || !Number.isFinite(end)) return
  const nextBlock = blockHtmlToMd(blockEl)
  const currentRaw = blockEl.dataset.raw ?? ''
  if (nextBlock === currentRaw) return
  const notePath = ref.note.path
  const nextText = ref.noteText.slice(0, start) + nextBlock + ref.noteText.slice(end)
  ref.noteText = nextText
  blockEl.dataset.raw = nextBlock
  setAutosaveChip('保存中…')
  try {
    const payload = await api('/api/reference/note', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, path: notePath, text: nextText })
    })
    setAutosaveChip('已保存 · 刚刚')
    // 标签可能被编辑动了（frontmatter/行内 #tag）：延迟重扫索引，不重开笔记（不打断编辑）
    clearTimeout(refRescanTimer)
    refRescanTimer = setTimeout(() => {
      loadReferences({ force: true }).then(() => {
        if (state.view === 'worldbook') render()
      }).catch(() => {})
    }, 1600)
    void payload
  } catch (error) {
    setAutosaveChip('保存失败')
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

let refRescanTimer = null

/** OS-81：右栏「图片槽」——1..N 张图，第一张做主图，其余做缩略行。
 * 图片路径来自 referenceStore 的 images[]（frontmatter cover/portrait/images/refImages）。
 * 站内相对路径走 /api/reference/asset 二进制通道（daemon 的 referenceAssetGet）。 */
function refImagesSlotHtml(note) { return referencePageViews?.refImagesSlotHtml(note)  }

/** OS-75：世界书条目一键生图。生成中禁用按钮，完成后重载笔记（图墙自动出现）。 */
async function generateReferenceImage() {
  const ref = state.reference
  const note = ref?.note
  if (!state.current || !note?.path) return
  const notePath = note.path
  try {
    // OS-80：提交到后台任务中心，立刻返回——切走页面/换库都不影响它继续跑。
    // 进度与完成在右下角悬浮球里看；完成后再回来看图墙（前端轮询发现 done 会自动重载笔记）。
    const payload = await api('/api/reference/image', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, path: notePath, async: true })
    })
    ref.flash = `已提交后台生成（任务 ${payload.jobId}）——进度看右下角任务中心`
    // 记录「这张图完成后要重载哪个笔记」，任务中心轮询到 done 时处理
    state.jobs.waitingNotes = state.jobs.waitingNotes || {}
    state.jobs.waitingNotes[payload.jobId] = { root: state.current.path, path: notePath }
    // 立刻刷一次任务列表，让悬浮球出现
    await new Promise((r) => setTimeout(r, 400))
    const snap = await api('/api/jobs?limit=30').catch(() => null)
    if (snap?.ok) { state.jobs.list = snap.jobs || []; state.jobs.active = snap.active || 0; renderJobBall() }
  } catch (error) {
    ref.flash = ''
    ref.error = text(error?.message || error)
  }
  render()
}

/** 故事源词条详情（OS-103）：世界书第二来源的只读展示——类型、首次出现章节、定义、
 *  以及它属于哪层（worldview/character/plot…）。想改它得改库内故事源文件（不在笔记通道）。 */
function referenceEntryDetailHtml(entryId) {
  return referenceViews.referenceEntryDetailHtml(entryId, state.reference.factEntries, { esc })
}

function referenceEditorHtml() {
  const ref = state.reference
  const note = ref.note
  if (!note) return ''
  // OS-164：纯 HTML 构造已迁 views/referenceViews.mjs；这里保留逐块编辑的状态写入副作用。
  const { body: bodySource, fmLen } = stripFrontmatterOf(note.text)
  ref.noteText = text(note.text)
  ref.fmLen = fmLen
  return referenceViews.referenceEditorHtml({
    ref, note, bodySource, body: renderRefDocBody(bodySource),
    imagesSlot: refImagesSlotHtml(note), backlinks: ref.backlinks, esc, text
  })
}

/** 世界书页整体（OS-48：侧栏导航 + 视图制主区）。 */
/* ---------- 习惯（OS-57）：描述性自定义表单——正向＋负向词条，Agent 成文前必读 ---------- */

async function loadHabits({ force = false } = {}) {
  if (!state.current) return
  // OS-89：必须 await 且在早退之前——习惯表已缓存时会直接 return，日志就永远拉不到
  await loadModuleLog('习惯', { limit: 20 })
  if (state.habits && !force) return
  try {
    const payload = await api(`/api/habits?root=${encodeURIComponent(state.current.path)}`)
    state.habits = payload.habits || null
  } catch (error) {
    state.habitsError = text(error.message)
  }
}

const HABIT_FIELDS = [
  { key: 'bannedWords', label: '禁用词', hint: '出现即改的词（一行一个）', ph: '例如：心理活动\n压力\n效率' },
  { key: 'preferredWords', label: '惯用词', hint: '希望多用的词（一行一个）', ph: '例如：恁地\n那厮' },
  { key: 'bannedPatterns', label: '禁用句式', hint: '句式模板（… 表示中间可隔字）', ph: '例如：不是…而是…' },
  { key: 'bannedRhetoric', label: '禁用修辞', hint: '不想看到的修辞（一行一个）', ph: '例如：排比三连\n通篇比喻' },
  { key: 'formulas', label: '喜好的描述公式', hint: '惯用的写法公式（一行一个）', ph: '例如：动作+后果，不写血腥细节' }
]

/**
 * 习惯页（OS-92 重做）。
 * 作者口径：「面对长列表、多词条的情况，再用文字框就很拉胯。可以用 tag 的形式，
 * #标注一个条目，然后空格直接渲染成标签卡片。每个栏有增删按钮——
 * 点击删按钮，下面的标签都出现 × 号，可以删除。」
 */
function habitsViewHtml() {
  // OS-161：纯构造函数已迁 views/workbenchViews.mjs；这里只取数＋转交（增量冻结，本体只出不进）。
  if (!workbenchViews) return needLibraryHtml()
  return workbenchViews.habitsViewHtml({
    current: state.current, habits: state.habits, fields: HABIT_FIELDS, uiKit,
    errorBox: errorHtml(), logHtml: moduleLogHtml('习惯', { title: '习惯表修改记录' }),
    esc, text
  })
}

async function saveHabits() {
  if (!state.current) return
  const form = { tone: document.getElementById('habit-tone')?.value || 'direct', style: document.getElementById('habit-style')?.value || '' }
  for (const field of HABIT_FIELDS) {
    // OS-92：标签编辑器把值存在隐藏 input（data-chip-value）
    const chipEl = document.querySelector(`[data-chip-field="${field.key}"]`)
    form[field.key] = chipEl ? chipValuesOf(chipEl) : []
  }
  try {
    const payload = await api('/api/habits', { method: 'PUT', body: JSON.stringify({ root: state.current.path, habits: form }) })
    state.habits = payload.habits
    state.error = ''
    state.flash = state.flash // flash 通道留给通用提示
    render()
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/* ---------- 同源版本状态条（世界书页 / 故事源页共用）----------
 * 后端一次读三条线：Fact 链 revision、世界书派生 wiki 的基于版本、写通道之外的外部改动。
 * 前端只负责展示与「重新生成」入口；检查失败不拦界面，降级成一行「同源检查不可用」。 */
async function loadSyncCheck({ force = false } = {}) {
  const sync = state.sync
  const root = state.current?.path
  if (!root) return
  // 换库＝换数据源：上本书的 revision 拿来跟这本比是错的，整块作废（与 factView 同口径）
  if (sync.root && sync.root !== root) {
    sync.loaded = false
    sync.loading = false
    sync.data = null
    sync.error = ''
    sync.root = ''
    sync.notice = ''
    sync.openList = false
  }
  if (sync.loading) return
  if (!force && sync.loaded && sync.root === root) return
  sync.loading = true
  // OS-113 修：换库竞态——请求发出后库可能又切走，回来时必须核对「发起的库」是否还是当前库。
  const startedFor = root
  try {
    // 契约未落地时后端是 404：api() 会抛，这里兜住——状态条显示不可用，页面照常
    const payload = await api('/api/sync/check', { method: 'POST', body: JSON.stringify({ root }) })
    // 迟到响应：库已换走就整包丢弃，绝不把 A 库的结果写到 B 库头上
    if (state.current?.path !== startedFor) return
    sync.data = payload && typeof payload === 'object' ? payload : null
    sync.error = ''
    sync.root = root
    sync.loaded = true
    // 拿到新结果＝上一次「已提交 enrich」的口头提示该退休了（否则会一直挂在那儿）
    sync.notice = ''
    // OS-115：按策略处理「发现不同步」——提醒 / 自动 / 静默，同一指纹只处理一次
    handleSyncProblems(sync.data, root)
  } catch (error) {
    if (state.current?.path !== startedFor) return
    // 刷新失败保留上一次的结果（比清空更有用），只是标注一句不可信。
    // loaded 照样置真：否则每次 render 都会重打一个还没实现的端点（后端还没起来时尤其致命）。
    sync.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    sync.root = root
    sync.loaded = true
  } finally {
    // 只有「这次请求仍是最后一次」时才复位标志，避免旧请求把新请求的 loading 抹掉
    if (state.current?.path === startedFor) sync.loading = false
  }
  if (state.view === 'worldbook' || state.view === 'dir:故事源') render()
}

/** 同步策略（OS-115）：默认「进页面查 + 提醒我」（最不打扰、又不会漏）。 */
const SYNC_POLICY_DEFAULTS = Object.freeze({ checkOn: 'enter', action: 'remind' })

function syncPolicy() {
  const sync = state.sync
  if (sync.policy && sync.policyLoaded) return sync.policy
  const saved = uiGet('syncPolicy', null)
  const merged = {
    checkOn: (saved?.checkOn === 'manual' ? 'manual' : 'enter'),
    action: (['auto', 'silent'].includes(saved?.action) ? saved.action : 'remind')
  }
  sync.policy = merged
  sync.policyLoaded = true
  return merged
}

function setSyncPolicy(patch) {
  const next = { ...syncPolicy(), ...(patch || {}) }
  state.sync.policy = next
  state.sync.policyLoaded = true
  uiSet('syncPolicy', next)
  render()
}

/** 不同步指纹（OS-115）：同一份不同步只提醒一次——fact/wiki/正文三者时间戳拼成的串。 */
function syncStaleFingerprint(data) {
  const same = data?.sameSource || {}
  const changes = Array.isArray(data?.external?.externalChanges) ? data.external.externalChanges.length : 0
  return [
    text(same.factAt), text(same.wikiAt), text(same.chaptersAt),
    same.wikiStale === true ? 'stale' : 'ok',
    changes
  ].join('|')
}

/** 判断当前是否有「需要用户处理」的不同步（派生档过期 / 正文超前 / 外部改动）。 */
function syncProblemsFrom(data) {
  const same = data?.sameSource || {}
  const external = data?.external || {}
  const problems = []
  if (same.wikiStale === true) problems.push({ kind: 'wiki', label: text(same.wikiNote) || '世界书派生档落后' })
  if (same.chaptersNewerThanFact === true) problems.push({ kind: 'chapters', label: text(same.chaptersNote) || '正文比故事源新' })
  const changes = Array.isArray(external.externalChanges) ? external.externalChanges.filter(Boolean) : []
  if (changes.length) problems.push({ kind: 'external', label: `检测到 ${changes.length} 处未经写通道的改动` })
  return problems
}

/** 发现不同步时按策略处理（OS-115）。
 *  · remind：置 sync.prompt（横幅「发现不同步，立即同步 / 稍后」），同一指纹只提一次
 *  · auto：直接跑 enrich 重建派生档（10 分钟内不重复触发，防抖）
 *  · silent：什么都不做，只靠状态条颜色提示
 */
function handleSyncProblems(data, root) {
  const sync = state.sync
  const policy = syncPolicy()
  const problems = syncProblemsFrom(data)
  // 只有「派生档过期 / 正文超前」需要重建；外部改动只能由作者去编辑器里处理
  const rebuildable = problems.filter((p) => p.kind === 'wiki' || p.kind === 'chapters')
  if (!rebuildable.length) { sync.prompt = null; return }
  const fp = syncStaleFingerprint(data)
  if (policy.action === 'silent') { sync.prompt = null; return }
  if (policy.action === 'auto') {
    // 防抖：同一指纹 10 分钟内只自动跑一次；失败也不循环重试
    if (sync.promptedFor === fp && Date.now() - sync.lastAutoAt < 600000) return
    sync.promptedFor = fp
    sync.lastAutoAt = Date.now()
    sync.prompt = null
    runSyncRegen({ auto: true })
    return
  }
  // remind：同一份不同步只提醒一次（作者点了「稍后」也不该每次 render 再弹）
  if (sync.promptedFor === fp) return
  sync.promptedFor = fp
  sync.prompt = { root, fingerprint: fp, problems: rebuildable, externalOnly: problems.length > rebuildable.length }
}

/** 进场提示横幅（OS-115）：发现不同步时给一条带动作的提示，不做模态弹窗。 */
function syncPromptHtml() { return syncViews?.syncPromptHtml()  }

/** 世界书笔记里最新的一条 mtime（世界书页顺手显示；没有就返回空串）。 */
function syncLatestNoteAt() { return syncViews?.syncLatestNoteAt()  }

/**
 * 同源状态条（纯渲染）：一行紧凑条，三档——✓ 一致 / ! 派生档过期 / ! 外部改动 N 处。
 * 颜色全走语义令牌（--ok / --warn / --danger / --meta），不写死色值。
 */
function syncBarHtml() { return syncViews?.syncBarHtml()  }

function syncBarHtmlUnsafe() { return syncViews?.syncBarHtmlUnsafe()  }

/**
 * 「重新生成」入口（状态条上的 sync-regen-wiki）：真走 enrich（POST /api/enrich/run）。
 * enrich 是 2–6 分钟的模型任务，且要求设置里配好文本运行时——没配就只在状态条上说明、不发请求。
 */
/** 跑 enrich 重建派生档（OS-115）：状态条「重新生成」与进场提示「立即同步」共用同一个实现。
 *  auto=true 时是策略触发的自动重建，文案与手动区分。 */
async function runSyncRegen({ auto = false } = {}) {
  const sync = state.sync
  const root = state.current?.path
  if (!root || sync.regenBusy) return
  sync.regenBusy = true
  sync.notice = ''
  render()
  try {
    // OS-113 修：bookId 必须按「当前库」现取——state.factView.bookId 是上一个库的，
    // 换库后直接用它会让 enrich 在新库里凭空造一本幽灵书。
    let bookId = ''
    const listed = await api(`/api/fact/books?root=${encodeURIComponent(root)}`).catch(() => null)
    const books = Array.isArray(listed?.books) ? listed.books : []
    const remembered = text(state.factView?.bookId).trim()
    if (remembered && books.some((b) => text(b?.bookId) === remembered)) bookId = remembered
    if (!bookId) bookId = text(books[0]?.bookId).trim()
    if (state.current?.path !== root) return
    if (!bookId) {
      sync.notice = '这个库还没有故事源数据，enrich 无从跑起。'
      return
    }
    const payload = await api('/api/enrich/run', { method: 'POST', body: JSON.stringify({ root, bookId }) })
    sync.notice = auto
      ? `已自动提交同步（${text(payload?.jobId) || '任务已入队'}），完成后点「重试」刷新状态`
      : `已提交 enrich（${text(payload?.jobId) || '任务已入队'}），进度看左下角任务球。`
    sync.prompt = null
  } catch (error) {
    sync.notice = auto
      ? `自动同步没跑起来：${text(error?.message || error)}（可在设置里关掉自动同步）`
      : `提交 enrich 失败：${text(error?.message || error)}`
  } finally {
    sync.regenBusy = false
    render()
  }
}

// 老调用点兼容：状态条的「重新生成」按钮原本叫 regenWikiFromSync
function syncRegenWiki() { return runSyncRegen({ auto: false }) }
function referencePageHtml() {
  const ref = state.reference
  if (!state.current) return needLibraryHtml()
  // 进页面拉一次同源检查（loaded 挡重复；换库由 loadSyncCheck 自己作废重拉）
  loadSyncCheck()
  if (ref.loading && !ref.loaded) return '<div class="loading">正在读取世界书…</div>'
  if (!refModule) return '<div class="loading">世界书模块载入中…</div>'
  // OS-103：故事源词条详情优先（世界书第二来源，只读）
  const mainHtml = (ref.view || 'note') === 'graph'
    ? referenceGraphHtml()
    : (ref.activeEntry ? referenceEntryDetailHtml(ref.activeEntry) : referenceEditorHtml())
  const absorbTotal = Object.values(ref.absorb || {}).reduce((sum, count) => sum + (Number(count) || 0), 0)
  // OS-96：首次出现章节筛选——0＝全量；>0 只看 firstChapter≤该章的词条
  const fcLimit = Number(ref.firstChapterFilter) || 0
  const visibleNotes = fcLimit > 0 ? refModule.notesVisibleAt(ref.notes, fcLimit) : ref.notes
  const shell = refModule.referenceShellHtml({
    notes: visibleNotes,
    tags: ref.tags,
    activeTag: ref.activeTag,
    activePath: ref.activePath,
    view: ref.view || 'note',
    q: ref.q || '',
    mainHtml,
    stats: ref.stats,
    absorbable: absorbTotal,
    firstChapterFilter: fcLimit,
    // OS-103：世界书第二来源（故事源词条）与当前选中词条
    factEntries: ref.factEntries || [],
    activeEntry: ref.activeEntry || '',
    // OS-89：世界书模块自己的修改日志（AGENTS.md 第 10 条）
    changelogHtml: moduleLogHtml(registryModule.namingEntry('worldbook').logModule, { title: '世界书修改记录' })
  })
  // OS-164：同步状态条＋进场提示由宿主取数，插入位置由 views/referenceViews.mjs 的纯函数决定
  // （函数式 replacement：路径/reason 里可能出现 $& 序列，不能当分组引用吃掉）。
  const syncBlock = `${syncBarHtml()}${syncPromptHtml()}`
  return referenceViews.referencePageHtml({ ref, shell, syncBlock, errorBox: errorHtml(), esc })
}

/** 世界书页·关系图谱视图（OS-51）：大画布＋节点信息卡（简介＋跳转按钮）＋标签筛选行。 */
function referenceGraphHtml() {
  return referenceViews.referenceGraphHtml({
    rc: state.refCol, ref: state.reference, esc, text,
    nodeCardHtml: (node) => refNodeCardHtml(node)
  })
}

/** 图谱节点信息卡：类型徽章＋标签＋一句话摘要＋「打开详情」。 */
function refNodeCardHtml(node, variant = '') {
  return referenceViews.refNodeCardHtml(node, { edges: state.refCol.graph?.edges || [], esc, text, variant })
}

/**
 * 图谱画布的数据视图（OS-51 参数化）：
 *   tagFilter：只看某个标签挂着的子图（标签节点＋直接相连节点）——作者口径「在图谱里搜索固定的标签」
 *   focusId：聚焦时取邻域；全景（无 focus 无 tagFilter）只画有连接的节点，上限 120。
 */
function graphFocusView(focusId = state.reference.focus, tagFilter = state.reference.tagFilter || '') {
  const graph = state.refCol.graph
  if (!graph) return { nodes: [], edges: [], stats: {} }
  let nodes = graph.nodes
  let edges = graph.edges
  if (tagFilter) {
    const tid = `tag:${tagFilter}`
    const keep = new Set([tid])
    for (const edge of edges) {
      if (edge.a === tid) keep.add(edge.b)
      if (edge.b === tid) keep.add(edge.a)
    }
    nodes = nodes.filter((node) => keep.has(node.id))
    edges = edges.filter((edge) => keep.has(edge.a) && keep.has(edge.b))
  }
  if (!focusId) {
    if (tagFilter) return { nodes, edges, stats: graph.stats }
    const degree = new Map()
    for (const edge of edges) {
      degree.set(edge.a, (degree.get(edge.a) || 0) + 1)
      degree.set(edge.b, (degree.get(edge.b) || 0) + 1)
    }
    const visible = nodes
      .filter((node) => degree.get(node.id))
      .sort((left, right) => (degree.get(right.id) || 0) - (degree.get(left.id) || 0))
      .slice(0, 120)
    const keep = new Set(visible.map((node) => node.id))
    return { nodes: visible, edges: edges.filter((edge) => keep.has(edge.a) && keep.has(edge.b)), stats: graph.stats }
  }
  const keep = new Set([focusId])
  for (const edge of edges) {
    if (edge.a === focusId) keep.add(edge.b)
    if (edge.b === focusId) keep.add(edge.a)
  }
  return {
    nodes: nodes.filter((node) => keep.has(node.id)),
    edges: edges.filter((edge) => keep.has(edge.a) && keep.has(edge.b)),
    stats: graph.stats
  }
}

/** 图谱节点跳详情（OS-51：跳转只走信息卡按钮；来路是图谱，详情页给返回键，返回时聚焦保留）。 */
function navigateFromGraphNode(node) {
  if (node.kind === 'worldbook') {
    state.reference.view = 'note'
    // 正文页小图也走这里（OS-52）：不在世界书页时先切页签
    if (state.view !== 'worldbook') go('worldbook')
    openReference(node.id, { from: 'graph' })
    return
  }
  if (node.kind === 'artifact') {
    if (node.id.startsWith('正文/')) {
      loadChapter(node.id)
      go('chapters')
    } else {
      const dir = node.id.split('/')[0]
      if (state.libDirs.includes(dir)) go(`dir:${dir}`)
    }
    return
  }
  if (node.kind === 'tag') {
    // 标签没有「详情页」——跳转＝按该标签筛选笔记列表（清掉旧详情，主区回列表空态）
    const ref = state.reference
    ref.view = 'note'
    ref.activeTag = node.id.replace(/^tag:/u, '')
    ref.focus = null
    ref.note = null
    ref.activePath = ''
    ref.from = ''
    if (state.view !== 'worldbook') go('worldbook')
    else render()
    return
  }
  if (node.kind === 'entry') {
    // 条目工作面已剔除（OS-54）：条目数据的消费方是推演——切过去
    go('roleplay')
  }
}

/** 世界书页大图谱挂载（OS-48）：focus 模式——点节点聚焦邻域，再点进详情，点空白复位。 */
async function mountReferenceGraph() {
  const canvas = document.getElementById('ref-graph-canvas')
  if (!canvas) return
  if (!state.refCol.graph) {
    await loadRefGraph()
    // 数据到位后回挂一次——之前直接 return，首次进入图谱视图会停在「正在构图…」
    return mountReferenceGraph()
  }
  const mod = await import('./graph.mjs')
  graphCleanup?.()
  graphCleanup = mod.mountGraph({
    canvas,
    graph: graphFocusView(),
    focusId: state.reference.focus,
    onPick: (node) => {
      // OS-51：点节点＝聚焦邻域＋出信息卡（跳转走卡片按钮，不再「再点进详情」）
      state.reference.focus = node.id
      render()
    },
    onBlank: () => {
      if (state.reference.focus || state.reference.tagFilter) {
        state.reference.focus = null
        render()
      }
    }
  })
}

/** 详情页右上角小图谱（OS-51）：本词条的邻域；jump 模式点节点即跳。 */
let detailGraphCleanup = null
async function mountDetailGraph() {
  const canvas = document.getElementById('ref-detail-canvas')
  if (!canvas) return
  if (!state.refCol.graph) {
    await loadRefGraph()
    if (!document.getElementById('ref-detail-canvas')) return // 等待期间页面切走了
  }
  const view = graphFocusView(state.reference.activePath, '')
  if (!view.nodes.length) return
  const mod = await import('./graph.mjs')
  detailGraphCleanup?.()
  detailGraphCleanup = mod.mountGraph({
    canvas,
    graph: view,
    focusId: state.reference.activePath,
    onPick: (node) => {
      if (node.id === state.reference.activePath) return
      navigateFromGraphNode(node)
    }
  })
}

/** 词条详情的邻域图谱（OS-105）：与笔记详情同规格——focus 用 entry:<id>。 */
async function mountEntryGraph() {
  const canvas = document.getElementById('ref-entry-canvas')
  if (!canvas) return
  if (!state.refCol.graph) {
    await loadRefGraph()
    if (!document.getElementById('ref-entry-canvas')) return
  }
  const entryId = text(state.reference.activeEntry)
  if (!entryId) return
  const focusId = entryId.startsWith('entry:') ? entryId : 'entry:' + entryId
  const view = graphFocusView(focusId, '')
  const mod = await import('./graph.mjs')
  detailGraphCleanup?.()
  if (!view.nodes.length) {
    canvas.parentElement.innerHTML = '<p class="ds-empty">这条词条暂时没有关联节点。</p>'
    return
  }
  detailGraphCleanup = mod.mountGraph({
    canvas,
    graph: view,
    focusId,
    onPick: (node) => {
      if (node.id === focusId) return
      navigateFromGraphNode(node)
    }
  })
}

/* ---------- 左内容栏（OS-44）：章节树 / 世界书图谱 / 世界书摘要 ---------- */

/** 章节树：按目录结构分两级（卷/章）。 */
function chapterTreeHtml() { return referencePageViews?.chapterTreeHtml()  }

/** 章节行（卷/章两级）。抽出来供「只重画行、不动输入框」复用。 */
function chapterRowsHtml(chapters) { return referencePageViews?.chapterRowsHtml(chapters)  }

/** 世界书图谱模块（canvas 力导向，由 graph.mjs 驱动）。 */
function graphModuleHtml() { return referencePageViews?.graphModuleHtml()  }

/** 世界书摘要模块：AI 基于图谱知识总结当前章节的大纲。 */
function refSummaryHtml() { return referencePageViews?.refSummaryHtml()  }

/**
 * 左栏三个模块（OS-44）。
 * 每个模块可单独关闭（设置里插拔），全关则整栏隐藏。
 */
/** OS-76：剧本页的左栏模块组——没有「章节」（剧本用幕），换成「出场人物」。
 * 世界书图谱/摘要与正文页共用同一套实现。 */
const SCRIPT_REF_MODULES = Object.freeze([
  { id: 'cast', label: '出场人物', hint: '本剧出现过的角色', render: () => scriptCastHtml(), badge: () => String((state.scriptModule?.scriptStats?.(dirWork('剧本').text || '')?.cast || []).length) },
  { id: 'graph', label: '世界书图谱', hint: '世界书与产物的关系', render: () => graphModuleHtml(), badge: () => String(state.refCol.graph?.stats?.nodes ?? 0) },
  { id: 'summary', label: '世界书摘要', hint: 'AI 基于图谱总结本剧', render: () => refSummaryHtml(), badge: () => '' },
  // OS-89：剧本模块自己的修改日志
  { id: 'changelog', label: '本模块修改', hint: '每次保存的 diff 与时间', render: () => moduleLogHtml('剧本', { title: '剧本修改记录' }), badge: () => String(moduleLogOf('剧本')?.entries?.length ?? 0) }
])

/** 剧本出场人物卡（OS-163：本体迁 views/scriptViews.mjs，这里取数后转交）。 */
function scriptCastHtml() { return referencePageViews?.scriptCastHtml()  }

const REF_MODULES = Object.freeze([
  { id: 'chapters', label: '章节', hint: '卷/章两级', render: () => chapterTreeHtml(), badge: () => String((state.write.chapters || []).length) },
  { id: 'graph', label: '世界书图谱', hint: '世界书与产物的关系', render: () => graphModuleHtml(), badge: () => String(state.refCol.graph?.stats?.nodes ?? 0) },
  { id: 'summary', label: '世界书摘要', hint: 'AI 基于图谱总结本章', render: () => refSummaryHtml(), badge: () => '' },
  // OS-89：模块自己的修改日志——作者要能看见「这个模块最近改了什么」
  { id: 'changelog', label: '本模块修改', hint: '每次保存的 diff 与时间', render: () => moduleLogHtml('正文', { title: '正文修改记录' }), badge: () => String(moduleLogOf('正文')?.entries?.length ?? 0) }
])

/**
 * 题材工作面左栏（OS-45）。
 * 注意它是「小说/世界书」这类题材页自己的内部左栏（二等公民的内部结构），
 * Agent 始终在最外层最左（一等公民），两者不抢位置——所以这里返回 HTML 字符串，
 * 由各题材页自己决定往哪插，而不是去改全局 .main 布局。
 *
 * OS-48：左栏是浮层附庸（绝对定位，不占正文流），正文纸面永远居中不被挤压；
 * 三张卡片共用一套头（标题＋计数＋折叠箭头＋关闭 ×），与右栏分析卡同构。
 */
/** 左栏模块卡（章节树/世界书图谱/世界书摘要）——抽出来供正文页与剧本页共用。 */
function refModulesHtml({ prepend = '', modules = null } = {}) {
  if (!state.current) return ''
  const openState = state.refCol.open ?? (state.refCol.open = {})
  return referenceViews.refModulesHtml({
    prepend, modules: Array.isArray(modules) ? modules : REF_MODULES,
    hidden: hiddenModules(), openState, esc
  })
}

function refColHtml() { return referencePageViews?.refColHtml()  }

/* ── OS-114 窄面板约束：世界书资料左栏改「抽屉」────────────────────────
   ≤1000px（与 index.html 的断点一致）时，248px 的左栏不再常驻——默认收起，
   由页头「世界书资料」按钮开合；宽面板保持原样（常驻＋结构性让位）。
   只动渲染层，narrowOpen 是内存态，不写库内/浏览器状态。 */
const NARROW_PANEL_MAX = 1000

function isNarrowPanel() {
  try {
    return window.matchMedia(`(max-width: ${NARROW_PANEL_MAX}px)`).matches
  } catch {
    return false
  }
}

/** 把「窄面板抽屉」状态投影到 DOM（每次重绘后、窗口尺寸变化时都调）。 */
function applyNarrowRefDrawer() {
  const shell = document.querySelector('.doc-workspace-sticky')
  if (!shell) return
  const narrow = isNarrowPanel()
  const open = state.refCol?.narrowOpen === true
  shell.classList.toggle('is-narrow-ref-closed', narrow && !open)
  document.querySelectorAll('[data-action="refcol-toggle"]').forEach((btn) => {
    btn.classList.toggle('on', narrow && open)
  })
}
window.addEventListener('resize', () => { applyNarrowRefDrawer() })

/** 题材页渲染完后统一挂图谱（各页只负责插 refColHtml()）。 */
function afterRefColMount() {
  const host = document.getElementById('ref-col')
  const shell = document.querySelector('.doc-workspace-sticky')
  if (!host) {
    // 左栏整栏关掉（模块全隐）＝不占位，正文不该留白
    shell?.classList.remove('has-refcol')
    return
  }
  // OS-88：左栏存在＝正文滚动区补左侧内边距（纸面让位），与右栏 has-analyze 对称
  shell?.classList.toggle('has-refcol', true)
  const openState = state.refCol.open ?? {}
  const graphCard = host.querySelector('[data-ref-mod="graph"]')
  if (graphCard && openState.graph !== false && graphCard.dataset.open === '1') {
    requestAnimationFrame(() => mountRefGraph())
  }
}

/**
 * 重绘左栏。
 * 历史坑（OS-50 修复）：这里原来是空壳、只调 afterRefColMount()（只挂图谱不建 DOM），
 * 于是「生成摘要」的状态变化（loading/正文/报错）永远不会上屏——点了像没反应。
 * 现在真的重建左栏 HTML，并保住正文滚动位置。
 */
function renderRefCol() {
  rerenderRefCol()
}

/** 只重画某一张卡的 body（不动别的卡、不重挂图谱）。 */
function repaintRefModule(id) {
  const card = document.querySelector(`.ref-mod[data-ref-mod="${id}"]`)
  if (!card || card.dataset.open === '0') return
  const mod = REF_MODULES.find((item) => item.id === id)
  const body = card.querySelector('.ref-mod-body')
  if (!mod || !body) return
  body.innerHTML = mod.render()
  const badgeEl = card.querySelector('.rm-badge')
  const badge = mod.badge()
  if (badgeEl) { if (badge) badgeEl.textContent = badge; else badgeEl.remove() }
  else if (badge) {
    card.querySelector('.rm-toggle')?.insertAdjacentHTML('beforeend', `<span class="rm-badge">${esc(badge)}</span>`)
  }
}

/**
 * 模块插拔（OS-44）：库内 ui-state，照 hiddenTabs 的模式。
 * 可在设置里关掉任意模块；全关则左栏整体消失。
 */
const MODULE_HIDE_KEY = (root) => `openstory-modules-hidden::${root || ''}`

function hiddenModules() {
  const root = state.current?.path || ''
  if (!state.moduleHidden) state.moduleHidden = {}
  if (!state.moduleHidden[root]) {
    const saved = uiGet('moduleHidden', null)
    state.moduleHidden[root] = Array.isArray(saved) ? saved : []
  }
  return new Set(state.moduleHidden[root])
}

function setModuleHidden(id, hidden) {
  const root = state.current?.path || ''
  const set = hiddenModules()
  if (hidden) set.add(id)
  else set.delete(id)
  if (!state.moduleHidden) state.moduleHidden = {}
  state.moduleHidden[root] = [...set]
  uiSet('moduleHidden', [...set]) // OS-89：落库内
  // 在正文/世界书页上就地重排左栏（不整页重绘：正文滚动位置不该因为开关卡片被重置）；
  // 设置页等其它页面走常规 render，才能同步勾选态。
  const host = document.getElementById('ref-col')
  if (host && (state.view === 'chapters' || state.view === 'worldbook')) {
    rerenderRefCol()
    return
  }
  render()
}

/** 就地重建左栏（保留正文滚动位置）。全关时左栏整体消失。 */
function rerenderRefCol() {
  const host = document.getElementById('ref-col')
  if (!host) return
  const scroller = docScroller()
  const keepTop = scroller ? scroller.scrollTop : 0
  graphCleanup?.()
  graphCleanup = null
  const html = refColHtml()
  if (html) host.outerHTML = html
  else host.remove()
  if (scroller) scroller.scrollTop = keepTop
  afterRefColMount()
}

/** 挂载世界书图谱（OS-44）：canvas 就位后调 graph.mjs 的 mountGraph。 */
let graphCleanup = null
async function mountRefGraph() {
  const canvas = document.getElementById('ref-graph-canvas')
  if (!canvas) {
    // 图模块还在「正在构图」态（rc.graph 为空时不渲染画布）——先拉数据再挂。
    // 不做这一步就是死锁：无 canvas → 不加载数据 → 永远无 canvas，
    // 换库后（openLibrary 清了 rc.graph）图谱永远是空的（OS-65 作者实测）。
    if (!state.refCol.graph && !state.refCol.graphLoading) await loadRefGraph()
    return
  }
  if (!state.refCol.graph) {
    await loadRefGraph()
    return
  }
  const mod = await import('./graph.mjs')
  graphCleanup?.()
  graphCleanup = mod.mountGraph({
    canvas,
    graph: state.refCol.graph,
    onPick: (node) => {
      // OS-52：点节点＝出信息卡（跟世界书页大图同一套口径），跳转走卡片按钮
      state.refCol.pick = state.refCol.pick === node.id ? null : node.id
      updateGraphPickCard()
    },
    onBlank: () => {
      if (state.refCol.pick) {
        state.refCol.pick = null
        updateGraphPickCard()
      }
    }
  })
}

/** 只换小图下方的信息卡容器（不重挂画布，不丢布局）。 */
function updateGraphPickCard() {
  const host = document.getElementById('ref-graph-pick')
  if (!host) return
  const node = state.refCol.graph?.nodes?.find((item) => item.id === state.refCol.pick)
  host.innerHTML = node ? refNodeCardHtml(node, 'inline') : ''
}

/** 拉图谱数据。 */
async function loadRefGraph({ force = false } = {}) {
  const rc = state.refCol
  if (!state.current || rc.graphLoading) return
  if (rc.graph && !force) return
  rc.graphLoading = true
  rc.graphError = ''
  // 图谱模块在题材页内部：重画左栏要走对应页面的重绘，而不是改全局容器
  if (state.view === 'chapters' || state.view === 'worldbook') render()
  else renderRefCol()
  try {
    const payload = await api(`/api/reference/graph?root=${encodeURIComponent(state.current.path)}`)
    rc.graph = { nodes: payload.nodes || [], edges: payload.edges || [], stats: payload.stats || {} }
  } catch (error) {
    rc.graph = null
    rc.graphError = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  rc.graphLoading = false
  if (state.view === 'chapters' || state.view === 'worldbook') render()
  else renderRefCol()
}

/**
 * 世界书摘要（OS-44）：让 AI 读当前章节关联的世界书，总结成本章要点。
 * 走 ephemeral——不建会话、不污染会话列表。
 */
/**
 * 单次 Agent 调用（OS-50 补齐）：走 ephemeral 通道——不建会话、不落档、不进会话列表。
 * 与润笔共用 streamChat；只收文本，thinking/tool 一律丢弃。
 * 注意：这个函数原先只有调用点、没有定义，世界书摘要一点就 ReferenceError。
 */
async function runAgentOnce(prompt, { timeoutMs = 120000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  let out = ''
  let failure = null
  try {
    await streamChat({
      content: prompt,
      ephemeral: true,
      controller,
      onDelta: (chunk) => { out += chunk },
      onError: (error) => { failure = error }
    })
  } finally {
    clearTimeout(timer)
  }
  if (failure) throw new Error(failure.message || '模型调用失败')
  return text(out).trim()
}

async function runRefSummary() {
  const rc = state.refCol
  if (!state.current || rc.summaryBusy) return
  if (!agent.configured) {
    rc.summaryError = '先配置模型端点（右上角设置 → Agent 运行时）'
    repaintRefModule('summary')
    return
  }
  rc.summaryBusy = true
  rc.summaryError = ''
  repaintRefModule('summary')
  try {
    // 材料口径（OS-45 单向原则）：**世界书只暴露链接，不给正文/摘要**——世界书内容由 Agent
    // 自己按路径去读（它有读文件能力），否则等于把世界书资料全量灌进上下文。
    // 章节正文本身是作者要总结的对象，给开头即可。
    const chapter = text(state.chapterText).slice(0, 1200)
    const graph = state.refCol.graph
    const chapterPath = text(state.chapterFile)
    // 与当前章节直接相连的世界书优先，其余按标签/度数补足
    const linked = (graph?.edges || [])
      .filter((edge) => edge.a === chapterPath || edge.b === chapterPath)
      .map((edge) => (edge.a === chapterPath ? edge.b : edge.a))
    const noteByPath = new Map((state.reference.notes || []).map((note) => [note.path, note]))
    const picked = []
    for (const path of linked) {
      const note = noteByPath.get(path)
      if (note && !note.isTagNote) picked.push(note)
    }
    for (const note of state.reference.notes || []) {
      if (picked.length >= 10) break
      if (note.isTagNote || picked.includes(note)) continue
      picked.push(note)
    }
    const refLinks = picked.slice(0, 10)
      .map((note) => `- ${note.title}　${note.path}${note.tags?.length ? `　(${note.tags.map((tag) => `#${tag}`).join(' ')})` : ''}`)
      .join('\n')
    const prompt = [
      '【世界书摘要】',
      chapterPath ? `当前章节：${chapterPath}` : '（还没选章节）',
      chapter ? `\n章节开头：\n${chapter}` : '',
      refLinks ? `\n可用世界书（只有链接，需要内容请自行读取对应文件）：\n${refLinks}` : '',
      '',
      '请给这一章写一份要点摘要（150 字以内）：这一章要推进什么、涉及哪些世界书资料、有什么要注意的伏笔或设定约束。',
      '需要世界书细节时用你的读文件能力打开上面列出的路径，不要凭空猜测。只输出摘要正文，不要标题、不要解释。'
    ].filter(Boolean).join('\n')
    const result = await runAgentOnce(prompt)
    rc.summary = result || '（模型没有返回内容）'
  } catch (error) {
    rc.summaryError = humanizeAgentError(error)
  }
  rc.summaryBusy = false
  repaintRefModule('summary')
}

/** 保存世界书笔记（走 /api/chapter 通道，复用原子写＋.history 备份）。 */
/* OS-53：textarea 版 saveReferenceNote 已退役——实时逐块编辑由 commitRefBlock 接管。 */

/** 把当前世界书笔记塞进 Agent 上下文（复用 OS-24 的 chip 机制）。 */
async function sendReferenceToAgent() {
  const note = state.reference.note
  if (!note) return
  if (dshBridgeAvailable()) {
    // 嵌入模式：世界书正文作为引用块进 DSH 输入框（附世界书来源）
    const body = text(note.text).trim().slice(0, 2000) || note.title
    reportDshBridge(await sendToDshAgent({ quote: body, hint: openStorySourceNote('reference') + `世界书《${note.title}》：` }))
    return
  }
  agent.pendingContext = {
    quote: note.title,
    context: text(note.text).slice(0, 2000),
    label: `世界书：${note.title}（${text(note.text).replace(/\s/gu, '').length} 字）`
  }
  renderAgent()
  const input = document.getElementById('agent-input')
  input?.focus()
}

/** 新建笔记/标签的弹层。 */
function openNewReferenceModal(kind) {
  const isTag = kind === 'tag'
  openModal(`
    <h3>${isTag ? '新建标签' : '新建世界书笔记'}</h3>
    <p class="sub">${isTag
      ? '标签是人话的分类——给每个标签写一句描述，用的时候一眼知道它什么意思。'
      : '世界书笔记写你查到的、想到的、要记住的。写作时左栏图谱会把它和章节连起来。'}</p>
    <div class="field"><label>${isTag ? '标签名（不含 #）' : '标题'}</label>
      <input id="ref-new-name" placeholder="${isTag ? '例如：伏笔' : '例如：渡口钟声'}">
    </div>
    ${isTag ? `
    <div class="field"><label>描述（这个标签是什么意思）</label>
      <input id="ref-new-desc" placeholder="例如：埋下但尚未回收的线索">
    </div>` : `
    <div class="field"><label>放在哪个子目录（可留空）</label>
      <input id="ref-new-dir" placeholder="例如：人物 / 设定">
    </div>`}
    <div class="err" id="ref-new-err"></div>
    <div class="ops">
      <button class="btn-ghost" data-action="modal-close">取消</button>
      <button class="btn-primary" data-action="ref-create" data-kind="${esc(kind)}">创建</button>
    </div>
  `)
  document.getElementById('ref-new-name')?.focus()
}

/** 从弹层创建世界书笔记 / 标签笔记。 */
async function createReferenceFromModal() {
  const errEl = document.getElementById('ref-new-err')
  const name = text(document.getElementById('ref-new-name')?.value).trim()
  if (!name) { if (errEl) errEl.textContent = '名字不能为空'; return }
  const descEl = document.getElementById('ref-new-desc')
  const isTag = Boolean(descEl) // 弹层里有描述框＝在新建标签
  const dirInput = text(document.getElementById('ref-new-dir')?.value).trim().replace(/^[\\/]+/u, '')
  const safe = name.replace(/[\\/:*?"<>|]/gu, '_')
  // 标签笔记固定进 世界书/标签/；普通笔记按作者指定的子目录
  const file = isTag
    ? `${registryModule.namingEntry('worldbook').dir}/标签/${safe}.md`
    : (dirInput ? `${registryModule.namingEntry('worldbook').dir}/${dirInput}/${safe}.md` : `${registryModule.namingEntry('worldbook').dir}/${safe}.md`)
  const body = isTag
    ? `---\nkind: tag\ntag: ${name}\ndescription: ${text(descEl.value).trim()}\n---\n\n`
    : `---\ntags: []\n---\n\n# ${name}\n\n`
  try {
    await api('/api/reference/note', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, path: file, text: body })
    })
    closeModal()
    await loadReferences({ force: true })
    if (isTag) {
      state.reference.activeTag = name
      render()
    } else {
      state.reference.activePath = file
      await openReference(file)
    }
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

/** 迁入旧目录弹层（OS-48）：显式动稿——确认后才搬，原稿进 .history 可逆。 */
function openAbsorbModal() {
  const absorb = state.reference.absorb || {}
  const rows = ['大纲', '构思', '资料', '约束'].map((dir) => {
    const count = Number(absorb[dir]) || 0
    if (!count) return ''
    return `<label class="absorb-row"><input type="checkbox" checked data-absorb-dir="${esc(dir)}">
      <span><b>${esc(dir)}/</b> ${count} 篇 → <span class="hint">${registryModule.namingEntry('worldbook').dir}/${esc(dir)}/</span></span></label>`
  }).join('')
  if (!rows) return
  openModal(`
    <h3>迁入旧目录</h3>
    <p class="sub">这些旧目录的内容会搬进「世界书」，并入图谱与双链体系。搬运是显式动作：
      目标重名不覆盖；原稿挪进 <span class="hint">.history</span> 备份，随时可捞回。</p>
    <div class="absorb-list">${rows}</div>
    <div class="err" id="ref-absorb-err"></div>
    <div class="ops">
      <button class="btn-ghost" data-action="modal-close">取消</button>
      <button class="btn-primary" data-action="ref-absorb-run">迁入</button>
    </div>
  `)
}

/** 执行迁入：POST /api/reference/absorb → 刷新世界书索引与图谱缓存。 */
async function runAbsorbFromModal() {
  const errEl = document.getElementById('ref-absorb-err')
  const dirs = [...document.querySelectorAll('[data-absorb-dir]')]
    .filter((input) => input.checked)
    .map((input) => input.dataset.absorbDir)
  if (!dirs.length) { if (errEl) errEl.textContent = '至少勾一个目录'; return }
  try {
    const payload = await api('/api/reference/absorb', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, dirs })
    })
    closeModal()
    state.refCol.graph = null // 迁移后图谱要重建
    state.reference.flash = `已迁入 ${payload.moved?.length ?? 0} 篇${payload.skipped?.length ? `，跳过 ${payload.skipped.length} 篇（${payload.skipped[0]?.reason || '目标重名'}）` : ''}`
    await loadReferences({ force: true })
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

function artifactsHtml() {
  // OS-161：纯构造函数已迁 views/workbenchViews.mjs；这里取数＋注入工具后转交。
  return workbenchViews.artifactsHtml({
    current: state.current, inventory: state.artifacts,
    groupLabel, formatBytes, formatAt, flowError, esc
  })
}

/** 恢复历史版本：读历史档 → PUT 回原文件（写前自动 .history 备份＝恢复动作也留档）。OS-211：按目标所属写端点路由（views/artifactRestoreRoute）。 */
async function restoreArtifact(historyFile, original) {
  const confirmed = globalThis.confirm?.(`把「${original}」恢复成这份历史版本？当前内容会先自动备份进 .history。`)
  if (!confirmed) return
  const inventory = state.artifacts
  try {
    const route = workbenchViews.artifactRestoreRoute(original, { worldbookDir: registryModule.namingEntry('worldbook').dir })
    const readKey = route.kind === 'worldbook' ? 'path' : 'file'
    const read = await api(`${route.read}?${new URLSearchParams({ root: state.current.path, [readKey]: historyFile })}`)
    const version = route.kind === 'worldbook' ? read.note?.text ?? '' : read.text
    await api(route.put, { method: 'PUT', body: JSON.stringify({ root: state.current.path, [readKey]: original, text: version }) })
    inventory.previewFile = original
    await openArtifacts({ force: true })
  } catch (error) {
    inventory.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

async function saveAgentSettings() {
  const errEl = document.getElementById('settings-err')
  const endpoint = document.getElementById('cfg-endpoint').value.trim()
  const model = document.getElementById('cfg-model').value.trim()
  const key = document.getElementById('cfg-key').value
  const reasoningEl = document.getElementById('cfg-reasoning')
  const reasoningEffort = reasoningEl ? reasoningEl.value.trim() : undefined
  const chineseEl = document.getElementById('cfg-chinese-reasoning')
  const chineseReasoning = chineseEl ? chineseEl.checked : undefined
  try {
    const payload = await api('/api/agent/config', {
      method: 'PUT',
      body: JSON.stringify({
        endpoint,
        model,
        ...(key.trim() ? { apiKey: key } : {}),
        ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
        ...(chineseReasoning !== undefined ? { chineseReasoning } : {})
      })
    })
    agent.configured = payload.configured === true
    agent.endpoint = text(payload.endpoint)
    agent.model = text(payload.model)
    agent.apiKeyMasked = text(payload.apiKeyMasked)
    agent.configPath = text(payload.configPath)
    agent.reasoningEffort = text(payload.reasoningEffort)
    agent.chineseReasoning = payload.chineseReasoning !== false
    updateAgentChip()
    updateComposerState()
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

/** 拉 DSH 的模型与推理深度选项（设置页下拉的选项源；失败静默，不摆假选项）。 */
async function loadDshReasoningOptions() {
  try {
    const payload = await api('/api/agent/dsh/models')
    agent.dshModels = Array.isArray(payload.models) ? payload.models : []
    const options = []
    for (const model of payload.models || []) {
      for (const option of model.reasoningOptions || []) {
        if (!options.some((item) => item.id === option.id)) {
          options.push({ id: option.id, name: option.name, default: option.default === true })
        }
      }
    }
    agent.dshReasoningOptions = options
  } catch {
    agent.dshModels = []
    agent.dshReasoningOptions = []
  }
}

function openCardModal(msgIndex) {
  const item = agent.items[Number(msgIndex)]
  if (!item || item.kind !== 'msg' || item.role !== 'assistant') return
  openCardModalFor(item.content, agent.sessionId, '这段对话还没有落档会话，先发一条消息再转卡片。')
}

/** 卡弹层通用入口：左列消息与推演页都走这里（卡跟着 sessionId 所在的会话走）。 */
function openCardModalFor(cardText, sessionId, noSessionHint = '先开始一段对话，再把回答转卡片。') {
  if (!sessionId) {
    rememberAgentError(noSessionHint)
    renderAgent()
    return
  }
  state.cardModal = { sessionId }
  // 目标下拉：章节清单优先（号＋标题人话），没有就退回文件直列/自由路径。
  const options = (state.write.chapters.length
    ? state.write.chapters.map((chapter) => ({
        file: chapter.file,
        label: `${chapter.no !== null ? `${String(chapter.no).padStart(2, '0')} ` : ''}${chapter.title}`
      }))
    : state.chapterFiles.map((file) => ({ file, label: file })))
    .map((option) => `<option value="${esc(option.file)}"${option.file === state.chapterFile ? ' selected' : ''}>${esc(option.label)}</option>`)
    .join('')
  openModal(`
    <h3>转为待确认卡</h3>
    <p class="sub">创建时记录目标正文的快照；采纳时如果文件已被改过（比如被外部工具修改过），会拒绝写入而不是覆盖。</p>
    <div class="field"><label>目标章节（库内相对路径，可手改）</label>
      ${options ? `<select id="card-file-select">${options}</select>` : ''}
      <input id="card-file-input" placeholder="正文/xxx.md" value="${esc(state.chapterFile)}">
    </div>
    <div class="field"><label>写入内容</label>
      <textarea id="card-text">${esc(cardText)}</textarea>
    </div>
    <div class="field"><label>备注（可选）</label>
      <input id="card-note" placeholder="这段是什么、为什么这么写">
    </div>
    <div class="err" id="modal-err"></div>
    <div class="ops">
      <button class="btn-ghost" data-action="modal-close">取消</button>
      <button class="btn-primary" data-action="card-create">创建卡片</button>
    </div>
  `)
  const select = document.getElementById('card-file-select')
  if (select) {
    select.addEventListener('change', () => {
      const input = document.getElementById('card-file-input')
      if (input) input.value = select.value
    })
  }
}

async function submitCard() {
  const errEl = document.getElementById('modal-err')
  const file = document.getElementById('card-file-input').value.trim()
  const cardText = document.getElementById('card-text').value
  const note = document.getElementById('card-note').value
  const sessionId = state.cardModal?.sessionId
  if (!sessionId) {
    if (errEl) errEl.textContent = '先开始一段对话，再把回答转卡片。'
    return
  }
  if (!file || !cardText.trim()) {
    if (errEl) errEl.textContent = '目标文件和内容都要填。'
    return
  }
  try {
    await api('/api/agent/cards', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId, file, text: cardText, note })
    })
    closeModal()
    state.cardModal = null
    agent.cardError = null
    // 卡跟着它的会话走：推演页建的卡也把左列切过去，作者随手就能采纳。
    if (sessionId !== agent.sessionId) {
      agent.sessionId = sessionId
      await loadSessions()
    }
    await reloadThread()
    renderAgent()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

async function adoptCard(cardId, { confirmed = false } = {}) {
  agent.cardError = null
  try {
    await api('/api/agent/cards/adopt', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: agent.sessionId, id: cardId, ...(confirmed ? { confirm: true } : {}) })
    })
    // 正文被 Agent 改了：正文页签缓存作废，正开着就重读。
    state.chapterLoaded = false
    state.savedAt = ''
    if (state.view === 'chapters' && state.chapterFile) loadChapter(state.chapterFile)
  } catch (error) {
    // 习惯表命中（OS-59）：不是错误——弹一次确认，作者点头再带 confirm 重发
    if (error?.details?.needsConfirm && !confirmed) {
      const hits = (error.details.habitHits || []).map((hit) => `· ${hit.message}`).join('\n')
      if (globalThis.confirm?.(`这段产物命中了你的习惯表：\n\n${hits}\n\n仍要采纳？`)) {
        await adoptCard(cardId, { confirmed: true })
        return
      }
      agent.cardError = { cardId, message: `已取消采纳（命中习惯表：${(error.details.habitHits || []).map((hit) => hit.pattern).join('、')}）` }
      renderAgent()
      return
    }
    if (error?.code === 'REVISION_MISMATCH') {
      agent.cardError = { cardId, message: text(error?.message || error) }
    } else {
      rememberAgentError(error)
    }
  }
  await reloadThread()
  renderAgent()
}

async function rejectCard(cardId) {
  agent.cardError = null
  try {
    await api('/api/agent/cards/reject', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: agent.sessionId, id: cardId })
    })
  } catch (error) {
    rememberAgentError(error)
  }
  await reloadThread()
  renderAgent()
}

/* ---------- 库管理写操作（OS-7：新建/导入/修复整页流）---------- */

// 与 next/shell/library/wizardKit.mjs 的 DECISION_ORDER 同源照抄（浏览器侧拿不到仓内模块）。
// 与 openstory/libraryManage.mjs 的 PRIMARY_CHOICES 同源（v1 内嵌修复只给两大主载体）。
function flowError(message) { return libraryFlowViews?.flowError(message)  }

function joinDir(parent, name) { return libraryFlowViews?.joinDir(parent, name)  }

async function flowCreate() {
  state.create.result = null
  state.create.error = ''
  state.view = 'lib-create'
  render()
  await loadGenres()
  render()
  document.getElementById('create-parent')?.focus()
}

async function loadGenres() {
  try {
    const payload = await api('/api/genres')
    state.genres = Array.isArray(payload.genres) ? payload.genres : []
  } catch {
    state.genres = []
  }
}

function flowImport(prefill = {}) {
  state.impo.error = ''
  state.impo.plan = null
  state.impo.report = null
  if (prefill.source !== undefined) state.impo.source = prefill.source
  if (prefill.root !== undefined) state.impo.root = prefill.root
  else if (!state.impo.root && state.current) state.impo.root = state.current.path
  else if (!state.impo.root && state.libraries.length) state.impo.root = state.libraries[0].path
  state.view = 'lib-import'
  render()
  document.getElementById('import-source')?.focus()
}

function createHtml() { return libraryFlowViews?.createHtml()  }

/** 原生选择器（OS-108）：调 daemon 弹 Windows 对话框 → 回填目标输入框。 */
/** 在资源管理器打开路径（OS-109）：文件夹＝打开；文件＝选中。失败如实提示。 */
function revealNativePath(targetPath) {
  const p = text(targetPath).trim()
  if (!p) return
  api('/api/native/reveal', { method: 'POST', body: JSON.stringify({ path: p }) })
    .catch((error) => {
      const msg = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
      state.error = msg
      render()
    })
}

function pickNativePath(triggerEl, kind) {
  const targetId = triggerEl.dataset.target || ''
  const inputEl = targetId ? document.getElementById(targetId) : null
  const current = text(inputEl?.value).trim()
  // OS-118：本会话已知原生框弹不出——直接开内建浏览器（0 延迟，不再等 8 秒超时）
  if (state.nativeDialogUnusable) {
    openFsBrowser({ kind, targetId, startPath: current || '', note: '' })
    return
  }
  api('/api/native/pick', {
    method: 'POST',
    body: JSON.stringify({
      kind,
      title: kind === 'file' ? '选择文件' : '选择文件夹',
      initialDir: current,
      ...(triggerEl.dataset.filter ? { filter: triggerEl.dataset.filter } : {})
    })
  }).then((payload) => {
    if (!payload?.ok || !payload.path) return  // 取消：静默
    applyPickedPath(triggerEl, inputEl, kind, payload.path)
  }).catch((error) => {
    const code = text(error?.code)
    // OS-110：服务进程没有交互桌面（后台启动的 daemon 弹不出模态框）
    // → 自动降级到内建目录浏览器，不依赖 Windows 对话框
    if (code === 'NO_DESKTOP') {
      // 记住：本会话后续直接走内建（下一次点击 0 等待）
      state.nativeDialogUnusable = true
      openFsBrowser({
        kind,
        targetId,
        startPath: current || '',
        note: '系统没允许弹出文件选择框（服务是后台启动的），已切换到内建目录浏览器'
      })
      return
    }
    const msg = (code ? code + ' · ' : '') + text((error && error.message) || error)
    if (state.libCreate) state.libCreate.error = msg
    else state.error = msg
    render()
  })
}

/** 把选中的路径写回输入框（文件夹＝绝对路径；文件＝完整路径或所在目录）。 */
function applyPickedPath(triggerEl, inputEl, kind, pickedPath) {
  if (!inputEl) return
  // OS-119：原生框与内建浏览器共用一份「上次选的目录」记忆
  const remembered = kind === 'folder' ? pickedPath : pickedPath.replace(/[\\/][^\\/]+$/u, '')
  if (remembered) {
    state.fsLastPicked = remembered
    api('/api/fs/browse', { method: 'POST', body: JSON.stringify({ path: remembered, remember: true }) }).catch(() => {})
  }
  inputEl.value = kind === 'folder'
    ? pickedPath
    : (triggerEl.dataset.mode === 'full' ? pickedPath : pickedPath.replace(/[\\/][^\\/]+$/u, ''))
  inputEl.dispatchEvent(new Event('input', { bubbles: true }))
  render()
}

/* ---------- 内建目录浏览器（OS-110 兜底）----------
 * 调 /api/fs/browse 列盘符/子目录，任何环境都能用（不依赖 Windows 桌面栈）。 */

function openFsBrowser({ kind = 'folder', targetId = '', startPath = '', note = '' } = {}) {
  // OS-119：起点＝输入框已有值，否则交给 daemon 的默认根
  // （作者口径：默认目录「始终」是 C 盘 OpenStory——不是上次逛到哪就从哪开始）。
  // 「上次选择」只作弹层里的一个快捷入口，不改变默认起点。
  const remembered = text(state.fsLastPicked).trim()
  const start = text(startPath).trim()
  state.fsBrowse = {
    open: true, kind, targetId,
    path: start, parent: '', entries: [], loading: true, error: '', note,
    isDefaultRoot: false, defaultRoot: '', lastPicked: remembered
  }
  renderFsBrowserModal()
  loadFsBrowse(start)
}

async function loadFsBrowse(pathToLoad, { remember = false } = {}) {
  const fb = state.fsBrowse
  if (!fb) return
  fb.loading = true
  fb.error = ''
  renderFsBrowserModal()
  try {
    const payload = await api('/api/fs/browse', {
      method: 'POST',
      body: JSON.stringify({ path: pathToLoad || '', ...(remember ? { remember: true } : {}) })
    })
    fb.path = payload.path || ''
    fb.parent = payload.parent || ''
    fb.entries = Array.isArray(payload.entries) ? payload.entries : []
    fb.isDefaultRoot = payload.isDefaultRoot === true
    fb.defaultRoot = text(payload.defaultRoot).trim()
    fb.lastPicked = text(payload.lastPicked).trim()
    // 服务端认的记忆＝真源：同步回前端，下次开窗直接用
    if (fb.lastPicked) state.fsLastPicked = fb.lastPicked
  } catch (error) {
    fb.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  fb.loading = false
  renderFsBrowserModal()
}

/** 内建浏览器的浮层 HTML（用 openModal 挂载）。 */
function renderFsBrowserModal() { return libraryFlowViews?.renderFsBrowserModal()  }

function importHtml() { return libraryFlowViews?.importHtml()  }

function planHtml(plan) { return libraryFlowViews?.planHtml(plan)  }

function reportHtml(report) { return libraryFlowViews?.reportHtml(report)  }

function repairHtml() { return libraryFlowViews?.repairHtml()  }

async function submitCreate() {
  const create = state.create
  create.parent = document.getElementById('create-parent')?.value ?? create.parent
  create.name = document.getElementById('create-name')?.value ?? create.name
  const parent = create.parent.trim()
  const name = create.name.trim()
  create.error = ''
  if (!parent || !name) {
    create.error = '位置和库名都要填。'
    render()
    return
  }
  create.running = true
  render()
  try {
    const payload = await api('/api/library/create', {
      method: 'POST',
      body: JSON.stringify({
        path: joinDir(parent, name),
        name,
        ...(create.primary ? { primaryCarrier: create.primary } : {})
      })
    })
    create.result = payload
    await refreshLibraries()
    // OS-19：体裁声明＝一等约束——建库后立刻写项目简报（失败如实报，不假装成功）
    if (create.genre) {
      const lengthInput = document.getElementById('create-length')?.value
      const perUnitInput = document.getElementById('create-per-unit')?.value
      const selectedGenre = (state.genres || []).find((item) => item.id === create.genre)
      try {
        await api('/api/brief', {
          method: 'PUT',
          body: JSON.stringify({
            root: payload.root,
            genre: create.genre,
            ...(selectedGenre ? { deliverables: selectedGenre.deliverables } : {}),
            length: {
              ...(lengthInput ? { total: Number(lengthInput) } : {}),
              ...(perUnitInput ? { perUnit: Number(perUnitInput) } : {}),
              ...(selectedGenre ? { divideBy: selectedGenre.length.divideBy } : {})
            }
          })
        })
        create.result.briefWritten = true
      } catch (error) {
        create.result.briefError = `体裁已选但简报写入失败：${text(error?.message || error)}（可在库里重新声明）`
      }
    }
  } catch (error) {
    create.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  create.running = false
  render()
}

async function scanImportFlow() {
  const impo = state.impo
  impo.root = document.getElementById('import-root')?.value ?? impo.root
  impo.source = document.getElementById('import-source')?.value ?? impo.source
  impo.plan = null
  impo.report = null
  impo.error = ''
  if (!impo.root || !impo.source.trim()) {
    impo.error = '目标库和源目录都要填。'
    render()
    return
  }
  impo.running = true
  render()
  try {
    const payload = await api('/api/library/scan', {
      method: 'POST',
      body: JSON.stringify({ root: impo.root, sourcePath: impo.source.trim() })
    })
    impo.plan = payload.plan
  } catch (error) {
    impo.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  impo.running = false
  render()
}

async function runImportFlow() {
  const impo = state.impo
  impo.running = true
  impo.error = ''
  render()
  try {
    const payload = await api('/api/library/import', {
      method: 'POST',
      body: JSON.stringify({ root: impo.root, sourcePath: impo.source.trim() })
    })
    impo.report = payload.report
    impo.plan = null
  } catch (error) {
    impo.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  impo.running = false
  render()
}

async function repairSetPrimary(carrierId) {
  const repair = state.repair
  if (!repair) return
  try {
    await api('/api/library/primary', {
      method: 'POST',
      body: JSON.stringify({ root: repair.path, primaryCarrier: carrierId })
    })
    await refreshLibraries()
    state.repair = null
    await openLibrary(repair.path)
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

async function refreshLibraries() {
  try {
    const payload = await api('/api/libraries')
    state.libraries = Array.isArray(payload.libraries) ? payload.libraries : []
    state.warnings = Array.isArray(payload.warnings) ? payload.warnings : []
    state.preferencesPath = text(payload.preferencesPath)
  } catch { /* 保住旧清单 */ }
}

/* ---------- 业务页扩展（OS-8：动态页签＋目录工作面＋推演页）----------
   OS-143：页签词表/退场表/默认隐藏种子已迁 public/views/registry.mjs（唯一真源），
   本文件经顶部 registryReady 的引用壳消费它们；renderTabs/go 由注册表驱动。 */

/**
 * 页签栏（OS-36）。
 * 作者口径：「上面的这些正文/世界书/大纲/产物，它应该能删除，也应该能添加」。
 *  × ＝只把这个页签收起来，磁盘上的目录和稿子一个字节都不动；在「＋」里能再勾回来。
 *  ＋ ＝列出库里所有还没显示的目录可勾选，也能现场新建一个目录。
 * 全部是每库本机偏好（库内 ui-state，随库走），不写进业务稿，不动任何稿子。
 */
const TAB_HIDE_KEY = (root) => `openstory-tab-hidden::${root || ''}`

/** 关掉的页签集合（按库分键）。dirsPage 记的是页签名（write/entries/dir:xxx/artifacts/wiki/deduce）。 */
function hiddenTabs() {
  const root = state.current?.path || ''
  if (!state.tabHidden) state.tabHidden = {}
  if (!state.tabHidden[root]) {
    // OS-198a：页签只来自投影，退场目录名是死条目——读时忽略，写时不再追加
    state.tabHidden[root] = registryModule?.sanitizeHiddenTabs(uiGet('tabHidden', null)) ?? []
  }
  return new Set(state.tabHidden[root])
}

function setTabHidden(view, hidden) {
  const root = state.current?.path || ''
  const set = hiddenTabs()
  if (hidden) set.add(view)
  else set.delete(view)
  if (!state.tabHidden) state.tabHidden = {}
  state.tabHidden[root] = [...set]
  uiSet('tabHidden', [...set]) // OS-89：落库内
  // 关掉当前正在看的页签 → 退到第一个还开着的
  if (hidden && state.view === view) {
    const next = state.current ? 'chapters' : 'libraries'
    state.view = next
  }
  render()
}

/**
 * 「＋」新增页签面板（OS-36）。
 * 两块：① 勾选磁盘上已有的目录（勾上＝出现在页签栏）；② 现场新建一个目录。
 * 被 × 收起的内置页签（正文/世界书/产物/Wiki/推演）也在这里列出来，可勾回来。
 */
function openTabAdd() {
  if (!state.current || !registryModule) return
  const hidden = hiddenTabs()
  const slots = state.plugins?.slots
  if (!slots) {
    openModal('<h3>增加页签</h3><p class="sub">拿不到工作台清单（/api/plugins 的 slots 投影）——不能凭硬编码名单猜页签。</p><div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>')
    return
  }
  // OS-198：可勾选项只来自投影；模块停用／没有页面时它根本不在投影里。
  const rows = registryModule.projectedPanelTabs(slots, undefined, {
    current: state.current,
    brief: state.brief ?? null,
    briefGenre: state.briefGenre ?? null,
    libDirs: state.libDirs,
    settingsOpen: state.settings.open
  }).map((item) => {
    const off = hidden.has(item.view)
    return `<button class="tab-pick${off ? '' : ' on'}" data-action="tab-toggle-pick" data-tab-view="${esc(item.view)}"${item.degraded ? ` disabled data-degraded="1" aria-disabled="true" title="${esc(governanceViews?.missingText?.(item.missing) ?? '')}"` : ''}>
      <span class="tp-check">${off ? '' : '✓'}</span><b>${esc(item.label)}</b>${item.degraded ? '<span class="tp-note">降级</span>' : ''}</button>`
  }).join('')
  openModal(`
    <h3>增加页签</h3>
    <p class="sub">勾上就会出现在顶栏；取消勾选只是收起页签，磁盘上的文件和稿子不受影响。页签名单与顺序由工作台 manifest 决定。</p>
    <div class="tab-pick-sec"><h4>可显示的页签</h4><div class="tab-pick-grid">${rows || '<span class="count">当前工作台没有可显示的页签</span>'}</div></div>
    <div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>
  `)
}

/** OS-83：一键建出已识别的业务目录（剧本/漫画…）并加页签——与「新建目录」同一条通道。 */
async function makeTabDir(name) {
  if (!state.current || !name) return
  const errEl = document.getElementById('tab-add-err')
  try {
    const payload = await api('/api/dir', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, name })
    })
    const topPayload = await api(`/api/files?root=${encodeURIComponent(state.current.path)}`)
    state.libDirs = Array.isArray(topPayload.dirs) ? topPayload.dirs : state.libDirs
    setTabHidden(`dir:${payload.name || name}`, false)
    openTabAdd()
    if (errEl) errEl.textContent = ''
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

/** 勾/取消勾选某个页签（面板不关，所见即所得）。 */
function toggleTabPick(view) {
  const hidden = hiddenTabs()
  setTabHidden(view, !hidden.has(view))
  openTabAdd() // 重画面板保持打开
}

/** 新建目录并立刻让它出页签。 */
async function createTabDir() {
  const input = document.getElementById('tab-new-dir')
  const errEl = document.getElementById('tab-add-err')
  const name = text(input?.value).trim()
  if (!name) { if (errEl) errEl.textContent = '先填一个目录名'; return }
  try {
    const payload = await api('/api/dir', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, name })
    })
    // 刷新目录清单 → 新目录会以 dir:xxx 出现在页签里
    const topPayload = await api(`/api/files?root=${encodeURIComponent(state.current.path)}`)
    state.libDirs = Array.isArray(topPayload.dirs) ? topPayload.dirs : state.libDirs
    setTabHidden(`dir:${payload.name || name}`, false)
    openTabAdd()
    if (input) input.value = ''
    if (errEl) errEl.textContent = ''
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

/* OS-198：页签只照 `/api/plugins.slots.tab` 投影渲染——顺序、名称、模块归属都来自 manifest。
   投影拿不到时如实显示「拿不到工作台清单」，绝不退回硬编码名单。 */
function renderTabs() {
  const tabsEl = document.getElementById('tabs')
  if (!tabsEl || !registryModule) return
  const hidden = state.current ? hiddenTabs() : new Set()
  const slots = state.current ? state.plugins?.slots : {}
  if (state.current && !slots) {
    tabsEl.innerHTML = `<span class="tab tab-off" title="${esc(state.plugins?.error || '没能取到 /api/plugins 的 slots 投影')}">拿不到工作台清单</span>`
    return
  }
  const defs = registryModule.projectedTabDefs({
    slots: slots ?? {},
    ctx: {
      current: state.current,
      brief: state.brief ?? null,
      briefGenre: state.briefGenre ?? null,
      libDirs: state.libDirs,
      settingsOpen: state.settings.open
    }
  })
  const visible = registryModule.visibleTabDefs(defs, hidden)
  const tabHtml = visible.map((def) => registryModule.tabButtonHtml(def, { active: state.view === def.view, esc, missingText: (...args) => governanceViews?.missingText?.(...args) })).join('')
  // 末尾「＋」：把被收起的页签勾回来（只在投影内勾选，不另造名单）
  const addBtn = state.current ? '<button class="tab tab-add" data-action="tab-add-open" title="增加页签">＋</button>' : ''
  tabsEl.innerHTML = tabHtml + addBtn
}

/* OS-162：宿主顶栏「导入 / 导出」——模块注册的动作，停用即不出现（同 OS-144 分析入口口径）。
   流程：选格式与目标书 → 贴 JSONL/pedia JSON → 先 dryRun 预览 → 作者确认才真写。 */
function openExchangeDialog() {
  if (!state.current) return
  document.getElementById('exchange-dialog')?.remove()
  const box = document.createElement('div')
  box.id = 'exchange-dialog'
  box.className = 'modal-mask'
  box.innerHTML = `<div class="modal-card">
    <div class="doc-head"><h2>导入 / 导出（NovelPedia ↔ fact）</h2></div>
    <div class="row"><label>方向 <select id="ex-dir"><option value="import">导入 pedia → fact</option><option value="export">导出 fact → pedia</option></select></label></div>
    <div class="row"><label>目标书 id <input id="ex-book" placeholder="例如 shuihu" value="${esc(state.current.name || '')}"></label></div>
    <div class="row"><label>格式 <select id="ex-format"><option value="pedia/v1">pedia/v1 (JSON)</option><option value="jsonl">JSONL</option></select></label></div>
    <div class="row" id="ex-text-row"><label>JSON 文本 <textarea id="ex-text" rows="8" placeholder="粘贴 pedia/v1 条目或 JSONL 每行一条"></textarea></label></div>
    <div class="row"><button class="btn-primary" data-action="exchange-run">先预览（dryRun）</button><button class="btn-ghost" data-action="exchange-close">关闭</button></div>
    <pre id="ex-result" class="ex-result"></pre>
  </div>`
  document.body.appendChild(box)
}

async function runExchange() {
  const dir = document.getElementById('ex-dir')?.value
  const bookId = text(document.getElementById('ex-book')?.value).trim()
  const format = document.getElementById('ex-format')?.value
  const resultEl = document.getElementById('ex-result')
  if (!bookId || !resultEl) return
  if (dir === 'export') {
    resultEl.textContent = '导出中…'
    try {
      const payload = await api('/api/exchange/export', { method: 'POST', body: JSON.stringify({ root: state.current.path, bookId, format }) })
      resultEl.textContent = `导出 ${payload.entries?.length || 0} 条；丢失字段：${(payload.lost || []).join('、') || '无'}
${JSON.stringify(payload.entries, null, 2).slice(0, 4000)}`
    } catch (error) { resultEl.textContent = `${error?.code || '错误'} · ${text(error?.message || error)}` }
    return
  }
  const raw = document.getElementById('ex-text')?.value || ''
  const body = JSON.stringify({ root: state.current.path, bookId, format, text: raw })
  // 两段确认：初次＝dryRun 预览；再点一次（pending 态）才真写——作者确认前绝不落盘。
  const dryRun = resultEl.dataset.confirmed !== 'pending'
  try {
    const payload = await api('/api/exchange/import', { method: 'POST', body: JSON.stringify({ ...JSON.parse(body), dryRun }) })
    if (dryRun) {
      resultEl.textContent = `预览：${payload.entries} 条通过，跳过 ${payload.skipped?.length || 0}，错误 ${payload.errors?.length || 0}。确认无误请再点一次「写盘」。`
      resultEl.dataset.confirmed = 'pending'
      return
    }
    resultEl.dataset.confirmed = ''
    resultEl.textContent = `已写入 ${payload.entries} 条（revision ${payload.written?.revision ?? '—'}）。`
    render()
  } catch (error) {
    resultEl.textContent = `${error?.code || '错误'} · ${text(error?.message || error)}`
  }
}

/** OS-203：入口三态——停用隐藏、降级置灰并带统一说明、健康照旧（slotState 唯一判定）。 */
const slotAction = (slot, page, title) => registryModule.slotActionAttrs(registryModule.slotState(state.plugins?.slots, slot, page), title, { esc, missingText: (...args) => governanceViews?.missingText?.(...args) })

/* ---------- 顶栏库切换器（OS-12）---------- */

function renderLibSwitchPanel() {
  const panel = document.getElementById('lib-switch-panel')
  if (!panel) return
  if (!panel.classList.contains('open')) return // 收起状态不渲染内容，展开时再渲染
  const rows = state.libraries.map((library) => `
    <button class="sw-lib${library.path === state.current?.path ? ' on' : ''}" data-lib-path="${esc(library.path)}">
      <b>${esc(library.name)}</b>
      <span class="path">${esc(library.path)}</span>
    </button>`).join('')
  panel.innerHTML = state.libraries.length
    ? `${rows}
       <div class="divider"></div>
       <div class="ops">
         <button data-go="libraries">管理库</button>
         <button data-action="flow-create">＋新建库</button>
         <button data-action="flow-import">导入稿件</button>
         ${registryModule.slotState(state.plugins?.slots, 'host-actions', 'exchange').present ? `<button data-action="exchange-open"${slotAction('host-actions', 'exchange', '导入/导出')}>导入/导出</button>` : ''}
       </div>`
    : `<div class="empty">还没有库。<br>从建一个空库或导入一份稿子开始。</div>
       <div class="divider"></div>
       <div class="ops">
         <button data-action="flow-create">＋新建库</button>
         <button data-action="flow-import">导入稿件</button>
       </div>`
}

/* ---------- 通用文件工作面（大纲/构思/资料/约束/日志… 每页一个模块）---------- */

function dirWork(dir) {
  if (!state.dirWork[dir]) {
    state.dirWork[dir] = { files: [], file: '', text: '', loaded: false, savedAt: '', note: '', loading: false, error: '' }
  }
  return state.dirWork[dir]
}

async function openDirWork(dir) {
  state.view = `dir:${dir}`
  // OS-89：await 且在早退之前——目录已缓存时会直接 return，日志就拉不到
  await loadModuleLog(dir, { limit: 20 })
  const work = dirWork(dir)
  if (work.files.length && (work.loaded || READONLY_DIRS.has(dir))) {
    render()
    return
  }
  work.loading = true
  work.error = ''
  render()
  try {
    const payload = await api(`/api/files?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent(dir)}`)
    work.files = Array.isArray(payload.files) ? payload.files : []
    if (work.files.length && !work.file) {
      work.file = work.files[0].file
      await loadDirFile(dir, work.file)
      return
    }
    work.loaded = true
  } catch (error) {
    work.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  work.loading = false
  render()
}

async function loadDirFile(dir, file) {
  const work = dirWork(dir)
  work.file = file
  work.loading = true
  work.error = ''
  work.savedAt = ''
  work.note = ''
  render()
  try {
    const payload = await api(`/api/chapter?root=${encodeURIComponent(state.current.path)}&file=${encodeURIComponent(file)}`)
    work.text = payload.text
    work.loaded = true
  } catch (error) {
    if (error?.code === 'NOT_FOUND') {
      work.text = ''
      work.loaded = true
      work.note = '文件不存在；保存会新建'
    } else {
      work.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    }
  }
  work.loading = false
  render()
}

async function saveDirFile(dir) {
  const work = dirWork(dir)
  if (!work.loaded) return
  work.loading = true
  work.error = ''
  render()
  try {
    const payload = await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: work.file, text: work.text })
    })
    work.savedAt = payload.savedAt
    work.note = payload.backup ? `上一版备份：${payload.backup}` : ''
  } catch (error) {
    work.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  work.loading = false
  render()
}

async function createDirFile(dir) {
  const input = document.getElementById('dirfile-new-name')
  const raw = text(input?.value).trim()
  if (!raw) return
  const fileName = /\.[a-z0-9]+$/iu.test(raw) ? raw : `${raw}.md`
  const work = dirWork(dir)
  try {
    await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: `${dir}/${fileName}`, text: '' })
    })
    work.files = []
    work.file = `${dir}/${fileName}`
    work.text = ''
    work.loaded = true
    work.savedAt = ''
    work.note = '新文件已建'
    await openDirWork(dir)
    if (work.file === `${dir}/${fileName}` && !work.loaded) await loadDirFile(dir, work.file)
  } catch (error) {
    work.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/** ---------- 故事源（S2）：Fact 链的三形态 ----------
 * 数据源：/api/fact/entries（条目＋provenance）＋ /api/fact/curve（wiki 章纲＋计数）
 *        ＋ /api/enrich/graph（因果/台账，右栏辐射的旁证）
 * 纯函数层在 public/storySource.mjs（浏览器/Node 双用）；这里只做装配与渲染。
 * 全部只读——fact 的写入端仍在 enrich 与抽取管线。 */

let ssModule = null
let ssModulePromise = null
let ssChartInstance = null
let ssChartResize = null
let ssEchartsPromise = null
let ssChartToken = 0

function ensureStorySourceModule() {
  if (ssModule) return Promise.resolve(ssModule)
  if (!ssModulePromise) {
    ssModulePromise = import('./storySource.mjs')
      .then((module) => { ssModule = module; return module })
      .catch((error) => { ssModulePromise = null; throw error })
  }
  return ssModulePromise
}

function freshFactView() {
  return {
    root: '', bookId: '', pickBookId: '', book: null, revision: 0,
    loaded: false, loading: false, error: '', entriesError: '',
    curve: null, graph: null, books: [], entries: [], layers: {}, total: 0,
    warnings: [], truncated: false, layout: null,
    ss: {
      view: 'outline', layer: 'all', q: '', entryId: '', chapter: 0,
      chart: 'plot-curve', openChapters: {}, folded: {}, closed: {},
      chartError: ''
    }
  }
}

async function loadFactViewData(force = false, nextBookId) {
  if (!state.current) return
  const fv = state.factView || (state.factView = freshFactView())
  if (!fv.ss) fv.ss = freshFactView().ss
  const root = state.current.path
  // 换库＝换数据源：整块状态重置，免得拿上本书的条目当这本书的
  if (fv.root && fv.root !== root) Object.assign(fv, freshFactView())
  if (nextBookId !== undefined) {
    fv.pickBookId = text(nextBookId)
    fv.ss.entryId = ''
    fv.ss.chapter = 0
  }
  // 两道闸：loading 挡递归 render；loaded 挡重复拉取（换书/换库走 force）
  if (fv.loading) return
  if (!force && fv.loaded && fv.root === root) return
  fv.loading = true
  fv.error = ''
  fv.entriesError = ''
  fv.layout = null
  render()
  try {
    const q = `root=${encodeURIComponent(root)}`
    const pick = text(fv.pickBookId).trim()
    const booksPayload = await api(`/api/fact/books?${q}`).catch(() => null)
    if (Array.isArray(booksPayload?.books)) fv.books = booksPayload.books
    fv.curve = await api(`/api/fact/curve?${q}${pick ? `&bookId=${encodeURIComponent(pick)}` : ''}`).catch(() => null)
    fv.bookId = fv.curve?.bookId || pick || ''
    const bookQuery = fv.bookId ? `&bookId=${encodeURIComponent(fv.bookId)}` : ''
    const [entriesPayload, graphPayload] = await Promise.all([
      api(`/api/fact/entries?${q}${bookQuery}&limit=500`).catch((error) => ({ __error: error })),
      fv.bookId ? api(`/api/enrich/graph?${q}&bookId=${encodeURIComponent(fv.bookId)}`).catch(() => null) : Promise.resolve(null)
    ])
    fv.graph = graphPayload
    if (entriesPayload?.__error) {
      fv.entries = []
      fv.total = 0
      fv.layers = {}
      fv.warnings = []
      fv.entriesError = entriesPayload.__error
    } else {
      fv.entries = Array.isArray(entriesPayload?.entries) ? entriesPayload.entries : []
      fv.total = Number(entriesPayload?.total) || fv.entries.length
      fv.layers = entriesPayload?.layers && typeof entriesPayload.layers === 'object' ? entriesPayload.layers : {}
      fv.warnings = Array.isArray(entriesPayload?.warnings) ? entriesPayload.warnings : []
      fv.book = entriesPayload?.book && typeof entriesPayload.book === 'object' ? entriesPayload.book : null
      fv.revision = Number(entriesPayload?.revision) || 0
      fv.truncated = fv.total > fv.entries.length
    }
    fv.root = root
    fv.loaded = true
  } catch (error) {
    fv.error = text(error?.message || error)
  }
  fv.loading = false
  if (state.view.startsWith('dir:')) render()
}

/** 嵌套槽位值拍平成人话（OS-66 补）：structure={main:...,subplot:...} 这类对象逐键展开。 */
function fvFlatten(value, depth = 0) {
  if (value === null || value === undefined || value === '') return ''
  if (Array.isArray(value)) return value.map((item) => fvFlatten(item, depth + 1)).filter(Boolean).join('；')
  if (typeof value === 'object') {
    return Object.entries(value)
      .map(([k, v]) => `${k}：${fvFlatten(v, depth + 1)}`)
      .filter((line) => line.trim().length > 2)
      .join('；')
  }
  return text(value)
}

/** 故事源数据装配：storySource.mjs 的纯函数只认 entries ＋ wiki 章纲。 */
function ssWikiOf(fv) {
  return {
    chapterSummaries: (fv?.curve?.chapters || []).map((chapter) => ({
      chapter: chapter.no,
      title: chapter.title,
      summary: chapter.summary,
      function: chapter.function,
      emotion: chapter.emotion,
      beats: chapter.beats,
      events: chapter.events,
      foreshadows: chapter.foreshadows
    })),
    // OS-74：伏笔明细（含 plantedAt/payoffAt/status）——伏笔回收图靠它画埋-收连线
    foreshadows: Array.isArray(fv?.curve?.foreshadows) ? fv.curve.foreshadows : []
  }
}

function ssLayoutOf(fv) {
  if (!fv || !ssModule) return null
  return ssModule.layoutStorySource({ entries: fv.entries, wiki: ssWikiOf(fv), view: fv.ss.view })
}

/* ---------- 故事源「图表」＝分析模块容器（S3）---------- */

/** 模块 id → ECharts 图种（注册表只管数据与结论，挂图在 app.js 这层做）。 */
const SS_CHART_KIND = Object.freeze({ 'plot-curve': 'curve', 'foreshadow-audit': 'foreshadow', 'plot-density': 'heatmap', timeline: 'timeline' })

function ssChartKind(id) {
  if (SS_CHART_KIND[id]) return SS_CHART_KIND[id]
  return ['curve', 'foreshadow', 'heatmap', 'timeline'].includes(id) ? id : 'curve'
}

/** 当前选中的 work 模块（旧值 'curve'/'foreshadow'/'heatmap' 自动落到对应模块）。 */
function ssChartModule(ss) {
  const mods = analyzeModulesFor('work')
  return mods.find((mod) => mod.id === ss?.chart) || mods[0] || null
}

function ssSelectedEntry(layout, ss) {
  if (!layout || !ss?.entryId) return null
  return layout.tree.byKey?.[ss.entryId] || null
}

/** 条目短名：剧情条目用「段N · 首事件」；其余用 name。 */
function ssEntryLabel(entry) {
  const name = text(entry?.name).trim()
  if (text(entry?.layer) === 'plot') {
    const segment = Number(entry?.provenance?.segmentIndex) || 0
    const first = text(entry?.events?.[0]?.content).replace(/\s+/gu, ' ').trim()
    if (segment) return first ? `段${segment} · ${truncate(first, 20)}` : `段${segment}`
  }
  return name || '(未命名)'
}

function ssLayerLabel(value) {
  const key = text(value).trim().toLowerCase()
  return ssModule?.STORY_LAYER_LABELS?.[key] || (key || '其他')
}

function ssLayerClass(value) {
  const key = text(value).trim().toLowerCase()
  return ['plot', 'character', 'worldview'].includes(key) ? key : 'other'
}

function ssAlignLabel(alignment) {
  return alignment === 'approximate' ? '对齐近似' : '对齐精确'
}

function ssFilteredRows(layout, ss) {
  const q = text(ss.q).trim().toLowerCase()
  return layout.board.rows.filter((row) => {
    if (ss.layer !== 'all' && row.layer !== ss.layer) return false
    if (!q) return true
    return text(row.name).toLowerCase().includes(q) || text(row.cast).toLowerCase().includes(q)
  })
}

function ssTableHtml(layout, ss) {
  // OS-161：纯构造函数已迁 views/workbenchViews.mjs；这里注入工具后转交。
  return workbenchViews.ssTableHtml(layout, ss, { esc, text, truncate })
}

function ssOutlineSideHtml(layout, ss) {
  // OS-161：纯构造函数已迁 views/workbenchViews.mjs；这里注入工具后转交。
  return workbenchViews.ssOutlineSideHtml(layout, ss, { esc, text, truncate })
}

function ssLayerSideHtml(layout, ss) {
  const layers = layout.stats.layers
  const entries = [{ key: 'all', label: '全部', n: layout.stats.entries }]
  for (const key of ['plot', 'character', 'worldview', 'other']) {
    if (!layers[key]) continue
    entries.push({ key, label: ssLayerLabel(key), n: layers[key] })
  }
  const rows = entries.map((item) => `<button class="ss-layer${ss.layer === item.key ? ' on' : ''}" data-ss-layer="${item.key}">
    <span class="ss-layer-dot ${item.key}"></span>
    <span>${esc(item.label)}</span>
    <span class="n">${item.n}</span>
  </button>`).join('')
  return `<section class="surface-card ss-card">
    <div class="ss-card-head"><h3>按层筛选</h3><span class="sub">${layout.stats.entries} 条</span></div>
    <div class="ss-layers">${rows}</div>
  </section>`
}

function ssChartSideHtml(layout, ss) {
  const mods = analyzeModulesFor('work')
  const current = ssChartModule(ss)
  const rows = mods.map((mod) => `<button class="ss-chart-btn${current?.id === mod.id ? ' on' : ''}" data-ss-chart="${esc(mod.id)}">
    ${esc(mod.label)}<span class="sub">${esc(mod.hint || '')}</span>
  </button>`).join('')
  return `<section class="surface-card ss-card">
    <div class="ss-card-head"><h3>分析模块</h3><span class="sub">${mods.length} 个 · 可插拔</span></div>
    <div class="ss-chart-list">${rows || '<p class="ss-side-note">分析模块装载中…</p>'}</div>
    <p class="ss-side-note">列表来自分析模块注册表；图色取自 :root 令牌，换皮肤后重绘。</p>
  </section>`
}

/** 图表形态的主体：模块切换条 + 选中模块的 render()。 */
function ssModuleBodyHtml(layout, ss) {
  const fv = state.factView
  const mods = analyzeModulesFor('work')
  if (!mods.length) {
    return `<section class="surface-card ss-card ss-main-card">
      <div class="ss-card-head"><h3>分析模块</h3><span class="sub">装载中…</span></div>
      <div class="loading">正在装载分析模块…</div>
    </section>`
  }
  const mod = ssChartModule(ss)
  if (!mod) return '<section class="surface-card ss-card ss-main-card"><div class="ss-empty">没有可用的作品级分析模块。</div></section>'
  if (ss.chart !== mod.id) ss.chart = mod.id
  const tabs = mods.map((item) => `<button class="ss-tab${item.id === mod.id ? ' on' : ''}" data-ss-chart="${esc(item.id)}">${esc(item.label)}</button>`).join('')
  let body
  try {
    // work 模块多为同步纯计算；timeline 用惰性 import 所以是 async——统一 await（同步值 await 无害）。
    const result = mod.run({ entries: fv?.entries || [], wiki: ssWikiOf(fv), layout })
    body = mod.render(result, { plot: true })
  } catch (error) {
    body = `<div class="ss-empty">${esc(text(error?.message || error))}</div>`
  }
  return `<section class="surface-card ss-card ss-main-card">
    <div class="ss-card-head"><h3>${esc(mod.label)}</h3><span class="sub">${esc(mod.hint || '')}</span></div>
    <div class="ss-tabs ss-module-tabs">${tabs}</div>
    <div class="ss-module-body">${body}</div>
  </section>`
}

function ssPlotBody(entry) {
  const events = Array.isArray(entry.events) ? entry.events : []
  const list = events.map((event, index) => `<article class="ss-event">
    <div class="ss-event-head">
      <span class="ss-event-no">#${esc(event.index ?? index + 1)}</span>
      ${text(event.who).trim() ? `<span class="ss-event-who">${esc(event.who)}</span>` : ''}
      ${text(event.channel).trim() ? `<span class="ss-event-channel">${esc(event.channel)}</span>` : ''}
    </div>
    <p class="ss-event-text">${esc(event.content)}</p>
  </article>`).join('')
  return list || '<div class="ss-empty">这条剧情条目还没有事件流。</div>'
}

function ssCharacterBody(entry) {
  const anchors = entry.anchors && typeof entry.anchors === 'object' ? entry.anchors : {}
  const traits = Array.isArray(entry.traits) ? entry.traits : []
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
  const lines = (title, values) => {
    const list = Array.isArray(values) ? values.filter(Boolean) : []
    if (!list.length) return ''
    return `<h4 class="ss-subhead">${esc(title)} <span>${list.length}</span></h4>
      <div class="ss-anchor-list">${list.map((value) => `<blockquote class="ss-anchor">${esc(value)}</blockquote>`).join('')}</div>`
  }
  return `${text(entry.identity).trim() ? `<p class="ss-prose">${esc(entry.identity)}</p>` : ''}
    ${traits.length ? `<div class="ss-chip-row"><span class="ss-field-k">特质</span>${traits.map((trait) => `<span class="ss-chip">${esc(trait)}</span>`).join('')}</div>` : ''}
    ${text(entry.personality).trim() ? `<p class="ss-prose">${esc(entry.personality)}</p>` : ''}
    ${aliases.length ? `<div class="ss-chip-row"><span class="ss-field-k">别名</span>${aliases.map((alias) => `<span class="ss-chip">${esc(alias)}</span>`).join('')}</div>` : ''}
    ${lines('台词锚点', anchors.speech)}
    ${lines('行为锚点', anchors.behavior)}
    ${lines('内心锚点', anchors.inner)}
    ${!anchors.speech?.length && !anchors.behavior?.length && !anchors.inner?.length ? '<div class="ss-empty">这位角色还没有台词/行为锚点。</div>' : ''}`
}

function ssFieldBody(entry) {
  const skip = new Set(['schema', 'id', 'layer', 'name', 'status', 'domain', 'sources', 'provenance', 'fingerprint', 'events', 'relations', 'anchors', 'aliases', 'notes'])
  const fields = Object.entries(entry).filter(([key, value]) => {
    if (skip.has(key) || key === '_storyKey') return false
    if (value === null || value === undefined || value === '') return false
    if (Array.isArray(value) && !value.length) return false
    return true
  })
  if (!fields.length) return '<div class="ss-empty">这条条目还没有可展示的字段。</div>'
  return `<div class="ss-fields">${fields.map(([key, value]) => `<div class="ss-field">
    <span class="ss-field-k">${esc(key)}</span>
    <span class="ss-field-v">${esc(fvFlatten(value))}</span>
  </div>`).join('')}</div>`
}

function ssEntryDetailHtml(entry, layout) {
  const meta = layout.tree.entryIndex[entry._storyKey] || {}
  const layer = text(entry.layer)
  const notes = text(entry.notes).trim()
  const body = layer === 'plot' ? ssPlotBody(entry) : (layer === 'character' ? ssCharacterBody(entry) : ssFieldBody(entry))
  return `<div class="ss-detail-head">
      <span class="ss-chip layer-${ssLayerClass(layer)}">${esc(ssLayerLabel(layer))}</span>
      <h2>${esc(ssEntryLabel(entry))}</h2>
      <span class="ss-align ${meta.alignment === 'approximate' ? 'approximate' : ''}">${esc(ssAlignLabel(meta.alignment))}</span>
    </div>
    <div class="ss-meta-line">
      <span>第 ${meta.chapter || '—'} 章${meta.chapterTitle ? `「${esc(meta.chapterTitle)}」` : ''}</span>
      <span>${esc(meta.beat || '—')}</span>
      <span>状态 ${esc(entry.status || '—')}</span>
      <span>${(entry.sources || []).length} 条溯源</span>
      <span>${(entry.events || []).length} 事件</span>
    </div>
    ${body}
    ${notes ? `<div class="ss-note"><b>备注</b>${esc(notes)}</div>` : ''}`
}

function ssChapterOverviewHtml(chapter) {
  return `<div class="ss-detail-head">
      <span class="ss-chip">第 ${chapter.chapter} 章</span>
      <h2>${esc(chapter.title || `第${chapter.chapter}章`)}</h2>
      ${chapter.function ? `<span class="ss-tag">${esc(chapter.function)}</span>` : ''}
      ${chapter.emotion ? `<span class="ss-tag emo">${esc(chapter.emotion)}</span>` : ''}
    </div>
    <div class="ss-meta-line">
      <span>${chapter.beats.length} 段</span>
      <span>${chapter.entries.length} 条目</span>
      <span>${chapter.eventCount} 事件</span>
      <span>${chapter.exact} 条精确 · ${chapter.approximate} 条近似</span>
    </div>
    ${chapter.summary ? `<p class="ss-ch-summary">${esc(chapter.summary)}</p>` : '<p class="ss-ch-summary empty">这一章还没有摘要——跑 enrich 会补。</p>'}
    <div class="ss-callout">左侧点一条条目，中栏换成它的详情（剧情=事件流 / 角色=台词·行为锚点 / 世界观=字段表）。</div>`
}

function ssBookOverviewHtml(fv, layout) {
  const title = fv.book?.title || fv.curve?.title || fv.bookId || '这本书'
  return `<div class="ss-detail-head"><h2>《${esc(title)}》</h2><span class="ss-align ${layout.stats.alignment === 'approximate' ? 'approximate' : ''}">${esc(ssAlignLabel(layout.stats.alignment))}</span></div>
    <p class="ss-prose">这是 Fact 链的可视化工作面：左栏按章／层／图切换，中栏读条目，右栏看溯源、世界书关联与扮演/分析消费点。</p>
    <div class="ss-stat-grid">
      <div class="ss-stat"><b>${layout.stats.entries}</b><span>条目</span></div>
      <div class="ss-stat"><b>${layout.stats.events}</b><span>事件</span></div>
      <div class="ss-stat"><b>${layout.stats.chapters}</b><span>章</span></div>
      <div class="ss-stat"><b>${layout.stats.sources}</b><span>溯源</span></div>
    </div>
    <div class="ss-callout">${layout.stats.approximate ? `有 ${layout.stats.approximate} 条只能按段号近似归章——页头标了「对齐近似」。` : '章号来自 provenance.chapters，全部精确对齐。'} 左侧选一章或一条条目开始。</div>`
}


function ssTraceHtml(entry, layout, ss) {
  // OS-161：纯构造函数已迁 views/workbenchViews.mjs；graph 从 state 取（读写状态留宿主）。
  return workbenchViews.ssTraceHtml(entry, layout, ss, { graph: state.factView?.graph, esc, text })
}


function factViewHtml() {
  const fv = state.factView
  const headKick = `<div class="kick">${esc(state.current?.name || '')} / 故事源</div>`
  if (!state.current) return needLibraryHtml()
  // 进页面拉一次同源检查（loaded 挡重复；换库由 loadSyncCheck 自己作废重拉）
  loadSyncCheck()
  if (!ssModule) {
    ensureStorySourceModule()
      .then(() => { if (state.view === 'dir:故事源') render() })
      .catch((error) => {
        if (state.factView) state.factView.error = text(error?.message || error)
        if (state.view === 'dir:故事源') render()
      })
    return `<div class="doc-head">${headKick}<h1>故事源</h1></div><div class="loading">正在装载故事源…</div>`
  }
  if (!fv) return `<div class="doc-head">${headKick}<h1>故事源</h1></div><div class="loading">…</div>`
  if (fv.loading && !fv.loaded) {
    return `<div class="doc-head">${headKick}<h1>故事源</h1><div class="doc-meta"><span class="b">Fact 链</span><span>正在读条目与章纲…</span></div></div><div class="loading">正在读 Fact 链…</div>`
  }
  if (fv.error && !fv.loaded) {
    return `<div class="doc-head">${headKick}<h1>故事源</h1></div>${flowError(fv.error)}`
  }
  if (fv.entriesError && ssModule.isFactUnreadableError(fv.entriesError)) {
    return `<div class="doc-head">${headKick}<h1>故事源</h1><div class="doc-meta"><span class="b">Fact 链</span><span>故事源档读不出来</span></div></div><div class="warn-box">${esc(ssModule.factUnreadableText(fv.entriesError))}——这不是「还没有故事源」：故事源/ 下有档但读不出来，修好档或删掉坏档再回来。</div>`
  }
  if (fv.entriesError && !ssModule.isFactEmptyError(fv.entriesError)) {
    return `<div class="doc-head">${headKick}<h1>故事源</h1><div class="doc-meta"><span class="b">Fact 链</span><span>条目读不了</span></div></div>${flowError(`条目读不了：${text(fv.entriesError?.message || fv.entriesError)}`)}`
  }
  if (!fv.loaded) return `<div class="doc-head">${headKick}<h1>故事源</h1></div><div class="loading">…</div>`
  if (!fv.entries.length) {
    return `<div class="doc-head">${headKick}<h1>故事源</h1><div class="doc-meta"><span class="b">Fact 链</span><span>还没有条目</span></div>${syncBarHtml()}</div>
      <div class="empty-state"><h2>还没有故事源</h2>
      <p>故事源/ 目录下没有可读的 fact 条目（或这本书只有章纲没有条目）。先在「世界书/条目」侧产出条目，跑一次 enrich，再回来。</p></div>`
  }

  const layout = ssLayoutOf(fv)
  if (!layout) return `<div class="doc-head">${headKick}<h1>故事源</h1></div><div class="loading">正在排版…</div>`
  fv.layout = layout
  const ss = fv.ss
  // 正文页「在故事源中查看」的落点：数据就绪后切到图表形态的指定模块（跨库重置也不丢）
  if (state.ssJump?.module) {
    ss.view = 'chart'
    ss.chart = state.ssJump.module
    ss.chartError = ''
    state.ssJump = null
  }
  const stats = layout.stats
  const title = fv.book?.title || fv.curve?.title || fv.bookId || '未命名'
  const bookOptions = (fv.books || []).map((book) => `<option value="${esc(book.bookId)}"${book.bookId === fv.bookId ? ' selected' : ''}>${esc(book.title || book.bookId)}${book.error ? '（坏档）' : ''}</option>`).join('')
  const currentListed = (fv.books || []).some((book) => book.bookId === fv.bookId)
  const currentOption = fv.bookId && !currentListed ? `<option value="${esc(fv.bookId)}" selected>${esc(fv.bookId)}</option>` : ''
  const pickOptions = `<option value=""${fv.bookId ? '' : ' selected'}>最新（自动）</option>${currentOption}${bookOptions}`
  const views = [['outline', '大纲'], ['board', '表格'], ['chart', '图表']]
  const viewTabs = views.map(([key, label]) => `<button class="ss-tab${ss.view === key ? ' on' : ''}" data-ss-view="${key}">${label}</button>`).join('')
  const head = `<div class="doc-head ss-doc-head">
      ${headKick}
      <h1>故事源</h1>
      <div class="doc-meta">
        <span class="b">Fact 链</span>
        <span>《${esc(title)}》${fv.revision ? ` · revision ${fv.revision}` : ''}</span>
        <select class="select" id="ss-book" title="换一本故事源数据">${pickOptions}</select>
        <span class="ss-align ${stats.alignment === 'approximate' ? 'approximate' : ''}">${esc(ssAlignLabel(stats.alignment))}</span>
        <span class="count">${stats.entries} 条目 · ${stats.chapters} 章 · ${stats.events} 事件</span>
        ${fv.truncated ? `<span class="count">只读了前 ${fv.entries.length} / ${fv.total} 条</span>` : ''}
        ${fv.warnings.length ? `<span class="count">${fv.warnings.length} 条读档警告</span>` : ''}
      </div>
      ${syncBarHtml()}
    </div>`

  // 默认展开第一段有内容的章；选中条目所在章保持展开
  if (!Object.keys(ss.openChapters).length) {
    const first = layout.tree.chapters.find((chapter) => chapter.beats.length) || layout.tree.chapters[0]
    if (first) ss.openChapters[first.chapter] = true
  }
  const selected = ssSelectedEntry(layout, ss)
  if (selected) {
    const meta = layout.tree.entryIndex[selected._storyKey]
    if (meta) ss.openChapters[meta.chapter] = true
  } else if (ss.chapter) {
    ss.openChapters[ss.chapter] = true
  }

  const left = `<aside class="ss-col ss-left">
    <section class="surface-card ss-card">
      <div class="ss-card-head"><h3>形态</h3><span class="sub">Fact 链的三种读法</span></div>
      <div class="ss-tabs">${viewTabs}</div>
    </section>
    ${ss.view === 'outline' ? ssOutlineSideHtml(layout, ss) : ''}
    ${ss.view === 'board' ? ssLayerSideHtml(layout, ss) : ''}
    ${ss.view === 'chart' ? ssChartSideHtml(layout, ss) : ''}
  </aside>`

  let middle
  if (ss.view === 'board') {
    const count = ssFilteredRows(layout, ss).length
    const layerTabs = ['all', 'plot', 'character', 'worldview', 'other']
      .filter((key) => key === 'all' || layout.stats.layers[key])
      .map((key) => `<button class="ss-tab${ss.layer === key ? ' on' : ''}" data-ss-layer="${key}">${key === 'all' ? '全部' : esc(ssLayerLabel(key))} ${key === 'all' ? layout.stats.entries : layout.stats.layers[key]}</button>`)
      .join('')
    middle = `<section class="surface-card ss-card ss-main-card">
      <div class="ss-card-head"><h3>条目表</h3><span class="sub" id="ss-board-count">${count} / ${stats.entries} 条</span></div>
      <div class="ss-tabs ss-layer-tabs">${layerTabs}</div>
      <div class="ss-board-toolbar">
        <input id="ss-search" class="ss-search" value="${esc(ss.q)}" placeholder="按名称搜索…" autocomplete="off" spellcheck="false">
        <span class="ss-board-hint">只读 · 点行选中</span>
      </div>
      <div id="ss-table-region">${ssTableHtml(layout, ss)}</div>
    </section>`
  } else if (ss.view === 'chart') {
    middle = ssModuleBodyHtml(layout, ss)
  } else if (selected) {
    middle = `<section class="surface-card ss-card ss-main-card">${ssEntryDetailHtml(selected, layout)}</section>`
  } else {
    const chapter = ss.chapter ? layout.tree.chapters.find((item) => item.chapter === Number(ss.chapter)) : null
    middle = `<section class="surface-card ss-card ss-main-card">${chapter ? ssChapterOverviewHtml(chapter) : ssBookOverviewHtml(fv, layout)}</section>`
  }

  const right = `<aside class="ss-col ss-right">${ssTraceHtml(selected, layout, ss)}</aside>`

  return `<div class="ss-wrap">${head}
    <div class="ss-grid">${left}${middle}${right}</div>
  </div>`
}

/* ---------- 故事源图表态：ECharts 按需加载＋CSS 令牌主题 ---------- */

function disposeStorySourceChart() {
  // 令牌递增：取消还在等 ECharts 脚本的挂载，避免同一 host 上 init 两次
  ssChartToken += 1
  if (ssChartResize) {
    window.removeEventListener('resize', ssChartResize)
    ssChartResize = null
  }
  if (ssChartInstance) {
    try { ssChartInstance.dispose() } catch { /* DOM 已换掉，实例自会失效 */ }
    ssChartInstance = null
  }
}

/** 本地 vendor 按需加载：只有进图表态才拉 1MB 的包，其它页签零负担。 */
function loadEcharts() {
  if (window.echarts) return Promise.resolve(window.echarts)
  if (ssEchartsPromise) return ssEchartsPromise
  ssEchartsPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = '/vendor/echarts.min.js'
    script.async = true
    script.onload = () => {
      if (window.echarts) resolve(window.echarts)
      else { ssEchartsPromise = null; reject(new Error('ECharts 脚本已加载，但全局对象缺失')) }
    }
    script.onerror = () => {
      ssEchartsPromise = null
      reject(new Error('ECharts 本地文件加载失败（public/vendor/echarts.min.js）'))
    }
    document.head.appendChild(script)
  })
  return ssEchartsPromise
}

/** 主题从 :root 令牌取值——皮肤一换，重挂图表就跟着变（不在这里写死任何色值）。 */
function ssChartTheme() {
  const style = getComputedStyle(document.documentElement)
  const token = (name) => style.getPropertyValue(name).trim()
  return {
    bg: token('--bg'),
    // ECharts 的调色器不认 color-mix 表达式——热力图低端取 --soft（实色令牌）
    card: token('--soft'),
    ink: token('--ink'),
    ink2: token('--ink-2'),
    muted: token('--muted'),
    meta: token('--meta'),
    line: token('--line'),
    hair: token('--hair'),
    accent: token('--accent'),
    ok: token('--ok'),
    warn: token('--warn'),
    danger: token('--danger'),
    font: token('--sans') || 'sans-serif'
  }
}

function ssChartOption(layout, chart, theme) {
  const data = layout.stats.charts
  const axis = {
    axisLine: { lineStyle: { color: theme.line } },
    axisTick: { show: false },
    axisLabel: { color: theme.muted },
    splitLine: { lineStyle: { color: theme.hair } }
  }
  const base = {
    backgroundColor: 'transparent',
    textStyle: { color: theme.ink, fontFamily: theme.font },
    animationDuration: 260,
    tooltip: {
      trigger: 'axis',
      backgroundColor: theme.bg,
      borderColor: theme.line,
      textStyle: { color: theme.ink }
    }
  }

  if (chart === 'foreshadow') {
    const foreshadow = data.foreshadows
    if (!foreshadow.detail && !foreshadow.counts.some((item) => item.planted > 0)) return null
    if (foreshadow.detail) {
      const points = foreshadow.points.slice(0, 90)
      const lastChapter = foreshadow.maxChapter || (data.curve.length ? data.curve[data.curve.length - 1].chapter : 1)
      const unresolved = points.filter((point) => !point.resolved)
      return {
        ...base,
        tooltip: {
          ...base.tooltip,
          trigger: 'item',
          formatter: (params) => {
            const item = params?.data
            if (!item || !item.text) return ''
            const tail = item.payoffChapter ? ` · 第${item.payoffChapter}章回收` : ' · 未收'
            return `第${item.chapter}章${tail}<br>${esc(item.text)}`
          }
        },
        grid: { left: 40, right: 24, top: 34, bottom: 34 },
        legend: { data: ['埋', '收'], top: 2, textStyle: { color: theme.muted } },
        xAxis: { type: 'value', min: 1, max: lastChapter, ...axis },
        yAxis: {
          type: 'value',
          min: -1,
          max: Math.max(1, points.length),
          name: '伏笔线',
          nameTextStyle: { color: theme.meta },
          axisLabel: { show: false },
          splitLine: { show: false },
          axisLine: { show: false }
        },
        series: [
          {
            name: '埋',
            type: 'scatter',
            symbolSize: 8,
            data: points.map((point) => ({ value: [point.chapter, point.index], chapter: point.chapter, text: point.text })),
            itemStyle: { color: theme.accent }
          },
          {
            name: '收',
            type: 'scatter',
            symbol: 'circle',
            symbolSize: 10,
            data: points.filter((point) => point.resolved).map((point) => ({
              value: [point.payoffChapter || point.chapter, point.index],
              chapter: point.payoffChapter || point.chapter,
              text: point.text,
              payoffChapter: point.payoffChapter
            })),
            itemStyle: { color: theme.bg, borderColor: theme.ok, borderWidth: 2 }
          },
          {
            name: '未收',
            type: 'lines',
            coordinateSystem: 'cartesian2d',
            silent: true,
            polyline: false,
            lineStyle: { color: theme.meta, width: 1, type: 'dashed', opacity: 0.55 },
            data: unresolved.map((point) => ({ coords: [[point.chapter, point.index], [lastChapter, point.index]] }))
          }
        ]
      }
    }
    return {
      ...base,
      grid: { left: 42, right: 24, top: 34, bottom: 34 },
      legend: { data: ['埋（条）', '累计未收'], top: 2, textStyle: { color: theme.muted } },
      xAxis: { type: 'category', data: foreshadow.counts.map((item) => item.chapter), ...axis },
      yAxis: { type: 'value', name: '伏笔', nameTextStyle: { color: theme.meta }, ...axis },
      series: [
        {
          name: '埋（条）',
          type: 'bar',
          barMaxWidth: 18,
          data: foreshadow.counts.map((item) => ({ value: item.planted, chapter: item.chapter })),
          itemStyle: { color: theme.accent, borderRadius: [3, 3, 0, 0] }
        },
        {
          name: '累计未收',
          type: 'line',
          smooth: true,
          showSymbol: false,
          data: foreshadow.counts.map((item) => ({ value: item.cumulative, chapter: item.chapter })),
          lineStyle: { color: theme.warn, width: 1.5, type: 'dashed' },
          itemStyle: { color: theme.warn }
        }
      ]
    }
  }

  if (chart === 'heatmap') {
    const heatmap = data.heatmap
    if (!heatmap.data.length) return null
    return {
      ...base,
      tooltip: {
        ...base.tooltip,
        trigger: 'item',
        formatter: (params) => {
          const value = params?.value || []
          const chapter = heatmap.xChapters[value[0]] ?? '—'
          return `第${chapter}章 · 第${Number(value[1]) + 1}段<br>${value[2]} 事件`
        }
      },
      // OS-112：格子按数据量留白——1 行数据不该撑满 420px 高，否则格子变成大色块
      grid: {
        left: 52, right: 24, top: 24,
        bottom: 58,
        containLabel: true,
        // 高度按行数自适应：每行 44px，最少 80px
        height: Math.max(80, Math.min(280, heatmap.yLabels.length * 44))
      },
      xAxis: { type: 'category', data: heatmap.xLabels, ...axis },
      yAxis: { type: 'category', data: heatmap.yLabels, ...axis },
      // OS-112：离散分档——事件数通常只有 0–5 几档，连续渐变会糊成一片同色
      visualMap: {
        min: 0,
        max: Math.max(1, heatmap.max),
        type: 'piecewise',
        pieces: Array.from({ length: Math.max(1, heatmap.max) + 1 }, (_, i) => ({ value: i, label: String(i) })),
        orient: 'horizontal',
        left: 'center',
        bottom: 0,
        itemWidth: 16,
        itemHeight: 12,
        textStyle: { color: theme.muted, fontSize: 10 },
        inRange: { color: [theme.card, theme.accent] }
      },
      series: [{
        name: '事件数',
        type: 'heatmap',
        data: heatmap.data,
        itemStyle: { borderColor: theme.bg, borderWidth: 1 },
        emphasis: { itemStyle: { shadowBlur: 6, shadowColor: theme.line } }
      }]
    }
  }

  if (!data.curve.length) return null
  return {
    ...base,
    grid: { left: 44, right: 48, top: 38, bottom: 32 },
    legend: { data: ['张力', '事件密度'], top: 2, textStyle: { color: theme.muted } },
    xAxis: { type: 'category', boundaryGap: false, data: data.curve.map((item) => item.chapter), ...axis },
    yAxis: [
      { type: 'value', name: '张力', min: 0, max: 100, nameTextStyle: { color: theme.meta }, ...axis },
      {
        type: 'value',
        name: '事件',
        nameTextStyle: { color: theme.meta },
        axisLine: { show: false },
        axisTick: { show: false },
        axisLabel: { color: theme.muted },
        splitLine: { show: false }
      }
    ],
    series: [
      {
        name: '张力',
        type: 'line',
        smooth: true,
        showSymbol: false,
        data: data.curve.map((item) => item.tension),
        lineStyle: { color: theme.accent, width: 2 },
        itemStyle: { color: theme.accent },
        areaStyle: { color: theme.accent, opacity: 0.12 }
      },
      {
        name: '事件密度',
        type: 'line',
        yAxisIndex: 1,
        smooth: true,
        showSymbol: false,
        data: data.curve.map((item) => item.density),
        lineStyle: { color: theme.ok, width: 1.5, type: 'dashed' },
        itemStyle: { color: theme.ok },
        areaStyle: { color: theme.ok, opacity: 0.08 }
      }
    ]
  }
}

function ssChartFallbackHtml(layout, chart, message) {
  // OS-161：纯构造函数已迁 views/workbenchViews.mjs；这里注入 esc 后转交。
  return workbenchViews.ssChartFallbackHtml(layout, chart, message, { esc })
}

async function mountStorySourceChart() {
  disposeStorySourceChart()
  const token = ++ssChartToken
  const host = document.getElementById('ss-chart')
  if (!host) return
  const fv = state.factView
  if (!fv?.layout || fv.ss?.view !== 'chart') return
  const kind = ssChartKind(fv.ss.chart)
  if (fv.ss.chartError) {
    host.innerHTML = ssChartFallbackHtml(fv.layout, kind, fv.ss.chartError)
    return
  }
  try {
    const echarts = await loadEcharts()
    if (token !== ssChartToken || !host.isConnected || state.view !== 'dir:故事源' || state.factView !== fv) return
    const option = ssChartOption(fv.layout, kind, ssChartTheme())
    if (!option) {
      host.innerHTML = '<div class="ss-empty">这张图还没有数据——entry 事件流或章纲还没铺开。</div>'
      return
    }
    host.innerHTML = ''
    ssChartInstance = echarts.init(host, null, { renderer: 'canvas' })
    ssChartInstance.setOption(option)
    ssChartInstance.on('click', (params) => {
      const layout = fv.layout
      if (!layout) return
      const charts = layout.stats.charts
      let chapter = 0
      if (kind === 'curve') chapter = charts.curve[params.dataIndex]?.chapter
      else if (kind === 'foreshadow') chapter = Number(params.data?.chapter ?? params.value?.[0])
      else if (kind === 'heatmap') chapter = charts.heatmap.xChapters[params.value?.[0]]
      if (!chapter) return
      fv.ss.chapter = chapter
      fv.ss.openChapters[chapter] = true
      // 让 ECharts 先把 click 事件走完，再换 DOM（避免在自己的事件里 dispose 自己）
      setTimeout(() => { if (state.view === 'dir:故事源') render() }, 0)
    })
    ssChartResize = () => { ssChartInstance?.resize() }
    window.addEventListener('resize', ssChartResize)
  } catch (error) {
    fv.ss.chartError = text(error?.message || error)
    host.innerHTML = ssChartFallbackHtml(fv.layout, kind, fv.ss.chartError)
  }
}

/** 剧本页（OS-75；OS-163 本体迁 views/scriptViews.mjs）：这里取 state 后转交纯视图。 */
function scriptViewHtml() {
  const dir = '剧本'
  const work = dirWork(dir)
  return scriptViews.scriptViewHtml({
    currentName: state.current.name,
    dir,
    label: DIR_LABELS[dir] || dir,
    work,
    stats: state.scriptModule?.scriptStats ? (source) => state.scriptModule.scriptStats(source) : null,
    body: work.loaded ? renderScriptDocBody(work.text) : '',
    modules: SCRIPT_REF_MODULES,
    refModulesHtml,
    flowError,
    esc, formatAt, formatBytes,
    analysisAttrs: slotAction('right', 'analysis', '分析本剧')
  })
}

/** 角色专属色（OS-78）：跟随「设置 · 剧本 · 角色配色」开关。关掉＝纯墨色。 */
function castColorStyle(who) {
  if (!scriptPrefs().castColors) return ''
  const c = castColorOf(who)
  return `--sc-cast-bg:${c.bg};--sc-cast-fg:${c.fg};--sc-cast-bar:${c.bar}`
}

/** 剧本逐块渲染（与 renderDocBody 同构：doc-line + doc-block + 源码偏移）。
 * 唯一区别是块内容按剧本版式渲染，而不是 markdown。 */
function renderScriptDocBody(source) {
  const mod = state.scriptModule
  if (!mod?.splitScriptBlocks) return `<div class="doc-paper"><p>${esc(source)}</p></div>`
  const blocks = mod.splitScriptBlocks(source)
  if (!blocks.length) return `<div class="doc-paper"><div class="sc-empty">还没有内容——写第一幕吧。</div></div>`
  const parts = blocks.map((block) => `<div class="doc-line" data-line="${block.index}">
      <button class="doc-gutter" data-action="gutter-jump" data-block-index="${block.index}" title="第 ${block.index + 1} 块" aria-label="第 ${block.index + 1} 块"></button>
      <div class="doc-block sc-block" contenteditable="true" spellcheck="false" data-block="${block.index}" data-start="${block.start}" data-end="${block.end}" data-raw="${esc(block.raw)}"${block.kind === 'line' ? ` style="${castColorStyle(block.who)}"` : ''}>${mod.renderScriptBlock(block)}</div>
    </div>`)
  return `<div class="doc-paper sc-doc" id="doc-reader">${parts.join('')}</div>`
}

function dirViewHtml(dir) {
  if (!state.current) return needLibraryHtml()
  // 故事源目录走专属视图（OS-66）：enrich 产出的六槽位/因果图/台账/章纲是人类可读的
  // 结构化知识，用裸 textarea 呈现等于把知识当文本埋掉。
  if (dir === '故事源') {
    loadFactViewData()
    return factViewHtml()
  }
  // OS-75：剧本走原生渲染（幕/场景指示/角色台词按剧本格式排版，不是裸 textarea）。
  // 与小说同构：逐块 contenteditable 实时编辑，失焦保存。
  if (dir === '剧本') return scriptViewHtml()
  const work = dirWork(dir)
  const readonly = READONLY_DIRS.has(dir)
  const label = DIR_LABELS[dir] || dir
  const options = work.files
    .map((item) => `<option value="${esc(item.file)}"${item.file === work.file ? ' selected' : ''}>${esc(item.name)}（${item.size} B）</option>`)
    .join('')
  const editor = work.loaded
    ? `<textarea class="editor" id="dir-editor" spellcheck="false" placeholder="${readonly ? '只读页签。' : '内容…'}"${readonly ? ' readonly' : ''}>${esc(work.text)}</textarea>`
    : `<div class="empty-state"><h2>${esc(label)}</h2><p>${readonly ? '还没有日志文件。' : '选一个文件开始，或新建一个。'}</p></div>`
  return `<div class="doc-head">
      <div class="kick">${esc(state.current.name)} / ${esc(label)}${readonly ? ' · 只读' : ''}</div>
      <h1>${esc(work.file ? work.file.split('/').pop() : label)}</h1>
      <div class="doc-meta">
        <span class="b">${esc(label)}</span>
        <span id="dir-chars">${work.text.length} 字</span>
        ${work.savedAt ? `<span class="saved-chip">已保存 · ${esc(formatAt(work.savedAt))}</span>` : ''}
        ${work.note ? `<span class="count">${esc(work.note)}</span>` : ''}
      </div>
    </div>
    ${flowError(work.error)}
    <div class="toolbar">
      ${options ? `<select class="select" id="dirfile-select">${options}</select>` : ''}
      ${readonly ? '' : `<input class="file-input" id="dirfile-new-name" placeholder="新文件名.md" value=""><button class="btn-ghost" data-action="dirfile-new">新建</button>`}
      <span class="sp"></span>
      ${readonly ? '' : `<button class="btn-primary" data-action="dirfile-save"${work.loaded ? '' : ' disabled'}>保存</button>`}
    </div>
    ${work.loading && !work.loaded ? '<div class="loading">正在读取…</div>' : editor}`
}

/* ---------- 推演页（前提/变量/分支三段 → Agent 通道 → 待确认卡）---------- */


/* ---------- 推演引擎（OS-29）：接本仓自持 fact 推演链 ---------- */

/** 呈现一拍：局面卡＋候选（引擎确定性，不需要模型）。 */
async function deduceEnginePresent(opts) {
  const options = opts || {}
  if (!state.current) return
  const engine = state.deduce.engine
  const povInput = document.getElementById('deduce-pov')
  const seedInput = document.getElementById('deduce-seed')
  if (povInput) engine.pov = povInput.value.trim()
  if (seedInput) engine.seed = seedInput.value.trim()
  // OS-93：向导开局时把选的角色卡写进 POV
  if (options.pov) engine.pov = options.pov
  engine.busy = true
  engine.error = ""
  render()
  try {
    const payload = await api("/api/deduce/present", {
      method: "POST",
      body: JSON.stringify({
        root: state.current.path,
        // OS-86：局跟 sessionId 走（peek 也带——切局后用 peek 回放那局的最后一面）
        sessionId: engine.sessionId || undefined,
        peek: options.peek === true || undefined,
        // OS-93：向导选的世界书与开头
        bookId: options.bookId || undefined,
        seedPrompt: options.seedPrompt || undefined,
        pov: engine.pov || undefined,
        seed: engine.seed === "" ? undefined : Number(engine.seed),
        reset: options.reset === true
      }),
      // peek 是软查询：NO_DEDUCE_SESSION＝合法空态（新开的局还没有第一面），不抛
      ...(options.peek === true ? { allowOkFalse: true } : {})
    })
    if (payload.ok === false) {
      // 软空态：维持空态画面，不进错误条
      engine.data = null
      if (payload.code !== 'NO_DEDUCE_SESSION') engine.hint = opts && opts.hint ? opts.hint : ""
    } else {
      engine.data = payload
      if (Array.isArray(payload.characters)) state.deduce.characters = payload.characters
      engine.flowPin = true
      engine.hint = opts && opts.hint ? opts.hint : ""
    }
  } catch (error) {
    engine.error = (error && error.code ? error.code + " · " : "") + text((error && error.message) || error)
    engine.data = null
  }
  engine.busy = false
  render()
}

/** 角色卡编辑（OS-102）：把角色档案就地改好写回库内世界书条目。
 *  优先改 世界书/ 里的同名笔记；没有就提示去世界书新建（不偷偷造文件）。 */
function roleplayEditCard(name) {
  const engine = state.deduce.engine
  const narrative = engine.data?.narrative
  const id = narrative?.identity
  const cardName = text(name).trim() || text(id?.name) || text(engine.pov)
  if (!cardName) { engineSetError('还没有可编辑的角色档案。'); return }
  const isSelf = !text(name).trim() || cardName === text(id?.name) || cardName === text(engine.pov)
  const cur = {
    identity: isSelf ? text(id?.identity) : '',
    archetype: isSelf ? text(id?.archetype) : '',
    personality: isSelf && Array.isArray(id?.personality) ? id.personality.join('，') : '',
    goal: isSelf ? text(id?.goal) : ''
  }
  openModal(`<h3>编辑角色档案 · ${esc(cardName)}</h3>
    <p class="sub">改完写回库内世界书条目（世界书/ 下标题含该角色的那篇）。关掉重开扮演就用新档案。</p>
    <div class="field"><label>身份／一句话</label>
      <input id="rc-identity" value="${esc(cur.identity)}" placeholder="如：与老人同住的年轻男子，自述神经质但坚称没疯">
    </div>
    <div class="field"><label>类型</label>
      <input id="rc-archetype" value="${esc(cur.archetype)}" placeholder="如：不可靠叙述者（自辩型）">
    </div>
    <div class="field"><label>性格（逗号分隔）</label>
      <input id="rc-personality" value="${esc(cur.personality)}" placeholder="偏执，自辩，极度敏锐">
    </div>
    <div class="field"><label>目标</label>
      <input id="rc-goal" value="${esc(cur.goal)}" placeholder="如：向听者证明自己没疯">
    </div>
    <div class="ded-image-ops">
      <button class="btn-ghost" data-action="close-modal">取消</button>
      <button class="btn-primary" data-action="roleplay-save-card" data-name="${esc(cardName)}">保存到世界书</button>
    </div>`)
}

/** 保存角色卡：找世界书笔记（标题或路径含角色名）→ 改写 frontmatter 的 identity/archetype/personality/goal。 */
async function roleplaySaveCard(name) {
  const engine = state.deduce.engine
  const cardName = text(name).trim()
  if (!state.current || !cardName) return
  const identity = text(document.getElementById('rc-identity')?.value).trim()
  const archetype = text(document.getElementById('rc-archetype')?.value).trim()
  const personality = text(document.getElementById('rc-personality')?.value).split(/[，,]/u).map((x) => x.trim()).filter(Boolean)
  const goal = text(document.getElementById('rc-goal')?.value).trim()
  try {
    if (!state.reference.loaded) await loadReferences()
    const hit = (state.reference.notes || []).find((note) => !note.isTagNote
      && (text(note.title).includes(cardName) || text(note.path).includes(cardName)))
    if (!hit) {
      closeModal()
      engineSetError(`没找到「${cardName}」的世界书条目——先去世界书新建一篇再回来编辑。`)
      render()
      return
    }
    const payload = await api('/api/reference/note?root=' + encodeURIComponent(state.current.path) + '&path=' + encodeURIComponent(hit.path))
    const raw = text(payload.note?.text)
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw)
    let fm = fmMatch ? fmMatch[1] : ''
    const setLine = (source, key, value) => {
      const re = new RegExp('^' + key + ':\\s*.*$', 'mu')
      if (!value) return source.replace(re, '').replace(/\n{3,}/gu, '\n\n').trim()
      return re.test(source) ? source.replace(re, key + ': ' + value) : (source ? source + '\n' : '') + key + ': ' + value
    }
    fm = setLine(fm, 'identity', identity)
    fm = setLine(fm, 'archetype', archetype)
    fm = setLine(fm, 'goal', goal)
    fm = setLine(fm, 'personality', personality.length ? '[' + personality.join(', ') + ']' : '')
    const body = fmMatch ? raw.slice(fmMatch[0].length) : raw
    const nextText = '---\n' + fm.trim() + '\n---' + body
    await api('/api/reference/note', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, path: hit.path, text: nextText })
    })
    closeModal()
    engine.hint = `角色档案已更新：${cardName}（${hit.path}）——下一幕起就用新档案`
    engine.opening.loaded = false
    await loadReferences({ force: true })
    render()
  } catch (error) {
    closeModal()
    engineSetError(`角色档案没存上（${(error && error.message) || error}）`)
    render()
  }
}

/** 扮演开场（OS-100）：主持人替世界拉开第一幕——开场白＋三条初始分支，不再是空白页。 */
async function deduceRoleplayOpening({ pov, openingDetail }) {
  const engine = state.deduce.engine
  if (!state.current || engine.turnBusy) return
  engine.turnBusy = true
  engine.error = ''
  render()
  try {
    const payload = await api('/api/roleplay/opening', {
      method: 'POST',
      body: JSON.stringify({
        root: state.current.path,
        pov,
        premise: openingDetail || '',
        openingDetail: openingDetail || ''
      })
    })
    engine.draft = { nodeId: '', round: 1, prose: payload.feedback ?? '', proseError: '', isOpening: true }
    engine.roleplayOptions = Array.isArray(payload.options) ? payload.options.slice(0, 4) : []
    engine.lastBeats = []
    engine.flowPin = true
    engine.hint = '开场已摆好——选一条，或在下面说你的动作'
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
    engine.hint = '开场没能拉起来——直接在下面说你这一幕做什么'
  }
  engine.turnBusy = false
  render()
}

/** 扮演一回合（OS-97）：玩家操作 → 主持人裁决谁登场 → 各角色子 agent 演绎 → 世界反馈。 */
async function deduceRoleplayTurn({ playerAction }) {
  const engine = state.deduce.engine
  if (!state.current || engine.turnBusy) return
  engine.turnBusy = true
  engine.error = ''
  engine.customText = ''
  render()
  try {
    const payload = await api('/api/roleplay/turn', {
      method: 'POST',
      body: JSON.stringify({
        root: state.current.path,
        sessionId: engine.sessionId || undefined,
        pov: engine.session?.pov || engine.pov || '',
        playerAction,
        premise: engine.opening?.selOpen && engine.opening.selOpen !== 'free'
          ? (engine.opening.openings ?? []).find((o) => o.id === engine.opening.selOpen)?.detail || ''
          : ''
      })
    })
    // 会话带回就更新（beats 已随节点存）。扮演局开局时 session 可能还是 null——
    // 这里拉一次会话，保证后续回合有容器（OS-99）
    if (payload.node) {
      if (!engine.session) {
        try {
          const fresh = await api('/api/deduce/session?root=' + encodeURIComponent(state.current.path))
          engine.session = fresh.session ?? null
        } catch { engine.session = null }
      }
      if (engine.session) {
        engine.session.cursor = payload.node.round
        engine.session.nodes.push(payload.node)
        const buffered = engine.session.buffer
        if (buffered) { buffered.nodes.push(payload.node); buffered.words += text(payload.node.prose).length }
      }
    }
    engine.draft = { nodeId: payload.node?.id ?? '', round: payload.node?.round ?? 0, prose: payload.feedback ?? '', proseError: '' }
    // OS-98：情境分支（主持人收束时给的三条下一步）＋登场角色署名（气泡渲染用）
    engine.roleplayOptions = Array.isArray(payload.options) ? payload.options.slice(0, 4) : []
    engine.lastBeats = Array.isArray(payload.beats) ? payload.beats : []
    engine.flowPin = true
    if (Array.isArray(payload.beats) && payload.beats.length) {
      engine.hint = `本幕登场：${payload.beats.map((b) => b.name).join('、')}——选一条分支，或在下面说你的动作`
    } else {
      engine.hint = '本幕空场（没有角色登场）——继续你的动作，或换一个说法'
    }
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  engine.turnBusy = false
  render()
}

/** 多局管理（OS-86）：new＝新开一局并切过去；switch＝切局；delete＝非破坏删除。
 *  成功后引擎画面清空，peek 回放新激活局的最后一面——像换了一本书读。 */
async function deduceSessionManage(action, sessionId) {
  const engine = state.deduce.engine
  if (!state.current || engine.busy) return
  engine.busy = true
  engine.error = ''
  render()
  try {
    const payload = await api('/api/deduce/session/manage', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, action, ...(sessionId ? { sessionId } : {}) })
    })
    if (Array.isArray(payload.sessions)) {
      engine.sessions = { activeId: payload.activeId ?? payload.sessionId, sessions: payload.sessions }
    }
    engine.sessionId = payload.activeId ?? payload.sessionId ?? 'main'
    engine.session = payload.session ?? null
    engine.data = null
    engine.draft = null
    engine.customText = ''
    engine.flowPin = true
    if (action === 'delete') {
      engine.hint = `已删除这一局（回收站：扮演/<bookId>/.deleted/sessions/ 可找回）——现在在：${engine.session?.title || '主线'}`
      // 删除响应带局清单但没有画面——直接 peek 新激活局
      if (engine.session) await deduceEnginePresent({ peek: true })
    } else {
      engine.hint = action === 'new'
        ? `已新开一局：${engine.session?.title || ''}——推下一拍开始`
        : `已切到：${engine.session?.title || ''}`
      await deduceEnginePresent({ peek: true })
    }
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  engine.busy = false
  render()
}

/** 结算：选择某候选（或否决）。 */
async function deduceEngineSettle(candidateId, action) {
  const engine = state.deduce.engine
  if (!state.current || !engine.data) return
  engine.busy = true
  engine.error = ""
  render()
  try {
    const payload = await api("/api/deduce/settle", {
      method: "POST",
      body: JSON.stringify({
        root: state.current.path,
        sessionId: engine.sessionId || undefined,
        candidateId: candidateId || undefined,
        action: action || "choose"
      })
    })
    engine.hint = "已结算（第 " + payload.round + " 拍）——再呈现一拍继续"
    await deduceEnginePresent({})
  } catch (error) {
    engine.error = (error && error.code ? error.code + " · " : "") + text((error && error.message) || error)
  }
  engine.busy = false
  render()
}

/* ---------- 推演回合层（OS-61 P2）：选/自定义 → 成文草稿 → 缓存区 → 归档 ---------- */

/** 进页面续草稿：会话最后一拍与当前局面同拍号＝这拍结算过还没推下一拍，草稿接着写。 */
function deduceRestoreDraft() {
  const engine = state.deduce.engine
  if (engine.draft || !engine.data || !engine.session) return
  const branchId = engine.session.branchId || 'main'
  const nodes = (engine.session.nodes || []).filter((node) => (node.branchId || 'main') === branchId)
  const last = nodes[nodes.length - 1]
  if (last && Number(last.round) === Number(engine.data.round)) {
    engine.draft = { nodeId: last.id, round: last.round, prose: last.prose || '', proseError: '' }
  }
}

/** 结算这一拍并成文：choiceId 走候选结算，customText 走作者注入；regenerate 只重写正文。 */
async function deduceEngineTurn(opts) {
  const engine = state.deduce.engine
  if (!state.current || engine.turnBusy) return
  engine.turnBusy = true
  engine.error = ''
  engine.archiveNote = ''
  render()
  try {
    const payload = await api('/api/deduce/turn', {
      method: 'POST',
      body: JSON.stringify({
        root: state.current.path,
        sessionId: engine.sessionId || undefined,
        choiceId: opts.choiceId || undefined,
        customText: opts.customText || undefined,
        regenerate: opts.regenerate === true || undefined
      })
    })
    engine.session = payload.session
    engine.sessionLoaded = true
    engine.draftEdit = false
    engine.flowPin = true
    engine.draft = {
      nodeId: payload.node.id,
      round: payload.node.round,
      prose: payload.prose ?? payload.node.prose ?? '',
      proseError: payload.proseError || ''
    }
    if (!opts.regenerate) engine.customText = ''
    engine.hint = opts.regenerate ? '已重写这一拍的正文' : `第 ${payload.node.round} 拍已结算——正文草稿进缓存区，不落正文文件`
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  engine.turnBusy = false
  render()
}

/** 待确认事实卡结算（OS-82 回填闭环）：write＝写进故事源（单条 upsert），dismiss＝只出队。 */
async function deducePendingSettle(pendingId, action) {
  const engine = state.deduce.engine
  if (!state.current || !pendingId) return
  // 写入可能要过一次文件协议，禁用本卡按钮防连点
  const card = document.querySelector(`.ded-factcard[data-pending-id="${pendingId}"]`)
  if (card) for (const btn of card.querySelectorAll('button')) btn.disabled = true
  try {
    const payload = await api('/api/deduce/pending', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: engine.sessionId || undefined, pendingId, action })
    })
    engine.session = payload.session
    engine.hint = action === 'write'
      ? `事实已写入世界底账${payload.revision ? `（revision ${payload.revision}）` : ''}——下一拍推演就能引用它`
      : '已忽略这张事实卡（不落库）'
  } catch (error) {
    const message = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
    if (String(error?.code || '') === 'NOT_FOUND') {
      // 卡已被另一处写入/忽略：拉一次最新会话即可，不当错误
      engine.hint = message
      try {
        const fresh = await api(`/api/deduce/session?root=${encodeURIComponent(state.current.path)}`)
        engine.session = fresh.session ?? null
      } catch { /* 读不到就保持现状 */ }
    } else {
      engine.error = message
    }
  }
  render()
}

/** 草稿写回会话（PUT 整存）：textarea 失焦或离开草稿区前调。字数按新正文重算。 */
async function deduceSaveDraft() {
  const engine = state.deduce.engine
  const draft = engine.draft
  if (!state.current || !draft || !engine.session) return true
  const node = (engine.session.nodes || []).find((item) => item.id === draft.nodeId)
  if (!node || node.prose === draft.prose) return true
  node.prose = draft.prose
  const buffered = (engine.session.buffer?.nodes || []).find((item) => item.id === draft.nodeId)
  if (buffered) buffered.prose = draft.prose
  if (engine.session.buffer) {
    engine.session.buffer.words = (engine.session.buffer.nodes || []).reduce((sum, item) => {
      const prose = text(item.prose)
      if (prose.trim()) return sum + prose.length
      return sum + (item.candidates || []).reduce((acc, candidate) => acc + text(candidate?.text).length, 0)
    }, 0)
  }
  try {
    const payload = await api('/api/deduce/session', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, session: engine.session })
    })
    engine.session = payload.session
    return true
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
    render()
    return false
  }
}

/** 下一拍：先存草稿，再呈现新局面（草稿区收起）。存失败就停下，不丢作者改过的字。 */
async function deduceEngineNext() {
  const saved = await deduceSaveDraft()
  if (!saved) return
  const engine = state.deduce.engine
  engine.draft = null
  await deduceEnginePresent({})
}

/** 归档本章：缓存区整理成 md；结果用 ok-note 报路径与字数。 */
async function deduceArchiveChapter() {
  const engine = state.deduce.engine
  if (!state.current || engine.turnBusy) return
  const saved = await deduceSaveDraft()
  if (!saved) return
  engine.turnBusy = true
  engine.error = ''
  engine.archiveNote = ''
  render()
  try {
    const payload = await api('/api/deduce/archive', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: engine.sessionId || undefined })
    })
    engine.archiveNote = `已归档：${payload.path} · ${payload.words} 字`
    const sessionPayload = await api(`/api/deduce/session?root=${encodeURIComponent(state.current.path)}`)
    engine.session = sessionPayload.session ?? null
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  engine.turnBusy = false
  render()
}

/* ---------- 文游素材（OS-61 P4）：立绘/BGM 占位骨架＋打字机 ---------- */

/** 素材本体直挂 URL（<img>/<audio> 同源装载）：path 相对 扮演/<bookId>/素材/。 */
function dedAssetUrl(item) {
  const engine = state.deduce.engine
  const bookId = engine.assetBookId
  const prefix = `${registryModule.namingEntry('roleplay').dir}/${bookId}/素材/`
  const sub = text(item.path).startsWith(prefix) ? text(item.path).slice(prefix.length) : text(item.path)
  return `/api/deduce/asset?root=${encodeURIComponent(state.current.path)}&bookId=${encodeURIComponent(bookId)}&path=${encodeURIComponent(sub)}`
}

/** BGM 选曲：先按场景名，再按张力情绪（中文标签或 low/medium…），都没有就取第一首。 */
function pickDedBgm() {
  const engine = state.deduce.engine
  const list = engine.assets?.bgm || []
  if (!list.length) return null
  const card = engine.data?.sceneCard ?? {}
  const sceneName = card.where && card.where !== '未标记地点' ? text(card.where) : ''
  const level = text(engine.data?.tension?.level)
  const label = { low: '平静', medium: '升温', high: '紧迫', critical: '一触即发' }[level] || ''
  return list.find((item) => item.name === sceneName)
    || list.find((item) => item.name === label || item.name === level)
    || list[0]
}

let dedBgmAudio = null

function deduceBgmStop() {
  if (dedBgmAudio) {
    try { dedBgmAudio.pause() } catch { /* 已结束 */ }
    dedBgmAudio = null
  }
}

function deduceBgmToggle() {
  const engine = state.deduce.engine
  if (engine.bgmOn) {
    engine.bgmOn = false
    deduceBgmStop()
    render()
    return
  }
  const pick = pickDedBgm()
  if (!pick) return
  deduceBgmStop()
  dedBgmAudio = new Audio(dedAssetUrl(pick))
  dedBgmAudio.loop = true
  dedBgmAudio.play()
    .then(() => { engine.bgmOn = true; if (state.view === 'roleplay') render() })
    .catch(() => {
      engine.bgmOn = false
      deduceBgmStop()
      engine.error = 'BGM 播放失败——文件可能损坏，或浏览器拦了自动播放（再点一次试试）。'
      if (state.view === 'roleplay') render()
    })
}

/** 打字机：正文逐字出现；重渲不重打（按拍号＋文本键续进度），点对话框立即全显。 */
let dedTypewriter = { key: '', full: '', pos: 0, timer: null }

function dedTypewriterStop() {
  if (dedTypewriter.timer) {
    clearInterval(dedTypewriter.timer)
    dedTypewriter.timer = null
  }
}

function mountDedTypewriter() {
  const el = document.getElementById('deduce-dialog-text')
  if (!el) return
  const full = text(el.dataset.stageText)
  const engine = state.deduce.engine
  const key = `${engine.data?.round}|${engine.draft?.nodeId || ''}|${full.length}|${full.slice(0, 24)}`
  dedTypewriterStop()
  if (key !== dedTypewriter.key) {
    dedTypewriter.key = key
    dedTypewriter.pos = 0
  }
  dedTypewriter.full = full
  const paint = () => {
    el.textContent = full.slice(0, dedTypewriter.pos)
    const caret = document.getElementById('deduce-dialog-caret')
    if (caret) caret.hidden = dedTypewriter.pos >= full.length
  }
  paint()
  if (dedTypewriter.pos < full.length) {
    dedTypewriter.timer = setInterval(() => {
      dedTypewriter.pos = Math.min(full.length, dedTypewriter.pos + 2)
      paint()
      // OS-81：贴底时正文逐字撑高要把视口跟着往下按，不然读者会被「留在原地」
      if (engine.flowPin !== false) {
        const sc = document.getElementById('deduce-flow')
        if (sc) sc.scrollTop = sc.scrollHeight
      }
      if (dedTypewriter.pos >= full.length) dedTypewriterStop()
    }, 30)
  }
}

/**
 * OS-81：叙事流挂载——打字机只作用于最新一拍；贴底跟随（用户上滚就放手，
 * 出「↓ 最新一拍」浮标）；重渲后按记忆的偏移恢复阅读位置。
 */
function mountDedFlow() {
  const engine = state.deduce.engine
  const sc = document.getElementById('deduce-flow')
  // 打字机：只挂展示态的最新拍（编辑态是 textarea，不打字）
  const typing = document.getElementById('deduce-dialog-text')
  if (typing && !(engine.draft && engine.draftEdit)) {
    mountDedTypewriter()
    // 刚收起编辑器＝作者刚改过自己的稿，直接全显不重打
    if (engine.draftShownFull) { dedTypewriterSkip(); engine.draftShownFull = false }
  } else {
    dedTypewriterStop()
  }
  if (!sc) return
  const pill = document.getElementById('deduce-flow-jump')
  // 程序化贴底会把期望 scrollTop 记下来：滚动事件落在这个值附近＝自己/排版锚定，
  // 不当成「用户上滚」（否则重渲与打字机撑高都会把贴底误判成离底）
  const stick = () => {
    engine.flowStickAt = Math.max(0, sc.scrollHeight - sc.clientHeight)
    sc.scrollTop = sc.scrollHeight
  }
  const syncPin = () => {
    if (Math.abs(sc.scrollTop - Number(engine.flowStickAt || -1)) < 2) return
    const gap = sc.scrollHeight - sc.scrollTop - sc.clientHeight
    engine.flowPin = gap < 90
    engine.flowOffset = sc.scrollTop
    if (pill) pill.hidden = engine.flowPin !== false
  }
  sc.addEventListener('scroll', syncPin, { passive: true })
  if (engine.flowPin !== false) {
    stick()
    if (pill) pill.hidden = true
  } else {
    // 重渲不拽走读者：恢复上次的阅读位置
    sc.scrollTop = Math.min(Number(engine.flowOffset) || 0, Math.max(0, sc.scrollHeight - sc.clientHeight))
    if (pill) pill.hidden = false
  }
}

function dedTypewriterSkip() {
  dedTypewriterStop()
  dedTypewriter.pos = dedTypewriter.full.length
  const el = document.getElementById('deduce-dialog-text')
  if (el) el.textContent = dedTypewriter.full
  const caret = document.getElementById('deduce-dialog-caret')
  if (caret) caret.hidden = true
}

/* ---------- 推演剧情树（OS-61 P3）：二维分支导图＋回跳/开分支 ---------- */

let deduceTreeCleanup = null

/** 选中节点的右上提示面板：回到这一拍 / 从这拍开新分支。 */
function deduceTreePickHtml() {
  return deduceViews.deduceTreePickHtml({ engine: state.deduce.engine, esc })
}

/** 树视图：整宽画布＋右上选中提示（选中节点后出现）。 */
function deduceTreeHtml() {
  return deduceViews.deduceTreeHtml({ engine: state.deduce.engine, esc, flowError, pickHtml: deduceTreePickHtml() })
}

/** 挂导图：只更新选中面板、不整页重渲——保住作者拖好的视野。 */
async function mountDeduceTree() {
  const host = document.getElementById('deduce-tree-host')
  if (!host) return
  const mod = await import('./storyTree.mjs')
  if (!document.getElementById('deduce-tree-host')) return // 等待期间页面切走了
  deduceTreeCleanup?.()
  deduceTreeCleanup = mod.mountStoryTree({
    host,
    session: state.deduce.engine.session,
    onPick: (node) => {
      state.deduce.engine.treePick = node.id
      const slot = document.getElementById('deduce-tree-pick')
      if (slot) {
        slot.hidden = false
        slot.innerHTML = deduceTreePickHtml()
      }
    }
  })
}

/** 回到这一拍：切分支＋cursor 定位（switchBranch 语义），PUT 整存后回「当前局面」。 */
async function deduceTreeJump() {
  const engine = state.deduce.engine
  const node = (engine.session?.nodes || []).find((item) => item.id === engine.treePick)
  if (!state.current || !node || !engine.session || engine.turnBusy) return
  const saved = await deduceSaveDraft()
  if (!saved) return
  engine.turnBusy = true
  engine.error = ''
  render()
  try {
    const session = { ...engine.session, branchId: node.branchId || 'main', cursor: Number(node.round) || 0 }
    const payload = await api('/api/deduce/session', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, session })
    })
    engine.session = payload.session
    engine.view = 'scene'
    engine.treePick = null
    engine.draft = null
    deduceRestoreDraft()
    engine.hint = `已回到第 ${Number(node.round) || 0} 拍（${session.branchId === 'main' ? '主线' : session.branchId}）——下一拍从这里续`
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  engine.turnBusy = false
  render()
}

/** 从选中拍开新分支：daemon 给新 branchId＋cursor 定位，成功后回「当前局面」。 */
async function deduceTreeBranch() {
  const engine = state.deduce.engine
  const node = (engine.session?.nodes || []).find((item) => item.id === engine.treePick)
  if (!state.current || !node || engine.turnBusy) return
  const saved = await deduceSaveDraft()
  if (!saved) return
  engine.turnBusy = true
  engine.error = ''
  render()
  try {
    const payload = await api('/api/deduce/branch', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: engine.sessionId || undefined, fromNodeId: node.id })
    })
    engine.session = payload.session
    engine.sessionLoaded = true
    engine.view = 'scene'
    engine.treePick = null
    engine.draft = null
    engine.hint = `已从第 ${Number(node.round) || 0} 拍开出新分支 ${payload.session.branchId}——下一拍走新路`
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  engine.turnBusy = false
  render()
}

function composeDeduceContent() {
  const deduce = state.deduce
  const variables = deduce.variables.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => `- ${line}`).join('\n')
  const branches = Math.min(5, Math.max(1, Number(suiteValue('deduceBranches', 'writing', 2)) || 2))
  return [
    '【推演请求】',
    `前提（设定为真）：\n${deduce.premise.trim()}`,
    `变量（可能拨动的开关）：\n${variables || '（无）'}`,
    `要推演的问题：${deduce.question.trim()}`,
    `请给出至少 ${branches} 条可能世界的分支（分支 A／分支 B…），每条写清因果链与最值得写成正文的一段；最后指出哪条分支张力最强、为什么。`
  ].join('\n\n')
}

async function startDeduce() {
  const deduce = state.deduce
  if (!state.current || deduce.streaming) return
  deduce.premise = document.getElementById('deduce-premise')?.value ?? deduce.premise
  deduce.variables = document.getElementById('deduce-variables')?.value ?? deduce.variables
  deduce.question = document.getElementById('deduce-question')?.value ?? deduce.question
  if (!deduce.premise.trim() || !deduce.question.trim()) {
    deduce.error = '前提和问题都要填。'
    render()
    return
  }
  if (!agent.configured) {
    openSettingsModal('先配好模型端点再开始扮演。')
    return
  }
  deduce.error = ''
  deduce.reply = ''
  deduce.streaming = true
  const controller = new AbortController()
  deduce.controller = controller
  render()
  const result = await streamChat({
    content: composeDeduceContent(),
    sessionId: deduce.sessionId || undefined,
    controller,
    onStart: (sessionId) => { deduce.sessionId = sessionId },
    onDelta: (piece) => {
      deduce.reply += piece
      const replyEl = document.querySelector('.deduce-reply')
      if (replyEl) {
        replyEl.textContent = deduce.reply
        replyEl.scrollTop = replyEl.scrollHeight
      }
    },
    onError: (error) => {
      deduce.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    }
  })
  deduce.streaming = false
  deduce.controller = null
  if (result.aborted && deduce.reply.trim()) deduce.reply += '\n（已停止——以上是推演到一半的部分）'
  render()
}


function deduceHtml() {
  if (!state.current) return needLibraryHtml()
  // OS-84：统一壳——引擎/Agent、叙事流/剧情树共用同一条工具栏与同一容器，
  // 切换只换内容区不换骨架（旧实现 Agent/剧情树另起 doc-head，切换＝整页换头，割裂）。
  return deduceEngineHtml()
}

/**
 * 事实包健康度（OS-60）：推演质量的根在故事源条目。
 * 只有命运骰候选＝事实包太薄（没有足够角色/地点/伏笔支撑必然与戏剧候选），
 * 这里如实告诉作者缺什么、补了会怎样——而不是让他对着两张检定单发呆。
 */
function dedPackHtml() {
  return deduceViews.dedPackHtml({ data: state.deduce.engine.data, esc })
}

/**
 * OS-81：推演页重构＝沉浸叙事流（酒馆模型）＋流末待决回合（RPG 模型）。
 * 旧 galgame 舞台退役：正文不再挤在底部单框，历史拍全部留在流里可回读；
 * 场景立绘降为流的暗化背景（可切「纸面」）；局面/设置退为浮层；
 * 候选作为「待决」挂在流末，输入条常驻底部——页面只有流自己滚。
 */

/** 序章消息：◆ 你是谁 / 眼前场景 默认展开，前情提要默认收起（点开）。缺数据如实说缺。 */
function deducePrologueHtml(narrative) {
  return deduceViews.deducePrologueHtml({ narrative, recapOpen: state.deduce.engine.introOpen?.recap === true, esc })
}

/** 你的回合：这一拍选了哪条候选 / 自己写了什么（choiceId 在会话节点里，回放同源）。 */
/** 命运回合行的人话文案（OS-88）。服务端同款在 deduceEngine.humanizeFateText（按 trace 重写）；
 *  这里兜历史拍——会话节点只存了 text 没存 trace，旧黑话「剧情检定 2d6=…」从文本拆骰点翻人话。 */
function fateHumanFromLegacy(chosen) {
  return deduceViews.fateHumanFromLegacy(chosen, { text })
}

function deduceTurnLineHtml(node) {
  return deduceViews.deduceTurnLineHtml(node, { esc, text })
}

/** 待确认事实卡（OS-82 回填闭环）：这一拍结算产出的 fact 条目——写进故事源前的最后一道闸。
 *  「写入故事源」走 writeFactFile 单条 upsert（只进这一条，不动其他条目）；「忽略」只出队不落库。 */
function deducePendingFactHtml(item) {
  return deduceViews.deducePendingFactHtml(item, { esc, text })
}

/** 本拍正文：历史拍是静态纸卡；最新一拍（草稿）带打字机／编辑态与动作行。 */
function deduceProseMsgHtml(node, live) {
  return deduceViews.deduceProseMsgHtml(node, live, { engine: state.deduce.engine, esc, text })
}

/** 在场小头像（立绘有图用图，没有用首字色块）——缩进待决的场景行，不再立右栏。 */
function deduceWhoChipsHtml(who) {
  return deduceViews.deduceWhoChipsHtml(who, { assets: state.deduce.engine.assets, dedAssetUrl, esc })
}

/**
 * 待决回合：流末的候选（必然/命运/戏剧）＋否决。每拍重新生成，选完折叠成「你的回合」。
 * 候选「人物化」沿用 OS-79：标题＝你打算做什么，副标＝后果预期，骰点收进 roll 小字。
 */
function deducePendingHtml(data) {
  return deduceViews.deducePendingHtml(data, { engine: state.deduce.engine, esc, text, whoChipsHtml: (list) => deduceWhoChipsHtml(list) })
}

/** 已知信息牌（OS-91）：剧本杀式的左栏——你扮演谁／谁在你面前／这里是什么地方／
 *  你经历过了什么／世界的暗流。全部来自 present 的叙事上下文，第二人称，不摆 fact 术语。 */
function deduceSideHtml(data) {
  return deduceViews.deduceSideHtml(data, { esc })
}

/** 推演主面（OS-84 统一壳）：工具栏常驻，内容区三形态（叙事流/剧情树/Agent）就地切换。 */
function deduceEngineHtml() {
  const engine = state.deduce.engine
  // OS-100：模式判定必须在函数开头——bar 与流渲染都要用（曾因后置定义导致 TDZ 崩页）
  const rpMode = (engine.playMode || 'roleplay') !== 'engine'
  const data = engine.data
  const inFlow = state.deduce.mode === 'engine' && engine.view !== 'tree'
  const session = engine.session
  const buffer = session?.buffer
  const bufferCount = buffer?.nodes?.length || 0
  const card = data?.sceneCard ?? {}
  const tension = data?.tension ?? {}
  const who = Array.isArray(card.who) ? card.who.filter(Boolean) : []

  /* —— 背景：当前场景立绘铺满（暗化），纸面模式整体关掉 —— */
  const assets = engine.assets || { characters: [], scenes: [], bgm: [] }
  const sceneName = card.where && card.where !== '未标记地点' ? text(card.where) : ''
  const sceneAsset = sceneName ? assets.scenes.find((item) => item.name === sceneName) : null

  /* —— 工具栏（OS-86 重排）：左＝进度＋张力；右＝形态三分切换（永远一个亮、永不消失）
       ＋内容开关（局面/设置/BGM）＋动作（生图/归档）＋显示偏好（纸面），组间细竖线 —— */
  const heatLevel = text(tension.level)
  const heatLabel = { low: '平静', medium: '升温', high: '紧迫', critical: '一触即发' }[heatLevel] || ''
  const heatClass = { low: 'h-low', medium: 'h-mid', high: 'h-high', critical: 'h-crit' }[heatLevel] || 'h-low'
  const pov = session?.pov || data?.pov || engine.pov || ''
  const bgmAsset = pickDedBgm()
  // OS-91：左栏＝已知信息牌，默认常驻（沉浸扮演要随时看得见自己是谁）；按钮只管开合
  const infoVisible = data ? engine.infoOpen !== false : false
  // 形态三态：叙事流＝引擎+局面视图；剧情树＝引擎+树视图；Agent＝表单。互斥、恒显。
  const form = inFlow ? 'flow' : (state.deduce.mode === 'engine' ? 'tree' : 'agent')
  const segTab = (key, label, action, title) => `<button class="fl-seg-tab${form === key ? ' on' : ''}" data-action="${action}" title="${title}">${label}</button>`
  const bar = `<header class="fl-bar">
    ${inFlow ? `<span class="fl-bar-progress">${rpMode && engine.session ? `第 ${Number(engine.session.cursor) || 0} 拍` : (data ? `第 ${Number(data.round) || 0} 拍` : '未开局')}${pov ? `<span class="ded-bar-sep">·</span>${esc(pov)}视角` : ''}<span class="ded-bar-sep">·</span>本章 ${bufferCount} 拍 ${buffer?.words || 0} 字</span>
    ${heatLabel ? `<span class="ded-heat ${heatClass}" title="前线时钟读数：张力从平静到一触即发">${esc(heatLabel)}</span>` : ''}` : ''}
    <span class="fl-bar-right">
      <span class="fl-seg">
        ${segTab('flow', '叙事流', 'deduce-view-scene', '沉浸叙事流：一幕一条消息（扮演＝主持人＋登场角色；推演＝确定性引擎）')}
        ${segTab('tree', '剧情树', 'deduce-view-tree', '二维分支导图：回跳或开新分支（确定性引擎）')}
        ${segTab('agent', 'Agent', 'deduce-mode-agent', 'Agent 分支推理（需要模型，表单形态）')}
      </span>
      ${inFlow && data ? `<i class="fl-bar-div"></i>
        <button class="fl-btn${infoVisible ? ' on' : ''}" data-action="deduce-info-toggle" title="显示/隐藏左侧的已知信息：你扮演谁／谁在你面前／这里是什么地方／你经历过的">状态</button>
        <button class="fl-btn${engine.setOpen ? ' on' : ''}" data-action="deduce-tools-toggle" title="推演设置：POV / 种子 / 推进 / 重新开局">⚙ 设置</button>
        <button class="fl-btn${engine.bgmOn ? ' on' : ''}" data-action="deduce-bgm-toggle"${bgmAsset ? '' : ' disabled'}
          title="${bgmAsset ? `播放：${esc(bgmAsset.name)}（循环）` : '未配置 BGM——放 扮演/…/素材/bgm/<场景或情绪>.mp3 即可启用'}">♪ BGM</button>
        <i class="fl-bar-div"></i>
        <button class="fl-btn" data-action="deduce-image"${slotAction('settings', 'imagegen', '按本拍局面生成一张场景立绘（需在设置里配生图端点）')}${engine.turnBusy ? ' disabled' : ''}>生图</button>
        <button class="fl-btn" data-action="deduce-archive"${engine.turnBusy || !bufferCount ? ' disabled' : ''} title="把本章缓冲的拍整理成 markdown 归档（不写正文文件）">归档</button>
        <button class="fl-btn" data-action="deduce-export"${engine.turnBusy ? ' disabled' : ''} title="整个会话导出成 markdown（每拍的决定＋正文），落 扮演/&lt;bookId&gt;/导出/">导出</button>
      ` : ''}
      <i class="fl-bar-div"></i>
      <button class="fl-btn${engine.paperMode ? ' on' : ''}" data-action="deduce-paper-toggle" title="纸面模式：关掉立绘背景，纯纸面读文">纸面</button>
    </span>
  </header>`

  /* —— 已知信息牌（deduceSideHtml）接管局面卡／前线；事实包术语退场（世界书管条目） —— */
  const controls = `<div class="ded-tools">
      <input class="file-input" id="deduce-pov" list="deduce-pov-list" placeholder="以谁的眼睛看（可选）" value="${esc(engine.pov)}">
      <datalist id="deduce-pov-list">${(state.deduce.characters || []).map((name) => `<option value="${esc(name)}"></option>`).join('')}</datalist>
      <input class="file-input" id="deduce-seed" placeholder="种子（留空＝随机）" value="${esc(engine.seed)}" title="同一种子＋同一份事实＝同一拍，可复现">
      <button class="btn-primary" data-action="deduce-engine-present"${engine.busy || engine.turnBusy ? ' disabled' : ''}>${engine.busy ? '推演中…' : data ? '推下一拍' : '开始推演'}</button>
      ${data ? '<button class="btn-ghost" data-action="deduce-engine-reset" title="清空本局从第一拍重来">本局重开</button>' : ''}
    </div>`
  /* —— 多局切换（OS-86）：主线永远在列；当前局高亮；每行可删（非破坏，回收站可找回） —— */
  const currentSid = engine.sessionId || 'main'
  const sessRows = (engine.sessions?.sessions ?? []).map((item) => {
    const isCur = item.id === currentSid
    return `<div class="ded-sess-row${isCur ? ' on' : ''}">
      <button class="ded-sess-pick" data-action="deduce-sess-switch" data-id="${esc(item.id)}"${isCur ? ' disabled' : ''} title="${isCur ? '当前局' : '切到这一局'}">
        <span class="ded-sess-name">${esc(item.title || (item.id === 'main' ? '主线' : item.id))}</span>
        <span class="ded-sess-meta">${item.rounds} 拍${item.pending ? ` · ${item.pending} 张待确认` : ''}</span>
      </button>
      <button class="ded-sess-del" data-action="deduce-sess-del" data-id="${esc(item.id)}" title="删除这一局（非破坏——文件进 扮演/.deleted/sessions/ 可找回）">删</button>
    </div>`
  }).join('')
  const sessHtml = `<div class="ded-sess">
      <div class="ded-sess-head">扮演局<span class="sub">不同前提各开一局，互不串线</span></div>
      <div class="ded-sess-list">${sessRows || '<p class="ded-none">局清单还没读到——再开一次设置页试试</p>'}</div>
      <button class="btn-ghost ded-sess-new" data-action="deduce-sess-new"${engine.busy || engine.turnBusy ? ' disabled' : ''} title="新开一局（自动命名，切过去就是空白第一拍）">＋新开一局</button>
    </div>`
  const sideHtml = deduceSideHtml(data)
  const setPanel = `<div class="ded-set-panel"${engine.setOpen ? '' : ' hidden'}>
      ${sessHtml}
      <div class="ded-set-head">推演设置<span class="sub">POV / 种子 / 推进</span></div>
      ${controls}
      ${moduleLogHtml(registryModule?.logModuleForView('roleplay') ?? '', { title: '扮演修改记录', limit: 6 })}
    </div>`

  /* —— OS-84：非叙事流形态（Agent 表单／剧情树）——同一壳同一工具栏，只换内容区 —— */
  if (!inFlow) {
    const inner = state.deduce.mode === 'agent' ? deduceAgentHtml() : deduceTreeHtml()
    return `<div class="ded-flow" data-paper="${engine.paperMode ? 1 : 0}">
      <div class="ded-flow-bg"${sceneAsset ? ` style="background-image:url('${dedAssetUrl(sceneAsset)}')"` : ''}>${sceneAsset ? '' : '<div class="ded-scene-grain"></div>'}</div>
      <div class="ded-flow-tint"></div>
      ${bar}
      <div class="fl-scroll-wrap"><div class="fl-scroll fl-scroll-page">${inner}</div></div>
    </div>`
  }

  /* —— 空态＝开局向导（OS-93 照酒馆：选角色卡 → 选世界书 → 选开头）—— */
  if (!data && !engine.roleplayStarted) {
    const ow = engine.opening
    const owCard = (sel, body) => `<div class="ow-card${sel ? ' on' : ''}">${body}</div>`
    const povCards = [{ name: '主持人', identity: '你是这一幕的导演与裁判——裁决谁登场、织世界反馈；其他角色由各自的子 agent 演绎' }, ...(ow.characters ?? [])].map((c, i) => owCard(ow.selPov === c.name, `
        <button class="ow-pick" data-action="ow-pov" data-name="${esc(c.name)}">
          <b>${esc(c.name)}</b>${c.archetype ? `<i>${esc(c.archetype)}</i>` : ''}
          ${c.identity ? `<span>${esc(c.identity.slice(0, 56))}${c.identity.length > 56 ? '…' : ''}</span>` : ''}
        </button>`)).join('')
    const bookRows = (ow.books ?? []).map((b) => `<button class="ow-pick ow-book${ow.selBook === b.bookId ? ' on' : ''}" data-action="ow-book" data-id="${esc(b.bookId)}">
          <b>${esc(b.title)}</b><span class="ow-book-meta">世界观 ${b.worldview} · 角色 ${b.characters} · 剧情 ${b.plot}</span>
        </button>`).join('')
    const openRows = (ow.openings ?? []).map((o) => `<button class="ow-pick ow-open${ow.selOpen === o.id ? ' on' : ''}" data-action="ow-open" data-id="${esc(o.id)}">
          <b>${esc(o.label)}</b>${o.detail ? `<span>${esc(o.detail.slice(0, 70))}${o.detail.length > 70 ? '…' : ''}</span>` : ''}
        </button>`).join('')
    const step = (no, title, sub, body) => `<section class="ow-step"><h3><span class="no">${no}</span>${title}<span class="sub">${sub}</span></h3>${body}</section>`
    return `<div class="ded-flow" data-paper="${engine.paperMode ? 1 : 0}">
      <div class="ded-flow-tint"></div>
      ${bar}
      <div class="fl-scroll-wrap">
        <div class="fl-scroll" id="deduce-flow">
          ${flowError(engine.error || '')}
          <div class="fl-hero">
            <div class="ow-wizard">
              <h2>开局 · 扮演</h2>
              <p class="ow-sub">选好这三样就开始——像酒馆一样往下读。</p>
              <div class="ow-mode">
                <button class="ow-pick ow-mode-btn${engine.playMode !== 'engine' ? ' on' : ''}" data-action="ow-mode-roleplay" title="主持人＋N 个登场角色各自由子 agent 演绎，世界反馈对你说"><b>扮演</b><span>主持人＋登场角色，多 agent 同幕</span></button>
                <button class="ow-pick ow-mode-btn${engine.playMode === 'engine' ? ' on' : ''}" data-action="ow-mode-engine" title="确定性推演引擎（种子化，不需要模型）"><b>推演</b><span>确定性引擎：同一事实同一拍</span></button>
              </div>
              ${ow.loaded ? 
                step(1, '选角色卡', '你扮演谁', `<div class="ow-card">${povCards || '<p class="ds-empty">这个库还没有角色条目——去世界书写一条再回来</p>'}</div>`) +
                ((ow.books ?? []).length > 1 ? step(2, '选世界书', '哪一份事实包', `<div class="ow-card">${bookRows}</div>`) : '') +
                step(3, '选开头', '从哪里开始', `<div class="ow-card">${openRows}</div>`)
                : '<p class="ow-loading">正在盘点角色卡与开局…</p>'}
            </div>
          </div>
          ${engine.hint ? `<div class="warn-box">${esc(engine.hint)}</div>` : ''}
        </div>
      </div>
      <div class="fl-composer">
        <div class="fl-composer-row">
          <button class="btn-primary fl-send" data-action="ow-start"${ow.loaded && ow.selPov ? '' : ' disabled'} title="按选好的角色卡＋世界书＋开头开局">${engine.playMode === 'engine' ? '就这样开始推演' : '就这样开始扮演'}</button>
        </div>
      </div>
      ${setPanel}
    </div>`
  }

  /* —— 叙事流：序章 → 历史拍（你的回合＋正文）→ 待决 —— */
  const draft = engine.draft
  const branchId = session?.branchId || 'main'
  const nodes = (session?.nodes || []).filter((node) => (text(node?.branchId) || 'main') === branchId)
  const msgs = []
  if (data?.narrative) msgs.push(deducePrologueHtml(data.narrative))
  // OS-99：扮演局开场——玩家先说话，给一张「序幕」引导卡（不摆引擎局面）
  if (!data && rpMode && engine.roleplayStarted && !engine.lastBeats?.length) {
    const povName = engine.pov || ''
    const openDetail = engine.seedPrompt || ''
    msgs.push(`<section class="fl-msg fl-msg-prologue"><div class="fl-prose"><div class="fl-prologue-head"><span class="fl-prologue-mark">◆</span>序幕</div>${povName ? `<p class="fl-line">你扮演 <b>${esc(povName)}</b>${povName === '主持人' ? '——这一幕的导演与裁判' : ''}。</p>` : ''}${openDetail ? `<p class="fl-line fl-story">${esc(openDetail)}</p>` : ''}${povName === '主持人' ? '<p class="fl-line">说一句开场：这一幕在哪儿、什么时候、谁在场——我来替你召集演员。</p>' : `<p class="fl-line">说你这一幕睁开眼在做什么、说什么——点名谁，谁就登场。</p>`}</div></section>`)
  }
  // OS-82 回填闭环：结算产出的条目卡按 nodeId 挂在对应拍后面；对不上拍的兜底挂流尾，不吞卡
  const pendingAll = Array.isArray(session?.pending) ? session.pending : []
  const pendingLeft = new Set(pendingAll.map((item) => text(item?.id)))
  for (const node of nodes) {
    const live = !!draft && draft.nodeId === node.id
    const turnLine = deduceTurnLineHtml(node)
    if (turnLine) msgs.push(turnLine)
    msgs.push(deduceProseMsgHtml(node, live))
    for (const item of pendingAll) {
      if (text(item?.nodeId) === text(node.id)) {
        msgs.push(deducePendingFactHtml(item))
        pendingLeft.delete(text(item?.id))
      }
    }
  }
  for (const item of pendingAll) {
    if (pendingLeft.has(text(item?.id))) msgs.push(deducePendingFactHtml(item))
  }
  // OS-100：开场白（主持人拉开的第一幕）——nodeId 为空不匹配任何节点，单独成一条气泡
  if (draft && draft.isOpening && text(draft.prose).trim()) {
    msgs.push(`<section class="fl-msg"><span class="fl-rn">开场</span><div class="fl-prose"><p class="fl-text">${esc(draft.prose)}</p></div></section>`)
  }
  // OS-98/99：扮演模式的登场角色署名气泡＋情境分支选项——挂在流末（最新一拍之后）。
  // 注意：draft 存在时它**就是**最新那一拍，选项照样要给玩家。
  if (rpMode && ((engine.lastBeats ?? []).length || (engine.roleplayOptions ?? []).length)) {
    for (const beat of (engine.lastBeats ?? [])) {
      msgs.push(`<div class="fl-beat"><span class="fl-beat-name">${esc(beat.name)}</span><span class="fl-beat-text">${esc(beat.text)}</span></div>`)
    }
    if ((engine.roleplayOptions ?? []).length) {
      msgs.push(`<div class="fl-options"><p class="fl-prompt">轮到你了——选一条，或在下面说你的动作</p>${engine.roleplayOptions.map((opt, i) => `<button class="fl-opt" data-action="roleplay-option" data-idx="${i}"><span class="fl-opt-arrow">▸</span>${esc(opt)}</button>`).join('')}</div>`)
    }
  }
  // OS-101：推演模式也要「写完就给下一步」——draft 存在（刚成文那一拍）照样给候选；
  // 只有「正在成文中」才暂缓（避免和打字机打架）。
  if (!rpMode && data && !engine.turnBusy) msgs.push(deducePendingHtml(data))
  if (engine.hint) msgs.push(`<div class="fl-hint">${esc(engine.hint)}</div>`)

  const composer = `<div class="fl-composer">
    ${engine.error ? flowError(engine.error) : ''}
    ${engine.archiveNote ? `<div class="fl-note-row"><span class="ok-note">${esc(engine.archiveNote)}</span></div>` : ''}
    <div class="fl-composer-row">
      <textarea class="fl-input" id="deduce-custom" rows="1" placeholder="说你这一幕做什么/说什么——点名谁，谁就登场（Enter 发送 · Shift+Enter 换行）">${esc(engine.customText)}</textarea>
      <button class="btn-primary fl-send" data-action="deduce-engine-custom"${engine.busy || engine.turnBusy ? ' disabled' : ''}>就这么做</button>
    </div>
  </div>`

  // OS-91：沉浸舞台＝左（已知信息牌）＋右（气泡流）。左栏不是聊天，是「我知道什么」。
  return `<div class="ded-flow" data-paper="${engine.paperMode ? 1 : 0}">
    <div class="ded-flow-bg"${sceneAsset ? ` style="background-image:url('${dedAssetUrl(sceneAsset)}')"` : ''}>${sceneAsset ? '' : '<div class="ded-scene-grain"></div>'}</div>
    <div class="ded-flow-tint"></div>
    ${bar}
    <div class="ded-body">
      <aside class="ded-side"${infoVisible ? '' : ' hidden'}>${sideHtml}</aside>
      <div class="ded-main-col">
        <div class="fl-scroll-wrap">
          <div class="fl-scroll" id="deduce-flow">
            <div class="fl-inner">
              ${msgs.join('')}
            </div>
          </div>
          <button class="fl-jump" id="deduce-flow-jump" data-action="deduce-flow-jump" hidden>↓ 最新一拍</button>
        </div>
        ${composer}
      </div>
    </div>
    ${setPanel}
  </div>`
}

/** 导出整个推演会话（OS-94）：每拍的决定＋正文出 markdown，落 扮演/<bookId>/导出/。 */
async function deduceExportSession() {
  const engine = state.deduce.engine
  if (!state.current) return
  try {
    const payload = await api('/api/deduce/export', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: engine.sessionId || undefined })
    })
    engine.archiveNote = `已导出：${payload.path}（${payload.words} 字）`
  } catch (error) {
    engine.error = (error && error.code ? error.code + ' · ' : '') + text((error && error.message) || error)
  }
  render()
}

/** 转正弹窗（OS-94）：这一拍正文 → 正文/ 成正式章节（自动下一章号＋备份通道）。 */
function deducePromoteFlow() {
  const engine = state.deduce.engine
  const draft = engine.draft
  if (!state.current || !draft) { engineSetError('先选一条走向出正文，最新一拍才能转正。'); return }
  if (!draft.nodeId) { engineSetError('开场白还没落成拍——先说一句你的动作，第一拍落地后才能转正。'); return }
  if (!text(draft.prose).trim()) { engineSetError('这一拍还没有正文——先「重写」出稿或自己写完，再转正。'); return }
  openModal(`<h3>转正为正式章节</h3>
    <p class="sub">把这一拍的正文写进 正文/（自动下一章号，走备份通道——原文永远可找回）。</p>
    <div class="field"><label>章节标题</label>
      <input id="promote-title" placeholder="例如：第八夜·那只眼睁开" value="推演第${Number(draft.round) || 0}拍">
    </div>
    <div class="ded-image-ops">
      <button class="btn-ghost" data-action="close-modal">取消</button>
      <button class="btn-primary" id="deduce-promote-go">转正</button>
    </div>`)
  document.getElementById('promote-title')?.focus()
}

async function deducePromoteRun() {
  const engine = state.deduce.engine
  const draft = engine.draft
  const title = text(document.getElementById('promote-title')?.value).trim()
  if (!state.current || !draft) return
  if (!title) { engineSetError('章节标题要有实际内容。'); return }
  const go = document.getElementById('deduce-promote-go')
  if (go) { go.disabled = true; go.textContent = '转正中…' }
  try {
    const payload = await api('/api/deduce/promote', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: engine.sessionId || undefined, nodeId: draft.nodeId, title })
    })
    closeModal()
    engine.archiveNote = `已转正：${payload.file}（${payload.chars} 字）——去「正文」页即可编辑`
  } catch (error) {
    const box = document.querySelector('.ded-image-ops')
    if (box) {
      const err = document.createElement('div')
      err.className = 'warn-box'
      err.textContent = `${error.code ? error.code + ' · ' : ''}${text(error?.message || error)}`
      box.before(err)
      if (go) { go.disabled = false; go.textContent = '转正' }
    } else {
      engineSetError(text(error?.message || error))
    }
    return
  }
  render()
}

/**
 * 生图流程（OS-66 适配）：正规弹窗替代原生 prompt()——场景名＋画面描述＋尺寸，
 * 生成中按钮禁用，完成/失败都在弹窗内反馈，成功后关弹窗回舞台。
 */
function deduceImageFlow() {
  openModal(`<h3>生成场景立绘</h3>
    <p class="sub">调生图端点按画面描述生成一张场景图，落 扮演/&lt;bookId&gt;/素材/场景/ 后自动挂为舞台背景。</p>
    <div class="field"><label>场景名（立绘绑定用，如：龙虎山）</label>
      <input id="deduce-image-name" placeholder="例如：龙虎山">
    </div>
    <div class="field"><label>画面描述（给生图模型的提示词）</label>
      <textarea id="deduce-image-prompt" rows="3" placeholder="例如：云雾缭绕的山道石阶，晨雾，青苔石栏，古松"></textarea>
    </div>
    <div class="field"><label>尺寸</label>
      <select id="deduce-image-size">
        <option value="1024x1024">方图 1024×1024</option>
        <option value="1344x768" selected>横图 1344×768</option>
        <option value="768x1344">竖图 768×1344</option>
      </select>
    </div>
    <div class="ded-image-ops">
      <button class="btn-ghost" data-action="close-modal">取消</button>
      <button class="btn-primary" id="deduce-image-go">生成</button>
    </div>`)
  document.getElementById('deduce-image-name')?.focus()
}

async function deduceImageRun() {
  const name = text(document.getElementById('deduce-image-name')?.value).trim()
  const prompt = text(document.getElementById('deduce-image-prompt')?.value).trim()
  const size = text(document.getElementById('deduce-image-size')?.value).trim() || '1344x768'
  if (!name || !prompt) {
    engineSetError('场景名与画面描述都要填。')
    return
  }
  const go = document.getElementById('deduce-image-go')
  if (go) { go.disabled = true; go.textContent = '生成中…（可能要一两分钟）' }
  try {
    const payload = await api('/api/deduce/image', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, name, prompt, size })
    })
    closeModal()
    const engine = state.deduce.engine
    engine.archiveNote = `立绘已生成：${payload.path}（回到当前局面即可见）`
    // OS-81：立绘落库后重拉素材盘点，流的暗化背景立刻换上新图
    engine.assetsLoaded = false
    engine.assets = null
    render()
  } catch (error) {
    const box = document.querySelector('.ded-image-ops')
    if (box) {
      const err = document.createElement('div')
      err.className = 'warn-box'
      err.textContent = `${error.code ? error.code + ' · ' : ''}${text(error?.message || error)}`
      box.before(err)
    } else {
      engineSetError(text(error?.message || error))
    }
  }
}

function engineSetError(message) {
  state.deduce.engine.error = text(message)
  render()
}

/** Agent 模式（原三栏表单，保留）。 */
function deduceAgentHtml() {
  return deduceViews.deduceAgentHtml({ deduce: state.deduce, configured: agent.configured, esc, flowError })
}

/* ---------- 数据加载 ---------- */

async function boot() {
  await Promise.all([registryReady, runtimeShelfReady, suiteShelfViewsReady, workbenchViewsReady, scriptViewsReady, referenceViewsReady, knowledgeBaseViewsReady, knowledgeBaseControllerReady, deduceViewsReady, settingsAggregationReady, uiKitReady, settingsViewsReady, analysisViewsReady, agentViewsReady, libraryFlowViewsReady, syncViewsReady, referencePageViewsReady, governanceViewsReady]) // OS-143/149/161/163/164：注册表、运行时货架、各工作面纯视图先就位（首帧起页签全部由注册表驱动）
  applyTypography()   // OS-91：无库时也先套默认字号档，避免首帧跳变
  applyAgentCollapse() // OS-103
  // 运行时清单与 config 一起拉：chip 要能显示「DSH 原生」这类具体名字，不能等进设置页才加载
  await Promise.all([bootAgentConfig(), loadGlobalConfig(), loadAgentRuntimes()])
  updateAgentChip()
  loadPlugins()
  try {
    const payload = await api('/api/libraries')
    state.libraries = Array.isArray(payload.libraries) ? payload.libraries : []
    state.warnings = Array.isArray(payload.warnings) ? payload.warnings : []
    state.preferencesPath = text(payload.preferencesPath)
    if (payload.defaultRoot) {
      // 启动时带 --root：跳过库选择，直接进这个库的工作台。
      await openLibrary(payload.defaultRoot)
      return
    }
  } catch (error) {
    rememberError(error)
  }
  renderAgent()
  render()
}

async function openLibrary(path) {
  // OS-78：路径归一化——库清单里的 path 可能带反斜杠（Windows），调用方可能传正斜杠；
  // 直接 === 比较会静默找不到库（表现为「点了没反应」）。统一按正斜杠比较。
  const norm = (p) => text(p).replace(/\x5c/gu, '/').replace(/\/+$/u, '')
  const wanted = norm(path)
  const library = state.libraries.find((item) => norm(item.path) === wanted)
  if (!library) return
  // 换库先掐掉还在跑的对话（DSH 一 run 一进程，跨库挂着会把两个库搅在一起）
  if (agent.streaming) {
    try { agent.controller?.abort() } catch { /* 已结束 */ }
    agent.streaming = false
    agent.controller = null
    agent.notices = []
    agent.lastError = '换库，已停止上一段对话'
  }
  state.current = library
  // Agent 列跟库走：这一组重置必须早于任何 early return，
  // 否则"坏库"分支会让上一库的 sessionId 留在内存里，接着打新库的 root 就是 NOT_FOUND。
  agent.sessions = []
  agent.sessionId = ''
  agent.items = []
  agent.cardError = null
  agent.lastError = null
  agent.pendingContext = null
  agent.forceNewSession = false
  // 先体检：形态不对（空地/有稿无标记/缺主模块/坏档）不进空工作台，摆修复卡（A-5 同口径）。
  try {
    const diagnosed = await api(`/api/library/diagnose?root=${encodeURIComponent(path)}`)
    if (diagnosed?.verdict && diagnosed.verdict.ok === false) {
      state.repair = { path, shape: diagnosed.shape ?? {}, verdict: diagnosed.verdict }
      state.view = 'repair'
      render()
      await loadSessions().then(restoreAgentSession).catch(() => {})
      renderAgent()
      return
    }
  } catch { /* 体检接口失败不拦工作台 */ }
  state.chapterFiles = []
  state.chapterFile = ''
  state.chapterText = ''
  state.chapterLoaded = false
  state.chapterNote = ''
  state.savedAt = ''
  state.layerFilter = ''
  state.search = ''
  state.error = ''
  state.view = 'chapters'
  // OS-8/10：按库扫描顶层目录（动态页签）＋章节清单（正文工作面）＋文件直列（转卡兜底）。
  state.libDirs = []
  state.dirWork = {}
  state.write = { chapters: [], listLoading: false }
  state.deduce = {
    premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '',
    mode: 'engine',
    engine: { busy: false, data: null, pov: '', seed: '', error: '', hint: '',
      session: null, sessionLoaded: false, customText: '', draft: null, turnBusy: false, archiveNote: '',
      sessionId: 'main', sessions: null,
      opening: { loaded: false, loading: false, books: [], characters: [], openings: [], selPov: '', selBook: '', selOpen: 'free' },
      view: 'scene', treePick: null,
      assets: null, assetsLoaded: false, assetBookId: '', bgmOn: false,
      paperMode: false, flowPin: true, introOpen: null },
    characters: []
  }
  deduceBgmStop()
  // OS-65（作者实测严重 bug）：换库必须清掉上一库的**所有模块缓存**——
  // 世界书图谱/索引/反链、习惯表、分析结果、推演角色名单。漏掉的会跨库串数据
  // （实测：水浒的人物图谱出现在大梦的推演页）。画布动画也要停。
  graphCleanup?.()
  graphCleanup = null
  import('./graph.mjs').then((m) => m.resetGraphColors?.()).catch(() => {})
  state.refCol = { graph: null, graphLoading: false, graphError: '', summary: '', summaryBusy: false, summaryError: '', narrowOpen: false }
  state.reference = { loaded: false, loading: false, notes: [], tags: [], tagNotes: {}, stats: null, error: '', activePath: '', activeTag: '', note: null, backlinks: { linked: [], unlinked: [] }, draft: '', view: 'graph', q: '', focus: null, absorb: {}, flash: '', tagFilter: '', from: '', noteText: '', fmLen: 0 }
  state.habits = null
  state.habitsError = ''
  state.analyze = { open: false, result: null, busy: false, dismissed: {}, activePara: -1, expandOthers: false, fact: null, factRoot: '', factTab: 'emotion', modOpen: {} }
  state.chapterFiles = []
  try {
    const [topPayload, chapterList, chaptersPayload] = await Promise.all([
      api(`/api/files?root=${encodeURIComponent(path)}`),
      api(`/api/files?root=${encodeURIComponent(path)}&dir=${encodeURIComponent('正文')}`).catch(() => null),
      api(`/api/chapters?root=${encodeURIComponent(path)}&dir=${encodeURIComponent('正文')}`).catch(() => null)
    ])
    state.libDirs = Array.isArray(topPayload.dirs) ? topPayload.dirs : []
    // OS-89：拉库内界面状态（页签/模块开关等）——必须在 render() 之前灌满，
    // 否则第一帧会用默认值渲染再跳一下。这就是「不用浏览器缓存」的落地。
    await loadUiState()
    applyTypography()   // OS-91：进库即应用项目级字号档位
    applyAgentCollapse() // OS-103：进库即应用 Agent 栏折叠状态
    // OS-198：进库拉一次 slot 投影——页签栏第一帧就照 manifest 编排，不再另算名单与顺序。
    await loadPlugins(path)
    // OS-84：探已退场旧目录还剩多少篇——页签栏第一帧就要据此决定藏/露，不能等进世界书页
    await probeRetiredDirs()
    // OS-19：体裁声明后按 excludedPages 裁剪页签（未声明＝不裁剪，保持 OS-8 行为）
    try {
      const briefPayload = await api(`/api/brief?root=${encodeURIComponent(path)}`)
      state.brief = briefPayload.brief ?? null
      state.briefGenre = briefPayload.genre ?? null
      try {
        const picksPayload = await api(`/api/agent-picks?root=${encodeURIComponent(path)}`)
        state.agent.picks = picksPayload.picks ?? null
        state.agent.picksExplicit = picksPayload.explicit === true
      } catch {
        state.agent.picks = null
        state.agent.picksExplicit = false
      }
      if (state.brief && state.briefGenre) {
        // 页签名 → 目录名（worldbook→世界书 等）
        const excluded = new Set((state.briefGenre.excludedPages ?? []).map((page) => PAGE_TO_DIR_LOCAL[page] ?? page))
        state.libDirs = state.libDirs.filter((dir) => !excluded.has(dir))
      }
    } catch {
      state.brief = null
      state.briefGenre = null
    }
    if (chapterList?.ok && Array.isArray(chapterList.files) && chapterList.files.length) {
      state.chapterFiles = chapterList.files.map((item) => item.file)
    }
    if (chaptersPayload?.ok) {
      state.write.chapters = Array.isArray(chaptersPayload.chapters) ? chaptersPayload.chapters : []
      if (!state.chapterFile && state.write.chapters.length) state.chapterFile = state.write.chapters[0].file
      if (!state.chapterFiles.length) state.chapterFiles = state.write.chapters.map((chapter) => chapter.file)
    }
  } catch { /* 清单失败不拦工作台 */ }
  renderAgent()
  render()
  // OS-84 修：清单里顺手指了第一章却没有载入内容——正文页首进＝空态
  // （标题在、正文不在），切走再切回来才被 go('chapters') 的自动载入链补上。
  // 这里直接载入：首进即有正文。只读操作，不写盘。
  if (state.view === 'chapters' && state.chapterFile && !state.chapterLoaded) {
    loadChapter(state.chapterFile)
  }
  // OS-89：进库时按当前模块检索它自己的 log（AGENTS.md 第 10 条）。
  // 进库不走 go('chapters')，所以必须在这里补——否则「本模块修改」永远是 0。
  await loadModuleLog(moduleOfCurrentView(), { limit: 20 })
  if (state.view === 'chapters' && document.getElementById('ref-col')) renderRefCol()
  await loadSessions()
  // 默认会话：接着这个库上次那条聊（OS-39），不用手动去下拉里点
  await restoreAgentSession()
  renderAgent()
}



async function loadChapter(file) {
  if (!state.current) return
  const target = text(file).trim()
  if (!target) {
    state.error = '先填正文文件路径'
    render()
    return
  }
  state.chapterFile = target
  state.loading = true
  state.chapterLoaded = false
  state.error = ''
  state.chapterNote = ''
  state.savedAt = ''
  render()
  try {
    const payload = await api(`/api/chapter?${new URLSearchParams({ root: state.current.path, file: target }).toString()}`)
    state.chapterText = text(payload.text)
    state.chapterLoaded = true
    const meta = state.write.chapters.find((chapter) => chapter.file === target)
    state.chapterMetaAt = meta?.mtime || ''
    state.write.mode = 'read'
    // OS-41：分析面板开着＝切章后自动重跑（曲线/批注跟着新章走，不用手点）
    if (state.analyze.open) runAnalysis()
  } catch (error) {
    if (error.code === 'NOT_FOUND') {
      state.chapterText = ''
      state.chapterLoaded = true
      state.chapterNote = '文件不存在；保存会新建'
      state.error = ''
    } else {
      rememberError(error)
    }
  }
  state.loading = false
  render()
}

async function saveChapter() {
  if (!state.current) return
  const editor = document.getElementById('chapter-editor')
  if (!editor) return
  const value = editor.value
  state.loading = true
  state.error = ''
  try {
    const payload = await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({
        root: state.current.path,
        file: state.chapterFile,
        text: value
      })
    })
    state.chapterText = value
    state.savedAt = payload.savedAt
    state.chapterNote = payload.backup ? `上一版备份：${payload.backup}` : ''
    await loadWriteChapters({ force: true }) // 清单里的字数/大小跟手刷新
  } catch (error) {
    // 写失败也不吞作者刚敲的字：先把编辑框内容放回 state 再重渲染。
    state.chapterText = value
    rememberError(error)
  }
  state.loading = false
  render()
}

/* ---------- 交互 ---------- */

/**
 * 设置页签（OS-32）：设置与正文/产物同级，是一个能打开的窗口——不是常驻页。
 * 打开时记住来处，关掉就回那里（作者口径：这是组件页面，必须能关）。
 */
function openSettingsTab() {
  if (!state.settings.open) {
    state.settings.open = true
    state.settings.prevView = state.view && state.view !== 'settings' ? state.view : (state.current ? 'chapters' : 'libraries')
  }
  state.settings.helpOpen = false
  go('settings')
}

function closeSettingsTab() {
  state.settings.open = false
  state.settings.helpOpen = false
  const back = state.settings.prevView || (state.current ? 'chapters' : 'libraries')
  state.settings.prevView = ''
  state.view = back === 'settings' ? (state.current ? 'chapters' : 'libraries') : back
  render()
}

/** 故事源的右栏关联点击：先在世界书索引里找同名条目，找不到就落到搜索词。 */
function ssOpenReference(name) {
  const wanted = text(name).trim()
  if (!wanted) return
  const jump = () => {
    const hit = findReferenceByRef(wanted)
    if (hit) {
      state.reference.activePath = hit.path
      if (state.view !== 'worldbook') go('worldbook')
      openReference(hit.path)
      return
    }
    state.reference.q = wanted
    if (state.view !== 'worldbook') go('worldbook')
    else render()
  }
  if (state.reference.loaded) jump()
  else loadReferences().then(jump).catch(() => {})
}

/** 故事源内部的全部点击（形态/层/条/章/图/折叠/关联/辐射）。 */
function handleSsClick(target) {
  const fv = state.factView
  if (!fv?.ss) return
  const ss = fv.ss
  const ds = target.dataset || {}
  if (ds.ssView !== undefined) {
    ss.view = ds.ssView
    ss.chartError = ''
    if (ss.view !== 'chart') disposeStorySourceChart()
    render()
    return
  }
  if (ds.ssLayer !== undefined) {
    ss.layer = ds.ssLayer
    render()
    return
  }
  if (ds.ssChapter !== undefined) {
    const chapter = Number(ds.ssChapter)
    ss.chapter = chapter
    ss.entryId = ''
    ss.openChapters[chapter] = ss.openChapters[chapter] !== true
    render()
    return
  }
  if (ds.ssEntry !== undefined) {
    ss.entryId = ds.ssEntry
    const meta = fv.layout?.tree?.entryIndex?.[ds.ssEntry]
    if (meta) {
      ss.chapter = meta.chapter
      ss.openChapters[meta.chapter] = true
    }
    render()
    return
  }
  if (ds.ssChart !== undefined) {
    ss.chart = ds.ssChart
    ss.chartError = ''
    render()
    return
  }
  if (ds.ssGotoWrite !== undefined) {
    jumpToWriteChapter(Number(ds.ssGotoWrite))
    return
  }
  if (ds.ssFold !== undefined) {
    ss.folded[ds.ssFold] = ss.folded[ds.ssFold] !== true
    render()
    return
  }
  if (ds.ssClose !== undefined) {
    ss.closed[ds.ssClose] = true
    render()
    return
  }
  if (ds.ssOpen !== undefined) {
    ss.closed[ds.ssOpen] = false
    render()
    return
  }
  if (ds.ssRef !== undefined) {
    ssOpenReference(ds.ssRef)
    return
  }
  if (ds.ssRadiate !== undefined) {
    if (ds.ssRadiate === 'chart') {
      ss.view = 'chart'
      ss.chart = 'plot-curve'
      ss.chartError = ''
      render()
    } else if (ds.ssRadiate === 'deduce') {
      go('roleplay')
    } else {
      go('chapters')
    }
    return
  }
  if (ds.ssRetryChart !== undefined) {
    ss.chartError = ''
    mountStorySourceChart()
  }
}

function go(view) {
  if (view === 'habits') loadHabits().then(() => { if (state.view === 'habits') render() })
  state.error = ''
  if (view.startsWith('dir:')) {
    openDirWork(view.slice(4))
    return
  }
  // OS-143/198：作用域由注册表驱动；未注册视图留日志并退回第一个可见投影页签，不静默留白。
  // 不需要先打开库；library 作用域没库就退回库清单（扮演也要 root）。
  if (registryModule && !registryModule.viewKnown(view, state.plugins?.slots ?? {})) { console.error(`[go] 未注册视图：${view}`); go(registryModule.visibleTabDefs(registryModule.projectedTabDefs({ slots: state.plugins?.slots ?? {}, ctx: { current: state.current, brief: state.brief, briefGenre: state.briefGenre, libDirs: state.libDirs, settingsOpen: state.settings.open } }), hiddenTabs())[0]?.view ?? 'chapters'); return }
  const scope = registryModule ? registryModule.viewScope(view) : null
  if (scope !== 'global' && scope !== 'flow' && !state.current) {
    state.view = 'libraries'
    render()
    return
  }
  // 点页签进设置就算「打开」；切到别的页签不关闭它（真页签常驻，直到点 ×）
  if (view === 'settings') state.settings.open = true
  state.view = view
  render()
  if (view === 'settings') {
    // 先并行拉数据，全部回来再渲染一次（否则先完成的 render 会用旧 state 覆盖）
    Promise.all([loadGlobalConfig(), loadAgentRuntimes(), loadStyles(), loadPlugins(), loadKbStatus(), loadDshReasoningOptions(), api('/api/health').then((payload) => { state.appVersion = text(payload?.appVersion) || '' }).catch(() => { state.appVersion = '' })])
      .then(() => { if (state.view === 'settings') render() })
      .catch(() => render())
    return
  }
  if (view === 'worldbook') {
    // 世界书页：拉索引，并预挂载模块。loadReferences 内部已含 OS-89 的日志检索。
    // OS-147：收口在 loadReferences 自己身上——索引在途时再进本页会走 ref.loading 早退
    loadReferences().catch((e) => console.error('[ref-render]', e))
    loadRefModule().then(() => { if (state.view === 'worldbook') render() }).catch(() => {})
    return
  }
  if (view === 'knowledge-base') { knowledgeBaseController?.load(); return }
  if (view === 'roleplay') {
    // OS-89：推演模块加载时检索自己的 log
    loadModuleLog(registryModule.namingEntry('roleplay').logModule, { limit: 20 }).then(() => {
      if (state.view === 'roleplay') render()
    })
    return
  }
  if (view === 'artifacts') {
    openArtifacts()
    return
  }
  if (view === 'chapters') {
    // 章节工作面自带清单（不再依赖故事源）；有当前章且在清单里就自动载入。
    loadWriteChapters().then(() => {
      if (!state.chapterLoaded && state.chapterFile && state.write.chapters.some((chapter) => chapter.file === state.chapterFile)) {
        loadChapter(state.chapterFile)
      }
      // OS-89：日志是异步拉的，到位后重排左栏（否则「本模块修改」停在 0）
      if (state.view === 'chapters' && document.getElementById('ref-col')) renderRefCol()
    })
    // 左栏图谱与世界书索引：写小说时要能看到关联的世界书（OS-45）。
    // 注意 loadReferences 有「已加载就短路」的分支，所以图谱要单独保证被拉一次——
    // 否则从世界书页切回正文时，索引已缓存但图谱还是空的。
    Promise.resolve()
      .then(() => loadReferences())
      .then(() => loadRefGraph())
      .catch(() => {})
    return
  }
}

document.addEventListener('click', (event) => {
  // OS-103：世界书·故事源词条点击——切 note 视图并展示词条详情（只读，来源 故事源/）
  const refEntryBtn = event.target.closest?.('[data-ref-entry]')
  if (refEntryBtn && state.view === 'worldbook') {
    state.reference.activeEntry = refEntryBtn.dataset.refEntry || ''
    state.reference.activePath = ''
    state.reference.view = 'note'
    render()
    return
  }
  // 故事源（S2）：形态/层/条/章/图/折叠/关联/辐射都在页内切换，不碰全局路由
  const ssTarget = event.target.closest?.('[data-ss-view], [data-ss-layer], [data-ss-entry], [data-ss-chapter], [data-ss-chart], [data-ss-fold], [data-ss-close], [data-ss-open], [data-ss-ref], [data-ss-radiate], [data-ss-retry-chart], [data-ss-goto-write]')
  if (ssTarget && state.view === 'dir:故事源') {
    handleSsClick(ssTarget)
    return
  }
  // 消息内路径 code（OS-51）：点「参考/约束/写作纪律」旧路径＝打开这篇世界书；
  // 点「正文/001-xxx.md」＝打开这一章。之前没这个入口，点路径会误弹「新建笔记」。
  const pathCode = event.target.closest?.('.msg.assistant code, .msg.assistant .tool-target')
  if (pathCode) {
    const raw = pathCode.textContent.trim().replace(/^参考[\/]/u, `${registryModule.namingEntry('worldbook').dir}/`)
    const looksLikePath = /^(?:参考|正文|大纲|世界书|故事源|扮演|人物|场景|事件|约束|资料|构思|标签)[\/][^\s]+$/u.test(raw)
      || /^[0-9]{3}[-_—][^\s]*\.md$/u.test(raw)
    if (looksLikePath) {
      if (raw.startsWith('正文/') || /^[0-9]{3}[-_—]/u.test(raw)) {
        const file = raw.startsWith('正文/') ? raw : `正文/${raw}`
        loadChapter(file)
        go('chapters')
        return
      }
      if (raw.startsWith(`${registryModule.namingEntry('worldbook').dir}/`) || raw.startsWith('参考/')) {
        const jumpTo = (hit) => {
          state.reference.activePath = hit.path
          if (state.view !== 'worldbook') go('worldbook')
          openReference(hit.path)
        }
        const promptNew = () => {
          const name = raw.split('/').pop().replace(/\.(?:md|markdown|txt)$/iu, '')
          state.reference.pendingNew = name
          openNewReferenceModal('note')
          const nameInput = document.getElementById('ref-new-name')
          if (nameInput) nameInput.value = name
        }
        // write 页通常还没拉世界书索引——先补一次再匹配（click 委托非 async，走 Promise 链）
        const tryJump = () => {
          const hit = findReferenceByRef(raw)
          if (hit) jumpTo(hit)
          else promptNew()
        }
        if (state.reference.loaded) tryJump()
        else loadReferences().then(tryJump)
        return
      }
      const dir = raw.split('/')[0]
      if (state.libDirs.includes(dir)) { go(`dir:${dir}`); return }
    }
  }
  const target = event.target.closest('[data-view], [data-go], [data-action], [data-skin], [data-lib-path], [data-kind], [data-session-id], [data-session-del], [data-create-primary], [data-create-genre], [data-runtime-id], [data-chapter-file], [data-dirfile-pick], [data-settings-section], [data-ref-path], [data-ref-tag], [data-ref-view], [data-wiki-open], [data-wiki-tag], a.wl[data-ref]')
  // 点在菜单/按钮之外：收起输入区菜单（OS-51）——注意这不 return，
  // 后面消息内路径 code 的点击不携带任何 data-*，必须继续往下走
  if (!event.target.closest?.('.composer-pop, .c-tool')) closeComposerMenus()
  if (!target || target.getAttribute?.('aria-disabled') === 'true') return

  if (state.view === 'knowledge-base') { knowledgeBaseController?.click(target); return }
  if (target.dataset.createGenre !== undefined) {
    state.create.genre = target.dataset.createGenre
    state.create.length = null
    render()
    return
  }

  if (target.dataset.settingsSection) {
    state.settings.section = target.dataset.settingsSection
    state.settings.helpOpen = false
    if (state.view !== 'settings') openSettingsTab(); else render()
    return
  }

  if (target.dataset.skin) {
    setSkin(target.dataset.skin)
    return
  }

  // 双链点击（OS-44）：[[某世界书]] 在正文或世界书页里都能点开
  const wl = event.target.closest?.('a.wl[data-ref]')
  if (wl) {
    event.preventDefault()
    const ref = text(wl.dataset.ref).trim()
    if (!ref) return
    // 目录型目标（正文/剧本/…）→ 跳对应工作面
    if (/^(?:正文|剧本|人物|场景|大纲|素材|漫画|视频|体验|联机|资料|约束|构思)[\\/]/u.test(ref)) {
      if (ref.startsWith('正文/')) { loadChapter(ref); go('chapters'); return }
      const dir = ref.split('/')[0]
      if (state.libDirs.includes(dir)) { go(`dir:${dir}`); return }
      return
    }
    // 条目链接：条目工作面已剔除，条目数据的消费方是推演
    if (/^条目[:：]/u.test(ref)) { go('roleplay'); return }
    // 否则当世界书笔记：标题/相对路径/「参考/」旧路径前缀都能认（OS-51）
    const hit = findReferenceByRef(ref)
    if (hit) {
      state.reference.activePath = hit.path
      if (state.view !== 'worldbook') go('worldbook')
      openReference(hit.path)
      return
    }
    // 找不到＝还没建这篇：直接给建（Obsidian 的「点击创建」）
    state.reference.pendingNew = ref
    openNewReferenceModal('note')
    const nameInput = document.getElementById('ref-new-name')
    if (nameInput) nameInput.value = ref
    return
  }
  if (target.dataset.refPath) {
    openReference(target.dataset.refPath)
    return
  }
  if (target.dataset.refTag !== undefined) {
    // 再点同一个标签＝取消筛选（OS-48 侧栏口径）
    const tag = target.dataset.refTag
    state.reference.activeTag = state.reference.activeTag === tag ? '' : tag
    render()
    return
  }
  if (target.dataset.refView !== undefined) {
    // 侧栏视图切换（OS-48）：笔记 / 关系图谱
    state.reference.view = target.dataset.refView || 'graph'
    state.reference.focus = null
    if (state.reference.view === 'graph' && !state.refCol.graph) loadRefGraph()
    render()
    return
  }
  // OS-76：剧本左侧文件列表点选（与正文页章节列表同构）
  if (target.dataset.dirfilePick) {
    const file = target.dataset.dirfilePick
    if (state.view === 'dir:剧本') {
      dirWork('剧本').file = file
      loadDirFile('剧本', file)
    }
    return
  }
  if (target.dataset.chapterFile) {
    loadChapter(target.dataset.chapterFile)
    return
  }
  if (target.dataset.runtimeId !== undefined) {
    selectRuntime(target.dataset.runtimeId)
    return
  }
  if (target.dataset.createPrimary !== undefined) {
    state.create.primary = target.dataset.createPrimary
    for (const option of document.querySelectorAll('[data-create-primary]')) {
      option.classList.toggle('on', option.dataset.createPrimary === state.create.primary)
    }
    return
  }

  if (target.dataset.sessionDel) {
    deleteSession(target.dataset.sessionDel)
    return
  }
  if (target.dataset.action === 'session-pin') {
    // 把这条设为默认临时会话（再点一次取消）；面板不关，所见即所得
    const id = target.dataset.sessionId
    setTempSessionId(getTempSessionId() === id ? '' : id)
    renderAgent()
    return
  }
  if (target.dataset.action === 'temp-mode') {
    // 切换临时需求路由：固定会话（推荐）/ 当前会话
    setTempMode(target.dataset.mode)
    renderAgent()
    return
  }
  if (target.dataset.sessionId) {
    openSession(target.dataset.sessionId)
    closeAgentSessions() // 选完就收起，跟库切换器一致
    return
  }
  if (target.dataset.view) {
    go(target.dataset.view)
    return
  }
  if (target.dataset.go) {
    // 顶栏设置钮＝打开一个可关闭的设置页签（OS-32），不是换页
    if (target.dataset.go === 'settings') openSettingsTab()
    else go(target.dataset.go)
    return
  }
  if (target.dataset.kind !== undefined) {
    state.kindFilter = target.dataset.kind
    render()
    return
  }
  if (target.dataset.libPath) {
    openLibrary(target.dataset.libPath)
    return
  }
  const action = target.dataset.action
  if (action === 'exchange-open') { openExchangeDialog(); return }
  if (action === 'exchange-run') { runExchange(); return }
  if (action === 'exchange-close') { document.getElementById('exchange-dialog')?.remove(); return }
  if (action === 'para-polish') {
    hideParaMenu()
    startPolishRequest()
  } else if (action === 'para-to-agent') {
    hideParaMenu()
    discussSelection()
  } else if (action === 'para-analyze') {
    hideParaMenu()
    // 右键整段：label 带段号；框选半句：label 带字数。两种都只分析框住的内容。
    const wholeLen = (renderedBlocks()[state.sel.para]?.text ?? '').trim().length
    const label = state.sel.para >= 0 && (state.sel.text || '').length === wholeLen
      ? `第 ${state.sel.para + 1} 段`
      : '选区'
    analyzeSelection({ text: state.sel.text, label, para: state.sel.para })
  } else if (action === 'para-result-close') {
    state.sel.paraResult = null
    renderParaResult()
  } else if (action === 'settings-close') {
    event.stopPropagation() // 点 × 不该先触发页签切换
    closeSettingsTab()
  } else if (action === 'tab-hide') {
    event.stopPropagation() // 点 × 不该先切到那个页签
    setTabHidden(target.dataset.tabView, true)
  } else if (action === 'tab-add-open') {
    openTabAdd()
  } else if (action === 'tab-toggle-pick') {
    toggleTabPick(target.dataset.tabView)
  } else if (action === 'tab-create-dir') {
    createTabDir()
  } else if (action === 'tab-make-dir') {
    makeTabDir(target.dataset.dirName)
  } else if (action === 'settings-help-toggle') {
    state.settings.helpOpen = !state.settings.helpOpen
    render()
  } else if (action === 'load-chapter') {
    const input = document.getElementById('chapter-file')
    loadChapter(input?.value || state.chapterFile)
  } else if (action === 'save-chapter') {
    saveChapter()
  } else if (action === 'agent-settings') {
    go('settings')
  } else if (action === 'agent-new-session') {
    newSession()
    closeAgentSessions()
  } else if (action === 'agent-stop') {
    agent.controller?.abort()
  } else if (action === 'agent-send') {
    sendAgentMessage()
  } else if (action === 'copy-text') {
    // 正文框自带的复制：按元素文本复制（body.textContent 是排版后的纯文本）
    const host = document.getElementById(target.dataset.copyTarget || '')
    const body = text(host?.textContent).trim()
    const btn = target
    const mark = (label) => {
      btn.textContent = label
      setTimeout(() => { btn.textContent = '复制' }, 1600)
    }
    const fallback = () => {
      try {
        const area = document.createElement('textarea')
        area.value = body
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const okFlag = document.execCommand?.('copy')
        document.body.removeChild(area)
        mark(okFlag ? '已复制' : '复制失败')
      } catch { mark('复制失败') }
    }
    if (body && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(body).then(() => mark('已复制')).catch(fallback)
    } else if (body) {
      fallback()
    }
  } else if (action === 'ref-summary-run') {
    runRefSummary()
  } else if (action === 'ref-summary-clear') {
    state.refCol.summary = ''
    state.refCol.summaryError = ''
    repaintRefModule('summary')
  } else if (action === 'ref-to-agent') {
    sendReferenceToAgent()
  } else if (action === 'ref-absorb') {
    openAbsorbModal()
  } else if (action === 'ref-absorb-run') {
    runAbsorbFromModal()
  } else if (action === 'ref-node-open') {
    // 图谱信息卡的「打开详情」：大图读 reference.focus，正文页小图读 refCol.pick
    const nodeId = state.reference.focus || state.refCol.pick
    const focusNode = state.refCol.graph?.nodes?.find((node) => node.id === nodeId)
    if (focusNode) navigateFromGraphNode(focusNode)
  } else if (action === 'ref-back-graph') {
    state.reference.view = 'graph'
    state.reference.from = ''
    render()
  } else if (action === 'ref-graph-tag') {
    // 图谱按标签筛子图（作者口径）；切标签时顺手复位聚焦
    const tag = target.dataset.tag || ''
    state.reference.tagFilter = state.reference.tagFilter === tag ? '' : tag
    state.reference.focus = null
    render()
  } else if (action === 'fc-filter-input') {
    // OS-96：视图筛选框——input 事件在下面 fcFilterInput 统一处理（键盘松开即筛）
    render()
  } else if (action === 'fc-save') {
    saveFirstChapter(target.dataset.fcPath)
  } else if (action === 'ref-new-note') {
    openNewReferenceModal('note')
  } else if (action === 'ref-new-tag') {
    openNewReferenceModal('tag')
  } else if (action === 'ref-create') {
    createReferenceFromModal()
  } else if (action === 'msg-copy') {
    const item = agent.items[Number(target.dataset.msgIndex)]
    const body = text(item?.content)
    const btn = target
    const done = () => {
      btn.textContent = '已复制'
      btn.classList.add('ok')
      setTimeout(() => { btn.textContent = '复制'; btn.classList.remove('ok') }, 1600)
    }
    const fail = () => {
      btn.textContent = '复制失败'
      setTimeout(() => { btn.textContent = '复制' }, 1600)
    }
    // 剪贴板 API 在 http/localhost 之外、或没有 user gesture 时会被拒；
    // 兜底走 textarea + execCommand（老浏览器/受限环境都能用）。
    const fallback = () => {
      try {
        const area = document.createElement('textarea')
        area.value = body
        area.style.position = 'fixed'
        area.style.opacity = '0'
        document.body.appendChild(area)
        area.select()
        const okFlag = document.execCommand?.('copy')
        document.body.removeChild(area)
        if (okFlag) done(); else fail()
      } catch { fail() }
    }
    if (body && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(body).then(done).catch(fallback)
    } else if (body) {
      fallback()
    }
  } else if (action === 'sync-prompt-go') {
    runSyncRegen({ auto: false })
  } else if (action === 'sync-prompt-later') {
    // 稍后＝收起横幅，同一指纹不再提醒（下次数据变了才重新提）
    state.sync.prompt = null
    render()
  } else if (action === 'sync-policy-checkon') {
    setSyncPolicy({ checkOn: target.dataset.value === 'manual' ? 'manual' : 'enter' })
  } else if (action === 'sync-policy-action') {
    const v = text(target.dataset.value)
    setSyncPolicy({ action: ['auto', 'silent'].includes(v) ? v : 'remind' })
  } else if (action === 'sync-regen-wiki') {
    // 同源状态条·重新生成：真入口走 enrich（设置里配了文本模型才可用），
    // 未配置/无故事源数据时只在状态条上说明，不发请求。
    regenWikiFromSync()
  } else if (action === 'sync-recheck') {
    // 同源状态条·重试：绕过 loaded 缓存再打一次（后端刚起来时用）
    state.sync.notice = ''
    loadSyncCheck({ force: true })
  } else if (action === 'sync-toggle-list') {
    // 外部改动清单的展开/收起（存在 state 上，render 不会冲掉）
    state.sync.openList = !state.sync.openList
    render()
  } else if (action === 'msg-reject') {
    // 驳回（OS-51）：只收起这条消息的产物按钮，不动任何文件
    const idx = Number(target.dataset.msgIndex)
    if (Number.isInteger(idx)) {
      if (!agent.rejectedMsgs) agent.rejectedMsgs = {}
      agent.rejectedMsgs[idx] = true
      renderThread()
    }
  } else if (action === 'msg-redo') {
    // 重新修改（OS-51）：把产物文件塞进上下文，输入框预填，作者接着提要求
    const file = target.dataset.file || ''
    agent.pendingContext = {
      quote: file,
      context: '',
      label: `重新修改：${file}`
    }
    renderAgent()
    const input = document.getElementById('agent-input')
    if (input) {
      input.value = '重新修改刚才那段：'
      input.focus()
      const end = input.value.length
      input.setSelectionRange?.(end, end)
    }
  } else if (action === 'tool-open') {
    // 工具行点击（OS-59）：按目标路径分流——正文→正文页，参考旧路径→世界书，其它→目录页
    const raw = text(target.dataset.toolTarget).trim().replace(/^参考[\/]/u, `${registryModule.namingEntry('worldbook').dir}/`)
    if (!raw) return
    if (raw.startsWith('正文/') || /^[0-9]{3}[-_—]/u.test(raw)) {
      const file = raw.startsWith('正文/') ? raw : `正文/${raw}`
      loadChapter(file)
      go('chapters')
      return
    }
    if (raw.startsWith(`${registryModule.namingEntry('worldbook').dir}/`)) {
      const jumpTo = (hit) => {
        state.reference.activePath = hit.path
        if (state.view !== 'worldbook') go('worldbook')
        openReference(hit.path)
      }
      const tryJump = () => {
        // 按标题兜底（OS-59）：文件可能已迁到「习惯/」或被改名——
        // 旧会话里的工具行还指着老路径，用标题再找一次，别直接报错
        const hit = findReferenceByRef(raw)
          || (state.reference.notes || []).find((note) => raw.endsWith(`/${note.title}.md`) || raw.endsWith(`${note.title}.md`))
        if (hit) { jumpTo(hit); return }
        // 世界书里没有：可能是规则类笔记已迁到 习惯/（OS-57 三层定界）——
        // 这种情况直接带作者去习惯页，而不是丢一句「不存在」
        const base = raw.split('/').pop() || ''
        if (state.habits && base && (state.habits.style || []).length >= 0) {
          go('habits')
          return
        }
        rememberAgentError(`打不开这个路径：${raw}`)
      }
      if (state.reference.loaded) tryJump()
      else loadReferences().then(tryJump)
      return
    }
    if (raw.startsWith('习惯/')) {
      // 习惯类文件（如迁走的写作纪律）→ 跳习惯页
      go('habits')
      return
    }
    const dir = raw.split('/')[0]
    if (state.libDirs.includes(dir)) { go(`dir:${dir}`); return }
    rememberAgentError(`这个路径打不开：${raw}`)
  } else if (action === 'card-from') {
    openCardModal(target.dataset.msgIndex)
  } else if (action === 'card-create') {
    submitCard()
  } else if (action === 'card-adopt') {
    adoptCard(target.dataset.cardId)
  } else if (action === 'card-reject') {
    rejectCard(target.dataset.cardId)
  } else if (action === 'agent-config-save') {
    saveAgentSettings()
  } else if (action === 'script-more') {
    openScriptSettingsModal()
  } else if (action === 'script-pref-save-modal') {
    const autoFormat = document.getElementById('sm-autoformat')?.checked === true
    const castColors = document.getElementById('sm-castcolors')?.checked === true
    setScriptPref('autoFormat', autoFormat)
    setScriptPref('castColors', castColors)
    closeModal()
    if (state.view === 'dir:剧本') render()
  } else if (action === 'script-to-fact') {
    scriptToFactFlow()
  } else if (action === 'fact-to-script') {
    factToScriptFlow()
  } else if (action === 'script-pref-save') {
    const autoFormat = document.getElementById('sc-pref-autoformat')?.checked === true
    const castColors = document.getElementById('sc-pref-castcolors')?.checked === true
    setScriptPref('autoFormat', autoFormat)
    setScriptPref('castColors', castColors)
    const note = document.getElementById('sc-pref-note')
    if (note) note.textContent = '已保存（本库生效）'
    if (state.view === 'dir:剧本') render()
  } else if (action === 'config-save') {
    saveConfigBlock(target.dataset.block)
  } else if (action === 'config-probe') {
    runConfigProbe(target.dataset.probeKind)
  } else if (action === 'modal-close') {
    closeModal()
  } else if (action === 'flow-create') {
    flowCreate()
  } else if (action === 'flow-create-reset') {
    state.create = { parent: state.create.parent, name: '', primary: state.create.primary, running: false, result: null, error: '' }
    render()
  } else if (action === 'flow-import') {
    flowImport()
  } else if (action === 'flow-back') {
    state.view = 'libraries'
    state.repair = null
    render()
  } else if (action === 'reveal-path') {
    revealNativePath(target.dataset.path || '')
  } else if (action === 'fsb-go') {
    loadFsBrowse(target.dataset.path || '')
  } else if (action === 'fsb-jump') {
    loadFsBrowse(target.dataset.path || '')
  } else if (action === 'fsb-up') {
    loadFsBrowse(state.fsBrowse?.parent || '')
  } else if (action === 'fsb-pick') {
    // 选中当前所在目录（文件夹场景）
    const fb = state.fsBrowse
    if (!fb) return
    // OS-119：选过就记住——下次开窗直接落这里（fire-and-forget，不拖慢关窗）
    if (fb.path) {
      state.fsLastPicked = fb.path
      api('/api/fs/browse', { method: 'POST', body: JSON.stringify({ path: fb.path, remember: true }) }).catch(() => {})
    }
    const inputEl = fb.targetId ? document.getElementById(fb.targetId) : null
    applyPickedPath({ dataset: {} }, inputEl, 'folder', fb.path)
    state.fsBrowse = null
    closeModal()
    render()
  } else if (action === 'fsb-close') {
    state.fsBrowse = null
    closeModal()
    render()
  } else if (action === 'pick-folder' || action === 'pick-file') {
    // OS-108：调 daemon 弹 Windows 原生对话框（浏览器拿不到绝对路径）
    pickNativePath(target, action === 'pick-file' ? 'file' : 'folder')
  } else if (action === 'create-submit') {
    submitCreate()
  } else if (action === 'create-open') {
    openLibrary(target.dataset.root)
  } else if (action === 'create-import') {
    state.repair = null
    flowImport({ root: target.dataset.root })
  } else if (action === 'import-scan') {
    scanImportFlow()
  } else if (action === 'import-run') {
    runImportFlow()
  } else if (action === 'import-open') {
    openLibrary(target.dataset.root)
  } else if (action === 'import-again') {
    state.impo.report = null
    render()
  } else if (action === 'repair-create') {
    state.create.parent = state.repair?.path ?? state.create.parent
    state.create.name = ''
    state.create.result = null
    state.create.error = ''
    state.view = 'lib-create'
    render()
    document.getElementById('create-parent')?.focus()
  } else if (action === 'repair-import') {
    const source = state.repair?.path ?? ''
    state.repair = null
    // 目标库不预填坏目录：让作者从清单里挑（或先去新建）。
    flowImport({ source, root: '' })
  } else if (action === 'repair-primary') {
    repairSetPrimary(target.dataset.id)
  } else if (action === 'dirfile-save') {
    if (state.view?.startsWith('dir:')) saveDirFile(state.view.slice(4))
  } else if (action === 'dirfile-new') {
    if (state.view?.startsWith('dir:')) createDirFile(state.view.slice(4))
  } else if (action === 'deduce-engine-present') {
    // 草稿还没收口就推下一拍＝先存草稿再推（不丢作者改过的字）
    if (state.deduce.engine.draft) deduceEngineNext()
    else deduceEnginePresent({})
  } else if (action === 'deduce-engine-reset') {
    state.deduce.engine.draft = null
    deduceEnginePresent({ reset: true, hint: '本局已清空从第一拍重来' })
  } else if (action === 'ow-mode-roleplay') {
    state.deduce.engine.playMode = 'roleplay'
    uiSet('deducePlayMode', 'roleplay')
    render()
  } else if (action === 'ow-mode-engine') {
    state.deduce.engine.playMode = 'engine'
    uiSet('deducePlayMode', 'engine')
    render()
  } else if (action === 'ow-pov') {
    state.deduce.engine.opening.selPov = target.dataset.name
    render()
  } else if (action === 'ow-book') {
    state.deduce.engine.opening.selBook = target.dataset.id
    render()
  } else if (action === 'ow-open') {
    state.deduce.engine.opening.selOpen = target.dataset.id
    render()
  } else if (action === 'ow-start') {
    // OS-99：扮演模式不摆引擎局面——那是推演的确定性引擎。扮演首幕由玩家输入驱动：
    // 直接把 POV/世界书/开头记进 engine，流里放一句「你说你的第一幕」，等玩家开口。
    // OS-100：handler 作用域里没有 engine 变量——先取出来（曾 ReferenceError 卡住开局）
    const engine = state.deduce.engine
    const ow = state.deduce.engine.opening
    const open = (ow.openings ?? []).find((o) => o.id === ow.selOpen)
    if (engine.playMode === 'engine') {
      deduceEnginePresent({ pov: ow.selPov, bookId: ow.selBook, seedPrompt: open && open.id !== 'free' ? open.detail : '', hint: '开局——选一条走向，世界回你一段正文' })
    } else {
      engine.pov = ow.selPov
      engine.bookId = ow.selBook
      engine.seedPrompt = open && open.id !== 'free' ? open.detail : ''
      engine.roleplayStarted = true
      engine.roleplayOptions = []
      engine.lastBeats = []
      uiSet('deducePlayMode', 'roleplay')
      if (ow.selPov === '主持人') {
        engine.hint = '你是主持人——说一句开场（这一幕在哪儿、什么时候、谁在场），我来替你召集演员'
        render()
      } else {
        // OS-100：不再干等玩家开口——主持人先替世界拉开第一幕（时间/地点/在场/第一眼）
        engine.hint = '正在拉开开场…'
        render()
        deduceRoleplayOpening({
          pov: ow.selPov,
          openingDetail: open && open.id !== 'free' ? open.detail : ''
        })
      }
    }
  } else if (action === 'deduce-sess-new') {
    deduceSessionManage('new', '')
  } else if (action === 'deduce-sess-switch') {
    deduceSessionManage('switch', target.dataset.id)
  } else if (action === 'deduce-sess-del') {
    deduceSessionManage('delete', target.dataset.id)
  } else if (action === 'deduce-engine-choose') {
    deduceEngineTurn({ choiceId: target.dataset.candidateId })
} else if (action === 'roleplay-edit-card') {
    roleplayEditCard(target.dataset.name || '')
  } else if (action === 'roleplay-save-card') {
    roleplaySaveCard(target.dataset.name || '')
  } else if (action === 'roleplay-option') {
    // OS-98：情境分支——点了就是你的下一幕动作
    const idx = Number(target.dataset.idx)
    const opt = (state.deduce.engine.roleplayOptions ?? [])[idx]
    if (opt) deduceRoleplayTurn({ playerAction: opt })
  } else if (action === 'deduce-engine-custom') {
    // OS-81：customText 在 input 事件里同步进 engine 状态——重渲不丢作者正在写的字
    const customValue = (state.deduce.engine.customText ?? '').trim()
    if (!customValue) {
      state.deduce.engine.error = '先写两句「这一拍发生什么」，再按「按我写的走」。'
      render()
    } else if ((state.deduce.engine.playMode || 'roleplay') !== 'engine') {
      deduceRoleplayTurn({ playerAction: customValue })
    } else {
      deduceEngineTurn({ customText: customValue })
    }
  } else if (action === 'agent-collapse') {
    // OS-103：折叠/展开 Agent 栏——状态落库内 ui-state
    const next = !uiGet('agentCollapsed', false)
    uiSet('agentCollapsed', next || null, { immediate: true })
    applyAgentCollapse()
  } else if (action === 'suite-select') {
    // OS-99：主从两栏——点左列切换右栏详情，不整页跳转
    state.settings.suiteId = target.dataset.id
    state.settings.section = 'suites'
    render()
  } else if (action === 'plug-info') {
    // OS-120：技能与运行时没有编辑面，点开只把它的完整信息摊开（不假装能改）
    const kind = target.dataset.kind || ''
    const id = target.dataset.id || ''
    const item = (state.plugins?.list ?? []).find((entry) => entry.kind === kind && entry.id === id)
    if (!item) return
    openModal(`<h3>${esc(item.name || item.id)}</h3>
      <p class="sub">${esc(item.kindLabel || kind)}${item.source ? ' · ' + esc(item.source) : ''}</p>
      ${item.description ? `<p class="sub">${esc(item.description)}</p>` : ''}
      <div class="plug-info-meta">
        <span>版本 v${esc(item.version || '—')}</span>
        <span>${item.enabled === false ? '已停用' : '已启用'}</span>
        ${item.blocked ? `<span class="plug-info-bad">${esc(item.blockedReason || '被拦下')}</span>` : ''}
      </div>
      <div class="ops"><button class="btn-ghost" data-action="modal-close">知道了</button></div>`)
  } else if (action === 'knowledge-save') {
    saveKbConfig()
  } else if (action === 'knowledge-test') {
    testKbConnection()
  } else if (action === 'knowledge-collection-add') {
    addKbCollectionRow()
  } else if (action === 'knowledge-collection-remove') {
    removeKbCollectionRow(target)
  } else if (action === 'chip-toggle-edit') {
    // OS-92：进入/退出删除态——所有标签显 ×（作者原话：点删按钮，下面的标签都出现 x 号）
    const field = target.closest('.uikit-chipfield')
    if (field) {
      const on = field.dataset.editing === '1'
      field.dataset.editing = on ? '0' : '1'
      for (const x of field.querySelectorAll('.uikit-chip-x')) x.classList.toggle('is-hidden', on)
      target.classList.toggle('uikit-btn-ghost', !on)
    }
  } else if (action === 'chip-remove') {
    // 删除单个标签：重排索引并同步隐藏字段
    const field = target.closest('.uikit-chipfield')
    const key = target.dataset.chipKey
    const index = Number(target.dataset.chipIndex)
    if (!field || !key) return
    const values = chipValuesOf(field)
    values.splice(index, 1)
    chipSetValues(field, values)
  } else if (action === 'open-typography-settings') {
    closeModal()
    state.settings.section = 'typography'
    state.view = 'settings'
    state.settings.open = true
    render()
  } else if (action === 'skill-peek') {
    openSkillPeek(target.dataset.skillName)
  } else if (action === 'typo-ui') {
    setTypography('ui', target.dataset.typoUi)
  } else if (action === 'typo-doc') {
    setTypography('doc', target.dataset.typoDoc)
  } else if (action === 'typo-reset') {
    uiSet('typography', null, { immediate: true })
    applyTypography()
    render()
  } else if (action === 'modlog-open') {
    // OS-90：点日志行 → 看这次改动的完整 diff
    openChangeLogEntry(target.dataset.module, target.dataset.at, target.dataset.hash)
  } else if (action === 'modlog-restore') {
    restoreFromLog(target.dataset.module, target.dataset.at, target.dataset.hash)
  } else if (action === 'deduce-paper-toggle') {
    const engine = state.deduce.engine
    engine.paperMode = !engine.paperMode
    uiSet('deducePaperMode', engine.paperMode)
    render()
  } else if (action === 'deduce-flow-jump') {
    const sc = document.getElementById('deduce-flow')
    state.deduce.engine.flowPin = true
    if (sc) sc.scrollTo({ top: sc.scrollHeight, behavior: 'smooth' })
    const pill = document.getElementById('deduce-flow-jump')
    if (pill) pill.hidden = true
  } else if (action === 'deduce-engine-regen') {
    state.deduce.engine.draftEdit = false
    deduceEngineTurn({ regenerate: true })
  } else if (action === 'deduce-engine-next') {
    deduceEngineNext()
  } else if (action === 'deduce-pending-write') {
    deducePendingSettle(target.dataset.id, 'write')
  } else if (action === 'deduce-pending-dismiss') {
    deducePendingSettle(target.dataset.id, 'dismiss')
  } else if (action === 'deduce-archive') {
    deduceArchiveChapter()
  } else if (action === 'deduce-engine-veto') {
    deduceEngineSettle(target.dataset.candidateId, 'veto')
  } else if (action === 'deduce-tw-skip') {
    dedTypewriterSkip()
  } else if (action === 'ref-gen-image') {
    generateReferenceImage()
  } else if (action === 'deduce-export') {
    deduceExportSession()
  } else if (action === 'deduce-promote-flow') {
    deducePromoteFlow()
  } else if (action === 'deduce-promote-go') {
    deducePromoteRun()
  } else if (action === 'deduce-image') {
    deduceImageFlow()
  } else if (action === 'job-ball-toggle') {
    state.jobs.open = !state.jobs.open
    renderJobBall()
  } else if (action === 'job-cancel') {
    const id = target.dataset.jobId
    state.jobs.open = true
    if (id) refreshJobsAfter(() => api('/api/jobs/cancel', { method: 'POST', body: JSON.stringify({ id }) }))
    else renderJobBall()
  } else if (action === 'job-clear') {
    refreshJobsAfter(() => api('/api/jobs/clear', { method: 'POST', body: JSON.stringify({}) }))
  } else if (action === 'gg-toggle') {
    // OS-81：序章里只剩「前情提要」一个折叠位（其余内容直接入流）
    const engine = state.deduce.engine
    const key = target.dataset.ggKey
    engine.introOpen = engine.introOpen || {}
    engine.introOpen[key] = engine.introOpen[key] === false
    render()
  } else if (action === 'deduce-info-toggle') {
    // OS-81：正经布尔切换——不管当前是 undefined（默认隐藏/显示）都能一下到位
    const engine = state.deduce.engine
    const data = engine.data
    const visible = data ? (engine.infoOpen === true || (!data.narrative && engine.infoOpen !== false)) : false
    engine.infoOpen = !visible
    uiSet('deduceInfoOpen', engine.infoOpen)
    render()
  } else if (action === 'deduce-tools-toggle') {
    const engine = state.deduce.engine
    engine.setOpen = !engine.setOpen
    render()
  } else if (action === 'deduce-draft-edit') {
    const engine = state.deduce.engine
    engine.draftEdit = !engine.draftEdit
    // 收起编辑器后展示态直接全显（刚改过的稿不重打）
    if (!engine.draftEdit) engine.draftShownFull = true
    render()
    if (engine.draftEdit) {
      const box = document.getElementById('deduce-draft')
      if (box) { box.focus(); box.setSelectionRange(box.value.length, box.value.length) }
    }
  } else if (action === 'deduce-image-go') {
    deduceImageRun()
  } else if (action === 'deduce-bgm-toggle') {
    deduceBgmToggle()
  } else if (action === 'deduce-mode-engine') {
    state.deduce.mode = 'engine'
    render()
  } else if (action === 'deduce-mode-agent') {
    state.deduce.mode = 'agent'
    render()
  } else if (action === 'deduce-view-scene') {
    // OS-86：形态三分切换——从 Agent 点回流/树要先把引擎模式接回来
    state.deduce.mode = 'engine'
    state.deduce.engine.view = 'scene'
    state.deduce.engine.treePick = null
    render()
  } else if (action === 'deduce-view-tree') {
    state.deduce.mode = 'engine'
    state.deduce.engine.view = 'tree'
    render()
  } else if (action === 'deduce-tree-back') {
    deduceTreeJump()
  } else if (action === 'deduce-tree-branch') {
    deduceTreeBranch()
  } else if (action === 'deduce-start') {
    startDeduce()
  } else if (action === 'deduce-stop') {
    state.deduce.controller?.abort()
  } else if (action === 'deduce-card') {
    openCardModalFor(state.deduce.reply, state.deduce.sessionId, '推演还没建立会话（先成功跑一次推演）。')
  } else if (action === 'chapter-create') {
    createChapterFlow()
  } else if (action === 'chapter-rename') {
    closeModal()
    renameChapterFlow()
  } else if (action === 'chapter-delete') {
    closeModal()
    deleteChapterFlow()
  } else if (action === 'docpref-toggle-gap') {
    const next = !loadDocPrefs().autoGap
    setDocPref('autoGap', next)
    // 就地改文案：面板不重绘也能保持在打开状态
    target.textContent = next ? '已开启（点按关闭）' : '已关闭（点按开启）'
  } else if (action === 'refcol-toggle') {
    // OS-114：窄面板下＝抽屉开合（不动作者对模块的偏好）；宽面板＝原逻辑（整栏显隐）
    if (isNarrowPanel()) {
      state.refCol.narrowOpen = state.refCol.narrowOpen !== true
      applyNarrowRefDrawer()
      return
    }
    // 左栏整体显隐（浮层，不影响正文）。全关时点这里重新打开全部。
    const hidden = hiddenModules()
    const visible = REF_MODULES.filter((mod) => !hidden.has(mod.id))
    if (visible.length) {
      for (const mod of visible) setModuleHidden(mod.id, true)
    } else {
      for (const mod of REF_MODULES) setModuleHidden(mod.id, false)
    }
    render()
  } else if (action === 'refmod-toggle') {
    // 就地折叠：不整页重绘（否则正文滚动位置会跳回顶部）
    const id = target.dataset.moduleId
    const openState = state.refCol.open ?? (state.refCol.open = {})
    const next = openState[id] === false
    openState[id] = next
    const card = target.closest('.ref-mod')
    if (card) {
      const mod = REF_MODULES.find((item) => item.id === id)
      card.dataset.open = next ? '1' : '0'
      target.setAttribute('aria-expanded', next ? 'true' : 'false')
      const oldBody = card.querySelector('.ref-mod-body')
      if (next) {
        const body = document.createElement('div')
        body.className = 'ref-mod-body'
        body.innerHTML = mod ? mod.render() : ''
        card.append(body)
        if (id === 'graph') requestAnimationFrame(() => mountRefGraph())
      } else {
        oldBody?.remove()
        if (id === 'graph') state.refCol.graphMounted = false
      }
    }
  } else if (action === 'module-close') {
    setModuleHidden(target.dataset.moduleId, true)
  } else if (action === 'sel-polish') {
    startPolishRequest()
  } else if (action === 'sel-discuss') {
    discussSelection()
  } else if (action === 'clear-agent-context') {
    state.agent.pendingContext = null
    closeComposerMenus()
    renderAgent()
  } else if (action === 'toggle-style-menu') {
    toggleComposerMenu('style')
  } else if (action === 'toggle-plus-menu') {
    toggleComposerMenu('plus')
  } else if (action === 'plus-back') {
    const menu = document.getElementById('agent-plus-menu')
    if (menu) { menu.innerHTML = plusMenuHtml(); menu.hidden = false }
  } else if (action === 'pick-file') {
    pickReferenceFile(target.dataset.dir)
  } else if (action === 'attach-file') {
    attachFileToAgent(target.dataset.file)
  } else if (action === 'skill-attach') {
    // 技能（OS-66 作者口径）：选中＝提示 chip 显示在对话框上方；输入框不放说明文字。
    // data-skill-name＝真技能（拉全文注入）；data-kit-name＝套件规范引用（老链路保留）。
    if (target.dataset.kitName) {
      const name = target.dataset.kitName || ''
      const desc = target.dataset.kitDesc || ''
      agent.pendingContext = {
        kind: 'skill',
        quote: name,
        context: `按《${name}》套件的默认规范处理。${desc ? `（${desc}）` : ''}`,
        label: `套件规范：${name}`
      }
      closeComposerMenus()
      renderAgent()
      document.getElementById('agent-input')?.focus()
    } else {
      attachSkillToAgent(target.dataset.skillName || '')
    }
  } else if (action === 'cmd-fill') {
    closeComposerMenus()
    const input = document.getElementById('agent-input')
    if (input) {
      input.value = target.dataset.cmd || ''
      input.focus()
      const end = input.value.length
      input.setSelectionRange?.(end, end)
    }
  } else if (action === 'genre-pick') {
    pickGenre(target.dataset.genreId || '')
  } else if (action === 'pick-style') {
    pickStyle(target.dataset.skillName || '')
  } else if (action === 'toggle-method') {
    toggleMethod(target.dataset.skillName || '')
  } else if (action === 'style-mode-plain') {
    if (agent.pendingContext?.kind === 'polish') agent.pendingContext = null
    closeComposerMenus()
    renderAgent()
  } else if (action === 'style-mode-polish') {
    closeComposerMenus()
    startPolishRequest()
  } else if (action === 'analyze-toggle') {
    toggleAnalyzePanel()
  } else if (action === 'analyze-picker') {
    state.analyze.pickerOpen = !state.analyze.pickerOpen
    renderAnalyzePanel()
  } else if (action === 'analyze-module-toggle') {
    toggleAnalyzeModule(target.dataset.moduleId || '')
  } else if (action === 'analyze-to-source') {
    openStorySourceModule(target.dataset.moduleId || '')
  } else if (action === 'mod-toggle') {
    const id = target.dataset.modId
    if (!state.analyze.modOpen) state.analyze.modOpen = {}
    state.analyze.modOpen[id] = !(state.analyze.modOpen[id] === true)
    renderAnalyzePanel()
  } else if (action === 'ed-jump') {
    // 总评「详情 ↘」：展开对应模块卡并把右栏滚到它（OS-56 详有略的「略→详」跳转）
    const id = target.dataset.module
    if (!state.analyze.modOpen) state.analyze.modOpen = {}
    state.analyze.modOpen[id] = true
    renderAnalyzePanel()
    const card = document.querySelector(`.analyze-sec[data-mod-card="${id}"]`)
    card?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  } else if (action === 'habits-save') {
    saveHabits()
  } else if (action === 'analyze-expand') {
    state.analyze.expandOthers = !state.analyze.expandOthers
    renderAnalyzePanel()
  } else if (action === 'gutter-jump') {
    gutterJump(target.dataset.blockIndex)
  } else if (action === 'analyze-close') {
    state.analyze.open = false
    renderAnalyzePanel()
  } else if (action === 'analyze-run') {
    runAnalysis()
  } else if (action === 'analyze-dismiss') {
    dismissIssue(target.dataset.issueId)
  } else if (action === 'curve-para') {
    gotoParagraph(target.dataset.paragraph)
  } else if (action === 'analyze-chart') {
    state.analyze.factTab = target.dataset.tab === 'events' ? 'events' : 'emotion'
    renderAnalyzePanel()
  } else if (action === 'curve-chapter') {
    const no = Number(target.dataset.chapterNo)
    const file = (state.write.chapters || []).find((c) => chapterNoFromFile(c.file) === no)?.file
    if (file) {
      loadChapter(file)
    } else {
      state.error = '曲线指向第 ' + no + ' 章，但正文列表里没有对应文件（章节号按文件名 NNN- 前缀匹配）。'
      render()
    }
  } else if (action === 'analyze-goto') {
    gotoParagraph(target.dataset.paragraph)
  } else if (action === 'analyze-fix') {
    fixIssueWithAgent(target.dataset.issueId)
  } else if (action === 'doc-more') {
    openDocMore()
  } else if (action === 'chapter-history') {
    closeModal() // 版本历史会跳到产物，面板得先收
    openChapterHistory()
  } else if (action === 'chapter-nav') {
    if (target.dataset.file) loadChapter(target.dataset.file)
  } else if (action === 'artifact-preview') {
    previewArtifact(target.dataset.file)
  } else if (action === 'artifact-edit') {
    editArtifact(target.dataset.file)
  } else if (action === 'artifact-restore') {
    restoreArtifact(target.dataset.file, target.dataset.original)
  } else if (action === 'suite-open') {
    state.settings.suiteId = target.dataset.id
    state.settings.section = 'suites'
    render()
  } else if (action === 'suite-toggle') {
    toggleSuite(target.dataset.id)
  } else if (action === 'suite-settings-save') {
    saveSuiteValues(target.dataset.id)
  } else if (action === 'runtime-setup') {
    runRuntimeSetup(target.dataset.id)
  } else if (action === 'toggle-lib-switch') {
    const panel = document.getElementById('lib-switch-panel')
    if (panel) {
      panel.classList.toggle('open')
      renderLibSwitchPanel()
    }
  } else if (action === 'toggle-agent-sessions') {
    toggleAgentSessions()
  }
})

document.addEventListener('change', (event) => {
  const target = event.target
  if (state.view === 'knowledge-base') { knowledgeBaseController?.change(target); return }
  // 设置 · 模型：运行时下拉＝立刻切活动运行时（与插件节的运行时卡同一口径）
  if (target.id === 'mcfg-runtime') {
    selectRuntime(text(target.value))
    return
  }
  // 设置 · 模型：生图后端切换＝两套表单显隐（OpenAI 兼容 / ComfyUI）
  if (target.id === 'mcfg-image-backend') {
    const comfy = text(target.value) === 'comfyui'
    const openaiBox = document.getElementById('mcfg-image-openai')
    const comfyBox = document.getElementById('mcfg-image-comfy')
    if (openaiBox) openaiBox.hidden = comfy
    if (comfyBox) comfyBox.hidden = !comfy
    return
  }
  // 故事源换书（S2）：force 重拉 entries/curve/graph
  if (target.id === 'ss-book' && state.view === 'dir:故事源') {
    loadFactViewData(true, target.value)
    return
  }
  // 工作台模块插拔（OS-44）：勾选＝显示，取消＝隐藏
  if (target.dataset?.action === 'module-toggle' && target.dataset.moduleId) {
    setModuleHidden(target.dataset.moduleId, target.checked !== true)
    return
  }
  if (target.id === 'import-root') {
    state.impo.root = target.value
    return
  }
  if (target.id === 'dirfile-select' && state.view?.startsWith('dir:')) {
    loadDirFile(state.view.slice(4), target.value)
    return
  }
  // 推演草稿（OS-61 P2）：失焦即存进会话
  if (target.id === 'deduce-draft') {
    deduceSaveDraft()
    return
  }
  // OS-75：剧本 contenteditable 失焦保存（把 innerText 写回 dir work）
  if (target.dataset?.scriptEditor === '1' && state.view === 'dir:剧本') {
    const work = dirWork('剧本')
    if (work?.loaded) {
      const next = target.innerText.replace(/\n{3,}/gu, '\n\n').trim()
      if (next !== work.text.replace(/\s+$/u, '').trim()) {
        work.text = next
        saveDirFile('剧本')
      }
    }
    return
  }
})

document.addEventListener('input', (event) => {
  const target = event.target
  if (state.view === 'knowledge-base') { knowledgeBaseController?.input(target); return }
  // 推演输入条（OS-81）：自由输入同步进 engine 状态（重渲不丢）＋轻量自适应高度
  if (target.id === 'deduce-custom') {
    const engine = state.deduce.engine
    engine.customText = target.value
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 132)}px`
    return
  }
  // 推演草稿（OS-81）：逐字同步进 draft——失焦保存才有东西可存（旧实现只挂 blur，编辑内容实际存不进去）
  if (target.id === 'deduce-draft') {
    const engine = state.deduce.engine
    if (engine.draft) {
      engine.draft.prose = target.value
      // OS-89：编辑中的草稿也要落本地（未保存内容禁止只活在内存/缓存里）。
      // 走独立草稿通道，和「会话整存」分开——会话整存是失焦时才做，这里要即时。
      debounceDraftPersist(registryModule.namingEntry('roleplay').logModule, engine.draft.nodeId || `round-${engine.draft.round}`, target.value)
    }
    const chars = document.getElementById('deduce-draft-chars')
    if (chars) chars.textContent = `${target.value.length} 字 · 失焦自动保存`
    return
  }
  // 故事源表格（S2）：只重渲表体，不打断搜索框焦点
  if (target.id === 'ss-search' && state.view === 'dir:故事源') {
    const fv = state.factView
    if (!fv?.layout || !fv.ss) return
    fv.ss.q = target.value
    const region = document.getElementById('ss-table-region')
    if (region) region.innerHTML = ssTableHtml(fv.layout, fv.ss)
    const count = document.getElementById('ss-board-count')
    if (count) count.textContent = `${ssFilteredRows(fv.layout, fv.ss).length} / ${fv.layout.stats.entries} 条`
    return
  }
  if (target.dataset?.docpref) {
    const key = target.dataset.docpref
    setDocPref(key, Number(target.value))
    const label = target.closest('.field')?.querySelector('.count')
    if (label) label.textContent = ` ${target.value}${key === 'fontSize' ? 'px' : key === 'paraGap' || key === 'indent' ? 'em' : ''}`
    return
  }
  if (target.id === 'dir-editor' && state.view?.startsWith('dir:')) {
    const work = dirWork(state.view.slice(4))
    work.text = target.value
    const chars = document.getElementById('dir-chars')
    if (chars) chars.textContent = `${target.value.length} 字`
    return
  }
  if (target.id === 'create-parent' || target.id === 'create-name') {
    if (target.id === 'create-parent') state.create.parent = target.value
    else state.create.name = target.value
    const parent = document.getElementById('create-parent')?.value.trim()
    const name = document.getElementById('create-name')?.value.trim()
    const preview = document.querySelector('.path-preview')
    if (preview) preview.textContent = parent && name ? `将创建：${joinDir(parent, name)}` : ''
    return
  }
  if (target.id === 'ref-search') {
    // 世界书侧栏搜索（OS-53）：只重渲目录树容器，不打断输入焦点
    state.reference.q = target.value
    const tree = document.getElementById('ref-tree')
    if (tree && refModule) {
      tree.innerHTML = refModule.refTreeHtml({
        notes: state.reference.notes,
        tags: state.reference.tags,
        activeTag: state.reference.activeTag,
        activePath: state.reference.activePath,
        q: state.reference.q
      })
    }
    return
  }
  if (target.id === 'chapter-editor') {
    state.chapterText = target.value
    state.savedAt = ''
    const chars = document.getElementById('chapter-chars')
    if (chars) chars.textContent = `${target.value.length} 字`
  }
  // 推演回合层（OS-61 P2）：输入同步进 state，重渲不丢字
  if (target.id === 'deduce-custom') {
    state.deduce.engine.customText = target.value
    return
  }
  if (target.id === 'deduce-draft' && state.deduce.engine.draft) {
    state.deduce.engine.draft.prose = target.value
    const chars = document.getElementById('deduce-draft-chars')
    if (chars) chars.textContent = `${target.value.length} 字`
  }
})

document.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && event.target.id === 'chapter-new-title') {
    event.preventDefault()
    createChapterFlow()
    return
  }
  if (event.key === 'Enter' && event.target.id === 'chapter-file') {
    event.preventDefault()
    loadChapter(event.target.value)
    return
  }
  if (event.key === 'Enter' && event.target.id === 'dirfile-new-name' && state.view?.startsWith('dir:')) {
    event.preventDefault()
    createDirFile(state.view.slice(4))
    return
  }
  if (event.key === 'Enter' && event.target.id === 'agent-input' && !event.shiftKey) {
    event.preventDefault()
    sendAgentMessage()
    return
  }
  // 输入条（OS-81/97）：Enter＝发送，Shift+Enter＝换行。扮演模式走 roleplayTurn，推演走引擎。
  if (event.key === 'Enter' && event.target.id === 'deduce-custom' && !event.shiftKey) {
    event.preventDefault()
    const engine = state.deduce.engine
    const customValue = (engine.customText ?? '').trim()
    if (customValue && !engine.busy && !engine.turnBusy) {
      if ((engine.playMode || 'roleplay') !== 'engine') deduceRoleplayTurn({ playerAction: customValue })
      else deduceEngineTurn({ customText: customValue })
    }
    return
  }
  // OS-92：标签输入框——空格/回车/逗号成标签，空框退格删最后一个
  if (chipInputKeydown(event)) return
  if (event.key === 'Escape') {
    if (state.view === 'chapters' && state.write.mode === 'edit') { leaveDocEdit(); return }
    closeModal()
  }
})

// 正文滚动 → 右栏批注卡吸顶跟随（OS-33）。事件委托：容器会被 writeHtml 重建。
document.addEventListener('scroll', (event) => {
  if (event.target?.id === 'doc-scroll') {
    if (analyzeScrollTick) return
    analyzeScrollTick = requestAnimationFrame(() => {
      analyzeScrollTick = 0
      syncAnalyzeScroll()
    })
  }
}, true)

// 会话双击重命名（OS-31：列表在下拉面板里；损坏标题也给原始值让作者自己能改）
document.addEventListener('dblclick', (event) => {
  const row = event.target.closest('.agent-sess-panel .sess[data-session-id]')
  if (!row || agent.streaming) return
  const session = agent.sessions.find((item) => item.id === row.dataset.sessionId)
  if (!session) return
  const title = sessionTitle(session)
  renameSession(session.id, title.broken ? '' : title.label)
})

// 点弹层遮罩空白处＝关闭；点切换器之外＝收起库下拉
// 逐块实时编辑：失焦即写回并自动保存（不需要「编辑/保存」按钮）
document.addEventListener('focusout', (event) => {
  const blockEl = event.target?.closest?.('.doc-block[data-block]')
  if (!blockEl) return
  // 正文页 / 世界书详情页 / 剧本页共用同一套逐块实时编辑（OS-53/OS-76）；按所在容器与视图分流写回
  if (blockEl.closest('#ref-reader')) commitRefBlock(blockEl)
  else if (state.view === 'chapters' || state.view === 'dir:剧本') commitDocBlock(blockEl)
})

// 文档内拖选文字 → 上方浮窗（润笔 / 与 Agent 讨论）
// OS-37：右键整段已是主入口；这里只服务「拖选了半句话」的场景，且落在有真实拖选时才弹。
// 注意：不要监听 scroll 收浮窗——contenteditable 聚焦会触发滚动，会把刚弹出的浮窗立刻收掉。
let selBarTimer = null
document.addEventListener('selectionchange', () => {
  if (state.view !== 'chapters') return
  const picked = readDocSelection()
  if (picked) {
    // 整段被 Range 全选（右键走的路径）时不再弹横条——那是段操作，不是文字级操作
    const wholeBlock = picked.text.length === (picked.blockEl.textContent || '').trim().length
    if (wholeBlock) { hideSelBar(); return }
    clearTimeout(selBarTimer)
    selBarTimer = setTimeout(() => {
      const again = readDocSelection()
      if (again) showSelBar(again)
    }, 120)
    return
  }
  clearTimeout(selBarTimer)
  if (!state.sel.busy) hideSelBar()
})

document.addEventListener('mousedown', (event) => {
  if (event.target.id === 'overlay') closeModal()
  if (!event.target.closest?.('[data-selbar]') && !event.target.closest?.('.doc-block')) hideSelBar()
  if (!event.target.closest?.('[data-paramenu]')) hideParaMenu()
  const switcher = document.getElementById('lib-switch')
  const panel = document.getElementById('lib-switch-panel')
  if (panel?.classList.contains('open') && switcher && !switcher.contains(event.target)) {
    panel.classList.remove('open')
  }
  const sessDd = document.getElementById('agent-sess-dd')
  if (document.getElementById('agent-sess-panel')?.classList.contains('open') && sessDd && !sessDd.contains(event.target)) {
    closeAgentSessions()
  }
})

/* ---------- 段操作（OS-37）：左键选中整段 / 右键出浮窗 ---------- */

// 右键一段 ＝ 把这一段「框选」出来，并给出三个动作（润笔 / 添加到 Agent / 分析这一段）
document.addEventListener('contextmenu', (event) => {
  if (state.view !== 'chapters') return
  const blockEl = event.target?.closest?.('.doc-block')
  if (!blockEl) return
  event.preventDefault() // 不要系统右键菜单
  hideSelBar()
  showParaMenu(blockEl, event.clientX, event.clientY)
})

// 左键点一行：把这一段标成「选中」（视觉高亮），但不动光标——contenteditable 里还要正常打字
document.addEventListener('click', (event) => {
  if (state.view !== 'chapters') return
  if (event.button !== 0) return
  if (event.target.closest?.('.doc-gutter, [data-paramenu], .para-result, .sel-bar')) return
  const blockEl = event.target?.closest?.('.doc-block')
  if (!blockEl) return
  const selection = window.getSelection?.()
  if (selection && !selection.isCollapsed) return // 用户在拖选，别抢
  // 标出选中态：记下这一段作为「当前段」，右键/动作都拿它
  const index = Number(blockEl.dataset.block)
  state.sel.para = index
  state.sel.blockIndex = index
  state.sel.text = (blockEl.textContent || '').trim()
  document.querySelectorAll('.doc-block.para-on').forEach((el) => el.classList.remove('para-on'))
  blockEl.classList.add('para-on')
})

/* ---------- 风格包（OS-5：目录加载，真皮在 daemon 侧 styles/ 目录）---------- */

function currentPack() {
  return state.styles.find((pack) => pack.id === state.skin) || state.styles[0] || null
}

function applySkin(pack) {
  if (!pack) return
  state.skin = pack.id
  let styleEl = document.getElementById('skin-style')
  if (!styleEl) {
    styleEl = document.createElement('style')
    styleEl.id = 'skin-style'
    document.head.appendChild(styleEl)
  }
  // 注入 :root（后置覆盖静态兜底）；token 名/值已在 daemon 侧按 --kebab/禁注入字符校验过。
  styleEl.textContent = `:root {\n${Object.entries(pack.tokens || {}).map(([key, value]) => `  ${key}: ${value};`).join('\n')}\n}`
  document.documentElement.dataset.skin = pack.id
}

function setSkin(id) {
  const pack = state.styles.find((item) => item.id === id)
  if (!pack) return
  applySkin(pack)
  api('/api/ui-preferences', { method: 'PUT', body: JSON.stringify({ skin: id }) }).catch(() => {}) // OS-158：皮肤落服务端，失败不影响本次生效
  // wiki 网页态的强调色跟包走，换皮即重载 iframe；设置页要刷新选中态。
  if (state.view === 'settings') render()
  // 图谱是 canvas 绘制、配色取自 CSS 变量；换皮后重挂一次才能跟上新色板
  // （世界书页大图是 focus 模式，正文页左栏小图是 jump 模式——按当前页分流，OS-49）
  if (document.getElementById('ref-graph-canvas')) {
    graphCleanup?.()
    graphCleanup = null
    requestAnimationFrame(() => {
      if (state.view === 'worldbook' && (state.reference.view || 'graph') === 'graph') mountReferenceGraph()
      else mountRefGraph()
    })
  }
  // 故事源图表用令牌取色：换皮后重挂一次，轴/线/热力才跟上新色板（OS-49 同口径）
  if (state.view === 'dir:故事源' && state.factView?.ss?.view === 'chart') mountStorySourceChart()
}

async function loadStyles() {
  try {
    const payload = await api('/api/styles')
    state.styles = Array.isArray(payload.styles) ? payload.styles : []
    state.stylesWarnings = Array.isArray(payload.warnings) ? payload.warnings : []
    // OS-109：风格包真实目录（本机路径区显示＋一键打开）
    state.stylesDirs = Array.isArray(payload.dirs) ? payload.dirs : []
  } catch {
    state.styles = []
  }
}

async function loadKbStatus() {
  // OS-97：状态与配置一起拉——设置页要能立即渲染表单，而不是等用户点开才读
  // OS-146：带当前库 root——模块闸按这个库的 kb 开关判定（多库时不被别的库误拦）
  const q = state.current?.path ? `?root=${encodeURIComponent(state.current.path)}` : ''
  try {
    const [status, config] = await Promise.all([
      api(`/api/kb/status${q}`).catch(() => null),
      api(`/api/kb/config${q}`).catch(() => null)
    ])
    state.kbStatus = status
    state.kbConfig = config ? { ...config.config, configPath: config.configPath, configError: config.configError } : null
  } catch {
    state.kbStatus = null
    state.kbConfig = null
  }
}

/** OS-97：读知识库表单当前值（UI → 配置对象）。 */
function readKbForm() {
  const root = document.getElementById('knowledge-collections')
  const collections = {}
  if (root) {
    const rows = root.querySelectorAll('.knowledge-collection-row')
    for (const row of rows) {
      const alias = row.querySelector('[data-knowledge-collection-alias]')?.value?.trim()
      const id = row.querySelector('[data-knowledge-collection-id]')?.value?.trim()
      if (alias && id) collections[alias] = id
    }
  }
  const key = document.getElementById('knowledge-api-key')?.value?.trim() || ''
  return {
    baseUrl: document.getElementById('knowledge-base-url')?.value?.trim() || '',
    // 留空＝保留原密钥（协议约定 __KEEP__）
    apiKey: key || '__KEEP__',
    spaceId: document.getElementById('knowledge-space-id')?.value?.trim() || '',
    collections
  }
}

/** OS-97：保存知识库配置。 */
async function saveKbConfig() {
  state.kbMsg = '保存中…'
  render()
  try {
    // OS-146：带当前库 root——模块闸按这个库判定，不被别的库的停用误拦
    const payload = await api('/api/kb/config', { method: 'PUT', body: JSON.stringify({ ...readKbForm(), root: state.current?.path || '' }) })
    state.kbStatus = payload.status ?? state.kbStatus
    state.kbMsg = '已保存并重探服务'
    // 重新拉配置（拿回新的掩码）
    await loadKbStatus()
  } catch (error) {
    state.kbMsg = `保存失败：${text(error?.message || error)}`
  }
  render()
}

/** OS-97：测试知识库连接（不写盘）。 */
async function testKbConnection() {
  state.kbMsg = '测试中…'
  render()
  try {
    const form = readKbForm()
    const payload = await api('/api/kb/test', {
      method: 'POST',
      body: JSON.stringify({ baseUrl: form.baseUrl, apiKey: form.apiKey, root: state.current?.path || '' })
    })
    const w = payload.weknora || {}
    const e = payload.embedding || {}
    state.kbMsg = `WeKnora ${w.up ? '在线' : '离线'} · Embedding ${e.up ? '在线' : '离线'}`
    await loadKbStatus()
  } catch (error) {
    state.kbMsg = `测试失败：${text(error?.message || error)}`
  }
  render()
}

/** OS-97：分库行增删（前端本地操作，保存时才落盘）。 */
function addKbCollectionRow() {
  const root = document.getElementById('knowledge-collections')
  if (!root) return
  const empty = root.querySelector('p.sub')
  if (empty) empty.remove()
  const row = document.createElement('div')
  row.className = 'knowledge-collection-row'
  row.innerHTML = '<input class="uikit-input" data-knowledge-collection-alias placeholder="别名" aria-label="分库别名">'
    + '<input class="uikit-input" data-knowledge-collection-id placeholder="collection id" aria-label="分库 id">'
    + '<button type="button" class="btn-ghost" data-action="knowledge-collection-remove" title="删除这一行">×</button>'
  root.appendChild(row)
  row.querySelector('[data-knowledge-collection-alias]')?.focus()
}

function removeKbCollectionRow(button) {
  button.closest('.knowledge-collection-row')?.remove()
}

async function bootStyles() {
  await loadStyles()
  let saved = ''
  try { saved = text((await api('/api/ui-preferences')).preferences?.skin) } catch { saved = '' }
  state.skin = saved
  applySkin(currentPack())
}

/**
 * 库内 UI 状态桥接（OS-89）。
 *
 * 作者立宪（AGENTS.md 第 8 条）：
 *   「绝对不能放在任何浏览器缓存里……关掉浏览器、换一台机器、清缓存后，
 *     重新打开库必须完全复原。不能复原＝违规。」
 *
 * 所以这些偏好全部改到库内 `.openstory/ui-state.json`：
 *   · 读：同步（界面渲染需要立即拿到值）——从内存镜像 state.uiState 读；
 *     进库时由 loadUiState() 从服务端拉一次灌满镜像。
 *   · 写：同步更新镜像 + 异步防抖落库（不阻塞 UI，但保证最终一致）。
 *   · 无库可写时（库清单页）才退到内存，不落任何浏览器存储。
 *
 * 皮肤是另一个例外：它没有库也要生效，故落服务端机器级 ui-preferences.json（OS-158）。
 */

/** 内存镜像：库内 ui-state.json 的副本。切换库时重置。 */
function uiMemory(root) {
  if (!state.uiState) state.uiState = { root: '', values: {}, loaded: false }
  const mem = state.uiState
  const key = text(root || state.current?.path || '')
  if (mem.root !== key) {
    mem.root = key
    mem.values = {}
    mem.loaded = false
  }
  return mem
}

/** 进库时拉一次（在 openLibrary 里调）。失败不阻断界面。 */
async function loadUiState() {
  if (!state.current?.path) return {}
  const mem = uiMemory(state.current.path)
  try {
    const payload = await api(`/api/ui-state?root=${encodeURIComponent(state.current.path)}`)
    mem.values = payload?.state && typeof payload.state === 'object' ? payload.state : {}
    mem.loaded = true
  } catch {
    mem.values = {}
    mem.loaded = true
  }
  // OS-145/146：旧键迁移跑一次落 marker（OS-146 起迁移表为空——只防重扫，不写死键）。
  await settingsAggregationReady
  const migrated = settingsAggregation?.migrateLegacySettings(mem.values)
  if (migrated?.changed) {
    mem.values = migrated.state
    uiFlush()
  }
  return mem.values
}

/**
 * 同步读一个 UI 状态键。
 * @param {string} key
 * @param {*} fallback 键不存在时的默认值
 */
function uiGet(key, fallback = null) {
  const mem = uiMemory()
  return key in mem.values ? mem.values[key] : fallback
}
/** OS-144 模块插件判定（前端唯一入口）：ui-state `modules.enabled.<id>`（扁平键优先，缺省启用）。 */
function moduleOn(id) { const flat = uiGet(`modules.enabled.${id}`, null); if (flat !== null) return flat !== false; const nested = uiGet('modules', null); if (nested && nested.enabled && Object.prototype.hasOwnProperty.call(nested.enabled, id)) return nested.enabled[id] !== false; return true }

/** 防抖落库：短时间内多次设置只写一次。 */
let uiFlushTimer = null
let uiPendingKeys = new Set()

function uiFlush() {
  if (uiFlushTimer) { clearTimeout(uiFlushTimer); uiFlushTimer = null }
  const root = state.current?.path
  if (!root) return
  const mem = uiMemory(root)
  uiPendingKeys = new Set()
  // 落库失败不回滚内存（界面以内存为准），但要如实报错
  return api('/api/ui-state', {
    method: 'PUT',
    body: JSON.stringify({ root, state: mem.values })
  }).catch((error) => {
    state.error = `界面状态没能存进库（${error?.message || error}）——换机器后这些偏好会丢`
    render()
  })
}

/**
 * 写一个 UI 状态键（同步更新内存，防抖落库）。
 * @param {string} key
 * @param {*} value 传 null ＝删除该键
 */
function uiSet(key, value, { immediate = false } = {}) {
  const mem = uiMemory()
  if (value === null) delete mem.values[key]
  else mem.values[key] = value
  uiPendingKeys.add(key)
  if (immediate || !state.current?.path) {
    if (state.current?.path) return uiFlush()
    return undefined
  }
  if (uiFlushTimer) clearTimeout(uiFlushTimer)
  uiFlushTimer = setTimeout(uiFlush, 400)
}

/**
 * OS-201：工作台模块启停专用写回——先落排队中的界面状态，再只补丁写这一个键；
 * 成功以库为准回填内存镜像，失败原样抛出且内存不动（不许出现内存与库错位）。
 */
async function setModuleEnabled(id, enabled) {
  const root = state.current?.path
  if (!root) throw Object.assign(new Error('先打开一个库——启停按库分别记'), { code: 'NO_LIBRARY' })
  if (uiPendingKeys.size) await uiFlush()
  await api('/api/ui-state', { method: 'PUT', body: JSON.stringify({ root, state: { [`modules.enabled.${id}`]: enabled } }) })
  await loadUiState()
}

/** 页面关闭前把没落库的写掉（尽力而为）。 */
function flushUiOnUnload() {
  const root = state.current?.path
  if (!root || !uiPendingKeys.size) return
  const mem = uiMemory(root)
  try {
    // sendBeacon 保证卸载时也能发出去；daemon 是本地回环，几乎必达
    const blob = new Blob([JSON.stringify({ root, state: mem.values })], { type: 'application/json' })
    navigator.sendBeacon?.('/api/ui-state', blob)
  } catch { /* 尽力而为 */ }
}
window.addEventListener('beforeunload', flushUiOnUnload)

/* ---------- 模块变更日志（AGENTS.md 第 10 条） ---------- */

/**
 * 模块加载时检索自己的 log。
 * 「每一个模块在每次加载的时候，都要自己检索一遍跟自己相关的一些 log。」
 * @param {string} module 模块名（正文/世界书/扮演/习惯/剧本/故事源…）
 * @param {{limit?: number, file?: string}} [opts]
 * @returns {Promise<{entries: Array, truncated: boolean}>}
 */
async function loadModuleLog(module, { limit = 20, file = '' } = {}) {
  if (!state.current?.path) return { entries: [], truncated: false }
  const key = `${module}|${file}`
  if (!state.moduleLogs) state.moduleLogs = {}
  try {
    const qs = new URLSearchParams({
      root: state.current.path,
      module,
      limit: String(limit),
      ...(file ? { file } : {})
    })
    const payload = await api(`/api/log?${qs.toString()}`)
    const result = { entries: payload?.entries ?? [], truncated: payload?.truncated === true }
    state.moduleLogs[key] = result
    return result
  } catch {
    state.moduleLogs = state.moduleLogs || {}
    state.moduleLogs[key] = { entries: [], truncated: false, error: true }
    return state.moduleLogs[key]
  }
}

/** 取已加载的模块日志（同步，供渲染）。 */
function moduleLogOf(module, file = '') {
  return state.moduleLogs?.[`${module}|${file}`] ?? null
}

/** 把日志渲染成可读清单（时间/操作/文件/一句话 diff 摘要）。 */
function moduleLogHtml(module, { file = '', limit = 8, title = '最近修改' } = {}) {
  const log = moduleLogOf(module, file)
  if (!log || (!log.entries.length && !log.error)) return ''
  if (log.error) return `<div class="modlog"><div class="modlog-head">${esc(title)}</div><p class="modlog-empty">日志读不到（不影响写作）</p></div>`
  const rows = log.entries.slice(0, limit).map((entry) => {
    const when = text(entry.at).replace('T', ' ').slice(5, 16)
    const opLabel = { create: '新建', update: '修改', delete: '删除', move: '移动', adopt: '采纳' }[entry.op] || entry.op
    const fileLabel = text(entry.file).split('/').pop()
    const delta = entry.beforeChars === entry.afterChars ? ''
      : `${entry.beforeChars}→${entry.afterChars} 字`
    // OS-90：整行可点 → 打开 diff 弹层（看完整差异 + 可恢复）
    return `<button class="modlog-row" data-action="modlog-open" data-module="${esc(module)}" data-at="${esc(entry.at)}" data-hash="${esc(entry.afterHash)}" title="${esc(entry.file)}「点击查看这处改动」">
      <span class="modlog-at">${esc(when)}</span>
      <span class="modlog-op" data-op="${esc(entry.op)}">${esc(opLabel)}</span>
      <span class="modlog-file">${esc(fileLabel)}</span>
      <span class="modlog-delta">${esc(delta)}</span>
    </button>`
  }).join('')
  return `<div class="modlog">
    <div class="modlog-head">${esc(title)}<span class="count">${log.entries.length}</span></div>
    ${rows}
  </div>`
}

/**
 * OS-90：打开一条变更的 diff 弹层。
 * 显示完整 unified diff（+/- 着色）；若这条变更带 backup，则提供「恢复到此版本」。
 */
async function openChangeLogEntry(module, at, afterHash) {
  openModal('<div class="loading">正在读取这次改动…</div>')
  let entry = null
  try {
    const qs = new URLSearchParams({ root: state.current.path, module, at, afterHash })
    const payload = await api(`/api/log/entry?${qs.toString()}`)
    entry = payload?.entry ?? null
  } catch (error) {
    openModal(`<h3>这次改动</h3><p class="sub">读不出来：${esc(text(error?.message || error))}</p>
      <div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>`)
    return
  }
  if (!entry) {
    openModal('<h3>这次改动</h3><p class="sub">找不到这条记录（可能已被清理）。</p>'
      + '<div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>')
    return
  }
  const diffLines = text(entry.diff).split(String.fromCharCode(10)).map((line) => {
    let cls = 'ctx'
    if (line.startsWith('+++') || line.startsWith('---')) cls = 'hdr'
    else if (line.startsWith('@@')) cls = 'hunk'
    else if (line.startsWith('+')) cls = 'add'
    else if (line.startsWith('-')) cls = 'del'
    return `<div class="diff-line ${cls}">${esc(line) || '&nbsp;'}</div>`
  }).join('')
  const opLabel = { create: '新建', update: '修改', delete: '删除', move: '移动', adopt: '采纳' }[entry.op] || entry.op
  const canRestore = Boolean(entry.backup)
  openModal(`<h3>${esc(opLabel)} · ${esc(text(entry.file).split('/').pop())}</h3>
    <p class="sub">${esc(text(entry.at).replace('T', ' ').slice(0, 19))} · ${entry.beforeChars}→${entry.afterChars} 字
      ${entry.diffTruncated ? ' · <span class="hint">diff 过长已截断</span>' : ''}</p>
    <div class="diff-view">${diffLines || '<div class="diff-line ctx">（无内容变化）</div>'}</div>
    <div class="ops">
      ${canRestore
        ? `<button class="btn-primary" data-action="modlog-restore" data-module="${esc(module)}" data-at="${esc(entry.at)}" data-hash="${esc(entry.afterHash)}">恢复到此版本之前</button>`
        : '<span class="count">这条变更没有可恢复的备份</span>'}
      <button class="btn-ghost" data-action="modal-close">关闭</button>
    </div>`)
}

/** OS-90：从日志恢复——先确认，再调端点（服务端会先给当前内容做安全备份）。 */
async function restoreFromLog(module, at, afterHash) {
  const ok = globalThis.confirm?.('把这个文件恢复到这次改动之前的状态？')
  if (!ok) return
  try {
    const payload = await api('/api/log/restore', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, module, at, afterHash })
    })
    closeModal()
    state.reference.flash = `已恢复：${payload.file}${payload.safetyBackup ? `（当前内容备份在 ${payload.safetyBackup}）` : ''}`
    // 重载受影响的数据
    await loadModuleLog(module, { limit: 20 })
    if (module === '正文') await loadWriteChapters({ force: true })
    if (module === registryModule.namingEntry('worldbook').logModule) await loadReferences({ force: true })
    if (module === '习惯') { state.habits = null; await loadHabits({ force: true }) }
    render()
  } catch (error) {
    state.error = `恢复失败：${text(error?.message || error)}`
    render()
  }
}

/* ---------- 未保存草稿落本地（AGENTS.md 第 11 条） ---------- */

/**
 * 草稿落库防抖队列。
 * 作者正在打字时不必每键一次网络往返，但**绝不能只留在内存**：
 * 停手 700ms 就落一次，刷新/关页面也能捞回。
 */
const draftTimers = new Map()

/**
 * 把「正在编辑、尚未保存」的内容落进库内 .openstory/drafts（防抖 700ms）。
 * @param {string} module 模块名
 * @param {string} id     草稿标识（如推演拍号）
 * @param {string} body   当前文本
 */
function debounceDraftPersist(module, id, body) {
  if (!state.current?.path || !module || !id) return
  const key = `${module}|${id}`
  if (draftTimers.has(key)) clearTimeout(draftTimers.get(key))
  draftTimers.set(key, setTimeout(() => {
    draftTimers.delete(key)
    persistDraftNow(module, id, body)
  }, 700))
}

/** 立刻落一次草稿（失焦、切页、关闭前调）。 */
async function persistDraftNow(module, id, body) {
  if (!state.current?.path || !module || !id) return { ok: false }
  try {
    const payload = await api('/api/draft', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, module, id, text: text(body) })
    })
    return { ok: true, draft: payload?.draft ?? null }
  } catch (error) {
    return { ok: false, error }
  }
}

/** 读一份草稿（恢复用）。 */
async function readDraft(module, id) {
  if (!state.current?.path || !module || !id) return null
  try {
    const qs = new URLSearchParams({ root: state.current.path, module, id })
    const payload = await api(`/api/draft?${qs.toString()}`)
    return payload?.draft ?? null
  } catch { return null }
}

/** 列某模块全部草稿。 */
async function readDrafts(module) {
  if (!state.current?.path || !module) return []
  try {
    const qs = new URLSearchParams({ root: state.current.path, module })
    const payload = await api(`/api/draft?${qs.toString()}`)
    return Array.isArray(payload?.drafts) ? payload.drafts : []
  } catch { return [] }
}

/** 删除草稿（内容已采纳进正文时收口）。 */
async function dropDraftFile(module, id) {
  if (!state.current?.path || !module || !id) return false
  try {
    await api('/api/draft', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, module, id, delete: true })
    })
    return true
  } catch { return false }
}

/** 卸载前把待落草稿全部写掉（尽力而为）。 */
function flushDraftsOnUnload() {
  for (const [key, timer] of draftTimers.entries()) {
    clearTimeout(timer)
    draftTimers.delete(key)
  }
}
window.addEventListener('beforeunload', flushDraftsOnUnload)

// OS-158：先取服务端皮肤再首屏渲染，杜绝闪一下；取数失败内部已回落缺省，不拦启动。
;(async () => { await bootStyles(); boot() })()

/** OS-89：当前视图对应的模块名（用于「模块加载时检索自己的 log」）。
 * OS-148：视图→日志模块名唯一真源在命名表（registry.logModuleForView），这里不再抄一份映射。 */
function moduleOfCurrentView() {
  return registryModule ? registryModule.logModuleForView(state.view) : ''
}

/* ---------- OS-92：标签编辑器（chip field）交互 ---------- */

/** 取某个 chip 字段的当前值（从隐藏 input 读，单一真源）。 */
function chipValuesOf(fieldEl) {
  const hidden = fieldEl?.querySelector('[data-chip-value]')
  const raw = hidden ? hidden.value : ''
  return raw.split(String.fromCharCode(10)).map((line) => line.trim()).filter(Boolean)
}

/** 写回标签集合：重排 DOM + 同步隐藏字段 + 更新计数。 */
function chipSetValues(fieldEl, values) {
  if (!fieldEl) return
  const key = fieldEl.dataset.chipField
  const max = Number(fieldEl.dataset.max) || 60
  const list = values.map((v) => String(v).trim().slice(0, max)).filter(Boolean)
  const body = fieldEl.querySelector('.uikit-chipfield-body')
  const editing = fieldEl.dataset.editing === '1'
  if (body) {
    body.innerHTML = list.length
      ? list.map((value, index) => uiKit.chipChip({ key, value, index, editing })).join('')
      : '<span class="uikit-chipfield-empty">还没有条目——在下面输入，按空格添加</span>'
  }
  const hidden = fieldEl.querySelector('[data-chip-value]')
  if (hidden) hidden.value = list.join(String.fromCharCode(10))
  const count = fieldEl.querySelector('[data-chip-count]')
  if (count) count.textContent = String(list.length)
}

/** 追加一个标签（去重）。 */
function chipAddValue(fieldEl, value) {
  const max = Number(fieldEl?.dataset.max) || 60
  const clean = String(value || '').trim().slice(0, max)
  if (!clean) return false
  const values = chipValuesOf(fieldEl)
  if (values.includes(clean)) return false
  chipSetValues(fieldEl, [...values, clean])
  return true
}

/** 标签输入框的键处理：空格/回车/逗号 → 成标签。 */
function chipInputKeydown(event) {
  const input = event.target
  if (!input?.matches?.('[data-chip-input]')) return false
  const isSep = event.key === ' ' || event.key === 'Enter' || event.key === ',' || event.key === '、'
  const field = input.closest('.uikit-chipfield')
  if (!field) return false
  if (isSep) {
    event.preventDefault()
    const added = chipAddValue(field, input.value)
    if (added) input.value = ''
    return true
  }
  // 退格删最后一个（输入框为空时）
  if (event.key === 'Backspace' && !input.value) {
    const values = chipValuesOf(field)
    if (values.length) {
      event.preventDefault()
      values.pop()
      chipSetValues(field, values)
    }
    return true
  }
  return false
}

// OS-96：世界书「首次出现章节」——筛选框实时过滤＋详情页数字框失焦写回 frontmatter
document.addEventListener('input', (event) => {
  if (event.target?.id === 'fc-filter') {
    const v = Math.max(0, Math.floor(Number(event.target.value) || 0))
    state.reference.firstChapterFilter = v
    render()
  }
})
document.addEventListener('change', (event) => {
  if (event.target?.classList?.contains('fc-input')) {
    saveFirstChapter(event.target.dataset.fcPath, Math.max(0, Math.floor(Number(event.target.value) || 0)))
  }
})

/** 写回 frontmatter.firstChapter：读原文→替换/插入 fm 行→走世界书保存通道（OS-96）。 */
async function saveFirstChapter(notePath, value) {
  const ref = state.reference
  if (!state.current || !notePath) return
  const note = (ref.notes || []).find((n) => n.path === notePath)
  if (!note) return
  try {
    const payload = await api(`/api/reference/note?root=${encodeURIComponent(state.current.path)}&path=${encodeURIComponent(notePath)}`)
    const raw = text(payload.note?.text)
    const fmMatch = /^---\r?\n([\s\S]*?)\r?\n---/u.exec(raw)
    let next
    if (fmMatch) {
      const fm = fmMatch[1]
      const lineRe = /^firstChapter:\s*.*$/mu

      next = lineRe.test(fm)
        ? raw.replace(lineRe, `firstChapter: ${value}`)
        : raw.replace(/^---\r?\n/, `---\nfirstChapter: ${value}\n`)
    } else {
      next = `---\nfirstChapter: ${value}\n---\n\n` + raw
    }
    // OS-211：世界书笔记走专用端点（/api/reference/note PUT——归属 worldbook，写实现同一份）
    await api('/api/reference/note', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, path: notePath, text: next })
    })
    note.firstChapter = value
    if (ref.note?.path === notePath) ref.note.firstChapter = value
    ref.flash = `已记下：${note.title} 首次出现于第 ${value} 章`
    render()
  } catch (error) {
    state.error = `首次出现章节没写进去（${(error && error.message) || error}）`
    render()
  }

}

/* ---------- OS-103：Agent 栏折叠 ---------- */

/** 把折叠状态投影到 DOM（进库后、切换后都调）。 */
function applyAgentCollapse() {
  const col = document.getElementById('agent-col')
  if (!col) return
  col.classList.toggle('is-collapsed', uiGet('agentCollapsed', false) === true)
}
