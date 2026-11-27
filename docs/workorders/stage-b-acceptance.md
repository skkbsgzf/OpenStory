# 阶段 B 验收报告 · update-project 与版本冲突安全链

日期：2026-11-27。范围：OS-220～224。执行方式：workflow 停止后，由监督线按已批准 plan 直接完成并独立验收。未 push、未 tag。

## 交付

| 工单 | 结果 | 核心证据 |
|---|---|---|
| OS-220 只读诊断与计划 | 完成 | `src/protocol/upgradePlan.mjs` 纯核心；`diagnoseLibraryUpgrade` 虚拟树预览；capability 文件与迁移器摘要进入整库 bindings；阻断冲突/虚拟树读失败进入计划 |
| OS-221 状态与备份 API | 完成 | `GET /api/library/migration-status`、`GET /api/library/migration-backups` 专用只读端点；journal 完整形状校验；旧 failed 兼容口径统一；目录不可读类型化 |
| OS-222 确认执行与 MCP | 完成 | 五个 MCP 升级工具；apply 必须 `confirm:'migrate'`；HTTP 额外参数拒绝；plan 漂移/确认缺失/备份失败零写入；复用 journal/备份/回滚 |
| OS-223 update-project skill | 完成 | 恰好五把工具、`confirm:migrate`；diagnose→plan→作者确认→apply→status→backup verify；不复制迁移/恢复实现 |
| OS-224 迁移 E2E 与 CI | 完成 | `tools/verify/verify-upgrade-e2e.mjs` 24 项检查全绿；23 个失败注入点均 rolledBack 且业务树逐字节复原；CI 增加独立步骤与结构门禁 |

## 关键安全性质

- **预览零写入**：diagnose/plan 前后整库文件树与字节哈希完全一致；不创建 `.history`、不写 marker、不跑能力迁移。
- **计划漂移**：planId 绑定 root、受影响业务文件与迁移器摘要；仅修改 capability 目标数据文件也会 `PLAN_STALE`。
- **确认分层**：MCP apply 需 `confirm:'migrate'`；宿主 HTTP apply 需布尔 `confirm:true`；两种入口不能互相替代。
- **拒绝零写入**：缺/低确认、无计划、错 planId、过期计划、额外参数、阻断冲突、`DATA_VERSION_AHEAD`、备份失败均在执行业务写前拒绝。
- **回滚如实**：失败恢复成功报 `rolledBack:true`；恢复失败报 `rolledBack:false` 与逐条 `rollbackErrors`，不自动重试、不复制备份覆盖。
- **观测只读**：status/backup verify 不调用会执行迁移的 `prepareLibraryMigrations`；坏 journal/缺备份/哈希不符类型化呈现。

## 门禁结果

| 门禁 | 结果 |
|---|---|
| `npm test` 第一轮 | **1017 例 / 1015 过 / 2 跳过 / 0 挂** |
| `npm test` 第二轮 | **1017 例 / 1015 过 / 2 跳过 / 0 挂** |
| acceptance | **29 过 / 0 挂 / 0 警** |
| arch-stats --check | 通过 |
| number-anchors --check | 通过（1017 例／29 门禁／117 端点） |
| CI workflow 结构 | 通过 |
| 独立升级迁移 E2E | **24/24 通过** |
| 既有隔离 E2E | 通过 |
| MCP clean-room E2E | 通过（60 工具；假上游语义边界如实标注） |

## 明确边界

- 升级预览会对**受信任本机模块**执行装载/`activate()`，当前信任模型不提供进程级沙箱；不得对不可信代码承诺绝对零副作用。
- 未覆盖真实作者旧库迁移；全部验证使用系统临时库与临时 `LOCALAPPDATA/APPDATA`。
- 未 push、未 tag、未连接或重启生产 8807，版本保持 `0.2.0`。
