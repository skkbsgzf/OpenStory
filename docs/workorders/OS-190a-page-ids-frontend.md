# OS-190a · 页面 id＝slug 的前端一半：页签 id／视图键归一＋升级后视图可解析

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内修复（上一张号＋字母，接 OS-190） |
| 对应 | OS-190 任务 2（页面 id＝slug）与任务 6（门禁）——验收发现只落到了 manifest 与升级映射，前端页签没改 |
| 依赖 | OS-190（`f68331c`） |
| 允许改动 | `public/**`、`src/protocol/libraryUpgrade.mjs`、`tools/verify/verify-os172-naming.mjs`、`test/tabRegistry.test.mjs`、`test/os172Naming.test.mjs`、`test/libraryUpgrade.test.mjs`、`test/naming.test.mjs`、`ARCHITECTURE.md`、`docs/number-anchors.json` |
| 风险 | 中——动前端页签 id 与视图键；对外契约名不变 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 现状（监督线验收实测）

- 21 份 manifest 的页面 id 已是 slug：`chapters`、`worldbook`、`roleplay`、`storysource`、`log`、`imagegen`、`knowledge`。
- 一次性升级（`src/protocol/libraryUpgrade.mjs` 的 `VIEW_ID_RENAMES`）把旧库的 `view`／`tabHidden`／`hiddenTabs`／`selectedTab` 映射成这些 slug（`dir:参考`→`worldbook`、`reference`→`worldbook`、`deduce`→`roleplay`、`write`→`chapters`…）。
- **前端页签还是旧 id／旧视图键**：`public/views/registry.mjs` 里 `{ id: 'write', view: 'write' }`、`{ id: 'reference', view: 'reference' }`、`{ id: 'deduce', view: 'deduce' }`（约 :228／:231／:248）。`go('worldbook')` 时 `viewScope()` 返回 `null`，`render()` 无对应条目——**升级后如果库里上次停在正文／世界书／扮演，打开会是空白页**。
- 同名门禁只核 manifest 的 `pages[].id`（`tools/verify/verify-os172-naming.mjs:95-101`），没核 `TAB_REGISTRY`，所以 OS-190 的门禁是绿的。

## 任务

### 1. 前端页签 id 与视图键归一

- `TAB_REGISTRY` 里三个页面型页签改成 slug：`write`→`chapters`、`reference`→`worldbook`、`deduce`→`roleplay`——`id` 与 `view` 一起改。
- 目录型视图（`dir:剧本`、`dir:故事源`、`dir:日志`）的 `view` 保持 `dir:` 前缀（它们是目录路由），但 `id` 与 manifest 页面 id 对齐。
- 全前端跟着改：`data-view` 选择器、`go()` 的调用点、`state.view` 比较、`visibleWhen`、默认页、`hiddenTabs` 初值、`PAGE_TO_DIR_LOCAL`／`DIR_TO_VIEW` 一类映射表、`DEFAULT_HIDDEN_TABS`。`public/app.js` 只许减不许增。
- `go()` 收到没有注册条目的 view：`console.error` 并退回第一个可见页签——不静默留白（先例：OS-53 的「吞异常处必须留日志」）。

### 2. 升级输出与前端视图键一致

- 升级后 `view`／`hiddenTabs`／`selectedTab` 的值必须是**前端认得的视图键**：写一条测试断言「`VIEW_ID_RENAMES` 的每个目标值 ∈ `TAB_REGISTRY` 的 view 集合（或 `dir:` 目录视图集合）」。
- 样例库的 `selectedTab` 是显示名「正文」而不是视图键——前端没有消费者（已核）：要么删掉这个键，要么改成视图键；二选一，写进回报。

### 3. 门禁补齐

- `tools/verify/verify-os172-naming.mjs` 增加断言：`TAB_REGISTRY` 里带 `module` 的条目，`id` 必须等于该模块 manifest 的 id；页面型页签（非 `dir:` 视图）的 `view` 必须等于 `id`。
- `test/tabRegistry.test.mjs` 加等价断言。
- 反证：临时把 `worldbook` 页签改回 `reference`，门禁与 `test/tabRegistry.test.mjs` 都必须红，贴输出后还原。

### 4. 端到端

- 隔离 e2e 的「水浒」段加一次「打开库后落在哪个视图」的检查；另外在临时夹具库里构造「旧库 `view: 'dir:参考'`」升级后直接打开，确认落到世界书页（贴输出）。
- 浏览器冒烟（隔离 daemon、临时库）：九个页签都能点开；升级过的旧库打开不是空白。

## 不做

- 不改 manifest（已经是 slug）；不改端点路径、MCP 工具名、错误码。
- 不碰作者真库与真实 `%LOCALAPPDATA%`；`app.js` 行数上限锚只许下调。

## 验收

- 机器门禁全绿；红线测试 `test/tabRegistry.test.mjs`、`test/os172Naming.test.mjs`、`test/libraryUpgrade.test.mjs`、`test/naming.test.mjs` 全绿。
- 任务 3 的反证、任务 4 的两条输出贴进回报。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过（`ARCHITECTURE.md` 与 `docs/number-anchors.json` 已列入允许改动）。
