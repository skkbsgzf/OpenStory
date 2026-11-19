# PUBLISHING.md — 开源发布规范（高优先级）

> **本文件是本仓发布的规范与检查单，优先级仅次于 AGENTS.md 的硬规则。**
> 标准：**协议干净、demo 干净、人机双读**——三项全绿才允许 push。
> 自动检查器：`node ~/.zcode/skills/repo-publish/scripts/publish-scan.mjs .`（对任意仓可跑，全绿退出码 0）。

## 一、推送前必过检查单

### ① 历史与工作树敏感扫描

- 全历史凭据扫描（`git log --all -p -G "(api[_-]?key|token|secret|password)\s*[:=]\s*['\"][A-Za-z0-9]{16,}"`）——命中需逐条甄别：**测试 mock 假值可豁免，真实形态一律阻断**
- `git ls-files` 确认无 `.env`、agent-config、session、密钥文件被跟踪
- 运行残留不得被跟踪：`.history/`、`.openstory/`、`.pinax/`（project.json 除外）、`*.log`、`tmp/`、测试自产夹具目录——`git rm -r --cached` 清退＋进 .gitignore

### ② .gitignore 五分区

依赖（node_modules）｜运行产物（*.log/.cache/tmp/测试自产）｜库内数据（.openstory/.history/.pinax）｜本机环境（.env*，豁免 .env.example）｜系统杂项。分区带注释头，声明意图。

### ③ README 七要件（缺一即红）

①标题下一句话定位 ②边界/声明（不做什么）③快速开始三行命令 ④ASCII 架构图 ⑤仓库地图（目录→内容）⑥出处与致谢（vendor/上游链接）⑦版本注记。端点数/测试数**写死在文中**作为漂移检测锚点——数字变了就是 README 过期了。

### ④ 协议干净

LICENSE 与 vendor 归属自洽；`core/VENDORED.md` 记逐字 vendor 出处；package.json 带 repository/license/engines；**不写真实私人邮箱**。

### ⑤ demo 干净

`samples/*/` 只留内容文件；运行残留/备份/会话一律清除；自带 README（怎么导入＋体验入口）；素材确认来源可公开。

## 二、提交描述规范

- 标题 `type：一句话`（feat/fix/docs/chore/refactor/test），**≤72 字**，不用句号
- 正文列要点，重要取舍写「为什么」；如实报备事故与残留处理
- 原子化：一个提交一件事；**并行协作改完一个文件就 commit**（防未提交改动被同仓其它会话裹挟/回滚——OS-52 事故教训）
- 历史已推送的标题不可改写：规范对未来提交生效

## 三、版本与 tag

- semver 首版 `v0.1.0`；annotated tag 说明「本版包含什么＋硬数字」
- tag 打在 HEAD；push 用 `git push -u origin main --tags`

## 四、文档人机双读口径

人能扫读（标题分层/表格/代码块），agent 能 grep（关键数字写死、边界与红线成条列出、文件名稳定不漂移）。仓内文档改动与代码同批提交，不攒文档债。
