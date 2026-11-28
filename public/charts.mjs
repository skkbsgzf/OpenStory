/**
 * 剧情曲线图表库（OS-41·分析对齐故事源曲线）——从 私人语料库 wiki 面板移植的三套纯 SVG 算法，零依赖。
 *
 * 与故事源曲线（wiki/{id}/index.html · devtools/build-wiki.mjs）同源同口径：
 *   renderEmotionCurve   情绪曲线 B1：横轴章进度、纵轴剧情强度（beats）、颜色=情绪类型、只标峰值（±2 邻域极大）带标签
 *   renderEventArea      事件密度面积图：逐章事件数（fact 事件流），柱带 hover 与点击
 *   renderFunctionRibbon 章功能彩带条：建立→铺垫→叠加→对峙→揭露→打击→收束 的序列带
 *   renderLocalCurve     本地词典近似曲线（段落级）：无 fact 数据时的降级层，点=段
 *
 * 互动约定（作者要求：图上的点与主页互相映射）：
 *   章级点/柱/彩带段 → data-action="curve-chapter" data-chapter-no="N"（app.js 跳到该章）
 *   段级点           → data-action="curve-para" data-paragraph="N"（app.js gotoParagraph）
 *   反向映射：opts.activeNo / opts.activePara 对应点画高亮环。
 */

const NS = 'http://www.w3.org/2000/svg'

/** 情绪八色（与故事源曲线 EMOTION_COLOR 同表；固定色保证跨皮肤可读）。 */
const EMOTION_COLOR = {
  '甜': '#10b981', '痛': '#ef4444', '爽': '#f59e0b', '悔': '#64748b',
  '疑': '#0ea5e9', '燃': '#fbbf24', '压迫': '#94a3b8', '释然': '#cbd5e1'
}

/** 章功能色（分析面板彩带条用）。 */
const FUNCTION_COLOR = {
  '建立': '#0ea5e9', '铺垫': '#64748b', '叠加': '#f59e0b', '误导': '#a78bfa',
  '打击': '#ef4444', '觉醒': '#10b981', '对峙': '#f97316', '揭露': '#22c55e', '收束': '#8b5cf6'
}

const esc = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;')

/**
 * 情绪曲线（章级）。chapters: [{no,title,emotion,beats}]。
 * opts: {width, height, activeNo}。峰值点可点击（curve-chapter）。
 */
export function renderEmotionCurve(chapters, opts = {}) {
  const list = (chapters ?? []).filter((c) => c.emotion)
  if (list.length < 2) return ''
  const W = opts.width ?? 760, H = opts.height ?? 132
  const pad = { l: 10, r: 10, t: 18, b: 22 }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const maxBeats = Math.max(1, ...list.map((c) => c.beats || 1))
  const step = iw / Math.max(1, list.length - 1)
  const pts = list.map((c, i) => ({
    x: pad.l + i * step,
    y: pad.t + ih - ((c.beats || 1) / maxBeats) * ih,
    color: EMOTION_COLOR[c.emotion] || '#94a3b8',
    no: c.no, emotion: c.emotion, beats: c.beats || 1, title: c.title
  }))
  const isPeak = (i) => {
    for (let k = Math.max(0, i - 2); k <= Math.min(pts.length - 1, i + 2); k++) {
      if (pts[k].beats > pts[i].beats) return false
    }
    return true
  }
  const line = pts.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;overflow:visible" role="img" aria-label="情绪曲线">`
  svg += `<polyline points="${line}" fill="none" stroke="var(--border)" stroke-width="1.5"/>`
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const peak = isPeak(i)
    const active = opts.activeNo === p.no
    const r = peak ? 5.5 : 3
    const ring = active ? `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r + 4}" fill="none" stroke="${p.color}" stroke-width="2" stroke-dasharray="3 2"/>` : ''
    // OS-50：r=3 的小点很难点中，再叠一层 r=12 的透明命中区（cursor 提示可点）
    svg += `<circle class="cv-hit" cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="12" fill="transparent" style="cursor:pointer" data-action="curve-chapter" data-chapter-no="${p.no}"><title>第${p.no}章「${esc(p.title)}」· ${esc(p.emotion)} · 剧情点 ${p.beats} · 点击跳到这一章</title></circle>`
    svg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${r}" fill="${p.color}" fill-opacity="${peak ? 0.95 : 0.5}" stroke="#fff" stroke-width="1.2" style="cursor:pointer" data-action="curve-chapter" data-chapter-no="${p.no}"><title>第${p.no}章「${esc(p.title)}」· ${esc(p.emotion)} · 剧情点 ${p.beats} · 点击跳转</title></circle>${ring}`
    if (peak) {
      svg += `<text x="${p.x.toFixed(1)}" y="${(p.y - 11).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="600" fill="${p.color}" stroke="var(--card)" stroke-width="3" paint-order="stroke" style="cursor:pointer" data-action="curve-chapter" data-chapter-no="${p.no}">${esc(p.emotion)}</text>`
    }
  }
  // 横轴首尾章号
  svg += `<text x="${pad.l}" y="${H - 6}" font-size="10" fill="var(--muted-fg,#64748b)">第${pts[0].no}章</text>`
  svg += `<text x="${W - pad.r}" y="${H - 6}" text-anchor="end" font-size="10" fill="var(--muted-fg,#64748b)">第${pts[pts.length - 1].no}章</text>`
  svg += '</svg>'
  return svg
}

/**
 * 事件密度面积图（章级）。chapters: [{no,events,title}]。
 * opts: {width, height, activeNo}。柱可点击（curve-chapter）。
 */
export function renderEventArea(chapters, opts = {}) {
  const list = (chapters ?? []).filter((c) => Number(c.events) > 0)
  if (list.length < 2) return ''
  const W = opts.width ?? 760, H = opts.height ?? 110
  const pad = { l: 10, r: 10, t: 12, b: 20 }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const maxEvents = Math.max(1, ...list.map((c) => c.events))
  const bw = iw / list.length
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%" role="img" aria-label="事件密度">`
  svg += `<line x1="${pad.l}" y1="${pad.t + ih}" x2="${W - pad.r}" y2="${pad.t + ih}" stroke="var(--border)" stroke-width="1"/>`
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const h = Math.max(2, (c.events / maxEvents) * ih)
    const x = pad.l + i * bw + bw * 0.12
    const w = Math.max(3, bw * 0.76)
    const active = opts.activeNo === c.no
    const color = active ? 'var(--accent,#0ea5e9)' : 'color-mix(in srgb, var(--accent,#0ea5e9) 38%, transparent)'
    // 柱本身可能只有 2px 高，补一块整列高的透明命中区（OS-50）
    svg += `<rect class="cv-hit" x="${(pad.l + i * bw).toFixed(1)}" y="${pad.t}" width="${bw.toFixed(1)}" height="${ih}" fill="transparent" style="cursor:pointer" data-action="curve-chapter" data-chapter-no="${c.no}"><title>第${c.no}章「${esc(c.title)}」· 事件 ${c.events} · 点击跳到这一章</title></rect>`
    svg += `<rect x="${x.toFixed(1)}" y="${(pad.t + ih - h).toFixed(1)}" width="${w.toFixed(1)}" height="${h.toFixed(1)}" rx="2.5" fill="${color}" style="cursor:pointer" data-action="curve-chapter" data-chapter-no="${c.no}"><title>第${c.no}章「${esc(c.title)}」· 事件 ${c.events} · 点击跳转</title></rect>`
    if ((i + 1) % Math.ceil(list.length / 8) === 0 || i === list.length - 1) {
      svg += `<text x="${(x + w / 2).toFixed(1)}" y="${H - 6}" text-anchor="middle" font-size="9.5" fill="var(--muted-fg,#64748b)">${c.no}</text>`
    }
  }
  svg += '</svg>'
  return svg
}

/**
 * 章功能彩带条。chapters: [{no,function,title}]。段宽均分，色=功能；可点击。
 */
export function renderFunctionRibbon(chapters, opts = {}) {
  const list = (chapters ?? []).filter((c) => c.function)
  if (!list.length) return ''
  const W = opts.width ?? 760, H = 26
  const seg = W / list.length
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%" role="img" aria-label="章功能序列">`
  for (let i = 0; i < list.length; i++) {
    const c = list[i]
    const color = FUNCTION_COLOR[c.function] || '#94a3b8'
    const active = opts.activeNo === c.no
    svg += `<rect x="${(i * seg + 1).toFixed(1)}" y="${active ? 2 : 5}" width="${(seg - 2).toFixed(1)}" height="${H - (active ? 4 : 10)}" rx="4" fill="${color}" fill-opacity="${active ? 1 : 0.82}" style="cursor:pointer" data-action="curve-chapter" data-chapter-no="${c.no}"><title>第${c.no}章「${esc(c.title)}」· ${esc(c.function)} · 点击跳转</title></rect>`
    if (seg > 42) {
      svg += `<text x="${(i * seg + seg / 2).toFixed(1)}" y="${H / 2 + 3.5}" text-anchor="middle" font-size="10" font-weight="600" fill="#fff" pointer-events="none">${esc(c.function)}</text>`
    }
  }
  svg += '</svg>'
  return svg
}

/**
 * 本地词典近似曲线（段落级，降级层）。emotion: analysis.mjs 的 [{index,value,pos,neg}]。
 * opts: {width, height, activePara}。点可点击（curve-para）。
 */
export function renderLocalCurve(emotion, opts = {}) {
  const pts = (emotion ?? []).filter((p) => Number.isInteger(p.index))
  if (pts.length < 3) return ''
  const W = opts.width ?? 760, H = opts.height ?? 96
  const pad = { l: 8, r: 8, t: 12, b: 10 }
  const iw = W - pad.l - pad.r, ih = H - pad.t - pad.b
  const step = iw / Math.max(1, pts.length - 1)
  const zero = pad.t + ih / 2
  const values = pts.map((p) => p.value)
  const bound = Math.max(1, ...values.map((v) => Math.abs(v)))
  const scale = (ih / 2) / bound
  // 可发现性（OS-50，作者反馈「点看不出能点」）：
  //   · 每个数据点外面套一圈**透明的宽命中区**（r=11），鼠标不用对准 3px 小点
  //   · 命中区 fill 透明但 cursor:pointer，hover 时由 CSS 放大可见圆点（.cv-hit）
  //   · 当前段（activePara）加实心环 + 竖虚线，和正文的竖条高亮呼应
  let svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" style="display:block;width:100%;overflow:visible" role="img" aria-label="段落情绪（词典近似）· 点击任意点跳到对应段落">`
  svg += `<line x1="${pad.l}" y1="${zero}" x2="${W - pad.r}" y2="${zero}" stroke="var(--line)" stroke-width="1" stroke-dasharray="2 3"/>`
  const line = pts.map((p, i) => `${(pad.l + i * step).toFixed(1)},${(zero - p.value * scale).toFixed(1)}`).join(' ')
  svg += `<polyline points="${line}" fill="none" stroke="var(--accent,#0ea5e9)" stroke-width="1.5" stroke-opacity="0.55"/>`
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]
    const x = pad.l + i * step
    const y = zero - p.value * scale
    const active = opts.activePara === p.index
    const color = p.value >= 0 ? 'var(--ok, #10b981)' : 'var(--danger, #ef4444)'
    const tip = `第 ${p.index + 1} 段 · 强度 ${p.value}（正 ${p.pos}/负 ${p.neg}）· 点击跳到这一段`
    // 当前段：竖虚线（把「这一点」和「正文那一段」在视觉上挂上）
    if (active) {
      svg += `<line x1="${x.toFixed(1)}" y1="${pad.t}" x2="${x.toFixed(1)}" y2="${H - pad.b}" stroke="${color}" stroke-width="1" stroke-opacity="0.5" stroke-dasharray="2 3" pointer-events="none"/>`
    }
    // 可见点
    svg += `<circle class="cv-dot${active ? ' on' : ''}" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${active ? 4 : 2.6}" fill="${color}" fill-opacity="${active ? 1 : 0.6}" pointer-events="none"/>`
    // 宽命中区（透明，负责接收点击与 hover）
    svg += `<circle class="cv-hit" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="11" fill="transparent" style="cursor:pointer" data-action="curve-para" data-paragraph="${p.index}"><title>${tip}</title></circle>`
    if (active) {
      svg += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="8" fill="none" stroke="${color}" stroke-width="1.6" stroke-dasharray="3 2" pointer-events="none"/>`
    }
  }
  svg += '</svg>'
  return svg
}

export const CHART_LEGEND = Object.freeze({
  emotion: Object.entries(EMOTION_COLOR).map(([k, v]) => ({ label: k, color: v })),
  function: Object.entries(FUNCTION_COLOR).map(([k, v]) => ({ label: k, color: v }))
})
