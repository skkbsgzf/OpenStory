# OS-198a · slot 编排返工：第三方页签收得起要放得回＋模块页面只服务声明的入口

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内返工，接 OS-198（Qoder 施工，落袋提交见看板；监督线验收主体通过） |
| 对应 | OS-198 任务 2（「＋」面板与隐藏机制）、任务 3（模块页面路由）、任务 4（门禁） |
| 依赖 | OS-198、OS-197a（同轮连派，先 197a 后本单） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/UX-STRUCTURE.md`、`docs/workorders/OS-198a-slots-rework.md` |
| 风险 | 中——动前端的「＋」面板与页面路由；`app.js` 只减不增 |
| 状态 | 已验收（监督线，2026-11-25）；提交 `453df91` |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 已经站得住、不要动坏的部分（监督线实测）

- 接口层（`probe-198.mjs`）：`/api/plugins.slots` 的页签投影为「产物／正文／世界书／剧本／日志／故事源／习惯／扮演」，顺序与 OS-198 之前**完全一致**（之前测试代码里钉死的顺序就是这个世界书在第三的顺序，是那条测试的标题过时了）；标签取自 manifest；右栏／设置区／宿主动作三个位都在投影里；第三方 iframe 页面按 `order` 落位、`view=iframe`、带 `entry`；没有可渲染页面的位置 `view=none` 并进警告；路径穿越被拒（403）；内置模块不走 `/module-page`（404）。
- 浏览器冒烟（隔离 daemon＋冒烟副本库，截图已附在验收记录）：进库正常、正文渲染正常；页签顺序「产物／正文／世界书／故事源／习惯／扮演／外部台」；内置页签逐个点开都有内容；第三方页面「外部台」带标题条（页面名、模块名、版本、内容摘要）并能调通自己的端点（`FRAME-OK`）；用 × 收起「习惯」后「＋」面板里能勾回来；设置页的插件中心完整，「本机模块」入口在。
- 反证 (b)：manifest 里塞一个没登记的 slot → 校验拒绝。

## 要返工的四处（监督线实证）

### 1. 第三方页签用 × 收起后回不来

收起「外部台」后，「＋」面板的可勾选项只有「产物／正文／世界书／故事源／习惯／扮演」，没有它；收起状态被写进库内 `tabHidden`（`"module:extwb/extwb"`），刷新重进后页签栏里仍然没有它——**界面上再没有任何办法把它放回来**。`projectedPanelTabs()` 只列内置页签。

### 2. `/module-page/<id>/<entry>` 把模块目录里的任何文件都吐出来

`GET /module-page/extwb/secret.txt` → 200；`GET /module-page/extwb/module.manifest.json` → 200。工单写的是「只对来自已登记模块根的模块提供 `/module-page/<模块 id>/<入口>`」——入口，不是整个目录。

### 3. 门禁抓不到「前端写死页签顺序」

把一个写死的页签顺序数组放进 `public/app.js`（行数不变），S2.12 仍是绿的——它只查 `TAB_REGISTRY` 的禁用字段和 `app.js` 里有没有消费投影的正则，没有「前端不许出现硬编码页签名单或顺序」这条断言。工单任务 4 的反证 (a) 不成立。

### 4. `app.js` 涨了 2 行

10,108 → 10,110。规则是只减不增（上限锚 10,500 没破，但这是硬规则）。

## 任务

1. **收得起、放得回**：「＋」面板列出投影里所有可关闭的页签（含 iframe 页面）；勾选后回到页签栏原位。守护测试：纯函数（`projectedPanelTabs` 含 iframe 页）＋ daemon 级（收起 → 刷新 → 面板里能勾回 → 页签回来）。
2. **模块页面只服务声明的入口**：`/module-page/<id>/<entry>` 只许取该模块 manifest 里 `pages[].kind === 'iframe'` 声明的入口文件，以及这些入口引用的静态资源（扩展名白名单：`js mjs css png jpg jpeg webp gif ico woff2 json`）；`module.manifest.json`、模块 `entry`、`migrations[].entry` 永不服务。守护测试：我的 P3c／P3d 两例必须变成 403／404；声明的入口与其引用的资源照常 200。
3. **门禁补反证 (a)**：前端代码里出现硬编码的页签名单或页签顺序数组（页签 id 的字面量数组，含 `artifacts`、`chapters` 等并排列出）→ S2.12 红。反证贴输出后还原。
4. **`app.js` 回到不超过 10,108 行**：新逻辑进 `public/views/`。
5. **死种子**：首次进库不再把四个已退场目录名（`dir:大纲` 等，`DEFAULT_HIDDEN_TABS`）写进 `tabHidden`——页签只来自投影，这些条目永远对应不到任何页签；已有库里的死条目读时忽略、写时不再追加。
6. **补一条场景测试**：库里没有 `世界书/` 目录时投影里世界书页签不出（`visibleWhen` 门控），其余不动。

## 不做

- 不改任何对外契约的既有字段；不改端点路径与 MCP 工具名。不碰作者真库与真实院子；不重启、不连接 8807。

## 验收

- 机器门禁全绿；红线测试 `test/tabRegistry.test.mjs`、`test/os198SlotsWiring.test.mjs`、`test/slots.test.mjs`、`test/os172Naming.test.mjs`、`test/moduleManifest2.test.mjs` 全绿。
- 监督线复跑 `probe-198.mjs`（15 项全过）并在隔离 daemon 上重做浏览器冒烟：收起「外部台」→「＋」面板能勾回 → 刷新后仍在。
- 回报里贴：面板与页面路由的改动点（`文件:行`）、门禁反证 (a) 的输出、`app.js` 行数前后。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 843 · pass 841 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- `public/views/registry.mjs` — `projectedPanelTabs`（:367）改为从 `projectedTabDefs` 派生，列出投影里全部可关闭页签（含 iframe），排除宿主设置页；新增 `sanitizeHiddenTabs`（:383）过滤死种子。
- `public/app.js` — `hiddenTabs`（:5382）改用 `sanitizeHiddenTabs`，删除 `DEFAULT_HIDDEN_TABS` 引用壳；行数 10,110 → 10,107。
- `src/host/daemon.mjs` — 新增 `MODULE_PAGE_ASSET_EXT`（:284）/`modulePageAllowList`（:296），`serveModulePage`（:342-347）只服务声明的 iframe 入口及其引用的白名单资源；`module.manifest.json`、模块 `entry`、`migrations[].entry` 永不服务。
- `tools/acceptance/acceptance.mjs` — S2.12（:444-473）新增前端硬编码页签名单/顺序数组检测（≥3 个页面 id 字面量并列；registry.mjs 真源豁免）。
- `test/tabRegistry.test.mjs` — 补面板含 iframe、死种子、无世界书目录门控三项断言。
- `test/os198SlotsWiring.test.mjs` — 补 P3c/P3d 等 403/404 断言、引用资源 200、daemon 级「收起→刷新→面板勾回→页签回来」测试。
- `README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/number-anchors.json` — 数字锚回写（841 过／843 例／app.js 10,107）。

VERIFIED:
- 红线测试：`node --test test/tabRegistry.test.mjs test/os198SlotsWiring.test.mjs test/slots.test.mjs test/os172Naming.test.mjs test/moduleManifest2.test.mjs` → 35/35 过。
- 全量：`node .zcode/run-gate.mjs` → pass=841 / fail=0 / skip=2。
- 门禁：`node tools/acceptance/acceptance.mjs` → **29 过 / 0 挂 / 0 警**。
- 反证 (a)：在 `app.js` 原行注入 `const __probeHardcodedTabs = ['artifacts','chapters','worldbook','habits','roleplay']`（行数不变 10,107），门禁输出：`✗ [S2.12] ... 前端出现硬编码页签名单/顺序数组：public/app.js: ['artifacts', 'chapters', 'worldbook', 'habits', 'roleplay']`；已还原，复跑 S2.12 绿。
- `node tools/number-anchors.mjs --check` → 绿；`npm run arch:stats` / `node tools/arch-stats.mjs --check` → 生成段一致。
- `git diff --check` → 干净（仅 LF→CRLF 提示）。
- app.js 行数：改前 10,110 → 改后 10,107（上限 10,108 内，只减不增）。

LIMITATIONS:
- 仓库内不含 `probe-198.mjs`，无法复跑监督线 15 项探针；其覆盖点已用 daemon 级测试（投影顺序、第三方页收放、路径穿越 403、模块页 403/404、引用资源 200）等价覆盖。
- 环境无浏览器自动化，未做真浏览器逐帧冒烟；「收起→＋面板勾回→刷新仍在」以真实 daemon＋库内 ui-state 落盘读写＋前端纯函数 round-trip 测试验证。
```

## 验收记录（监督线，2026-11-25）

- 提交 `453df91`；全量 843／841 过／2 条件跳过／0 挂；门禁全绿；隔离 e2e 全绿；`app.js` 10,110→10,107。
- 接口探针 `probe-198.mjs` **15 项全过**：未声明的文件与 `module.manifest.json` 现在都是 **403**（返工前是 200）；`secret.txt` 一并被拒。
- 新增探针 `probe-198c.mjs`：入口引用的 `style.css`／`app.js`／`logo.png` 200；没被引用的 `unused.js` 404、`data.json` 404；`module.manifest.json` 与 `index.mjs` 403——「只服务声明的入口及其引用资源」成立。
- 门禁反证 (a) 成立（监督线亲跑）：在 `public/app.js` 里放一个页签顺序数组（行数不变）→ S2.12 红并点名 `public/app.js: ['artifacts', 'chapters', …]`；还原后绿。
- **浏览器复验**（隔离 daemon＋冒烟副本库，截图归档 `D:\Pinax-e2e\os-shots\os198-slots-20261125\`）：进库→页签栏「产物／正文／世界书／故事源／习惯／扮演／外部台」；用 × 收起「外部台」→「＋」面板里出现「外部台」（未勾选）→ 勾回 → 刷新重进仍在 → 点开页面照常调通端点（`FRAME-OK`）。返工前的「收起来回不来」已翻转。
- `test/tabRegistry.test.mjs` 补了面板含 iframe、死种子、无世界书目录门控三项；死种子 `DEFAULT_HIDDEN_TABS` 的写入已由 `sanitizeHiddenTabs` 过滤。
- 结论：**已验收**。
