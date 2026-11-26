# OS-212 · operate skill 协议与货架一致性

| 项 | 值 |
|---|---|
| 批次 | OS-211～231 |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | 无 |
| 允许改动 | `src/services/skills.mjs`、`skills/PROTOCOL.md`、`skills/README.md`、`skills/humanizer/SKILL.md`、`src/host/mcp.mjs`（仅 category enum/说明）、`test/skills.test.mjs`、`test/mcp.test.mjs`、`docs/mcp/**`、相关门禁与数字锚 |
| 风险 | 中——协议与注入语义 |
| 状态 | 待施工 |

## 目标

让项目构建/升级说明书能作为第五类 skill 被装载，同时不获得直接执行代码或绕过 MCP 的权限。

## 任务

1. `SKILL_CATEGORIES` 增加 `operate`；PROTOCOL 明确定义：只读说明书、不产出小说内容、不执行代码、所有写操作只能调用声明的官方 MCP 工具。
2. frontmatter 增加/规整 `tools` 与确认级别语义（至少区分 read / create / migrate / restore）；加载器保留并验证形状，坏声明拒绝或明确 warning。
3. `craftInstructionBlock()` 继续只选 craft；operate 不自动注入 prompt，只能按需读取。
4. humanizer 按现有协议校正为 `transform`；检查其 YAML `allowed-tools` 与 `tools` 声明，不让 Write/Edit 语义伪装成 OpenStory 自动写权。
5. 补门禁：`SKILL_CATEGORIES` 与 PROTOCOL category 表一致；operate skill 的 tools 必须来自 MCP 注册表；只读 skill 不得声明危险写工具。
6. 清理 README 的失效 `mcp/skills/*.md` 引用、旧 `参考/` 路径与“生图未启用”等过时表述；31 内置与 2 套件捆绑技能口径写清。

## 验收

- `category: operate` 可装载，旧四类零回归，坏 category 仍拒。
- 新单尚未创建 build-project/update-project 前，用临时 operate fixture 验证协议。
- humanizer 不再默认注入所有体裁 prompt；现有测试按真实分类更新，不删断言。
- 工具白名单门禁对不存在工具、危险工具、错误确认级别变红。
- 全量测试、验收、数字锚全绿；不 push。
