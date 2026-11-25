// OS-123 解耦①：文本解析工具自持层（fork 点，归本仓所有）。
// 谱系：函数体逐字拷贝自 Pinax-next `feat/pinax-electron-next`@`70a4f44` 的
// 章节号解析与世界书条目投影实现（2026-11-24 转自有，出处见 docs/kernel-provenance.md）。
// OS-157：parseChapterNumber 上移协议层 chapterNumber.mjs；原逐字收编自 @pinax/core
// 0.16.0 的契约判定见出处文档。
// OS-195：纯函数下沉底座契约 `src/protocol/libraryTextUtil.mjs`，本模块只转供、不复制实现。
export * from '../../protocol/libraryTextUtil.mjs'
