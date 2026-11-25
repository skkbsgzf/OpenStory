/**
 * OpenStory 世界书模块 · 世界书文件md格式契约（世界书条目 frontmatter/关系读写）。
 *
 * 谱系：2026-11-23 由 @pinax/core 0.16.0（pinax-core 仓 `e56a0bc`）的
 * `src/domain/worldbookFileContract.js` 逐字收编（OS-132），2026-11-24 转本仓自有（OS-157）。
 * 实现本体逐字未动；仅本头注释按 OpenStory 出处口径改写。此后在本仓演进，上游不再同步；
 * 出处与转有时的文件对应关系见 docs/kernel-provenance.md。
 *
 * 落盘格式不改：`世界书/*.md` 的世界书条目契约（worldbook-file@2）。
 * 格式对 Pinax 运行时往返无损；`relations:` 缩进对象列表 = Pinax 富关系；
 * index.json 的 list 型 section 顺序含 Pinax 扩展 资料。
 *
 * OS-195：与任何工作台无关的格式判定已下沉为底座契约 `src/protocol/worldbookContract.mjs`，
 * 本模块只转供，不复制实现；调用方（导入/世界书/护栏）经底座契约取同一份判定。
 */
export * from '../../protocol/worldbookContract.mjs'
