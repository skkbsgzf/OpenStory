/** C6：从 public/app.js 逐字迁出的analysisViews渲染面。副作用仍由 app.js 持有。 */
export function createAnalysisViews(scope) {
  const { state, esc, hiddenModules, chapterNoFromFile, analyzeEnabled, analyzeModulesFor, analyzeModuleById, chartsModule, analysisModules, moduleCard, missingText } = scope

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

function analyzeChapterView() {
  return {
    dismissed: state.analyze.dismissed,
    activePara: state.analyze.activePara,
    expandOthers: state.analyze.expandOthers,
    modOpen: state.analyze.modOpen,
    hidden: [...hiddenModules()],
    charts: chartsModule(),
    fact: state.analyze.fact,
    factTab: state.analyze.factTab,
    chapterNo: chapterNoFromFile(state.chapterFile)
  }
}

function analyzePanelHtml() {
  // OS-203：分析工作面降级时不渲染卡片与选择器，只出一条统一说明（判定由 app.js 注入）。
  const card = typeof moduleCard === 'function' ? moduleCard('analysis') : null
  if (card && card.status === 'degraded') {
    const why = typeof missingText === 'function' ? missingText(card.missing, card.requires) : ''
    return `<div class="analyze-body"><div class="analyze-degraded" data-degraded="1" title="${esc(why)}">${esc(why)}</div></div>`
  }
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
    parts.push(`<div class="am-empty">${analysisModules() ? '还没有选装分析模块——点「＋ 分析」挑一个。' : '正在装载分析模块…'}</div>`)
  }
  return `<div class="analyze-body">${parts.join('')}</div>`
}

  return { sparkline, barRow, analyzePickerHtml, analyzeWorkCardHtml, analyzeChapterView, analyzePanelHtml }
}
