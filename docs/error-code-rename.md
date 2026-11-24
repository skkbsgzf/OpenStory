# 错误码改名对照表（旧 → 新）

OS-157（2026-11-24，作者裁定 C）：内核 25 个错误码去掉旧品牌前缀，与宿主 `API_ERROR_CODES`
同一命名法。这是**对外 `code` 字符串的一次性变更**，不做双发兼容；外部调用方（MCP 客户端、
脚本、前端常量）按本表改一次即可。错误语义、触发条件、落盘格式均未改变。

| # | 旧码 | 新码 | 语义与宿主同名词核对 |
|---:|---|---|---|
| 1 | `PINAX_INVALID_MANIFEST` | `INVALID_MANIFEST` | 无宿主同名码；库管理映射为 `INVALID_ENTRY` |
| 2 | `PINAX_DUPLICATE_PLUGIN` | `DUPLICATE_PLUGIN` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 3 | `PINAX_KERNEL_INCOMPATIBLE` | `KERNEL_INCOMPATIBLE` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 4 | `PINAX_RESERVED_SLOT` | `RESERVED_SLOT` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 5 | `PINAX_TOOL_CONFLICT` | `TOOL_CONFLICT` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 6 | `PINAX_UNKNOWN_CAPABILITY` | `UNKNOWN_CAPABILITY` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 7 | `PINAX_DIR_CONFLICT` | `DIR_CONFLICT` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 8 | `PINAX_SCOPE_NOT_GRANTED` | `SCOPE_NOT_GRANTED` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 9 | `PINAX_SCOPE_OUTSIDE_OWNER` | `SCOPE_OUTSIDE_OWNER` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 10 | `PINAX_RESERVED_VIEW_TYPE` | `RESERVED_VIEW_TYPE` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 11 | `PINAX_UNKNOWN_SUBSCRIPTION` | `UNKNOWN_SUBSCRIPTION` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 12 | `PINAX_INVALID_ENTRY` | `INVALID_ENTRY` | 与宿主 `INVALID_ENTRY` 语义一致，已合一 |
| 13 | `PINAX_INVALID_SERVICE` | `INVALID_SERVICE` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 14 | `PINAX_INVALID_MCP` | `INVALID_MCP` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 15 | `PINAX_INVALID_EFFECT` | `INVALID_EFFECT` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 16 | `PINAX_EFFECT_ON_DISPOSED` | `EFFECT_ON_DISPOSED` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 17 | `PINAX_PATH_OUTSIDE_PROJECT` | `PATH_OUTSIDE_PROJECT` | 语义＝宿主 `PATH_ESCAPE`，在 `libraryManage.mapManageError` 显式对应 |
| 18 | `PINAX_STALE_REVISION` | `STALE_REVISION` | **语义同宿主 `REVISION_MISMATCH` 但不同名**，在 `chapterWrite.mapWriteErrorCode` 与 `libraryManage.mapManageError` 两处显式对应 |
| 19 | `PINAX_DEPENDENCY_UNMET` | `DEPENDENCY_UNMET` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 20 | `PINAX_PRIMARY_CARRIER_MISSING` | `PRIMARY_CARRIER_MISSING` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 21 | `PINAX_PRIMARY_CARRIER_NOT_ENABLED` | `PRIMARY_CARRIER_NOT_ENABLED` | 无宿主同名码；映射为 `INVALID_ENTRY` |
| 22 | `PINAX_IO_FAILED` | `IO_FAILED` | 语义＝宿主 `WRITE_PROTOCOL_IO_FAILED`，裸码路径（如 `/api/fact/entries/import`）会原样透出 |
| 23 | `PINAX_INVALID_INPUT` | `INVALID_INPUT` | 与宿主 `WRITE_PROTOCOL_INVALID_INPUT` 在 `mapWriteErrorCode` 显式对应；未知内核码也回落到本码 |
| 24 | `PINAX_FACT_NOT_FOUND` | `FACT_NOT_FOUND` | 与宿主 `NOT_FOUND`（写协议侧 `WRITE_PROTOCOL_NOT_FOUND`）语义相近，按通道分别映射 |
| 25 | `PINAX_WRITE_PROTOCOL_NOT_STARTED` | `WRITE_PROTOCOL_NOT_STARTED` | 无宿主同名码；语义＝「写协议尚未开放」，不是写失败 |

## 同步改名的本地环境变量（双读兼容一个大版本）

| 旧名 | 新名 | 消费者 |
|---|---|---|
| `PINAX_OS_PREFERENCES` | `OPENSTORY_PREFERENCES` | `src/host/authorize.mjs`（新名优先、旧名仍认，命中旧名每进程打一条 deprecation 日志） |
| `PINAX_OS_FIXTURE` | `OPENSTORY_FIXTURE` | `test/contracts.test.mjs` 的 291 条真实夹具库用例（同上双读） |

金样 `test/kernelPlumber.test.mjs` 的码表 × `fail()` 全矩阵 sha256 摘要随本表改名重取
（旧摘要 `037fdac7038d546ef3d35c002c6e275ff0d0b04fc755a0d00766d88a42c7c2fe`，
新摘要 `dd3e8347151a2adba2a9a0d2d0ae03b6cebc24b05c4be2527118a55ee0cfc54e`）：
矩阵条目与语义逐条不变，只有 `code` 字符串按上表更新。
