/**
 * 本机院子唯一对外门面（OS-166 / G10a＋G10c）。
 *
 * 实现落在 `src/modules/storage/courtyard.mjs`，由 storage.roots 能力持有；
 * 本文件经 protocol/courtyard.mjs 转供，不复制路径规则，也不直取内核模块
 * （OS-193 台账 host→内核 1→0 的最后一笔，按 OS-194 清零）。
 * 院子＝%LOCALAPPDATA%/OpenStory/；本机其余目录一律不读、不写、不删。
 */
export * from '../protocol/courtyard.mjs'
