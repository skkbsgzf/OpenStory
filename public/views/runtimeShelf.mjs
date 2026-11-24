/**
 * 运行时货架可见性（OS-149 / G8e）——fixture 套件不进作者可见列表。
 *
 * 作者口径：echo-kit（回声参考套件）是 kit 作者的骨架模板＋测试夹具，不是产品功能；
 * 它照常留在 `runtimes/echo-kit/`（测试端到端要用），但设置页的运行时货架与 Agent 的
 * 运行时下拉都不摆它。判定只有一个信号：manifest 的 `fixture: true`（src/services/runtimes.mjs
 * 做形状闸，非布尔＝坏 kit；缺省＝false）。
 *
 * 为什么在这里：app.js 是增量冻结的消费壳（OS-143），过滤逻辑必须落在 views/ 的纯函数里，
 * 壳只调用。零 import、不碰 DOM、不读全局 state、不写存储——Node 测试可直接 import。
 *
 * 两处消费者：
 *   · `settingsRuntimeSectionHtml`（设置 · 引擎与存储）的分组；
 *   · `settingsModelsSectionHtml`（设置 · 模型）的运行时下拉。
 */

/** 货架三组（声明序＝渲染序）：与 /api/agent/runtimes 的 category 一一对应。 */
export const RUNTIME_SHELF_GROUPS = Object.freeze([
  Object.freeze({ key: 'native', label: '原生 / 套件' }),
  Object.freeze({ key: 'dsh', label: 'DSH 原生' }),
  Object.freeze({ key: 'cli', label: 'CLI 服务（嫁接）' })
])

/** 夹具套件判定：只认严格 true（坏档/缺字段都当正常套件，不误伤）。 */
export function isFixtureRuntime(kit) {
  return kit?.fixture === true
}

/** 作者可见的运行时清单：去掉 fixture 与非对象条目（输入不是数组＝空清单，绝不抛）。 */
export function visibleRuntimeKits(list) {
  return (Array.isArray(list) ? list : []).filter((kit) => kit && typeof kit === 'object' && !isFixtureRuntime(kit))
}

/** 某个货架分组的可见套件（category 缺省 native，与后端同一口径）。 */
export function runtimeKitsByCategory(list, category) {
  return visibleRuntimeKits(list).filter((kit) => (kit?.category ?? 'native') === category)
}

/** 运行时下拉的可选项：可见且有 id（Pi 兜底条目 id 为空，由调用方单独摆一条）。 */
export function selectableRuntimeKits(list) {
  return visibleRuntimeKits(list).filter((kit) => Boolean(kit?.id))
}
