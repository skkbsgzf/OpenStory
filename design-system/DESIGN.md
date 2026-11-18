# OpenStory Paper 设计系统

> Category: Writing & Creative Tools
> 类纸（paper-like）写作工作台：正文恒居中，模块皆浮层卡片，无边框、干净清爽。

## 1. 视觉主题与气质

- **视觉风格**：类纸、素净、卡片堆叠（OS-47 作者口径）
- **取色**：依 OpenDesign 口径——中性 surface、暖墨阴影（OS-49）
- **设计意图**：写作工具是主角，界面退后。所有附属功能以浮层卡片存在，
  阴影落在卡片上而非栏容器上；左蓝右蓝都是附庸，永不挤压正文。

## 2. 色（语义令牌，见 tokens.css）

- **画布**：`--bg` 纯白；大面背景一律画布色。
- **卡片面**：`--surface-card`（ink 3% 混入 bg 派生的中性面，禁用偏暖的 `--soft`——珊瑚/墨皮会显脏）。
- **墨**：`--ink` 正文 / `--ink-2` 次级 / `--muted` 弱化 / `--meta` 元信息。
- **主色**：珊瑚 `--accent`（CTA/选中/链接），`--on-accent` 作其上的文字色。
- **语义**：`--ok` / `--danger` / `--warn`（+ `--warn-ink` 深琥珀文字、`--warn-on-dark` 暗面警示）。
- **线**：`--hair` 发丝线（分隔），`--line` 实线（描边场景）。
- **推演场景**：`--scene-deep/mid/far` 夜空渐变三档 + `--scene-overlay` 舞台条覆面。

**铁律**：令牌定义区（:root / 夜间覆盖块）之外禁止裸色值——新增颜色先进令牌再引用
（门禁 S3.1 机械检查；画布绘图用 `getComputedStyle` 现读令牌，见 public/graph.mjs）。

## 3. 字体与排版

- **界面**：`--sans`（系统栈 + 微软雅黑/PingFang）
- **正文**：`--serif`（Noto Serif SC / 宋体），17px / 1.9 行高 / 2em 首行缩进（`--doc-*`）
- **代码**：`--mono`
- **尺度**：界面小字 11.5–13px，正文 17px；标题层级靠字重与墨色，不靠大字号

## 4. 间距与组件

- **圆角**：`--radius` 10（控件）/ `--radius-md` 14（卡片）/ `--radius-lg` 20（浮层）/ `--pill` 胶囊
- **影**：静息 1px 级微影（`--shadow-card`），浮起散影（`--shadow-card-hover`），弹出层 `--shadow-float`
- **卡片**：`.surface-card` + 圆角 md + `shadow-card`；堆叠排列，卡片间 8px 间隙
- **关闭**：模块卡 `.rm-x`（圆形幽灵钮）+ `.rm-toggle`（可点标题）；整页关闭 `.page-close`
- **提示**：`.error-box` / `.loading` 全局统一
- **浮层宪法**：左右栏绝对定位不占正文流（OS-48）；`--content-max` 1180 / 正文 `--doc-max` 720 恒居中

## 5. Agent 对接

- Agent 生成界面时引用本文件的令牌名，不发明新颜色。
- 图例/徽标等 JS 侧颜色一律取令牌（canvas 场景用 getComputedStyle 现读）。
- 组件约定与跳转层级细则见 `docs/UX-STRUCTURE.md`；机械验收 `tools/acceptance/acceptance.mjs` S3/S4。
