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
- 编排器内置的闸：开工前查工作树干净与全量测试基线绿；改了后端先重启 daemon 再跑 e2e；provider 限流或空结果直接停线；只改了工单归档不算实质改动。

## 2. 通用纪律

1. **既有测试只许新增或等价加强**，不许删除、skip、放宽断言（工单点名的除外，逐处说明）。
2. 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地；补丁写成脚本文件或用编辑工具，不用 bash 内联 JS 模板串。
3. 不执行 git 写操作（提交由编排器做）；不启动、不杀 daemon（编排器会按需重启）；不动 `.zcode/`；临时探针用完必删。
4. 零 npm 依赖、零构建；`package.json` 只许在工单明确允许时改 `scripts`。
5. 测试一律用**临时夹具库**。**绝不碰 `D:/Projects/**`（作者真库）、真实的 `%LOCALAPPDATA%\OpenStory\` 与 `%LOCALAPPDATA%\PinaxNext\`**——一律用临时 `LOCALAPPDATA` 注入。
6. **测试不许依赖本机环境**：不硬编码本机绝对路径、不依赖本机装了什么软件、不依赖真实下载物；环境不齐就显式 skip 并注明守卫理由。
7. `public/app.js` 只许减不许增；渲染函数一律进 `public/views/`。
8. **收尾必做**：`npm run arch:stats` 回写文档（否则验收门禁 S0.2 红）。
9. 遇到门禁不可能通过、或规格互相矛盾——停下来如实上报，不要绕过去。
10. **三名一致**（作者裁定）：每个插件的前端显示名称、插件本体的命名、本地文件的命名完全统一。新增或改名任何面向用户的东西，先改命名表（`public/views/registry.mjs`）；显示名 ＝ 库内目录名 ＝ 修改日志模块名，一个正名只许一个 slug，**不许另起名**。

## 3. 门禁（全绿才算过）

全量测试（`npm test`）· 验收门禁（`node tools/acceptance/acceptance.mjs`，现有 23 项，只增不减）· 水浒 10 项 · 新建 13 项。
（vendor 漂移一道已随 vendor 退役取消。）

## 4. 交付格式

```
CHANGED: 逐个列出改/新建的文件路径
VERIFIED: 实际跑了什么命令、结果如何（验收项要求「反证」的，把实验输出贴在这里）
LIMITATIONS: 没做到或不确定的地方（没有就写「无」）
```
