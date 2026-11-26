# OS-220 · 只读升级诊断与计划核心

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 B |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | 无 |
| 允许改动 | `src/protocol/libraryUpgrade.mjs`、`src/protocol/capabilityMigration.mjs`、`src/host/libraryMigrations.mjs`、`src/host/moduleRuntime.mjs`、新升级计划模块、`test/libraryUpgrade.test.mjs`、`test/capabilityMigration*.test.mjs`、相关文档与数字锚 |
| 风险 | 高——升级前预览必须零写入 |
| 状态 | 待施工 |

## 目标

把现有迁移逻辑变成作者可读、机器可校验的执行前计划，而不是第一次业务请求后才知道发生了什么。

## 任务

1. 抽取/复用 `inspectLegacy`、`transformStoredJson`、capability migration 计划生成，提供纯只读 diagnose/plan。
2. plan 至少含：planId、root 授权指纹、旧/新 spec/carrier、目录操作、文件改写、冲突、skipped（文件+行）、备份范围、风险、迁移器 entry/hash、预计 journal 路径。
3. planId 绑定受影响文件哈希与迁移器摘要；执行前可检测预览后漂移。
4. preview 不得创建 `.history`、`.openstory/migrations`、upgrade marker、sync-state 或任何业务文件；允许进程内缓存计划。
5. 旧库升级与 capability migration 分节报告；DATA_VERSION_AHEAD 只报告，不自动 down migration。

## 验收

- preview 前后整库文件树与字节哈希完全一致。
- 旧目录、坏 JSON/JSONL、键冲突、同名文件、能力版本超前均有明确计划项。
- planId 稳定可复现；相同输入得到相同语义计划（排除时间戳）。
- 既有自动升级与 migration 测试零回归；全量测试、验收、数字锚全绿。
- 不 push。
