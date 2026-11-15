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
  create: { parent: '', name: '', primary: 'pinax.carrier.novel', running: false, result: null, error: '' },
  impo: { root: '', source: '', plan: null, report: null, running: false, error: '' },
  repair: null,
  libDirs: [],
  dirWork: {},
  write: { chapters: [], listLoading: false },
  deduce: { premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '' },
  artifacts: { root: '', groups: [], totals: null, loading: false, error: '', previewFile: '', previewText: '', previewLoading: false },
  settings: { userDir: '', section: 'runtime', suiteId: '' },
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

function formatBytes(size) {
  const value = Number(size) || 0
  return value >= 1024 ? `${(value / 1024).toFixed(1)} KB` : `${value} B`
}

async function loadWriteChapters({ force = false } = {}) {
  if (!state.current) return
  if (state.write.chapters.length && !force) return
  state.write.listLoading = true
  render()
  try {
    const payload = await api(`/api/chapters?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent('正文')}`)
    state.write.chapters = Array.isArray(payload.chapters) ? payload.chapters : []
  } catch (error) {
    state.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  state.write.listLoading = false
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
  const editor = state.chapterLoaded
    ? `<textarea class="editor" id="chapter-editor" spellcheck="false" placeholder="正文内容…">${esc(state.chapterText)}</textarea>`
    : `<div class="empty-state">
        <h2>选一章开始</h2>
        <p>左侧点章节载入；或输入标题新建一章（自动编号）。章节就是 <span class="hint">正文/NNN-标题.md</span> 文件，Pinax 里同样可见。</p>
      </div>`

  return `<div class="doc-head">
      <div class="kick">${esc(state.current.name)} / 正文</div>
      <h1>${esc(currentChapter?.title || state.chapterFile?.split('/').pop() || '正文')}</h1>
      <div class="doc-meta">
        <span class="b">正文</span>
        <span id="chapter-chars">${state.chapterText.length} 字</span>
        ${saved}
        ${note}
      </div>
    </div>
    ${errorHtml()}
    <div class="chapter-grid">
      <aside class="chapter-list">
        <div class="chapter-new">
          <input id="chapter-new-title" placeholder="新章标题…" value="">
          <button class="btn-ghost" data-action="chapter-create" title="自动编号新建">＋</button>
        </div>
        <div class="chapter-rows">${rows || '<div class="count" style="padding:8px">还没有章节——右上输入标题新建第一章。</div>'}</div>
      </aside>
      <div class="chapter-editor-col">
        <div class="toolbar">
          <button class="btn-ghost" data-action="chapter-nav" data-file="${esc(prev?.file ?? '')}"${prev ? '' : ' disabled'}>← 上一章</button>
          <button class="btn-ghost" data-action="chapter-nav" data-file="${esc(next?.file ?? '')}"${next ? '' : ' disabled'}>下一章 →</button>
          <span class="sp"></span>
          <button class="btn-ghost" data-action="chapter-rename"${state.chapterFile ? '' : ' disabled'}>重命名</button>
          <button class="btn-ghost" data-action="chapter-delete"${state.chapterFile ? '' : ' disabled'}>删除</button>
          <button class="btn-primary" data-action="save-chapter"${state.chapterLoaded ? '' : ' disabled'}>保存</button>
        </div>
        ${editor}
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

function updateAgentChip() {
  const chip = document.getElementById('agent-model-chip')
  if (!chip) return
  const kit = agent.runtimeList.find((item) => item.id === agent.runtime && item.id)
  const label = kit ? kit.name : agent.configured ? (agent.model || agent.endpoint) : '未配置模型'
  chip.textContent = label
  chip.classList.toggle('on', agent.configured)
  chip.title = kit
    ? `运行时套件：${kit.name}（${kit.source}）${agent.model ? `\n模型：${agent.model}` : ''}`
    : agent.configured
      ? `端点：${agent.endpoint}${agent.apiKeyMasked ? `\nkey：${agent.apiKeyMasked}（完整 key 不回显）` : ''}`
      : '点这里配置模型端点或选运行时套件'
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

function sessionsHtml() {
  const pills = agent.sessions.map((session) => `
    <span class="s${session.id === agent.sessionId ? ' on' : ''}" data-session-id="${esc(session.id)}" title="${esc(session.title)}（双击重命名）">
      <span class="tt">${esc(session.title)}</span>
      <button class="x" data-session-del="${esc(session.id)}" title="删除会话">×</button>
    </span>`).join('')
  return `<button class="new" data-action="agent-new-session" title="开始一段新对话">＋新会话</button>${pills}`
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

function renderAgent() {
  const strip = document.getElementById('agent-sessions')
  if (strip) strip.innerHTML = sessionsHtml()
  renderThread()
  updateComposerState()
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
  const content = text(input?.value).trim()
  if (!content) return
  if (input) input.value = ''
  agent.lastError = null
  agent.cardError = null
  agent.items.push({ kind: 'msg', id: 'local-user', role: 'user', content, at: '' })
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

const SETTINGS_SECTIONS = Object.freeze([
  { id: 'runtime', label: 'Agent 运行时', hint: 'Agent 运行时、kit 货架' },
  { id: 'suites', label: '套件（插件）', hint: '业务套件：版本/归属/启停/独立设置' },
  { id: 'appearance', label: '外观', hint: '风格包、版面观感' },
  { id: 'data', label: '数据与目录', hint: '库清单、配置与货架路径' },
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
  return `<button class="big-opt${on ? ' on' : ''}${runtime.status === 'missing' ? ' is-missing' : ''}" data-runtime-id="${esc(runtime.id)}">
    <b>${esc(runtime.name)}<span class="src">${esc(runtime.source)}</span><span class="rt-status ${esc(runtime.status || '')}">${esc(status)}</span></b>
    <span>${esc(runtime.description || '')}${probeNote}</span>
  </button>`
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
    runtime: settingsRuntimeSectionHtml,
    suites: suitesSectionHtml,
    suite: () => suiteDetailHtml(state.settings.suiteId),
    appearance: settingsAppearanceSectionHtml,
    data: settingsDataSectionHtml,
    about: settingsAboutSectionHtml
  }
  const sectionId = sectionRenderers[state.settings.section] ? state.settings.section : 'runtime'
  // 套件独立设置页（suite:）在导航上高亮「套件（插件）」
  const navOn = sectionId === 'suite' ? 'suites' : sectionId
  const sectionHtml = (sectionRenderers[sectionId] ?? settingsRuntimeSectionHtml)()
  const nav = SETTINGS_SECTIONS.map((section) => `
    <button class="settings-nav-item${section.id === navOn ? ' on' : ''}" data-settings-section="${esc(section.id)}">
      <b>${esc(section.label)}</b>
      <span>${esc(section.hint)}</span>
    </button>`).join('')
  return `<div class="lib-wrap">
    <h1>设置</h1>
    <p class="sub">全面设置：运行时与套件（插件）、外观、数据目录——全部只落本机，不上网。功能规则会持续变多，都归这里管。</p>
    ${errorHtml()}
    <div class="settings-layout">
      <nav class="settings-nav">${nav}</nav>
      <div class="settings-content">${sectionHtml}</div>
    </div>
  </div>`
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
    return `<div class="step"><h3>套件不在货架上</h3><p class="sub">可能已被移除。<button class="btn-ghost" data-settings-section="suites">← 回套件列表</button></p></div>`
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
      <button class="btn-ghost" data-settings-section="suites">← 回套件列表</button>
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

function flowCreate() {
  state.create.result = null
  state.create.error = ''
  state.view = 'lib-create'
  render()
  document.getElementById('create-parent')?.focus()
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
  const result = create.result
    ? `<div class="step">
        <h3><span class="no">✓</span>库已建成</h3>
        <p class="sub">${esc(create.result.document?.name ?? '')} · ${esc(create.result.root)}</p>
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

function renderTabs() {
  const tabsEl = document.getElementById('tabs')
  if (!tabsEl) return
  const defs = []
  if (state.current) {
    // OS-12：页签首格固定＝产物中心（产出物＋多版本＋历史）；「库」上移顶栏。
    defs.push({ view: 'artifacts', label: '产物', ic: '产' })
    defs.push({ view: 'write', label: '正文', ic: '章' })
    defs.push({ view: 'entries', label: '世界书', ic: '条' })
    const extra = state.libDirs
      .filter((dir) => dir !== '正文' && dir !== '世界书' && DIR_LABELS[dir])
      .sort((left, right) => DIR_ORDER.indexOf(left) - DIR_ORDER.indexOf(right))
      .map((dir) => ({ view: `dir:${dir}`, label: DIR_LABELS[dir], ic: DIR_LABELS[dir][0], readonly: READONLY_DIRS.has(dir) }))
    defs.push(...extra)
    defs.push({ view: 'wiki', label: 'Wiki', ic: 'W' })
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
  return `<div class="doc-head">
      <div class="kick">${esc(state.current.name)} / 推演</div>
      <h1>推演稿</h1>
      <div class="doc-meta">
        <span class="b">Agent 推演</span>
        ${deduce.sessionId ? '<span class="count">推演会话已建——卡在左列会话里采纳</span>' : ''}
      </div>
    </div>
    ${flowError(deduce.error)}
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
          ${!agent.configured ? '<span class="count">先在右上角「设置」里配好模型端点。</span>' : '<span class="count">推演＝Agent 分支推理；产出经待确认卡落正文。</span>'}
        </div>
      </div>
      <div class="step">
        <h3><span class="no">→</span>推演回答</h3>
        <div class="deduce-reply">${deduce.reply ? esc(deduce.reply) : (deduce.streaming ? '推演中…' : '填好左边三段，点「开始推演」。回答可整段转成待确认卡，采纳后写进正文。')}</div>
        ${deduce.reply && !deduce.streaming ? `<div class="repair-actions"><button class="btn-primary" data-action="deduce-card">转为待确认卡（写正文）</button></div>` : ''}
      </div>
    </div>`
}

/* ---------- 数据加载 ---------- */

async function boot() {
  bootAgentConfig()
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
  state.deduce = { premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '' }
  state.chapterFiles = []
  try {
    const [topPayload, chapterList, chaptersPayload] = await Promise.all([
      api(`/api/files?root=${encodeURIComponent(path)}`),
      api(`/api/files?root=${encodeURIComponent(path)}&dir=${encodeURIComponent('正文')}`).catch(() => null),
      api(`/api/chapters?root=${encodeURIComponent(path)}&dir=${encodeURIComponent('正文')}`).catch(() => null)
    ])
    state.libDirs = Array.isArray(topPayload.dirs) ? topPayload.dirs : []
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
    loadAgentRuntimes().then(render)
    loadStyles().then(render)
    loadSuites().then(render)
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
  const target = event.target.closest('[data-view], [data-go], [data-action], [data-skin], [data-lib-path], [data-entry-id], [data-layer], [data-kind], [data-load-more], [data-session-id], [data-session-del], [data-wiki-mode], [data-create-primary], [data-runtime-id], [data-chapter-file], [data-settings-section]')
  if (!target) return

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
  } else if (action === 'deduce-start') {
    startDeduce()
  } else if (action === 'deduce-stop') {
    state.deduce.controller?.abort()
  } else if (action === 'deduce-card') {
    openCardModalFor(state.deduce.reply, state.deduce.sessionId, '推演还没建立会话（先成功跑一次推演）。')
  } else if (action === 'chapter-create') {
    createChapterFlow()
  } else if (action === 'chapter-rename') {
    renameChapterFlow()
  } else if (action === 'chapter-delete') {
    deleteChapterFlow()
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
  } else if (action === 'toggle-lib-switch') {
    const panel = document.getElementById('lib-switch-panel')
    if (panel) {
      panel.classList.toggle('open')
      renderLibSwitchPanel()
    }
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
  if (event.key === 'Escape') closeModal()
})

// 会话双击重命名
document.addEventListener('dblclick', (event) => {
  const pill = event.target.closest('.agent-sessions .s[data-session-id]')
  if (!pill || agent.streaming) return
  const session = agent.sessions.find((item) => item.id === pill.dataset.sessionId)
  if (session) renameSession(session.id, session.title)
})

// 点弹层遮罩空白处＝关闭；点切换器之外＝收起库下拉
document.addEventListener('mousedown', (event) => {
  if (event.target.id === 'overlay') closeModal()
  const switcher = document.getElementById('lib-switch')
  const panel = document.getElementById('lib-switch-panel')
  if (panel?.classList.contains('open') && switcher && !switcher.contains(event.target)) {
    panel.classList.remove('open')
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
