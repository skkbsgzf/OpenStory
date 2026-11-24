# OS-166 · 段 D 第 1 步：本机院子改名 ＋ 首启迁移 ＋ 运行态归口（G10a＋G10c）

| 项 | 值 |
|---|---|
| 批次 | 段 D·品牌分家 |
| 对应 | 第二批 G10a、G10c |
| 依赖 | 段 C 全部完成（与插件加载器重写同批） |
| 允许改动 | `src/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`PUBLISHING.md` |
| 风险 | **高**（动真实数据目录；主 agent 开工前已备份现场） |
| 状态 | 待派 |

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

## 验收记录（主 agent 填）
