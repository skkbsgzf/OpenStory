# OS-172 · A1 互认拆除：`.pinax/` → `.openstory/` 单态收敛

| 项 | 值 |
|---|---|
| 批次 | 第三批·批次 A 宪法批（工作包 A1） |
| 对应 | 规划 [`batch3-microkernel-plan.md`](../plan/batch3-microkernel-plan.md) §4 批次 A、§3 R1／R14 |
| 依赖 | OS-170（数字锚门禁已就位，文档改动受控） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`samples/**`、`.gitignore`、`docs/**`、`AGENTS.md`、`ARCHITECTURE.md`、`README.md` |
| 风险 | **高**（改的是库的落盘位置；会迁移作者既有库） |
| 状态 | 待派（**需作者再确认一次**，见规划 §6-1） |

通用规则见 [`COMMON-RULES.md`](COMMON-RULES.md)。

## 目标

库的运行态只有一个家：`<库>/.openstory/`。`.pinax/` 作为 Pinax 时代的兼容目录退场，旧库一次性升级；与 Pinax 桌面端的互认就此拆除（作者裁定：本轮验收标准是 OpenStory 内部代码质量）。

## 主 agent 核对到的事实

- `src/` 里对 `.pinax` 的引用约 **49 处**（运行态：界面状态、修改日志、草稿、`project.json`）。
- 台账【作者动作】仍有「用 Pinax 桌面端打开 OpenStory 新建库确认」，LEGACY-ITEMS 多处以 `.pinax/project.json` 为互认锚——本单之后这些都要改。
- `pinaxListGet`、`pinaxListImport` 两个端点与设置页「导入 Pinax 清单」入口在 OS-167 落地。
- 作者验收报告的「影响面·六」不在仓内——本单第一步自己盘。

## 任务

1. **影响面盘点（先做，贴报告）**：`src/**`、`public/**`、`test/**`、`tools/**`、`samples/**`、`docs/**` 里所有 `.pinax` 引用逐条归类（运行态读写／测试夹具／样例库／文档）；`src/modules/library/projectDoc.mjs` 里 `project.json` 的 spec 名（`pinax-project@3`）与字段逐项列出。作者报告里的六项若能对上就标注。
2. **单态收敛**：所有运行态读写改到 `<库>/.openstory/`（子路径名不变：`ui-state.json`、`log/`、`drafts/`、`project.json`）；**读侧只认 `.openstory/`**，不做长期双读。
3. **一次性升级迁移**：打开一个「有 `.pinax/`、无 `.openstory/`」的旧库时触发——
   - 先把整个 `.pinax/` 备份到 `<库>/.history/.pinax-upgrade-<时间戳>/`；
   - 再经物理写管道迁到 `.openstory/`（原子写）；写迁移标记 `.openstory/.upgraded-from-pinax.json`（时间、条目数）；
   - 幂等：已有标记或目标已存在则不重复迁；**失败则原样保留 `.pinax/` 并如实报错，绝不留半迁状态**；成功后原 `.pinax/` 改名为 `.pinax.retired-<时间戳>/` 留在库内（不删，作者确认后可自行清）。
4. **`project.json` 改用自有格式**：spec 名与字段里的 Pinax 谱系名（`pinax-project@3`、`pinax.carrier.*`）换成 OpenStory 自己的命名（命名表先登记，再改代码）；写一个只读的旧格式识别：读到旧 spec 名即视为需要升级的旧库。
5. **pinax 端点退役**：`pinaxListGet`、`pinaxListImport` 与设置页入口下线；契约与端点计数同步。
6. **金样改锁自有格式**：`test/decoupleStep2.test.mjs` 从「逐字段等于 Pinax 内核建库输出」改为「逐字段等于 OpenStory 自有 `project.json` 格式」；旧金样保留为 `test/fixtures/` 的一份只读旧格式夹具，供升级迁移测试当输入。
7. **样例库同步**：`samples/水浒传` 的 `.pinax/` 换成 `.openstory/`，用已有的生成脚本重跑，不手改；样例洁净门禁照过。
8. **文档**：`AGENTS.md` 第 10 条落盘表、`ARCHITECTURE.md`、`README.md` 的数据位置段、`docs/LEGACY-ITEMS.md`（删「桌面端开新库确认」，补「互认已拆除」一条已裁定）。

## 不做

- **绝不碰作者真库**（`D:/Projects/**`）：迁移只在临时夹具库上验证；作者真库的升级由作者用新版第一次打开时触发。
- 不保留 `.pinax` 的长期双读；不删除任何旧数据（只备份、改名）。
- 不动内核 fact 链与 Host API。

## 验收

- 升级迁移测试（临时夹具）：旧库 → 打开 → 读写正常、`.history` 有备份、迁移标记在、旧目录已改名、重复打开幂等、注入失败时原样保留。
- 全量测试与验收门禁全绿；`grep -rn "\.pinax" src public` 只剩迁移代码里的旧路径常量。
- 两条 e2e（水浒／新建）在新代码上全绿（编排器会重启 daemon）。
- 报告贴：影响面清单、`project.json` 新旧字段对照、迁移测试输出。

## 本单专属纪律

- 迁移逻辑的每一个分支（成功／幂等／失败／部分失败）都要有测试；不许「大概没事」。
- 开工前确认工作树干净；主 agent 会在派发前打一份 git bundle 备份。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）
