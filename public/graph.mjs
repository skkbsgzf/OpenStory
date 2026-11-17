/**
 * 轻量力导向图（OS-44）——零依赖 canvas，给参考图谱用。
 *
 * 为什么自研而不引 d3/pixi：本仓零 npm 依赖（VENDORED 口径），参考图谱规模在
 * 几百节点以内，canvas 2D + 一个 O(n²) 斥力 + 边弹簧就够用，没必要引入 200KB 库。
 *
 * OS-49 对齐作者 Wiki 设计（D:\Qbook\短篇选题库\wiki\*\index.html 的 forceLayout）：
 *   · 初始位置按 kind 分环（参考内环 → 产物中环 → 标签/条目外环）
 *   · 斥力按度数缩放：枢纽（关联多的节点）留在中心
 *   · 边弹簧按来源分刚度：双链边短而紧，标签边长而松
 *   · 标签避让：径向朝外候选位 + 度数高者优先占位（照 Wiki 的 labelPos 算法）
 *   · 聚焦模式（mode:'focus'）：点节点看邻域，再点进详情，点空白复位——由调用方
 *     过滤子图后重挂，本模块只负责把 focusId 节点画上深色描边
 *   · hover halo 光圈（0.10 → 0.26），密集时标签默认只显圆点
 */

const KIND_COLOR = {
  reference: '#ff385c',
  tag: '#c48a00',
  artifact: '#008a05',
  entry: '#9a9a9a'
}

/** 初始环半径比例（相对画布短边）：越「核心」的 kind 越靠内。 */
const KIND_RING = {
  reference: 0.34,
  artifact: 0.62,
  tag: 0.92,
  entry: 0.92
}

/** 边弹簧参数按来源分：link=双链（结构边），tag=标签共现，mention=提及。 */
const EDGE_SPRING = {
  link: { rest: 84, stiffness: 0.05 },
  mention: { rest: 110, stiffness: 0.028 },
  tag: { rest: 132, stiffness: 0.012 }
}

const LABEL_FONT = '10.5px system-ui, sans-serif'
const LABEL_FONT_WIDE = '600 11px system-ui, sans-serif'

function radiusOf(node) {
  if (node.kind === 'tag') return 5
  if (node.kind === 'artifact') return 6
  if (node.kind === 'entry') return 5
  // 参考节点：字数越多越大（6~13）
  const chars = Number(node.chars) || 0
  return Math.max(6, Math.min(13, 6 + chars / 400))
}

/**
 * 挂载/重绘图谱。幂等：同一 canvas 上重复调用会重置。
 * @param {object} opts
 * @param {'jump'|'focus'} opts.mode jump=点节点直接 onPick（正文页左栏小图）；focus=调用方管聚焦（参考页大图）
 * @param {string|null} opts.focusId 聚焦节点 id（focus 模式下画深色描边环）
 * @param {(node) => void} opts.onPick 点节点（位移 <4px）
 * @param {() => void} opts.onBlank 点空白（focus 模式复位用）
 * @returns {() => void} 清理函数（卸载动画与监听）
 */
export function mountGraph({ canvas, graph, onPick, onBlank, mode = 'jump', focusId = null }) {
  if (!canvas || !graph) return () => {}
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}

  const rawNodes = graph.nodes || []
  const rawEdges = graph.edges || []

  // 度数表：决定斥力缩放与标签优先级（枢纽留中心、标签先占位）
  const degree = new Map()
  for (const edge of rawEdges) {
    degree.set(edge.a, (degree.get(edge.a) || 0) + 1)
    degree.set(edge.b, (degree.get(edge.b) || 0) + 1)
  }

  // 节点初始化：按 kind 分环铺开（比单一圆环好看，也符合「枢纽在内、外围装饰」的阅读顺序）
  const byKind = new Map()
  for (const node of rawNodes) {
    const kind = node.kind || 'reference'
    if (!byKind.has(kind)) byKind.set(kind, [])
    byKind.get(kind).push(node)
  }
  // 初始化半径：优先按实际容器尺寸；拿不到（卡片尚未布局完）就用默认 190 兜底，
  // 之后 resize() 会按真实尺寸等比重排，不会永久塌在角落。
  const initW = canvas.clientWidth || 240
  const initH = canvas.clientHeight || 190
  const spread = Math.min(initW, initH) * 0.46
  const nodes = []
  for (const [kind, list] of byKind) {
    const ring = (KIND_RING[kind] ?? 0.8) * spread
    list.forEach((node, index) => {
      const angle = (index / list.length) * Math.PI * 2 + (kind === 'artifact' ? 0.35 : kind === 'tag' ? 0.7 : 0)
      nodes.push({
        ...node,
        r: radiusOf(node),
        deg: degree.get(node.id) || 0,
        x: Math.cos(angle) * ring,
        y: Math.sin(angle) * ring * 0.82,
        vx: 0,
        vy: 0
      })
    })
  }
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges = rawEdges
    .map((edge) => ({
      ...edge,
      from: byId.get(edge.a),
      to: byId.get(edge.b),
      spring: EDGE_SPRING[(edge.sources && edge.sources[0]) || 'tag'] || EDGE_SPRING.tag
    }))
    .filter((edge) => edge.from && edge.to)

  // 标签避让：度数高者优先占位；候选位优先「径向朝外」（照 Wiki labelPos）
  const labelWidthCache = new Map()
  function labelWidth(node, label) {
    if (!labelWidthCache.has(label)) {
      ctx.font = node.kind === 'reference' ? LABEL_FONT_WIDE : LABEL_FONT
      labelWidthCache.set(label, ctx.measureText(label).width)
    }
    return labelWidthCache.get(label)
  }
  function layoutLabels() {
    const order = [...nodes].sort((left, right) => right.deg - left.deg)
    const placed = []
    // 标签不能溢出画布（作者指出：贴边节点的标签被裁掉）。候选位先算包围盒，
    // 出界的直接判不合格；全都不合格时退化为「钳制到框内」，宁可挤也不截断。
    const PAD_X = 2
    const PAD_Y = 2
    const inBounds = (box) => box.x1 >= PAD_X && box.x2 <= width - PAD_X && box.y1 >= PAD_Y && box.y2 <= height - PAD_Y
    for (const node of order) {
      // 窄画布里长标题会横贯整张图并互相压住：按可用宽度动态截断（最少 6 字）
      const raw = String(node.label || node.id)
      const maxW = width - 8
      ctx.font = node.kind === 'reference' ? LABEL_FONT_WIDE : LABEL_FONT
      let label = raw.slice(0, 24)
      if (ctx.measureText(label).width > maxW) {
        let cut = label
        while (cut.length > 4 && ctx.measureText(`${cut}…`).width > maxW) cut = cut.slice(0, -1)
        label = `${cut}…`
      }
      const estW = labelWidth(node, label)
      const vx = node.x - width / 2
      const vy = node.y - height / 2
      const vlen = Math.sqrt(vx * vx + vy * vy) || 1
      const off = node.r + 9
      const rdx = (vx / vlen) * off
      const rdy = (vy / vlen) * off + 4
      const radialAnchor = Math.abs(vx) < vlen * 0.35 ? 'center' : (vx > 0 ? 'left' : 'right')
      const candidates = [
        { dx: rdx, dy: rdy, anchor: radialAnchor },
        { dx: 0, dy: -(node.r + 8), anchor: 'center' },
        { dx: 0, dy: node.r + 15, anchor: 'center' },
        { dx: node.r + 8, dy: 4, anchor: 'left' },
        { dx: -(node.r + 8), dy: 4, anchor: 'right' }
      ]
      let best = null
      let fallback = null
      for (let c = 0; c < candidates.length; c += 1) {
        const cand = candidates[c]
        const cx = node.x + cand.dx
        const cy = node.y + cand.dy
        const x1 = cand.anchor === 'center' ? cx - estW / 2 : cand.anchor === 'left' ? cx : cx - estW
        const box = { x1, x2: x1 + estW, y1: cy - 9, y2: cy + 3 }
        if (!inBounds(box)) {
          if (!fallback) {
            // 记录第一个出界的候选，作为兜底（钳制后使用）
            const clampedX1 = Math.max(PAD_X, Math.min(width - PAD_X - estW, box.x1))
            const clampedY1 = Math.max(PAD_Y, Math.min(height - PAD_Y - 12, box.y1))
            fallback = {
              dx: clampedX1 - node.x,
              dy: (clampedY1 + 9) - node.y,
              anchor: 'left',
              box: { x1: clampedX1, x2: clampedX1 + estW, y1: clampedY1, y2: clampedY1 + 12 }
            }
          }
          continue
        }
        const hit = placed.some((p) => !(box.x2 < p.x1 || box.x1 > p.x2 || box.y2 < p.y1 || box.y1 > p.y2))
        if (!hit) { best = { ...cand, box }; placed.push(box); break }
      }
      if (!best) {
        best = fallback || { ...candidates[0], box: { x1: PAD_X, x2: PAD_X + estW, y1: PAD_Y, y2: PAD_Y + 12 } }
        placed.push(best.box)
      }
      node._label = label
      node._labelPos = best
    }
  }

  let width = 0
  let height = 0
  let dpr = 1
  let raf = 0
  let alpha = 1
  let hover = null
  let dragNode = null

  /**
   * 画布尺寸变化时把节点坐标**等比重排**回新画布。
   * 节点坐标是以画布中心为原点的（x ± ring），所以尺寸一变就必须重算：
   *   · 挂载瞬间卡片尚未布局完，clientWidth/Height 可能拿到 0 或很小的值，
   *     节点会按小半径铺开、卡片撑开后也不重排 → 永久塌在左上角（作者截图）。
   *   · 窗口缩放/展开卡片同理。
   * 做法：记住上一帧的归一化坐标（按旧短边的一半归一），换尺寸时按新短边重投影，
   * 既不掉形变也不会把图挤到角落。
   */
  function reproject(prevW, prevH) {
    if (!prevW || !prevH) return
    const prevHalf = Math.min(prevW, prevH) / 2
    const nextHalf = Math.min(width, height) / 2
    if (!prevHalf || !nextHalf || (prevW === width && prevH === height)) return
    const k = nextHalf / prevHalf
    for (const node of nodes) {
      node.x *= k
      node.y *= k
      node.vx *= k
      node.vy *= k
    }
  }

  function resize() {
    const prevW = width
    const prevH = height
    dpr = Math.min(2, window.devicePixelRatio || 1)
    // 拿不到尺寸时保留上次的，不要退化成 0（会让节点集中到原点）
    width = canvas.clientWidth || prevW || 240
    height = canvas.clientHeight || prevH || 190
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    reproject(prevW, prevH)
    draw()
  }

  /** 一步物理迭代（斥力＋弹簧＋向心＋积分），与绘制解耦——供预热循环与动画帧共用。 */
  function physicsStep() {
    const cx = width / 2
    const cy = height / 2
    const cooling = 0.9 + (1 - alpha) * 0.1
    // 斥力：度数越高斥力越弱（枢纽留在中心）——照 Wiki forceLayout 的度数缩放
    const repulseBase = (nodes.length > 150 ? 2400 : 1700) * cooling * (Math.min(width, height) / 480 + 0.55)
    for (let i = 0; i < nodes.length; i += 1) {
      const a = nodes[i]
      for (let j = i + 1; j < nodes.length; j += 1) {
        const b = nodes[j]
        let dx = a.x - b.x
        let dy = a.y - b.y
        let dist2 = dx * dx + dy * dy
        if (dist2 < 1) {
          // 重合时给个确定的偏移，避免除零
          dx = (i % 2 ? 1 : -1) * 0.5
          dy = (j % 2 ? 1 : -1) * 0.5
          dist2 = 0.5
        }
        const dist = Math.sqrt(dist2)
        const da = 1 + a.deg * 0.35
        const db = 1 + b.deg * 0.35
        const force = repulseBase / (dist2 * Math.max(1, Math.min(da, db) * 0.55))
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }
    // 引力（边弹簧）：来源决定 rest/stiffness——双链边短而紧，标签边长而松
    for (const edge of edges) {
      const dx = edge.to.x - edge.from.x
      const dy = edge.to.y - edge.from.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const force = (dist - edge.spring.rest) * edge.spring.stiffness
      const fx = (dx / dist) * force
      const fy = (dy / dist) * force
      edge.from.vx += fx
      edge.from.vy += fy
      edge.to.vx -= fx
      edge.to.vy -= fy
    }
    // 向心 + 积分 + 阻尼
    for (const node of nodes) {
      if (node === dragNode) continue
      node.vx += (cx - node.x) * 0.006
      node.vy += (cy - node.y) * 0.006
      node.vx *= 0.85
      node.vy *= 0.85
      node.x += node.vx
      node.y += node.vy
      // 夹在画布内（留半径余量）
      const pad = node.r + 4
      node.x = Math.max(pad, Math.min(width - pad, node.x))
      node.y = Math.max(pad, Math.min(height - pad, node.y))
    }
    alpha *= 0.985
  }

  function tick() {
    physicsStep()
    draw()
    if (alpha > 0.02) {
      raf = requestAnimationFrame(tick)
    } else {
      raf = 0
    }
  }

  /**
   * 标签可见性分级（作者指出小图里标签互相压住、看不清）。
   * 判据是**空间密度**而不是绝对节点数：小画布（左栏 204px）装 30 个节点已经过挤。
   *   · 密度低（每人有 ≥ 1400px²）→ 全显
   *   · 密度中 → 只显参考/产物节点，标签只显 hover/聚焦的
   *   · 密度高 → 只显度数最高的若干参考节点 + hover/聚焦
   * 这样小图始终「结构可读」，细节靠 hover。
   */
  const area = Math.max(1, width * height)
  const density = area / Math.max(1, nodes.length)
  const labelTier = density >= 1400 ? 'all' : density >= 800 ? 'refs' : 'hubs'
  const hubCutoff = (() => {
    if (labelTier !== 'hubs') return 0
    const degs = nodes.map((node) => node.deg).sort((a, b) => b - a)
    return degs[Math.min(degs.length - 1, Math.max(2, Math.round(degs.length * 0.35)))] || 0
  })()
  function labelVisible(node) {
    if (hover?.id === node.id || focusId === node.id) return true
    if (labelTier === 'all') return true
    if (labelTier === 'refs') return node.kind !== 'tag'
    // hubs：只留度数高的参考/产物节点
    return node.kind !== 'tag' && node.deg >= hubCutoff
  }

  function draw() {
    ctx.clearRect(0, 0, width, height)
    // 边：来源定宽（双链粗），hover/聚焦邻域高亮
    const focusRing = hover?.id || dragNode?.id || focusId || null
    for (const edge of edges) {
      const active = focusRing && (edge.from.id === focusRing || edge.to.id === focusRing)
      const isLink = (edge.sources || []).includes('link')
      ctx.strokeStyle = active ? 'rgba(255,56,92,0.55)' : isLink ? 'rgba(150,150,150,0.34)' : 'rgba(150,150,150,0.22)'
      ctx.lineWidth = Math.min(2.4, 0.8 + Math.min(2.2, (Number(edge.weight) || 1) * 0.28))
      ctx.beginPath()
      ctx.moveTo(edge.from.x, edge.from.y)
      ctx.lineTo(edge.to.x, edge.to.y)
      ctx.stroke()
    }
    // 节点：halo 光圈 + 本体 + 白描边 + 聚焦深环（照 Wiki 的径向渐变观感，canvas 用两层圆近似）
    for (const node of nodes) {
      const color = KIND_COLOR[node.kind] || '#888'
      const isHover = hover?.id === node.id
      const isFocusNode = focusId === node.id
      // halo
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.r + 5, 0, Math.PI * 2)
      ctx.fillStyle = color
      ctx.globalAlpha = isHover ? 0.26 : 0.1
      ctx.fill()
      ctx.globalAlpha = 1
      // 本体
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.r + (isHover ? 1.8 : 0), 0, Math.PI * 2)
      ctx.fillStyle = node.kind === 'entry' ? 'rgba(154,154,154,0.55)' : color
      ctx.fill()
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 1.6
      ctx.stroke()
      if (isHover || isFocusNode) {
        ctx.strokeStyle = isFocusNode ? '#222' : color
        ctx.lineWidth = isFocusNode ? 2.4 : 2
        ctx.beginPath()
        ctx.arc(node.x, node.y, node.r + 3.2, 0, Math.PI * 2)
        ctx.stroke()
      }
    }
    // 标签（避让后统一画，白描边保证压线上可读）
    layoutLabels()
    ctx.lineJoin = 'round'
    for (const node of nodes) {
      if (!labelVisible(node)) continue
      const pos = node._labelPos
      if (!pos) continue
      const lx = node.x + pos.dx
      const ly = node.y + pos.dy
      ctx.font = node.kind === 'reference' ? LABEL_FONT_WIDE : LABEL_FONT
      ctx.textAlign = pos.anchor === 'center' ? 'center' : pos.anchor === 'left' ? 'left' : 'right'
      ctx.textBaseline = 'middle'
      ctx.strokeStyle = 'rgba(255,255,255,0.9)'
      ctx.lineWidth = 3
      ctx.strokeText(node._label, lx, ly)
      ctx.fillStyle = node.kind === 'tag' ? '#a06a00' : '#3d3a36'
      ctx.fillText(node._label, lx, ly)
    }
    ctx.textAlign = 'left'
    // hover 摘要胶囊（有 excerpt 时显示第二行信息）
    if (hover) {
      const excerpt = String(hover.excerpt || '').trim()
      if (excerpt) {
        const label = excerpt.slice(0, 30)
        ctx.font = '10.5px system-ui, sans-serif'
        const pad = 5
        const w = ctx.measureText(label).width + pad * 2
        const bx = Math.min(width - w - 2, Math.max(2, hover.x - w / 2))
        const by = Math.min(height - 22, Math.max(16, hover.y + hover.r + 14))
        ctx.globalAlpha = 0.94
        ctx.fillStyle = 'rgba(34,34,34,0.82)'
        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by - 12, w, 17, 4)
        else ctx.rect(bx, by - 12, w, 17)
        ctx.fill()
        ctx.globalAlpha = 1
        ctx.fillStyle = '#fff'
        ctx.textAlign = 'left'
        ctx.fillText(label, bx + pad, by - 3)
      }
    }
  }

  function pick(event) {
    const rect = canvas.getBoundingClientRect()
    const x = event.clientX - rect.left
    const y = event.clientY - rect.top
    let best = null
    let bestDist = Infinity
    for (const node of nodes) {
      const dist = Math.hypot(node.x - x, node.y - y)
      if (dist <= node.r + 4 && dist < bestDist) {
        best = node
        bestDist = dist
      }
    }
    return best
  }

  const onMove = (event) => {
    if (dragNode) {
      const rect = canvas.getBoundingClientRect()
      dragNode.x = event.clientX - rect.left
      dragNode.y = event.clientY - rect.top
      dragNode.vx = 0
      dragNode.vy = 0
      draw()
      return
    }
    const next = pick(event)
    if (next?.id !== hover?.id) {
      hover = next
      canvas.style.cursor = next ? 'pointer' : 'grab'
      draw()
    }
  }
  const onDown = (event) => {
    const node = pick(event)
    if (!node) {
      // 空白处：干净点击（位移 <4px）→ onBlank（focus 模式复位全景）
      const startX = event.clientX
      const startY = event.clientY
      const onUpBlank = (upEvent) => {
        canvas.removeEventListener('pointerup', onUpBlank)
        if (Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY) < 4 && typeof onBlank === 'function') onBlank()
      }
      canvas.addEventListener('pointerup', onUpBlank)
      return
    }
    dragNode = node
    canvas.classList.add('dragging')
    // 拖完若几乎没动，算一次点击
    const startX = event.clientX
    const startY = event.clientY
    const startNode = node
    const onUp = (upEvent) => {
      canvas.removeEventListener('pointerup', onUp)
      canvas.classList.remove('dragging')
      dragNode = null
      const moved = Math.hypot(upEvent.clientX - startX, upEvent.clientY - startY)
      if (moved < 4 && typeof onPick === 'function') onPick(startNode)
      else { alpha = Math.max(alpha, 0.35); if (!raf) raf = requestAnimationFrame(tick) }
    }
    canvas.addEventListener('pointerup', onUp)
  }

  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerdown', onDown)
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(() => resize()) : null
  observer?.observe(canvas)

  resize()
  /**
   * 预热（OS-52，作者指出「每次进去节点大量晃动」）：首帧前同步把力迭代跑到位——
   * 照作者 Wiki forceLayout 的同步迭代口径，挂载即收敛布局，不做入场动画。
   * 迭代上限按节点数调（O(n²)），120 节点 ~30ms 量级，感知不到；
   * 收敛后 alpha 归零不再跑 rAF，拖拽/聚焦时才唤醒（alpha>=0.35）。
   */
  const prewarmIters = Math.min(800, Math.max(200, nodes.length * 10))
  for (let it = 0; it < prewarmIters && alpha > 0.02; it += 1) physicsStep()
  // 预热就是「跑到位」：无条件停动画（alpha=0），拖拽/聚焦时再唤醒（alpha>=0.35）。
  // 上限不足时也硬停——入场绝不晃，剩余收敛交给下一次交互。
  alpha = 0
  draw()

  return () => {
    if (raf) cancelAnimationFrame(raf)
    observer?.disconnect()
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerdown', onDown)
  }
}

/** 节点配色（供图例复用）。 */
export { KIND_COLOR }
