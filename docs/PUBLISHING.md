# PUBLISHING.md — 开源发布规范（高优先级）

> **本文件是本仓发布的规范与检查单，优先级仅次于 AGENTS.md 的硬规则。**
> 标准：**协议干净、demo 干净、人机双读**——三项全绿才允许 push。
> 自动检查器：`node ~/.zcode/skills/repo-publish/scripts/publish-scan.mjs .`（对任意仓可跑，全绿退出码 0）。

**OS-170 历史数字锚**（仅保留当时发布复核结果，不代表 C6 当前状态；机器可读真源是 `docs/number-anchors.json`）：

| 命令 | OS-170 当时结果 |
|---|---|
| `node --test test/*.test.mjs` | 836 tests / 834 pass / 2 skip / 0 fail |
| `node tools/acceptance/acceptance.mjs` | 29 过 / 0 挂 / 0 警 |
| `npm run arch:check` | 通过；生成段：底座 28 文件 4,308 行、契约 17 文件 3,887 行、协议 34 文件 5,852 行、内核件 59 文件 11,205 行、工作台 30 文件 3,556 行、前端 31 文件 20,981 行、`app.js` 10,110 行、端点 108、测试 109 文件 |
| `node tools/verify/verify-os172-naming.mjs` | 四名一致 21 概念通过；产品目录扫描 205 文件，仅保留真实出处与迁移兼容 |
| `node tools/verify/verify-os172-e2e.mjs` | 《水浒传》临时库 10/10＋新建/半成品库 13/13；不碰真库与真实院子 |
| `node tools/verify/verify-ci-workflow.mjs` | CI YAML 子集与三层门禁结构通过；隔离 E2E、独立 Chromium job 与报告产物齐全 |
| `node tools/verify/page-browser-smoke.mjs --out <目录>` | 页面矩阵真实 Chromium 全跑，逐页 DOM/布局/状态、错误收集与截图 |
| `node tools/verify/verify-page-report.mjs <目录>` | 页面集合完整，无 fail/manual/skip，PNG 截图非空，无脚本/请求/溢出错误 |

**三层发布门禁（OS-210 起）**：`gates`（两轮单测＋验收＋架构＋隔离全栈 E2E）与
`browser-smoke`（完整页面矩阵＋报告完整性校验）都是 push/PR 硬门禁。所有 daemon、库、
`LOCALAPPDATA`、上游与 Chromium profile 均为临时夹具；不连接 8807，不打开作者真库。
失败日志、页面 manifest、console/pageerror 记录与截图上传为 artifact，保留 7 天。

**C6／D 批当前审计快照（与 `docs/number-anchors.json` 同源）**：全量单测
`956 tests / 954 pass / 2 skip / 0 fail`）；验收门禁 29 项；
契约端点 109；`app.js` 10,044 行（上限 10,500）；测试 124 文件。最终结果以本次任务回报与
`docs/number-anchors.json` 为准，上面 OS-170 历史记录不得冒充当前通过。

## 一、推送前必过检查单

### ① 历史与工作树敏感扫描

- 全历史凭据扫描（`git log --all -p -G "(api[_-]?key|token|secret|password)\s*[:=]\s*['\"][A-Za-z0-9]{16,}"`）——命中需逐条甄别：**测试 mock 假值可豁免，真实形态一律阻断**
- `git ls-files` 确认无 `.env`、agent-config、session、密钥文件被跟踪
- 运行残留不得被跟踪：`.history/`、`.openstory/`、`.pinax/`（project.json 除外）、`*.log`、`tmp/`、测试自产夹具目录——`git rm -r --cached` 清退＋进 .gitignore

### ② .gitignore 五分区

依赖（node_modules）｜运行产物（*.log/.cache/tmp/测试自产）｜库内数据（.openstory/.history/.pinax）｜本机环境（.env*，豁免 .env.example）｜系统杂项。分区带注释头，声明意图。

### ③ README 七要件（缺一即红）

①标题下一句话定位 ②边界/声明（不做什么）③快速开始三行命令 ④ASCII 架构图 ⑤仓库地图（目录→内容）⑥出处与致谢（上游链接，指向 `docs/kernel-provenance.md`）⑦版本注记。端点数/测试数/行数以 `docs/number-anchors.json` 与 `ARCHITECTURE.md` 的脚本生成段为准，README 不手抄易漂移数字。

### ④ 协议干净

LICENSE 与出处自洽：`README.md` 致谢段记内核谱系（Pinax-next `feat/pinax-electron-next`@`70a4f44`／@pinax/core 0.16.0 `e56a0bc`），逐文件「来源 → 现位置」对照见 `docs/kernel-provenance.md`，对外错误码改名见 `docs/error-code-rename.md`；package.json 带 repository/license/engines；**不写真实私人邮箱**。不再有 `core/VENDORED.md` 与 `npm run vendor:check`。OS-172 起互认已拆除，新库契约为 `openstory-project@4`；旧库首次打开时一次性升级并保留备份与留档。

### ⑤ demo 干净

`samples/*/` 只留内容文件；运行残留/备份/会话一律清除；自带 README（怎么导入＋体验入口）；素材确认来源可公开。

> **已知误报（OS-160／OS-199）**：`samples/水浒传/` 按 OS-160 裁定**自带** `.openstory/{project,ui-state}.json` 与 `.openstory/plugins/suite-state.json`（打开即复现配置），这是内容不是残留。通用 `publish-scan.mjs` 的 ⑦ 会把整个 `.openstory/` 目录计为运行残留；以验收门禁 S3.6「样例库洁净」（只拦日志/历史/临时/凭据/本机路径）为准，发布时人工确认该唯一红项即可。

### ⑥ 命名真源一致（OS-148／OS-172）

显示名、页签/入口名、磁盘目录名与 changelog 模块名只许来自
`public/views/registry.mjs` 的 `NAMING_TABLE`，后端经 `src/protocol/naming.mjs` 转供。
发布前跑：

```bash
node tools/acceptance/acceptance.mjs     # S2.5 命名真源表一致、S2.9 四名一致、S2.10 谱系名 必须 ✓
node --test test/naming.test.mjs         # 页签层/日志层都回表、无第二份字面量
node tools/verify/verify-os172-naming.mjs
```

新概念没登表、或页签/日志层自己写了一份名字——两项都会红。

## 二、提交描述规范

- 标题 `type：一句话`（feat/fix/docs/chore/refactor/test），**≤72 字**，不用句号
- 正文列要点，重要取舍写「为什么」；如实报备事故与残留处理
- 原子化：一个提交一件事；**并行协作改完一个文件就 commit**（防未提交改动被同仓其它会话裹挟/回滚——OS-52 事故教训）
- 历史已推送的标题不可改写：规范对未来提交生效

## 三、版本与 tag

- semver：首版 `v0.1.0`（2026-11-19）已发布；当前 `package.json` 为 `v0.2.0`，下一 tag 按当前版本取，annotated tag 说明「本版包含什么＋硬数字」
- tag 打在 HEAD；首次推送用 `git push -u origin main --tags`（本仓 `origin` 已配，但本地未设 upstream）

## 四、文档人机双读口径

人能扫读（标题分层/表格/代码块），agent 能 grep（关键数字写死、边界与红线成条列出、文件名稳定不漂移）。仓内文档改动与代码同批提交，不攒文档债。
