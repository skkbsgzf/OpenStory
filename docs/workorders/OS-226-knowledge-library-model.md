# OS-226 · 知识库清单、文档与定制模型

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 C |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-225 |
| 允许改动 | `src/modules/knowledge-base/**`、`knowledge-packs/**`、`src/protocol/courtyard.mjs`（如必须）、`src/api/contracts/knowledgeBase.mjs`、`test/knowledge*.test.mjs`、`docs/protocol/**`、相关数字锚 |
| 风险 | 高——系统级资产与磁盘契约 |
| 状态 | 待施工 |

## 目标

建立跨项目知识库的登记、内容、版本、定制与状态模型，供独立工作台和 HyperGraphRAG 使用。

## 任务

1. 系统级清单 `openstory.knowledge-library@1`：id/name/description/source/root/manifest/enabled/createdAt/updatedAt/activeLibraryId；路径只经 courtyard 解析。
2. 单库 manifest `openstory.knowledge-base@1`：版本、vendor、license、文档入口、格式/排除规则、检索默认值、标签/节点映射。
3. 文档模型：Markdown/frontmatter/tags/双链/摘要/反链；内容 hash、整套 content revision、索引 hash；源文件只读。
4. 定制：显示名、描述、标签、节点/边映射、检索 topK/minScore/预算、排除规则；不存密钥/正文副本。
5. 状态：模块启停继续 ui-state；知识库 enabled/active 用机器级 state；不复用作品 suite-state。
6. 开源种子知识包：修仙、都市、西幻、宫斗等小型示例，许可清楚；不默认打包作者私有 skills/Qbook 内容。
7. 登记预览/确认、坏档拒绝覆盖、原子写、history/log（非敏感元数据）与路径/symlink 越界测试。

## 验收

- 两份临时知识库可登记、启用/停用、切换、定制；源目录 hash 不变。
- 坏清单/坏 manifest/路径逃逸/symlink/重复 id 有明确错误；active 状态跨作品库不漂移。
- 种子包可被公开分发包包含；凭据、作者私有内容、本机路径不入库。
- 全量测试、验收、数字锚全绿；不 push。
