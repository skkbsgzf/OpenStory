/**
 * OpenStory 内核 · 公开面装配（openstory-kernel@1）。
 *
 * 这是 `src/kernel/**` 唯一对外出口：只向下取自持内核件，不含业务、不引任何模块层文件。
 * 消费方（协议层叶子、handler、服务）只认本文件的五组出口与身份常量，不见内核文件路径。
 *
 * 公开面（test/kernelIdentity.test.mjs 逐键锁定，新增成员必须先改那里的快照）：
 *   KERNEL_ID / KERNEL_NAME / KERNEL_VERSION —— 身份常量（identity.mjs）
 *   factStore / enrich                      —— 冻结能力组（落盘语义自带的只读/写协议面）
 *   ok / fail / writeFileAtomic             —— 最小 plumber（fork 点与写通道用）
 *
 * 谱系：2026-11-24 由 Pinax-next `feat/pinax-electron-next`@`70a4f44` 逐步转自有
 * （OS-152→157）；此后在本仓演进，上游不再同步。详见 docs/kernel-provenance.md。
 */
import { createFactFileStore, writeFactFile, readFactWiki, FACT_DIR_NAME } from './fact/factFileStore.mjs'
import { derivePseudoChapters, hasRealChapters } from './enrich/pseudoChapters.mjs'
import { causalSummary } from './enrich/metrics.mjs'
import { ok, fail } from './errors.mjs'
import { writeFileAtomic } from './atomicWrite.mjs'

export * from './identity.mjs'

/** fact 存储协议（S1 只读 list/get ＋ S2 writeFactFile 写协议＋wiki 旁挂）。 */
export const factStore = Object.freeze({ createFactFileStore, writeFactFile, readFactWiki, FACT_DIR_NAME })

/** enrich 度量（伪章推导＋因果图闭环率/耦合度/断点敏感度）。 */
export const enrich = Object.freeze({ derivePseudoChapters, hasRealChapters, causalSummary })

/** 内核 plumber 转供（纯内存/原子写原件；模块层请走 hostWrite.atomicWriteFile）。 */
export { ok, fail, writeFileAtomic }
