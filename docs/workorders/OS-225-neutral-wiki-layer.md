# OS-225 · 中性 wiki 呈现层抽取

| 项 | 值 |
|---|---|
| 批次 | OS-211～231；阶段 C |
| 执行 | workflow 施工；dsv4flash / hy4flash 交替，对方模型评审 |
| 依赖 | 无 |
| 允许改动 | `public/wiki/**`、`public/views/**`、`public/reference.mjs`、`public/referenceStore.mjs`、`public/graph.mjs`、`public/md.mjs`、`public/app.js`（只减不增）、`test/reference*.test.mjs`、`test/wiki*.test.mjs`、相关文档与数字锚 |
| 风险 | 中高——前端共享层 |
| 状态 | 待施工 |

## 目标

抽出世界书与知识库共用的 wiki 呈现层，禁止新插件复制世界书实现。

## 任务

1. 中性组件：标签树、文档树、详情、反链、图谱、Markdown 阅读/编辑、空态/加载/错误态。
2. 参数化：标题、source id、路径/ref resolver、节点 kind、边类型、是否 firstChapter/fact/图片/编辑、动作注册。
3. 世界书真实改用公共层；保留 `世界书/` 扫描、防剧透、fact 只读层、正文单向链、生图/absorb 等作品策略。
4. 图谱渲染 `mountGraph()` 支持通用 kind 映射，默认不复制 worldbook/tag/artifact/entry 假设。
5. app.js 只保留薄壳/取数/动作绑定；新公共层有生产调用方与纯度测试。

## 验收

- 世界书现有浏览器场景、视图金样、单向边与只读 fact 测试不回退。
- 公共层被世界书真实调用；不是“抽了一份没人用”。
- 可用合成 KB 数据渲染标签树/详情/反链/图谱，无世界书专属字段。
- 全量测试、验收、数字锚、browser smoke 全绿；不 push。
