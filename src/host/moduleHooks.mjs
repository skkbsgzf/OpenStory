/**
 * 宿主模块钩子（OS-161 立，OS-195a 收口）——工作面模块「副作用注入点」的唯一取用口。
 *
 * 与 daemon 端点闸（isModuleDisabledFor）互补：
 *   · 端点闸＝外部请求进来时按开关决定 200 / MODULE_DISABLED；
 *   · 本钩子＝宿主内部装配（写盘前 lint、系统提示词注入、KB 探活、世界书索引）要用模块
 *     能力时，只从贡献表取——模块停用即贡献消失，调用点不静态 import 任何模块实现。
 *
 * OS-195a：本文件不再是第二套注册方式。钩子由各模块 activate() 贡献在
 * `contribution.hooks`，钩子名登记在 `src/protocol/moduleActivation.mjs`；宿主经
 * `src/host/handlerTable.mjs` 的 hooksFor() 按库快照取（与 handlerFor 同一张表）。
 */

import { hooksFor } from './handlerTable.mjs'

/** 写盘前的习惯 lint（OS-59）：模块停用 → 空命中（不执行），启用 → 真跑。 */
export async function habitLint(root, text) {
  const hooks = await hooksFor(root, 'beforeWrite')
  const results = await Promise.all(Object.values(hooks).map((fn) => fn(root, text)))
  return results.flat()
}

/** Agent 系统提示词的习惯段（OS-57）：模块停用 → null（不注入），启用 → 习惯表。 */
export async function habitsForPrompt(root) {
  const hooks = await hooksFor(root, 'promptContext')
  return typeof hooks.habits === 'function' ? (await hooks.habits(root)) ?? null : null
}

/** KB 先例片段（KB-ARCH P0）：知识库模块停用 → 不注入。 */
export async function precedentPromptSection(root, genre, options) {
  const hooks = await hooksFor(root, 'promptContext')
  return typeof hooks.knowledge === 'function' ? (await hooks.knowledge(root, genre, options)) ?? null : null
}

/** 独立知识库检索：knowledge-base 停用＝不注入；失败由宿主降级为不注入。 */
export async function knowledgeBaseReferences(root, options = {}) {
  const hooks = await hooksFor(root, 'promptContext')
  return typeof hooks.knowledgeBase === 'function' ? (await hooks.knowledgeBase(root, options.genre, options)) ?? null : null
}

/** 世界书索引段（OS-45）：世界书模块停用 → 不注入；只给路径不给全文的口径在模块内。 */
export async function worldbookPromptSection(root, options) {
  const hooks = await hooksFor(root, 'promptContext')
  return typeof hooks.worldbook === 'function' ? (await hooks.worldbook(root, options)) ?? null : null
}

/** 世界书索引（供宿主 syncCheck 取 mtime）：模块停用 → 空 notes。 */
export async function referenceIndexFor(root) {
  const hooks = await hooksFor(root, 'referenceIndex')
  return typeof hooks.worldbook === 'function'
    ? await hooks.worldbook(root)
    : { notes: [], tags: [], backlinks: [] }
}

/** 启动钩子（KB 探活）：知识库模块停用 → 不启动；返回各模块的停表函数。 */
export async function startupHooks(options) {
  const hooks = await hooksFor('', 'startup')
  const stops = await Promise.all(Object.values(hooks).map((fn) => fn(options)))
  return stops.filter((stop) => typeof stop === 'function')
}
