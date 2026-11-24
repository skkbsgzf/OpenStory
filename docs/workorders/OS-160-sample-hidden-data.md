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
