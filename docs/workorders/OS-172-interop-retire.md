# OS-172 · A1 去 Pinax 化：库的一次性升级（单态收敛＋目录正名）＋谱系名清扫

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 A 宪法批（工作包 A1「互认拆除」；按作者「三名一致」裁定扩成完整的去 Pinax 化） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §1.3a 第二版（规则与不一致清单）、§3 R1／R14 |
| 依赖 | OS-170（数字锚门禁已就位，文档改动受控） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`skills/**`、`suites/**`、`genres/**`、`samples/**`、`.gitignore`、`docs/**`、`AGENTS.md`、`ARCHITECTURE.md`、`README.md`、`package.json`（只许改 `description`／`keywords` 一类元数据与 `scripts`；**`author`、`version`、依赖不动**） |
| 风险 | **高**（改库的落盘位置与目录名；会迁移作者既有库） |
| 状态 | 待派（**需作者确认**，见文末「本单专属纪律」） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

OpenStory 的库与本机，从里到外不再有 Pinax：运行态只有一个家 `.openstory/`；库内目录叫**前端显示的名字**；落盘的谱系名、对用户说的话、技能与套件里的 Pinax 提法一次清干净。旧库**一次性升级**，作者的库只迁一次。

## 主 agent 核对到的现状（对着 `4d8ad95` 实测）

1. **三层名字不统一**：世界书 ↔ 目录 `参考/`；故事源 ↔ `拆解/`；扮演 ↔ `推演/`。修改日志模块名同理（enrich 也把变更记在「拆解」日志）；「＋」面板里世界书还叫「参考」。
2. **`.pinax` 作为运行态目录**：`src` 约 49 个文件、`test` 32、`public` 6、`tools` 7、`samples` 1。
3. **落盘的谱系名**：`pinax-project@3` 与 `pinax.carrier.*`（`project.json`、`genres/` 7 份体裁、`public/app.js` 的建库缺省值）；派生档 schema `pinax-wiki-derived@1`（`public/scriptFact.mjs`）；临时文件前缀 `.pinax-tmp-`（`src/kernel/atomicWrite.mjs`）。
4. **Pinax 导入通道**：端点 `pinaxListGet`／`pinaxListImport`（`/api/library/pinax-list`、`/api/library/pinax-import`）、`importPinaxLibraries`／`inspectPinaxLibraries`、前端 `state.pinaxImport`／`scanPinaxList`。
5. **对用户说的话还在讲「与 Pinax 共用」**（`public/app.js`）：
   - 约 :734「库清单与 Pinax 共用。」
   - 约 :749「库清单与 Pinax 同一份。」
   - 约 :1999「章节就是 正文/NNN-标题.md 文件，Pinax 里同样可见。」
   - 约 :3614 关于页「它和 Pinax 桌面版看的是同一批库文件：两个入口，一份稿子，改哪边都算数。」

   前两处在库清单自持（OS-167）之后**已经是错话**。
6. **货架内容**：`skills/` 9 份里有 15 处「Pinax」，而且技能提示词引用的是 Pinax 的 MCP 工具名（`pinax_chapter_read`、`pinax_worldbook_list`、`pinax_chapter_save`、`pinax_fact_check`、`pinax_extract_status`），不是 OpenStory 自己的 `openstory_*`；`suites/` 6 处「Pinax」。
7. `src/api/handlers/fact.mjs` 约 :1112 的提示语「先跑抽取（pinax_extract_*）再 enrich」。
8. `package.json` 的 `author` 写「Pinax 作者（OpenStory 线）」——这是作者本人的署名，**不在本单范围**。

## 任务（可按 A–E 分多次提交，每次提交后全量测试必须绿）

### A. 单态收敛与目录正名

1. 运行态读写全部改到 `<库>/.openstory/`；**读侧只认 `.openstory/`**，不做长期双读。
2. **目录正名（三名一致）**：`参考/` → `世界书/`（与原 `世界书/` 目录合一）、`拆解/` → `故事源/`、`推演/` → `扮演/`；修改日志模块名、「＋」面板里的叫法同步改成前端名称；命名表里 `reference` 并入 `worldbook`，一个正名只留一个 slug；页签「产物」的页面标题「产物中心」改「产物」；「导入导出」的落盘目录名一并对齐板块名。

### B. 落盘的谱系名

3. `project.json` 改用 OpenStory 自己的 spec 名与载体 id（**先在命名表登记，再改代码**）；读到旧名即视为待升级的旧库。
4. 派生档 schema `pinax-wiki-derived@1` 换成自己的版本串（读侧兼容旧串一个大版本，写出只用新串）。
5. 临时文件前缀 `.pinax-tmp-` 换成 `.openstory-tmp-`；清理逻辑**同时认得旧前缀**（以前崩溃留下的残留文件要能被扫掉）。
6. `genres/` 里的载体 id 同步换成新名。

### C. 一次性升级迁移（把 A、B 的变化一次做完）

7. 打开「带旧目录名、或带 `.pinax/`、或 `project.json` 是旧 spec 名」的库时触发：
   - 先把整库相关部分备份到 `<库>/.history/upgrade-<时间戳>/`；
   - 再经物理写管道完成目录改名、运行态迁移、`project.json` 与派生档的谱系名改写；
   - 写迁移标记（时间、做了哪几项）；幂等；
   - **任何一步失败都原样保留并如实报错，绝不留半迁状态**；成功后旧目录改名留档（加 `.retired-<时间戳>` 后缀），不删。
8. 同名冲突（如 `参考/` 与 `世界书/` 里有同名文件）：加后缀并入报告。

### D. 清扫与退役

9. Pinax 导入通道退役：两端点、协议层函数、前端状态与设置页入口下线；契约与端点计数同步。
10. 对用户说的话改成事实（现状第 5 条的四句）。
11. 技能与套件内容：**只替换产品称呼与 MCP 工具名**——`pinax_*` 换成 OpenStory 自己对应的 `openstory_*`（先核对工具确实存在；没有对应的保留原词，并在报告里逐条列出）。不改技能的写法指导本身。
12. 提示语「先跑抽取（pinax_extract_*）」改成 OpenStory 自己的工具名或中性说法。
13. 样例库 `samples/水浒传` 用生成脚本重跑成新布局（现在同时有 `.openstory` 与 `.pinax`，且还是旧目录名）。

### E. 文档

14. `AGENTS.md` 第 10 条落盘表、`ARCHITECTURE.md`、`README.md` 的数据位置段。
15. `DEMO.md` 的三库口径改为只留《水浒传》（新 demo 从 0 重建是另一个优先级最低的项目，这里只改口径）；`docs/plan/` 里三份 Pinax 对标文档顶部标「历史」。
16. `docs/LEGACY-ITEMS.md`：删「用 Pinax 桌面端打开 OpenStory 新建库确认」；补一条已裁定「互认已拆除、目录已正名」，写明推翻了 OS-48／OS-50（目录名不动）与第二批 G8b（`参考/` 冻结）。
17. **出处声明保留**：`README.md` 致谢段与 `docs/kernel-provenance.md` 里「内核最初出自 Pinax-next」是出处，不是关联，不许删。

## 不做

- **绝不碰作者真库**（`D:/Projects/**`）：迁移只在临时夹具库上验证；作者真库由作者用新版第一次打开时升级。
- 不删任何旧数据（只备份、改名留档）；不保留 `.pinax` 的长期双读。
- 不改端点路径与 MCP 工具名（对外契约名，作者裁定不在三层之内）。
- 不动 `package.json` 的 `author`；不新建 demo。

## 验收

- **迁移测试**（临时夹具旧库）：升级后三个新目录名在、`.openstory/` 在、`project.json` 与派生档是新名、旧目录已改名留档、`.history` 有备份、重复打开幂等、逐步注入失败都原样保留、同名冲突加后缀入报告。
- **三名一致门禁**（验收新增）：每个模块的显示名 ＝ 其页签或入口的显示名 ＝ 库内目录名（有目录的）＝ 修改日志模块名；命名表一个正名只许一个 slug。
- **谱系名门禁**（验收新增）：`src/**`、`public/**`、`genres/**`、`skills/**`、`suites/**` 里，除出处声明与迁移代码里的旧路径常量外，不许出现 `pinax`（不区分大小写）。
- 反证两则：临时把某目录名改回旧名、临时在某个源文件里写一个 `pinax_xxx`，两道门禁都必须红；贴输出后还原。
- 全量测试与验收门禁全绿；水浒／新建两条 e2e 全绿。
- 报告贴：影响面清单（逐类逐文件）、新旧目录对照、迁移测试输出、四句文案的改后原文、技能里无法替换的 Pinax 工具名清单。

## 本单专属纪律

- 迁移逻辑的每一个分支（成功／幂等／每一步失败／同名冲突）都要有测试。
- **需作者确认**：目录改名与运行态迁移会动作者四个真库；确认后主 agent 先打一份 git bundle 备份再派。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
