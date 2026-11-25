/**
 * 本机院子唯一对外门面（OS-166 / G10a＋G10c）。
 *
 * 实现落在 `src/modules/storage/courtyard.mjs`，由 storage.roots 能力持有；
 * 本文件只做宿主兼容转供，不复制路径规则。
 * 新院＝%LOCALAPPDATA%/OpenStory/；旧院＝%LOCALAPPDATA%/PinaxNext/，
 * **原样保留给 Pinax 桌面端，永不删除、永不改写**。
 */
export * from '../modules/storage/courtyard.mjs'
