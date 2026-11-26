# OS-203 验收记录（监督线，2026-11-26）

**结论：通过（经 OS-203a 返工后）。** 提交 `1077313`（主体）＋ `7d401f7`（返工）。施工 CodeBuddy `hy4flash`。

## 一、我自己实跑

| 项 | 主体 `1077313` | 返工后 `7d401f7` |
|---|---|---|
| 主探针 | 19 过 / 0 挂 | 19 过 / 0 挂 |
| 专项探针（右栏＋设置区） | — | **10 过 / 0 挂** |
| 全量测试 | 889 例 · 887 过 · 0 挂 · 2 跳过 | 893 例 · 891 过 · 0 挂 · 2 跳过 |
| 验收门禁 | 29 过 / 0 挂 / 0 警 | 同 |
| `app.js` 行数 | 10,095（不增） | 10,095 |

降级一律走**真实接口链路**造：停带依赖的工作台 → 停内核件 → 重开工作台。

## 二、返工原因（OS-203a）

主体版把页签、说明页、`slotState`、`missingText`、`degradedViewHtml` 都做对了（这几项已验），但两处没做到：

### 1. 右栏入口在降级时被隐藏，而不是灰显

实测：`analysis` 降级后正文页的「分析本章」按钮 `hidden="true"`、完全消失。工单要求「停用照旧隐藏；降级置灰保留」。

### 2. 设置区降级提示没命中，仍出完整可编辑表单

实测：`imagegen` 降级时「引擎与存储」里生图、识图仍是完整表单（Endpoint／模型／Key／保存／测试连接全在），没有降级说明——正是 OS-146 铁律禁止的死配置。

返工后：`slotActionAttrs` 三态（停用→`hidden`／降级→`disabled`＋`aria-disabled`＋`title`／健康→只有 title）；设置区降级时不出表单，出一条点名缺失能力与供给方的说明。

## 三、验收项（返工后逐项实测）

**探针（19 项）**：降级页签带 `degraded`／`missing`；其余页签不受影响；「＋」面板降级项带 `degraded`；健康输入形状不变；`slotState` 三态；`tabButtonHtml` 灰显＋`aria-disabled`＋title；`missingText` 三种文案（有供给方／无供给方／多项）；`viewHtml` 分派前有降级判定；`degradedViewHtml` 写模块名＋缺失项＋治理台入口。

**专项探针（10 项）**：降级时生图表单消失（无 `mcfg-image-endpoint`）、识图表单消失（无 `mcfg-vision-enabled`）、无生图保存/测试按钮、出说明并点名 `media.`；右栏三态（停用 `hidden`／降级 `disabled`＋`aria-disabled`＋点名能力／健康无隐藏无禁用）；四处入口都走 `slotAction(` 且 `app.js` 无 `slotHas(`。

## 四、测试不放宽

主体新增 `test/degradedSurfaces.test.mjs` 等；返工 `1077313 → 7d401f7` 的测试 diff 里**删除的断言为零**。
反证：把 `slotActionAttrs` 的健康分支也改成 ` hidden`，`test/degradedSurfaces.test.mjs` 立刻红（exit=1）。已还原。

## 五、浏览器实测（临时 daemon＋临时夹具库，截图已归档）

截图在 `D:\Pinax-e2e\os-shots\os203-degraded-20261126\`：

1. `01-降级页签灰显.png`：「扮演」页签灰显；点它被拦住（停在正文）；强制 `go('roleplay')` 给说明页——「扮演 · 暂不可用／缺少所需能力：text.analyze@1（供给方：文本内核）——该工作面暂不可用／去插件治理台 →」。
2. `02-设置区-生图识图降级说明.png`：`imagegen` 降级后，「引擎与存储」里生图／识图表单消失，换成两条说明（点名 `media.generate@1`、`media.describe@1`，供给方媒体引擎，带「去插件治理台 →」）。
3. `03-右栏入口降级灰显.png`：`analysis` 降级后，「分析本章」按钮**可见但置灰**——`disabled`、`aria-disabled="true"`、`data-degraded="1"`、悬停「缺少所需能力：text.analyze@1（目前没有插件供给）——该工作面暂不可用」。

## 六、留给后续

导航收敛、面板独立成节、单一装载、「关于」版本号（OS-204）；显示名迁入投影（OS-205）。

另记一条环境教训：临时夹具库放在系统 `%TEMP%` 下时偶发 `EPERM rename ui-state.json`（目录被占），冒烟改用项目内临时根即可复现稳定；这不是产品缺陷，但写冒烟脚本时要注意。
