/**
 * 库清单自持（OS-167 / G10b）：OpenStory 的库清单是 `%LOCALAPPDATA%/OpenStory/libraries.json`，
 * 不是 Pinax 的 `next-preferences.json`。互认靠库内 `.pinax/project.json`，不靠本机清单。
 *
 * 读优先级（隐式路径）：① 调用方显式 `preferencesPath`（CLI/测试覆盖）→ ② `OPENSTORY_PREFERENCES`
 * → ③ 新院 `libraries.json` → ④ 空清单＋可观测 warning。**不读** `PINAX_OS_PREFERENCES`、
 * **不回落**旧院清单；旧清单只经 `inspectPinaxLibraries` 在设置页里被看到，作者勾选才导入。
 *
 * 旧形状 `{ recentProjects: [...] }` 只在显式路径上做兼容读（测试/迁移排障用），
 * 并标 `legacy:true`——产品路径永不自动指向它，写操作一律拒绝写回。
 */
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { atomicWriteFile } from './hostWrite.mjs'
import { courtyardPath, legacyCourtyardPath } from './courtyard.mjs'

export const LIBRARY_MANIFEST_FILE = 'libraries.json'
export const LEGACY_MANIFEST_FILE = 'next-preferences.json'
export const LIBRARY_MANIFEST_SCHEMA = 'openstory.library-manifest/v1'
export const LIBRARY_MANIFEST_SCHEMA_VERSION = 1
export const LIBRARY_SOURCES = Object.freeze({ openstory: 'openstory', importedPinax: 'imported-pinax' })

const text = (value) => String(value ?? '')

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 新院库清单路径；env 注入是测试隔离的唯一手段。 */
export function defaultLibraryManifestPath(env = process.env) {
  return courtyardPath(env, LIBRARY_MANIFEST_FILE)
}

/** 旧院 Pinax 清单路径：只读导入用，产品永不写。 */
export function pinaxPreferencesPath(env = process.env) {
  return legacyCourtyardPath(env, LEGACY_MANIFEST_FILE)
}

/** 解析清单路径：显式覆盖 ＞ OPENSTORY_PREFERENCES ＞ 新院默认。旧环境变量不再参与。 */
export function resolveLibraryManifestPath({ preferencesPath, env = process.env } = {}) {
  const explicit = text(preferencesPath).trim()
  if (explicit) return explicit
  const fromEnv = text(env?.OPENSTORY_PREFERENCES).trim()
  if (fromEnv) return fromEnv
  return defaultLibraryManifestPath(env)
}

/** 路径去重口径与 contracts.normalizeLibraries 一致（去尾斜杠、Windows 大小写不敏感）。 */
function pathKey(value) {
  return text(value).replace(/[\\/]+$/u, '').replaceAll('\\', '/').toLowerCase()
}

function samePath(a, b) {
  return pathKey(a) === pathKey(b)
}

function dedupe(libraries) {
  const seen = new Set()
  const out = []
  for (const item of libraries) {
    const key = pathKey(item.path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(item)
  }
  return out
}

/** 文件名兜底（不引 node:path 的 basename 处理 Windows 双斜杠以外的差异）。 */
function defaultName(filePath) {
  return basename(text(filePath).replace(/[\\/]+$/u, '')) || text(filePath)
}

/**
 * 文档 → 规整清单。新形状 `{schemaVersion, libraries}` 为真源；旧形状
 * `{recentProjects}` 只在显式路径上兼容读，source 标 `imported-pinax`。
 */
export function normalizeLibraryManifest(document, sourceHint = LIBRARY_SOURCES.openstory) {
  if (!isPlainObject(document)) return { ok: false, libraries: [], legacy: false, reason: '清单不是对象' }
  if (Array.isArray(document.libraries)) {
    const libraries = []
    const skipped = []
    document.libraries.forEach((item, index) => {
      if (!isPlainObject(item) || !text(item.path).trim()) {
        skipped.push(index)
        return
      }
      const source = text(item.source).trim() || sourceHint
      libraries.push({
        path: text(item.path).trim(),
        name: text(item.name).trim() || defaultName(item.path),
        addedAt: text(item.addedAt).trim() || text(item.at).trim(),
        source: source === LIBRARY_SOURCES.importedPinax ? LIBRARY_SOURCES.importedPinax : LIBRARY_SOURCES.openstory
      })
    })
    return { ok: true, libraries: dedupe(libraries), legacy: false, skipped }
  }
  if (Array.isArray(document.recentProjects)) {
    const libraries = document.recentProjects
      .filter((item) => isPlainObject(item) && text(item.path).trim())
      .map((item) => ({
        path: text(item.path).trim(),
        name: text(item.name).trim() || defaultName(item.path),
        addedAt: text(item.addedAt).trim() || text(item.at).trim(),
        source: LIBRARY_SOURCES.importedPinax
      }))
    return { ok: true, libraries: dedupe(libraries), legacy: true }
  }
  return { ok: false, libraries: [], legacy: false, reason: '清单缺 libraries 数组（也不是旧 recentProjects）' }
}

/** 同步读清单（daemon 启动链是同步的）。坏档不抛，如实回 warnings。 */
export function readLibraryManifest({ preferencesPath, env = process.env } = {}) {
  const target = resolveLibraryManifestPath({ preferencesPath, env })
  if (!target) {
    return {
      ok: true, libraries: [], warnings: [{ code: 'PREFERENCES_PATH_UNKNOWN', message: '找不到 LOCALAPPDATA，无法定位 libraries.json' }],
      path: '', legacy: false
    }
  }
  let raw
  try {
    raw = readFileSync(target, 'utf-8')
  } catch (error) {
    const missing = error?.code === 'ENOENT'
    return {
      ok: true, libraries: [],
      warnings: [{
        code: missing ? 'PREFERENCES_MISSING' : 'PREFERENCES_UNREADABLE',
        path: target,
        message: missing ? '本机库清单还不存在：先在设置页导入或新建库' : `本机库清单读不了：${text(error?.message || error)}`
      }],
      path: target, legacy: false
    }
  }
  let document
  try {
    document = JSON.parse(raw)
  } catch (error) {
    return {
      ok: true, libraries: [],
      warnings: [{ code: 'PREFERENCES_CORRUPT', path: target, message: `本机库清单不是有效 JSON：${text(error?.message || error)}` }],
      path: target, legacy: false
    }
  }
  const normalized = normalizeLibraryManifest(document)
  if (!normalized.ok) {
    return {
      ok: true, libraries: [], warnings: [{ code: 'PREFERENCES_SHAPE', path: target, message: normalized.reason }],
      path: target, legacy: false
    }
  }
  const warnings = []
  if (normalized.legacy) {
    warnings.push({ code: 'PREFERENCES_LEGACY_READONLY', path: target, message: '这是 Pinax 旧清单，只读兼容；请到设置页导入 OpenStory 库清单' })
  }
  for (const index of normalized.skipped ?? []) {
    warnings.push({ code: 'LIBRARY_ENTRY_SKIPPED', index, message: '库清单有一条记录没有 path，已跳过' })
  }
  return { ok: true, libraries: normalized.libraries, warnings, path: target, legacy: normalized.legacy }
}

/** 写新清单（原子写）；只接 `{schemaVersion,libraries}`，绝不认旧形状。 */
export async function writeLibraryManifest(target, libraries, { schemaVersion = LIBRARY_MANIFEST_SCHEMA_VERSION } = {}) {
  const path = text(target).trim()
  if (!path) return { ok: false, code: 'INVALID_ENTRY', message: '没有可写的库清单路径' }
  if (basename(path).toLowerCase() === LEGACY_MANIFEST_FILE.toLowerCase()) {
    return { ok: false, code: 'INVALID_ENTRY', message: '库清单已分家：Pinax 的 next-preferences.json 只读，不写回' }
  }
  const list = (Array.isArray(libraries) ? libraries : [])
    .filter((item) => isPlainObject(item) && text(item.path).trim())
    .map((item) => ({
      path: resolve(text(item.path).trim()),
      name: text(item.name).trim() || defaultName(item.path),
      addedAt: text(item.addedAt).trim(),
      source: text(item.source).trim() === LIBRARY_SOURCES.importedPinax ? LIBRARY_SOURCES.importedPinax : LIBRARY_SOURCES.openstory
    }))
  const document = { schemaVersion, libraries: dedupe(list) }
  try {
    await mkdir(dirname(path), { recursive: true })
    await atomicWriteFile(path, `${JSON.stringify(document, null, 2)}\n`)
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `库清单写失败：${text(error?.message || error)}` }
  }
  return { ok: true, path, document, libraries: document.libraries }
}

/** 逐个体检旧清单条目：目录在？有 .pinax/project.json？非法项标灰给原因，不写任何文件。 */
export function inspectPinaxLibraries(env = process.env, { legacyPath } = {}) {
  const source = text(legacyPath || pinaxPreferencesPath(env)).trim()
  if (!source) {
    return { ok: true, source: '', libraries: [], warnings: [{ code: 'PREFERENCES_PATH_UNKNOWN', message: '找不到 LOCALAPPDATA，无法定位 Pinax 旧清单' }] }
  }
  let document
  try {
    document = JSON.parse(readFileSync(source, 'utf-8'))
  } catch (error) {
    const missing = error?.code === 'ENOENT'
    return {
      ok: true, source, libraries: [],
      warnings: [{
        code: missing ? 'PREFERENCES_MISSING' : 'PREFERENCES_CORRUPT',
        path: source,
        message: missing ? 'Pinax 旧清单不存在，没有可导入的库' : `Pinax 旧清单读不了/不是合法 JSON：${text(error?.message || error)}`
      }]
    }
  }
  const raw = Array.isArray(document?.recentProjects) ? document.recentProjects : []
  const libraries = []
  for (const item of raw) {
    const root = text(item?.path).trim()
    const base = { path: root, name: text(item?.name).trim() || (root ? defaultName(root) : ''), addedAt: text(item?.at).trim() }
    if (!root) {
      libraries.push({ ...base, ok: false, reason: '旧记录没有路径' })
      continue
    }
    let stat
    try {
      stat = statSync(root)
    } catch {
      libraries.push({ ...base, ok: false, reason: '目录不存在' })
      continue
    }
    if (!stat.isDirectory()) {
      libraries.push({ ...base, ok: false, reason: '不是目录' })
      continue
    }
    if (!existsSync(`${root.replace(/[\\/]+$/u, '')}/.pinax/project.json`)) {
      libraries.push({ ...base, ok: false, reason: '没有 .pinax/project.json' })
      continue
    }
    libraries.push({ ...base, ok: true, reason: '' })
  }
  return { ok: true, source, libraries: dedupe(libraries), warnings: [] }
}

/**
 * 作者勾选后写入新清单：`source: imported-pinax`。只写新院，不写旧院；
 * 已登记路径不重复写（保留原 source），非法勾选如实回绝。
 */
export async function importPinaxLibraries({ paths = [], env = process.env, preferencesPath } = {}) {
  const inspected = inspectPinaxLibraries(env)
  const wanted = new Set((Array.isArray(paths) ? paths : []).map(pathKey))
  const chosen = inspected.libraries.filter((item) => item.ok && wanted.has(pathKey(item.path)))
  const rejected = inspected.libraries.filter((item) => wanted.has(pathKey(item.path)) && !item.ok)
    .map((item) => ({ path: item.path, reason: item.reason }))
  if (!chosen.length) {
    return {
      ok: false, code: 'INVALID_ENTRY', message: '没有可导入的库：请勾选体检通过的条目',
      source: inspected.source, imported: [], rejected, warnings: inspected.warnings
    }
  }
  const current = readLibraryManifest({ preferencesPath, env })
  const merged = [...current.libraries]
  for (const item of chosen) {
    if (merged.some((existing) => samePath(existing.path, item.path))) continue
    merged.push({ path: item.path, name: item.name, addedAt: item.addedAt || new Date().toISOString(), source: LIBRARY_SOURCES.importedPinax })
  }
  const written = await writeLibraryManifest(preferencesPath || current.path, merged)
  if (!written.ok) return { ...written, source: inspected.source, imported: [], rejected, warnings: inspected.warnings }
  return {
    ok: true, source: inspected.source, imported: chosen.map((item) => ({ path: item.path, name: item.name })),
    rejected, warnings: [...inspected.warnings, ...current.warnings], path: written.path, libraries: written.libraries
  }
}
