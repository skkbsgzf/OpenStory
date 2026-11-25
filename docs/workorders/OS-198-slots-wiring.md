# OS-198 · slot 编排接线：前端消费 manifest 的 slot 投影

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 11 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §三 B5；规划 §1.3「工作台（用户功能面，全部带 slots 与 requires）」、§2.6 底座供给的装载 API；ADR 0003 §一、G4 |
| 依赖 | OS-192、OS-194（OS-196 的本机模块根就绪后一并验证第三方工作台） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/protocol/module-manifest-2.md`、`docs/UX-STRUCTURE.md`、`docs/workorders/OS-198-slots-wiring.md` |
| 风险 | **高**——动前端的页签主干；`app.js` 只许减不许增 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

「哪个工作面出现在哪里、什么顺序」**只由 manifest 决定**：底座的 slot 注册表与编排投影是唯一真源，前端照投影渲染，不再自己另存一份名单与顺序。

## 现状（监督线验收实测）

- `src/protocol/slots.mjs` 的 `slotPlacements()` 只有 `test/slots.test.mjs` 在调；前端不读 `slots`，也不读 `/api/plugins` 的 `capabilityReport`。
- 前端 `public/views/registry.mjs` 的 `TAB_REGISTRY` 同时保存着页签名、目录归属、声明顺序（「声明序＝页签栏序」）与渲染行为——和 21 份 manifest 的 `slots[].page` 是两份真源，靠门禁互相对账。
- 第三方工作台即便装进来（OS-196），也没有页面可渲染——前端只有内置视图。

## 任务

### 1. 投影下发

`GET /api/plugins` 响应新增 `slots`：该库当前快照下 `slotPlacements()` 的结果，每个位置带 `{ slot, page, module, label, view }`；`view` 三态——`builtin`（前端有内置视图）／`iframe`（模块自带页面入口）／`none`（声明了位置但没有可渲染的页面，进启动报告的警告）。

### 2. 前端照投影渲染

- 页签栏、右栏卡片位、设置区的模块卡、宿主动作位，全部从投影生成；停用模块后投影里消失，前端不再另算隐藏名单（旧的 `tabHidden`／`hiddenTabs` 机制里只为「模块启停」服务的那部分退役；作者手动关掉某个页签的状态若仍需要，另立明确的键并写进命名表说明）。
- `TAB_REGISTRY` 退为**视图行为表**：页面 id → 渲染函数、图标、行为（可关闭、作用域、可见条件）；不再有页签名、目录归属、模块归属、顺序。宿主自己的路由（库管理、新建、导入、修复）照旧在表里。
- 进库时拉一次投影；投影拉不到时页面如实显示「拿不到工作台清单」，**不退回硬编码名单**。
- 新逻辑进 `public/views/`，`app.js` 只减不增。

### 3. 第三方工作台的页面

- manifest 的 `pages[]` 增加可选 `kind: 'iframe'` 与 `entry`（包内 HTML）。daemon 只对「来自已登记模块根的模块」提供 `/module-page/<模块 id>/<入口>`（内置模块不走这条路；套件仍然禁止任何 HTML）。
- 前端用通用视图渲染：标题条（页面名、模块名、版本、内容摘要）＋ iframe；页面与 daemon 的交互走同源 HTTP API（库路径经 URL 参数交给页面）。这是可信代码——OS-196 的信任模型写明「登记即信任」，这里不另设沙箱承诺，但要在 AGENTS.md 与设置页的风险说明里讲清楚。
- 内置视图优先：同一个页面 id 前端有内置视图就用内置的。

### 4. 门禁

- 前端一致性门禁加三条：前端代码里不许出现硬编码的页签名单或页签顺序；`TAB_REGISTRY` 不含页签名／目录／模块归属／顺序字段（宿主路由除外）；manifest 的 `slots[].slot` 必须在底座 slot 注册表里（已有校验保留）。
- 反证两则：(a) 临时在前端写死一个页签顺序数组，门禁红；(b) 临时在 manifest 里用 `{"slot":"sidebar","page":"x"}` 塞一个没登记的 slot，装载被拒。贴输出后还原。

## 测试

- 纯函数：同一组 manifest，`slotPlacements()` 的顺序稳定；停用某工作台后对应位置消失；本机同 id 覆盖内置后位置不变、归属换人。
- daemon 级（临时 `LOCALAPPDATA`）：`/api/plugins` 的 `slots` 与 manifest 一致；停用「习惯」后 `slots` 里没有 habits；重新启用后回来。
- 浏览器冒烟（隔离 daemon，临时库）：九个页签顺序与现在一致；停用某工作台后页签消失、其余不动；第三方工作台（临时模块根里的一个最小 `iframe` 页面模块）的页面能打开并调通一个端点。附截图路径与说明。

## 不做

- 不改任何对外契约的既有字段（`slots` 是新增字段）；不改端点路径与 MCP 工具名。
- 不碰作者真库与真实 `%LOCALAPPDATA%`；`app.js` 行数上限锚只许下调。

## 验收

- 机器门禁全绿；红线测试 `test/slots.test.mjs`、`test/tabRegistry.test.mjs`、`test/os172Naming.test.mjs`、`test/moduleManifest2.test.mjs`、`test/plugins.test.mjs` 全绿。
- 生产调用点贴出来（`文件:行`）：投影生成、前端消费、第三方页面路由。
- `docs/UX-STRUCTURE.md`、`docs/protocol/module-manifest-2.md`（§4.4 slot 一节）、`AGENTS.md` 同步。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
