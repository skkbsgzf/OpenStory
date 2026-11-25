# ADR 0003 · D4 动态装载评估与 slot 扩展

**状态：评估已裁定。本批不开放第三方可执行代码装载；slot 注册表归底座并留有扩展程序。**

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
| 第三方 kernel/workbench 动态装载 | **不开放**，理由与开门条件见 §三 | 本 ADR |

slot 扩展程序：新增 slot＝在本表登记（id/label/description/scope）＋同步前端编排＋补
`test/slots.test.mjs` 的注册表断言与门禁；**不提供运行时自注册入口**，第三方包不能自造 slot。
底座初始保留位仍是 `tab/right/sidebar/host-actions/settings`。

## 二、现状盘点（代码事实）

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

## 三、裁定：本批不开放动态装载

理由（缺一不可的开门条件，均未满足）：

- **G1 信任门缺失**：没有「本机模块目录」的作者显式授权与路径 allowlist；自动扫描任意目录等于远程代码执行面。
- **G2 身份门缺失**：快照 id 与激活缓存不含入口文件/传递依赖摘要（§二·2、3），同版本改代码会静默复用旧实现。
- **G3 边界门缺失**：`entry` 只看路径不出包目录，未限制其 import 范围；S2.1/S2.4' 是仓内静态扫，覆盖不到运行期加载。
- **G4 切换门缺失**：没有「重建→三检查→原子切换」的进程内切换器；当前只有按库代理，端点归属与 slot 编排未随快照回收。
- **G5 回退门未联调**：覆盖回退（D1）与迁移安全阀（D2）已在候选图与迁移器层面打通，但未与本机包安装/卸载流程联调。

已具备、可作为开门地基的部分：manifest@2 校验矩阵、能力三检查、覆盖四守卫、迁移 journal／失败安全阀、
套件无代码扫描、`base.loader.activate` 的路径闸与贡献校验、在途句柄持旧快照。

**结论**：D 批的「生态的门打开」限定在**数据类套件**（规则/技能/文风/体裁），
kernel/workbench 的可执行代码只来自仓内受审源码。第三方可执行装载留到后续批次，按 G1–G5 逐门验收。

**OS-196／OS-196a 更新**：后续批次已在机器级信任表（G1）之上开放本机可执行模块。
边界门的真实形态在 OS-196a 返工后明确为：
- **运行期强制**：`src/host/moduleBoundaryHooks.mjs` 用 `module.registerHooks({ resolve })` 拦住包内
  发出的 import/require，只许解析到 `node:` 内置或同包 realpath 路径；`data:` URL 也不放行（会绕开
  parentURL 归属）。静态扫描（`src/protocol/localModuleBoundary.mjs`）保留为预览提示，能点名七类绕法，
  但**不再是唯一依据**。
- **不是沙箱**：登记的模块与 daemon 同进程同权限。本门挡的是越界耦合与误用——不是代码执行：
  `eval`/`Function` 直接摸 `process`、用允许的 `node:fs` 读盘、在进程里生成新代码，都无法被 import 解析钩子
  可靠禁止。风险说明必须在预览里原样呈现，不能把边界门说成安全隔离。
- **整图身份**：逐文件内容摘要（含 JSON 数据依赖）在解析钩子中追加到包内 import 的 URL，
  改依赖文件后刷新即拿到新代码；`engines` 因此抬到 `>=22.15.0`，旧 Node 如实报「需重启 daemon」。

## 四、开门验收（后续批次执行）

1. 安装源：仅接受用户显式选定的本机模块根；库内登记该根与包摘要，未登记不扫描。
2. 身份：快照 id 纳入 `manifestSha256`＋入口与传递依赖摘要；激活缓存以摘要为键。
3. 边界：运行期拒绝越出包目录的 import/`require`（OS-196a 用同步解析钩子按 realpath 强制，静态扫描只作提示）；
   能力与端点/slot 只能来自 manifest 声明；**本门不是沙箱**，同进程代码的其它行为不在管辖内。
4. 切换：候选快照三检查通过后整体切换；在途句柄继续持旧快照，旧快照保留到句柄释放。
5. 失败：任一门失败＝当前快照不动、坏包跳过并记 warning，`GET /api/plugins` 如实报告；绝不半装载。
6. 回退：覆盖者卸载/停用走 D1 回退链；改落盘格式必须带 D2 迁移器并通过失败安全阀。
7. runtime 套件：命令执行另设作者信任、命令白名单与可执行文件指纹，不随本次动态装载一并开放。

## 五、遗留

- 全局热切换与端点动态注册仍未实施（§13 清单未勾项不变）。
- 本机模块目录的 UI/设置入口未设计；在 G1 落地前不摆「安装模块」按钮。
- 数字锚已于 D 批收口回写：812 例（810 过／2 条件跳过／0 挂）、102 个测试文件、门禁 27 项、端点 105、`app.js` 10,338 行；机器真源见 `docs/number-anchors.json`。