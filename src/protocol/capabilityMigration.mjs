/**
 * OS-186 / D2：单向能力迁移框架（模块清单 @2 的 `migrations`）。
 *
 * 只做「一次 from→to、先 journal 后提交」的通用管道：
 *   · 迁移器只产出计划（读取当前数据 → 返回待写文件），不直接落盘；
 *   · 计划全部产完才进入提交：先备份原件到 `.history/capability-<cap>-<from>-to-<to>-<stamp>/`，
 *     再逐文件经 `hostWrite.atomicWriteFile` 物理写盘，并逐条记 changelog；
 *   · 任一步失败＝逆序恢复已写文件、journal 记 `failed`、原格式保留、返回 `MIGRATION_FAILED`，
 *     由调用方禁用覆盖者；绝不删旧数据文件、绝不自动降版。
 *   · journal 见 `done` 直接跳过；见 `running`/`failed` 先按 journal 恢复再重试，绝不盲跑。
 *
 * 与 OS-172 的旧库一次性升级是两套机制、两套 marker，互不调用。
 */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { API_ERROR_CODES } from './apiErrors.mjs'
import { atomicWriteFile } from './hostWrite.mjs'
import { recordChange } from './changelog.mjs'
import { METADATA_DIR, canonicalRoot, resolveInsideRoot } from './rootPath.mjs'

export const MIGRATION_SPEC = 'openstory-capability-migration@1'
export const MIGRATION_JOURNAL_STATE = Object.freeze({ running: 'running', done: 'done', failed: 'failed', recovered: 'recovered' })

const hashOf = (contents) => createHash('sha256').update(contents).digest('hex')
const stampOf = (now) => now.toISOString().replace(/[:.]/gu, '-')
const posix = (value) => String(value).replaceAll('\\', '/')

async function exists(target) {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

export function migrationKey(migration) {
  return `${migration.capability}@${migration.from}->${migration.to}`
}

export function migrationJournalPath(root, migration) {
  return join(canonicalRoot(root), METADATA_DIR, 'migrations', migration.capability, `${migration.from}-to-${migration.to}.json`)
}

export function migrationBackupDir(root, migration, stamp) {
  return join(canonicalRoot(root), '.history', `capability-${migration.capability}-${migration.from}-to-${migration.to}-${stamp}`)
}

export async function readMigrationJournal(root, migration) {
  const path = migrationJournalPath(root, migration)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

export function validateCapabilityMigration(migration, { packageDir } = {}) {
  const invalid = (reason, message) => ({ ok: false, code: API_ERROR_CODES.MIGRATION_FAILED, reason, message })
  if (!migration || typeof migration !== 'object') return invalid('MIGRATION_INVALID', '迁移声明必须是对象')
  const { plugin, capability, from, to, entry } = migration
  if (!String(plugin ?? '').trim()) return invalid('MIGRATION_INVALID', '迁移声明缺 plugin')
  if (!/^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)+$/u.test(String(capability ?? ''))) {
    return invalid('MIGRATION_INVALID', `能力 id 不合法：${capability}`)
  }
  if (!Number.isInteger(from) || from < 1 || !Number.isInteger(to)) return invalid('MIGRATION_INVALID', '迁移版本必须是正整数')
  if (to !== from + 1) return invalid('MIGRATION_VERSION_GAP', `迁移必须单向递增一档：${from}→${to}`)
  const entryText = String(entry ?? '').trim()
  if (!entryText || isAbsolute(entryText) || entryText.includes('\0')) return invalid('MIGRATION_ENTRY_INVALID', `迁移入口不合法：${entry}`)
  const entryPosix = posix(entryText).replace(/^\.\//u, '')
  if (entryPosix.split('/').some((part) => !part || part === '.' || part === '..')) {
    return invalid('MIGRATION_ENTRY_INVALID', `迁移入口不得越出包目录：${entry}`)
  }
  if (!entryPosix.endsWith('.mjs')) return invalid('MIGRATION_ENTRY_INVALID', `迁移入口必须是 .mjs：${entry}`)
  if (!String(packageDir ?? '').trim()) return invalid('MIGRATION_ENTRY_INVALID', `缺少包目录，无法解析迁移入口：${entry}`)
  const base = canonicalRoot(packageDir)
  const absolute = join(base, entryPosix)
  const rel = relative(base, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return invalid('MIGRATION_ENTRY_INVALID', `迁移入口解析后落在包目录之外：${entry}`)
  }
  return { ok: true, entryPath: absolute, entry: entryPosix }
}

function normalizePlan(result) {
  const files = Array.isArray(result) ? result : result?.files
  if (!Array.isArray(files)) throw new Error('迁移器必须返回 { files: [{ path, content }] } 或文件数组')
  return files.map((file) => {
    const path = posix(String(file?.path ?? '').trim()).replace(/^\.\//u, '')
    const content = file?.content
    if (!path) throw new Error('迁移产出缺少 path')
    if (typeof content !== 'string' && !ArrayBuffer.isView(content)) throw new Error(`迁移产出 ${path} 的内容必须是字符串或字节`)
    return { path, content }
  })
}

async function listFilesInside(root, dir) {
  const base = canonicalRoot(root)
  const target = !dir || dir === '.'
    ? base
    : resolveInsideRoot(root, dir, { allowMetadata: false })
  if (!target || target.ok === false || !(await exists(target.path ?? target))) return []
  const path = target.path ?? target
  const entries = await readdir(path, { recursive: true, withFileTypes: true })
  return entries
    .filter((item) => item.isFile())
    .map((item) => posix(relative(path, join(item.parentPath ?? item.path, item.name))))
    .sort()
}

function migrationContext(root, migration) {
  return Object.freeze({
    root: canonicalRoot(root),
    plugin: migration.plugin,
    capability: migration.capability,
    from: migration.from,
    to: migration.to,
    async readFile(path) {
      const resolved = resolveInsideRoot(root, path)
      if (!resolved.ok) throw new Error(resolved.message)
      try {
        return await readFile(resolved.path, 'utf8')
      } catch (error) {
        if (error?.code === 'ENOENT') return null
        throw error
      }
    },
    listFiles(dir) {
      return listFilesInside(root, dir)
    }
  })
}

async function loadMigrator(entryPath) {
  const module = await import(pathToFileURL(entryPath).href)
  const migrate = module.default ?? module.migrate
  if (typeof migrate !== 'function') throw new Error(`迁移入口没有导出 migrate：${entryPath}`)
  return migrate
}

async function writeJournal(root, migration, journal) {
  const path = migrationJournalPath(root, migration)
  await mkdir(dirname(path), { recursive: true })
  await atomicWriteFile(path, JSON.stringify(journal, null, 2))
  return path
}

function journalFileBackup(backupDir, relativePath) {
  return join(backupDir, ...posix(relativePath).split('/'))
}

async function restoreJournaledFiles(root, journal) {
  const restored = []
  const backupDir = journal.backupPath ? join(canonicalRoot(root), ...posix(journal.backupPath).split('/')) : ''
  for (const file of [...(journal.files ?? [])].reverse()) {
    const resolved = resolveInsideRoot(root, file.path)
    if (!resolved.ok) continue
    if (file.backup) {
      const backupPath = join(backupDir, ...posix(file.backup).split('/'))
      if (!(await exists(backupPath))) continue
      await mkdir(dirname(resolved.path), { recursive: true })
      await atomicWriteFile(resolved.path, await readFile(backupPath))
      restored.push(file.path)
    } else if (await exists(resolved.path)) {
      await unlink(resolved.path)
      restored.push(file.path)
    }
  }
  return restored
}

async function commitFiles(root, files, { backupDir }) {
  const records = []
  const written = []
  try {
    for (const file of files) {
      const resolved = resolveInsideRoot(root, file.path)
      if (!resolved.ok) throw new Error(`迁移产出越出库根：${file.path}`)
      const before = (await exists(resolved.path)) ? await readFile(resolved.path) : null
      let backup = null
      if (before !== null) {
        backup = file.path
        const backupPath = journalFileBackup(backupDir, file.path)
        await mkdir(dirname(backupPath), { recursive: true })
        await atomicWriteFile(backupPath, before)
      }
      const afterBytes = Buffer.from(file.content)
      records.push({
        path: file.path,
        beforeHash: before === null ? null : hashOf(before),
        afterHash: hashOf(afterBytes),
        backup
      })
      await mkdir(dirname(resolved.path), { recursive: true })
      await atomicWriteFile(resolved.path, file.content)
      written.push({ path: resolved.path, relative: file.path, before, after: file.content })
    }
  } catch (error) {
    const restored = []
    for (const item of [...written].reverse()) {
      if (item.before === null) await unlink(item.path).catch(() => {})
      else await atomicWriteFile(item.path, item.before).catch(() => {})
      restored.push(item.relative)
    }
    throw Object.assign(error, { restored, records })
  }
  return { records, written }
}

async function recordMigrationLogs(root, migration, written) {
  const asText = (value) => {
    if (value === null || value === undefined) return ''
    if (typeof value === 'string') return value
    return Buffer.from(value).toString('utf8')
  }
  for (const item of written) {
    const before = asText(item.before)
    const after = asText(item.after)
    await recordChange({
      root,
      module: migration.plugin,
      file: item.relative,
      op: item.before === null ? 'create' : 'update',
      before,
      after,
      actor: 'migration',
      meta: { capability: migration.capability, from: migration.from, to: migration.to }
    }).catch(() => {})
  }
}

async function runOne(root, migration, { now }) {
  const validation = validateCapabilityMigration(migration, { packageDir: migration.packageDir })
  if (!validation.ok) return { ok: false, plugin: migration.plugin, ...validation }
  const journal = await readMigrationJournal(root, migration)
  if (journal?.state === MIGRATION_JOURNAL_STATE.done) {
    const entryHash = await readFile(validation.entryPath).then(hashOf).catch(() => null)
    return { ok: true, skipped: true, plugin: migration.plugin, journal, entryChanged: entryHash !== journal.entrySha256 }
  }
  let restored = []
  if (journal && (journal.state === MIGRATION_JOURNAL_STATE.running
    || journal.state === MIGRATION_JOURNAL_STATE.failed
    || journal.state === MIGRATION_JOURNAL_STATE.recovered)) {
    restored = await restoreJournaledFiles(root, journal)
  }
  const startedAt = new Date(now()).toISOString()
  const stamp = stampOf(new Date(now()))
  const backupDir = migrationBackupDir(root, migration, stamp)
  const backupRelative = posix(relative(canonicalRoot(root), backupDir))
  const entrySha256 = hashOf(await readFile(validation.entryPath))
  const operationId = randomUUID()
  const baseJournal = {
    spec: MIGRATION_SPEC,
    plugin: migration.plugin,
    capability: migration.capability,
    from: migration.from,
    to: migration.to,
    entry: validation.entry,
    entrySha256,
    operationId,
    startedAt,
    backupPath: backupRelative,
    files: []
  }
  const journalPath = await writeJournal(root, migration, { ...baseJournal, state: MIGRATION_JOURNAL_STATE.running })
  try {
    const migrate = await loadMigrator(validation.entryPath)
    const files = normalizePlan(await migrate(migrationContext(root, migration)))
    const committed = await commitFiles(root, files, { backupDir })
    const done = {
      ...baseJournal,
      state: MIGRATION_JOURNAL_STATE.done,
      finishedAt: new Date(now()).toISOString(),
      files: committed.records
    }
    await writeJournal(root, migration, done)
    await recordMigrationLogs(root, migration, committed.written)
    return { ok: true, plugin: migration.plugin, capability: migration.capability, from: migration.from, to: migration.to, journalPath, backupPath: backupRelative, files: done.files, restored }
  } catch (error) {
    const failed = {
      ...baseJournal,
      state: MIGRATION_JOURNAL_STATE.failed,
      finishedAt: new Date(now()).toISOString(),
      files: error?.records ?? [],
      error: String(error?.message ?? error),
      restored: error?.restored ?? []
    }
    await writeJournal(root, migration, failed).catch(() => {})
    return {
      ok: false,
      code: API_ERROR_CODES.MIGRATION_FAILED,
      plugin: migration.plugin,
      capability: migration.capability,
      from: migration.from,
      to: migration.to,
      reason: 'MIGRATION_FAILED',
      message: `能力迁移失败，原数据已保留：${failed.error}`,
      journalPath,
      backupPath: backupRelative,
      restored: [...new Set([...restored, ...failed.restored])],
      files: failed.files,
      disable: [migration.plugin]
    }
  }
}

/**
 * 依次执行声明的能力迁移。单项失败不阻断其它能力，汇总在 failures 里；
 * 调用方须把 `disable` 里的覆盖者从候选图中剔除（失败安全阀）。
 */
export async function runCapabilityMigrations({ root, migrations = [], now = () => new Date() } = {}) {
  if (!String(root ?? '').trim()) {
    return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '能力迁移需要一个库根', ran: [], skipped: [], failures: [] }
  }
  const ran = []
  const skipped = []
  const failures = []
  for (const migration of migrations) {
    const result = await runOne(root, migration, { now })
    if (result.ok && result.skipped) skipped.push(result)
    else if (result.ok) ran.push(result)
    else failures.push(result)
  }
  const disable = [...new Set(failures.flatMap((item) => item.disable ?? []))]
  return { ok: failures.length === 0, ran, skipped, failures, disable }
}

export function declaredCapabilityMigrations(manifests = [], packageDirFor = () => null) {
  return manifests.flatMap((manifest) => (Array.isArray(manifest?.migrations) ? manifest.migrations : []).map((migration) => ({
    plugin: manifest.id,
    packageDir: packageDirFor(manifest.id),
    ...migration
  })))
}