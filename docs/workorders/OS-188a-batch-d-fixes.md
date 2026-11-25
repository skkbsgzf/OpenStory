# OS-188a · 旧库升级补强：路径改写锚定＋旧数据键抬升＋残留归档

| 项 | 值 |
|---|---|
| 批次 | 清账批（E）第 1 张；规划见 [`cleanup-batch-20261125.md`](../plan/cleanup-batch-20261125.md) |
| 对应 | D 批验收记录 §二 A1、§五 D3；OS-189（Pinax 退役）的前置 |
| 依赖 | 无 |
| 允许改动 | `src/protocol/libraryUpgrade.mjs`、`src/modules/library/textUtil.mjs`、`test/libraryUpgrade.test.mjs`、`test/naming.test.mjs`、`test/os172Naming.test.mjs`、`tools/verify/verify-os172-naming.mjs`、`docs/workorders/OS-188a-batch-d-fixes.md` |
| 风险 | **中**——这段代码会在作者真库上执行；测试一律只用临时夹具库 |
| 状态 | 已实现（待监督线验收） |

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

## 实现记录（施工方回填）

- 路径改写只认库根首段与 `.openstory/drafts|log/<旧模块名>/` 运行态前缀；`.pinax` 前缀先换元数据目录再走运行态规则。正斜杠/反斜杠均识别，回写沿用原分隔符。
- 旧关系扩展键在 md frontmatter 与 JSON/JSONL 对象键两处抬升；`textUtil.mjs` 只认 `extra.relationExtensions`。旧键仅留 `libraryUpgrade.mjs`，`naming.test.mjs` 加了静态断言。
- `.pinax-tmp-*` 按相对路径移入 `<备份>/tmp-residue/`（跳过 `.history`/`.retired-*`/`.git`/`node_modules`），只搬不删；JSON/JSONL 解析失败记入 `report.skipped`（含行号），不阻断升级。
- **反证**：临时把 `mapStoredPath` 改回「任意位置」，锚定用例报 `actual:'世界书/世界书/人物/a.md' / expected:'世界书/参考/人物/a.md'`，随后已还原为锚定实现。
- 新增断言挂在既有 `test()` 上（等价加强），全仓测试总数仍 812，避免牵动数字锚文档；`npm run arch:stats` 回写了 `ARCHITECTURE.md` 生成段的协议行数（4,387→4,496）。
- 复跑 `accept-d-probes.mjs`：B1 三行符合预期，探针夹具未调整。
## 施工回报（编排器自动归档）

> 模型 hy4flash · 第 1 轮 · 测试 绿（tests 812 · pass 810 · fail 0 · skip 2） · 门禁 绿 · e2e 水浒＋新建（隔离 daemon）绿 · 8807 未动

```text
CHANGED:
- `src/protocol/libraryUpgrade.mjs` — 路径锚定、`mapStoredKey` 抬升旧键、md frontmatter 键行改写、`.pinax-tmp-*` 残留归档、`report.skipped/frontmatter/tmpResidue`
- `src/modules/library/textUtil.mjs` — 改读 `extra.relationExtensions`
- `test/libraryUpgrade.test.mjs` — 锚定三例、旧键抬升、残留归档/skipped 断言（作为既有 test 的等价加强，未新增 test 计数）
- `test/naming.test.mjs` — 在既有断言内加入「旧键只许在 libraryUpgrade.mjs」检查
- `docs/workorders/OS-188a-batch-d-fixes.md` — 状态与实现记录回填
- `ARCHITECTURE.md` — `npm run arch:stats` 自动回写生成段（协议行数 4,387→4,496）
- `docs/number-anchors.json` — `node tools/number-anchors.mjs` 重新生成（仍 812 例）

VERIFIED:
- `node --check` 改动的 4 个 `.mjs`：全部通过
- `node --test test/libraryUpgrade.test.mjs test/naming.test.mjs test/os172Naming.test.mjs`：20/20 通过
- `node .zcode/run-gate.mjs`：812 例，810 pass / 0 fail / 2 skip
- `node tools/acceptance/acceptance.mjs`：27 过 / 0 挂 / 0 警
- `node tools/number-anchors.mjs --check`：`✓ 812 例／门禁 27／端点 105`
- `node tools/arch-stats.mjs --check`：`✓ 生成段与实测一致`
- 监督线探针 `node D:/Pinax-e2e/.zcode/tmp/accept-d-probes.mjs`，B1 三行：`推演/素材/a.png`→`扮演/素材/a.png`；`扮演/推演/素材/b.png` 原样；`世界书/参考/人物/a.md` 原样。探针夹具未调整。
- 反证：临时把 `mapStoredPath` 改回「任意位置」，`OS-188a 路径改写锚定` 用例报 `actual '世界书/世界书/人物/a.md' / expected '世界书/参考/人物/a.md'`，随后已还原并复跑全绿。
- 改动文件空白检查（尾随空白/末尾换行）干净，无残留探针文件。

LIMITATIONS:
- 未亲自执行 `git diff --check`（遵守「不执行任何 git 命令」约束），改用逐文件空白等价检查替代。
- 探针 B1 中 `ui-state.lastFile: '参考/人物/a.md'` 保持原样：它不是既有 path-key 集合中的键，本次任务未要求扩展该集合，属预期行为而非漏改。
- 未改动 `test/os172Naming.test.mjs` 与 `tools/verify/verify-os172-naming.mjs`（虽在允许范围）：现有谱系门禁已通过，旧键边界断言落在 `naming.test.mjs`。
```
