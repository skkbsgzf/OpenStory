# OS-160 · 样例库自带隐藏数据与插件配置

| 项 | 值 |
|---|---|
| 批次 | 段 B⁺·推送前整备（作者 2026-11-24 裁定：git push 之前做完） |
| 对应 | 作者原话：「sample 里除了放文档也要放隐藏数据，sample 里每个插件注册后的一些配置文件，也理应在本地有留存」 |
| 依赖 | OS-157 已提交 |
| 允许改动 | `src/**`、`test/**`、`tools/**`、`docs/**`、`samples/**`、`.gitignore`、`AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`package.json`（**只许改 `scripts` 条目**） |
| 风险 | 中（套件状态的归属从机器级改为库级，属行为变化） |
| 状态 | 待派 |

## 目标

**打开样例库＝复现一份配置好的工作台**：页签、模块启停、套件启停与设置值都随库走，不需要在本机重新点一遍。

## 主 agent 审计到的现状

- 样例库 `samples/水浒传`：进仓 30 个文件；隐藏数据只有 `.pinax/project.json`；`.gitignore` 第 14–16 行把 `.openstory/`、`.history/`、`.pinax/` 全挡了。
- **套件（业务插件）的启停与设置值存在机器级单文件**：院子的 `suite-state.json`，形状 `{ suites: { <id>: { enabled, values, updatedAt } } }`，不按库分（`src/services/suites.mjs`）。所以样例库没法自带插件配置。
- 已经是库级的：模块启停与界面状态（`.pinax/ui-state.json`）、题材灯泡的选择（`.openstory/agent-picks.json`）。

## 任务

1. **套件状态随库走**：
   - 库内文件：`<库>/.openstory/plugins/suite-state.json`（运行态一律进 `.openstory/`，与作者路线 G10c 的归口一致）；
   - 读：库内有就用库内的，没有回落机器级文件（机器级从「唯一真源」降为「缺省值」）；
   - 写：开着库时写库内文件；没开库（设置页的全局入口）时写机器级缺省；
   - 路径解析只许一处（单一入口函数），测试钉住；
   - 测试：两个库可以有不同的套件启停；没开库时读写机器级且不污染任何库；库内文件坏档时如实报错并回落，不静默。
2. **样例库充实**（确定性、无噪声）：
   - 提交 `samples/水浒传/.pinax/ui-state.json`（一份合理的缺省界面状态：页签可见性、模块全启用等）；
   - 提交 `samples/水浒传/.openstory/plugins/suite-state.json`（与演示一致的配置，例如写作套件启用）；
   - 若样例的推演素材还缺 `.openstory/deduce/…` 配置文件，补齐；
   - **生成方式**：用脚本在「临时登记的样例库拷贝」上跑一遍真实路径产出，**不许手写 JSON 冒充运行态**；脚本留在 `tools/` 下可重跑；
   - **不提交**：`.pinax/log/`、`.history/`、`*.tmp-*`，以及任何含凭据、本机绝对路径（`C:\Users\…`、`D:\Projects\…`）、随机时间戳的文件。
3. **`.gitignore`**：给 `samples/` 加反向规则，只放行上面点名的文件；噪声目录继续挡。
4. **样例库洁净门禁**：验收新增一项——扫 `git ls-files samples/` 下所有文件，不许出现日志、历史、临时文件、凭据样式（`sk-`、`Bearer`、`token=`）、本机绝对路径；违例即红。只增不减。
5. **「打开即复现」测试**：把 `samples/水浒传` 拷到临时目录并登记，经 API 读到的套件状态、模块启停、界面状态与样例文件里写的逐项相等；测试结束摘除登记。
6. **文档**：README／DEMO 写明样例库自带配置；`AGENTS.md` 第 10 条落盘表补 `.openstory/plugins/` 一行。

## 不做

- **不迁移任何既有库或机器级状态**（旧库不迁移红线）：机器级 `suite-state.json` 原样保留当缺省。
- 不动作者真库（`D:/Projects/**`）一个字节。
- 不改套件 manifest 的形状与 Host API。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（新增「样例库洁净」一项）。
- 报告贴出：`git ls-files samples` 的新清单、洁净门禁输出、复现测试输出、生成脚本用法。
- 收尾跑 `npm run arch:stats` 回写。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）

**结论：通过。2026-11-24 由接手 agent 施工＋验收。提交号见看板。**

- 测试 597 例（595 过 / 0 挂 / 2 跳，较基线 586 增 11）；门禁 22 过 / 0 挂 / 0 警（新增 S3.6 样例库洁净）；架构统计已回写；app.js 仍 12,466 行。

**套件状态库级化**（行为变化，按工单）：
- `src/services/suites.mjs` 新增**唯一路径入口** `resolveSuiteStatePath({ root, machinePath, mode })`：读时库内有 `<库>/.openstory/plugins/suite-state.json` 才用，否则回落机器级（机器级从「唯一真源」降为「没开库时的缺省」）；写时开着库就写库内（没有也建）。`loadSuiteState`/`saveSuiteState` 是唯二读写点，全部经它解析；上层 `listSuitesPublic`/`saveSuiteSettings`/`setSuiteEnabled`/`suiteValue`/`getSuiteStateData`/`saveSuiteStateData` 与 protocol 层 `listAllPlugins` 新增可选 root 一路透传。
- 契约给 5 个套件端点加可选 `root`（query/body），`plugins.mjs` handler 对非空 root 做 `authorizeRoot`（防路径逃逸），空 root（设置页全局入口）回落机器级；前端 3 处调用带 `state.current?.path`；`chapters.mjs` 的 `suiteValue` 透传授权后的 root。
- **顺带修一处隐患**：`src/host/daemon.mjs` 的 `ENDPOINT_HAS_QUERY` 原来是手抄集合，给 `suitesGet` 加 root query 时漏登记→读不到库级状态（实测踩到）。改为从契约 `ENDPOINTS` 自动推导（声明了 `request.query` 就走 URL query），与 `validateRequest` 口径一致，杜绝此类漏改。

**样例库充实**（真实路径产出，非手写）：
- 新增 `tools/samples/generate-sample-config.mjs`（可重跑）：空临时库根上调真实 `writeUiState` / `saveSuiteSettings` / `setSuiteEnabled`（原子写＋schema 校验＋changelog 全走产品代码），把产出的两个文件复制回样例库并回读自检。不在样例库留下日志/历史/临时文件。
- `samples/水浒传/.pinax/ui-state.json`（页签/模块/折叠缺省）与 `.openstory/plugins/suite-state.json`（writing 启用，`newChapterTitle=第{N}章`、`deduceBranches=2`）已入库；`.gitignore` 加反向规则只放行点名文件，`.pinax/log/`、`.history/`、临时文件继续挡。
- 门禁 S3.6 样例洁净：扫 `git ls-files samples/`（用 `core.quotepath=false` 拿中文路径原文——默认转义会让尾部匹配失效，反证实测踩过），日志/历史/临时/凭据/本机绝对路径 0 容忍。

**测试**（`test/sampleConfig.test.mjs`，5 例）：样例配置在库且形状对；路径单一入口读写分流；两库套件启停互不影响＋没开库写机器级不污染库；库内坏档如实报 warning 回落；**打开即复现**——临时 daemon 带 `--root` 起样例副本，API 读到的套件状态/界面状态与样例文件逐项相等。

**反证**：临时把 `debug.log` 加进样例库跟踪，S3.6 命中并挂（21/1/0）；删掉后 22/0/0。已贴输出并还原。

**文档**：AGENTS.md 落盘表补 `.openstory/plugins/` 一行；README/DEMO 写明样例库自带配置与生成脚本；DEMO 的 MCP 启动路径顺手改成 `src/host/mcp.mjs`（OS-159 遗留的绝对路径旧写法）。

**LIMITATIONS**：`updatedAt` 是生成时的真实运行时间戳（产品代码写入），重跑会更新——这是「真跑过」的证据，不是伪造的固定值；不含凭据/本机绝对路径，已过洁净门禁。未迁移任何既有库或机器级状态（工单红线，机器级文件原样当缺省）。
