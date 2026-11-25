/**
 * 本机院子唯一对外门面（OS-166 / G10a＋G10c）。
 *
 * 实现落在 `src/modules/storage/courtyard.mjs`，由 storage.roots 能力持有；
 * 本文件只做宿主兼容转供，不复制路径规则。
 * 院子＝%LOCALAPPDATA%/OpenStory/；本机其余目录一律不读、不写、不删。
 */
export * from '../modules/storage/courtyard.mjs'
