# OS-180 · C2 prose 插件化（chapters 拆两半）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 C 降级批（工作包 C2） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3 prose 件与写作台、§4 批次 C |
| 依赖 | OS-179 |
| 允许改动 | `src/modules/prose/**`（新建）、`src/modules/chapters/**`、`src/modules/script/**`、`src/protocol/{chapterWrite,changelog,chapters}.mjs`、`src/host/**`、`src/api/**`、`src/modules/*/module.manifest.json`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 高（正文写通道） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

chapters 拆成两半：**写协议下沉**为内核件 prose（供给 `prose.write@1`、`changelog@1`：`writeChapterWithBackup`＋`.history` 保留策略＋月度留痕），**页面上浮**为写作台（workbench，`requires: prose.write`、`fact.store`）。剧本台同样 `requires: prose.write`——两个工作台共用一条写通道。

## 任务

1. **prose 件**：`src/modules/prose/` 收编 `src/protocol/chapterWrite.mjs`、`changelog.mjs` 与 `.history` 保留逻辑；manifest 声明两项能力，`prose.write` 带 `golden`（锁正文落盘：原子写、备份文件命名、日志行格式）。
2. **写作台**：`src/modules/chapters/` 只留页面相关（端点归属、页签、视图）；manifest 的 `class: workbench`、`requires` 两项、`slots: ["tab"]`。
3. **剧本台**：`src/modules/script/` 的 manifest 补 `requires: prose.write`；它的文件写入确认走同一条通道（不许有第二份写逻辑）。
4. **单一写通道核查**（本单的真正风险点）：列出正文与剧本的全部写入路径（界面保存、MCP 写工具、导入、扮演「拍转正」），逐条确认都经 `prose.write`；报告里写「收敛前 N 条、收敛后 M 条」。
5. **测试**：正文＋剧本写路径回归（保存→备份→恢复、日志行）；两条 e2e 里的正文读写；拍转正仍落 `正文/` 并留 `.history`。

## 不做

- 不改正文／剧本的落盘格式；不改写协议的语义（原子性、备份、留痕）。
- 不动 `factGuard`（它守的是 fact 读侧）。

## 验收

- 全量测试与验收门禁全绿；水浒／新建两条 e2e 全绿。
- `grep` 证据：仓里只有一处实现原子写＋备份的正文写函数；`src/api/handlers/**` 不直接 import 它，而是经能力路由。
- `app.js` 行数不增；本批末的行数上限锚（≤11,600）由 OS-170 的门禁把关。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
