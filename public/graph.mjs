/**
 * 轻量力导向图（OS-44）——零依赖 canvas，给参考图谱用。
 *
 * 为什么自研而不引 d3/pixi：本仓零 npm 依赖（VENDORED 口径），参考图谱规模在
 * 几百节点以内，canvas 2D + 一个 O(n²) 斥力 + 边弹簧就够用，没必要引入 200KB 库。
 *
 * 力模型（照 d3-force 的直觉，参数手调）：
 *   · 斥力：节点两两相斥，随距离平方衰减
 *   · 引力：有边的节点互相靠拢
 *   · 向心：整体往画布中心收，防飘散
 *   · 阻尼：每步 0.85，收敛后自动停（避免吃满 CPU）
 */

const KIND_COLOR = {
  reference: '#ff385c',
  tag: '#c48a00',
  artifact: '#008a05',
  entry: '#9a9a9a'
}

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
 * @returns {() => void} 清理函数（卸载动画与监听）
 */
export function mountGraph({ canvas, graph, onPick }) {
  if (!canvas || !graph) return () => {}
  const ctx = canvas.getContext('2d')
  if (!ctx) return () => {}

  // 节点初始化：圆环铺开（比随机好看，收敛也快）
  const nodes = (graph.nodes || []).map((node, index, all) => {
    const angle = (index / Math.max(1, all.length)) * Math.PI * 2
    const spread = Math.min(canvas.clientWidth, canvas.clientHeight) * 0.32
    return {
      ...node,
      r: radiusOf(node),
      x: Math.cos(angle) * spread,
      y: Math.sin(angle) * spread,
      vx: 0,
      vy: 0
    }
  })
  const byId = new Map(nodes.map((node) => [node.id, node]))
  const edges = (graph.edges || [])
    .map((edge) => ({ ...edge, from: byId.get(edge.a), to: byId.get(edge.b) }))
    .filter((edge) => edge.from && edge.to)

  let width = 0
  let height = 0
  let dpr = 1
  let raf = 0
  let alpha = 1
  let hover = null
  let dragNode = null

  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1)
    width = canvas.clientWidth || 240
    height = canvas.clientHeight || 190
    canvas.width = Math.round(width * dpr)
    canvas.height = Math.round(height * dpr)
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
    draw()
  }

  function tick() {
    const cx = width / 2
    const cy = height / 2
    // 斥力
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
        const force = 900 / dist2
        const fx = (dx / dist) * force
        const fy = (dy / dist) * force
        a.vx += fx
        a.vy += fy
        b.vx -= fx
        b.vy -= fy
      }
    }
    // 引力（边弹簧）
    for (const edge of edges) {
      const dx = edge.to.x - edge.from.x
      const dy = edge.to.y - edge.from.y
      const dist = Math.max(1, Math.sqrt(dx * dx + dy * dy))
      const stiffness = 0.015 + Math.min(0.02, (Number(edge.weight) || 1) / 200)
      const force = (dist - 60) * stiffness
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
    draw()
    if (alpha > 0.02) {
      raf = requestAnimationFrame(tick)
    } else {
      raf = 0
    }
  }

  function draw() {
    ctx.clearRect(0, 0, width, height)
    // 边
    const focusId = hover?.id || dragNode?.id || null
    for (const edge of edges) {
      const active = focusId && (edge.from.id === focusId || edge.to.id === focusId)
      ctx.strokeStyle = active ? 'rgba(255,56,92,0.55)' : 'rgba(150,150,150,0.28)'
      ctx.lineWidth = Math.min(2.2, 0.7 + (Number(edge.weight) || 1) * 0.22)
      ctx.beginPath()
      ctx.moveTo(edge.from.x, edge.from.y)
      ctx.lineTo(edge.to.x, edge.to.y)
      ctx.stroke()
    }
    // 节点
    for (const node of nodes) {
      const color = KIND_COLOR[node.kind] || '#888'
      const isFocus = focusId === node.id
      ctx.beginPath()
      ctx.arc(node.x, node.y, node.r + (isFocus ? 2 : 0), 0, Math.PI * 2)
      ctx.fillStyle = node.kind === 'entry' ? 'rgba(154,154,154,0.55)' : color
      ctx.globalAlpha = node.kind === 'entry' ? 0.8 : 1
      ctx.fill()
      ctx.globalAlpha = 1
      if (isFocus) {
        ctx.strokeStyle = color
        ctx.lineWidth = 2
        ctx.stroke()
      }
    }
    // 焦点节点的名字
    if (hover) {
      ctx.font = '11px system-ui, sans-serif'
      ctx.fillStyle = 'rgba(0,0,0,0.72)'
      const label = String(hover.label || hover.id).slice(0, 22)
      const pad = 4
      const w = ctx.measureText(label).width + pad * 2
      const bx = Math.min(width - w - 2, Math.max(2, hover.x - w / 2))
      const by = Math.max(14, hover.y - hover.r - 10)
      ctx.globalAlpha = 0.92
      ctx.fillRect(bx, by - 12, w, 15)
      ctx.globalAlpha = 1
      ctx.fillStyle = '#fff'
      ctx.fillText(label, bx + pad, by - 1)
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
    if (!node) return
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
  raf = requestAnimationFrame(tick)

  return () => {
    if (raf) cancelAnimationFrame(raf)
    observer?.disconnect()
    canvas.removeEventListener('pointermove', onMove)
    canvas.removeEventListener('pointerdown', onDown)
  }
}

/** 节点配色（供图例复用）。 */
export { KIND_COLOR }
