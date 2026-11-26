# OS-227 · 独立知识库工作台

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 C |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | OS-226 |
| 允许改动 | `src/modules/knowledge-base/**`、`public/views/knowledgeBaseViews.mjs`、`public/views/registry.mjs`、`public/app.js`（只减不增）、`src/api/contracts/knowledgeBase.mjs`、`test/knowledge*.test.mjs`、`test/helpers/pageMatrix.mjs`、`test/helpers/tempDaemon.mjs`、相关文档与数字锚 |
| 风险 | 高——新 workbench 与系统级状态 |
| 状态 | 待施工 |

## 目标

交付世界书式但语义独立的知识库插件工作面。

## 任务

1. 新 manifest：`knowledge-base` workbench，独占文档/清单/定制/搜索/索引状态端点；页面 id/显示名/命名表/TAB_REGISTRY 一致。
2. wiki 主区：库选择、标签树、文档列表/搜索、详情、反链、邻域图谱；复用 OS-225 公共层。
3. 治理：登记已有目录先 preview 再 confirm；新建空库、启用/停用、active 切换、定制保存。
4. 索引状态：never-indexed/building/fresh/stale/failed、显式 sync；runtime 未就绪时明确降级，不返回假空结果。
5. 设置区只放真实消费者；凭据仍走现有 knowledge 配置面，不进入 manifest settings/ui-state。
6. 端点显式带 libraryId/documentRef，realpath 校验；不开放回写作品世界书/fact/absorb/自动生图。

## 验收

- 知识库主页面、空库、文档详情、反链、图谱、搜索、登记确认、切换、定制、索引状态在真实 Chromium 通过；补 675/420。
- 停用 knowledge-base 后数据与状态保留；停用世界书不影响知识库，反之亦然。
- 路径逃逸、symlink、未登记库、跨库 ref 拒绝；凭据零泄漏。
- 全量测试、验收、数字锚、browser smoke 全绿；不 push。
