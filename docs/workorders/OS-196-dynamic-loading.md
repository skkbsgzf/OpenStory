# OS-196 · 动态装载开放：本机可执行模块（信任门、身份门、边界门、切换门、失败门）

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 9 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | 规划 §1.6「第三方生态的门打开」、§2.8 装载源、§2.4 覆盖优先级；ADR 0003 §三 G1–G4、§四 开门验收 1–5 |
| 依赖 | OS-195 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`docs/number-anchors.json`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`docs/protocol/module-manifest-2.md`、`docs/workorders/OS-196-dynamic-loading.md` |
| 风险 | **高**——开放的是「往 daemon 进程里装载可执行代码」；每一道门都要有守护测试 |
| 状态 | 已实施（2026-11-25；机器门禁 28/0/0，全量单测 824／822 过／0 挂／2 条件跳过；七条守护测试全绿） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

作者规划里 D 批的终点——「D 批动态装载后三类全开放」——落到实处：内核件与工作台可以来自作者登记的本机模块根；套件照旧只许数据。按 ADR 0003 §四逐门验收，一门不缺。

## 信任模型（写进 AGENTS.md 与设置页）

**可执行模块与 daemon 同进程、同权限。登记一个模块根，等于信任这个根目录下所有模块的代码。** 所以登记入口必须有清单预览与明确确认，不提供「扫描任意目录」的捷径。

## 任务

### 1. 信任门（G1）——安装源

- 只接受作者显式登记的本机模块根；未登记的根不扫描。登记表落在本机院子 `%LOCALAPPDATA%/OpenStory/openstory/module-roots.json`（机器级，不属于任何一个库）：根路径、登记时间、登记时每个模块的内容摘要。
- 设置页新增「本机模块」区：已登记的根（路径、模块数、登记时间、每个模块的状态）；「添加模块根…」走内建目录浏览器（不依赖桌面权限）；选中后先出**预览清单**（每个模块的名称、版本、类别、供给与依赖、内容摘要）与一句风险说明，作者点确认才生效；可移除某个根（回到内置层）。`public/app.js` 只许减不许增，新界面进 `public/views/`。
- 内置 `src/modules/` 永远是内置层；本机层同 id 覆盖内置层，并在 `/api/plugins` 里显式列出。

### 2. 身份门（G2）

- 快照 id 纳入每份 manifest 的 `manifestSha256` 与「入口文件＋传递依赖」的内容摘要；激活缓存以摘要为键。同版本改代码＝新快照，不再命中旧激活结果（ADR 0003 §二·2、3 的两个缺陷）。
- `/api/plugins` 报告每个模块的摘要；与登记时不一致的标「内容已变」。

### 3. 边界门（G3）

装载前静态扫描模块的 import 图（入口＋包内传递依赖）：

- 本机模块只许 import **node 内置模块**与**自己包内的相对路径**；不许 import 仓库里的任何文件、不许裸包名（零依赖仓没有第三方包可解析）、不许非字面量参数的动态 `import()`、不许 `createRequire`／`eval`／`new Function`。
- 本机模块与宿主的全部交互走 `activate(context)`：`context.manifest`、`context.resolve(id, range)`、`context.base`（写管道、错误信封、命名表、进程服务——即五件底座能力的只读句柄）。
- 内置模块沿 OS-193～195 的口径（只经 `context.resolve`，另可直接 import `src/protocol/` 的底座契约与 `src/host/baseCapabilities.mjs`）。
- 贡献（能力、端点、页面、slot）必须来自 manifest 声明（OS-194 的校验已覆盖端点；页面与 slot 同样校验）。
- 任何一条越界即拒装。

### 4. 切换门（G4）

候选快照 → 能力图三检查 → 原子切换。新请求用新快照；在途请求持旧句柄到底；端点与 slot 的归属随快照回收。登记、移除模块根、启停模块都走这一条路，不允许未校验的替换。

### 5. 失败门

任一门失败＝当前快照不动、坏模块跳过并记 warning；`/api/plugins` 如实报告是哪一门、什么原因；绝不半装载（同包内其它模块若依赖它，按能力图的断链报告降级）。

## 测试（全部用临时模块根＋临时 `LOCALAPPDATA`，daemon 级）

1. 未登记的根里有模块：不扫描、不装载、报告里不出现。
2. 登记＋确认：模块装载，它声明的端点与 slot 在真实请求路径上生效（请求打进去验证）。
3. 改模块代码不升版本：摘要变、快照变、新代码生效（旧激活结果不被复用）。
4. import 越出包目录（`../../src/…`、裸包名、非字面量动态 import 各一例）：拒装，当前快照不变，报告点名边界门。
5. 坏 manifest／声明了却没供给的能力：跳过并报告，其余模块照常。
6. 移除模块根：回到内置层，在途请求不崩。
7. 本机同 id 覆盖内置：路由指向本机层，报告显式列出。

## 不做

- 不开放套件携带可执行内容（套件仍是纯数据）；不自动扫描任何目录。
- 不改既有对外契约；不碰作者真实院子与真库（测试全用临时目录）。
- 迁移器的生产接线与回退门（G5）是下一张 OS-197。

## 验收

- 机器门禁全绿；上面七条守护测试全绿并贴输出。
- 生产调用点贴出来（`文件:行`）：信任表读写、摘要计算、import 图扫描、候选快照切换。
- `AGENTS.md` 新增「本机模块」一节（信任模型与四道门）；`docs/protocol/module-manifest-2.md` 补「本机模块的 import 边界与 context」。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。

## 施工回报（CodeBuddy CLI，2026-11-25）

```text
CHANGED:
- 协议纯函数：src/protocol/localModuleContract.mjs（信任表形状／manifest+内容摘要）、src/protocol/localModuleBoundary.mjs（import 图静态扫描）；src/protocol/README.md 登记两文件。
- 底座 I/O 与运行时：src/host/moduleRoots.mjs（机器级信任表读写、预览、发现）、src/host/moduleRuntime.mjs（候选快照／三检查／原子切换／报告）、src/host/moduleLoader.mjs（摘要入缓存键、本机入口摘要破缓存、context.base）、src/host/handlerTable.mjs、src/host/capabilityBindings.mjs、src/host/daemon.mjs 接入当前层。
- 身份入图：src/protocol/capabilityGraph.mjs（摘要进 snapshot.id 与 moduleDigests）、src/protocol/modules.mjs（内置源入图）、src/protocol/moduleActivation.mjs（页面与 slot 贡献白名单）。
- 端点：src/api/contracts/plugins.mjs ＋ src/api/handlers/plugins.mjs 新增五个机器级端点（读/预览/确认登记/移除/刷新）；tools/acceptance/moduleCoverage.mjs 登记宿主白名单理由。
- 前端：public/views/settingsViews.mjs 新增「本机模块」区（浏览预览确认移除刷新）；public/app.js 仅在既有装配行上接线（物理行数不增）。
- 文档与门禁：AGENTS.md（本机模块节＋落盘表）、README.md（本机模块节）、docs/protocol/module-manifest-2.md §8.5、ARCHITECTURE.md（生成段回写）、docs/number-anchors.json、test/apiRegistry.test.mjs、test/moduleCoverage.test.mjs、test/capabilityResolver.test.mjs、test/localModules.test.mjs（新增七条守护测试）。

VERIFIED:
- `npm test`：824 例 / 822 过 / 0 挂 / 2 条件跳过；`node --test test/localModules.test.mjs`：7/7 过。
- `node tools/acceptance/acceptance.mjs`：28 过 / 0 挂 / 0 警；`node tools/number-anchors.mjs --check`、`node tools/arch-stats.mjs --check` 一致。
- 七条守护测试逐条覆盖：未登记不扫描；确认前端点不生效、确认后端点+slot 真生效；同版本改代码摘要/快照/代码全变；三类越界 import 拒装且快照不动；坏 manifest/未供给能力跳过而同包其它模块照常；移除后在途请求持旧句柄；本机同 id 覆盖内置且报告列出。
- 生产调用点：信任表读写 `src/host/moduleRoots.mjs:27` / `:47`；摘要计算 `src/protocol/localModuleContract.mjs:20` / `:28`；import 图扫描生产调用 `src/host/moduleRoots.mjs:148`（纯函数 `src/protocol/localModuleBoundary.mjs:49`）；候选快照三检查 `src/host/moduleRuntime.mjs:117`、原子切换 `src/host/moduleRuntime.mjs:323`（重建入口 `:318`）；端点分派 `src/host/daemon.mjs:396` → `src/host/handlerTable.mjs:50`。
- 未启动/杀死 8807 daemon；未执行任何 git 命令；所有夹具用临时 LOCALAPPDATA 与临时模块根。

LIMITATIONS:
- 用户明令「不执行任何 git 命令」，因此没有跑 `git diff --check`；已用非 git 脚本扫过改动文件的行尾空白。
- 新增五个对外端点（机器级模块根治理，既有 103 个端点的 id/路径/形状/错误码一字未改）；锚点随之 103→108、测试 817→824。第三步「迁移器生产接线与回退门（G5）」按工单「不做」留给 OS-197。
- 设置页的交互接线在 settingsViews 内用事件委托完成；没有浏览器端的自动化截图验证（本单验收面是 daemon 级七条守护测试）。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 824 · pass 822 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- 新建 `src/protocol/localModuleContract.mjs`、`src/protocol/localModuleBoundary.mjs`
- 新建 `src/host/moduleRoots.mjs`、`src/host/moduleRuntime.mjs`
- 改 `src/protocol/README.md`、`src/protocol/capabilityGraph.mjs`、`src/protocol/modules.mjs`、`src/protocol/moduleActivation.mjs`
- 改 `src/host/moduleLoader.mjs`、`src/host/capabilityBindings.mjs`、`src/host/handlerTable.mjs`、`src/host/daemon.mjs`
- 改 `src/api/contracts/plugins.mjs`、`src/api/handlers/plugins.mjs`
- 改 `tools/acceptance/moduleCoverage.mjs`
- 新建 `test/localModules.test.mjs`；改 `test/apiRegistry.test.mjs`、`test/moduleCoverage.test.mjs`
- 改 `public/views/settingsViews.mjs`、`public/app.js`（仅同线接线，行数未增）
- 改 `AGENTS.md`、`README.md`、`ARCHITECTURE.md`、`docs/number-anchors.json`、`docs/protocol/module-manifest-2.md`、`docs/workorders/OS-196-dynamic-loading.md`

VERIFIED:
- `node --test test/localModules.test.mjs`：7/7 过（未登记不扫描／确认前端点不生效+后端点+slot 生效／同版本改码摘要与快照变／三类越界 import 拒装且快照不动／坏模块跳过其余照常／移除后在途请求持旧句柄／本机同 id 覆盖内置）。
- `npm test`：824 例／822 过／0 挂／2 条件跳过。
- `node tools/acceptance/acceptance.mjs`：28 过／0 挂／0 警。
- `node tools/number-anchors.mjs --check`：824 例／门禁 28／端点 108／app.js 10108≤10500 行；`node tools/arch-stats.mjs --check`：一致。
- 生产调用点：信任表读写 `src/host/moduleRoots.mjs:27`/`:47`；摘要 `src/protocol/localModuleContract.mjs:20`/`:28`；import 图扫描生产调用 `src/host/moduleRoots.mjs:148`（纯函数 `src/protocol/localModuleBoundary.mjs:49`）；三检查 `src/host/moduleRuntime.mjs:117`、原子切换 `src/host/moduleRuntime.mjs:323`（重建入口 `:318`）；分派 `src/host/daemon.mjs:396` → `src/host/handlerTable.mjs:50`。
- 未启动/杀死 8807 daemon；未执行任何 git 命令；夹具全为临时目录。

LIMITATIONS:
- 因「不执行任何 git 命令」约束，未跑 `git diff --check`；已用非 git 脚本扫改动文件行尾空白（唯一命中是 `public/app.js:7527` 的既有行，非本次改动）。
- 新增 5 个机器级端点（既有 103 个端点 id/路径/形状/错误码未变），数字锚随之 103→108、测试 817→824。
- 本机模块的 `hooks` 贡献未接入宿主 `hooksFor`（工单未要求、OS-198 slot 接线后续处理）；无浏览器端自动化截图验证。
- 迁移器生产接线与回退门 G5 按工单「不做」留 OS-197。
```
