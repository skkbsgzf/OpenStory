/** C6：从 public/app.js 逐字迁出的referencePageViews渲染面。副作用仍由 app.js 持有。 */
export function createReferencePageViews(scope) {
  const { state, esc, text, moduleOn, registryModule, refNodeCardHtml, refModulesHtml, dirWork, scriptViews, moduleCard, missingText, pageLabel } = scope

function refImagesSlotHtml(note) {
  const images = Array.isArray(note?.images) ? note.images.filter(Boolean) : []
  const root = state.current?.path || ''
  const urlOf = (rel) => /^https?:\/\//u.test(rel)
    ? rel
    : `/api/reference/asset?root=${encodeURIComponent(root)}&path=${encodeURIComponent(rel)}`
  // OS-203：生图降级时按钮置灰保留并带统一说明，不再假装可点。
  const degCard = typeof moduleCard === 'function' ? moduleCard('imagegen') : null
  const deg = degCard && degCard.status === 'degraded'
  const degWhy = deg && typeof missingText === 'function' ? missingText(degCard.missing, degCard.requires) : ''
  const genBtn = deg
    ? `<button class="ref-slot-gen" data-action="ref-gen-image" data-degraded="1" aria-disabled="true" disabled title="${esc(degWhy)}">✦ 生成设定图</button>`
    : `<button class="ref-slot-gen" data-action="ref-gen-image" title="按这个条目生成设定图（后台任务，进度看右下角任务中心）"${moduleOn('imagegen') ? '' : ' hidden'}>✦ 生成设定图</button>`
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

function chapterTreeHtml() {
  const chapters = state.write.chapters || []
  const head = `<div class="chapter-new">
      <input id="chapter-new-title" placeholder="新章标题…" value="">
      <button class="btn-ghost" data-action="chapter-create" title="自动编号新建">＋</button>
    </div>`
  return `${head}<div class="chapter-rows">${chapterRowsHtml(chapters)}</div>`
}

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

function graphModuleHtml() {
  const rc = state.refCol
  if (rc.graphError) return `<div class="error-box">${esc(rc.graphError)}</div>`
  if (rc.graphLoading) return '<div class="loading">正在构图…</div>'
  const graph = rc.graph
  if (!graph) return `<div class="empty">点「重新构图」生成${registryModule()?.namingEntry?.('worldbook')?.graphLabel || '世界书图谱'}。</div>`
  const byKind = graph.stats?.byKind || {}
  const legend = [
    ['worldbook', pageLabel('worldbook'), 'var(--accent)'],
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

function refSummaryHtml() {
  const rc = state.refCol
  if (rc.summaryBusy) return '<div class="loading">正在生成摘要…</div>'
  const body = text(rc.summary)
  return `<div class="ref-summary">${body ? esc(body) : '<span class="empty">还没有摘要。点下面生成——AI 会读当前章节关联的世界书，总结成本章要点。</span>'}</div>
    ${rc.summaryError ? `<div class="error-box">${esc(rc.summaryError)}</div>` : ''}
    <div class="ref-summary-ops">
      <button data-action="ref-summary-run">${body ? '重新生成' : '生成摘要'}</button>
      ${body ? '<button data-action="ref-summary-clear">清空</button>' : ''}
    </div>`
}

function scriptCastHtml() {
  const work = dirWork('剧本')
  const mod = state.scriptModule
  if (!mod?.splitScriptBlocks || !work?.text) return '<div class="nav-empty">还没有内容</div>'
  return scriptViews().scriptCastHtml({ blocks: mod.splitScriptBlocks(work.text), esc })
}

function refColHtml() {
  const inner = refModulesHtml()
  return inner ? `<aside class="ref-col" id="ref-col">${inner}</aside>` : ''
}

  return { refImagesSlotHtml, chapterTreeHtml, chapterRowsHtml, graphModuleHtml, refSummaryHtml, scriptCastHtml, refColHtml }
}
