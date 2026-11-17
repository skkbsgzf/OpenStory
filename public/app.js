/**
 * OpenStory 工作台数据与路由（OS-3 ＋ OS-4）。
 *
 * 全部数据来自本机 daemon（127.0.0.1）：
 *   GET  /api/libraries → 库卡
 *   GET  /api/entries   → 拆解条目清单（S1 factFileStore 同构）
 *   GET  /api/entry     → 单条
 *   GET/PUT /api/chapter→ 正文读/写（PUT 同目录 .history 备份）
 *   GET  /api/wiki、POST /api/wiki/derive → S4 派生 wiki
 *   GET/PUT /api/agent/config            → 模型端点（key 只存 daemon 本机，这里只拿到掩码）
 *   GET/POST /api/agent/sessions…        → 会话（JSONL 在 daemon 侧）
 *   POST /api/agent/chat                 → 流式对话（SSE：start → delta* → done/error）
 *   POST /api/agent/cards[/adopt|/reject]→ 待确认卡（采纳走正文快照闸）
 *
 * v1 边界：Agent 无工具循环（读不到库文件）；正文保存不做跨进程 revision 闸（.history 粗保护）。
 * 这里不内置任何演示数据——读不到就摆空态，不拿假卡片冒充库。
 */

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
  wikiFrom: null,
  wikiLoaded: false,
  loading: false,
  error: '',
  styles: [],
  stylesWarnings: [],
  skin: '',
  wikiMode: 'html',
  libFlow: null,
  create: { parent: '', name: '', primary: 'pinax.carrier.novel', genre: '', length: null, deliverables: [], running: false, result: null, error: '' },
  genres: [],
  brief: null,
  briefGenre: null,
  impo: { root: '', source: '', plan: null, report: null, running: false, error: '' },
  repair: null,
  libDirs: [],
  dirWork: {},
  write: { chapters: [], listLoading: false, mode: 'read', docPrefs: null },
  sel: { text: '', blockIndex: -1, rect: null, busy: false, preview: null, para: -1 },
  analyze: { open: false, result: null, busy: false, dismissed: {}, activePara: -1, expandOthers: false, fact: null, factRoot: '', factTab: 'emotion' },
  deduce: { premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '',
    mode: 'engine', engine: { busy: false, data: null, pov: '', seed: '', error: '', hint: '' } },
  artifacts: { root: '', groups: [], totals: null, loading: false, error: '', previewFile: '', previewText: '', previewLoading: false },
  // 参考载体（OS-44）：索引 / 当前笔记 / 反链 / 筛选标签
  reference: { loaded: false, loading: false, notes: [], tags: [], tagNotes: {}, stats: null, error: '', activePath: '', activeTag: '', note: null, backlinks: { linked: [], unlinked: [] }, draft: '', view: 'note', q: '', focus: null, absorb: {}, flash: '' },
  // 左内容栏三模块（OS-44）：章节树 / 参考图谱 / 参考摘要
  refCol: { graph: null, graphLoading: false, graphError: '', summary: '', summaryBusy: false, summaryError: '' },
  settings: { userDir: '', section: 'plugins', suiteId: '', open: false, prevView: '', helpOpen: false },
  kbStatus: null,
  tabHidden: {},
  suites: [],
  agent: {
    configured: false,
    endpoint: '',
    model: '',
    apiKeyMasked: '',
    configPath: '',
    runtime: '',
    runtimeList: [],
    notices: [],
    sessions: [],
    sessionId: '',
    items: [],
    streaming: false,
    controller: null,
    cardError: null,
    lastError: null
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

let mdReady = false
loadMd().then(() => { mdReady = true; if (state.view === 'write') render() }).catch(() => {})

const LAYER_LABELS = {
  plot: '剧情',
  character: '人物',
  world: '世界观',
  worldview: '世界观',
  setting: '设定',
  term: '术语',
  item: '物品',
  location: '地点',
  faction: '势力',
  event: '事件',
  relation: '关系',
  concept: '概念',
  rule: '规则'
}

const STATUS_LABELS = {
  draft: '草稿',
  confirmed: '已确认',
  reviewed: '已审',
  archived: '归档'
}

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

function layerLabel(layer) {
  const key = text(layer).trim()
  return LAYER_LABELS[key] ?? (key || '未分层')
}

function statusLabel(status) {
  const key = text(status).trim()
  return STATUS_LABELS[key] ?? key
}

function entrySummary(entry) {
  for (const value of [entry?.summary, entry?.definition, entry?.notes]) {
    const body = text(value).trim()
    if (body) return body
  }
  const events = Array.isArray(entry?.events) ? entry.events : []
  for (const event of events) {
    const body = text(event?.content).trim()
    if (body) return body
  }
  return ''
}

function truncate(value, max = 110) {
  const body = text(value).replace(/\s+/gu, ' ').trim()
  return body.length > max ? `${body.slice(0, max)}…` : body
}

/** 拆解条目的 name 常是「第1章·正文/x.txt·段1」：清单里只显示「第1章 · 段1」，全名留在详情。 */
function entryDisplayName(entry) {
  const raw = text(entry?.name || entry?.id).trim()
  const parts = raw.split('·').map((part) => part.trim()).filter(Boolean)
  if (parts.length >= 2 && /^段\d+$/u.test(parts[parts.length - 1])) {
    return `${parts[0]} · ${parts[parts.length - 1]}`
  }
  return raw
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
  const response = await fetch(path, {
    headers: { 'content-type': 'application/json' },
    ...options
  })
  let payload = null
  try {
    payload = await response.json()
  } catch {
    payload = null
  }
  if (!response.ok || payload?.ok === false) {
    const error = new Error(payload?.error?.message || `请求失败（HTTP ${response.status}）`)
    error.code = payload?.error?.code || ''
    error.details = payload?.error?.details || null
    throw error
  }
  return payload
}

function rememberError(error) {
  state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  state.loading = false
}

/* ---------- 渲染 ---------- */

function render() {
  const current = state.current
  const switchName = document.getElementById('lib-switch-name')
  if (switchName) switchName.textContent = current ? current.name : (state.libraries.length ? '选择库' : '还没有库')
  renderLibSwitchPanel()
  renderTabs()
  // 正文页自己管滚动（页头吸顶＋纸面/右栏各自滚），外层不再滚动
  viewEl.classList.toggle('content-locked', state.view === 'write')
  if (state.view === 'libraries') viewEl.innerHTML = libraryHtml()
  else if (state.view === 'entries') viewEl.innerHTML = state.entry ? entryDetailHtml() : entriesHtml()
  else if (state.view === 'write') {
    viewEl.innerHTML = writeHtml()
    // 版面换了 DOM：批注面板要重挂（否则右栏是空的），标注与吸顶也要重算
    renderAnalyzePanel()
    paintDocAnnotations()
    afterRefColMount()
  }
  else if (state.view === 'reference') {
    viewEl.innerHTML = referencePageHtml()
    // 图谱视图：DOM 就位后挂大画布（聚焦模式）；笔记视图无需画布
    if ((state.reference.view || 'note') === 'graph') mountReferenceGraph()
  }
  else if (state.view === 'wiki') viewEl.innerHTML = wikiHtml()
  else if (state.view === 'lib-create') viewEl.innerHTML = createHtml()
  else if (state.view === 'lib-import') viewEl.innerHTML = importHtml()
  else if (state.view === 'repair') viewEl.innerHTML = repairHtml()
  else if (state.view === 'deduce') viewEl.innerHTML = deduceHtml()
  else if (state.view === 'settings') viewEl.innerHTML = settingsHtml()
  else if (state.view === 'artifacts') viewEl.innerHTML = artifactsHtml()
  else if (state.view?.startsWith('dir:')) viewEl.innerHTML = dirViewHtml(state.view.slice(4))
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
        <p>新建一个库（挑主模块建骨架），或把已有的稿子目录导入进来。库清单与 Pinax 共用。</p>
        <div class="repair-actions" style="justify-content:center">
          <button class="btn-primary" data-action="flow-create">＋新建库</button>
          <button class="btn-ghost" data-action="flow-import">导入稿件</button>
        </div>
        <div class="hint">库清单：${esc(state.preferencesPath || '%LOCALAPPDATA%\\PinaxNext\\next-preferences.json')}</div>
      </div>`
    : `<div class="filter">${filters}</div><div class="cards">${cards}</div>`

  return `<div class="lib-wrap">
    <div class="lib-head-row">
      <h1>库管理</h1><span class="sp"></span>
      <button class="btn-ghost" data-action="flow-import">导入稿件</button>
      <button class="btn-primary" data-action="flow-create">＋新建库</button>
    </div>
    <p class="sub">每个库就是磁盘上的一个文件夹，库清单与 Pinax 同一份。</p>
    ${errorHtml()}
    ${warningsHtml(state.warnings)}
    ${empty}
  </div>`
}

function entriesHtml() {
  if (!state.current) return needLibraryHtml()
  if (state.loading && state.entries.length === 0) return '<div class="loading">正在读取拆解条目…</div>'
  if (state.entries.length === 0) {
    return `<div class="empty-state">
      <h2>这个库还没有拆解条目</h2>
      <p>OpenStory 读的是 <span class="hint">拆解/&lt;bookId&gt;.json</span> 里的 entries；先在 Pinax 里跑一次抽取，或确认库路径。</p>
    </div>`
  }

  const layers = [...new Set(state.entries.map((entry) => text(entry.layer).trim()).filter(Boolean))]
  const layerChips = [`<button class="chip${state.layerFilter === '' ? ' on' : ''}" data-layer="">全部</button>`]
    .concat(layers.map((layer) => `<button class="chip${state.layerFilter === layer ? ' on' : ''}" data-layer="${esc(layer)}">${esc(layerLabel(layer))}</button>`))
    .join('')

  const visible = visibleEntries()
  const rows = visible.map((entry) => `<button class="entry-row" data-entry-id="${esc(entry.id)}">
    <span class="nm">${esc(entryDisplayName(entry))}</span>
    <span class="sm${entrySummary(entry) ? '' : ' empty'}">${esc(truncate(entrySummary(entry)) || '（无摘要）')}</span>
    <span class="ly">${esc(layerLabel(entry.layer))}${entry.status ? ` · ${esc(statusLabel(entry.status))}` : ''}</span>
  </button>`).join('')

  const more = state.entries.length < state.total
    ? `<div class="pager"><span>已显示 ${state.entries.length} / ${state.total}</span><button class="btn-ghost" data-load-more>加载更多</button></div>`
    : `<div class="pager"><span>共 ${state.total} 条</span></div>`

  return `<div class="toolbar">
      <input class="search" id="entry-search" type="search" placeholder="按名称 / 摘要过滤…" value="${esc(state.search)}">
      <span class="sp"></span>
      <span class="count">${state.current.name} · 拆解条目</span>
    </div>
    ${errorHtml()}
    ${warningsHtml(state.entryWarnings)}
    <div class="toolbar">${layerChips}</div>
    <div class="entry-list">${rows || '<div class="loading">没有匹配的条目</div>'}</div>
    ${more}`
}

function visibleEntries() {
  const needle = state.search.trim().toLowerCase()
  return state.entries.filter((entry) => {
    if (state.layerFilter && text(entry.layer) !== state.layerFilter) return false
    if (!needle) return true
    const haystack = [
      entry.name,
      entrySummary(entry),
      Array.isArray(entry.aliases) ? entry.aliases.join(' ') : '',
      entry.bookName
    ].join(' ').toLowerCase()
    return haystack.includes(needle)
  })
}

function entryDetailHtml() {
  const entry = state.entry
  if (!entry) return entriesHtml()
  const summary = entrySummary(entry)
  const aliases = Array.isArray(entry.aliases) ? entry.aliases : []
  const events = Array.isArray(entry.events) ? entry.events : []
  const sources = Array.isArray(entry.sources) ? entry.sources : []
  const identity = entry.identity && typeof entry.identity === 'object' ? Object.entries(entry.identity) : []

  const eventBlocks = events.map((event) => {
    const who = text(event?.who).trim()
    const channel = text(event?.channel).trim()
    const label = [who, channel].filter(Boolean).join(' · ')
    return `<div class="e-sec"><h3>${esc(label || '事件')}</h3><p>${esc(text(event?.content).trim())}</p></div>`
  }).join('')

  const identityBlocks = identity
    .filter(([, value]) => typeof value === 'string' || Array.isArray(value))
    .map(([key, value]) => `<div class="e-sec"><h3>${esc(key)}</h3><p>${esc(Array.isArray(value) ? value.join('、') : value)}</p></div>`)
    .join('')

  return `<div class="toolbar">
      <button class="btn-ghost" data-action="back-entries">← 条目清单</button>
      <span class="sp"></span>
      <span class="count">${esc(layerLabel(entry.layer))}${entry.status ? ` · ${esc(statusLabel(entry.status))}` : ''}</span>
    </div>
    ${errorHtml()}
    <div class="entry-grid">
      <div>
        <h1 class="e-title">${esc(entryDisplayName(entry))}</h1>
        <p class="e-sum">${esc(summary || '（没有摘要）')}</p>
        <div class="e-meta">
          <span class="t">${esc(layerLabel(entry.layer))}</span>
          ${aliases.length ? `<span>触发词 ${esc(aliases.join('、'))}</span>` : ''}
          ${entry.bookName ? `<span>${esc(entry.bookName)}</span>` : ''}
        </div>
        ${entry.definition ? `<div class="e-sec"><h3>定义</h3><p>${esc(entry.definition)}</p></div>` : ''}
        ${identityBlocks}
        ${eventBlocks}
        ${entry.notes ? `<div class="e-sec"><h3>备注</h3><p>${esc(entry.notes)}</p></div>` : ''}
      </div>
      <aside class="e-side">
        <h4>条目信息</h4>
        <div class="kv"><span class="k">id</span><span class="v">${esc(entry.id)}</span></div>
        <div class="kv"><span class="k">名称</span><span class="v">${esc(entry.name || '—')}</span></div>
        <div class="kv"><span class="k">分层</span><span class="v">${esc(layerLabel(entry.layer))}</span></div>
        <div class="kv"><span class="k">状态</span><span class="v">${esc(statusLabel(entry.status) || '—')}</span></div>
        <div class="kv"><span class="k">书</span><span class="v">${esc(entry.bookName || '—')}</span></div>
        <div class="kv"><span class="k">版本</span><span class="v">${esc(state.entryRevision ?? '—')}</span></div>
        <h4>来源 · ${sources.length}</h4>
        ${sources.map((source) => `<div class="kv"><span class="k">文件</span><span class="v">${esc(source?.sourceId || '—')}</span></div>`).join('') || '<div class="kv"><span class="k">文件</span><span class="v">—</span></div>'}
      </aside>
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
  let saved = {}
  try { saved = JSON.parse(localStorage.getItem('openstory-doc-prefs') || '{}') } catch { saved = {} }
  state.write.docPrefs = { ...DOC_PREF_DEFAULTS, ...saved }
  return state.write.docPrefs
}

function applyDocPrefs() {
  const prefs = loadDocPrefs()
  const root = document.documentElement
  root.style.setProperty('--doc-font-size', `${prefs.fontSize}px`)
  root.style.setProperty('--doc-line-height', String(prefs.lineHeight))
  root.style.setProperty('--doc-para-gap', `${prefs.paraGap}em`)
  root.style.setProperty('--doc-indent', `${prefs.indent}em`)
  root.dataset.docAutoGap = prefs.autoGap ? 'on' : 'off'
}

function setDocPref(key, value) {
  const prefs = loadDocPrefs()
  prefs[key] = value
  try { localStorage.setItem('openstory-doc-prefs', JSON.stringify(prefs)) } catch { /* 隐私模式 */ }
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

/**
 * 拉章节清单。OS-22：不整页重绘——只重画左侧章节列表（实时编辑时纸面 DOM 不能被换掉）。
 * 首次进页面（列表为空）才走整页 render 摆 loading。
 */
async function loadWriteChapters({ force = false } = {}) {
  if (!state.current) return
  if (state.write.chapters.length && !force) return
  const firstLoad = state.write.chapters.length === 0
  if (firstLoad) {
    state.write.listLoading = true
    render()
  }
  try {
    const payload = await api(`/api/chapters?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent('正文')}`)
    state.write.chapters = Array.isArray(payload.chapters) ? payload.chapters : []
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  state.write.listLoading = false
  refreshChapterRows()
}

/** 只重画左侧章节行（不动纸面/光标，也不动新建输入框的输入内容）。 */
function refreshChapterRows() {
  const host = document.querySelector('.chapter-rows')
  if (!host) return
  host.innerHTML = chapterRowsHtml(state.write.chapters || [])
}


/* ---------- 沉浸式编辑交互（OS-21）---------- */


/** 版本历史：跳到产物中心并预选该文件的历史（产物中心已有 bak/deleted 归一与恢复）。 */
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
    slider('fontSize', '字号', 14, 24, 1, 'px'),
    slider('lineHeight', '行高', 1.4, 2.6, 0.05, ''),
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
 * 而不是抢占正在聊的主会话。实现＝每库记一个 tempSessionId（localStorage）：
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
    let saved = 'fixed'
    try { saved = text(localStorage.getItem(TEMP_MODE_KEY(root))) || 'fixed' } catch { saved = 'fixed' }
    agent.tempModes[root] = saved === 'current' ? 'current' : 'fixed'
  }
  return agent.tempModes[root]
}

function setTempMode(mode) {
  const root = state.current?.path || ''
  if (!agent.tempModes) agent.tempModes = {}
  agent.tempModes[root] = mode === 'current' ? 'current' : 'fixed'
  try {
    localStorage.setItem(TEMP_MODE_KEY(root), agent.tempModes[root])
  } catch { /* 隐私模式 */ }
}

/** 临时需求路由：fixed 模式先切到固定临时会话，current 模式原地不动。 */
async function routeTemp() {
  if (getTempMode() === 'fixed') await ensureTempSession()
}

function getTempSessionId() {
  const root = state.current?.path || ''
  if (!agent.tempSessions) agent.tempSessions = {}
  if (!(root in agent.tempSessions)) {
    let saved = ''
    try { saved = text(localStorage.getItem(TEMP_SESSION_KEY(root))) } catch { saved = '' }
    agent.tempSessions[root] = saved
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
  try {
    if (id) localStorage.setItem(TEMP_SESSION_KEY(root), id)
    else localStorage.removeItem(TEMP_SESSION_KEY(root))
  } catch { /* 隐私模式 */ }
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
 * fact 曲线数据（OS-41·对齐拆解线）：库内 拆解/ 的章级 序列/情绪/剧情点/事件数。
 * 按 root 缓存；拉不到（无拆解数据/网络失败）＝fact:null，面板降级到本地词典近似层。
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
  await loadCharts()
  loadFactCurve()
  state.analyze.busy = true
  renderAnalyzePanel()
  try {
    const paragraphs = analysisParagraphs()
    state.analyze.result = analysisModule.analyzeChapter(state.chapterText, { paragraphs })
  } catch (error) {
    state.analyze.result = null
    rememberAgentError(error)
  }
  state.analyze.busy = false
  renderAnalyzePanel()
  paintDocAnnotations()
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
function sparkline(values, opts) {
  const options = opts || {}
  const width = options.width || 260
  const height = options.height || 54
  const color = options.color || "var(--accent)"
  const useFill = options.fill !== false
  if (!values.length) return ""
  const max = Math.max.apply(null, values.map((v) => Math.abs(v)).concat([1]))
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => [
    Math.round(index * step),
    Math.round(height / 2 - (value / max) * (height / 2 - 4))
  ])
  const line = points.map((pair, index) => (index === 0 ? "M" : "L") + pair[0] + "," + pair[1]).join(" ")
  const area = useFill
    ? '<path d="' + line + " L" + points[points.length - 1][0] + "," + height / 2 + " L0," + height / 2 + ' Z" fill="' + color + '" opacity=".12"/>'
    : ""
  return '<svg class="spark" viewBox="0 0 ' + width + " " + height + '" preserveAspectRatio="none">' + area + '<path d="' + line + '" fill="none" stroke="' + color + '" stroke-width="1.6"/></svg>'
}

function barRow(factor) {
  const width = Math.min(100, Math.max(0, factor.score))
  return '<div class="bar-row"><span class="bar-label">' + esc(factor.label) + '</span><span class="bar-track"><span class="bar-fill" style="width:' + width + '%"></span></span><span class="bar-score">' + factor.score + '</span><span class="bar-detail">' + esc(factor.detail) + "</span></div>"
}

/**
 * 分析面板（OS-33 重做）。
 *
 * 作者要的体验：「右侧每个具体注释问题，都像向上悬浮吸顶——滚到那个组件的位置时，
 * 自动与左侧有标注的段落平齐」。右栏有 40 条问题时把它们全平铺、再靠滚右栏去对齐，
 * 物理上做不到（内容比视口长，scrollTop 顶到头就没了）。
 *
 * 所以按「聚焦」重排：
 *   · 顶部概览（字数/段/句/对白 + 两张曲线 + AI 味）——位置固定，永远看得见；
 *   · 「本段批注」区＝**当前视口那一段**的问题，永远紧贴概况下面（天然吸顶，条数少）；
 *   · 其下是「全章问题」＋「其它段落的问题」折叠列表，需要时再展开。
 * 这样右栏的内容长度与视口无关，滚动正文时它只是换内容，不会滚丢。
 */
function analyzePanelHtml() {
  const result = state.analyze.result
  if (state.analyze.busy) return '<div class="analyze-body"><div class="loading">正在分析…</div></div>'
  if (!result) {
    return '<div class="analyze-body"><button class="btn-primary" data-action="analyze-run">开始分析本章</button></div>'
  }
  const stats = result.stats

  const rhythmValues = result.rhythm.map((item) => item.chars)
  const openIssues = result.issues.filter((issue) => !state.analyze.dismissed[issue.id])
  // 每条问题可能落在多段（重复用词/套话）：paragraphs 是全集，paragraph 只是首段
  const parasOf = (issue) => {
    const list = Array.isArray(issue.paragraphs) && issue.paragraphs.length
      ? issue.paragraphs
      : [Number(issue.paragraph)]
    return list.filter((n) => Number.isInteger(n) && n >= 0)
  }
  const located = openIssues.filter((issue) => parasOf(issue).length > 0)
  const global = openIssues.filter((issue) => parasOf(issue).length === 0)
  const viewPara = Number.isInteger(state.analyze.activePara) ? state.analyze.activePara : -1
  // 「本段批注」＝离视口最近的有批注的那一段（视口这一段没批注时，退到上/下一段有批注的）
  const issueParas = [...new Set(located.flatMap(parasOf))].sort((a, b) => a - b)
  const pickPara = (() => {
    if (!issueParas.length) return -1
    if (issueParas.includes(viewPara)) return viewPara
    const passed = issueParas.filter((n) => n <= viewPara)
    if (passed.length) return passed[passed.length - 1]
    return issueParas[0]
  })()
  const here = pickPara >= 0 ? located.filter((issue) => parasOf(issue).includes(pickPara)) : []
  // 同一段里同类的重复问题（比如十几个「反复出现」的套话）聚成一条，避免右栏被刷屏
  const groupHere = (list) => {
    const groups = new Map()
    for (const issue of list) {
      const key = `${issue.type || ''}::${(issue.label || '').replace(/「.*」$/u, '')}`
      if (!groups.has(key)) groups.set(key, [])
      groups.get(key).push(issue)
    }
    return [...groups.values()].map((items) => items.length === 1 ? items[0] : {
      merged: true,
      id: items[0].id,
      type: items[0].type,
      severity: items.some((it) => it.severity === 'high') ? 'high' : items[0].severity,
      label: `${items.length} 处${(items[0].label || '').replace(/「.*」$/u, '')}`,
      detail: items.map((it) => it.label.replace(/^.*?「(.*)」$/u, '「$1」')).join(' ')
        + '——都可以换成具体动作，或直接删掉。',
      paragraph: items[0].paragraph,
      paragraphs: items[0].paragraphs,
      items
    })
  }
  const hereShown = groupHere(here)
  const atView = pickPara === viewPara
  const elsewhere = located.filter((issue) => !here.includes(issue))
    .sort((a, b) => (parasOf(a)[0] ?? 0) - (parasOf(b)[0] ?? 0))
  const spanOf = (issue) => {
    const ps = parasOf(issue)
    if (!ps.length) return '全章'
    if (ps.length === 1) return `第 ${ps[0] + 1} 段`
    return `${ps.length} 段`
  }
  const card = (issue) => {
    const ps = parasOf(issue)
    return `<div class="issue-card sev-${esc(issue.severity)}" data-issue-id="${esc(issue.id)}" data-para="${ps[0] ?? ''}">
      <div class="ic-head"><span class="ic-tag">${esc(issue.label)}</span><span class="ic-para">${spanOf(issue)}</span></div>
      <div class="ic-detail">${esc(issue.detail)}</div>
      <div class="ic-ops">
        ${ps.length ? `<button class="issue-act" data-action="analyze-goto" data-paragraph="${ps[0]}">定位</button>` : ''}
        <button class="issue-act" data-action="analyze-fix" data-issue-id="${esc(issue.id)}">让 Agent 改</button>
        <button class="issue-act" data-action="analyze-dismiss" data-issue-id="${esc(issue.id)}">解决</button>
      </div>
    </div>`
  }
  const aiClass = result.aiSmell.score >= 50 ? "bad" : result.aiSmell.score >= 25 ? "mid" : "good"
  const expandOpen = state.analyze.expandOthers === true
  // OS-41 剧情曲线区（对齐拆解线算法）：fact 可用＝章级语义曲线（点峰值跳章）；否则本地词典近似（点段定位）
  const charts = chartsModule
  const fact = state.analyze.fact
  const activeNo = chapterNoFromFile(state.chapterFile)
  let curveSection = ''
  if (charts && fact && (fact.chapters?.length ?? 0) >= 2) {
    const tab = state.analyze.factTab === 'events' ? 'events' : 'emotion'
    const chart = tab === 'events'
      ? charts.renderEventArea(fact.chapters, { activeNo })
      : charts.renderEmotionCurve(fact.chapters, { activeNo })
    const ribbon = charts.renderFunctionRibbon(fact.chapters, { activeNo })
    curveSection = '<section class="analyze-sec"><h4>剧情曲线 <span class="count">fact · ' + esc(fact.title || fact.bookId) +
      ' · ' + fact.chapters.length + ' 章</span></h4>' +
      '<div class="chart-tabs"><button class="chart-tab' + (tab === 'emotion' ? ' on' : '') + '" data-action="analyze-chart" data-tab="emotion">情绪曲线</button>' +
      '<button class="chart-tab' + (tab === 'events' ? ' on' : '') + '" data-action="analyze-chart" data-tab="events">事件密度</button></div>' +
      chart + ribbon +
      '<p class="sub">图上的点/柱/彩带都可以点——跳到对应章；正文切章或滚动，当前章在这里高亮回看。</p></section>'
  } else if (charts) {
    curveSection = '<section class="analyze-sec"><h4>情绪曲线 <span class="count">词典近似 · 低置信</span></h4>' +
      charts.renderLocalCurve(result.emotion, { activePara: viewPara }) +
      '<p class="sub">本库还没有拆解 fact——曲线只是词典近似。跑一次「拆解 → enrich」后，这里会换成语义级剧情曲线：峰值标情绪、可点击跳章。</p></section>'
  }
  // OS-44：面板改为模块化装配——每个分析是一个独立卡片，可在设置里插拔
  const modules = [
    { id: 'plotCurve', html: curveSection },
    { id: 'style', html: `<section class="analyze-sec"><h4>文风</h4>${styleSectionHtml(result)}</section>` },
    { id: 'rhythm', html: `<section class="analyze-sec"><h4>节奏（逐段字数）</h4>${sparkline(rhythmValues, { color: 'var(--ok)' })}</section>` },
    { id: 'aiSmell', html: `<section class="analyze-sec"><h4>AI 味 <b class="ai-score ${aiClass}">${result.aiSmell.score}</b></h4>${result.aiSmell.factors.map(barRow).join('')}</section>` },
    {
      id: 'annotations',
      // 空态（OS-50）：以前只剩一行灰字 + 大片留白（作者截图指出）。现在空态也给信息与出路：
      //   · 说清「这一段干净」还是「还没滚动」，给出全章条数与最近的批注段，可一键跳过去看
      html: '<section class="analyze-sec analyze-here" id="analyze-here">' +
        '<h4>本段批注 <span class="count">' +
        (pickPara < 0 ? '滚动正文即对齐'
          : `第 ${pickPara + 1} 段${atView ? '' : '（最近）'} · ${hereShown.length} 条`) +
        '</span></h4>' +
        (hereShown.length
          ? hereShown.map(card).join('')
          : `<div class="ann-empty">
              <p class="ann-empty-main">${viewPara >= 0 ? `第 ${viewPara + 1} 段没有批注——这一段是干净的。` : '往下滚，这里会跟着你正在看的段落走。'}</p>
              ${issueParas.length
                ? `<p class="ann-empty-sub">本章 ${new Set(issueParas).size} 段有批注，共 ${located.length} 条${global.length ? `（另有 ${global.length} 条章级）` : ''}。</p>
                   <div class="ann-empty-ops">
                     ${issueParas.slice(0, 3).map((n) => `<button class="ann-jump" data-action="analyze-goto" data-paragraph="${n}">跳到第 ${n + 1} 段</button>`).join('')}
                     ${issueParas.length > 3 ? `<span class="ann-more">还有 ${issueParas.length - 3} 段…</span>` : ''}
                   </div>`
                : '<p class="ann-empty-sub">全章暂时没有发现问题。改完再点下面「重新分析」看看。</p>'}
            </div>`) +
        '</section>' +
        (global.length ? '<section class="analyze-sec"><h4>全章 <span class="count">' + global.length + '</span></h4>' + global.map(card).join('') + '</section>' : '') +
        (elsewhere.length
          ? `<section class="analyze-sec"><h4><button class="sec-toggle" data-action="analyze-expand">其它段落 ${elsewhere.length} 条<span class="caret">${expandOpen ? '▾' : '▸'}</span></button></h4>${expandOpen ? elsewhere.map(card).join('') : ''}</section>`
          : '')
    }
  ]
  const hiddenMods = hiddenModules()
  const live = modules.filter((mod) => !hiddenMods.has(mod.id) && mod.html)
  return '<div class="analyze-body">' +
    '<div class="analyze-kpis"><span><b>' + stats.chars + "</b> 字</span><span><b>" + stats.paragraphs +
    "</b> 段</span><span><b>" + stats.avgSentenceLen + "</b> 字/句</span><span><b>" + stats.dialogueRatio +
    "%</b> 对白</span></div>" +
    (result.confidence === "low" ? '<div class="warn-box">本章偏短，指标仅供参考。</div>' : "") +
    live.map((mod) => mod.html).join('') +
    '<div class="ops"><button class="btn-ghost" data-action="analyze-run">重新分析</button></div></div>'
}

/**
 * 文风模块（OS-44）——analysis.mjs 一直算出 style 但从未渲染，这批用起来。
 * 句子长度变异系数（sentenceCv）与段落变异系数（paraCv）是「是否像人写」的两个硬指标：
 * 人写的句子长短参差，模板文则异常整齐。
 */
function styleSectionHtml(result) {
  const style = result?.style
  if (!style) return '<p class="sub">这一章还没有文风数据。</p>'
  const cv = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—')
  const verdict = (value, good, mid) => {
    const num = Number(value)
    if (!Number.isFinite(num)) return ['—', '']
    if (num >= good) return ['参差自然', 'good']
    if (num >= mid) return ['偏整齐', 'mid']
    return ['过于均匀', 'bad']
  }
  const [sentVerdict, sentClass] = verdict(style.sentenceCv, 0.55, 0.35)
  const [paraVerdict, paraClass] = verdict(style.paraCv, 0.5, 0.3)
  const cliches = Array.isArray(style.cliches) ? style.cliches : []
  const connectives = Array.isArray(style.connectives) ? style.connectives : []
  const chip = (item, kind) => `<span class="style-chip ${kind}" title="${esc(item.word)} 出现 ${item.count} 次">${esc(item.word)}<b>${item.count}</b></span>`
  return `<div class="style-grid">
      <div class="style-kpi"><span class="sk-label">句长变异</span><b class="sk-val ${sentClass}">${cv(style.sentenceCv)}</b><span class="sk-note">${sentVerdict}</span></div>
      <div class="style-kpi"><span class="sk-label">段长变异</span><b class="sk-val ${paraClass}">${cv(style.paraCv)}</b><span class="sk-note">${paraVerdict}</span></div>
    </div>
    ${cliches.length ? `<div class="style-block"><h5>套话 <span class="count">${cliches.length}</span></h5><div class="style-chips">${cliches.slice(0, 10).map((item) => chip(item, 'cliche')).join('')}</div></div>` : ''}
    ${connectives.length ? `<div class="style-block"><h5>连接词 <span class="count">${connectiveCount(connectives)}</span></h5><div class="style-chips">${connectives.slice(0, 10).map((item) => chip(item, 'connective')).join('')}</div></div>` : ''}
    ${!cliches.length && !connectives.length ? '<p class="sub">没检出套话与连接词堆砌——文风干净。</p>' : ''}`
}

function connectiveCount(list) {
  return (Array.isArray(list) ? list : []).reduce((sum, item) => sum + (Number(item.count) || 0), 0)
}

function renderAnalyzePanel() {
  const panel = document.getElementById("analyze-panel")
  if (!panel) return
  const open = state.analyze.open && state.chapterLoaded
  panel.classList.toggle("open", open)
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
  await loadSuites() // 写作套件的默认标题要新鲜
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
        <p>左侧点章节载入；或输入标题新建一章（自动编号）。章节就是 <span class="hint">正文/NNN-标题.md</span> 文件，Pinax 里同样可见。</p>
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
        <button class="doc-drawer-btn" data-action="refcol-toggle" title="参考资料" aria-label="参考资料">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6h11M2.5 10h11" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="doc-drawer-btn" data-action="analyze-toggle" title="分析本章" aria-label="分析本章">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.6A5.4 5.4 0 0 1 13.4 8H8z" fill="currentColor"/></svg>
        </button>
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

function wikiHtml() {
  if (!state.current) return needLibraryHtml()
  if (state.loading && !state.wikiLoaded) return '<div class="loading">正在读取 wiki…</div>'

  const bookOptions = state.books
    .map((book) => `<option value="${esc(book.bookId)}"${book.bookId === state.bookId ? ' selected' : ''}>${esc(book.bookName || book.bookId)}（${book.count} 条）</option>`)
    .join('')

  const modeTabs = `<span class="subtabs">
      <button class="chip${state.wikiMode === 'html' ? ' on' : ''}" data-wiki-mode="html" title="派生 HTML，沙箱 iframe 装载">网页</button>
      <button class="chip${state.wikiMode === 'data' ? ' on' : ''}" data-wiki-mode="data" title="JSON 卡片视图（对照）">数据</button>
    </span>`

  if (!state.wiki) {
    return `<div class="toolbar">
        ${bookOptions ? `<select class="select" id="wiki-book">${bookOptions}</select>` : '<span class="count">没有可派生的书</span>'}
        <span class="sp"></span>
        <button class="btn-primary" data-action="derive-wiki"${state.loading || !state.bookId ? ' disabled' : ''}>派生 wiki</button>
      </div>
      ${errorHtml()}
      <div class="empty-state">
        <h2>这本书还没有 wiki</h2>
        <p>wiki 是零模型纯计算派生，随时可重建；派生结果落在 <span class="hint">拆解/&lt;bookId&gt;.wiki.json</span>。派生后「网页」态以沙箱 HTML 呈现。</p>
      </div>`
  }

  const toolbar = `<div class="toolbar">
      ${bookOptions ? `<select class="select" id="wiki-book">${bookOptions}</select>` : ''}
      ${modeTabs}
      <span class="sp"></span>
      <span class="count">派生自 fact revision ${esc(state.wikiFrom?.factRevision ?? '—')}</span>
      <button class="btn-ghost" data-action="derive-wiki"${state.loading ? ' disabled' : ''}>重新派生</button>
    </div>`

  return `${toolbar}${errorHtml()}${state.wikiMode === 'html' ? wikiFrameHtml() : wikiDataHtml()}`
}

/** 网页态：daemon 现渲的独立 HTML，沙箱 iframe 装载；强调色取当前风格包。 */
function wikiFrameHtml() {
  const pack = currentPack()
  const params = new URLSearchParams({
    root: state.current.path,
    bookId: state.bookId,
    accent: pack?.tokens?.['--accent'] || '#ff385c',
    bg: pack?.tokens?.['--bg'] || '#ffffff',
    ink: pack?.tokens?.['--ink'] || '#222222'
  })
  return `<iframe class="wiki-frame" sandbox src="/api/wiki/html?${params.toString()}" title="wiki 派生网页"></iframe>`
}

/** 数据态（对照）：JSON 卡片视图，OS-3 老渲染保留。 */
function wikiDataHtml() {
  const wiki = state.wiki
  const book = wiki.book ?? {}
  const characters = Array.isArray(wiki.characters) ? wiki.characters : []
  const chapters = Array.isArray(wiki.chapters) ? wiki.chapters : []
  const terms = Array.isArray(wiki.terms) ? wiki.terms : []

  const characterCards = characters.map((character) => {
    const detail = [character.identity, character.archetype, character.summary]
      .map((value) => text(value).trim())
      .filter(Boolean)
      .join(' · ')
    return `<div class="wiki-card"><b>${esc(character.name)}</b><span class="sub">${esc(detail || '（无画像）')}${character.appearances ? ` · 出现 ${esc(character.appearances)} 次` : ''}</span></div>`
  }).join('')

  const chapterLines = chapters.map((chapter) => `<div class="wiki-line">
      <span class="no">${esc(chapter.no ?? '—')}</span>
      <span class="tt">${esc(chapter.title || `第 ${chapter.no} 章`)}${chapter.summary ? ` · ${esc(truncate(chapter.summary, 80))}` : ''}</span>
    </div>`).join('')

  const termCards = terms.map((term) => `<div class="wiki-card"><b>${esc(term.name || term.term || '—')}</b><span class="sub">${esc(truncate(term.summary || term.definition || '', 80) || '—')}</span></div>`).join('')

  return `<div class="wiki-wrap">
      <div class="wiki-head">
        <h2>${esc(book.title || state.current.name)}</h2>
        <div class="meta">
          ${book.author ? `<span>作者 ${esc(book.author)}</span>` : ''}
          ${book.group ? `<span>${esc(book.group)}</span>` : ''}
          <span>${chapters.length} 章</span>
          <span>${characters.length} 人</span>
          <span>${terms.length} 术语</span>
        </div>
      </div>
      <section class="wiki-section"><h3>人物 · ${characters.length}</h3><div class="wiki-cards">${characterCards || '<span class="count">没有人物条目</span>'}</div></section>
      <section class="wiki-section"><h3>章节 · ${chapters.length}</h3>${chapterLines || '<span class="count">没有章节</span>'}</section>
      ${termCards ? `<section class="wiki-section"><h3>术语 · ${terms.length}</h3><div class="wiki-cards">${termCards}</div></section>` : ''}
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
  const detail = kit ? kit.name : (agent.model || agent.endpoint || '')
  if (!detail) {
    chip.hidden = true
    chip.textContent = ''
    chip.className = 'agent-model'
    chip.title = ''
    return
  }
  chip.hidden = false
  chip.textContent = detail
  chip.classList.toggle('on', Boolean(kit) || agent.configured)
  chip.title = kit
    ? `运行时套件：${kit.name}（${kit.source}）${agent.model ? `\n模型：${agent.model}` : ''}`
    : `端点：${agent.endpoint}${agent.apiKeyMasked ? `\nkey：${agent.apiKeyMasked}（完整 key 不回显）` : ''}`
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
  const polish = agent.pendingContext?.kind === 'polish'
  const modeChip = document.getElementById('agent-mode-chip')
  if (modeChip) modeChip.textContent = polish ? '润笔' : '对话'
  input.placeholder = !state.current
    ? '先选一个库，再和 Agent 聊…'
    : !agent.configured
      ? '先点右上角「设置」配置模型端点…'
      : polish
        ? '补一句润笔要求（如：更冷峻、去掉形容词），回车发给 Agent'
        : '问问剧情、要一段正文…（Enter 发送，Shift+Enter 换行）'
  if (libChip) libChip.textContent = state.current ? state.current.name : '未选库'
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
  try {
    // 临时会话不进「上次会话」槽：它由 TEMP_SESSION_KEY 单独记
    if (id && !isTempSession(id)) localStorage.setItem(AGENT_SESSION_KEY(root), id)
    else if (!id) localStorage.removeItem(AGENT_SESSION_KEY(root))
  } catch { /* 隐私模式 */ }
}

function recallSession() {
  const root = state.current?.path || ''
  try { return localStorage.getItem(AGENT_SESSION_KEY(root)) || '' } catch { return '' }
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
 * 打开库之后恢复上次会话（OS-39）：优先 localStorage 记的那条，
 * 它没了就退到服务端最新的那条（换机器/清了 localStorage 也能接上）。
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
function sessionTitle(session, index) {
  const raw = text(session.title).trim()
  const broken = !raw || raw.includes('\uFFFD') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(raw)
  if (!broken) return { label: raw, broken: false }
  const at = text(session.createdAt)
  const stamp = at ? formatAt(at) : ''
  return { label: `会话${index !== undefined ? ` ${index + 1}` : ''}${stamp ? ` · ${stamp}` : ''}`, broken: true }
}

function sessionsHtml() {
  const pinnedId = getTempSessionId()
  const mode = getTempMode()
  // 模式切换（OS-39b）：fixed＝推荐默认，每次添加都切到固定会话；current＝跟当前会话走
  const modeSwitch = `<div class="sess-mode">
      <span class="sm-label">临时需求去哪</span>
      <button class="mode-opt${mode === 'fixed' ? ' on' : ''}" data-action="temp-mode" data-mode="fixed">固定会话（推荐）</button>
      <button class="mode-opt${mode === 'current' ? ' on' : ''}" data-action="temp-mode" data-mode="current">当前会话</button>
    </div>`
  const fixedName = agent.sessions.find((session) => session.id === pinnedId)?.title || '临时需求'
  const hint = mode === 'fixed'
    ? `<div class="sess-hint">润笔/添加到 Agent 都会切到「${esc(fixedName)}」发送，不打断你正在聊的这条；点行上的「设临」可换一条。</div>`
    : `<div class="sess-hint">临时需求会发到你当前打开的会话（不切换）。</div>`
  if (!agent.sessions.length) {
    return `${modeSwitch}${hint}<div class="empty">还没有会话。<br>发第一条消息就会自动建。</div>
      <div class="divider"></div>
      <button class="new" data-action="agent-new-session">＋新会话</button>`
  }
  const rows = agent.sessions.map((session, index) => {
    const title = sessionTitle(session, index)
    // 空会话不摆「0」——只有真聊过才标条数
    const meta = Number.isFinite(session.messageCount) && session.messageCount > 0 ? `${session.messageCount}` : ''
    const isTemp = mode === 'fixed' && session.id === getTempSessionId()
    return `<div class="sess${session.id === agent.sessionId ? ' on' : ''}" data-session-id="${esc(session.id)}" title="${esc(title.label)}${title.broken ? '（历史标题编码损坏，双击重命名）' : '（双击重命名）'}">
      <span class="tt">${esc(title.label)}</span>
      ${meta ? `<span class="meta">${meta} 条</span>` : ''}
      <button class="pin${isTemp ? ' on' : ''}" data-action="session-pin" data-session-id="${esc(session.id)}" title="${isTemp ? '临时需求固定走这条（点一下取消）' : '把这条设为默认临时会话（润笔/分析都走它）'}">${isTemp ? '临时' : '设临'}</button>
      <button class="x" data-session-del="${esc(session.id)}" title="删除会话">×</button>
    </div>`
  }).join('')
  return `${modeSwitch}${hint}${rows}<div class="divider"></div>
    <button class="new" data-action="agent-new-session" title="开始一段新对话">＋新会话</button>`
}

/** 当前会话一行：下拉收起时也能看出在聊哪条（含损坏标题的标记）。 */
function renderAgentCurrent() {
  const host = document.getElementById('agent-current')
  if (!host) return
  if (!agent.sessionId) { host.innerHTML = ''; return }
  const index = agent.sessions.findIndex((session) => session.id === agent.sessionId)
  const session = agent.sessions[index]
  const title = session ? sessionTitle(session, index) : { label: '未落档的新会话', broken: false }
  host.innerHTML = `<span>当前</span><span class="tt${title.broken ? ' bad' : ''}">${esc(title.label)}</span>`
}

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
function processBlockHtml(proc, { live = false } = {}) {
  if (!proc) return ''
  const thinking = text(proc.thinking).trim()
  const tools = Array.isArray(proc.tools) ? proc.tools : []
  if (!thinking && !tools.length) return ''
  const toolCount = tools.length
  const sec = proc.elapsedMs ? (proc.elapsedMs / 1000).toFixed(1) : ''
  const metaParts = [sec ? `${sec}s` : '', toolCount ? `${toolCount} 次工具` : ''].filter(Boolean)
  const label = live ? '思考中' : '思考过程'
  const toolRows = tools.map(toolRowHtml).join('')
  return `<details class="proc-block${live ? ' live' : ''}"${live ? ' open' : ''}>
    <summary>
      <span class="proc-label"><i class="proc-dot"></i>${esc(label)}</span>
      ${metaParts.length ? `<span class="proc-meta">${esc(metaParts.join(' · '))}</span>` : ''}
      <span class="proc-chev">›</span>
    </summary>
    <div class="proc-body">
      ${thinking ? `<div class="proc-think">${esc(thinking)}</div>` : ''}
      ${toolRows}
    </div>
  </details>`
}

/** 工具名的图标与说明（OS-43）：让作者一眼看出「它在干什么」。 */
const TOOL_META = Object.freeze({
  read: { icon: '👁', note: '读文件' },
  read_file: { icon: '👁', note: '读文件' },
  write: { icon: '✎', note: '写文件' },
  write_file: { icon: '✎', note: '写文件' },
  create_file: { icon: '✎', note: '新建文件' },
  edit: { icon: '✐', note: '改文件' },
  str_replace_edit: { icon: '✐', note: '改文件' },
  str_replace_editor: { icon: '✐', note: '改文件' },
  glob: { icon: '🗂', note: '列目录' },
  list_files: { icon: '🗂', note: '列目录' },
  grep: { icon: '🔍', note: '搜内容' },
  search: { icon: '🔍', note: '搜内容' },
  web_search: { icon: '🌐', note: '联网搜索' },
  web_fetch: { icon: '🌐', note: '抓网页' },
  fetch: { icon: '🌐', note: '抓网页' },
  bash: { icon: '▶', note: '跑命令' },
  pwsh: { icon: '▶', note: '跑命令' },
  shell: { icon: '▶', note: '跑命令' },
  subagent: { icon: '⑂', note: '派子任务' },
  task: { icon: '⑂', note: '派子任务' },
  todo_write: { icon: '☑', note: '列待办' }
})

function toolMeta(name) {
  const raw = text(name)
  return TOOL_META[raw.toLowerCase()] || { icon: '●', note: raw || '工具' }
}

/**
 * 工具行（OS-43）：图标＋动词＋对象＋耗时，让「它调了什么工具」有可辨识的形状。
 * 之前只有一行灰字，看不出读/写/搜/跑的区别。
 */
function toolRowHtml(tool) {
  const meta = toolMeta(tool.name)
  const verb = toolVerb(tool.name)
  const target = toolTarget(tool)
  const took = tool.elapsedMs ? `${(tool.elapsedMs / 1000).toFixed(1)}s` : ''
  const cls = tool.isError ? 'tool-row fail' : 'tool-row'
  return `<div class="${cls}">
    <span class="tool-icon" title="${esc(meta.note)}">${esc(meta.icon)}</span>
    <span class="tool-verb">${esc(verb)}</span>
    ${target ? `<code class="tool-target">${esc(target)}</code>` : ''}
    ${took ? `<span class="tool-took">${esc(took)}</span>` : ''}
    ${tool.isError ? '<span class="tool-fail">失败</span>' : ''}
  </div>`
}

/** 工具名 → 中文动词（照 OD 的词表口径）。 */
function toolVerb(name) {
  const raw = text(name)
  const lower = raw.toLowerCase()
  if (lower === 'read' || lower === 'read_file') return '读取'
  if (lower === 'write' || lower === 'write_file' || lower === 'create_file') return '新建'
  if (lower === 'edit' || lower === 'str_replace_edit' || lower === 'str_replace_editor') return '改写'
  if (lower === 'grep' || lower === 'search' || lower === 'web_search') return '搜索'
  if (lower === 'glob' || lower === 'list_files') return '列出'
  if (lower === 'bash' || lower === 'pwsh' || lower === 'shell') return '执行'
  if (lower === 'subagent' || lower === 'task') return '子任务'
  if (lower === 'web_fetch' || lower === 'fetch') return '抓取'
  if (lower === 'todo_write') return '待办'
  return raw || '工具'
}

/** 工具调用里的「对象」：优先文件路径/命令/查询词，取不到就不显示。 */
function toolTarget(tool) {
  const input = tool.input
  if (!input || typeof input !== 'object') return ''
  const candidate = input.file_path || input.path || input.file || input.command || input.pattern || input.query || input.prompt || ''
  const raw = text(candidate).trim()
  if (!raw) return ''
  return raw.length > 48 ? `…${raw.slice(-46)}` : raw
}

/**
 * 正文产出框（OS-43）：作者要的「md 框封装 + 自带复制」。
 * 模型按系统提示用 ``` 包起可采纳的正文，但这不该渲染成灰色代码块（那是给代码看的），
 * 而应该是一个「这是正文」的容器：正常小说排版 + 右上角复制。
 * 判定同 proposedFiles：有文件路径 + 有够长的代码块。
 */
function proseOutputHtml(raw, files) {
  if (!files.length) return null
  const match = raw.match(/```[^\n]*\n([\s\S]*?)```/u)
  if (!match) return null
  const body = match[1].trim()
  if (body.replace(/\s/gu, '').length < 80) return null
  // 正文按小说排版渲染（不转义换行，保留段落）
  const paragraphs = body.split(/\n{2,}/u).map((block) => block.trim()).filter(Boolean)
  const rendered = paragraphs.length > 1
    ? paragraphs.map((block) => `<p>${esc(block)}</p>`).join('')
    : `<p>${esc(body)}</p>`
  return `<div class="prose-out">
    <div class="prose-out-head">
      <span class="po-label">正文</span>
      <code class="po-file">${esc(files[0])}</code>
      <button class="po-copy" data-action="copy-text" data-copy-target="po-${esc(files[0].replace(/[^\w]/gu, '_'))}" title="复制这段正文">复制</button>
    </div>
    <div class="prose-out-body" id="po-${esc(files[0].replace(/[^\w]/gu, '_'))}">${rendered}</div>
  </div>`
}

/**
 * 助手正文（OS-43）：无框沉浸式 + Markdown 渲染。
 * 参考 OpenDesign：助手消息没有气泡底色/边框，正文直接落在页面背景上，只有用户消息是气泡。
 * Markdown 走自研 md.mjs（已支持标题/引用/列表/表格/代码/hr/图片/任务列表）。
 */
function assistantBodyHtml(item, streamingThis, files = []) {
  const raw = text(item.content)
  if (!raw) return ''
  // 流式时不渲染 markdown（半截表格/代码块会闪），出完再渲染；这也是 OD 的做法
  if (streamingThis) return `<div class="prose-block streaming">${esc(raw)}</div>`
  // 有正文产出：把那段代码块换成「正文框」
  const output = proseOutputHtml(raw, files)
  if (output) {
    // 把原代码块从 markdown 里摘掉，避免渲染两遍
    const rest = raw.replace(/```[^\n]*\n[\s\S]*?```/u, '')
    const restHtml = (mdReady && mdModule && rest.trim()) ? mdModule.renderMarkdown(rest.trim()) : (rest.trim() ? `<p>${esc(rest.trim())}</p>` : '')
    return `${restHtml ? `<div class="prose-block">${restHtml}</div>` : ''}${output}`
  }
  if (!mdReady || !mdModule) return `<div class="prose-block">${esc(raw)}</div>`
  try {
    return `<div class="prose-block">${mdModule.renderMarkdown(raw)}</div>`
  } catch {
    return `<div class="prose-block">${esc(raw)}</div>`
  }
}

/**
 * 这段回复里是否真的产出了「可采纳的正文」。
 * 只有「有东西可落」时才给采纳入口——每条都摆一个按钮是错的：
 *  - 一句「你好」没有文件可写
 *  - 一段「目录下有这些文件」只是提及
 *  - 一段「统计方法是……」只是说明
 * 判定（照 Pinax/DW 口径，宁可少给也不误给）：
 *    ① 明确点名了正文文件路径（正文/xxx.md 或 NNN-标题.md）
 *    ② 且回复里有**被明确界定为正文的整段文字**——下面两种形态任选：
 *       a) 代码块（```…```）：最常见，作者可以直接整块复制
 *       b) 引用块（> …）连续 ≥3 行：也是一种「这段是给你抄的」的写法
 *    光有「长段落」不够：统计说明、目录清单也长，但那不是正文。
 */
function proposedFiles(item) {
  const raw = text(item.content)
  if (!raw) return []
  const files = new Set()
  for (const match of raw.matchAll(/(?:正文[\\/])?([0-9]{3}[-_—][^\s`'"）)]+\.md)/gu)) {
    files.add(`正文/${match[1]}`)
  }
  for (const match of raw.matchAll(/(正文[\\/][^\s`'"）)]+\.md)/gu)) {
    files.add(match[1].replaceAll('\\', '/'))
  }
  if (!files.size) return []
  // a) 代码块里至少有 80 字（去掉围栏行）
  const fences = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map((match) => match[1].trim())
  if (fences.some((block) => block.replace(/\s/gu, '').length >= 80)) return [...files]
  // b) 连续引用块 ≥3 行且合计 ≥80 字
  const quoteLines = raw.split('\n').filter((line) => /^\s*>\s?\S/u.test(line))
  if (quoteLines.length >= 3 && quoteLines.join('').replace(/[\s>]/gu, '').length >= 80) return [...files]
  return []
}

/**
 * 生效标注（OS-43）：这轮用了什么。
 * 作者要能看出「AI 手里有什么武器」——技能、体裁策略、知识库、中文推理，各自一个图标＋一句话。
 */
function appliedChipsHtml(applied) {
  if (!applied) return ''
  const chips = []
  const skills = Array.isArray(applied.craftSkills) ? applied.craftSkills : []
  if (skills.length) {
    const names = skills.map((skill) => skill.name).join('、')
    chips.push(`<span class="ap-chip" title="${esc(skills.map((skill) => `${skill.name}：${skill.description}`).join('\n'))}"><i>✦</i>技法 ${skills.length} 项<span class="ap-more">${esc(names.slice(0, 40))}${names.length > 40 ? '…' : ''}</span></span>`)
  }
  if (applied.brief) {
    chips.push(`<span class="ap-chip" title="项目简报里的体裁/篇幅/分章约束已注入提示词"><i>▤</i>体裁${applied.genre ? ` · ${esc(applied.genre)}` : ''}</span>`)
  }
  if (applied.kb) {
    chips.push(`<span class="ap-chip" title="同题材先例（案例库/套路库）已检索并注入"><i>◈</i>知识库先例</span>`)
  }
  if (applied.canReadFiles) {
    chips.push(`<span class="ap-chip" title="可以读这个库里的文件，但改正文要走待确认"><i>⌸</i>可读库文件</span>`)
  }
  if (applied.chineseReasoning) {
    chips.push(`<span class="ap-chip" title="推理过程用中文（可在设置里关）"><i>文</i>中文推理</span>`)
  }
  return chips.length ? `<div class="ap-chips">${chips.join('')}</div>` : ''
}

function msgHtml(item, index) {
  if (item.role === 'user') return `<div class="bub user">${esc(item.content)}</div>`
  const streamingThis = agent.streaming && index === agent.items.length - 1
  const cursor = streamingThis ? '<span class="cursor"></span>' : ''
  // 过程块：流式时展开（活），结束后收起成「思考过程 · 12.3s · 2 次工具」
  const proc = item.process
  const processBlock = proc ? processBlockHtml(proc, { live: streamingThis && !item.content }) : ''
  // 状态行只在「还没有任何过程、也没出正文」时显示——一句话，不刷屏
  const sec = item.waiting || 0
  const idleLine = streamingThis && !item.content && !processBlock && sec
    ? `<span class="act"><i class="act-dot"></i>${item.activity === 'thinking' ? '思考中' : '准备中'}… ${sec}s</span>`
    : ''
  const truncated = item.truncated
    ? '<span class="partial-tag">回答被模型长度上限截断——可以让我接着写完</span>'
    : ''
  const partial = item.partial
    ? '<span class="partial-tag">已停止——这段是不完整回答，以服务器落档为准</span>'
    : ''
  const files = streamingThis ? [] : proposedFiles(item)
  const body = assistantBodyHtml(item, streamingThis, files)
  // 底部条：复制常驻；「采纳」只在真有产出时出现（OS-43，照 Pinax/DW 的口径）
  const copyBtn = item.content
    ? `<button class="msg-act" data-action="msg-copy" data-msg-index="${index}" title="复制这段回复">复制</button>`
    : ''
  const adoptBtn = files.length
    ? `<button class="msg-act primary" data-action="card-from" data-msg-index="${index}" title="把这段写进 ${esc(files[0])}">采纳</button>`
    : ''
  const foot = (copyBtn || adoptBtn)
    ? `<div class="msg-foot">${adoptBtn}${copyBtn}</div>`
    : ''
  const appliedChips = appliedChipsHtml(item.applied)
  return `<div class="msg assistant">${idleLine}${processBlock}${body}${cursor}${truncated}${partial}${appliedChips}${foot}</div>`
}

/**
 * 待确认卡（OS-43 对齐 Pinax/DW 口径）：
 * 只有真动了文件才出现；按钮说「采纳 / 驳回」，不说「采纳写入 / 拒绝」。
 * 采纳后原地变绿药丸「已采纳 · 写入 <文件>」，驳回变灰「已驳回」。
 */
function cardHtml(item) {
  const open = item.state === 'open'
  const snapshotNote = item.snapshot?.exists ? `创建时 ${item.snapshot.chars} 字` : '创建时是新文件'
  const ops = open
    ? `<div class="ops">
        <button class="btn-primary" data-action="card-adopt" data-card-id="${esc(item.id)}">采纳</button>
        <button class="btn-ghost" data-action="card-reject" data-card-id="${esc(item.id)}">驳回</button>
        <span class="count">采纳＝写「${esc(item.file)}」· ${esc(snapshotNote)}</span>
      </div>`
    : `<div class="ops">
        <span class="state-chip${item.state === 'adopted' ? ' ok' : ' dead'}">${item.state === 'adopted' ? '已采纳' : '已驳回'}</span>
        ${item.state === 'adopted' ? `<span class="count">写入「${esc(item.file)}」</span>` : ''}
        ${item.backup ? `<span class="count">上一版备份：${esc(item.backup)}</span>` : ''}
      </div>`
  const revError = agent.cardError?.cardId === item.id ? `<div class="rev-error">${esc(agent.cardError.message)}</div>` : ''
  return `<div class="card-block">
    <div class="head"><b>待确认</b><span class="file">${esc(item.file)}</span></div>
    <div class="body">${esc(item.text)}</div>
    ${item.note ? `<div class="note">备注：${esc(item.note)}</div>` : ''}
    ${ops}${revError}
  </div>`
}

function threadHtml() {
  if (!state.current) {
    return `<div class="agent-empty"><strong>先选一个库</strong>点右上角「库」切换器选一个库，Agent 就绑定到那个库。</div>`
  }
  if (agent.items.length === 0) {
    return `<div class="agent-empty"><strong>问剧情、要一段正文、改设定…</strong>回答可以转成「待确认卡」，采纳后才真正写进正文文件。</div>`
  }
  // 过程行（kind==='process'）挂到相邻的 assistant 消息上——它是那一轮的过程留痕，
  // 不要再单独摆一块，否则对话流被切成两半。落档时 process 一定在 assistant 之前，
  // 但老数据可能反序，所以两边都认。
  const items = []
  for (let i = 0; i < agent.items.length; i += 1) {
    const item = agent.items[i]
    if (item.kind === 'process') continue
    if (item.kind === 'card') { items.push(cardHtml(item)); continue }
    let merged = item
    if (item.kind === 'msg' && item.role === 'assistant') {
      const before = agent.items[i - 1]
      const after = agent.items[i + 1]
      const proc = before?.kind === 'process' ? before : (after?.kind === 'process' ? after : null)
      if (proc) merged = { ...item, process: proc }
    }
    items.push(msgHtml(merged, i))
  }
  return items.join('')
}

function renderThread() {
  const thread = document.getElementById('agent-thread')
  if (!thread) return
  const follow = thread.scrollHeight - thread.scrollTop <= thread.clientHeight + 60
  const notices = agent.notices.slice(-3).map((noticeText) => `<div class="thread-notice">${esc(noticeText)}</div>`).join('')
  thread.innerHTML = threadHtml()
    + notices
    + (agent.lastError ? `<div class="error-box">${esc(agent.lastError)}</div>` : '')
  if (follow) thread.scrollTop = thread.scrollHeight
}

function renderContextChip() {
  const host = document.getElementById('agent-context')
  if (!host) return
  const ctx = state.agent.pendingContext
  if (!ctx) { host.innerHTML = ''; return }
  host.innerHTML = `<div class="ctx-chip">
    <span class="ctx-label">上下文</span>
    <span class="ctx-text" title="${esc(ctx.context)}">${esc(ctx.label)}</span>
    <button class="ctx-x" data-action="clear-agent-context" title="移除上下文">×</button>
  </div>`
}

function renderAgent() {
  renderContextChip()
  renderAgentCurrent()
  const strip = document.getElementById('agent-sess-panel')
  if (strip) strip.innerHTML = sessionsHtml()
  const count = document.getElementById('agent-sess-count')
  if (count) count.textContent = String(agent.sessions.length)
  renderThread()
  updateComposerState()
  updateAgentChip()
}

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
  const head = polish ? '【润笔请求】' : '【选中段落】'
  const askTag = polish ? '【作者要求】' : '【我的问题】'
  const content = ctx
    ? `${head}\n${ctx.quote}\n\n【所在段落上下文】\n${ctx.context}${typed ? `\n\n${askTag}\n${typed}` : ''}`
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
  const ensureProcess = (last) => {
    if (!last.process) last.process = { thinking: '', tools: [], startedAt }
    return last.process
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
          proc.thinking += piece
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

const SETTINGS_SECTIONS = Object.freeze([
  { id: 'plugins', label: '插件', hint: '套件与 Agent 运行时' },
  { id: 'modules', label: '工作台模块', hint: '左栏与右栏的分析模块插拔' },
  { id: 'discover', label: '发现与导入', hint: '货架路径与导入稿件' },
  { id: 'data', label: '数据与目录', hint: '库清单与配置位置' },
  { id: 'kb', label: '知识库', hint: 'WeKnora 连接与健康' },
  { id: 'about', label: '关于', hint: '这台工作台是什么' }
])

/**
 * 工作台模块清单（OS-44）：左栏三个 + 右栏分析模块。
 * 作者口径：所有模块都可以在设置里插拔开关自定义。
 */
const WORKBENCH_MODULES = Object.freeze([
  { id: 'chapters', label: '章节树', slot: '左栏', hint: '卷/章两级，写小说时随手切章' },
  { id: 'graph', label: '参考图谱', slot: '左栏', hint: '参考与章节/条目的关系图' },
  { id: 'summary', label: '参考摘要', slot: '左栏', hint: 'AI 基于图谱总结本章要点' },
  { id: 'plotCurve', label: '剧情曲线', slot: '右栏', hint: '情绪曲线 / 事件密度（需拆解 fact）' },
  { id: 'style', label: '文风分析', slot: '右栏', hint: '句长/段长变异系数 + 套话与连接词' },
  { id: 'rhythm', label: '节奏', slot: '右栏', hint: '逐段字数起伏' },
  { id: 'aiSmell', label: 'AI 味', slot: '右栏', hint: '四因子加权评分' },
  { id: 'annotations', label: '本段批注', slot: '右栏', hint: '跟着正文滚动对齐的问题卡' }
])

/** 工作台模块插拔（设置页）。 */
function settingsModulesSectionHtml() {
  const hidden = hiddenModules()
  const groups = ['左栏', '右栏']
  const rows = groups.map((slot) => {
    const items = WORKBENCH_MODULES.filter((mod) => mod.slot === slot)
    if (!items.length) return ''
    return `<div class="step"><h3>${esc(slot)}</h3>
      <div class="mod-list">${items.map((mod) => {
        const on = !hidden.has(mod.id)
        return `<div class="mod-row">
          <label class="mod-main">
            <input type="checkbox" data-action="module-toggle" data-module-id="${esc(mod.id)}"${on ? ' checked' : ''}>
            <span><b>${esc(mod.label)}</b><i>${esc(mod.hint)}</i></span>
          </label>
        </div>`
      }).join('')}</div>
      <p class="sub">${slot === '左栏' ? '三个都关掉，左栏整体收起来，正文更宽。' : '关掉的模块不再出现在分析面板里，其余照常。'}</p>
    </div>`
  }).join('')
  return `${rows}<div class="step"><h3>当前库</h3><p class="sub">${state.current ? esc(state.current.name) : '还没选库'}——模块开关按库分别记，换库不串。</p></div>`
}

/**
 * 每个分节的一段自然语言说明——只说「这对你意味着什么」，不写实现细节。
 * 平时收起，点右上角「!」才展开（作者口径：呈现要干净，说明要对人话）。
 */
const SETTINGS_HELP = Object.freeze({
  plugins: '插件分成两类：一类给写作能力（比如写作套件、编剧套件），一类给 Agent 一条能对话的模型通道。它们都可以随时启用或停用，停用只是让效果回到默认，你设过的值不会丢。点「设置 →」进各自的设置页。',
  discover: '插件不用安装：往本机的这几个文件夹里丢一个目录或一个 JSON 文件，刷新就出现在列表里。同名时你本机放的那份优先，内置的退到后面。文件坏掉只会跳过它，不会影响别的。',
  data: '你的稿子始终是磁盘上的文件夹，这个工作台不另建数据库，删掉这个软件稿子也还在。下面是各项配置存在哪儿——都只在这台机器上。',
  kb: '知识库给 Agent 供弹药：技法配方、文风指纹、题材套路、读者信号、同型案例分库存放。写东西时 Agent 会自动取用，这里只看连接是否健康、每个库装了多少，不用做任何操作。',
  about: 'OpenStory 是给写小说用的工作台。它和 Pinax 桌面版看的是同一批库文件：两个入口，一份稿子，改哪边都算数。所有数据、密钥、会话都只留在本机，不上传也不联网同步。',
  suiteSettings: '这里的每一项都是这个套件自己的规则。停用它，规则会退回程序内置的默认值，但你现在填的内容会保留下来，重新启用就回到你设的样子。'
})

const RUNTIME_STATUS_LABEL = {
  ready: '就绪', idle: '待拉起', running: '运行中', unconfigured: '未配置', missing: '不可用'
}

function runtimeCard(runtime) {
  const on = runtime.id === agent.runtime
  const status = RUNTIME_STATUS_LABEL[runtime.status] ?? runtime.status ?? ''
  const probe = runtime.probe ?? null
  const probeNote = probe?.version ? ` · ${esc(probe.version)}` : probe?.message ? ` · ${esc(probe.message)}` : ''
  const canFix = runtime.status === 'missing' && runtime.kind === 'dsh'
  const desc = text(runtime.description).trim()
  return `<div class="big-opt${on ? ' on' : ''}${runtime.status === 'missing' ? ' is-missing' : ''}" data-runtime-id="${esc(runtime.id)}" title="${esc(desc)}">
    <b>${esc(runtime.name)}<span class="src">${esc(runtime.source)}</span><span class="rt-status ${esc(runtime.status || '')}">${esc(status)}</span></b>
    <span class="one-line">${esc(desc)}${probeNote}</span>
    ${canFix ? `<div class="rt-fix" data-action="runtime-setup" data-id="${esc(runtime.id)}">修复</div>` : ''}
  </div>`
}

function settingsRuntimeSectionHtml() {
  const groups = [
    { key: 'native', label: '原生 / 套件' },
    { key: 'dsh', label: 'DSH 原生' },
    { key: 'cli', label: 'CLI 服务（嫁接）' }
  ]
  const runtimeCards = groups.map((group) => {
    const items = (agent.runtimeList || []).filter((runtime) => (runtime.category ?? 'native') === group.key)
    if (items.length === 0) return ''
    return `<div class="runtime-group"><div class="runtime-group-head">${esc(group.label)}</div><div class="big-opts">${items.map(runtimeCard).join('')}</div></div>`
  }).join('')
  return `<div class="step">
    <h3>Agent 运行时</h3>
    <div class="big-opts">${runtimeCards}</div>
    <div class="field" style="margin-top:14px"><label>Pi 兜底端点</label>
      <input id="cfg-endpoint" placeholder="https://api.deepseek.com/v1/chat/completions" value="${esc(agent.endpoint)}">
    </div>
    <div class="field"><label>模型</label>
      <input id="cfg-model" placeholder="deepseek-chat" value="${esc(agent.model)}">
    </div>
    <div class="field"><label>API Key${agent.apiKeyMasked ? `（已设置 ${esc(agent.apiKeyMasked)}）` : ''}</label>
      <input id="cfg-key" type="password" placeholder="${agent.apiKeyMasked ? '留空保留原 key' : 'sk-…'}">
    </div>
    ${dshDepthFieldHtml()}
    <div class="field">
      <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
        <input type="checkbox" id="cfg-chinese-reasoning"${agent.chineseReasoning !== false ? ' checked' : ''} style="width:auto">
        <span>用中文推理（推荐）</span>
      </label>
      <span class="count" style="line-height:1.7">
        中文写作讨论用中文思考更贴题，术语和语感不容易在翻译里走样。<br>
        代价是可能损失一部分推理性能——复杂的形式化推理用英文通常更稳。<br>
        关掉后模型用默认语言思考，回复本身仍然是中文。
      </span>
    </div>
    <div class="err" id="settings-err"></div>
    <div class="row" style="display:flex;gap:10px;align-items:center;margin-top:8px">
      <button class="btn-primary" data-action="agent-config-save">保存</button>
    </div>
  </div>`
}

/**
 * 推理深度（OS-39）：DSH 支持 reasoning_effort，档位由 `dsh --models` 报上来。
 * 只在 DSH 就绪时展示；取不到清单就不摆假选项。
 */
function dshDepthFieldHtml() {
  const options = agent.dshReasoningOptions || []
  if (!options.length) return ''
  const current = text(agent.reasoningEffort)
  const rows = [
    `<option value=""${current ? '' : ' selected'}>默认（用 DSH 自己的档）</option>`,
    ...options.map((option) => `<option value="${esc(option.id)}"${option.id === current ? ' selected' : ''}>${esc(option.name)}${option.default ? '（DSH 默认）' : ''}</option>`)
  ].join('')
  return `<div class="field"><label>推理深度（仅 DSH）</label>
    <select class="select" id="cfg-reasoning">${rows}</select>
    <span class="count">想得更久＝答案更稳但更慢；留默认即可</span>
  </div>`
}

function settingsAppearanceSectionHtml() {
  const styleCards = state.styles.map((pack) => `
    <button class="big-opt${pack.id === state.skin ? ' on' : ''}" data-skin="${esc(pack.id)}">
      <b>${esc(pack.name)}<span class="src">${esc(pack.source)}</span></b>
      <span>${esc(pack.description || '')}</span>
    </button>`).join('')
  return `<div class="step">
    <h3>风格包</h3>
    <div class="big-opts">${styleCards || '<span class="count">风格包清单读不到，先用内置珊瑚兜底。</span>'}</div>
  </div>`
}


/** 外观·写作（OS-21）：正文字号/行高/段距/首行缩进/自动隔行——改完立刻投影到 CSS 变量。 */
function settingsWritingSectionHtml() {
  return `<div class="step">
    <h3>正文排版</h3>
    ${docPrefSlidersHtml()}
  </div>`
}


/**
 * 「插件」节（OS-28）：应用只管插件的插拔——两块货架，业务套件 + Agent 运行时。
 * 每个插件的设置都归它自己的设置页（点进去），不在应用设置里摊开。
 */
function settingsPluginsSectionHtml() {
  return suitesSectionHtml() + settingsRuntimeSectionHtml()
}

/**
 * 「发现与导入」节（OS-28）：应用只管「从哪发现插件」和「怎么把稿子导进来」。
 * 三类货架都是目录制——丢文件即上新，本机覆盖内置。
 */
function settingsDiscoverSectionHtml() {
  const shelves = [
    { label: '业务套件', dir: '%LOCALAPPDATA%\\PinaxNext\\openstory\\suites' },
    { label: 'Agent 运行时', dir: '%LOCALAPPDATA%\\PinaxNext\\openstory\\runtimes' },
    { label: '风格包', dir: '%LOCALAPPDATA%\\PinaxNext\\openstory\\styles' }
  ]
  const rows = shelves.map((shelf) => `<div class="discover-row"><div><b>${esc(shelf.label)}</b></div><div class="hint">${esc(shelf.dir)}</div></div>`).join('')
  return `<div class="step"><h3>插件货架</h3>${rows}</div>
    <div class="step"><h3>库与稿件</h3>
    <div class="row" style="display:flex;gap:10px"><button class="btn-ghost" data-action="flow-create">＋新建库</button><button class="btn-ghost" data-action="flow-import">导入稿件</button></div></div>`
}

function settingsDataSectionHtml() {
  const paths = [
    { label: '库清单', path: state.preferencesPath || '%LOCALAPPDATA%\\PinaxNext\\next-preferences.json' },
    { label: 'Agent 配置', path: agent.configPath || '%LOCALAPPDATA%\\PinaxNext\\openstory\\agent-config.json' },
    { label: '运行时套件货架', path: state.settings.userDir || '%LOCALAPPDATA%\\PinaxNext\\openstory\\runtimes' },
    { label: '风格包货架', path: '%LOCALAPPDATA%\\PinaxNext\\openstory\\styles' }
  ]
  return `<div class="step">
    <h3>本机路径</h3>
    ${paths.map((item) => `<div class="kv-line"><span class="k">${esc(item.label)}</span><span class="v">${esc(item.path)}</span></div>`).join('')}
    ${warningsHtml(state.warnings)}
  </div>`
}

function settingsAboutSectionHtml() {
  return `<div class="step">
    <h3>OpenStory</h3>
    <div class="kv-line"><span class="k">版本</span><span class="v">0.1.0</span></div>
    <div class="kv-line"><span class="k">与 Pinax 的关系</span><span class="v">同一批库文件，两个入口</span></div>
  </div>`
}

function settingsKbSectionHtml() {
  const s = state.kbStatus
  if (!s) {
    return `<div class="step"><h3>知识库</h3><div class="kv-line"><span class="k">状态</span><span class="v">读取中…</span></div></div>`
  }
  if (!s.configured) {
    return `<div class="step">
      <h3>知识库</h3>
      <div class="kv-line"><span class="k">连接</span><span class="v">未配置</span></div>
      <div class="kv-line"><span class="k">说明</span><span class="v">在 %LOCALAPPDATA%\\PinaxNext\\openstory\\kb-config.json 写入 WeKnora 连接后重启 daemon</span></div>
      <div class="kv-line"><span class="k">配置路径</span><span class="v">${esc(s.configPath || '—')}</span></div>
      ${s.configError ? `<div class="kv-line"><span class="k">读取问题</span><span class="v">${esc(s.configError)}</span></div>` : ''}
    </div>`
  }
  const lamp = (up) => up ? '<span style="color:var(--green)">●</span>在线' : '<span style="color:var(--destructive)">●</span>离线'
  const svc = s.services || {}
  const rows = (s.collections || []).map((c) => {
    const docs = c.docs === null || c.docs === undefined ? '—' : String(c.docs)
    const parsed = c.parsed === null || c.parsed === undefined ? '—' : `${c.parsed}/${c.docs ?? '?'}`
    return `<div class="kv-line"><span class="k">${esc(c.alias)}</span><span class="v">文档 ${docs}｜已解析 ${parsed}</span></div>`
  }).join('')
  const embed = svc.embedding || {}
  const embedInfo = embed.up
    ? `${esc(embed.model || 'embedding')}${embed.dim ? `（${embed.dim} 维）` : ''}${embed.autoStarted ? '·本进程自动拉起' : ''}`
    : '离线'
  return `<div class="step">
    <h3>知识库</h3>
    <div class="kv-line"><span class="k">WeKnora</span><span class="v">${lamp(!!(svc.weknora && svc.weknora.up))}${svc.weknora && svc.weknora.version ? ` · v${esc(svc.weknora.version)}${svc.weknora.edition ? ` · ${esc(svc.weknora.edition)}` : ''}` : ''}</span></div>
    <div class="kv-line"><span class="k">Embedding</span><span class="v">${lamp(!!embed.up)}${embed.up ? ` · ${embedInfo}` : ''}</span></div>
    <div class="kv-line"><span class="k">连接</span><span class="v">${esc(s.backend || '—')}</span></div>
    <div class="kv-line"><span class="k">配置路径</span><span class="v">${esc(s.configPath || '—')}</span></div>
    <div class="kv-line"><span class="k">最近检查</span><span class="v">${esc(s.lastCheck ? s.lastCheck.replace('T', ' ').slice(0, 19) : '—')}</span></div>
    ${s.configError ? `<div class="kv-line"><span class="k">读取问题</span><span class="v">${esc(s.configError)}</span></div>` : ''}
    <h3>分库清单</h3>
    ${rows || '<div class="kv-line"><span class="k">状态</span><span class="v">读不到分库（WeKnora 离线或配置为空）</span></div>'}
  </div>`
}

function settingsHtml() {
  const sectionRenderers = {
    plugins: settingsPluginsSectionHtml,
    modules: settingsModulesSectionHtml,
    suites: suitesSectionHtml,
    suite: () => suiteDetailHtml(state.settings.suiteId),
    suiteSettings: () => suiteDetailHtml(state.settings.suiteId),
    runtime: settingsRuntimeSectionHtml,
    appearance: settingsAppearanceSectionHtml,
    discover: settingsDiscoverSectionHtml,
    data: settingsDataSectionHtml,
    kb: settingsKbSectionHtml,
    about: settingsAboutSectionHtml
  }
  const sectionId = sectionRenderers[state.settings.section] ? state.settings.section : 'plugins'
  // 套件独立设置页在导航上高亮「插件」
  const navOn = sectionId === 'suite' || sectionId === 'suiteSettings' ? 'plugins' : sectionId
  const sectionHtml = (sectionRenderers[sectionId] ?? settingsPluginsSectionHtml)()
  const nav = SETTINGS_SECTIONS.map((section) => `
    <button class="settings-nav-item${section.id === navOn ? ' on' : ''}" data-settings-section="${esc(section.id)}">
      <b>${esc(section.label)}</b>
      <span>${esc(section.hint)}</span>
    </button>`).join('')
  const help = SETTINGS_HELP[sectionId] || SETTINGS_HELP.plugins
  const helpOpen = state.settings.helpOpen === true
  return `<div class="lib-wrap">
    <div class="page-head">
      <h1>设置</h1>
      <span class="sp"></span>
      <button class="help-btn${helpOpen ? ' on' : ''}" data-action="settings-help-toggle" title="这些设置是干什么的" aria-expanded="${helpOpen}">!</button>
      <button class="icon-btn page-close" data-action="settings-close" title="关闭设置">×</button>
    </div>
    ${helpOpen ? `<div class="help-bubble">${esc(help)}</div>` : ''}
    ${errorHtml()}
    <div class="settings-layout">
      <nav class="settings-nav">${nav}</nav>
      <div class="settings-content">${sectionHtml}</div>
    </div>
  </div>`
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
    await loadAgentRuntimes()
    updateAgentChip()
    updateComposerState()
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

/* ---------- 套件（插件）设置（OS-15：版本/归属/启停/独立设置页）---------- */

async function loadSuites() {
  try {
    const payload = await api('/api/suites')
    state.suites = Array.isArray(payload.suites) ? payload.suites : []
    state.settings.suitesUserDir = text(payload.userDir)
  } catch {
    state.suites = []
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

function suitesSectionHtml() {
  const enabledCount = state.suites.filter((suite) => suite.enabled !== false).length
  const rows = state.suites.map((suite) => {
    const on = suite.enabled !== false
    const desc = text(suite.description).trim()
    return `<div class="suite-manage-row${on ? '' : ' off'}" title="${esc(desc)}">
      <div class="sm-main">
        <button class="sm-name" data-action="suite-open" data-id="${esc(suite.id)}" title="进这个套件的设置页">${esc(suite.name)}</button>
        <span class="pill">v${esc(suite.version)}</span>
        <span class="pill">${esc(suite.vendor)}</span>
        ${suite.domains?.length ? `<span class="count">${esc(suite.domains.join('／'))}</span>` : ''}
        <div class="count one-line">${esc(desc)}</div>
      </div>
      <div class="sm-ops">
        <button class="btn-ghost" data-action="suite-open" data-id="${esc(suite.id)}">设置 →</button>
        <button class="sm-toggle${on ? ' on' : ''}" data-action="suite-toggle" data-id="${esc(suite.id)}" title="${on ? '停用（规则退回默认，值保留）' : '启用'}">
          <span class="knob"></span><span class="lab">${on ? '启用中' : '已停用'}</span>
        </button>
      </div>
    </div>`
  }).join('')
  return `<div class="step">
    <h3>业务套件<span class="cnt">启用 ${enabledCount} · 停用 ${state.suites.length - enabledCount}</span></h3>
    <div class="suite-manage">${rows || '<div class="count" style="padding:10px">货架为空——把套件目录丢进本机 suites 目录即上新。</div>'}</div>
  </div>`
}

function settingFieldHtml(setting) {
  const value = state.settings.draftValues?.[setting.key] ?? setting.default ?? ''
  if (setting.type === 'select') {
    const options = (setting.options ?? []).map((option) => `<option value="${esc(option)}"${option === value ? ' selected' : ''}>${esc(option)}</option>`).join('')
    return `<div class="field"><label>${esc(setting.label)}</label><select class="select" data-suite-key="${esc(setting.key)}">${options}</select></div>`
  }
  if (setting.type === 'boolean') {
    return `<div class="field"><label>${esc(setting.label)}</label>
      <select class="select" data-suite-key="${esc(setting.key)}">
        <option value="true"${value === true ? ' selected' : ''}>开</option>
        <option value="false"${value === false ? ' selected' : ''}>关</option>
      </select></div>`
  }
  const inputType = setting.type === 'number' ? 'number' : 'text'
  return `<div class="field"><label>${esc(setting.label)}</label>
    <input data-suite-key="${esc(setting.key)}" type="${inputType}" value="${esc(value)}" ${setting.type === 'number' ? 'step="any"' : ''}>
  </div>`
}

function suiteDetailHtml(id) {
  const suite = suiteById(id)
  if (!suite) {
    return `<div class="step"><h3>套件不在货架上</h3><p class="sub">可能已被移除。<button class="btn-ghost" data-settings-section="plugins">← 回插件</button></p></div>`
  }
  state.settings.draftValues = { ...suite.values }
  const caps = suite.capabilities ?? { settings: { mode: 'none' }, pages: [], services: [] }
  const mode = caps.settings?.mode ?? 'none'
  const head = `<div class="suite-head">
      <span class="suite-name">${esc(suite.name)}</span>
      <span class="pill">v${esc(suite.version)}</span>
      <span class="pill">${esc(suite.vendor)}</span>
      <span class="state-chip ${suite.enabled ? 'ok' : 'dead'}">${suite.enabled ? '启用中' : '已停用'}</span>
    </div>`
  const paused = suite.enabled ? '' : '<div class="warn-box"><b>已停用</b>——这套件的规则当前走内置默认；下面的值保留，启用即恢复。</div>'
  let body = ''
  if (mode === 'page') {
    body = `${paused}<iframe class="suite-frame" src="/suite-assets/${esc(suite.id)}/${esc(caps.settings.entry)}" title="${esc(suite.name)} 设置"></iframe>`
  } else if (mode === 'schema') {
    const schema = suite.settingsSchema ?? []
    body = `
      ${paused}
      ${schema.length ? schema.map(settingFieldHtml).join('') : '<p class="sub">这套件没有声明设置项。</p>'}
      <div class="err" id="suite-err"></div>
      <div class="row" style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <button class="btn-primary" data-action="suite-settings-save" data-id="${esc(suite.id)}">保存</button>
      </div>`
  } else {
    body = '<p class="sub">这套件没有设置项。</p>'
  }
  return `<div class="step">
    ${head}
    ${body}
    <div class="row" style="display:flex;gap:10px;align-items:center;margin-top:14px">
      <button class="btn-ghost" data-action="suite-toggle" data-id="${esc(suite.id)}" data-enabled="${suite.enabled ? 'true' : 'false'}">${suite.enabled ? '停用' : '启用'}</button>
      <button class="btn-ghost" data-settings-section="plugins">← 回插件</button>
    </div>
  </div>`
}

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
    const payload = await api('/api/suite/settings', { method: 'PUT', body: JSON.stringify({ id, values }) })
    const suite2 = suiteById(id)
    if (suite2) suite2.values = payload.values
    if (errEl) errEl.textContent = ''
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

async function toggleSuite(id) {
  const suite = suiteById(id)
  try {
    await api('/api/suite/state', { method: 'PUT', body: JSON.stringify({ id, enabled: !(suite?.enabled !== false) }) })
    await loadSuites()
    render()
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/* ---------- 产物中心（OS-11：全库只读盘点＋预览＋去编辑）---------- */

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
    go('write')
    loadChapter(file)
    return
  }
  if (topDir) {
    openDirWork(topDir).then(() => loadDirFile(topDir, file))
    return
  }
  // 根目录散文件没有归属工作面——留在产物中心看预览。
}

function groupLabel(dir) {
  if (!dir) return '根目录文件'
  return DIR_LABELS[dir] || dir
}

/* ---------- 参考载体（OS-44）：Obsidian 式笔记系统 ---------- */

let refModule = null
async function loadRefModule() {
  if (!refModule) refModule = await import('./reference.mjs')
  return refModule
}

/** 拉参考索引（供参考页与左栏图谱共用）。 */
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
    // OS-48：顺手探旧目录有没有可迁入的内容（迁入按钮按需显示；目录不存在＝0）
    ref.absorb = {}
    await Promise.all(['大纲', '构思', '资料', '约束'].map(async (dir) => {
      try {
        const listed = await api(`/api/files?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent(dir)}`)
        ref.absorb[dir] = Array.isArray(listed.files) ? listed.files.length : 0
      } catch { ref.absorb[dir] = 0 }
    }))
  } catch (error) {
    ref.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  ref.loading = false
}

/** 打开一篇参考笔记（含反链）。 */
async function openReference(path) {
  const ref = state.reference
  if (!state.current || !path) return
  ref.activePath = path
  ref.error = ''
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

/** 参考页正文区（Markdown 渲染 + 编辑切换）。 */
function referenceEditorHtml() {
  const ref = state.reference
  const note = ref.note
  if (!note) return ''
  if (ref.editing) {
    return `<div class="rf-edit">
      <textarea class="editor" id="ref-editor" spellcheck="false">${esc(ref.draft ?? note.text)}</textarea>
      <div class="row" style="display:flex;gap:8px;margin-top:8px">
        <button class="btn-primary" data-action="ref-save">保存</button>
        <button class="btn-ghost" data-action="ref-cancel-edit">取消</button>
      </div>
    </div>`
  }
  // 渲染前剥掉 frontmatter——那是指标（tags/title），不是正文内容，不该出现在页面上
  const stripFrontmatter = (raw) => {
    const source = text(raw)
    if (!source.startsWith('---\n')) return source
    const end = source.indexOf('\n---', 4)
    if (end === -1) return source
    return source.slice(source.indexOf('\n', end + 1) + 1 || source.length)
  }
  const bodySource = stripFrontmatter(note.text)
  const body = (mdReady && mdModule) ? mdModule.renderMarkdown(bodySource) : `<p>${esc(bodySource)}</p>`
  const tagChips = (Array.isArray(note.tags) ? note.tags : [])
    .map((tag) => `<button class="pill tag-pick" data-ref-tag="${esc(tag)}">#${esc(tag)}</button>`).join('')
  return `<h2>${esc(note.title || note.path)}</h2>
    <div class="rf-meta">
      <span>${esc(note.path)}</span>
      ${note.chars !== undefined ? `<span>${note.chars} 字</span>` : ''}
      ${tagChips}
      <span class="sp" style="flex:1"></span>
      <button class="btn-ghost" data-action="ref-edit">编辑</button>
      <button class="btn-ghost" data-action="ref-to-agent">发给 Agent</button>
    </div>
    <div class="prose-block">${body}</div>`
}

/** 参考页整体（OS-48：侧栏导航 + 视图制主区）。 */
function referencePageHtml() {
  const ref = state.reference
  if (!state.current) return needLibraryHtml()
  if (ref.loading && !ref.loaded) return '<div class="loading">正在读取参考…</div>'
  if (!refModule) return '<div class="loading">参考模块载入中…</div>'
  const mainHtml = (ref.view || 'note') === 'graph' ? referenceGraphHtml() : referenceEditorHtml()
  const absorbTotal = Object.values(ref.absorb || {}).reduce((sum, count) => sum + (Number(count) || 0), 0)
  const shell = refModule.referenceShellHtml({
    notes: ref.notes,
    tags: ref.tags,
    activeTag: ref.activeTag,
    activePath: ref.activePath,
    view: ref.view || 'note',
    q: ref.q || '',
    mainHtml,
    backlinks: ref.backlinks,
    stats: ref.stats,
    absorbable: absorbTotal
  })
  // 参考页自己就是双链文档工作面（侧栏导航/正文/反链），
  // 不再套题材左栏——那三块是给「小说」这类非双链页用的。
  return `<div class="topic-workspace"><div class="topic-main">${errorHtml()}${ref.flash ? `<div class="ok-note">${esc(ref.flash)}</div>` : ''}${shell}</div></div>`
}

/** 参考页·关系图谱视图（OS-48）：大画布 + 聚焦交互，对齐作者 Wiki 的图谱口径。 */
function referenceGraphHtml() {
  const rc = state.refCol
  if (rc.graphError) return `<div class="error-box">${esc(rc.graphError)}</div>`
  if (!rc.graph) return '<div class="loading">正在构图…</div>'
  const stats = rc.graph.stats || {}
  const byKind = stats.byKind || {}
  const legend = [
    ['reference', '参考', 'var(--accent)'],
    ['tag', '标签', '#c48a00'],
    ['artifact', '章节/产物', 'var(--ok)'],
    ['entry', '条目（只读）', 'var(--meta)']
  ].filter(([kind]) => byKind[kind]).map(([, label, color]) =>
    `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')
  const focusNode = state.reference.focus
    ? rc.graph.nodes.find((node) => node.id === state.reference.focus)
    : null
  const hint = focusNode
    ? `聚焦「${focusNode.label || focusNode.id}」的邻域——再点它进详情，点空白复位`
    : '点节点聚焦邻域，再点进详情，点空白复位'
  return `<div class="ref-graph">
    <div class="ref-graph-meta">${stats.nodes ?? 0} 个节点 · ${stats.edges ?? 0} 条边 · ${esc(hint)}</div>
    <div class="graph-box big" id="ref-graph-box"><canvas id="ref-graph-canvas"></canvas></div>
    <div class="graph-legend">${legend || '<span>没有节点</span>'}</div>
  </div>`
}

/** 图谱画布的数据视图：聚焦时取邻域子图，全景只画有连接的节点（孤立节点在侧栏里看），上限 120。 */
function graphFocusView() {
  const graph = state.refCol.graph
  if (!graph) return { nodes: [], edges: [], stats: {} }
  const focus = state.reference.focus
  if (!focus) {
    const degree = new Map()
    for (const edge of graph.edges) {
      degree.set(edge.a, (degree.get(edge.a) || 0) + 1)
      degree.set(edge.b, (degree.get(edge.b) || 0) + 1)
    }
    const nodes = graph.nodes
      .filter((node) => degree.get(node.id))
      .sort((left, right) => (degree.get(right.id) || 0) - (degree.get(left.id) || 0))
      .slice(0, 120)
    const keep = new Set(nodes.map((node) => node.id))
    return { nodes, edges: graph.edges.filter((edge) => keep.has(edge.a) && keep.has(edge.b)), stats: graph.stats }
  }
  const keep = new Set([focus])
  for (const edge of graph.edges) {
    if (edge.a === focus) keep.add(edge.b)
    if (edge.b === focus) keep.add(edge.a)
  }
  return {
    nodes: graph.nodes.filter((node) => keep.has(node.id)),
    edges: graph.edges.filter((edge) => keep.has(edge.a) && keep.has(edge.b)),
    stats: graph.stats
  }
}

/** 图谱节点跳详情（聚焦模式：再点同节点）。 */
function navigateFromGraphNode(node) {
  state.reference.focus = null
  if (node.kind === 'reference') {
    state.reference.view = 'note'
    openReference(node.id)
    return
  }
  if (node.kind === 'artifact') {
    if (node.id.startsWith('正文/')) {
      loadChapter(node.id)
      go('write')
    } else {
      const dir = node.id.split('/')[0]
      if (state.libDirs.includes(dir)) go(`dir:${dir}`)
    }
    return
  }
  if (node.kind === 'tag') {
    state.reference.view = 'note'
    state.reference.activeTag = node.id.replace(/^tag:/u, '')
    render()
    return
  }
  if (node.kind === 'entry') {
    openEntry(node.id.replace(/^entry:/u, ''))
    go('entries')
  }
}

/** 参考页大图谱挂载（OS-48）：focus 模式——点节点聚焦邻域，再点进详情，点空白复位。 */
async function mountReferenceGraph() {
  const canvas = document.getElementById('ref-graph-canvas')
  if (!canvas) return
  if (!state.refCol.graph) {
    await loadRefGraph()
    return
  }
  const mod = await import('./graph.mjs')
  graphCleanup?.()
  graphCleanup = mod.mountGraph({
    canvas,
    graph: graphFocusView(),
    mode: 'focus',
    focusId: state.reference.focus,
    onPick: (node) => {
      if (state.reference.focus === node.id) navigateFromGraphNode(node)
      else {
        state.reference.focus = node.id
        render()
      }
    },
    onBlank: () => {
      if (state.reference.focus) {
        state.reference.focus = null
        render()
      }
    }
  })
}

/* ---------- 左内容栏（OS-44）：章节树 / 参考图谱 / 参考摘要 ---------- */

/** 章节树：按目录结构分两级（卷/章）。 */
function chapterTreeHtml() {
  const chapters = state.write.chapters || []
  const head = `<div class="chapter-new">
      <input id="chapter-new-title" placeholder="新章标题…" value="">
      <button class="btn-ghost" data-action="chapter-create" title="自动编号新建">＋</button>
    </div>`
  return `${head}<div class="chapter-rows">${chapterRowsHtml(chapters)}</div>`
}

/** 章节行（卷/章两级）。抽出来供「只重画行、不动输入框」复用。 */
function chapterRowsHtml(chapters) {
  if (!chapters.length) return '<div class="empty" style="padding:6px 4px">还没有章节——上面填标题新建第一章。</div>'
  // 按 file 的目录段分组：正文/卷一/001-x.md → 卷一
  const groups = new Map()
  for (const chapter of chapters) {
    const parts = text(chapter.file).split('/')
    const group = parts.length > 2 ? parts[parts.length - 2] : ''
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(chapter)
  }
  return [...groups.entries()].map(([group, list]) => {
    const groupHead = group ? `<div class="ct-vol">${esc(group)}</div>` : ''
    const body = list.map((chapter) => `
      <button class="ct-row${chapter.file === state.chapterFile ? ' on' : ''}" data-chapter-file="${esc(chapter.file)}" title="${esc(chapter.file)}">
        <span class="no">${chapter.no !== null ? String(chapter.no).padStart(2, '0') : '—'}</span>
        <span class="tt">${esc(chapter.title)}</span>
      </button>`).join('')
    return `${groupHead}${body}`
  }).join('')
}

/** 参考图谱模块（canvas 力导向，由 graph.mjs 驱动）。 */
function graphModuleHtml() {
  const rc = state.refCol
  if (rc.graphError) return `<div class="error-box">${esc(rc.graphError)}</div>`
  if (rc.graphLoading) return '<div class="loading">正在构图…</div>'
  const graph = rc.graph
  if (!graph) return '<div class="empty">点「重新构图」生成参考图谱。</div>'
  const byKind = graph.stats?.byKind || {}
  const legend = [
    ['reference', '参考', 'var(--accent)'],
    ['tag', '标签', '#c48a00'],
    ['artifact', '章节/产物', 'var(--ok)'],
    ['entry', '条目（只读）', 'var(--meta)']
  ].filter(([kind]) => byKind[kind]).map(([, label, color]) =>
    `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')
  return `<div class="graph-box" id="ref-graph-box"><canvas id="ref-graph-canvas"></canvas></div>
    <div class="graph-legend">${legend || '<span>没有节点</span>'}</div>
    <div class="graph-hint">${graph.stats?.nodes ?? 0} 个节点 · ${graph.stats?.edges ?? 0} 条边 · 点节点可跳转</div>`
}

/** 参考摘要模块：AI 基于图谱知识总结当前章节的大纲。 */
function refSummaryHtml() {
  const rc = state.refCol
  if (rc.summaryBusy) return '<div class="loading">正在生成摘要…</div>'
  const body = text(rc.summary)
  return `<div class="ref-summary">${body ? esc(body) : '<span class="empty">还没有摘要。点下面生成——AI 会读当前章节关联的参考，总结成本章要点。</span>'}</div>
    ${rc.summaryError ? `<div class="error-box">${esc(rc.summaryError)}</div>` : ''}
    <div class="ref-summary-ops">
      <button data-action="ref-summary-run">${body ? '重新生成' : '生成摘要'}</button>
      ${body ? '<button data-action="ref-summary-clear">清空</button>' : ''}
    </div>`
}

/**
 * 左栏三个模块（OS-44）。
 * 每个模块可单独关闭（设置里插拔），全关则整栏隐藏。
 */
const REF_MODULES = Object.freeze([
  { id: 'chapters', label: '章节', hint: '卷/章两级', render: () => chapterTreeHtml(), badge: () => String((state.write.chapters || []).length) },
  { id: 'graph', label: '参考图谱', hint: '参考与产物的关系', render: () => graphModuleHtml(), badge: () => String(state.refCol.graph?.stats?.nodes ?? 0) },
  { id: 'summary', label: '参考摘要', hint: 'AI 基于图谱总结本章', render: () => refSummaryHtml(), badge: () => '' }
])

/**
 * 题材工作面左栏（OS-45）。
 * 注意它是「小说/参考」这类题材页自己的内部左栏（二等公民的内部结构），
 * Agent 始终在最外层最左（一等公民），两者不抢位置——所以这里返回 HTML 字符串，
 * 由各题材页自己决定往哪插，而不是去改全局 .main 布局。
 *
 * OS-48：左栏是浮层附庸（绝对定位，不占正文流），正文纸面永远居中不被挤压；
 * 三张卡片共用一套头（标题＋计数＋折叠箭头＋关闭 ×），与右栏分析卡同构。
 */
function refColHtml() {
  if (!state.current) return ''
  const hidden = hiddenModules()
  const visible = REF_MODULES.filter((mod) => !hidden.has(mod.id))
  if (!visible.length) return ''
  const openState = state.refCol.open ?? (state.refCol.open = {})
  return `<aside class="ref-col" id="ref-col">${visible.map((mod) => {
    const open = openState[mod.id] !== false
    const badge = mod.badge()
    const body = open ? mod.render() : ''
    return `<section class="ref-mod" data-ref-mod="${esc(mod.id)}" data-open="${open ? '1' : '0'}">
      <div class="ref-mod-head">
        <button class="rm-toggle" data-action="refmod-toggle" data-module-id="${esc(mod.id)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="rm-title">${esc(mod.label)}</span>
          ${badge ? `<span class="rm-badge">${esc(badge)}</span>` : ''}
          <span class="rm-chev">›</span>
        </button>
        <button class="rm-x" data-action="module-close" data-module-id="${esc(mod.id)}" title="关闭「${esc(mod.label)}」（设置里可重新打开）" aria-label="关闭">×</button>
      </div>
      ${body ? `<div class="ref-mod-body">${body}</div>` : ''}
    </section>`
  }).join('')}</aside>`
}

/** 题材页渲染完后统一挂图谱（各页只负责插 refColHtml()）。 */
function afterRefColMount() {
  const host = document.getElementById('ref-col')
  if (!host) return
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
 * 模块插拔（OS-44）：per-library localStorage，照 hiddenTabs 的模式。
 * 可在设置里关掉任意模块；全关则左栏整体消失。
 */
const MODULE_HIDE_KEY = (root) => `openstory-modules-hidden::${root || ''}`

function hiddenModules() {
  const root = state.current?.path || ''
  if (!state.moduleHidden) state.moduleHidden = {}
  if (!state.moduleHidden[root]) {
    let saved = []
    try { saved = JSON.parse(localStorage.getItem(MODULE_HIDE_KEY(root)) || '[]') } catch { saved = [] }
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
  try { localStorage.setItem(MODULE_HIDE_KEY(root), JSON.stringify([...set])) } catch { /* 隐私模式 */ }
  // 在正文/参考页上就地重排左栏（不整页重绘：正文滚动位置不该因为开关卡片被重置）；
  // 设置页等其它页面走常规 render，才能同步勾选态。
  const host = document.getElementById('ref-col')
  if (host && (state.view === 'write' || state.view === 'reference')) {
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

/** 挂载参考图谱（OS-44）：canvas 就位后调 graph.mjs 的 mountGraph。 */
let graphCleanup = null
async function mountRefGraph() {
  const canvas = document.getElementById('ref-graph-canvas')
  if (!canvas) return
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
      // 点节点跳转：参考→参考页；章节→正文；条目→条目详情
      if (node.kind === 'reference') {
        state.reference.activePath = node.id
        go('reference')
        openReference(node.id)
        return
      }
      if (node.kind === 'artifact') {
        if (node.id.startsWith('正文/')) {
          loadChapter(node.id)
          go('write')
        } else {
          const dir = node.id.split('/')[0]
          if (state.libDirs.includes(dir)) go(`dir:${dir}`)
        }
        return
      }
      if (node.kind === 'tag') {
        state.reference.activeTag = node.id.replace(/^tag:/u, '')
        go('reference')
        return
      }
      if (node.kind === 'entry') {
        openEntry(node.id.replace(/^entry:/u, ''))
        go('entries')
      }
    }
  })
}

/** 拉图谱数据。 */
async function loadRefGraph({ force = false } = {}) {
  const rc = state.refCol
  if (!state.current || rc.graphLoading) return
  if (rc.graph && !force) return
  rc.graphLoading = true
  rc.graphError = ''
  // 图谱模块在题材页内部：重画左栏要走对应页面的重绘，而不是改全局容器
  if (state.view === 'write' || state.view === 'reference') render()
  else renderRefCol()
  try {
    const payload = await api(`/api/reference/graph?root=${encodeURIComponent(state.current.path)}`)
    rc.graph = { nodes: payload.nodes || [], edges: payload.edges || [], stats: payload.stats || {} }
  } catch (error) {
    rc.graph = null
    rc.graphError = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  rc.graphLoading = false
  if (state.view === 'write' || state.view === 'reference') render()
  else renderRefCol()
}

/**
 * 参考摘要（OS-44）：让 AI 读当前章节关联的参考，总结成本章要点。
 * 走 ephemeral——不建会话、不污染会话列表。
 */
/**
 * 单次 Agent 调用（OS-50 补齐）：走 ephemeral 通道——不建会话、不落档、不进会话列表。
 * 与润笔共用 streamChat；只收文本，thinking/tool 一律丢弃。
 * 注意：这个函数原先只有调用点、没有定义，参考摘要一点就 ReferenceError。
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
    // 材料口径（OS-45 单向原则）：**参考只暴露链接，不给正文/摘要**——参考内容由 Agent
    // 自己按路径去读（它有读文件能力），否则等于把参考资料全量灌进上下文。
    // 章节正文本身是作者要总结的对象，给开头即可。
    const chapter = text(state.chapterText).slice(0, 1200)
    const graph = state.refCol.graph
    const chapterPath = text(state.chapterFile)
    // 与当前章节直接相连的参考优先，其余按标签/度数补足
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
      '【参考摘要】',
      chapterPath ? `当前章节：${chapterPath}` : '（还没选章节）',
      chapter ? `\n章节开头：\n${chapter}` : '',
      refLinks ? `\n可用参考（只有链接，需要内容请自行读取对应文件）：\n${refLinks}` : '',
      '',
      '请给这一章写一份要点摘要（150 字以内）：这一章要推进什么、涉及哪些参考、有什么要注意的伏笔或设定约束。',
      '需要参考细节时用你的读文件能力打开上面列出的路径，不要凭空猜测。只输出摘要正文，不要标题、不要解释。'
    ].filter(Boolean).join('\n')
    const result = await runAgentOnce(prompt)
    rc.summary = result || '（模型没有返回内容）'
  } catch (error) {
    rc.summaryError = humanizeAgentError(error)
  }
  rc.summaryBusy = false
  repaintRefModule('summary')
}

/** 保存参考笔记（走 /api/chapter 通道，复用原子写＋.history 备份）。 */
async function saveReferenceNote() {
  const ref = state.reference
  const note = ref.note
  if (!state.current || !note) return
  const draft = text(document.getElementById('ref-editor')?.value ?? ref.draft)
  try {
    await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: note.path, text: draft })
    })
    ref.editing = false
    ref.draft = draft
    // 重扫索引（标签/链接可能变了）
    await loadReferences({ force: true })
    await openReference(note.path)
  } catch (error) {
    ref.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/** 把当前参考塞进 Agent 上下文（复用 OS-24 的 chip 机制）。 */
function sendReferenceToAgent() {
  const note = state.reference.note
  if (!note) return
  agent.pendingContext = {
    quote: note.title,
    context: text(note.text).slice(0, 2000),
    label: `参考：${note.title}（${text(note.text).replace(/\s/gu, '').length} 字）`
  }
  renderAgent()
  const input = document.getElementById('agent-input')
  input?.focus()
}

/** 新建笔记/标签的弹层。 */
function openNewReferenceModal(kind) {
  const isTag = kind === 'tag'
  openModal(`
    <h3>${isTag ? '新建标签' : '新建参考笔记'}</h3>
    <p class="sub">${isTag
      ? '标签是人话的分类——给每个标签写一句描述，用的时候一眼知道它什么意思。'
      : '参考笔记写你查到的、想到的、要记住的。写作时左栏图谱会把它和章节连起来。'}</p>
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

/** 从弹层创建参考笔记 / 标签笔记。 */
async function createReferenceFromModal() {
  const errEl = document.getElementById('ref-new-err')
  const name = text(document.getElementById('ref-new-name')?.value).trim()
  if (!name) { if (errEl) errEl.textContent = '名字不能为空'; return }
  const descEl = document.getElementById('ref-new-desc')
  const isTag = Boolean(descEl) // 弹层里有描述框＝在新建标签
  const dirInput = text(document.getElementById('ref-new-dir')?.value).trim().replace(/^[\\/]+/u, '')
  const safe = name.replace(/[\\/:*?"<>|]/gu, '_')
  // 标签笔记固定进 参考/标签/；普通笔记按作者指定的子目录
  const file = isTag
    ? `参考/标签/${safe}.md`
    : (dirInput ? `参考/${dirInput}/${safe}.md` : `参考/${safe}.md`)
  const body = isTag
    ? `---\nkind: tag\ntag: ${name}\ndescription: ${text(descEl.value).trim()}\n---\n\n`
    : `---\ntags: []\n---\n\n# ${name}\n\n`
  try {
    await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file, text: body })
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
      <span><b>${esc(dir)}/</b> ${count} 篇 → <span class="hint">参考/${esc(dir)}/</span></span></label>`
  }).join('')
  if (!rows) return
  openModal(`
    <h3>迁入旧目录</h3>
    <p class="sub">这些旧目录的内容会搬进「参考」，并入图谱与双链体系。搬运是显式动作：
      目标重名不覆盖；原稿挪进 <span class="hint">.history</span> 备份，随时可捞回。</p>
    <div class="absorb-list">${rows}</div>
    <div class="err" id="ref-absorb-err"></div>
    <div class="ops">
      <button class="btn-ghost" data-action="modal-close">取消</button>
      <button class="btn-primary" data-action="ref-absorb-run">迁入</button>
    </div>
  `)
}

/** 执行迁入：POST /api/reference/absorb → 刷新参考索引与图谱缓存。 */
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
  const inventory = state.artifacts
  if (!state.current) return needLibraryHtml()
  if (inventory.loading) return '<div class="loading">正在盘点全库产物…</div>'
  const totals = inventory.totals || { files: 0, bytes: 0, histories: 0 }
  const historyItem = inventory.groups.flatMap((group) => group.history ?? []).find((item) => item.file === inventory.previewFile)
  const groupCards = inventory.groups.map((group) => {
    const label = groupLabel(group.dir)
    const rows = group.files.map((file) => `
      <button class="artifact-row${file.file === inventory.previewFile ? ' on' : ''}" data-action="artifact-preview" data-file="${esc(file.file)}">
        <span class="nm">${esc(file.name)}</span>
        <span class="sz">${formatBytes(file.size)}</span>
        <span class="tm">${esc(formatAt(file.mtime))}</span>
      </button>`).join('')
    const historyRows = (group.history ?? []).map((item) => `
      <button class="artifact-row hist${item.file === inventory.previewFile ? ' on' : ''}" data-action="artifact-preview" data-file="${esc(item.file)}" title="${esc(item.original)} 的${item.kind === 'deleted' ? '删除档' : '历史版本'}">
        <span class="nm">${esc(item.name)}</span>
        <span class="tag">${item.kind === 'deleted' ? '已删除' : '历史'}</span>
        <span class="sz">${formatBytes(item.size)}</span>
        <span class="tm">${esc(formatAt(item.mtime))}</span>
      </button>`).join('')
    const historyNote = (group.history?.length ?? 0) > 0 ? ` · ${group.history.length} 份历史` : ''
    return `<div class="step artifact-group">
      <h3>${esc(label)}<span class="cnt">${group.files.length} 个${historyNote}</span></h3>
      <div class="artifact-rows">${rows}${historyRows}</div>
    </div>`
  }).join('')
  const preview = inventory.previewFile
    ? `<div class="step artifact-preview">
        <h3><span class="no">→</span>${esc(inventory.previewFile.split('/').pop())}${historyItem ? `<span class="src">${historyItem.kind === 'deleted' ? '已删除档' : '历史版本'}</span>` : ''}</h3>
        ${historyItem ? `<p class="sub">原文件：${esc(historyItem.original)}</p>` : ''}
        ${inventory.previewLoading ? '<div class="loading">读取中…</div>' : `<textarea class="editor" readonly spellcheck="false">${esc(inventory.previewText)}</textarea>`}
        <div class="repair-actions">
          ${historyItem ? `<button class="btn-primary" data-action="artifact-restore" data-file="${esc(inventory.previewFile)}" data-original="${esc(historyItem.original)}">恢复此版本到「${esc(historyItem.originalName)}」</button>` : ''}
          ${historyItem ? '' : `<button class="btn-primary" data-action="artifact-edit" data-file="${esc(inventory.previewFile)}">去编辑</button>`}
        </div>
      </div>`
    : `<div class="step artifact-preview"><h3><span class="no">→</span>预览</h3><div class="empty-state" style="margin:20px auto"><p>点左侧任意文件预览；历史与已删除档可整版恢复（当前内容会先自动备份）。</p></div></div>`
  return `<div class="doc-head">
      <div class="kick">${esc(state.current.name)} / 产物中心</div>
      <h1>产物中心</h1>
      <div class="doc-meta">
        <span class="b">产出物＋版本历史</span>
        <span>${inventory.groups.length} 组</span>
        <span>${totals.files} 个文件</span>
        ${totals.histories ? `<span>${totals.histories} 份历史</span>` : ''}
        <span>${formatBytes(totals.bytes)}</span>
      </div>
    </div>
    ${flowError(inventory.error)}
    <div class="artifacts-grid">
      <div>${groupCards || '<div class="empty-state"><p>库里还没有文本产物——去正文/大纲写点东西。</p></div>'}</div>
      <div>${preview}</div>
    </div>`
}

/** 恢复历史版本：读历史档 → PUT 回原文件（写前自动 .history 备份＝恢复动作也留档）。 */
async function restoreArtifact(historyFile, original) {
  const confirmed = globalThis.confirm?.(`把「${original}」恢复成这份历史版本？当前内容会先自动备份进 .history。`)
  if (!confirmed) return
  const inventory = state.artifacts
  try {
    const version = await api(`/api/chapter?root=${encodeURIComponent(state.current.path)}&file=${encodeURIComponent(historyFile)}`)
    await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: original, text: version.text })
    })
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
    <p class="sub">创建时记录目标正文的快照；采纳时如果文件已被改过（比如在 Pinax 里保存过），会拒绝写入而不是覆盖。</p>
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

async function adoptCard(cardId) {
  agent.cardError = null
  try {
    await api('/api/agent/cards/adopt', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, sessionId: agent.sessionId, id: cardId })
    })
    // 正文被 Agent 改了：正文页签缓存作废，正开着就重读。
    state.chapterLoaded = false
    state.savedAt = ''
    if (state.view === 'write' && state.chapterFile) loadChapter(state.chapterFile)
  } catch (error) {
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
const DECISION_LABELS = {
  chapter: '正文',
  script: '剧本',
  outline: '大纲',
  'outline-json': '大纲（结构化）',
  worldbook: '世界书',
  rule: '约束',
  idea: '构思',
  source: '资料',
  'source-json': '资料（归档 JSON）',
  material: '资料（章节衍生）',
  auxiliary: '资料（世界书辅助）',
  log: '日志'
}

// 与 openstory/libraryManage.mjs 的 PRIMARY_CHOICES 同源（v1 内嵌修复只给两大主载体）。
const PRIMARY_CHOICES = [
  { id: 'pinax.carrier.novel', title: '小说', detail: '正文/ 大纲/ 世界书/ 构思/ 资料/ 日志/ 约束 骨架' },
  { id: 'pinax.carrier.script', title: '剧本', detail: '剧本/ 人物/ 场景/ 大纲/ 世界书/… 骨架' }
]

function flowError(message) {
  return message ? `<div class="error-box">${esc(message)}</div>` : ''
}

function joinDir(parent, name) {
  const base = text(parent).replace(/[\\/]+$/u, '')
  const isWindows = base.includes('\\') || /^[a-zA-Z]:/u.test(base)
  return `${base}${isWindows ? '\\' : '/'}${text(name).trim()}`
}

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

function createHtml() {
  const create = state.create
  const parent = create.parent.trim()
  const name = create.name.trim()
  const full = parent && name ? joinDir(parent, name) : ''
  const primaryCards = [
    ...PRIMARY_CHOICES.map((choice) => `<button class="big-opt${create.primary === choice.id ? ' on' : ''}" data-create-primary="${esc(choice.id)}"><b>${esc(choice.title)}</b><span>${esc(choice.detail)}</span></button>`),
    '<button class="big-opt' + (create.primary === '' ? ' on' : '') + '" data-create-primary=""><b>先建空壳</b><span>只落 .pinax/ 与元数据，主模块以后再选（OpenStory 里可以修）。</span></button>'
  ].join('')
  const genres = state.genres || []
  const selectedGenre = genres.find((item) => item.id === create.genre) ?? null
  const genreCards = genres.length
    ? genres.map((genre) => `<button class="big-opt${create.genre === genre.id ? ' on' : ''}" data-create-genre="${esc(genre.id)}">
        <b>${esc(genre.name)}${genre.tier === 'primary' ? '<span class="src">主打</span>' : ''}</b>
        <span>${esc(genre.summary || '')}</span>
        <span class="count">交付物：${genre.deliverables.map(deliverableLabel).join('／')} · 篇幅单位：${unitLabel(genre.length.unit)}${genre.length.divideBy !== 'none' ? ` · 分${divideLabel(genre.length.divideBy)}` : ' · 不分章'}</span>
      </button>`).join('')
    : '<span class="count">体裁货架读不到——库会建成未声明体裁的空壳，可在库里补声明。</span>'
  const lengthInput = create.length ?? (selectedGenre?.length?.total?.target ?? '')
  const perUnitInput = selectedGenre?.length?.perUnit?.target ?? ''
  const genreDetail = selectedGenre
    ? `<div class="row" style="margin-top:12px;align-items:flex-end">
        <div class="field"><label>总篇幅目标（${unitLabel(selectedGenre.length.unit)}）</label>
          <input id="create-length" type="number" min="1" value="${esc(lengthInput)}"></div>
        ${selectedGenre.length.divideBy !== 'none' ? `<div class="field"><label>每${divideLabel(selectedGenre.length.divideBy)}约（${unitLabel(selectedGenre.length.unit)}）</label>
          <input id="create-per-unit" type="number" min="1" value="${esc(perUnitInput)}"></div>` : ''}
        <span class="count">体裁建议区间：${selectedGenre.length.total ? `${selectedGenre.length.total.min}–${selectedGenre.length.total.max}` : '不限'}${selectedGenre.length.divideBy !== 'none' ? ` · 分${divideLabel(selectedGenre.length.divideBy)}` : ''}</span>
      </div>`
    : ''
  const result = create.result
    ? `<div class="step">
        <h3><span class="no">✓</span>库已建成</h3>
        <p class="sub">${esc(create.result.document?.name ?? '')} · ${esc(create.result.root)}</p>
        ${create.result.briefWritten ? '<p class="sub">✓ 作品简报已写入（体裁/篇幅已锁定，页签与 Agent 策略按它生效）</p>' : ''}
        ${create.result.briefError ? `<p class="sub" style="color:var(--danger)">${esc(create.result.briefError)}</p>` : ''}
        <p class="sub">${create.result.needsPrimary ? '这是个空壳库：还没选主模块。可以在库里点「诊断」修，或现在去导入稿件。' : `骨架与 .pinax/project.json 已按「${esc(create.result.document?.kind ?? '')}」落盘，并已登记进库清单（Pinax 里也能看到）。`}</p>
        <div class="repair-actions">
          <button class="btn-primary" data-action="create-open" data-root="${esc(create.result.root)}">打开这个库</button>
          <button class="btn-ghost" data-action="create-import" data-root="${esc(create.result.root)}">继续导入稿件</button>
          <button class="btn-ghost" data-action="flow-create-reset">再建一个</button>
        </div>
      </div>`
    : ''
  return `<div class="lib-wrap">
    <div class="lib-head-row">
      <button class="btn-ghost" data-action="flow-back">← 库管理</button><span class="sp"></span>
    </div>
    <h1>新建库</h1>
    <p class="sub">目录＝固化中文骨架 ∪ 模块认领的文件夹；只建不删。建好自动登记进库清单。</p>
    ${result}
    ${result ? '' : `
    <div class="step">
      <h3><span class="no">1</span>位置与名字</h3>
      <div class="row">
        <div class="field"><label>放在哪个目录下（绝对路径）</label>
          <input id="create-parent" placeholder="D:\\写作" value="${esc(create.parent)}"></div>
        <div class="field"><label>库名（也是文件夹名）</label>
          <input id="create-name" placeholder="长夜" value="${esc(create.name)}"></div>
      </div>
      ${full ? `<div class="path-preview">将创建：${esc(full)}</div>` : ''}
    </div>
    <div class="step">
      <h3><span class="no">2</span>主模块（决定骨架形态）</h3>
      <div class="big-opts">${primaryCards}</div>
      <p class="sub">其余载体（世界书/漫画/…）的主模块在 Pinax 里选。</p>
    </div>
    <div class="step">
      <h3><span class="no">3</span>作品简报（体裁＝一等约束）</h3>
      <p class="sub">体裁决定要哪些模块、写多长、Agent 用什么策略——建库后写进 <span class="hint">.openstory/brief.json</span>。</p>
      <div class="big-opts">${genreCards}</div>
      ${genreDetail}
    </div>
    ${flowError(create.error)}
    <div class="row" style="display:flex;gap:10px;align-items:center">
      <button class="btn-primary" data-action="create-submit"${create.running ? ' disabled' : ''}>${create.running ? '创建中…' : '创建库'}</button>
    </div>`}
  </div>`
}

function importHtml() {
  const impo = state.impo
  const options = state.libraries
    .map((library) => `<option value="${esc(library.path)}"${library.path === impo.root ? ' selected' : ''}>${esc(library.name)}${library.path === state.current?.path ? '（当前）' : ''}</option>`)
    .join('')
  return `<div class="lib-wrap">
    <div class="lib-head-row">
      <button class="btn-ghost" data-action="flow-back">← 库管理</button><span class="sp"></span>
    </div>
    <h1>导入稿件</h1>
    <p class="sub">源目录永远只读；识别出的稿件按类别落进目标库的标准目录，只新增不覆盖，认不出的原样跳过不猜。</p>
    ${flowError(impo.error)}
    <div class="step">
      <h3><span class="no">1</span>目标库</h3>
      ${options ? `<select class="select" id="import-root">${options}</select>` : '<span class="count">还没有库——先去 <button class="btn-ghost" data-action="flow-create">新建一个</button>。</span>'}
    </div>
    <div class="step">
      <h3><span class="no">2</span>源目录（只读）</h3>
      <div class="field">
        <input id="import-source" placeholder="D:\\旧稿\\长夜　（顶层目录名＝类别：正文/剧本/大纲/世界书/约束/构思/资料/日志）" value="${esc(impo.source)}">
      </div>
      <div class="row">
        <button class="btn-primary" data-action="import-scan"${impo.running || !options ? ' disabled' : ''}>${impo.running ? '扫描中…' : '扫描预览'}</button>
        <span class="count">上限 400 个文件 / 单文件 2MB / 总量 32MB。</span>
      </div>
    </div>
    ${impo.plan ? planHtml(impo.plan) : ''}
    ${impo.report ? reportHtml(impo.report) : ''}
  </div>`
}

function planHtml(plan) {
  const items = Array.isArray(plan.items) ? plan.items : []
  const groups = new Map()
  for (const item of items) {
    if (!groups.has(item.decision)) groups.set(item.decision, [])
    groups.get(item.decision).push(item)
  }
  const groupHtml = [...groups.entries()].map(([decision, list]) => `
    <div class="plan-group">
      <h4>${esc(DECISION_LABELS[decision] ?? decision)}<span class="cnt">${list.length} 个文件</span></h4>
      <div class="plan-files">${list.slice(0, 40).map((item) => `<div>${esc(item.source)} → ${esc(item.target || '（归档）')}</div>`).join('')}${list.length > 40 ? `<div>…还有 ${list.length - 40} 个</div>` : ''}</div>
    </div>`).join('')
  const skipped = Array.isArray(plan.skipped) ? plan.skipped : []
  const warnings = Array.isArray(plan.warnings) ? plan.warnings : []
  return `<div class="step">
    <h3><span class="no">3</span>预览（计划模式，还没写盘）</h3>
    <div class="result-kv">
      <span><b>${plan.importable ?? items.length}</b> 可导入</span>
      <span><b>${plan.skippedCount ?? skipped.length}</b> 跳过</span>
      <span class="count">扫描 ${plan.scanned ?? '—'} 个文件 · ${plan.mode === 'plan' ? 'dryRun' : plan.mode}</span>
    </div>
    ${groupHtml || '<div class="count">没有可导入的文件。</div>'}
    ${skipped.length ? `<div class="plan-group"><h4>跳过<span class="cnt">${skipped.length}</span></h4><div class="plan-files">${skipped.slice(0, 30).map((item) => `<div>${esc(item.source || item.name || '?')} — ${esc(item.reason || '')}</div>`).join('')}</div></div>` : ''}
    ${warningsHtml(warnings)}
    <div class="row">
      <button class="btn-primary" data-action="import-run"${state.impo.running ? ' disabled' : ''}>${state.impo.running ? '导入中…' : '执行导入'}</button>
      <span class="count">核对上面的 target 再落盘；写不进的逐条记账，不中断其余文件。</span>
    </div>
  </div>`
}

function reportHtml(report) {
  const written = Array.isArray(report.written) ? report.written : []
  const failures = Array.isArray(report.writeFailures) ? report.writeFailures : []
  return `<div class="step">
    <h3><span class="no">✓</span>导入完成</h3>
    <div class="result-kv">
      <span><b>${report.createdCount ?? 0}</b> 新建</span>
      <span><b>${report.reusedCount ?? 0}</b> 同内容复用</span>
      <span class="${failures.length ? 'bad' : ''}"><b>${failures.length || (report.failedCount ?? 0)}</b> 失败</span>
      <span><b>${report.skippedCount ?? 0}</b> 跳过</span>
    </div>
    ${written.length ? `<div class="plan-group"><h4>落盘清单<span class="cnt">${written.length}</span></h4><div class="plan-files">${written.slice(0, 40).map((item) => `<div>${esc(item.target || item.source)}${item.reused ? '（同内容，未重写）' : ''}</div>`).join('')}</div></div>` : ''}
    ${failures.length ? `<div class="plan-group"><h4>写失败<span class="cnt">${failures.length}</span></h4><div class="plan-files">${failures.slice(0, 20).map((item) => `<div>${esc(item.target || item.source || '?')} — ${esc(item.reason || '')}</div>`).join('')}</div></div>` : ''}
    <div class="repair-actions">
      <button class="btn-primary" data-action="import-open" data-root="${esc(report.targetRoot ?? '')}">打开这个库</button>
      <button class="btn-ghost" data-action="import-again">再导一批</button>
    </div>
  </div>`
}

function repairHtml() {
  const repair = state.repair
  if (!repair) return needLibraryHtml()
  const verdict = repair.verdict
  let actions = ''
  if (verdict.action === 'create-here') {
    actions = `<div class="repair-actions"><button class="btn-primary" data-action="repair-create">在这里新建库</button></div>`
  } else if (verdict.action === 'import-here') {
    actions = `<div class="repair-actions">
        <button class="btn-primary" data-action="repair-import">导入这个文件夹</button>
        <button class="btn-ghost" data-action="repair-create">或者旁边建个新库存它</button>
      </div>
      <p class="sub" style="margin-top:10px">导入需要一个已登记的库当目标：先「在这里新建库」再导，或回「库管理」选别的目标。</p>`
  } else if (verdict.action === 'pick-primary') {
    actions = `<div class="big-opts" style="margin-top:12px">
        ${PRIMARY_CHOICES.map((choice) => `<button class="big-opt" data-action="repair-primary" data-id="${esc(choice.id)}"><b>${esc(choice.title)}</b><span>${esc(choice.detail)}</span></button>`).join('')}
      </div>
      <p class="sub" style="margin-top:10px">选完连骨架一起落盘（依赖闭包装不齐会拒绝）。其余载体主模块在 Pinax 里选。</p>`
  }
  return `<div class="repair-card">
    <h2>${esc(verdict.title)}</h2>
    <p class="detail">${esc(verdict.detail)}</p>
    <p class="path">${esc(repair.path)}</p>
    ${errorHtml()}
    ${actions}
    ${verdict.action ? '' : '<p class="sub">这个形态 OpenStory 修不了：按下面的技术详情看原因，或回 Pinax 处理。</p>'}
    <div class="raw-detail">形态：${esc(JSON.stringify(repair.shape))}</div>
    <div class="repair-actions"><button class="btn-ghost" data-action="flow-back">← 库管理</button></div>
  </div>`
}

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

/* ---------- 业务页扩展（OS-8：动态页签＋目录工作面＋推演页）---------- */

// 目录名 → 页签标签（与 Pinax 载体骨架同源；认不出的目录不上页签——不谎报工作面）。
const DIR_LABELS = {
  正文: '正文', 世界书: '世界书', 大纲: '大纲', 构思: '构思', 资料: '资料', 约束: '约束',
  剧本: '剧本', 人物: '人物', 场景: '场景', 素材: '素材', 漫画: '漫画', 视频: '视频',
  体验: '体验', 联机: '联机', 日志: '日志', 文档: '文档'
}
const DIR_ORDER = ['正文', '世界书', '大纲', '构思', '资料', '约束', '剧本', '人物', '场景', '素材', '漫画', '视频', '体验', '联机', '日志', '文档']
const READONLY_DIRS = new Set(['日志'])
const PAGE_TO_DIR_LOCAL = Object.freeze({ write: '正文', entries: '世界书', worldbook: '世界书', outline: '大纲', notes: '构思', material: '资料', dossier: '资料', script: '剧本', comic: '漫画', wiki: 'Wiki' })

/**
 * 页签栏（OS-36）。
 * 作者口径：「上面的这些正文/世界书/大纲/产物，它应该能删除，也应该能添加」。
 *  × ＝只把这个页签收起来，磁盘上的目录和稿子一个字节都不动；在「＋」里能再勾回来。
 *  ＋ ＝列出库里所有还没显示的目录可勾选，也能现场新建一个目录。
 * 全部是每库本机偏好（localStorage，按库路径分键），不写进 .pinax，不动任何稿子。
 */
const TAB_HIDE_KEY = (root) => `openstory-tab-hidden::${root || ''}`

/**
 * 默认收起种子（OS-48）：大纲/构思/资料/约束的定位已被「参考」覆盖，
 * 作者没表过态（localStorage 键不存在）时默认不出这四个页签。
 * 只作种子不落盘——作者一旦在「＋」里勾回或再收起，以作者的选择为准。
 */
const DEFAULT_HIDDEN_TABS = Object.freeze(['dir:大纲', 'dir:构思', 'dir:资料', 'dir:约束'])

/** 关掉的页签集合（按库分键）。dirsPage 记的是页签名（write/entries/dir:xxx/artifacts/wiki/deduce）。 */
function hiddenTabs() {
  const root = state.current?.path || ''
  if (!state.tabHidden) state.tabHidden = {}
  if (!state.tabHidden[root]) {
    let saved = null
    try {
      const raw = localStorage.getItem(TAB_HIDE_KEY(root))
      if (raw !== null) saved = JSON.parse(raw)
    } catch { saved = [] }
    // 键不存在＝作者从未表态 → 用默认种子（不写回，尊重作者后续选择）
    state.tabHidden[root] = Array.isArray(saved) ? saved : [...DEFAULT_HIDDEN_TABS]
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
  try { localStorage.setItem(TAB_HIDE_KEY(root), JSON.stringify([...set])) } catch { /* 隐私模式 */ }
  // 关掉当前正在看的页签 → 退到第一个还开着的
  if (hidden && state.view === view) {
    const next = state.current ? (state.libDirs.includes('正文') ? 'write' : 'entries') : 'libraries'
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
  if (!state.current) return
  const hidden = hiddenTabs()
  const libDirs = state.libDirs
  // 内置页签（有独立视图，不一定是目录）
  const builtins = [
    { view: 'artifacts', label: '产物', need: null },
    { view: 'write', label: '正文', need: '正文' },
    { view: 'entries', label: '条目', need: '世界书' },
    { view: 'wiki', label: 'Wiki', need: null },
    { view: 'deduce', label: '推演', need: null }
  ]
  const builtinRows = builtins
    .filter((item) => (item.need ? libDirs.includes(item.need) : true))
    .map((item) => {
      const off = hidden.has(item.view)
      return `<button class="tab-pick${off ? '' : ' on'}" data-action="tab-toggle-pick" data-tab-view="${esc(item.view)}">
        <span class="tp-check">${off ? '' : '✓'}</span><b>${esc(item.label)}</b></button>`
    }).join('')
  // 目录型页签
  const dirRows = libDirs
    .filter((dir) => dir !== '正文' && dir !== '世界书')
    .sort((left, right) => DIR_ORDER.indexOf(left) - DIR_ORDER.indexOf(right))
    .map((dir) => {
      const view = `dir:${dir}`
      const off = hidden.has(view)
      const known = Boolean(DIR_LABELS[dir])
      return `<button class="tab-pick${off ? '' : ' on'}" data-action="tab-toggle-pick" data-tab-view="${esc(view)}">
        <span class="tp-check">${off ? '' : '✓'}</span><b>${esc(DIR_LABELS[dir] || dir)}</b>${known ? '' : '<span class="tp-note">未识别</span>'}</button>`
    }).join('')
  // 磁盘上有、但没在任何页签里的目录（比如「出图」）也列出来——这是「加页签」的主用途之一
  openModal(`
    <h3>增加页签</h3>
    <p class="sub">勾上就会出现在顶栏；取消勾选只是收起页签，磁盘上的文件和稿子不受影响。</p>
    <div class="tab-pick-sec"><h4>常用</h4><div class="tab-pick-grid">${builtinRows}</div></div>
    <div class="tab-pick-sec"><h4>库里已有目录</h4><div class="tab-pick-grid">${dirRows || '<span class="count">没有其它目录</span>'}</div></div>
    <div class="tab-pick-sec"><h4>新建目录</h4>
      <div class="row" style="display:flex;gap:8px;align-items:center">
        <input id="tab-new-dir" placeholder="例如：分镜" style="flex:1">
        <button class="btn-primary" data-action="tab-create-dir">建目录并加页签</button>
      </div>
      <div class="err" id="tab-add-err"></div>
    </div>
    <div class="ops"><button class="btn-ghost" data-action="modal-close">关闭</button></div>
  `)
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

function renderTabs() {
  const tabsEl = document.getElementById('tabs')
  if (!tabsEl) return
  const hidden = state.current ? hiddenTabs() : new Set()
  const defs = []
  if (state.current) {
    // OS-12：页签首格固定＝产物中心（产出物＋多版本＋历史）；「库」上移顶栏。
    defs.push({ view: 'artifacts', label: '产物', ic: '产', closable: true })
    // OS-19：正文/世界书也走 libDirs 判断——体裁声明后（如短故事）就不出世界书页签
    const libDirs = state.libDirs
    const hasDir = (name) => libDirs.includes(name)
    const excluded = new Set((state.briefGenre?.excludedPages ?? []).map((page) => PAGE_TO_DIR_LOCAL[page] ?? page))
    if (!state.brief || hasDir('正文')) defs.push({ view: 'write', label: '正文', ic: '章', closable: true })
    // OS-48：这个页签暴露的其实是 fact 拆解条目（真源 拆解/*.json），改名「条目」消除与世界书目录/参考的定位混淆
    if (!state.brief || hasDir('世界书')) defs.push({ view: 'entries', label: '条目', ic: '条', closable: true })
    const extra = libDirs
      // 作者要求页签可自选：库里任何顶层目录都能出页签（不再只认 DIR_LABELS 里的名单）
      .filter((dir) => dir !== '正文' && dir !== '世界书' && !excluded.has(dir))
      .sort((left, right) => {
        const li = DIR_ORDER.indexOf(left)
        const ri = DIR_ORDER.indexOf(right)
        return (li === -1 ? 99 : li) - (ri === -1 ? 99 : ri)
      })
      .map((dir) => ({
        // 参考目录（OS-44）走专门的笔记系统页，不是通用文本页
        view: dir === '参考' ? 'reference' : `dir:${dir}`,
        label: dir === '参考' ? '参考' : (DIR_LABELS[dir] || dir),
        ic: dir === '参考' ? '参' : (DIR_LABELS[dir] || dir).slice(0, 1),
        readonly: READONLY_DIRS.has(dir),
        closable: true
      }))
    defs.push(...extra)
    if (!excluded.has('Wiki')) defs.push({ view: 'wiki', label: 'Wiki', ic: 'W', closable: true })
    defs.push({ view: 'deduce', label: '推演', ic: '推', closable: true })
  }
  // 设置是一个可关闭的页签（OS-32）：跟正文/产物同级，打开才出现，× 关掉回到原页
  if (state.settings.open) defs.push({ view: 'settings', label: '设置', ic: '设', closable: true })
  const visible = defs.filter((def) => !hidden.has(def.view))
  const tabHtml = visible.map((def) => `<button class="tab${state.view === def.view ? ' on' : ''}" data-view="${esc(def.view)}"><span class="ic">${esc(def.ic)}</span>${esc(def.label)}${def.readonly ? '<span class="pill">只读</span>' : ''}${def.closable ? `<span class="tab-x" data-action="${def.view === 'settings' ? 'settings-close' : 'tab-hide'}" data-tab-view="${esc(def.view)}" title="收起这个页签（不动磁盘上的东西）">×</span>` : ''}</button>`).join('')
  // 末尾「＋」：加回被收起的页签，或新建目录
  const addBtn = state.current ? '<button class="tab tab-add" data-action="tab-add-open" title="增加页签">＋</button>' : ''
  tabsEl.innerHTML = tabHtml + addBtn
}

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

function dirViewHtml(dir) {
  if (!state.current) return needLibraryHtml()
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


/* ---------- 推演引擎（OS-29）：接 Pinax fact 推演链 ---------- */

/** 呈现一拍：局面卡＋候选（引擎确定性，不需要模型）。 */
async function deduceEnginePresent(opts) {
  const options = opts || {}
  if (!state.current) return
  const engine = state.deduce.engine
  const povInput = document.getElementById('deduce-pov')
  const seedInput = document.getElementById('deduce-seed')
  if (povInput) engine.pov = povInput.value.trim()
  if (seedInput) engine.seed = seedInput.value.trim()
  engine.busy = true
  engine.error = ""
  render()
  try {
    const payload = await api("/api/deduce/present", {
      method: "POST",
      body: JSON.stringify({
        root: state.current.path,
        bookId: state.bookId || "default",
        pov: engine.pov || undefined,
        seed: engine.seed === "" ? undefined : Number(engine.seed),
        reset: options.reset === true
      })
    })
    engine.data = payload
    engine.hint = opts && opts.hint ? opts.hint : ""
  } catch (error) {
    engine.error = (error && error.code ? error.code + " · " : "") + text((error && error.message) || error)
    engine.data = null
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
        bookId: state.bookId || "default",
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
    openSettingsModal('先配好模型端点再推演。')
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

/** 本库拆解里的角色名（推演 POV 自动补全用；读不到就返回空，不影响手动输入）。 */
function characterNames() {
  try {
    const list = state.entries
    if (!Array.isArray(list) || !list.length) return []
    return [...new Set(list
      .filter((entry) => entry.layer === 'character' && entry.name)
      .map((entry) => String(entry.name).trim())
      .filter(Boolean))].slice(0, 40)
  } catch { return [] }
}

/** 进推演页时补一次拆解条目（只为 POV 候选；失败静默，不拦推演）。 */
let deduceEntriesTried = false
async function ensureEntriesForDeduce() {
  if (deduceEntriesTried || !state.current) return
  deduceEntriesTried = true
  if (state.entries.length) return
  try {
    const query = new URLSearchParams({ root: state.current.path, offset: '0', limit: '500' })
    const payload = await api(`/api/entries?${query.toString()}`)
    const incoming = Array.isArray(payload.entries) ? payload.entries : []
    if (incoming.length) {
      state.entries = incoming
      state.total = Number(payload.total) || incoming.length
      if (state.view === 'deduce') render()
    }
  } catch { /* 没拆解条目＝推演本来就开不了局，这里只是补 POV 候选 */ }
}

function deduceHtml() {
  const deduce = state.deduce
  if (!state.current) return needLibraryHtml()
  const engine = deduce.engine
  const tabs = `<span class="subtabs">
      <button class="chip${deduce.mode === 'engine' ? ' on' : ''}" data-action="deduce-mode-engine" title="确定性推演引擎（种子化 2d6，不需要模型）">引擎</button>
      <button class="chip${deduce.mode === 'agent' ? ' on' : ''}" data-action="deduce-mode-agent" title="Agent 分支推理（需要模型）">Agent</button>
    </span>`
  const head = `<div class="doc-head">
      <div class="kick">${esc(state.current.name)} / 推演</div>
      <div class="doc-line-row"><h1>推演</h1>${tabs}</div>
      <div class="doc-meta">
        <span class="b">${deduce.mode === 'engine' ? '事实推演引擎' : 'Agent 推演'}</span>
        ${deduce.mode === 'engine' ? '<span class="count">局面卡＋三层候选（必然/命运/戏剧）· 种子化确定性</span>' : ''}
        ${deduce.mode === 'agent' && deduce.sessionId ? '<span class="count">推演会话已建——卡在左列会话里采纳</span>' : ''}
      </div>
    </div>`
  if (deduce.mode === 'agent') return head + deduceAgentHtml()
  return head + deduceEngineHtml()
}

/** 引擎模式：局面卡＋候选列表＋张力/前线。 */
function deduceEngineHtml() {
  const engine = state.deduce.engine
  const data = engine.data
  const controls = `<div class="toolbar">
      <input class="file-input" id="deduce-pov" list="deduce-pov-list" placeholder="POV 角色（可选）" value="${esc(engine.pov)}">
      <datalist id="deduce-pov-list">${characterNames().map((name) => `<option value="${esc(name)}"></option>`).join('')}</datalist>
      <input class="file-input" id="deduce-seed" placeholder="种子（留空＝随机，可复现）" value="${esc(engine.seed)}">
      <button class="btn-primary" data-action="deduce-engine-present"${engine.busy ? ' disabled' : ''}>${engine.busy ? '推演中…' : data ? '再推一拍' : '开始推演'}</button>
      ${data ? '<button class="btn-ghost" data-action="deduce-engine-reset">重新开局</button>' : ''}
    </div>`
  if (!data) {
    return `${controls}
      ${flowError(engine.error || '')}
      ${engine.hint ? `<div class="warn-box">${esc(engine.hint)}</div>` : ''}
      <div class="empty-state">
        <h2>事实推演引擎</h2>
        <p>读本库的拆解条目（worldview/角色/剧情）作为事实包，推出一拍局面与三层候选：<br>
        <b>必然</b>（世界事实推导）· <b>命运</b>（种子化 2d6 检定）· <b>戏剧</b>（需模型，可选）。</p>
        <p class="sub">引擎是确定性的：同一个种子＋同一份事实包＝同一拍。</p>
      </div>`
  }
  const card = data.sceneCard ?? {}
  const tension = data.tension ?? {}
  const candidates = Array.isArray(data.candidates) ? data.candidates : []
  const fronts = Array.isArray(data.fronts) ? data.fronts : []
  const sourceBadge = { 必然: 'certain', 命运: 'fate', 戏剧: 'drama' }
  const rows = candidates.map((candidate) => {
    const kind = sourceBadge[candidate.source] || 'other'
    const trace = candidate.trace && candidate.trace.sum !== undefined
      ? `2d6=${candidate.trace.a}+${candidate.trace.b}=${candidate.trace.sum}（${candidate.trace.success ? '顺遂' : '受阻'}）`
      : ''
    return `<div class="cand-row src-${kind}">
      <div class="cand-main">
        <span class="cand-badge">${esc(candidate.source || '候选')}</span>
        <span class="cand-text">${esc(candidate.text)}</span>
        ${trace ? `<span class="cand-trace">${esc(trace)}</span>` : ''}
        ${candidate.refs && candidate.refs.length ? `<span class="count">引用：${esc(candidate.refs.join('、'))}</span>` : ''}
      </div>
      <div class="cand-ops">
        <button class="btn-ghost" data-action="deduce-engine-choose" data-candidate-id="${esc(candidate.id)}">选这条</button>
        <button class="issue-act" data-action="deduce-engine-veto" data-candidate-id="${esc(candidate.id)}">否决</button>
      </div>
    </div>`
  }).join('')
  return `${controls}
    ${flowError(engine.error || '')}
    ${engine.hint ? `<div class="warn-box">${esc(engine.hint)}</div>` : ''}
    <div class="deduce-engine-grid">
      <div class="step">
        <h3>第 ${esc(data.round)} 拍 · 局面卡</h3>
        <div class="scene-card">
          <div><span class="k">在场</span><span class="v">${esc((card.who || []).join('、') || '—')}</span></div>
          <div><span class="k">地点</span><span class="v">${esc(card.where || '—')}</span></div>
          <div><span class="k">张力</span><span class="v">${esc(card.tension || '—')}</span></div>
          <div><span class="k">钩子</span><span class="v">${esc(card.hook || '—')}</span></div>
        </div>
        <div class="count" style="margin-top:8px">种子 ${esc(data.seed)} · 张力档 ${esc(tension.level ?? '—')} · AI 预算 ${esc((data.budget && data.budget.used) ?? 0)}/${esc((data.budget && data.budget.max) ?? 8)}</div>
        ${fronts.length ? `<h4 style="margin:14px 0 6px;font-size:12px;color:var(--meta)">前线（world 压力）</h4>${fronts.map((front) => `<div class="front-row"><span>${esc(front.name)}</span><span class="front-bar"><span style="width:${Math.min(100, Math.round((front.value / Math.max(1, front.max)) * 100))}%"></span></span><span class="count">${front.value}/${front.max}</span></div>`).join('')}` : ''}
      </div>
      <div class="step">
        <h3>候选 <span class="count">${candidates.length}</span></h3>
        ${rows || '<p class="sub">这一拍没有候选：检查事实包是否够（worldview/角色/剧情）。</p>'}
        <p class="sub" style="margin-top:10px">选择会结算成事件条目（不自动写库）；「否决」只记账不落库。</p>
      </div>
    </div>`
}

/** Agent 模式（原三栏表单，保留）。 */
function deduceAgentHtml() {
  const deduce = state.deduce
  return `${flowError(deduce.error)}
    <div class="deduce-grid">
      <div class="step">
        <h3><span class="no">1</span>前提（设定为真）</h3>
        <textarea class="deduce-input" id="deduce-premise" placeholder="目前故事走到哪、哪些设定是铁的…">${esc(deduce.premise)}</textarea>
        <h3><span class="no">2</span>变量（每行一个可能拨动的开关）</h3>
        <textarea class="deduce-input" id="deduce-variables" placeholder="林砚知道真相&#10;大雾提前散了">${esc(deduce.variables)}</textarea>
        <h3><span class="no">3</span>要推演的问题</h3>
        <input id="deduce-question" placeholder="如果林砚选择沉默，第 3 章会走向哪里？" value="${esc(deduce.question)}">
        <div class="row" style="display:flex;gap:10px;margin-top:12px;align-items:center">
          <button class="btn-primary" data-action="deduce-start"${deduce.streaming || !agent.configured ? ' disabled' : ''}>${deduce.streaming ? '推演中…' : '开始推演'}</button>
          <button class="btn-ghost" data-action="deduce-stop"${deduce.streaming ? '' : ' hidden'}>停止</button>
          ${!agent.configured ? '<span class="count">先在右上角设置里配好模型端点。</span>' : '<span class="count">Agent 分支推理；产出经待确认卡落正文。</span>'}
        </div>
      </div>
      <div class="step">
        <h3><span class="no">→</span>推演回答</h3>
        <div class="deduce-reply">${deduce.reply ? esc(deduce.reply) : (deduce.streaming ? '推演中…' : '填好左边三段，点「开始推演」。回答可整段转成待确认卡，采纳后写进正文。')}</div>
        ${deduce.reply && !deduce.streaming ? '<div class="repair-actions"><button class="btn-primary" data-action="deduce-card">转为待确认卡（写正文）</button></div>' : ''}
      </div>
    </div>`
}

/* ---------- 数据加载 ---------- */

async function boot() {
  // 运行时清单与 config 一起拉：chip 要能显示「DSH 原生」这类具体名字，不能等进设置页才加载
  await Promise.all([bootAgentConfig(), loadAgentRuntimes()])
  updateAgentChip()
  loadSuites()
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
  const library = state.libraries.find((item) => item.path === path)
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
  state.entries = []
  state.total = 0
  state.entryWarnings = []
  state.entry = null
  state.entryRevision = null
  deduceEntriesTried = false // 换库了：POV 候选要重新拉
  state.books = []
  state.bookId = ''
  state.wiki = null
  state.wikiFrom = null
  state.wikiLoaded = false
  state.chapterFiles = []
  state.chapterFile = ''
  state.chapterText = ''
  state.chapterLoaded = false
  state.chapterNote = ''
  state.savedAt = ''
  state.layerFilter = ''
  state.search = ''
  state.error = ''
  state.view = 'entries'
  // OS-8/10：按库扫描顶层目录（动态页签）＋章节清单（正文工作面）＋文件直列（转卡兜底）。
  state.libDirs = []
  state.dirWork = {}
  state.write = { chapters: [], listLoading: false }
  state.deduce = {
    premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '',
    mode: 'engine',
    engine: { busy: false, data: null, pov: '', seed: '', error: '', hint: '' }
  }
  state.chapterFiles = []
  try {
    const [topPayload, chapterList, chaptersPayload] = await Promise.all([
      api(`/api/files?root=${encodeURIComponent(path)}`),
      api(`/api/files?root=${encodeURIComponent(path)}&dir=${encodeURIComponent('正文')}`).catch(() => null),
      api(`/api/chapters?root=${encodeURIComponent(path)}&dir=${encodeURIComponent('正文')}`).catch(() => null)
    ])
    state.libDirs = Array.isArray(topPayload.dirs) ? topPayload.dirs : []
    // OS-19：体裁声明后按 excludedPages 裁剪页签（未声明＝不裁剪，保持 OS-8 行为）
    try {
      const briefPayload = await api(`/api/brief?root=${encodeURIComponent(path)}`)
      state.brief = briefPayload.brief ?? null
      state.briefGenre = briefPayload.genre ?? null
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
  await ensureEntries()
  await loadSessions()
  // 默认会话：接着这个库上次那条聊（OS-39），不用手动去下拉里点
  await restoreAgentSession()
  renderAgent()
}

async function ensureEntries({ append = false } = {}) {
  if (!state.current) return
  if (!append && state.entries.length > 0) return
  state.loading = true
  state.error = ''
  render()
  try {
    const query = new URLSearchParams({
      root: state.current.path,
      offset: String(append ? state.entries.length : 0),
      limit: '500'
    })
    const payload = await api(`/api/entries?${query.toString()}`)
    const incoming = Array.isArray(payload.entries) ? payload.entries : []
    state.entries = append ? [...state.entries, ...incoming] : incoming
    state.total = Number(payload.total) || 0
    state.entryWarnings = Array.isArray(payload.warnings) ? payload.warnings : []
    state.books = collectBooks(state.entries)
    if (!state.bookId && state.books.length) state.bookId = state.books[0].bookId
    // 正文候选：OS-8 起以 filesGet 直列为主，拆解 sources 只在直列空时兜底。
    if (!state.chapterFiles.length) state.chapterFiles = collectChapterFiles(state.entries)
    if (!state.chapterFile && state.chapterFiles.length) state.chapterFile = state.chapterFiles[0]
  } catch (error) {
    rememberError(error)
  }
  state.loading = false
  render()
}

function collectBooks(entries) {
  const byId = new Map()
  for (const entry of entries) {
    const bookId = text(entry.bookId).trim()
    if (!bookId) continue
    const found = byId.get(bookId)
    if (found) found.count += 1
    else byId.set(bookId, { bookId, bookName: text(entry.bookName).trim() || bookId, count: 1 })
  }
  return [...byId.values()]
}

/** 正文候选：拆解条目的 sources[].sourceId（通常是 `正文/<file>`）。 */
function collectChapterFiles(entries) {
  const files = new Set()
  for (const entry of entries) {
    const sources = Array.isArray(entry?.sources) ? entry.sources : []
    for (const source of sources) {
      const id = text(source?.sourceId).trim()
      if (!id) continue
      if (id.startsWith('正文/') || /\.(md|txt)$/iu.test(id)) files.add(id)
    }
  }
  return [...files].sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))
}

async function openEntry(id) {
  state.loading = true
  state.error = ''
  render()
  try {
    const payload = await api(`/api/entry?${new URLSearchParams({ root: state.current.path, id }).toString()}`)
    state.entry = payload.entry
    state.entryRevision = payload.revision
  } catch (error) {
    rememberError(error)
  }
  state.loading = false
  render()
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

async function ensureWiki({ force = false } = {}) {
  if (!state.current) return
  if (state.wikiLoaded && !force) return
  const bookId = state.bookId || collectBooks(state.entries)[0]?.bookId || ''
  if (!bookId) {
    state.wikiLoaded = true
    render()
    return
  }
  state.bookId = bookId
  state.loading = true
  state.error = ''
  render()
  try {
    const payload = await api(`/api/wiki?${new URLSearchParams({ root: state.current.path, bookId }).toString()}`)
    state.wiki = payload.wiki ?? null
    state.wikiFrom = payload.derivedFrom ?? null
    state.wikiLoaded = true
  } catch (error) {
    rememberError(error)
  }
  state.loading = false
  render()
}

async function deriveWiki() {
  if (!state.current || !state.bookId) return
  state.loading = true
  state.error = ''
  render()
  try {
    const operationId = `openstory-derive-${state.bookId}-${globalThis.crypto?.randomUUID?.() ?? Date.now()}`
    const payload = await api('/api/wiki/derive', {
      method: 'POST',
      body: JSON.stringify({ root: state.current.path, bookId: state.bookId, operationId })
    })
    state.wiki = payload.wiki ?? null
    state.wikiFrom = payload.derivedFrom ?? null
    state.wikiLoaded = true
  } catch (error) {
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
    state.settings.prevView = state.view && state.view !== 'settings' ? state.view : (state.current ? 'write' : 'libraries')
  }
  state.settings.helpOpen = false
  go('settings')
}

function closeSettingsTab() {
  state.settings.open = false
  state.settings.helpOpen = false
  const back = state.settings.prevView || (state.current ? 'write' : 'libraries')
  state.settings.prevView = ''
  state.view = back === 'settings' ? (state.current ? 'write' : 'libraries') : back
  render()
}

function go(view) {
  state.error = ''
  if (view.startsWith('dir:')) {
    openDirWork(view.slice(4))
    return
  }
  const flowPage = view === 'lib-create' || view === 'lib-import'
  const globalPage = view === 'settings' || view === 'deduce' || view === 'libraries'
  if (view !== 'libraries' && !flowPage && !globalPage && !state.current) {
    state.view = 'libraries'
    render()
    return
  }
  // 点页签进设置就算「打开」；切到别的页签不关闭它（真页签常驻，直到点 ×）
  if (view === 'settings') state.settings.open = true
  state.view = view
  if (view === 'entries') state.entry = null
  render()
  if (view === 'settings') {
    // 先并行拉数据，全部回来再渲染一次（否则先完成的 render 会用旧 state 覆盖）
    Promise.all([loadAgentRuntimes(), loadStyles(), loadSuites(), loadKbStatus(), loadDshReasoningOptions()])
      .then(() => { if (state.view === 'settings') render() })
      .catch(() => render())
    return
  }
  if (view === 'reference') {
    // 参考页：拉索引，并预挂载模块
    loadReferences().then(() => { if (state.view === 'reference') render() }).catch(() => {})
    loadRefModule().then(() => { if (state.view === 'reference') render() }).catch(() => {})
    return
  }
  if (view === 'deduce') {
    ensureEntriesForDeduce() // POV 候选：有拆解就补上角色名
    return
  }
  if (view === 'artifacts') {
    openArtifacts()
    return
  }
  if (view === 'write') {
    // 章节工作面自带清单（不再依赖拆解）；有当前章且在清单里就自动载入。
    loadWriteChapters().then(() => {
      if (!state.chapterLoaded && state.chapterFile && state.write.chapters.some((chapter) => chapter.file === state.chapterFile)) {
        loadChapter(state.chapterFile)
      }
    })
    // 左栏图谱与参考索引：写小说时要能看到关联的参考（OS-45）。
    // 注意 loadReferences 有「已加载就短路」的分支，所以图谱要单独保证被拉一次——
    // 否则从参考页切回正文时，索引已缓存但图谱还是空的。
    Promise.resolve()
      .then(() => loadReferences())
      .then(() => loadRefGraph())
      .catch(() => {})
    return
  }
  if (view === 'entries') ensureEntries()
  const needsEntries = view === 'wiki' && state.current && state.entries.length === 0
  if (needsEntries) {
    ensureEntries().then(() => {
      if (state.view === 'wiki') ensureWiki()
    })
    return
  }
  if (view === 'wiki') ensureWiki()
}

document.addEventListener('click', (event) => {
  const target = event.target.closest('[data-view], [data-go], [data-action], [data-skin], [data-lib-path], [data-entry-id], [data-layer], [data-kind], [data-load-more], [data-session-id], [data-session-del], [data-wiki-mode], [data-create-primary], [data-create-genre], [data-runtime-id], [data-chapter-file], [data-settings-section], [data-ref-path], [data-ref-tag], [data-ref-view], a.wl[data-ref]')
  if (!target) return

  if (target.dataset.createGenre !== undefined) {
    state.create.genre = target.dataset.createGenre
    state.create.length = null
    render()
    return
  }

  if (target.dataset.settingsSection) {
    state.settings.section = target.dataset.settingsSection
    state.settings.helpOpen = false
    render()
    return
  }

  if (target.dataset.skin) {
    setSkin(target.dataset.skin)
    return
  }

  // 双链点击（OS-44）：[[某参考]] 在正文或参考页里都能点开
  const wl = event.target.closest?.('a.wl[data-ref]')
  if (wl) {
    event.preventDefault()
    const ref = text(wl.dataset.ref).trim()
    if (!ref) return
    // 目录型目标（正文/剧本/…）→ 跳对应工作面
    if (/^(?:正文|剧本|人物|场景|大纲|素材|漫画|视频|体验|联机|资料|约束|构思)[\\/]/u.test(ref)) {
      if (ref.startsWith('正文/')) { loadChapter(ref); go('write'); return }
      const dir = ref.split('/')[0]
      if (state.libDirs.includes(dir)) { go(`dir:${dir}`); return }
      return
    }
    // 条目链接
    const entry = /^条目[:：](.+)$/u.exec(ref)
    if (entry) { openEntry(entry[1].trim()); go('entries'); return }
    // 否则当参考笔记：先按标题找，再按路径找
    const notes = state.reference.notes || []
    const hit = notes.find((note) => note.title === ref)
      || notes.find((note) => note.rel.replace(/\.(?:md|markdown|txt)$/iu, '') === ref)
      || notes.find((note) => note.path === ref || note.path.endsWith(`/${ref}.md`))
    if (hit) {
      state.reference.activePath = hit.path
      if (state.view !== 'reference') go('reference')
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
    state.reference.view = target.dataset.refView || 'note'
    state.reference.focus = null
    if (state.reference.view === 'graph' && !state.refCol.graph) loadRefGraph()
    render()
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

  if (target.dataset.wikiMode !== undefined) {
    state.wikiMode = target.dataset.wikiMode
    render()
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
  if (target.dataset.entryId) {
    openEntry(target.dataset.entryId)
    return
  }
  if (target.dataset.layer !== undefined) {
    state.layerFilter = target.dataset.layer
    render()
    return
  }
  if (target.dataset.loadMore !== undefined) {
    ensureEntries({ append: true })
    return
  }
  const action = target.dataset.action
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
  } else if (action === 'settings-help-toggle') {
    state.settings.helpOpen = !state.settings.helpOpen
    render()
  } else if (action === 'toggle-palette') {
    document.getElementById('palette').classList.toggle('open')
  } else if (action === 'back-entries') {
    state.entry = null
    render()
  } else if (action === 'load-chapter') {
    const input = document.getElementById('chapter-file')
    loadChapter(input?.value || state.chapterFile)
  } else if (action === 'save-chapter') {
    saveChapter()
  } else if (action === 'derive-wiki') {
    deriveWiki()
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
  } else if (action === 'ref-edit') {
    state.reference.editing = true
    state.reference.draft = text(state.reference.note?.text)
    render()
  } else if (action === 'ref-cancel-edit') {
    state.reference.editing = false
    render()
  } else if (action === 'ref-save') {
    saveReferenceNote()
  } else if (action === 'ref-to-agent') {
    sendReferenceToAgent()
  } else if (action === 'ref-absorb') {
    openAbsorbModal()
  } else if (action === 'ref-absorb-run') {
    runAbsorbFromModal()
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
    deduceEnginePresent({})
  } else if (action === 'deduce-engine-reset') {
    deduceEnginePresent({ reset: true, hint: '新开了推演会话' })
  } else if (action === 'deduce-engine-choose') {
    deduceEngineSettle(target.dataset.candidateId, 'choose')
  } else if (action === 'deduce-engine-veto') {
    deduceEngineSettle(target.dataset.candidateId, 'veto')
  } else if (action === 'deduce-mode-engine') {
    state.deduce.mode = 'engine'
    render()
  } else if (action === 'deduce-mode-agent') {
    state.deduce.mode = 'agent'
    render()
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
    renderAgent()
  } else if (action === 'analyze-toggle') {
    toggleAnalyzePanel()
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
    closeModal() // 版本历史会跳到产物中心，面板得先收
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
    state.settings.section = 'suite'
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
  if (target.id === 'wiki-book') {
    state.bookId = target.value
    state.wiki = null
    state.wikiLoaded = false
    ensureWiki({ force: true })
  }
})

document.addEventListener('input', (event) => {
  const target = event.target
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
    // 参考侧栏搜索（OS-48）：只换笔记组，不打断输入焦点
    state.reference.q = target.value
    const group = document.querySelector('.ref-nav .nav-group.grow')
    if (group && refModule) {
      group.outerHTML = refModule.refNotesGroupHtml({
        notes: state.reference.notes,
        activeTag: state.reference.activeTag,
        activePath: state.reference.activePath,
        q: state.reference.q
      })
    }
    return
  }
  if (target.id === 'entry-search') {
    state.search = target.value
    const list = document.querySelector('.entry-list')
    if (list) {
      const rows = visibleEntries().map((entry) => `<button class="entry-row" data-entry-id="${esc(entry.id)}">
        <span class="nm">${esc(entryDisplayName(entry))}</span>
        <span class="sm${entrySummary(entry) ? '' : ' empty'}">${esc(truncate(entrySummary(entry)) || '（无摘要）')}</span>
        <span class="ly">${esc(layerLabel(entry.layer))}${entry.status ? ` · ${esc(statusLabel(entry.status))}` : ''}</span>
      </button>`).join('')
      list.innerHTML = rows || '<div class="loading">没有匹配的条目</div>'
    }
    return
  }
  if (target.id === 'chapter-editor') {
    state.chapterText = target.value
    state.savedAt = ''
    const chars = document.getElementById('chapter-chars')
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
  if (event.key === 'Escape') {
    if (state.view === 'write' && state.write.mode === 'edit') { leaveDocEdit(); return }
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
  if (blockEl && state.view === 'write') commitDocBlock(blockEl)
})

// 文档内拖选文字 → 上方浮窗（润笔 / 与 Agent 讨论）
// OS-37：右键整段已是主入口；这里只服务「拖选了半句话」的场景，且落在有真实拖选时才弹。
// 注意：不要监听 scroll 收浮窗——contenteditable 聚焦会触发滚动，会把刚弹出的浮窗立刻收掉。
let selBarTimer = null
document.addEventListener('selectionchange', () => {
  if (state.view !== 'write') return
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
  if (state.view !== 'write') return
  const blockEl = event.target?.closest?.('.doc-block')
  if (!blockEl) return
  event.preventDefault() // 不要系统右键菜单
  hideSelBar()
  showParaMenu(blockEl, event.clientX, event.clientY)
})

// 左键点一行：把这一段标成「选中」（视觉高亮），但不动光标——contenteditable 里还要正常打字
document.addEventListener('click', (event) => {
  if (state.view !== 'write') return
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
  for (const option of document.querySelectorAll('.palette .opt')) {
    option.classList.toggle('on', option.dataset.skin === pack.id)
  }
}

function setSkin(id) {
  const pack = state.styles.find((item) => item.id === id)
  if (!pack) return
  applySkin(pack)
  try { localStorage.setItem('openstory-skin', id) } catch { /* 隐私模式存不了就本次有效 */ }
  // wiki 网页态的强调色跟包走，换皮即重载 iframe；设置页要刷新选中态。
  if (state.view === 'wiki' || state.view === 'settings') render()
  // 图谱是 canvas 绘制、配色取自 CSS 变量；换皮后重挂一次才能跟上新色板
  // （参考页大图是 focus 模式，正文页左栏小图是 jump 模式——按当前页分流，OS-49）
  if (document.getElementById('ref-graph-canvas')) {
    graphCleanup?.()
    graphCleanup = null
    requestAnimationFrame(() => {
      if (state.view === 'reference' && (state.reference.view || 'note') === 'graph') mountReferenceGraph()
      else mountRefGraph()
    })
  }
}

async function loadStyles() {
  try {
    const payload = await api('/api/styles')
    state.styles = Array.isArray(payload.styles) ? payload.styles : []
    state.stylesWarnings = Array.isArray(payload.warnings) ? payload.warnings : []
  } catch {
    state.styles = []
  }
}

async function loadKbStatus() {
  try {
    state.kbStatus = await api('/api/kb/status')
  } catch {
    state.kbStatus = null
  }
}

function renderPalette() {
  const opts = document.getElementById('palette-opts')
  if (!opts) return
  if (state.styles.length === 0) {
    opts.innerHTML = '<div class="count" style="padding:6px 2px">风格包清单读不到，先用内置珊瑚兜底。</div>'
    return
  }
  opts.innerHTML = state.styles.map((pack) => `<button class="opt${pack.id === state.skin ? ' on' : ''}" data-skin="${esc(pack.id)}" title="${esc(pack.source)} · ${esc(pack.id)}">
    <span class="sw" style="background:${esc(pack.tokens['--bg'] || '#fff')}"><span style="width:12px;height:12px;border-radius:50%;background:${esc(pack.tokens['--accent'] || '#333')}"></span></span>
    <span><span class="nm">${esc(pack.name)}<span class="src">${esc(pack.source)}</span></span><br><span class="ds">${esc(pack.description || '')}</span></span>
  </button>`).join('')
}

async function bootStyles() {
  await loadStyles()
  let saved = ''
  try { saved = text(localStorage.getItem('openstory-skin')) } catch { saved = '' }
  state.skin = saved
  applySkin(currentPack())
  renderPalette()
}

bootStyles()
boot()
