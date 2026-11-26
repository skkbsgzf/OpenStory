# OS-221 · 迁移状态与备份产品接口

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 B |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-220 |
| 允许改动 | `src/api/contracts/**`、`src/api/handlers/**`、`src/host/libraryMigrations.mjs`、`src/host/moduleRuntime.mjs`、`src/protocol/capabilityMigration.mjs`、`src/protocol/libraryUpgrade.mjs`、`test/**`、相关文档与数字锚 |
| 风险 | 高——迁移状态与备份读取 |
| 状态 | 待施工 |

## 目标

提供专用、机器可读的迁移状态与备份校验接口，不再用整个 `/api/plugins` 代替。

## 任务

1. 新状态端点：返回升级报告、capability journal 状态、dataVersions、dataAhead、失败原因、rolledBack/rollbackErrors、备份路径。
2. 新备份端点：列升级/能力备份清单、逐文件 hash/大小、校验结果；只读，不提供任意路径下载。
3. 复用现有 `readDataVersions`、journal、upgrade marker 与 backup manifest；不得另写一套状态真源。
4. 坏 journal、缺备份、回滚未完成必须类型化，不能静默当健康。
5. 契约、错误码、HTTP 映射、root 授权与模块闸同步；凭据/正文内容不进入状态响应。

## 验收

- 成功、幂等、running、failed、recovered、done、DATA_VERSION_AHEAD 状态在真实 daemon 可读。
- 备份校验能发现缺文件/哈希不符；越权 root、任意 backupPath、路径逃逸拒绝。
- 不触发迁移、不写业务文件；现有 `/api/plugins` 保持兼容。
- 全量测试、验收、数字锚全绿；不 push。
