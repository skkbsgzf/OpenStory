# OS-212 · operate skill 协议与货架一致性

| 项 | 值 |
|---|---|
| 批次 | OS-211～231 |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | 无 |
| 允许改动 | `src/services/skills.mjs`、`src/protocol/mcpToolSemantics.mjs`（新纯注册表）、`src/protocol/README.md`（仅补登记该新文件的一行，S2.1 要求每个协议文件逐字登记）、`src/host/mcp.mjs`（消费注册表与 category enum/说明，含 callTool 实参确认闸）、`skills/PROTOCOL.md`、`skills/README.md`、`skills/humanizer/SKILL.md`、`test/skills.test.mjs`、`test/mcp.test.mjs`、`test/mcpDaemon.test.mjs`（`deduce_present` reset:true 夹具补 confirm 等价加强＋无确认反例）、`test/pageNecessaryApi.test.mjs`（humanizer 分类等价修正）、`ARCHITECTURE.md`（仅生成段）、`docs/mcp/**`、相关门禁与数字锚 |
| 风险 | 中——协议与注入语义 |
| 状态 | 待施工 |

## 目标

让项目构建/升级说明书能作为第五类 skill 被装载，同时不获得直接执行代码或绕过 MCP 的权限。

## 任务

1. `SKILL_CATEGORIES` 增加 `operate`；PROTOCOL 明确定义：只读说明书、不产出小说内容、不执行代码、所有写操作只能调用声明的官方 MCP 工具。
2. frontmatter 增加/规整 `tools` 与确认级别语义（至少区分 read / create / migrate / restore）；加载器保留并验证形状。**安全语义违规 fail-closed：非法形状、未知/未分类工具、shell/fs 伪装、写工具无确认、只读类写工具或写确认，一律拒绝装载，不能只 warning。**
3. 新建无副作用 `mcpToolSemantics` 单一注册表：每条工具声明 `effect`、`requiredConfirm`，支持 `mutatesWhen/parameterEffects`；MCP 工具与注册表双向校验，未分类工具禁止 operate 引用。`deduce_present` 正常续拍会保存状态，`reset=true` 必须确认；无法参数化时整体按写工具。注册表是**纯声明**：不 import `node:fs`/`child_process`/`http`/`net`，不调用 `fetch`/`spawn`（S2.1 协议层约束），依赖方向是 `mcp.mjs` 与 `skills.mjs` 都从它 import；同时按 S2.1 要求在 `src/protocol/README.md` 补一行文件登记。
4. `craftInstructionBlock()` 继续只选 craft；operate 不自动注入 prompt，只能按需读取。
5. humanizer 按现有协议校正为 `transform`；检查其 YAML `allowed-tools` 与 `tools` 声明，不让 Write/Edit 语义伪装成 OpenStory 自动写权。
6. 补门禁：`SKILL_CATEGORIES` 与 PROTOCOL category 表一致；operate skill 的 tools 必须来自 MCP 注册表；只读 skill 不得声明危险写工具。
7. 清理 README 的失效 `mcp/skills/*.md` 引用、旧 `参考/` 路径与“生图未启用”等过时表述；31 内置与 2 套件捆绑技能口径写清。

## 验收

- `category: operate` 可装载，旧四类零回归，坏 category 仍拒；operate 的 tools 必须非空且全部已分类。
- 反例必须拒绝装载：写工具＋confirm:read、shell_exec、未知 openstory_nope、review/extract＋new_chapter、review/extract＋confirm:migrate。
- **实参确认闸在真实调用路径生效**：`src/host/mcp.mjs` 的 `callTool` 按注册表在参数触发写时校验 confirm 级别，缺失/不足返回 `isError:true`＋`CONFIRM_REQUIRED`（业务错误信封，不用 -32602）；不触发写时放行。`deduce_present reset:true` 必须带确认，无确认被拒有测试证明。
- 新单尚未创建 build-project/update-project 前，用临时 operate fixture 验证协议。
- humanizer 不再默认注入所有体裁 prompt；现有测试按真实分类更新，不删断言。
- 工具白名单门禁对不存在工具、危险工具、错误确认级别变红。
- 全量测试、验收、数字锚全绿；不 push。
