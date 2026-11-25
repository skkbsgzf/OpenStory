# OS-169 · 收尾：测试环境健壮性（S1，修 5 红）

| 项 | 值 |
|---|---|
| 批次 | 第三批·收尾批（作者验收意见 S1） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §4 收尾批 |
| 依赖 | 无（**必须最先做**：它是前两批关闭与上 CI 的前提） |
| 允许改动 | `test/**`、`tools/acceptance/**`、`docs/**`、`AGENTS.md`、`ARCHITECTURE.md` |
| 风险 | 低 |
| 状态 | 已验收（2026-11-25 主 agent 独立复跑通过，待提交后回填提交号） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

`npm test` 在**任何机器**上都是 682 例 / 0 挂；环境不齐的测试显式 skip 并注明守卫理由，不许靠本机恰好有某个文件或某个软件才绿。

## 主 agent 核对到的事实

作者验收环境里全量 `npm test` 稳定 5 挂；**在作者本机实测是 682 例 0 挂**——说明这 5 条依赖本机环境，换到干净环境才红。所以修法必须「先在干净环境复现，再修」。

| 测试 | 根因 | 修法 |
|---|---|---|
| `test/kb-router.test.mjs:25` | 硬编码 `C:/Users/Administrator/…/kb-config.json`，违反自家夹具纪律 | 改 `fixture()` 注入临时 `%LOCALAPPDATA%`；环境不存在→条件 skip |
| `test/dshBridge.test.mjs:130` | `resolveDshRun` CLI 优先，本机装了 dsh 即改变行为 | 测试内显式把 env 指向夹具 runtime；无夹具→skip |
| dshBridge 端到端 | 本机无 OpenStory runtime 插件 | no-runtime 守卫：探测 kit 缺失→skip |
| embeddingPaths | 断言 `.cache/models` 真实存在 | 改为断言路径推导结果，不依赖真实下载 |
| sampleConfig「打开即复现」 | 并发下 12.9s 的 health 轮询超预算（60×200ms），单跑绿 | 轮询预算提到 90×200ms，或该文件隔离串行跑 |

## 任务

1. **先复现**：在干净环境下跑一遍全量（临时 `LOCALAPPDATA` 与 `USERPROFILE`、子进程 `PATH` 里去掉 dsh），把红的用例与报错贴进报告。复现不了的那几条（如并发超时），说明你怎么构造出同等条件的。
2. **逐条修**（按上表）。每一处「红转 skip」在测试文件里注明守卫理由：探测什么、缺了为什么只能 skip。
3. **防回潮**：验收门禁新增一项「测试不依赖本机环境」——扫 `test/**`，出现本机绝对路径（`C:/Users/`、`C:\Users\`、`/Users/`、`/home/`）即红，允许清单为空。只增不减。
4. `docs/ACCEPTANCE.md` 与 `AGENTS.md` 里关于测试纪律的一句同步（「测试不许依赖本机环境」）。

## 不做

- 不改产品代码。若某条红的根因其实在产品代码（例如某个探测函数的行为本身不稳定），**停下来上报**，不要顺手改产品代码。
- 不为了绿而放宽断言或整文件 skip。

## 验收

- `npm test` **连跑两轮**：682 例 / 0 挂；skip 只许是环境类，逐条列进报告（名称＋守卫理由）。
- 验收门禁全绿（新增一项）。
- 反证：在某个测试里临时写一个 `C:/Users/x` 字面量，新门禁必须红；贴输出后删掉。

## 施工回报（编排器自动归档）

CHANGED:
- `test/kb-router.test.mjs`：改用临时 `LOCALAPPDATA` 夹具，不再读真实 kb-config。
- `test/dshBridge.test.mjs`：显式构造临时 DSH_HOME/profile/runtime；缺夹具时带守卫原因 skip。
- `test/embeddingPaths.test.mjs`：只断言路径推导，不依赖真实模型下载物。
- `test/sampleConfig.test.mjs`：daemon 健康轮询预算 60×200ms → 90×200ms，业务断言不变。
- `test/{agent,browseRoot,contracts,styles,suites}.test.mjs`：本机路径样例改为中性夹具路径。
- `tools/acceptance/acceptance.mjs`：新增 S1.6，扫描 `test/**` 本机绝对路径，允许清单为空。
- `AGENTS.md`、`docs/ACCEPTANCE.md`、`docs/PUBLISHING.md`、`docs/plan/final-audit.md`、`docs/plan/workorder-system-20261124.md`：同步测试纪律与 24 项门禁口径。

VERIFIED:
- 主 agent 用 Node 直接构造临时 `LOCALAPPDATA/APPDATA/USERPROFILE/HOME/DSH_HOME`，并从 PATH 移除 npm 全局目录里的 dsh/codebuddy，保留 Windows 系统命令。
- 干净环境 `node --test "test/*.test.mjs"` 连跑两轮：均 682 tests / 680 pass / 0 fail / 2 skip。
- 正式 `node tools/acceptance/acceptance.mjs`：24 过 / 0 挂 / 0 警。
- S1.6 反证：临时写入 `C:/Users/x` 后门禁为 23 过 / 1 挂，删除后恢复 24/24。
- `node tools/arch-stats.mjs --check`：通过；全部改动 `.mjs` 通过 `node --check`。

LIMITATIONS:
- 未改产品代码；两条 skip 分别为作者真夹具库缺失与 Windows 平台不适用 posix 权限现场。
- 尚未创建 git 提交，提交号待回填。

## 验收记录（主 agent 填）

- 2026-11-25：主 agent 独立审查 diff，确认无产品代码改动、无业务断言放宽；干净环境两轮、正式门禁、反证与架构统计均通过。
- 结论：实现与验证通过，待提交后转为「已验收」并回填提交号。
