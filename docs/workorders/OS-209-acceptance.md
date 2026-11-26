# OS-209 验收记录（监督线独立施工，2026-11-26）

**结论：通过。** 41 个模块端点停用/恢复、24 个 MCP 工具隔离链路、扮演关键动作、本机模块运行期契约全部通过。

## 交付

- `test/moduleEndpointMatrix.test.mjs`：逐个所属 workbench 停用 → 独占端点必须 409 `MODULE_DISABLED` → 恢复后不再 409；41/41 有证据。全部工作台停用后，共享 fact 端点仍返回 200。
- `test/mcpDaemon.test.mjs`：MCP 子进程通过 `OPENSTORY_PORT` 连随机端口临时 daemon；initialize、tools/list、24 工具数据映射或明确负向、章节/世界书/习惯写备份、模块停用错误信封、stdout 纯 JSON 与 EOF 清理。
- `test/roleplayEndpointMatrix.test.mjs`：会话存读、多局新建/切换/删除、最后一局拒删、导出、拍转正；pending dismiss 不写 fact、write 单条 upsert、重复 404；opening/turn 经假上游，空事实包拒绝对应 400。
- `test/moduleRuntimeContracts.test.mjs`：本机 JSON 响应合法放行，缺字段/错类型/非 JSON 在发车前拒绝；模块根确认门、相对/缺失路径、重复根、移除后路由清理；静态契约非法类型与宿主路径越界拒绝。
- 产品加固两处：
  1. `src/host/mcp.mjs`：参数校验从仅 required 扩为 required/type/enum/additionalProperties，错参统一 -32602；
  2. `src/host/daemon.mjs`＋`src/api/contracts.mjs`：本机模块 JSON 契约先缓冲校验再发，非法响应回 400 `INVALID_ENTRY`；空 response 或 `writesResponse` 的二进制/自写端点保持原语义。

## 实测

- 四张聚焦测试：10/10。
- 全量：929 例／927 过／2 跳过／0 挂。
- 验收：29/0/0；arch check、number anchors 全绿。
- 数字锚稳定：929 例（927 过／2 跳过）、108 端点、122 测试文件、`app.js` 10,044 行。
- 8807 未连接、未重启；所有库、`LOCALAPPDATA`、MCP daemon、上游均为临时夹具，退出清理。

## 安全与兼容

- 端点路径、MCP 工具名、manifest、`package.json` 版本与依赖未改。
- `public/app.js` 未增。
- 既有测试无删除、无新增 skip、无放宽断言。
