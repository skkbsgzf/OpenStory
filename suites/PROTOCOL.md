# OpenStory 货架协议 · 套件＝`openstory-module@2`

> OS-192 收口：五类货架（技能／文风／体裁／运行时／业务套装）都是能力图里的一等套件。
> **一个装载入口、一套启停与状态、一条依赖闭包**；套件目录里不再有任何可执行内容。
> legacy 的 `openstory-suite@1`／`@2` 页面模式、`/suite-assets/` 路由与 `suiteStateDataGet/Put` 已整体退役。

## 1. 唯一真源与投影

`loadSuiteCapabilityManifests()`（`src/protocol/shelfManifests.mjs`）是唯一的套件清单来源。
单文件/单目录货架**不另加 manifest**：由各自的域适配器把现有事实投影成 module@2 套件形状，不造第二份真源。

| 货架 | 投影来源 | `supplies` | `appliesTo`（硬依赖） |
|---|---|---|---|
| `skills/<id>/` | `SKILL.md` frontmatter | `skill` | `agent.runtime` |
| `styles/<id>.json` | JSON 的 id/name/version/vendor | `resource`（`resourceKind: style`） | 无（消费方是底座界面；校验器只对文风包允许空） |
| `genres/<id>.json` | 同上 | `resource`（`resourceKind: genre`） | `storage.scaffold`、`prose.write` |
| `runtimes/<id>/` | kit 的 `manifest.json` | `runtime` | `agent.runtime` |
| `suites/<id>/` | `manifest.json`（已是 module@2） | 原样 | 原样 |

投影出的五类都进能力图（`loaded`／`degraded`／`disabled`）与 `/api/plugins` 启动报告。
各货架原有读取端点（`skillsGet`／`skillGet`／`stylesGet`／`genresGet`／运行时相关端点）保留端点 id、路径与响应形状，内部改从统一清单取数。

## 2. 业务套装目录（真源就是 `manifest.json`）

```
suites/                          ← 内置 <库或仓>/suites/ 或本机 %LOCALAPPDATA%/OpenStory/openstory/suites/
  <suite-id>/
    manifest.json                ← openstory-module@2 class:suite（唯一必需）
    rules.json / skills/…        ← 数据 .json/.md/.txt/.yaml/.yml/.css、位图、字体
```

宿主每次请求现扫货架；**本机目录按 id 覆盖内置，并显式报告谁覆盖谁、来自哪个目录**（`/api/suites`、`/api/plugins` 的 `overrides`）；删目录即下架；`.openstory`／隐藏目录不扫。

```json
{
  "spec": "openstory-module@2",
  "id": "writing",
  "name": "写作套件",
  "version": "0.1.0",
  "class": "suite",
  "builtin": true,
  "description": "小说写作的默认规则",
  "supplies": ["skill"],
  "entries": { "skill": "skills" },
  "appliesTo": [{ "id": "prose.write", "min": 1 }],
  "deps": [],
  "settings": [
    { "key": "newChapterTitle", "label": "新建章节默认标题", "type": "string", "default": "未命名章" }
  ]
}
```

| 字段 | 必填 | 规则 |
|---|---|---|
| `spec` | ✓ | 精确 `openstory-module@2`；`openstory-module@1` 直接拒收并给出明确警告（无迁移入口） |
| `id` / `name` / `version` | ✓ | id 小写字母开头、`a-z0-9-`、≤40 字；version 三段数字；id 必须等于目录名 |
| `class` | ✓ | `suite`（内核/工作台另有矩阵） |
| `builtin` | ✓ | 必须与装载源一致（内置目录 `true`、本机目录 `false`） |
| `supplies` / `entries` | ✓ | supplies ∈ skill/deduce-rule/media-workflow/resource/runtime/bundle；entries 每个供给一项、必须指向目录内真实文件 |
| `appliesTo` | ✓ | 硬依赖范围数组（文风包允许空）；`resource` 供给必须声明 `resourceKind: style\|genre` |
| `deps` |  | 其它套件 id 数组，进 `resolveSuiteDependencies` 依赖闭包 |
| `settings` |  | `{key,label,type,default,options?}`，type ∈ string/number/boolean/select |

## 3. 套件只许数据与说明

扩展名白名单：`.json/.md/.txt/.yaml/.yml/.css/.png/.jpg/.jpeg/.webp/.gif/.ico/.woff2`。
HTML、SVG、WASM 与任何脚本扩展名一律拒收（理由：不凭空许诺可执行内容、不许死设置项）。
漫剧占位套件（`comicdrama`）因两个设置项无任何消费者、设置页是可执行孤岛，已按作者裁定删除。

## 4. 生命周期与统一治理

安装＝放目录 → 货架可见；启用/停用＝`PUT /api/suite/state`（值保留）；下架＝删目录。
启停与设置值统一落库内 `.openstory/plugins/suite-state.json`（机器级同名文件只作没开库时的缺省）：
五类货架通用 `suitesGet`／`suiteStatePut`／`suiteSettingsPut`。停用＝规则退回内置默认，值保留，宿主绝不假装它在场。

依赖闭包覆盖 `deps`（套件 id）与 `appliesTo`（能力范围）：缺依赖/成环的条目照常上架但标 `blocked`，作者能看见「它为什么没生效」。

设置页只在一处管理六组（技能包／文风包／体裁包／运行时套件／业务套装／推演规则包），每项可启停；
原来分散的「插件总览」「运行时货架」「风格包」「技能」管理入口不再重复同一个动作。
选择动作（当前皮肤、当前 Agent 运行时）仍留在「外观」与「引擎与存储」，与启停不是同一件事。

## 5. 最小示例

`src/services/suites.mjs` 的 `normalizeSuite()` 是唯一规整入口；内置写作/编剧/推演规则三个套件（见 `suites/`）是金样。
页面渲染样板见 `public/views/suiteShelfViews.mjs`（只用令牌，无裸色值/裸像素）。
