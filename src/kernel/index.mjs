/**
 * OpenStory 内核 · 公开面装配（openstory-kernel@1）。
 *
 * 这是 `src/kernel/**` 唯一对外出口：只向下取自持内核件，不含业务、不引任何模块层文件。
 * 消费方（协议层叶子、handler、服务）只认本文件的 plumber 出口与身份常量，不见内核文件路径。
 *
 * 公开面（test/kernelIdentity.test.mjs 逐键锁定，新增成员必须先改那里的快照）：
 *   KERNEL_ID / KERNEL_NAME / KERNEL_VERSION —— 身份常量（identity.mjs）
 *   ok / fail / writeFileAtomic             —— 最小 plumber（fork 点与写通道用）
 *
 * 谱系：2026-11-24 由 Pinax-next `feat/pinax-electron-next`@`70a4f44` 逐步转自有
 * （OS-152→157）；此后在本仓演进，上游不再同步。详见 docs/kernel-provenance.md。
 */
import { ok, fail } from './errors.mjs'
import { writeFileAtomic } from './atomicWrite.mjs'

export { KERNEL_ID, KERNEL_NAME, KERNEL_VERSION } from './identity.mjs'

/** 内核 plumber 转供（纯内存/原子写原件；模块层请走 hostWrite.atomicWriteFile）。 */
export { ok, fail, writeFileAtomic }
