# OS-164 · 段 C 第 4 步：世界书与扮演升格核心模块 ＋ 世界书目录归属（G8b）

| 项 | 值 |
|---|---|
| 批次 | 段 C·工作面插件化收尾 |
| 对应 | 第一批 G5c＋G8b（作者裁定「参考/ 冻结，世界书/ 是 Pinax 载体兼容输入」） |
| 依赖 | OS-163 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中（含新建库骨架变更，属行为变化） |
| 状态 | 已验收（2026-11-24） |

## 目标

两件：世界书与扮演升格为核心模块（`core:true` 不可停用）；把「世界书目录归属」按作者裁定定死，顺手清掉新建库骨架的历史包袱。

## 动工前必读

- OS-163 落地的正文／剧本核心模块与 `MODULE_CORE` 口径（照抄，不要另起一套）。
- `src/modules/library/projectDoc.mjs`：**新建库骨架表**（约 `:63` 的 `novel` 行仍建 `正文/大纲/世界书/构思/资料/日志/约束`）。
- `src/modules/library/importAdapter.mjs` 的 `ALLOWED_PROJECT_DIRS`（白名单里没有 `参考`）。
- `public/views/registry.mjs` 的 `NAMING_TABLE`（OS-148；`reference` 的页签叫「世界书」、目录叫「参考」）与 `RETIRED_DIRS`。
- 左栏「参考图谱／世界书图谱」两种叫法（`public/app.js` 与 `src/protocol/chapterWrite.mjs` 各一处）。

## 任务

### 一、两个核心模块
1. `src/modules/worldbook/module.manifest.json`（`core: true`）：独占端点 `referenceGet`／`referenceGraphGet`／`referenceNoteGet`／`referenceAssetGet`／`referenceAbsorb`（`referenceImageGenerate` 属生图模块，不在此列）；共享的 fact 读端点如实登记。
2. `src/modules/roleplay/module.manifest.json`（`core: true`）：独占 deduce／roleplay 开头的端点（`deduceImage` 若属生图模块则不在此列）。
3. 两模块接进「不可停用」两层（恒启用＋写停用拒 `MODULE_CORE`），各补测试。
4. 视图迁出：`referencePageHtml`／`referenceEditorHtml`／`referenceEntryDetailHtml`／`referenceGraphHtml`／`refModulesHtml` 与扮演的 `deduceHtml` 及 `deduce*` 纯 HTML 构造函数搬进 `public/views/`（注意 `reference.mjs`、`referenceStore.mjs`、`graph.mjs` 已存在，别重名）；
   打字机、定时器、滚动跟随、会话状态机一律留在 `app.js`。配金样测试＋纯度测试。
5. **换库清缓存那条线不许断**：`reference`／`refCol`／`deduce` 相关缓存的清理调用点逐个核对仍在（OS-66 的教训）。

### 二、世界书目录归属（G8b，按作者裁定）
6. **`参考/` 冻结**：不改名、不迁移既有库。
7. **`世界书/` 定义为 Pinax 载体兼容输入**：新建库**同时**建 `参考/`（真正的笔记目录）与 `世界书/`（兼容占位）；
   建库时若选了「从 Pinax 载体导入」，`世界书/` 的内容走 absorb 进 `参考/`。
8. **新建库骨架去掉四个已退场目录**（`大纲/构思/资料/约束`）：`projectDoc.mjs` 的骨架表改成 `正文/参考/世界书/日志`（剧本库同理）；
   每个退场目录的去向写进注释（内容归 `参考`／`习惯`）。
9. **导入白名单补 `参考`**：`ALLOWED_PROJECT_DIRS` 加 `参考`（现在导入稿件写不进参考目录）。
10. **图谱/摘要叫法统一**：左栏与右栏统一为「世界书图谱」「世界书摘要」（与页签名一致），命名表里登记；代码里两处字面量改为取表。
11. `test/newLibrarySkeleton.test.mjs`：新建库的目录集合恰为骨架表所列（不含退场目录、含 `参考/`）；导入白名单含 `参考`。

## 不做

- 不迁移既有库（旧库不迁移红线）；不给既有库补建目录。
- 不动 `src/kernel/**`；不改 Host API；不动 `package.json` 依赖。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）；`node tools/acceptance/acceptance.mjs` 全绿。
- **缺省页签快照不改**；`public/app.js` 行数净下降。
- 收尾跑 `npm run arch:stats` 回写。
- 报告贴：新建库的 `ls`（实际建出来的目录）、四条不可停用证据、两处叫法统一前后的 grep。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言（新建库骨架变化的测试属合法更新，逐处说明）。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件；测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过或规格矛盾——停下来如实上报。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）

- **两个 manifest**：`src/modules/worldbook/module.manifest.json`（`core:true`，独占 `referenceGet` / `referenceGraphGet` / `referenceNoteGet` / `referenceAssetGet` / `referenceAbsorb`；`referenceImageGenerate` 仍归 comfyui，fact 读端点为共享通道）与 `src/modules/roleplay/module.manifest.json`（`core:true`，独占 17 个 `deduce*`/`roleplay*` 端点，`deduceImage` 仍归 comfyui）。`CORE_MODULE_IDS` 现为四枚：chapters／script／worldbook／roleplay。
- **证据① 恒启用**：`test/coreModules.test.mjs` 同时写扁平＋嵌套 `modules.enabled.<id>=false`，四枚核心全 true；遍历四个 manifest 的全部独占端点，`isModuleDisabledFor` 全为 null；普通模块 habits 仍按 false 停用（对照）。
- **证据② 拒写**：`uiStatePut` 对 worldbook／roleplay 的扁平键与嵌套键写 false 一律 409 `MODULE_CORE`，拒写后 ui-state 文件未落该键；普通键照旧写。设置页 `checked disabled`＋「核心模块」徽标由 OS-163 的通用逻辑自动覆盖新两枚。
- **证据③ 页签恒在**：`TAB_REGISTRY` 的 reference／deduce 显式声明 `module: worldbook/roleplay` 与 `moduleCore:true`（不改页签级 `core`；registry 仍零 import）。显式启用集合传空集时正文／剧本／世界书／扮演四页签全在，habits 照常消失；`test/tabRegistry.test.mjs` 快照与对拍全绿，缺省页签 diff 为空。
- **证据④ 端点恒通**：ui-state 写 false 后起真实 daemon，`GET /api/chapters`、`GET /api/chapter`、`GET /api/reference`、`GET /api/deduce/sessions` 全部 200。
- **视图迁出**：新增 `public/views/referenceViews.mjs`（6 个：词条详情／编辑器／图谱节点卡／图谱页／左栏模块卡／页面外壳）与 `public/views/deduceViews.mjs`（12 个：剧情树／事实包／序章／命运骰人话／你的回合／事实待确认卡／本拍正文／在场头像／待决回合／已知信息牌／Agent 表单等），均零 import／零 DOM／零存储，配金样与薄壳测试。**`app.js` 12,242 → 11,841，净降 401 行**（相对 OS-163 开工 12,310 累计净降 469）。`deduceEngineHtml`（226 行状态机装配）、打字机、定时器、滚动跟随、会话流程与 `scriptToFactFlow` 同口径留宿主；`deduceHtml` 本身是三行路由壳，未迁。
- **换库清缓存那条线未断**：逐点核对仍在——`state.refCol` 重置、`state.reference` 重置、`state.deduce` 重置、`graphCleanup?.()`、`deduceTreeCleanup?.()`、换库前 `deduceBgmStop()`；纯视图迁出没有拿走任何清理调用。
- **世界书目录归属（G8b）**：`projectDoc.mjs` 骨架表改为 novel `正文/参考/世界书/日志`、screenplay `剧本/人物/场景/参考/世界书/日志`、generic `文档/日志`；四个退场目录注释写明去向（大纲→参考，构思→习惯＋参考，资料→参考，约束→习惯＋参考）。`test/newLibrarySkeleton.test.mjs` 真建库 `readdir` 验证目录集恰为骨架表（`ls` 证据）。**既有库不迁移、不补建**。
- **导入与 absorb**：`importAdapter.mjs` 的 `ALLOWED_PROJECT_DIRS` 补 `参考`（旧载体目录仍留白名单只为兼容导入）。`referenceStore.ABSORBABLE_DIRS` 补 `世界书`——载体导入落在 `世界书/`，经 `referenceAbsorb` 走既有 `writeChapterWithBackup`＋`deleteChapter`（源进 `.history`）搬进 `参考/世界书/…`；契约注释同步（原文写「只接受大纲/构思/资料/约束」与实现不一致，一并纠正）。`test/contracts.test.mjs` 用真实 daemon 验证世界书 absorb 落盘目标。
- **叫法统一前后 grep**：改前 `app.js` 有 `label: '参考图谱'`、`label: '参考摘要'` 与按钮文案 `点「重新构图」生成参考图谱`；改后 `NAMING_TABLE` 的 reference 行登记 `graphLabel: '世界书图谱'`／`summaryLabel: '世界书摘要'`，三处均改为 `registryModule?.namingEntry?.('reference')?.graphLabel/summaryLabel`（getter 解决 registry 异步装载时序），`REF_MODULES` 与注释口径一致。协议层 `chapterWrite.mjs` 无这两处字面量，只有 `namingEntryForDir` 转供。
- **既有测试合法更新（逐处说明）**：`test/decoupleStep2.test.mjs` 的 GOLDEN 三处（novel/screenplay 的 skeleton 与 listing）按新骨架表更新；`test/libraryManage.test.mjs` 骨架断言从八个目录改为五个并显式反证四个退场目录；`test/contracts.test.mjs` 与 `test/reference.test.mjs` 把「世界书在 absorb 白名单外」改为合法（新增正文/日志反证）。无删除、无 skip、无放宽。
- **测试/门禁**：新增 `test/newLibrarySkeleton.test.mjs`（5 例）、`test/referenceViews.test.mjs`（8 例）、`test/deduceViews.test.mjs`（9 例）；`test/coreModules.test.mjs` 四枚核心与四证据全面补强。全量 **660 例（658 过 / 2 跳 / 0 挂）**，较 OS-163 的 638 只增不减；门禁 **22 过 / 0 挂 / 0 警**；`npm run arch:stats` 已回写（前端 23 文件 21,220 行、app.js 11,841、测试 83 文件）。夹具全在系统临时目录，未碰作者真库。
