# OS-165 · 段 C 第 5 步（收口）：模块覆盖面门禁 ＋ 模块闸库路径审计 ＋ 台账同步

| 项 | 值 |
|---|---|
| 批次 | 段 C·工作面插件化收尾 |
| 对应 | 第一批 G5d |
| 依赖 | OS-161～164（八个模块全部落地） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 低 |
| 状态 | 已验收（2026-11-24） |

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

- **覆盖面四条断言**：新增 `test/moduleCoverage.test.mjs`（4/4）——a) `src/modules/` 下 14 个目录全部有合法 manifest，`core:true` 恰好四枚；b) 105 个 handler 键 100% 有归属（`claimed 41` ＋宿主白名单 `64`，无重叠、无遗漏）；c) 11 个未退场页签全部归属模块或在宿主保留白名单；d) 模块页签渲染函数本体不在 app.js（薄壳转交 views 或通过 `HOST_KEPT_RENDERERS` 显式列理由）。
- **门禁收紧**：新增 S2.7「模块覆盖面」，与测试共用 `tools/acceptance/moduleCoverage.mjs` 一份口径（防止门禁与测试分叉）；门禁 **23 过 / 0 挂 / 0 警**（新增一项只增不减）。
- **四个核心模块**：chapters（7 独占端点／write）／worldbook（5／reference）／script（0／script）／roleplay（17／deduce）。**普通模块 10 枚**：7 个工作面插件 analysis（0／analysis-panel）／comfyui（3／image-settings）／kb（4／kb-settings）／habits（2／habits）／storysource（0／storySource）／artifacts（1／artifacts）／exchange（2／exchange-actions），另 3 枚宿主域登记 agentbar／deduce／library（零端点零页签，只为清单透明、无可停用工作面）。工单预估「八个普通」与实际不符，按实测 10 枚如实记录（4＋10＝14）。
- **宿主白名单逐组理由（64 端点）**：库管理与通用文件通道 9（库是数据不是工作面；文件/目录浏览属宿主）／修改痕迹 5（OS-89 跨模块统一 diff＋.history，不归单一模块）／fact 共享读与拆解链 8（多方共用，停任一模块都不该让事实链消失）／本机原生选择器 2（无库上下文）／Agent 栏与会话 17（宿主自带对话面，未插件化）／写作规则资源 4（风格包/技能/体裁是静态资产）／插件系统自身 6（货架与套件不能由插件自己管）／进程配置与后台任务 7（daemon 本机设施）／项目简报与界面状态 6（跨页签库内设置）。宿主页签两条：log（跨模块修改痕迹自检索）、settings（宿主设置本体，不插件化）。全部理由写在 `tools/acceptance/moduleCoverage.mjs`，每组可追溯。
- **模块闸库路径审计（无残留）**：41 个模块独占端点的契约 `request` **全部带 root**（脚本全量扫描，非抽样）；daemon `moduleGateRoot` 优先取已授权请求 root，其「默认库＞清单第一条」兜底对独占端点不可达；MCP 分析工具不显式给 root 就完全不判定、绝不回落清单；`moduleHooks` 的 habitLint/habitsForPrompt 由调用方传 root。`docs/LEGACY-ITEMS.md`【已裁定】新增审结行，`HANDOFF.md` 挂账同步改为「已审结、无残留」。
- **台账同步**：标题改为「截至 OS-165 · 段 C 收口现状」；G7 行标注 OS-162 适配器已落地、唯一开放项＝真实数据复验；【作者动作】新增「NovelPedia 真实数据复验」；【后续可选】新增「RAG 导出端点」（ADR §五仍标规划、消费者与切块契约未定）与「无自动化 UI 测试」（零构建依赖宪法下不引浏览器测试链）；做完的行已删，三档之外无灰区。
- **文档**：`ARCHITECTURE.md` 新增「模块插件清单」节（id／核心与否／独占端点数／页签／settings 项数，14 行表，实测自 manifest）；同步把契约域描述从「七域」纠正为八域（OS-162 加 exchange 后遗留）。`README.md` 目录表同步 14 份 manifest 与四类模块口径。`npm run arch:stats` 已回写生成段（前端 23 文件 21,220 行、app.js 11,841、测试 84 文件）。
- **测试**：全量 **664 例（662 过 / 2 跳 / 0 挂）**，较 OS-164 的 660 只增不减；新增 manifest 三份（agentbar/deduce/library，零端点零页签、settingsHint 写明宿主域，不改变任何模块行为）。既有测试无删除、无 skip、无放宽。
