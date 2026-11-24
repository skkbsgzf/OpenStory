# OS-150a · 段 A 验收与复核修复（7 条）

| 项 | 值 |
|---|---|
| 批次 | 段 A·立规矩（验收与复核修复；编号规则见体系文档 §4：段内修复用上一张已派工单号＋字母，不占新号） |
| 对应 | OS-148／OS-149／OS-150 的独立复核（1 条 medium、3 条 low）＋主 agent 浏览器实测发现（2 条既有问题）＋1 条门禁扫描面 |
| 依赖 | OS-148、OS-149、OS-150 已提交 |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/acceptance/**`、`scripts/verify-newproj.mjs`、`AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`docs/**` |
| 风险 | 低到中（只有第 6 条动一个端点在空库上的响应） |
| 状态 | 待派 |

## 目标

把段 A 放行时挂着的几条一次修净，顺带修掉全页实测暴露的两处老问题。不扩大范围。

## 动工前必读

- 三张工单末尾的「施工回报」：`docs/workorders/OS-148-naming-source.md`、`OS-149-anchors-echo-kit.md`、`OS-150-doc-numbers.md`。
- `public/views/registry.mjs` 的 `NAMING_TABLE` 与查表函数；`src/protocol/naming.mjs`（后端取表口）。
- `public/views/runtimeShelf.mjs`（运行时货架的过滤纯函数）；`src/protocol/plugins.mjs`（插件清单聚合）。
- `AGENTS.md` 的增量冻结规则（第 20 条）与命名表硬规则（第 21 条）。

## 任务

### 1【medium】回声参考套件仍出现在「设置 → 插件总览」（G8e 漏网）

实测：`/api/plugins` 的运行时条目是 `cli-claude, cli-codebuddy, cli-qoder, dsh, echo-kit`，**没有夹具标记**；而 `/api/agent/runtimes` 里是 `echo-kit(fixture)`。
原因：`src/protocol/plugins.mjs` 的聚合层组条目时把 `fixture` 字段丢了；`public/app.js` 的 `pluginsOverviewHtml`（约 `:4644`）对 `bag.byKind.runtime` 逐条渲染、不过滤。

- 聚合层透传 `fixture`；总览的渲染数据过滤掉夹具套件——**复用 `runtimeShelf.mjs` 里已有的纯函数**，不许写第二份过滤逻辑。
- 加测试：`/api/plugins` 的运行时条目保留夹具标记；总览的渲染数据不含夹具套件。
- 再全仓搜一遍有没有第三处作者可见的运行时列表（DSH 修复流程、Agent 栏的状态 chip 等），逐个确认并写进交付说明。

### 2【low】`src/services/genres.mjs` 里还有第二份「页签名 → 目录名」字面量

`genres.mjs` 约 `:270` 的 `PAGE_TO_DIR`（`write / entries / worldbook / script …`）与注册表里的那份重叠，没从命名表派生。

- 改为经 `src/protocol/naming.mjs` 取表派生。表里没有的键（退场或未入表的概念）要么入表，要么在交付说明里逐个说明去留。
- `test/naming.test.mjs` 补一条：`src/` 里不许再出现页签名到目录名的字面量映射。

### 3【low】S4.1 的渲染注册断言能被注释骗过

`tools/acceptance/acceptance.mjs` 约 `:440` 对 `VIEW_RENDERERS` 块分词前没剥注释，块内写一行 `// writeHtmlGone` 就能冒充已注册。

- 分词前先剥掉 `//` 与 `/* */` 注释。
- 反证写进交付说明：在块内加一行这样的注释时，断言仍是「未注册」。

### 4【low】落盘表的导出文件名少一段

`AGENTS.md` 约 `:91` 写 `导出/会话-<sid>-<ts>.md`，实际是 `会话-<bookId>-<sid>-<ts>.md`（`src/api/handlers/fact.mjs:660`）。以代码为准改文档；`:636` 的注释也少一段，一并改。

### 5【low，既有问题】扮演页的「本模块修改」永远读不到记录

前端 `moduleLogHtml('扮演')`（`public/app.js` 约 `:9828`）查的模块名是「扮演」，而日志写在「推演」下。

- 改为取表（`logModuleForView`），别再写死。
- 补一条测试钉住「扮演页查的就是推演模块」。

### 6【low，既有问题】故事源页在还没拆解的库上显示内部错误文案

实测：一个没有拆解条目的新库，故事源页显示「条目读不了：条目清单响应形状不符合契约」。
来源：`/api/fact/entries` 在库里没有 fact 书时自校验失败（`src/api/handlers/fact.mjs:191`），把内部校验的错直接甩给了页面。

- 端点在「库没有拆解条目」时返回一个**专用、稳定**的错误码（登记进契约 errors），消息是人话，例如「这个库还没有拆解条目」。
- 故事源页对这个码渲染引导性的空态（而不是错误条）；文案走统一出口，不许在页面里散落。
- 其它消费方（世界书的拆解词条组、MCP 的 fact 工具）在无拆解库上的既有行为**不许变**——逐个确认并写进交付说明。
- `scripts/verify-newproj.mjs` 的 A5 若断言了旧码，同步更新并在交付说明里写明。

### 7【low】S2.2 的扫描面是写死的

`tools/acceptance/acceptance.mjs` 的 S2.2（前端模块互不 import）只扫写死的 6 个模块，新增的 `public/views/runtimeShelf.mjs` 不在其中。

- 改成自动枚举 `public/*.mjs` 与 `public/views/*.mjs`（`md.mjs` 渲染协议的豁免照旧）。只增不减。

## 不做

- 不改注册表里条目的 `core` 标记；不改 MCP 工具名、端点路径。
- 不动 `core/**`、`vendor/**`、`package.json`；不引任何依赖。
- 第 6 条不许改 fact 文件的格式与写协议。

## 验收

- `node --test test/*.test.mjs` 全绿（当前 529 例，只增不减）。
- `node tools/acceptance/acceptance.mjs` 全绿（当前 18 项，只增不减）。
- 改完跑 `npm run arch:stats` 回写文档，S0.2 照绿。
- `public/app.js` 行数不增（当前 12,471）。
- 交付说明里逐条对应上面 7 条：改在哪、怎么验的。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁真的落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件，越界的不提交。
- 测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过、规格互相矛盾、或必须删／放宽既有测试才能过——停下来如实上报，不要绕过去。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
