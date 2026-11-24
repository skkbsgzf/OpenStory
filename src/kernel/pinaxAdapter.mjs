/**
 * OS-125 解耦③：内核唯一进口（pinaxAdapter）。
 *
 * 本文件是**全仓唯一的内核能力出口**（门禁 S2.4 钉死，tools/acceptance/acceptance.mjs）。
 * OS-156 起 `core/pinax/` 已全部转自有（写协议 store 是最后一件，落 `src/kernel/fact/`），
 * 本文件不再 import 任何 `core/**`——它只把自持内核件组装成四组能力出口；
 * 消费方永远只见下面的四组能力出口，不见内核文件路径（docs/plan/decouple-pinax-core-20261122.md §3）。
 *
 * 四组能力出口（OS-155 起；推演端子已归扮演模块，不再在此）：
 *   factStore     —— fact 存储协议（S1 只读 list/get ＋ S2 writeFactFile 写协议＋wiki 旁挂）
 *   enrich        —— enrich 度量（伪章推导＋因果图三指标）
 *   projectMeta   —— .pinax/project.json 合同读写（转引本仓 projectDoc.mjs，OS-124 自持）
 *   projectImport —— 整目录导入（转引本仓 importAdapter.mjs／textUtil.mjs，OS-123 自持）
 * 后两组是自有能力的统一出口——放 adapter 让消费方只有一个进口，而不是散回各 fork 点文件。
 *
 * OS-155：推演链（原 `deduce` 组）判为**产品引擎**而非内核能力——八件自 core 平移到
 * `src/modules/deduce/engine/`，`fact.deduce` 随之退出 Host API（host-api@2）。本文件不再引
 * 任何 core 推演文件，原先五组出口自此收窄为四组＋plumber；推演消费方（deduceEngine）改引模块内
 * `engine/index.mjs`（模块内组合，S2.1 ③ 明文允许）。
 *
 * 四组之外的最小补集（偏差注记）：`ok`/`fail`/`writeFileAtomic` 是内核 plumber，
 * projectDoc.mjs／importAdapter.mjs 两个 fork 点文件的逐字函数体依赖它们。OS-125 起
 * 这两份的 import 重指向本文件（与其 OS-123「除 import 重指向外逐字未动」同一条纪律），
 * 于是 core/ 直引归零。仅限这两个既有 fork 点使用，新模块一律走四组出口。
 * OS-138 写通道收敛补一条：hostWrite.mjs（全仓唯一写入口）也经本文件取
 * writeFileAtomic／TMP_PREFIX／syncDirectory——原子写归一是 AGENTS.md 写通道红线的落点，
 * 与上面两个 fork 点同属「最小补集」口径，其余新模块仍一律走四组出口。
 * OS-152：管道三件（errors/atomicWrite/fsDurability）已影子复制进 src/kernel/ 并改由本文件
 * 从这里取；hostWrite.mjs／kernelPlumber.mjs 同期改指 src/kernel/ 直取（不再经本文件绕道）。
 * OS-154：enrich 两件（pseudoChapters/metrics）已转自有并改指 `src/kernel/enrich/`，core 原件删除；
 * 本文件仍转出同一组函数（同一实现对象），四组出口与 core 侧的 factStore 未动（OS-155 起 deduce 已随推演链离开 adapter）。
 * OS-156：写协议 store（factFileStore，756 行）落 `src/kernel/fact/factFileStore.mjs`，core 剩余 13 件
 * 一并删除——本文件自此不 import 任何 core/**，四组出口形状与码值一个字未改（改名单在 OS-157）。
 *
 * 循环引用说明：projectDoc/importAdapter → 本文件（取 plumber）、本文件 → 这两份（转引
 * 四组成员）。两侧被转引的都是函数声明（模块实例化期即初始化），且任何一侧都只在函数体内
 * 使用对方出口、绝不在模块求值期调用——ESM 循环在此安全（test/decoupleStep3.test.mjs
 * 对两种加载序都做了冒烟）。
 *
 * 不在此文件的内核接触面：worldbook/lexicon 格式契约（OS-132 起收编进本仓
 * vendor/contracts/worldbookFileContract.js，由 textUtil.mjs 等直引）——那是格式契约面，
 * 解耦规划 §4 明确「不动」，也不在 S2.4 管辖。
 */
import { createFactFileStore, writeFactFile, readFactWiki, FACT_DIR_NAME } from './fact/factFileStore.mjs'
import { derivePseudoChapters, hasRealChapters } from './enrich/pseudoChapters.mjs'
import { causalSummary } from './enrich/metrics.mjs'
/* 内核 plumber 转供（见头部偏差注记；核心消费方＝projectDoc.mjs／importAdapter.mjs）
   OS-152：管道三件已影子复制进 src/kernel/，本处即取自持件（OS-156 起 core 原件已删）。 */
import { ok, fail } from './errors.mjs'
import { writeFileAtomic, TMP_PREFIX } from './atomicWrite.mjs'
/* OS-138：宿主写通道（hostWrite.mjs）的二进制分支要同前缀＋同目录 fsync，一并转出 */
import { syncDirectory } from './fsDurability.mjs'
/* projectMeta／projectImport：自有能力的统一出口（转引，不再包一层） */
import { readProjectDocument, writeProjectDocument, nextCarriers, validateProjectDocument } from '../modules/library/projectDoc.mjs'
import { planImport, runImport } from '../modules/library/importAdapter.mjs'
import { parseChapterNumber } from '../modules/library/textUtil.mjs'

/** fact 存储协议（内核 S1/S2 契约，operationId 幂等＋expectedRevision 乐观并发）。 */
export const factStore = Object.freeze({ createFactFileStore, writeFactFile, readFactWiki, FACT_DIR_NAME })

/** enrich 度量（伪章推导＋因果图闭环率/耦合度/断点敏感度，三处同口径）。 */
export const enrich = Object.freeze({ derivePseudoChapters, hasRealChapters, causalSummary })

/** `.pinax/project.json` 合同（转引本仓 projectDoc.mjs——落盘格式是与 Pinax 桌面端的双向兼容契约）。 */
export const projectMeta = Object.freeze({ readProjectDocument, writeProjectDocument, nextCarriers, validateProjectDocument })

/** 整目录导入（转引本仓 importAdapter.mjs＋textUtil.mjs——源只读、只新增不覆盖、不替作者编号）。 */
export const projectImport = Object.freeze({ planImport, runImport, parseChapterNumber })

/** 内核 plumber 转供（仅 projectDoc.mjs／importAdapter.mjs 两个既有 fork 点使用；新模块不许用）。 */
export { ok, fail, writeFileAtomic }
/** OS-138 写通道收敛：内核原子写的前缀与目录 fsync（OS-152 起 hostWrite.mjs 直取 src/kernel/，此处保留转出以维持旧接触面）。 */
export { TMP_PREFIX, syncDirectory }
