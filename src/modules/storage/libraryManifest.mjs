/**
 * 库清单自持（OS-167 / G10b）：OpenStory 的库清单是 `%LOCALAPPDATA%/OpenStory/libraries.json`，
 * 不读取旧产品的 `next-preferences.json`。库身份靠库内 `.openstory/project.json`，不靠本机清单。
 *
 * 读优先级（隐式路径）：① 调用方显式 `preferencesPath`（CLI/测试覆盖）→ ② `OPENSTORY_PREFERENCES`
 * → ③ 新院 `libraries.json` → ④ 空清单＋可观测 warning。**不读** `PINAX_OS_PREFERENCES`、
 * **不回落**旧院清单，也不扫描或导入旧产品清单。
 *
 * 旧形状 `{ recentProjects: [...] }` 只在显式路径上做兼容读（测试/迁移排障用），
 * 并标 `legacy:true`——产品路径永不自动指向它，写操作一律拒绝写回。
 */
import { readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { courtyardPath } from './courtyard.mjs'

export const LIBRARY_MANIFEST_FILE = 'libraries.json'
export const LEGACY_MANIFEST_FILE = 'next-preferences.json'
export const LIBRARY_MANIFEST_SCHEMA = 'openstory.library-manifest/v1'
export const LIBRARY_MANIFEST_SCHEMA_VERSION = 1
export const LIBRARY_SOURCES = Object.freeze({ openstory: 'openstory', imported: 'imported' })

const text = (value) => String(value ?? '')

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 新院库清单路径；env 注入是测试隔离的唯一手段。 */
export function defaultLibraryManifestPath(env = process.env) {
  return courtyardPath(env, LIBRARY_MANIFEST_FILE)
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
 * `{recentProjects}` 只在显式路径上兼容读，source 统一标 `imported`。
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
        source: source === LIBRARY_SOURCES.imported || source === 'imported-pinax' ? LIBRARY_SOURCES.imported : LIBRARY_SOURCES.openstory
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
        source: LIBRARY_SOURCES.imported
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
    warnings.push({ code: 'PREFERENCES_LEGACY_READONLY', path: target, message: '这是旧格式清单，只读兼容；不会写回，也不自动导入' })
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
    return { ok: false, code: 'INVALID_ENTRY', message: '库清单已分家：旧 next-preferences.json 只读，不写回' }
  }
  const list = (Array.isArray(libraries) ? libraries : [])
    .filter((item) => isPlainObject(item) && text(item.path).trim())
    .map((item) => ({
      path: resolve(text(item.path).trim()),
      name: text(item.name).trim() || defaultName(item.path),
      addedAt: text(item.addedAt).trim(),
      source: [LIBRARY_SOURCES.imported, 'imported-pinax'].includes(text(item.source).trim()) ? LIBRARY_SOURCES.imported : LIBRARY_SOURCES.openstory
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
