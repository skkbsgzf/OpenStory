/**
 * fact.data/v2 domain 桶（OS-153 影子迁移：逐字复制自 core/pinax/next/fact/domain/pediaSchema.js）。
 *
 * 只做 re-export：词表、稳定 id、状态机、双时间轴、信封校验、视角校验各在自己文件里。
 * 文件名去掉 vendor 谱系名（pediaSchema → index），re-export 面与 core 原件逐字相同（导出名/顺序不变）。
 */

export * from './vocabulary.js'
export * from './stableId.js'
export * from './status.js'
export * from './validity.js'
export * from './schema.js'
export * from './perspective.js'
