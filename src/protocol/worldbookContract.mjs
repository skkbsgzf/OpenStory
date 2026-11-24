/**
 * OS-142 Host API：世界书文件契约 v2 转供叶子。
 *
 * 转出 `src/modules/worldbook/worldbookFileContract.mjs` 的 parseWorldbookEntryFile——
 * 世界书条目 md 的契约判定（front matter/id/relations，MISSING_FRONTMATTER/MISSING_ID
 * 等错误码原样透传）。实现自 OS-157 起为世界书模块自有（此前逐字收编自 @pinax/core
 * 0.16.0，出处见 docs/kernel-provenance.md），落盘格式不变。
 *
 * 原：textUtil.mjs（OS-123 fork 点）直引收编契约。OS-142 模块纪律生效后，模块层不许引
 * src/protocol 之外的本仓路径，本叶子成为唯一转供通道：textUtil 经此取契约判定，护栏
 * 测试直引世界书模块的实现本体（护栏的职责就是盯格式契约本体）。只读、纯函数，不落盘。
 */
export { parseWorldbookEntryFile } from '../modules/worldbook/worldbookFileContract.mjs'
