# OpenStory MCP 工具速查表（build-project）

> 真源：`src/host/mcp.mjs` 的 `tools/list`。本表随 OS-216 固定为 **60 个工具**；新增/删除工具必须同步本文与门禁，不允许 ±2 误差。
> 通用：业务错误 `isError:true`＋错误码文本；参数/schema 错误 JSON-RPC `-32602`；未知工具/方法 `-32601`。所有工具都接受 `confirm` 实参，写工具按注册表门槛强制校验；`confirm` 不转发给 daemon。

## 元信息（2）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_libraries` | — | 列本机库，拿 root | read |
| `openstory_files` | `root` | 列库内目录文件；`dir` 可选 | read |

## 正文 / 剧本（7）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_novel_list_chapters` | `root` | 列章节（默认正文目录） | read |
| `openstory_novel_read_chapter` | `root,file` | 读整章 md | read |
| `openstory_novel_write_chapter` | `root,file,text` | 整章覆盖；`.history` 备份；返回 factStale | create |
| `openstory_novel_new_chapter` | `root` | 自动下一号新建；`title` 可选 | create |
| `openstory_novel_delete_chapter` | `root,file` | 挪入 `.history`，非真删 | restore |
| `openstory_chapters_rename` | `root,file,title` | 保号重命名；目标冲突拒 | create |

说明：`file` 只允许正文/剧本载体目录；世界书走 `reference_write_note`，事实走 `fact_entries_import`。

## 世界书（4）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_reference_index` | `root` | 索引 notes/tags/stats | read |
| `openstory_reference_graph` | `root` | 关系图谱 | read |
| `openstory_reference_read_note` | `root,path` | 读 `世界书/` 笔记 | read |
| `openstory_reference_write_note` | `root,file,text` | 专用端点整篇写；`.history` 备份 | create |

## 习惯（2）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_habits_read` | `root` | 读作者写作习惯 | read |
| `openstory_habits_put` | `root,habits` | 整表覆盖；仅在作者明确要求时用 | create |

## 视觉 / 生图（2）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_vision_describe` | `root,image` | 识图（需 DSH vision 运行时） | read |
| `openstory_image_generate` | `root,path,prompt` | 世界书生图并回填 frontmatter（需生图后端） | create |

## 推演 / 富化（6）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_deduce_present` | `root,bookId` | 出下一拍候选；`seed/pov` 可选；`reset:true` 清盘 | create；reset→restore |
| `openstory_deduce_settle` | `root,bookId,action` | 结算候选；`sessionId` 可选 | create |
| `openstory_enrich_run` | `root,bookId` | 启动六窗语义富化，返回 jobId；需模型 | create |
| `openstory_enrich_status` | `jobId` | 轮询富化任务 | read |
| `openstory_enrich_graph` | `root,bookId` | 读因果图等派生结果 | read |
| `openstory_fact_curve` | `root` | 章节事实曲线 | read |

## 分析（1）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_analysis_chapter` | `text` | 本地确定性文本分析，不依赖 daemon；`root?` | read |

## 技能货架（2）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_skills_list` | — | 列技能；`genre/category` 可选 | read |
| `openstory_skills_read` | `name` | 读 SKILL.md 全文与声明 | read |

## 建库 / 导入（5）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_library_create` | `path,name` | 空目录建库并登记；`primaryCarrier` 可选 | create |
| `openstory_library_diagnose` | `root` | 只读形状/版本诊断，不触发升级 | read |
| `openstory_library_scan` | `root,sourcePath` | 只读扫描旧稿出导入计划 | read |
| `openstory_library_import` | `root,sourcePath` | 按计划导入；有备份/留痕 | create |
| `openstory_library_primary` | `root,primaryCarrier` | 切主载体；`expectedRevision` 乐观锁 | create |

## 套件（3）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_suites` | — | 列套件/状态/设置；`root` 可选 | read |
| `openstory_suite_enable` | `id,enabled` | 启停套件；`root` 可选 | create |
| `openstory_suite_settings` | `id,values` | 覆盖传入设置键；`root` 可选 | create |

## 事实链（3）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_fact_books` | `root` | 列事实书 bookId/revision | read |
| `openstory_fact_entries` | `root` | 读条目；`bookId/layer/q/offset/limit` 可选 | read |
| `openstory_fact_entries_import` | `root,bookId,entries` | **整份替换**；逐条 v3 校验；备份/operationId 幂等 | create |

## exchange（2）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_exchange_export` | `root,bookId,format` | 导出；缺省只回数据，`save:true` 落盘 | read；save→create |
| `openstory_exchange_import` | `root,bookId,format,text` | 导入；`dryRun:true` 零写入 | create（即使 dryRun） |

支持格式以 daemon 契约为准：`jsonl` / `pedia/v1`；不是文档里写的任意 markdown/csv。

## 剧本互转（2）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_script_to_fact` | `root,text` | 剧本→fact 骨架；`bookId/domain` 可选；不写盘 | read |
| `openstory_script_from_fact` | `root` | fact→剧本；`bookId/entries/wiki` 可选；空条目报错 | read |

## 多局会话（6）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_sessions` | `root` | 列全部局与 activeId；`bookId` 可选 | read |
| `openstory_session_get` | `root` | 读局；`sessionId/bookId` 可选；不存在返回 session:null | read |
| `openstory_session_new` | `root` | 新建并激活；`bookId/title` 可选 | create |
| `openstory_session_switch` | `root,sessionId` | 激活已有局；`bookId` 可选 | create |
| `openstory_session_delete` | `root,sessionId` | 非破坏删除；最后一局拒删 | restore |
| `openstory_session_put` | `root,session` | 完整覆盖会话（有备份），不是补丁 | create |

## 扮演 / 推演动作（6）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_roleplay_turn` | `root` | 推进一回合；`choiceId/customText/regenerate/sessionId/bookId` 可选；实际为 `/api/deduce/turn` | create |
| `openstory_roleplay_archive` | `root` | 归档一章到扮演目录 | create |
| `openstory_roleplay_export` | `root` | 导出会话 md | create |
| `openstory_roleplay_promote` | `root,nodeId` | 节点转正文；空正文拒绝 | create |
| `openstory_roleplay_pending` | `root,pendingId` | 结算已有卡：write/dismiss；重复卡 NOT_FOUND | create |
| `openstory_roleplay_branch` | `root,fromNodeId` | 从节点开分支 | create |

## 素材（3）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_assets` | `root` | 盘点 characters/scenes/bgm；目录不存在是空态 | read |
| `openstory_asset_read` | `root,path` | 读 `.png/.mp3`（≤16MB）→ mediaType/bytes/dataUrl | read |
| `openstory_asset_put` | `root,path,dataBase64` | 受限写入 PNG/MP3；验签名、≤16MB；`overwrite` 覆盖前备份 | create |
| `openstory_deduce_image` | `root,name,prompt` | 推演场景生图（需后端） | create |

## 插件投影（1）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_plugins` | — | 读 plugins/modules/moduleGraph/slots/能力报告；`root` 可选 | read |

## 多角色扮演（2）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_roleplay_opening` | `root,pov` | 多角色扮演开场（需模型，保存 roleplay 节点） | create |
| `openstory_roleplay_scene_turn` | `root,pov,playerAction` | 多角色扮演一回合（需模型，区别于推演 turn） | create |

## 界面状态（1）

| 工具 | 必填参数 | 用途 | 确认 |
|---|---|---|---|
| `openstory_ui_state` | `root,state` | 合并写库 ui-state；经能力图事务并留备份 | create |

## 完成检查单

- [ ] 目标 root 已由 `libraries` 确认，`diagnose` 通过。
- [ ] 所有写调用都带作者授权的 `confirm`；无 shell/fs 旁路。
- [ ] 套件状态回读一致；未把套件启停冒充模块启停。
- [ ] 世界书走专用端点；事实走 fact 写协议；正文只落载体目录。
- [ ] fact 全合法，整份替换前读过旧 revision，operationId 可重放。
- [ ] fact/wiki 派生 revision 与主档一致。
- [ ] 章节/剧本/会话/素材/exchange 文件逐一回读。
- [ ] enrich/扮演/识图/生图如实区分真实模型成功、不可用、未覆盖。
- [ ] 业务失败保留错误码与诊断；不伪造 200/空正文为成功。
