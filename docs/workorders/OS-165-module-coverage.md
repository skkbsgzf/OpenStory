# OS-165 · 段 C 第 5 步（收口）：模块覆盖面门禁 ＋ 模块闸库路径审计 ＋ 台账同步

| 项 | 值 |
|---|---|
| 批次 | 段 C·工作面插件化收尾 |
| 对应 | 第一批 G5d |
| 依赖 | OS-161～164（八个模块全部落地） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 低 |
| 状态 | 待派 |

## 目标

把「内核收缩到协议＋宿主＋fact 链，其余皆插件」从口号做成**门禁**；把模块闸的库路径问题审干净；台账与架构文档与事实对齐。

## 任务

1. **新增 `test/moduleCoverage.test.mjs`**（四条断言，缺一条都红）：
   a) **模块清单**：`src/modules/*/module.manifest.json` 全部过形状校验；`core:true` 的**恰好四个**（chapters／worldbook／script／roleplay）。
   b) **端点覆盖**：`src/api/registry.mjs` 的 `HANDLERS` 每个键，要么被某模块 manifest 声明为独占端点，要么在测试的**宿主白名单**上——白名单逐条带一行理由（Agent 栏／系统与进程／插件系统自身／修改痕迹／库管理／通用文件通道等）。没归属＝红。
   c) **页签覆盖**：`public/views/registry.mjs` 的 `TAB_REGISTRY` 每个未退场条目，要么归属某模块，要么在宿主白名单上（设置／库管理与流程页／日志）。
   d) **视图归属**：每个模块页签的渲染函数本体不在 `app.js` 里（已迁出到 `public/views/`）；仍在 `app.js` 的必须在测试里显式列为「宿主保留」并写理由。
2. **门禁收紧**（`tools/acceptance/acceptance.mjs`，只增不减）：新增「模块覆盖面」一项，跑上面前两条；`src/modules/` 下每个目录都必须有合法 manifest。
3. **模块闸库路径审计**：全仓找「停用判定时拿不到库路径、退回 daemon 默认库/清单第一条」的端点（OS-144 遗留）。逐个处理：能补 `root` 就补；不能补的在 `docs/LEGACY-ITEMS.md` 写明为什么与影响面。报告里列出清单。
4. **台账同步**（`docs/LEGACY-ITEMS.md` 三档）：
   - 做完的删行；新开放项入档：NovelPedia 真实数据复验、RAG 导出未实现、无自动化 UI 测试、模块闸无 root 的兜底（若第 3 条仍有残留）；
   - 标题里的「OS-133 收官判定」改成现状口径。
5. **文档**：`ARCHITECTURE.md` 加一节「模块插件清单」（id／是否核心／独占端点数／页签／设置项），数字用 `npm run arch:stats` 的实测值；`README.md` 的模块清单同步。

## 不做

- 不改任何模块行为；不动 `src/kernel/**`、Host API、`package.json` 依赖。

## 验收

- `node --test test/*.test.mjs` 全绿（新增覆盖面测试）。
- `node tools/acceptance/acceptance.mjs` 全绿（新增一项）。
- 收尾跑 `npm run arch:stats` 回写。
- 报告贴：四个核心模块与八个普通模块的清单、宿主白名单每条的理由、端点归属覆盖率（100%）。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件；测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过或规格矛盾——停下来如实上报。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
