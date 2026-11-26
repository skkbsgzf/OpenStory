# OS-230 · 真实 HyperGraphRAG 安装与黄金语料验收

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 C |
| 执行 | workflow 施工；dsv4flash；hy4flash 评审 |
| 依赖 | OS-229 |
| 允许改动 | `tools/knowledge-runtime/**`、`knowledge-packs/**`（黄金语料）、`src/modules/knowledge-runtime/**`、`test/hypergraph*.test.mjs`、`docs/KNOWLEDGE-RUNTIME.md`、`docs/ACCEPTANCE.md`、相关数字锚 |
| 风险 | 高——真实引擎质量与可安装性 |
| 状态 | 待施工 |

## 目标

证明 HyperGraphRAG 不是只有假 sidecar 绿，而是固定版本可安装、可检索、来源正确。

## 任务

1. 固定 runtime commit、版本、Python 依赖 lock 与哈希；提供显式安装命令、健康检查、版本不符提示。
2. 四题材小规模黄金语料：修仙、都市、西幻、宫斗；预定义 query→应命中文档/来源，覆盖技法、套路、人物、设定。
3. 评测 recall/precision、来源正确率、查询延迟、索引构建时间/体积；记录机器可读报告。
4. 内容更新→stale→重建→fresh 全链；构建失败不发布半成品；取消/超时可恢复。
5. 默认切到 HyperGraphRAG；WeKnora 保留显式可选 provider。无 runtime 时明确安装指引，不静默降级到别的引擎。

## 验收

- 真实 worker 安装与 health 通过；黄金语料达到工单约定的最低来源正确率/recall，不达则如实报未通过。
- 报告含 runtime hash、语料 hash、逐 query 结果与失败样本；可复跑。
- 普通 npm test 不依赖真实模型/下载；真实评测作为独立门禁。
- 不 push；全量测试、验收、数字锚全绿。
