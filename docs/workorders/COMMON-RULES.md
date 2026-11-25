# 工单通用规则（第三批起，所有工单共用）

> 每张工单只写**本单专属**的内容；纪律、门禁、交付格式一律以本文为准，工单里不再重复。
> 体系全貌见 [`docs/plan/workorder-system-20261124.md`](../plan/workorder-system-20261124.md)，实时状态见 [`BOARD.md`](BOARD.md)。

## 1. 派发

```bash
cd D:/OpenStory
node .zcode/os-batch-runner.mjs --plan <plan.json> --status <status.json> --model hy4flash --rounds 2
```

- `plan.json` 每批一项：`{ id, title, ticket, allow, mustPass }`。
- **`allow` 是硬约束**（越界＝返工）；迁移类、动门禁的单必须带 `tools/**`；`mustPass` 列红线测试。
- **`allow` 必须覆盖收尾脚本的写入面**：改了源码行数就要有 `ARCHITECTURE.md` 与 `docs/number-anchors.json`（`arch:stats`／数字锚要回写）；改了页面 id 或命名就要有 `test/**`（引用旧 id 的模块测试会跟着改）。漏了这两处，施工方只能把文档还原、门禁必红——OS-191 与 OS-190a 都因此停过线。
- 编排器内置的闸：开工前查工作树干净与全量测试基线绿；**e2e 一律走隔离脚本（`tools/verify/verify-os172-e2e.mjs` 自己起临时 daemon），编排器不重启也不连接 8807**；provider 限流或空结果直接停线；只改了工单归档不算实质改动。

## 2. 通用纪律

1. **既有测试只许新增或等价加强**，不许删除、skip、放宽断言（工单点名的除外，逐处说明）。
2. 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地；补丁写成脚本文件或用编辑工具，不用 bash 内联 JS 模板串。
3. 不执行 git 写操作（提交由编排器做）；不动 `.zcode/`；临时探针用完必删。**8807 上的常驻 daemon 是作者在用的旧进程：不重启、不杀、不连接**——新版里「首次打开即升级真库」，碰它等于替作者升级真库。要验证端到端，跑隔离脚本。
4. 零 npm 依赖、零构建；`package.json` 只许在工单明确允许时改 `scripts`。
5. 测试一律用**临时夹具库**。**绝不碰 `D:/Projects/**`（作者真库）、真实的 `%LOCALAPPDATA%\OpenStory\` 与 `%LOCALAPPDATA%\PinaxNext\`**——一律用临时 `LOCALAPPDATA` 注入。
6. **测试不许依赖本机环境**：不硬编码本机绝对路径、不依赖本机装了什么软件、不依赖真实下载物；环境不齐就显式 skip 并注明守卫理由。
7. `public/app.js` 只许减不许增（行数上限锚在 `docs/number-anchors.json`，只许下调）；渲染函数一律进 `public/views/`。
8. **收尾必做**：`npm run arch:stats` 回写文档，再跑 `node tools/number-anchors.mjs`（否则验收门禁 S0.2 与数字锚会红）。
9. 遇到门禁不可能通过、或规格互相矛盾——停下来如实上报，不要绕过去。**不许为了让门禁变绿去删断言、加白名单或扩大豁免**；确需调整门禁口径的，在工单里写明理由并经监督线同意。
10. **三名一致**（作者裁定）：每个插件的前端显示名称、插件本体的命名、本地文件的命名完全统一。新增或改名任何面向用户的东西，先改命名表（`public/views/registry.mjs`）；显示名 ＝ 库内目录名 ＝ 修改日志模块名，一个正名只许一个 slug，**不许另起名**。
11. **「已实现」的口径**（作者裁定：不接受妥协）：新机制必须有生产调用方、在真实请求路径上生效——只有测试或门禁在调的不算实现。交付时在 VERIFIED 里贴出调用点（`文件:行`）。做不到就如实写进 LIMITATIONS，不许用「框架就位」「后续接线」交差。
12. **自验如实**：VERIFIED 只写自己实际跑过的命令与输出；没跑的不许写成通过。施工回报不写「已验收」——验收归监督线。
13. **与 Pinax 的边界**：旧名（`.pinax`、`参考/拆解/推演` 旧目录、`pinax-*` 谱系名）只许出现在 `src/protocol/libraryUpgrade.mjs`（一次性升级，作者旧库的出口）与出处注释里；其余产品代码不许出现 `pinax`（谱系名门禁把关）。出处声明（「内核最初出自 Pinax-next」）是出处，不是关联，不许删。

## 3. 门禁（全绿才算过）

全量测试（`npm test`）· 验收门禁（`node tools/acceptance/acceptance.mjs`，现有 27 项，只增不减）· 数字锚（`node tools/number-anchors.mjs --check`）· 架构统计（`node tools/arch-stats.mjs --check`）· 隔离 e2e（`node tools/verify/verify-os172-e2e.mjs`：水浒 10 项＋新建 13 项）。

## 4. 交付格式

```
CHANGED: 逐个列出改/新建的文件路径
VERIFIED: 实际跑了什么命令、结果如何（验收项要求「反证」的，把实验输出贴在这里；新机制的调用点写 文件:行）
LIMITATIONS: 没做到或不确定的地方（没有就写「无」）
```
