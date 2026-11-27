/**
 * 剧本 ↔ fact 互转（OS-78 前端入口 · OS-214 起转发到服务端真源）。
 *
 * 真源已下沉到 `src/modules/script/scriptFact.mjs`——同一份确定性算法既供浏览器用，
 * 也供 daemon 的 `POST /api/script/to-fact` / `POST /api/script/from-fact` 用。
 * 这里只做 re-export，不保留第二份实现（曾经唯一生产路径是浏览器私有逻辑，MCP/HTTP
 * 都调不到；OS-214 修的正是这一点）。
 *
 * 方向 A：剧本 → fact 条目（幕/角色/场景三类骨架，id 用 stableEntryId 同算法）。
 * 方向 B：fact 条目 → 剧本文本（plot.events 与 character.anchors.speech 反向渲染）。
 *
 * 硬约束不变：双向不丢信息、不做 LLM 调用、fact 侧字段必须过 schema。
 */

export { scriptToFact, factToScript } from '../src/modules/script/scriptFact.mjs'
