# OS-167 · 段 D 第 2 步：库清单分家 ＋ 导入 Pinax 清单（G10b）

| 项 | 值 |
|---|---|
| 批次 | 段 D·品牌分家 |
| 对应 | 第二批 G10b |
| 依赖 | OS-166 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | **高**（库清单是 root 授权的来源；弄错会让作者打不开库） |
| 状态 | ✅ 已验收（2026-11-24，提交 `e282e8e`） |

## 目标

OpenStory 的库清单自持（`libraries.json` 在新院里），不再直接读写 Pinax 的 `next-preferences.json`；互认改走**库内 `.pinax/project.json`**。旧清单通过设置页「导入 Pinax 清单」一次性导入。

## 动工前必读

- `src/host/authorize.mjs`：`loadLibraries({ preferencesPath, env })`、`defaultPreferencesPath`、`PINAX_OS_PREFERENCES`／`OPENSTORY_PREFERENCES` 双读（OS-157）。
- daemon 的 root 白名单来源（`allowlist.resolve`）与 `--root=` 授权路径。
- OS-166 的 `src/host/courtyard.mjs`（新院路径唯一来源）。

## 任务

1. **清单自持**：新院 `libraries.json`，形状 `{ schemaVersion, libraries: [{ path, name, addedAt, source }] }`；`source` 取值 `openstory`／`imported-pinax`。
2. **读优先级**：`OPENSTORY_PREFERENCES` 环境变量（测试用）→ 新院 `libraries.json` → 都空则空清单（不静默回落到 Pinax 清单）。
3. **root 白名单**：`allowlist.resolve` 改为读新清单；`--root=` 显式授权照旧可绕过清单（现有行为保留）。
4. **设置页新增「导入 Pinax 清单」**（数据节）：读旧院 `next-preferences.json` 的 `recentProjects`，**逐个体检**（目录存在？有 `.pinax/project.json`？）后列出，作者勾选后写入 `libraries.json`（`source: imported-pinax`）；非法项标灰并给原因；**不写回** Pinax 清单。
5. **互认**：打开库时的元信息只读库内 `.pinax/project.json`（不依赖任何本机清单）；若某库不在清单里，如实报 `NO_LIBRARY` 并提示「用导入或 --root 授权」。
6. **`test/libraryManifest.test.mjs`**（临时目录）：空环境 → 空清单；写读往返；损坏清单 → 如实报错不崩；导入时跳过不存在/无 project.json 的项；`--root` 授权不依赖清单。
7. **文档**：`ARCHITECTURE.md` 数据位置段、`AGENTS.md` 第 10 条、`README.md` 的「库清单在哪」三处同步；写明「互认靠库内 project.json，不靠本机清单」。

## 不做

- 不改库内任何文件格式；不写回 Pinax 的 `next-preferences.json`。
- 不做自动迁移（必须作者在设置页里勾选确认）。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）；`node tools/acceptance/acceptance.mjs` 全绿。
- **演练**：临时 `LOCALAPPDATA` 造旧清单（三项：正常库／目录不存在／无 project.json），贴出导入界面数据与结果清单。
- 收尾跑 `npm run arch:stats` 回写。
- 报告贴：grep `next-preferences` 的剩余命中（应只剩导入逻辑与文档）。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件。
- **绝不碰真实 `%LOCALAPPDATA%\PinaxNext\`、真实 `%LOCALAPPDATA%\OpenStory\` 与作者真库**：全部用临时 `LOCALAPPDATA` 注入。
- 遇到门禁不可能通过或规格矛盾——停下来如实上报。

## 施工回报（编排器自动归档）

- 新解析源：`src/protocol/libraryManifest.mjs`（`libraries.json` 读写、旧清单只读扫描/勾选导入），
  `src/host/authorize.mjs` 退成薄封装：root 白名单读新清单，上屏形状仍经契约层 `normalizeLibraries`
  归一化（`kind/count/at` 保底），`--root=` 显式授权原样保留。
- 读优先级：显式 `preferencesPath` ＞ `OPENSTORY_PREFERENCES` ＞ 新院 `libraries.json` ＞ 空清单＋warning。
  `PINAX_OS_PREFERENCES` 不再参与解析；旧 `{recentProjects}` 形状只在显式路径上兼容读并标 `legacy:true`，
  产品路径永不隐式指向旧清单。
- 写通道：`src/modules/library/libraryManage.mjs` 的 `registerLibrary` 改走 `writeLibraryManifest`，
  只写 `{schemaVersion,libraries:[{path,name,addedAt,source}]}`，`source=openstory`；
  遇旧形状/坏档拒绝且不覆盖。`writeLibraryManifest` 对 `next-preferences.json` 文件名硬拒。
- 新端点（library 域，2 个，契约 105→107）：
  - `GET /api/library/pinax-list` → `pinaxListGet`：只读旧院清单，逐体检（目录存在？有 `.pinax/project.json`？），非法项带 reason。
  - `POST /api/library/pinax-import` → `pinaxListImport`：`{paths}` 勾选后写新清单，`source=imported-pinax`；已登记路径不重复写，旧院零改写。
  - 两端登记在 `src/modules/library/module.manifest.json`（模块独占），契约 errors 含 `MODULE_DISABLED`。
- 设置页：数据节加「导入 Pinax 清单」——路径提示改 `libraries.json`；纯视图 `pinaxImportSectionHtml`
  放 `public/views/settingsAggregation.mjs`（零 import／零 DOM／零存储），app.js 只留取数、勾选与提交。
- 文档：`ARCHITECTURE.md` 数据位置表与协议叶子清单、`AGENTS.md` 第 10 条、`README.md` 三处
  （边界 1／数据位置／仓库地图）、`src/protocol/README.md`、`docs/LEGACY-ITEMS.md` 同步；
  统一写明「互认靠库内 `.pinax/project.json`，不靠本机清单」。
- 测试：`test/libraryManifest.test.mjs` 8 例（空环境/写读往返/坏档不覆盖/三项体检/勾选导入/
  旧环境变量不回落/`--root` 不依赖清单＋拒写旧名/纯视图）；`test/moduleCoverage.test.mjs` 端点数
  105→107 合法更新；建库夹具 `next-preferences.json`→`libraries.json`，原断言强度不变。

## 验收记录（主 agent 填）

- **专项测试**：`node --test test/libraryManifest.test.mjs` → **8/8 通过**。
- **全量测试**：`node --test test/*.test.mjs` → 650 顶层项／**678 tests，676 pass，0 fail，2 skipped**
  （OS-166 基线 670 例，本单净增 8 例）。
- **验收门禁**：`node tools/acceptance/acceptance.mjs` → **23 过／0 挂／0 警**；
  S2.7 自动跟随为 14 模块／core 4／端点 107 ＝ 独占 43＋宿主 64／无归属 0。
- **架构统计**：`npm run arch:stats` 回写——前端 23 文件 21,317 行；宿主 7 文件 1,684 行；
  自持层 74 文件 16,112 行；`app.js` 11,886 行；契约 107 端点；测试 86 文件。
- **导入演练**（临时 `LOCALAPPDATA`，真实院/真库未触碰）：
  - 扫描结果三项：`正常库 → 可导入`；`已搬走的库 → 目录不存在`；`无工程库 → 没有 .pinax/project.json`。
  - 界面数据：合法项 `checked`，两项非法 `disabled`；来源路径如实显示在设置页。
  - 提交 `{paths:[正常库, 已搬走的库, 无工程库]}` → `ok=true, imported=1, rejected=2`，
    拒绝原因 `["目录不存在","没有 .pinax/project.json"]`。
  - 结果清单：`{schemaVersion:1, libraries:[{path:<临时>/正常库, name:"正常库",
    addedAt:"2026-11-20T00:00:00.000Z", source:"imported-pinax"}]}`；
    `old-unchanged=true`，重复导入不新增条目。
- **grep `next-preferences` 剩余命中**：仅 ① 导入逻辑与拒写旧名的常量/提示（`src/protocol/libraryManifest.mjs`、
  `src/api/contracts/library.mjs`、`src/modules/library/libraryManage.mjs`），② 显式兼容读/导入的专项测试
  （`test/contracts.test.mjs`、`test/courtyard.test.mjs`、`test/libraryManifest.test.mjs`），
  ③ 历史 workorder/plan 归档。**产品默认路径与 root 白名单零命中**。
- **纪律核对**：未碰真实 `%LOCALAPPDATA%` 与作者真库；未启动/未杀 daemon 进程；未动 `.zcode/`；
  临时探针执行后删除；既有测试无删除、无 skip、无放宽断言。
