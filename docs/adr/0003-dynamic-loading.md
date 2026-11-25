# ADR 0003 · D4 动态装载评估与 slot 扩展

**状态：已开放（OS-196 开放本机模块，OS-196a 返工收口）。第三方可执行代码仍只来自作者显式登记的本机模块根；边界门不是沙箱。slot 注册表归底座，OS-198 已把投影接到前端。**

- 对应规划：[第三批规划](../plan/batch3-microkernel-plan.md) D4（OS-188）
- 上位裁定：[ADR 0002 · 底座宪法](0002-base-constitution.md) §D4／§八
- 配套协议：[module-manifest@2](../protocol/module-manifest-2.md) §4.4、§5.5、§12.4

---

## 一、本单做了什么

| 项 | 结果 | 落点 |
|---|---|---|
| slot 注册表归底座 | 完成：`openstory-slots@1` 单一真源，插件只能引用 | `src/protocol/slots.mjs` |
| slot 编排投影 | 完成：装载序＋page id 稳定排序，停用不出 | `slotPlacements()`（同上） |
| 只读投影进底座词表 | 完成：`base.naming` 增加 `SLOT_REGISTRY/isRegisteredSlot/slotEntry` | `src/host/baseCapabilities.mjs` |
| 套件无代码扫描 | 完成（D3）：`.mjs/.cjs/.js/.wasm/.sh/.ps1/.bat/.cmd` 与含 `<script>` 的 HTML 一律拒收 | `src/services/suites.mjs` `findExecutableInSuite()` |
| 在途句柄持旧快照 | 完成（B5 已验）：重建快照不回收旧句柄 | `test/capabilityResolver.test.mjs` |
| 第三方 kernel/workbench 动态装载 | **已开放（OS-196／196a）**，仅限作者登记的本机模块根；不是沙箱 | 本 ADR §三 |

slot 扩展程序：新增 slot＝在本表登记（id/label/description/scope）＋同步前端编排＋补
`test/slots.test.mjs` 的注册表断言与门禁；**不提供运行时自注册入口**，第三方包不能自造 slot。
底座初始保留位仍是 `tab/right/sidebar/host-actions/settings`；OS-198 起 `/api/plugins.slots` 按库投影，
前端不再持有页签名单。第三方工作台页面用 `pages[].kind:'iframe'`＋`entry`，经 `/module-page/<id>/<entry>` 只对已登记且装载成功的本机模块提供。

## 二、开盘前现状盘点（历史，OS-196 前）

> 以下六条是 D4 评估时的代码事实，用于说明当时为何不开放；OS-196／196a 已逐条改变，现状见 §三证据。

1. **清单来源是静态的**：`MODULE_MANIFESTS` 只从仓内 `src/modules/` 读取（`src/protocol/modules.mjs:585`），
   本机目录尚未进入装载源。`MODULE_SOURCES` 已记录每份清单的 `manifestSha256`，但未参与快照身份。
2. **快照身份不含代码内容**：`snapshotId()` 只哈希 `id/version/enabled`＋路由＋surface＋issues
   （`src/protocol/capabilityGraph.mjs:52`）。同版本改入口文件，快照 id 不变。
3. **激活缓存按声明键**：`moduleLoader` 的缓存键是 `[snapshot.id, modulesDir, [id, version, entry]]`
   （`src/host/moduleLoader.mjs:39`）；同版本改代码会命中旧激活结果。这是当前内置装载可接受的
   「版本即契约」，但对本机/第三方包是错误前提。
4. **实现表静态导入**：`IMPLEMENTATIONS = { base, ...MODULE_IMPLEMENTATIONS }`（`src/host/capabilityBindings.mjs:6`），
   能力实现来自仓内 import；真实 `activate` 贡献只做形状校验（`src/protocol/moduleActivation.mjs`），
   尚未接管端点/页面注册。
5. **套件已是无代码数据包**：D3 后 `openstory-module@2 class:suite` 禁带可执行入口，
   安装源只做 entries 越界与存在性校验；能力图按 `appliesTo` 判活跃。
6. **切换语义是「按库薄代理」**：每库解析一次快照，句柄冻结实现与快照 id；没有全局热切换。

## 三、G1–G5 逐门验收（OS-196／196a）

D4 当时五门均未满足，故不开放；清账批逐门补齐后开放。证据均为 daemon 级真实请求路径测试（`test/localModules.test.mjs`）：

- **G1 信任门**：机器级信任表 `%LOCALAPPDATA%/OpenStory/openstory/module-roots.json`；`src/host/moduleRoots.mjs` 只枚举登记根，设置页必须先预览后 `confirm:true`。证据：`G1-1 未登记的根里有模块：不扫描、不装载、报告里不出现`、`G1-2 登记＋确认：端点与 slot 在真实请求上生效；无确认不生效`。
- **G2 身份门**：`manifestSha256`＋入口与包内传递依赖（含 JSON）的 `contentSha256` 进快照 id 与激活缓存键；`src/host/moduleBoundaryHooks.mjs` 给包内每个 import 追加逐文件摘要。证据：`G2-3 同版本改代码：摘要变、快照变、新代码生效（旧激活结果不复用）`。
- **G3 边界门**：运行期 `module.registerHooks({ resolve })` 强制包内 import/require 只解析到 `node:` 内置或同包 realpath；静态扫描 `src/protocol/localModuleBoundary.mjs` 降级为预览提示。证据：`G3-4 三类越界 import 全部拒装：当前快照不动，报告点名边界门`；Node 无解析钩子时 `boundaryHooksStatus()` 如实报「需重启 daemon」，不冒充新代码。
- **G4 切换门**：`src/host/moduleRuntime.mjs:buildLayer` 做 manifest 层端点归属＋三检查 → 淘汰违规模块 → 只激活合格者 → 校验贡献 → 重做检查 → 一次同步赋值；在途请求持旧句柄到底。证据：`G4-6 移除模块根：回到内置层，在途请求持旧句柄到底`、`G4-7 本机同 id 覆盖内置：路由指向本机层，报告显式列出`。
- **G5 失败门**：任一门失败＝当前快照不动、坏模块跳过、warning 进报告；`/api/plugins` 与 `/api/module-roots` 如实报 `gate` 与原因。证据：`G5-5 坏 manifest／声明却没供给的能力：跳过并报告，其余模块照常`。

**结论**：本机可执行模块已开放，但**只来自作者显式登记的本机模块根**；边界门挡越界耦合与误用，**不是沙箱**（同进程代码可直接摸 `process`、`node:fs`）。数据类套件（规则/技能/文风/体裁）继续无代码。

**OS-196／OS-196a 边界形态**：
- **运行期强制**：`src/host/moduleBoundaryHooks.mjs` 用 `module.registerHooks({ resolve })` 拦住包内
  发出的 import/require，只许解析到 `node:` 内置或同包 realpath 路径；`data:` URL 也不放行（会绕开
  parentURL 归属）。静态扫描（`src/protocol/localModuleBoundary.mjs`）保留为预览提示，能点名七类绕法，
  但**不再是唯一依据**。
- **不是沙箱**：登记的模块与 daemon 同进程同权限。本门挡的是越界耦合与误用——不是代码执行：
  `eval`/`Function` 直接摸 `process`、用允许的 `node:fs` 读盘、在进程里生成新代码，都无法被 import 解析钩子
  可靠禁止。风险说明必须在预览里原样呈现，不能把边界门说成安全隔离。
- **整图身份**：逐文件内容摘要（含 JSON 数据依赖）在解析钩子中追加到包内 import 的 URL，
  改依赖文件后刷新即拿到新代码；`engines` 因此抬到 `>=22.15.0`，旧 Node 如实报「需重启 daemon」。

## 四、开门验收（已由 OS-196／196a 执行）

1. 安装源：仅接受用户显式选定的本机模块根；库内登记该根与包摘要，未登记不扫描。
2. 身份：快照 id 纳入 `manifestSha256`＋入口与传递依赖摘要；激活缓存以摘要为键。
3. 边界：运行期拒绝越出包目录的 import/`require`（OS-196a 用同步解析钩子按 realpath 强制，静态扫描只作提示）；
   能力与端点/slot 只能来自 manifest 声明；**本门不是沙箱**，同进程代码的其它行为不在管辖内。
4. 切换：候选快照三检查通过后整体切换；在途句柄继续持旧快照，旧快照保留到句柄释放。
5. 失败：任一门失败＝当前快照不动、坏包跳过并记 warning，`GET /api/plugins` 如实报告；绝不半装载。
6. 回退：覆盖者卸载/停用走 D1 回退链；改落盘格式必须带 D2 迁移器并通过失败安全阀。
7. runtime 套件：命令执行另设作者信任、命令白名单与可执行文件指纹，不随本次动态装载一并开放。

## 五、遗留与边界

- 全局热切换已由 OS-196a 的候选层＋一次同步赋值实现；端点动态注册由 `activate()` 的 `contracts` 贡献接管，随层回收。当前仍不提供「运行时自注册端点」旁路，也不提供第三方 slot 自注册。
- 本机模块目录的设置入口已落地（「插件中心 → 本机模块」：预览、确认、移除、刷新）；未登记根不出现「安装模块」按钮。
- 本机模块不是沙箱：登记即信任同进程代码。预览必须原样显示风险说明，不得宣称安全隔离。
- runtime 套件的第三方命令执行仍未开放；需要另设作者信任、命令白名单与可执行文件指纹。
- 数字锚以 `docs/number-anchors.json` 与 `ARCHITECTURE.md` 生成段为准；本文不手写测试数／端点数／行数。