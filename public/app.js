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
  write: { chapters: [], listLoading: false, mode: 'read', docPrefs: null, drawerOpen: false },
  sel: { text: '', blockIndex: -1, rect: null, busy: false, preview: null },
  analyze: { open: false, result: null, busy: false, dismissed: {} },
  deduce: { premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '',
    mode: 'engine', engine: { busy: false, data: null, pov: '', seed: '', error: '', hint: '' } },
  artifacts: { root: '', groups: [], totals: null, loading: false, error: '', previewFile: '', previewText: '', previewLoading: false },
  settings: { userDir: '', section: 'plugins', suiteId: '' },
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
  if (state.view === 'libraries') viewEl.innerHTML = libraryHtml()
  else if (state.view === 'entries') viewEl.innerHTML = state.entry ? entryDetailHtml() : entriesHtml()
  else if (state.view === 'write') viewEl.innerHTML = writeHtml()
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
  const parts = blocks.map((block, index) => {
    const html = mdModule.renderMarkdown(block.text)
    return `<div class="doc-block" contenteditable="true" spellcheck="false" data-block="${index}" data-start="${block.start}" data-end="${block.end}" data-raw="${esc(block.text)}">${html}</div>`
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

/** 只重画左侧章节行（不动纸面/光标）。 */
function refreshChapterRows() {
  if (state.view !== 'write') return
  const host = document.querySelector('.chapter-rows')
  if (!host) return
  const rows = state.write.chapters.map((chapter) => `
    <button class="ch-row${chapter.file === state.chapterFile ? ' on' : ''}" data-chapter-file="${esc(chapter.file)}" title="${esc(chapter.file)}">
      <span class="no">${chapter.no !== null ? String(chapter.no).padStart(2, '0') : '—'}</span>
      <span class="tt">${esc(chapter.title)}</span>
      <span class="sz">${formatBytes(chapter.chars)}</span>
    </button>`).join('')
  host.innerHTML = rows || '<div class="count" style="padding:8px">还没有章节——右上输入标题新建第一章。</div>'
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

/** 一个块改完：按 start/end 替换源码中那一段，然后自动保存。 */
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
  bar.innerHTML = '<button data-action="sel-polish">润笔</button><button data-action="sel-discuss">与 Agent 讨论</button>'
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
  const blocks = state.write.chapters.length ? mdModule.splitBlocks(state.chapterText) : []
  const raw = blocks.map((block) => block.text)
  const index = state.sel.blockIndex
  const near = [raw[index - 1], raw[index], raw[index + 1]].filter((line) => typeof line === 'string' && line.trim())
  return near.join('\n\n')
}

/* ---------- 润笔：选区＋上下文 → Agent → 预览卡 ---------- */

async function polishSelection() {
  if (state.sel.busy) return
  if (!agent.configured) {
    rememberAgentError('润笔要先配好模型端点（右上角设置 → Agent 运行时）')
    renderAgent()
    hideSelBar()
    return
  }
  if (!state.current) return
  state.sel.busy = true
  hideSelBar()
  openModal(`
    <h3>润笔</h3>
    <p class="sub">选中 ${state.sel.text.length} 字，连上下文一起交给 Agent 改写。</p>
    <div class="field"><label>改写要求（可选）</label>
      <input id="polish-hint" placeholder="例如：更冷峻、去掉形容词、加一句心理描写">
    </div>
    <div class="err" id="polish-err"></div>
    <div class="ops">
      <button class="btn-ghost" data-action="modal-close">取消</button>
      <button class="btn-primary" data-action="sel-polish-run">开始润笔</button>
    </div>
  `)
}

async function runPolish() {
  const hint = document.getElementById('polish-hint')?.value?.trim() || ''
  const errEl = document.getElementById('polish-err')
  const context = selectionContext()
  const prompt = [
    '【润笔请求】',
    `要改的这段（只改这段，不要扩写整章）：
${state.sel.text}`,
    `所在段落上下文：
${context}`,
    hint ? `作者要求：${hint}` : '',
    '请只输出改写后的这一段正文，不要解释、不要加引号、不要小标题。'
  ].filter(Boolean).join('\n\n')
  if (errEl) errEl.textContent = '润笔中…'
  try {
    const result = await runAgentOnce(prompt)
    state.sel.preview = { text: result, original: state.sel.text }
    state.sel.busy = false
    openPolishPreview()
  } catch (error) {
    state.sel.busy = false
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
}

function openPolishPreview() {
  const preview = state.sel.preview
  const diffHint = preview.text === preview.original ? '（与原文一致）' : ''
  openModal(`
    <h3>润笔结果${diffHint}</h3>
    <div class="field"><label>改写后</label>
      <textarea id="polish-result" style="min-height:180px">${esc(preview.text)}</textarea>
    </div>
    <div class="field"><label>原文（对照）</label>
      <div class="sub" style="max-height:120px;overflow:auto">${esc(preview.original)}</div>
    </div>
    <div class="ops">
      <button class="btn-ghost" data-action="modal-close">丢弃</button>
      <button class="btn-primary" data-action="sel-polish-apply">替换原文</button>
    </div>
  `)
}

/** 用润笔结果替换选区所在的块（按块偏移回写，自动保存）。 */
async function applyPolish() {
  const value = document.getElementById('polish-result')?.value ?? ''
  if (!state.current || !state.chapterFile || !value.trim()) return
  const blocks = mdModule.splitBlocks(state.chapterText)
  const block = blocks[state.sel.blockIndex]
  if (!block) {
    closeModal()
    return
  }
  const text = state.chapterText.slice(0, block.start) + value.trim() + state.chapterText.slice(block.end)
  closeModal()
  state.chapterText = text
  try {
    await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: state.chapterFile, text })
    })
    state.savedAt = new Date().toISOString()
    state.sel.preview = null
    setAutosaveChip('已替换 · 已保存')
    render()
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
    render()
  }
}

/* ---------- 与 Agent 讨论：选中段落作上下文，进左列会话 ---------- */

function discussSelection() {
  if (!state.current) return
  const context = selectionContext()
  state.agent.pendingContext = {
    quote: state.sel.text,
    context,
    label: `${state.sel.text.slice(0, 18)}${state.sel.text.length > 18 ? '…' : ''}（${state.sel.text.length} 字）`
  }
  hideSelBar()
  window.getSelection?.()?.removeAllRanges?.()
  renderAgent()
  const input = document.getElementById('agent-input')
  input?.focus()
}

/** 一次性 Agent 调用（润笔用：不落会话，不进会话列表）。 */
async function runAgentOnce(prompt) {
  if (!state.current) throw new Error('没有选中的库')
  const controller = new AbortController()
  let collected = ''
  let failure = null
  await streamChat({
    content: prompt,
    sessionId: undefined,
    controller,
    onStart: () => {},
    onDelta: (piece) => { collected += piece },
    onError: (error) => { failure = error }
  })
  if (failure) throw Object.assign(new Error(failure.message || 'Agent 调用失败'), { code: failure.code })
  const text = collected.trim()
  if (!text) throw new Error('Agent 没有返回内容')
  return text
}


/* ---------- 分析面板（OS-25/26）：插件自管，纯本地计算 ---------- */

async function runAnalysis() {
  if (!state.chapterLoaded) return
  await loadAnalysis()
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

/** 分析用的段落（与渲染块一致；去掉大标题）。 */
function analysisParagraphs() {
  if (!mdReady || !mdModule) return []
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

function analyzePanelHtml() {
  const result = state.analyze.result
  if (state.analyze.busy) return '<div class="analyze-body"><div class="loading">正在分析…</div></div>'
  if (!result) {
    return '<div class="analyze-body"><p class="sub">纯本地计算：节奏、对白、情绪曲线、文风、AI 味。不调模型、不上传。</p><button class="btn-primary" data-action="analyze-run">开始分析本章</button></div>'
  }
  const stats = result.stats
  const emotionValues = result.emotion.map((item) => item.value)
  const rhythmValues = result.rhythm.map((item) => item.chars)
  const openIssues = result.issues.filter((issue) => !state.analyze.dismissed[issue.id])
  const issueRows = openIssues.map((issue) =>
    '<div class="issue-row sev-' + esc(issue.severity) + '"><span class="issue-tag">' + esc(issue.label) +
    '</span><span class="issue-detail">' + esc(issue.detail) + '</span><span class="issue-ops">' +
    '<button class="issue-act" data-action="analyze-goto" data-paragraph="' + issue.paragraph + '">定位</button>' +
    '<button class="issue-act" data-action="analyze-fix" data-issue-id="' + esc(issue.id) + '">让 Agent 改</button>' +
    '<button class="issue-act" data-action="analyze-dismiss" data-issue-id="' + esc(issue.id) + '">解决</button>' +
    "</span></div>"
  ).join("")
  const aiClass = result.aiSmell.score >= 50 ? "bad" : result.aiSmell.score >= 25 ? "mid" : "good"
  return '<div class="analyze-body">' +
    '<div class="analyze-kpis"><span><b>' + stats.chars + "</b> 字</span><span><b>" + stats.paragraphs +
    "</b> 段</span><span><b>" + stats.avgSentenceLen + "</b> 字/句</span><span><b>" + stats.dialogueRatio +
    "%</b> 对白</span></div>" +
    (result.confidence === "low" ? '<div class="warn-box">本章偏短（&lt;800 字），指标置信度低——仅供参考。</div>' : "") +
    '<section class="analyze-sec"><h4>情绪曲线</h4>' + sparkline(emotionValues) + '<p class="sub">逐段正负情绪强度（中线以上偏暖，以下偏冷）</p></section>' +
    '<section class="analyze-sec"><h4>节奏（逐段字数）</h4>' + sparkline(rhythmValues, { color: "var(--ok)" }) + '<p class="sub">起伏太大＝长短段失衡，太平＝节奏单调</p></section>' +
    '<section class="analyze-sec"><h4>AI 味 <b class="ai-score ' + aiClass + '">' + result.aiSmell.score + "</b></h4>" +
    result.aiSmell.factors.map(barRow).join("") +
    '<p class="sub">分数越高越像模板文；四个因子都能解释到具体词/句。</p></section>' +
    '<section class="analyze-sec"><h4>问题 <span class="count">' + openIssues.length + " / " + result.issues.length + "</span></h4>" +
    (issueRows || '<p class="sub">没有未解决的问题。</p>') + "</section>" +
    '<div class="ops"><button class="btn-ghost" data-action="analyze-run">重新分析</button></div></div>'
}

function renderAnalyzePanel() {
  const panel = document.getElementById("analyze-panel")
  if (!panel) return
  panel.classList.toggle("open", state.analyze.open)
  if (!state.analyze.open) return
  const name = state.chapterFile ? state.chapterFile.split("/").pop() : ""
  panel.innerHTML = '<div class="analyze-head"><b>分析</b><span class="count">' + esc(name) + '</span><span class="sp"></span><button class="doc-icon" data-action="analyze-close" title="关闭">×</button></div>' + analyzePanelHtml()
}

/** 文档内标注：给有未解决问题的段落加高亮类（不动 contenteditable 结构）。 */
function paintDocAnnotations() {
  const result = state.analyze.result
  const blocks = document.querySelectorAll(".doc-block")
  blocks.forEach((block) => block.classList.remove("has-issue", "sev-high", "sev-medium", "sev-low"))
  if (!result) return
  const byParagraph = new Map()
  const rank = { high: 3, medium: 2, low: 1 }
  for (const issue of result.issues) {
    if (state.analyze.dismissed[issue.id]) continue
    if (!Number.isInteger(issue.paragraph) || issue.paragraph < 0) continue
    const prev = byParagraph.get(issue.paragraph)
    if (!prev || (rank[issue.severity] || 0) > (rank[prev] || 0)) byParagraph.set(issue.paragraph, issue.severity)
  }
  for (const entry of byParagraph) {
    const block = blocks[entry[0]]
    if (!block) continue
    block.classList.add("has-issue", "sev-" + entry[1])
  }
}

function toggleAnalyzePanel() {
  state.analyze.open = !state.analyze.open
  renderAnalyzePanel()
  if (state.analyze.open && !state.analyze.result) runAnalysis()
}

function dismissIssue(issueId) {
  state.analyze.dismissed[issueId] = true
  renderAnalyzePanel()
  paintDocAnnotations()
}

function gotoParagraph(index) {
  const block = document.querySelectorAll(".doc-block")[Number(index)]
  if (!block) return
  block.scrollIntoView({ block: "center", behavior: "smooth" })
  block.classList.add("issue-flash")
  setTimeout(() => block.classList.remove("issue-flash"), 1200)
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
  return `<div class="doc-head doc-head-immersive">
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
        <button class="doc-drawer-btn" data-action="toggle-chapter-drawer" title="章节列表（悬浮）" aria-label="章节列表">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6h11M2.5 10h11" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="doc-drawer-btn" data-action="analyze-toggle" title="分析本章" aria-label="分析本章">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.6A5.4 5.4 0 0 1 13.4 8H8z" fill="currentColor"/></svg>
        </button>
        <button class="doc-icon" data-action="doc-more" title="本章（版本历史 / 重命名 / 删除 / 显示设置）" aria-label="本章">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.4" cy="8" r="1.35" fill="currentColor"/><circle cx="8" cy="8" r="1.35" fill="currentColor"/><circle cx="12.6" cy="8" r="1.35" fill="currentColor"/></svg>
        </button>
      </div>
      <h1 class="doc-title">${esc(docTitle)}</h1>
      <div class="doc-actions">
        <button class="doc-link" data-action="chapter-nav" data-file="${esc(prev?.file ?? '')}"${prev ? '' : ' disabled'} title="上一章">←</button>
        <button class="doc-link" data-action="chapter-nav" data-file="${esc(next?.file ?? '')}"${next ? '' : ' disabled'} title="下一章">→</button>
      </div>
      <div class="doc-mini-meta">
        ${saved}${note}
      </div>
    </div>
    ${errorHtml()}
    <div class="chapter-grid doc-workspace">
      <aside class="chapter-list${state.write.drawerOpen ? ' open' : ''}">
        <div class="chapter-new">
          <input id="chapter-new-title" placeholder="新章标题…" value="">
          <button class="btn-ghost" data-action="chapter-create" title="自动编号新建">＋</button>
        </div>
        <div class="chapter-rows">${rows || '<div class="count" style="padding:8px">还没有章节——右上输入标题新建第一章。</div>'}</div>
      </aside>
      <div class="chapter-editor-col">
        ${editor}
      </div>
      <aside class="analyze-panel" id="analyze-panel"></aside>
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
  input.placeholder = !state.current
    ? '先选一个库，再和 Agent 聊…'
    : !agent.configured
      ? '先点右上角「设置」配置模型端点…'
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

async function openSession(id) {
  if (agent.streaming) return
  agent.sessionId = id
  agent.cardError = null
  agent.lastError = null
  await reloadThread()
  renderAgent()
}

function newSession() {
  if (agent.streaming) return
  agent.sessionId = ''
  agent.items = []
  agent.cardError = null
  agent.lastError = null
  renderAgent()
  document.getElementById('agent-input')?.focus()
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
  agent.lastError = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
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
  if (!agent.sessions.length) {
    return `<div class="empty">还没有会话。<br>发第一条消息就会自动建。</div>
      <div class="divider"></div>
      <button class="new" data-action="agent-new-session">＋新会话</button>`
  }
  const rows = agent.sessions.map((session, index) => {
    const title = sessionTitle(session, index)
    // 空会话不摆「0」——只有真聊过才标条数
    const meta = Number.isFinite(session.messageCount) && session.messageCount > 0 ? `${session.messageCount}` : ''
    return `<div class="sess${session.id === agent.sessionId ? ' on' : ''}" data-session-id="${esc(session.id)}" title="${esc(title.label)}${title.broken ? '（历史标题编码损坏，双击重命名）' : '（双击重命名）'}">
      <span class="tt">${esc(title.label)}</span>
      ${meta ? `<span class="meta">${meta} 条</span>` : ''}
      <button class="x" data-session-del="${esc(session.id)}" title="删除会话">×</button>
    </div>`
  }).join('')
  return `${rows}<div class="divider"></div>
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

function msgHtml(item, index) {
  if (item.role === 'user') return `<div class="bub user">${esc(item.content)}</div>`
  const streamingThis = agent.streaming && index === agent.items.length - 1
  const cursor = streamingThis ? '<span class="cursor"></span>' : ''
  const partial = item.partial ? '<span class="partial-tag">已停止——这段是不完整回答，以服务器落档为准</span>' : ''
  const foot = streamingThis ? '' : `<div class="bub-foot"><button class="mini" data-action="card-from" data-msg-index="${index}">转为待确认卡</button></div>`
  return `<div class="bub assistant">${esc(item.content)}${cursor}${partial}${foot}</div>`
}

function cardHtml(item) {
  const open = item.state === 'open'
  const snapshotNote = item.snapshot?.exists ? `创建时 ${item.snapshot.chars} 字` : '创建时是新文件'
  const ops = open
    ? `<div class="ops">
        <button class="btn-primary" data-action="card-adopt" data-card-id="${esc(item.id)}">采纳写入</button>
        <button class="btn-ghost" data-action="card-reject" data-card-id="${esc(item.id)}">拒绝</button>
        <span class="count">采纳＝写「${esc(item.file)}」· ${esc(snapshotNote)}</span>
      </div>`
    : `<div class="ops">
        <span class="state-chip${item.state === 'adopted' ? ' ok' : ' dead'}">${item.state === 'adopted' ? '已写入正文' : '已拒绝'}</span>
        ${item.backup ? `<span class="count">上一版备份：${esc(item.backup)}</span>` : ''}
      </div>`
  const revError = agent.cardError?.cardId === item.id ? `<div class="rev-error">${esc(agent.cardError.message)}</div>` : ''
  return `<div class="card-block">
    <div class="head"><b>待确认卡</b><span class="file">${esc(item.file)}</span></div>
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
  return agent.items.map((item, index) => item.kind === 'card' ? cardHtml(item) : msgHtml(item, index)).join('')
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
    handlers.onStart?.(payload.sessionId)
  } else if (payload?.type === 'delta') {
    handlers.onDelta?.(text(payload.text))
  } else if (payload?.type === 'notice') {
    handlers.onNotice?.(text(payload.text))
  } else if (payload?.type === 'error') {
    handlers.onError?.({ code: payload.error?.code, message: payload.error?.message })
  }
}

/**
 * 走 daemon Agent 通道的一条流式对话（左列对话与推演页共用）。
 * controller 由调用方持有（停止按钮 abort 它）；帧回调按调用方各自的状态落地。
 */
async function streamChat({ content, sessionId, controller, onStart, onDelta, onNotice, onError }) {
  try {
    const response = await fetch('/api/agent/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        root: state.current.path,
        ...(sessionId ? { sessionId } : {}),
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
        handleChatFrame(buffer.slice(0, index), { onStart, onDelta, onNotice, onError })
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
  // OS-24：若有选中段落上下文，拼进消息（并在气泡里保留引用）
  const ctx = agent.pendingContext
  const content = ctx
    ? `【选中段落】\n${ctx.quote}\n\n【所在段落上下文】\n${ctx.context}${typed ? `\n\n【我的问题】\n${typed}` : ''}`
    : typed
  if (!content) return
  if (input) input.value = ''
  agent.lastError = null
  agent.cardError = null
  agent.items.push({ kind: 'msg', id: 'local-user', role: 'user', content: typed ? content : `【选中段落】${ctx.quote}`, at: '' })
  agent.pendingContext = null
  agent.items.push({ kind: 'msg', id: 'streaming', role: 'assistant', content: '', at: '' })
  agent.streaming = true
  const controller = new AbortController()
  agent.controller = controller
  renderAgent()
  await streamChat({
    content,
    sessionId: agent.sessionId || undefined,
    controller,
    onStart: (sessionId) => { agent.sessionId = sessionId },
    onDelta: (piece) => {
      const last = agent.items[agent.items.length - 1]
      if (last?.kind === 'msg' && last.role === 'assistant') {
        last.content += piece
        renderThread()
      }
    },
    onNotice: (noticeText) => {
      agent.notices.push(noticeText)
      renderThread()
    },
    onError: (error) => rememberAgentError(error)
  })
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

/* ---------- 设置页（OS-14：左导航分节制——运行时/外观/数据/关于）---------- */

function openSettingsModal() {
  go('settings')
}

/* ---------- 设置页（OS-14：左导航分节制——功能规则会持续变多，架子先立好）---------- */

/**
 * 应用级设置分节（OS-28 认知：应用只管插件的插拔、发现与导入）。
 * 业务面板自己的偏好（正文排版等）归各面板的 ⚙，不在这里。
 */
const SETTINGS_SECTIONS = Object.freeze([
  { id: 'plugins', label: '插件', hint: '套件与 Agent 运行时的启停/设置' },
  { id: 'discover', label: '发现与导入', hint: '货架路径、本机安装、库导入' },
  { id: 'data', label: '数据与目录', hint: '库清单与配置位置' },
  { id: 'about', label: '关于', hint: '这台工作台是什么' }
])

// 运行时状态标（OS-18：货架三组＋实测状态）
const RUNTIME_STATUS_LABEL = {
  ready: '就绪', idle: '待拉起', running: '运行中', unconfigured: '未配置', missing: '不可用'
}

function runtimeCard(runtime) {
  const on = runtime.id === agent.runtime
  const status = RUNTIME_STATUS_LABEL[runtime.status] ?? runtime.status ?? ''
  const probe = runtime.probe ?? null
  const probeNote = probe?.version ? ` · ${esc(probe.version)}` : probe?.message ? ` · ${esc(probe.message)}` : ''
  const canFix = runtime.status === 'missing' && runtime.kind === 'dsh'
  return `<div class="big-opt${on ? ' on' : ''}${runtime.status === 'missing' ? ' is-missing' : ''}" data-runtime-id="${esc(runtime.id)}">
    <b>${esc(runtime.name)}<span class="src">${esc(runtime.source)}</span><span class="rt-status ${esc(runtime.status || '')}">${esc(status)}</span></b>
    <span>${esc(runtime.description || '')}${probeNote}</span>
    ${canFix ? `<div class="rt-fix" data-action="runtime-setup" data-id="${esc(runtime.id)}">修复（自动装 profile 与 runtime 组件）</div>` : ''}
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
  const kitActive = Boolean(agent.runtime)
  return `<div class="step">
    <h3>Agent 运行时（kit 优先，Pi 兜底）</h3>
    <div class="big-opts">${runtimeCards}</div>
    <div class="field" style="margin-top:14px"><label>Pi 兜底端点${kitActive ? '（当前用套件，可留空）' : ''}</label>
      <input id="cfg-endpoint" placeholder="https://api.deepseek.com/v1/chat/completions" value="${esc(agent.endpoint)}">
    </div>
    <div class="field"><label>模型</label>
      <input id="cfg-model" placeholder="deepseek-chat" value="${esc(agent.model)}">
    </div>
    <div class="field"><label>API Key${agent.apiKeyMasked ? `（已设置 ${esc(agent.apiKeyMasked)}，留空＝保留）` : ''}</label>
      <input id="cfg-key" type="password" placeholder="${agent.apiKeyMasked ? '留空保留原 key' : 'sk-…'}">
    </div>
    <div class="err" id="settings-err"></div>
    <div class="row" style="display:flex;gap:10px;align-items:center;margin-top:8px">
      <button class="btn-primary" data-action="agent-config-save">保存 Pi 配置</button>
      <span class="count">key 只存本机配置文件，界面永远只显示尾号</span>
    </div>
  </div>`
}

function settingsAppearanceSectionHtml() {
  const styleCards = state.styles.map((pack) => `
    <button class="big-opt${pack.id === state.skin ? ' on' : ''}" data-skin="${esc(pack.id)}">
      <b>${esc(pack.name)}<span class="src">${esc(pack.source)}</span></b>
      <span>${esc(pack.description || '')}</span>
    </button>`).join('')
  return `<div class="step">
    <h3>风格包（整窗换肤）</h3>
    <div class="big-opts">${styleCards || '<span class="count">风格包清单读不到，先用内置珊瑚兜底。</span>'}</div>
    <p class="sub">本机风格目录丢 JSON 即上新：<span class="hint">%LOCALAPPDATA%\\PinaxNext\\openstory\\styles\\</span>（左下角色板是同一份数据的快捷入口）。</p>
  </div>`
}


/** 外观·写作（OS-21）：正文字号/行高/段距/首行缩进/自动隔行——改完立刻投影到 CSS 变量。 */
function settingsWritingSectionHtml() {
  return `<div class="step">
    <h3>正文排版</h3>
    ${docPrefSlidersHtml()}
    <p class="sub">所有偏好只存本机（localStorage），改完立刻作用到正文工作台；阅读态与编辑态共用同一组排版。正文页的「⋯」里也有同一组。</p>
  </div>`
}


/**
 * 「插件」节（OS-28）：应用只管插件的插拔——两块货架，业务套件 + Agent 运行时。
 * 每个插件的设置都归它自己的设置页（点进去），不在应用设置里摊开。
 */
function settingsPluginsSectionHtml() {
  return suitesSectionHtml() +
    '<div class="step" style="margin-top:14px"><h3>Agent 运行时</h3><p class="sub">模型对话走哪条通道：Pi 直连 / DSH 原生 / CLI 服务（嫁接）。每个运行时的配置归它自己的设置页。</p></div>' +
    settingsRuntimeSectionHtml()
}

/**
 * 「发现与导入」节（OS-28）：应用只管「从哪发现插件」和「怎么把稿子导进来」。
 * 三类货架都是目录制——丢文件即上新，本机覆盖内置。
 */
function settingsDiscoverSectionHtml() {
  const shelves = [
    { label: "业务套件", dir: "%LOCALAPPDATA%\\PinaxNext\\openstory\\suites", spec: "openstory-suite@2 · PROTOCOL.md", what: "一个目录＋manifest.json（声明能力：设置页用宿主表单还是自带页）" },
    { label: "Agent 运行时", dir: "%LOCALAPPDATA%\\PinaxNext\\openstory\\runtimes", spec: "openstory-runtime-kit@1 · runtimes/README.md", what: "一个目录＋manifest.json（sidecar / endpoint / cli / dsh 四种 kind）" },
    { label: "风格包", dir: "%LOCALAPPDATA%\\PinaxNext\\openstory\\styles", spec: "tokens JSON", what: "一个 JSON 文件（--bg/--accent… 令牌，可带栅格密度）" }
  ]
  const rows = shelves.map((shelf) => '<div class="discover-row"><div><b>' + esc(shelf.label) + '</b><span class="pill">' + esc(shelf.spec) + '</span><div class="count">' + esc(shelf.what) + '</div></div><div class="hint">' + esc(shelf.dir) + "</div></div>").join("")
  return '<div class="step"><h3>插件货架（丢目录/文件即上新）</h3>' + rows +
    '<p class="sub">同名 id 时本机覆盖内置；坏档跳过并给 warning，不会拖垮货架。</p></div>' +
    '<div class="step"><h3>库与稿件导入</h3><p class="sub">库＝磁盘上的文件夹（.pinax 兼容）。新建库/导入稿件在顶栏「库」切换器面板里；导入会把源目录按类别（正文/剧本/大纲/世界书/资料…）识别并复制进库，源目录只读。</p>' +
    '<div class="row" style="display:flex;gap:10px"><button class="btn-ghost" data-action="flow-create">＋新建库</button><button class="btn-ghost" data-action="flow-import">导入稿件</button></div></div>'
}

function settingsDataSectionHtml() {
  const paths = [
    { label: '库清单', path: state.preferencesPath || '%LOCALAPPDATA%\\PinaxNext\\next-preferences.json' },
    { label: 'Agent 配置', path: agent.configPath || '%LOCALAPPDATA%\\PinaxNext\\openstory\\agent-config.json' },
    { label: '运行时套件货架（本机）', path: state.settings.userDir || '%LOCALAPPDATA%\\PinaxNext\\openstory\\runtimes' },
    { label: '风格包货架（本机）', path: '%LOCALAPPDATA%\\PinaxNext\\openstory\\styles' }
  ]
  return `<div class="step">
    <h3>本机路径（全部只落这台机器）</h3>
    ${paths.map((item) => `<div class="kv-line"><span class="k">${esc(item.label)}</span><span class="v">${esc(item.path)}</span></div>`).join('')}
    ${warningsHtml(state.warnings)}
  </div>`
}

function settingsAboutSectionHtml() {
  return `<div class="step">
    <h3>这台工作台是什么</h3>
    <p class="sub" style="line-height:2">
      OpenStory＝跑在浏览器 / DSH 里的小说工作台（OpenDesign 形态的小说版）。<br>
      · 数据真源在磁盘：库＝一个文件夹（.pinax 兼容形态），OpenStory 不自建数据库；<br>
      · 与 Pinax（Electron 壳）共用同一份文件资产与库清单——两个壳，一份稿子；<br>
      · daemon 只监听 127.0.0.1，配置与凭据只存本机，不上网不同步；<br>
      · Agent 运行时可插拔（套件货架），Pi 兜底；风格包即插件式外观。
    </p>
  </div>`
}

function settingsHtml() {
  const sectionRenderers = {
    plugins: settingsPluginsSectionHtml,
    suites: suitesSectionHtml,
    suite: () => suiteDetailHtml(state.settings.suiteId),
    suiteSettings: () => suiteDetailHtml(state.settings.suiteId),
    runtime: settingsRuntimeSectionHtml,
    appearance: settingsAppearanceSectionHtml,
    discover: settingsDiscoverSectionHtml,
    data: settingsDataSectionHtml,
    about: settingsAboutSectionHtml
  }
  const sectionId = sectionRenderers[state.settings.section] ? state.settings.section : 'plugins'
  // 套件独立设置页 / 运行时节在导航上高亮「插件」
  const navOn = sectionId === 'suite' || sectionId === 'suiteSettings' ? 'plugins' : sectionId
  const sectionHtml = (sectionRenderers[sectionId] ?? settingsPluginsSectionHtml)()
  const nav = SETTINGS_SECTIONS.map((section) => `
    <button class="settings-nav-item${section.id === navOn ? ' on' : ''}" data-settings-section="${esc(section.id)}">
      <b>${esc(section.label)}</b>
      <span>${esc(section.hint)}</span>
    </button>`).join('')
  return `<div class="lib-wrap">
    <h1>设置</h1>
    <p class="sub">应用级设置只管插件的插拔、发现与导入。业务面板自己的偏好（如正文排版、分析）在各自的 ⚙ 里，不在这里。</p>
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
    return `<div class="suite-manage-row${on ? '' : ' off'}">
      <div class="sm-main">
        <button class="sm-name" data-action="suite-open" data-id="${esc(suite.id)}" title="进独立设置页">${esc(suite.name)}</button>
        <span class="pill">v${esc(suite.version)}</span>
        <span class="pill">${esc(suite.vendor)}</span>
        ${suite.domains?.length ? `<span class="count">域：${esc(suite.domains.join('／'))}</span>` : ''}
        <div class="count">${esc(suite.description || '')}</div>
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
    <h3>业务套件（不常驻）<span class="cnt">启用 ${enabledCount} · 停用 ${state.suites.length - enabledCount}</span></h3>
    <p class="sub">开关管「激活/不激活」：停用＝这套件的规则退回内置默认（值保留）；「设置 →」进它的独立设置页。与 Agent 运行时（上一节）分工：运行时管模型通道，套件管业务规则。</p>
    <div class="suite-manage">${rows || '<div class="count" style="padding:10px">货架为空——把套件目录丢进本机 suites 目录即上新。</div>'}</div>
    <p class="sub">本机套件目录：<span class="hint">${esc(state.settings.suitesUserDir || '%LOCALAPPDATA%\\PinaxNext\\openstory\\suites')}</span></p>
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
  const domains = suite.domains?.length ? esc(suite.domains.join('／')) : '—'
  const capChips = [
    mode === 'page' ? '设置：自带页' : mode === 'schema' ? '设置：宿主表单' : '设置：未声明',
    caps.pages?.length ? `业务页：登记 ${caps.pages.length} 个（装载随宿主上线）` : '',
    caps.services?.length ? `服务：登记 ${caps.services.length} 个` : ''
  ].filter(Boolean).map((chip) => `<span class="pill">${esc(chip)}</span>`).join('')
  const head = `<div class="suite-head">
      <span class="suite-name">${esc(suite.name)}</span>
      <span class="pill">v${esc(suite.version)}</span>
      <span class="pill">${esc(suite.vendor)}</span>
      <span class="pill">${esc(suite.source)}</span>
      <span class="state-chip ${suite.enabled ? 'ok' : 'dead'}">${suite.enabled ? '启用中' : '已停用'}</span>
    </div>
    <p class="sub">${esc(suite.description || '')}${suite.domains?.length ? ` · 域：${domains}` : ''}</p>
    <p class="sub cap-chips">${capChips}</p>`
  let body = ''
  if (mode === 'page') {
    body = `
      ${suite.enabled ? '' : '<div class="warn-box"><b>已停用</b>——这套件的规则当前退回内置默认；下面的值保留，启用即恢复。</div>'}
      <p class="sub">自带设置页（同源装载；配置由套件页经 state-data 通道自管，宿主只存不校验形状）：</p>
      <iframe class="suite-frame" src="/suite-assets/${esc(suite.id)}/${esc(caps.settings.entry)}" title="${esc(suite.name)} 设置"></iframe>`
  } else if (mode === 'schema') {
    const schema = suite.settingsSchema ?? []
    body = `
      ${suite.enabled ? '' : '<div class="warn-box"><b>已停用</b>——这套件的规则当前退回内置默认；下面的值保留，启用即恢复。</div>'}
      ${schema.length ? schema.map(settingFieldHtml).join('') : '<p class="sub">这套件没有声明设置项。</p>'}
      <div class="err" id="suite-err"></div>
      <div class="row" style="display:flex;gap:10px;align-items:center;margin-top:10px">
        <button class="btn-primary" data-action="suite-settings-save" data-id="${esc(suite.id)}">保存设置</button>
        <span class="count">按套件声明的规则校验后落本机</span>
      </div>`
  } else {
    body = '<p class="sub">这套件没有声明设置能力。</p>'
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
  try {
    const payload = await api('/api/agent/config', {
      method: 'PUT',
      body: JSON.stringify({ endpoint, model, ...(key.trim() ? { apiKey: key } : {}) })
    })
    agent.configured = payload.configured === true
    agent.endpoint = text(payload.endpoint)
    agent.model = text(payload.model)
    agent.apiKeyMasked = text(payload.apiKeyMasked)
    agent.configPath = text(payload.configPath)
    updateAgentChip()
    updateComposerState()
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
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

function renderTabs() {
  const tabsEl = document.getElementById('tabs')
  if (!tabsEl) return
  const defs = []
  if (state.current) {
    // OS-12：页签首格固定＝产物中心（产出物＋多版本＋历史）；「库」上移顶栏。
    defs.push({ view: 'artifacts', label: '产物', ic: '产' })
    // OS-19：正文/世界书也走 libDirs 判断——体裁声明后（如短故事）就不出世界书页签
    const libDirs = state.libDirs
    const hasDir = (name) => libDirs.includes(name)
    const excluded = new Set((state.briefGenre?.excludedPages ?? []).map((page) => PAGE_TO_DIR_LOCAL[page] ?? page))
    if (!state.brief || hasDir('正文')) defs.push({ view: 'write', label: '正文', ic: '章' })
    if (!state.brief || hasDir('世界书')) defs.push({ view: 'entries', label: '世界书', ic: '条' })
    const extra = libDirs
      .filter((dir) => dir !== '正文' && dir !== '世界书' && DIR_LABELS[dir] && !excluded.has(dir))
      .sort((left, right) => DIR_ORDER.indexOf(left) - DIR_ORDER.indexOf(right))
      .map((dir) => ({ view: `dir:${dir}`, label: DIR_LABELS[dir], ic: DIR_LABELS[dir][0], readonly: READONLY_DIRS.has(dir) }))
    defs.push(...extra)
    if (!excluded.has('Wiki')) defs.push({ view: 'wiki', label: 'Wiki', ic: 'W' })
    defs.push({ view: 'deduce', label: '推演', ic: '推' })
  } else {
    // 无库时页签留空——库管理走顶栏切换器，设置走顶栏设置钮。
  }
  tabsEl.innerHTML = defs.map((def) => `<button class="tab${state.view === def.view ? ' on' : ''}" data-view="${esc(def.view)}"><span class="ic">${esc(def.ic)}</span>${esc(def.label)}${def.readonly ? '<span class="pill">只读</span>' : ''}</button>`).join('')
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
      <input class="file-input" id="deduce-pov" placeholder="POV 角色（可选，如 林砚）" value="${esc(engine.pov)}">
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
  state.current = library
  // 先体检：形态不对（空地/有稿无标记/缺主模块/坏档）不进空工作台，摆修复卡（A-5 同口径）。
  try {
    const diagnosed = await api(`/api/library/diagnose?root=${encodeURIComponent(path)}`)
    if (diagnosed?.verdict && diagnosed.verdict.ok === false) {
      state.repair = { path, shape: diagnosed.shape ?? {}, verdict: diagnosed.verdict }
      state.view = 'repair'
      render()
      return
    }
  } catch { /* 体检接口失败不拦工作台 */ }
  state.entries = []
  state.total = 0
  state.entryWarnings = []
  state.entry = null
  state.entryRevision = null
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
  // Agent 列跟库走：换库＝换会话集。
  agent.sessions = []
  agent.sessionId = ''
  agent.items = []
  agent.cardError = null
  agent.lastError = null
  renderAgent()
  render()
  await ensureEntries()
  await loadSessions()
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
  state.view = view
  if (view === 'entries') state.entry = null
  render()
  if (view === 'settings') {
    // 先并行拉数据，全部回来再渲染一次（否则先完成的 render 会用旧 state 覆盖）
    Promise.all([loadAgentRuntimes(), loadStyles(), loadSuites()])
      .then(() => { if (state.view === 'settings') render() })
      .catch(() => render())
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
  const target = event.target.closest('[data-view], [data-go], [data-action], [data-skin], [data-lib-path], [data-entry-id], [data-layer], [data-kind], [data-load-more], [data-session-id], [data-session-del], [data-wiki-mode], [data-create-primary], [data-create-genre], [data-runtime-id], [data-chapter-file], [data-settings-section]')
  if (!target) return

  if (target.dataset.createGenre !== undefined) {
    state.create.genre = target.dataset.createGenre
    state.create.length = null
    render()
    return
  }

  if (target.dataset.settingsSection) {
    state.settings.section = target.dataset.settingsSection
    render()
    return
  }

  if (target.dataset.skin) {
    setSkin(target.dataset.skin)
    return
  }

  if (target.dataset.chapterFile) {
    loadChapter(target.dataset.chapterFile)
    if (state.write.drawerOpen) {
      state.write.drawerOpen = false
      document.querySelector('.chapter-list')?.classList.remove('open')
      document.querySelector('[data-action="toggle-chapter-drawer"]')?.classList.remove('on')
    }
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
    go(target.dataset.go)
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
  if (action === 'toggle-palette') {
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
  } else if (action === 'toggle-chapter-drawer') {
    state.write.drawerOpen = !state.write.drawerOpen
    const list = document.querySelector('.chapter-list')
    if (list) list.classList.toggle('open', state.write.drawerOpen)
    target.classList.toggle('on', state.write.drawerOpen)
  } else if (action === 'sel-polish') {
    polishSelection()
  } else if (action === 'sel-polish-run') {
    runPolish()
  } else if (action === 'sel-polish-apply') {
    applyPolish()
  } else if (action === 'sel-discuss') {
    discussSelection()
  } else if (action === 'clear-agent-context') {
    state.agent.pendingContext = null
    renderAgent()
  } else if (action === 'analyze-toggle') {
    toggleAnalyzePanel()
  } else if (action === 'analyze-close') {
    state.analyze.open = false
    renderAnalyzePanel()
  } else if (action === 'analyze-run') {
    runAnalysis()
  } else if (action === 'analyze-dismiss') {
    dismissIssue(target.dataset.issueId)
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

// 文档内框选 → 上方浮窗（润笔 / 与 Agent 讨论）
// 注意：不要监听 scroll 收浮窗——contenteditable 聚焦会触发滚动，会把刚弹出的浮窗立刻收掉。
let selBarTimer = null
document.addEventListener('selectionchange', () => {
  if (state.view !== 'write') return
  const picked = readDocSelection()
  if (picked) {
    // 拖选过程中选区在变，等 120ms 稳定后再弹，避免抖动
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
