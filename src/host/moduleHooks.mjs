/**
 * 宿主模块钩子（OS-161）：工作面模块「副作用注入点」的统一取用口。
 *
 * 与 daemon 端点闸（isModuleDisabledFor）互补：
 *   · 端点闸＝外部请求进来时按开关决定 200 / MODULE_DISABLED；
 *   · 本钩子＝宿主内部装配（写盘前 lint、系统提示词注入）要用模块能力时，
 *     先问 isModuleEnabled，停用时整段跳过——调用点不直接 import 模块实现，
 *     只调这里，模块停用即天然不执行。
 *
 * 这是 OS-144 分析模块「AI 味闸」的显式收口（fact handler 把
 * isModuleEnabled(root,'analysis') 作为 enabled 传给 deAiPass）；本文件让习惯的
 * 两个注入点（lint／提示词）走同一条口径，不再各自 import 习惯实现。
 *
 * 约束：钩子是宿主层组合件——可以 import 模块实现；模块实现本身仍不 reverse-import 宿主。
 */
import { isModuleEnabled } from '../protocol/modules.mjs'
import { lintHabits, readHabits } from '../modules/habits/habits.mjs'

/** 写盘前的习惯 lint（OS-59）：模块停用 → 空命中（不执行），启用 → 真跑。 */
export async function habitLint(root, text) {
  if (!(await isModuleEnabled(root, 'habits'))) return []
  return lintHabits(text, readHabits(root))
}

/** Agent 系统提示词的习惯段（OS-57）：模块停用 → null（不注入），启用 → 习惯表。 */
export async function habitsForPrompt(root) {
  if (!(await isModuleEnabled(root, 'habits'))) return null
  return readHabits(root)
}
