/**
 * OpenStory Host API（OS-142）——host-api@2 显式入口。
 *
 * 这是协议层的**唯一命名空间入口**：插件（三层货架的任何代码）只准 `import` 本文件，
 * 不许直接 import src/protocol/ 下的其他文件或仓内任何别的模块；本仓模块层
 * （src/modules/**）按门禁 S2.1 的路径规则也只准引 node 内置、src/protocol/**（含本
 * 入口与各叶子转供件）和自己模块目录内的文件。
 *
 * 版本约定：HOST_API_VERSION 字面量 `host-api@2`。**只有破坏性变更（删除导出、改签名、
 * 改语义、改错误码）才升版**；纯增量（新命名空间成员）留在当前版本内，但必须同步
 * 改 test/hostApi.test.mjs 的键清单快照与本文件 JSDoc——快照强制每次增删都是显式确认。
 * 版本史：`@1`（OS-142 建档）→ `@2`（OS-155：`fact.deduce` 删除——推演端子归扮演模块
 * `src/modules/deduce/engine/`；OS-157 定稿：再删 `fact.projectImport`／`fact.projectMeta`
 * ——两组能力回归库管理模块内组合，协议层不依赖模块层）。
 *
 * 七个能力命名空间（每个都是冻结对象；落盘只走协议写通道 hostWrite/changelog）：
 *   fact      —— 内核能力通道（`src/kernel/index.mjs` 五键公开面直取）
 *   prose     —— chapters 正文协议（列表/建章/改名/删章＋写备份/.history 保留）
 *   changelog —— 变更日志协议（diff＋月度 jsonl，库内唯一「修改留痕」通道）
 *   jobs      —— 任务中心（进程内任务登记/查询/取消/订阅，重启即清，不落盘）
 *   events    —— agentEvents 的 AG-UI canonical 事件模型＋SSE 帧投影（纯内存，不落盘）
 *   plugins   —— 三层货架能力声明聚合（plugins 只读聚合＋versionGate 版本闸＋dependencyGraph 依赖图）
 *   guard     —— factGuard（fact 上下文只读守卫＋prose 直读审计）
 *
 * 叶子转供件（同在 src/protocol/，属协议层表面；模块层可引，插件不许）：
 *   hostWrite / kernelPlumber / authorize / apiErrors / upstream / worldbookContract /
 *   chapters / chapterWrite / changelog / agentEvents / plugins / versionGate /
 *   dependencyGraph / factGuard / libState——分工见 src/protocol/README.md。
 *
 * 装载序说明：本文件模块求值期只做「取已初始化的绑定＋冻结」，不调用任何能力函数；
 * 依赖子树（kernel/** 公开面→自持内核件）只向下、不含回环到本文件的边，任何装载序都安全
 * （test/hostApi.test.mjs 双向冒烟钉死）。
 */

/** Host API 版本字面量（host-api@2）。破坏性变更才升版，见文件头版本约定。 */
export const HOST_API_VERSION = 'host-api@2'

import * as kernel from '../kernel/index.mjs'
import { KERNEL_CAPABILITIES as K } from './capabilityImplementations.mjs'
import * as changelogProtocol from './changelog.mjs'
import * as jobCenter from '../services/jobCenter.mjs'
import * as agentEventsProtocol from './agentEvents.mjs'
import * as pluginsProtocol from './plugins.mjs'
import * as versionGateProtocol from './versionGate.mjs'
import * as dependencyGraphProtocol from './dependencyGraph.mjs'
import * as factGuardProtocol from './factGuard.mjs'

/** 内核身份（openstory-kernel@1）：供巡检/健康检查直接读取，不属任何命名空间成员。 */
export const KERNEL_ID = kernel.KERNEL_ID

/**
 * fact 命名空间——内核能力通道（OS-157 定稿：host-api@2 五键，直取内核公开面）。
 *
 * 成员（OS-155 删 `deduce`、OS-157 删 `projectImport`／`projectMeta` 后的五个键）：
 *   · enrich             —— enrich 度量：derivePseudoChapters/hasRealChapters/causalSummary。
 *                          纯函数，不落盘。
 *   · factStore          —— fact 存储协议：createFactFileStore/writeFactFile/readFactWiki/
 *                          FACT_DIR_NAME。读只读不落盘；writeFactFile 落盘到
 *                          `<库>/故事源/<id>.json`（operationId 幂等＋expectedRevision 乐观并发），
 *                          错误码 WRITE_PROTOCOL_*（REVISION_MISMATCH/OPERATION_ID_REQUIRED/
 *                          VALIDATION_FAILED/INVALID_INPUT/NOT_FOUND/IO_FAILED）。
 *   · ok / fail          —— 内核 plumber 响应封装（纯内存）。仅 fork 点与内部协议件使用，
 *                          新代码优先用各能力自己的返回形状。
 *   · writeFileAtomic    —— 内核原子写原件（fsync＋rename＋目录 fsync）。落盘。**模块层
 *                          请走 hostWrite.atomicWriteFile（写通道收敛红线），此成员仅供
 *                          协议层内部转供链使用。**
 *
 * 已退出 `@2` 的三组：`deduce`（推演端子归 src/modules/deduce/engine/）、`projectMeta`／
 * `projectImport`（库管理模块内组合，见 src/modules/library/index.mjs）。
 */
const chaptersProtocol = K.proseWrite
const chapterWriteProtocol = K.proseWrite

export const fact = Object.freeze({
  enrich: K.factEnrich,
  factStore: K.factStore,
  fail: kernel.fail,
  ok: kernel.ok,
  writeFileAtomic: kernel.writeFileAtomic
})

/**
 * prose 命名空间——chapters 正文协议（`正文/NNN-标题.md` 约定）＋写备份协议。
 *
 * 成员（chapters.mjs）：
 *   · sanitizeChapterTitle / parseChapterName / chapterFileName —— 章名清洗/文件名解析/
 *                          章节文件名拼装。纯函数，不落盘。
 *   · listChapters(root, dir) —— 只读列举（返回章列表＋编号/标题）；NOT_FOUND 走 PATH_ESCAPE 口径。
 *   · nextChapterNumber(chapters) —— 纯函数下一个章号（不猜已占用号）。
 *   · createChapter(root, dir, title) —— 落盘新章（模板头＋编号占用检查）。
 *   · renameChapter(root, file, title) —— 落盘改名（保留章号，rename＋记录）。
 *   · deleteChapter(root, file) —— 落盘删除（挪 .history 备份，不物理销毁）。
 * 成员（chapterWrite.mjs）：
 *   · writeChapterWithBackup(root, file, newText, logOptions) —— 正文写唯一通道：原子写＋
 *                          写前 .history 备份＋changelog 记录。落盘。
 *   · historyBackupPath / pruneHistoryBackups / resolveHistoryKeepPerFile / HISTORY_KEEP_DEFAULT
 *                          —— 备份路径计算＋每文件配额滚动清理（落盘：删超额备份）。
 *   · mapWriteErrorCode    —— IO 错误码映射（WRITE_PROTOCOL_IO_FAILED 等，纯函数）。
 *   · moduleOfPath         —— 库内路径 → 模块名（changelog 维度用，纯函数）。
 */
export const prose = Object.freeze({
  sanitizeChapterTitle: chaptersProtocol.sanitizeChapterTitle,
  parseChapterName: chaptersProtocol.parseChapterName,
  chapterFileName: chaptersProtocol.chapterFileName,
  listChapters: chaptersProtocol.listChapters,
  nextChapterNumber: chaptersProtocol.nextChapterNumber,
  createChapter: chaptersProtocol.createChapter,
  renameChapter: chaptersProtocol.renameChapter,
  deleteChapter: chaptersProtocol.deleteChapter,
  historyBackupPath: chapterWriteProtocol.historyBackupPath,
  HISTORY_KEEP_DEFAULT: chapterWriteProtocol.HISTORY_KEEP_DEFAULT,
  resolveHistoryKeepPerFile: chapterWriteProtocol.resolveHistoryKeepPerFile,
  pruneHistoryBackups: chapterWriteProtocol.pruneHistoryBackups,
  mapWriteErrorCode: chapterWriteProtocol.mapWriteErrorCode,
  moduleOfPath: chapterWriteProtocol.moduleOfPath,
  writeChapterWithBackup: chapterWriteProtocol.writeChapterWithBackup
})

/**
 * changelog 命名空间——变更日志协议（库内唯一「修改留痕」通道，OS-89）。
 *
 * 存储 `<库>/.openstory/log/<模块>/<yyyy-mm>.jsonl`，append-only，一行一记录（hash 链）。
 *   · recordChange({ root, module, file, before, after, … }) —— 落盘追加一条 diff 记录
 *                          （unified diff＋contentHash；写通道红线：所有模块的修改留痕只经此）。
 *   · logFilePath(module, now) / LOG_DIR —— 日志路径与目录常量（纯函数/常量）。
 *   · safeModuleName / contentHash / unifiedDiff —— 归一与 diff 纯函数。
 *   · readLog / readLatestByFile / readChange / findRestoreCandidate —— 只读检索
 *                          （按模块/文件/时间点；afterHash 断链校验）。
 *   · hasLog / logSummary  —— 只读存在性与摘要。
 * 错误码：IO 失败原样抛（调用方映射 WRITE_PROTOCOL_IO_FAILED 口径）。
 */
export const changelog = Object.freeze({
  LOG_DIR: changelogProtocol.LOG_DIR,
  safeModuleName: changelogProtocol.safeModuleName,
  contentHash: changelogProtocol.contentHash,
  unifiedDiff: changelogProtocol.unifiedDiff,
  logFilePath: changelogProtocol.logFilePath,
  recordChange: changelogProtocol.recordChange,
  readLog: changelogProtocol.readLog,
  readLatestByFile: changelogProtocol.readLatestByFile,
  hasLog: changelogProtocol.hasLog,
  logSummary: changelogProtocol.logSummary,
  readChange: changelogProtocol.readChange,
  findRestoreCandidate: changelogProtocol.findRestoreCandidate
})

/**
 * jobs 命名空间——全局后台任务中心（OS-80，进程内注册表）。
 *
 * 单一进程内 Map：任务不跨 daemon 重启存活（有意的——不留幽灵进度条）；**不落盘**。
 *   · submitJob({ kind, label, root, run }) —— 登记＋执行：返回 job 句柄（id/state/progress…），
 *                          run 为调用方给的 async 执行器，自己 update。
 *   · getJob(id) / listJobs({ root, kind, state, limit }) / activeCount({ root }) —— 只读查询。
 *   · cancelJob(id)        —— 置 cancelled＋AbortController.signal（执行器自己响应）。
 *   · clearSettled({ root}) —— 清已完成/失败/取消的记录（内存清理）。
 *   · subscribe(fn)        —— 状态变化回调订阅（SSE 用）。
 * 错误码：未知 id 查询给 null、取消给 ok:false，不抛。
 */
export const jobs = Object.freeze({
  submitJob: jobCenter.submitJob,
  getJob: jobCenter.getJob,
  listJobs: jobCenter.listJobs,
  cancelJob: jobCenter.cancelJob,
  clearSettled: jobCenter.clearSettled,
  activeCount: jobCenter.activeCount,
  subscribe: jobCenter.subscribe
})

/**
 * events 命名空间——Agent 事件模型与 SSE 投影（agentEvents，OS-131 AG-UI 接入）。
 *
 * 内部事件 canonical 化，SSE 帧是投影；纯内存编码，**不落盘**。
 *   · AGENT_EVENT_TYPES / AGENT_EVENT_TYPES_SSE —— 事件类型词表（冻结数组）。
 *   · AGENT_EVENT_AGUI_KINDS —— 内部类型 → AG-UI kind 映射（冻结表）。
 *   · encodeForAgui(event, ctx) —— canonical 事件 → AG-UI SSE 帧。
 *   · projectLegacyFrame(event) —— 旧版帧 → canonical 事件投影。
 */
export const events = Object.freeze({
  AGENT_EVENT_TYPES: agentEventsProtocol.AGENT_EVENT_TYPES,
  AGENT_EVENT_TYPES_SSE: agentEventsProtocol.AGENT_EVENT_TYPES_SSE,
  AGENT_EVENT_AGUI_KINDS: agentEventsProtocol.AGENT_EVENT_AGUI_KINDS,
  encodeForAgui: agentEventsProtocol.encodeForAgui,
  projectLegacyFrame: agentEventsProtocol.projectLegacyFrame
})

/**
 * plugins 命名空间——三层货架能力声明聚合（业务套件/技能/运行时 kit）。
 *
 * 只读聚合层（读货架目录与 manifest），宿主 daemon 与设置页共用同一份清单口径；
 * 除 versionGate 缓存重置外**不落盘**。
 * 成员（plugins.mjs）：
 *   · PLUGIN_KINDS / KIND_LABELS —— 货架层词表（冻结）。
 *   · listAllPlugins({ suitesDirs, suiteStatePath, skillsDirs, runtimesDirs })
 *                          —— 三层货架只读聚合；坏档跳过＋warning 不拖垮货架。
 *   · pluginDetail(opts, kind, id) / listBlockedPlugins(opts) / pluginHealth(opts)
 *                          —— 详情/停用清单/健康度（只读；suiteStatePath 读停用状态）。
 *   · suiteAssetPath(plugin, which) —— 套件资产路径解析（纯函数）。
 * 成员（versionGate.mjs，插件规范共用的版本比对协议）：
 *   · readAppVersion(repoRoot) / resetAppVersionCache() —— 宿主版本读取（带缓存）＋缓存重置。
 *   · satisfiesMinVersion(required, current) —— 语义比对（纯函数）。
 *   · minVersionGate(required, current, { prefix, label, where }) —— 门禁判定对象
 *                          （ok:false 时 message 带「升级宿主」指引，不抛）。
 * 成员（dependencyGraph.mjs）：
 *   · resolveSuiteDependencies(suites) —— 套件依赖闭包解析（环检测＋拓扑序，纯函数）。
 */
export const plugins = Object.freeze({
  PLUGIN_KINDS: pluginsProtocol.PLUGIN_KINDS,
  KIND_LABELS: pluginsProtocol.KIND_LABELS,
  listAllPlugins: pluginsProtocol.listAllPlugins,
  pluginDetail: pluginsProtocol.pluginDetail,
  listBlockedPlugins: pluginsProtocol.listBlockedPlugins,
  pluginHealth: pluginsProtocol.pluginHealth,
  suiteAssetPath: pluginsProtocol.suiteAssetPath,
  readAppVersion: versionGateProtocol.readAppVersion,
  resetAppVersionCache: versionGateProtocol.resetAppVersionCache,
  satisfiesMinVersion: versionGateProtocol.satisfiesMinVersion,
  minVersionGate: versionGateProtocol.minVersionGate,
  resolveSuiteDependencies: dependencyGraphProtocol.resolveSuiteDependencies
})

/**
 * guard 命名空间——fact 守卫（factGuard：FACT-FIRST 红线的协议层落点）。
 *
 * fact 只读上下文装配＋prose 直读审计；除审计清单重置外**不落盘**（fact 读取本身只读）。
 *   · CONTEXT_SOURCE —— 上下文来源词表（冻结）。
 *   · factHealth(root) —— fact 健康度（只读；无数据如实报 stale:false/count:0，不伪造）。
 *   · loadFactContext({ root, chapterNo, limit }) —— 正文写作的 fact 上下文装配（只读）。
 *   · loadFactDerived({ root, bookId }) —— 故事源派生只读。
 *   · PROSE_DIRECT_READS / allowProseDirectRead({ caller, reason })
 *                          —— prose 直读审计：默认拒绝（空清单），点名放才放行并留审计计数
 *                          （内存）；resetProseAudit() 供测试清零。
 */
export const guard = Object.freeze({
  CONTEXT_SOURCE: factGuardProtocol.CONTEXT_SOURCE,
  factHealth: factGuardProtocol.factHealth,
  loadFactContext: factGuardProtocol.loadFactContext,
  loadFactDerived: factGuardProtocol.loadFactDerived,
  PROSE_DIRECT_READS: factGuardProtocol.PROSE_DIRECT_READS,
  allowProseDirectRead: factGuardProtocol.allowProseDirectRead,
  resetProseAudit: factGuardProtocol.resetProseAudit
})
