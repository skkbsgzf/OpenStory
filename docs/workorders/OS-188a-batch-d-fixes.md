# OS-188a · 旧库升级补强：路径改写锚定＋旧数据键抬升＋残留归档

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 1 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §二 A1、§五 D3；OS-189（Pinax 退役）的前置 |
| 依赖 | 无 |
| 允许改动 | `src/protocol/libraryUpgrade.mjs`、`src/modules/library/textUtil.mjs`、`test/libraryUpgrade.test.mjs`、`test/naming.test.mjs`、`test/os172Naming.test.mjs`、`tools/verify/verify-os172-naming.mjs`、`docs/workorders/OS-188a-batch-d-fixes.md` |
| 风险 | **中**——这段代码会在作者真库上执行；测试一律只用临时夹具库 |
| 状态 | 待派 |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

一次性升级在作者的库里**既不改错、也不漏改**；把「只该由迁移器知道的旧名」收进迁移器，给 OS-189 的退役铺路。

## 现状（监督线验收实测）

1. `src/protocol/libraryUpgrade.mjs:94-101` 的 `mapStoredPath` 没有锚定在库根，路径里**任何位置**的 `参考/`、`拆解/`、`推演/`、`.pinax/` 都会被替换。探针结果：`推演/素材/a.png` → `扮演/素材/a.png`（对）；`扮演/推演/素材/b.png` → `扮演/扮演/素材/b.png`（错）；`世界书/参考/人物/a.md` → `世界书/世界书/人物/a.md`（错）。
2. `src/modules/library/textUtil.mjs:62` 在运行时读旧数据键 `extra.pinaxRelationExtensions`（并进 `entry.relations`）。
3. 旧临时文件前缀 `.pinax-tmp-` 的回收还留在运行时（`src/kernel/atomicWrite.mjs:13` 的 `LEGACY_TMP_PREFIX`，本单不动它，由 OS-189 删）。
4. 升级时解析不了的 JSON／JSONL 行被静默跳过，报告里看不出哪些文件没处理。

## 任务

### 1. 路径改写锚定（必修）

`mapStoredPath` 与 `transformStoredJson` 里对对象键的改写（`mapStoredPath(childKey)`）只认两类：

- **以库根为基准的首段**：`参考/`→`世界书/`、`拆解/`→`故事源/`、`推演/`→`扮演/`、`导出/`→`导入导出/`；以 `.pinax/` 开头的先换成 `.openstory/` 再按后面的规则走。
- **已知运行态前缀**：`<元数据目录>/drafts/<旧模块名>/…` 与 `<元数据目录>/log/<旧模块名>/…`（旧模块名见 `MODULE_RENAMES`）。

路径中间的同名目录一律不动。正斜杠与反斜杠两种分隔都要认（现有行为保持）。

### 2. 旧关系扩展键抬升到新键名

- 升级新增一步：在 `世界书/` 下的条目 Markdown 里，frontmatter **顶层键** `pinaxRelationExtensions` 改名为 `relationExtensions`——只改键名所在的那一行，其余字节不动；改写前过 journal，原文件由整库备份兜底。JSON／JSONL 里的同名对象键同样改名（走 `transformStoredJson`）。
- `src/modules/library/textUtil.mjs` 改读 `extra.relationExtensions`，不再认旧键。
- 升级后全仓产品代码里，旧键名只出现在 `libraryUpgrade.mjs`。

### 3. 旧临时文件残留归档

升级时把库内所有 `.pinax-tmp-*` 文件（跳过 `.history`、`.retired-*`、`.git`、`node_modules`）挪进 `.history/upgrade-<时间戳>/tmp-residue/`，保持相对路径；列入升级报告。不删除。

### 4. 解析失败入报告

`report` 增加一项（如 `skipped`），逐条列出解析失败的文件与行号；不阻断升级。

### 5. 测试（`test/libraryUpgrade.test.mjs`，全部用临时夹具库）

- 库根首段照改：`推演/素材/a.png` → `扮演/素材/a.png`；`参考/人物/a.md` → `世界书/人物/a.md`。
- 嵌套同名段不动：`世界书/参考/人物/a.md`、`扮演/推演/素材/b.png` 原样。
- 运行态前缀照改：`.pinax/drafts/推演/r1.json` → `.openstory/drafts/扮演/r1.json`。
- 以上三类在 sync-state 的**对象键**上同样成立。
- 旧关系扩展键：条目 frontmatter 改名后正文逐字节不变、再解析能读到 `relations`；旧键不再被认。
- `.pinax-tmp-abc` 残留被归档、原位置消失、报告里有记录。
- 坏 JSON 的文件出现在 `skipped` 里。
- **反证**：把规则临时改回「任意位置」，嵌套用例必须红，贴输出后还原。

## 不做

- 不动 `src/kernel/atomicWrite.mjs`（旧前缀常量的删除归 OS-189）。
- 不碰作者真库与真实 `%LOCALAPPDATA%`；不改端点与 MCP 工具名；不动既有测试（只许新增或等价加强）。

## 验收

- 机器门禁全绿；红线测试 `test/libraryUpgrade.test.mjs`、`test/os172Naming.test.mjs`、`test/naming.test.mjs` 全绿。
- 复跑监督线探针 `D:\Pinax-e2e\.zcode\tmp\accept-d-probes.mjs`，B1 三行输出符合上面「应为」；探针脚本若因新规则需要调整夹具，在回报里说明改了什么。
- `git diff --check` 干净；`node tools/number-anchors.mjs` 与 `npm run arch:stats` 跑过。
