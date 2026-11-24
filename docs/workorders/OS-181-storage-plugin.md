# OS-181 · C3 storage 插件化（courtyard／libraryManifest／建库骨架降级）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 C 降级批（工作包 C3） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3 storage 件、§2.9 storage×genres 边界、§4 批次 C |
| 依赖 | OS-180 |
| 允许改动 | `src/modules/storage/**`（新建或由 `src/modules/library` 改造）、`src/protocol/{courtyard,libraryManifest,authorize}.mjs`、`src/host/{authorize,courtyard}.mjs`、`src/api/**`、`src/modules/*/module.manifest.json`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 高（库清单是 root 授权来源，弄错会让作者打不开库） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

库清单、本机院子路径、建库骨架这三件事从宿主域降级为**内核件 storage**（供给 `storage.roots@1`、`library.list@1`）；root 白名单的**数据来源**经能力供给，而**路径防逃逸检查**（`resolveInsideRoot`）留在底座——数据可以是能力，安全是宪法。

## 任务

1. **storage 件**：收编 `libraryManifest`、`courtyard`（协议层一份、宿主门面一份，合并成一处解析）、建库骨架（`projectDoc.mjs` 的目录骨架表）；manifest 声明两项能力，`storage.roots` 带 `golden`（锁 `libraries.json` 与 `project.json` 的落盘格式——`project.json` 此时已是 OS-172 的自有格式）。
2. **自举顺序**（按 ADR）：底座在 storage 件装载之前只需要「内置 manifest 目录」与「院子根路径」两样——把这两样的解析明确写成底座自举最小集，其余路径一律 `resolve('storage.roots')`。
3. **root 白名单**：`allowlist.resolve` 的清单来源改为经能力路由；`--root=` 显式授权与路径防逃逸检查留在底座，不随件走。
4. **storage × genres 边界**（按 ADR 结论；作者倾向：骨架模板属体裁包）：建库骨架模板从 storage 件里移到体裁包（数据），storage 件只提供「按模板建骨架」的通用能力。
5. **测试**：临时 `LOCALAPPDATA` 下的清单读写、损坏清单报错、`--root` 授权绕过清单、路径逃逸被底座拦下；骨架模板换一份体裁包后建出的目录集合随之变化。

## 不做

- **绝不碰真实院子与作者真库**（全部用临时 `LOCALAPPDATA` 注入）。
- 不迁移任何既有清单或库。

## 验收

- 全量测试与验收门禁全绿；新建库 e2e 13/13 全绿。
- 反证：把 storage 件的供给临时拿掉，启动报告应指出底座自身的哪条 `requires` 断了；贴输出后改回。
- 报告贴：底座自举最小集清单、root 来源的前后对照。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
