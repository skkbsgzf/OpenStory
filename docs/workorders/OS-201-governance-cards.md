# OS-201 · 治理台·卡片流与启停确认

| 项 | 值 |
|---|---|
| 批次 | 第四批第 2 张；规划见 [`plugin-frontend-batch-20261126.md`](../plan/plugin-frontend-batch-20261126.md) §5 |
| 对应 | 规划书 §三-2、§四 4.1～4.4（卡片与启停）、§五 第 2、3 步的卡片部分；规划 §2 原型 |
| 依赖 | OS-200（`/api/plugins` 的 `modules[]` 推导字段与 `toggleCheck`） |
| 允许改动 | `public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`design-system/tokens.css` |
| 风险 | 中高——替换设置页「模块」一节、动启停交互；`app.js` 只减不增。能力图不在本单（OS-202） |
| 状态 | 待派（等 OS-200 验收） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

设置页插件中心里的「模块」一节升级为**插件治理台**的卡片流：投影里的每一件一张卡（内核件只读、工作台可启停、宿主组合面身份说明），每张卡讲清身份、供给、依赖逐条（谁供给）、谁依赖我、设置指路、停用影响；停用先出确认条（影响面按位置生成），确认后各处照投影即时变化；没开库时开关置灰；闸拒绝时如实显示原因。

## 现状（监督线 2026-11-26 实测）

- 「模块」节＝`public/views/settingsAggregation.mjs` 的 `renderSettingsModules`：每张卡只有名字、一个启用开关和一行指路（或自报设置项）；没有依赖、没有谁依赖我、没有状态。
- 启停：`public/app.js` 的 `plugin-module-toggle` 动作 → `uiSet('modules.enabled.<id>', …, { immediate: true })`，末尾 `.catch(() => render())` **把闸的报错吞掉**，开关只是弹回去；而 `uiFlush()` 落库失败不回滚内存，会出现「内存里已停用、库里仍启用」的错位。
- 12 件工作台里只有 8 件有页签：分析在右栏、导入导出在顶栏动作位、生图与识图／知识库在设置区。停用影响必须按位置说，不能一律说「页签消失」。
- 内置 21 件没有任何自带设置项：工作台只有 `settingsHint`（生图与识图、知识库另有 `settingsJump: 'engines'`）。自报设置项的渲染只对本机模块有用，但必须留着。
- `test/shellViewsC6.test.mjs` 钉着 `settingsModuleSettingsSectionHtml` 的占位与一行转交壳。

## 原型参考（只读，不许改）

`D:\Pinax-e2e\.zcode\tmp\wkbd-proto\index.html` 是作者原型的可运行副本——只看**信息架构与交互**；读不到就按本工单的文字口径做。它的色值、像素、写死的数据与坐标，以及下面这些已知毛病一律不照搬：导航断行、摘要被截成几个字、锁死开关画成关着的灰开关、内核件卡的空指路框、确认条复述指路文案。

## 任务

### 1. 视图模块 `public/views/governanceViews.mjs`

零 import；工厂 `createGovernanceViews(scope)`，依赖由 `app.js` 注入（`state`、`esc`、`text`、`uiKit`、`loadPlugins`、`render`、`setModuleEnabled`、`uiSet`、`uiMemory`、`settingsAggregation`、`navLabel`）。具名导出纯函数供 Node 测试：`governanceModel(payload, uiState)`、`pluginCardHtml(card, options)`、`confirmStripHtml(card)`；整页 `governanceHtml()`。载荷缺字段或畸形时如实产出空态，不抛错；投影拿不到时写「拿不到插件清单：<原因>」，**不退回任何写死的名单**。

**模型** `governanceModel(payload, uiState)` → `{ total, groups: […] }`：三组顺序固定为内核件 → 工作台 → 宿主组合面，每组带 `id`／`label`／`desc`／`cards`；每张卡带 `id, name, version, cls, clsLabel, builtin, status, summary, provides, requires, dependents, impact, toggleCheck, surfaces, hint, jump, jumpLabel, settings`。`surfaces`＝该件在 `payload.slots` 里的位置集合（`tab/right/settings/host-actions`）；`settings` 的值按 `settingsAggregation.aggregateSettings` 的口径从 ui-state 补齐；`jumpLabel` 由 `navLabel(jump)` 取，取不到回落区块 id。

**卡片收起一行**：类别点 · 名称 · `id@v版本`（等宽）· 类别徽标（本机模块另加「本机」）· 一句摘要 · 状态点 · 开关或锁 · 展开箭头。摘要口径（放不下可省略，但前半句必须完整）：

| 卡 | 摘要 |
|---|---|
| 内核件 | `供给 N 项 · 被 M 件依赖`（M＝状态正常的直接依赖方数） |
| 工作台·正常 | `<出现位置> · 依赖 N 项`；出现位置取自 `surfaces`：`tab`→页签、`right`→右栏、`settings`→设置区、`host-actions`→顶栏动作，多处用顿号连 |
| 工作台·已停用 | `已停用 · 数据与配置保留` |
| 工作台·降级 | `降级 · 缺 <能力 id，顿号分隔>` |
| 宿主组合面 | `依赖 N 项 · 宿主自带` |

状态点：正常 `--ok`、已停用 `--meta`、降级 `--warn`。**只有工作台有可操作开关**（复用既有 `.sm-toggle` 按钮式样，带 `role="switch"` 与 `aria-checked`）；内核件与宿主组合面**不画开关**，画锁形标记，`title` 写「不可停：<原因>」。

**卡片展开（通栏）三栏**：

- 「供给」：`◆ <能力 id>@v<版本>`，金样带 `★金样`。
- 「依赖」：`✓ <能力 id>@v<最低版本> ← <供给方名称>`；不满足的打 `✗` 并写原因；底座能力的供给方写「底座」。
- 「谁依赖我」：依赖方胶囊（带类别点；非正常态的加「已停用」／「降级」小标）；没有则写「没有插件依赖我——停用只影响自己的工作面。」
- 内核件另有一条说明：`toggleCheck.ok === false` 时「不可停的原因：<活跃依赖方名称，顿号分隔> 依赖本件供给的能力，停用即断链。」；`impact` 非空再接「连锁影响：<名称，顿号分隔>。」——活跃依赖方取 `toggleCheck.consumers`，`base` 写「底座」。宿主组合面写「宿主域实现，随宿主走，不随工作台启停」。

**设置区（只在有内容时出现；内核件不出空框）**：模块自报了 `settings` → 按 schema 渲染表单，值取 ui-state `modules.settings.<id>.<key>`，停用时整块只读、值保留；只有 `settingsHint` → 指路框，有 `settingsJump` 再加「去 <区块名> →」按钮（`data-settings-section="<id>"`，区块名不写死）；两者都没有 → 不出设置区。

**降级件**：依赖行打叉之外，卡内给恢复办法——缺的能力有供给方就写「恢复办法：让供给方「X」恢复供给」；没有供给方（能力没人供给）就写「需要一件供给 <能力 id> 的插件」。

### 2. 启停确认（卡内确认条，不用弹窗）

- 点**已启用**工作台的开关 → 卡片展开并在卡底出现确认条：标题「确认停用「X」？」＋影响面正文＋「取消」／「确认停用」（危险色按钮）。影响面**按 `surfaces` 逐个生成**，不许复述指路文案：

| 位置 | 文案 |
|---|---|
| `tab` | 「停用后，页签「X」从导航消失。」 |
| `right` | 「停用后，正文右栏里它的卡片收起。」 |
| `settings` | 「停用后，设置页里它的配置区收起，已填的值保留。」 |
| `host-actions` | 「停用后，顶栏的「X」入口收起。」 |

  固定收尾句：「库内数据与配置全部保留，重新启用即恢复。」该件当前是降级态时再加一句：「它现在缺 <能力 id>；停用后再启用仍是降级，直到依赖恢复。」
- 点**已停用**工作台的开关 → 直接启用，不确认。
- 确认停用与直接启用都走同一条写回：成功后 `loadPlugins()` → `render()`（页签、右栏、设置区照投影即时变化）；被闸拒绝 → 卡内如实显示错误码与原因，开关回到原位。**不许吞错，不许出现内存与库错位。**
- 交互由视图自己的委托监听承担（动作名一律 `gov-` 前缀，照 OS-196 本机模块区的做法），`app.js` 不新增动作分支。

### 3. 写回（`public/app.js`）

把旧的 `plugin-module-toggle`／`plugin-module-setting` 两个动作分支交给视图后删除。新增一个模块启停专用的写回（建议 `setModuleEnabled(id, enabled)`）：先把排队中的界面状态写掉（免得整份内存把它盖回去），再以补丁形式 `PUT /api/ui-state`（只带 `modules.enabled.<id>` 这一个键），成功后以库为准回填内存镜像（`loadUiState()`）；失败原样抛出、内存不动。自报设置项的写入照旧走 `uiSet`。

### 4. 没开库

`state.current` 为空时开关置灰并带 `title`「先打开一个库——启停按库分别记」；能力、依赖、指路照常可看（读机器级投影）。页头一行实况：「N 件 · 当前库：<库名>」或「N 件 · 未打开库」，N 取投影，不写死 21。

### 5. 导航

「插件中心」里的 `moduleSettings`（模块）一节换成 `governance`「插件治理台」（提示语：能力图 · 启停 · 依赖 · 设置指路）；旧 id `moduleSettings` 的深链重定向到它。旧的「模块」节渲染（`settingsModuleSettingsSectionHtml`、`settingsAggregation.renderSettingsModules` 与 `moduleSettingsSectionHtml`）退役——新卡必须覆盖它原有的全部能力（启停、指路、自报设置项、停用只读）。`aggregateSettings` 保留（新卡在用）。

### 6. 样式与 `app.js`

- `.gov-*` 类写进 `public/index.html` 的 `<style>`。三类着色新增语义令牌 `--cat-kernel`／`--cat-workbench`／`--cat-host` 进 `:root`，同步 `design-system/tokens.css`；浅底色用 `color-mix(in srgb, var(--cat-*) 10%, var(--bg))` 派生，深浅两套皮肤都要看得清。卡片两列，窄屏（≤720px）一列；字号只用 `--ui-fs-*`，间距只用 `--ui-gap-*`／`calc(Npx * var(--ui-scale))`。导航项的标签与提示上下两行，不许挤在同一行断字。
- `app.js` 只做接线（动态 import＋一行转交壳＋boot 等 ready），净行数只减不增。

## 测试（新建 `test/governanceViews.test.mjs`）

夹具直接用 OS-200 的纯函数对内置 21 件生成 `/api/plugins` 形状的载荷，不手抄。

- **模型**：三组 7／12／2、顺序正确；`fact` 摘要「供给 7 项 · 被 10 件依赖」；`roleplay` 摘要含「页签」；`analysis` 含「右栏」；`exchange` 含「顶栏动作」；`imagegen` 含「设置区」；`surfaces` 与 `slots` 投影一致。
- **卡片**：展开 `fact` → 含 `★金样`、10 个依赖方胶囊、「不可停的原因」与「连锁影响：生图与识图、日志」；展开 `roleplay` → 依赖四行各带供给方名、有指路框无跳转按钮；`imagegen` → 有「去 引擎与存储 →」且 `data-settings-section="engines"`；内核件卡没有指路框；工作台有 `role="switch"`；内核件与宿主组合面没有开关、有锁；宿主组合面卡有「随宿主走」的身份说明；名称里带 `<script>`、`"` 时被转义。
- **确认条**：四种位置各自的文案＋固定收尾句；多位置连写；降级件多一句；已停用件不出确认条。
- **没开库**：`state.current` 为空 → 开关 `disabled` 且 `title` 含「先打开一个库」；页头写「未打开库」。
- **自报设置项**：一个声明了 `settings` 的夹具模块 → 渲染表单、值取自 ui-state；停用后控件 `disabled` 且值还在。
- **降级夹具**：手工构造 `status:'degraded'`、`missing` 含一条无供给方的依赖 → 状态与摘要、`✗` 行、「需要一件供给 … 的插件」。
- **空态**：载荷为 `null`／畸形 → 空态与「拿不到插件清单」，不抛错。
- **视图源码**：零 import、无 eval／浏览器存储字样；`app.js` 里不再有 `plugin-module-toggle`，`setModuleEnabled` 以补丁形式写 `/api/ui-state` 并回填内存。
- **导航**：`settingsHtml()` 的导航含「插件治理台」且不再有「模块」一节；`state.settings.section === 'moduleSettings'` 渲染的是治理台。

## 既有测试的合法改写（逐处说明，断言不弱于原来）

- `test/shellViewsC6.test.mjs`：第 50 行 `settingsModuleSettingsSectionHtml` 的占位断言、第 67–68 行的聚合晚绑定断言 → 改指治理台（无载荷给空态；导航含「插件治理台」）；C6 表加一行 `governanceViews: ['governanceHtml']`，并要求 boot 等到 `governanceViewsReady`。
- `test/settingsAggregation.test.mjs`：第 138 行（停用整卡只读、控件 disabled）、第 150 行（只给工作台开关，宿主组合面／内核件／套件不伪装成开关）、第 351 行（指路行＋跳转按钮，不渲染空输入框）三条改指治理台卡片；`aggregateSettings` 的三条（第 60／99／119 行）保留不动。
- `test/coreModules.test.mjs`：第 177 行「设置页：四工作台改为普通开关，停用压暗…」与文内对 `plugin-module-toggle`／`renderSettingsModules`／`aggregateSettings` 的引用，改指治理台卡片。
- 其余文件里若引用了被退役的函数名，一并改指新实现并在回报里列出。

## 不做

- 能力图（OS-202）；降级件在各出现位置的灰显与说明页（OS-203）；导航两大域的收敛、面板独立成节、全部套件改读单一投影（OS-204）。
- 不开放内核件与宿主组合面的启停；不新增端点。

## 验收

- 机器门禁全绿；`app.js` 行数不增；`git diff --check` 干净。
- 生产调用点贴出来（`文件:行`）：视图工厂与转交壳、boot 等待、`setModuleEnabled`、导航入口与旧 id 重定向。
- 反证一则：把确认条文案临时换成复述指路文案，对应测试必须红；贴输出后还原。
