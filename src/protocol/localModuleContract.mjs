/**
 * 本机可执行模块的信任表契约与身份摘要（OS-196 G1/G2）。
 *
 * 纯函数：不读盘、不写盘、不碰进程状态。I/O 只在 src/host/moduleRoots.mjs；
 * 这样门禁可以在源码文本上量「信任表读写只有一处」，摘要口径也只有一处。
 *
 * 信任表是**机器级**文件（%LOCALAPPDATA%/OpenStory/openstory/module-roots.json），
 * 不属于任何一个库：登记一个根＝信任该根下所有模块的代码，与 daemon 同进程同权限。
 */
import { createHash } from 'node:crypto'

export const MODULE_ROOTS_SCHEMA = 'openstory.module-roots/v1'
/** 这是给作者看的唯一一句风险说明，设置页原样显示，不许缩写。 */
export const ROOT_RISK_NOTE = '登记即信任：该模块根下的所有可执行代码会与 daemon 同进程、同权限运行。只登记你自己写的、或你信任的来源。'

const text = (value) => String(value ?? '')
const plainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

/** sha256（十六进制）。manifest 摘要只算原文；内容摘要算入口＋包内传递依赖。 */
export function sha256Hex(contents) {
  return createHash('sha256').update(String(contents ?? '')).digest('hex')
}

/**
 * 内容摘要：按路径稳定排序的「相对路径 \0 源码 \0」序列。
 * files 来自 import 图扫描的 visited（入口＋包内传递依赖），同一份代码必得同一摘要。
 */
export function contentDigest(files = []) {
  const hash = createHash('sha256')
  const ordered = (Array.isArray(files) ? files : [])
    .filter((item) => plainObject(item) && /(?:\.mjs|\.js)$/u.test(text(item.path)))
    .slice()
    .sort((left, right) => text(left.path).localeCompare(text(right.path)))
  for (const file of ordered) {
    hash.update(text(file.path))
    hash.update('\0')
    hash.update(text(file.source))
    hash.update('\0')
  }
  return ordered.length ? hash.digest('hex') : ''
}

/** 规整一条登记记录；坏项跳过并记 warning，绝不静默吞掉。 */
function normalizeRoot(raw, seen, warnings, index) {
  if (!plainObject(raw)) {
    warnings.push({ code: 'MODULE_ROOT_INVALID', index, message: `第 ${index + 1} 条登记不是对象，已跳过` })
    return null
  }
  const path = text(raw.path).trim()
  if (!path) {
    warnings.push({ code: 'MODULE_ROOT_INVALID', index, message: `第 ${index + 1} 条登记缺 path，已跳过` })
    return null
  }
  const key = path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
  if (seen.has(key)) {
    warnings.push({ code: 'MODULE_ROOT_DUPLICATE', index, message: `模块根重复登记（${path}），保留先出现的一条` })
    return null
  }
  seen.add(key)
  const modules = []
  const moduleSeen = new Set()
  for (const [moduleIndex, item] of (Array.isArray(raw.modules) ? raw.modules : []).entries()) {
    if (!plainObject(item)) continue
    const id = text(item.id).trim()
    if (!id || moduleSeen.has(id)) continue
    moduleSeen.add(id)
    modules.push(Object.freeze({
      id,
      name: text(item.name).trim() || id,
      version: text(item.version).trim(),
      class: text(item.class).trim(),
      manifestSha256: text(item.manifestSha256).trim(),
      contentSha256: text(item.contentSha256).trim(),
      registeredAt: text(item.registeredAt).trim(),
      capabilities: Object.freeze((Array.isArray(item.capabilities) ? item.capabilities : []).map(text)),
      requires: Object.freeze((Array.isArray(item.requires) ? item.requires : []).map(text))
    }))
  }
  modules.sort((left, right) => left.id.localeCompare(right.id))
  return Object.freeze({
    path,
    registeredAt: text(raw.registeredAt).trim(),
    modules: Object.freeze(modules)
  })
}

/** 读表后的唯一规整口：形状不对不抛，按空表＋warning 处理（与库清单同口径）。 */
export function normalizeModuleRoots(raw) {
  const warnings = []
  if (!plainObject(raw)) {
    if (raw !== undefined && raw !== null) warnings.push({ code: 'MODULE_ROOTS_BAD_SHAPE', message: '信任表不是对象，按空表处理' })
    return { ok: false, roots: [], warnings }
  }
  if (raw.schema !== MODULE_ROOTS_SCHEMA) {
    warnings.push({ code: 'MODULE_ROOTS_BAD_SCHEMA', message: `信任表 schema 不是 ${MODULE_ROOTS_SCHEMA}，按空表处理` })
    return { ok: false, roots: [], warnings }
  }
  const seen = new Set()
  const roots = (Array.isArray(raw.roots) ? raw.roots : [])
    .map((item, index) => normalizeRoot(item, seen, warnings, index))
    .filter(Boolean)
    .sort((left, right) => left.path.localeCompare(right.path))
  return { ok: true, roots: Object.freeze(roots), warnings }
}

/** 新建的空信任表（首次登记时写盘）。 */
export function emptyModuleRoots() {
  return Object.freeze({ schema: MODULE_ROOTS_SCHEMA, roots: Object.freeze([]) })
}

/** 一条预览项的稳定投影——设置页只显示这些字段，不碰磁盘路径以外的东西。 */
export function normalizePreviewModule(item) {
  if (!plainObject(item)) return null
  const id = text(item.id).trim()
  if (!id) return null
  return Object.freeze({
    id,
    name: text(item.name).trim() || id,
    version: text(item.version).trim(),
    class: text(item.class).trim(),
    status: text(item.status).trim() || 'ok',
    gate: text(item.gate).trim(),
    reason: text(item.reason).trim(),
    manifestSha256: text(item.manifestSha256).trim(),
    contentSha256: text(item.contentSha256).trim(),
    capabilities: Object.freeze((Array.isArray(item.capabilities) ? item.capabilities : []).map(text)),
    requires: Object.freeze((Array.isArray(item.requires) ? item.requires : []).map(text)),
    supplies: Object.freeze((Array.isArray(item.supplies) ? item.supplies : []).map(text))
  })
}

/** 预览整根：带风险说明与逐模块状态；预览不写盘、不生效。 */
export function normalizeRootPreview(raw) {
  const modules = (Array.isArray(raw?.modules) ? raw.modules : [])
    .map(normalizePreviewModule)
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id))
  return Object.freeze({
    path: text(raw?.path).trim(),
    risk: ROOT_RISK_NOTE,
    modules: Object.freeze(modules),
    warnings: Object.freeze((Array.isArray(raw?.warnings) ? raw.warnings : []).map((item) => (
      plainObject(item) ? Object.freeze({ code: text(item.code), message: text(item.message) }) : { code: 'PREVIEW_WARNING', message: text(item) }
    )))
  })
}
