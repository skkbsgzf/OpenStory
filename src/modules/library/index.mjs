/**
 * OpenStory 库管理模块 · 公开面（模块内组合，OS-157）。
 *
 * 旧适配器解散后，`projectMeta`（project.json 合同）与 `projectImport`（整目录导入）
 * 不再经 Host API 转出：两者都是库管理模块自己的 fork 点能力，由本文件在模块内组装成
 * 冻结出口，供 libraryManage.mjs 与金样护栏 test/decoupleStep3.test.mjs 取用。
 * 实现文件逐字未动，出处见 docs/kernel-provenance.md。
 */
import { planImport, runImport } from '../../protocol/importAdapter.mjs'
import { parseChapterNumber } from '../../protocol/chapterNumber.mjs'

/** 整目录导入（源只读、只新增不覆盖、不替作者编号）。 */
export const projectImport = Object.freeze({ planImport, runImport, parseChapterNumber })

export async function activate(context) {
  context.resolve('storage.roots', { min: 1 })
  context.resolve('library.list', { min: 1 })
  context.resolve('storage.scaffold', { min: 1 })
  context.resolve('fact.store', { min: 3 })
  return { handlers: {}, pages: {}, settingsConsumers: {} }
}
