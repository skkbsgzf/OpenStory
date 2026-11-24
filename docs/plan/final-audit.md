# OS-168 总复核清单（主 agent / 作者逐条执行）

> 用途：把「能自动跑的」与「必须在作者真实环境跑的」分开列清，避免把纸面检查当已验收。
> 本文件只列命令与判据；当前数值锚点见 `ARCHITECTURE.md` 的 `arch-stats` 生成段与 `docs/PUBLISHING.md`。

## 一、命令清单

| # | 命令 | 覆盖 | 本次收口状态 |
|---|---|---|---|
| 1 | `node --test test/*.test.mjs` | 全量 Node 测试（含 daemon 端到端、模块覆盖面、院子迁移、库清单导入、总复核护栏） | ✅ 已跑：682 tests / 680 pass / 2 skip / 0 fail |
| 2 | `node tools/acceptance/acceptance.mjs` | 23 项验收门禁（S0–S4） | ✅ 已跑：23 过 / 0 挂 / 0 警 |
| 3 | `npm run arch:stats --check` | `ARCHITECTURE.md` 生成段逐字比对代码实测 | ✅ 已跑：通过；生成段 14 行——前端 23 文件 21,317 行／宿主 7 文件 1,684 行／自持层 74 文件 16,112 行／内核 11 文件 1,871 行／`app.js` 11,886 行／端点 107／测试 87 文件 |
| 4 | `node tools/verify/verify-shuihu.mjs` | 水浒真库第一章全链路（正文→fact→参考→推演→导出） | ⏸ 需作者真实环境：真 daemon @8807 ＋ `D:/Projects/水浒传`；本会话不启动/不碰 daemon 与真库 |
| 5 | `node tools/verify/verify-newproj.mjs` | 从零建库/半成品导入全链，结束从库清单摘除测试库 | ⏸ 需作者真实环境：真 daemon @8807；脚本自称只走临时目录，但仍会写本机库清单 |
| 6 | `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' \| npm run mcp` | MCP stdio 冒烟：`tools/list` 应返回 24 工具 | ✅ 已跑：stdio 就绪、`tools/list` 返回 24 工具 |
| 7 | 两端口一致性：daemon A 监听 8807、daemon B 监听临时端口（均用同一 `LOCALAPPDATA` 注入），一端 `PUT /api/ui-preferences` 改皮肤，另一端 `GET /api/ui-preferences` 应读回同一值；清空浏览器存储后仍一致 | 机器级偏好与库内状态不随端口/缓存漂移（OS-158 判据） | ⏸ 需作者真实环境：本会话不启动/不杀 daemon |

> 第 4–5、7 项在作者环境执行时，若本机 8807 已有 daemon，不要另起实例：单实例闸会友好退出，复用在跑的那个即可；
> 如需干净环境，先由作者确认无在跑的 daemon 再启动。所有涉及本机院子的验证一律用临时 `LOCALAPPDATA` 注入。

## 二、23 项门禁清单（编号／断言／覆盖什么）

| 编号 | 断言（摘要） | 覆盖什么 |
|---|---|---|
| S0.1 | 仓根文件/目录白名单，实测无越界 | 根级零 `.mjs`、文档在 `docs/`、布局宪法 |
| S0.2 | `arch-stats --check` 生成段逐字相等 | 架构文档数字不漂移 |
| S1.1 | MCP 24 工具、4 模块组均有读写 | 外部 Agent 工具面 |
| S1.2 | `docs/mcp/OVERVIEW.md` 工具数与实装一致 | 对外工具文档 |
| S1.3 | `skills/` 31 包都有 `SKILL.md` | 知识库包完整 |
| S1.4 | dsh-cli 一次一进程型适配件注册 | 原生 CLI runtime |
| S1.5 | Qoder 子 agent 派发器就位 | 外部 CLI 派发链路 |
| S2.1 | `src/modules/**` 只引 node 内置／`protocol/**`／模块内；清单模块零直接耦合 | 后端模块纪律（院子/清单解析下沉协议层后仍零豁免） |
| S2.2 | `public/*.mjs`＋`views/*.mjs` 互不 import（合法边按条登记） | 前端模块隔离 |
| S2.6 | 登记的豁免边必须真实存在且有理由 | 豁免表不腐化 |
| S2.7 | 14 模块／core 4／端点 107 ＝ 独占 43＋宿主 64／无归属 0 | 模块覆盖面随契约自动增长 |
| S2.3 | `contracts.mjs` 107 端点；daemon 分派＋响应校验 | 契约驱动架构 |
| S2.4 | `src/**` 无 `core/` 说明符；内核实现只在 `src/kernel/` | 内核唯一（OS-157 退役旧 S2.4） |
| S2.5 | 19 概念命名真源表一致（页签/日志都回表） | 五层命名归一 |
| S3.1 | 令牌定义区外裸色值 8 处 | 语义令牌覆盖 |
| S3.2 | 侧栏恒为浮层、正文居中 | OS-48 布局宪法 |
| S3.3 | 统一组件约定类都有样式定义 | UI kit 一致 |
| S3.4 | `public/**` 零 `localStorage`/`sessionStorage`/`indexedDB` | 任何端口同一份设置（OS-158） |
| S3.5 | html/js/css/mjs 静态资源 `no-store` | 防旧包假象 |
| S3.6 | `samples/` 34 文件，日志/历史/临时/凭据/本机路径 0 | 样例库洁净 |
| S4.1 | 6 个核心页签顶栏可达，注册表 `core:true` 锚点真实 | UX 跳转层级 |
| S4.2 | 关闭按钮统一走 `rm-x`，旁路 `close` 0 | 组件一致性 |
| S4.3 | `docs/UX-STRUCTURE.md` 存在 | UX 结构清单 |

> `test/finalAudit.test.mjs` 会核对本表覆盖 acceptance 源码里全部 `check('S…')` 编号，
> 并核对路线表与 `PUBLISHING.md` 的数值锚点，防止「写了但从不运行」或文档空转。

## 三、作者待办（不在本仓代码范围内）

1. 在真实桌面端拿一本新库开一次，确认 `.pinax/project.json` 互认（台账【作者动作】）。
2. 拿一本真实 NovelPedia 书跑导出→导入回环（台账【作者动作】）。
3. 全部复核通过后由作者下令 push；推送前后用 `git ls-remote` 核远端状态，不依赖本地打印摘要。
