# src/protocol —— Host API（host-api@2）

协议层是宿主能力的**唯一对外表面**：一个显式入口（`index.mjs`）＋一组叶子协议件。
版本字面量 `host-api@2`（`src/protocol/index.mjs` 的 `HOST_API_VERSION`；`@2` ＝ OS-155 删除
`fact.deduce`（推演端子归扮演模块）、OS-157 再删 `fact.projectImport`／`fact.projectMeta`
（回归库管理模块内组合）——协议层不依赖产品模块，五键在段末定稿）。

## 谁准 import 什么

| 谁 | 准许 |
|---|---|
| 插件（三层货架任何代码） | **只准 import `src/protocol/index.mjs`**（七命名空间入口），不许引仓内其他任何模块 |
| 模块层 `src/modules/**` | 只准三类：node 内置模块（`node:` 前缀）、`src/protocol/**`、自己模块目录内文件（门禁 S2.1 路径规则，静态 `from` 与动态 `import()` 都扫） |
| API/宿主层（`src/api`、`src/host`） | 可用全仓面；内核能力走 `src/kernel/index.mjs` 公开面（S2.4'：内核实现只在 `src/kernel/`） |
| `src/kernel/**` | OpenStory 自有内核，实现只在此一处；上游出处见 `docs/kernel-provenance.md` |

## 能力清单（七命名空间，全部冻结对象，JSDoc 见 index.mjs）

| 命名空间 | 来源 | 能力 | 落盘 |
|---|---|---|---|
| `fact` | `src/kernel/index.mjs` 五键公开面 | enrich（度量）、factStore（fact 存储）、fail/ok（内核响应封装）、writeFileAtomic（原子写原件）。**推演端子/项目合同/整目录导入均不在其中**（OS-155/157 起分别归扮演模块与库管理模块） | writeFactFile/writeFileAtomic 落盘；读全部只读 |
| `prose` | chapters.mjs＋chapterWrite.mjs | 正文 `NNN-标题.md` 协议：list/create/rename/delete＋writeChapterWithBackup＋.history 保留策略 | create/rename/delete/write 落盘；.history 备份；changelog 留痕 |
| `changelog` | changelog.mjs | 库内唯一修改留痕通道：recordChange＋readLog/readChange 等（diff＋月度 jsonl） | recordChange 落盘 `.pinax/log/<模块>/<yyyy-mm>.jsonl`；读只读 |
| `jobs` | services/jobCenter.mjs | 任务中心：submit/get/list/cancel/clearSettled/activeCount/subscribe | **不落盘**（进程内，重启即清） |
| `events` | agentEvents.mjs | AG-UI canonical 事件模型＋SSE 帧投影：encodeForAgui/projectLegacyFrame＋类型词表 | **不落盘**（纯内存编码） |
| `plugins` | plugins.mjs＋versionGate.mjs＋dependencyGraph.mjs | 三层货架能力声明：只读聚合/详情/健康度＋宿主版本闸＋套件依赖闭包 | 只读（suiteStatePath 读停用状态，不写） |
| `guard` | factGuard.mjs | FACT-FIRST 守卫：fact 上下文只读装配＋prose 直读审计（默认拒绝、点名放行） | 只读；审计计数在内存 |

## 叶子转供件（模块层可引，插件仍只准走 index.mjs）

| 文件 | 转出什么 | 给谁用 |
|---|---|---|
| `hostWrite.mjs` | 宿主写协议唯一入口 `atomicWriteFile`（OS-138：tmp＋fsync＋rename＋目录 fsync；二进制分支）。实现直取 `src/kernel/atomicWrite.mjs`／`src/kernel/fsDurability.mjs` | 全仓落盘一律经它（写通道红线） |
| `kernelPlumber.mjs` | `ok`/`fail`/`writeFileAtomic` 原名转供。实现直取 `src/kernel/errors.mjs`／`src/kernel/atomicWrite.mjs` | **仅 projectDoc/importAdapter 两个 OS-123 fork 点**（函数体逐字不动，import 重指向）；新代码一律走 `fact` 命名空间 |
| `authorize.mjs` | 宿主路径授权：canonicalRoot/pathFail/text/METADATA_DIR/resolveInsideRoot | 模块层（inventory、turnProse…） |
| `apiErrors.mjs` | `API_ERROR_CODES` 错误码词表 | 模块层构建响应失败对象 |
| `upstream.mjs` | 上游模型通道：chatCompleteViaUpstream/resolveUpstreamSafe/resolveChatUpstream | 模块层（turnProse） |
| `worldbookContract.mjs` | 世界书文件契约 `parseWorldbookEntryFile`（实现在世界书模块，本体不直引） | textUtil；护栏测试直引实现本体 |
| `chapterNumber.mjs` | 章节号解析纯函数（OS-157 从 textUtil 上移） | chapters.mjs；textUtil 经此转出 |
| `modules.mjs` | 模块插件（OS-144）：manifest 装载/形状校验、端点归属 `MODULE_ENDPOINT_OWNERS`、启停唯一入口 `isModuleEnabled` / `isModuleDisabledFor`（ui-state `modules.enabled.<id>`） | daemon 路由停用闸、MCP 分析工具、API handler（扮演 AI 味闸） |
| `naming.mjs` | 五层命名单一真源（OS-148）：`NAMING_TABLE` / `LOG_MODULES` / `namingEntry` / `logModuleForDir`（目录→日志模块名）/ `PAGE_TO_DIR_LOCAL`（页签名→目录名，OS-150a 起 genres 也走这里），**从 `public/views/registry.mjs` 原样 re-export** | 写通道（chapterWrite 的 moduleOfPath）、各模块写日志取 `LOG_MODULES`、推演会话目录名、体裁裁剪（genres.excludedDirNames） |
| `chapters.mjs` 等 | 各协议件本体（index.mjs 聚合它们的导出） | 协议层内部与 API/宿主层 |
| `factDomain.mjs` | fact 域原语＋`buildFactPack` 的**只 re-export** 转供面（实现真源 `src/kernel/fact/domain/index.mjs`／`src/kernel/fact/factPack.mjs`） | 推演引擎（`src/modules/deduce/engine/`）——模块不许直引 `src/kernel/**`（S2.1），这是唯一不开口子的取数路径（OS-155） |
| `courtyard.mjs` | 本机院子唯一路径来源：`courtyardBase/Root/Path`、`ensureCourtyard`、`legacyCourtyardPath`；首启只拷贝旧院（跳 `*.tmp-*`/`daemon.lock`）并留迁移标记（OS-166） | 模块层与 services 层的本机路径解析（agentStore/kbAdapter/genres/nativePicker/runtimes/skills/stylePacks/suites/systemPrompt/uiPreferences）；`src/host/courtyard.mjs` 只做原样转供 |
| `libraryManifest.mjs` | 自持库清单（OS-167）：`libraries.json` 读写＋旧 Pinax `next-preferences.json` 只读扫描/勾选导入；`source=openstory\|imported-pinax`，绝不写回旧清单 | 宿主 `authorize.mjs` 的 root 白名单源、library 模块的登记与两个导入端点；互认仍靠库内 `.pinax/project.json` |

## 版本约定

- **只有破坏性变更才升版**（`host-api@1` → `host-api@2`）：删除命名空间成员、改函数签名、改语义、改错误码词表。现行版本 `host-api@2`，五键形状在 OS-157 定稿。
- 纯增量（新命名空间成员）留在当前版本内，但必须同批改两处：`test/hostApi.test.mjs` 的
  键清单快照（改快照＝显式确认）＋本文件能力清单。
- `HOST_API_VERSION` 是字面量，不许动态拼接；快照测试钉死它是 `host-api@2`。

## 豁免台账（门禁显式点名，不许静默放过）

| 豁免 | 原因 | 去向 |
|---|---|---|
| `src/modules/roleplay/roleplayEngine.mjs → public/analysis.mjs`（analyzeChapter 算「AI 味」） | 纯函数分析，浏览器侧同源实现（public/analysis.mjs 同时服务前端页面）；`public/**` 是浏览器直载面，不适合被 protocol 反向依赖 | 下沉到协议层留后续批次（届时改走协议层并删豁免） |
| `src/protocol/naming.mjs → public/views/registry.mjs`（OS-148：表＋查表纯函数） | 命名表必须同时被浏览器（注册表派生 DIR_LABELS/页签名）与 Node（写通道推断日志模块名）消费，而浏览器拿不到 `src/`；注册表有「零 import」纯度门禁不能再把表拆成独立 public 模块。被引文件是零 import／零 DOM／零存储的纯数据＋纯函数，等同数据文件（先例：daemon 直引 `public/analysis.mjs`） | 表仍只有一份；若将来拆出真正的前端/后端共享数据层（OS-132 式收编），这条边随之消失 |

除此以外 `src/modules/**` 不得出现三类来源（node 内置 / `src/protocol/**` / 模块目录内）
之外的任何 import——门禁 S2.1 直接红，证据带 file:line。

## 内核接触面（S2.4'）

`src/**` 与仓根两个垫片不得出现 `core/` 路径说明符（防陈旧 import 回潮）；内核实现只在
`src/kernel/**`。`src/protocol/**` 中 `factGuard.mjs` 与 `index.mjs` 直取 `src/kernel/index.mjs`
公开面，`kernelPlumber.mjs`／`hostWrite.mjs` 直取 `src/kernel/` 管道件——没有单点适配器，
门禁按这条全树规则判定，不再维护豁免清单。
