/**
 * 分析模块注册表（S3）——把「分析能力」封装成可注册、可插拔的模块。
 *
 * 两种作用域（scope）：
 *   chapter ＝ 看正文选区/本章（右栏正文页选装）
 *   work    ＝ 看整部作品（故事源「图表」形态承载，正文页也可选装同一份结果）
 *
 * 硬约束：
 *   · 本文件是纯数据 + 纯函数：模块定义里不碰 DOM、不读全局 state、不写任何浏览器存储；
 *     需要状态（dismissed/activePara/图表实例…）由调用方经 `view` 传入。
 *   · 零第三方依赖、无静态 import：章节模块通过 context.analyze 注入引擎，
 *     缺失时才惰性 `import('./analysis.mjs')`（保持与 analysis.mjs 的松耦合）。
 *   · work 级数据口径来自 storySource.mjs 的 stats.charts（单一真源），
 *     run({ entries, wiki, layout }) 只做「选读 + 结论」，不另算一套张力表。
 *
 * 消费方：
 *   public/app.js（正文右栏选装 / 故事源图表容器）
 */

/* ---------- 小工具（纯函数，样式全部走类名与令牌） ---------- */

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

function listOf(value) {
  return Array.isArray(value) ? value : []
}

function num(value, fallback = 0) {
  const number = Number(value)
  return Number.isFinite(number) ? number : fallback
}

function sumOf(list, pick) {
  return list.reduce((sum, item) => sum + (Number(pick(item)) || 0), 0)
}

/** 折线（SVG viewBox，零图表库）。与正文面板同口径，模块自带一份保持零耦合。 */
function sparkline(values, opts = {}) {
  const width = opts.width || 260
  const height = opts.height || 54
  const color = opts.color || 'var(--accent)'
  const useFill = opts.fill !== false
  if (!values.length) return ''
  const max = Math.max(...values.map((value) => Math.abs(value)), 1)
  const step = values.length > 1 ? width / (values.length - 1) : width
  const points = values.map((value, index) => [
    Math.round(index * step),
    Math.round(height / 2 - (value / max) * (height / 2 - 4))
  ])
  const line = points.map((pair, index) => `${index === 0 ? 'M' : 'L'}${pair[0]},${pair[1]}`).join(' ')
  const area = useFill
    ? `<path d="${line} L${points[points.length - 1][0]},${height / 2} L0,${height / 2} Z" fill="${color}" opacity=".12"/>`
    : ''
  return `<svg class="spark" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none">${area}<path d="${line}" fill="none" stroke="${color}" stroke-width="1.6"/></svg>`
}

function barRow(factor) {
  const width = Math.min(100, Math.max(0, num(factor?.score)))
  return `<div class="bar-row"><span class="bar-label">${esc(factor?.label)}</span><span class="bar-track"><span class="bar-fill" style="width:${width}%"></span></span><span class="bar-score">${esc(factor?.score)}</span><span class="bar-detail">${esc(factor?.detail)}</span></div>`
}

/** 列表行（work 模块在右栏的紧凑形态）。 */
function rowHtml(main, meta = '') {
  return `<div class="am-list-row"><span class="am-li-main">${esc(main)}</span>${meta ? `<span class="am-li-meta">${esc(meta)}</span>` : ''}</div>`
}

function statHtml(pairs) {
  return `<div class="am-stat">${pairs.map(([label, value]) => `<span>${esc(label)} <b>${esc(value)}</b></span>`).join('')}</div>`
}

function chartHostHtml(note) {
  return `<div id="ss-chart" class="ss-chart-box"></div><p class="ss-chart-note">${esc(note)}</p>`
}

function emptyHtml(view, message) {
  return view?.plot
    ? `<div class="ss-empty">${esc(message)}</div>`
    : `<div class="am-empty">${esc(message)}</div>`
}

/* ---------- 本章编辑总评（scope: chapter）----------
 * 这是原正文右栏的整块分析面板（OS-33/OS-44/OS-56 的口径原样搬进来）：
 * 概览 KPI → 编辑总评 → 曲线/文风/节奏/AI 味 → 本段批注（活卡）。
 * view 提供状态：dismissed / activePara / expandOthers / modOpen / hidden / charts / fact / factTab / chapterNo。
 */

function styleSectionHtml(result) {
  const style = result?.style
  if (!style) return '<p class="sub">这一章还没有文风数据。</p>'
  const cv = (value) => (Number.isFinite(value) ? value.toFixed(2) : '—')
  const verdict = (value, good, mid) => {
    const number = Number(value)
    if (!Number.isFinite(number)) return ['—', '']
    if (number >= good) return ['参差自然', 'good']
    if (number >= mid) return ['偏整齐', 'mid']
    return ['过于均匀', 'bad']
  }
  const [sentVerdict, sentClass] = verdict(style.sentenceCv, 0.55, 0.35)
  const [paraVerdict, paraClass] = verdict(style.paraCv, 0.5, 0.3)
  const cliches = Array.isArray(style.cliches) ? style.cliches : []
  const connectives = Array.isArray(style.connectives) ? style.connectives : []
  const chip = (item, kind) => `<span class="style-chip ${kind}" title="${esc(item.word)} 出现 ${esc(item.count)} 次">${esc(item.word)}<b>${esc(item.count)}</b></span>`
  return `<div class="style-grid">
      <div class="style-kpi"><span class="sk-label">句长变异</span><b class="sk-val ${sentClass}">${cv(style.sentenceCv)}</b><span class="sk-note">${sentVerdict}</span></div>
      <div class="style-kpi"><span class="sk-label">段长变异</span><b class="sk-val ${paraClass}">${cv(style.paraCv)}</b><span class="sk-note">${paraVerdict}</span></div>
    </div>
    ${cliches.length ? `<div class="style-block"><h5>套话 <span class="count">${cliches.length}</span></h5><div class="style-chips">${cliches.slice(0, 10).map((item) => chip(item, 'cliche')).join('')}</div></div>` : ''}
    ${connectives.length ? `<div class="style-block"><h5>连接词 <span class="count">${sumOf(connectives, (item) => item.count)}</span></h5><div class="style-chips">${connectives.slice(0, 10).map((item) => chip(item, 'connective')).join('')}</div></div>` : ''}
    ${!cliches.length && !connectives.length ? '<p class="sub">没检出套话与连接词堆砌——文风干净。</p>' : ''}`
}

function chapterEditorialHtml(result, view = {}) {
  if (!result) return '<p class="sub">还没有分析结果——点「重新分析」。</p>'
  const stats = result.stats
  const dismissed = view.dismissed || {}
  const modOpen = view.modOpen || {}
  const hiddenMods = new Set(listOf(view.hidden))
  const viewPara = Number.isInteger(view.activePara) ? view.activePara : -1

  const rhythmValues = result.rhythm.map((item) => item.chars)
  const openIssues = result.issues.filter((issue) => !dismissed[issue.id])
  // 每条问题可能落在多段（重复用词/套话）：paragraphs 是全集，paragraph 只是首段
  const parasOf = (issue) => {
    const list = Array.isArray(issue.paragraphs) && issue.paragraphs.length
      ? issue.paragraphs
      : [Number(issue.paragraph)]
    return list.filter((n) => Number.isInteger(n) && n >= 0)
  }
  const located = openIssues.filter((issue) => parasOf(issue).length > 0)
  const global = openIssues.filter((issue) => parasOf(issue).length === 0)
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
  const expandOpen = view.expandOthers === true
  // OS-41 剧情曲线区：fact 可用＝章级语义曲线（点峰值跳章）；否则本地词典近似（点段定位）
  const charts = view.charts || null
  const fact = view.fact || null
  const activeNo = num(view.chapterNo)
  const factTab = view.factTab === 'events' ? 'events' : 'emotion'
  let curveSection = ''
  if (charts && fact && (fact.chapters?.length ?? 0) >= 2) {
    const chart = factTab === 'events'
      ? charts.renderEventArea(fact.chapters, { activeNo })
      : charts.renderEmotionCurve(fact.chapters, { activeNo })
    const ribbon = charts.renderFunctionRibbon(fact.chapters, { activeNo })
    curveSection = '<div class="chart-tabs"><button class="chart-tab' + (factTab === 'emotion' ? ' on' : '') + '" data-action="analyze-chart" data-tab="emotion">情绪曲线</button>' +
      '<button class="chart-tab' + (factTab === 'events' ? ' on' : '') + '" data-action="analyze-chart" data-tab="events">事件密度</button></div>' +
      chart + ribbon +
      '<p class="sub">图上的点/柱/彩带都可以点——跳到对应章；正文切章或滚动，当前章在这里高亮回看。</p>'
  } else if (charts) {
    curveSection = charts.renderLocalCurve(result.emotion, { activePara: viewPara }) +
      '<p class="sub">本库还没有故事源 fact——曲线只是词典近似。跑一次「故事源 → enrich」后，这里会换成语义级剧情曲线：峰值标情绪、可点击跳章。</p>'
  }
  const modules = [
    { id: 'plotCurve', title: '情绪曲线', body: curveSection },
    { id: 'style', title: '文风', body: styleSectionHtml(result) },
    { id: 'rhythm', title: '节奏（逐段字数）', body: sparkline(rhythmValues, { color: 'var(--ok)' }) },
    { id: 'aiSmell', title: `AI 味 ${result.aiSmell.score}`, body: result.aiSmell.factors.map(barRow).join('') },
    {
      id: 'annotations',
      // 空态也给信息与出路：说清「这一段干净」还是「还没滚动」，给出全章条数与最近的批注段。
      // raw＝活卡原样渲染（跟正文滚动对齐），不进折叠。
      raw: true,
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
  // 编辑 verdict：每个模块的「一句话结论」——有问题先显问题，没问题显亮点，都没有给中性位
  const ed = result.editorial || { headline: '', goods: [], problems: [] }
  const verdictFor = (id) => {
    const bad = ed.problems.find((item) => item.module === id)
    if (bad) return { icon: '⚠', tone: 'warn', text: bad.verdict }
    const ok = ed.goods.find((item) => item.module === id)
    if (ok) return { icon: '✓', tone: 'good', text: ok.verdict }
    return null
  }
  const wrapMod = (mod, verdict) => {
    const open = modOpen[mod.id] === true
    const line = verdict
      ? `<span class="mod-verdict ${verdict.tone}">${verdict.icon} ${esc(verdict.text)}</span>`
      : '<span class="mod-verdict neutral">详见展开</span>'
    return `<details class="analyze-sec mod${open ? ' open' : ''}" data-mod-card="${esc(mod.id)}"${open ? ' open' : ''}>
      <summary data-action="mod-toggle" data-mod-id="${esc(mod.id)}">
        <span class="mod-v-head">${mod.title}</span>${line}<span class="mod-caret">›</span>
      </summary>
      <div class="mod-v-body">${mod.body}</div>
    </details>`
  }

  const live = modules.filter((mod) => !hiddenMods.has(mod.id) && (mod.body || mod.html))
  const edCard = '<section class="analyze-sec ed-card">' +
    '<h4>编辑总评</h4>' +
    '<p class="ed-headline">' + esc(ed.headline || '还没有结论——点「重新分析」。') + '</p>' +
    (ed.goods.length ? '<div class="ed-goods">' + ed.goods.slice(0, 3).map((item) =>
      '<div class="ed-line good"><span class="ed-ic">✓</span><span>' + esc(item.verdict) + '</span></div>').join('') + '</div>' : '') +
    (ed.problems.length ? '<div class="ed-problems">' + ed.problems.slice(0, 4).map((item) => {
      const goto = item.paras && item.paras.length
        ? '<button class="ed-act" data-action="analyze-goto" data-paragraph="' + item.paras[0] + '">定位第 ' + (item.paras[0] + 1) + ' 段</button>' : ''
      const jump = item.module && !hiddenMods.has(item.module)
        ? '<button class="ed-act" data-action="ed-jump" data-module="' + esc(item.module) + '">详情 ↘</button>' : ''
      return '<div class="ed-line warn"><span class="ed-ic">⚠</span><span class="ed-text"><b>' + esc(item.verdict) + '</b>' +
        (item.action ? '<i class="ed-action">改法：' + esc(item.action) + '</i>' : '') +
        (item.detail ? '<i class="ed-why">' + esc(item.detail) + '</i>' : '') +
        (item.source ? '<i class="ed-source">依据：' + esc(item.source) + '</i>' : '') +
        '</span><span class="ed-ops">' + goto + jump + '</span></div>'
    }).join('') + '</div>' : '') +
    '</section>'
  return '<div class="analyze-kpis"><span><b>' + stats.chars + '</b> 字</span><span><b>' + stats.paragraphs +
    '</b> 段</span><span><b>' + stats.avgSentenceLen + '</b> 字/句</span><span><b>' + stats.dialogueRatio +
    '%</b> 对白</span></div>' +
    (result.confidence === 'low' ? '<div class="warn-box">本章偏短，指标仅供参考。</div>' : '') +
    edCard +
    live.map((mod) => {
      if (mod.raw) return mod.html
      return wrapMod({ id: mod.id, body: mod.body, title: mod.title }, verdictFor(mod.id))
    }).join('') +
    '<div class="ops"><button class="btn-ghost" data-action="analyze-run">重新分析</button></div>'
}

/* ---------- 章节模块的引擎（注入优先，缺省惰性加载） ---------- */

let enginePromise = null
function chapterEngine() {
  if (!enginePromise) enginePromise = import('./analysis.mjs').then((mod) => mod.analyzeChapter)
  return enginePromise
}

async function runChapterEditorial(context = {}) {
  const engine = typeof context.analyze === 'function' ? context.analyze : await chapterEngine()
  return engine(context.text, { paragraphs: context.paragraphs, habits: context.habits })
}

/* ---------- 剧情曲线（scope: work）----------
 * 数据源＝storySource 的 stats.charts.curve（张力×事件密度），这里只挑峰、给结论。
 */

function plotCurveRun({ layout } = {}) {
  const curve = listOf(layout?.stats?.charts?.curve)
  if (!curve.length) return { empty: true, chapters: 0, points: [], peaks: [], densest: [], avgTension: 0, maxTension: 0, totalEvents: 0 }
  const peaks = [...curve].sort((left, right) => right.tension - left.tension).slice(0, 3)
  const densest = [...curve].sort((left, right) => right.density - left.density).slice(0, 3)
  const totalEvents = sumOf(curve, (point) => point.density)
  return {
    empty: false,
    chapters: curve.length,
    points: curve,
    peaks,
    densest,
    avgTension: Math.round(sumOf(curve, (point) => point.tension) / curve.length),
    maxTension: peaks[0]?.tension ?? 0,
    totalEvents
  }
}

function plotCurveRender(result, view = {}) {
  if (result.empty) return emptyHtml(view, '这本书还没有章级的张力/事件数据——先在故事源里铺开条目，再跑 enrich。')
  const peakRows = result.peaks.map((point) => rowHtml(
    `第${point.chapter}章${point.title && point.title !== `第${point.chapter}章` ? ` · ${point.title}` : ''}`,
    `张力 ${point.tension}${point.function ? ` · ${point.function}` : ''}${point.emotion ? ` / ${point.emotion}` : ''}`
  )).join('')
  if (view.plot) {
    return chartHostHtml(`张力＝章功能 45% ＋ 情绪 55%（enrich 同表换算）；事件密度取 fact 事件流逐章计数。全 ${result.chapters} 章，均张力 ${result.avgTension}，峰值第 ${result.peaks[0]?.chapter ?? '—'} 章。`)
  }
  return statHtml([['章', result.chapters], ['均张力', result.avgTension], ['事件', result.totalEvents]]) +
    sparkline(result.points.map((point) => point.tension), { color: 'var(--accent)' }) +
    `<div class="am-list">${peakRows}</div>` +
    '<p class="sub">峰章按张力排序；完整曲线去故事源「图表 → 剧情曲线」看。</p>'
}

/* ---------- 伏笔回收（scope: work）---------- */

function foreshadowAuditRun({ layout } = {}) {
  const foreshadow = layout?.stats?.charts?.foreshadows || null
  const points = listOf(foreshadow?.points)
  const counts = listOf(foreshadow?.counts)
  if (!foreshadow || (!points.length && !counts.some((item) => num(item.planted) > 0))) {
    return { empty: true, detail: false, points: [], unresolved: [], counts: [], planted: 0, resolved: 0, open: 0 }
  }
  const unresolved = points.filter((point) => !point.resolved)
  const resolved = points.length - unresolved.length
  return {
    empty: false,
    detail: Boolean(foreshadow.detail) && points.length > 0,
    points,
    unresolved,
    counts,
    planted: points.length || sumOf(counts, (item) => item.planted),
    resolved,
    open: unresolved.length || Math.max(0, sumOf(counts, (item) => item.planted) - resolved)
  }
}

function foreshadowAuditRender(result, view = {}) {
  if (result.empty) return emptyHtml(view, '还没有伏笔数据——wiki 章纲里没有被记录的伏笔（埋点/回收点）。')
  if (view.plot) {
    return chartHostHtml(result.detail
      ? '实心＝埋 · 空心＝收 · 虚线＝未收。点任意伏笔点回跳所在章；未收线延伸到末章。'
      : '章纲只有伏笔计数、没有回收明细——这里按「埋（条）＋累计未收」呈现，不拿假回收糊弄。')
  }
  if (!result.detail) {
    const rows = result.counts.filter((item) => num(item.planted) > 0).slice(0, 8)
      .map((item) => rowHtml(`第${item.chapter}章`, `埋 ${item.planted} · 累计 ${item.cumulative}`)).join('')
    return statHtml([['埋', result.planted], ['涉及章', result.counts.filter((item) => num(item.planted) > 0).length]]) +
      `<div class="am-list">${rows || '<p class="sub">章纲没有伏笔计数。</p>'}</div>` +
      '<p class="sub">章纲只有计数、没有逐条回收明细——不编造回收点。</p>'
  }
  const rows = result.unresolved.slice(0, 8)
    .map((point) => rowHtml(`第${point.chapter}章 · ${text(point.text).slice(0, 30) || '（未记内容）'}`, point.payoffChapter ? `第${point.payoffChapter}章收` : '未收')).join('')
  return statHtml([['埋', result.planted], ['收', result.resolved], ['未收', result.open]]) +
    `<div class="am-list">${rows || '<p class="sub">没有未收的伏笔。</p>'}</div>` +
    '<p class="sub">只看未收（最多 8 条）；完整分布去故事源「图表 → 伏笔回收」。</p>'
}

/* ---------- 剧情密度（scope: work）---------- */

function plotDensityRun({ layout } = {}) {
  const heatmap = layout?.stats?.charts?.heatmap || null
  const cells = listOf(heatmap?.data)
  if (!heatmap || !cells.length) return { empty: true, cells: [], xChapters: [], hottest: [], max: 0, totalEvents: 0, chapters: 0 }
  const hottest = [...cells]
    .sort((left, right) => right[2] - left[2])
    .slice(0, 5)
    .map((cell) => ({
      chapter: heatmap.xChapters?.[cell[0]] ?? cell[0] + 1,
      beat: cell[1] + 1,
      events: cell[2]
    }))
  return {
    empty: false,
    cells,
    xChapters: listOf(heatmap.xChapters),
    hottest,
    max: num(heatmap.max),
    totalEvents: sumOf(cells, (cell) => cell[2]),
    chapters: listOf(heatmap.xLabels).length
  }
}

function plotDensityRender(result, view = {}) {
  if (result.empty) return emptyHtml(view, '还没有可聚合的段级事件——fact 条目缺少 segmentIndex 时无法按段铺热力。')
  if (view.plot) {
    return chartHostHtml('色深＝该章该段的事件数；点热格回跳章。')
  }
  const rows = result.hottest
    .map((cell) => rowHtml(`第${cell.chapter}章 · 第${cell.beat}拍`, `${cell.events} 事件`)).join('')
  return statHtml([['章', result.chapters], ['段次', result.cells.length], ['事件', result.totalEvents]]) +
    `<div class="am-list">${rows}</div>` +
    '<p class="sub">最密的 5 个「章×段」格；完整热力图去故事源「图表 → 剧情密度」。</p>'
}

/* ---------- 注册表 ---------- */

/* ---------- 角色泳道时间线（scope: work）----------
 * 数据源＝fact 条目的 events（who × chapter × channel）。
 * 作者口径：「不同角色在同一个轴上不断出场、退场、说话、行动」——这就是那条轴。
 */

/** buildTimeline 的内联同步版（与 storySource.buildTimeline 同算法；本模块无静态 import）。 */
function buildTimelineSync(entries) {
  const list = listOf(entries).filter((e) => e && typeof e === "object")
  const chapterSet = new Set()
  const byWho = new Map()
  const spans = []
  const CHANNEL_LABEL = { say: "说", do: "做", perceive: "感知", feel: "情绪", state: "状态", action: "行动" }
  for (const entry of list) {
    const name = text(entry.name).trim()
    const from = numOf(entry?.span?.from)
    const to = numOf(entry?.span?.to)
    if (from != null) chapterSet.add(from)
    if (to != null) chapterSet.add(to)
    if (from != null && to != null) spans.push({ name, from, to })
    for (const ev of listOf(entry.events)) {
      const who = text(ev?.who).trim() || "（未标注）"
      const chapter = numOf(ev?.chapter) ?? from ?? null
      if (chapter != null) chapterSet.add(chapter)
      const channel = text(ev?.channel).trim() || "other"
      if (!byWho.has(who)) byWho.set(who, [])
      byWho.get(who).push({
        entry: name, chapter, index: numOf(ev?.index) ?? 0, channel,
        channelLabel: CHANNEL_LABEL[channel] ?? channel,
        track: text(ev?.track) || "fact",
        content: text(ev?.content).trim().slice(0, 220)
      })
    }
  }
  const chapters = [...chapterSet].filter((n) => n != null).sort((a, b) => a - b)
  const tracks = [...byWho.entries()].map(([who, events]) => ({
    who, count: events.length,
    events: events.sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0) || a.index - b.index)
  })).sort((a, b) => b.count - a.count || a.who.localeCompare(b.who, "zh-Hans-CN"))
  const used = new Set()
  for (const t of tracks) for (const ev of t.events) used.add(ev.channel)
  return {
    tracks, chapters, spans: spans.sort((a, b) => a.from - b.from),
    channels: [...used].map((key) => ({ key, label: CHANNEL_LABEL[key] ?? key })),
    stats: { trackCount: tracks.length, eventCount: tracks.reduce((n, t) => n + t.count, 0), chapterCount: chapters.length, drawable: tracks.length > 0 && chapters.length > 0 }
  }
}

function numOf(value) { const n = Number(value); return Number.isFinite(n) ? n : null }

function timelineRun({ layout, entries: ctxEntries } = {}) {
  // layout 里没有 events 明细，直接用 entries（run 收到的 ctx 里有）
  const entries = listOf(ctxEntries ?? layout?.entries)
  if (!entries.length) return { empty: true, reason: "没有 fact 条目", timeline: null }
  const timeline = buildTimelineSync(entries)
  if (!timeline.stats.drawable) {
    return { empty: true, reason: "这份故事源没有事件级数据（events/span 为空）", timeline }
  }
  return { empty: false, timeline }
}

/** 泳道图：每角色一行，横轴＝章，圆点＝事件（颜色按 channel）。纯 HTML/CSS，不引图表库。 */
function timelineRender(data) {
  const timeline = data?.timeline
  if (!timeline || data.empty) {
    return `<div class="tl-empty"><p>${escText(data?.reason || "没有可画的时间线")}</p>
      <p class="sub">时间线需要 fact 条目里的 events（谁、在哪个 channel、对应章节）——先准备故事源条目并运行 enrich 就有了。</p></div>`
  }
  const { tracks, chapters, channels, spans, stats } = timeline
  const colOf = (chapter) => {
    if (chapter == null) return -1
    const idx = chapters.indexOf(chapter)
    return idx < 0 ? -1 : idx
  }
  const colCount = Math.max(1, chapters.length)
  const CH_COLOR = { say: "#f472b6", do: "#60a5fa", perceive: "#34d399", feel: "#fbbf24", state: "#a78bfa", other: "#94a3b8" }
  const head = `<div class="tl-axis"><span class="tl-axis-label">角色 \\ 章</span>${chapters.map((ch) => `<span class="tl-tick">${ch}</span>`).join("")}</div>`
  const legend = `<div class="tl-legend">${channels.map((c) => `<span class="tl-lg"><i style="background:${CH_COLOR[c.key] || CH_COLOR.other}"></i>${escText(c.label)}</span>`).join("")}</div>`
  const spanRow = spans.length
    ? `<div class="tl-spans"><span class="tl-axis-label">条目跨度</span>${spans.map((sp) => {
        const a = colOf(sp.from), b = colOf(sp.to)
        if (a < 0 || b < 0) return ""
        const left = (a / colCount) * 100, width = ((b - a + 1) / colCount) * 100
        return `<span class="tl-span" style="left:${left}%;width:${width}%" title="${escText(sp.name)}：第${sp.from}–${sp.to}章">${escText(sp.name)}</span>`
      }).join("")}</div>`
    : ""
  const rows = tracks.map((track) => {
    const dots = track.events.map((ev) => {
      const col = colOf(ev.chapter)
      if (col < 0) return ""
      const left = ((col + 0.5) / colCount) * 100
      const color = CH_COLOR[ev.channel] || CH_COLOR.other
      const label = `第${ev.chapter ?? "?"}章 · ${ev.channelLabel}${ev.entry ? ` · ${ev.entry}` : ""}`
      return `<button class="tl-dot" style="left:${left}%;background:${color}" title="${escText(ev.content)}" data-action="tl-dot" data-label="${escText(label)}" data-text="${escText(ev.content)}"></button>`
    }).join("")
    return `<div class="tl-row"><span class="tl-who">${escText(track.who)}<i>${track.count}</i></span><div class="tl-lane">${dots}</div></div>`
  }).join("")
  return `<div class="tl-wrap">
    <div class="tl-stats">${stats.trackCount} 个角色 · ${stats.eventCount} 个事件 · ${stats.chapterCount} 章</div>
    ${legend}
    <div class="tl-chart">${head}${spanRow}${rows}</div>
    <div class="tl-pick" id="tl-pick" hidden></div>
  </div>`
}

/** 最小 HTML 转义（模块内自足，避免依赖 app.js 的 esc）。 */
function escText(value) {
  return String(value ?? "").replace(/[&<>"\x27]/gu, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]))
}

export const ANALYSIS_MODULES = Object.freeze([
  Object.freeze({
    id: 'chapter-editorial',
    label: '本章编辑总评',
    scope: 'chapter',
    hint: '字数/句长/对白/节奏/AI 味 + 编辑结论',
    emptyLabel: '开始分析本章',
    run: runChapterEditorial,
    render: chapterEditorialHtml
  }),
  Object.freeze({
    id: 'plot-curve',
    label: '剧情曲线',
    scope: 'work',
    hint: '张力 × 事件密度',
    run: plotCurveRun,
    render: plotCurveRender
  }),
  Object.freeze({
    id: 'foreshadow-audit',
    label: '伏笔回收',
    scope: 'work',
    hint: '埋 / 收 / 未收',
    run: foreshadowAuditRun,
    render: foreshadowAuditRender
  }),
  Object.freeze({
    id: 'timeline',
    label: '角色时间线',
    scope: 'work',
    hint: '角色泳道 × 章轴，看谁何时出场/说话/行动',
    run: timelineRun,
    render: timelineRender
  }),

  Object.freeze({
    id: 'plot-density',
    label: '剧情密度',
    scope: 'work',
    hint: '章 × 段事件热力',
    run: plotDensityRun,
    render: plotDensityRender
  })
])

/** 按作用域取模块（保持注册顺序；未知 scope 返回空数组）。 */
export function modulesFor(scope) {
  return ANALYSIS_MODULES.filter((mod) => mod.scope === scope)
}

/** 按 id 取模块；不存在返回 null（调用方决定降级，不抛）。 */
export function moduleById(id) {
  return ANALYSIS_MODULES.find((mod) => mod.id === id) || null
}

/** 跑单个模块：统一成 Promise（章节模块是异步的，work 模块是同步纯计算）。 */
export async function runModule(id, context = {}) {
  const mod = moduleById(id)
  if (!mod) throw new Error(`未知分析模块：${id}`)
  return mod.run(context)
}
