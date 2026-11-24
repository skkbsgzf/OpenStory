# PUBLISHING.md — 开源发布规范（高优先级）

> **本文件是本仓发布的规范与检查单，优先级仅次于 AGENTS.md 的硬规则。**
> 标准：**协议干净、demo 干净、人机双读**——三项全绿才允许 push。
> 自动检查器：`node ~/.zcode/skills/repo-publish/scripts/publish-scan.mjs .`（对任意仓可跑，全绿退出码 0）。

**OS-168 收口数值锚点**（数字只由命令复现，不手抄）：

| 命令 | 当前结果 |
|---|---|
| `node --test test/*.test.mjs` | 682 tests / 680 pass / 2 skip / 0 fail |
| `node tools/acceptance/acceptance.mjs` | 23 过 / 0 挂 / 0 警 |
| `npm run arch:stats --check` | 通过；生成段：前端 23 文件 21,317 行、宿主 7 文件 1,684 行、自持层 74 文件 16,112 行、内核 11 文件 1,871 行、`app.js` 11,886 行、端点 107、测试 87 文件 |
| `grep -rn "PinaxNext" src public` | 仅迁移常量/门面注释；产品零直拼 |
| `grep -rn "next-preferences" src public` | 仅旧清单只读导入与拒写提示；默认路径零命中 |

## 一、推送前必过检查单

### ① 历史与工作树敏感扫描

- 全历史凭据扫描（`git log --all -p -G "(api[_-]?key|token|secret|password)\s*[:=]\s*['\"][A-Za-z0-9]{16,}"`）——命中需逐条甄别：**测试 mock 假值可豁免，真实形态一律阻断**
- `git ls-files` 确认无 `.env`、agent-config、session、密钥文件被跟踪
- 运行残留不得被跟踪：`.history/`、`.openstory/`、`.pinax/`（project.json 除外）、`*.log`、`tmp/`、测试自产夹具目录——`git rm -r --cached` 清退＋进 .gitignore

### ② .gitignore 五分区

依赖（node_modules）｜运行产物（*.log/.cache/tmp/测试自产）｜库内数据（.openstory/.history/.pinax）｜本机环境（.env*，豁免 .env.example）｜系统杂项。分区带注释头，声明意图。

### ③ README 七要件（缺一即红）

①标题下一句话定位 ②边界/声明（不做什么）③快速开始三行命令 ④ASCII 架构图 ⑤仓库地图（目录→内容）⑥出处与致谢（上游链接，指向 `docs/kernel-provenance.md`）⑦版本注记。端点数/测试数/行数**只写在 `ARCHITECTURE.md` 的脚本生成段**（`npm run arch:stats` 回写、`npm run arch:stats --check` 比对），README 不手抄易漂移数字。

### ④ 协议干净

LICENSE 与出处自洽：`README.md` 致谢段记内核谱系（Pinax-next `feat/pinax-electron-next`@`70a4f44`／@pinax/core 0.16.0 `e56a0bc`）与「落盘格式即互认锚」的口径，逐文件「来源 → 现位置」对照见 `docs/kernel-provenance.md`，对外错误码改名见 `docs/error-code-rename.md`；package.json 带 repository/license/engines；**不写真实私人邮箱**。不再有 `core/VENDORED.md` 与 `npm run vendor:check`——互认由落盘格式金样守护。

### ⑤ demo 干净

`samples/*/` 只留内容文件；运行残留/备份/会话一律清除；自带 README（怎么导入＋体验入口）；素材确认来源可公开。

### ⑥ 命名真源一致（OS-148）

五层名字（磁盘目录／页签／changelog 模块／契约域／MCP 前缀）只许来自
`public/views/registry.mjs` 的 `NAMING_TABLE`，后端经 `src/protocol/naming.mjs` 转供。
发布前跑：

```bash
node tools/acceptance/acceptance.mjs     # S2.5 命名真源表一致 必须 ✓
node --test test/naming.test.mjs         # 页签层/日志层都回表、无第二份字面量
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
