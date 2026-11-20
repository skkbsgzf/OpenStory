# OpenStory

**跑在浏览器 / DSH 里的小说工作台**——OpenDesign 形态的小说版。零 npm 构建依赖，daemon 只监听本机，库就是磁盘上的文件夹。

![版本](https://img.shields.io/badge/version-v0.2.0-blue) ![node](https://img.shields.io/badge/node-%3E%3D18-green) ![tests](https://img.shields.io/badge/tests-299%20cases-brightgreen) ![endpoints](https://img.shields.io/badge/endpoints-98-blueviolet)

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
npm install        # 装依赖（@pinax/core 走 file:vendor tgz）
npm start          # node daemon.mjs → http://127.0.0.1:8807
npm run mcp        # 全模块 MCP server（24 工具，stdio）
npm test           # node --test（299 例，零外部依赖）
```

浏览器打开 `http://127.0.0.1:8807`，右上角库切换器新建/导入库（建库骨架自动补齐）。模型对话在左列 Pi-Agent 设置里配端点（OpenAI 兼容 / DSH 原生 / CLI kit），生图在设置里配 ComfyUI。

> **演示库**：[`samples/水浒传/`](./samples/水浒传/)——公版示例（参考图谱/双链/事实包/扮演会话/素材），导入即可体验全部功能。

## 架构一图

```
┌─ 浏览器 / DSH webview ──────────────────────────────┐
│  工作台（public/ 单页，无构建依赖，ui-kit 统一规范）    │
│  页签：产物｜正文｜剧本｜日志｜世界书｜习惯｜故事源      │
│        ｜扮演｜设置（本体＋插件中心）                   │
│  左列：Pi-Agent（会话/待确认卡/思维链/选择链）          │
└──────────────┬──────────────────────────────────┘
               │ HTTP（127.0.0.1，JSON＋SSE）
┌──────────────▼──────────────────────────────────┐
│  daemon（daemon.mjs，唯一磁盘层）                   │
│  · 98 端点契约（contracts.mjs，请求/响应双端校验）   │
│  · fact 链：拆解 store/富集/曲线/守护/写通道        │
│  · 推演/扮演引擎＋会话容器；生图/识图适配器          │
│  · 全局任务中心/修改日志/ui-state/草稿              │
│  · MCP server（24 工具，stdio，独立进程）           │
└──────────────┬──────────────────────────────────┘
┌──────────────▼──────────────────────────────────┐
│  core/（底座抽取层——以 pinax-core 为原型）            │
│  载体清单注册表 / 建库内核 / 依赖闭包 / 推演链 vendor  │
└─────────────────────────────────────────────────┘
```

数据优先级（fact-first）：**事实链 ① ＞ 正文 ② ＞ 派生物 ③**——读数据先问事实链，喂模型先问能不能只喂事实链。详见 [FACT-FIRST.md](./FACT-FIRST.md)。

## 仓库地图

| 路径 | 内容 |
|---|---|
| `daemon.mjs` / `contracts.mjs` | daemon＋98 端点契约（纯数据，两端共享） |
| `mcp.mjs` | 全模块 MCP server（24 工具，零依赖 stdio；`npm run mcp`） |
| `referenceStore.mjs` / `deduceEngine.mjs` / `deduceSession.mjs` / `deduceNarrative.mjs` | 参考索引（标签/双链/图谱）/ 推演封装 / 多局会话容器 / 叙事上下文 |
| `roleplayEngine.mjs` / `roleplayPrompts.mjs` | 扮演调度（主持人＋N 角色子 agent）＋四层提示词 |
| `factGuard.mjs` / `enrichEngine.mjs` / `comfyEngine.mjs` | 事实守护 / 富集引擎 / ComfyUI 生图适配 |
| `changelog.mjs` / `jobCenter.mjs` / `libState.mjs` / `nativePicker.mjs` | 修改日志 / 后台任务中心 / 库内状态与草稿 / Windows 原生选择器 |
| `chapters.mjs` / `libraryManage.mjs` / `agentStore.mjs` / `suites.mjs` / `stylePacks.mjs` / `runtimes.mjs` | 章节协议 / 建库导入 / Agent 存储 / 三类货架装载 |
| `public/` | 工作台单页（app.js＋reference/graph/md/analysis/charts/ui-kit/storySource 等零依赖模块；echarts 本地 vendor） |
| `suites/` `styles/` `runtimes/` `genres/` `skills/`（31＋套件捆绑 2） | 插件货架（内置样例）＋ [PROTOCOL.md](./PROTOCOL.md)（套件注册协议） |
| `workflows/` | ComfyUI 文生图工作流 |
| `core/` | 底座抽取层（[VENDORED.md](./core/VENDORED.md) 记出处边界，本仓禁改） |
| `samples/水浒传/` | 公版演示库（导入即体验） |
| `test/` | 299 例（node --test，含 daemon 端到端） |
| `docs/` | 架构蓝图与规划（[推演×数据路线](./docs/plan/deduce-data-roadmap-20261118.md) 等） |

## 出处与致谢

OpenStory 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness) 的 openstory/ 线独立而来（2026-11-14 起，OS-1→OS-107 批次逐批交付）；底座模块逐字 vendor 自同仓（见 [core/VENDORED.md](./core/VENDORED.md)），后续按底座抽取路线升格为独立包。设计对标 OpenDesign（dsHarness 生态）的插件接入与用户体验口径。

## 发布规范

推送前必过「协议干净 / demo 干净 / 人机双读」检查单——见 [PUBLISHING.md](./PUBLISHING.md)（高优先级规范，优先级仅次于 AGENTS.md 硬规则）。

## 版本

- **v0.2.x**（2026-11-21）：角色时间线泳道图、Windows 原生文件夹选择器/资源管理器唤起、Agent 栏可折叠、剧情密度热力图修复。
- **v0.2.0**（2026-11-21）：扮演与文游舞台全面成型（多子 agent 同幕/长期记忆/拍转正/多局管理）、世界书纳入拆解词条（词条图谱槽）、剧本线（原生工作面＋外部导入）、生图识图、任务中心/修改日志/ui-state、设置重构（本体＋插件中心）、MCP 24 工具、95→98 端点契约、299 例测试。
- **v0.1.0**（2026-11-19）：首个对外版本。路线图见 [docs/plan/](./docs/plan/)。
