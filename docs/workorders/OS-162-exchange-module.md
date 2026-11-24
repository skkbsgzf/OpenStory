# OS-162 · 段 C 第 2 步：导入导出模块 ＋ NovelPedia 适配器（G7 落地）

| 项 | 值 |
|---|---|
| 批次 | 段 C·工作面插件化收尾 |
| 对应 | 第一批 G5b、G7（作者裁定「统一成 fact」） |
| 依赖 | OS-161（模块插件形状已落地） |
| 允许改动 | `src/**`、`public/**`、`test/**`、`tools/**`、`docs/**`、`ARCHITECTURE.md`、`AGENTS.md` |
| 风险 | 中（新增写入口，必须复用既有写通道） |
| 状态 | 待派 |

## 目标

把「导入导出」做成本地模块插件，并落地 ADR 0001 的 NovelPedia 薄适配器：**pedia/v1 与 fact.data/v3 之间只做字段映射，写一律走既有 fact 写通道**。

## 动工前必读

- `docs/adr/0001-fact-schema-unification.md` 全文，尤其 **§五（改动面）与附录 A（字段映射实测表）**——表外的 pedia 侧字段不许臆造。
- `src/api/handlers/fact.mjs` 的 `factEntriesImport`（现有写通道）与 `src/api/contracts/fact.mjs`。
- OS-161 的三个模块 manifest 与 `src/protocol/modules.mjs`（照它们的形状做）。

## 任务

1. **适配器（纯函数，零 fs）** `src/modules/exchange/pediaAdapter.mjs`：
   - `pediaToFactEntry`：pedia/v1 → fact.data/v3——改 schema 名、补 `status: 'draft'` 与 `provenance.mode: 'analyze'`，其余原样，**id 不重算**；`layer: style` 不转换、如实单列；
   - `factEntryToPedia`：反向投影，**返回丢失字段清单**（status／validity／readerCognition／provenance.mode／character 的 anchors·memoryPoints·castRole·knowledge／plot 的 rhythmSpec·structureTemplates）；
   - 转换结果逐条过 `validateFactEntry`。
2. **`test/pediaAdapter.test.mjs`** 把附录 A 每条结论钉死：三层样本转换后零 error 且 id 逐位不变；style 层单列；反向丢失清单与 A3 逐项一致。
3. **模块与端点** `src/modules/exchange/`＋`module.manifest.json`（`core: false`）＋新契约域 `src/api/contracts/exchange.mjs` ＋ `src/api/handlers/exchange.mjs`，进 `src/api/registry.mjs`：
   - 导入端点：格式、目标 bookId、JSONL 文本、`dryRun`；流程＝解析→适配→逐条校验→**调 `factEntriesImport` 抽出的同一写入函数**（抽共用函数，不许复制第二份写逻辑）；
   - 导出端点：经既有读通道取条目→`factEntryToPedia`→返回；可选存到库内 `导出/`，**存盘走宿主写协议**（原子写＋`.history`＋修改痕迹）；
   - 停用 → 两端点返回 `MODULE_DISABLED`。
4. **界面**：入口挂**宿主层**（顶栏库切换面板里的「导入 / 导出」），由模块注册的动作提供，模块停用即消失；流程＝选格式与目标书→选 `.jsonl`→**先 dryRun 预览**→作者确认→才真写。
5. **`test/exchange.test.mjs`**（临时夹具库）：导入→核对 fact 文件；dryRun 不落盘；重复导入的幂等/版本语义与 `factEntriesImport` 一致；停用回 `MODULE_DISABLED`；导出不改 fact 文件（mtime 与内容哈希）。
6. **文档**：ADR §五「出向（尚无端点）」改为已落地并指向新端点；`ARCHITECTURE.md` 模块清单加一行。

## 不做

- 不改 fact 文件格式与写协议；不新开第二条写口。
- 不动 `core/**`（已不存在）、`vendor/**`（已不存在）、`package.json` 依赖。

## 验收

- `node --test test/*.test.mjs` 全绿（只增不减）；`node tools/acceptance/acceptance.mjs` 全绿。
- 收尾跑 `npm run arch:stats` 回写。
- 报告贴：两个新端点的契约形状、dryRun 证据、导出不动 fact 的证据。

## 纪律

- 既有测试只许新增或等价加强，不许删除、skip、放宽断言。
- 每改一个文件立刻 `node --check`；改完 grep 调用点确认补丁落地。
- 补丁写成脚本文件再执行或用编辑工具，不用 bash 内联 JS 模板串。
- 不执行任何 git 命令；不启动、不杀 daemon 进程；不动 `.zcode/`；临时探针用完必须删。
- 只改「允许改动」范围内的文件；测试一律用临时夹具库，绝不碰 `D:/Projects` 下的作者真库。
- 遇到门禁不可能通过或规格矛盾——停下来如实上报。

## 施工回报（编排器自动归档）

## 验收记录（主 agent 填）

- **适配器（纯函数零 fs）**：`src/modules/exchange/pediaAdapter.mjs`——`pediaToFactEntry` 改 schema、补 `status:'draft'` 与 `provenance.mode:'analyze'`、id 不重算、style 层单列；`factEntryToPedia` 反向投影并**剥离 events 内 track/novelty/segments**（A3：v3 增量不静默透传），返回丢失清单。每条过 `validateFactEntry`（经 `protocol/factDomain.mjs` 转供叶子，S2.1 合法）。校验器经 `src/protocol/factDomain.mjs` 转供叶子取（模块不直引 kernel）。
- **ADR 附录 A 逐条钉死**：`test/pediaAdapter.test.mjs` 4/4——三层样本转换后零 error 且 id 逐位不变；style 单列；反向丢失清单与 A3 逐项一致（top + character 4 项 + plot 5 项）；深拷贝不改入参。
- **共存写通道**：fact 写核心抽成 `src/services/factImportWrite.mjs`，`factEntriesImport` 与 exchange 共用同一写入函数（原子写＋revision＋operationId 幂等＋wiki＋日志）——没有第二份写逻辑。
- **两个新端点**：`exchangeImport`（pedia/v1 或 JSONL → 适配 → 逐条校验 → 共用写函数；dryRun 预览）、`exchangeExport`（经既有 fact 读通道 → 反向投影 → 可选存库内「导出/」走宿主写协议）。契约 `src/api/contracts/exchange.mjs` 第八域，`src/api/handlers/exchange.mjs`，已进 registry。
- **端点测试证据**：`test/exchange.test.mjs` 3/3——dryRun 不落盘、真写核对 fact 文件、重复导入 revision 不倒退且同 id 不堆积；导出不动 fact 的 mtime＋sha256（含 save:true）；停用两端点 409 MODULE_DISABLED、启用恢复。
- **界面**：入口挂宿主顶栏库面板的「导入/导出」（`moduleOn('exchange')` 控制显隐）；两段确认（先 dryRun 预览，再点一次才真写），弹层样式令牌化。
- **文档**：ADR 0001 §五「出向（尚无端点）」改为已落地并指向新端点（export-rag 仍标规划）；`ARCHITECTURE.md` 模块清单补 exchange。
- **测试/门禁**：全量 625 例（623 过/2 跳，开工 618 只增不减）；门禁 22/0/0；契约域守卫等价加强为八域并集；架构统计已回写。app.js 12,256 → 12,310（本单 +54 行 UI/事件，仍较 OS-161 开工 12,466 净降 156）；S2.2 前端模块 18 个照绿。
