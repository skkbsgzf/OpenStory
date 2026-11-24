# OS-150b · OS-150a 复核的 4 条（门禁口径与边界语义）

| 项 | 值 |
|---|---|
| 批次 | 段 A·立规矩（验收与复核修复；编号规则：段内修复用上一张已派工单号＋字母） |
| 对应 | OS-150a 第三轮独立复核的 1 medium ＋ 3 low |
| 依赖 | OS-150a 已提交（`1f4ee2f`） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`AGENTS.md`、`ARCHITECTURE.md`、`docs/**` |
| 风险 | 低（三条是门禁与校验口径，一条是错误码细分） |
| 状态 | 待派 |

## 目标

把复核指出的四处「门禁能放过真问题」或「边界语义混淆」修净。**门禁只许更严，不许放松。**

## 动工前必读

- `tools/acceptance/acceptance.mjs`：S2.1 的扫描器（约 `:205-260`，已覆盖静态 `from`、动态 `import()`、`.js` 说明符）与 S2.2（约 `:275-300`）。
- `public/analysisModules.mjs`（约 `:306` 有一处 `import('./analysis.mjs')`）、`public/scriptFact.mjs`（`import { parseScript } from './script.mjs'`）。
- `src/api/handlers/fact.mjs` 的 `factEntriesGet`（约 `:150-160`）与 `src/services/factBooks.mjs` 的 `listFactBooks`（坏档怎么记 `error`）。
- `src/api/handlers/agent.mjs` 的 `agentRuntimePut`（约 `:123-133`）与 `public/app.js` 的 `updateAgentChip`（约 `:2063`）。
- `public/storySource.mjs` 的错误码常量与 `public/app.js` 故事源空态分流（约 `:8117`）。

## 任务

### 1【medium】S2.2 只扫静态 import，动态 `import()` 漏检

现状：S2.2 用 `/from\s+'\.\/([\w-]+\.mjs)'/g` 匹配，动态 `import('./analysis.mjs')` 不在扫描面。仓里 `public/analysisModules.mjs` 正好有这一条（注释里也提了一次），所以现在门禁是绿的但漏检。

- S2.2 改用与 S2.1 **同一个扫描器**（抽成共用函数，别写两份正则）。覆盖静态 `from`、动态 `import()`、`.js` 与 `.mjs` 说明符。
- 改完后：把 `public/analysisModules.mjs` 的这条真实依赖按规矩处理——它是否合法？分析模块是「按需加载的分析引擎」，与 `md.mjs` 同类的共享协议，还是应当走模块注册？给出判断与证据；若判合法，加进豁免并写明理由；若判违规，修掉依赖。
- 加测试：动态 import 违规能被抓（构造一个 `public/views/*.mjs` 里 `await import('./app.js')` 的反例，在内存或临时文件里验，不许留在仓里）。

### 2【low】`script.mjs` 按目标全局豁免，面大于实际合法边

现状：`PUBLIC_SHARED_PROTOCOL = new Set(['md.mjs','script.mjs'])`，任何文件依赖 `script.mjs` 都放行；真实合法边只有 `scriptFact.mjs → script.mjs` 一条。

- 改成**按边豁免**：只放行已登记的那几条 `(源文件, 目标文件)`，登记表带一行理由。新增边必须登记，否则红。
- 加测试：未登记的 `foo.mjs → ./script.mjs` 会红。

### 3【low】`FACT_EMPTY` 把「没有拆解书」和「有档但全坏」混成一个空态

现状：`拆解/` 下一本书都没有 → `FACT_EMPTY`；只有损坏的 `拆解/*.json`（`listFactBooks` 里那本带 `error`）→ 也回 `FACT_EMPTY`，于是故事源页显示「还没有故事源」的引导空态，掩盖了「档坏了」。

- 细分：`books.length > 0` 但全部带 `error` 时，返回**另一个码**（例如 `FACT_UNREADABLE`，登记进契约 errors），消息人话（「拆解档读不出来」），并带上可诊断的细节（哪一本、什么错）。
- 前端：故事源页对这个码显示**告警**而不是「还没有」的空态；两种码的判定都只认 `error.code`。
- `scripts/verify-newproj.mjs` 的 A5 断言不受影响（那是「真没有」的路径）；若需要，加一条「坏档库」的用例到 `test/fact-entries.test.mjs`。
- 其它消费方（世界书拆解词条组、MCP、剧本互转）在坏档库上的行为逐个确认，写进交付说明。

### 4【low】夹具套件能被手工配置成「当前激活」

现状：`agentRuntimePut` 只校验 id 在 kits 里，不拒 `fixture: true`；直接 PUT 或手改 `agent-config.json` 后，Agent 栏的状态 chip 会显示「回声参考套件」。

- `agentRuntimePut` 拒绝把夹具套件设为激活（返回既有错误形状 + 新码或既有校验码，登记进契约）。
- Agent 栏 chip 在遇到夹具套件时降级显示为「内置默认」之类的正常文案（不许显示夹具名）。
- 加测试：PUT 夹具套件被拒；chip 的取值函数对夹具返回默认文案。

## 不做

- 不改注册表、不改 MCP 工具名、不改端点路径。
- 不动 `core/**`、`vendor/**`、`package.json`；不引任何依赖。
- 第 3 条不许改 fact 文件格式与写协议。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 537 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（当前 18 项；若第 1、2 条拆成两项检查则更多，只增不减）。
- 反证写进交付说明：动态 import 违规会被抓、未登记的 `→script.mjs` 边会红。
- 改完跑 `npm run arch:stats` 回写文档，S0.2 照绿。
- `public/app.js` 行数不增（当前 12,471）。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

> 模型 deepseek-v4.1-flash · 第 1 轮 · 测试 绿（tests 547 · pass 545 · fail 0 · skip 2） · 门禁 绿 · 水浒 绿 · 新建 绿 · vendor 未动 · daemon 已重启（OS-150b 改了后端）

```text
CHANGED:
- 新建 `tools/acceptance/importScan.mjs`（S2.1/S2.2 共用扫描器＋按边豁免表＋审计函数）
- 新建 `test/importScan.test.mjs`、`test/agentFixtureGuard.test.mjs`
- `tools/acceptance/acceptance.mjs`（S2.1 改用共用扫描器；S2.2 改为按边登记；新增 S2.6 豁免表防腐化）
- `src/api/contracts.mjs`、`src/api/contracts/fact.mjs`、`src/api/contracts/agent.mjs`（新码登记）
- `src/host/http.mjs`（状态码映射）、`src/protocol/apiErrors.mjs`（词表说明）
- `src/api/handlers/fact.mjs`（FACT_EMPTY / FACT_UNREADABLE 分流）
- `src/api/handlers/agent.mjs`（拒收夹具套件）
- `public/storySource.mjs`、`public/views/runtimeShelf.mjs`、`public/app.js`（坏档告警 + chip 降级）
- `test/fact-entries.test.mjs`、`test/storySourceStates.test.mjs`、`test/runtimeShelf.test.mjs`、`test/runtimes.test.mjs`
- `docs/ACCEPTANCE.md`、`AGENTS.md`、`ARCHITECTURE.md`（`npm run arch:stats` 回写）

VERIFIED:
- `node .zcode/run-gate.mjs` 与 `node --test test/*.test.mjs` → 547 例，545 过 / 2 skip / 0 挂（原 537，只增）。
- `node tools/acceptance/acceptance.mjs` → **19 过 / 0 挂 / 0 警**（原 18；新增 S2.6）。`node scripts/arch-stats.mjs --check` → 一致。
- 反证（均已跑通）：`test/importScan.test.mjs` 抓到 `public/views/bad.mjs` 里 `await import('./app.js')` 与 `await import('../app.js')`；未登记的 `foo.mjs -> script.mjs` 判红；真实仓面 0 违规、豁免表 0 腐化。
- 判定：`analysisModules.mjs -> analysis.mjs` **合法**（`analysis.mjs` 是零依赖、零 DOM 的纯函数引擎，导出 `analyzeChapter/splitSentences`，后端 `roleplayEngine.mjs` 也引同一份；analysisModules 只在无 `context.analyze` 注入时惰性 import），已按边登记并写明理由；`script.mjs` 只剩 `scriptFact.mjs > script.mjs` 一条合法边。
- 坏档库消费方确认：故事源页走告警（先于「还没有故事源」空态）；世界书拆解词条组 `.catch` → 空组不炸、不告警；MCP 无 fact entries 工具（`fact_curve` 走 curve，坏档仍降级为 chapters=[]）；剧本互转 B 向显示「转失败：拆解档读不出来（…）」、A 向 `resolveLibraryBookId` 回退库名行为不变；`scripts/verify-newproj.mjs` A5（真空库）仍走 FACT_EMPTY。
- `public/app.js` 行数 12,466（原 12,471，未增）。

LIMITATIONS:
- 既有 `test/runtimes.test.mjs` 的端到端原先靠激活内置 `echo-kit` 跑 sidecar；新规则下该激活已非法，故改为同实现的**非夹具克隆**（`echo-live`）驱动。sidecar 拉起/回声/落档/兜底通知断言全部保留、未放宽，但「内置 echo-kit 可被激活」这条隐含覆盖随新规则消失（属预期）。
- 世界书「拆解词条组」在坏档库上仍只是空组（不显示告警）——本次工单只要求故事源页分流，未扩面。
- S2.2 扫描器不剥注释：注释里写一行 `import('./x.mjs')` 也会计入边（宁严不漏），需登记豁免；当前仓内 2 条豁免覆盖。
- 新码取值：`FACT_UNREADABLE` 映射 500（数据面故障）、`AGENT_RUNTIME_FIXTURE` 映射 400；若上游有既定口径需要改，只动 `src/host/http.mjs` 一处。
```

## 验收记录（主 agent 填）
