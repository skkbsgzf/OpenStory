# OS-196a · 动态装载返工：三道门的真缺陷＋端点归属规则

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）·段内返工，接 OS-196（`4532448`，监督线判返工） |
| 对应 | OS-196 的身份门 G2、边界门 G3、切换门 G4；ADR 0003 §三 G3「运行期拒绝越出包目录的 import/require」 |
| 依赖 | OS-196 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md`、`README.md`、`package.json`（只在确需调整 `engines` 时改，并写明理由） |
| 风险 | **高**——开放的是往 daemon 进程里装载可执行代码；每一条返工都要有端到端守护测试 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 已经站得住、不要动坏的部分（监督线实测）

- 信任门：登记表在院子（机器级，不属于任何库）；预览只读；登记必须 `confirm: true`；未登记的根不扫描；本机同 id 覆盖内置；刷新端点；预览里的风险说明文案。
- 来源闸：外站 `Origin` → 403；伪造 `Host`（DNS 重绑定）→ 403；`text/plain` → 400；缺 `confirm` → 400。
- 失败门：坏 manifest / 越界 / 激活抛错的模块被跳过，其余照常；移除根后在途请求持旧句柄。

## 为什么返工（监督线在隔离 daemon 上端到端实证，脚本在 `D:\Pinax-e2e\.zcode\tmp\`：`probe-boundary.mjs`、`probe-196-e2e.mjs`、`probe-196-e2e-c.mjs`）

### 1. 边界门只是正则扫描，能被绕过

`src/protocol/localModuleBoundary.mjs` 用正则找 import。九个对抗样例里七个放行：

- 字符串里放 `/*`，后面的 import 被当注释吃掉（`withoutComments` 先于扫描）；
- `import { createRequire as mk } from 'node:module'` 之后 `mk(...)`；
- 标识符用 unicode 转义写 `eval`；`(0, eval)(...)`；`Function(...)` 不带 `new`；取 `AsyncFunction` 构造器；计算属性名取 `createRequire`。

端到端：用第一种写法的模块走真实「预览 → 登记」流程，预览 `ok`、装载 `loaded`，并且真的 import 到了仓库的内核登记表（模块写的标记文件里列出了全部内核入口）。

### 2. 切换门次序反了

两个合法工作台都声明 `stylesGet`：报告 `blocked: { gate: 'switch' }`、两个模块都标 `invalid/switch`，**但两个模块的 `activate()` 都已经跑过**（`src/host/moduleRuntime.mjs:189-235`：先逐个激活，之后才 `checkCandidate`）。另外，一个模块违规会连累同根其它本机模块一起被丢（`contributions` 整体清空）。

### 3. 身份门对依赖文件不生效

改 `helper.mjs`（入口不动）再刷新：报告 `contentChanged=true`、摘要变了、状态 `loaded`，而 `activate()` 看到的仍是旧版。原因：缓存失效的 `?v=<摘要>` 只加在入口 URL 上（`src/host/moduleLoader.mjs:103`），包内相对 import 的依赖仍走 Node 的模块缓存。JSON 数据依赖也没进内容摘要。

### 4. 本机模块能接管任意宿主自有端点，却没有自己的端点

一个 id 全新的模块在 manifest 里写 `endpoints: ['uiStatePut']` → 装载后 `PUT /api/ui-state` 返回的是它写的响应。`checkCandidate` 只在「另一个模块已占有该端点」时才拒，宿主自有端点谁都能认领。反过来，契约表是静态的，第三方模块没法注册自己的端点——OS-196 的「端点生效」测试是靠覆盖内置端点过的。

### 5. 本机模块的钩子贡献没接入

`hooksFor()` 只认内置模块的贡献。

## 任务

### 1. 边界门改成运行期强制

- 给「已登记模块根下的文件」装解析钩子（Node 的 `module.registerHooks()`，或等价手段）：任何从包内发出的 import / require，只许解析到 node 内置模块或**同一个包目录内**的真实路径（按 realpath 比，防符号链接指到包外）；其余在加载那一刻抛错。
- 静态扫描保留，降级为预览里的**提示**（哪一行可疑），不再作为边界门的唯一依据；上面七个绕法要能被点名。
- **文档如实**（AGENTS.md、ADR 0003、`docs/protocol/module-manifest-2.md`）：边界门挡的是越界耦合与误用，**不是沙箱**——登记的模块与本进程同权限，代码生成在进程内无法可靠禁止。
- 守护测试（daemon 级、端到端）：七个绕法逐个登记，期望「装载失败、点名边界门、当前层不变、模块的标记文件没被写」。

### 2. 先检查、后激活

- 三检查与端点归属检查先在 **manifest 层面**做（不跑代码就能判），淘汰违规模块；只激活过了检查的；激活后校验贡献；任何一步淘汰了模块就重做检查；全部通过才原子切换。
- 淘汰按模块算：违规的模块被跳过并点名，同根其它模块照常（除非它们硬依赖被淘汰者）。
- 守护测试：两个工作台抢同一端点 → 两者的 `activate()` 都没跑（标记文件不存在），报告点名谁因为什么被拒。

### 3. 整图缓存失效

- 在同一个解析钩子里，给包内每个 import 追加**逐文件**的内容摘要；JSON 数据依赖计入内容摘要。
- 运行中的 Node 不支持解析钩子时（`package.json` 的 `engines` 现为 `>=18`），如实报告「依赖文件已变，需重启 daemon 才生效」，不许显示成已加载新代码。若选择抬高 `engines`，在回报里写明理由与最低版本。
- 守护测试：改依赖文件后刷新拿到新值；改 JSON 依赖后同样。

### 4. 端点归属规则＋模块自带端点契约

- **归属规则**：本机模块只能 (a) 注册自己的新端点，或 (b) 按 id 覆盖某个内置模块时接管那个模块的端点。不许接管宿主自有端点，也不许接管别的模块的端点。
- **自带契约**：`activate()` 的贡献里可以带 `contracts: { <endpointId>: { method, path, request, response, errors } }`（形状语言沿用现有契约表），路径必须在 `/api/modules/<模块 id>/…` 之下；登记进当前层的契约表，分派、请求校验、错误信封与内置端点同一套；停用模块后 409。静态数字锚不统计运行期端点。
- 守护测试：第三方工作台注册一个自己的端点，真实请求打通并经过请求校验；声明 `uiStatePut` 的模块被拒且 `PUT /api/ui-state` 仍是宿主行为；按 id 覆盖内置模块时端点跟着换人。

### 5. 钩子贡献接入

`hooksFor()` 与 handler 用同一张贡献表，合并本机层。守护测试：本机工作台贡献一个 `promptContext` 钩子，宿主取得到；停用后消失。

## 不做

- 不改既有 103 个端点的 id、路径、请求/响应形状、错误码与 MCP 工具名；不改落盘格式；金样测试一个字不动。
- 不自动扫描任何目录；套件仍然只许数据。不碰作者真库与真实院子；不重启、不连接 8807。

## 验收

- 机器门禁全绿；红线测试 `test/localModules.test.mjs`、`test/handlerDispatch.test.mjs`、`test/moduleActivation.test.mjs`、`test/capabilityGraph.test.mjs`、`test/originGuard.test.mjs` 全绿。
- 监督线复跑自己的探针，四个场景必须翻转：注释吞 import 的模块装载失败且标记文件没被写；抢端点的两个模块标记文件都不存在；改依赖文件后拿到 `v2`；声明 `uiStatePut` 的模块被拒且宿主端点行为不变；`probe-boundary.mjs` 九例里八例「拒绝或装载失败」（合规那例放行）。
- 回报里贴：解析钩子的生产调用点（`文件:行`）、三检查前移后的调用顺序、端点归属规则的判定点、新增守护测试清单。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 832 · pass 830 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- 新增 `src/host/moduleBoundaryHooks.mjs`（运行期解析钩子）、`src/host/moduleContracts.mjs`（自带契约校验）、`src/host/runtimeContracts.mjs`（静态＋运行期契约合并）、`test/localModules196a.test.mjs`（8 个守护测试）
- 改 `src/host/moduleRuntime.mjs`、`src/host/moduleLoader.mjs`、`src/host/moduleRoots.mjs`、`src/host/handlerTable.mjs`、`src/host/daemon.mjs`、`src/api/contracts.mjs`、`src/protocol/localModuleBoundary.mjs`、`src/protocol/localModuleContract.mjs`、`src/protocol/moduleActivation.mjs`
- 改 `test/localModules.test.mjs`：4 个用例按新端点归属规则改用 `/api/modules/<id>/…` 自带端点（守卫意图不变）
- 改 `AGENTS.md`、`docs/adr/0003-dynamic-loading.md`、`docs/protocol/module-manifest-2.md`、`ARCHITECTURE.md`、`docs/number-anchors.json`、`package.json`（engines `>=18` → `>=22.15.0`）

VERIFIED:
- 钩子生产调用点：`src/host/moduleBoundaryHooks.mjs:99`（`registerHooks`）、`src/host/moduleLoader.mjs:106`（激活前安装）；钩子主体 `src/host/moduleBoundaryHooks.mjs:63`；根同步 `src/host/moduleRuntime.mjs:213`
- 三检查前移顺序：`moduleRuntime.mjs:253` 端点归属（manifest 层，不跑码）→ `:257` 底座/内置路由检查 → `:289` 仅激活合格模块 → `:317` 淘汰后重做归属 → `:324` 重做路由检查 → 原子切换；归属判定点 `src/host/moduleRuntime.mjs:124`（`checkEndpointOwnership`）
- 新增守护测试（`test/localModules196a.test.mjs`）：`:76` 七绕法静态点名、`:98` 八个绕法端到端、`:134` CJS require 运行期越界、`:157` 抢端点双方不跑 activate、`:183` 依赖+JSON 新值、`:209` 自带端点校验/停用 409、`:237` 拒接管 uiStatePut、`:261` 本机钩子接入与停用消失
- `npm test` 832 例 / 830 过 / 2 条件跳过 / 0 挂；`node .zcode/run-gate.mjs` 全绿
- `node tools/acceptance/acceptance.mjs`：28 过 / 0 挂 / 0 警
- `node tools/number-anchors.mjs --check`、`node tools/arch-stats.mjs --check`、`git diff --check`：通过
- 监督线探针复跑：`probe-boundary.mjs` 9 个非合规例全拒、合规例放行；`probe-196-e2e.mjs` 标记文件未写／双方 activate 未跑／依赖拿到 v2；`probe-196-e2e-c.mjs` 抢端点双方 invalid/switch、uiStatePut 被拒且宿主行为不变
- 未执行 git add/commit/push，未连接或重启 8807，未改 `core/pinax/**`

LIMITATIONS:
- `engines` 抬到 `>=22.15.0`，因为同步 `module.registerHooks()` 最低见于 Node 22.15.0/23.5.0；旧 Node 上钩子不可用，边界退化为静态提示，且如实报告「依赖文件已变，需重启 daemon 才生效」，不会显示成已加载新代码。
- 边界门按工单要求明确「不是沙箱」：登记的模块与 daemon 同进程同权限，`eval`/`Function` 直接访问 `process`、使用允许的 `node:fs` 等不在 import 解析钩子的管辖内；已写入 AGENTS/ADR/协议文档与预览风险说明。
- 本机模块按新归属规则不得认领宿主端点或他人端点；既有红线测试中依赖旧行为（新 id 模块声明 `stylesGet`/`genresGet`）的断言已同步改写为自带端点，未弱化原守卫目标。
```

## 验收记录（监督线，2026-11-25）

- 提交 `28ca775`；工作树干净；全量 832／830 过／2 条件跳过／0 挂；门禁 28／0／0；数字锚与架构统计一致；隔离 e2e 全绿；`app.js` 未增（10,108）。
- **监督线六场景验收仪器**（`D:\Pinax-e2e\.zcode\tmp\verify-196a.mjs`，隔离 daemon＋临时院子＋临时模块根，端到端），六个全部翻转：
  1. 注释吞 import 的模块 → `invalid / boundary`，标记文件未被写（上一版：装载成功并读到仓库内核登记表）。
  2. 两个工作台抢同一端点 → 两者 `activate()` 都没跑（上一版：都跑过）。
  3. 改依赖文件 `v1→v2` 后刷新 → `activate()` 看到 `v1→v2`（上一版：仍是 v1）。
  4. 全新模块声明 `uiStatePut` → `invalid / switch`，`PUT /api/ui-state` 仍是宿主行为（上一版：被接管）。
  5. 模块自带端点 `GET /api/modules/own-ep/hello` → 200 `{"marker":"from-local-module"}`（新增能力）。
  6. 本机模块贡献 `promptContext` 钩子 → 宿主 `hooksFor(root, name, env)` 取到 `HOOK_FROM_LOCAL`（上一版：未接入）。
- **静态扫描器九例对抗**：八种绕法全部点名拒绝（注释吞 import、`createRequire` 改名、unicode 转义 `eval`、`(0, eval)`、`Function` 不带 new、`getBuiltinModule`、`AsyncFunction`、`file://` 绝对 URL、计算属性名），合规那例放行。
- 实现要点核对：运行期解析钩子在 `src/host/moduleBoundaryHooks.mjs:99`（`module.registerHooks`），激活前安装（`src/host/moduleLoader.mjs:106`）；三检查前移（`moduleRuntime.mjs:253` manifest 层端点归属 → `:257` 底座/内置路由 → `:289` 只激活合格模块 → `:317`/`:324` 淘汰后重做 → 原子切换）；端点归属判定 `moduleRuntime.mjs:124`。
- `package.json` 的 `engines` 抬到 `>=22.15.0`（`module.registerHooks` 需要），ADR 0003、AGENTS.md 已写明；CI 用 Node 24，不受影响。ADR 0003 与 AGENTS 同时写明「边界门不是沙箱」。
- 新增守护测试 `test/localModules196a.test.mjs` 8 例（七绕法静态点名、八个绕法端到端、CJS `require` 越界、抢端点双方不跑 activate、依赖与 JSON 新值、自带端点校验与停用 409、拒接管 `uiStatePut`、本机钩子接入与停用消失）。
- 结论：**已验收**。动态装载五道门（信任／身份／边界／切换／失败）至此真正成立。
