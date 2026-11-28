# OpenStory 分发边界（开源清障批）

> 本文件是打包白名单与清洁门禁的唯一说明。白名单/排除表实现在
> `tools/acceptance/cleanGates.mjs`，门禁在 `tools/acceptance/acceptance.mjs` 的 S5.1–S5.4。

## 三层分发模型

| 层 | 内容 | 机制 |
|---|---|---|
| 开源仓·产品 | `src/`、`public/`、`test/`、`tools/`、`genres/`、`samples/`、`styles/`、`runtimes/`、`suites/`、`docs/mcp/`；根文件 `README.md`、`AGENTS.md`、`ARCHITECTURE.md`、`LICENSE`、`package.json`；用户文档 `docs/DEMO.md`、`docs/ACCEPTANCE.md`、`docs/UI-KIT.md`、`docs/PUBLISHING.md`、本文件 | 打包携带 |
| 在仓·不分发 | `skills/`、`knowledge-packs/`、`docs/workorders/`、`docs/plan/`、`docs/adr/`（历史决策与谱系记录）、`docs/kb-eval/`、`docs/samples/`、`tools/acceptance/out/`；已移出仓内的 `docs/KB-ARCHITECTURE.md` 私人副本 | 沿用货架排除机制，不进发布包 |
| 不在仓 | `.ua/`、`.zcode/`（工具运行时数据，私人副本已归档到仓外）；私人语料库 语料、番茄下载器归档等私人资产 | `.gitignore` 排除；工作树不保留 |

`docs/adr/` 与历史审计类文档含真实谱系名与旧路径，属于决策留痕而不是面向新用户的分发文档，因此归入「在仓·不分发」；出处声明本身保留在仓内，供维护者核对，不删除、不改写为虚假中性名。

## 清洁门禁

对「开源仓·产品」白名单内文件执行四条 grep 规则，命中即红：

| 编号 | 规则 |
|---|---|
| S5.1 | 盘符路径：`[A-Za-z]:[/\\](Users\|私人语料库\|OpenStory\|旧版库\|_openstory\|D盘)` |
| S5.2 | 私人名：`私人语料库\|旧版库(-e2e)?\|外部施工模型\|外部施工模型\|编码代理\|编码代理\|工作台` |
| S5.3 | 源机用户名：`C:\\Users\\Administrator`（双反斜杠写法仅为避免文档自身触发规则） |
| S5.4 | 凭据模式：`sk-[A-Za-z0-9]{8,}` 或 `api[_-]?key\s*[:=]\s*["'][^"']{6}` |

豁免表：`test/fixtures/clean-gates-allowlist.json`。只登记 `src/protocol/libraryUpgrade.mjs` 中功能必需的旧库协议标识字符串，精确到字符串值；门禁只在该字符串值出现在同一行时放行。其他文件不得申请豁免。

## 复跑命令

```bash
node tools/acceptance/acceptance.mjs   # S5.1–S5.4 必须全绿
node tools/number-anchors.mjs --check
npm run arch:stats -- --check
```
