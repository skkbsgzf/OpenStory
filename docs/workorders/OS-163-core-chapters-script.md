# OS-163 · 段 C 第 3 步：正文与剧本升格核心模块（core:true，不可停用）

| 项 | 值 |
|---|---|
| 批次 | 段 C·工作面插件化收尾 |
| 对应 | 第一批 G5c |
| 依赖 | OS-161、OS-162 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中（核心写面；`app.js` 要净下降） |
| 状态 | 已验收（2026-11-24） |

## 目标

正文（chapters）与剧本（script）升格为**核心模块插件**：`core: true`，永远启用、不可停用。红线「核心插件保底」在这两件上落地。

## 动工前必读

- OS-161 落地的三个模块（manifest／启停／端点归属）与 `src/protocol/modules.mjs` 的 `isModuleEnabled`。
- `public/views/registry.mjs`：条目上的 `core` 标记是**页签可达面**（OS-143 定的六条），与模块级 `core:true` 是两件事——不要互相改写。
- `AGENTS.md` 第 20 条：`app.js` 增量冻结（只减不增）。
- 现有正文／剧本的注入点：`src/modules/library`（章节）、`src/protocol/chapters.mjs`、`src/modules/deduce`（剧本互转在此读写 fact）。

## 任务（两个子件，各自独立提交）

### 一、正文 chapters
1. `src/modules/chapters/module.manifest.json`（`core: true`）：独占端点 `chapterGet`／`chapterPut`／`chaptersGet`／`chaptersCreate`／`chaptersRename`／`chapterDelete`／`draftGet`；`changeLog*` 属宿主（OS-89 立宪的跨模块修改痕迹），不归本模块。
2. **不可停用两层**：a) 启停判定对 `core:true` 恒返回启用（ui-state 里即便被写成 false 也不生效）；b) 写「停用」的请求返回 `MODULE_CORE`（登记进契约 errors）。
   若现有实现没有独立启停端点、只有 ui-state 写入路径，就只在那条路径拒绝「核心模块＝停用」这一个键，其余键照旧。
3. 前端：核心模块的启停开关渲染成**锁定态＋「核心模块」徽标**（设置·模块组）。
4. 权限（这是本单的真正风险点）：
   - **编辑/研究可改**，不制造无需有的屏障；真正不可协商的是**单一写通道**——正文写入必须仍走 `writeChapterWithBackup`（原子写＋`.history`＋修改痕迹），谁调都一样；
   - 已存在的外部读写（`src/protocol/chapters.mjs`、`tests` 里的直调、`public/scriptFact.mjs` 的导入导出）只做**路由统一**，不加第二道批准动作；
   - 报告里列出「现在有几条写入路径、统一后剩几条」。

### 二、剧本 script
5. `src/modules/script/module.manifest.json`（`core: true`）：剧本没有独占端点（文件走 chapter 通道）——独占端点留空，如实登记它借用的共享通道。
6. 视图迁出：`scriptViewHtml`／`scriptCastHtml`／`scriptBlockToRaw`／`scriptPrefs`／`scriptToFactFlow` 等**纯 HTML 构造函数**搬进 `public/views/`（注意已存在 `public/script.mjs`、`scriptFormat.mjs`、`scriptFact.mjs`，别重名——能并入既有叶子模块就并入）；
   读写模块状态、起定时器、操作 DOM 的留在 `app.js`。搬完在 `VIEW_RENDERERS` 改注册名，配金样测试＋纯度测试。
7. `test/coreModules.test.mjs`：两个模块恒启用；写停用被拒 `MODULE_CORE`；页签恒在；端点恒通。

## 不做

- 不改正文/剧本的落盘格式；不动 `src/kernel/**`；不改 Host API。
- 不把别的模块加进 `core:true`（核心只有四个：chapters／worldbook／script／roleplay，后两个在 OS-164）。
- 不动 `package.json` 依赖。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）；`node tools/acceptance/acceptance.mjs` 全绿。
- **缺省页签快照一个字不改**（`test/tabRegistry.test.mjs` 的 diff 为空）。
- `public/app.js` 行数净下降（写进报告）。
- 收尾跑 `npm run arch:stats` 回写。
- 报告贴：四条「不可停用」证据（恒启用、拒写、页签在、端点通）＋写入路径收敛前后对照。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件；测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过或规格矛盾——停下来如实上报。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）

- **两个 manifest 落地**：`src/modules/chapters/module.manifest.json`（`core:true`，独占 `chapterGet` / `chapterPut` / `chaptersGet` / `chaptersCreate` / `chaptersRename` / `chapterDelete` / `draftGet`；`changeLog*` 明确不归它）与 `src/modules/script/module.manifest.json`（`core:true`，零独占端点，如实登记借用 chapters 通道）。`src/protocol/modules.mjs` 新增 `CORE_MODULE_IDS` / `isCoreModule`，`isModuleEnabled` 对核心模块短路返回 true（ui-state 写 false 不生效）。
- **证据① 恒启用**：`test/coreModules.test.mjs` 把扁平键＋嵌套键同时写成 false，`isModuleEnabled(root, 'chapters'/'script')` 仍 true，七个独占端点的 `isModuleDisabledFor` 全为 null；同一份 state 下普通模块 habits 仍按 false 停用（对照）。
- **证据② 拒写**：`uiStatePut` 只拒绝「核心模块＝false」这一种键（扁平与嵌套都拦），返回 409 `MODULE_CORE`；契约 `uiStatePut.errors` 登记该码，`src/host/http.mjs` 的 `STATUS_BY_CODE` 补 `MODULE_CORE: 409`；普通模块停用键与其它 ui-state 键照旧写入并落盘。设置页 `renderSettingsModules` 把核心开关渲染成 `checked disabled` 并挂「核心模块」徽标，`aggregateSettings` 对 core 恒 `enabled:true`。
- **证据③ 页签恒在**：`TAB_REGISTRY` 的 write/script 显式声明 `module: chapters/script` 与 `moduleCore:true`（新字段，不改页签级 `core`；registry 仍零 import）；`moduleVisible` 对 `moduleCore` 短路放行。显式启用集合传空集时正文与剧本页签仍在， habits 照常消失；dirScan 分支同样恒在。`test/tabRegistry.test.mjs` 快照与对拍 34/34 全绿，缺省页签 diff 为空。
- **证据④ 端点恒通**：ui-state 写 false 后起真实 daemon，`GET /api/chapters?dir=正文` 与 `GET /api/chapter?file=正文/001-风雪山神庙.md` 均 200 且正文可读。
- **写入路径收敛前后对照**：正文**内容**写入通道——开工前 1 条（`writeChapterWithBackup`：原子写＋`.history`＋修改痕迹），6 个调用点（`handlers/chapters.mjs` 2、`handlers/agent.mjs` 1、`handlers/fact.mjs` 1、`handlers/reference.mjs` 2）；统一后仍是这 1 条 / 6 处，**没有新增第二套写逻辑、没有加第二道批准动作**。元数据通道 `createChapter`（建空文件）／`renameChapter`（保号改名）／`deleteChapter`（挪 `.history`）沿用既有，不算内容写入；剧本无独立写通道，与正文共用 `/api/chapter`。
- **视图迁出（app.js 净下降）**：新增 `public/views/scriptViews.mjs`（零 import / 零 DOM / 零存储），迁出 `scriptPrefsFrom` / `scriptBlockToRaw` / `scriptCastHtml` / `scriptViewHtml` 四个纯函数，app.js 留薄壳注入 `text/esc/state/refModulesHtml` 等；`scriptToFactFlow` 因读 state、调 api、操作 DOM 留在 app.js（工单「起定时器/操作 DOM 的留宿主」）。app.js **12,310 → 12,242，净降 68 行**。`VIEW_RENDERERS` 注册名未变（剧本仍走 `dirViewHtml` → `scriptViewHtml` 分支）。
- **测试**：新增 `test/scriptViews.test.mjs`（7 例：设置项/三类剧本块金样/人物卡/页面金样/分支/纯度/薄壳）与 `test/coreModules.test.mjs`（6 例：manifest/四证据/设置页）；`test/modulePlugins.test.mjs` 的「全模块非核心」按批次等价加强为「core 标记与核心清单严格一致」，核心端点不得登记不可达的 `MODULE_DISABLED`，`chapterGet` 归属从 null 改为核心模块 chapters；强度不减。全量 **638 例（636 过 / 2 跳 / 0 挂）**，较 OS-162 的 625 例只增不减。
- **门禁与统计**：`node tools/acceptance/acceptance.mjs` **22 过 / 0 挂 / 0 警**；`npm run arch:stats` 已回写 `ARCHITECTURE.md`（`public/` 21 文件 21,098 行，`app.js` 12,242，端点 105，测试 80 文件）。新增/修改的每个文件均过 `node --check`；夹具全在系统临时目录，未碰作者真库。
