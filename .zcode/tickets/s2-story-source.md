# 工单 S2：故事源页（替代拆解 view，三形态）

## 背景
`public/app.js` 的 `factViewHtml()` 现在是五张只读卡片（章级序列/六槽位/因果图/台账/缺口），与世界书零交互、按层数据拍平成文字。

作者定位：**故事源 = Fact 链的可视化 + 小说大纲功能**，三种形态：
1. **大纲形态** — 章→拍→事件的树 + 中栏内容
2. **数据形态** — 多维表格（可切看板）
3. **图表形态** — 剧情曲线/伏笔/密度（ECharts）

## 前置
工单 S1 已完成，`GET /api/fact/entries` 与 `GET /api/fact/books` 可用。

## 任务

### 1. 新模块文件 `public/storySource.mjs`

纯函数模块（浏览器+Node 双用，风格对齐 `public/storyTree.mjs`），导出：

```js
export function layoutStorySource({ entries, wiki, view })  // 返回 { tree, board, stats }
export function groupByChapter(entries, chapterSummaries)   // 章→拍→事件 三层
export function groupByLayer(entries)                       // plot/character/worldview
export function toBoardColumns(entries)                     // 飞书多维表格列定義
```

**关键设计（照作者裁定的双层对齐）**：
- fact 侧条目带 `provenance.segmentIndex`（正文段号）与 `provenance.chapters[]`
- wiki 侧 `chapterSummaries[]` 是叙事章
- **两套编号不总是一致**（实测 Qbook 短篇：fact 全标 chapter=1，wiki 有 38 章）
- 所以 `groupByChapter` 必须：优先用 `provenance.chapters[0]`；缺失时按 `segmentIndex` 均分兜底，并在返回里标 `alignment: 'exact' | 'approximate'`

### 2. 重写 `factViewHtml()`（在 app.js 里）

三栏布局（复用工作台已有的浮层宪法与卡片类）：
- **左栏**：形态切换（大纲/表格/图表）+ 树。大纲态是 章→拍→条目 三级；表格态是层筛选器
- **中栏**：大纲态＝条目详情（按 `layer` 换渲染器：plot 走事件流，character 走台词/行为锚点，worldview 走字段表）；表格态＝多维表格；图表态＝ECharts 图
- **右栏**：溯源（sources 列表，显示 sourceId + segmentId + quote_hash 缩写）+ 关联（世界书条目链接）+ 辐射（推演/分析消费点）

**必须复用现有 CSS 约定**：
- 卡片用 `.surface-card` 语义（`box-shadow: var(--shadow-card)`）
- 关闭用 `.rm-x`，折叠用 `.rm-toggle`
- 颜色全部走 `var(--*)` 令牌，**零裸色值**（门禁 S3.1 会查）

### 3. 表格态（飞书多维表格风格）

列定义：`名称 / 层 / 状态 / 出场人物 / 章 / 段 / 事件数`。
- 支持按层筛选（顶部 tab）、按名称搜索、点行选中
- 不要求拖拽排序、不要求内联编辑（P1 只读）
- 表格用原生 `<table class="table">`，横向滚动用 `.table-responsive`

### 4. 图表态（ECharts）

**先做 vendor 落盘**：下载 `echarts.min.js`（5.x）到 `public/vendor/echarts.min.js`，在 `public/index.html` 里按需 `<script>` 引入（**不要动其他页面的加载**——用动态 `import()` 或 `document.createElement('script')` 在进入图表态时加载）。

三张图：
1. **剧情曲线**：横轴章号，纵轴张力（用 `fact/curve` 的 emotion/function 换算），叠事件密度面积
2. **伏笔回收**：横轴章，纵轴伏笔线，埋＝实心点、收＝空心点、未收＝虚线延伸
3. **剧情密度**：热力图，横轴章/纵轴拍

**ECharts 主题必须从 CSS 令牌取值**（`getComputedStyle(document.documentElement).getPropertyValue('--accent')`），跟随皮肤切换。

### 5. 路由：`dir:拆解` → 故事源

`dirViewHtml(dir)` 里 `if (dir === '拆解')` 分支保留，但标题从「拆解数据」改为「故事源」，页签标签可以仍叫「拆解」（目录名不改）或改成「故事源」——**你判断哪个改动小且不破坏现有页签逻辑**，在 limitations 里说明。

## 允许改的文件
- `public/storySource.mjs`（新建）
- `public/app.js`（`factViewHtml` 重写 + `loadFactViewData` 扩展 + 事件绑定）
- `public/index.html`（新增样式，全走令牌）
- `public/vendor/echarts.min.js`（新建，下载）
- `DEMO.md`（拆解段改写）

## 验收
`node tools/acceptance/acceptance.mjs` 14 检查全过（特别是 S3.1 裸色值零容忍）。

## 注意
- 不要动 `deduceEngineHtml`/`deduceSession`（推演页刚重构完，别碰）
- 不要动 `core/**`
- 图表态如果 ECharts 加载失败，降级为文字提示，不许白屏
