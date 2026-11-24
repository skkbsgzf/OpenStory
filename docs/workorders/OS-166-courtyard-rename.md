# OS-166 · 段 D 第 1 步：本机院子改名 ＋ 首启迁移 ＋ 运行态归口（G10a＋G10c）

| 项 | 值 |
|---|---|
| 批次 | 段 D·品牌分家 |
| 对应 | 第二批 G10a、G10c |
| 依赖 | 段 C 全部完成（与插件加载器重写同批） |
| 允许改动 | `src/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`PUBLISHING.md` |
| 风险 | **高**（动真实数据目录；主 agent 开工前已备份现场） |
| 状态 | ✅ 已验收（2026-11-24，提交 `cf24bfe`） |

## 目标

本机院子从 `%LOCALAPPDATA%\PinaxNext\` 迁到 `%LOCALAPPDATA%\OpenStory\`：**只拷贝、不删除**；旧院继续留给 Pinax 桌面端。运行态归口：新增一律落 `.openstory/`。

## 动工前必读

- 主 agent 审计：`PinaxNext` 在 `src/` 里有 **9 处**路径拼接（`daemon.mjs` 锁、`authorize.mjs` 偏好、`agentStore`、`kbAdapter`、`genres`、`runtimes`、`nativePicker`、`skills` 等）。
- 本机院子里有一个原子写残留 `agent-config.json.tmp-*`——迁移必须跳过。
- `AGENTS.md` 第 10 条落盘表。

## 任务

1. **一处解析**：新建 `src/host/courtyard.mjs`（名字自定）作为**唯一**院子路径来源：`courtyardRoot(env)`、`courtyardPath(env, ...segments)`；全仓 9 处拼接改为调它。允许的例外：测试夹具注入（走 env）。
2. **迁移**：首启检测 `PinaxNext/` 存在而 `OpenStory/` 不存在 → **一次性递归拷贝**（跳过 `*.tmp-*`、`daemon.lock`）→ 在 `OpenStory/.migrated-from-pinaxnext.json` 写标记（含时间、来源、条目数）。已存在标记或目标目录已存在 → 不重复迁移。
3. **不删除旧院**；日志里明确写「旧院保留给 Pinax 桌面端」。
4. **运行态归口**：新增文件一律进 `.openstory/`（库内）；本机侧新文件一律进新院。`AGENTS.md` 第 10 条补一行；`docs/` 里写明旧路径冻结、不迁移。
5. **`test/courtyard.test.mjs`**（临时目录，绝不碰真实院子）：空环境首次调用 → 建新院；旧院有数据 → 迁移并留标记、旧院仍在；残留 `*.tmp-*` 不被拷贝；重复调用幂等；`LOCALAPPDATA` 缺失时如实报错不静默。
6. **文档**：`ARCHITECTURE.md` 的「本机院子」一节改双院现状（新院＝OpenStory、旧院＝Pinax 桌面端保留）；`README.md` 数据位置段同步。

## 不做

- **不删旧院**、不改 Pinax 桌面端的任何文件。
- 不迁移库（库永远在作者自己的目录里，与本机院子无关）。
- 不改 `suite-state.json` 的键形状（库级化在 OS-160 已做）。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）；`node tools/acceptance/acceptance.mjs` 全绿。
- **迁移演练**：在临时 `LOCALAPPDATA` 里造一个假旧院（含 `agent-config.json`、`kb-config.json`、`suite-state.json`、一个 `*.tmp-*`），跑一次首启，贴出：新院文件清单、标记文件内容、旧院仍在、tmp 未拷贝。
- 收尾跑 `npm run arch:stats` 回写。
- 报告贴：9 处拼接改前/改后对照、grep `PinaxNext` 的剩余命中（应只剩文档与迁移代码里的旧路径常量）。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件。
- **绝不碰真实 `%LOCALAPPDATA%\PinaxNext\` 与 `%LOCALAPPDATA%\OpenStory\`**：所有验证在临时目录里做（用 `LOCALAPPDATA` 注入）。
- 遇到门禁不可能通过或规格矛盾——停下来如实上报。

## 施工回报（编排器自动归档）

- 唯一解析源：`src/protocol/courtyard.mjs`（实现）＋ `src/host/courtyard.mjs`（宿主唯一门面，
  `export * from '../protocol/courtyard.mjs'`）。实现下沉协议层是为了过门禁 S2.1：模块层只准引
  `node:` 内置／`src/protocol/**`／模块目录内文件，不为此开豁免。
- 路径改线：工单预警 9 处，实测 **12 文件／13 调用点**（`suites.mjs` 两处）：
  1. `src/host/authorize.mjs`：`join(base,'PinaxNext','next-preferences.json')` → `courtyardPath(env,'next-preferences.json')`
  2. `src/host/daemon.mjs`：`join(base,'PinaxNext','openstory','daemon.lock')` → `courtyardPath(env,'openstory','daemon.lock')`
  3. `src/modules/agentbar/agentStore.mjs`：`base ? join(base,'PinaxNext','openstory') : ''` → `courtyardPath(env,'openstory')`
  4. `src/modules/kb/kbAdapter.mjs`：`join(base,'PinaxNext','openstory','kb-config.json')` → `courtyardPath(env,'openstory','kb-config.json')`
  5. `src/services/genres.mjs`：`…/genres` → `courtyardPath(env,'openstory','genres')`
  6. `src/services/nativePicker.mjs`：`…/fs-browse.json` → `courtyardPath(env,'openstory','fs-browse.json')`
  7. `src/services/runtimes.mjs`：`…/runtimes` → `courtyardPath(env,'openstory','runtimes')`
  8. `src/services/skills.mjs`：`…/skills` → `courtyardPath(env,'openstory','skills')`
  9. `src/services/stylePacks.mjs`：`…/styles` → `courtyardPath(env,'openstory','styles')`
  10. `src/services/suites.mjs`：`…/suites` → `courtyardPath(env,'openstory','suites')`
  11. `src/services/suites.mjs`：`…/suite-state.json` → `courtyardPath(env,'openstory','suite-state.json')`
  12. `src/services/systemPrompt.mjs`：`…/kb-config.json` → `courtyardPath(process.env,'openstory','kb-config.json')`
  13. `src/services/uiPreferences.mjs`：`…/ui-preferences.json` → `courtyardPath(env,'openstory','ui-preferences.json')`
- 迁移语义：空环境首启建新院（`reason=created`）；旧院在且新院不在 → 递归只拷贝（跳 `*.tmp-*` 与
  `daemon.lock`）＋写 `.migrated-from-pinaxnext.json`；标记或目标院已存在 → 不重拷；`LOCALAPPDATA`
  与 `APPDATA` 都没有 → `ensureCourtyard('')` 回 `no-base`，`courtyardRoot/courtyardPath` 回空串，
  不静默猜路径。旧院只读、不删、不改写，日志与标记均写明「旧院保留给 Pinax 桌面端」。
- UI/文档：`public/app.js`、`public/index.html`、`public/views/settingsAggregation.mjs` 的路径提示改新院；
  `AGENTS.md` 第 10 条加旧院冻结行；`ARCHITECTURE.md` 加双院现状与冻结行；`README.md` 加数据位置段；
  `docs/LEGACY-ITEMS.md` 记裁定；`genres/`、`runtimes/`、`skills/`、`suites/` 的协议 README 同步。
- 既有测试只改路径期望（等价加强，无删除、无 skip、无放宽）：agent / browseRoot / contracts /
  daemonSingleInstance / kbAdapter / runtimes / styles / suites / uiPreferences 等；新增
  `test/courtyard.test.mjs` 6 例（空院、迁移、tmp 跳过、幂等、目标已存在、缺 env 与 APPDATA 兜底）。

## 验收记录（主 agent 填）

- **专项测试**：`node --test test/courtyard.test.mjs` 6/6 通过；
  `node --test test/courtyard.test.mjs test/moduleCoverage.test.mjs` 10/10 通过。
- **全量测试**：`node --test test/*.test.mjs` → 642 顶层项／**670 tests，668 pass，0 fail，2 skipped**
  （OS-165 基线 664 例，本单净增 6 例）。
- **验收门禁**：`node tools/acceptance/acceptance.mjs` → **23 过／0 挂／0 警**；
  S2.1 通过（实现下沉 `src/protocol/`，未新增模块耦合豁免），S2.7 维持 14 模块／端点 105/105。
- **架构统计**：`npm run arch:stats` 回写——前端 23 文件 21,219 行；宿主 7 文件 1,724 行；
  自持层 73 文件 15,849 行；`app.js` 11,840 行（顺手修掉 HEAD 里「Agent 运行时」提示的
  `openstory`／`untimes` 断行，净降 1 行）；契约 105 端点；测试 85 文件。
- **迁移演练**（临时 `LOCALAPPDATA`，真实院子未被触碰）：
  - 新院文件清单：`.migrated-from-pinaxnext.json`、`agent-config.json`、`kb-config.json`、
    `openstory/nested/note.md`、`openstory/suite-state.json`（拷贝 4 个文件）。
  - 标记内容：`schema=openstory.courtyard-migration/v1`、`from=<临时>/PinaxNext`、
    `to=<临时>/OpenStory`、`at=2026-11-24T08:55:52.606Z`、`entries=4`、
    `note=旧院保留给 Pinax 桌面端（未删除、未改写）`。
  - 旧院仍在：`true`，且 `agent-config.json.tmp-98765`、`openstory/daemon.lock` 仍在旧院。
  - 残留未拷贝：`tmp-copied=false`、`lock-copied=false`。
- **grep `PinaxNext` 剩余命中**：仅三类——① `src/protocol/courtyard.mjs` 的迁移常量与注释、
  ② `src/host/courtyard.mjs` 门面注释、③ 文档（新冻结说明＋历史 plan/workorder 归档）。
  **产品代码零直拼**，模块层与 services 层全部经 `courtyardPath`。
- **纪律核对**：未启动/未杀 daemon；未动 `.zcode/`；未碰真实 `%LOCALAPPDATA%`；
  所有验证在 `mkdtemp` 临时目录内完成，探针脚本执行后删除。
