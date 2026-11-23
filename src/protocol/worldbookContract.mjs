/**
 * OS-142 Host API：世界书文件契约 v2 转供叶子。
 *
 * 转出 vendor/contracts/worldbookFileContract.js 的 parseWorldbookEntryFile——
 * 世界书条目 md 的契约判定（front matter/id/relations，MISSING_FRONTMATTER/MISSING_ID
 * 等错误码原样透传）。vendor 件逐字不动（跨层红线：core/** 与 vendor/contracts/**
 * 内容禁改写，指纹锚在 scripts/vendor-drift.mjs）。
 *
 * 原：textUtil.mjs（OS-123 fork 点）直引 vendor 契约——ARCHITECTURE.md 跨层红线 3
 * 的「仅 textUtil 及其护栏测试直引」。OS-142 模块纪律生效后，模块层不许引 src/protocol
 * 之外的本仓路径，本叶子成为唯一转供通道：textUtil 经此取契约判定，护栏测试仍直引
 * vendor 件（护栏的职责就是盯 vendor 本体）。只读、纯函数，不落盘。
 */
export { parseWorldbookEntryFile } from '../../vendor/contracts/worldbookFileContract.js'
