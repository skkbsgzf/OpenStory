# OS-174 · B1 manifest@2 落地（schema＋校验器＋@1→@2 迁移工具）

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 B 能力批（工作包 B1） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §2.2、§4 批次 B |
| 依赖 | **OS-173 协议定稿且作者已过目** |
| 允许改动 | `src/protocol/**`、`src/modules/*/module.manifest.json`、`src/host/moduleHooks.mjs`、`src/api/**`、`public/views/**`、`test/**`、`tools/**`、`docs/**`、`AGENTS.md`、`ARCHITECTURE.md`、`package.json`（只许改 `scripts`） |
| 风险 | 中（装载协议是所有插件的公共语言） |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

把协议定稿里的 manifest@2 变成**能跑的 schema 与校验器**，14 份现有 manifest 全部升版；过渡期 @1 继续受理，行为零变化。

## 任务

1. **schema 与校验器**（`src/protocol/modules.mjs` 升版，或按定稿另立文件）：按定稿实现必填矩阵——`class` 三类各自的必填／禁止字段；`capabilities[]`、`requires[]`、`overrides[]`、`migrations[]` 的形状校验；未知字段报错而不是忽略。
2. **@1 → @2 迁移工具**（`tools/` 下可重跑的脚本）：读 @1 → 按定稿的 class 推断规则（现 `core:true`／宿主域／普通 → 建议值）→ 写 @2；只许改 manifest 文件；幂等；输出每份的推断结果供人核对。
3. **14 份 manifest 升版**：用迁移工具跑一遍，再人工核对推断的 `class`；现有字段（`endpoints`、`pages`、`settings`、`settingsHint`）原样保留；`core: true` **暂时保留**（它由 OS-176 退役，本单不动）。
4. **过渡期受理**：装载循环同时认 `openstory-module@1` 与 `@2`；@2 的新字段（`capabilities`／`requires`／`class` 等）在过渡期全部选填——缺了只记一条启动警告，不拒载。
5. **端点与页签归属检查跟着升**：现有覆盖面测试（`test/moduleCoverage.test.mjs`）与门禁 S2.7 改为读 @2 的字段，@1 兼容路径也要覆盖。
6. **测试**：schema 对三类的合法／非法样例各至少 3 例；迁移工具对 14 份真实 manifest 幂等；@1 夹具仍可装载；覆盖面测试全绿。

## 不做

- 不实现能力图、能力路由、停用推导（OS-175／176／178）。
- 不改任何模块的业务代码与前端行为。

## 验收

- 全量测试与验收门禁全绿；14 份 manifest 都过 @2 校验。
- 反证：一份缺 `capabilities` 的 kernel 类、一份带 `capabilities` 的 workbench 类，校验器都必须拒。
- 报告贴：迁移工具输出的 14 行推断结果、schema 校验规则清单。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
