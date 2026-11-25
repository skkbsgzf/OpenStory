/**
 * 底座契约：整目录导入的格式适配（OS-195 由 library 宿主组合面下移）。
 *
 * 纯格式判定＋源只读/目标只新增的适配逻辑，与任何工作台无关；库管理端点与金样护栏
 * 共用同一份实现。出处见 docs/kernel-provenance.md。
 */
import { planImport, runImport } from './importAdapter.mjs'
import { parseChapterNumber } from './chapterNumber.mjs'

/** 整目录导入（源只读、只新增不覆盖、不替作者编号）。 */
export const projectImport = Object.freeze({ planImport, runImport, parseChapterNumber })
export { planImport, runImport }
