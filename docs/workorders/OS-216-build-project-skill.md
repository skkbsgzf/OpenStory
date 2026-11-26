# OS-216 · 官方 build-project skill

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 A |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-212、OS-213、OS-215 |
| 允许改动 | `skills/build-project/**`、`src/services/skills.mjs`（如必须）、`src/host/mcp.mjs`（instructions/说明）、`test/skills.test.mjs`、`test/mcpDaemon.test.mjs`、`docs/mcp/**`、相关门禁与数字锚 |
| 风险 | 中——官方操作说明书 |
| 状态 | 待施工 |

## 目标

任何外部 agent 首次接入 OpenStory，仅凭本 skill 与 MCP 工具即可从空目录构建一个可用项目。

## 任务

产出 `skills/build-project/SKILL.md` 与 `references/tool-cheatsheet.md`：

1. 总纲：库=项目、daemon/MCP 薄适配关系、manifest/能力图、carrier 与磁盘布局。
2. 工具分域说明书：以真实 tools/list 为准，逐工具写何时用、参数、返回、错误、备份与确认。
3. 读写红线：读自由；写有备份；absorb 与 Agent 对话永不开 MCP；不手改盘、不复制 history 覆盖、不删除 retired。
4. 构建剧本：诊断/建库→套件→习惯→世界书→合法 fact→enrich→正文/剧本→多局扮演→素材→exchange 导出→逐步回读断言。
5. 幂等与失败恢复：operationId、revision、jobId、模块停用、能力降级、DATA_VERSION_AHEAD、DAEMON_UNREACHABLE。
6. 一页速查表与完成检查单；内容与当前 MCP 行为逐字核对，不沿用规划稿中的旧数字。

## 验收

- `openstory_skills_list` 能列出、`openstory_skills_read` 能读全文；frontmatter 过 operate 协议。
- skill 声明的每个工具真实存在；危险工具/未声明工具门禁变红。
- 说明书可指导第三方 agent 走通 OS-217 的 clean-room 构建全绿项；本单不实际生成 sample。
- 不 push；全量测试、验收、数字锚全绿。
