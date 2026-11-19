/**
 * OpenStory 工作台数据与路由（OS-3 ＋ OS-4）。
 *
 * 全部数据来自本机 daemon（127.0.0.1）：
 *   GET  /api/libraries → 库卡
 *   （OS-54：条目/wiki 视图端点已剔除——fact 数据由推演/曲线/图谱通道消费）
 *   GET/PUT /api/chapter→ 正文读/写（PUT 同目录 .history 备份）
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
  loading: false,
  error: '',
  styles: [],
  stylesWarnings: [],
  skin: '',
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
  scriptModule: null,
  jobs: { list: [], active: 0, open: false, loading: false, pollTimer: null },
  analyze: { open: false, result: null, busy: false, dismissed: {}, activePara: -1, expandOthers: false, fact: null, factRoot: '', factTab: 'emotion', modOpen: {},
    enabled: [], enabledRoot: '', pickerOpen: false, work: {}, workRoot: '', workLoaded: false, workLoading: false },
  deduce: { premise: '', variables: '', question: '', sessionId: '', streaming: false, reply: '', controller: null, error: '',
    mode: 'engine', engine: { busy: false, data: null, pov: '', seed: '', error: '', hint: '',
      session: null, sessionLoaded: false, customText: '', draft: null, turnBusy: false, archiveNote: '',
      // OS-86 多局：当前局 id（='main'＝legacy 主线）＋局清单缓存（设置浮层切换/新建/删除用）
      sessionId: 'main', sessions: null,
      view: 'scene', treePick: null,
      assets: null, assetsLoaded: false, assetBookId: '', bgmOn: false,
      // OS-81 叙事流：纸面模式（关掉立绘背景回纯纸面）/ 贴底跟随 / 序章折叠
      paperMode: false, flowPin: true, introOpen: null } },
  artifacts: { root: '', groups: [], totals: null, loading: false, error: '', previewFile: '', previewText: '', previewLoading: false },
  // 参考载体（OS-44）：索引 / 当前笔记 / 反链 / 筛选标签
  reference: { loaded: false, loading: false, notes: [], tags: [], tagNotes: {}, stats: null, error: '', activePath: '', activeTag: '', note: null, backlinks: { linked: [], unlinked: [] }, draft: '', view: 'graph', q: '', focus: null, absorb: {}, flash: '', tagFilter: '', from: '', noteText: '', fmLen: 0 },
  // 左内容栏三模块（OS-44）：章节树 / 参考图谱 / 参考摘要
  refCol: { graph: null, graphLoading: false, graphError: '', summary: '', summaryBusy: false, summaryError: '', pick: null },
  settings: { userDir: '', section: 'plugins', suiteId: '', open: false, prevView: '', helpOpen: false },
  kbStatus: null,
  tabHidden: {},
  ssJump: null,
  // 产物驳回记录（OS-51）：msgHtml index → true。会话级，不落档
  rejectedMsgs: {},
  suites: [],
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
    if (state.view === 'write' && state.analyze.open) renderAnalyzePanel()
    if (state.view === 'dir:拆解') render()
  })
  .catch(() => {})

let mdReady = false
loadMd().then(() => { mdReady = true; if (state.view === 'write') render() }).catch(() => {})



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
  if (!hasAny && !active) { host.innerHTML = ''; return }
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
  host.innerHTML = `<div class="job-ball-wrap${jobs.open ? ' open' : ''}">
    <button class="job-ball${active > 0 ? ' busy' : ''}" data-action="job-ball-toggle" title="后台任务（${active} 进行中 / ${list.length} 总计）">
      <span class="jb-ic">◱</span>${dot}
    </button>
    ${jobs.open ? `<div class="job-panel">
      <div class="jb-head">
        <b>后台任务</b><span class="jb-sub">${active} 进行中 · ${settled.length} 已结束</span>
        <button class="jb-clear" data-action="job-clear" title="清空已结束">清空已完成</button>
      </div>
      <div class="jb-list">
        ${running.length ? `<div class="jb-group">进行中</div>${running.map(row).join('')}` : '<div class="jb-empty">没有进行中的任务</div>'}
        ${settled.length ? `<div class="jb-group">已结束</div>${settled.slice(0, 10).map(row).join('')}` : ''}
      </div>
    </div>` : ''}
  </div>`
}

/* ---------- 渲染 ---------- */

function render() {
  ensureJobsPolling()
  const current = state.current
  const switchName = document.getElementById('lib-switch-name')
  if (switchName) switchName.textContent = current ? current.name : (state.libraries.length ? '选择库' : '还没有库')
  renderLibSwitchPanel()
  renderTabs()
  // 故事源图表实例只属于图表态；换页/换形态先释放，避免画布挂在已卸的 DOM 上
  if (state.view !== 'dir:拆解') disposeStorySourceChart()
  // 正文页自己管滚动（页头吸顶＋纸面/右栏各自滚），外层不再滚动
  // OS-76：剧本页也用沉浸式排版（与正文页同构：铺满视口、左中右三栏）
  // OS-84：推演全形态（叙事流/剧情树/Agent）同一壳——铺满视口、内容区自己滚
  viewEl.classList.toggle('content-locked', state.view === 'write' || state.view === 'dir:剧本'
    || state.view === 'deduce')
  if (state.view !== 'deduce') dedTypewriterStop()
  if (state.view === 'libraries') viewEl.innerHTML = libraryHtml()
  else if (state.view === 'write') {
    viewEl.innerHTML = writeHtml()
    // 版面换了 DOM：批注面板要重挂（否则右栏是空的），标注与吸顶也要重算
    renderAnalyzePanel()
    paintDocAnnotations()
    afterRefColMount()
  }
  else if (state.view === 'habits') {
    viewEl.innerHTML = habitsViewHtml()
  }
  else if (state.view === 'reference') {
    viewEl.innerHTML = referencePageHtml()
    // 图谱视图：挂大画布（focus 模式）；笔记视图：详情页右上角小图谱（本词条邻域）
    if ((state.reference.view || 'graph') === 'graph') {
      // 无数据时先拉再重渲——loading 态没有 canvas，mountReferenceGraph 会早退，
      // 之前默认进图谱视图会永远停在「正在构图…」（OS-54）
      if (!state.refCol.graph && !state.refCol.graphLoading) {
        // 不能在外面预设 graphLoading——loadRefGraph 的防重入 guard 会直接 return，
        // then 里 render 又进本分支 = 无限循环（OS-54 修）
        loadRefGraph().then(() => { if (state.view === 'reference') render() })
      } else {
        mountReferenceGraph()
      }
    }
    else if (state.reference.activePath && state.reference.note) mountDetailGraph()
  }
  else if (state.view === 'lib-create') viewEl.innerHTML = createHtml()
  else if (state.view === 'lib-import') viewEl.innerHTML = importHtml()
  else if (state.view === 'repair') viewEl.innerHTML = repairHtml()
  else if (state.view === 'deduce') {
    viewEl.innerHTML = deduceHtml()
    // 进入推演页自动续上已有局面（OS-60）：以前进来永远是空态，库里推过的拍看不到，
    // 得手动点「开始推演」——但那会额外推一拍，语义是错的。
    const engine = state.deduce.engine
    if (!engine.data && !engine.busy && !engine.error && state.current?.path) {
      engine.busy = true
      api('/api/deduce/present', { method: 'POST', body: JSON.stringify({ root: state.current.path, peek: true }) })
        .then((payload) => {
          if (payload?.ok === false && payload.code === 'NO_DEDUCE_SESSION') return
          engine.data = payload
          if (Array.isArray(payload.characters)) state.deduce.characters = payload.characters
          deduceRestoreDraft()
        })
        .catch(() => { /* 没有会话就当空态，不报错 */ })
        .finally(() => { engine.busy = false; if (state.view === 'deduce') render() })
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
        .finally(() => { if (state.view === 'deduce') render() })
      // OS-86 多局清单：设置浮层里的局列表（切换/新建/删除）
      api(`/api/deduce/sessions?root=${encodeURIComponent(state.current.path)}`)
        .then((payload) => { engine.sessions = { activeId: payload.activeId, sessions: payload.sessions ?? [] } })
        .catch(() => { engine.sessions = null })
    }
    // 剧情树（OS-61 P3）：树视图挂 SVG 导图；离开树视图就清理（mode 在 state.deduce 上，不在 engine 上）
    if (state.deduce.mode === 'engine' && engine.view === 'tree') mountDeduceTree()
    else { deduceTreeCleanup?.(); deduceTreeCleanup = null }
    // 文游素材（OS-61 P4）：进页拉一次盘点；打字机只在「当前局面」视图挂
    if (!engine.assetsLoaded) {
      engine.assetsLoaded = true
      api(`/api/deduce/assets?root=${encodeURIComponent(state.current.path)}`)
        .then((payload) => {
          engine.assets = { characters: payload.characters || [], scenes: payload.scenes || [], bgm: payload.bgm || [] }
          engine.assetBookId = text(payload.bookId)
        })
        .catch(() => { engine.assets = { characters: [], scenes: [], bgm: [] } })
        .finally(() => { if (state.view === 'deduce') render() })
    }
    if (state.deduce.mode === 'engine' && engine.view !== 'tree') mountDedFlow()
    else dedTypewriterStop()
  }
  else if (state.view === 'settings') viewEl.innerHTML = settingsHtml()
  else if (state.view === 'artifacts') viewEl.innerHTML = artifactsHtml()
  else if (state.view?.startsWith('dir:')) {
    const dir = state.view.slice(4)
    viewEl.innerHTML = dirViewHtml(dir)
    if (dir === '拆解') mountStorySourceChart()
    // OS-76：剧本页 fork 正文页——同样的左右栏挂载（图谱/摘要/分析面板）
    if (dir === '剧本') {
      renderAnalyzePanel()
      afterRefColMount()
    }
  }
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
  // 参考详情页自己的保存提示（OS-53 实时编辑）
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

/** 剧本块 HTML → 剧本文本（OS-76：与 blockHtmlToMd 同职责，但保留剧本标记）。
 * 按 data-sc-kind 重建：幕 `# 标题`、场景 `*〔…〕*`、台词 `**名**（提示）：说白`。 */
function scriptBlockToRaw(blockEl) {
  // data-sc-kind 渲染在内层块（.sc-line/.sc-act/…）上，不在 doc-block 外层——
  // 先读外层（兼容），再从内层找；两处都没有才算 action。
  const inner = blockEl.querySelector('[data-sc-kind]')
  const kind = blockEl.dataset.scKind || inner?.dataset.scKind || ''
  const raw = blockEl.dataset.raw || ''
  // contenteditable 里 innerText 会受浏览器排版影响；优先用 textContent（不含渲染空白差异）
  const plain = (el) => text(el?.textContent ?? '').replace(/\s+/gu, ' ').trim()
  if (kind === 'act') return `# ${plain(blockEl) || raw.replace(/^#\s+/u, '')}`
  if (kind === 'stage') return `*〔${plain(blockEl) || raw.replace(/^\*?[〔【\[]/u, '').replace(/[〕】\]]\*?$/u, '')}〕*`
  if (kind === 'line') {
    const who = plain(blockEl.querySelector('.sc-who'))
    const hint = plain(blockEl.querySelector('.sc-hint')).replace(/^[（(]|[）)]$/gu, '')
    const said = plain(blockEl.querySelector('.sc-said'))
    // 结构被浏览器重组（span 丢了）时，用 data-raw 反解出 who/hint 兜底
    if (who && said !== undefined) return `**${who}**${hint ? `（${hint}）` : ''}：${said}`
    if (raw) {
      const m = /^\*\*([^*]+)\*\*\s*(?:[（(]([^）)]*)[）)])?\s*[:：]\s*([\s\S]*)$/u.exec(raw)
      if (m) return `**${m[1].trim()}**${m[2] ? `（${m[2].trim()}）` : ''}：${plain(blockEl) || m[3]}`
    }
    return plain(blockEl)
  }
  return plain(blockEl) || raw
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
 * 已启用的分析模块（per-library localStorage，照 hiddenTabs 的键模式）。
 * 键不存在＝作者从未表态 → 只开「本章编辑总评」（保持改造前的默认体验）。
 */
function analyzeEnabled() {
  const root = state.current?.path || ''
  if (state.analyze.enabledRoot !== root) {
    let saved = null
    try {
      const raw = localStorage.getItem(ANALYZE_ENABLED_KEY(root))
      if (raw !== null) saved = JSON.parse(raw)
    } catch { saved = null }
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
  try { localStorage.setItem(ANALYZE_ENABLED_KEY(root), JSON.stringify(enabled)) } catch { /* 隐私模式 */ }
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
function analyzePickerHtml() {
  const enabled = analyzeEnabled()
  const row = (mod) => {
    const on = enabled.includes(mod.id)
    return `<button class="am-row${on ? ' on' : ''}" data-action="analyze-module-toggle" data-module-id="${esc(mod.id)}">
      <span class="am-check">${on ? '✓' : ''}</span>
      <span class="am-row-main"><b>${esc(mod.label)}</b><span class="am-row-hint">${esc(mod.hint || '')}</span></span>
    </button>`
  }
  const chapter = analyzeModulesFor('chapter')
  const work = analyzeModulesFor('work')
  const menu = state.analyze.pickerOpen
    ? `<div class="am-menu">
        ${chapter.length ? `<div class="am-group"><h5>本章</h5>${chapter.map(row).join('')}</div>` : ''}
        ${work.length ? `<div class="am-group"><h5>整部作品</h5>${work.map(row).join('')}</div>` : ''}
        ${!chapter.length && !work.length ? '<p class="sub">分析模块还没装载。</p>' : ''}
      </div>`
    : ''
  return `<div class="am-bar"><button class="am-add${state.analyze.pickerOpen ? ' on' : ''}" data-action="analyze-picker" title="选择要跑的分析模块">＋ 分析</button><span class="am-bar-note">${enabled.length} 个已启用</span></div>${menu}`
}

/** 正文右栏的 work 模块卡：取数→结论，头部带「在故事源中查看」。 */
function analyzeWorkCardHtml(mod) {
  const entry = state.analyze.work?.[mod.id]
  let body
  if (!entry) body = '<div class="am-empty">正在取数…</div>'
  else if (entry.error) body = `<div class="warn-box">${esc(entry.error)}</div>`
  else body = mod.render(entry.result, {})
  return `<section class="analyze-sec am-card">
    <div class="am-card-head"><h4>${esc(mod.label)}</h4>
      <button class="am-goto" data-action="analyze-to-source" data-module-id="${esc(mod.id)}">在故事源中查看</button></div>
    ${body}
  </section>`
}

/** 本章模块需要的外部状态（注册表不读全局 state——由这里注入）。 */
function analyzeChapterView() {
  return {
    dismissed: state.analyze.dismissed,
    activePara: state.analyze.activePara,
    expandOthers: state.analyze.expandOthers,
    modOpen: state.analyze.modOpen,
    hidden: [...hiddenModules()],
    charts: chartsModule,
    fact: state.analyze.fact,
    factTab: state.analyze.factTab,
    chapterNo: chapterNoFromFile(state.chapterFile)
  }
}

/**
 * 分析面板（S3 封装化）：模块选择器 + 已选模块渲染。
 * 本章模块吃 analyzeChapter 的结果；work 模块吃 loadWorkAnalysis 拉来的整书数据。
 * 默认只启用 chapter-editorial —— 与改造前的整块面板完全一致。
 */
function analyzePanelHtml() {
  const enabled = analyzeEnabled()
  const parts = [analyzePickerHtml()]
  let cards = 0
  for (const id of enabled) {
    const mod = analyzeModuleById(id)
    if (!mod) continue
    cards += 1
    if (mod.scope === 'chapter') {
      if (state.analyze.busy) {
        parts.push('<div class="analyze-sec"><div class="loading">正在分析…</div></div>')
      } else if (!state.analyze.result) {
        parts.push(`<div class="analyze-sec"><button class="btn-primary" data-action="analyze-run">${esc(mod.emptyLabel || '开始分析')}</button></div>`)
      } else {
        parts.push(mod.render(state.analyze.result, analyzeChapterView()))
      }
      continue
    }
    parts.push(analyzeWorkCardHtml(mod))
  }
  if (!cards) {
    parts.push(`<div class="am-empty">${analysisModules ? '还没有选装分析模块——点「＋ 分析」挑一个。' : '正在装载分析模块…'}</div>`)
  }
  return `<div class="analyze-body">${parts.join('')}</div>`
}

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
  go('dir:拆解')
}

/** 故事源条目 → 正文：先切页，等章节清单回来再按章号挑文件（P1 只定位到章）。 */
async function jumpToWriteChapter(no) {
  const chapterNo = Number(no)
  if (!chapterNo || !state.current) return
  go('write')
  await loadWriteChapters()
  const file = (state.write.chapters || []).find((chapter) => chapterNoFromFile(chapter.file) === chapterNo)?.file
  if (file) loadChapter(file)
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
    const kbRow = (k, v) => v ? `<div class="kb-row"><span class="kb-k">${esc(k)}</span><span class="kb-v">${esc(v)}</span></div>` : ''
    const unit = cur.length?.unit === 'episodes' ? '集' : cur.length?.unit === 'minutes' ? '分钟' : '字'
    const div = cur.length?.divideBy === 'chapter' ? '章' : cur.length?.divideBy === 'episode' ? '集' : cur.length?.divideBy === 'scene' ? '场' : ''
    const lenParts = []
    if (cur.length?.total?.target) lenParts.push(`总约 ${cur.length.total.target} ${unit}（${cur.length.total.min ?? '–'}–${cur.length.total.max ?? '–'}）`)
    if (div && cur.length?.perUnit?.target) lenParts.push(`每${div}约 ${cur.length.perUnit.target} ${unit}`)
    kbCard = `<div class="kb-card"><div class="kb-head">知识库 · ${esc(cur.name)}<span class="kb-sub">以下标注每轮注入 Agent</span></div>
      ${kbRow('节奏', pol.pacing)}
      ${kbRow('开篇', pol.openHook)}
      ${kbRow('审阅重点', (pol.reviewFocus || []).join('；'))}
      ${kbRow('禁忌', (pol.forbidden || []).join('；'))}
      ${kbRow('篇幅', lenParts.join('；'))}
      ${(cur.knowledgePacks || []).length ? `<div class="kb-row"><span class="kb-k">知识包</span><span class="kb-v">${cur.knowledgePacks.map((t) => `<span class="kb-tag">${esc(t)}</span>`).join('')}</span></div>` : ''}
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
    styleRows.push(`<div class="pop-item genre-item" data-action="pick-style" data-skill-name="${esc(skill.name)}"><span class="pi-ic">${on ? '✓' : '○'}</span><span class="genre-main"><b>${esc(skill.name)}${on ? '<i class="on-tag">主导文风</i>' : ''}</b><i class="genre-desc">${esc(skill.description || '')}</i></span></div>`)
  }

  // —— 级3 方法论（多选）——
  const methodRows = methodSkills.map((skill) => {
    const on = activeMethods.includes(skill.name)
    return `<div class="pop-item genre-item" data-action="toggle-method" data-skill-name="${esc(skill.name)}"><span class="pi-ic">${on ? '☑' : '☐'}</span><span class="genre-main"><b>${esc(skill.name)}</b><i class="genre-desc">${esc(skill.description || '')}</i></span></div>`
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
      if (!(state.libDirs || []).includes(dir)) state.view = 'write'
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
    <div class="pop-item" data-action="pick-file" data-dir="参考"><span class="pi-ic">🗂</span><b>引用参考</b><i>把一篇参考喂给 Agent</i></div>
    <div class="pop-div"></div>
    <div class="pop-title">指令</div>
    <div class="pop-item" data-action="cmd-fill" data-cmd="请总结当前章节的剧情要点、出场人物与埋下的伏笔。"><span class="pi-ic">☑</span><b>总结本章</b><i>要点+伏笔清单</i></div>
    <div class="pop-item" data-action="cmd-fill" data-cmd="请根据已有章节与参考资料，续写下一章的正文，用待确认卡交付。"><span class="pi-ic">✎</span><b>续写下一章</b><i>产出走待确认卡</i></div>
    <div class="pop-item" data-action="cmd-fill" data-cmd="列出与本章相关的参考，逐条说明在写作时怎么用。"><span class="pi-ic">◈</span><b>查关联参考</b><i>图谱优先</i></div>
    <div class="pop-div"></div>
    <div class="pop-title">技能</div>
    ${plusSkillsHtml()}
    <div class="pop-item" data-action="pick-file" data-dir="__more" hidden></div>`
}

/** 技能节（OS-68b）：真技能货架为主列（内置/本机/套件捆绑），套件规范降为次组。 */
function plusSkillsHtml() {
  const catLabel = { craft: '技法', review: '审阅', transform: '改写', extract: '抽取' }
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
  const order = { craft: 0, review: 1, transform: 2, extract: 3 }
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
    const body = text(payload?.skill?.body || '')
    agent.pendingContext = { kind: 'skill', quote: name, context: body || `按技能《${name}》执行。`, label: `技能：${name}` }
    agent.lastError = null
  } catch (error) {
    agent.lastError = `技能全文读不到：${name}（${text(error?.message || error)}）`
  }
  closeComposerMenus()
  renderAgent()
  document.getElementById('agent-input')?.focus()
}

/** 引用文件：列该目录下的文件，点选喂给 Agent（内容截 2000 字，与参考 chip 同口径）。 */
async function pickReferenceFile(dir) {
  if (!state.current) return
  try {
    const payload = await api(`/api/files?root=${encodeURIComponent(state.current.path)}&dir=${encodeURIComponent(dir)}`)
    const menu = document.getElementById('agent-plus-menu')
    const files = Array.isArray(payload.files) ? payload.files : []
    if (!menu) return
    // files 端点返回的 file 字段是完整相对路径（含子目录）——之前只取 name 丢了子目录，
    // 拼出来「参考/绰号.md」而不是「参考/标签/绰号.md」，读文件必 404（OS-51）
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
    // 正文走 chapter 通道；其它目录（参考等）走 reference/note 通道——chapter 端点只认正文/
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

/** 生效知识链常驻提示（OS-71 作者要求「切换要有画面提示」）：
 * 题材 · 文风 · 方法论数，配了才显示（沉默层），点一下＝打开灯泡选择链。
 * 刚切换 1.5s 内加 flash 动画，让「改了什么」一眼可见。 */
function renderKbChain() {
  const host = document.getElementById('agent-kb-chain')
  if (!host) return
  const genre = state.briefGenre?.name || ''
  const picks = state.agent.picksExplicit && state.agent.picks ? state.agent.picks : null
  if (!genre && !picks?.style && !(picks?.methods || []).length) { host.innerHTML = ''; return }
  const styleName = picks?.style || ''
  const methods = picks?.methods || []
  const flash = Date.now() - (state.agent.picksFlashAt || 0) < 1600
  const segs = []
  if (genre) segs.push(`<span class="kb-chip" title="题材（写进库简报）">${esc(genre)}</span>`)
  if (styleName) segs.push(`<span class="kb-chip style" title="主导文风（每轮注入）">${esc(styleName.replace(/^style-/, ''))}</span>`)
  if (methods.length) segs.push(`<span class="kb-chip" title="${esc(methods.join('、'))}">方法论 ×${methods.length}</span>`)
  host.innerHTML = `<button class="kb-chain${flash ? ' flash' : ''}" data-action="toggle-style-menu" title="点开调整知识链">知识链 ${segs.join('<i class="kb-sep">·</i>')}</button>`
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
/**
 * 过程块（OS-51 重写）：思维链**渐进呈现**。
 *   · 每一段思考是一个独立小节：写完就折叠成一行摘要（保留在原地，可展开回看，不消失）
 *   · 最新一段直播展开；工具行插在段与段之间（按发生顺序）
 *   · 旧落档数据没有 segments（只有拼接的 thinking）→ 走兼容单段渲染
 * 全部收起后 summary 行仍给一句话概览（耗时 + 工具次数 + 段数）。
 */
function processBlockHtml(proc, { live = false } = {}) {
  if (!proc) return ''
  const tools = Array.isArray(proc.tools) ? proc.tools : []
  const segments = Array.isArray(proc.segments) && proc.segments.length
    ? proc.segments
    : (text(proc.thinking).trim() ? [{ type: 'think', text: text(proc.thinking), closed: true }] : [])
  if (!segments.length && !tools.length) return ''
  const sec = proc.elapsedMs ? (proc.elapsedMs / 1000).toFixed(1) : ''
  const toolCount = tools.length
  const metaParts = [sec ? `${sec}s` : '', toolCount ? `${toolCount} 次工具` : ''].filter(Boolean)
  const label = live ? '思考中' : '思考过程'
  // 序列化段与工具行：think 段有自己的位置；tools 按记录顺序穿插（近似发生顺序）
  const parts = []
  let toolIdx = 0
  const thinkSegs = segments.filter((seg) => seg.type === 'think')
  let thinkIdx = 0
  // 工具发生在「第几段思考之后」无法精确回放，按段数均匀插入
  for (const seg of segments) {
    if (seg.type === 'tool') { parts.push({ type: 'tool', tool: seg }); continue }
    thinkIdx += 1
    parts.push({ type: 'think', seg, index: thinkIdx })
  }
  // 工具行：没有段信息时统一排在思考后面
  if (toolCount && !parts.some((part) => part.type === 'tool')) {
    for (const tool of tools) parts.push({ type: 'tool', tool })
  }
  const thinkParts = parts.filter((part) => part.type === 'think')
  const lastThinkKey = thinkParts.length ? thinkParts[thinkParts.length - 1].seg.t : -1
  const body = parts.map((part) => {
    if (part.type === 'tool') return toolRowHtml(part.tool)
    const seg = part.seg
    const isLast = seg.t === lastThinkKey
    const open = live && isLast && !seg.closed
    const summaryText = seg.closed
      ? (seg.text.trim().split('\n')[0] || '思路').slice(0, 60) + (seg.text.trim().split('\n').length > 1 || seg.text.length > 60 ? '…' : '')
      : '正在想…'
    if (open) {
      return `<div class="proc-seg live"><div class="proc-seg-head"><i class="proc-dot"></i><span class="proc-seg-label">正在想</span></div><div class="proc-think">${esc(seg.text)}</div></div>`
    }
    return `<details class="proc-seg"><summary><span class="proc-seg-label">${esc(summaryText)}</span><span class="proc-seg-n">思路 ${part.index}</span><span class="proc-chev">›</span></summary><div class="proc-think">${esc(seg.text)}</div></details>`
  }).join('')
  return `<details class="proc-block${live ? ' live' : ''}"${live ? ' open' : ''}>
    <summary>
      <span class="proc-label"><i class="proc-dot"></i>${esc(label)}</span>
      ${metaParts.length ? `<span class="proc-meta">${esc(metaParts.join(' · '))}</span>` : ''}
      <span class="proc-chev">›</span>
    </summary>
    <div class="proc-body">${body}</div>
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
  // 工具行可点（OS-59）：点了就打开它读写的那份文件（读＝看内容，写＝跳到正文/世界书）
  const clickable = target && !tool.isError ? ` data-action="tool-open" data-tool-target="${esc(target)}" role="button" tabindex="0" title="打开 ${esc(target)}"` : ''
  return `<div class="${cls}${clickable ? ' clickable' : ''}"${clickable}>
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
  // 多段产出（OS-59）：模型一次给两章时，每个围栏一个正文框，按出现顺序与文件路径配对。
  // 之前只取第一个围栏——第二章直接消失，作者以为模型漏写了。
  const fences = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)]
    .map((match) => match[1].trim())
    .filter((body) => body.replace(/\s/gu, '').length >= 80)
  if (!fences.length) return null
  const renderOne = (body, file) => {
    // 正文按小说排版渲染（OS-51：单换行也成段）
    const paragraphs = body.split(/\n+/u).map((block) => block.trim()).filter(Boolean)
    const rendered = paragraphs.map((block) => `<p>${esc(block)}</p>`).join('')
    return `<div class="prose-out">
    <div class="prose-out-head">
      <span class="po-label">正文</span>
      <code class="po-file">${esc(file)}</code>
      <button class="po-copy" data-action="copy-text" data-copy-target="po-${esc(file.replace(/[^\w]/gu, '_'))}" title="复制这段正文">复制</button>
    </div>
    <div class="prose-out-body" id="po-${esc(file.replace(/[^\w]/gu, '_'))}">${rendered}</div>
  </div>`
  }
  return fences.map((body, index) => renderOne(body, files[index] || files[0])).join('')
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
    // 把**所有**正文围栏从 markdown 里摘掉，避免渲染两遍（OS-59 多段产出：g 修饰符）
    const rest = raw.replace(/```[^\n]*\n[\s\S]*?```/gu, '')
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
  for (const match of raw.matchAll(/(?:正文[\/])?([0-9]{3}[-_—][^`'"）)\n]+?\.md)/gu)) {
    files.add(`正文/${match[1]}`)
  }
  for (const match of raw.matchAll(/(正文[\/][^`'"）)\n]+?\.md)/gu)) {
    files.add(match[1].replaceAll('\\', '/'))
  }
  if (!files.size) return []
  // a) 代码块 ≥80 字（去掉围栏行）——多段产出（模型一次给两章）也认：
  //    按围栏出现顺序与文件路径出现顺序配对，产出多少个正文框由围栏数决定（OS-59）
  const fences = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map((match) => match[1].trim())
  const usable = fences.filter((block) => block.replace(/\s/gu, '').length >= 80)
  if (usable.length) return [...files]
  // b) 连续引用块 ≥3 行且合计 ≥80 字
  const quoteLines = raw.split('\n').filter((line) => /^\s*>\s?\S/u.test(line))
  if (quoteLines.length >= 3 && quoteLines.join('').replace(/[\s>]/gu, '').length >= 80) return [...files]
  // c) 单行长引用块 ≥60 字（OS-51 放宽：润笔「拟替换 + 引用块」常只有一行长文）
  if (quoteLines.length >= 1 && quoteLines.join('').replace(/[\s>]/gu, '').length >= 60) return [...files]
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
  const rejected = agent.rejectedMsgs?.[index]
  const adoptBtn = files.length && !rejected
    ? `<button class="msg-act primary" data-action="card-from" data-msg-index="${index}" title="${files.length > 1 ? `把 ${files.length} 段正文分别写进 ${esc(files.slice(0, 2).join('、'))}${files.length > 2 ? ' 等' : ''}` : `把这段写进 ${esc(files[0])}`}">采纳${files.length > 1 ? ` ${files.length} 段` : ''}</button>`
    : ''
  // OS-51：产物形态补齐——驳回（收起这条的产物按钮）与重新修改（带文件上下文重开一轮）
  const redoBtn = files.length && !rejected
    ? `<button class="msg-act" data-action="msg-redo" data-msg-index="${index}" data-file="${esc(files[0])}" title="就这段产物提修改要求">重新修改</button>`
    : ''
  const rejectBtn = files.length && !rejected
    ? `<button class="msg-act" data-action="msg-reject" data-msg-index="${index}" title="不采纳，收起这些按钮">驳回</button>`
    : ''
  const rejectedTag = rejected ? '<span class="msg-act dead">已驳回</span>' : ''
  const foot = (adoptBtn || copyBtn || redoBtn || rejectBtn || rejectedTag)
    ? `<div class="msg-foot">${adoptBtn}${redoBtn}${rejectBtn}${copyBtn}${rejectedTag}</div>`
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
  renderKbChain()
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

const SETTINGS_SECTIONS = Object.freeze([
  { id: 'plugins', label: '插件', hint: '套件与 Agent 运行时' },
  { id: 'models', label: '模型', hint: '对话 / 生图 / 识图' },
  { id: 'appearance', label: '风格', hint: '皮肤包切换' },
  { id: 'script', label: '剧本', hint: '自动排版与角色配色' },
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
/* ---------- 设置 · 剧本（OS-78）：自动排版与角色配色 ---------- */

/**
 * 剧本设置项（per-library localStorage，与 hiddenTabs 同 pattern）：
 *   autoFormat   —— 自动排版（自由文本 → 规范剧本格式）
 *   castColors   —— 角色专属颜色
 */
function scriptPrefs() {
  const root = state.current?.path || ''
  const key = `openstory-script-prefs::${root}`
  try {
    const raw = JSON.parse(localStorage.getItem(key) || '{}')
    return {
      autoFormat: raw.autoFormat !== false,   // 默认开
      castColors: raw.castColors !== false    // 默认开
    }
  } catch {
    return { autoFormat: true, castColors: true }
  }
}

function setScriptPref(name, value) {
  const root = state.current?.path || ''
  const key = `openstory-script-prefs::${root}`
  const next = { ...scriptPrefs(), [name]: value }
  try { localStorage.setItem(key, JSON.stringify(next)) } catch { /* 存不下就只影响本次 */ }
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
        <button class="btn-ghost" data-action="script-to-fact">剧本 → 拆解条目</button>
        <button class="btn-ghost" data-action="fact-to-script">拆解条目 → 剧本</button>
      </div>
      <span class="cfg-note">「剧本 → 拆解」把幕/角色/场景抽成 fact 条目（写入 拆解/）；「拆解 → 剧本」按 fact 反向渲染成剧本文本。</span>
    </div>

    <div class="ded-image-ops">
      <button class="btn-ghost" data-action="close-modal">取消</button>
      <button class="btn-primary" data-action="script-pref-save-modal">保存</button>
    </div>
    <div class="err" id="sm-err"></div>`)
}

/** 剧本↔fact 互转（弹层按钮触发）——方向 A：剧本 → 拆解条目。 */
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
    // 先问服务端本库事实包叫什么（拆解/ 下最新的那份），落到同一本书上。
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
    state.reference.flash = `已转成 ${payload.entries} 条拆解条目（${bookId}）——去「故事源」看`
    render()
  } catch (error) {
    if (errEl) errEl.textContent = `转失败：${text(error?.message || error)}`
  }
}

/** 方向 B：拆解条目 → 剧本。 */
async function factToScriptFlow() {
  const sf = state.scriptFact
  if (!sf?.factToScript) { alert('互转模块还没加载，稍后再试'); return }
  const errEl = document.getElementById('sm-err')
  try {
    const work = dirWork('剧本')
    // OS-83 修：bookId 不能拿剧本文件名凑（空目录时是 ''，会退化成 'screenplay' 再查成 404）。
    // 拆解事实包按「库」存，不传 bookId 就是本库全量——这才是互转要读的东西。
    const payload = await api(`/api/fact/entries?root=${encodeURIComponent(state.current.path)}&limit=500`)
    if (!payload.ok) throw new Error(payload.error?.message || '读条目失败')
    const { text: scriptText, stats } = sf.factToScript(payload.entries, payload.wiki)
    if (!scriptText.trim()) { if (errEl) errEl.textContent = '这部书还没有可用的拆解条目'; return }
    // 空剧本目录：先落一个文件名，否则 PUT 没有落点（旧实现直接静默失败）
    if (!work.file) {
      const stamp = new Date().toISOString().slice(0, 10)
      work.file = `剧本/${stamp.replace(/-/gu, '')}-${escFileName('由拆解生成')}.md`
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
      ? `已按 ${stats.acts} 条剧情梳理出剧本骨架（${stats.sketches} 段剧情概要）——拆解里没有台词/事件明细，台词待你补写`
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

function settingsScriptSectionHtml() {
  if (!state.current) {
    return `<div class="step"><h3>剧本</h3><p class="sub">剧本设置是「按库」的——先选一个库。</p></div>`
  }
  const prefs = scriptPrefs()
  const isScriptLib = (state.current.kind || '').includes('script') || (state.libDirs || []).includes('剧本')
  return `
    <div class="cfg-card">
      <div class="cfg-head"><h3>自动排版</h3><span class="cfg-note">把自由输入转成规范剧本格式</span></div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="sc-pref-autoformat"${prefs.autoFormat ? ' checked' : ''}>
          <span>启用自动排版（保存时自动规范化）</span>
        </label>
      </div>
      <div class="sc-rule-list">
        <div class="sc-rule"><code>洪信：你来了。</code><span>→</span><code>**洪信**：你来了。</code></div>
        <div class="sc-rule"><code>洪信（压低声音）：…</code><span>→</span><code>**洪信**（压低声音）：…</code></div>
        <div class="sc-rule"><code>【场景】山道</code><span>→</span><code>*〔场景：山道〕*</code></div>
        <div class="sc-rule"><code>（幕落）</code><span>→</span><code>*〔幕落〕*</code></div>
        <div class="sc-rule"><code>第一幕：雨前</code><span>→</span><code># 第一幕：雨前</code></div>
      </div>
      <span class="cfg-note">已是规范格式的行不会被二次包装（幂等）；不确定的行保持原样（保守）。</span>
    </div>

    <div class="cfg-card">
      <div class="cfg-head"><h3>角色配色</h3><span class="cfg-note">每个角色一个专属色</span></div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="sc-pref-castcolors"${prefs.castColors ? ' checked' : ''}>
          <span>给不同角色不同颜色（按名字稳定生成，换个库也一致）</span>
        </label>
      </div>
      <div class="sc-cast-preview">${castColorPreviewHtml()}</div>
      <span class="cfg-note">颜色由角色名 hash 到固定色相（HSL 42% 饱和度、深色文字），不用手工维护。</span>
    </div>

    ${isScriptLib ? '' : '<div class="cfg-note" style="padding:8px 0">提示：当前库不是剧本载体，这里的设置会在打开剧本页时生效。</div>'}

    <div class="row">
      <button class="btn-primary" data-action="script-pref-save">保存剧本设置</button>
      <span class="cfg-note" id="sc-pref-note"></span>
    </div>`
}

/** 角色配色预览：从当前剧本抽取角色，各显示一个色块。 */
function castColorPreviewHtml() {
  const work = dirWork('剧本')
  const mod = state.scriptModule
  if (!mod?.splitScriptBlocks || !work?.text) return '<span class="cfg-note">当前库没有剧本——打开剧本页后这里会显示角色配色预览。</span>'
  const cast = [...new Set(mod.splitScriptBlocks(work.text).filter((b) => b.kind === 'line' && b.who).map((b) => b.who))]
  if (!cast.length) return '<span class="cfg-note">剧本里还没有角色台词。</span>'
  return cast.slice(0, 12).map((name) => {
    const c = castColorOf(name)
    return `<span class="cast-chip" style="background:${c.bg};color:${c.fg}">${esc(name)}</span>`
  }).join('')
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
  models: '这里配四样东西：对话模型（Agent 平时用的那条通道）、生图、识图、以及 Agent 的默认档。填完可以先点「测试连接」——它会真的发一个最小请求试连，没保存的值也能测。生图的测试会真生成一张小图、消耗额度，所以会先问你一次。',
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

function cfgBadgeHtml(kind) {
  const probe = agent.probes[kind]
  const state = probe?.state ? ` ${probe.state}` : ''
  const label = probeBadgeLabel(probe)
  return `<span class="cfg-badge${state}" data-probe-badge="${esc(kind)}" title="${esc(label)}">${esc(label)}</span>`
}

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
function dshModelValue(model) {
  return model.provider ? `${model.provider}/${model.id}` : model.id
}

function dshModelOptionsHtml(current, emptyLabel) {
  const models = agent.dshModels || []
  const value = text(current)
  const rows = [`<option value=""${value ? '' : ' selected'}>${esc(emptyLabel)}</option>`]
  let known = false
  for (const model of models) {
    const id = dshModelValue(model)
    if (id === value) known = true
    rows.push(`<option value="${esc(id)}"${id === value ? ' selected' : ''}>${esc(model.name)}${model.providerName ? `（${esc(model.providerName)}）` : ''}</option>`)
  }
  if (value && !known) rows.push(`<option value="${esc(value)}" selected>${esc(value)}（当前值，不在清单里）</option>`)
  return rows.join('')
}

function dshModelFieldHtml(id, label, current, emptyLabel) {
  const models = agent.dshModels || []
  if (!models.length) {
    return `<div class="field"><label>${esc(label)}</label>
      <select class="select" id="${esc(id)}">${dshModelOptionsHtml(current, emptyLabel)}</select>
      <span class="cfg-note">DSH 模型清单没取到（DSH 没装或 profile 没就绪）——先在「插件 · 运行时」里修好，这里才能选。</span>
    </div>`
  }
  return `<div class="field"><label>${esc(label)}</label>
    <select class="select" id="${esc(id)}">${dshModelOptionsHtml(current, emptyLabel)}</select>
  </div>`
}

function settingsModelsSectionHtml() {
  const config = agent.config
  if (!config) {
    return `<div class="step"><h3>模型</h3><p class="sub">配置还没读到——确认 daemon 在跑，再回到设置重进这一节。</p></div>`
  }
  const runtime = text(agent.runtime)
  const isDsh = settingRuntimeKind(runtime) === 'dsh'
  const textBlock = config.text ?? {}
  const image = config.image ?? {}
  const vision = config.vision ?? {}
  const agentBlock = config.agent ?? {}

  const runtimeOptions = [
    `<option value=""${runtime ? '' : ' selected'}>Pi（默认兜底）</option>`,
    ...(agent.runtimeList || []).filter((item) => item.id).map((item) => `<option value="${esc(item.id)}"${item.id === runtime ? ' selected' : ''}>${esc(item.name)}${item.source ? `（${esc(item.source)}）` : ''}</option>`)
  ].join('')

  const runtimeKind = settingRuntimeKind(runtime)
  const activeKit = (agent.runtimeList || []).find((item) => item.id === runtime)
  const kitModels = Array.isArray(activeKit?.models) ? activeKit.models : []
  // OS-74：三种运行时三种表单——DSH（模型从 /models 选）/ CLI（模型从 kit.models 选，凭据走 CLI 自己）/ Pi（直连端点）
  const textFields = isDsh
    ? `${dshModelFieldHtml('mcfg-text-model', '主模型（对话）', textBlock.model, '用运行时自己的默认模型')}
       ${dshModelFieldHtml('mcfg-subagent-model-a', '子 agent 模型', agentBlock.subagentModel, '跟主模型一样')}
       ${dshDepthFieldHtml()}
       <div class="field">
         <label class="cfg-switch">
           <input type="checkbox" id="mcfg-chinese"${agent.chineseReasoning !== false ? ' checked' : ''}>
           <span>用中文推理（推荐）</span>
         </label>
         <span class="cfg-note">中文写作讨论用中文思考更贴题，代价是可能损失一部分形式化推理性能。</span>
       </div>`
    : runtimeKind === 'cli'
      ? `<div class="field"><label>模型（走 ${esc(activeKit?.name || 'CLI')} 自己的模型清单）</label>
           <select class="select" id="mcfg-cli-model">
             <option value=""${textBlock.model ? '' : ' selected'}>用 kit 缺省（${esc(activeKit?.defaultModel || '未声明')}）</option>
             ${kitModels.map((m) => `<option value="${esc(m)}"${textBlock.model === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}
           </select>
           <span class="cfg-note">CLI 用自己登录的凭据；本仓不存 key、不直连 LLM API——跑动记录因此一致。</span>
         </div>
         <div class="field"><label>子 agent 模型（可选）</label>
           <select class="select" id="mcfg-cli-subagent-model">
             <option value=""${agentBlock.subagentModel ? '' : ' selected'}>跟主模型一样</option>
             ${kitModels.map((m) => `<option value="${esc(m)}"${agentBlock.subagentModel === m ? ' selected' : ''}>${esc(m)}</option>`).join('')}
           </select>
         </div>`
      : `<div class="field"><label>Endpoint（OpenAI 兼容 chat/completions）</label>
         <input id="mcfg-endpoint" placeholder="https://api.deepseek.com/v1/chat/completions" value="${esc(text(textBlock.endpoint))}">
       </div>
       <div class="field"><label>模型</label>
         <input id="mcfg-model" placeholder="deepseek-chat" value="${esc(text(textBlock.model))}">
       </div>
       <div class="field"><label>API Key${textBlock.apiKeyMasked ? `（已设置 ${esc(textBlock.apiKeyMasked)}）` : ''}</label>
         <input id="mcfg-key" type="password" placeholder="${textBlock.apiKeyMasked ? '留空保留原 key' : 'sk-…'}">
       </div>`

  return `
    <div class="cfg-card" data-cfg-card="text">
      <div class="cfg-head"><h3>对话模型</h3>${cfgBadgeHtml('text')}</div>
      <div class="field"><label>运行时</label>
        <select class="select" id="mcfg-runtime">${runtimeOptions}</select>
        <span class="cfg-note">运行时决定 Agent 走哪条通道；选 DSH 时下面改选模型，选 Pi 时直连端点。</span>
      </div>
      ${textFields}
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="text">保存</button>
        <button class="btn-ghost" data-action="config-probe" data-probe-kind="text">测试连接</button>
        <span class="cfg-note" id="mcfg-text-note"></span>
      </div>
      ${isDsh ? '<span class="cfg-note">测试连接测的是 Pi 兜底端点；DSH 自身的连通性看「插件 · 运行时」的状态灯。</span>' : ''}
      <div class="err" id="mcfg-text-err"></div>
    </div>

    <div class="cfg-card" data-cfg-card="image">
      <div class="cfg-head"><h3>生图</h3>${cfgBadgeHtml('image')}</div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="mcfg-image-enabled"${image.enabled === true ? ' checked' : ''}>
          <span>启用生图（推演/世界书生成场景图时会用到）</span>
        </label>
      </div>
      <div class="field"><label>后端</label>
        <select class="select" id="mcfg-image-backend">
          <option value="openai"${(image.backend ?? 'openai') !== 'comfyui' ? ' selected' : ''}>OpenAI 兼容 API（云端）</option>
          <option value="comfyui"${image.backend === 'comfyui' ? ' selected' : ''}>ComfyUI（本机）</option>
        </select>
        <span class="cfg-note">OpenAI 兼容：填 endpoint＋模型＋key，一次请求直接出图。ComfyUI：填本地端口＋工作流 JSON，走提交→轮询→取图。</span>
      </div>
      <div class="cfg-sub" id="mcfg-image-openai"${image.backend === 'comfyui' ? ' hidden' : ''}>
        <div class="field"><label>Endpoint（OpenAI 兼容，填到 /v1 为止）</label>
          <input id="mcfg-image-endpoint" placeholder="https://api.openai.com/v1" value="${esc(text(image.endpoint))}">
        </div>
        <div class="field"><label>模型</label>
          <input id="mcfg-image-model" placeholder="gpt-image-1" value="${esc(text(image.model))}">
        </div>
        <div class="field"><label>API Key${image.apiKeyMasked ? `（已设置 ${esc(image.apiKeyMasked)}）` : ''}</label>
          <input id="mcfg-image-key" type="password" placeholder="${image.apiKeyMasked ? '留空保留原 key' : 'sk-…'}">
        </div>
      </div>
      <div class="cfg-sub" id="mcfg-image-comfy"${image.backend === 'comfyui' ? '' : ' hidden'}>
        <div class="field"><label>ComfyUI 地址（端口）</label>
          <input id="mcfg-comfy-url" placeholder="http://127.0.0.1:8188" value="${esc(text(image.comfyUrl))}">
          <span class="cfg-note">ComfyUI 默认 8188；启动后浏览器打开同地址可确认。</span>
        </div>
        <div class="field"><label>工作流 JSON（API 格式导出的那份）</label>
          <input id="mcfg-comfy-workflow" placeholder="参考/素材/comfy/scene.json 或绝对路径" value="${esc(text(image.comfyWorkflow))}">
          <span class="cfg-note">在 ComfyUI 里用「Save (API Format)」导出。相对路径按库根解析。</span>
        </div>
        <div class="field"><label>节点映射（可选，逗号分隔 key:节点id）</label>
          <input id="mcfg-comfy-nodemap" placeholder="positive:6,negative:7,seed:3" value="${esc(comfyNodeMapText(image.comfyNodeMap))}">
          <span class="cfg-note">留空＝按节点标题自动猜（Positive/Negative/KSampler/EmptyLatentImage）。</span>
        </div>
      </div>
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="image">保存</button>
        <button class="btn-ghost" data-action="config-probe" data-probe-kind="image">测试连接</button>
        <span class="cfg-note" id="mcfg-image-note"></span>
      </div>
      <span class="cfg-note">测试会真生成一张 256×256 的小图（消耗额度），点按钮后还会再确认一次。</span>
      <div class="err" id="mcfg-image-err"></div>
    </div>

    <div class="cfg-card" data-cfg-card="vision">
      <div class="cfg-head"><h3>识图</h3>${cfgBadgeHtml('vision')}</div>
      <div class="field">
        <label class="cfg-switch">
          <input type="checkbox" id="mcfg-vision-enabled"${vision.enabled === true ? ' checked' : ''}>
          <span>启用识图（派 DSH 子 agent 读图写白描）</span>
        </label>
      </div>
      <div class="field"><label>识图模型（从 DSH 模型清单选）</label>
        <select class="select" id="mcfg-vision-model">
          <option value=""${text(vision.model) ? '' : ' selected'}>用 DSH 默认模型</option>
          ${(agent.dshModels || []).map((m) => `<option value="${esc(m.provider + '/' + m.id)}"${text(vision.model) === m.provider + '/' + m.id ? ' selected' : ''}>${esc(m.providerName + ' / ' + m.name)}</option>`).join('')}
        </select>
        <span class="cfg-note">走 DSH 子 agent + 内置 read_image 工具，不引入额外模型、不直连 LLM API。跑动记录与 DSH 会话一致。</span>
      </div>
      <div class="field"><label>DSH profile（留空＝默认 openstory）</label>
        <input id="mcfg-vision-profile" placeholder="openstory" value="${esc(text(vision.profile))}">
      </div>
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="vision">保存</button>
        <span class="cfg-note">识图没有独立探测——随手生一张设定图后点「看这张图写白描」就能验。</span>
      </div>
      <div class="err" id="mcfg-vision-err"></div>
    </div>

    <div class="cfg-card" data-cfg-card="agent">
      <div class="cfg-head"><h3>Agent 默认档</h3></div>
      ${dshModelFieldHtml('mcfg-default-model', 'OpenStory 默认模型（对话模型留空时用它）', agentBlock.defaultModel, '不指定')}
      ${dshModelFieldHtml('mcfg-subagent-model', '默认子 agent 模型', agentBlock.subagentModel, '跟主模型一样')}
      <div class="field"><label>Profile 名（可选）</label>
        <input id="mcfg-profile" placeholder="openstory" value="${esc(text(agentBlock.profile))}">
        <span class="cfg-note">DSH 的 profile 名；留空＝用 DSH 自己的默认 profile。</span>
      </div>
      <div class="row">
        <button class="btn-primary" data-action="config-save" data-block="agent">保存</button>
        <span class="cfg-note" id="mcfg-agent-note"></span>
      </div>
      <div class="err" id="mcfg-agent-err"></div>
    </div>`
}

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
  return suitesSectionHtml() + settingsRuntimeSectionHtml() + settingsImageGenSectionHtml()
}

/**
 * 生图接口（S4）：真配置面在「设置 · 模型 · 生图」——这里只留一句指路，
 * 免得两处各摆一套字段、改了一边另一边不生效。
 */
function settingsImageGenSectionHtml() {
  return `<div class="step">
    <h3>生图接口</h3>
    <p class="sub">端点、模型、key 与开关都在「设置 · 模型 · 生图」里配；配好并测试可达后，推演里就能直接生成场景图。</p>
  </div>`
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
    models: settingsModelsSectionHtml,
    script: settingsScriptSectionHtml,
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
  // 捆绑技能（OS-68）：这套件自带的手艺配方——启用就上货架，停用就撤下
  const bundled = Array.isArray(suite.bundledSkills) ? suite.bundledSkills : []
  const catLabel = { craft: '技法', review: '审阅', transform: '改写', extract: '抽取' }
  const bundledHtml = bundled.length ? `<div class="bundled-skills">
      <div class="sub" style="margin-top:14px">捆绑技能（${bundled.length}）——启用即进 Agent 技能货架</div>
      ${bundled.map((skill) => `<div class="bskill-row"><b>${esc(skill.name)}</b><span class="pill sm">${esc(catLabel[skill.category] || skill.category || '技能')}</span><span class="sub">${esc(skill.summary || '')}</span></div>`).join('')}
    </div>` : ''
  return `<div class="step">
    ${head}
    ${body}
    ${bundledHtml}
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
    await probeRetiredDirs()
  } catch (error) {
    ref.error = `${error?.code ? `${error.code} · ` : ''}${text(error?.message || error)}`
  }
  ref.loading = false
}

/**
 * OS-86：探旧目录还剩多少篇——只服务参考页的「迁入旧目录」按钮（有剩才显示入口）。
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

/** 打开一篇参考笔记（含反链）。 */
/** 打开一篇参考笔记（含反链）。from='graph' 时详情页给「← 返回图谱」键。 */
/**
 * 按任意写法找参考笔记（OS-51）：支持 标题 / 相对路径 / 「参考/」前缀路径 / 带或不带 .md。
 * 之前「参考/约束/写作纪律」这种全路径匹配不到（只比对 rel 与 title），点它错弹「新建笔记」。
 */
function findReferenceByRef(ref) {
  const raw = text(ref).trim()
  if (!raw) return null
  const notes = state.reference.notes || []
  const noMd = raw.replace(/\.(?:md|markdown|txt)$/iu, '')
  const relNoPrefix = noMd.replace(/^参考[\/]/u, '')
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
 * 参考详情页（OS-51，作者 Wiki 式分层）：
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
 * 参考笔记逐块实时渲染（OS-53，作者裁定「直接用实时渲染的词条编辑」）：
 * 与正文页 renderDocBody 同一套组件口径——contenteditable 逐块、失焦写回自动保存。
 * 差异：参考笔记有 frontmatter（不可编辑），块偏移统一加上 fmLen 才是对全文的偏移；
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

/** 参考笔记块失焦写回：按全文偏移拼回 noteText → PUT /api/chapter 自动保存。 */
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
    const payload = await api('/api/chapter', {
      method: 'PUT',
      body: JSON.stringify({ root: state.current.path, file: notePath, text: nextText })
    })
    setAutosaveChip('已保存 · 刚刚')
    // 标签可能被编辑动了（frontmatter/行内 #tag）：延迟重扫索引，不重开笔记（不打断编辑）
    clearTimeout(refRescanTimer)
    refRescanTimer = setTimeout(() => {
      loadReferences({ force: true }).then(() => {
        if (state.view === 'reference') render()
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
function refImagesSlotHtml(note) {
  const images = Array.isArray(note?.images) ? note.images.filter(Boolean) : []
  const root = state.current?.path || ''
  const urlOf = (rel) => /^https?:\/\//u.test(rel)
    ? rel
    : `/api/reference/asset?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`
  const genBtn = `<button class="ref-slot-gen" data-action="ref-gen-image" title="按这个条目生成设定图（后台任务，进度看右下角任务中心）">✦ 生成设定图</button>`
  if (!images.length) {
    return `<div class="ref-img-slot empty">
      <div class="ref-slot-head">参考图</div>
      <div class="ref-slot-empty-body">${genBtn}</div>
    </div>`
  }
  const cover = images[0]
  const thumbs = images.slice(1, 7)
  return `<div class="ref-img-slot">
    <div class="ref-slot-head">参考图<span class="ref-slot-n">${images.length}</span></div>
    <div class="ref-slot-cover"><img src="${esc(urlOf(cover))}" alt="${esc(note.title || '')}" loading="lazy"></div>
    ${thumbs.length ? `<div class="ref-slot-thumbs">${thumbs.map((p) => `<img src="${esc(urlOf(p))}" alt="" loading="lazy">`).join('')}</div>` : ''}
    <div class="ref-slot-ops">${genBtn}</div>
  </div>`
}

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

function referenceEditorHtml() {
  const ref = state.reference
  const note = ref.note
  if (!note) return ''
  // OS-53：实时渲染逐块编辑——textarea「编辑/保存/取消」退役，点进去直接改
  const { body: bodySource, fmLen } = stripFrontmatterOf(note.text)
  ref.noteText = text(note.text)
  ref.fmLen = fmLen
  const body = renderRefDocBody(bodySource)
  const tagChips = (Array.isArray(note.tags) ? note.tags : [])
    .map((tag) => `<button class="pill tag-pick" data-ref-tag="${esc(tag)}" title="按这个标签筛选">#${esc(tag)}</button>`).join('')
  const mdPlain = (source) => text(source).replace(/[*_`#>[\]()|]/gu, ' ').replace(/-{2,}/gu, ' ').replace(/\s+/gu, ' ').trim()
  const excerpt = mdPlain(note.excerpt) || mdPlain(bodySource).slice(0, 120)
  // OS-81（作者裁定）：条目名是 H1；上半区左 60% 摘要正文（无卡）/ 右 40% 图片槽＋图谱槽两张卡；
  // 往下的详情全屏铺开；「关联说明」整块删除——要干净的前端。
  // OS-81 修：卡片浮在右侧（float），简介+详情在左侧流动——
  // 卡片结束后正文自然变全宽。不再用 grid 行（右栏比摘要高很多时会留一大截空白）。
  return `<div class="ref-detail">
    <div class="ref-detail-head">
      ${ref.from === 'graph' ? '<button class="btn-ghost" data-action="ref-back-graph" title="回到关系图谱">← 返回图谱</button>' : ''}
      <h1 class="ref-title">${esc(note.title || note.path)}</h1>
      <span class="ref-detail-path">${esc(note.path)}${note.chars !== undefined ? ` · ${note.chars} 字` : ''}</span>
      <span class="sp"></span>
      <span class="doc-autosave" id="ref-autosave"></span>
      <span class="count">点正文直接改，失焦自动保存</span>
      <button class="btn-ghost" data-action="ref-to-agent">发给 Agent</button>
    </div>
    <div class="ref-flow">
      <aside class="ref-side-cards">
        ${refImagesSlotHtml(note)}
        <div class="ref-graph-slot">
          <div class="ref-slot-head">关系图谱</div>
          <div class="graph-box detail"><canvas id="ref-detail-canvas"></canvas></div>
        </div>
      </aside>
      <div class="brief-tags">${tagChips}</div>
      <p class="brief-text">${esc(excerpt)}</p>
      <div class="ref-doc">${body}</div>
    </div>
  </div>`
}

/** 参考页整体（OS-48：侧栏导航 + 视图制主区）。 */
/* ---------- 习惯（OS-57）：描述性自定义表单——正向＋负向词条，Agent 成文前必读 ---------- */

async function loadHabits({ force = false } = {}) {
  if (!state.current) return
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

function habitsViewHtml() {
  const h = state.habits
  if (!state.current) return needLibraryHtml()
  if (!h) return '<div class="loading">正在读取习惯表…</div>'
  const fields = HABIT_FIELDS.map((field) => `<div class="field">
      <label>${esc(field.label)}<span class="count">　${esc(field.hint)}</span></label>
      <textarea class="habit-list" data-habit-key="${esc(field.key)}" rows="4" placeholder="${esc(field.ph)}">${esc((h[field.key] || []).join('\n'))}</textarea>
    </div>`).join('')
  return `<div class="doc-head"><div class="kick">${esc(state.current.name)} / 习惯</div><h1>习惯</h1>
      <div class="doc-meta"><span class="b">你的写作习惯表</span><span>Agent 成文前会逐条遵循；分析引擎按它扫问题</span></div></div>
    ${errorHtml()}
    <div class="habits-form">
      <div class="field"><label>口吻（分析结论的说话方式）</label>
        <select class="select" id="habit-tone">
          <option value="direct"${h.tone !== 'gentle' ? ' selected' : ''}>直言——编辑体，问题直接说</option>
          <option value="gentle"${h.tone === 'gentle' ? ' selected' : ''}>温和——先扬后抑，问题说成「可以先动的」</option>
        </select>
      </div>
      <div class="field"><label>文风（一句自述，Agent 成文与总评都以它为基调）</label>
        <input class="text" id="habit-style" value="${esc(h.style || '')}" placeholder="例如：宋明白话为骨，白描，少形容词">
      </div>
      ${fields}
      <div class="ops"><button class="btn-primary" data-action="habits-save">保存习惯表</button>
        <span class="count">保存后立即生效：Agent 成文注入＋分析扫描</span></div>
    </div>`
}

async function saveHabits() {
  if (!state.current) return
  const form = { tone: document.getElementById('habit-tone')?.value || 'direct', style: document.getElementById('habit-style')?.value || '' }
  for (const field of HABIT_FIELDS) {
    form[field.key] = (document.querySelector(`[data-habit-key="${field.key}"]`)?.value || '').split('\n').map((line) => line.trim()).filter(Boolean)
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
    stats: ref.stats,
    absorbable: absorbTotal
  })
  // 参考页自己就是双链文档工作面（侧栏导航/正文/反链），
  // 不再套题材左栏——那三块是给「小说」这类非双链页用的。
  return `<div class="topic-workspace"><div class="topic-main">${errorHtml()}${ref.flash ? `<div class="ok-note">${esc(ref.flash)}</div>` : ''}${shell}</div></div>`
}

/** 参考页·关系图谱视图（OS-51）：大画布＋节点信息卡（简介＋跳转按钮）＋标签筛选行。 */
function referenceGraphHtml() {
  const rc = state.refCol
  if (rc.graphError) return `<div class="error-box">${esc(rc.graphError)}</div>`
  if (!rc.graph) return '<div class="loading">正在构图…</div>'
  const stats = rc.graph.stats || {}
  const byKind = stats.byKind || {}
  const legend = [
    ['reference', '参考', 'var(--accent)'],
    ['tag', '标签', 'var(--warn)'],
    ['artifact', '章节/产物', 'var(--ok)'],
    ['entry', '条目（只读）', 'var(--meta)']
  ].filter(([kind]) => byKind[kind]).map(([, label, color]) =>
    `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')
  const ref = state.reference
  const focusNode = ref.focus ? rc.graph.nodes.find((node) => node.id === ref.focus) : null
  const hint = focusNode
    ? `聚焦「${focusNode.label || focusNode.id}」的邻域——跳转走卡片按钮，点空白复位`
    : '点节点看简介与跳转，点空白复位'
  // 标签筛选行（作者口径：在图谱里按固定标签筛子图）
  const topTags = (ref.tags || []).slice(0, 10)
  const tagBar = topTags.length
    ? `<div class="ref-graph-tagbar"><button class="chart-tab${ref.tagFilter ? '' : ' on'}" data-action="ref-graph-tag" data-tag="">全部</button>${topTags.map((tag) =>
      `<button class="chart-tab${ref.tagFilter === tag.name ? ' on' : ''}" data-action="ref-graph-tag" data-tag="${esc(tag.name)}">#${esc(tag.name)} ${tag.count}</button>`).join('')}</div>`
    : ''
  // 节点信息卡（点节点→邻域聚焦＋卡片；跳转只走卡片按钮）
  const card = focusNode ? refNodeCardHtml(focusNode) : ''
  return `<div class="ref-graph">
    <div class="ref-graph-meta">${stats.nodes ?? 0} 个节点 · ${stats.edges ?? 0} 条边 · ${esc(hint)}</div>
    ${tagBar}
    <div class="graph-box big" id="ref-graph-box"><canvas id="ref-graph-canvas"></canvas>${card}</div>
    <div class="graph-legend">${legend || '<span>没有节点</span>'}</div>
  </div>`
}

/** 图谱节点信息卡：类型徽章＋标签＋一句话摘要＋「打开详情」。 */
function refNodeCardHtml(node, variant = '') {
  const kindLabels = { reference: '参考', tag: '标签', artifact: '章节/产物', entry: '条目' }
  const degree = (state.refCol.graph?.edges || [])
    .filter((edge) => edge.a === node.id || edge.b === node.id).length
  const tags = Array.isArray(node.tags) ? node.tags : []
  const tagChips = tags.map((tag) => `<button class="pill tag-pick" data-ref-tag="${esc(tag)}">#${esc(tag)}</button>`).join('')
  const excerpt = text(node.excerpt).replace(/[*_`#>[\]()|]/gu, ' ').replace(/-{2,}/gu, ' ').replace(/\s+/gu, ' ').trim()
  return `<div class="ref-node-card${variant ? ` ${esc(variant)}` : ''}">
    <div class="rn-head"><span class="rn-kind ${esc(node.kind)}">${esc(kindLabels[node.kind] || node.kind)}</span><b>${esc(node.label || node.id)}</b></div>
    ${tagChips ? `<div class="rn-tags">${tagChips}</div>` : ''}
    ${excerpt ? `<p class="rn-excerpt">${esc(excerpt.slice(0, 90))}</p>` : ''}
    <div class="rn-ops">
      <span class="rn-deg">${degree} 条关联</span>
      <span class="sp"></span>
      <button class="btn-ghost" data-action="ref-node-open">打开详情 →</button>
    </div>
  </div>`
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
  if (node.kind === 'reference') {
    state.reference.view = 'note'
    // 正文页小图也走这里（OS-52）：不在参考页时先切页签
    if (state.view !== 'reference') go('reference')
    openReference(node.id, { from: 'graph' })
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
    // 标签没有「详情页」——跳转＝按该标签筛选笔记列表（清掉旧详情，主区回列表空态）
    const ref = state.reference
    ref.view = 'note'
    ref.activeTag = node.id.replace(/^tag:/u, '')
    ref.focus = null
    ref.note = null
    ref.activePath = ''
    ref.from = ''
    if (state.view !== 'reference') go('reference')
    else render()
    return
  }
  if (node.kind === 'entry') {
    // 条目工作面已剔除（OS-54）：条目数据的消费方是推演——切过去
    go('deduce')
  }
}

/** 参考页大图谱挂载（OS-48）：focus 模式——点节点聚焦邻域，再点进详情，点空白复位。 */
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
    mode: 'focus',
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
    mode: 'jump',
    focusId: state.reference.activePath,
    onPick: (node) => {
      if (node.id === state.reference.activePath) return
      navigateFromGraphNode(node)
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
    ['tag', '标签', 'var(--warn)'],
    ['artifact', '章节/产物', 'var(--ok)'],
    ['entry', '条目（只读）', 'var(--meta)']
  ].filter(([kind]) => byKind[kind]).map(([, label, color]) =>
    `<span><i style="background:${color}"></i>${esc(label)}</span>`).join('')
  // OS-52：点节点出信息卡（Obsidian 口径：hover 预览、点击看卡，跳转走卡片按钮）
  const pickNode = rc.pick ? (graph.nodes || []).find((item) => item.id === rc.pick) : null
  return `<div class="graph-box" id="ref-graph-box"><canvas id="ref-graph-canvas"></canvas></div>
    <div id="ref-graph-pick">${pickNode ? refNodeCardHtml(pickNode, 'inline') : ''}</div>
    <div class="graph-legend">${legend || '<span>没有节点</span>'}</div>
    <div class="graph-hint">${graph.stats?.nodes ?? 0} 个节点 · ${graph.stats?.edges ?? 0} 条边 · 点节点看简介，卡里跳转</div>`
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
/** OS-76：剧本页的左栏模块组——没有「章节」（剧本用幕），换成「出场人物」。
 * 世界书图谱/摘要与正文页共用同一套实现。 */
const SCRIPT_REF_MODULES = Object.freeze([
  { id: 'cast', label: '出场人物', hint: '本剧出现过的角色', render: () => scriptCastHtml(), badge: () => String((state.scriptModule?.scriptStats?.(dirWork('剧本').text || '')?.cast || []).length) },
  { id: 'graph', label: '世界书图谱', hint: '世界书与产物的关系', render: () => graphModuleHtml(), badge: () => String(state.refCol.graph?.stats?.nodes ?? 0) },
  { id: 'summary', label: '世界书摘要', hint: 'AI 基于图谱总结本剧', render: () => refSummaryHtml(), badge: () => '' }
])

/** 剧本出场人物卡：从角色台词里统计谁说了多少句。 */
function scriptCastHtml() {
  const work = dirWork('剧本')
  const mod = state.scriptModule
  if (!mod?.splitScriptBlocks || !work?.text) return '<div class="nav-empty">还没有内容</div>'
  const blocks = mod.splitScriptBlocks(work.text).filter((b) => b.kind === 'line' && b.who)
  const counts = new Map()
  for (const b of blocks) counts.set(b.who, (counts.get(b.who) || 0) + 1)
  if (!counts.size) return '<div class="nav-empty">还没有台词</div>'
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([who, n]) => `<div class="cast-row"><span class="cast-name">${esc(who)}</span><span class="cast-n">${n} 句</span></div>`).join('')
}

const REF_MODULES = Object.freeze([
  { id: 'chapters', label: '章节', hint: '卷/章两级', render: () => chapterTreeHtml(), badge: () => String((state.write.chapters || []).length) },
  { id: 'graph', label: '世界书图谱', hint: '世界书与产物的关系', render: () => graphModuleHtml(), badge: () => String(state.refCol.graph?.stats?.nodes ?? 0) },
  { id: 'summary', label: '世界书摘要', hint: 'AI 基于图谱总结本章', render: () => refSummaryHtml(), badge: () => '' }
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
/** 左栏模块卡（章节树/世界书图谱/世界书摘要）——抽出来供正文页与剧本页共用。 */
function refModulesHtml({ prepend = '', modules = null } = {}) {
  if (!state.current) return ''
  const hidden = hiddenModules()
  const source = Array.isArray(modules) ? modules : REF_MODULES
  const visible = source.filter((mod) => !hidden.has(mod.id))
  const openState = state.refCol.open ?? (state.refCol.open = {})
  const cards = visible.map((mod) => {
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
  }).join('')
  return prepend + cards
}

function refColHtml() {
  const inner = refModulesHtml()
  return inner ? `<aside class="ref-col" id="ref-col">${inner}</aside>` : ''
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
      // OS-52：点节点＝出信息卡（跟参考页大图同一套口径），跳转走卡片按钮
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
/* OS-53：textarea 版 saveReferenceNote 已退役——实时逐块编辑由 commitRefBlock 接管。 */

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
    if (state.view === 'write' && state.chapterFile) loadChapter(state.chapterFile)
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

/**
 * 目录名 → 页签标签。
 * OS-88（作者裁定）：demo 只做三种载体——长篇、短篇、剧本。**只保留有真实实现的标签**，
 * 其余（素材/漫画/视频/体验/联机/文档/人物/场景/大纲/构思/资料/约束）一律不进词表：
 * 它们没有专属页面，点进去只是一个裸 textarea，等于凭空许诺。
 * 已实现的真实页面：正文 / 世界书(参考载体) / 剧本 / 习惯 / 故事源(拆解) / 推演 / 日志(只读)。
 */
const DIR_LABELS = {
  正文: '正文',
  世界书: '世界书',
  剧本: '剧本',
  日志: '日志',
  // S2：拆解目录承载故事源（Fact 链可视化）——目录名不动，页签改叫故事源
  拆解: '故事源'
}
const DIR_ORDER = ['正文', '世界书', '剧本', '日志']
const READONLY_DIRS = new Set(['日志'])
// 只留真正有 view 的映射；其余载体在 Pinax 主程序里，不在本 demo。
const PAGE_TO_DIR_LOCAL = Object.freeze({ write: '正文', entries: '世界书', worldbook: '世界书', script: '剧本' })

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

/**
 * OS-84：已退场的旧目录（作者裁定：定位已被「参考」「习惯」覆盖，标签不再进「增加页签」面板）。
 *   · 大纲/构思/资料 → 内容迁进「参考」（referenceStore.ABSORBABLE_DIRS，参考页有迁入入口）
 *   · 约束 → 规则类内容归「习惯」(habits.json)，OS-59 起不再迁入参考
 * 退场只影响**入口**：目录空着就彻底不出现；还有文件的只降级为「旧·待迁」露出，
 * 保证老库里的稿子不会因为标签下架变成 UI 里再也打不开的死文件。
 */
const RETIRED_DIRS = Object.freeze(['大纲', '构思', '资料', '约束'])

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
    const next = state.current ? 'write' : 'libraries'
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
    { view: 'deduce', label: '推演', need: null }
  ]
  const builtinRows = builtins
    .filter((item) => (item.need ? libDirs.includes(item.need) : true))
    .map((item) => {
      const off = hidden.has(item.view)
      return `<button class="tab-pick${off ? '' : ' on'}" data-action="tab-toggle-pick" data-tab-view="${esc(item.view)}">
        <span class="tp-check">${off ? '' : '✓'}</span><b>${esc(item.label)}</b></button>`
    }).join('')
  // 目录型页签（已有目录）
  // 「参考」「习惯」不是普通目录：它们分流到 reference/habits 专页（见 renderTabs）。
  // 面板里要用同一个 view 键，否则勾选会写进 dir:参考 而页签栏根本不放它。
  const DIR_TO_VIEW = { 参考: 'reference', 习惯: 'habits' }
  const DIR_TO_LABEL = { 参考: '参考', 习惯: '习惯' }
  // OS-86：已退场的旧目录彻底不出现——不管磁盘上还在不在、有多少篇。
  // 作者口径：没被官方认证的标签就是要消失，不做「旧·待迁」降级露出；
  // 内容清理走一次性迁移（大纲/构思/资料→参考，约束→习惯＋参考存档）。
  const dirRows = libDirs
    .filter((dir) => dir !== '正文' && dir !== '世界书' && dir !== '推演')
    .filter((dir) => !RETIRED_DIRS.includes(dir))
    .sort((left, right) => DIR_ORDER.indexOf(left) - DIR_ORDER.indexOf(right))
    .map((dir) => {
      const view = DIR_TO_VIEW[dir] || `dir:${dir}`
      const off = hidden.has(view)
      const known = Boolean(DIR_LABELS[dir]) || Boolean(DIR_TO_VIEW[dir])
      const label = DIR_TO_LABEL[dir] || DIR_LABELS[dir] || dir
      return `<button class="tab-pick${off ? '' : ' on'}" data-action="tab-toggle-pick" data-tab-view="${esc(view)}">
        <span class="tp-check">${off ? '' : '✓'}</span><b>${esc(label)}</b>${known ? '' : '<span class="tp-note">未识别</span>'}</button>`
    }).join('')
  // OS-83：已识别但库里还没建的业务目录（剧本/人物/场景/素材/漫画/视频…）。
  // 以前面板只列磁盘已有的目录，于是「剧本」这种模块在小说库里整块消失——作者以为功能不存在。
  // 这里把它们如实列出来，点一下就建目录并加页签（走同一条 /api/dir 通道）。
  const creatableRows = DIR_ORDER
    .filter((dir) => Boolean(DIR_LABELS[dir]))
    .filter((dir) => !libDirs.includes(dir))
    .filter((dir) => !RETIRED_DIRS.includes(dir))
    .filter((dir) => dir !== '正文' && dir !== '世界书' && dir !== '拆解' && dir !== '人物' && dir !== '场景')
    .map((dir) => `<button class="tab-pick" data-action="tab-make-dir" data-dir-name="${esc(dir)}" title="库里还没有 ${esc(dir)}/ 目录——点一下建出来并加页签">
      <span class="tp-check">＋</span><b>${esc(DIR_LABELS[dir])}</b><span class="tp-note">待建</span></button>`)
    .join('')
  // 磁盘上有、但不在 DIR_LABELS 里的目录（作者自建的如「分镜」）也列出来——
  // 这是「加页签」的主用途之一；标「未识别」如实说明它不是内置载体。
  openModal(`
    <h3>增加页签</h3>
    <p class="sub">勾上就会出现在顶栏；取消勾选只是收起页签，磁盘上的文件和稿子不受影响。</p>
    <div class="tab-pick-sec"><h4>常用</h4><div class="tab-pick-grid">${builtinRows}</div></div>
    <div class="tab-pick-sec"><h4>库里已有目录</h4><div class="tab-pick-grid">${dirRows || '<span class="count">没有其它目录</span>'}</div></div>
    ${creatableRows ? `<div class="tab-pick-sec"><h4>可以新建的业务模块</h4><div class="tab-pick-grid">${creatableRows}</div></div>` : ''}
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
    const extra = libDirs
      // 作者要求页签可自选：库里任何顶层目录都能出页签（不再只认 DIR_LABELS 里的名单）
      .filter((dir) => dir !== '正文' && dir !== '世界书' && !excluded.has(dir))
      // OS-86：已退场的旧目录（大纲/构思/资料/约束）一律不出页签，不管磁盘上还剩什么
      .filter((dir) => !RETIRED_DIRS.includes(dir))
      .sort((left, right) => {
        const li = DIR_ORDER.indexOf(left)
        const ri = DIR_ORDER.indexOf(right)
        return (li === -1 ? 99 : li) - (ri === -1 ? 99 : ri)
      })
      .map((dir) => ({
        // 参考目录（OS-44）走专门的笔记系统页，不是通用文本页
        view: dir === '参考' ? 'reference' : (dir === '习惯' ? 'habits' : `dir:${dir}`),
        label: dir === '参考' ? '世界书' : (DIR_LABELS[dir] || dir),
        ic: dir === '参考' ? '世' : (DIR_LABELS[dir] || dir).slice(0, 1),
        readonly: READONLY_DIRS.has(dir),
        closable: true
      }))
    defs.push(...extra)
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
      fv.entriesError = text(entriesPayload.__error?.message || entriesPayload.__error)
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
const SS_CHART_KIND = Object.freeze({ 'plot-curve': 'curve', 'foreshadow-audit': 'foreshadow', 'plot-density': 'heatmap' })

function ssChartKind(id) {
  if (SS_CHART_KIND[id]) return SS_CHART_KIND[id]
  return ['curve', 'foreshadow', 'heatmap'].includes(id) ? id : 'curve'
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
  const rows = ssFilteredRows(layout, ss)
  if (!rows.length) {
    return `<div class="ss-empty">${layout.board.rows.length ? '没有匹配的条目——换个层或搜索词。' : '这本书还没有可读条目。'}</div>`
  }
  const columns = layout.board.columns
  const head = columns
    .map((column) => `<th${column.align === 'right' ? ' class="num"' : ''}>${esc(column.label)}</th>`)
    .join('')
  const body = rows.map((row) => {
    const cells = columns.map((column) => {
      let value
      if (column.key === 'name') value = ssEntryLabel(row.entry)
      else if (column.key === 'cast') value = row.cast || '—'
      else if (column.key === 'status') value = row.status || '—'
      else if (column.key === 'layerLabel') value = row.layerLabel
      else if (column.key === 'chapter') value = row.chapter || '—'
      else if (column.key === 'segment') value = row.segment || '—'
      else value = row.events
      const classes = [column.align === 'right' ? 'num' : '', column.key === 'name' ? 'name' : ''].filter(Boolean).join(' ')
      return `<td${classes ? ` class="${classes}"` : ''}>${esc(value)}</td>`
    }).join('')
    return `<tr data-ss-entry="${esc(row.id)}"${row.id === ss.entryId ? ' class="on"' : ''} title="${esc(row.entry?.name || row.name)}">${cells}</tr>`
  }).join('')
  return `<div class="table-responsive"><table class="table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

function ssOutlineSideHtml(layout, ss) {
  const tree = layout.tree
  const rows = tree.chapters.map((chapter) => {
    const open = ss.openChapters[chapter.chapter] === true
    const chapterOn = Number(ss.chapter) === chapter.chapter && !ss.entryId
    const beats = open ? `<div class="ss-beats">${chapter.beats.map((beat) => `
      <div class="ss-beat">
        <span class="ss-beat-label">${esc(beat.label)}</span>
        <span class="ss-beat-n">${beat.eventCount} 事件</span>
      </div>
      ${beat.entries.map((entry) => `<button class="ss-entry${entry._storyKey === ss.entryId ? ' on' : ''}" data-ss-entry="${esc(entry._storyKey)}" title="${esc(entry.name)}">${esc(ssEntryLabel(entry))}<span class="n">${(entry.events || []).length}</span></button>`).join('')}
    `).join('')}</div>` : ''
    return `<div class="ss-ch">
      <button class="ss-ch-head rm-toggle${chapterOn ? ' on' : ''}" data-ss-chapter="${chapter.chapter}" title="第${chapter.chapter}章 · ${esc(chapter.title || '未命名')}">
        <span class="rm-chev">${open ? '▾' : '▸'}</span>
        <span class="ss-ch-no">${String(chapter.chapter).padStart(2, '0')}</span>
        <span class="ss-ch-title">${esc(chapter.title || `第${chapter.chapter}章`)}</span>
        <span class="ss-ch-n">${chapter.beats.length}</span>
      </button>
      ${beats}
    </div>`
  }).join('')
  const note = tree.alignment === 'exact'
    ? '章号来自 provenance.chapters，精确对齐。'
    : (tree.chapterCount <= 1
      ? '没读到 wiki 章纲，条目暂归首章；跑 enrich 后再按段号铺到叙事章。'
      : 'fact 章号不可靠时按段号均分到 wiki 章——页头已标「近似」。')
  return `<section class="surface-card ss-card">
    <div class="ss-card-head"><h3>章 → 段 → 条目</h3><span class="sub">${tree.chapterCount} 章 · ${tree.beatCount} 段</span></div>
    ${rows ? `<div class="ss-tree">${rows}</div>` : '<div class="ss-empty">这本书还没有可排进章树的条目。</div>'}
    <p class="ss-side-note">${esc(note)}</p>
  </section>`
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
    // work 模块是同步纯计算（注册表注释里写明）；数据口径与 storySource 的 stats.charts 同源。
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
    <p class="ss-prose">这是 Fact 链的可视化工作面：左栏按章／层／图切换，中栏读条目，右栏看溯源、世界书关联与推演/分析消费点。</p>
    <div class="ss-stat-grid">
      <div class="ss-stat"><b>${layout.stats.entries}</b><span>条目</span></div>
      <div class="ss-stat"><b>${layout.stats.events}</b><span>事件</span></div>
      <div class="ss-stat"><b>${layout.stats.chapters}</b><span>章</span></div>
      <div class="ss-stat"><b>${layout.stats.sources}</b><span>溯源</span></div>
    </div>
    <div class="ss-callout">${layout.stats.approximate ? `有 ${layout.stats.approximate} 条只能按段号近似归章——页头标了「对齐近似」。` : '章号来自 provenance.chapters，全部精确对齐。'} 左侧选一章或一条条目开始。</div>`
}

function ssCardShell(key, title, badge, body, ss) {
  if (ss.closed?.[key]) return ''
  const folded = ss.folded?.[key] === true
  return `<section class="surface-card ss-card ss-trace-card">
    <div class="ss-card-head">
      <button class="rm-toggle" data-ss-fold="${key}" title="${folded ? '展开' : '折叠'}">
        <span class="rm-chev">${folded ? '▸' : '▾'}</span>
        <span class="rm-title">${esc(title)}</span>
        <span class="rm-badge">${esc(badge)}</span>
      </button>
      <button class="rm-x" data-ss-close="${key}" title="收起这张卡">×</button>
    </div>
    ${folded ? '' : `<div class="ss-card-body">${body}</div>`}
  </section>`
}

function ssTraceHtml(entry, layout, ss) {
  const sources = Array.isArray(entry?.sources) ? entry.sources : []
  const sourceRows = sources.slice(0, 14).map((source) => {
    const hash = text(source.quote_hash || source.quoteHash).slice(0, 8)
    return `<div class="ss-src">
      <div class="ss-src-id" title="${esc(source.sourceId)}">${esc(source.sourceId || '—')}</div>
      <div class="ss-src-meta">${esc(source.segmentId || '—')}${hash ? ` · ${esc(hash)}…` : ''}</div>
    </div>`
  }).join('')
  // 溯源 → 正文：条目所属章若在正文里有对应文件，给一个「去正文」入口（P1 只跳页面）
  const entryChapter = entry && layout?.tree?.entryIndex?.[entry._storyKey]?.chapter
    ? Number(layout.tree.entryIndex[entry._storyKey].chapter)
    : (Number(entry?.provenance?.chapters?.[0]) || 0)
  const jumpRow = entryChapter
    ? `<div class="ss-src-jump"><button data-ss-goto-write="${entryChapter}">去正文第 ${entryChapter} 章</button></div>`
    : ''
  const sourceBody = jumpRow + (sourceRows || `<div class="ss-empty-sm">${entry ? '这条条目没有溯源记录。' : '先选一条条目，右栏显示它的来源。'}</div>`)

  const relations = Array.isArray(entry?.relations) ? entry.relations : []
  const targets = []
  const pushTarget = (name, type) => {
    const value = text(name).trim()
    if (!value) return
    if (targets.some((item) => item.name === value)) return
    targets.push({ name: value, type: text(type).trim() })
  }
  relations.forEach((relation) => pushTarget(relation.to ?? relation.target, relation.type))
  if (Array.isArray(entry?.who)) entry.who.forEach((name) => pushTarget(name, '出场'))
  const relationBody = targets.length
    ? `<div class="ss-rel-list">${targets.slice(0, 24).map((item) => `<button class="ss-rel" data-ss-ref="${esc(item.name)}" title="${esc(item.name)}${item.type ? ` · ${esc(item.type)}` : ''}">${esc(item.name)}${item.type ? `<i>${esc(item.type)}</i>` : ''}</button>`).join('')}</div>
       <p class="ss-side-note">点名字去世界书；找不到同名条目会落到世界书搜索。</p>`
    : `<div class="ss-empty-sm">${entry ? '这条条目没有关联记录。' : '选中条目后显示世界书/人物关联。'}</div>`

  const graph = state.factView?.graph
  const causalNodes = graph?.causalGraph?.nodes?.length || 0
  const causalEdges = graph?.causalGraph?.edges?.length || 0
  const ledgerRows = (graph?.ledger?.knowledgeLedger?.length || 0) + (graph?.ledger?.stateLedger?.length || 0)
  const graphLine = graph
    ? `<p class="ss-side-note">enrich 旁证：因果图 ${causalNodes} 节点 / ${causalEdges} 边 · 台账 ${ledgerRows} 条${graph.failures?.length ? ` · ${graph.failures.length} 处缺口` : ''}</p>`
    : ''
  const radiateBody = `${graphLine}<div class="ss-radiate">
      <button data-ss-radiate="chart">剧情曲线<span class="sub">切到图表形态，看这条所在章的张力与密度</span></button>
      <button data-ss-radiate="deduce">推演事实包<span class="sub">推演按 layer 读取拆解条目，往下一拍</span></button>
      <button data-ss-radiate="analysis">正文分析<span class="sub">跳正文页，分析面板按章看写作问题</span></button>
    </div>`

  const cards = [
    ssCardShell('sources', '溯源', `${sources.length} 条`, sourceBody, ss),
    ssCardShell('relations', '关联', `${targets.length} 个`, relationBody, ss),
    ssCardShell('radiate', '辐射', '消费点', radiateBody, ss)
  ].join('')
  const labels = { sources: '溯源', relations: '关联', radiate: '辐射' }
  const restored = ['sources', 'relations', 'radiate'].filter((key) => ss.closed?.[key])
  const restore = restored.length
    ? `<div class="ss-restore">已收起 ${restored.map((key) => `<button data-ss-open="${key}">＋${labels[key]}</button>`).join('')}</div>`
    : ''
  return cards + restore
}


function factViewHtml() {
  const fv = state.factView
  const headKick = `<div class="kick">${esc(state.current?.name || '')} / 故事源</div>`
  if (!state.current) return needLibraryHtml()
  if (!ssModule) {
    ensureStorySourceModule()
      .then(() => { if (state.view === 'dir:拆解') render() })
      .catch((error) => {
        if (state.factView) state.factView.error = text(error?.message || error)
        if (state.view === 'dir:拆解') render()
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
  if (fv.entriesError) {
    return `<div class="doc-head">${headKick}<h1>故事源</h1><div class="doc-meta"><span class="b">Fact 链</span><span>条目读不了</span></div></div>${flowError(`条目读不了：${fv.entriesError}`)}`
  }
  if (!fv.loaded) return `<div class="doc-head">${headKick}<h1>故事源</h1></div><div class="loading">…</div>`
  if (!fv.entries.length) {
    return `<div class="doc-head">${headKick}<h1>故事源</h1><div class="doc-meta"><span class="b">Fact 链</span><span>还没有条目</span></div></div>
      <div class="empty-state"><h2>还没有故事源</h2>
      <p>拆解/ 目录下没有可读的 fact 条目（或这本书只有章纲没有条目）。先在「世界书/条目」侧产出条目，跑一次 enrich，再回来。</p></div>`
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
        <select class="select" id="ss-book" title="换一本拆解数据">${pickOptions}</select>
        <span class="ss-align ${stats.alignment === 'approximate' ? 'approximate' : ''}">${esc(ssAlignLabel(stats.alignment))}</span>
        <span class="count">${stats.entries} 条目 · ${stats.chapters} 章 · ${stats.events} 事件</span>
        ${fv.truncated ? `<span class="count">只读了前 ${fv.entries.length} / ${fv.total} 条</span>` : ''}
        ${fv.warnings.length ? `<span class="count">${fv.warnings.length} 条读档警告</span>` : ''}
      </div>
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
      grid: { left: 52, right: 24, top: 24, bottom: 58 },
      xAxis: { type: 'category', data: heatmap.xLabels, ...axis },
      yAxis: { type: 'category', data: heatmap.yLabels, ...axis },
      visualMap: {
        min: 0,
        max: Math.max(1, heatmap.max),
        calculable: true,
        orient: 'horizontal',
        left: 'center',
        bottom: 6,
        itemWidth: 140,
        itemHeight: 10,
        textStyle: { color: theme.muted },
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
  const charts = layout.stats.charts
  let headers = []
  let rows = []
  if (chart === 'foreshadow') {
    headers = ['章', '埋', '累计未收']
    rows = charts.foreshadows.counts.filter((item) => item.planted > 0).slice(0, 14)
      .map((item) => [`第${item.chapter}章`, item.planted, item.cumulative])
  } else if (chart === 'heatmap') {
    headers = ['章', '段', '事件']
    rows = charts.heatmap.data.slice(0, 14)
      .map((cell) => [`第${charts.heatmap.xChapters[cell[0]]}章`, `第${cell[1] + 1}段`, cell[2]])
  } else {
    headers = ['章', '张力', '事件']
    rows = charts.curve.slice(0, 14).map((item) => [`第${item.chapter}章`, item.tension, item.density])
  }
  const table = rows.length
    ? `<div class="table-responsive"><table class="table"><thead><tr>${headers.map((header) => `<th>${esc(header)}</th>`).join('')}</tr></thead><tbody>
        ${rows.map((row) => `<tr>${row.map((cell, index) => `<td${index ? ' class="num"' : ''}>${esc(cell)}</td>`).join('')}</tr>`).join('')}
      </tbody></table></div>`
    : '<div class="ss-empty">这张图还没有数据。</div>'
  return `<div class="ss-chart-fallback">
    <h4>图表没加载出来</h4>
    <p>${esc(message)}</p>
    <p class="sub">先用文字把数据摆出来——不白屏。</p>
    ${table}
    <button class="btn-ghost" data-ss-retry-chart>重试加载图表</button>
  </div>`
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
    if (token !== ssChartToken || !host.isConnected || state.view !== 'dir:拆解' || state.factView !== fv) return
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
      setTimeout(() => { if (state.view === 'dir:拆解') render() }, 0)
    })
    ssChartResize = () => { ssChartInstance?.resize() }
    window.addEventListener('resize', ssChartResize)
  } catch (error) {
    fv.ss.chartError = text(error?.message || error)
    host.innerHTML = ssChartFallbackHtml(fv.layout, kind, fv.ss.chartError)
  }
}

/** 剧本页（OS-75）：与小说同构的「逐块实时编辑」，但按剧本格式渲染。
 * 数据通道不变（/api/files + /api/chapter）——剧本就是 剧本/NNN-标题.md。 */
function scriptViewHtml() {
  const dir = '剧本'
  const work = dirWork(dir)
  const label = DIR_LABELS[dir] || dir
  const sc = work.loaded && state.scriptModule?.scriptStats ? state.scriptModule.scriptStats(work.text) : null
  const meta = sc
    ? `<span class="b">${sc.acts} 幕</span><span class="docline-sep">·</span><span>${sc.scenes} 场</span><span class="docline-sep">·</span><span>${sc.lines} 句台词</span><span class="docline-sep">·</span><span id="dir-chars">${sc.chars} 字</span>${sc.cast.length ? `<span class="docline-sep">·</span><span class="count">出场：${esc(sc.cast.join('、'))}</span>` : ''}`
    : `<span id="dir-chars">${work.text.length} 字</span>`
  // OS-76：与正文页同构——逐块 contenteditable + data-start/end/raw 偏移，
  // 保存走同一套 commitDocBlock（只是渲染器换成剧本版式）。
  // 文件列表像正文页章节列表一样放左栏，不再占顶部横栏。
  const body = work.loaded
    ? renderScriptDocBody(work.text)
    : `<div class="empty-state"><h2>${esc(label)}</h2><p>还没有剧本——左侧新建一个，或选已有文件。</p></div>`
  const fileRows = work.files.map((item) => `<button class="ch-row${item.file === work.file ? ' on' : ''}" data-dirfile-pick="${esc(item.file)}" title="${esc(item.file)}">
      <span class="no">${esc(String(item.name || '').slice(0, 2))}</span>
      <span class="tt">${esc(String(item.name || '').replace(/\.md$/u, ''))}</span>
      <span class="sz">${formatBytes(item.size)}</span>
    </button>`).join('')
  return `<div class="doc-workspace doc-workspace-sticky">
    <header class="doc-head doc-head-immersive">
      <div class="docline">
        <span class="kick">${esc(state.current.name)}</span>
        <span class="docline-sep">·</span>
        <span class="chap-no">${esc(label)}</span>
        <span class="docline-sep">·</span>
        ${meta}
        <span class="sp"></span>
        <span class="doc-autosave" id="doc-autosave"></span>
        <button class="doc-drawer-btn" data-action="refcol-toggle" title="左侧栏（文件/人物/图谱）" aria-label="左侧栏">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6h11M2.5 10h11" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="doc-drawer-btn" data-action="analyze-toggle" title="分析本剧" aria-label="分析">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.6A5.4 5.4 0 0 1 13.4 8H8z" fill="currentColor"/></svg>
        </button>
        <button class="doc-icon" data-action="script-more" title="剧本设置（自动排版 / 角色配色 / 互转）" aria-label="剧本设置">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.4" cy="8" r="1.35" fill="currentColor"/><circle cx="8" cy="8" r="1.35" fill="currentColor"/><circle cx="12.6" cy="8" r="1.35" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="doc-title-row">
        <h1 class="doc-title">${esc(work.file ? work.file.split('/').pop().replace(/\.md$/u, '') : label)}</h1>
        ${work.savedAt ? `<span class="saved-chip">已保存 · ${esc(formatAt(work.savedAt))}</span>` : ''}
      </div>
    </header>
    <div class="chapter-grid">
    <aside class="ref-col sc-side" id="ref-col">
      ${refModulesHtml({ modules: SCRIPT_REF_MODULES, prepend: `<section class="ref-mod">
        <div class="ref-mod-head"><span class="rm-toggle">剧本<span class="count">${work.files.length}</span></span></div>
        <div class="sc-file-list">
          ${fileRows || '<div class="nav-empty">还没有剧本</div>'}
          <div class="sc-new-row">
            <input class="file-input" id="dirfile-new-name" placeholder="新剧本.md" value="">
            <button class="btn-ghost" data-action="dirfile-new">新建</button>
          </div>
        </div>
      </section>` })}
    </aside>
      ${flowError(work.error)}
      <div class="doc-scroll" id="doc-scroll">
        <div class="chapter-editor-col">${work.loading && !work.loaded ? '<div class="loading">正在读取…</div>' : body}</div>
      </div>
      <aside class="analyze-panel" id="analyze-panel"></aside>
    </div>
  </div>`
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
  // 拆解目录走专属视图（OS-66）：enrich 产出的六槽位/因果图/台账/章纲是人类可读的
  // 结构化知识，用裸 textarea 呈现等于把知识当文本埋掉。
  if (dir === '拆解') {
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
        // OS-86：局跟 sessionId 走（peek 也带——切局后用 peek 回放那局的最后一面）
        sessionId: engine.sessionId || undefined,
        peek: options.peek === true || undefined,
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
      engine.hint = `已删除这一局（回收站：推演/<bookId>/.deleted/sessions/ 可找回）——现在在：${engine.session?.title || '主线'}`
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

/** 待确认事实卡结算（OS-82 回填闭环）：write＝写进拆解（单条 upsert），dismiss＝只出队。 */
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
      ? `事实已写入拆解${payload.revision ? `（revision ${payload.revision}）` : ''}——下一拍推演就能引用它`
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

/** 素材本体直挂 URL（<img>/<audio> 同源装载）：path 相对 推演/<bookId>/素材/。 */
function dedAssetUrl(item) {
  const engine = state.deduce.engine
  const bookId = engine.assetBookId
  const prefix = `推演/${bookId}/素材/`
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
    .then(() => { engine.bgmOn = true; if (state.view === 'deduce') render() })
    .catch(() => {
      engine.bgmOn = false
      deduceBgmStop()
      engine.error = 'BGM 播放失败——文件可能损坏，或浏览器拦了自动播放（再点一次试试）。'
      if (state.view === 'deduce') render()
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
  const engine = state.deduce.engine
  const node = (engine.session?.nodes || []).find((item) => item.id === engine.treePick)
  if (!node) return ''
  const branchLabel = (node.branchId || 'main') === 'main' ? '主线' : node.branchId
  return `<span class="ded-tree-pick-label">选中：第 ${Number(node.round) || 0} 拍 · ${esc(branchLabel)}</span>
    <button class="btn-primary" data-action="deduce-tree-back"${engine.turnBusy ? ' disabled' : ''} title="切到这一拍所在的分支与拍号，回「当前局面」继续">回到这一拍</button>
    <button class="btn-ghost" data-action="deduce-tree-branch"${engine.turnBusy ? ' disabled' : ''} title="以这一拍为分叉点开一条新分支，下一拍走新路">从这拍开新分支</button>`
}

/** 树视图：整宽画布＋右上选中提示（选中节点后出现）。 */
function deduceTreeHtml() {
  const engine = state.deduce.engine
  const nodes = engine.session?.nodes || []
  const branchCount = new Set(nodes.map((node) => node.branchId || 'main')).size
  return `${flowError(engine.error || '')}
    <div class="ded-tree-wrap">
      <div class="ded-tree-bar">
        <span class="ded-buffer-stat">共 ${nodes.length} 拍 · ${branchCount} 条分支</span>
        <span class="sub">横轴＝拍号，纵轴＝分支 · 点节点选中，空白拖动平移，滚轮缩放</span>
      </div>
      <div class="ded-tree-host" id="deduce-tree-host"></div>
      <div class="ded-tree-pick" id="deduce-tree-pick"${engine.treePick ? '' : ' hidden'}>${deduceTreePickHtml()}</div>
    </div>`
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
  if (!state.current) return needLibraryHtml()
  // OS-84：统一壳——引擎/Agent、叙事流/剧情树共用同一条工具栏与同一容器，
  // 切换只换内容区不换骨架（旧实现 Agent/剧情树另起 doc-head，切换＝整页换头，割裂）。
  return deduceEngineHtml()
}

/**
 * 事实包健康度（OS-60）：推演质量的根在拆解条目。
 * 只有命运骰候选＝事实包太薄（没有足够角色/地点/伏笔支撑必然与戏剧候选），
 * 这里如实告诉作者缺什么、补了会怎样——而不是让他对着两张检定单发呆。
 */
function dedPackHtml() {
  const data = state.deduce.engine.data || {}
  const who = Array.isArray(data.sceneCard?.who) ? data.sceneCard.who.filter(Boolean).length : 0
  const where = data.sceneCard?.where && data.sceneCard.where !== '未标记地点'
  const hook = data.sceneCard?.hook && data.sceneCard.hook !== '……'
  const fronts = Array.isArray(data.fronts) ? data.fronts.length : 0
  const sources = new Set((data.candidates || []).map((candidate) => candidate.source))
  const rich = sources.has('必然') || sources.has('戏剧')
  const items = [
    { ok: who >= 2, label: '在场角色', hint: who >= 2 ? `${who} 人` : '太少——补 character 条目' },
    { ok: Boolean(where), label: '地点', hint: where ? '已标' : '世界书里还没有他知道的地点' },
    { ok: Boolean(hook), label: '挂起伏笔', hint: hook ? '有' : '没有悬着的伏笔，推演张力会平' },
    { ok: fronts > 0, label: '前线时钟', hint: fronts ? `${fronts} 条在走` : '没有前线——威胁不会被推着走' },
    { ok: rich, label: '候选来源', hint: rich ? [...sources].join('／') : '只有命运骰——补条目才会出「必然」' }
  ]
  return `<section class="ded-card ded-pack">
      <div class="ded-card-head"><h3>事实包</h3><span class="sub">推演质量取决于拆解条目</span></div>
      ${items.map((item) => `<div class="ded-pack-row ${item.ok ? 'ok' : 'gap'}">
        <span class="ded-pack-ic">${item.ok ? '✓' : '○'}</span>
        <span class="ded-pack-label">${esc(item.label)}</span>
        <span class="ded-pack-hint">${esc(item.hint)}</span>
      </div>`).join('')}
    </section>`
}

/**
 * OS-81：推演页重构＝沉浸叙事流（酒馆模型）＋流末待决回合（RPG 模型）。
 * 旧 galgame 舞台退役：正文不再挤在底部单框，历史拍全部留在流里可回读；
 * 场景立绘降为流的暗化背景（可切「纸面」）；局面/设置退为浮层；
 * 候选作为「待决」挂在流末，输入条常驻底部——页面只有流自己滚。
 */

/** 序章消息：◆ 你是谁 / 眼前场景 默认展开，前情提要默认收起（点开）。缺数据如实说缺。 */
function deducePrologueHtml(narrative) {
  const engine = state.deduce.engine
  const recapOpen = engine.introOpen?.recap === true

  // —— 你是谁（一句话写进序章，不再单开卡） ——
  const id = narrative.identity || null
  // OS-90 角色扮演框架：明说「你扮演的就是这个角色」——尤其 POV 名字抽象时（如「叙述者」），
  // 玩家得知道这三个字就是自己。选项都是这个角色的行动，其他角色会自己行动。
  const idLine = !id
    ? '<p class="fl-line is-missing">还没选定视角人物——设置里填「以谁的眼睛看」，这里会显示你的身份与目标。</p>'
    : id.missing
      ? `<p class="fl-line">你扮演 <b>${esc(id.name)}</b>。<span class="is-missing">这个角色还没有档案（去世界书写一条，或跑 enrich 生成人物档）。</span></p>`
      : `<p class="fl-line">你扮演 <b>${esc(id.name)}</b>${id.archetype ? `<span class="fl-arch">${esc(id.archetype)}</span>` : ''}${id.identity ? `，${esc(id.identity)}` : ''}。</p>
        ${id.goal ? `<p class="fl-goal">你要 ${esc(id.goal)}</p>` : ''}
        <p class="fl-line is-missing fl-role-hint">下面的选项都是你（${esc(id.name)}）能做的事；别人（场景里其他角色）会自己行动，世界也会回应。</p>
        ${id.personality && id.personality.length ? `<p class="fl-chips-row">${id.personality.map((p) => `<span class="fl-chip">${esc(p)}</span>`).join('')}</p>` : ''}`

  // —— 眼前场景 ——
  const sc = narrative.scene || { text: '', others: [], where: '' }
  const othersInline = (sc.others || []).map((o) => `<b>${esc(o.name)}</b>`).join('、')
  const sceneLine = `${sc.text ? `<p class="fl-line fl-scene">${esc(sc.text)}</p>` : ''}
    ${othersInline ? `<p class="fl-line">你面前：${othersInline}。</p>` : ''}
    ${!sc.where ? '<p class="fl-line is-missing">地点未标注——在世界书里给这个场景补一条地点条目，这里会说明你在哪。</p>' : ''}`

  // —— 前情提要（默认收起：序章不必每次都背一遍书） ——
  const rc = narrative.recap || { story: '', soFar: [], recent: [] }
  const recapRows = []
  if (rc.story) recapRows.push(`<p class="fl-line fl-story">${esc(rc.story)}</p>`)
  if (rc.soFar && rc.soFar.length) {
    recapRows.push(`<div class="fl-sofar">${rc.soFar.map((c) => `<div class="fl-sofar-row"><b>第${c.chapter}章${c.title ? ` ${esc(c.title)}` : ''}</b><span>${esc(c.summary)}</span></div>`).join('')}</div>`)
  }
  if (rc.recent && rc.recent.length) {
    recapRows.push(`<div class="fl-recent">${rc.recent.map((r) => `<div class="fl-recent-row"><span class="fl-rn-inline">第${r.round}拍</span>${esc(r.excerpt)}…</div>`).join('')}</div>`)
  }

  const missingNote = narrative.missing && narrative.missing.length
    ? `<div class="fl-missing-note">缺：${narrative.missing.map((m) => ({ pov: '视角人物', 'character-profile': '角色档案', location: '地点', recap: '前情' }[m] || m)).join(' · ')}</div>`
    : ''

  return `<section class="fl-msg fl-msg-prologue">
    <span class="fl-rn">序章</span>
    <div class="fl-prose">
      <div class="fl-prologue-head"><span class="fl-prologue-mark">◆</span>序章</div>
      ${idLine}
      ${sceneLine}
      <button class="fl-recap-toggle" data-action="gg-toggle" data-gg-key="recap" aria-expanded="${recapOpen ? 'true' : 'false'}">${recapOpen ? '▾ 收起前情提要' : '▸ 前情提要'}</button>
      ${recapOpen ? `<div class="fl-recap-body">${recapRows.join('') || '<p class="fl-line is-missing">这本书还没有摘要——跑 enrich 后这里会显示整本书讲了什么。</p>'}</div>` : ''}
      ${missingNote}
    </div>
  </section>`
}

/** 你的回合：这一拍选了哪条候选 / 自己写了什么（choiceId 在会话节点里，回放同源）。 */
/** 命运回合行的人话文案（OS-88）。服务端同款在 deduceEngine.humanizeFateText（按 trace 重写）；
 *  这里兜历史拍——会话节点只存了 text 没存 trace，旧黑话「剧情检定 2d6=…」从文本拆骰点翻人话。 */
function fateHumanFromLegacy(chosen) {
  const m = /^剧情检定 2d6=(\d+)\+(\d+)\=(\d+)：(顺遂|受阻)$/.exec(text(chosen?.text || ''))
  if (!m) return ''
  const a = Number(m[1]); const b = Number(m[2]); const sum = Number(m[3])
  const success = m[4] === '顺遂'
  return success
    ? `世界不拦你——事情按眼下最自然的走向推进（命运骰 ${sum}：${a}+${b} 顺遂）`
    : `世界设了坎——这一步会受阻，有代价要收拾（命运骰 ${sum}：${a}+${b} 受阻）`
}

function deduceTurnLineHtml(node) {
  const chosen = (node.candidates || []).find((candidate) => candidate.id === node.choiceId)
  if (!node.choiceId || !chosen) return ''
  // OS-88：命运候选历史拍是黑话文本——渲染时翻人话；新档已是人话（正则不中）原样
  const chosenText = chosen.source === '命运' ? (fateHumanFromLegacy(chosen) || chosen.text) : chosen.text
  // OS-91：酒馆式——你拍板的行动就是右侧气泡里那句话，不挂任何元标签
  return `<div class="fl-you"><span class="fl-you-text">${esc(chosenText)}</span></div>`
}

/** 待确认事实卡（OS-82 回填闭环）：这一拍结算产出的 fact 条目——写进拆解前的最后一道闸。
 *  「写入拆解」走 writeFactFile 单条 upsert（只进这一条，不动其他条目）；「忽略」只出队不落库。 */
function deducePendingFactHtml(item) {
  const entry = item?.entry ?? {}
  const decidedBy = text(item?.decidedBy)
  const decidedLabel = decidedBy === 'author' ? '作者裁定' : decidedBy === 'fate' ? '命运之笔' : decidedBy || '推演产出'
  return `<section class="fl-msg ded-factcard" data-pending-id="${esc(text(item?.id))}">
    <div class="ded-factcard-head">
      <span class="ded-factcard-badge">事实待确认</span>
      <span class="ded-factcard-meta">${esc(text(entry.layer || 'plot'))} · 第 ${Number(item?.round) || 0} 拍 · ${esc(decidedLabel)}</span>
    </div>
    <p class="ded-factcard-name">${esc(text(entry.name))}</p>
    <p class="ded-factcard-def">${esc(text(entry.definition))}</p>
    <div class="ded-factcard-ops">
      <button class="fl-btn is-primary" data-action="deduce-pending-write" data-id="${esc(text(item?.id))}" title="写入库内拆解文件（单条追加，不动其他条目）">写入拆解</button>
      <button class="fl-btn" data-action="deduce-pending-dismiss" data-id="${esc(text(item?.id))}" title="不落库，把这张卡移出队列">忽略</button>
    </div>
  </section>`
}

/** 本拍正文：历史拍是静态纸卡；最新一拍（草稿）带打字机／编辑态与动作行。 */
function deduceProseMsgHtml(node, live) {
  const engine = state.deduce.engine
  const round = Number(node.round) || 0
  if (!live) {
    const prose = text(node.prose).trim()
    return `<section class="fl-msg">
      <span class="fl-rn">第 ${round} 拍</span>
      <div class="fl-prose"><p class="fl-text${prose ? '' : ' is-empty'}">${prose ? esc(prose) : '（这一拍没有正文）'}</p></div>
    </section>`
  }
  const draft = engine.draft
  const editing = engine.draftEdit === true
  const head = `<span class="fl-rn">第 ${round} 拍${draft?.prose ? ` · ${text(draft.prose).length} 字` : ''}</span>`
  const proseError = draft?.proseError ? `<div class="warn-box">${esc(draft.proseError)}——可以直接改，或点「↻ 重写」。</div>` : ''
  if (editing) {
    return `<section class="fl-msg is-live">
      ${head}
      <div class="fl-prose">
        ${proseError}
        <textarea class="fl-draft-input" id="deduce-draft" placeholder="这一拍的正文草稿（200–400 字）">${esc(draft.prose)}</textarea>
        <div class="fl-actions">
          <span class="fl-actions-note" id="deduce-draft-chars">${text(draft.prose).length} 字 · 失焦自动保存</span>
          <button class="fl-btn is-primary" data-action="deduce-engine-next"${engine.turnBusy || engine.busy ? ' disabled' : ''} title="收下这一拍进本章缓冲，推新的局面">下一拍 →</button>
          <button class="fl-btn" data-action="deduce-engine-regen"${engine.turnBusy ? ' disabled' : ''} title="让模型重写这一拍的正文（覆盖草稿）">${engine.turnBusy ? '成文中…' : '↻ 重写'}</button>
          <button class="fl-btn" data-action="deduce-draft-edit" title="收起编辑器，回到展示">✓ 收起</button>
        </div>
      </div>
    </section>`
  }
  const stageText = text(draft.prose).trim()
    ? text(draft.prose)
    : '（这一拍还没有正文——点「✎ 编辑」自己写，或点「↻ 重写」让模型出稿。）'
  return `<section class="fl-msg is-live">
    ${head}
    <div class="fl-prose">
      ${proseError}
      <div class="fl-text-body" data-action="deduce-tw-skip" title="点一下立即全显">
        <span class="fl-text" id="deduce-dialog-text" data-stage-text="${esc(stageText)}"></span><span class="fl-caret" id="deduce-dialog-caret">▍</span>
      </div>
      <div class="fl-actions">
        <span class="fl-actions-note">进本章缓冲 · 「下一拍」后可继续写</span>
        <button class="fl-btn is-primary" data-action="deduce-engine-next"${engine.turnBusy || engine.busy ? ' disabled' : ''} title="收下这一拍进本章缓冲，推新的局面">下一拍 →</button>
        <button class="fl-btn" data-action="deduce-engine-regen"${engine.turnBusy ? ' disabled' : ''} title="让模型重写这一拍的正文（覆盖草稿）">${engine.turnBusy ? '成文中…' : '↻ 重写'}</button>
        <button class="fl-btn" data-action="deduce-draft-edit" title="就地编辑这一拍的正文草稿">✎ 编辑</button>
      </div>
    </div>
  </section>`
}

/** 在场小头像（立绘有图用图，没有用首字色块）——缩进待决的场景行，不再立右栏。 */
function deduceWhoChipsHtml(who) {
  if (!who.length) return '<span class="fl-who-none">这一拍无人在场</span>'
  const assets = state.deduce.engine.assets || { characters: [] }
  return who.map((name) => {
    const asset = assets.characters.find((item) => item.name === name)
    const hue = [...name].reduce((sum, char) => sum + char.codePointAt(0), 0) % 360
    return `<span class="fl-who" title="${esc(name)}">
      ${asset
        ? `<img src="${dedAssetUrl(asset)}" alt="${esc(name)}">`
        : `<i style="background:hsl(${hue} 42% 84%);color:hsl(${hue} 45% 30%)">${esc(name.slice(0, 1))}</i>`}
      ${esc(name)}
    </span>`
  }).join('')
}

/**
 * 待决回合：流末的候选（必然/命运/戏剧）＋否决。每拍重新生成，选完折叠成「你的回合」。
 * 候选「人物化」沿用 OS-79：标题＝你打算做什么，副标＝后果预期，骰点收进 roll 小字。
 */
function deducePendingHtml(data) {
  const engine = state.deduce.engine
  const card = data.sceneCard ?? {}
  // OS-91：命运是世界的暗手（骰点体现在世界的回应里），不进玩家的选项——
  // 玩家面前只有基于眼前情境的分支（戏剧＝模型提的分支，必然＝世界规矩推的分支）
  const candidates = (Array.isArray(data.candidates) ? data.candidates : []).filter((candidate) => candidate.source !== '命运')
  const who = Array.isArray(card.who) ? card.who.filter(Boolean) : []
  const where = card.where && card.where !== '未标记地点' ? text(card.where) : '地点未标'
  const hook = card.hook && card.hook !== '……' ? text(card.hook) : ''
  const sourceNote = { 必然: '世界规矩', 戏剧: '另一种可能' }
  const describeCandidate = (candidate) => {
    if (candidate.source === '必然') {
      const fact = text(candidate.text).replace(/^剧情检定[^：]*：/u, '').trim()
      return { title: fact || '按世界的规矩来', sub: '从世界事实推出来的——不这么做也会发生', roll: '' }
    }
    return { title: text(candidate.text) || '（空候选）', sub: hook ? `牵动：${hook}` : '', roll: '' }
  }
  const optRows = candidates.map((candidate) => {
    const kind = { 必然: 'certain', 命运: 'fate', 戏剧: 'drama' }[candidate.source] || 'other'
    const info = describeCandidate(candidate)
    return `<div class="ded-opt-row src-${kind}">
      <button class="ded-opt" data-action="deduce-engine-choose" data-candidate-id="${esc(candidate.id)}"${engine.turnBusy ? ' disabled' : ''}>
        <span class="ded-opt-head"><span class="ded-badge">${esc(candidate.source || '候选')}</span><span class="ded-cand-note">${esc(sourceNote[candidate.source] || '')}</span></span>
        <span class="ded-opt-title">${esc(info.title)}</span>
        ${info.sub ? `<span class="ded-opt-sub">${esc(info.sub)}</span>` : ''}
      </button>
      <button class="ded-opt-veto" data-action="deduce-engine-veto" data-candidate-id="${esc(candidate.id)}" title="只记账，不落库">否决</button>
    </div>`
  }).join('')
  const busyNote = engine.busy
    ? '<div class="fl-typing">推演中——正在摆局面…</div>'
    : (engine.turnBusy ? '<div class="fl-typing">成文中——这一拍正在落字…</div>' : '')
  return `<section class="fl-pending">
    <div class="fl-pending-scene">
      <span class="fl-pending-rn">第 ${Number(data.round) || 0} 拍</span>
      <span class="fl-pending-where">${esc(where)}</span>
      ${deduceWhoChipsHtml(who)}
    </div>
    <p class="fl-prompt">轮到你了——这一拍怎么走由你决定：选一条，或在下面自己说</p>
    ${busyNote}
    ${optRows || (engine.busy || engine.turnBusy ? '' : '<p class="fl-no-cand">这一拍没有候选——事实包不够（世界观／角色／剧情条目太少）或预算用尽。点下方自己写一拍，或去设置里重掷。</p>')}
  </section>`
}

/** 已知信息牌（OS-91）：剧本杀式的左栏——你扮演谁／谁在你面前／这里是什么地方／
 *  你经历过了什么／世界的暗流。全部来自 present 的叙事上下文，第二人称，不摆 fact 术语。 */
function deduceSideHtml(data) {
  const n = data?.narrative
  if (!n) return ''
  const id = n.identity || null
  const sc = n.scene || { others: [], where: '', text: '', tension: '' }
  const rc = n.recap || {}
  const sec = (title, body) => body ? `<section class="ds-sec"><h4>${title}</h4>${body}</section>` : ''
  const whoYouAre = !id
    ? '<p class="ds-empty">还没选定视角——⚙ 设置里选「以谁的眼睛看」</p>'
    : `<p class="ds-name">${esc(id.name)}${id.archetype ? `<i>${esc(id.archetype)}</i>` : ''}</p>
      ${id.identity ? `<p class="ds-line">${esc(id.identity)}</p>` : ''}
      ${id.goal ? `<p class="ds-goal">你要 ${esc(id.goal)}</p>` : ''}
      ${id.personality && id.personality.length ? `<p class="ds-tags">${id.personality.map((p) => `<span>${esc(p)}</span>`).join('')}</p>` : ''}`
  const others = Array.isArray(sc.others) ? sc.others : []
  const beforeYou = others.length
    ? others.map((o) => `<div class="ds-person"><b>${esc(o.name)}</b>${o.identity ? `<span>${esc(o.identity)}</span>` : ''}${o.archetype ? `<i>${esc(o.archetype)}</i>` : ''}</div>`).join('')
    : '<p class="ds-empty">眼前没有别人——只有你和这个地方</p>'
  const whereSec = `<p class="ds-line">${sc.text ? esc(sc.text) : (sc.where ? `你在${esc(sc.where)}。` : '还没人知道这里是什么地方——去世界书补一条地点条目。')}</p>
      ${sc.tension ? `<p class="ds-tension">气氛：${esc(sc.tension)}</p>` : ''}`
  const past = (Array.isArray(rc.recent) ? rc.recent : []).map((r) => `<div class="ds-mem"><span>第${r.round}拍</span>${esc(r.excerpt)}…</div>`).join('')
  const pastSec = `${rc.story ? `<p class="ds-line ds-story">${esc(rc.story)}</p>` : ''}${past}`
  const fronts = Array.isArray(data?.fronts) ? data.fronts : []
  const frontsSec = fronts.map((f) => {
    const filled = Number(f.filled) || 0
    const max = Number(f.max) || 0
    const pct = max ? Math.round((filled / max) * 100) : 0
    return `<div class="ds-front"><div class="ds-front-row"><span>${esc(f.name || f.id || '前线')}</span><span>${filled}/${max}</span></div><div class="ds-front-bar"><i style="width:${pct}%"></i></div></div>`
  }).join('')
  return [
    sec('你扮演', whoYouAre),
    sec('在你面前', beforeYou),
    sec('这里', whereSec),
    sec('你经历过的', pastSec),
    sec('世界的暗流', frontsSec)
  ].join('')
}

/** 推演主面（OS-84 统一壳）：工具栏常驻，内容区三形态（叙事流/剧情树/Agent）就地切换。 */
function deduceEngineHtml() {
  const engine = state.deduce.engine
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
    ${inFlow ? `<span class="fl-bar-progress">${data ? `第 ${Number(data.round) || 0} 拍` : '未开局'}${pov ? `<span class="ded-bar-sep">·</span>${esc(pov)}视角` : ''}<span class="ded-bar-sep">·</span>本章 ${bufferCount} 拍 ${buffer?.words || 0} 字</span>
    ${heatLabel ? `<span class="ded-heat ${heatClass}" title="前线时钟读数：张力从平静到一触即发">${esc(heatLabel)}</span>` : ''}` : ''}
    <span class="fl-bar-right">
      <span class="fl-seg">
        ${segTab('flow', '叙事流', 'deduce-view-scene', '沉浸叙事流：一拍一条消息，候选挂在流末（确定性引擎）')}
        ${segTab('tree', '剧情树', 'deduce-view-tree', '二维分支导图：回跳或开新分支（确定性引擎）')}
        ${segTab('agent', 'Agent', 'deduce-mode-agent', 'Agent 分支推理（需要模型，表单形态）')}
      </span>
      ${inFlow && data ? `<i class="fl-bar-div"></i>
        <button class="fl-btn${infoVisible ? ' on' : ''}" data-action="deduce-info-toggle" title="显示/隐藏左侧的已知信息：你扮演谁／谁在你面前／这里是什么地方／你经历过的">状态</button>
        <button class="fl-btn${engine.setOpen ? ' on' : ''}" data-action="deduce-tools-toggle" title="推演设置：POV / 种子 / 推进 / 重新开局">⚙ 设置</button>
        <button class="fl-btn${engine.bgmOn ? ' on' : ''}" data-action="deduce-bgm-toggle"${bgmAsset ? '' : ' disabled'}
          title="${bgmAsset ? `播放：${esc(bgmAsset.name)}（循环）` : '未配置 BGM——放 推演/…/素材/bgm/<场景或情绪>.mp3 即可启用'}">♪ BGM</button>
        <i class="fl-bar-div"></i>
        <button class="fl-btn" data-action="deduce-image" title="按本拍局面生成一张场景立绘（需在设置里配生图端点）"${engine.turnBusy ? ' disabled' : ''}>生图</button>
        <button class="fl-btn" data-action="deduce-archive"${engine.turnBusy || !bufferCount ? ' disabled' : ''} title="把本章缓冲的拍整理成 markdown 归档（不写正文文件）">归档</button>
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
      <button class="ded-sess-del" data-action="deduce-sess-del" data-id="${esc(item.id)}" title="删除这一局（非破坏——文件进 推演/.deleted/sessions/ 可找回）">删</button>
    </div>`
  }).join('')
  const sessHtml = `<div class="ded-sess">
      <div class="ded-sess-head">推演局<span class="sub">不同前提各开一局，互不串线</span></div>
      <div class="ded-sess-list">${sessRows || '<p class="ded-none">局清单还没读到——再开一次设置页试试</p>'}</div>
      <button class="btn-ghost ded-sess-new" data-action="deduce-sess-new"${engine.busy || engine.turnBusy ? ' disabled' : ''} title="新开一局（自动命名，切过去就是空白第一拍）">＋新开一局</button>
    </div>`
  const sideHtml = deduceSideHtml(data)
  const setPanel = `<div class="ded-set-panel"${engine.setOpen ? '' : ' hidden'}>
      ${sessHtml}
      <div class="ded-set-head">推演设置<span class="sub">POV / 种子 / 推进</span></div>
      ${controls}
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

  /* —— 空态：还没开局时，流区放说明＋开局控件 —— */
  if (!data) {
    return `<div class="ded-flow" data-paper="${engine.paperMode ? 1 : 0}">
      <div class="ded-flow-tint"></div>
      ${bar}
      <div class="fl-scroll-wrap">
        <div class="fl-scroll" id="deduce-flow">
          ${flowError(engine.error || '')}
          <div class="fl-hero">
            <div class="ded-empty">
              <h2>事实推演引擎</h2>
              <p>读本库的拆解条目（世界观／角色／剧情）作为事实包，推出一拍局面与候选。每一拍是一条消息：你选一条走向，世界回你一段正文——像酒馆一样往下读。</p>
              <div class="ded-empty-types">
                <div class="ded-type"><b>眼前分支</b><span>基于你面前的情境：进山还是绕行，搭话还是观察</span></div>
                <div class="ded-type"><b>世界的暗手</b><span>命运骰在幕后掷——顺逆体现在世界的回应里，不用你掷</span></div>
                <div class="ded-type"><b>你自己说</b><span>任何时候都能自己写这一拍怎么走</span></div>
              </div>
              <p class="sub">引擎是确定性的：同一个种子＋同一份事实包＝同一拍。它是「如果世界」的推演，不是替你写正文。</p>
            </div>
          </div>
          ${engine.hint ? `<div class="warn-box">${esc(engine.hint)}</div>` : ''}
        </div>
      </div>
      <div class="fl-composer">
        <div class="fl-composer-row">${controls}</div>
      </div>
      ${setPanel}
    </div>`
  }

  /* —— 叙事流：序章 → 历史拍（你的回合＋正文）→ 待决 —— */
  const draft = engine.draft
  const branchId = session?.branchId || 'main'
  const nodes = (session?.nodes || []).filter((node) => (text(node?.branchId) || 'main') === branchId)
  const msgs = []
  if (data.narrative) msgs.push(deducePrologueHtml(data.narrative))
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
  if (!draft) msgs.push(deducePendingHtml(data))
  if (engine.hint) msgs.push(`<div class="fl-hint">${esc(engine.hint)}</div>`)

  const composer = `<div class="fl-composer">
    ${engine.error ? flowError(engine.error) : ''}
    ${engine.archiveNote ? `<div class="fl-note-row"><span class="ok-note">${esc(engine.archiveNote)}</span></div>` : ''}
    <div class="fl-composer-row">
      <textarea class="fl-input" id="deduce-custom" rows="1" placeholder="自己写：这一拍发生什么，你说了算（Enter 发送 · Shift+Enter 换行）">${esc(engine.customText)}</textarea>
      <button class="btn-primary fl-send" data-action="deduce-engine-custom"${engine.busy || engine.turnBusy ? ' disabled' : ''}>按我写的走</button>
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

/**
 * 生图流程（OS-66 适配）：正规弹窗替代原生 prompt()——场景名＋画面描述＋尺寸，
 * 生成中按钮禁用，完成/失败都在弹窗内反馈，成功后关弹窗回舞台。
 */
function deduceImageFlow() {
  openModal(`<h3>生成场景立绘</h3>
    <p class="sub">调生图端点按画面描述生成一张场景图，落 推演/&lt;bookId&gt;/素材/场景/ 后自动挂为舞台背景。</p>
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
  await Promise.all([bootAgentConfig(), loadGlobalConfig(), loadAgentRuntimes()])
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
  state.view = 'write'
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
  state.refCol = { graph: null, graphLoading: false, graphError: '', summary: '', summaryBusy: false, summaryError: '' }
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
    // OS-84：探已退场旧目录还剩多少篇——页签栏第一帧就要据此决定藏/露，不能等进参考页
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
  // （标题在、正文不在），切走再切回来才被 go('write') 的自动载入链补上。
  // 这里直接载入：首进即有正文。只读操作，不写盘。
  if (state.view === 'write' && state.chapterFile && !state.chapterLoaded) {
    loadChapter(state.chapterFile)
  }
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

/** 故事源的右栏关联点击：先在世界书索引里找同名条目，找不到就落到搜索词。 */
function ssOpenReference(name) {
  const wanted = text(name).trim()
  if (!wanted) return
  const jump = () => {
    const hit = findReferenceByRef(wanted)
    if (hit) {
      state.reference.activePath = hit.path
      if (state.view !== 'reference') go('reference')
      openReference(hit.path)
      return
    }
    state.reference.q = wanted
    if (state.view !== 'reference') go('reference')
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
      go('deduce')
    } else {
      go('write')
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
  const flowPage = view === 'lib-create' || view === 'lib-import'
  // OS-78 修：deduce 需要 state.current.path（peek 会话要 root），不能当无库可进的全局页
  const globalPage = view === 'settings' || view === 'libraries'
  if (view !== 'libraries' && !flowPage && !globalPage && !state.current) {
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
    Promise.all([loadGlobalConfig(), loadAgentRuntimes(), loadStyles(), loadSuites(), loadKbStatus(), loadDshReasoningOptions()])
      .then(() => { if (state.view === 'settings') render() })
      .catch(() => render())
    return
  }
  if (view === 'reference') {
    // 参考页：拉索引，并预挂载模块
    loadReferences().then(() => { if (state.view === 'reference') render() }).catch((e) => console.error('[ref-render]', e))
    loadRefModule().then(() => { if (state.view === 'reference') render() }).catch(() => {})
    return
  }
  if (view === 'deduce') {
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
}

document.addEventListener('click', (event) => {
  // 故事源（S2）：形态/层/条/章/图/折叠/关联/辐射都在页内切换，不碰全局路由
  const ssTarget = event.target.closest?.('[data-ss-view], [data-ss-layer], [data-ss-entry], [data-ss-chapter], [data-ss-chart], [data-ss-fold], [data-ss-close], [data-ss-open], [data-ss-ref], [data-ss-radiate], [data-ss-retry-chart], [data-ss-goto-write]')
  if (ssTarget && state.view === 'dir:拆解') {
    handleSsClick(ssTarget)
    return
  }
  // 消息内路径 code（OS-51）：点「参考/约束/写作纪律」＝打开这篇参考；
  // 点「正文/001-xxx.md」＝打开这一章。之前没这个入口，点路径会误弹「新建笔记」。
  const pathCode = event.target.closest?.('.msg.assistant code, .msg.assistant .tool-target')
  if (pathCode) {
    const raw = pathCode.textContent.trim()
    const looksLikePath = /^(?:参考|正文|大纲|世界书|拆解|人物|场景|事件|约束|资料|构思|标签)[\/][^\s]+$/u.test(raw)
      || /^[0-9]{3}[-_—][^\s]*\.md$/u.test(raw)
    if (looksLikePath) {
      if (raw.startsWith('正文/') || /^[0-9]{3}[-_—]/u.test(raw)) {
        const file = raw.startsWith('正文/') ? raw : `正文/${raw}`
        loadChapter(file)
        go('write')
        return
      }
      if (raw.startsWith('参考/')) {
        const jumpTo = (hit) => {
          state.reference.activePath = hit.path
          if (state.view !== 'reference') go('reference')
          openReference(hit.path)
        }
        const promptNew = () => {
          const name = raw.split('/').pop().replace(/\.(?:md|markdown|txt)$/iu, '')
          state.reference.pendingNew = name
          openNewReferenceModal('note')
          const nameInput = document.getElementById('ref-new-name')
          if (nameInput) nameInput.value = name
        }
        // write 页通常还没拉参考索引——先补一次再匹配（click 委托非 async，走 Promise 链）
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
  const target = event.target.closest('[data-view], [data-go], [data-action], [data-skin], [data-lib-path], [data-kind], [data-session-id], [data-session-del], [data-create-primary], [data-create-genre], [data-runtime-id], [data-chapter-file], [data-dirfile-pick], [data-settings-section], [data-ref-path], [data-ref-tag], [data-ref-view], a.wl[data-ref]')
  // 点在菜单/按钮之外：收起输入区菜单（OS-51）——注意这不 return，
  // 后面消息内路径 code 的点击不携带任何 data-*，必须继续往下走
  if (!event.target.closest?.('.composer-pop, .c-tool')) closeComposerMenus()
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
    // 条目链接：条目工作面已剔除，条目数据的消费方是推演
    if (/^条目[:：]/u.test(ref)) { go('deduce'); return }
    // 否则当参考笔记：标题/相对路径/「参考/」前缀都能认（OS-51）
    const hit = findReferenceByRef(ref)
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
    // 工具行点击（OS-59）：按目标路径分流——正文→正文页，参考→世界书，其它→目录页
    const raw = text(target.dataset.toolTarget).trim()
    if (!raw) return
    if (raw.startsWith('正文/') || /^[0-9]{3}[-_—]/u.test(raw)) {
      const file = raw.startsWith('正文/') ? raw : `正文/${raw}`
      loadChapter(file)
      go('write')
      return
    }
    if (raw.startsWith('参考/')) {
      const jumpTo = (hit) => {
        state.reference.activePath = hit.path
        if (state.view !== 'reference') go('reference')
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
  } else if (action === 'deduce-sess-new') {
    deduceSessionManage('new', '')
  } else if (action === 'deduce-sess-switch') {
    deduceSessionManage('switch', target.dataset.id)
  } else if (action === 'deduce-sess-del') {
    deduceSessionManage('delete', target.dataset.id)
  } else if (action === 'deduce-engine-choose') {
    deduceEngineTurn({ choiceId: target.dataset.candidateId })
  } else if (action === 'deduce-engine-custom') {
    // OS-81：customText 在 input 事件里同步进 engine 状态——重渲不丢作者正在写的字
    const customValue = (state.deduce.engine.customText ?? '').trim()
    if (!customValue) {
      state.deduce.engine.error = '先写两句「这一拍发生什么」，再按「按我写的走」。'
      render()
    } else {
      deduceEngineTurn({ customText: customValue })
    }
  } else if (action === 'deduce-paper-toggle') {
    const engine = state.deduce.engine
    engine.paperMode = !engine.paperMode
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
  if (target.id === 'ss-book' && state.view === 'dir:拆解') {
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
    if (engine.draft) engine.draft.prose = target.value
    const chars = document.getElementById('deduce-draft-chars')
    if (chars) chars.textContent = `${target.value.length} 字 · 失焦自动保存`
    return
  }
  // 故事源表格（S2）：只重渲表体，不打断搜索框焦点
  if (target.id === 'ss-search' && state.view === 'dir:拆解') {
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
    // 参考侧栏搜索（OS-53）：只重渲目录树容器，不打断输入焦点
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
  // 推演输入条（OS-81）：Enter＝按我写的走，Shift+Enter＝换行
  if (event.key === 'Enter' && event.target.id === 'deduce-custom' && !event.shiftKey) {
    event.preventDefault()
    const engine = state.deduce.engine
    const customValue = (engine.customText ?? '').trim()
    if (customValue && !engine.busy && !engine.turnBusy) deduceEngineTurn({ customText: customValue })
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
  if (!blockEl) return
  // 正文页 / 参考详情页 / 剧本页共用同一套逐块实时编辑（OS-53/OS-76）；按所在容器与视图分流写回
  if (blockEl.closest('#ref-reader')) commitRefBlock(blockEl)
  else if (state.view === 'write' || state.view === 'dir:剧本') commitDocBlock(blockEl)
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
}

function setSkin(id) {
  const pack = state.styles.find((item) => item.id === id)
  if (!pack) return
  applySkin(pack)
  try { localStorage.setItem('openstory-skin', id) } catch { /* 隐私模式存不了就本次有效 */ }
  // wiki 网页态的强调色跟包走，换皮即重载 iframe；设置页要刷新选中态。
  if (state.view === 'settings') render()
  // 图谱是 canvas 绘制、配色取自 CSS 变量；换皮后重挂一次才能跟上新色板
  // （参考页大图是 focus 模式，正文页左栏小图是 jump 模式——按当前页分流，OS-49）
  if (document.getElementById('ref-graph-canvas')) {
    graphCleanup?.()
    graphCleanup = null
    requestAnimationFrame(() => {
      if (state.view === 'reference' && (state.reference.view || 'graph') === 'graph') mountReferenceGraph()
      else mountRefGraph()
    })
  }
  // 故事源图表用令牌取色：换皮后重挂一次，轴/线/热力才跟上新色板（OS-49 同口径）
  if (state.view === 'dir:拆解' && state.factView?.ss?.view === 'chart') mountStorySourceChart()
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

async function bootStyles() {
  await loadStyles()
  let saved = ''
  try { saved = text(localStorage.getItem('openstory-skin')) } catch { saved = '' }
  state.skin = saved
  applySkin(currentPack())
}

bootStyles()
boot()
