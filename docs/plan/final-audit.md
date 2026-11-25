# OS-168 总复核清单（主 agent / 作者逐条执行）

> 用途：把「能自动跑的」与「必须在作者真实环境跑的」分开列清，避免把纸面检查当已验收。
> 本文件只列命令与判据；当前数值锚点见 `ARCHITECTURE.md` 的 `arch-stats` 生成段与 `docs/PUBLISHING.md`。
> **C6／D 批当前快照**：全量单测 836 例、端点 108、`app.js` 10,110 行、测试 109 文件；
> `836 tests / 834 pass / 2 skip / 0 fail`；测试汇总已全绿，门禁 29 过 / 0 挂 / 0 警，
> 不以本文件早先的 OS-168 通过记录冒充当前结果。

## 一、命令清单

| # | 命令 | 覆盖 | OS-168 历史状态／C6 当前要求 |
|---|---|---|---|
| 1 | `node --test test/*.test.mjs` | 全量 Node 测试（含 daemon 端到端、模块覆盖面、院子迁移、库升级、总复核护栏） | OS-168 历史：750 tests / 748 pass / 2 skip / 0 fail；C6 当前必须重新全绿 |
| 2 | `node tools/acceptance/acceptance.mjs` | 29 项验收门禁（S0–S4） | OS-168 历史：27 过 / 0 挂 / 0 警；C6 当前必须重新全绿 |
| 3 | `npm run arch:check` | `ARCHITECTURE.md` 生成段逐字比对代码实测 | OS-168 历史：旧 L7–L2 生成段通过；C6 改为职责/manifest class 生成段，必须重新通过 |
| 4 | `node tools/verify/verify-shuihu.mjs` | 水浒真库第一章全链路（正文→fact→世界书→扮演→导入导出） | ⏸ 需作者真实环境：真 daemon @8807 ＋ `D:/Projects/水浒传`；本会话不启动/不碰 daemon 与真库 |
| 5 | `node tools/verify/verify-os172-e2e.mjs` | 《水浒传》临时库＋新建/半成品库全链路；假上游覆盖真实扮演请求 | ✅ 已跑：水浒 10/10＋新建/半成品 13/13；临时库与临时院子均已清理 |
| 6 | `node tools/verify/verify-newproj.mjs` | 从零建库/半成品导入全链，结束从临时库清单摘除测试库 | ✅ 已由 OS-172 临时 e2e 覆盖；脚本现要求显式临时 preferences 路径 |
| 7 | `printf '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}\n' \| npm run mcp` | MCP stdio 冒烟：`tools/list` 应返回 24 工具 | ✅ 已跑：stdio 就绪、`tools/list` 返回 24 工具 |
| 8 | 两端口一致性：daemon A 监听 8807、daemon B 监听临时端口（均用同一 `LOCALAPPDATA` 注入），一端 `PUT /api/ui-preferences` 改皮肤，另一端 `GET /api/ui-preferences` 应读回同一值；清空浏览器存储后仍一致 | 机器级偏好与库内状态不随端口/缓存漂移（OS-158 判据） | ⏸ 需作者真实环境：本会话不启动/不杀 daemon |

> 第 4、8 项在作者环境执行时，若本机 8807 已有 daemon，不要另起实例：单实例闸会友好退出，复用在跑的那个即可；
> 如需干净环境，先由作者确认无在跑的 daemon 再启动。所有涉及本机院子的验证一律用临时 `LOCALAPPDATA` 注入。

## 二、29 项门禁清单（编号／断言／覆盖什么）

| 编号 | 断言（摘要） | 覆盖什么 |
|---|---|---|
| S0.1 | 仓根文件/目录白名单，实测无越界 | 根级零 `.mjs`、文档在 `docs/`、布局宪法 |
| S0.2 | `arch-stats --check` 生成段逐字相等 | 架构文档数字不漂移 |
| S1.1 | MCP 24 工具、4 模块组均有读写 | 外部 Agent 工具面 |
| S1.2 | `docs/mcp/OVERVIEW.md` 工具数与实装一致 | 对外工具文档 |
| S1.3 | `skills/` 31 包都有 `SKILL.md` | 知识库包完整 |
| S1.4 | dsh-cli 一次一进程型适配件注册 | 原生 CLI runtime |
| S1.5 | Qoder 子 agent 派发器就位 | 外部 CLI 派发链路 |
| S1.6 | `test/**` 本机绝对路径零容忍（允许清单为空） | 测试不依赖本机环境（OS-169） |
| S2.1 | 模块只经协议/能力句柄；API/services/host/protocol 仅显式转供叶，复制实现拒绝 | 能力路由边界与兼容转供去重 |
| S2.2 | `public/*.mjs`＋`views/*.mjs` 互不 import（合法边按条登记） | 前端模块隔离 |
| S2.3 | `contracts.mjs` 108 端点；daemon 分派＋响应校验 | 契约驱动架构 |
| S2.4 | kernel 不反向依赖、host 不私接模块/前端、无 core/vendor 回潮、base.* 五项句柄齐全 | 底座边界（C6 取代旧 L2 口径） |
| S2.5 | 20 概念命名真源表一致（页签/日志都回表） | 五层命名归一 |
| S2.6 | 登记的豁免边必须真实存在且有理由 | 豁免表不腐化 |
| S2.7 | 21 模块＝12 workbench＋7 kernel＋2 宿主组合面；stage C／零 kernel UI／端点唯一归属／能力图与 activate 贡献校验 | 能力归属与动态入口 |
| S2.8 | 测试 836／端点 108／宿主域端点 0／app.js 10,110≤10,500；文档＝JSON＝实测 | 数字锚与 app.js 只降不升上限 |
| S2.9 | 显示名＝入口名＝磁盘目录名＝日志模块名 | OS-172 四名一致；正名只留一个 slug |
| S2.10 | 产品目录扫描 `pinax` 零违规；署名统一为作者身份 | OS-172 谱系名清扫；仅留真实出处与迁移兼容 |
| S2.11 | 内核直连与转供叶为零（R-a～R-d 同一口径） | OS-193/195 边界收口 |
| S2.12 | 页签清单只来自 `/api/plugins` 的 slot 投影；行为表无页签名/目录/顺序字段 | OS-198 单一编排源 |
| S3.1 | 令牌定义区外裸色值 8 处 | 语义令牌覆盖 |
| S3.2 | 侧栏恒为浮层、正文居中 | OS-48 布局宪法 |
| S3.3 | 统一组件约定类都有样式定义 | UI kit 一致 |
| S3.4 | `public/**` 零 `localStorage`/`sessionStorage`/`indexedDB` | 任何端口同一份设置（OS-158） |
| S3.5 | html/js/css/mjs 静态资源 `no-store` | 防旧包假象 |
| S3.6 | `samples/` 62 文件，日志/历史/临时/凭据/本机路径 0 | 样例库洁净 |
| S4.1 | 6 个核心页签顶栏可达，注册表 `core:true` 锚点真实 | UX 跳转层级；夹具目录从命名表派生 |
| S4.2 | 关闭按钮统一走 `rm-x`，旁路 `close` 0 | 组件一致性 |
| S4.3 | `docs/UX-STRUCTURE.md` 存在 | UX 结构清单 |

> `test/finalAudit.test.mjs` 会核对本表覆盖 acceptance 源码里全部 `check('S…')` 编号，
> 并核对路线表与 `PUBLISHING.md` 的数值锚点，防止「写了但从不运行」或文档空转。

## 三、作者待办（不在本仓代码范围内）

1. 拿一本真实 NovelPedia 书跑导出→导入回环（台账【作者动作】）。
2. 用新版首次打开既有真库，确认一次性升级报告与作者认可；升级保留备份、冲突后缀和旧目录留档，不删旧数据。
3. 全部复核通过后由作者下令 push；推送前后用 `git ls-remote` 核远端状态，不依赖本地打印摘要。
