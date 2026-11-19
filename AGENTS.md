# AGENTS.md — OpenStory

> 给所有在本仓干活的 agent（Zcode / Qoder / Codex / Claude / CodeBuddy…）的入仓须知。
> 人在环：作者本人裁定一切；拿不准就问，别自作主张动稿。

## 这里是什么

零 npm 构建依赖的中文小说工作台：`daemon.mjs`（Express 手写 HTTP，127.0.0.1:8807）
+ `public/` 原生 JS 前端。模块：**小说**（纯净写作面）/ **世界书+参考**（条目 KB）/
**习惯**（写作规矩表）/ **拆解**（fact 链）/ **推演**（种子化文游）/ **分析**（本地引擎）。
全部经 `contracts.mjs`（62 端点）契约分派；MCP 对外 20 工具（`mcp.mjs`）。

## 硬规则（违反＝白干）

1. **`core/pinax/**` 逐字 vendor 禁改**（见 `core/VENDORED.md`）。fact 引擎是 Pinax 内核，
   OpenStory 层只调用不修改。
2. **daemon 只监听 127.0.0.1**；凭据只存本机（agent-config.json），响应只回掩码。
3. **参考单向性**：正文不反向进参考上下文；参考不能全量丢进 Agent 上下文。
4. **absorb 不开 MCP**：旧目录迁入参考是显式动稿操作，只走界面按钮。
5. **MCP 不开 agent 对话**（不套娃）；写操作一律有 .history 备份。
6. **模块不耦合**：功能模块间禁止直接 import——只经 `contracts.mjs`/`chapters.mjs`
   协议层与 vendor 内核；依赖注入解（范例见 `kbHealth.mjs` 的 resolveCollections 注入）。
7. **前端令牌单一真源**：颜色进 `public/index.html` 的 `:root`（同步 `design-system/tokens.css`）；
   样式令牌区外禁止裸色值。侧栏=绝对定位浮层，正文恒居中（OS-48 宪法）。
   组件约定见 `docs/UX-STRUCTURE.md`。

## 本地化与可追溯（OS-89 作者立宪，不可协商）

作者口径原文：「所有的内容必须放在本地。对于已经落盘的内容，应该放在固定的落盘位置。
对那些还没有落盘的数据，比如用户还没有保存，或者像推演这种——处于推演阶段有一个文档，
但没有被用户真实认可并保存到正文里——这些都是要落到本地的，绝对不能放在任何浏览器缓存里。
所有的保存行为和储存行为都是基于本地的本地文件。所有的修改都要有 diff，都要有 log。
每一个模块在每次加载的时候，都要自己检索一遍跟自己相关的一些 log。」

8. **一切状态落本地文件，浏览器只做内存视图。**
   - 禁止用 `localStorage` / `sessionStorage` / IndexedDB 保存任何**内容性或状态性**数据
     （草稿、偏好、选中项、会话指针、模块开关…）。
   - 允许的唯一例外：皮肤/字号这类**纯渲染偏好**也只在无库可写时兜底；有库时必须落库。
   - 判据：**关掉浏览器、换一台机器、清缓存后，重新打开库必须完全复原。** 不能复原＝违规。

9. **落盘位置固定，不得散落。** 全部在库根内的固定位置：
   | 数据 | 位置 |
   |---|---|
   | 正文/剧本/参考/世界书等稿件 | `<库>/<业务目录>/*.md` |
   | 未保存的编辑草稿（作者正在写、还没提交） | `<库>/.pinax/drafts/<模块>/<id>.json` |
   | 推演中未被采纳的拍/会话 | `<库>/.openstory/deduce/<bookId>.json` |
   | 界面状态（页签、模块开关、选中项） | `<库>/.pinax/ui-state.json` |
   | 每一版修改的 diff 与日志 | `<库>/.pinax/log/<模块>/<yyyy-mm>.jsonl` |
   | 旧版原文备份（二进制快照） | 同目录 `.history/<file>.bak-<stamp>`（现有机制，保留） |
   | 本机凭据/模型端点 | `%LOCALAPPDATA%/PinaxNext/openstory/agent-config.json`（含密钥，不入库） |

10. **每一次修改都必须有 diff + log，且可被模块自检索。**
    - 写操作一律经 `changelog.mjs` 的 `recordChange()`：自动算 unified diff、
      写 `<库>/.pinax/log/<模块>/<yyyy-mm>.jsonl`（append-only，一行一记录）。
    - 每个模块**加载时**必须调 `GET /api/log?root=&module=` 取自己的近期日志，
      在界面上如实呈现（作者要能看见「这个模块最近改了什么」）。
    - 记录必须含：`at / module / file / op / actor / beforeHash / afterHash / diff / bytes`。
      绝不记录密钥、正文全文以外的隐私内容。

11. **推演/草稿等「未确认」内容同样必须落本地。**
    推演拍、Agent 待确认卡、未保存草稿都属于「已产生但未采纳」的数据，
    必须落在上表位置，禁止只活在浏览器内存或缓存里。采纳后才写进正文，但**产生时就要落盘**。

## 发布规范（推送前必读）

推 GitHub 前必过 [PUBLISHING.md](./PUBLISHING.md) 的检查单（协议干净/demo 干净/人机双读）；
自动检查器：`node ~/.zcode/skills/repo-publish/scripts/publish-scan.mjs .`，全绿才推。

## 改完必跑（验收线，详见 `docs/ACCEPTANCE.md`）

```bash
node .zcode/run-gate.mjs                    # ① 全量单测（217 例）
node tools/acceptance/acceptance.mjs        # ② 交付标准 S1–S4 门禁（14 检查，Rea 式证据）
# ③ .ua/ 知识图谱增量（/understand，skill 在 ~/.zcode/skills/understand*）
# ④ 前端批次给作者截图讲场景（对照 design-system/DESIGN.md + docs/UX-STRUCTURE.md）
```

①② 全绿才合入。MCP 工具增删必须同步：`mcp/skills/*.md`、`test/mcp.test.mjs` 的工具数、
`DEMO.md`、`tools/acceptance/acceptance.mjs` 的 S1.1 覆盖面。

## 仓内地图

- `contracts.mjs` 端点契约 → `daemon.mjs` 路由实现（endpointFor 分派 + validateResponse 校验）
- `deduceEngine.mjs`（vendor 推演核）/ `deduceSession.mjs`（会话容器，推演/<bookId>/session.json）
- `referenceStore.mjs`（参考索引/图谱）· `enrichEngine.mjs`（语义富化 6 窗）· `factGuard.mjs`
- `skills/` 创作知识库 30 包（SKILL.md 制）· `mcp/skills/` 对外分发材料 · `design-system/` 设计令牌包
- `tools/acceptance/` 验收门禁 · `.ua/` UA 知识图谱（intermediate/ 与 tmp/ 是运行产物不入库）
- `test/` node --test 全覆盖；跑法统一走 `.zcode/run-gate.mjs`（它会 chdir 到仓根）
