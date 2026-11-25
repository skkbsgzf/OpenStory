import { existsSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, copyFile, symlink } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { atomicWriteFile } from './hostWrite.mjs'
import { LOG_MODULES, namingEntry } from './naming.mjs'
import { logFilePath, recordChange } from './changelog.mjs'

const STORAGE = namingEntry('libraryStorage')
export const LIBRARY_UPGRADE_SPEC = 'openstory.library-upgrade/v1'
export const LEGACY_PROJECT_SPECS = Object.freeze(['pinax-project@1', 'pinax-project@2', 'pinax-project@3'])
export const LEGACY_WIKI_SCHEMA = 'pinax-wiki-derived@1'
export const WIKI_DERIVED_SCHEMA = STORAGE.wikiSchema
export const LEGACY_CARRIER_PREFIX = 'pinax.carrier.'

const DIR_RENAMES = Object.freeze({ 参考: '世界书', 拆解: '故事源', 推演: '扮演', 导出: '导入导出' })
const MODULE_RENAMES = Object.freeze({ 参考: '世界书', 拆解: '故事源', 故事源: '故事源', 推演: '扮演' })
const SKIP_DIRS = new Set(['.git', '.history', 'node_modules'])
const inflight = new Map()
const completed = new Set()

function text(value) {
  return String(value ?? '')
}

function stampOf(now) {
  return now.toISOString().replace(/[:.]/gu, '-')
}

async function exists(path) {
  try {
    await lstat(path)
    return true
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

async function isDirectory(path) {
  try {
    return (await lstat(path)).isDirectory()
  } catch (error) {
    if (error?.code === 'ENOENT') return false
    throw error
  }
}

function relPath(root, path) {
  return relative(root, path).split(sep).join('/')
}

function uniquePath(path, stamp) {
  const ext = extname(path)
  const stem = ext ? path.slice(0, -ext.length) : path
  let candidate = `${stem}.upgrade-${stamp}${ext}`
  let index = 2
  while (true) {
    if (!existsSync(candidate)) return candidate
    candidate = `${stem}.upgrade-${stamp}-${index}${ext}`
    index += 1
  }
}

export function normalizeCarrierId(id) {
  return typeof id === 'string' && id.startsWith(LEGACY_CARRIER_PREFIX)
    ? `${STORAGE.carrierPrefix}${id.slice(LEGACY_CARRIER_PREFIX.length)}`
    : id
}

function mapProjectDocument(document, now) {
  const carriers = document.carriers && typeof document.carriers === 'object' && !Array.isArray(document.carriers)
    ? document.carriers
    : {}
  return {
    ...document,
    spec: STORAGE.projectSpec,
    schemaVersion: 4,
    updatedAt: now.toISOString(),
    carriers: {
      ...carriers,
      primary: normalizeCarrierId(carriers.primary ?? null),
      enabled: Array.isArray(carriers.enabled) ? carriers.enabled.map(normalizeCarrierId) : []
    }
  }
}

function mapRoute(value) {
  if (value === 'dir:拆解') return 'dir:故事源'
  if (value === 'dir:推演') return 'deduce'
  if (value === 'dir:参考') return 'reference'
  return value
}

/**
 * OS-188a：路径改写锚定在库根首段（或已知运行态前缀），路径中间的同名目录一律不动。
 * 旧行为是「任意位置命中即替换」，会把 `世界书/参考/a.md` 错改成 `世界书/世界书/a.md`。
 * 正斜杠与反斜杠都认，回写沿用原路径出现的第一种分隔符。
 */
function mapStoredPath(value) {
  const raw = text(value)
  if (!raw) return raw
  const parts = raw.split(/[\\/]/u)
  if (parts.length < 2) return raw
  const sep = /[\\/]/u.exec(raw)[0]
  let head = parts[0]
  let changed = false
  if (head === '.pinax') {
    head = STORAGE.metadataDir
    changed = true
  } else if (Object.hasOwn(DIR_RENAMES, head)) {
    head = DIR_RENAMES[head]
    changed = true
  }
  parts[0] = head
  // 已知运行态前缀：<元数据目录>/drafts|log/<旧模块名>/…
  if (head === STORAGE.metadataDir && (parts[1] === 'drafts' || parts[1] === 'log')) {
    const oldModule = parts[2]
    if (oldModule && Object.hasOwn(MODULE_RENAMES, oldModule) && MODULE_RENAMES[oldModule] !== oldModule) {
      parts[2] = MODULE_RENAMES[oldModule]
      changed = true
    }
  }
  return changed ? parts.join(sep) : raw
}

/** 旧关系扩展键抬升到新键名（只动对象键，不动值）。 */
function mapStoredKey(key) {
  return key === 'pinaxRelationExtensions' ? 'relationExtensions' : mapStoredPath(key)
}

/** JSON.parse 报错行号：优先用 Node 自带的 `(line N column M)`，否则按 position 折算。 */
function jsonErrorLine(message, source) {
  const explicit = /line (\d+)/u.exec(message)
  if (explicit) return Number(explicit[1])
  const position = /position (\d+)/u.exec(message)
  if (!position) return 1
  return source.slice(0, Number(position[1])).split('\n').length
}

function transformStoredJson(value, key = '') {
  if (Array.isArray(value)) {
    const next = value.map((item) => transformStoredJson(item, key))
    return JSON.stringify(next) === JSON.stringify(value) ? value : next
  }
  if (!value || typeof value !== 'object') {
    if (key === 'module' && MODULE_RENAMES[value]) return MODULE_RENAMES[value]
    if (key === 'view' || key === 'tabHidden' || key === 'hiddenTabs' || key === 'visibleTabs') return mapRoute(value)
    if (key === 'schema' && value === LEGACY_WIKI_SCHEMA) return WIKI_DERIVED_SCHEMA
    if (['path', 'file', 'archivePath', 'exportPath', 'sessionPath', 'assetPath'].includes(key) && typeof value === 'string') {
      return mapStoredPath(value)
    }
    return value
  }
  let changed = false
  const next = {}
  for (const [childKey, child] of Object.entries(value)) {
    const mappedKey = mapStoredKey(childKey)
    const mappedValue = transformStoredJson(child, childKey)
    if (Object.hasOwn(next, mappedKey)) {
      if (JSON.stringify(next[mappedKey]) !== JSON.stringify(mappedValue)) {
        throw new Error(`升级路径冲突：${childKey} 与现有键都映射到 ${mappedKey}`)
      }
      continue
    }
    next[mappedKey] = mappedValue
    if (mappedKey !== childKey || JSON.stringify(mappedValue) !== JSON.stringify(child)) changed = true
  }
  return changed ? next : value
}

async function walkJsonFiles(root, io, visit) {
  if (!await isDirectory(root)) return
  const entries = await io.readdir(root, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const path = join(root, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.retired-') || /\.retired-/u.test(entry.name)) continue
      await walkJsonFiles(path, io, visit)
    } else if (entry.isFile() && !entry.name.startsWith('.openstory-tmp-') && !entry.name.startsWith('.pinax-tmp-')) {
      await visit(path)
    }
  }
}

async function inspectLegacy(root, io) {
  const metadata = join(root, STORAGE.metadataDir)
  const oldMetadata = join(root, '.pinax')
  const oldDirs = Object.keys(DIR_RENAMES).filter((name) => existsSync(join(root, name)))
  const marker = join(metadata, 'project.json')
  let legacyMarker = false
  if (await exists(marker)) {
    try {
      const document = JSON.parse(await io.readFile(marker, 'utf-8'))
      legacyMarker = LEGACY_PROJECT_SPECS.includes(document?.spec)
        || text(document?.carriers?.primary).startsWith('pinax.carrier.')
        || (Array.isArray(document?.carriers?.enabled) && document.carriers.enabled.some((id) => text(id).startsWith('pinax.carrier.')))
    } catch {
      legacyMarker = legacyMarker || false
    }
  }
  const needed = existsSync(oldMetadata) || oldDirs.length > 0 || legacyMarker
  if (!needed) return { needed: false, oldDirs }
  const upgradeMarker = join(metadata, 'upgrade.json')
  if (await exists(upgradeMarker)) {
    let markerData = null
    try { markerData = JSON.parse(await io.readFile(upgradeMarker, 'utf-8')) } catch { markerData = null }
    if (markerData?.spec === LIBRARY_UPGRADE_SPEC && !existsSync(oldMetadata) && oldDirs.length === 0 && !legacyMarker) {
      return { needed: false, oldDirs, alreadyUpgraded: true }
    }
    throw new Error('升级标记仍在，但旧目录或旧谱系名再次出现；已拒绝重复迁移，请检查 .openstory/upgrade.json')
  }
  return { needed: true, oldDirs }
}

async function copyPath(source, target, io) {
  const stats = await io.lstat(source)
  if (stats.isDirectory()) {
    await io.mkdir(target)
    const entries = await io.readdir(source, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) await copyPath(join(source, entry.name), join(target, entry.name), io)
    return
  }
  if (stats.isSymbolicLink()) {
    await io.symlink(await io.readlink(source), target)
    return
  }
  await io.copyFile(source, target)
}

async function backupLegacy(root, backup, sources, io, operation) {
  operation('backup:mkdir')
  await io.mkdir(backup, { recursive: true })
  const copied = []
  for (const source of sources) {
    if (!await exists(source)) continue
    const target = join(backup, basename(source))
    operation(`backup:${basename(source)}`)
    await copyPath(source, target, io)
    copied.push(relPath(root, source))
  }
  const manifest = `${JSON.stringify({ spec: LIBRARY_UPGRADE_SPEC, at: new Date().toISOString(), copied }, null, 2)}\n`
  operation('backup:manifest')
  await io.atomicWrite(join(backup, 'backup-manifest.json'), manifest)
}

function journalFor(journal) {
  return {
    remove(path) { journal.push({ kind: 'remove', path }) },
    move(from, to) { journal.push({ kind: 'move', from, to }) },
    write(path, before) { journal.push({ kind: 'write', path, before }) }
  }
}

async function rollback(root, journal) {
  const errors = []
  for (const item of [...journal].reverse()) {
    try {
      if (item.kind === 'remove') await rm(item.path, { recursive: true, force: true })
      else if (item.kind === 'move') {
        if (!await exists(item.from)) await rename(item.to, item.from)
      } else if (item.before === null) await rm(item.path, { force: true })
      else await atomicWriteFile(item.path, item.before)
    } catch (error) {
      errors.push(`${relPath(root, item.path ?? item.to)}: ${text(error?.message || error)}`)
    }
  }
  return errors
}

async function ensureDirectory(root, path, journal, io, operation) {
  if (await exists(path)) return
  const parent = join(path, '..')
  if (parent !== root) await ensureDirectory(root, parent, journal, io, operation)
  journal.push({ kind: 'remove', path })
  operation(`mkdir:${relPath(root, path)}`)
  await io.mkdir(path)
}

async function copyTree(root, source, target, journal, io, operation, conflicts, stamp, report) {
  if (await exists(target)) {
    await mergeTree(root, source, target, journal, io, operation, conflicts, stamp, report)
    return
  }
  journal.push({ kind: 'remove', path: target })
  operation(`copy:${relPath(root, source)}`)
  await copyPath(source, target, io)
  report.copied.push({ from: relPath(root, source), to: relPath(root, target) })
}

async function mergeTree(root, source, target, journal, io, operation, conflicts, stamp, report) {
  await ensureDirectory(root, target, journal, io, operation)
  const entries = await io.readdir(source, { withFileTypes: true })
  entries.sort((a, b) => a.name.localeCompare(b.name))
  for (const entry of entries) {
    const from = join(source, entry.name)
    const wanted = join(target, entry.name)
    let to = wanted
    if (await exists(wanted)) {
      if (entry.isDirectory() && await isDirectory(wanted)) {
        await mergeTree(root, from, wanted, journal, io, operation, conflicts, stamp, report)
        continue
      }
      to = uniquePath(wanted, stamp)
      conflicts.push({ from: relPath(root, from), to: relPath(root, to), reason: '同名冲突，旧文件加后缀保留' })
    }
    journal.push({ kind: 'move', from, to })
    operation(`move:${relPath(root, from)}`)
    await io.rename(from, to)
    report.moved.push({ from: relPath(root, from), to: relPath(root, to) })
  }
}

async function retireDirectory(root, source, journal, io, operation, stamp, report) {
  if (!await exists(source)) return null
  let retired = `${source}.retired-${stamp}`
  let index = 2
  while (await exists(retired)) retired = `${source}.retired-${stamp}-${index++}`
  journal.push({ kind: 'move', from: source, to: retired })
  operation(`retire:${relPath(root, source)}`)
  await io.rename(source, retired)
  report.retired.push(relPath(root, retired))
  return retired
}

async function migrateLegacyDirectory(root, name, targetName, journal, io, operation, conflicts, stamp, report) {
  const source = join(root, name)
  const target = join(root, targetName)
  if (!await exists(source)) return
  await copyTree(root, source, target, journal, io, operation, conflicts, stamp, report)
  await retireDirectory(root, source, journal, io, operation, stamp, report)
}

async function rewriteJson(root, path, transform, journal, io, operation, report, strict = false) {
  const before = await io.readFile(path)
  let document
  try { document = JSON.parse(before.toString('utf-8')) } catch (error) {
    if (strict) throw error
    const source = before.toString('utf-8')
    report.skipped.push({ file: relPath(root, path), line: jsonErrorLine(text(error?.message || error), source), reason: text(error?.message || error) })
    return
  }
  const next = transform(document)
  if (JSON.stringify(next) === JSON.stringify(document)) return
  journal.push({ kind: 'write', path, before })
  operation(`rewrite:${relPath(root, path)}`)
  await io.atomicWrite(path, `${JSON.stringify(next, null, 2)}\n`)
  report.rewritten.push(relPath(root, path))
}

async function rewriteJsonLines(root, path, transform, journal, io, operation, report) {
  const before = await io.readFile(path, 'utf-8')
  let changed = false
  const after = before.split('\n').map((line, index) => {
    if (!line.trim()) return line
    let document
    try { document = JSON.parse(line) } catch (error) {
      report.skipped.push({ file: relPath(root, path), line: index + 1, reason: text(error?.message || error) })
      return line
    }
    const next = transform(document)
    if (JSON.stringify(next) === JSON.stringify(document)) return line
    changed = true
    return JSON.stringify(next)
  }).join('\n')
  if (!changed) return
  journal.push({ kind: 'write', path, before })
  operation(`rewrite:${relPath(root, path)}`)
  await io.atomicWrite(path, after)
  report.rewritten.push(relPath(root, path))
}

/**
 * OS-188a：世界书条目 md 的 frontmatter 顶层旧键抬升。只替换键名所在那一行的键，
 * 其余字节（含 CRLF、缩进、块标量内容）原样保留；改写前过 journal，原文件由整库备份兜底。
 */
async function rewriteMarkdownKey(root, path, journal, io, operation, report) {
  const before = await io.readFile(path, 'utf-8')
  const lines = before.split('\n')
  if (lines[0]?.trim() !== '---') return
  let end = -1
  for (let index = 1; index < lines.length; index += 1) {
    if (/^---\r?$/u.test(lines[index])) { end = index; break }
  }
  if (end < 1) return
  let changed = false
  for (let index = 1; index < end; index += 1) {
    const match = /^pinaxRelationExtensions(\s*:)/u.exec(lines[index])
    if (!match) continue
    lines[index] = `relationExtensions${match[1]}`
    changed = true
  }
  if (!changed) return
  journal.push({ kind: 'write', path, before })
  operation(`rewrite-md:${relPath(root, path)}`)
  await io.atomicWrite(path, lines.join('\n'))
  report.frontmatter.push(relPath(root, path))
}

/** OS-188a：把库内 `.pinax-tmp-*` 残留按相对路径挪进备份的 tmp-residue/，不删除。 */
async function archiveTmpResidue(root, backup, journal, io, operation, report) {
  const residueRoot = join(backup, 'tmp-residue')
  async function walk(dir) {
    if (!await isDirectory(dir)) return
    const entries = await io.readdir(dir, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.retired-') || /\.retired-/u.test(entry.name)) continue
        await walk(path)
      } else if (entry.isFile() && entry.name.startsWith('.pinax-tmp-')) {
        const rel = relPath(root, path)
        const target = join(residueRoot, rel)
        await ensureDirectory(root, join(target, '..'), journal, io, operation)
        journal.push({ kind: 'move', from: path, to: target })
        operation(`archive-tmp:${rel}`)
        await io.rename(path, target)
        report.tmpResidue.push(rel)
      }
    }
  }
  await walk(root)
}

async function migrateModuleState(root, parentName, journal, io, operation, conflicts, stamp, report) {
  const parent = join(root, STORAGE.metadataDir, parentName)
  if (!await isDirectory(parent)) return
  for (const [oldName, newName] of Object.entries(MODULE_RENAMES)) {
    if (oldName === newName) continue
    const source = join(parent, oldName)
    if (!await exists(source)) continue
    const target = join(parent, newName)
    await copyTree(root, source, target, journal, io, operation, conflicts, stamp, report)
    await retireDirectory(root, source, journal, io, operation, stamp, report)
  }
}

async function runUpgrade(root, options = {}) {
  const now = options.now instanceof Date ? options.now : new Date()
  const stamp = stampOf(now)
  const io = {
    copyFile: options.deps?.copyFile ?? copyFile,
    lstat: options.deps?.lstat ?? lstat,
    mkdir: options.deps?.mkdir ?? mkdir,
    readdir: options.deps?.readdir ?? readdir,
    readFile: options.deps?.readFile ?? readFile,
    readlink: options.deps?.readlink ?? readlink,
    rename: options.deps?.rename ?? rename,
    symlink: options.deps?.symlink ?? symlink,
    atomicWrite: options.deps?.atomicWrite ?? atomicWriteFile
  }
  const operation = (name) => {
    if (options.deps?.failAt === name) throw new Error(`注入失败：${name}`)
  }
  const journal = []
  const mutations = journalFor(journal)
  const report = {
    at: now.toISOString(), backup: '', copied: [], moved: [], retired: [], conflicts: [], rewritten: [],
    skipped: [], frontmatter: [], tmpResidue: []
  }
  let phase = 'inspect'
  let backup = ''
  let historyExisted = false
  try {
    const legacy = await inspectLegacy(root, io)
    if (!legacy.needed) return { ok: true, upgraded: false, alreadyUpgraded: legacy.alreadyUpgraded === true, report: null }

    phase = 'backup'
    const historyPath = join(root, '.history')
    historyExisted = await exists(historyPath)
    backup = join(historyPath, `upgrade-${stamp}`)
    let backupIndex = 2
    while (await exists(backup)) backup = join(historyPath, `upgrade-${stamp}-${backupIndex++}`)
    const sources = [
      join(root, '.pinax'), join(root, STORAGE.metadataDir),
      ...Object.keys(DIR_RENAMES).flatMap((name) => [join(root, name), join(root, DIR_RENAMES[name])])
    ]
    await backupLegacy(root, backup, sources, io, operation)
    report.backup = relPath(root, backup)

    phase = 'runtime'
    await migrateLegacyDirectory(root, '.pinax', STORAGE.metadataDir, journal, io, operation, report.conflicts, stamp, report)
    await ensureDirectory(root, join(root, STORAGE.metadataDir), journal, io, operation)

    phase = 'directories'
    for (const [oldName, newName] of Object.entries(DIR_RENAMES)) {
      await migrateLegacyDirectory(root, oldName, newName, journal, io, operation, report.conflicts, stamp, report)
    }

    phase = 'state-names'
    await migrateModuleState(root, 'log', journal, io, operation, report.conflicts, stamp, report)
    await migrateModuleState(root, 'drafts', journal, io, operation, report.conflicts, stamp, report)

    phase = 'project-marker'
    const projectPath = join(root, STORAGE.metadataDir, 'project.json')
    if (await exists(projectPath)) {
      await rewriteJson(root, projectPath, (document) => mapProjectDocument(document, now), journal, io, operation, report, true)
    }

    phase = 'derived-schema'
    for (const dir of ['世界书', '故事源', '扮演']) {
      await walkJsonFiles(join(root, dir), io, async (path) => {
        if (!path.endsWith('.wiki.json')) return
        await rewriteJson(root, path, (document) => {
          if (document?.derivedFrom?.schema !== LEGACY_WIKI_SCHEMA) return document
          return { ...document, derivedFrom: { ...document.derivedFrom, schema: WIKI_DERIVED_SCHEMA } }
        }, journal, io, operation, report)
      })
    }

    phase = 'stored-paths'
    for (const dir of [STORAGE.metadataDir, '世界书', '故事源', '扮演']) {
      await walkJsonFiles(join(root, dir), io, async (path) => {
        if (path.endsWith('.jsonl')) {
          await rewriteJsonLines(root, path, transformStoredJson, journal, io, operation, report)
        } else if (path.endsWith('.json') && path !== projectPath && !path.endsWith('.wiki.json')) {
          await rewriteJson(root, path, transformStoredJson, journal, io, operation, report)
        }
      })
    }

    phase = 'frontmatter'
    await walkJsonFiles(join(root, namingEntry('worldbook').dir), io, async (path) => {
      if (path.endsWith('.md')) await rewriteMarkdownKey(root, path, journal, io, operation, report)
    })

    phase = 'tmp-residue'
    await archiveTmpResidue(root, backup, journal, io, operation, report)

    phase = 'upgrade-marker'
    const markerPath = join(root, STORAGE.metadataDir, 'upgrade.json')
    mutations.write(markerPath, null)
    operation('write:upgrade.json')
    const markerContent = `${JSON.stringify({ spec: LIBRARY_UPGRADE_SPEC, ...report }, null, 2)}\n`
    await io.atomicWrite(markerPath, markerContent)

    phase = 'changelog'
    const logRel = logFilePath(LOG_MODULES.libraryUpgrade, now)
    const logPath = join(root, logRel)
    const logBefore = await exists(logPath) ? await readFile(logPath, 'utf-8') : null
    mutations.write(logPath, logBefore)
    operation('write:upgrade-log')
    const logged = await recordChange({
      root,
      module: LOG_MODULES.libraryUpgrade,
      file: `${STORAGE.metadataDir}/upgrade.json`,
      op: 'create',
      after: markerContent,
      actor: 'system',
      now,
      meta: {
        backup: report.backup, conflicts: report.conflicts.length, rewritten: report.rewritten.length,
        skipped: report.skipped.length, frontmatter: report.frontmatter.length, tmpResidue: report.tmpResidue.length
      }
    })
    if (!logged.ok) throw new Error(`升级变更日志写入失败：${logged.message}`)
    return { ok: true, upgraded: true, report }
  } catch (error) {
    if (phase === 'backup') {
      await rm(backup, { recursive: true, force: true }).catch(() => {})
      if (!historyExisted) await rm(join(root, '.history'), { recursive: true, force: true }).catch(() => {})
      return { ok: false, code: 'LIBRARY_UPGRADE_FAILED', phase, rolledBack: true, message: `库升级备份失败，原库未改动：${text(error?.message || error)}` }
    }
    const rollbackErrors = await rollback(root, journal)
    return {
      ok: false,
      code: 'LIBRARY_UPGRADE_FAILED',
      phase,
      rolledBack: rollbackErrors.length === 0,
      rollbackErrors,
      message: rollbackErrors.length === 0
        ? `库升级在「${phase}」阶段失败，已原样回滚：${text(error?.message || error)}`
        : `库升级在「${phase}」阶段失败，回滚也未完成：${text(error?.message || error)}`
    }
  }
}

export async function upgradeLibrary(root, options = {}) {
  return runUpgrade(resolve(text(root)), options)
}

export async function ensureLibraryUpgraded(root) {
  const target = resolve(text(root))
  if (!target || completed.has(target)) return { ok: true, upgraded: false }
  const pending = inflight.get(target)
  if (pending) return pending
  const task = runUpgrade(target).then((result) => {
    if (result.ok) completed.add(target)
    return result
  }).finally(() => inflight.delete(target))
  inflight.set(target, task)
  return task
}

export function clearLibraryUpgradeCache() {
  inflight.clear()
  completed.clear()
}
