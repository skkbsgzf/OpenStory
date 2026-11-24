/**
 * OpenStory 库管理模块 · 公开面（模块内组合，OS-157）。
 *
 * pinaxAdapter 解散后，`projectMeta`（project.json 合同）与 `projectImport`（整目录导入）
 * 不再经 Host API 转出：两者都是库管理模块自己的 fork 点能力，由本文件在模块内组装成
 * 冻结出口，供 libraryManage.mjs 与金样护栏 test/decoupleStep3.test.mjs 取用。
 * 实现文件逐字未动，出处见 docs/kernel-provenance.md。
 */
import { readProjectDocument, writeProjectDocument, nextCarriers, validateProjectDocument } from './projectDoc.mjs'
import { planImport, runImport } from './importAdapter.mjs'
import { parseChapterNumber } from '../../protocol/chapterNumber.mjs'

/** `.pinax/project.json` 合同（落盘格式是与桌面端的双向兼容契约）。 */
export const projectMeta = Object.freeze({ readProjectDocument, writeProjectDocument, nextCarriers, validateProjectDocument })

/** 整目录导入（源只读、只新增不覆盖、不替作者编号）。 */
export const projectImport = Object.freeze({ planImport, runImport, parseChapterNumber })
