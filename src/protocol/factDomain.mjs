/**
 * fact 域原语转供叶（OS-155，设计稿 §3.1／§5.1／§9-3 备选 B）——给推演引擎的协议层取数口。
 *
 * 为什么需要这一片：推演引擎已归 `src/modules/deduce/engine/`（OS-155），而模块层
 * 按门禁 S2.1 只许引 node 内置／`src/protocol/**`／自己模块目录——不许直引 `src/kernel/**`。
 * 于是把引擎需要的 fact 域能力在这里**只做 re-export**（不复制任何实现）：
 *   · 域原语：词表（FACT_SCHEMA 等）、稳定 id（stableEntryId/sha1Hex）、双时间轴
 *     （isActiveAt/normalizeSpan/intersectValidity）、别名索引（createAliasIndex）、
 *     状态机／信封校验／视角校验——实现真源 `src/kernel/fact/domain/index.mjs`；
 *     注：别名索引 `aliases.js` 不在域桶的 re-export 面里（core 的 `pediaSchema.js` 没含它），
 *     这里按引擎真实消费面单独再转出一行，不复制实现。
 *   · 事实包投影：`buildFactPack`——实现真源 `src/kernel/fact/factPack.mjs`。
 *
 * 边界：本文件是**转供**不是实现；内部协议件若要这些能力，直接引 `src/kernel/**` 更短，
 * 不必绕这一层。新增导出前先问「推演引擎真的要用吗」——协议层转供面只随真实消费方增长。
 */

export * from '../kernel/fact/domain/index.mjs'
export * from '../kernel/fact/domain/aliases.js'
export { buildFactPack } from '../kernel/fact/factPack.mjs'
