# OpenStory 升级五工具速查表（update-project）

> 真源：`src/host/mcp.mjs` 的 `tools/list`。本 skill **只声明这 5 把升级工具**；其余业务工具（建库、fact、章节…）不在本说明书权限内。
> 通用：业务错误 `isError:true`＋错误码文本；参数/schema 错误 JSON-RPC `-32602`；未知工具/方法 `-32601`。所有工具都接受 `confirm` 实参，写工具按注册表门槛强制校验；`confirm` 不转发给 daemon。

## 升级确认链（5）

| 工具 | 必填参数 | 用途 | 确认 | 写盘 |
|---|---|---|---|---|
| `openstory_upgrade_diagnose` | `root` | 只读诊断：旧布局/能力迁移现状、冲突、skipped、备份范围、风险 | read | 否（零写入） |
| `openstory_upgrade_plan` | `root` | 只读计划：产出 `planId`＋plan，绑定 root/文件哈希/迁移器摘要 | read | 否（零写入） |
| `openstory_upgrade_apply` | `root,planId` | 按已预览 planId 执行升级/迁移；`operationId` 仅回填不判重 | **migrate** | **是**（唯一写步骤） |
| `openstory_upgrade_status` | `root` | 只读：升级标记、journal、dataVersions、DATA_VERSION_AHEAD、失败/回滚、备份路径 | read | 否（零写入） |
| `openstory_upgrade_backup_verify` | `root` | 只读：.history 备份逐文件 sha256/大小，与 journal 写前哈希核对；`backup` 可选只看一份 | read | 否（零写入） |

## 调用顺序与门禁

```text
1. openstory_upgrade_diagnose {root}                              # 只读，零写入
2. openstory_upgrade_plan {root}                                  # 只读，产出 planId
3. 向作者用人话解释影响/冲突/备份/风险，等明确确认               # ← 不调用任何工具
4. openstory_upgrade_apply {root,planId,confirm:'migrate'}         # 唯一写；服务端复核摘要
5. openstory_upgrade_status {root}                                # 只读核对
6. openstory_upgrade_backup_verify {root,backup?}                  # 只读核对
```

- `confirm:'migrate'` 是 **MCP 级**确认闸，缺/低（`read`、`create`）一律业务错误 `CONFIRM_REQUIRED`；宿主 HTTP apply 使用布尔 `confirm:true`，两种入口是不同信任边界，布尔参数不能替代 MCP 等级确认。HTTP 升级端点额外参数一律 `INVALID_ENTRY`。
- `openstory_upgrade_apply` 的 schema 必填 `root` 与 `planId`；`planId` 必须是非空字符串，缺/类型错走 `-32602`。`root` 是绝对路径且须授权（本机库清单内）。
- planId 绑定一次预览时的 root / 逐文件哈希 / 迁移器摘要：预览后任何相关文件变动、`DATA_VERSION_AHEAD`、降级请求都使 planId 失效，需重新 `plan`。**planId 是一次性的**：apply 成功/失败/冲突后服务端都会删除它，同 planId 重放得到 `PLAN_NOT_FOUND`，不是幂等重放。
- `operationId` 只是调用方标识，**仅原样回填进结果**，服务端不据此判重；重试前重新 diagnose/plan 并回读结果，不要因传了同一个 id 就当作已执行成功。
- apply 复用现有 `.history` 备份/journal/原子写/回滚；失败如实报 `rolledBack` / `rollbackErrors`，不自动重试、不自动降级。

## 结果字段速查

| 字段 | 来源 | 含义 |
|---|---|---|
| `outcome` | apply | `success` / `idempotent`（无待执行项，非重放判重）/ `conflict` / `rolled-back` / `rollback-incomplete`（真源 `src/host/libraryMigrations.mjs`；无 `applied`/`up-to-date`/`duplicate` 取值） |
| `rolledBack` / `rollbackErrors` | apply | 回滚是否完成及错误；`false`＝停止上报 |
| `journals` / `backups` | apply | 相对路径，供 status/backup verify 核对 |
| `status` | status | 升级标记、journal、dataVersions、dataAhead、失败/回滚与备份路径 |
| `healthy` / `backups` / `issues` | backup verify | 备份是否齐全、逐文件核对结果、缺口如实列出 |
| `writes` | diagnose/plan/backup verify | 恒为 false；预览零写入 |

## 边界

- 本 skill 不复制迁移变换与恢复实现；规则与执行全在服务端（升级链端点）。
- 升级/迁移不得用 shell/fs 改稿或复制备份覆盖；只走上表五工具。
- 空目录建库走 `build-project`；旧目录 absorb 不开 MCP；本 skill 不承担知识库/套件配置。
