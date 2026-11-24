/**
 * 本机院子唯一对外门面（OS-166 / G10a＋G10c）。
 *
 * 实现落在 `src/protocol/courtyard.mjs`：协议层是模块层唯一可引的底层面（门禁 S2.1），
 * 本文件只做原样转供，宿主层与测试夹具仍从这一个路径取院子 API。
 * 新院＝%LOCALAPPDATA%/OpenStory/；旧院＝%LOCALAPPDATA%/PinaxNext/，
 * **原样保留给 Pinax 桌面端，永不删除、永不改写**。
 */
export * from '../protocol/courtyard.mjs'
