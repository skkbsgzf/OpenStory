/**
 * 底座门面（以 pinax-core 为原型的抽取层）——OpenStory 用到的底座面，从这里出。
 * 现状：逐字 vendor 自 Pinax-next@70a4f44（映射见 scripts/vendor-core.mjs、清单见 core/VENDORED.md）；
 * 后续按 pinax-core 的抽包节奏把这一层升格为独立发布的底座包。
 */
export { createRegistry } from './pinax/next/kernel/pluginRegistry.mjs'
export { PROJECT_KINDS } from './pinax/next/kernel/projectSkeleton.mjs'
export { createProject, initBareProject } from './pinax/next/project/createProject.mjs'
export { createCarrierRegistry, CARRIER_IDS } from './carrierBootstrap.mjs'
