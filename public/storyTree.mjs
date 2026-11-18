/**
 * 推演剧情树（OS-61 P3）——二维分支导图：横轴＝拍号（round），纵轴＝分支泳道。
 *
 * 分两层：
 *   · layoutStoryTree / storyNodeLabel 是纯函数（不碰 DOM），Node 测试直接载入；
 *   · mountStoryTree 用原生 SVG 画出来——点节点回调 onPick，空白拖动平移、滚轮缩放。
 * 零依赖，不引任何第三方库。
 *
 * 数据来源是推演会话（deduceSession）：nodes 带 branchId/parentId/round。
 * 分叉溯源：/api/deduce/branch 会在分叉节点上记 forkBranchIds（新分支 id 列表），
 * 布局据此给「新分支第一拍」补一条虚线分叉边——即使那拍还没有 parentId。
 */

const SVG_NS = 'http://www.w3.org/2000/svg'

export const STORY_TREE_DEFAULTS = Object.freeze({
  colGap: 190,   // 相邻拍号的横向间距
  rowGap: 84,    // 同泳道同拍号叠放时的纵向间距
  padX: 90,
  padY: 64,
  lanePad: 22    // 泳道上下留白
})

function text(value) {
  return String(value ?? '')
}

function branchOf(node) {
  return text(node?.branchId).trim() || 'main'
}

function roundOf(node) {
  const round = Number(node?.round)
  return Number.isFinite(round) ? round : 0
}

/** 节点短标签：正文首句（截断）；没正文退候选摘要；都没有退「第N拍」。 */
export function storyNodeLabel(node, maxChars = 14) {
  const prose = text(node?.prose).trim()
  let source = prose
  if (!source) {
    const candidates = Array.isArray(node?.candidates) ? node.candidates : []
    const chosen = candidates.find((candidate) => candidate && text(candidate.id) === text(node?.choiceId))
    source = text(chosen?.text || candidates[0]?.text).trim()
  }
  if (!source) return `第${roundOf(node)}拍`
  const sentence = source.split(/[。！？!?…\n]/u)[0].trim() || source
  const chars = [...sentence]
  return chars.length > maxChars ? `${chars.slice(0, maxChars).join('')}…` : sentence
}

/**
 * 布局（纯函数）：
 *   · 泳道＝branchId 分组，主线（main）永远第一条，其余按首次出现顺序；
 *   · x＝拍号：padX + (round - 最小拍号) * colGap，全图同一把横尺；
 *   · y＝泳道顶 + 泳道留白 + 叠放序号 * rowGap——同分支同拍号的节点纵向叠放不重叠，
 *     泳道高度按该道最大叠放数撑开；
 *   · 边＝parentId 实线＋forkBranchIds 补的分叉虚线（只补没有父边的分支首拍）。
 * 空会话/坏形状返回空布局，不抛。
 */
export function layoutStoryTree(session, options = {}) {
  const { colGap, rowGap, padX, padY, lanePad } = { ...STORY_TREE_DEFAULTS, ...options }
  const raw = Array.isArray(session?.nodes) ? session.nodes : []
  const nodes = raw.filter((node) => node && typeof node === 'object')
  if (!nodes.length) return { nodes: [], edges: [], lanes: [], width: 0, height: 0 }

  const indexed = nodes.map((node, index) => ({ node, index }))
  const laneOrder = []
  for (const { node } of indexed) {
    const branchId = branchOf(node)
    if (!laneOrder.includes(branchId)) laneOrder.push(branchId)
  }
  laneOrder.sort((a, b) => (a === 'main' ? -1 : b === 'main' ? 1 : 0))

  /**
   * 分支本地拍号（OS-65 作者确认的弯度）：分支拍的引擎全局 round 会跳号
   * （分叉在第 8 拍，分支第一拍可能是第 12 拍），树横轴若按全局 round 排，
   * 分支节点会飘到主线右侧、读不出「从分叉点重新走」。
   * 这里给每条非主线分支算 forkRound（分叉点的拍号），分支第 n 拍的本地拍号
   * ＝ forkRound + n。主线用全局 round，两条泳道各自成立、分叉处自然对齐。
   */
  const forkRoundOf = (branchId) => {
    const forkNode = nodes.find((node) => Array.isArray(node?.forkBranchIds) && node.forkBranchIds.includes(branchId))
    return forkNode ? roundOf(forkNode) : null
  }
  const localBeatOf = new Map()
  for (const branchId of laneOrder) {
    if (branchId === 'main') continue
    const laneNodes = indexed.filter(({ node }) => branchOf(node) === branchId)
    const forkRound = forkRoundOf(branchId) ?? roundOf(laneNodes[0]?.node) ?? 1
    laneNodes.forEach(({ node }, index) => {
      localBeatOf.set(node.id, forkRound + 1 + index)
    })
  }
  const beatOf = (node, branchId) => branchId === 'main' ? roundOf(node) : (localBeatOf.get(text(node.id)) ?? roundOf(node))

  const rounds = nodes.map(roundOf)
  const minRound = Math.min(...rounds)
  const maxRound = Math.max(...rounds)

  const laid = []
  const lanes = []
  let top = padY
  for (const branchId of laneOrder) {
    const laneNodes = indexed
      .filter(({ node }) => branchOf(node) === branchId)
      .sort((a, b) => roundOf(a.node) - roundOf(b.node) || a.index - b.index)
    const stacks = new Map()
    let maxStack = 1
    const placed = laneNodes.map(({ node }) => {
      const beat = branchId === 'main' ? roundOf(node) : (localBeatOf.get(text(node.id)) ?? roundOf(node))
      const stack = stacks.get(beat) ?? 0
      stacks.set(beat, stack + 1)
      maxStack = Math.max(maxStack, stack + 1)
      return { node, beat, stack }
    })
    const height = lanePad * 2 + maxStack * rowGap
    for (const { node, beat, stack } of placed) {
      laid.push({
        id: text(node.id),
        round: roundOf(node),
        beat,
        branchId,
        lane: laneOrder.indexOf(branchId),
        x: padX + (beat - minRound) * colGap,
        y: top + lanePad + stack * rowGap + rowGap / 2,
        label: storyNodeLabel(node),
        beatLabel: branchId === 'main' ? `第${beat}拍` : `第${beat}拍·${branchId}`,
        current: false,
        node
      })
    }
    lanes.push({ branchId, index: lanes.length, top, height, count: laneNodes.length })
    top += height
  }

  // 当前节点＝当前分支 cursor 所在拍（同拍多个取最后一个）；没有就取该分支最后一拍
  const currentBranch = text(session?.branchId).trim() || 'main'
  const cursor = Number.isFinite(Number(session?.cursor)) ? Number(session.cursor) : 0
  const inBranch = laid.filter((item) => item.branchId === currentBranch)
  const atCursor = inBranch.filter((item) => item.round === cursor)
  const currentPool = atCursor.length ? atCursor : inBranch
  const current = currentPool[currentPool.length - 1]
  if (current) current.current = true

  const byId = new Map(laid.map((item) => [item.id, item]))
  const edges = []
  const hasParentEdge = new Set()
  for (const item of laid) {
    const parentId = text(item.node?.parentId)
    if (parentId && byId.has(parentId) && parentId !== item.id) {
      edges.push({ from: parentId, to: item.id, fork: false })
      hasParentEdge.add(item.id)
    }
  }
  // 分叉边：分叉节点 → 新分支第一拍（那拍没有父边才补，避免双线）
  for (const item of laid) {
    const forks = Array.isArray(item.node?.forkBranchIds) ? item.node.forkBranchIds : []
    for (const forkBranch of forks) {
      const target = laid.find((candidate) => candidate.branchId === text(forkBranch) && !hasParentEdge.has(candidate.id))
      if (target && target.id !== item.id) {
        edges.push({ from: item.id, to: target.id, fork: true })
        hasParentEdge.add(target.id)
      }
    }
  }

  return {
    nodes: laid,
    edges,
    lanes,
    width: padX * 2 + (maxRound - minRound) * colGap,
    height: top + padY
  }
}

function edgePath(from, to) {
  const bend = Math.max(36, Math.abs(to.x - from.x) / 2)
  return `M ${from.x} ${from.y} C ${from.x + bend} ${from.y}, ${to.x - bend} ${to.y}, ${to.x} ${to.y}`
}

function svgEl(name, attrs = {}) {
  const el = document.createElementNS(SVG_NS, name)
  for (const [key, value] of Object.entries(attrs)) el.setAttribute(key, String(value))
  return el
}

/**
 * 挂载剧情树：host 里画 SVG，返回清理函数（移除监听＋清空 host）。
 * 交互：点节点 → onPick(原始 node)；空白处按住拖动平移；滚轮以指针为中心缩放。
 * 空会话画空态提示，不报错。
 */
export function mountStoryTree({ host, session, onPick }) {
  if (!host) return () => {}
  const layout = layoutStoryTree(session)
  host.innerHTML = ''
  if (!layout.nodes.length) {
    const empty = document.createElement('div')
    empty.className = 'ded-tree-empty'
    empty.textContent = '还没有推演节点——先去「当前局面」推几拍，剧情树才有东西可画。'
    host.appendChild(empty)
    return () => { host.innerHTML = '' }
  }

  const viewW = Math.max(host.clientWidth || 800, 320)
  const viewH = Math.max(host.clientHeight || 480, 240)
  const svg = svgEl('svg', {
    class: 'ded-tree-svg',
    viewBox: `0 0 ${viewW} ${viewH}`,
    preserveAspectRatio: 'xMidYMid meet'
  })
  const world = svgEl('g')
  svg.appendChild(world)

  // 泳道底＋道名
  for (const lane of layout.lanes) {
    world.appendChild(svgEl('rect', {
      class: `ded-tree-lane${lane.index % 2 ? ' alt' : ''}`,
      x: 0, y: lane.top, width: layout.width, height: lane.height
    }))
    const label = svgEl('text', { class: 'ded-tree-lane-label', x: 12, y: lane.top + 18 })
    label.textContent = lane.branchId === 'main' ? '主线' : lane.branchId
    world.appendChild(label)
  }
  // 横轴刻度：每个拍号一条淡竖线＋顶部拍号
  const seenRounds = new Set()
  for (const item of layout.nodes) {
    if (seenRounds.has(item.round)) continue
    seenRounds.add(item.round)
    world.appendChild(svgEl('line', { class: 'ded-tree-grid', x1: item.x, y1: 34, x2: item.x, y2: layout.height - 16 }))
    const tick = svgEl('text', { class: 'ded-tree-tick', x: item.x, y: 24, 'text-anchor': 'middle' })
    tick.textContent = item.beatLabel
    world.appendChild(tick)
  }
  // 父→子连线（分叉边虚线）
  const posOf = new Map(layout.nodes.map((item) => [item.id, item]))
  for (const edge of layout.edges) {
    const from = posOf.get(edge.from)
    const to = posOf.get(edge.to)
    if (!from || !to) continue
    world.appendChild(svgEl('path', { class: `ded-tree-edge${edge.fork ? ' fork' : ''}`, d: edgePath(from, to) }))
  }
  // 节点：圆点＋拍号＋短标签；当前节点高亮
  const originalOf = new Map((Array.isArray(session?.nodes) ? session.nodes : []).map((node) => [text(node?.id), node]))
  for (const item of layout.nodes) {
    const group = svgEl('g', { class: `ded-tree-node${item.current ? ' current' : ''}`, 'data-node-id': item.id, tabindex: 0 })
    if (item.current) group.appendChild(svgEl('circle', { class: 'ring', cx: item.x, cy: item.y, r: 13 }))
    group.appendChild(svgEl('circle', { class: 'core', cx: item.x, cy: item.y, r: 7 }))
    const roundText = svgEl('text', { class: 'no', x: item.x, y: item.y - 16, 'text-anchor': 'middle' })
    roundText.textContent = item.beatLabel
    group.appendChild(roundText)
    const labelText = svgEl('text', { class: 'label', x: item.x, y: item.y + 26, 'text-anchor': 'middle' })
    labelText.textContent = item.label
    group.appendChild(labelText)
    const title = svgEl('title')
    title.textContent = `${item.branchId === 'main' ? '主线' : item.branchId} · ${item.beatLabel}（全局第${item.round}拍） · ${item.label}`
    group.appendChild(title)
    world.appendChild(group)
  }
  host.appendChild(svg)

  // 初始视野：整图缩放进 host（不放大超过 1）
  let scale = Math.min(viewW / layout.width, viewH / layout.height, 1) * 0.94
  let tx = (viewW - layout.width * scale) / 2
  let ty = (viewH - layout.height * scale) / 2
  const apply = () => world.setAttribute('transform', `translate(${tx} ${ty}) scale(${scale})`)
  apply()

  const toSvgPoint = (event) => {
    const point = svg.createSVGPoint()
    point.x = event.clientX
    point.y = event.clientY
    const ctm = svg.getScreenCTM()
    return ctm ? point.matrixTransform(ctm.inverse()) : { x: 0, y: 0 }
  }
  const onWheel = (event) => {
    event.preventDefault()
    const point = toSvgPoint(event)
    const next = Math.min(4, Math.max(0.25, scale * Math.exp(-event.deltaY * 0.0015)))
    tx = point.x - (point.x - tx) * (next / scale)
    ty = point.y - (point.y - ty) * (next / scale)
    scale = next
    apply()
  }
  let dragging = null
  const onPointerDown = (event) => {
    if (event.target.closest?.('[data-node-id]')) return
    const point = toSvgPoint(event)
    dragging = { x: point.x, y: point.y, tx, ty }
    svg.classList.add('dragging')
    svg.setPointerCapture?.(event.pointerId)
  }
  const onPointerMove = (event) => {
    if (!dragging) return
    const point = toSvgPoint(event)
    tx = dragging.tx + (point.x - dragging.x)
    ty = dragging.ty + (point.y - dragging.y)
    apply()
  }
  const onPointerUp = (event) => {
    dragging = null
    svg.classList.remove('dragging')
    svg.releasePointerCapture?.(event.pointerId)
  }
  const onClick = (event) => {
    const group = event.target.closest?.('[data-node-id]')
    if (!group) return
    const original = originalOf.get(group.getAttribute('data-node-id'))
    if (original) onPick?.(original)
  }
  const onKeydown = (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return
    const group = event.target.closest?.('[data-node-id]')
    if (!group) return
    event.preventDefault()
    const original = originalOf.get(group.getAttribute('data-node-id'))
    if (original) onPick?.(original)
  }
  svg.addEventListener('wheel', onWheel, { passive: false })
  svg.addEventListener('pointerdown', onPointerDown)
  svg.addEventListener('pointermove', onPointerMove)
  svg.addEventListener('pointerup', onPointerUp)
  svg.addEventListener('pointercancel', onPointerUp)
  svg.addEventListener('click', onClick)
  svg.addEventListener('keydown', onKeydown)

  return () => {
    svg.removeEventListener('wheel', onWheel)
    svg.removeEventListener('pointerdown', onPointerDown)
    svg.removeEventListener('pointermove', onPointerMove)
    svg.removeEventListener('pointerup', onPointerUp)
    svg.removeEventListener('pointercancel', onPointerUp)
    svg.removeEventListener('click', onClick)
    svg.removeEventListener('keydown', onKeydown)
    host.innerHTML = ''
  }
}