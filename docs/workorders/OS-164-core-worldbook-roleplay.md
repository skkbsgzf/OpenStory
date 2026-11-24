# OS-164 · 段 C 第 4 步：世界书与扮演升格核心模块 ＋ 世界书目录归属（G8b）

| 项 | 值 |
|---|---|
| 批次 | 段 C·工作面插件化收尾 |
| 对应 | 第一批 G5c＋G8b（作者裁定「参考/ 冻结，世界书/ 是 Pinax 载体兼容输入」） |
| 依赖 | OS-163 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中（含新建库骨架变更，属行为变化） |
| 状态 | 待派 |

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
