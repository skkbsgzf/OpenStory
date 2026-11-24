# OS-159 · 仓根结构精简——根目录不散落 .mjs

| 项 | 值 |
|---|---|
| 批次 | 段 B⁺·推送前整备（作者 2026-11-24 裁定：git push 之前做完） |
| 对应 | 作者原话：「git push 之前，把文件夹结构再精简优化，大仓下不散落 mjs」 |
| 依赖 | OS-157 已提交（`core/`、`vendor/`、`scripts/vendor-*` 已退役） |
| 允许改动 | 仓根全部（**除 `.zcode/`、`.git/`、`node_modules/`**）：`src/**`、`test/**`、`tools/**`、`scripts/**`、`docs/**`、`public/**`（仅当引用路径要改）、`package.json`（**只许改 `scripts` 条目**）、`AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`.gitignore`、根级文件与目录的移动 |
| 风险 | 中（路径面广：入口、门禁、测试、文档、npm scripts） |
| 状态 | 待派 |

## 目标

根目录干净到一眼能看懂：没有散落的 `.mjs`，没有零散小目录，文档都在 `docs/`。

## 主 agent 审计到的现状

- 根目录 2 个 `.mjs`：`daemon.mjs`、`mcp.mjs`（OS-140 留的入口垫片）；`package.json` 的 `start`、`mcp` 指向它们；1 个测试文件按 `../daemon.mjs` 或 `../mcp.mjs` 引用。
- 根级三份文档：`DEMO.md`（5 处引用）、`FACT-FIRST.md`（7 处）、`PUBLISHING.md`（8 处）。
- 根级零散小目录：`mcp/`（只有 `mcp/skills/` 五份 MCP 工具说明）、`workflows/`（只有一份 ComfyUI 工作流样例）、`stylekits/`（只有 `PROTOCOL.md`）。
- `scripts/` 有 8 个脚本（OS-157 之后剩 5 个）；`tools/` 已有 `acceptance/`、`distill/`、`eval/`、`dsh-openstory-studio/`。
- 门禁 S0.1 现在的口径是「仓根只留两个入口垫片」。

## 目标布局（可以偏离，但每一处偏离都要在报告里写理由）

根目录只留这些**文件**：`README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`LICENSE`、`package.json`、`package-lock.json`、`.gitignore`；
以及这些**目录**：

- `src/`（代码＋启动入口）、`public/`、`test/`、`tools/`、`docs/`、`samples/`
- 五个货架：`suites/`、`runtimes/`、`styles/`、`genres/`、`skills/`
- `design-system/`（令牌包）
- `.zcode/`（管线工具，本单不动）

## 任务

1. **入口归位**：`daemon.mjs`、`mcp.mjs` 从根目录拿掉，启动入口放进 `src/host/`（命名自定）；`package.json` 的 `start`、`mcp` 改指新位置；测试里的 `../daemon.mjs`、`../mcp.mjs` 同步；README、DEMO、AGENTS、ARCHITECTURE 里的启动命令同步。
2. **根级文档并入 `docs/`**：`DEMO.md`、`FACT-FIRST.md`、`PUBLISHING.md` 移进 `docs/`，全部引用处同步（文档、代码注释、门禁、发布检查清单）。
3. **零散小目录归位**：
   - `mcp/skills/` → `docs/mcp/`（它们是 MCP 工具的使用说明，不是代码）；
   - `workflows/qwen-image-2.1-t2i.json` → 跟生图模块走还是进 `samples/`，你定并写理由；代码里若有默认指向 `workflows/` 的路径要同步；
   - `stylekits/PROTOCOL.md` → 与 `docs/STYLEKIT-PROTOCOL-20261116.md` 核对：是同一协议的新旧两份就合并成一份留在 `docs/`；不是就移进 `docs/` 并说明区别。
4. **`scripts/` 并入 `tools/`**：剩余 5 个脚本移到 `tools/` 下的合理位置；`package.json` scripts、门禁 `acceptance.mjs` 里对 `arch-stats` 的调用、测试与文档里的路径全部同步。**移动后仓里不许再有 `scripts/` 目录。**
5. **门禁 S0.1 收紧**：从「仓根只留两个入口垫片」改成「**根目录白名单**」——根目录下的文件与目录必须落在上面那份清单里，多一个都红（要建新目录，先登记进门禁）。
6. **文档**：`npm run arch:stats` 回写（脚本换了位置，`arch:stats` 命令同步）；`ARCHITECTURE.md` 的目录树改成新布局；`AGENTS.md` 的仓内地图同步。

## 不做

- 不动 `.zcode/`（管线工具）与 `node_modules/`。
- 不改任何业务逻辑、不改 Host API、不改端点。
- `package.json` 只许改 `scripts` 条目；`package-lock.json` 不动。
- **主 agent 的编排器按旧路径调门禁脚本——主 agent 已把它改成新旧路径都能找到；你按目标布局移动即可。**

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（S0.1 已是白名单口径）。
- **用新命令各起一次 daemon 与 MCP 冒烟**，证明能起（把命令与输出贴进报告）。
- 报告贴出：新根目录的 `ls`、移动前后对照表（旧路径 → 新路径）、全仓 grep 旧路径为空的证据（`daemon.mjs`、`mcp.mjs`、`scripts/`、`workflows/`、`stylekits/`、`mcp/skills` 的残留引用）。
- 水浒 10/10、新建 13/13（主 agent 复跑）。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）

**结论：通过。2026-11-24 由接手 agent 施工＋验收。提交号见看板。**

- 测试 592 例（590 过 / 0 挂 / 2 跳）；门禁 21 过 / 0 挂 / 0 警；架构统计已回写（端点 103、测试 71 文件、`src/host/` 1,681 行）。

**移动前后对照表**（全部 git mv，历史保留）

| 旧路径 | 新路径 | 理由 |
|---|---|---|
| `daemon.mjs`（仓根垫片） | 删除；入口直跑 `src/host/daemon.mjs` | 实现文件自带 isMain 判定，中转垫片多余 |
| `mcp.mjs`（仓根垫片） | 删除；入口直跑 `src/host/mcp.mjs` | 同上 |
| `DEMO.md` | `docs/DEMO.md` | 根级文档归位 |
| `FACT-FIRST.md` | `docs/FACT-FIRST.md` | 同上 |
| `PUBLISHING.md` | `docs/PUBLISHING.md` | 同上 |
| `mcp/skills/{analysis,deduce,novel,OVERVIEW,reference}.md` | `docs/mcp/…`（5 份） | MCP 对外材料是文档不是代码 |
| `workflows/qwen-image-2.1-t2i.json` | `samples/qwen-image-2.1-t2i.json` | 生图工作流样例随 samples 走 |
| `stylekits/PROTOCOL.md` | `docs/STYLEKIT-REGISTRY-PROTOCOL.md` | 与 `docs/STYLEKIT-PROTOCOL-20261116.md` 核对：**不是同一份**——后者是设计稿 v1＋KB→StyleKit 桥，前者是注册协议精简版；两份都留 docs/，并在后者加了指向注 |
| `scripts/arch-stats.mjs` | `tools/arch-stats.mjs` | scripts 并入 tools |
| `scripts/audit-artifacts.mjs`、`audit-sync.mjs` | `tools/audit/…` | 同上，按用途分组 |
| `scripts/verify-newproj.mjs`、`verify-shuihu.mjs` | `tools/verify/…` | 同上（`os-batch-runner` 原有新旧路径兼容解析，无需改它） |

`scripts/`、`mcp/`、`workflows/`、`stylekits/` 四个空目录已删除。

**新根目录 `ls`**（无散落 `.mjs`）：
`AGENTS.md ARCHITECTURE.md LICENSE README.md design-system docs genres node_modules package-lock.json package.json public runtimes samples skills src styles suites test tools`

**新命令冒烟**（临时 LOCALAPPDATA，不碰真机）：
- `node src/host/daemon.mjs --port=18809` → `/api/health` 200 ✓
- `node src/host/mcp.mjs` → stdio initialize 握手成功，tools 24 个 ✓

**门禁收紧**：S0.1 从「仓根恰好两个垫片」改为**根目录白名单**（文件 7 项＋目录 16 项，多一个都红；`.git`/`.cache`/`.ua`/`.daemon-<port>.log` 运行时产物豁免），实测 26 条目、越界 0。S1.2 改读 `docs/mcp/`；S2.1 扫描面去掉已删的两个垫片（实现文件本就在 `src/host/` 内，覆盖面不减）。

**引用同步**：`package.json` 三条 scripts（start/mcp/arch:stats）；`tools/acceptance/acceptance.mjs`（S0.2 arch-stats 路径、S1.2、S2.1）；`test/{entryShims,daemonSingleInstance,mcp,modulePlugins}.test.mjs`（入口直跑路径，entryShims 等价重写为「根目录零 .mjs＋实现文件即入口」，断言强度不减）；`tools/dsh-openstory-studio/{index.mjs,cordis.patch.yml,README.md}`；`README/ARCHITECTURE/AGENTS/docs/{ACCEPTANCE,UX-STRUCTURE,DEMO,mcp/OVERVIEW}`。全仓 grep 旧路径（`node daemon.mjs`/`node mcp.mjs`/`node scripts/`/`mcp/skills/`/`scripts/arch-stats`/`workflows/qwen`/`stylekits/PROTOCOL`）在活跃代码与文档中为空；仅历史工单与 `docs/plan/` 保留当时的路径记述（史料，不改）。

**LIMITATIONS**：无。历史验收报告快照 `tools/acceptance/out/report-*.json` 里的 `mcp/skills/` 是当时的记录，未改。
