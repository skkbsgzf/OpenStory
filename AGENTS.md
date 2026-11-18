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
