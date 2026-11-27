# 阶段 A 收口报告 · MCP 构建闭环与《水浒传》重建

日期：2026-11-27。范围：OS-211～219。状态：**本地全量门禁通过，未 push、未 tag**。

## 交付

| 工单 | 结果 | 提交 |
|---|---|---|
| OS-211 写边界与 fact 完整性 | 章节只写载体目录；世界书专用端点；patch.entries 逐条校验；fact/wiki revision 对齐；syncCheck 真消费派生版本 | `a40b877` |
| OS-212 operate skill 协议 | 第五类 operate、工具/确认语义、fail-closed 装载、frontmatter 引号键与行内注释 | `a40b877` |
| OS-213 MCP 构建原语 I | 建库/诊断/导入、套件、fact、exchange 共 13 工具；确认闸收紧为无条件写必须确认 | `4a9da93` |
| OS-214 剧本服务端化 | 剧本解析/互转下沉到 `src/modules/script/`；两个 HTTP 端点；浏览器共享纯模块精确静态路由 | `69adfc7` |
| OS-215 MCP 构建原语 II | 剧本/多局/动作/素材共 18 工具 | `26c0e01` |
| OS-216 build-project | 官方 operate skill、60 工具速查表、构建红线与失败恢复 | `dc40f9c` |
| OS-217 clean-room 前置与构建器 | 素材受限写入、plugins 回读、多角色扮演 opening/turn、ui-state；MCP-only 构建器与审计 | 本批收口提交 |
| OS-218 新水浒样本 | 完整保留 18 篇世界书、7 条合法 fact、6 节点会话、归档、剧本、exchange、4 个素材 | 本批收口提交 |
| OS-219 文档与 CI | 60 工具文档双向门禁；CI 加结构自检与 MCP-only clean-room；清理旧 24 工具口径 | 本批收口提交 |

## 核心证据

- MCP 工具：**60**；语义注册表与 tools/list 逐名一致。
- clean-room：从临时空目录经 **77 次真实 MCP 调用**完成建库→套件→习惯→世界书→fact→正文/剧本→会话/多局→归档→素材→exchange→plugins/ui-state 回读。
- 语义 digest：`d620558b78389a6f8a71a428c10d76706ebc017d4b17f6502f309993a0d5c29f`。
- 新样本：7/7 fact 过 `fact.data/v3`；主档 revision 与 wiki `derivedFrom.factRevision` 均为 1。
- 缺工具负向：移除 `openstory_library_create` / `fact_entries_import` / `reference_write_note` / `asset_put` 均让构建失败。
- 样本洁净：无 `.history`、`.openstory/log`、临时文件、凭据或本机绝对路径；替换前同盘备份，失败可回滚。

## 门禁

| 门禁 | 结果 |
|---|---|
| `npm test` | **983 例 / 981 过 / 2 跳过 / 0 挂** |
| acceptance | **29 过 / 0 挂 / 0 警** |
| arch-stats --check | 通过 |
| number-anchors --check | 通过（983 例／29 门禁／112 端点） |
| CI workflow 结构 | 通过 |
| 隔离全栈 E2E | 通过 |
| MCP clean-room E2E | 通过（77 调用／60 工具／digest 稳定） |
| 浏览器 smoke＋report | **34/34 通过**，截图齐全，无脚本错误 |
| sampleConfig | 5/5 通过 |

## 明确未覆盖

- clean-room 的多角色扮演使用**假文本上游**，只验证协议与落盘；`semanticModelVerified:false`。
- enrich、真实扮演正文、vision、生图的真实模型语义未在本批验收。
- `.jsonl` exchange 文件仍不在 `openstory_files` 文本清单内；clean-room 使用可回读的 `pedia/v1` JSON 格式验收。
- 未 push、未 tag、未触碰生产 8807 或作者真库。

## 提交谱系（本地，未 push）

- `a40b877` OS-211/212
- `4a9da93` OS-213
- `69adfc7` OS-214
- `26c0e01` OS-215
- `dc40f9c` OS-216
- `62f2df8` OS-217～219 收口
