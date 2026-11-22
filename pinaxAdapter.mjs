/**
 * OS-125 解耦③：内核唯一进口（pinaxAdapter）。
 *
 * 本文件是**全仓唯一允许 import `core/**` 的仓根模块**（门禁 S2.4 钉死，
 * tools/acceptance/acceptance.mjs）。内核升版本/换实现时，只改这一个文件；
 * 消费方永远只见下面的五组能力出口，不见 core/ 路径（docs/plan/decouple-pinax-core-20261122.md §3）。
 *
 * 五组能力出口：
 *   factStore     —— fact 存储协议（S1 只读 list/get ＋ S2 writeFactFile 写协议＋wiki 旁挂）
 *   deduce        —— 确定性推演端子（开局→拍→导演动作→落定；同种子同事实包＝同一拍）
 *   enrich        —— enrich 度量（伪章推导＋因果图三指标）
 *   projectMeta   —— .pinax/project.json 合同读写（转引本仓 projectDoc.mjs，OS-124 自持）
 *   projectImport —— 整目录导入（转引本仓 importAdapter.mjs／textUtil.mjs，OS-123 自持）
 * 后两组是自有能力的统一出口——放 adapter 让消费方只有一个进口，而不是散回各 fork 点文件。
 *
 * 五组之外的最小补集（偏差注记）：`ok`/`fail`/`writeFileAtomic` 是内核 plumber，
 * projectDoc.mjs／importAdapter.mjs 两个 fork 点文件的逐字函数体依赖它们。OS-125 起
 * 这两份的 import 重指向本文件（与其 OS-123「除 import 重指向外逐字未动」同一条纪律），
 * 于是 core/ 直引归零。仅限这两个既有 fork 点使用，新模块一律走五组出口。
 *
 * 循环引用说明：projectDoc/importAdapter → 本文件（取 plumber）、本文件 → 这两份（转引
 * 五组成员）。两侧被转引的都是函数声明（模块实例化期即初始化），且任何一侧都只在函数体内
 * 使用对方出口、绝不在模块求值期调用——ESM 循环在此安全（test/decoupleStep3.test.mjs
 * 对两种加载序都做了冒烟）。
 *
 * 不在此文件的内核接触面：`@pinax/core`（npm 包，vendor tgz）的 worldbook/lexicon 契约
 * 由 textUtil.mjs 等直引——那是格式契约面，解耦规划 §4 明确「不动」，也不在 S2.4 管辖。
 */
import { createFactFileStore, writeFactFile, readFactWiki, FACT_DIR_NAME } from './core/pinax/next/kernel/factFileStore.mjs'
import { openDeduceSession } from './core/pinax/next/fact/usecases/deduce/opening.js'
import { presentTurn, applyDirectorAction } from './core/pinax/next/fact/usecases/deduce/turn.js'
import { settleChoice } from './core/pinax/next/fact/usecases/deduce/settle.js'
import { derivePseudoChapters, hasRealChapters } from './core/pinax/next/fact/usecases/enrich/pseudoChapters.mjs'
import { causalSummary } from './core/pinax/next/fact/usecases/enrich/metrics.mjs'
/* 内核 plumber 转供（见头部偏差注记；核心消费方＝projectDoc.mjs／importAdapter.mjs） */
import { ok, fail } from './core/pinax/next/kernel/errors.mjs'
import { writeFileAtomic } from './core/pinax/next/fs/atomicWrite.mjs'
/* projectMeta／projectImport：自有能力的统一出口（转引，不再包一层） */
import { readProjectDocument, writeProjectDocument, nextCarriers, validateProjectDocument } from './projectDoc.mjs'
import { planImport, runImport } from './importAdapter.mjs'
import { parseChapterNumber } from './textUtil.mjs'

/** fact 存储协议（内核 S1/S2 契约，operationId 幂等＋expectedRevision 乐观并发）。 */
export const factStore = Object.freeze({ createFactFileStore, writeFactFile, readFactWiki, FACT_DIR_NAME })

/** 确定性推演端子（内核 opening/turn/settle，引擎本身种子化，LLM 只是可选候选源）。 */
export const deduce = Object.freeze({ openDeduceSession, presentTurn, applyDirectorAction, settleChoice })

/** enrich 度量（伪章推导＋因果图闭环率/耦合度/断点敏感度，三处同口径）。 */
export const enrich = Object.freeze({ derivePseudoChapters, hasRealChapters, causalSummary })

/** `.pinax/project.json` 合同（转引本仓 projectDoc.mjs——落盘格式是与 Pinax 桌面端的双向兼容契约）。 */
export const projectMeta = Object.freeze({ readProjectDocument, writeProjectDocument, nextCarriers, validateProjectDocument })

/** 整目录导入（转引本仓 importAdapter.mjs＋textUtil.mjs——源只读、只新增不覆盖、不替作者编号）。 */
export const projectImport = Object.freeze({ planImport, runImport, parseChapterNumber })

/** 内核 plumber 转供（仅 projectDoc.mjs／importAdapter.mjs 两个既有 fork 点使用；新模块不许用）。 */
export { ok, fail, writeFileAtomic }
