/**
 * 工作面纯 HTML 构造函数（OS-161，G5b 延续）——从 app.js 迁出的纯函数。
 *
 * 硬约束（与 registry.mjs / settingsAggregation.mjs 同门风）：
 *   · 纯函数：入参进、HTML 字符串出；不读全局 state、不碰 DOM、不写存储、不 import 任何模块
 *     （ui-kit / esc / text / 工具函数全部由调用方注入——S2.2 零边，测试可直接喂夹具）；
 *   · app.js 只保留薄壳（取数＋转交），视图本体只出不进（AGENTS.md 第 20 条增量冻结）。
 *
 * 每个函数配金样测试（test/workbenchViews.test.mjs）：固定夹具 → 固定 HTML。
 */
const NEED_LIBRARY = `<div class="empty-state">
    <h2>先选一个库</h2>
    <p>点右上角的「库」切换器选一个库，OpenStory 才会去读那个文件夹。</p>
    <button class="btn-ghost" data-go="libraries">去库管理</button>
  </div>`

function needLibraryHtml() {
  return NEED_LIBRARY
}

/**
 * 习惯页（OS-92 重做，OS-161 迁出）。
 * @param {object} ctx { current, habits, fields, uiKit, errorBox, logHtml, esc, text }
 */
export function habitsViewHtml({ current, habits, fields, uiKit, errorBox = '', logHtml = '', esc, text }) {
  if (!current) return needLibraryHtml()
  if (!habits) return '<div class="loading">正在读取习惯表…</div>'
  const html = esc ?? ((value) => String(value ?? ''))
  const asText = text ?? ((value) => String(value ?? ''))
  const chipValues = (values) => Array.isArray(values) ? values : []
  const formFields = fields.map((item) => uiKit.chipField({
    key: item.key,
    label: item.label,
    hint: asText(item.hint).replace(/（一行一个）/u, ''),
    values: chipValues(habits[item.key]),
    placeholder: asText(item.ph).split(String.fromCharCode(10))[0] || '输入后按空格添加…',
    max: 60
  })).join('')
  const toneControl = uiKit.select({
    id: 'habit-tone', value: habits.tone || 'direct',
    options: [
      { value: 'direct', label: '直言——编辑体，问题直接说' },
      { value: 'gentle', label: '温和——先扬后抑，问题说成「可以先动的」' }
    ]
  })
  return `<div class="doc-head"><div class="kick">${html(current.name)} / 习惯</div><h1>习惯</h1>
      <div class="doc-meta"><span class="b">你的写作习惯表</span><span>Agent 成文前会逐条遵循；分析引擎按它扫问题</span></div></div>
    ${errorBox}
    <div class="habits-form">
      ${uiKit.field({ label: '口吻', hint: '分析结论的说话方式', control: toneControl })}
      ${uiKit.field({
        label: '文风',
        hint: '一句自述，Agent 成文与总评都以它为基调',
        control: uiKit.textInput({ id: 'habit-style', value: habits.style || '', placeholder: '例如：宋明白话为骨，白描，少形容词' })
      })}
      ${formFields}
      ${uiKit.toolbar({
        left: uiKit.buttonGroup({ items: [{ label: '保存习惯表', kind: 'primary', action: 'habits-save' }] }),
        right: '<span class="uikit-empty-hint">保存后立即生效：Agent 成文注入＋分析扫描</span>'
      })}
    </div>
    ${logHtml}`
}

/* ---------- 故事源（storysource，OS-161）纯 HTML 构造函数 ----------
   ssModuleBodyHtml 因调用 analyzeModulesFor/mod.run（装载与副作用）按工单留在 app.js；
   下面四个纯函数只吃入参出 HTML，state.factView.graph 由调用方显式传 graph。 */


function ssEntryLabel(entry, { text, truncate }) {
  const name = text(entry?.name).trim()
  if (text(entry?.layer) === 'plot') {
    const segment = Number(entry?.provenance?.segmentIndex) || 0
    const first = text(entry?.events?.[0]?.content).replace(/\s+/gu, ' ').trim()
    if (segment) return first ? `段${segment} · ${truncate(first, 20)}` : `段${segment}`
  }
  return name || '(未命名)'
}


function ssFilteredRows(layout, ss, { text }) {
  const q = text(ss.q).trim().toLowerCase()
  return layout.board.rows.filter((row) => {
    if (ss.layer !== 'all' && row.layer !== ss.layer) return false
    if (!q) return true
    return text(row.name).toLowerCase().includes(q) || text(row.cast).toLowerCase().includes(q)
  })
}


function ssCardShell(key, title, badge, body, ss, { esc }) {
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


export function ssTableHtml(layout, ss, { esc, text, truncate }) {
  const rows = ssFilteredRows(layout, ss, { text })
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
      if (column.key === 'name') value = ssEntryLabel(row.entry, { text, truncate })
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


export function ssOutlineSideHtml(layout, ss, { esc, text, truncate }) {
  const tree = layout.tree
  const rows = tree.chapters.map((chapter) => {
    const open = ss.openChapters[chapter.chapter] === true
    const chapterOn = Number(ss.chapter) === chapter.chapter && !ss.entryId
    const beats = open ? `<div class="ss-beats">${chapter.beats.map((beat) => `
      <div class="ss-beat">
        <span class="ss-beat-label">${esc(beat.label)}</span>
        <span class="ss-beat-n">${beat.eventCount} 事件</span>
      </div>
      ${beat.entries.map((entry) => `<button class="ss-entry${entry._storyKey === ss.entryId ? ' on' : ''}" data-ss-entry="${esc(entry._storyKey)}" title="${esc(entry.name)}">${esc(ssEntryLabel(entry, { text, truncate }))}<span class="n">${(entry.events || []).length}</span></button>`).join('')}
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


export function ssTraceHtml(entry, layout, ss, { graph, esc, text }) {
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
    ssCardShell('sources', '溯源', `${sources.length} 条`, sourceBody, ss, { esc }),
    ssCardShell('relations', '关联', `${targets.length} 个`, relationBody, ss, { esc }),
    ssCardShell('radiate', '辐射', '消费点', radiateBody, ss, { esc })
  ].join('')
  const labels = { sources: '溯源', relations: '关联', radiate: '辐射' }
  const restored = ['sources', 'relations', 'radiate'].filter((key) => ss.closed?.[key])
  const restore = restored.length
    ? `<div class="ss-restore">已收起 ${restored.map((key) => `<button data-ss-open="${key}">＋${labels[key]}</button>`).join('')}</div>`
    : ''
  return cards + restore
}


export function ssChartFallbackHtml(layout, chart, message, { esc }) {
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


/* ---------- 产物中心（artifacts，OS-161）纯视图 ---------- */

export function artifactsHtml({ current, inventory, groupLabel, formatBytes, formatAt, flowError, esc }) {
  if (!current) return needLibraryHtml()
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
      <div class="kick">${esc(current.name)} / 产物中心</div>
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
