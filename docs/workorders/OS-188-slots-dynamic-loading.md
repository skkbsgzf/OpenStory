# OS-188 · D4 slots 扩展＋动态装载评估

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 D 魔改批（可选；工作包 D4，第三批终点） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §2.6、§2.8、§4 批次 D |
| 依赖 | OS-187 |
| 允许改动 | `public/views/**`、`public/app.js`、`src/host/**`、`src/protocol/**`、`src/api/**`、`src/modules/agentbar/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md` |
| 风险 | 中（前端口径变化；评估部分不动代码） |
| 状态 | 待派（可选批） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

两件事：**slots 扩展落地**（sidebar／panel 两种嵌入点，Agent 栏落 sidebar）；**动态装载可行性评估**出一份报告（第三方生态的门要不要开、怎么开）——只评估，不实现。

## 任务

1. **slots 注册表**：底座词表登记四种 slot（tab／host-actions／sidebar／panel）；工作台在 manifest 的 `slots` 里声明嵌入点；前端按注册表挂载，不在 `app.js` 里写死哪个模块在哪。
2. **Agent 栏落 sidebar**：agentbar 的工作台声明改为 `slots: ["sidebar"]`，由注册表挂载（现有行为、位置、收起展开不变）。
3. **`pages[].slot` 去重**（R9，按 ADR 结论）：嵌入点统一在一处声明，另一处删掉；迁移工具同步。
4. **动态装载评估报告** `docs/plan/dynamic-loading-assessment.md`：
   - 前端：浏览器 `import()` 动态装载工作台视图的可行性（门禁 S2.1／S2.2 的动态扫描已预留）、失败回退、首屏影响；
   - 后端：内核件从本机目录装载需要什么（签名或哈希校验？沙箱？能力白名单是否够）；
   - 风险清单与建议的开放顺序（先开只读的 skill／资源，再开工作台，最后才考虑内核件）；
   - 明确结论：建议开／暂不开，理由各三条。
5. **`app.js` 行数**：本批不反弹（门禁把关）；挂载逻辑进 `public/views/`。

## 不做

- **不实现**任何动态装载（评估报告是唯一交付）。
- 不改 Agent 栏的任何用户可见行为。

## 验收

- 全量测试与验收门禁全绿；Agent 栏在设置里启停往返正常。
- 反证：一个工作台声明了未登记的 slot 名，装载器必须拒并报错。
- 评估报告结论明确、每条建议带风险与前置条件。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
