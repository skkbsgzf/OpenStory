# OS-217 · MCP-only 水浒 clean-room 构建器

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 A |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-216 |
| 允许改动 | `tools/samples/**`、`tools/verify/**`、`test/**`、`fixtures/**`（如新增）、`docs/mcp/**`、相关门禁与数字锚 |
| 风险 | 高——证明新架构有效性的核心证据 |
| 状态 | 待施工 |

## 目标

证明《水浒传》可以由 agent 经 MCP 从空目录构建，而不是继续手搓样本。

## 任务

1. 新建 clean-room 构建脚本：系统临时空目录起步，启动 port:0 daemon、临时 LOCALAPPDATA、假上游；MCP 子进程注入随机端口。
2. 所有库创建、套件、习惯、世界书、fact、正文、剧本、会话、素材与导出写入必须来自 MCP 调用；禁止脚本直接 writeFile 业务内容。
3. 输入内容可来自受版本控制的构建配方/公版底稿，但落盘只能经 MCP；记录完整工具调用审计（名称、参数摘要、结果码、耗时）。
4. 逐步回读：libraries/plugins/fact books+entries/wiki/revision/chapters/reference index/session/exchange file；断言事实合法、派生版本一致、模块投影正确。
5. 产出语义 digest，排除时间戳/随机 id 等非语义字段；用于 OS-218 对比提交样本。
6. 失败时保留审计与诊断，清理临时 daemon/进程；不碰真实 8807、真库或真实院子。

## 验收

- clean-room E2E 全绿；审计中无 direct-fs 业务写入。
- 移除任一必需 MCP 原语，构建必须红；禁用世界书/fact 模块时对应工具必须红。
- 新构建 fact 逐条过 v3 校验，fact/wiki revision 一致；exchange 导出可读回。
- 不修改 `samples/水浒传`（落盘在 OS-218）；全量测试、验收、数字锚全绿。
- 不 push。
