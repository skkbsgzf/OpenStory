# 工单 S3：分析能力封装化（故事源实现 → 正文选装）

## 背景
作者要求：**分析能力封装化，做在故事源里实现后可以在正文里选装、跳转。**

现状：
- `public/analysis.mjs` 是纯函数引擎（`analyzeChapter`/`splitSentences`），只有本章级分析
- 正文页右栏有分析面板（`analyzePanelHtml`），是**写死的一整套卡片**
- 没有「作品级」分析（跨章）

## 任务

### 1. 新建 `public/analysisModules.mjs`（分析模块注册表）

把分析能力定义成**可注册、可插拔的模块**，成功形状：

```js
export const ANALYSIS_MODULES = [
  {
    id: 'chapter-editorial',
    label: '本章编辑总评',
    scope: 'chapter',        // 'chapter' = 看正文选区/本章；'work' = 看整部作品
    run: async ({ text, habits, fact }) => ({ ...原本 analyzeChapter 的结果 }),
    render: (result) => '<html string>'
  },
  {
    id: 'plot-curve',
    label: '剧情曲线',
    scope: 'work',
    run: async ({ entries, wiki }) => ({ ... }),
    render: (result) => '<...>'
  },
  {
    id: 'foreshadow-audit',
    label: '伏笔回收',
    scope: 'work',
    ...
  },
  {
    id: 'plot-density',
    label: '剧情密度',
    scope: 'work',
    ...
  }
]
export function modulesFor(scope)          // 按 scope 过滤
export function runModule(id, context)     // 跑单个模块
```

### 2. 故事源页承载 `scope: 'work'` 的模块

在 S2 做的故事源页里，**图表形态**改为「分析模块容器」：
- 顶部一排模块切换（剧情曲线 / 伏笔回收 / 剧情密度）
- 每个模块的 `render()` 结果渲染在下方
- 模块列表来自 `modulesFor('work')`，**不再写死三张图**

### 3. 正文页「选装」

正文页右栏的分析面板改为**模块选择器 + 已选模块渲染**：
- 顶部一个「+ 分析」按钮，点开列出 `modulesFor('chapter')` + `modulesFor('work')` 的模块
- 勾选即启用，选择存进 `state.analyze.enabled`（per-library localStorage，复用 `hiddenTabs` 的键模式）
- 默认只启用 `chapter-editorial`（保持现状）
- **启用的 work 模块在正文页运行时**：数据从 `/api/fact/entries` + `/api/fact/curve` 拉，展示在右栏；
  卡片头部带一个「在故事源中查看」的小链接 → `go('dir:拆解')` 并切到对应模块

### 4. 跳转协议

- 正文里选中一段 → 右栏 work 模块能收到 `focus: { text, paragraph }`（可选，P1 可以只做「跳过去看全貌」）
- 故事源页点某个条目的溯源 → 跳到正文并定位（`go('write')` + 定位到对应 node；P1 若定位难，先只跳页面）

## 允许改的文件
- `public/analysisModules.mjs`（新建）
- `public/analysis.mjs`（保持现有导出，可加 work 级纯函数）
- `public/app.js`（分析面板改造 + 事件绑定）
- `public/index.html`（模块选择器样式，走令牌）
- 不要动 `public/storySource.mjs` 的导出口径（S2 刚建），只加容器调用

## 验收
- `node tools/acceptance/acceptance.mjs` 14 检查全过
- `node .zcode/run-gate.mjs` 全绿
- 正文页能勾选/取消模块，刷新后保持
- 故事源图表形态能切换至少 3 个模块

## 注意
- 现有 `analyzeChapter` 的行为**不许变**（它是 MCP 工具 `openstory_analysis_chapter` 的后端）
- 模块注册表必须是纯数据 + 纯函数，不许在模块定义里直接碰 DOM
