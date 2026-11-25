# 第三批 D 批（D1–D4，工作包直做）验收记录

| 项 | 值 |
|---|---|
| 验收对象 | 工作树里的第三批全部改动（**未提交**；HEAD＝`ce44e43`；验收前快照 `refs/backup/batch3-d-worktree-20261125`＝`e773d1f`，bundle 在 `D:\_openstory-backup\`） |
| 验收人 | 监督线主 agent（独立于施工会话；不采信施工会话的自验结论，全部本机实跑） |
| 验收时间 | 2026-11-25 11:25–12:15 |
| 结论 | **有条件通过**——自报数字全部属实；3 类问题须 push 前修（→ [OS-188a](OS-188a-batch-d-fixes.md)），其余如实记账 |
| 外围保险 | 验收全程未重启 8807、未碰 `D:/Projects/**` 与真实院子；探针与 e2e 全在临时端口＋临时 `LOCALAPPDATA` |

## 一、独立复跑结果

| 项 | 施工会话自报 | 本次实跑 |
|---|---|---|
| 全量测试（两轮，CI 同口径） | 812／810 过／2 跳过／0 挂 | **两轮均 812／810／2／0** |
| 验收门禁 | 27／0／0 | **27 过／0 挂／0 警** |
| 数字锚、`ARCHITECTURE.md` 生成段、CI 结构 | 通过 | 通过 |
| 端到端（水浒／新建） | 10/10、13/13 | **10/10、13/13**（隔离 daemon，假上游 1 次请求，临时目录已清） |
| 快照冒烟 | loaded 20／degraded 0／issues 0 | **属实**（`capability-79634e0d`） |
| 停用语义 | — | 只停 `text` → 409 `CAPABILITY_IN_USE`（消费者 analysis／habits／roleplay）；连停四个 → 200；`/api/habits` → 409 `MODULE_DISABLED`；`/api/fact/curve` 不受影响 |
| 测试不放宽 | — | 测试文件 87→102，无删除、无 `.only/.todo`；被改名的 20 例均有接替用例（四核心 `MODULE_CORE` 四例按规划 B3 改语义；Pinax 清单导入三例随功能退役） |
| `app.js`／`views` | 10,338 行／14 文件 | 属实（上限 10,500） |
| 署名 | `skkbsgzf` | `package.json`、`LICENSE` 版权人行、套件与技能 vendor 均已换；许可条款未动 |
| 浏览器存储 | 零 | `public/` 零命中 |
| 样例库 | 带隐藏数据与插件配置 | `.openstory/{project.json,ui-state.json,plugins/suite-state.json}` 在 |
| 真库 | 未碰 | 五个库仍是旧布局（`.pinax`、`参考/`、`拆解/`、`推演/`），无 `.retired-*`、无升级备份 |

## 二、push 前必须修（阻塞，见 OS-188a）

**A1 旧库升级的路径改写会误伤嵌套同名段**（`src/protocol/libraryUpgrade.mjs:94-101` `mapStoredPath`）。
`参考/`、`拆解/`、`推演/`、`.pinax/` 的替换没有锚定在库根，路径里**任何位置**出现同名目录都会被改。探针实测：

| 改写前 | 改写后 | 应为 |
|---|---|---|
| `推演/素材/a.png` | `扮演/素材/a.png` | ✓ |
| `扮演/推演/素材/b.png` | `扮演/扮演/素材/b.png` | 应不变 |
| `世界书/参考/人物/a.md` | `世界书/世界书/人物/a.md` | 应不变 |

这段代码会在作者首次打开真库时执行，改的是落盘数据。按现有真库的顶层结构（`参考/人物/…`、`推演/shuihu/…`）不会触发，但无法保证库内没有同名子目录，修法也小：只认库根首段与 `.openstory/{drafts,log}/<旧模块名>/` 这两类已知前缀。

**A2 三名一致有漏网：Agent 栏在前端叫「Pi-Agent」。**
`public/index.html:2698` 头部 `<span class="agent-name">Pi-Agent</span>`，插件名是「Agent 栏」；`index.html:164`、`app.js:18` 的说明文字同。ADR 0002 §2.2 已把它列为「后续改」，至今未改。

**A3 作者要过目的文档与实现对不上。**

| 文档 | 写的 | 实际 |
|---|---|---|
| ADR 0002 §2.3／§2.4／§4.3／D8、`docs/protocol/module-manifest-2.md` §3.1 | 能力 `prose.changelog@1`、`text.lint@1`、`agent.embedding@1`、`storage.library@1` | 20 份 manifest 里都不存在；实际是 `library.list@1`，`prose` 只供给 `prose.write@1` |
| ADR 0002 §4.3／D8 | 底座硬依赖 `storage.roots／storage.library／prose.changelog` | `BASE_REQUIRES` 只有五个 `base.*`；宿主面的硬依赖挂在 `agentbar`、`library` 两个组合面上 |
| ADR 0002 §2.2 | `comfyui`→`imagegen`、`kb`→`knowledge`（建议） | 未实施，slug 仍是 `comfyui`、`kb` |
| `README.md` 仓结构表 | 14 份 manifest、1 个 kernel；`src/kernel/` 含 fact 链与 enrich；列了 `workflows/` | 20 份、7 个 kernel；fact 与 enrich 已在 `src/modules/fact/`；仓根没有 `workflows/` |
| 看板 D2 行 | `capabilityMigrations.mjs`、`capabilityMigrations.test.mjs` | 文件名是单数 `capabilityMigration.mjs`（看板本次已改） |

## 三、「已收口」的成色（如实记账，不阻塞 push）

D 批交付的是**框架代码＋单元测试**，多数还没有生产调用方。下面的数字都是本次 grep 与探针的结果。

| # | 事实 | 证据 |
|---|---|---|
| B1 | **D2 迁移器没有任何生产调用点**，20 份 manifest 也没有一个声明迁移 | `runCapabilityMigrations`／`declaredCapabilityMigrations` 只有 `test/capabilityMigration.test.mjs` 在调 |
| B2 | D2 的 journal 四态里 `recovered` 从未被写入；`running` 态落盘时 `files` 恒为空，提交中途崩溃后按 journal 恢复不出已写文件（静态推演，未做崩溃注入）；回滚失败被 `.catch(() => {})` 吞掉 | `capabilityMigration.mjs:24,198-199,255-268,204-205` |
| B3 | **能力图与迁移框架两套校验不一致**：同主版本换金样，图放行、框架拒 `3→3`；升到 5，图放行、框架拒 `3→5` | 探针 A1–A4 |
| B4 | **回退供给者被停用时，覆盖者被判 `SELF_OVERRIDE`**，消费者得到 `CAPABILITY_MISSING`，而不是让覆盖者转成普通供给者 | 探针 A6／A7 |
| B5 | **D4 的 slot 注册表与 `slotPlacements()` 没有生产消费方**，前端不读 `slots`／`capabilityReport`，页签仍由 `TAB_REGISTRY` 决定；`activate()` 只有门禁在调 | grep：`slotPlacements(` 仅 `test/slots.test.mjs` |
| B6 | 能力路由只接到 handler 入口；`api／services／host` 另有 38 条经协议转供叶直连内核实现的静态 import，模块之间 11 条 | 转供叶形如 `export * from '../modules/…'` |
| B7 | D3 只升了 `suites/` 的 3/4（`comicdrama` 仍是 legacy 页面模式）；`skills／styles／genres／runtimes` 四个货架没有 manifest | `skills/` 31 个目录零 manifest |
| B8 | D3 的可执行扫描是黑名单（`.mjs/.cjs/.js/.wasm/.sh/.ps1/.bat/.cmd` 与含 `<script>` 的 HTML），漏 `.node/.exe/.svg` 与 HTML 内联事件 | `suites.mjs:85-107` |
| B9 | 「S2.1 跨层直引 0」是按「只准经转供叶」的定义成立的，它量不出 B6 | — |

按 ADR 0003，第三方可执行装载本批不开放，所以 B1、B5 目前不构成线上风险；但看板「D1–D4 已实现」应读作「框架就位、未接线」。B2–B4 是框架自身的缺陷，建议在开门（G1–G5）之前修，OS-188a 列为可选。

## 四、分类与三名一致的漏网（需作者一句话）

| # | 事实 |
|---|---|
| C1 | slug 未归一：`comfyui`（生图与识图）、`kb`（知识库）。ADR 0002 §九 D3 建议 `imagegen`／`knowledge`，未实施 |
| C2 | **「日志」没有 manifest**：分类表列了 12 个工作台，实际 11 个；ADR 0002 §2.2 写「后续登记」 |
| C3 | 页面内部 id 仍是旧词：扮演页 id 是 `deduce`，世界书页 id 是 `reference`，故事源是 `storySource`；图谱节点类型也还叫 `reference`（用户不可见，低） |

## 五、小问题

| # | 问题 | 位置 |
|---|---|---|
| D1 | `LICENSE` 第 9–10 行仍写「`core/` 目录下的底座模块逐字 vendor 自 Pinax-next（见 `core/VENDORED.md`）」，目录与文件都已不存在。许可条款我不动，是否改写由作者定 | `LICENSE:9-10` |
| D2 | `skills/README.md` 还指着 `core/pinax`，谱系门禁给这两句加了白名单而不是改掉；`public/scriptFact.mjs` 的注释同 | `skills/README.md:23-24`、`verify-os172-naming.mjs:33-34` |
| D3 | 首启时若新院不存在、旧院在，仍会从 `%LOCALAPPDATA%/PinaxNext/` 克隆配置到 OpenStory 院子（OS-166 的行为）。这是与 Pinax 最后一个运行时关联，去留由作者定 | `src/modules/storage/courtyard.mjs` |
| D4 | 两个审计脚本仍写 `.pinax/ui-state.json` | `tools/audit/audit-artifacts.mjs:116`、`audit-sync.mjs:81` |
| D5 | OS-172 回报说 `git diff --check` 通过，实际有一处文件尾空行 | `src/host/authorize.mjs:114` |
| D6 | 样例库生成后留了一份 `.openstory/.history/ui-state.json.bak-*`（被忽略、不入库） | `samples/水浒传/.openstory/.history/` |
| D7 | 内置 module@2 套件的归属显示为「OpenStory」，`comicdrama` 的 vendor 是 `skkbsgzf`，两套口径 | `suites.mjs:220` |
| D8 | 迁移框架的 `readFile`／落盘都过 `resolveInsideRoot`，默认拒绝 `.openstory/`，所以能力迁移改不了库内运行态（设计限制，开门前要定） | `capabilityMigration.mjs:122,180` |

## 六、切换到新版时作者会遇到的

1. **8807 上跑的还是 11-24 15:03 启动的旧进程**（早于 OS-166～168 与整个第三批）。本次验收没有重启它：浏览器里若有真库开着，新进程一授权 root 就会触发真库升级，这一步留给作者自己做。
2. 本机没有 `%LOCALAPPDATA%/OpenStory/libraries.json`（新版只认这一份，不再读旧的 `next-preferences.json`，旧清单导入通道也已退役）——升级后库清单是空的，五个库要手动重新添加，添加后各自在首次打开时升级。
3. `水浒传`、`泄密的心` 两个真库同时有 `.openstory/` 与 `.pinax/`，会走合并分支：同名文件保留现有 `.openstory/` 版本，旧的那份加 `.upgrade-<时间戳>` 后缀并入报告。
4. 升级后每个库根会多出 `.pinax.retired-<时间戳>`、`参考.retired-<时间戳>` 等留档目录，`.history/upgrade-<时间戳>/` 另有一份完整备份——旧数据留了两份，确认无误后可自行清理。
5. 升级标记写入后，若旧目录或 `.pinax/` 再度出现（比如旧进程还在写），该库会被拒绝打开并提示检查 `.openstory/upgrade.json`。**先停旧 daemon，再用新版开库。**

## 七、需作者裁定

1. **D 批范围**：规划原文是「D 批动态装载后三类全开放」，实际交付是框架就位、动态装载不开放（ADR 0003 G1–G5）、迁移器与 slot 投影未接线。是否接受这个收口口径。
2. **两个 slug**：`comfyui`→`imagegen`、`kb`→`knowledge` 改不改（建议改；对外端点与 MCP 工具名不动）。
3. **「日志」**：立不立 manifest（建议立，补齐分类表的 12 个工作台）。
4. **`LICENSE` 那两句**：改写成现状，还是保留原文。
5. **首启院子克隆**（D3）：留，还是随「不再关联」一并退役。
6. **ADR 0002 §十**记的是「作者明确要求不再等待旧工单逐项批准」——本次验收以这条记录为前提；若原话不是这个意思，请指出。
7. **提交**：352 个路径全部未提交。建议现在就把第三批整体提交一次先把成果落袋，OS-188a 的修复另成一个提交；要不要拆、何时 push 由作者定。push 前提醒：CI 跑在 `ubuntu-latest`，这套测试只在 Windows 上验证过，Linux 首跑有变数。

## 八、证据

- 脚本与输出在 `D:\Pinax-e2e\.zcode\tmp\`：`accept-d-testaudit.mjs`（测试不放宽审计）、`accept-d-manifests.mjs`（20 份 manifest 对照表）、`accept-d-probes.mjs`（能力图边界、旧库路径改写、隔离 daemon 停用实验）及对应 `.log`；两轮测试日志 `accept-d-tests*.log`；门禁 `accept-d-gates.log`；端到端 `accept-d-e2e.log`。
- 探针全部在系统临时目录运行，跑完即删，不触 8807、真库与真实院子。
