# OpenStory 业务套件注册协议 · openstory-suite@2

> 定位（作者 2026-11-15）：**先定协议，让插件方注册进来；宿主再按协议与功能开放情况准备设置页。**
> 套件与 OpenStory 的关系＝DSH 与 DSH 插件的关系：有版本号、有归属、有独立设置页、**不常驻**。
> 本文件是插件方的注册协议原文；宿主（daemon＋工作台）按这里实现，双方以 schemaVersion 对齐。

## 1. 注册＝放一个目录

```
suites/                          ← 内置 openstory/suites/ 或本机 %LOCALAPPDATA%/PinaxNext/openstory/suites/
  <suite-id>/
    manifest.json                ← 注册表（唯一必需）
    settings.html                ← 可选：自带设置页（capabilities.settings.mode="page" 时）
    （其他资产随套件自带）
```

宿主每次请求现扫货架；**本机目录按 id 覆盖内置**；删目录即下架；`.pinax`/隐藏目录不扫。

## 2. manifest（注册表）

```json
{
  "schemaVersion": "openstory-suite@2",
  "id": "comicdrama",
  "name": "漫剧套件",
  "version": "0.2.0",
  "vendor": "Pinax 官方",
  "description": "一句话说明",
  "domains": ["漫剧"],
  "capabilities": {
    "settings": { "mode": "page", "entry": "settings.html" },
    "pages":    [{ "id": "board", "title": "分镜板", "entry": "board.html" }],
    "services": []
  }
}
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `schemaVersion` | ✓ | 精确 `openstory-suite@2`（`@1` 的顶层 settings[] 自动按 schema 模式兼容，新套件请用 @2） |
| `id` / `name` / `version` / `vendor` | ✓ | id `[\w-]`；version 三段数字；vendor＝归属（官方/社区署名） |
| `domains` |  | 业务域标签（写作/编剧/漫剧…），展示用 |
| `capabilities.settings` |  | **设置页能力**，两种模式见 §3 |
| `capabilities.pages` |  | 自带业务页登记（id/title/entry）——**协议位：宿主登记并展示，装载随业务页宿主上线** |
| `capabilities.services` |  | 预留：套件自带服务（同运行时 kit 的 sidecar 语义） |

## 3. 设置页能力（两种模式，宿主按声明准备）

### 模式 A：`schema`（宿主渲染表单）
```json
"settings": { "mode": "schema", "schema": [ { "key": "newChapterTitle", "label": "…", "type": "string", "default": "…" } ] }
```
type ∈ string/number/boolean/select（select 带 options，default 必须在 options 内）。
宿主渲染表单＋校验＋落本机 `suite-state.json`（原子写）。

### 模式 B：`page`（套件自带设置页——DSH 插件同款）
```json
"settings": { "mode": "page", "entry": "settings.html" }
```
- 宿主经 **`GET /suite-assets/<id>/<相对路径>`** 提供套件资产（同源 iframe 装载；路径安全化，≤2MB，只读）。
- 套件页读写自己的配置走两个同源 API（宿主存本机，值＝任意 JSON 对象，宿主不校验形状）：
  - `GET /api/suite/state-data?id=<id>` → `{ok, values}`
  - `PUT /api/suite/state-data?id=<id>` body `{values: {...}}` → `{ok, values}`
- 停用语义不变：停用＝宿主不再应用套件规则（值保留）。

## 4. 生命周期（非常驻）

安装＝放目录 → 货架可见（版本/归属/能力 chips）；启用/停用＝`PUT /api/suite/state`（值保留）；
下架＝删目录。停用的套件：宿主不应用其规则、其自带页横幅提示——**宿主绝不假装它在场**。

## 4.5 套件前端规范（OS-95，page 模式的 settings.html / board.html 必读）

作者口径：「整体的规范性还是要在统一的 UI 里面去管理。」
插件页跑在同源 iframe 里，**不继承父文档的 CSS 变量**——所以宿主要主动下发。

### 第一步：链接宿主令牌

```html
<link rel="stylesheet" href="/suite-assets/_tokens.css">
```

这一个 link 给你全套令牌（宿主按当前档位算好具体值下发）：

| 类别 | 令牌 |
|---|---|
| 字号 | `--ui-fs-2xs` … `--ui-fs-2xl`（8 级） |
| 行高 | `--ui-lh-tight|normal|loose` |
| 控件 | `--ui-ctl-h`（高度）、`--ui-ctl-px`（横向内边距）、`--ui-row-py` |
| 间距 | `--ui-gap-3xs` … `--ui-gap-2xl`（8 级） |
| 配色 | `--bg` `--soft` `--ink` `--ink-2` `--muted` `--meta` `--line` `--hair` `--accent` `--accent-hover` `--accent-soft` `--ok` `--danger` `--warn` `--on-accent` |
| 圆角 | `--radius` `--radius-md` `--radius-lg` `--pill` |
| 字体 | `--sans` `--serif` `--mono` |

暗色：`html[data-theme="dark"]` 已内置覆盖；套件页在 `<html>` 上打这个属性即可跟随夜皮。

### 第二步：只用令牌写样式

```css
/* ✅ */
label { font-size: var(--ui-fs-sm); color: var(--ink-2); margin-bottom: var(--ui-gap-2xs); }
input { height: var(--ui-ctl-h); padding: 0 var(--ui-ctl-px); border: 1px solid var(--line); border-radius: var(--radius); }

/* ❌ 禁止 */
label { font-size: 12px; color: #6f6a63; }
```

**禁止裸写像素与十六进制色值**。宿主换皮、调字号档时，插件页必须自动跟随。

### 第三步：样板

`suites/comicdrama/settings.html` 是完整样板（0 裸值、全令牌）。新套件照抄它的结构。

### 自检

- [ ] `<link rel="stylesheet" href="/suite-assets/_tokens.css">` 在 head 里
- [ ] 页面样式里没有 `font-size: Npx` / `#hex`
- [ ] 控件高度用 `--ui-ctl-h`，间距用 `--ui-gap-*`
- [ ] 暗色下可读（切夜皮看一眼）

## 5. 最小示例

见 `openstory/suites/comicdrama/`（@2 page 模式：自带 settings.html）与
`openstory/suites/writing/manifest.json`（@1 schema 模式，两处规则已接线）。
