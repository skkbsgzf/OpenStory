# module-manifest@2 · 能力、工作台与创作套件协议

**状态：B1–B5、C 批（C1–C6）、D1–D4 与 OS-192 均已实施；七内核统一注册、动态激活、能力路由、slot 注册表、五类货架一等套件与数字锚门禁均已通过。本机可执行模块由 OS-196 开放、OS-196a 返工三道门（运行期边界／先检查后激活／整图摘要）与端点归属规则；全局热切换仍未实施（见 [ADR 0003](../adr/0003-dynamic-loading.md)）。架构裁定见 [ADR 0002](../adr/0002-base-constitution.md)。**

当前仓使用 `openstory-module@2`，21 份内置 manifest＝7 kernel＋12 workbench＋2 无 class 宿主组合面；**OS-192 起装载只认一套规则（原 stage C），stage 参数与 @1 双读/迁移脚手架全部删除**。能力图、停用事务、薄代理、模块级 `core`／`MODULE_CORE` 退役、动态 `activate` 与贡献校验均已落地。五类货架（技能/文风/体裁/运行时/业务套装）经 `loadSuiteCapabilityManifests()` 投影成 module@2 套件，与模块共用一张能力图与一份 suite-state；legacy `openstory-suite@1/@2` 页面模式已整体退役。端点 id/path 与 MCP 工具名不变（退役的两个端点除外）。

---

## 1. 范围与约束

### 1.1 三类插件

| class | 职责 | 允许用户界面 | 允许提供能力 |
|---|---|---|---|
| `kernel` | 无 UI 的能力供给者 | 否 | 是，`capabilities` |
| `workbench` | 用户功能面 | 是，`pages/slots/settings` | 否 |
| `suite` | skill、规则、工作流、资源、runtime 描述与 bundle | 仅宿主按 schema 渲染的设置项 | 否 |

宿主面（Agent 栏、设置、库管理）不是第四类，也不是可停用 workbench；它们是底座组合面，通过能力路由消费 kernel。

### 1.2 四条不可协商边界

1. 插件不得 import 另一个插件的内部实现；只能通过 `context.resolve()` 获取能力句柄。
2. 插件不得自定业务落盘路径或绕过 `base.write`；格式归能力，物理写归底座。
3. 未在 manifest 声明的 endpoint/page/slot/capability/supply 不得注册。
4. suite 不得携带宿主可执行代码、迁移器或能力实现；runtime 命令只是 `agent.runtime` 已实现的受控描述。

### 1.3 与对外契约的关系

内部 slug 可以改，既有端点路径、MCP 工具名与已发布错误码不随本协议自动改名。B3 已移除 `MODULE_CORE`；OS-192 起 `openstory-module@1` manifest 直接拒收并给出明确警告，`core` 字段在任何情况下都不接受，不再有迁移工具或 npm 脚本。

---

## 2. 术语

| 术语 | 定义 |
|---|---|
| 底座（base） | 唯一非插件层：进程与网络、装载协议、契约壳、物理写管道、词表 |
| 能力（capability） | 带主版本的供给契约，如 `fact.store@3` |
| 供给者（provider） | 在 `capabilities` 声明某能力的 kernel |
| 消费者（consumer） | 在 `requires/optionalRequires/appliesTo` 声明能力区间的工作台、内核件或套件 |
| 硬依赖 | `requires` 缺失时消费者不装载；可选依赖缺失时消费者降级 |
| 覆盖（override） | 显式声明替换某个 capability、surface contribution 或 suite resource |
| 金样（golden） | 以固定夹具逐字节/逐帧验证能力输出与落盘格式的内部契约 |
| 贡献（contribution） | 插件向底座登记的 endpoint、page、slot、settings 或 supply |
| 快照（snapshot） | 一次通过三检查后冻结的路由/贡献/能力表；切换前不可变 |
| 降级（degraded） | 插件或宿主面仍在进程中，但部分贡献不可用，并在启动报告/请求错误中明确说明 |
| legacy（历史） | OS-192 已无运行态 legacy 套件：@1 直接拒收，五类货架全部投影成 module@2 |

---

## 3. 权威分类

本节与 ADR §二一致；协议校验器以这里的 class/字段边界为准，不重新发明产品名。

### 3.1 七内核件

`storage → fact → prose → text → deduce → agent-runtime → media`（顺序是设计依赖序，实际 id 以 manifest 为准）

| id | 能力示例 | 金样义务 |
|---|---|---|
| `storage` | `storage.roots@1`、`library.list@1`、`storage.scaffold@1` | root/清单/建库骨架落盘金样 |
| `fact` | `fact.store@3`、`fact.pack@1`、`fact.enrich@1` | `fact.store` 必须带 `golden`；现 `decoupleStep2` 转为内部能力金样 |
| `prose` | `prose.write@1` | 正文读取/写协议、history 与 changelog 金样；`prose.changelog@1` 仅为早期规划建议，未登记为独立能力 |
| `text` | `text.analyze@1`、`text.lint@1` | 确定性输出金样；分析引擎不依赖 UI |
| `deduce` | `deduce.engine@1` | 同种子/事实包/规则=同拍的金样 |
| `agent-runtime` | `agent.runtime@1`、`agent.embedding@1` | 协议帧与存储边界金样；真实上游响应不做逐字节金样 |
| `media` | `media.generate@1`、`media.describe@1` | 请求/输出协议与白描结构金样；图片二进制可用结构/哈希断言 |

### 3.2 工作台两档与宿主面

- 创作面：正文、世界书、剧本、故事源、扮演。
- 工具面：习惯、产物、日志、分析、知识库、生图与识图、导入导出。
- 宿主面：Agent 栏、设置、库管理；不套 `class:workbench`。

三名一致由底座 `NAMING_TABLE` 投影保证：workbench 的 `id` 是唯一 slug，`name` 逐字等于正名；目录名与日志模块名从表中解析，不在 manifest 再抄一份。没有目录/日志的概念解析为 `null`，不要求新建目录。

### 3.3 六种 suite 供给

`skill | deduce-rule | media-workflow | resource | runtime | bundle`

- `resource` 必须再给 `resourceKind: "style" | "genre"`。
- `bundle` 必须给至少一个 `deps`，自身不提供可执行入口。
- `runtime` 是 `agent.runtime` 的受控扩展描述，不是第四类插件。
- OS-192 五类货架的投影来源见 [`suites/PROTOCOL.md`](../../suites/PROTOCOL.md)：`skills/<id>/SKILL.md`、`styles/<id>.json`、`genres/<id>.json`、`runtimes/<id>/manifest.json`、`suites/<id>/manifest.json`。单文件/单目录货架不另加 manifest。

---

## 4. manifest@2 形状

### 4.1 通用形状

以下示例展示字段集合；不同 class 必须遵守 §4.2 的禁用矩阵，不能把其他 class 的字段填着占位。

```json
{
  "spec": "openstory-module@2",
  "id": "fact",
  "name": "事实引擎",
  "version": "1.0.0",
  "class": "kernel",
  "builtin": true,
  "description": "事实链存储、装配与增补能力",
  "entry": "index.mjs",
  "minOpenStoryVersion": "0.2.0",
  "capabilities": [
    { "id": "fact.store", "version": 3, "golden": "fact-store-v3" },
    { "id": "fact.pack", "version": 1 },
    { "id": "fact.enrich", "version": 1 }
  ],
  "requires": [
    { "id": "storage.roots", "min": 1 }
  ],
  "optionalRequires": [],
  "overrides": [],
  "migrations": [],
  "endpoints": []
}
```

工作台示例：

```json
{
  "spec": "openstory-module@2",
  "id": "analysis",
  "name": "分析",
  "version": "1.0.0",
  "class": "workbench",
  "builtin": true,
  "entry": "index.mjs",
  "requires": [
    { "id": "text.analyze", "min": 1 },
    { "id": "fact.enrich", "min": 1 }
  ],
  "optionalRequires": [],
  "endpoints": [],
  "pages": [{ "id": "analysis-panel", "label": "分析" }],
  "slots": [{ "slot": "right", "page": "analysis-panel" }],
  "settings": []
}
```

套件示例：

```json
{
  "spec": "openstory-module@2",
  "id": "default-deduce-rules",
  "name": "默认推演规则",
  "version": "1.0.0",
  "class": "suite",
  "builtin": true,
  "supplies": ["deduce-rule"],
  "entries": { "deduce-rule": "rules.json" },
  "appliesTo": [{ "id": "deduce.engine", "min": 1 }],
  "deps": [],
  "settings": []
}
```

### 4.2 必填矩阵（C 批起生效）

「必填」表示字段必须存在且非空；「可选」表示可省略；「禁止」表示出现即校验失败。

| 字段 | kernel | workbench | suite |
|---|---|---|---|
| `spec/id/name/version/class/builtin` | 必填 | 必填 | 必填 |
| `entry` | 必填 | 必填 | 禁止 |
| `capabilities` | 必填，≥1 | 禁止 | 禁止 |
| `requires` | 可选 | 必填，≥1 | 禁止 |
| `optionalRequires` | 可选 | 可选 | 禁止 |
| `overrides` | 可选，仅 capability | 可选，仅 surface | 可选，仅 resource |
| `migrations` | 可选，仅 capability | 禁止 | 禁止 |
| `endpoints` | 禁止（必须为空） | 可选 | 禁止 |
| `pages` | 禁止 | 可选 | 禁止 |
| `slots` | 禁止 | 必填，≥1 | 禁止 |
| `settings` | 禁止 | 可选 | 可选，仅 schema |
| `settingsHint/settingsJump` | 禁止 | 可选 | 禁止 |
| `supplies` | 禁止 | 禁止 | 必填，≥1 |
| `entries` | 禁止 | 禁止 | 必填，覆盖每个 supply |
| `resourceKind` | 禁止 | 禁止 | 含 `resource` 时必填 |
| `appliesTo` | 禁止 | 禁止 | 必填，≥1（文风包 `resourceKind:style` 允许空） |
| `deps` | 禁止 | 禁止 | 可选；`bundle` 时必填且 ≥1 |
| `description/minOpenStoryVersion` | 可选 | 可选 | 可选 |
| `core` | 禁止 | 禁止 | 禁止 |

### 4.3 通用字段校验

- `spec` 必须逐字等于 `openstory-module@2`。
- `id`：`^[a-z][a-z0-9-]{1,39}$`，全局唯一，并等于包目录名。
- `name`：非空；workbench 必须等于命名表正名；suite 名称在该供给类型内唯一。
- `version`：`x.y.z` 三段全数字，表示插件自身 semver。
- `class`：只收 `kernel/workbench/suite`。
- `builtin`：必须与实际装载源一致；本机包不能自称 `builtin:true` 获取信任。
- `entry`：相对路径，不得逃逸包目录；kernel/workbench 的入口导出约定见 §8。
- `minOpenStoryVersion`：应用版本闸，与能力主版本无关；缺字段不校验，格式坏 fail-open warning，版本过高跳过装载。
- 未声明字段一律拒绝，避免 typo 被静默忽略。

### 4.4 pages 与 slots

- `pages[]` 只允许 `{id,label}`；`label` 必须与命名表正名一致。
- `slots[]` 只允许 `{slot,page}`；`page` 必须引用同 manifest 的 page id。
- 底座初始保留 slot：`tab/right/sidebar/host-actions/settings`。D 批扩展 slot 必须先在底座注册，插件不能自造。
- 注册表唯一真源是 `src/protocol/slots.mjs` 的 `SLOT_REGISTRY`（`openstory-slots@1`，含 id/label/description/scope），
  校验与 `base.naming` 只读投影都从这里取；扩展 slot＝改表＋同步前端编排＋补 `test/slots.test.mjs`，**无运行时自注册入口**。
- 同一 page 不得重复嵌入同一 slot；同一 slot 内多个 page 按 manifest 声明序＋稳定 id 排序
  （装载器可经 `slotPlacements()` 取稳定编排，停用模块不出现）。
- `pages[].slot` 与顶层字符串 `slots` 不再接受。

### 4.5 settings

- 只收 `{key,label,type,default,options?}`，type 为 `string/number/boolean/select`。
- 每个 key 必须有真实消费者；OS-146 的消费者表继续有效。
- suite 只允许 schema 设置；page 模式已整体退役（无 `/suite-assets/`、无 state-data 端点）。
- 凭据不得进入 settings 或库内 state；真配置仍只在本机配置文件，响应只回掩码。

---

## 5. 能力协议

### 5.1 命名与主版本

- 能力 id：`<domain>.<name>`，两段小写 slug；domain/name 可为小写字母、数字、连字符。
- `base.*` 只有底座可提供；其他 domain 由供给者声明并启动登记。
- `version` 是正整数主版本，不是插件 semver。
- 主版本变化代表不兼容：删除/改名能力成员、改变落盘格式、改变错误语义或确定性结果。
- 向后兼容地增加可选输出键不升主版本，但必须更新金样/文档。

### 5.2 消费区间

`requires/optionalRequires/appliesTo` 项为：

```json
{ "id": "fact.store", "min": 3, "maxExclusive": 4 }
```

- `min` 必填；`maxExclusive` 可选，缺省为 `min + 1`。
- 供给主版本必须满足 `min <= provider.major < maxExclusive`。
- 不能只写 `min:3` 就默认接受 `fact.store@4`；主版本升级不自动兼容旧消费者。

### 5.3 金样

- 凡改变落盘格式、目录骨架、日志/history 语义或确定性输出的能力，manifest 必须给 `golden`。
- `golden` 是注册表键，不是任意绝对路径；底座负责解析到仓内夹具并记录版本。
- 覆盖者覆盖带金样的能力时，必须提供自己的新金样；不能复用被覆盖者金样冒充新格式。
- 金样是内部质量契约，不是 Pinax 互认凭证。

### 5.4 启动三检查

对候选快照依次执行：

1. **闭环**：所有 hard `requires` 与底座 hard requires 必须有满足区间的活跃供给者；optional 缺失列降级，不阻断。断链码 `CAPABILITY_MISSING`。
2. **冲突**：同一 capability/surface/resource 有多个候选且无合法显式覆盖；覆盖环按冲突处理。冲突码 `CAPABILITY_CONFLICT`。
3. **覆盖合法**：逐项检查 §7 四守卫；不合法整项拒绝，覆盖者降级。拒绝码 `OVERRIDE_REJECTED`。

三检查通过才冻结快照。B 批每次按库构建完整候选图并校验启停事务；C6 验收在此基础上检查 stage-C 清单、端点/page/slot/capability 归属与真实 activate 贡献。全局原子热切换仍属后续，不把当前按库薄代理冒充全图热切换。

### 5.5 启动失败策略

- 进程、health、契约壳、物理写与词表始终先可用。
- 缺 hard 能力的消费者不装载；它的 slot 不出现，已登记 endpoint 返回 `PLUGIN_DEGRADED`，不返回伪造数据。
- 坏 manifest 只跳过该插件并记 warning；不得阻止其他插件装载。
- `GET /api/plugins` 返回启动报告：当前 snapshot、loaded/degraded、断链、冲突、覆盖拒绝、warning。
- health 继续只报进程事实，不把库路径、密钥或插件内部堆栈带回响应。

---

## 6. 启停与两种「不可停」语义

### 6.1 状态落盘

- kernel/workbench：`<库>/.openstory/ui-state.json` 的 `modules.enabled.<id>`，缺省 true。
- suite（含五类货架投影出的全部套件）：`<库>/.openstory/plugins/suite-state.json` 的 `suites.<id>.enabled`；设置值仍在同一文件。`suitesGet`／`suiteStatePut`／`suiteSettingsPut` 对五类通用。
- 无库时只能读机器级缺省；插件不得自己写 state 文件，统一经底座状态 API。
- 停用不删稿件、不删设置、不删历史；重新启用恢复贡献。

### 6.2 拒绝停用：有活跃 hard consumer

当供给者被至少一个**已启用且已装载**的 hard consumer 或底座 hard requires 消费时，停用请求必须被拒绝：

- HTTP `409`，码 `CAPABILITY_IN_USE`。
- `details.consumers` 列出全部直接断链点；传播闭包可由报告扩展，但不得只报第一个。
- optional consumer 不阻止停用；它们降级。
- 同一状态事务可先停用消费者再停用供给者；候选状态通过图检查后才提交。

### 6.3 启动/切换时缺失：消费者降级

- 消费者不装载或失去对应贡献，报告/请求使用 `PLUGIN_DEGRADED`（HTTP `503`）。
- 不把这种情况误报成「作者主动停用」；作者主动停用工作台仍用 `MODULE_DISABLED`（HTTP `409`）。
- 缺能力不是 daemon 拒启理由。

### 6.4 各 class 的停用结果

| class | 结果 |
|---|---|
| kernel | 先做 hard consumer 检查；允许后重建快照，合法回退链生效，消费者按新图降级 |
| workbench | slot 消失；独占 endpoint 返回 `MODULE_DISABLED`；数据与设置保留 |
| suite | supply 下线；`deps` 是软依赖，不制造能力断链；bundle 缺项在报告中列 degraded |

`MODULE_CORE` 已随 B3 退役；不再用 `core:true` 表达不可停用推导。宿主组合面不是 workbench，也不接受模块启停键。

---

## 7. 覆盖协议

### 7.1 覆盖形态

```json
{
  "overrides": [
    { "type": "capability", "target": "fact.store", "from": 3 }
  ]
}
```

- kernel 只能 `type:"capability"`，且必须同时提供目标 capability。
- workbench 只能 `type:"surface"`，目标为已注册的 surface contribution id；不得改能力或磁盘格式。
- suite 只能 `type:"resource"`，目标为资源 id；不得改能力、目录契约或携带迁移器。
- 本机覆盖内置是候选优先级，不是覆盖合法性的替代品。

### 7.2 四守卫

1. **显式声明**：必须点名 `type/target/from`；同 id 后装载静默替换不接受。
2. **版本对齐**：`from` 必须等于当前被覆盖目标主版本；不能跨未知版本覆盖。
   - 同主版本换金样＝改了落盘格式却没升版，直接 `OVERRIDE_REJECTED`，理由 `GOLDEN_CHANGE_REQUIRES_MAJOR`；不再要求、也不接受就地 `from === to` 的迁移器。
   - 升主版本只在「供给版本 ＝ 被覆盖版本 ＋ 1」时受理，且必须带 `from ＝ 被覆盖版本`、`to ＝ 供给版本` 的迁移器；跨两档以上 `OVERRIDE_REJECTED`，理由 `OVERRIDE_MIGRATION_GAP`。
3. **迁移责任**：capability 覆盖升主版本时必须带对应 `migrations` 且新金样通过，缺迁移器记 `OVERRIDE_MIGRATION_REQUIRED`。surface/resource 覆盖禁止迁移器。
4. **回退链**：每个覆盖者必须能回退到前一合法候选；回退前重新跑三检查。若被覆盖的供给者被停用或缺席、同能力只剩覆盖者一个供给者，这条覆盖声明**不生效**——覆盖者按普通供给者装载、不进 degraded、路由指向它、消费者不断链；`SELF_OVERRIDE` 只保留给「场上除被覆盖者外确无他方、声明目标就是自己」的真正自覆盖错误。若数据已迁到新主版本而旧供给者不支持，回退到「旧格式 provider」是非法的，消费者保持 degraded，绝不静默读错格式。

### 7.3 优先级与环

- 候选优先级：底座保底 → 内置 → 显式本机覆盖 → 装载序（仅在贡献 id 不同或已显式允许时）。
- 互相覆盖、自覆盖、覆盖不存在目标、覆盖 base 能力均拒绝。
- 本机同 id 覆盖内置一律显式报告（谁覆盖谁、来自哪个目录）：`/api/suites` 与 `/api/plugins` 的 `overrides`；不再静默按 Map 顺序替换。

### 7.4 切换与在途请求

1. 生成候选快照，不修改当前指针。
2. 跑闭环/冲突/覆盖合法三检查。
3. 通过后原子切换指针；失败保留当前快照。
4. 新请求拿新快照；在途请求继续使用旧句柄直至结束。
5. 禁止在未校验情况下热替换 handler 或能力函数。

**B5 历史切片**：`src/protocol/capabilityResolver.mjs` 返回绑定快照的冻结薄代理；当时宿主组合根把 provider `deduce` 映射到模块本地 `deduceCapability`。推演相关 handler 按请求 root 解析 `deduce.engine@1`，不再直引引擎内部文件；外部端点路径与 MCP 工具名不变。

**C6 当前机制**：动态入口与贡献校验已实现，生产清单只认原 stage C 的唯一规则；`src/protocol/capabilityImplementations.mjs` 是统一注册表，宿主只允许点名声明的绑定。验收在独立进程激活全部内置模块，检查 capability/handler/page/settingsConsumer 与 manifest 一致。注册缺项或 activate 未解析 hard require 必须报错，不得用 fallback 掩盖；全局原子热切换仍未实施。

---

## 8. 迁移协议、底座 API 与禁改区

### 8.1 单向能力迁移

```json
{
  "migrations": [
    {
      "capability": "fact.store",
      "from": 3,
      "to": 4,
      "entry": "migrations/v3-to-v4.mjs"
    }
  ]
}
```

- 只有 kernel/workbench capability 覆盖可携带迁移器；入口相对包目录，必须是受信内置/本机模块。suite 禁止携带迁移器或任何可执行代码。
- 迁移为 `from→to` 单向、只递增一档（`to === from + 1`）：`from === to` 与跨两档以上一律 `MIGRATION_VERSION_GAP`。这与 §7.2 的版本对齐同源——能力图判定放行的版本对，迁移框架必须同样受理，反之亦然。
- 写前生成 `.history` 备份，正文/事实仍走各能力写协议，最终物理提交走 `base.write`。迁移上下文的 `readFile/listFiles` 与提交落盘开放 `.openstory/` 运行态（与模块代码同级可信）；`.history` 除本次迁移自己的备份目录外仍禁止访问。
- 建议固定 journal：`<库>/.openstory/migrations/<capability>/<from>-to-<to>.json`；备份：`<库>/.history/capability-<capability>-<from>-to-<to>-<时间戳>/`。B2 落地时同步补入 AGENTS 落盘表。
- journal 至少记录 plugin id、capability、from/to、迁移器哈希、operationId、开始/完成时间、before/after 哈希、备份路径与结果。
- 进入提交前 `running` journal 就写入**完整计划**：每个文件的相对路径、写前哈希（存在时）、备份相对路径、`committed:false`。每写完一个文件，先把该文件标 `committed:true` 并重写 journal，再写下一个。`running/done/failed/recovered` 四态都有写入点，不留死状态。
- 成功后写 `done`；重复启动见 `done` 直接跳过；见 `running/failed/recovered` 先按 journal 恢复——只还原已提交文件（从备份恢复或删除新建文件），未提交的不动，恢复成功后写 `recovered` journal 再决定是否重试，绝不盲跑半迁数据。
- 失败安全阀：停止提交、删除/隔离临时副本、按 journal 逆序恢复、保留原格式与原数据、禁用覆盖者、返回 `MIGRATION_FAILED`。回滚失败逐条记 `rollbackErrors` 并置 `rolledBack:false`，对外区分「已原样回滚」与「回滚未完成」；不得吞掉错误后宣称原数据已保留。绝不删旧数据文件。
- 禁止自动 down migration。覆盖者停用不等于数据回滚；回退 provider 必须声明能读当前磁盘主版本，否则保持 degraded。
- OS-172 的旧库一次性升级与 capability migration 是两个不同机制、两套 marker；module@2 上线不得重跑 OS-172。

### 8.2 入口契约

kernel/workbench 的 `entry` 导出：

```js
export async function activate(context) {
  const fact = context.resolve('fact.store', { min: 3 })
  return {
    capabilities: { /* 仅 kernel；与 manifest 声明逐项一致 */ },
    handlers: { /* endpointId -> handler；键必须在 endpoints 中 */ },
    pages: { /* pageId -> 宿主视图描述/模块引用 */ },
    settingsConsumers: { /* key -> 真实消费者符号 */ }
  }
}
```

- 装载器先校验 manifest，再调用 `activate`；activate 抛错只降级该插件。
- 返回值不得包含 manifest 未声明的贡献。
- suite 不执行 `activate`；loader 只解析 `entries` 指向的数据文件。

### 8.3 底座 API

| API | 职责 | 禁改区 |
|---|---|---|
| `base.process` | lock/stamp/generation/health/jobs/events/SSE | 插件不得改监听、锁或 generation |
| `base.loader` | manifest 校验、源发现、三检查、快照切换、启动报告 | 插件不得替换裁判或自行注册来源 |
| `base.contract` | endpoint 分派、请求/响应形状、统一错误信封 | 插件不得改路径/错误格式/HTTP 映射 |
| `base.write` | 原子写、临时文件、备份钩子、journal 物理提交 | 插件不得直写业务目录或绕过备份 |
| `base.naming` | 正名/slug/目录/日志/slot/错误码只读投影 | 插件不得改词表或注册未批准 slot |
| `context.resolve` | 按能力区间返回绑定快照的稳定句柄 | 不得缓存裸函数引用假定路由不变 |
| `context.paths` | 已授权 root、包目录、只读资源路径 | 不得逃逸 root/包目录 |
| `context.jobs/events` | 进程任务与 AG-UI 事件 | 不得把临时进度冒充已保存稿件 |

### 8.4 硬禁改区

- 不得 import 其他插件内部文件。
- 不得覆盖 `base.*`、health、错误信封、物理写管道或命名真源。
- 不得在响应中回显密钥；凭据仍只存本机。
- 不得让 suite 携带 `.mjs/.js/.cjs`、内联脚本 HTML、WASM、shell 片段或迁移器。
- 不得把浏览器缓存/localStorage/sessionStorage/IndexedDB 当状态存储；未确认内容仍落本地固定位置。

### 8.5 本机模块的 import 边界与 context（OS-196，OS-196a 返工）

内置模块沿 OS-193～195 的口径：`context.resolve` 取内核句柄，另可直接 import `src/protocol/`
的底座契约与 `src/host/baseCapabilities.mjs`。**本机模块不同**：它来自作者显式登记的本机
模块根，与 daemon 同进程同权限，因此只有一条交互通道。

- **import 边界（运行期强制）**：`src/host/moduleBoundaryHooks.mjs` 用
  `module.registerHooks({ resolve })` 装解析钩子。从已登记根下发出的 import / require 只许解析到
  `node:` 内置模块或**同一个包目录**内的真实路径（按 realpath 比，符号链接指到包外一样拒），
  `data:` URL 也拒（会在包外重新起一层 parentURL）。越界在加载那一刻抛错，`gate:boundary`。
  `src/protocol/localModuleBoundary.mjs` 的静态扫描保留为预览提示，能点名「字符串藏 `/*` 吞掉后续
  import」「改名 createRequire」「unicode 转义 eval」「间接 eval」「裸 Function/AsyncFunction 构造器」
  「getBuiltinModule」「计算属性名取 createRequire」七类绕法，但**不是唯一依据**。
  **边界门不是沙箱**：它挡越界耦合与误用，挡不住同进程代码直接摸 `process`／`node:fs` 或用
  `eval`/`Function` 生成代码；登记的模块与本进程同权限，风险说明在预览里原样显示。
- **交互面**：只经 `activate(context)`。`context.manifest` 是当前 manifest；
  `context.resolve(id, range)` 取按快照绑定的能力句柄；`context.base` 是五件底座能力的只读句柄
  （`process / contract / write / naming / loader`，其中 loader 只有 snapshot/manifests/sources，
  不提供 `activate`）。本机模块不许 import 仓库里的任何文件，也不许静态 import 宿主实现。
- **贡献白名单**：`capabilities / handlers / contracts / pages / slots / hooks` 的键都必须能在
  manifest 的 `capabilities / endpoints / pages / slots` 里找到（端点与能力的双向校验见 §8.2；
  页面与 slot 同口径）；钩子名还须在 `moduleActivation.mjs` 登记。
- **自带端点契约**：`activate()` 可贡献 `contracts: { <endpointId>: { method, path, request,
  response, errors } }`，形状语言沿用本协议的契约表；`path` 必须在 `/api/modules/<模块 id>/…` 之下。
  校验与分派走 `src/host/moduleContracts.mjs` 与 `src/host/runtimeContracts.mjs`，与内置端点共用
  `endpointFor`／`validateRequest`／错误信封；停用模块回 `MODULE_DISABLED`（409）。静态数字锚不
  统计运行期端点。
- **端点归属**：本机模块只能注册自己的新端点，或按 id 覆盖内置模块时接管该模块的端点；
  宿主自有端点（如 `uiStatePut`）与别人的端点不得认领。两个本机模块抢同一新端点＝双方都不跑
  `activate`，报告逐模块点名。
- **身份与快照**：`manifestSha256` ＋ 入口、包内传递依赖与 **JSON 数据依赖**的 `contentSha256`
  进快照 id 与激活缓存键；解析钩子给包内每个 import 追加逐文件摘要（Node 模块缓存按 URL 键），
  同版本改入口／依赖／数据都是新代码。`engines` 最低 `22.15.0`（`registerHooks` 的引入版本）；
  旧 Node 如实报「依赖文件已变，需重启 daemon 才生效」，不显示成已加载新代码。登记摘要与当前
  摘要不符时 `/api/plugins` 标「内容已变」。
- **切换次序**：manifests 层先做端点归属＋三检查 → 淘汰违规模块（不跑 `activate`）→ 只激活合格者
  → 校验贡献 → 重做检查 → 一次同步赋值；淘汰按模块算，同根其它模块照常。
- **失败门**：任一门失败＝当前快照不动、坏模块跳过并记 warning，报告点名是哪一门（identity /
  boundary / contribution / capability / switch）与原因；同包其它模块照常装载。

---

## 9. 错误信封与 HTTP 映射

### 9.1 唯一信封

沿用 `src/api/contracts.mjs:errorEnvelope` 与 `src/host/http.mjs:sendError`，不另造格式：

```json
{
  "ok": false,
  "error": {
    "code": "CAPABILITY_MISSING",
    "message": "分析缺少 text.analyze@1",
    "details": {
      "capability": "text.analyze",
      "consumers": ["analysis"]
    }
  }
}
```

启动报告中的错误项使用同样的 `code/message/details`，但没有 HTTP 状态。

### 9.2 扩展映射

| 码 | HTTP | 场景 | 关键 details |
|---|---|---|---|
| `CAPABILITY_MISSING` | 503 | hard 能力区间无供给 | `capability/consumers` |
| `CAPABILITY_CONFLICT` | 503 | 多供给无合法覆盖或覆盖成环 | `capability/providers` |
| `CAPABILITY_IN_USE` | 409 | 停用供给者会断活跃 hard consumer | `provider/consumers` |
| `OVERRIDE_REJECTED` | 400 | 覆盖四守卫失败 | `override/reason` |
| `MIGRATION_FAILED` | 500 | 迁移失败，原数据保留、覆盖者禁用 | `capability/from/to/backup/journal` |
| `PLUGIN_DEGRADED` | 503 | 消费者因缺能力未装载/降级 | `plugin/missing` |
| `MODULE_DISABLED` | 409 | 工作台被作者主动停用 | `module` |

`MODULE_CORE` 已删除，不再是兼容错误码；宿主组合面被写入停用键时返回 `INVALID_ENTRY`（400）。

未识别错误码仍按现状落到 500，不伪装成客户端错误。错误信息不得包含密钥、正文全文或内部绝对路径堆栈。

---

## 10. 装载源与状态

### 10.1 装载源

当前只扫描仓内固定 `src/modules/<id>/`。来源记录包含 `source:"builtin"`、`sourceDir`、manifest SHA-256 与派生角色；固定内置目录声明 `builtin:false` 会被拒绝。当前 21 份清单为 7 kernel、12 workbench，以及无 class 的 `agentbar`／`library` 宿主组合面；七内核件已落盘，运行时调用 `loadModuleManifests(dir)`（无 stage 参数）。D4 已评估本机目录与第三方 suite：数据类 suite 从仓内授权货架装载且禁可执行代码；本机/第三方可执行模块的装载门 G1–G5 见 ADR 0003。

套件源映射（OS-192 统一入口 `loadSuiteCapabilityManifests()`）：`skills/<id>/SKILL.md`、`styles/<id>.json`、`genres/<id>.json`、`runtimes/<id>/manifest.json`、`suites/<id>/manifest.json`。单文件/单目录货架由域适配器投影成 module@2，不另加 manifest、不发明第二套语法。五类都进能力图（loaded/degraded/disabled）与 `/api/plugins` 启动报告；依赖闭包覆盖 `deps` 与 `appliesTo`。

### 10.2 源发现顺序

1. 底座只读随包固定路径，发现内置 storage。
2. storage 提供院子/货架/库清单解析；装载器再扫本机候选。
3. 收集全部候选后按 id 分组；显式覆盖才形成链，否则冲突。
4. 每次装载确定 source、dir、manifest 哈希与 snapshot，启动报告可追溯。

### 10.3 启停状态

按 §6.1；machine 级缺省不覆盖已有库内状态。插件设置值保留，停用只影响贡献与 supply。

---

## 11. 现行机制迁移索引

| 现行机制 | 协议归宿 | 迁移注意 |
|---|---|---|
| `openstory-module@1`＋`validateModuleManifest` | @2 schema＋class 矩阵（OS-192 单规则） | @1 直接拒收并给明确警告；迁移脚本与 npm 脚本已删除 |
| `core:true`／`MODULE_CORE` | 底座 hard requires＋`CAPABILITY_IN_USE` | core 不能一对一推断 kernel；B3 已删除模块级字段与错误码，页签级 core 仅表示顶栏可达 |
| `src/api/registry.mjs:HANDLERS/ENDPOINT_MODULES` 静态聚合 | manifest 贡献＋能力路由快照 | endpoint id/path 保持；切换必须重新校验 |
| S2.1 import 路径门禁 | 能力路由＋显式兼容转供叶＋函数体去重 | 只允许 re-export/绑定；复制实现仍拒绝，不一次性放宽 |
| S2.7／`tools/acceptance/moduleCoverage.mjs` | stage-C 归属＋能力图＋独立进程 activate/贡献校验 | 宿主白名单只保留带能力理由的宿主组合面 |
| `versionGate.mjs:minVersionGate` | `minOpenStoryVersion` 应用版本闸 | 与 capability major 分离；保留缺字段/坏格式 fail-open |
| `test/decoupleStep2.test.mjs` | storage/fact 内部能力金样 | 金样随能力走，不作 Pinax 互认 |
| skills/suites/runtimes/styles/genres 各自加载 | 统一 `loadSuiteCapabilityManifests()` 投影 | 不造第二份真源；本机覆盖必须显式报告 |
| suite `requires`＋`dependencyGraph` | suite `deps`＋`appliesTo` 闭包 | `deps` 进拓扑/SCC；`appliesTo` 进能力图硬依赖检查 |
| suite page 模式 `.html/.mjs/.js` | 已退役 | 无 `/suite-assets/`、无 suiteStateData 端点、无 legacy spec；漫剧占位套件已删 |
| `host-api@2` | 底座 `context.*` API 的迁移入口 | 破坏性删除/改签名才升 host-api 主版本；C6 另要求 base.* 五项句柄存在 |
| `.history` 50 份＋日锚＋最新保护 | `prose` 金样＋`base.write` 钩子 | 配额与删除留痕不变 |
| OS-172 `ensureLibraryUpgraded` | 旧库一次性升级机制继续独立 | 不被 capability migration 重跑或替代 |
| jobs/events 进程内 Map | `base.process` 服务 | 保持不落盘；业务执行器仍由插件提供 |
| naming 前端表＋后端 re-export | `base.naming` 只读投影 | 最终数据源归底座；迁移期不留双真源 |
| 现 `MODULE_DISABLED` | 工作台主动停用错误 | 保留 409 与数据不丢语义 |

---

## 12. OS-192：过渡脚手架退役（原 @1 → @2 升版规则已删）

装载器只认一套规则（原 stage C）：`validateModuleManifest(raw, { dirName })` 不再接受 stage 参数。
以下 B 批过渡面全部删除，不再有双读、推断或迁移入口：

- `LEGACY_MODULE_SPEC`、`migrateModuleManifest`、`BUILTIN_PENDING_CLASSES`、`TRANSITION_NOTICES`、`SPLIT_PENDING`
- `npm run modules:migrate` 与 `tools/migrate-module-manifests.mjs`
- stage B 的 "@2 字段选填 / incomplete 标记 / @1 自动推断 class / core 迁移报告"

`openstory-module@1` 形状的 manifest 直接拒收并给出明确警告；作者需手工改造为 `openstory-module@2`。
运行时只需要 class 必填矩阵（宿主组合面 `agentbar`/`library` 例外）、`core` 禁止、能力/贡献归属唯一。

五类货架不再各走各的 spec：`openstory-skill@1`／`openstory-genre@1`／`openstory-runtime-kit@1` 的事实由域适配器投影成 module@2 套件；
`openstory-suite@1/@2` 页面模式连同 `/suite-assets/` 与两个 state-data 端点一并退役。

---

## 13. 未来施工验收清单

B/C/D 批不得只改 manifest 字符串，至少覆盖：

- [x] 21 个内置 manifest 已升 @2（7 kernel／12 workbench／2 宿主组合面），生产装载只认一套规则。
- [x] OS-192：五类货架全部投影成 module@2 套件并进能力图；legacy 页面模式与过渡脚手架已退役。
- [x] 能力闭环、冲突、覆盖合法三检查有正反例；缺 hard 能力不拖死 daemon。
- [x] `CAPABILITY_IN_USE` 与 `PLUGIN_DEGRADED` 语义分开；`MODULE_DISABLED` 保持 409。
- [x] 覆盖显式声明、版本对齐、迁移责任、回退链四守卫已有候选图校验。
- [ ] 全量路由原子热切换；B5 仅验证按库解析与在途句柄持旧快照。
- [ ] 所有落盘能力有金样；换规则包有确定性金样。
- [x] suite 无可执行代码（D3 扫描）；legacy page 模式尚未被误标为新协议。
- [x] slot 注册表归底座（D4 `openstory-slots@1`）；未注册 slot 校验失败、编排稳定序有测试。
- [x] 正名/slug/目录/日志模块由命名投影一致；外部 endpoint/MCP 名未漂移。
- [x] 写管道、history、changelog、OS-172 升级 marker 未被绕过。
- [x] 测试只用临时夹具与临时 `LOCALAPPDATA`，不碰作者真库/真院子。
- [x] C6 架构统计、S2.1/S2.4'/S2.7 与数字锚工具已落地；审计指出的 src 边界债不由门禁豁免。

作者已要求按既有批次规划继续实施；B1–B5、C1–C6 与 D1–D4 已落地并通过全量测试、动态激活、能力边界与数字锚门禁；第三方可执行模块装载按 ADR 0003 暂不开放。
