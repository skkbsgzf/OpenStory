# OS-202a · 能力图返工：节点必须点得动

| 项 | 值 |
|---|---|
| 批次 | 第四批（段内返工）；主单 [OS-202](OS-202-governance-graph.md) |
| 依赖 | OS-202（`d0dbd56`） |
| 允许改动 | `public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 中——只改 SVG 节点的可点性与一处委托；不新增端点、不动后端 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 为什么返工（监督线 2026-11-26，浏览器实测＋源码核对）

浏览器里点能力图上的「事实内核」节点**毫无反应**：高亮没有出现、卡片没有展开、也没有滚动定位。

- `capabilityGraphSvg` 产出的节点是 `<g class="gov-graph-node" data-id="…" data-status="…">`，**没有 `data-gov-action`**。
- 治理台的整页点击委托是 `event.target.closest('[data-gov-action]')`；`graph-node` 这个分支虽写了，但没有任何元素会触发它。
- 结果是 OS-202 的核心交互（工单要求「点节点 → 只亮它的正反向依赖并定位到卡片」）在真实页面上不成立；纯函数测试全绿也没抓到，因为测试只直接调用了 `capabilityGraphSvg(graph, modules, { selected })`，从没模拟过点击。

同批还核到一处次要问题：`governanceHtml` 的「收起」按钮走 `graph-toggle`，这个分支是好的，但它与节点点击同属一个委托，节点不修就等于图是死的。

## 任务

### 1. 节点可点

`public/views/governanceViews.mjs`：

- 节点 `<g>` 上加 `data-gov-action="graph-node"`（`data-id` 已有），并按需加 `role="button"`、`tabindex="0"`、`aria-label`（名称＋状态），让键盘与读屏也能触发。
- 委托监听里补 `Enter`／`Space` 键触发同一动作（监听 `keydown`，只对带 `data-gov-action` 的元素生效）。
- 点节点＝`selectPlugin(id, true)`：选中该件、只亮相连边与相邻节点、其余压暗，并展开、滚动定位到对应卡片。再点同一节点＝取消选中（与卡片行的开合口径一致）。

### 2. 测试（新建断言，必须能在「没接线」时红）

`test/governanceViews.test.mjs` 加例：

- `capabilityGraphSvg` 输出里每个节点都带 `data-gov-action="graph-node"` 与 `role="button"`，数量与节点数相等。
- 治理台整页 HTML（`governanceHtml`）里的 `<svg class="gov-graph"…>` 节点同样带该属性（防止只在纯函数分支加、装配时又被换掉）。
- **接线回归**：用假 DOM 断言委托选择器能命中——即页面上存在 `[data-gov-action="graph-node"][data-id]` 元素（这条就是本次缺陷的直接护栏）。

## 不做

- 不改布局、配色、底座说明条；不改卡片流与确认条（OS-201 已验收）。
- 不动后端与投影字段。

## 验收

- 机器门禁全绿；`app.js` 行数不增（当前 10,096）；`git diff --check` 干净。
- **浏览器实测必做**（这次是缺陷的发现方式）：点节点后截图证明高亮与定位生效，贴截图路径。
- 反证：把节点上的 `data-gov-action` 去掉，新加的接线测试必须红；贴输出后还原。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 878 · pass 876 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- `public/views/governanceViews.mjs`
- `test/governanceViews.test.mjs`
- `README.md`
- `AGENTS.md`
- `ARCHITECTURE.md`（`npm run arch:stats` 回写）
- `docs/number-anchors.json`（`node tools/number-anchors.mjs` 回写）

VERIFIED:
- `node --test test/governanceViews.test.mjs`：25/25 过。
- 反证：临时删掉节点上的 `data-gov-action` 后，3 条新断言红（`每个节点都要能被整页委托命中`／装配断言／`页面上没有任何可被委托命中的 graph-node 节点`），还原后复跑 25/25 过。
- `node .zcode/run-gate.mjs`：878 例 / 876 过 / 2 跳过 / 0 挂。
- `npm run arch:stats` → `node tools/number-anchors.mjs` → `node tools/acceptance/acceptance.mjs`：29 过 / 0 挂 / 0 警。
- `git diff --check` 干净；`public/app.js` 仍为 10,096 行。
- 浏览器实测：`startDaemon({ port: 0 })` 临时库 + Edge CDP，真实鼠标点击 `graph-node/data-id=fact`；命中目标 `rect → graph-node/fact`；点击后 `nodeSel=true, hotEdges=14, dimNodes=10, cardOpen=true, cardFlash=true, cardVisible=true`。截图：`C:/Users/Administrator/AppData/Local/Temp/os202a-graph-highlight.png`。临时脚本与库已删除，未动 8807 daemon。

LIMITATIONS: 无
```
