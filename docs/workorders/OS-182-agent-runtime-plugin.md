# OS-182 · C4 agent.runtime 件（services 收编）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 C 降级批（工作包 C4） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3 agent.runtime 件、§1.4、§3 R11、§4 批次 C |
| 依赖 | OS-181 |
| 允许改动 | `src/modules/agent/**`（新建）、`src/services/**`、`src/protocol/{upstream,agentEvents}.mjs`、`src/host/**`、`src/api/**`、`src/modules/{agentbar,kb,roleplay}/module.manifest.json`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中高（Agent 对话链路） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

`src/services/` 里属于「Agent 存储＋上游通道」的部分收编为内核件 agent.runtime（供给 `agent.runtime@1`）：Agent 存储、上游通道（OpenAI 兼容／DSH 原生／CLI kit）、LLM port、embedding。三个消费方——知识库台、扮演台、Agent 栏——走同一个能力，不再各引各的。

## 任务

1. **收编清单**（先盘后动，贴报告）：`agentConfig`、`chatUpstream`、`cli-bridge`、`dsh-bridge`、`dsh-cli`、`embedding-server`、`embeddingPaths`、`upstream`（协议）——逐个判断归 agent.runtime 件还是留 `services/`；`jobCenter`／`agentEvents` 按 ADR 结论归底座（不落盘的进程服务）。
2. **件落地**：`src/modules/agent/`（名字按协议定稿，避免与 agentbar 混淆）；manifest 声明 `agent.runtime@1`（不涉落盘格式则不带 `golden`，但 Agent 配置文件的格式要锁：凭据只存本机、响应只回掩码——这条是现有宪法，补成测试）。
3. **三消费方改接**：kb／roleplay／agentbar 的 manifest 加 `requires: [{ id: "agent.runtime", min: 1 }]`，调用点经能力路由。
4. **生图执行器**（R11，按 ADR 结论）：若 ADR 裁定单列内核件（如 `media.gen@1`），comfyui 的执行器随之迁出并声明能力；若裁定归 agent.runtime，则在此收编。两种都行，按 ADR。
5. **测试**：三消费方在停用 agent.runtime 供给时的降级行为（都应被拒且点名）；上游通道三类（OpenAI 兼容／DSH／CLI）的协议测试照绿；凭据掩码测试。

## 不做

- 不改 Agent 对话的 SSE 帧与 AG-UI 事件模型（canonical 不动）；不改任何上游协议。
- 不动 `jobCenter` 的行为（只按 ADR 决定归属，可能是「原地不动、只在文档里归位」）。

## 验收

- 全量测试与验收门禁全绿；Agent 相关测试照绿。
- `grep` 证据：kb／roleplay／agentbar 三处不再直接 import `src/services/{agentConfig,chatUpstream,cli-bridge,dsh-bridge}*`。
- 报告贴：收编清单（件内／留 services／归底座三类）。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
