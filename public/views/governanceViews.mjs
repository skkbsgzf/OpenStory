/**
 * OS-201：插件治理台视图（零 import，纯字符串渲染＋自己的事件委托）。
 *
 * 作者口径：投影给什么就画什么——能力、依赖、谁依赖我、设置指路、停用影响都来自
 * `/api/plugins` 的 modules[]/slots，不在这里另存一份插件名单，也不写死任何模块名。
 *
 * 三件对外：
 *   · governanceModel(payload, uiState, deps?) → 三组固定顺序（内核件→工作台→宿主组合面）的卡片模型；
 *   · pluginCardHtml(card, options) / confirmStripHtml(card) → 纯 HTML（Node 测试可直接断言）；
 *   · createGovernanceViews(scope) → 整页 governanceHtml ＋ gov-* 委托监听（app.js 只接线）。
 *
 * 约束：零 import；不构造动态代码；不碰任何浏览器存储；颜色字号间距只走令牌类。
 */

const SURFACE_ORDER = Object.freeze(['tab', 'right', 'settings', 'host-actions'])
const SURFACE_LABEL = Object.freeze({ tab: '页签', right: '右栏', settings: '设置区', 'host-actions': '顶栏动作' })
const GROUP_META = Object.freeze([
  Object.freeze({ id: 'kernel', label: '内核件', desc: '能力供给层——无界面，不可停' }),
  Object.freeze({ id: 'workbench', label: '工作台', desc: '可启停的工作面插件，停用只收工作面、数据保留' }),
  Object.freeze({ id: 'host', label: '宿主组合面', desc: '宿主域实现，随宿主走，不随工作台启停' })
])
const REASON_LABEL = Object.freeze({
  CAPABILITY_NOT_REGISTERED: '没有供给方',
  CAPABILITY_VERSION_MISMATCH: '版本不匹配',
  CAPABILITY_CONFLICT: '供给冲突'
})

const text = (value) => String(value ?? '')
function isObj(value) { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
function asArray(value) { return Array.isArray(value) ? value : [] }
/** OS-201a：治理台只收 21 件模块——认 class 的 kernel/workbench 或 role 的 host-composition；货架（suite）出局。 */
export function isGovernanceModule(module) {
  if (!isObj(module)) return false
  const klass = text(module.class)
  const role = text(module.role)
  return klass === 'kernel' || klass === 'workbench' || role === 'host-composition'
}
function escText(value) {
  return text(value).replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
}

/**
 * OS-203：降级说明的统一文案（纯函数、零 import，所有降级位置都调它）。
 * 口径：缺少所需能力：<能力>@<最低版本>（供给方：<名称>）——该工作面暂不可用；
 * 没人供给写「目前没有插件供给」；多项用分号连。
 */
export function missingText(missing, requires = []) {
  const reqById = new Map(asArray(requires).filter(isObj).map((req) => [text(req.id), req]))
  const parts = asArray(missing).map((item) => {
    const cap = isObj(item) ? text(item.capability ?? item.id) : text(item)
    const req = reqById.get(cap)
    const min = isObj(item) && item.min !== undefined && item.min !== null && item.min !== ''
      ? text(item.min) : (req && req.min !== undefined && req.min !== null ? text(req.min) : '')
    const provider = req && req.provider && req.provider !== 'base'
      ? (text(req.providerName) || text(req.provider)) : ''
    return `${cap}${min ? `@${min}` : ''}（${provider ? `供给方：${provider}` : '目前没有插件供给'}）`
  }).filter(Boolean)
  return parts.length ? `缺少所需能力：${parts.join('；')}——该工作面暂不可用` : ''
}

/** OS-203：直接进到降级工作面时的整页说明（纯函数，app.js 经注入使用）。 */
export function degradedViewHtml(card = {}) {
  const source = isObj(card) ? card : {}
  const name = escText(text(source.name || source.id || '这个工作面'))
  const why = escText(text(source.text || missingText(source.missing, source.requires)))
  return `<div class="gov-degraded-view">
    <h2>${name} · 暂不可用</h2>
    <p class="gov-degraded-why">${why}</p>
    <p class="gov-degraded-fix">到「设置 · 插件治理台」恢复供给或重新启用相关模块后即可使用。</p>
    <button type="button" class="uikit-btn uikit-btn-ghost" data-settings-section="governance">去插件治理台 →</button>
  </div>`
}

function groupOf(module) {
  const role = text(module.role || module.class)
  if (role === 'kernel') return 'kernel'
  if (role === 'host-composition') return 'host'
  return 'workbench'
}

/* ── OS-202 能力图：布局尺寸是视图常量，坐标一律由投影数据算出来 ──────────
   字号/颜色/间距全部走令牌类；SVG 属性里的颜色只写 var(--*)。 */
const GRAPH_COLS = 6
const GRAPH_NODE_W = 140
const GRAPH_NODE_H = 34
const GRAPH_GAP_X = 20
const GRAPH_GAP_Y = 28
const GRAPH_SEG_GAP = 18
const GRAPH_PAD = 24
const GRAPH_NOTE_H = 40
const num = (value) => Number.isFinite(value) ? Math.round(value * 100) / 100 : 0

function graphStatus(module) {
  const status = text(module.status)
  return status === 'disabled' || status === 'degraded' ? status : 'loaded'
}

function graphStatusLabel(status) {
  if (status === 'disabled') return '已停用'
  if (status === 'degraded') return '降级'
  return '正常'
}

/** 线段从源节点框边出发、止于目标节点框边，箭头落在供给方一端。 */
function trimToRect(center, toward, node) {
  const nx = node.x + node.w / 2
  const ny = node.y + node.h / 2
  const vx = toward.x - nx
  const vy = toward.y - ny
  const len = Math.hypot(vx, vy)
  if (!Number.isFinite(len) || len === 0) return { x: nx, y: ny }
  const ux = vx / len
  const uy = vy / len
  const tx = ux === 0 ? Infinity : (node.w / 2) / Math.abs(ux)
  const ty = uy === 0 ? Infinity : (node.h / 2) / Math.abs(uy)
  const t = Math.min(tx, ty)
  return { x: nx + ux * t, y: ny + uy * t }
}

/**
 * OS-202：能力图纯函数（零 import、同输入逐字相同）。
 *
 * 节点＝投影里的全部模块（内置 21 件＋本机模块；货架不进图），按 id 稳定排序后
 * 自上而下分三段：工作台（每行至多 6 个）、宿主组合面（靠右竖排）、内核件（换行）；
 * 边＝graph.edges（from 依赖方 → to 供给方），指向底座的边折进底部说明条不画。
 *
 * @param {object} graph   /api/plugins 的 moduleGraph（{spec,snapshot,edges,base}）
 * @param {Array}  modules /api/plugins 的 modules[]
 * @param {object} options { selected } 当前选中的模块 id
 * @returns {string} 内联 SVG；graph 缺失／无节点时返回空串（不留空框）
 */
export function capabilityGraphSvg(graph, modules, options = {}) {
  const source = isObj(graph) ? graph : null
  const catalog = asArray(modules).filter(isObj).filter(isGovernanceModule)
  if (!source || !Array.isArray(source.edges) || !catalog.length) return ''
  const opts = isObj(options) ? options : {}
  const selected = text(opts.selected)

  const byId = new Map()
  for (const module of catalog) {
    const id = text(module.id)
    if (!id || byId.has(id)) continue
    byId.set(id, {
      id,
      name: text(module.name || id),
      version: text(module.version),
      group: groupOf(module),
      status: graphStatus(module),
      builtin: module.builtin !== false
    })
  }
  const nodes = [...byId.values()].sort((left, right) => left.id.localeCompare(right.id))
  const width = GRAPH_PAD * 2 + GRAPH_COLS * GRAPH_NODE_W + (GRAPH_COLS - 1) * GRAPH_GAP_X
  const placed = []
  let cursor = GRAPH_PAD
  const laySegment = (items, rightAligned, onePerRow) => {
    const rows = onePerRow ? items.map((item) => [item]) : []
    if (!onePerRow) {
      for (let index = 0; index < items.length; index += GRAPH_COLS) {
        rows.push(items.slice(index, index + GRAPH_COLS))
      }
    }
    for (let row = 0; row < rows.length; row += 1) {
      for (let col = 0; col < rows[row].length; col += 1) {
        placed.push({
          ...rows[row][col],
          x: rightAligned ? width - GRAPH_PAD - GRAPH_NODE_W : GRAPH_PAD + col * (GRAPH_NODE_W + GRAPH_GAP_X),
          y: cursor + row * (GRAPH_NODE_H + GRAPH_GAP_Y),
          w: GRAPH_NODE_W,
          h: GRAPH_NODE_H
        })
      }
    }
    if (rows.length) cursor += rows.length * (GRAPH_NODE_H + GRAPH_GAP_Y) + GRAPH_SEG_GAP
  }
  laySegment(nodes.filter((node) => node.group === 'workbench'), false, false)
  laySegment(nodes.filter((node) => node.group === 'host'), true, true)
  laySegment(nodes.filter((node) => node.group === 'kernel'), false, false)
  const posById = new Map(placed.map((node) => [node.id, node]))

  const edges = asArray(source.edges).filter(isObj).map((edge) => ({
    from: text(edge.from),
    to: text(edge.to),
    capability: text(edge.capability),
    optional: edge.optional === true
  })).filter((edge) => edge.to !== 'base' && edge.from !== edge.to
    && posById.has(edge.from) && posById.has(edge.to))

  const hasSelected = Boolean(selected) && posById.has(selected)
  const related = new Set()
  if (hasSelected) {
    for (const edge of edges) {
      if (edge.from === selected || edge.to === selected) {
        related.add(edge.from)
        related.add(edge.to)
      }
    }
  }

  const edgesHtml = edges.map((edge) => {
    const from = posById.get(edge.from)
    const to = posById.get(edge.to)
    const sourcePoint = { x: from.x + from.w / 2, y: from.y + from.h / 2 }
    const targetPoint = { x: to.x + to.w / 2, y: to.y + to.h / 2 }
    const start = trimToRect(sourcePoint, targetPoint, from)
    const end = trimToRect(targetPoint, sourcePoint, to)
    // 已停用模块的依赖边当前不活跃：画虚线，且不参与选中高亮。
    const off = from.status === 'disabled'
    const touches = hasSelected && (edge.from === selected || edge.to === selected)
    const hot = touches && !off
    const dim = hasSelected && !touches
    const classes = ['gov-graph-edge', ...(off ? ['off'] : []), ...(hot ? ['hot'] : []), ...(dim ? ['dim'] : [])]
    const marker = hot ? 'gov-graph-arrow-hot' : 'gov-graph-arrow'
    return `<path class="${classes.join(' ')}" d="M ${num(start.x)} ${num(start.y)} L ${num(end.x)} ${num(end.y)}" data-from="${escText(edge.from)}" data-to="${escText(edge.to)}" data-capability="${escText(edge.capability)}" stroke="var(--line)" marker-end="url(#${marker})"${off ? ' stroke-dasharray="4 3"' : ''}><title>${escText(`${from.name} 依赖 ${edge.capability} ← ${to.name}`)}</title></path>`
  }).join('')

  const nodesHtml = placed.map((node) => {
    const classes = ['gov-graph-node', `cat-${node.group}`]
    if (node.status === 'disabled') classes.push('off')
    if (node.status === 'degraded') classes.push('degraded')
    if (hasSelected && node.id === selected) classes.push('sel')
    else if (hasSelected && related.has(node.id)) classes.push('adj')
    else if (hasSelected) classes.push('dim')
    const stroke = hasSelected && node.id === selected ? 'var(--accent)'
      : node.status === 'degraded' ? 'var(--warn)' : `var(--cat-${node.group})`
    const title = `${node.name} · ${node.id}@v${node.version} · ${graphStatusLabel(node.status)}`
    // OS-202a：节点必须能被整页委托命中——data-gov-action 是点击/键盘的统一入口；
    // role/tabindex/aria-label 让键盘与读屏也能触发（名称＋状态）。
    const ariaLabel = `${node.name} · ${graphStatusLabel(node.status)}`
    return `<g class="${classes.join(' ')}" data-gov-action="graph-node" role="button" tabindex="0" aria-label="${escText(ariaLabel)}" data-id="${escText(node.id)}" data-status="${node.status}">
      <title>${escText(title)}</title>
      <rect x="${num(node.x)}" y="${num(node.y)}" width="${node.w}" height="${node.h}" rx="14" fill="var(--surface-card)" stroke="${stroke}"${node.status === 'disabled' ? ' stroke-dasharray="4 3"' : ''}/>
      <text class="gov-graph-label" x="${num(node.x + node.w / 2)}" y="${num(node.y + node.h / 2)}">${escText(node.name)}</text>
      ${node.builtin ? '' : `<text class="gov-graph-local" x="${num(node.x + node.w - 6)}" y="${num(node.y + 12)}">本机</text>`}
    </g>`
  }).join('')

  // 底座能力：只列有依赖方的（全员依赖的折叠成一句），数量取自 graph.base.consumers。
  const baseRows = asArray(source.base).filter(isObj).map((item) => ({
    id: text(item.id), count: asArray(item.consumers).length
  })).filter((item) => item.id && item.count > 0)
    .sort((left, right) => right.count - left.count || left.id.localeCompare(right.id))
  const noteHtml = baseRows.length
    ? `<g class="gov-graph-base"><rect x="${GRAPH_PAD}" y="${num(cursor)}" width="${width - GRAPH_PAD * 2}" height="${GRAPH_NOTE_H}" rx="10" fill="var(--soft)" stroke="var(--line)"/><text class="gov-graph-note-text" x="${num(GRAPH_PAD + 12)}" y="${num(cursor + GRAPH_NOTE_H / 2)}">${escText(`底座 · ${baseRows.map((item) => `${item.id}（${item.count} 件依赖）`).join(' / ')} ＋ 装载协议 · 能力图 · 契约壳 · 物理写管道（全员依赖，图中略）`)}</text></g>`
    : ''
  const height = (baseRows.length ? cursor + GRAPH_NOTE_H : cursor - GRAPH_SEG_GAP) + GRAPH_PAD
  const defs = `<defs>
      <marker id="gov-graph-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--line)"/></marker>
      <marker id="gov-graph-arrow-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="var(--accent)"/></marker>
    </defs>`
  return `<svg class="gov-graph" viewBox="0 0 ${width} ${num(height)}" role="img" aria-label="插件能力图">${defs}<g class="gov-graph-edges">${edgesHtml}</g><g class="gov-graph-nodes">${nodesHtml}</g>${noteHtml}</svg>`
}

function clsLabelOf(group, role) {
  if (group === 'kernel') return '内核件'
  if (group === 'host') return '宿主组合面'
  return role && role !== 'workbench' ? role : '工作台'
}

/** 本地兜底 schema 规整（deps 没给 settingsAggregation 时仍可渲染，不抛错）。 */
function localSchema(raw) {
  const out = []
  const types = ['string', 'number', 'boolean', 'select']
  for (const entry of asArray(raw)) {
    if (!isObj(entry)) continue
    const key = text(entry.key ?? entry.id).trim()
    const type = text(entry.type).trim()
    if (!key || !types.includes(type)) continue
    const item = { key, label: text(entry.label).trim() || key, type }
    if (type === 'select') item.options = asArray(entry.options).map(text)
    if (entry.default !== undefined) item.default = entry.default
    out.push(item)
  }
  return out
}

function localRead(uiState, moduleId, key) {
  const source = isObj(uiState) ? uiState : {}
  const flat = `modules.settings.${text(moduleId)}.${text(key)}`
  if (Object.prototype.hasOwnProperty.call(source, flat)) return source[flat]
  const nested = source.modules?.settings
  if (isObj(nested) && isObj(nested[moduleId]) && Object.prototype.hasOwnProperty.call(nested[moduleId], key)) return nested[moduleId][key]
  return undefined
}

function localValid(setting, value) {
  if (!isObj(setting) || value === undefined || value === null || value === '') return { ok: false }
  if (setting.type === 'boolean') return typeof value === 'boolean' ? { ok: true, value } : { ok: false }
  if (setting.type === 'number') return typeof value === 'number' && Number.isFinite(value) ? { ok: true, value } : { ok: false }
  if (setting.type === 'select') return asArray(setting.options).map(text).includes(text(value)) ? { ok: true, value: text(value) } : { ok: false }
  return typeof value === 'string' ? { ok: true, value } : { ok: false }
}

/** 与 settingsAggregation.aggregateSettings 同口径补齐设置值（有注入实现时优先用它）。 */
function settingsFor(module, group, enabled, uiState, agg) {
  let schema = null
  if (agg && typeof agg.normalizeSettingsSchema === 'function') schema = agg.normalizeSettingsSchema(module.settings)
  if (!schema) schema = localSchema(module.settings)
  return schema.map((setting) => {
    let stored
    if (agg && typeof agg.normalizeSettingValue === 'function' && typeof agg.readModuleSetting === 'function') {
      stored = agg.normalizeSettingValue(setting, agg.readModuleSetting(uiState, module.id, setting.key))
    } else {
      stored = localValid(setting, localRead(uiState, module.id, setting.key))
    }
    return {
      ...setting,
      value: stored.ok ? stored.value : setting.default,
      stored: stored.ok,
      // 内核件与宿主组合面本来就没有自报设置；工作台停用＝只读保留。
      editable: group === 'workbench' && enabled
    }
  })
}

/**
 * 投影 → 治理台模型（纯函数，畸形输入产出空态，不抛错）。
 *
 * @param {object} payload  /api/plugins 响应（或 app.js 的 state.plugins）
 * @param {object} uiState  当前库 ui-state（读 modules.settings.*）
 * @param {object} deps     { navLabel?, settingsAggregation? }，可传函数做晚绑定
 */
export function governanceModel(payload, uiState, deps = {}) {
  const source = isObj(payload) ? payload : {}
  const modules = asArray(source.modules).filter(isObj).filter(isGovernanceModule)
  const slots = isObj(source.slots) ? source.slots : {}
  const options = isObj(deps) ? deps : {}
  const navLabel = typeof options.navLabel === 'function' ? options.navLabel : () => ''
  const agg = typeof options.settingsAggregation === 'function' ? options.settingsAggregation() : options.settingsAggregation

  const nameById = new Map(modules.map((item) => [text(item.id), text(item.name || item.id)]))
  const groupById = new Map(modules.map((item) => [text(item.id), groupOf(item)]))
  const nameOf = (id) => {
    const key = text(id)
    if (key === 'base') return '底座'
    return nameById.get(key) || key
  }
  const surfacesOf = (id) => SURFACE_ORDER.filter((slot) => asArray(slots[slot]).some((item) => isObj(item) && item.module === id))

  const cards = modules.map((module) => {
    const id = text(module.id)
    const group = groupOf(module)
    const role = text(module.role || module.class)
    const status = module.status === 'degraded' || module.status === 'disabled' ? module.status : 'loaded'
    const enabled = module.enabled !== false && status !== 'disabled'
    const provides = asArray(module.capabilities).filter(isObj).map((cap) => ({
      id: text(cap.id), version: cap.version, golden: cap.golden
    }))
    const requires = asArray(module.requires).filter(isObj).map((req) => ({
      ...req,
      id: text(req.id),
      provider: text(req.provider),
      providerName: text(req.provider) === 'base' ? '底座' : nameOf(req.provider)
    }))
    const dependents = asArray(module.dependents).filter(isObj).map((dep) => ({
      ...dep,
      id: text(dep.id),
      name: text(dep.name || dep.id),
      group: groupById.get(text(dep.id)) || groupOf(dep)
    }))
    const impact = asArray(module.impact).map(nameOf)
    const missing = asArray(module.missing).filter(isObj).map((item) => text(item.capability || item.id))
    const toggleCheck = isObj(module.toggleCheck) ? module.toggleCheck : null
    const surfaces = surfacesOf(id)
    const jump = text(module.settingsJump).trim()
    const hint = text(module.settingsHint).trim()
    const surfaceLabels = surfaces.map((slot) => SURFACE_LABEL[slot]).filter(Boolean)
    const activeDependents = dependents.filter((dep) => dep.status === 'loaded' && dep.enabled !== false).length
    let summary = ''
    if (group === 'kernel') {
      summary = `供给 ${provides.length} 项 · 被 ${activeDependents} 件依赖`
    } else if (group === 'host') {
      summary = `依赖 ${requires.length} 项 · 宿主自带`
    } else if (status === 'disabled') {
      summary = '已停用 · 数据与配置保留'
    } else if (status === 'degraded') {
      summary = `降级 · 缺 ${missing.join('、')}`
    } else {
      summary = `${surfaceLabels.join('、') || '无界面位置'} · 依赖 ${requires.length} 项`
    }
    return {
      id,
      name: text(module.name || id),
      version: text(module.version),
      cls: role || group,
      clsLabel: clsLabelOf(group, role),
      group,
      builtin: module.builtin !== false,
      status,
      enabled,
      // 只有工作台（含本机工作台）可启停；套件等非工作台角色即便混进 modules[] 也只读。
      toggleable: group === 'workbench' && (!role || role === 'workbench'),
      summary,
      provides,
      requires,
      dependents,
      impact,
      missing,
      toggleCheck,
      surfaces,
      nameMap: Object.fromEntries(nameById),
      hint,
      jump,
      jumpLabel: jump ? (text(navLabel(jump)) || jump) : '',
      settings: settingsFor(module, group, enabled, uiState, agg)
    }
  })

  const groups = GROUP_META.map((meta) => ({
    ...meta,
    cards: cards.filter((card) => card.group === meta.id)
  }))
  return { total: cards.length, groups }
}

function statusClass(status) {
  if (status === 'degraded') return '--warn'
  if (status === 'disabled') return '--meta'
  return '--ok'
}

function statusLabel(status) {
  if (status === 'degraded') return '降级'
  if (status === 'disabled') return '已停用'
  return '正常'
}

function lockReason(card) {
  if (card.cls === 'suite') return '套件是数据插件，不随工作台启停'
  if (card.group === 'host') return '宿主域实现，随宿主走，不随工作台启停'
  if (card.toggleCheck && card.toggleCheck.ok === false) return card.toggleCheck.message || '有活跃依赖方，停用即断链'
  return '内核件是能力供给层，停用会断链'
}

/** 一行收起的卡头：类别点 · 名称 · id@v · 徽标 · 摘要 · 状态点 · 开关/锁 · 箭头。 */
function cardHeadHtml(card, esc, options) {
  const id = esc(card.id)
  const builtinBadge = card.builtin ? '' : `<span class="gov-badge gov-badge-local">本机</span>`
  const status = statusClass(card.status)
  let control
  if (card.group === 'workbench' && card.toggleable !== false) {
    const disabled = options.canToggle === false ? ' disabled title="先打开一个库——启停按库分别记" aria-disabled="true"' : ''
    control = `<button type="button" class="sm-toggle${card.enabled ? ' on' : ''}" role="switch" aria-checked="${card.enabled ? 'true' : 'false'}" data-gov-action="toggle" data-id="${id}"${disabled}><span class="knob"></span><span class="lab">${card.enabled ? '已启用' : '已停用'}</span></button>`
  } else {
    control = `<span class="gov-lock" title="不可停：${esc(lockReason(card))}" aria-label="不可停"><i></i></span>`
  }
  return `<div class="gov-row" data-gov-action="expand" data-id="${id}" title="${esc(statusLabel(card.status))}：${esc(card.summary)}">
    <i class="gov-dot cat-${esc(card.group)}" title="${esc(card.clsLabel)}"></i>
    <span class="gov-name">${esc(card.name)}</span>
    <span class="gov-ident"><code>${id}</code><span class="gov-ver">@v${esc(card.version)}</span></span>
    <span class="gov-badge">${esc(card.clsLabel)}</span>${builtinBadge}
    <span class="gov-sum">${esc(card.summary)}</span>
    <i class="gov-status ${status}" title="${esc(statusLabel(card.status))}"></i>
    ${control}
    <span class="gov-chev" aria-hidden="true">›</span>
  </div>`
}

function providesHtml(card, esc) {
  const rows = card.provides.length
    ? card.provides.map((cap) => `<div class="gov-line"><span class="gov-mark">◆</span><code>${esc(cap.id)}@v${esc(cap.version)}</code>${cap.golden !== undefined && cap.golden !== null && cap.golden !== false && cap.golden !== '' ? '<span class="gov-golden">★金样</span>' : ''}</div>`).join('')
    : '<div class="gov-note">不供给能力。</div>'
  return `<section class="gov-col"><h4>供给</h4>${rows}</section>`
}

function requiresHtml(card, esc) {
  const rows = card.requires.length
    ? card.requires.map((req) => {
      const mark = req.ok === false ? '<span class="gov-mark bad">✗</span>' : '<span class="gov-mark good">✓</span>'
      const reason = req.ok === false ? `<span class="gov-why">（${esc(REASON_LABEL[text(req.reason)] || text(req.reason) || '未满足')}）</span>` : ''
      return `<div class="gov-line">${mark}<code>${esc(req.id)}@v${esc(req.min)}</code><span class="gov-provider">← ${esc(req.providerName)}</span>${reason}</div>`
    }).join('')
    : '<div class="gov-note">没有硬依赖。</div>'
  return `<section class="gov-col"><h4>依赖</h4>${rows}</section>`
}

function dependentsHtml(card, esc) {
  const rows = card.dependents.length
    ? `<div class="gov-deps">${card.dependents.map((dep) => {
      const tag = dep.status === 'disabled' || dep.enabled === false ? '<span class="gov-dep-tag">已停用</span>' : (dep.status === 'degraded' ? '<span class="gov-dep-tag warn">降级</span>' : '')
      return `<span class="gov-dep"><i class="gov-dot cat-${esc(dep.group)}"></i>${esc(dep.name)}${tag}</span>`
    }).join('')}</div>`
    : '<div class="gov-note">没有插件依赖我——停用只影响自己的工作面。</div>'
  return `<section class="gov-col"><h4>谁依赖我</h4>${rows}</section>`
}

function kernelNoteHtml(card, esc) {
  if (card.group === 'kernel') {
    const check = card.toggleCheck
    let note = ''
    if (check && check.ok === false) {
      const consumers = asArray(check.consumers).map((id) => text(id) === 'base' ? '底座' : (card.nameMap?.[text(id)] || text(id)))
      note += `<div class="gov-impact">不可停的原因：${esc(consumers.join('、'))} 依赖本件供给的能力，停用即断链。</div>`
    }
    if (card.impact.length) note += `<div class="gov-impact">连锁影响：${esc(card.impact.join('、'))}。</div>`
    return note
  }
  if (card.group === 'host') return '<div class="gov-identity">宿主域实现，随宿主走，不随工作台启停。</div>'
  return ''
}

/** 卡内恢复办法：有供给方就指名；没人供给就点名「需要一件供给…的插件」。 */
function recoveryHtml(card, esc) {
  if (card.status !== 'degraded' || !card.missing.length) return ''
  const rows = card.missing.map((cap) => {
    const req = card.requires.find((item) => item.id === cap)
    const provider = req && req.provider && req.provider !== 'base' ? req.providerName : ''
    return provider
      ? `<div class="gov-recovery">恢复办法：让供给方「${esc(provider)}」恢复供给。</div>`
      : `<div class="gov-recovery">需要一件供给 ${esc(cap)} 的插件。</div>`
  }).join('')
  return rows
}

function settingControlHtml(moduleId, setting, esc) {
  const disabled = setting.editable ? '' : ' disabled'
  const attrs = `data-gov-action="setting" data-module-id="${esc(moduleId)}" data-key="${esc(setting.key)}" data-type="${esc(setting.type)}"`
  const label = esc(setting.label)
  const value = setting.value
  if (setting.type === 'boolean') {
    return `<label class="gov-field gov-check"><input type="checkbox" ${attrs}${value === true ? ' checked' : ''}${disabled}><span>${label}</span></label>`
  }
  if (setting.type === 'select') {
    const options = asArray(setting.options).map((option) => `<option value="${esc(option)}"${text(option) === text(value) ? ' selected' : ''}>${esc(option)}</option>`).join('')
    return `<label class="gov-field"><span>${label}</span><select class="select" ${attrs}${disabled}>${options}</select></label>`
  }
  const type = setting.type === 'number' ? 'number' : 'text'
  const raw = value === undefined || value === null ? '' : text(value)
  return `<label class="gov-field"><span>${label}</span><input class="uikit-input" type="${type}" ${attrs} value="${esc(raw)}"${disabled}></label>`
}

/** 设置区：自报 schema → 表单；只有指路 → 指路框＋跳转；两者都没有 → 不出这一块。 */
function settingsHtml(card, esc) {
  if (card.group === 'kernel') return '' // 内核件不出空指路框
  if (card.settings.length) {
    return `<div class="gov-settings"><h4>设置</h4><div class="gov-fields">${card.settings.map((setting) => settingControlHtml(card.id, setting, esc)).join('')}</div>${card.enabled ? '' : '<div class="gov-note">已停用：设置值保留，重新启用即可编辑。</div>'}</div>`
  }
  if (card.hint) {
    const jump = card.jump
      ? `<button type="button" class="uikit-btn uikit-btn-ghost" data-settings-section="${esc(card.jump)}">去 ${esc(card.jumpLabel || card.jump)} →</button>`
      : ''
    return `<div class="gov-settings"><h4>设置</h4><div class="gov-pointer"><span>${esc(card.hint)}</span>${jump}</div></div>`
  }
  return ''
}

/** 卡内确认条：影响面按 surfaces 逐条生成，不复述 settingsHint。 */
export function confirmStripHtml(card) {
  const source = isObj(card) ? card : {}
  const esc = escText
  const name = esc(text(source.name || source.id))
  const surfaces = asArray(source.surfaces)
  const lines = []
  if (surfaces.includes('tab')) lines.push(`停用后，页签「${name}」从导航消失。`)
  if (surfaces.includes('right')) lines.push('停用后，正文右栏里它的卡片收起。')
  if (surfaces.includes('settings')) lines.push('停用后，设置页里它的配置区收起，已填的值保留。')
  if (surfaces.includes('host-actions')) lines.push(`停用后，顶栏的「${name}」入口收起。`)
  lines.push('库内数据与配置全部保留，重新启用即恢复。')
  if (source.status === 'degraded') {
    lines.push(`它现在缺 ${asArray(source.missing).map(text).join('、')}；停用后再启用仍是降级，直到依赖恢复。`)
  }
  const id = esc(text(source.id))
  return `<div class="gov-confirm">
    <h4>确认停用「${name}」？</h4>
    <div class="gov-impact-list">${lines.map((line) => `<p>${esc(line)}</p>`).join('')}</div>
    <div class="gov-confirm-actions">
      <button type="button" class="uikit-btn uikit-btn-ghost" data-gov-action="cancel" data-id="${id}">取消</button>
      <button type="button" class="uikit-btn gov-danger" data-gov-action="confirm-disable" data-id="${id}">确认停用</button>
    </div>
  </div>`
}

/** 单张卡：收起一行＋（展开时）通栏三栏＋设置区＋确认条。 */
export function pluginCardHtml(card, options = {}) {
  const source = isObj(card) ? card : {}
  const opts = isObj(options) ? options : {}
  const esc = typeof opts.esc === 'function' ? opts.esc : escText
  const group = text(source.group || groupOf(source))
  const id = esc(text(source.id))
  const normalized = { ...source, group }
  const classes = ['gov-card', `gov-${group}`]
  // OS-201a：expanded === true 出卡体；expandedId 命中本卡也给默认展开（OS-202 点节点定位到卡）。
  const isExpanded = opts.expanded === true || (opts.expandedId !== undefined && text(opts.expandedId) === text(source.id))
  if (isExpanded) classes.push('open')
  // OS-202：图与卡片共用选中态——点节点选中后，对应卡片也带上 sel 标记。
  if (text(opts.selectedId) && text(opts.selectedId) === text(source.id)) classes.push('sel')
  if (source.status === 'disabled') classes.push('off')
  if (source.status === 'degraded') classes.push('degraded')
  const head = cardHeadHtml(normalized, esc, opts)
  let body = ''
  if (isExpanded) {
    const error = isObj(opts.error) ? opts.error : null
    body = `<div class="gov-body">
      <div class="gov-grid">${providesHtml(normalized, esc)}${requiresHtml(normalized, esc)}${dependentsHtml(normalized, esc)}</div>
      ${kernelNoteHtml(normalized, esc)}
      ${recoveryHtml(normalized, esc)}
      ${settingsHtml(normalized, esc)}
      ${error ? `<div class="gov-error">${esc(error.code || 'WRITE_FAILED')} · ${esc(error.message || '写回失败')}</div>` : ''}
    </div>`
  }
  const confirm = opts.confirming && group === 'workbench' && source.toggleable !== false && source.status !== 'disabled' ? confirmStripHtml(normalized) : ''
  return `<article class="${classes.join(' ')}" data-gov-id="${id}">${head}${body}${confirm}</article>`
}

/** 治理台整页（纯字符串渲染；依赖由 view 注入，空参调用如实给「拿不到插件清单」空态）。 */
function governanceHtml(view = {}, options = {}) {
  const ctx = isObj(view) ? view : {}
  const state = isObj(ctx.state) ? ctx.state : {}
  // OS-205a：能不能启停只由当前库决定——不看调用方有没有传 options。
  const canToggle = Boolean(state.current?.path)
  const esc = typeof ctx.esc === 'function' ? ctx.esc : escText
  const textOf = typeof ctx.text === 'function' ? ctx.text : text
  const uiMemory = typeof ctx.uiMemory === 'function' ? ctx.uiMemory : () => ({ values: {} })
  const navLabel = typeof ctx.navLabel === 'function' ? ctx.navLabel : () => ''
  const settingsAggregation = ctx.settingsAggregation
  const uiState = isObj(ctx.ui) ? ctx.ui : {}
  const expanded = uiState.expanded instanceof Set ? uiState.expanded : new Set()
  const confirming = uiState.confirming || ''
  const error = uiState.error
  const opts = isObj(options) ? options : {}
  const selectedId = text(opts.selectedId || '')
  const graphCollapsed = opts.graphCollapsed === true
  const currentUiState = () => {
    if (!state.current) return {}
    const mem = uiMemory(state.current.path)
    return isObj(mem?.values) ? mem.values : {}
  }
  const payload = state.plugins
  const failed = !isObj(payload) || payload.slots === null || Boolean(payload.error) || !Array.isArray(payload.modules)
  const model = governanceModel(payload, currentUiState(), { navLabel, settingsAggregation })
  const lib = state.current
  const head = `${model.total} 件 · ${lib ? `当前库：${esc(textOf(lib.name || lib.path))}` : '未打开库'}`
  if (failed) {
    const reason = payload?.error || (payload?.slots === null ? '插件投影读取失败' : (isObj(payload) ? '投影里没有模块数组' : '没有收到 /api/plugins 投影'))
    return `<div class="gov"><div class="gov-head"><h2>插件治理台</h2><span class="gov-count">${esc(head)}</span></div><div class="gov-empty">拿不到插件清单：${esc(reason)}</div></div>`
  }
  // OS-202：能力图由投影现算；graph 缺失时整块不出现，不留空框。
  const graphSvg = capabilityGraphSvg(payload.moduleGraph, payload.modules, { selected: selectedId })
  const graphBlock = graphSvg ? `<section class="gov-map${graphCollapsed ? ' collapsed' : ''}">
    <div class="gov-map-head">
      <h3>能力图</h3>
      <span class="gov-count">${model.total} 件 · ${asArray(payload.moduleGraph?.edges).filter((edge) => isObj(edge) && text(edge.to) !== 'base').length} 条依赖</span>
      <div class="gov-graph-legend">
        <span><i class="gov-dot cat-workbench"></i>工作台</span>
        <span><i class="gov-dot cat-host"></i>宿主组合面</span>
        <span><i class="gov-dot cat-kernel"></i>内核件</span>
        <span class="gov-graph-arrow-note">箭头＝能力依赖（依赖方 → 供给方）</span>
      </div>
      <button type="button" class="uikit-btn uikit-btn-ghost gov-map-toggle" data-gov-action="graph-toggle">${graphCollapsed ? '展开能力图' : '收起'}</button>
    </div>
    ${graphSvg}
  </section>` : ''
  const groups = model.groups.map((group) => {
    const cards = group.cards.length
      ? group.cards.map((card) => pluginCardHtml(card, {
        esc,
        expanded: expanded.has(card.id),
        expandedId: selectedId || opts.expandedId,
        selectedId,
        confirming: confirming === card.id,
        error: error && error.id === card.id ? error : null,
        canToggle
      })).join('')
      : '<p class="gov-empty-group">这一组暂时没有插件。</p>'
    return `<section class="gov-group">
      <div class="gov-group-head"><i class="gov-dot cat-${esc(group.id)}"></i><h3>${esc(group.label)}</h3><span class="gov-count">${group.cards.length} 件</span><span class="gov-desc">${esc(group.desc)}</span></div>
      <div class="gov-cards">${cards}</div>
    </section>`
  }).join('')
  return `<div class="gov">
    <div class="gov-head"><h2>插件治理台</h2><span class="gov-count">${esc(head)}</span></div>
    <p class="gov-lead">能力图看全局，卡片管单件：启停看影响、依赖有出处、设置有指路。内核件与宿主组合面只读。</p>
    ${graphBlock}
    ${groups}
  </div>`
}

/** 工厂：注入依赖与事件委托，app.js 只拿整页渲染器一行转交。 */
export function createGovernanceViews(scope) {
  const ctx = isObj(scope) ? scope : {}
  const state = isObj(ctx.state) ? ctx.state : {}
  const esc = typeof ctx.esc === 'function' ? ctx.esc : escText
  const textOf = typeof ctx.text === 'function' ? ctx.text : text
  const uiMemory = typeof ctx.uiMemory === 'function' ? ctx.uiMemory : () => ({ values: {} })
  const navLabel = typeof ctx.navLabel === 'function' ? ctx.navLabel : () => ''
  const settingsAggregation = ctx.settingsAggregation
  const aggregation = () => typeof settingsAggregation === 'function' ? settingsAggregation() : settingsAggregation
  const loadPlugins = typeof ctx.loadPlugins === 'function' ? ctx.loadPlugins : async () => {}
  const render = typeof ctx.render === 'function' ? ctx.render : () => {}
  const setModuleEnabled = typeof ctx.setModuleEnabled === 'function' ? ctx.setModuleEnabled : async () => { throw new Error('启停写回没有接上') }
  const uiSet = typeof ctx.uiSet === 'function' ? ctx.uiSet : () => {}

  const expanded = new Set()
  let confirming = ''
  let error = null
  // OS-202：选中态与图的开合都是视图内存（不是内容性数据，不落浏览器存储）。
  let selected = ''
  let graphCollapsed = false

  function currentUiState() {
    if (!state.current) return {}
    const mem = uiMemory(state.current.path)
    return isObj(mem?.values) ? mem.values : {}
  }

  function findCard(id) {
    const model = governanceModel(state.plugins, currentUiState(), { navLabel, settingsAggregation })
    for (const group of model.groups) {
      const found = group.cards.find((card) => card.id === id)
      if (found) return found
    }
    return null
  }

  function renderPage() {
    return governanceHtml({ state, esc, text: textOf, uiMemory, navLabel, settingsAggregation, ui: { expanded, confirming, error } }, {
      selectedId: selected, graphCollapsed
    })
  }

  /** 图与卡片共用一个选中态：再点一次取消；选中即展开卡片并滚动定位、闪一下强调。 */
  function selectPlugin(id, scrollToCard) {
    selected = selected === id ? '' : id
    if (selected) expanded.add(selected)
    else expanded.delete(id)
    confirming = ''
    error = null
    render()
    if (selected && scrollToCard && typeof document !== 'undefined') {
      for (const card of document.querySelectorAll('[data-gov-id]')) {
        if (card.dataset.govId !== id) continue
        card.scrollIntoView({ behavior: 'smooth', block: 'center' })
        card.classList.add('flash')
        setTimeout(() => card.classList.remove('flash'), 1600)
        break
      }
    }
  }

  async function commit(id, enabled) {
    confirming = ''
    error = null
    try {
      await setModuleEnabled(id, enabled)
      expanded.add(id)
      await loadPlugins(state.current?.path || '')
      render()
    } catch (failure) {
      expanded.add(id) // 失败也要让卡展开，错误码与原因才看得见；开关保持原位（内存没动）
      error = { id, code: textOf(failure?.code || 'WRITE_FAILED'), message: textOf(failure?.message || failure) }
      render()
    }
  }

  /** 点击与键盘共用一套动作分派：委托只负责找到 [data-gov-action]，动作口径不变。 */
  async function runGovAction(target) {
    const action = target.dataset.govAction
    const id = textOf(target.dataset.id)
    try {
      if (action === 'expand') {
        selectPlugin(id, false)
        return
      }
      if (action === 'graph-node') {
        selectPlugin(id, true)
        return
      }
      if (action === 'graph-toggle') {
        graphCollapsed = !graphCollapsed
        render()
        return
      }
      if (action === 'toggle') {
        const card = findCard(id)
        if (!card || card.group !== 'workbench' || !state.current?.path) return
        if (card.enabled) {
          expanded.add(id)
          confirming = id
          error = null
          render()
        } else {
          await commit(id, true)
        }
        return
      }
      if (action === 'cancel') {
        confirming = ''
        error = null
        render()
        return
      }
      if (action === 'confirm-disable') {
        await commit(id, false)
        return
      }
    } catch (failure) {
      error = { id, code: textOf(failure?.code || 'WRITE_FAILED'), message: textOf(failure?.message || failure) }
      render()
    }
  }

  if (typeof document !== 'undefined') {
    document.addEventListener('click', (event) => {
      const target = event.target?.closest?.('[data-gov-action]')
      if (target) runGovAction(target)
    })
    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
      const target = event.target?.closest?.('[data-gov-action]')
      // 原生按钮/输入自己会响应 Enter/Space，交给它们，避免同一动作触发两次。
      if (!target || target.matches?.('button, a, input, select, textarea')) return
      event.preventDefault()
      runGovAction(target)
    })
    document.addEventListener('change', (event) => {
      const target = event.target?.closest?.('[data-gov-action="setting"]')
      if (!target) return
      const { moduleId, key, type } = target.dataset
      const raw = target.type === 'checkbox' ? target.checked : target.value
      const value = aggregation()?.coerceSettingValue?.(type, raw)
      if (value !== undefined) uiSet(`modules.settings.${textOf(moduleId)}.${textOf(key)}`, value, { immediate: true })
      render()
    })
  }

  return { governanceHtml: renderPage, missingText, degradedViewHtml, moduleCard: findCard }
}

export { governanceHtml }
