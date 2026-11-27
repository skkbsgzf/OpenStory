/**
 * 知识库路径边界（OS-226）。
 * 只接受已登记 realRoot 内的 POSIX 相对 documentRef；默认拒绝 symlink。
 */
import { lstat, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve, win32 } from 'node:path'

export const KNOWLEDGE_PATH_ERRORS = Object.freeze({
  PATH_ESCAPE: 'PATH_ESCAPE',
  INVALID_ENTRY: 'INVALID_ENTRY',
  NOT_FOUND: 'NOT_FOUND'
})

function fail(code, message, details) { return { ok: false, code, message, ...(details ? { details } : {}) } }
function inside(root, target) {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

export function normalizeKnowledgeRoot(input) {
  const raw = String(input ?? '').trim()
  if (!raw || !isAbsolute(raw)) return fail('INVALID_ENTRY', '知识库根必须是绝对路径')
  return { ok: true, path: resolve(raw), realRoot: resolve(raw) }
}

export async function canonicalKnowledgeRoot(input) {
  const normalized = normalizeKnowledgeRoot(input)
  if (!normalized.ok) return normalized
  try {
    const info = await lstat(normalized.path)
    if (info.isSymbolicLink()) return fail('PATH_ESCAPE', '知识库根不能是符号链接')
    if (!info.isDirectory()) return fail('INVALID_ENTRY', '知识库根不是目录')
    const realRoot = await realpath(normalized.path)
    return { ok: true, path: normalized.path, realRoot: resolve(realRoot) }
  } catch (error) {
    return fail(error?.code === 'ENOENT' ? 'NOT_FOUND' : 'PATH_ESCAPE', `知识库根不可访问：${error?.message || error}`)
  }
}

export function normalizeDocumentRef(input) {
  let raw = String(input ?? '').trim().replaceAll('\\', '/')
  if (!raw) return fail('INVALID_ENTRY', 'documentRef 必填')
  if (raw.includes('\0') || /^[a-z][a-z0-9+.-]*:/iu.test(raw) || isAbsolute(raw) || win32.isAbsolute(raw)) {
    return fail('PATH_ESCAPE', 'documentRef 必须是库内相对路径')
  }
  while (raw.startsWith('./')) raw = raw.slice(2)
  const parts = raw.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) return fail('PATH_ESCAPE', 'documentRef 含非法路径段')
  if (!/\.(?:md|markdown)$/iu.test(raw)) return fail('INVALID_ENTRY', '知识库文档只接受 Markdown')
  return { ok: true, ref: parts.join('/') }
}

export async function resolveKnowledgeDocument(root, documentRef, { allowSymlink = false } = {}) {
  const normalized = normalizeDocumentRef(documentRef)
  if (!normalized.ok) return normalized
  const located = await canonicalKnowledgeRoot(root)
  if (!located.ok) return located
  const target = resolve(located.realRoot, ...normalized.ref.split('/'))
  if (!inside(located.realRoot, target)) return fail('PATH_ESCAPE', 'documentRef 越出知识库根')
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink() && !allowSymlink) return fail('PATH_ESCAPE', '知识库文档不能是符号链接')
    if (!info.isFile()) return fail('INVALID_ENTRY', 'documentRef 不是文件')
    const realTarget = await realpath(target)
    if (!inside(located.realRoot, realTarget)) return fail('PATH_ESCAPE', 'documentRef realpath 越出知识库根')
    return { ok: true, root: located.path, realRoot: located.realRoot, ref: normalized.ref, path: target, realPath: realTarget }
  } catch (error) {
    return fail(error?.code === 'ENOENT' ? 'NOT_FOUND' : 'PATH_ESCAPE', `知识库文档不可访问：${error?.message || error}`)
  }
}

export async function assertNoSymlinkInParents(root, target) {
  const located = await canonicalKnowledgeRoot(root)
  if (!located.ok) return located
  const rel = relative(located.realRoot, target)
  if (!inside(located.realRoot, target)) return fail('PATH_ESCAPE', '目标越出知识库根')
  let cursor = located.realRoot
  for (const part of rel.split(/[\\/]/u).filter(Boolean)) {
    cursor = resolve(cursor, part)
    try {
      const info = await lstat(cursor)
      if (info.isSymbolicLink()) return fail('PATH_ESCAPE', `路径含符号链接：${part}`)
    } catch (error) {
      return fail(error?.code === 'ENOENT' ? 'NOT_FOUND' : 'PATH_ESCAPE', `路径不可访问：${error?.message || error}`)
    }
  }
  return { ok: true }
}
