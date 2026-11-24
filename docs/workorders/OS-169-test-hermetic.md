# OS-169 · 收尾：测试环境健壮性（S1，修 5 红）

| 项 | 值 |
|---|---|
| 批次 | 第三批·收尾批（作者验收意见 S1） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §4 收尾批 |
| 依赖 | 无（**必须最先做**：它是前两批关闭与上 CI 的前提） |
| 允许改动 | `test/**`、`tools/acceptance/**`、`docs/**`、`AGENTS.md`、`ARCHITECTURE.md` |
| 风险 | 低 |
| 状态 | 待派 |

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

## 验收记录（主 agent 填）
