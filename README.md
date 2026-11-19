# OpenStory

**跑在浏览器 / DSH 里的小说工作台**——OpenDesign 形态的小说版。零 npm 构建依赖，daemon 只监听本机，库就是磁盘上的文件夹。

![版本](https://img.shields.io/badge/version-v0.1.0-blue) ![node](https://img.shields.io/badge/node-%3E%3D18-green) ![tests](https://img.shields.io/badge/tests-221%20cases-brightgreen)

## 这是什么

一个「文件即真相」的中文小说创作工作台：

- **参考（reference）**：Obsidian 式笔记系统——frontmatter 标签（嵌套 `/` 层级）、`[[双链]]`、标签笔记带描述、参考页内嵌关系图谱（点节点→信息卡→跳详情）、`迁入旧目录` 把大纲/构思/资料/约束一键并入
- **小说**：纯净写作面——实时渲染逐块编辑（失焦自动保存）、章节自动编号、版本历史（.history）、右键段浮窗（润笔/讨论/分析）、分析面板（文风/AI 味/剧情曲线/本段批注吸顶对齐）
- **推演**：确定性推演引擎（同种子同事实包＝同一拍）——文游舞台（回合成文/剧情树/归档素材）、POV 智能缺省、三层候选（必然/命运/戏剧）、2d6 骰点 trace、前线张力
- **题材风格货架**：灯泡位选体裁写 brief.json 全局生效（策略注入＋技法过滤＋页签裁剪）；知识库标注卡＋风格词条（单选）＋方法论（多选）选择链
- **MCP server**：全模块零依赖 stdio server＋模块级 skill 分发
- **Agent**：左列一等公民——会话连续（DSH resume）、思维链折叠、工具调用行、待确认卡（采纳走快照闸）、ephemeral 润笔不污染会话列表
- **插件货架**：业务套件（openstory-suite@2）/ Agent 运行时 kit（openstory-runtime-kit@1）/ 风格包 tokens JSON——全部目录制，丢文件即上新，本机覆盖内置

## 三条边界

1. **数据真源在磁盘**：库＝文件夹（`.pinax` 兼容形态）；OpenStory 不自建数据库，与 Pinax（Electron 壳）共用同一份文件资产——两个壳，一份稿子。
2. **daemon 只监听 127.0.0.1**：不做 HTTPS/隧道/多用户；凭据只存本机（`agent-config.json`，响应只回掩码）。
3. **插件不常驻**：套件/运行时按声明加载，停用＝规则退回内置默认（值保留）。

## 快速开始

```bash
npm install        # 装依赖（@pinax/core 走 file:vendor tgz）
npm start          # node daemon.mjs → http://127.0.0.1:8807
npm test           # node --test（221 例，零外部依赖）
```

浏览器打开 `http://127.0.0.1:8807`，右上角库切换器新建/导入库（建库骨架自动补齐）。模型对话在左列 Pi-Agent 的设置里配端点（OpenAI 兼容 / DSH 原生 / CLI kit）。

> **演示库**：[`samples/水浒传/`](./samples/水浒传/)——公版示例（参考图谱/双链/事实包/文游会话），导入即可体验全部功能。

## 架构一图

```
┌─ 浏览器 / DSH webview ──────────────────────────────┐
│  工作台（public/ 单页，无构建依赖）                     │
│  页签：产物｜正文｜日志(只读)｜参考｜拆解｜推演           │
│  左列：Pi-Agent（会话/待确认卡/思维链）                 │
└──────────────┬──────────────────────────────────┘
               │ HTTP（127.0.0.1，JSON＋SSE）
┌──────────────▼──────────────────────────────────┐
│  daemon（daemon.mjs，唯一磁盘层）                   │
│  · 64 端点契约（contracts.mjs，请求/响应双端校验）    │
│  · 文件绑定：库/章节/参考/产物/套件资产              │
│  · Agent 通道：会话 JSONL＋运行时 kit 转发           │
│  · fact 链：拆解 store/富集/曲线/守护               │
│  · MCP server（全模块 stdio）＋技能分发             │
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
| `daemon.mjs` / `contracts.mjs` | daemon＋64 端点契约（纯数据，两端共享） |
| `referenceStore.mjs` / `deduceEngine.mjs` / `factGuard.mjs` / `enrichEngine.mjs` | 参考索引（标签/双链/图谱）/ 推演封装 / 事实守护 / 富集引擎 |
| `chapters.mjs` / `libraryManage.mjs` / `agentStore.mjs` / `suites.mjs` / `stylePacks.mjs` / `runtimes.mjs` | 章节协议 / 建库导入 / Agent 存储 / 三类货架装载 |
| `public/` | 工作台单页（app.js＋reference/graph/md/analysis/charts 零依赖模块） |
| `suites/` `styles/` `runtimes/` `genres/` `skills/` | 插件货架（内置样例）＋ [PROTOCOL.md](./PROTOCOL.md)（套件注册协议） |
| `core/` | 底座抽取层（[VENDORED.md](./core/VENDORED.md) 记出处边界，本仓禁改） |
| `test/` | 221 例（node --test，含 daemon 端到端） |
| `samples/水浒传/` | 公版演示库（导入即体验） |
| `docs/` | 架构蓝图与规划（[推演×数据路线](./docs/plan/deduce-data-roadmap-20261118.md) 等） |

## 出处与致谢

OpenStory 自 [Pinax-next](https://github.com/skkbsgzf/Pinax-StoryHarness) 的 openstory/ 线独立而来（2026-11-14 起，OS-1→OS-70 批次逐批交付）；底座模块逐字 vendor 自同仓（见 [core/VENDORED.md](./core/VENDORED.md)），后续按底座抽取路线升格为独立包。设计对标 OpenDesign（dsHarness 生态）的插件接入与用户体验口径。

## 版本

- **v0.1.0**（2026-11-19）：首个对外版本。工作台全量（参考图谱/实时编辑/推演文游舞台/Agent 选择链/题材风格货架/习惯闭环/MCP server），64 端点契约，221 例测试。路线图见 [docs/plan/](./docs/plan/)。
