/**
 * OS-194：daemon / MCP 共用的端点分派表。
 *
 * 宿主端点直接取 registry.HOST_HANDLERS；模块端点与宿主钩子都按库快照从 activate() 贡献里取——
 * 这就是 activate() 的生产调用点（启动装载由本表首次触发，每次库快照重建按 snapshot.id 换表）。
 * 在途请求在 await 前已持有旧 handler/hook 引用，换表不影响它。
 */
import { HOST_HANDLERS } from '../api/registry.mjs'
import { activateModules } from './moduleLoader.mjs'
import { capabilitySnapshotFor, moduleOfEndpoint } from '../protocol/modules.mjs'

/** snapshot.id → { moduleId → { handlers, hooks } }（冻结，按快照整体替换）。 */
const contributionCache = new Map()

/**
 * 取该库当前快照的完整贡献（handlers ＋ hooks）。缓存键＝capabilitySnapshotFor(root).id，
 * 其中已编码启停/路由/图问题；状态一变 id 就变，新请求自然拿到新贡献。
 */
async function snapshotContributions(root) {
  const snapshot = await capabilitySnapshotFor(root)
  let table = contributionCache.get(snapshot.id)
  if (!table) {
    const { activated } = await activateModules({ snapshot })
    table = Object.freeze(Object.fromEntries(
      activated.map((item) => [item.id, Object.freeze({
        handlers: Object.freeze(item.contribution.handlers ?? {}),
        hooks: Object.freeze(item.contribution.hooks ?? {})
      })])
    ))
    contributionCache.set(snapshot.id, table)
  }
  return table
}

/** 端点贡献视图（沿用 OS-194 的 module → handlers 形状）。 */
export async function contributionTable(root) {
  const full = await snapshotContributions(root)
  return Object.freeze(Object.fromEntries(
    Object.entries(full).map(([moduleId, contribution]) => [moduleId, contribution.handlers])
  ))
}

/**
 * endpointId → handler：宿主端点走静态表；模块端点走快照贡献。
 * 贡献缺失（模块停用/入口坏）返回 null，由 daemon 按现有闸给出 MODULE_DISABLED /
 * PLUGIN_DEGRADED 信封；激活本身抛错转成 PLUGIN_DEGRADED，不冒充 404。
 */
export async function handlerFor(endpointId, root) {
  const owner = moduleOfEndpoint(endpointId)
  if (!owner) return HOST_HANDLERS[endpointId] ?? null
  try {
    const table = await contributionTable(root)
    return table[owner]?.[endpointId] ?? null
  } catch (error) {
    const failure = new Error(error?.message ?? `模块 ${owner} 激活失败`)
    failure.code = 'PLUGIN_DEGRADED'
    failure.details = { module: owner, endpoint: endpointId, reason: error?.code ?? 'ACTIVATION_FAILED' }
    throw failure
  }
}

/**
 * 全量端点 → handler 视图（宿主静态表 ＋ 当前快照的模块贡献），供契约/覆盖面测试一次取齐。
 * 生产分派不用它——daemon 按请求所在库单独查 handlerFor。
 */
export async function allHandlers(root = '') {
  const table = await contributionTable(root)
  const contributed = Object.values(table).flatMap((handlers) => Object.entries(handlers))
  return Object.freeze({ ...HOST_HANDLERS, ...Object.fromEntries(contributed) })
}

/**
 * OS-195a：按库快照取宿主钩子。
 * 与 handlerFor 同一张贡献表、同一套按 snapshot.id 换表机制——模块停用＝贡献消失；
 * 返回的 { <模块局部名>: fn } 由调用方按名字取（钩子名已在底座登记，见 moduleActivation）。
 */
export async function hooksFor(root, hookName) {
  const table = await snapshotContributions(root)
  const slots = Object.values(table).map((entry) => entry.hooks?.[hookName]).filter(Boolean)
  return Object.freeze(Object.assign({}, ...slots))
}

/** 测试钩子：当前已缓存的贡献快照数（验证「快照重建后换表」）。 */
export function __contributionCacheSize() {
  return contributionCache.size
}
