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
 * 按 manifest 装载序生成各 slot 的稳定编排：同一 slot 内先按装载序、再按 page id 排；
 * 停用的模块不出现。`enabled` 缺省视为启用（与 readModuleEnabled 的缺省一致）。
 */
export function slotPlacements(manifests = [], enabled = {}) {
  const out = {}
  manifests.forEach((manifest, order) => {
    if (manifest?.class !== 'workbench' || enabled?.[manifest.id] === false) return
    for (const placement of manifest.slots ?? []) {
      if (!isRegisteredSlot(placement?.slot) || !String(placement?.page ?? '').trim()) continue
      ;(out[placement.slot] ??= []).push({
        slot: placement.slot,
        page: placement.page,
        module: manifest.id,
        order
      })
    }
  })
  for (const items of Object.values(out)) {
    items.sort((left, right) => left.order - right.order || left.page.localeCompare(right.page))
  }
  return deepFreeze(out)
}