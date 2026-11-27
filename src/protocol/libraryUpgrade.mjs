import { existsSync } from 'node:fs'
import { lstat, mkdir, readdir, readFile, readlink, rename, rm, copyFile, symlink } from 'node:fs/promises'
import { basename, extname, join, relative, resolve, sep } from 'node:path'
import { atomicWriteFile } from './hostWrite.mjs'
import { LOG_MODULES, namingEntry } from './naming.mjs'
import { logFilePath, recordChange } from './changelog.mjs'
import { sha256 } from './upgradePlan.mjs'
import { buildPlan } from './upgradePlan.mjs'

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

/**
 * 旧库根判定（OS-189）：历史运行态目录名只在本文件出现，调用方只拿到布尔值。
 * 用于导入适配器拒绝「拿旧库当原稿目录」；是否升级仍由 ensureLibraryUpgraded 决定。
 */
export function isLegacyLibraryRoot(root) {
  const raw = text(root).trim()
  if (!raw) return false
  return existsSync(join(resolve(raw), '.pinax'))
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

/**
 * OS-190/190a：旧 id／旧视图键 → 前端认得的视图键。旧库里既可能存旧「视图键」
 * （dir:参考 / dir:推演 / dir:拆解），也可能存旧 manifest 页 id
 * （reference / deduce / storySource / write）。页面型落到正名 slug（chapters/worldbook/
 * roleplay），目录型落到 dir: 视图（故事源没有独立页面视图，走 dir:故事源）。
 */
export const VIEW_ID_RENAMES = Object.freeze({
  'dir:参考': 'worldbook', 'dir:推演': 'roleplay', 'dir:拆解': 'dir:故事源',
  reference: 'worldbook', deduce: 'roleplay', storySource: 'dir:故事源', write: 'chapters',
  worldbook: 'worldbook', roleplay: 'roleplay', storysource: 'dir:故事源', chapters: 'chapters',
  '正文': 'chapters'
})
function mapRoute(value) {
  return VIEW_ID_RENAMES[value] ?? value
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

/**
 * OS-190：旧模块 slug → 新 slug（仅启停/设置键，端点与 MCP 名不在 ui-state 里）。
 * 扁平键 `modules.enabled.kb` 与嵌套 `modules: { enabled: { kb: … } }` 都认。
 */
const MODULE_ID_RENAMES = Object.freeze({ comfyui: 'imagegen', kb: 'knowledge' })
const MODULE_STATE_PREFIX = /^modules\.(enabled|settings)\./u

function mapModuleStateKey(key, path) {
  const flat = MODULE_STATE_PREFIX.exec(key)
  if (flat) {
    const newId = MODULE_ID_RENAMES[flat[1] === 'enabled' ? key.slice(flat[0].length) : null]
    if (flat[1] === 'enabled' && newId) return `modules.enabled.${newId}`
    if (flat[1] === 'settings') {
      const rest = key.slice(flat[0].length)
      const dot = rest.indexOf('.')
      const head = dot === -1 ? rest : rest.slice(0, dot)
      const newId = MODULE_ID_RENAMES[head]
      if (newId) return `modules.settings.${newId}${dot === -1 ? '' : rest.slice(dot)}`
    }
    return key
  }
  // 嵌套：path 是父键路径；只有父是 modules.enabled / modules.settings 时才改模块 id 段
  if (path === 'modules.enabled' || path === 'modules.settings') return MODULE_ID_RENAMES[key] ?? key
  return key
}

/** 旧关系扩展键抬升到新键名（只动对象键，不动值）。 */
function mapStoredKey(key, path = '') {
  if (key === 'pinaxRelationExtensions') return 'relationExtensions'
  const moduleKey = mapModuleStateKey(key, path)
  return moduleKey === key ? mapStoredPath(key) : moduleKey
}

/** JSON.parse 报错行号：优先用 Node 自带的 `(line N column M)`，否则按 position 折算。 */
function jsonErrorLine(message, source) {
  const explicit = /line (\d+)/u.exec(message)
  if (explicit) return Number(explicit[1])
  const position = /position (\d+)/u.exec(message)
  if (!position) return 1
  return source.slice(0, Number(position[1])).split('\n').length
}

function transformStoredJson(value, key = '', path = '') {
  if (Array.isArray(value)) {
    const next = value.map((item) => transformStoredJson(item, key, path))
    return JSON.stringify(next) === JSON.stringify(value) ? value : next
  }
  if (!value || typeof value !== 'object') {
    if (key === 'module' && MODULE_RENAMES[value]) return MODULE_RENAMES[value]
    if (key === 'view' || key === 'tabHidden' || key === 'hiddenTabs' || key === 'visibleTabs' || key === 'selectedTab') return mapRoute(value)
    if (key === 'schema' && value === LEGACY_WIKI_SCHEMA) return WIKI_DERIVED_SCHEMA
    if (['path', 'file', 'archivePath', 'exportPath', 'sessionPath', 'assetPath'].includes(key) && typeof value === 'string') {
      return mapStoredPath(value)
    }
    return value
  }
  let changed = false
  const next = {}
  for (const [childKey, child] of Object.entries(value)) {
    const mappedKey = mapStoredKey(childKey, path)
    const childPath = path ? `${path}.${childKey}` : childKey
    const mappedValue = transformStoredJson(child, childKey, childPath)
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
      conflicts.push({ kind: 'name-conflict', from: relPath(root, from), to: relPath(root, to), reason: '同名冲突，旧文件加后缀保留', blocking: false })
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

    // OS-220：动笔之前先出只读计划（同一套 inspect/改写判定，零写入）。
    // 这是真实请求路径上的调用点（daemon 首次打开旧库 → ensureLibraryUpgraded →
    // upgradeLibrary；以及 /api/library/diagnose → diagnoseLibrary → upgradeLibrary）：
    // 作者在看到任何副作用之前就能拿到「会动哪些文件、有什么冲突、备份在哪」。
    // 计划失败绝不放宽升级本身：拿不到就如实 plan:null，升级按原路径继续。
    let plan = null
    try {
      plan = buildSelfPlan(root, await diagnoseLibraryUpgrade(root, { now }), now)
    } catch {
      plan = null
    }

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
    return { ok: true, upgraded: true, report, plan }
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

/**
 * OS-220：只读升级诊断。与 `runUpgrade` 共用同一套判定（`inspectLegacy`、
 * `transformStoredJson`、目录改名表），但**零写入**：只用 lstat/readdir/readFile，
 * 不 mkdir、不 rename、不写 marker、不建 `.history`。
 *
 * 预览把「迁移后会落在哪里」算成虚拟树：先按 `copyTree`/`mergeTree` 的同一规则
 * 规划每个文件的去向，再在这份虚拟树上跑与真实升级相同的改写判定
 * （项目标记、wiki 谱系、存储路径键、frontmatter），因此计划里的文件与真实升级
 * 逐一对应。`now` 只影响时间派生命名与 `updatedAt` 预测，不参与 planId 语义。
 */
export async function diagnoseLibraryUpgrade(root, options = {}) {
  const target = resolve(text(root))
  const now = options.now instanceof Date ? options.now : new Date()
  const stamp = stampOf(now)
  const io = {
    readdir: options.deps?.readdir ?? readdir,
    readFile: options.deps?.readFile ?? readFile,
    lstat: options.deps?.lstat ?? lstat
  }
  const section = {
    needed: false,
    alreadyUpgraded: false,
    blocking: null,
    oldDirs: [],
    operations: [],
    movedFiles: [],
    rewrites: [],
    conflicts: [],
    skipped: [],
    backup: { scope: [], predictedPath: '' },
    // 旧库升级的 journal 是进程内逆序回滚表（runUpgrade 的 `journal` 数组），
    // 唯一持久化产物是 `.openstory/upgrade.json` 升级标记，失败时不留 journal 文件。
    markerPath: relPath(target, join(target, STORAGE.metadataDir, 'upgrade.json')),
    journalPath: null,
    journalKind: 'in-memory',
    journalPersistedAs: '',
    risks: []
  }
  let legacy
  try {
    legacy = await inspectLegacy(target, io)
  } catch (error) {
    section.blocking = text(error?.message || error)
    section.risks.push('升级标记仍在而旧目录/旧谱系名再次出现：重复迁移被拒绝，需人工检查 .openstory/upgrade.json')
    return section
  }
  section.oldDirs = legacy.oldDirs ?? []
  if (!legacy.needed) {
    section.alreadyUpgraded = legacy.alreadyUpgraded === true || await hasUpgradeMarker(target, io)
    if (!section.alreadyUpgraded) section.risks.push('库已是新布局：升级计划为空')
    return section
  }
  section.needed = true
  section.backup.predictedPath = relPath(target, join(target, '.history', `upgrade-${stamp}`))
  section.journalPersistedAs = section.markerPath
  section.backup.scope = [
    '.pinax', STORAGE.metadataDir,
    ...Object.keys(DIR_RENAMES).flatMap((name) => [name, DIR_RENAMES[name]])
  ].filter((rel) => existsSync(join(target, rel)))

  // 虚拟树：把升级会碰到的目录读进内存，按 runUpgrade 的同一顺序与规则演练一遍。
  let model
  try {
    model = await loadVirtualTree(target, io)
  } catch (error) {
    section.blocking = text(error?.message || error)
    section.skipped.push({ file: '.', reason: 'VIRTUAL_TREE_UNREADABLE', blocking: true })
    section.risks.push('预览无法完整读取受影响目录：已阻断，避免带漏项执行')
    return section
  }
  const ctx = { root: target, io, stamp, model }
  const out = { operations: section.operations, movedFiles: section.movedFiles, conflicts: section.conflicts }
  ctx.out = out
  await copyTreeModel(ctx, '.pinax', STORAGE.metadataDir)
  if (!model.has(STORAGE.metadataDir)) {
    // 与 runUpgrade 的 ensureDirectory 对应：没有 .pinax 可搬、.openstory 也还不存在时补建。
    model.set(STORAGE.metadataDir, { kind: 'dir' })
    out.operations.push({ kind: 'mkdir', path: STORAGE.metadataDir })
  }
  // 真实升级的 migrateLegacyDirectory 复制后必退役 `.pinax`（与业务目录同一规则）。
  retireModel(ctx, '.pinax', out)
  for (const [oldName, newName] of Object.entries(DIR_RENAMES)) {
    await copyTreeModel(ctx, oldName, newName)
    retireModel(ctx, oldName, out)
  }
  await planModuleStateMigration(ctx, 'log', out)
  await planModuleStateMigration(ctx, 'drafts', out)
  await planTmpResidue(ctx, section.backup.predictedPath, out)

  // 改写判定：在虚拟树的最终形状上跑与真实升级相同的判定（顺序也一致）。
  const projectRel = `${STORAGE.metadataDir}/project.json`
  const projectEntry = model.get(projectRel)
  if (projectEntry?.kind === 'file') {
    const parsed = await readJsonPreview(projectEntry.abs, io, section.skipped, projectRel)
    if (parsed.bad) section.blocking = `项目标记不是合法 JSON：${projectRel}`
    else {
      // 真实升级必写 marker（updatedAt 取 now、spec 抬到 @4），计划照实预测一笔。
      const carriers = parsed.value?.carriers && typeof parsed.value.carriers === 'object' ? parsed.value.carriers : {}
      section.project = {
        // 旧侧原样（旧 spec／旧 carrier 谱系名），新侧是升级后要落的值。
        from: {
          spec: text(parsed.value?.spec),
          schemaVersion: parsed.value?.schemaVersion ?? null,
          primary: carriers.primary ?? null,
          enabled: Array.isArray(carriers.enabled) ? carriers.enabled : []
        },
        to: {
          spec: STORAGE.projectSpec,
          schemaVersion: 4,
          primary: normalizeCarrierId(carriers.primary ?? null),
          enabled: Array.isArray(carriers.enabled) ? carriers.enabled.map(normalizeCarrierId) : []
        }
      }
      section.rewrites.push({ file: projectRel, kind: 'project-marker' })
    }
  } else {
    section.risks.push('库没有 .openstory/project.json：升级不会补造项目标记')
  }
  for (const dir of ['世界书', '故事源', '扮演']) {
    for (const [rel, entry] of modelEntries(model, dir)) {
      if (!rel.endsWith('.wiki.json')) continue
      const parsed = await readJsonPreview(entry.abs, io, section.skipped, rel)
      if (!parsed.bad && parsed.value?.derivedFrom?.schema === LEGACY_WIKI_SCHEMA) {
        section.rewrites.push({ file: rel, kind: 'wiki-schema' })
      }
    }
  }
  for (const dir of [STORAGE.metadataDir, '世界书', '故事源', '扮演']) {
    for (const [rel, entry] of modelEntries(model, dir)) {
      if (rel.endsWith('.jsonl')) {
        const before = await io.readFile(entry.abs, 'utf-8')
        let changed = false
        before.split('\n').forEach((line, index) => {
          if (!line.trim()) return
          let document
          try { document = JSON.parse(line) } catch (error) {
            section.skipped.push({ file: rel, line: index + 1, reason: text(error?.message || error) })
            return
          }
          try {
            if (JSON.stringify(transformStoredJson(document)) !== JSON.stringify(document)) changed = true
          } catch (error) {
            section.conflicts.push({ kind: 'key-conflict', file: rel, line: index + 1, reason: text(error?.message || error), blocking: true })
          }
        })
        if (changed) section.rewrites.push({ file: rel, kind: 'jsonl' })
      } else if (rel.endsWith('.json') && rel !== projectRel && !rel.endsWith('.wiki.json')) {
        const parsed = await readJsonPreview(entry.abs, io, section.skipped, rel)
        if (parsed.bad) continue
        try {
          if (JSON.stringify(transformStoredJson(parsed.value)) !== JSON.stringify(parsed.value)) {
            section.rewrites.push({ file: rel, kind: 'json' })
          }
        } catch (error) {
          section.conflicts.push({ kind: 'key-conflict', file: rel, reason: text(error?.message || error), blocking: true })
        }
      }
    }
  }
  const worldbookDir = namingEntry('worldbook').dir
  for (const [rel, entry] of modelEntries(model, worldbookDir)) {
    if (!rel.endsWith('.md')) continue
    const before = await io.readFile(entry.abs, 'utf-8')
    if ((before.match(/^pinaxRelationExtensions(\s*:)/gmu) ?? []).length > 0) {
      section.rewrites.push({ file: rel, kind: 'frontmatter' })
    }
  }
  if (section.conflicts.some((item) => item.blocking)) {
    section.risks.push('存在状态键合并冲突：真实升级会在 stored-paths 阶段失败并整库回滚，必须先人工消解，否则不可执行')
  }
  if (section.skipped.length) {
    section.risks.push(`有 ${section.skipped.length} 处坏 JSON/JSONL：升级会跳过这些位置（原字节保留），升级后仍需人工修复`)
  }
  if (section.oldDirs.length) {
    section.risks.push(`旧业务目录将改名留档：${section.oldDirs.map((name) => `${name}→${DIR_RENAMES[name]}.retired-${stamp}`).join('、')}`)
  }
  section.bindings = await collectAffectedBindings(target, section, io)
  return section
}

/** 库已在新布局且带本产品的升级标记＝一次性升级早已完成（读侧只认标记，不猜）。 */
async function hasUpgradeMarker(root, io) {
  const marker = join(root, STORAGE.metadataDir, 'upgrade.json')
  let source
  try { source = await io.readFile(marker, 'utf-8') } catch { return false }
  try { return JSON.parse(source)?.spec === LIBRARY_UPGRADE_SPEC } catch { return false }
}

/**
 * OS-221：升级标记的只读观测（**零写入**）。与 `inspectLegacy` 共用同一套旧库判定，
 * 但不抛错、不建目录：把「标记缺失/损坏/已升级/重复迁移被拒」分开回报，
 * 供迁移状态端点如实呈现。报告里只保留计数与备份路径，不携带任何稿件正文。
 */
export async function readUpgradeStatus(root) {
  const target = resolve(text(root))
  const markerPath = join(target, STORAGE.metadataDir, 'upgrade.json')
  const out = {
    markerPath: relPath(target, markerPath),
    markerState: 'absent',
    spec: '',
    at: '',
    backupPath: '',
    report: null,
    needed: false,
    alreadyUpgraded: false,
    repeatBlocked: false,
    blocking: '',
    oldDirs: []
  }
  let source = null
  try {
    source = await readFile(markerPath, 'utf-8')
  } catch (error) {
    if (error?.code !== 'ENOENT' && error?.code !== 'ENOTDIR') {
      out.markerState = 'unreadable'
      out.blocking = text(error?.message || error)
    }
  }
  if (source !== null) {
    let marker = null
    try { marker = JSON.parse(source) } catch { marker = null }
    if (!marker || typeof marker !== 'object' || Array.isArray(marker)) {
      out.markerState = 'corrupt'
    } else if (marker.spec !== LIBRARY_UPGRADE_SPEC) {
      out.markerState = 'foreign-spec'
      out.spec = text(marker.spec)
    } else {
      out.markerState = 'ok'
      out.spec = text(marker.spec)
      out.at = text(marker.at)
      out.backupPath = text(marker.backup)
      out.report = {
        backup: text(marker.backup),
        conflicts: Array.isArray(marker.conflicts) ? marker.conflicts.length : 0,
        rewritten: Array.isArray(marker.rewritten) ? marker.rewritten.length : 0,
        skipped: Array.isArray(marker.skipped) ? marker.skipped.length : 0,
        frontmatter: Array.isArray(marker.frontmatter) ? marker.frontmatter.length : 0,
        tmpResidue: Array.isArray(marker.tmpResidue) ? marker.tmpResidue.length : 0
      }
    }
  }
  const io = { readdir, readFile, lstat }
  try {
    const legacy = await inspectLegacy(target, io)
    out.needed = legacy.needed === true
    // 与 `diagnoseLibraryUpgrade` 同口径：标记在且无旧目录/旧谱系名也算已升级。
    out.alreadyUpgraded = legacy.alreadyUpgraded === true || out.markerState === 'ok'
    out.oldDirs = legacy.oldDirs ?? []
  } catch (error) {
    // 标记还在而旧目录/旧谱系名又出现：重复迁移被拒绝——状态必须点名，不冒充健康。
    out.repeatBlocked = true
    out.blocking = text(error?.message || error)
    out.alreadyUpgraded = false
    out.oldDirs = Object.keys(DIR_RENAMES).filter((name) => existsSync(join(target, name)))
  }
  return out
}

/**
 * 受影响文件的摘要绑定（OS-220 任务 3）：键用**执行前**的库内相对路径，
 * 值是该文件当前字节的 sha256。执行前重算即可发现「预览后有人动过稿」。
 */
async function collectAffectedBindings(root, section, io) {
  const affected = new Set([
    ...section.movedFiles.filter((item) => item.from !== item.to).map((item) => item.to),
    ...section.rewrites.map((item) => item.file)
  ])
  const originalOf = new Map(section.movedFiles.map((item) => [item.to, item.from]))
  // 一次升级可能把同一文件搬两次（.pinax/log/参考 → .openstory/log/参考 →
  // .openstory/log/世界书）。绑定必须一路追到执行前的真实原路径，不能只取最后一段。
  const sourceOf = (rel) => {
    const seen = new Set()
    let current = rel
    while (originalOf.has(current) && !seen.has(current)) {
      seen.add(current)
      current = originalOf.get(current)
    }
    return current
  }
  const bindings = []
  for (const rel of [...affected].sort()) {
    // 计划里的路径是升级后的路径；绑定用执行前的**原路径**，执行前重算才对得上。
    const sourceRel = sourceOf(rel)
    let bytes
    try { bytes = await io.readFile(join(root, sourceRel)) } catch (error) {
      if (error?.code === 'EISDIR') {
        // 目录退役只搬动目录项，没有「原文件字节」可绑定；目录内文件已由 movedFiles 覆盖。
        // 不能把目录读失败当文件漂移，否则旧库的推演/等空目录会被误判阻断。
        const info = await io.lstat(join(root, sourceRel)).catch(() => null)
        if (info?.isDirectory()) continue
      }
      // 预览已判定该文件受影响却读不到：不能静默漏掉漂移绑定。
      section.skipped.push({ file: sourceRel, reason: 'AFFECTED_FILE_UNREADABLE', blocking: true })
      section.blocking = `受影响文件读不到：${sourceRel}`
      continue
    }
    bindings.push({ id: `file:${sourceRel}`, path: sourceRel, sha256: sha256(bytes) })
  }
  return bindings
}

/* ---------- OS-220 虚拟树：把升级演练在内存里走一遍 ---------- */

/**
 * 虚拟树里的条目：`dir` / `file`。文件记住真实磁盘路径（`abs`，改写判定从这里读字节），
 * 目录不记路径。键是**库内相对路径（posix）**，与 report/journalk 同一口径。
 */
async function loadVirtualTree(root, io) {
  const model = new Map()
  async function walk(rel) {
    let entries = []
    try { entries = await io.readdir(join(root, rel), { withFileTypes: true }) } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') return
      throw new Error(`预览无法读取目录 ${rel || '.'}：${text(error?.message || error)}`)
    }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = `${rel}/${entry.name}`
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.retired-') || /\.retired-/u.test(entry.name)) continue
        model.set(childRel, { kind: 'dir' })
        await walk(childRel)
      } else if (entry.isFile() && !entry.name.startsWith('.openstory-tmp-') && !entry.name.startsWith('.pinax-tmp-')) {
        model.set(childRel, { kind: 'file', abs: join(root, childRel) })
      }
    }
  }
  for (const dir of ['.pinax', STORAGE.metadataDir, ...Object.keys(DIR_RENAMES), ...Object.values(DIR_RENAMES)]) {
    if (model.has(dir) || !await isDirectory(join(root, dir))) continue
    model.set(dir, { kind: 'dir' })
    await walk(dir)
  }
  return model
}

/** 目录下的全部条目（目录在前、文件在后，按字典序），`[相对路径, 条目]`。 */
function modelEntries(model, dirRel) {
  const prefix = `${dirRel}/`
  return [...model]
    .filter(([rel, entry]) => entry.kind === 'file' && rel.startsWith(prefix))
    .sort(([left], [right]) => left.localeCompare(right))
}

/** 目录子树（含目录自身之下的目录条目），搬移时用；父目录先于子路径出现。 */
function modelSubtree(model, dirRel) {
  const prefix = `${dirRel}/`
  return [...model]
    .filter(([rel]) => rel.startsWith(prefix))
    .sort(([left], [right]) => left.localeCompare(right))
}

function moveModel(ctx, fromRel, toRel, out) {
  const entry = ctx.model.get(fromRel)
  if (!entry) return
  ctx.model.delete(fromRel)
  ctx.model.set(toRel, entry.kind === 'dir' ? { kind: 'dir' } : entry)
  if (entry.kind === 'file') out.movedFiles.push({ from: fromRel, to: toRel })
}

/**
 * 与 `copyTree`/`mergeTree` 同规则：目标不存在＝整树复制；目标已存在＝逐项合并、
 * 同名文件加 `.upgrade-<stamp>` 后缀。差别只在虚拟树里做，不碰磁盘。
 * `migrateModuleState` 依赖「复制出的目录条目真的在树里」——目录与文件一起搬。
 */
async function copyTreeModel(ctx, sourceRel, targetRel) {
  const { model, out } = ctx
  const source = model.get(sourceRel)
  if (!source || source.kind !== 'dir') return
  if (!model.has(targetRel)) {
    model.set(targetRel, { kind: 'dir' })
    out.operations.push({ kind: 'copy-tree', from: sourceRel, to: targetRel, action: 'copy' })
    for (const [rel] of modelSubtree(model, sourceRel)) {
      moveModel(ctx, rel, `${targetRel}/${rel.slice(sourceRel.length + 1)}`, out)
    }
    return
  }
  out.operations.push({ kind: 'copy-tree', from: sourceRel, to: targetRel, action: 'merge' })
  await mergeTreeModel(ctx, sourceRel, targetRel)
}

async function mergeTreeModel(ctx, sourceRel, targetRel) {
  const { model, stamp, out } = ctx
  const children = [...model]
    .filter(([rel]) => rel.startsWith(`${sourceRel}/`))
    .map(([rel]) => rel.slice(sourceRel.length + 1))
    .filter((tail) => !tail.includes('/'))
    .sort()
  for (const name of children) {
    const fromRel = `${sourceRel}/${name}`
    const entry = model.get(fromRel)
    let toRel = `${targetRel}/${name}`
    if (model.has(toRel)) {
      if (entry.kind === 'dir' && model.get(toRel)?.kind === 'dir') {
        await mergeTreeModel(ctx, fromRel, toRel)
        continue
      }
      toRel = uniqueModelPath(model, toRel, stamp)
      out.conflicts.push({ kind: 'name-conflict', from: fromRel, to: toRel, reason: '同名冲突，旧文件加后缀保留', blocking: false })
    }
    if (entry.kind === 'dir') {
      model.set(toRel, { kind: 'dir' })
      out.operations.push({ kind: 'copy-tree', from: fromRel, to: toRel, action: 'copy' })
      for (const [rel] of modelSubtree(model, fromRel)) {
        moveModel(ctx, rel, `${toRel}/${rel.slice(fromRel.length + 1)}`, out)
      }
    } else {
      moveModel(ctx, fromRel, toRel, out)
    }
  }
}

/** 承载目录改名（退役）：`.retired-<stamp>` 与真实升级同名规则。 */
function retireModel(ctx, sourceRel, out) {
  if (!ctx.model.has(sourceRel)) return
  let retired = `${sourceRel}.retired-${ctx.stamp}`
  let index = 2
  while (ctx.model.has(retired)) retired = `${sourceRel}.retired-${ctx.stamp}-${index++}`
  ctx.model.set(retired, ctx.model.get(sourceRel))
  ctx.model.delete(sourceRel)
  out.operations.push({ kind: 'retire', from: sourceRel, to: retired })
}

function uniqueModelPath(model, targetRel, stamp) {
  const ext = extname(targetRel)
  const stem = ext ? targetRel.slice(0, -ext.length) : targetRel
  let candidate = `${stem}.upgrade-${stamp}${ext}`
  let index = 2
  while (model.has(candidate)) {
    candidate = `${stem}.upgrade-${stamp}-${index}${ext}`
    index += 1
  }
  return candidate
}

/** 运行态模块目录改名（`.openstory/log|drafts/<旧模块>` → 新模块名），同 `migrateModuleState`。 */
async function planModuleStateMigration(ctx, parentName, out) {
  const baseRel = `${STORAGE.metadataDir}/${parentName}`
  if (!ctx.model.has(baseRel)) return
  for (const [oldName, newName] of Object.entries(MODULE_RENAMES)) {
    if (oldName === newName) continue
    const sourceRel = `${baseRel}/${oldName}`
    if (!ctx.model.has(sourceRel)) continue
    await copyTreeModel(ctx, sourceRel, `${baseRel}/${newName}`)
    retireModel(ctx, sourceRel, out)
  }
}

/** `.pinax-tmp-*` 残留迁进备份 tmp-residue/（不删除），与 `archiveTmpResidue` 同遍历规则。 */
async function planTmpResidue(ctx, backupRel, out) {
  const { root, io } = ctx
  async function walk(dirRel) {
    let entries = []
    try { entries = await io.readdir(join(root, dirRel), { withFileTypes: true }) } catch { return }
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const childRel = dirRel ? `${dirRel}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name) || entry.name.startsWith('.retired-') || /\.retired-/u.test(entry.name)) continue
        await walk(childRel)
      } else if (entry.isFile() && entry.name.startsWith('.pinax-tmp-')) {
        out.operations.push({ kind: 'archive-tmp-residue', from: childRel, to: `${backupRel}/tmp-residue/${childRel}` })
      }
    }
  }
  await walk('')
}

/**
 * OS-220：把诊断分节包成计划（planId 绑定受影响文件与判定依据）。
 * 本函数与 `upgradeLibrary` 的动笔前预览共用（真实请求路径上的调用点）。
 */
export function buildSelfPlan(root, section, now = new Date()) {
  const risks = [...(section.risks ?? [])]
  if (section.blocking) risks.unshift(`升级被阻断：${section.blocking}`)
  return buildPlan({
    kind: 'library-upgrade',
    rootPath: root,
    sections: { libraryUpgrade: section },
    risks,
    bindings: section.bindings ?? [],
    now
  })
}

async function readJsonPreview(abs, io, skipped, rel) {
  let source
  try { source = await io.readFile(abs, 'utf-8') } catch (error) {
    skipped.push({ file: rel, line: 1, reason: text(error?.message || error) })
    return { bad: true }
  }
  try {
    return { bad: false, value: JSON.parse(source) }
  } catch (error) {
    skipped.push({ file: rel, line: jsonErrorLine(text(error?.message || error), source), reason: text(error?.message || error) })
    return { bad: true }
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
