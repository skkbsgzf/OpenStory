import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { API_ERROR_CODES } from './apiErrors.mjs'
import { namingEntry } from './naming.mjs'

export const METADATA_DIR = namingEntry('libraryStorage').metadataDir

export function text(value) {
  return String(value ?? '')
}

export function canonicalRoot(value) {
  const raw = text(value).trim()
  if (!raw) return ''
  const absolute = resolve(raw)
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

export function pathFail(message, path) {
  return { ok: false, code: API_ERROR_CODES.PATH_ESCAPE, message, details: path ? { path } : undefined }
}

export function resolveInsideRoot(root, relativePath, { allowMetadata = false } = {}) {
  const base = canonicalRoot(root)
  if (!base) {
    return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '文件路径需要一个项目根（root）' }
  }
  const raw = text(relativePath).trim()
  if (!raw || raw.includes('\0')) return pathFail('路径必须是非空字符串', raw)
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//u, '')
  const segments = normalized.split('/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)
    || segments.some((part) => !part || part === '.' || part === '..')) {
    return pathFail(`路径不合法或越出库根：${raw}`, normalized)
  }
  if (!allowMetadata && segments.some((part) => part.toLowerCase() === METADATA_DIR)) {
    return pathFail(`${METADATA_DIR}/ 只归 OpenStory 宿主写通道管理`, normalized)
  }
  const target = resolve(base, normalized)
  const rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return pathFail(`路径解析后落在库根之外：${raw}`, normalized)
  }
  return { ok: true, path: target, relative: normalized }
}
