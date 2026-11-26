/**
 * OS-188 / D4：底座 slot 注册表（唯一真源）。
 *
 * slot 是跨插件共同语言（页签、右栏、侧栏、宿主动作、设置区），只能由底座登记：
 * 插件 manifest 的 `slots[]` 只准引用这里已有的 id，自造 slot 一律校验失败。
 * 扩展 slot＝改这张表＋同步前端编排与验收，不提供运行时自注册入口。
 */
export const SLOT_SPEC = 'openstory-slots@1'

export const SLOT_REGISTRY = Object.freeze([
  Object.freeze({ id: 'tab', label: '页签', description: '顶栏可达的工作台页签', scope: 'workbench' }),
  Object.freeze({ id: 'right', label: '右栏', description: '正文右侧的分析／参考卡片位', scope: 'workbench' }),
  Object.freeze({ id: 'sidebar', label: '侧栏', description: '左侧导航浮层', scope: 'workbench' }),
  Object.freeze({ id: 'host-actions', label: '宿主动作', description: '页头全局动作位', scope: 'workbench' }),
  Object.freeze({ id: 'settings', label: '设置区', description: '设置页内嵌的模块设置区', scope: 'workbench' })
])

export const SLOT_IDS = Object.freeze(SLOT_REGISTRY.map((item) => item.id))

export function isRegisteredSlot(id) {
  return SLOT_IDS.includes(String(id ?? '').trim())
}

export function slotEntry(id) {
  const key = String(id ?? '').trim()
  return SLOT_REGISTRY.find((item) => item.id === key) ?? null
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const child of Object.values(value)) deepFreeze(child)
  return Object.freeze(value)
}

/**
 * 按 manifest 装载序生成各 slot 的稳定编排：同一 slot 内先按声明的 `order`、再按装载序、
 * 最后按 page id 排；停用的模块不出现。`enabled` 缺省视为启用（与 readModuleEnabled 的缺省一致）。
 * `orderHints` 是「本机同 id 覆盖内置但没重写 order」时的位置兜底（键＝`slot:page`）。
 */
export function slotPlacements(manifests = [], enabled = {}, orderHints = new Map()) {
  const out = {}
  manifests.forEach((manifest, loadOrder) => {
    if (manifest?.class !== 'workbench' || enabled?.[manifest.id] === false) return
    for (const placement of manifest.slots ?? []) {
      if (!isRegisteredSlot(placement?.slot) || !String(placement?.page ?? '').trim()) continue
      const hint = orderHints.get(`${placement.slot}:${placement.page}`)
      const order = Number.isInteger(placement.order) ? placement.order : (Number.isInteger(hint) ? hint : null)
      ;(out[placement.slot] ??= []).push({
        slot: placement.slot,
        page: placement.page,
        module: manifest.id,
        order,
        loadOrder
      })
    }
  })
  for (const items of Object.values(out)) {
    items.sort((left, right) => {
      const lo = left.order ?? Number.POSITIVE_INFINITY
      const ro = right.order ?? Number.POSITIVE_INFINITY
      return lo - ro || left.loadOrder - right.loadOrder || left.page.localeCompare(right.page)
    })
  }
  return deepFreeze(out)
}

/**
 * OS-198：面向 UI 的 slot 投影。每个位置只带渲染所需字段：
 *   `{ slot, page, module, label, view }`，iframe 页面另带 `entry`。
 * `view` 三态：builtin（前端有内置视图）／iframe（本机模块自带页面入口）／none（不可渲染）。
 * 页面 id → label 从 manifest 的 pages[] 取；不可渲染的位置进 warnings，不静默消失。
 *
 * OS-200：可选 `statuses`（模块 id → `{ status, active, missing }`）来自同一份能力快照。
 * 已启用但不活跃的降级件位置照常下发，带 `degraded:true` 与 `missing`；健康位置一个字段都不加，
 * 停用的位置照旧消失。不传 `statuses` 时输出形状与改前逐字相同。
 */
export function slotProjection(manifests = [], enabled = {}, {
  builtinPages = new Set(), localIds = new Set(), orderHints = new Map(), statuses = null
} = {}) {
  const placements = slotPlacements(manifests, enabled, orderHints)
  const byModule = new Map(manifests.map((manifest) => [manifest.id, manifest]))
  const statusOf = (id) => statuses instanceof Map ? statuses.get(id) : statuses?.[id]
  const warnings = []
  const slots = {}
  for (const [slot, items] of Object.entries(placements)) {
    slots[slot] = items.map((item) => {
      const manifest = byModule.get(item.module)
      const page = (manifest?.pages ?? []).find((entry) => entry.id === item.page)
      const label = page?.label || item.page
      const iframe = page?.kind === 'iframe' && Boolean(page.entry) && localIds.has(item.module)
      // 内置视图优先：本机模块即使覆盖同 id 页面并声明 iframe，前端仍走内置渲染。
      const view = builtinPages.has(item.page) ? 'builtin' : (iframe ? 'iframe' : 'none')
      if (view === 'none') {
        warnings.push({
          code: 'MODULE_PAGE_UNRENDERABLE',
          module: item.module,
          slot,
          page: item.page,
          message: `${item.module}/${item.page} 声明了 ${slot} 位置，但前端没有内置视图、也没有 iframe 入口`
        })
      }
      const degraded = statusOf(item.module)
      const mark = degraded?.status === 'degraded' && degraded.active !== true
      return {
        slot,
        page: item.page,
        module: item.module,
        label,
        view,
        ...(view === 'iframe' ? { entry: page.entry } : {}),
        ...(mark ? { degraded: true, missing: [...(degraded.missing ?? [])] } : {})
      }
    })
  }
  return { slots: deepFreeze(slots), warnings: deepFreeze(warnings) }
}