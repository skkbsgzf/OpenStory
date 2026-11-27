# 阶段 C 收口报告 · 独立知识库与 HyperGraphRAG

日期：2026-11-27。范围：OS-225～231。执行方式：按已批准 plan 由监督线直接施工；未使用 workflow。未 push、未 tag，版本保持 `0.2.0`。

## 交付

| 工单 | 结果 | 核心证据 |
|---|---|---|
| OS-225 中性 wiki 层 | 完成 | `public/wiki/**` 零依赖纯层；世界书 `reference.mjs`/`referenceViews.mjs`/`graph.mjs`/`md.mjs` 真实复用；反链落地、重复新建分支修复；`test/wiki.test.mjs` |
| OS-226 知识库模型 | 完成 | `openstory.knowledge-library@1`/`openstory.knowledge-base@1`；机器级清单、preview/confirm、realpath/symlink、contentRevision/indexHash、五态索引；四题材 seed packs；`test/knowledgeLibrary.test.mjs` |
| OS-227 独立工作台 | 完成 | `knowledge-base` manifest + 12 端点、`public/views/knowledgeBaseViews.mjs` + controller、wiki/搜索/图谱/登记/启停/切换/定制；Chromium 38 页全矩阵 |
| OS-228 HyperGraphRAG | 完成（带明确边界，见下） | `knowledge-runtime` kernel + `knowledge.retrieval@1`；JSONL sidecar、staging/不可变索引发布；`test/hypergraphSidecar.test.mjs` 21/21；固定 commit `e01d2f2a5f3d1e80415b933c10fa7d14587cf811` 的真实 worker health `sourceVerified:true` |
| OS-229 统一检索 | 完成 | `KnowledgeSearchService` 同源 canonical hits/provenance；API/MCP/Agent 三通道；短密钥掩码、坏配置拒覆盖、总预算与缓存身份；MCP 68 工具 |
| OS-230 真实验收 | 部分完成 | 固定源码、依赖 lock、source tree hash 与已安装 distribution provenance 已锁定；worker 真实 health 通过。**四题材 recall/来源正确率黄金查询尚未跑通，不能宣称真实语义质量通过** |
| OS-231 E2E 与收口 | 完成（OS-230 除外） | 两轮全量 1067/1065/2 跳过；验收 29/0/0；arch/number anchors/CI 结构；既有 OS-172/MCP build/upgrade E2E；完整 Chromium 38/38 |

## 门禁结果

| 门禁 | 结果 |
|---|---|
| `npm test` 第一轮 | 1067 例 / 1065 过 / 2 跳过 / 0 挂 |
| `npm test` 第二轮 | 1067 例 / 1065 过 / 2 跳过 / 0 挂 |
| acceptance | 29 过 / 0 挂 / 0 警 |
| arch-stats --check | 通过 |
| number-anchors --check | 通过（1067 例／29 门禁／129 端点） |
| CI workflow 结构 | 通过 |
| 隔离 OS-172 E2E | 13/13 |
| MCP clean-room E2E | 通过（68 工具；假上游语义边界如实标注） |
| 升级迁移 E2E | 24/24；失败注入 23/23 |
| 完整浏览器矩阵 | 38/38；报告完整性校验通过 |
| HyperGraphRAG sidecar | 21/21 |

## 关键安全与边界

- 知识库源只读；登记与索引使用临时夹具，源目录 hash 不变；坏清单、预览漂移、路径逃逸与 symlink 均拒绝。
- 凭据仍只存本机 `kb-config.json`；短密钥全掩码，坏配置不覆盖；自制种子包无凭据/作者私有内容。
- runtime down/未安装/版本不符/stale/超时/崩溃均类型化，不返回假空 hits，不隐式降级到 WeKnora。
- 固定 HyperGraphRAG 主分支提交已锁定；该仓库无 release/tag、PyPI 无同名包，安装采用本地 provenance 记录而非猜测发行包。
- 真实 worker health frame 已通过：`sourceVerified:true`，commit 与 runtime-source 一致。
- **未验证项**：四题材黄金 query 的召回/来源正确率。worker 的 insert/query 需要调用方显式提供 embedding/LLM provider；本次没有把假上游结果写成真实语义验收。

## 明确边界

- 未覆盖真实作者库迁移；所有 E2E 使用临时 `LOCALAPPDATA/APPDATA` 与 `port:0` daemon。
- 未连接、重启或杀掉 8807 常驻 daemon；未 push、未 tag；`public/app.js` 从 10,044 行降到 10,047 行仍在 10,500 上限内（阶段 C 的三行净增用于生产接线；按冻结口径需确认是否可进一步压回）。
- 两枚既有明文凭据仍需作者在签发方轮换；如果已进入已推送历史，需另行规划历史清理，本次未重写 git 历史。
