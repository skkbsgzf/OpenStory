/**
 * OS-194 / OS-196：daemon / MCP 共用的端点分派表。
 *
 * 宿主端点直接取 registry.HOST_HANDLERS；模块端点与宿主钩子都按库快照从 activate() 贡献里取——
 * 这就是 activate() 的生产调用点（启动装载由本表首次触发，每次库快照重建按 snapshot.id 换表）。
 * 在途请求在 await 前已持有旧 handler/hook 引用，换表不影响它。
 *
 * OS-196：本机模块根的贡献先按当前层取（已激活，摘要为键）；其余仍走内置装载。
 */
import { HOST_HANDLERS } from '../api/registry.mjs'
import { activateModules } from './moduleLoader.mjs'
import { endpointOwnerFor, localContribution, localContributions, migrationStateFor, snapshotFor } from './moduleRuntime.mjs'

/** snapshot.id → { moduleId → { handlers, hooks } }（冻结，按快照整体替换）。 */
const contributionCache = new Map()

/**
 * 取该库当前快照的完整贡献（handlers ＋ hooks）。缓存键＝snapshotFor(root, env).id，
 * 其中已编码启停/路由/图问题／本机模块摘要；状态一变 id 就变，新请求自然拿到新贡献。
 */
async function snapshotContributions(root, env) {
  const snapshot = await snapshotFor(root, env)
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
export async function contributionTable(root, env = process.env) {
  const full = await snapshotContributions(root, env)
  return Object.freeze(Object.fromEntries(
    Object.entries(full).map(([moduleId, contribution]) => [moduleId, contribution.handlers])
  ))
}

/**
 * endpointId → handler：宿主端点走静态表；模块端点走快照贡献。
 * 贡献缺失（模块停用/入口坏）返回 null，由 daemon 按现有闸给出 MODULE_DISABLED /
 * PLUGIN_DEGRADED 信封；激活本身抛错转成 PLUGIN_DEGRADED，不冒充 404。
 */
export async function handlerFor(endpointId, root, env = process.env) {
  const owner = await endpointOwnerFor(endpointId, env)
  if (!owner) return HOST_HANDLERS[endpointId] ?? null
  // OS-196：本机模块在候选快照构建时已激活，直接取贡献——不再按声明键复用旧激活结果。
  // OS-197：迁移失败被剔除的覆盖者，其端点随快照一起下线。
  const local = await localContribution(owner, env)
  if (local) {
    const excluded = new Set((await migrationStateFor(root, env)).excluded ?? [])
    if (excluded.has(owner)) return null
    const snapshot = await snapshotFor(root, env)
    if (snapshot.enabled?.[owner] === false) return null
    return local.handlers?.[endpointId] ?? null
  }
  try {
    const table = await contributionTable(root, env)
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
export async function allHandlers(root = '', env = process.env) {
  const table = await contributionTable(root, env)
  const contributed = Object.values(table).flatMap((handlers) => Object.entries(handlers))
  const merged = { ...HOST_HANDLERS, ...Object.fromEntries(contributed) }
  const excluded = new Set((await migrationStateFor(root, env)).excluded ?? [])
  for (const endpointId of Object.keys(merged)) {
    const owner = await endpointOwnerFor(endpointId, env)
    if (!owner || excluded.has(owner)) continue
    const local = await localContribution(owner, env)
    if (local?.handlers?.[endpointId]) merged[endpointId] = local.handlers[endpointId]
  }
  return Object.freeze(merged)
}

/**
 * OS-195a：按库快照取宿主钩子。
 * 与 handlerFor 同一张贡献表、同一套按 snapshot.id 换表机制——模块停用＝贡献消失；
 * 返回的 { <模块局部名>: fn } 由调用方按名字取（钩子名已在底座登记，见 moduleActivation）。
 */
export async function hooksFor(root, hookName, env = process.env) {
  // OS-196a：与 handler 用同一张贡献表；本机层也合并进来，按快照 enabled 回收。
  const [table, locals, snapshot, migrations] = await Promise.all([
    snapshotContributions(root, env), localContributions(env), snapshotFor(root, env), migrationStateFor(root, env)
  ])
  const excluded = new Set(migrations.excluded ?? [])
  const slots = Object.values(table).map((entry) => entry.hooks?.[hookName]).filter(Boolean)
  for (const [moduleId, contribution] of Object.entries(locals)) {
    if (excluded.has(moduleId)) continue
    if (snapshot.enabled?.[moduleId] === false) continue
    const hook = contribution?.hooks?.[hookName]
    if (hook) slots.push(hook)
  }
  return Object.freeze(Object.assign({}, ...slots))
}

/** 测试钩子：当前已缓存的贡献快照数（验证「快照重建后换表」）。 */
export function __contributionCacheSize() {
  return contributionCache.size
}
