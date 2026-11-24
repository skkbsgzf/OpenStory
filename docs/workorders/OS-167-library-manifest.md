# OS-167 · 段 D 第 2 步：库清单分家 ＋ 导入 Pinax 清单（G10b）

| 项 | 值 |
|---|---|
| 批次 | 段 D·品牌分家 |
| 对应 | 第二批 G10b |
| 依赖 | OS-166 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | **高**（库清单是 root 授权的来源；弄错会让作者打不开库） |
| 状态 | 待派 |

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

## 验收记录（主 agent 填）
