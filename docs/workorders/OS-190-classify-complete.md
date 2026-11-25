# OS-190 · 分类补齐：两个 slug 归一＋页面 id＝slug＋「日志」立 manifest

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 3 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §四 C1–C3、§五 D7；ADR 0002 §2.2／§2.4／§九 D3 |
| 依赖 | OS-189 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`samples/**`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`README.md`、`AGENTS.md`、`docs/adr/0002-base-constitution.md`（§2.2／§2.4 两张表）、`docs/workorders/OS-190-classify-complete.md` |
| 风险 | **中**——改名面广（模块目录、页面 id、DOM id、设置键、门禁锚点）；对外契约名一个不动 |
| 状态 | 已实施（2026-11-25；机器门禁全绿，待监督线验收） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

把分类表逐行落到实处：**一个正名、一个 slug、一个页面 id，三者相同**；分类表里的 12 个工作台一个不缺；「Pi-Agent」这个别家产品的名字从界面上消失。

## 现状（监督线验收实测）

- 模块 `comfyui`（显示名「生图与识图」，`src/modules/comfyui/`）与 `kb`（「知识库」，`src/modules/kb/`）：slug 不是正名对应的唯一机器名；`comfyui` 还是后端厂商名。
- 命名表 `public/views/registry.mjs:102-104` 另散着 `vision`、`imagegen`、`kb` 三个概念 id，和上面两个模块对不上。
- 工作台 11 个，分类表（ADR 0002 §2.4）12 个：缺「日志」——目录型页签（`registry.mjs:87,239`），没有 manifest。
- 页面 id 与 slug 不一致：世界书页 id `reference`、扮演页 id `deduce`、故事源页 id `storySource`、正文页 id `write`；manifest 的 `slots[].page` 与库内 ui-state 的 `view`／`tabHidden` 用的都是这些 id。图谱节点类型也还叫 `reference`。
- 内置 module@2 套件的归属显示「OpenStory」（`src/services/suites.mjs:220`），`suites/comicdrama/manifest.json` 写的是 `skkbsgzf`——两套口径。

## 任务

### 0. Agent 栏的显示名改成「Agent 栏」

现状：`public/index.html:2698` 头部写的是 `<span class="agent-name">Pi-Agent</span>`，而插件名是「Agent 栏」——违反三名一致，且「Pi」是别家产品的名字。改显示名与头像字母；`index.html:164`、`public/app.js:18`、`tools/dsh-openstory-studio/client.js:9,25` 与其 `README.md:28` 的说明文字同步改称「Agent 栏」。三名一致门禁加一条：`index.html` 里 `.agent-name` 的文本必须等于 `agentbar` manifest 的 `name`。反证：临时改回「Pi-Agent」，门禁红，贴输出后还原。

### 1. 两个 slug 归一

`comfyui` → `imagegen`，`kb` → `knowledge`。以下一起改，一个不漏：

- 模块目录（`src/modules/imagegen/`、`src/modules/knowledge/`）与 `manifest` 的 `id`；模块内源文件名跟着改（如 `kbRouter.mjs` → `knowledgeRouter.mjs`）。
- 命名表：「生图与识图」只留 `imagegen` 一个 id（`vision` 并进去，「识图」是它的功能之一）；「知识库」用 `knowledge`。删掉散落的旧概念 id。
- 页面 id、DOM id、`data-*`、CSS 类前缀（`kb-` → `knowledge-`）、设置键（`modules.settings.<id>.*`）、启停键（`modules.enabled.<id>`）。
- 测试、验收门禁锚点、`tools/**` 里的引用、样例库 `samples/水浒传/.openstory/ui-state.json`（用生成脚本重跑，不手改；生成后不留 `.openstory/.history/` 备份——现在的样例库里就留着一份 `ui-state.json.bak-*`）。

**对外契约名一个不动**：端点路径（`/api/kb/*`、`/api/vision/*`、`/api/reference/image` 等）、MCP 工具名、错误码。

### 2. 页面 id＝slug

规则写进命名表并被门禁钉住：一个正名、一个 slug、一个页面 id，三者相同。正文 `chapters`、世界书 `worldbook`、扮演 `roleplay`、故事源 `storysource` 四个页面的 id 改掉；非页签位（右栏、设置区、宿主动作）的页面同样用 slug 当页面 id（如 `analysis`、`exchange`、`imagegen`、`knowledge`）。图谱节点类型 `reference` → `worldbook`。

### 3. 一次性升级里的 id 映射

已发布的 v0.2.0 库里存着旧 id（页面 id `write`／`reference`／`deduce`／`storySource`，启停与设置键 `modules.enabled.comfyui`／`kb`、`modules.settings.comfyui.*`／`kb.*`）。在 `src/protocol/libraryUpgrade.mjs` 的一次性升级里直接映射成新 id——扁平键与嵌套形状（`modules: { enabled: { … } }`）都要认；旧库的视图键（`dir:参考`、`dir:推演` 等）直接映射到新页面 id，不再经过中间 id。作者的库只迁一次。

测试：带旧 id 的夹具库升级后，ui-state 里只剩新 id；重复打开幂等。

### 4. 「日志」立 manifest

`src/modules/log/module.manifest.json`：`class: workbench`、slot `tab`、页面 `log:日志`、`requires: prose.write`。**不声明独占端点**——`/api/log*` 是共用端点，各模块的「本模块修改」卡都读它。停用「日志」＝页签消失，日志数据保留。它在设置页的插件总览里是一枚普通开关。

### 5. 内置套件归属统一

内置 module@2 套件的归属显示 `skkbsgzf`（`src/services/suites.mjs:220`），与 `suites/*/manifest.json`、技能头的 `vendor` 同一口径；本机套件仍显示「本机」。

### 6. 门禁

三名一致门禁（`tools/verify/verify-os172-naming.mjs`）加三条断言：页面 id＝slug；每个工作台的 manifest `name`＝正名；分类表里的 12 个工作台都有 manifest。反证：临时把某个页面 id 改回旧词、临时删掉「日志」manifest，门禁都必须红，贴输出后还原。

## 不做

- 不改端点路径、MCP 工具名、错误码；不改能力 id（仍是 `media.*`）。
- 不碰作者真库与真实 `%LOCALAPPDATA%`。
- `public/app.js` 只许减不许增（行数上限锚只许下调）。

## 验收

- 机器门禁全绿；红线测试 `test/naming.test.mjs`、`test/os172Naming.test.mjs`、`test/tabRegistry.test.mjs`、`test/moduleManifest2.test.mjs`、`test/libraryUpgrade.test.mjs`、`test/settingsAggregation.test.mjs` 全绿。
- 21 份 manifest（7 kernel＋12 workbench＋2 宿主组合面）对照表贴进回报（`node D:\Pinax-e2e\.zcode\tmp\accept-d-manifests.mjs` 的输出）。
- 任务 6 的两则反证贴输出；任务 3 的升级测试贴输出。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 812 · pass 810 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
All work is complete. Let me produce the final report.

CHANGED: 76 个路径（均在工单「允许改动」范围内）。核心文件如下：
- `public/index.html`、`public/app.js`、`public/graph.mjs`、`public/referenceStore.mjs`
- `public/views/registry.mjs`、`agentViews.mjs`、`referencePageViews.mjs`、`referenceViews.mjs`、`settingsViews.mjs`
- 模块目录重命名：`src/modules/comfyui/`→`src/modules/imagegen/`（含 `imagegenEngine.mjs`、`index.mjs`、`module.manifest.json`）；`src/modules/kb/`→`src/modules/knowledge/`（含 `knowledgeAdapter/Health/Router.mjs`、`index.mjs`、`manifest`）
- 新增 `src/modules/log/`（`module.manifest.json`、`index.mjs`）；各工作台 `index.mjs`＋manifest 的 page id 改为 slug（chapters/worldbook/storysource/roleplay/analysis/exchange）
- 协议叶重命名：`src/protocol/kb{Adapter,Health,Router}.mjs`→`knowledge*.mjs`（重导出路径同步）
- `src/protocol/libraryUpgrade.mjs`（旧 id 直接映射：视图键＋扁平/嵌套启停与设置键）、`src/protocol/modules.mjs`、`src/services/{suites,systemPrompt}.mjs`、`src/api/handlers/system.mjs`、`src/host/daemon.mjs`、`src/modules/worldbook/referenceStore.mjs`
- `test/**` 共 20 个测试文件（含红线 6 个）；`tools/**`（naming 门禁、acceptance 边界、eval、sample 生成器、dsh 插件说明）
- 文档：`AGENTS.md`、`ARCHITECTURE.md`（arch:stats 回写）、`README.md`、`docs/adr/0002-base-constitution.md`、`docs/workorders/OS-190-classify-complete.md`
- `samples/水浒传/.openstory/ui-state.json`（生成脚本重跑；`.openstory/.history/` 的 `.bak-*` 已清除）

VERIFIED:
- `npm test` → 812 例 / 810 过 / 0 挂 / 2 条件跳过，exit 0
- 红线 6 个测试（naming / os172Naming / tabRegistry / moduleManifest2 / libraryUpgrade / settingsAggregation）全绿
- `node tools/acceptance/acceptance.mjs` → 27 过 / 0 挂 / 0 警
- `node tools/number-anchors.mjs --check` → 一致（812 例／门禁 27／端点 105／app.js 10338≤10500）
- `npm run arch:check`（`arch-stats.mjs --check`）→ 生成段一致
- `node tools/verify/verify-os172-naming.mjs` → exit 0（naming/lineage/agent 三项 ok）
- `node tools/verify/verify-os172-e2e.mjs` → 水浒 10/10 ＋ 新建/半成品 13/13，图谱节点类型显示 `worldbook:14`
- `node tools/samples/generate-sample-config.mjs` → 样例库重生成；生成器已加清理 `.openstory/.history` 逻辑
- `node D:\Pinax-e2e\.zcode\tmp\accept-d-manifests.mjs` → 21 份 manifest：`{"kernel":7,"(缺)":2,"workbench":12}`
- `git diff --check` → 无错误（仅 CRLF 提示）
- 任务 3 升级测试输出：`node --test test/libraryUpgrade.test.mjs` → 9/9 过（其中 OS-190 映射断言并入既有测试：view/write→chapters、tabHidden/reference·dir:推演·storySource→worldbook·roleplay·storysource、扁平+嵌套 `modules.enabled/skills` comfyui→imagegen、kb→knowledge、重复打开幂等）
- 任务 6 三则反证（临时改动后门禁 exit=1，还原后 exit=0）：
  - A：`index.html` 的 `.agent-name` 改回「Pi-Agent」→ `"agent.ok": false`，violation `.agent-name「Pi-Agent」≠ agentbar manifest name「Agent 栏」`
  - B：`chapters` manifest 的 page id 改回 `write` → `"naming.ok": false`，violations `页面 id「chapters」≠ slug「write」`／`slot.page「chapters」≠ slug「write」`
  - C：临时删除 `src/modules/log/module.manifest.json` → `"naming.ok": false`，violations `模块 manifest 缺失`／`工作台 manifest 缺失`／`分类表 12 个工作台只找到 11 个 manifest`

LIMITATIONS: 无

（说明：`verify-shuihu.mjs` / `verify-newproj.mjs` 单独直跑需编排器设置 `OPENSTORY_ROOT` / `OPENSTORY_TEST_PREFERENCES_PATH` 环境变量，故未单独直跑；其覆盖已由 `verify-os172-e2e.mjs` 在临时夹具＋临时 LOCALAPPDATA 上实跑全绿。未执行任何 git add/commit/push，未启动或杀 daemon，未碰作者真库与真实 LOCALAPPDATA。）
```
