/**
 * OS-197：能力迁移进入真实链路——按库执行一次、失败剔除覆盖者、已落新格式可查。
 *
 * 这里是唯一的生产调用口（由 moduleRuntime 的快照路径调用）：
 *   · 声明来自当前层 manifests（本机覆盖者的 `migrations`），包目录按层内 source 记录解析；
 *   · 该库启用中的覆盖者才迁移；dormant 的声明不碰数据；
 *   · 幂等由 `capabilityMigration.runCapabilityMigrations` 的 journal `done` 负责；
 *   · 失败结果缓存到下一次层／启停变化或 daemon 重启，期间覆盖者从该库快照剔除。
 */
import { createHash } from 'node:crypto'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { API_ERROR_CODES } from '../protocol/apiErrors.mjs'
import { BASE_GRAPH } from '../protocol/baseCapabilities.mjs'
import { buildCapabilitySnapshot, readModuleEnabled } from '../protocol/capabilityGraph.mjs'
import {
  dataAheadFrom, declaredCapabilityMigrations, planCapabilityMigration, readMigrationJournalFile,
  runCapabilityMigrations, validateCapabilityMigration
} from '../protocol/capabilityMigration.mjs'
import { readUiState } from '../protocol/libState.mjs'
import { diagnoseLibraryUpgrade, isLegacyLibraryRoot, readUpgradeStatus, upgradeLibrary } from '../protocol/libraryUpgrade.mjs'
import { METADATA_DIR, canonicalRoot } from '../protocol/rootPath.mjs'
import { logFilePath } from '../protocol/changelog.mjs'
import { LOG_MODULES } from '../protocol/naming.mjs'
import { readShelfSuiteState } from '../protocol/shelfManifests.mjs'
import { buildPlan, diffPlanBindings, rootFingerprint, semanticPlan, stableJson } from '../protocol/upgradePlan.mjs'

export const MIGRATION_STATUS_SPEC = 'openstory.migration-status/v1'
export const MIGRATION_BACKUP_SPEC = 'openstory.migration-backup-report/v1'

const text = (value) => String(value ?? '')
const states = new Map()

function migrationPackageDir(source, id) {
  if (source?.source !== 'local') return null
  const root = text(source.sourceDir).trim()
  return root ? join(root, id) : null
}

/**
 * 已 done 的 journal → 数据版本。执行路径、只读计划与状态端点共用这一份读法
 * （底层逐份 journal 解析统一走 `readCapabilityJournals`，不另立第二套真源）。
 * `journalPath` 保持绝对路径以兼容既有调用方；对外响应在状态端点里改写成库内相对路径。
 */
export async function readDataVersions(root, { journals = null } = {}) {
  const rootKey = canonicalRoot(root)
  const records = journals ?? await readCapabilityJournals(rootKey)
  return records
    .filter((item) => item.state === 'done' && Number.isInteger(item.to))
    .map((item) => ({
      capability: item.capability,
      from: item.from,
      to: item.to,
      plugin: item.plugin,
      journalPath: join(rootKey, ...item.path.split('/')),
      finishedAt: item.finishedAt,
      files: item.files.map((file) => file.path).filter(Boolean)
    }))
}

async function enabledMap(root, manifests) {
  if (!manifests.some((manifest) => (manifest?.migrations ?? []).length)) return {}
  try {
    const { state } = await readUiState(root)
    return Object.fromEntries(manifests.map((manifest) => [manifest.id, readModuleEnabled(state ?? {}, manifest.id)]))
  } catch {
    return Object.fromEntries(manifests.map((manifest) => [manifest.id, true]))
  }
}

async function execute(root, layer, enabled, declared) {
  const result = await runCapabilityMigrations({ root, migrations: declared })
  return {
    ok: result.ok,
    root,
    ran: result.ran,
    skipped: result.skipped,
    failures: result.failures,
    excluded: result.disable,
    migrations: declared.map((item) => ({
      plugin: item.plugin,
      capability: item.capability,
      from: item.from,
      to: item.to,
      entry: item.entry
    })),
    dataVersions: await readDataVersions(root),
    fresh: false
  }
}

function cacheKey(rootKey, layer, enabled) {
  return [rootKey, layer.id, JSON.stringify(enabled)].join('\u0000')
}

/**
 * 准备某库的迁移状态。同一根＋同一层＋同一启停组合只跑一次；层或启停一变就重算
 * （失败后作者停用覆盖者、或下一次 daemon 重开时按 journal 恢复重试）。
 */
export async function prepareLibraryMigrations(root, layer) {
  if (!root) return { ok: true, root: '', ran: [], skipped: [], failures: [], excluded: [], migrations: [], dataVersions: [], fresh: false }
  const rootKey = canonicalRoot(root)
  const enabled = await enabledMap(rootKey, layer.manifests ?? [])
  const sources = new Map((layer.sources ?? []).map((source) => [source.id, source]))
  const declared = declaredCapabilityMigrations(
    (layer.manifests ?? []).filter((manifest) => enabled[manifest.id] !== false),
    (id) => migrationPackageDir(sources.get(id), id)
  )
  // 没有声明就不缓存：已迁数据的取数必须反映当前 journal（比如覆盖者刚被移除）。
  if (!declared.length) {
    const prefix = `${rootKey}\u0000${layer.id}\u0000`
    for (const stale of states.keys()) if (stale.startsWith(prefix)) states.delete(stale)
    return {
      ok: true, root: rootKey, ran: [], skipped: [], failures: [], excluded: [],
      migrations: [], dataVersions: await readDataVersions(rootKey), fresh: false
    }
  }
  const key = cacheKey(rootKey, layer, enabled)
  const existing = states.get(key)
  if (existing?.promise) return { ...(await existing.promise), fresh: false }
  if (existing) return { ...existing, fresh: false }
  const layerPrefix = `${rootKey}\u0000${layer.id}\u0000`
  for (const stale of states.keys()) {
    if (stale.startsWith(layerPrefix) && stale !== key) states.delete(stale)
  }
  const entry = { promise: execute(rootKey, layer, enabled, declared) }
  states.set(key, entry)
  const base = await entry.promise
  states.set(key, { ...base, key })
  return { ...base, fresh: true }
}

/** 测试与重启口径：清掉某库（或全部）的迁移状态缓存。 */
export function resetLibraryMigrations(root = '') {
  if (!root) {
    states.clear()
    return
  }
  const prefix = `${canonicalRoot(root)}\u0000`
  for (const key of states.keys()) if (key.startsWith(prefix)) states.delete(key)
}

/* ================================================================
 * OS-220：只读能力迁移计划（不写 journal、不建备份、不跑提交）。
 * ================================================================ */

/**
 * 该库在给定层下的能力迁移计划。与 `prepareLibraryMigrations` 的差别只有一个：
 * 这里只问「会做什么」，`planCapabilityMigration` 用只读上下文跑迁移器，
 * 不落 journal、不建 `.history`、不动任何业务文件。
 * 路由表来自「不排除任何覆盖者」的快照——预览要看的是执行前的真实归属。
 */
export async function planLibraryMigrations(root, layer, { now = () => new Date() } = {}) {
  const rootKey = canonicalRoot(root)
  const empty = { ok: true, root: rootKey, migrations: [], dataVersions: [], dataAhead: [], risks: [] }
  if (!rootKey) return empty
  const enabled = await enabledMap(rootKey, layer.manifests ?? [])
  const sources = new Map((layer.sources ?? []).map((source) => [source.id, source]))
  const declared = declaredCapabilityMigrations(
    (layer.manifests ?? []).filter((manifest) => enabled[manifest.id] !== false),
    (id) => migrationPackageDir(sources.get(id), id)
  )
  const dataVersions = await readDataVersions(rootKey)
  // OS-222 P1：路由快照必须先建，DATA_VERSION_AHEAD 才能按真实供给者版本算。
  // 原实现在「本层无声明」时用空路由表 dataAheadFrom({}, …) 恒返回空，导致路由已回落
  // 旧 provider 的库 plan.dataAhead 为空、apply 误报 success（降级场景未拦）。
  const { state } = await readUiState(rootKey).catch(() => ({ state: {} }))
  const snapshot = buildCapabilitySnapshot({
    manifests: layer.manifests ?? [],
    sources: layer.sources ?? [],
    state: state ?? {},
    suiteState: readShelfSuiteState({ root: rootKey }),
    base: BASE_GRAPH,
    warnings: layer.warnings ?? []
  })
  const routes = snapshot.routes ?? {}
  if (!declared.length) return { ...empty, dataVersions, dataAhead: dataAheadFrom(routes, dataVersions) }
  const migrations = []
  for (const migration of declared) {
    migrations.push(await planCapabilityMigration(rootKey, migration, { now, routes }))
  }
  const risks = []
  const done = migrations.filter((item) => item.status === 'done')
  if (done.length) risks.push(`${done.length} 条能力迁移已完成（journal done），重复执行按幂等跳过`)
  const invalid = migrations.filter((item) => item.status === 'invalid')
  if (invalid.length) risks.push(`${invalid.length} 条能力迁移声明/迁移器无效：现在执行不会成功`)
  const dataAhead = dataAheadFrom(routes, dataVersions)
  if (dataAhead.length) risks.push(`${dataAhead.length} 处数据版本超前于当前供给者：不得降级覆盖`)
  return {
    ok: invalid.length === 0,
    root: rootKey,
    migrations,
    dataVersions,
    dataAhead,
    risks
  }
}

/* ================================================================
 * OS-220：整库只读升级计划（旧库一次性升级 ＋ 能力迁移两节）。
 * ================================================================ */

/**
 * 组装一份完整计划：`sections.libraryUpgrade` 来自 `libraryUpgrade.diagnoseLibraryUpgrade`，
 * `sections.capabilityMigrations` 与 `sections.dataAhead` 来自本文件的只读规划。
 * planId 绑定受影响文件摘要＋迁移器入口摘要（`bindings`），执行前重算即可发现漂移。
 * 本函数不写盘：只读判定全部落在 `diagnoseLibraryUpgrade` / `planCapabilityMigration`。
 */
export async function buildLibraryUpgradePlan(root, layer, { now = new Date() } = {}) {
  const rootKey = canonicalRoot(root)
  const library = await diagnoseLibraryUpgrade(rootKey, { now })
  const capability = await planLibraryMigrations(rootKey, layer, { now: () => now })
  const sections = {
    libraryUpgrade: library,
    // OS-222 P1：把 capability 的判定 ok 与阻断信息带进 sections，使 planId 绑定它们；
    // apply 直接据此拒绝 invalid/dataAhead，不再静默跳过或误报 success。
    capability: { ok: capability.ok === true, root: capability.root },
    capabilityMigrations: capability.migrations ?? [],
    dataAhead: capability.dataAhead ?? []
  }
  const bindings = [
    ...(library.bindings ?? []),
    ...(capability.migrations ?? []).flatMap((item) => {
      const rows = []
      if (item.entrySha256) rows.push({
        id: `migrator:${item.plugin}:${item.capability}:${item.from}->${item.to}`,
        path: item.entry,
        sha256: item.entrySha256
      })
      // 迁移器可能读操作范围之外的业务文件；这些文件同样进入 planId，
      // 否则预览后数据变化仍可能拿到旧 beforeHash 执行覆盖写。
      for (const operation of item.operations ?? []) {
        if (!operation?.path || !operation.beforeHash) continue
        rows.push({
          id: `capability-file:${item.plugin}:${item.capability}:${item.from}->${item.to}:${operation.path}`,
          path: operation.path,
          sha256: operation.beforeHash
        })
      }
      return rows
    })
  ]
  const risks = [...new Set([
    ...(library.risks ?? []),
    ...(capability.risks ?? []),
    ...(library.blocking ? [`旧库升级被阻断：${library.blocking}`] : [])
  ])]
  return buildPlan({ kind: 'library-upgrade', rootPath: rootKey, sections, risks, bindings, now })
}

/* ================================================================
 * OS-221：迁移状态与备份的**只读**观测（专用端点真源）。
 *
 * 与 `prepareLibraryMigrations` 的分界（关键）：那条路径会**真实执行**能力迁移、
 * 写 journal、建 `.history` 备份。状态/备份读取一律禁止走它——这里只读
 * journal 文件、upgrade marker、`.history` 备份清单与 `dataVersions`，
 * 不 mkdir、不写盘、不 import 迁移器、不跑迁移。
 * ================================================================ */

const HISTORY_DIR = '.history'
const CAPABILITY_JOURNAL_STATES = new Set(['running', 'done', 'failed', 'recovered'])

const sha256Bytes = (bytes) => createHash('sha256').update(bytes).digest('hex')
const posixOf = (value) => String(value ?? '').replaceAll('\\', '/')

async function readFileIfExists(path) {
  try {
    return await readFile(path)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

async function statIfExists(path) {
  try {
    return await stat(path)
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return null
    throw error
  }
}

/**
 * 备份相对路径的合法性：只认 `.history/` 之下、无 `..`、无盘符/绝对路径的库内相对路径。
 * journal 里的 `backupPath` 是历史写入值，读侧仍要按同一口径复核——坏值只报
 * MIGRATION_BACKUP_PATH_INVALID，绝不拿它去拼任意磁盘路径。
 */
function safeHistoryRelative(rootKey, value) {
  const raw = posixOf(value).trim()
  if (!raw || raw.includes('\0')) return null
  if (raw.startsWith('/') || /^[a-zA-Z]:\//u.test(raw)) return null
  const parts = raw.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return null
  if (parts[0] !== HISTORY_DIR || parts.length < 2) return null
  if (!parts[1].startsWith('capability-') && !parts[1].startsWith('upgrade-')) return null
  return join(canonicalRoot(rootKey), ...parts)
}

/** `.openstory/migrations/**` 下全部 journal 文件的相对路径（只 readdir，不建目录）。 */
async function listJournalFiles(rootKey, { issues = [] } = {}) {
  const dir = join(rootKey, METADATA_DIR, 'migrations')
  const out = []
  let capabilities = []
  try {
    capabilities = await readdir(dir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return out
    issues.push({ code: API_ERROR_CODES.MIGRATION_JOURNAL_CORRUPT, severity: 'error', scope: 'journal', path: `${METADATA_DIR}/migrations`, message: `迁移目录不可读：${text(error?.message || error)}` })
    return out
  }
  for (const capabilityDir of capabilities) {
    if (!capabilityDir.isDirectory()) continue
    let entries = []
    try {
      entries = await readdir(join(dir, capabilityDir.name), { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') continue
      issues.push({ code: API_ERROR_CODES.MIGRATION_JOURNAL_CORRUPT, severity: 'error', scope: 'journal', path: `${METADATA_DIR}/migrations/${capabilityDir.name}`, message: `迁移目录不可读：${text(error?.message || error)}` })
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      out.push({
        capability: capabilityDir.name,
        name: entry.name,
        path: join(dir, capabilityDir.name, entry.name),
        relative: `${METADATA_DIR}/migrations/${capabilityDir.name}/${entry.name}`
      })
    }
  }
  out.sort((left, right) => left.relative.localeCompare(right.relative))
  return out
}

/** 文件名 `<from>-to-<to>.json` → 版本号（journal 自身字段缺省时的兜底）。 */
function versionsFromJournalName(name) {
  const match = /^(\d+)-to-(\d+)\.json$/u.exec(name)
  if (!match) return { from: null, to: null }
  return { from: Number(match[1]), to: Number(match[2]) }
}

/**
 * capability journal 全量状态（每份 journal 一条）：done/running/failed/recovered 原样报，
 * 坏档报 `corrupt` 并附类型化 issue，绝不折成「没有迁移」。
 */
export async function readCapabilityJournals(root, { issues = [] } = {}) {
  const rootKey = canonicalRoot(root)
  const records = []
  for (const file of await listJournalFiles(rootKey, { issues })) {
    const read = await readMigrationJournalFile(file.path)
    const fallback = versionsFromJournalName(file.name)
    if (read.state === 'corrupt') {
      issues.push({
        code: API_ERROR_CODES.MIGRATION_JOURNAL_CORRUPT,
        severity: 'error',
        scope: 'journal',
        path: file.relative,
        message: read.message
      })
      records.push({
        capability: file.capability, from: fallback.from, to: fallback.to,
        plugin: '', state: 'corrupt', path: file.relative, message: read.message
      })
      continue
    }
    const journal = read.journal
    const state = text(journal?.state) || 'unknown'
    if (!CAPABILITY_JOURNAL_STATES.has(state)) {
      issues.push({
        code: API_ERROR_CODES.MIGRATION_JOURNAL_CORRUPT,
        severity: 'error',
        scope: 'journal',
        path: file.relative,
        message: `journal 状态不可识别：${state}`
      })
    }
    const files = Array.isArray(journal?.files) ? journal.files : []
    const record = {
      capability: text(journal?.capability) || file.capability,
      from: Number.isInteger(journal?.from) ? journal.from : fallback.from,
      to: Number.isInteger(journal?.to) ? journal.to : fallback.to,
      plugin: text(journal?.plugin),
      state,
      path: file.relative,
      operationId: text(journal?.operationId),
      entry: text(journal?.entry),
      entrySha256: text(journal?.entrySha256),
      startedAt: text(journal?.startedAt),
      finishedAt: text(journal?.finishedAt),
      recoveredAt: text(journal?.recoveredAt),
      backupPath: text(journal?.backupPath),
      fileCount: files.length,
      committedCount: files.filter((item) => item?.committed !== false).length,
      files: files.map((item) => ({
        path: text(item?.path),
        beforeHash: item?.beforeHash === null || item?.beforeHash === undefined ? null : text(item.beforeHash),
        afterHash: item?.afterHash === null || item?.afterHash === undefined ? null : text(item.afterHash),
        backup: text(item?.backup),
        committed: item?.committed !== false
      })),
      error: text(journal?.error),
      // 旧 failed journal 没有 rolledBack 字段时，执行/观测口径都按「已回滚」处理；
      // 但 rollbackErrors 是恢复失败的硬证据，必须优先把 rolledBack 翻为 false。
      rolledBack: (Array.isArray(journal?.rollbackErrors) ? journal.rollbackErrors.length === 0 : true)
        && (state === 'failed' ? journal?.rolledBack !== false : journal?.rolledBack === true),
      rollbackErrors: Array.isArray(journal?.rollbackErrors)
        ? journal.rollbackErrors.map((item) => ({ path: text(item?.path), error: text(item?.error) }))
        : [],
      restored: Array.isArray(journal?.restored) ? journal.restored.map((item) => text(item)) : []
    }
    if (state === 'failed' || state === 'recovered') {
      // recovered 是「先恢复再重试」的中间态：只有恢复本身失败（rollbackErrors）才算回滚未完成；
      // failed 才看显式 `rolledBack:false`（旧 journal 没有该字段＝按已回滚处理，与执行路径兼容）。
      const incomplete = record.rollbackErrors.length > 0
        || (state === 'failed' && journal?.rolledBack === false)
      if (incomplete) {
        issues.push({
          code: API_ERROR_CODES.MIGRATION_ROLLBACK_INCOMPLETE,
          severity: 'error',
          scope: 'capability',
          path: file.relative,
          message: `能力迁移 ${record.capability} ${record.from}→${record.to} 回滚未完成：${record.error || 'journal 记录了回滚错误'}`
        })
      } else if (state === 'failed') {
        issues.push({
          code: API_ERROR_CODES.MIGRATION_FAILED,
          severity: 'error',
          scope: 'capability',
          path: file.relative,
          message: `能力迁移 ${record.capability} ${record.from}→${record.to} 失败，已回滚：${record.error}`
        })
      }
    }
    records.push(record)
  }
  records.sort((left, right) => `${left.capability}`.localeCompare(`${right.capability}`) || (left.to ?? 0) - (right.to ?? 0))
  return records
}

/** 当前层路由表（只建快照，不跑迁移、不读 `prepareLibraryMigrations`）。 */
async function routesForLayer(layer, rootKey) {
  const ui = await readUiState(rootKey).catch(() => ({ state: {} }))
  const snapshot = buildCapabilitySnapshot({
    manifests: layer?.manifests ?? [],
    sources: layer?.sources ?? [],
    state: ui.state ?? {},
    suiteState: readShelfSuiteState({ root: rootKey }),
    base: BASE_GRAPH,
    warnings: layer?.warnings ?? []
  })
  return snapshot.routes ?? {}
}

/**
 * OS-221 状态总装：升级报告（marker）＋ capability journal 状态 ＋ dataVersions ＋
 * dataAhead ＋ 失败原因/回滚信息 ＋ 备份路径 ＋ 类型化 issues。
 *
 * **零写入**：只 readdir/readFile/stat。不调用 `prepareLibraryMigrations`
 * （那会执行迁移）、不 import 迁移器、不建 `.history`、不写 journal 或 marker。
 * 凭据与稿件正文不进响应：journal 只报路径/摘要/计数，marker 只报计数。
 */
export async function readMigrationStatus(root, layer, { now = new Date() } = {}) {
  const rootKey = canonicalRoot(root)
  const issues = []
  const upgrade = await readUpgradeStatus(rootKey)
  // 升级标记坏了／谱系外来／重复迁移被拒：都不能当健康——marker 是「升级已完成」的唯一凭据。
  if (upgrade.markerState === 'corrupt' || upgrade.markerState === 'unreadable') {
    issues.push({
      code: API_ERROR_CODES.LIBRARY_UPGRADE_FAILED,
      severity: 'error',
      scope: 'upgrade-marker',
      path: upgrade.markerPath,
      message: `升级标记读不出来或不是合法 JSON：${upgrade.blocking || upgrade.markerState}`
    })
  } else if (upgrade.markerState === 'foreign-spec') {
    issues.push({
      code: API_ERROR_CODES.LIBRARY_UPGRADE_FAILED,
      severity: 'error',
      scope: 'upgrade-marker',
      path: upgrade.markerPath,
      message: `升级标记的 spec 不是 openstory.library-upgrade/v1：${upgrade.spec}`
    })
  }
  if (upgrade.repeatBlocked) {
    issues.push({
      code: API_ERROR_CODES.LIBRARY_UPGRADE_FAILED,
      severity: 'error',
      scope: 'upgrade-marker',
      path: upgrade.markerPath,
      message: upgrade.blocking
    })
  }
  const journals = await readCapabilityJournals(rootKey, { issues })
  // dataVersions 复用执行路径同一份读法（`readDataVersions`），只把 journalPath 改写成库内相对路径。
  const dataVersions = (await readDataVersions(rootKey, { journals })).map((item) => ({
    ...item,
    journalPath: posixOf(relative(rootKey, item.journalPath))
  }))
  const routes = await routesForLayer(layer, rootKey)
  const dataAhead = dataAheadFrom(routes, dataVersions)

  // 备份路径汇总（路径只报库内相对路径，绝不回绝对路径，也不提供下载）。
  const backupPaths = new Set()
  if (upgrade.backupPath) backupPaths.add(posixOf(upgrade.backupPath))
  for (const journal of journals) if (journal.backupPath) backupPaths.add(posixOf(journal.backupPath))

  const failures = journals
    .filter((item) => item.state === 'failed' || item.state === 'recovered' || item.state === 'corrupt')
    .map((item) => ({
      capability: item.capability,
      from: item.from,
      to: item.to,
      plugin: item.plugin,
      state: item.state,
      journalPath: item.path,
      message: item.message || item.error || '',
      rolledBack: item.rolledBack === true,
      rollbackErrors: item.rollbackErrors ?? []
    }))
  const rolledBack = journals.filter((item) => item.state === 'failed' && item.rolledBack === true).map((item) => item.path)
  const rollbackErrors = journals.flatMap((item) => (item.rollbackErrors ?? [])
    .map((error) => ({ journalPath: item.path, capability: item.capability, path: error.path, error: error.error })))

  const running = journals.filter((item) => item.state === 'running').map((item) => item.path)
  const pending = journals.filter((item) => item.state === 'recovered').map((item) => item.path)

  // 健康口径：有任何 error 级 issue 即 unhealthy；running/recovered 单独计为 in-progress 而非健康。
  const errors = issues.filter((item) => item.severity === 'error')
  const busy = running.length > 0 || pending.length > 0
  const status = errors.length ? 'attention' : busy ? 'in-progress' : 'healthy'

  return {
    spec: MIGRATION_STATUS_SPEC,
    root: posixOf(rootKey),
    checkedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    status,
    healthy: status === 'healthy',
    upgrade: {
      markerPath: upgrade.markerPath,
      markerState: upgrade.markerState,
      spec: upgrade.spec,
      at: upgrade.at,
      backupPath: upgrade.backupPath,
      needed: upgrade.needed,
      alreadyUpgraded: upgrade.alreadyUpgraded,
      repeatBlocked: upgrade.repeatBlocked,
      blocking: upgrade.blocking,
      oldDirs: upgrade.oldDirs,
      report: upgrade.report
    },
    legacyPresent: isLegacyLibraryRoot(rootKey),
    journals,
    dataVersions,
    dataAhead,
    failures,
    rolledBack,
    rollbackErrors,
    running,
    pending,
    backupPaths: [...backupPaths].sort(),
    issues,
    // 硬事实：本响应来自纯读收集器，不会写 journal、备份或业务文件。
    writes: false
  }
}

/**
 * 备份清单与逐文件校验（**只读**）：扫 `.history/` 下 `upgrade-*` 与 `capability-*` 备份目录，
 * 逐文件算 sha256 与大小，并与 journal 记录的写前/写后哈希交叉核对。
 *
 * 判定：
 *   · journal 声明的备份目录不存在/文件缺失 → MIGRATION_BACKUP_MISSING；
 *   · 备份文件字节哈希与 journal `beforeHash` 不符  → MIGRATION_BACKUP_HASH_MISMATCH；
 *   · journal `backupPath` 越出 `.history/capability-*|upgrade-*` → MIGRATION_BACKUP_PATH_INVALID；
 *   · upgrade marker 指的备份目录缺失 → MIGRATION_BACKUP_MISSING。
 * 不提供任意路径下载：响应只含库内相对路径与哈希，不含绝对路径与文件内容。
 */
export async function readMigrationBackups(root, { now = new Date(), issues = [] } = {}) {
  const rootKey = canonicalRoot(root)
  const historyDir = join(rootKey, HISTORY_DIR)
  const journals = await readCapabilityJournals(rootKey, { issues })

  /** journal 期望：backupRelative → Map(相对备份目录的文件路径 → 期望哈希) */
  const expected = new Map()
  for (const journal of journals) {
    if (!journal.backupPath) continue
    if (!safeHistoryRelative(rootKey, journal.backupPath)) {
      issues.push({
        code: API_ERROR_CODES.MIGRATION_BACKUP_PATH_INVALID,
        severity: 'error',
        scope: 'backup',
        path: journal.path,
        message: `journal 的 backupPath 越出 .history 备份目录：${journal.backupPath}`
      })
      continue
    }
    const map = expected.get(posixOf(journal.backupPath)) ?? new Map()
    for (const file of journal.files ?? []) {
      if (!file.backup || file.beforeHash === null) continue
      const rel = `${posixOf(journal.backupPath)}/${posixOf(file.backup)}`
      map.set(rel, file.beforeHash)
    }
    expected.set(posixOf(journal.backupPath), map)
  }
  const upgrade = await readUpgradeStatus(rootKey)
  if (upgrade.backupPath) {
    if (!safeHistoryRelative(rootKey, upgrade.backupPath)) {
      issues.push({
        code: API_ERROR_CODES.MIGRATION_BACKUP_PATH_INVALID,
        severity: 'error',
        scope: 'backup',
        path: upgrade.markerPath,
        message: `升级标记的 backup 越出 .history 备份目录：${upgrade.backupPath}`
      })
    } else if (!expected.has(posixOf(upgrade.backupPath))) {
      expected.set(posixOf(upgrade.backupPath), new Map())
    }
  }

  const directories = []
  for (const prefix of ['capability-', 'upgrade-']) {
    let entries = []
    try {
      entries = await readdir(historyDir, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') break
      issues.push({ code: API_ERROR_CODES.MIGRATION_BACKUP_MISSING, severity: 'error', scope: 'backup', path: HISTORY_DIR, message: `备份根目录不可读：${text(error?.message || error)}` })
      break
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(prefix)) continue
      directories.push(entry.name)
    }
  }
  directories.sort()

  const backups = []
  for (const name of directories) {
    const relative = `${HISTORY_DIR}/${name}`
    const dirPath = join(historyDir, name)
    const wants = expected.get(relative) ?? new Map()
    const files = []
    const walk = async (dir, base) => {
      let entries = []
      try {
        entries = await readdir(dir, { withFileTypes: true })
      } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return
      issues.push({ code: API_ERROR_CODES.MIGRATION_BACKUP_MISSING, severity: 'error', scope: 'backup', path: childRel || relative, message: `备份目录不可读：${text(error?.message || error)}` })
      return
    }
      entries.sort((left, right) => left.name.localeCompare(right.name))
      for (const entry of entries) {
        const childPath = join(dir, entry.name)
        const childRel = base ? `${base}/${entry.name}` : entry.name
        if (entry.isDirectory()) { await walk(childPath, childRel); continue }
        if (!entry.isFile()) continue
        const bytes = await readFileIfExists(childPath)
        if (bytes === null) continue
        const actual = sha256Bytes(bytes)
        const want = wants.get(`${relative}/${childRel}`)
        const file = {
          path: childRel,
          bytes: bytes.length,
          sha256: actual,
          expectedSha256: want === undefined ? null : want,
          hashMatched: want === undefined ? null : want === actual
        }
        if (file.hashMatched === false) {
          issues.push({
            code: API_ERROR_CODES.MIGRATION_BACKUP_HASH_MISMATCH,
            severity: 'error',
            scope: 'backup',
            path: `${relative}/${childRel}`,
            message: `备份文件与 journal 记录的写前哈希不符：${relative}/${childRel}`
          })
        }
        files.push(file)
      }
    }
    const stats = await statIfExists(dirPath)
    await walk(dirPath, '')
    // 升级备份自带 `backup-manifest.json`（备份时写入的 copied 清单）：按它核对「声明过的都在」。
    let manifest = null
    if (name.startsWith('upgrade-')) {
      const manifestBytes = await readFileIfExists(join(dirPath, 'backup-manifest.json')).catch(() => null)
      if (manifestBytes === null) {
        issues.push({
          code: API_ERROR_CODES.MIGRATION_BACKUP_MISSING,
          severity: 'error',
          scope: 'backup',
          path: `${relative}/backup-manifest.json`,
          message: `升级备份缺 backup-manifest.json，无法核对备份范围：${relative}`
        })
      } else {
        let parsed = null
        try { parsed = JSON.parse(manifestBytes.toString('utf8')) } catch { parsed = null }
        if (!parsed || typeof parsed !== 'object' || !Array.isArray(parsed.copied)) {
          issues.push({
            code: API_ERROR_CODES.MIGRATION_BACKUP_HASH_MISMATCH,
            severity: 'error',
            scope: 'backup',
            path: `${relative}/backup-manifest.json`,
            message: `升级备份清单不可解析（缺 copied 数组）：${relative}`
          })
        } else {
          const declared = parsed.copied.map((item) => posixOf(item)).filter(Boolean)
          for (const source of declared) {
            // 清单记的是「原库内相对路径」，备份落点＝目录名（basename）。逐条核对归档目录在。
            const base = source.split('/').pop()
            const present = files.some((file) => file.path === base || file.path.startsWith(`${base}/`))
            if (present) continue
            issues.push({
              code: API_ERROR_CODES.MIGRATION_BACKUP_MISSING,
              severity: 'error',
              scope: 'backup',
              path: `${relative}/${base}`,
              message: `升级备份清单声明的内容不在备份目录里：${source}`
            })
          }
          manifest = {
            spec: text(parsed.spec),
            at: text(parsed.at),
            copied: declared,
            copiedCount: declared.length
          }
        }
      }
    }
    for (const rel of wants.keys()) {
      const inner = rel.slice(`${relative}/`.length)
      if (files.some((file) => file.path === inner)) continue
      issues.push({
        code: API_ERROR_CODES.MIGRATION_BACKUP_MISSING,
        severity: 'error',
        scope: 'backup',
        path: rel,
        message: `journal 声明的备份文件不存在：${rel}`
      })
    }
    backups.push({
      name,
      kind: name.startsWith('upgrade-') ? 'upgrade' : 'capability',
      path: relative,
      exists: stats !== null,
      bytes: files.reduce((sum, file) => sum + file.bytes, 0),
      fileCount: files.length,
      manifest,
      files
    })
  }
  for (const rel of expected.keys()) {
    if (backups.some((backup) => backup.path === rel)) continue
    issues.push({
      code: API_ERROR_CODES.MIGRATION_BACKUP_MISSING,
      severity: 'error',
      scope: 'backup',
      path: rel,
      message: `journal/marker 声明的备份目录不存在：${rel}`
    })
  }

  const errors = issues.filter((item) => item.severity === 'error')
  return {
    spec: MIGRATION_BACKUP_SPEC,
    root: posixOf(rootKey),
    checkedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    ok: errors.length === 0,
    healthy: errors.length === 0,
    historyDir: HISTORY_DIR,
    backups,
    issues,
    // 硬事实：校验只读；不修复、不复制、不覆盖任何备份。
    writes: false
  }
}

/* ================================================================
 * OS-222：确认执行（diagnose→plan→confirm→apply→status/backup verify）
 *
 * 计划存在进程内内存表：planId 由预览时的文件/迁移器摘要算出，apply 时重算
 * 同 root/层的新计划并逐条核对。确认闸通过后才调用既有执行入口
 * （upgradeLibrary / runCapabilityMigrations），它们自带 journal/备份/原子写/
 * 回滚；本文件绝不自己复制、覆盖或回滚任何文件。
 * ================================================================ */

const plansById = new Map()
const APPLY_RESULT_SPEC = 'openstory.upgrade-apply/v1'

/** 登记一份只读预览计划，返回 planId；仅存进程内存，daemon 重启即失效（需重新预览）。 */
export function rememberUpgradePlan(plan) {
  if (!plan?.planId || !plan?.root?.fingerprint) return null
  plansById.set(plan.planId, { plan, at: Date.now() })
  return plan.planId
}

/** 供测试/重启口径：清掉内存计划表（不触碰磁盘）。 */
export function clearUpgradePlans() {
  plansById.clear()
}

function bindingsProjection(bindings = []) {
  return Object.fromEntries((Array.isArray(bindings) ? bindings : [])
    .filter((binding) => binding?.id && binding?.sha256)
    .map((binding) => [binding.id, binding.sha256]))
}

const rejectApply = (code, message, details = {}) => ({ ok: false, code, message, ...details })

/**
 * OS-222 P1：journal/backup 一律回库内相对路径——绝不把服务器绝对路径交给调用方。
 * 绝对路径只在确实落在库根内时才收（转成相对）；库外路径直接丢弃。
 */
function relativeToRoot(rootKey, value) {
  const raw = text(value).trim()
  if (!raw) return ''
  const posix = raw.replaceAll('\\', '/')
  if (!posix.startsWith('/') && !/^[a-zA-Z]:\//u.test(posix)) {
    const parts = posix.split('/')
    return parts.every((part) => part && part !== '.' && part !== '..') ? posix : ''
  }
  const rel = relative(rootKey, raw).replaceAll('\\', '/')
  if (!rel || rel === '..' || rel.startsWith('../') || /^[a-zA-Z]:\//u.test(rel)) return ''
  return rel
}

/**
 * 确认闸（纯比较）：confirm 必须严谨 true；plan 存在、属于本次 root、planId 一致；
 * 重算计划的 root/spec/kind 与全部文件/迁移器摘要一致，语义投影一致。
 * 不通过时返回类型化拒绝原因，调用方零写入。
 */
function verifyPlan(planId, plan, fresh, rootKey, confirm) {
  const expected = String(planId ?? '').trim()
  if (confirm !== true) return rejectApply('CONFIRM_REQUIRED', 'apply 必须 confirm:true（作者显式确认）')
  if (!expected) return rejectApply('PLAN_REQUIRED', 'apply 必须带 planId')
  if (!plan) return rejectApply('PLAN_NOT_FOUND', 'planId 没有对应的预览计划，请重新 diagnose/plan')
  if (!fresh) return rejectApply('PLAN_NOT_FOUND', '无法重算计划，拒绝执行')
  const fingerprint = rootFingerprint(rootKey)
  if (plan.root?.fingerprint !== fingerprint || fresh.root?.fingerprint !== fingerprint) {
    return rejectApply('PLAN_ROOT_MISMATCH', '预览计划绑定的 root 与本次请求不一致')
  }
  if (plan.planId !== expected) return rejectApply('PLAN_NOT_FOUND', 'planId 与预览计划不匹配')
  // 先算摘要漂移再判 planId：文件一变 planId 也跟着变，必须点名是哪几个文件/迁移器变了。
  const drift = diffPlanBindings(plan, bindingsProjection(fresh.bindings ?? []))
  if (drift.length) {
    return rejectApply('PLAN_STALE', `预览后有 ${drift.length} 处文件/迁移器摘要变化`, { drift })
  }
  if (fresh.planId !== expected || plan.spec !== fresh.spec || plan.kind !== fresh.kind) {
    return rejectApply('PLAN_STALE', '预览后计划已变，拒绝执行')
  }
  if (stableJson(semanticPlan(plan)) !== stableJson(semanticPlan(fresh))) {
    return rejectApply('PLAN_STALE', '预览后计划语义发生变化，拒绝执行')
  }
  // OS-222 P1：计划阶段就判定的阻断项（迁移器声明/入口 invalid、DATA_VERSION_AHEAD）
  // 必须在 apply 闸里 fail-closed；旧实现只在 planLibraryMigrations 里算 ok 却丢弃，
  // apply 静默 continue invalid 迁移、dataAhead 空导致降级场景误报 success。
  const invalid = (fresh.sections?.capabilityMigrations ?? []).filter((item) => item?.status === 'invalid')
  if (invalid.length) {
    return rejectApply('MIGRATION_FAILED',
      `计划中有 ${invalid.length} 条无效能力迁移：${invalid.map((item) => item.reason ?? 'invalid').join('、')}`)
  }
  const blockingConflicts = (fresh.sections?.capabilityMigrations ?? [])
    .flatMap((item) => item?.conflicts ?? [])
    .filter((item) => item?.blocking === true)
  if (blockingConflicts.length) {
    return rejectApply('MIGRATION_FAILED',
      `计划中有 ${blockingConflicts.length} 处阻断冲突：${blockingConflicts.map((item) => item.path ?? item.reason).join('、')}`)
  }
  if (fresh.sections?.capability?.ok === false) {
    return rejectApply('MIGRATION_FAILED', '能力迁移计划未通过校验，拒绝执行')
  }
  if ((fresh.sections?.dataAhead ?? []).length) {
    return rejectApply('DATA_VERSION_AHEAD',
      `数据版本超前于当前供给者（${fresh.sections.dataAhead.length} 处），不得降级覆盖`)
  }
  if (fresh.sections?.libraryUpgrade?.blocking) {
    return rejectApply('LIBRARY_UPGRADE_FAILED', `旧库升级被阻断：${fresh.sections.libraryUpgrade.blocking}`)
  }
  return { ok: true }
}

/**
 * 执行一份已确认的计划。按顺序：
 *   1. 取回内存中的预览计划；按同一 root/层重算只读计划；
 *   2. 确认闸校验（含 confirm:true、root/文件/迁移器摘要）；
 *   3. 旧库升级段：《upgradeLibrary》复用既有备份/journal/回滚；
 *   4. 能力迁移段：逐条核对迁移器入口摘要后调用既有《runCapabilityMigrations》；
 *   5. 汇总结果，区分 success/idempotent/conflict/rolledBack/rollback-incomplete。
 * 任何校验失败即零写入返回；执行失败如实报 rolledBack，不自动重试。
 */
export async function applyUpgradePlan(root, { planId, confirm, operationId, layer, upgradeDeps } = {}, env = process.env) {
  const rootKey = canonicalRoot(root)
  if (!rootKey) return rejectApply('NO_LIBRARY', 'apply 需要一个库根')
  const entry = plansById.get(String(planId ?? '').trim())
  const plan = entry?.plan ?? null
  // 层由调用方（handler）从 moduleRuntime 注入——libraryMigrations 已被 moduleRuntime
  // import，反向静态 import 会成环；这里只接收已装载好的只读层快照。
  const activeLayer = layer ?? { manifests: [], sources: [] }
  const fresh = await buildLibraryUpgradePlan(rootKey, activeLayer)
  const gate = verifyPlan(planId, plan, fresh, rootKey, confirm)
  if (!gate.ok) return gate

  const result = {
    spec: APPLY_RESULT_SPEC,
    ok: true,
    root: posixOf(rootKey),
    planId: plan.planId,
    operationId: text(operationId),
    outcome: 'success',
    libraryUpgrade: null,
    capabilityMigrations: null,
    journals: [],
    backups: [],
    // OS-222 P1：只要没有任何「回滚未完成」的证据，成功执行就没有回滚这回事；
    // rolledBack 默认 true（=无需回滚/未发生未完成回滚），只有明确失败且回滚不完整才置 false。
    rolledBack: true,
    rollbackErrors: [],
    message: ''
  }
  const collect = (segment) => {
    if (!segment) return
    const backup = relativeToRoot(rootKey, segment.backupPath || segment.backup)
    if (backup) result.backups.push(backup)
    const journal = relativeToRoot(rootKey, segment.journalPath)
    if (journal) result.journals.push(journal)
    if (segment.rolledBack === false || (Array.isArray(segment.rollbackErrors) && segment.rollbackErrors.length)) {
      result.rolledBack = false
      result.rollbackErrors.push(...(segment.rollbackErrors ?? []))
    }
  }

  // 旧库升级段：只经既有 upgradeLibrary 执行（自带备份/journal/回滚）。
  if (fresh.sections?.libraryUpgrade?.needed) {
    const upgraded = await upgradeLibrary(rootKey, upgradeDeps ? { deps: upgradeDeps } : {})
    result.libraryUpgrade = {
      ok: upgraded.ok, upgraded: upgraded.upgraded === true,
      code: upgraded.code ?? '', phase: upgraded.phase ?? '',
      backup: upgraded.report?.backup ?? '', conflicts: upgraded.report?.conflicts ?? [],
      rolledBack: upgraded.rolledBack === true, rollbackErrors: upgraded.rollbackErrors ?? [],
      message: upgraded.message ?? ''
    }
    collect({ backup: upgraded.report?.backup, rolledBack: upgraded.rolledBack, rollbackErrors: upgraded.rollbackErrors })
    // OS-222 P1：把升级 changelog 的库内相对路径一并报出，供 MCP 调用方核对。
    if (upgraded.upgraded === true) {
      result.journals.push(logFilePath(LOG_MODULES.libraryUpgrade))
    }
    if (!upgraded.ok) {
      result.ok = false
      result.code = API_ERROR_CODES.LIBRARY_UPGRADE_FAILED
      result.outcome = upgraded.rolledBack === true ? 'rolled-back' : 'rollback-incomplete'
      result.message = upgraded.message ?? '旧库升级失败'
      // 失败即止，不继续能力迁移。
      plansById.delete(plan.planId)
      return result
    }
  }

  // 能力迁移段：逐条复核迁移器摘要，复用既有 runCapabilityMigrations。
  const sources = new Map((activeLayer.sources ?? []).map((source) => [source.id, source]))
  const declared = declaredCapabilityMigrations(
    (activeLayer.manifests ?? []).filter((manifest) => (plan.sections?.capabilityMigrations ?? [])
      .some((item) => item.plugin === manifest?.id)),
    (id) => migrationPackageDir(sources.get(id), id)
  )
  const allowed = new Map((fresh.sections?.capabilityMigrations ?? [])
    .filter((item) => item.entrySha256)
    .map((item) => [`${item.plugin}:${item.capability}:${item.from}->${item.to}`, item.entrySha256]))
  const pending = []
  for (const migration of declared) {
    const validation = validateCapabilityMigration(migration, { packageDir: migration.packageDir })
    if (!validation.ok) {
      // OS-222 P1：无效迁移绝不再静默跳过——verifyPlan 已在闸里拦下 invalid，
      // 这里再守一道，任何绕过闸的调用也不得报 success。
      result.ok = false
      result.outcome = 'conflict'
      result.message = `能力迁移声明无效：${validation.message}`
      plansById.delete(plan.planId)
      return result
    }
    const hash = await readFile(validation.entryPath).then((bytes) => createHash('sha256').update(bytes).digest('hex')).catch(() => null)
    const key = `${migration.plugin}:${migration.capability}:${migration.from}->${migration.to}`
    if (!allowed.has(key) || allowed.get(key) !== hash) {
      result.ok = false
      result.outcome = 'conflict'
      result.message = `迁移器摘要漂移：${key}`
      plansById.delete(plan.planId)
      return result
    }
    pending.push(migration)
  }
  if (pending.length) {
    const ran = await runCapabilityMigrations({ root: rootKey, migrations: pending })
    const entries = [...(ran.ran ?? []), ...(ran.skipped ?? []), ...(ran.failures ?? [])]
    const journals = await readCapabilityJournals(rootKey)
    const journalOf = (item) => journals.find((journal) => journal.capability === item.capability
      && journal.from === item.from && journal.to === item.to) ?? null
    for (const item of entries) {
      const journal = journalOf(item)
      result.capabilityMigrations ??= []
      result.capabilityMigrations.push({
        plugin: item.plugin, capability: item.capability, from: item.from, to: item.to,
        state: item.skipped ? 'skipped' : item.ok ? 'done' : 'failed',
        entryChanged: item.entryChanged === true,
        // OS-222 P1：journal/backup 一律库内相对路径，杜绝对外泄漏服务器绝对路径。
        journalPath: relativeToRoot(rootKey, item.journalPath ?? journal?.path ?? ''),
        backupPath: relativeToRoot(rootKey, item.backupPath ?? journal?.backupPath ?? ''),
        rolledBack: item.rolledBack === true,
        rollbackErrors: item.rollbackErrors ?? []
      })
      collect(item)
      const journalRel = relativeToRoot(rootKey, journal?.path ?? '')
      const backupRel = relativeToRoot(rootKey, journal?.backupPath ?? '')
      if (journalRel) result.journals.push(journalRel)
      if (backupRel) result.backups.push(backupRel)
      // 迁移器失败：按 journal/备份恢复记为 rolledBack:true；回滚失败（含 rollbackErrors）
      // 或 journal 明确 rolledBack:false 时如实报 rolledBack:false，绝不自动重试。
      if (item.ok === false && item.code === API_ERROR_CODES.MIGRATION_FAILED) {
        const rolledBack = item.rolledBack === true
          || (item.rolledBack !== false && !(Array.isArray(item.rollbackErrors) && item.rollbackErrors.length)
            && !(Array.isArray(journal?.rollbackErrors) && journal.rollbackErrors.length)
            && journal?.rolledBack !== false)
        result.capabilityMigrations.at(-1).rolledBack = rolledBack
        if (!rolledBack) {
          result.rolledBack = false
          const errors = item.rollbackErrors ?? journal?.rollbackErrors ?? []
          result.rollbackErrors.push(...errors)
          result.capabilityMigrations.at(-1).rollbackErrors = errors
        } else result.rolledBack = true
      }
    }
    if (!ran.ok) {
      result.ok = false
      result.code = API_ERROR_CODES.MIGRATION_FAILED
      result.outcome = result.rollbackErrors.length || result.capabilityMigrations.some((item) => item.rolledBack === false)
        ? 'rollback-incomplete' : 'rolled-back'
      result.message = `能力迁移失败：${(ran.failures ?? []).map((item) => item.message).join('；')}`
      plansById.delete(plan.planId)
      return result
    }
    if (!(ran.ran ?? []).length) result.outcome = 'idempotent'
  }
  const status = await readMigrationStatus(rootKey, activeLayer)
  const issues = (status.issues ?? []).filter((item) => item.severity === 'error')
  if (issues.length) {
    result.ok = false
    result.code = issues.some((item) => item.code === API_ERROR_CODES.MIGRATION_ROLLBACK_INCOMPLETE)
      ? API_ERROR_CODES.MIGRATION_ROLLBACK_INCOMPLETE : API_ERROR_CODES.MIGRATION_FAILED
    const incomplete = status.failures?.some((item) => item.rolledBack === false)
      || status.rollbackErrors?.length > 0
      || issues.some((item) => item.code === API_ERROR_CODES.MIGRATION_ROLLBACK_INCOMPLETE)
    if (incomplete) {
      result.outcome = 'rollback-incomplete'
      result.rolledBack = false
      result.rollbackErrors.push(...(status.rollbackErrors ?? []))
    } else result.outcome = 'conflict'
    result.message = `执行后状态异常：${issues.map((item) => item.message).join('；')}`
  }
  result.journals = [...new Set(result.journals)].filter(Boolean).sort()
  result.backups = [...new Set(result.backups)].filter(Boolean).sort()
  // 一次性计划：成功/失败都必须重新 diagnose/plan，杜绝「同一计划反复执行」的错觉。
  plansById.delete(plan.planId)
  return result
}