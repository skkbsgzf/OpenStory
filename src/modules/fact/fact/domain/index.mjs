/**
 * OpenStory 内核 · fact 域桶（openstory-kernel@1）。
 *
 * 谱系：2026-11-24 逐字复制并去谱系名（pediaSchema → index）转自有，出处见
 * docs/kernel-provenance.md；此后在本仓演进，上游不再同步。落盘格式不变。
 *
 * 只做 re-export：词表、稳定 id、状态机、双时间轴、信封校验、视角校验各在自己文件里。
 */

export * from './vocabulary.js'
export * from './stableId.js'
export * from './status.js'
export * from './validity.js'
export * from './schema.js'
export * from './perspective.js'
