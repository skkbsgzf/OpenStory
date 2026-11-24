# OS-168 · 段 E：总收口——路线归档、文档同步、总复核、全页验收

| 项 | 值 |
|---|---|
| 批次 | 段 E·总收口 |
| 对应 | 两批路线的收尾 |
| 依赖 | OS-157～167 全部完成 |
| 允许改动 | `docs/**`、`README.md`、`ARCHITECTURE.md`、`AGENTS.md`、`PUBLISHING.md`、`test/**`（只许补测试，不改既有断言） |
| 风险 | 低 |
| 状态 | ✅ 已验收（2026-11-24，提交 `5a43d6c`） |

## 目标

把两批路线收成一本能读的账：做完了什么、还剩什么、哪些是明确不做。不留悬空状态。

## 任务

1. **路线状态归档**：
   - `docs/plan/route-batch2-20261123.md` 顶部加一节「执行结果」：逐条（G8a~e、G9a~f、G10a~c）标 已做/部分/未做，附工单号与提交号；
   - `docs/plan/workorder-system-20261124.md` 的 §0 基线更新为收口时的真实数字（测试数、端点数、模块数、`app.js` 行数、仓根布局）。
2. **文档与事实对齐**：`README.md`、`ARCHITECTURE.md`、`AGENTS.md`、`PUBLISHING.md` 全量过一遍，凡与本仓现状不符的数字/路径/命令一律改（数字取 `npm run arch:stats` 输出，不许手填）。
3. **`docs/LEGACY-ITEMS.md` 定稿**：三档（已裁定／作者动作／后续可选／明确不做）逐条核，做完的删、新发现的补、有依据的写清出处。
4. **测试与门禁自检**：把当前所有门禁项列成一张表（编号／断言／覆盖什么），确认没有「写了但从不运行」的检查。
5. **总复核材料**：`docs/plan/final-audit.md` 列出**主 agent 需要复跑的命令清单**（测试、门禁、两条 e2e、`arch:stats --check`、MCP 冒烟、两端口一致性），供主 agent 逐条执行。

## 不做

- 不改任何业务代码与测试断言（本单只动文档；补测试也只许新增）。
- 不推 git、不打 tag（由作者下令）。

## 验收

- `node --test test/*.test.mjs` 全绿；`node tools/acceptance/acceptance.mjs` 全绿；`npm run arch:stats --check` 通过。
- 文档里每个数字都能被一条命令复现（报告里给出对应命令）。
- 报告贴：门禁项清单表、路线状态表、`LEGACY-ITEMS` 三档条目数。

## 纪律

- 只改文档与新增测试；既有测试与代码一个字节都不改。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`。
- 遇到与本仓现状冲突的文档内容——以代码为准改文档，改不动的如实上报。

## 施工回报（编排器自动归档）

- 路线归档：`docs/plan/route-batch2-20261123.md` 顶部新增「执行结果」——G8a~e／G9a~f／G10a~c
  共 14 条逐条标「已做」并附工单与提交号；原文照录部分未改。
- 基线同步：`docs/plan/workorder-system-20261124.md` §0 改为收口实测（682 例／门禁 23／端点 107／
  14 模块／`app.js` 11,886 行／测试 87 文件／仓根 7 文件＋16 目录白名单、越界 0），开工基线留作历史。
- 文档事实对齐：`README.md`（边界 1／数据位置／仓库地图）、`ARCHITECTURE.md`（数据位置表／
  Host API 叶子件／协议层清单）、`AGENTS.md`（契约八域 107 端点／14 模块 manifest／
  courtyard＋libraryManifest）、`docs/PUBLISHING.md`（数值锚点只从生成段取、当前版本 v0.2.0）
  全部按代码现状改；过期数字（七域/101/660/86 文件等）已清。
- `docs/LEGACY-ITEMS.md` 定稿：四档 —— 已裁定 4／作者动作 2／后续可选 10／明确不做 5；
  删掉已结案的「上游已移位长期处置」行，新增 OS-166 院冻结与 OS-167 清单分家裁定。
- 总复核材料：新增 `docs/plan/final-audit.md`——7 条命令清单（全量测试／门禁／`arch:stats --check`／
  两条 e2e／MCP 冒烟／两端口一致性）＋23 项门禁表（编号／断言摘要／覆盖什么）＋作者待办。
- 新增护栏测试 `test/finalAudit.test.mjs` 4 例：门禁编号全覆盖、路线 14 条全标结果并有提交号、
  文档硬数字与 `ARCHITECTURE.md` 生成段同源、7 条复核命令都在清单里。既有测试与业务代码零改动。

## 验收记录（主 agent 填）

- **全量测试**：`node --test test/*.test.mjs` → 654 顶层项／**682 tests，680 pass，0 fail，2 skipped**
  （OS-167 基线 678 例，本单只新增 4 例护栏测试）。
- **验收门禁**：`node tools/acceptance/acceptance.mjs` → **23 过／0 挂／0 警**。
- **架构统计**：`npm run arch:stats --check` → **通过（14 行生成段逐字相等）**；
  前端 23 文件 21,317 行／宿主 7 文件 1,684 行／自持层 74 文件 16,112 行／内核 11 文件 1,871 行／
  `app.js` 11,886 行／端点 107／测试 87 文件。
- **MCP 冒烟**：`printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' | npm run mcp`
  → stdio 就绪、`tools/list` 返回 24 工具。
- **文档数字可复现对照**：测试/门禁数字由上面两条命令给出；端点与行数由 `npm run arch:stats --check`
  给出；模块 14／core 4／端点归属 107＝43+64 由门禁 S2.7 给出；仓根布局由 S0.1 给出；
  路线条目由 `test/finalAudit.test.mjs` 核对，不留手写孤证。
- **未在本会话执行的两项**：`verify-shuihu`（需作者真库 `D:/Projects/水浒传`＋真 daemon）、
  `verify-newproj`（需真 daemon 且会写本机库清单）、两端口一致性（需起两个 daemon）——
  已如实写入 `docs/plan/final-audit.md` 供作者环境复跑；本单纪律禁止启动/杀 daemon 与触碰真库。
- **纪律核对**：本单只改 `docs/**` 与 `test/finalAudit.test.mjs` 新增文件；未改业务代码、
  未改既有测试断言、未启动/未杀 daemon、未动 `.zcode/`、未 push。
