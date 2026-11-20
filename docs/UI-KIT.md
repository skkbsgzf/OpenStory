# 前端套件指南（UI Kit）

> 给所有改 OpenStory 前端的人（含三方开发者）的**唯一入口文档**。
> 目标：相似的前端信息尽可能复用，新页面不用再造轮子。

## 一句话规矩

**新写 UI 只用 `.uikit-*` 与令牌；老类（`.btn-primary` / `.field` / `.kv-line`…）只是兼容别名，不再新增变体。**

---

## 1. 字号：两条轨道，永不混用

| 轨道 | 令牌 | 用于 | 档位 |
|---|---|---|---|
| 功能轨 | `--ui-fs-2xs` `xs` `sm` `md` `base` `lg` `xl` `2xl` | 按钮/表单/卡片/标签/表格/导航 | 紧凑·标准·大·特大（`--ui-scale`） |
| 正文轨 | `--doc-font-size` + `--doc-line-height` | 纸面正文（阅读/写作） | 小·中·大·特大·巨 |

```css
/* ✅ 对 */
font-size: var(--ui-fs-sm);
font-size: var(--doc-font-size);

/* ❌ 错 —— 硬编码像素会让字号档位失效 */
font-size: 12px;
```

配套尺寸令牌：`--ui-ctl-h`（控件高）、`--ui-ctl-px`（横向内边距）、`--ui-row-py`（行纵向内边距）、`--ui-lh-tight|normal|loose`。
间距缩写照抄：`calc(12px * var(--ui-scale))`。

**档位由「设置 · 主题与字号」项目级控制，任何页签不得自行覆盖。**

---

## 2. 组件（`public/ui-kit.mjs`）

| 组件 | 用途 |
|---|---|
| `chipField({key,label,hint,values,placeholder,max})` | 标签编辑器（替代「一行一个」的 textarea） |
| `chipChip({key,value,index,editing})` | 单个标签 |
| `field({label,hint,control,id})` | 表单字段 |
| `textInput({id,value,placeholder})` | 文本输入 |
| `select({id,value,options})` | 下拉（`options` 支持字符串或 `{value,label}`） |
| `toolbar({left,center,right})` | 工具栏三段 |
| `card({title,subtitle,badge,body,actions})` | 卡片 |
| `emptyState({title,hint,action})` | 空态 |
| `kvTable({rows,columns})` | 键值表 |
| `buttonGroup({items:[{label,kind,action,disabled}]})` | 按钮组 |

### 用法

```js
import { chipField, field, select, toolbar, buttonGroup } from './ui-kit.mjs'

const html = `
  ${field({ label: '口吻', hint: '分析结论的说话方式', control: select({ id: 'tone', value, options }) })}
  ${chipField({ key: 'bannedWords', label: '禁用词', values: h.bannedWords })}
  ${toolbar({ left: buttonGroup({ items: [{ label: '保存', kind: 'primary', action: 'save' }] }) })}
`
```

### 设计约束（改组件前必读）

1. **只出 HTML 字符串** —— 零框架依赖，与现有渲染方式一致
2. **样式只引令牌** —— 组件内不写像素值
3. **状态由调用方持有** —— 组件不收全局 `state`，参数进、HTML 出
4. **交互走 `data-action`** —— 组件不绑事件，由外壳统一分发

---

## 3. 标签编辑器（chipField）交互契约

| 操作 | 行为 |
|---|---|
| 输入词 + 空格 / 回车 / 逗号 / 、 | 变成标签 |
| 空输入框按退格 | 删最后一个标签 |
| 点字段头「删」 | 进入删除态，所有标签显 × |
| 点某个 × | 只删那一条 |
| 重复值 | 静默忽略（不重复添加） |

值存在隐藏 `input[data-chip-value]`（换行拼接）。保存时用 `chipValuesOf(fieldEl)` 取。

---

## 4. 老类兼容层（`index.html`）

以下老类已重写为与 `.uikit-btn` 同源的令牌组合，**HTML 无需改动**：

| 老类 | 等价于 |
|---|---|
| `.btn-primary` | `.uikit-btn.uikit-btn-primary`（胶囊圆角） |
| `.btn-ghost` | `.uikit-btn.uikit-btn-ghost`（胶囊描边） |
| `.icon-btn` | 圆形图标按钮（`--ui-ctl-h` 见方） |
| `.select` / `.file-input` / `.text` | `.uikit-input` / `.uikit-select` 同口径 |
| `.kv-line` | 键值行 |

**新代码请直接用 `.uikit-*`**；老类保留只为不破坏既有 183 处引用，不再新增变体。

---

## 5. 颜色与表面

| 令牌 | 用途 |
|---|---|
| `--bg` / `--soft` / `--surface-card` | 画布 / 浅层 / 卡片面 |
| `--ink` / `--ink-2` / `--muted` / `--meta` | 文字四级 |
| `--line` / `--hair` | 边框 / 细分隔线 |
| `--accent` / `--accent-soft` | 主色 / 主色浅底 |
| `--ok` / `--danger` / `--warn` | 语义色 |
| `--radius` / `--radius-md` / `--radius-lg` / `--pill` | 圆角四级 |
| `--shadow-card` / `--shadow-card-hover` / `--shadow-float` | 影三级 |

**禁止在页面样式里发明一次性数值**——需要新值就先在 `:root` 加语义令牌。

---

## 6. 自检清单（提 PR 前跑一遍）

- [ ] 没有裸写 `font-size: Npx`
- [ ] 没有裸写十六进制颜色（用令牌）
- [ ] 表单控件用 `.uikit-input` / `.uikit-select` 或老类别名
- [ ] 列表式多值输入用 `chipField`，不是 textarea
- [ ] 空态用 `emptyState()`，不是手写 `<p>暂无数据</p>`
- [ ] 表格用 `kvTable()` 或 `.uikit-table`
- [ ] 字号档位切换后页面不崩（设置 · 主题与字号里点四个档试一遍）

---

## 7. 现状与待办

**已完成**：
- 双轨字号令牌体系（功能 4 档 / 正文 5 档）
- 482 处硬编码字号 → 7 处（全是正文档位定义）
- ui-kit 10 个组件 + 配套样式
- 老类兼容层（按钮/图标/表单/键值行）

**待办**：
- 设置页的 `.step` / `.big-opt` 体系尚未迁到 uikit（它自成一套，迁移收益低）
- 故事源页的 `.ss-*`（44 个类）是专用可视化，不复用 uikit 合理
- 各页面仍在用老类，逐页迁移是渐进式的，不阻塞新功能
