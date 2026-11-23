# OpenStory

**跑在浏览器 / DSH 里的小说工作台**——OpenDesign 形态的小说版。零 npm 构建依赖，daemon 只监听本机，库就是磁盘上的文件夹。

![版本](https://img.shields.io/badge/version-v0.2.0-blue) ![node](https://img.shields.io/badge/node-%3E%3D18-green) ![tests](https://img.shields.io/badge/tests-417%20cases-brightgreen) ![endpoints](https://img.shields.io/badge/endpoints-101-blueviolet)

## 这是什么

一个「文件即真相」的中文小说创作工作台：

- **写作**：纯净写作面——实时渲染逐块编辑（失焦自动保存）、章节自动编号、版本历史（.history）、右键段浮窗（润笔/讨论/分析）、间距令牌化＋组件统一规范、分析面板模块化插拔（人话结论层：文风/AI 味/剧情曲线/伏笔回收/剧情密度）
- **世界书（参考）**：Obsidian 式笔记系统——frontmatter 嵌套标签、`[[双链]]`、标签笔记带描述、关系图谱（笔记＋拆解词条同图，词条只读第二来源）、「看到第 N 章为止」防剧透过滤、`迁入旧目录` 一键并入旧目录
- **扮演**（默认）与**确定性推演**（可选）：「扮演」页签＝主持人＋N 角色多子 agent 同幕——酒馆式舞台（场景立绘背景/气泡流/情境分支选项/角色署名气泡/长期记忆/AI 味过检），局面自动续上、多局并存、拍可「转正」写正文、会话导出 md；确定性引擎模式保留（同种子同事实包＝同一拍、2d6 骰点 trace）
- **故事源**（拆解）：fact 链的可视化盘点——结构化知识视图＋事件面积图＋**角色时间线泳道图**（fact events 可视化）；数据被推演/剧情曲线/世界书词条/参考图谱四方消费
- **剧本**：原生剧本工作面＋外部剧本→拆解条目导入（fact 写通道首次开放）
- **Agent**：左列一等公民——会话连续（DSH resume）、思维链渐进、工具调用行、待确认卡（采纳走快照闸）、灯泡选择链（题材/风格词条单选＋方法论多选＋知识库标注卡）、套件捆绑技能
- **生图与识图**：ComfyUI 双后端生图（世界书条目配图）＋vision 文学化白描（读库内图片）
- **全局设施**：任务中心（悬浮球轮询）、修改日志（模块自检索 diff＋单条恢复）、界面状态/草稿落 `.pinax/`、设置页本体/插件中心两组、MCP server（24 工具，零依赖 stdio）、Windows 原生文件夹选择器/资源管理器唤起（新建库与本地路径位）

## 三条边界

1. **数据真源在磁盘**：库＝文件夹（`.pinax` 兼容形态）；OpenStory 不自建数据库，与 Pinax（Electron 壳）共用同一份文件资产——两个壳，一份稿子。
2. **daemon 只监听 127.0.0.1**：不做 HTTPS/隧道/多用户；凭据只存本机（配置读写走掩码＋`__KEEP__`），响应只回掩码。
3. **插件不常驻**：套件/运行时按声明加载，停用＝规则退回内置默认（值保留）。

## 快速开始

```bash
npm install        # 装依赖（sharp/transformers；内核 vendor 自持，无 tgz 依赖）
npm start          # node daemon.mjs → http://127.0.0.1:8807（单实例锁＋/api/health）
npm run mcp        # 全模块 MCP server（24 工具，stdio）
npm test           # node --test（417 例，零外部依赖）
```

**作为 DSH 插件运行**（左栏底部 OpenStory → 右侧栏打开工作台，DSH 会话留在左边）：
`tools/dsh-openstory-studio/` 是一个 DSH bundle（宿主侧看护 daemon＋客户端右侧栏标签页）。
在 DSH 的 Plugins → Add plugin 里选该目录安装即可，细节见其
[README](./tools/dsh-openstory-studio/README.md)。

浏览器打开 `http://127.0.0.1:8807`，右上角库切换器新建/导入库（建库骨架自动补齐）。模型对话在左列 Pi-Agent 设置里配端点（OpenAI 兼容 / DSH 原生 / CLI kit），生图在设置里配 ComfyUI。

> **演示库**：[`samples/水浒传/`](./samples/水浒传/)——公版示例（参考图谱/双链/事实包/扮演会话/素材），导入即可体验全部功能。

## 架构一图

七层实测分层（数字实测于 2026-11-23，逐层职责与边界见 [ARCHITECTURE.md](./ARCHITECTURE.md)）：

```
L7  前端 public/            15 文件  19,917 行   无构建单页（ui-kit 统一规范）
L6  契约层 contracts/        8 文件   1,369 行   七域聚合，101 端点，双端校验
L5  daemon.mjs               1 文件   5,204 行   node:http 手写路由＋进程治理（单实例锁/stamp/generation/health）
    └ mcp.mjs                1 文件     715 行   stdio 24 工具，daemon HTTP 薄适配（独立进程）
L4  本仓自持层              37 模块  10,733 行   建库/导入自持（OS-123/124）＋fact 消费＋参考＋Agent＋货架＋协议层
L3  pinaxAdapter.mjs         1 文件      60 行   内核唯一进口（五能力组，门禁 S2.4）
L2  core/pinax              24 文件   4,332 行   fact 链底座（逐字 vendor，禁改；npm run vendor:check 盯漂移）
L1  磁盘库                  ——        ——       文件即真相（.pinax 兼容，与 Pinax 桌面端双向兼容）
```

数据优先级（fact-first）：**事实链 ① ＞ 正文 ② ＞ 派生物 ③**——读数据先问事实链，喂模型先问能不能只喂事实链。详见 [FACT-FIRST.md](./FACT-FIRST.md)。

## 仓库地图

| 路径 | 内容 |
|---|---|
| `daemon.mjs` / `contracts.mjs` ＋ `contracts/` | daemon＋101 端点契约（OS-130 起按七域分片，纯数据，两端共享） |
| `pinaxAdapter.mjs` / `core/` / `vendor/contracts/` | 内核唯一进口（五能力组）→ 24 文件 fact 链（逐字 vendor，[VENDORED.md](./core/VENDORED.md) 记出处边界，禁改；`npm run vendor:check` 盯漂移） |
| `projectDoc.mjs` / `importAdapter.mjs` / `textUtil.mjs` | 建库/导入自持（OS-123/124 fork 点；`.pinax/project.json` 格式与 Pinax 桌面端双向兼容） |
| `mcp.mjs` | 全模块 MCP server（24 工具，零依赖 stdio；`npm run mcp`） |
| `referenceStore.mjs` / `deduceEngine.mjs` / `deduceSession.mjs` / `deduceNarrative.mjs` | 参考索引（标签/双链/图谱）/ 推演封装 / 多局会话容器 / 叙事上下文 |
| `roleplayEngine.mjs` / `roleplayPrompts.mjs` | 扮演调度（主持人＋N 角色子 agent）＋四层提示词 |
| `factGuard.mjs` / `enrichEngine.mjs` / `comfyEngine.mjs` | 事实守护 / 富集引擎 / ComfyUI 生图适配 |
| `changelog.mjs` / `jobCenter.mjs` / `libState.mjs` / `nativePicker.mjs` | 修改日志 / 后台任务中心 / 库内状态与草稿 / Windows 原生选择器 |
| `chapters.mjs` / `libraryManage.mjs` / `agentStore.mjs` / `suites.mjs` / `stylePacks.mjs` / `runtimes.mjs` | 章节协议 / 建库导入 / Agent 存储 / 三类货架装载 |
| `public/` | 工作台单页（app.js＋reference/graph/md/analysis/charts/ui-kit/storySource 等零依赖模块；echarts 本地 vendor） |
| `suites/` `styles/` `runtimes/` `genres/` `skills/`（31＋套件捆绑 2） | 插件货架（内置样例）＋ [PROTOCOL.md](./PROTOCOL.md)（套件注册协议） |
| `workflows/` | ComfyUI 文生图工作流 |
| `tools/dsh-openstory-studio/` | DSH 插件 bundle：宿主侧 daemon 生命周期＋客户端右侧栏工作台（`sidebar.footer.action`／`sidebarRightTabs`） |
| `samples/水浒传/` | 公版演示库（导入即体验） |
| `test/` | 417 例（node --test，含 daemon 端到端与解耦金样护栏） |
| `docs/` | 架构与规划（[ARCHITECTURE.md](./ARCHITECTURE.md) 七层分层、[遗留台账](./docs/LEGACY-ITEMS.md)、[推演×数据路线](./docs/plan/deduce-data-roadmap-20261118.md) 等） |

## 出处与致谢

OpenStory 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness) 的 openstory/ 线独立而来（2026-11-14 起，OS-1→OS-133 批次逐批交付）；内核（`core/pinax` 24 文件＋`vendor/contracts` 1 文件）逐字 vendor 自同仓与 pinax-core 仓（见 [core/VENDORED.md](./core/VENDORED.md)），建库/导入/章节号已自持，上游漂移由 `npm run vendor:check` 盯防。设计对标 OpenDesign（dsHarness 生态）的插件接入与用户体验口径。

## 发布规范

推送前必过「协议干净 / demo 干净 / 人机双读」检查单——见 [PUBLISHING.md](./PUBLISHING.md)（高优先级规范，优先级仅次于 AGENTS.md 硬规则）。

## 版本

- **解耦收官**（2026-11-23，OS-120→133）：插件治理三件套＋能力白名单；内核解耦四步（server 层/载体注册体系移除→建库导入自持→pinaxAdapter 唯一进口→vendor 漂移检测）；进程治理（单实例锁/stamp/generation/health）；AG-UI 协议出口；契约分域（contracts/ 七域）；@pinax/core tgz 依赖收编移除。架构归档为[七层实测分层](./ARCHITECTURE.md)，遗留与「明确不做」见[遗留台账](./docs/LEGACY-ITEMS.md)。
- **v0.2.x**（2026-11-21）：角色时间线泳道图、Windows 原生文件夹选择器/资源管理器唤起、Agent 栏可折叠、剧情密度热力图修复；DSH 插件内嵌模式（OS-113：右侧栏打开工作台，内嵌时收起自带的 Pi-Agent 左列，左侧交给 DSH 会话）＋窄面板适配约束（OS-114：纸面可读下限 320px、≤1000px 浮层不再让位、内边距/页签按断点降档）＋内嵌 Agent 桥（OS-115：「添加到 Agent / 润笔 / 发给 Agent」以引用块写进 DSH 当前会话输入框）＋MCP 工具面（OS-116：OpenStory 24 个 MCP 工具挂进 DSH，引用附库/章/段/root 来源，DSH Agent 可读章节、按备份语义写回）。
- **v0.2.0**（2026-11-21）：扮演与文游舞台全面成型（多子 agent 同幕/长期记忆/拍转正/多局管理）、世界书纳入拆解词条（词条图谱槽）、剧本线（原生工作面＋外部导入）、生图识图、任务中心/修改日志/ui-state、设置重构（本体＋插件中心）、MCP 24 工具、95→99 端点契约、299 例测试。
- **v0.1.0**（2026-11-19）：首个对外版本。路线图见 [docs/plan/](./docs/plan/)。
