/**
 * worldbook 端点 handler（OS-194 从 src/api/handlers/reference.mjs 归位 5 个独占端点；
 * referenceImageGenerate 归 imagegen，syncCheck 是宿主共享端点仍留契约壳）。
 * fact.store / prose.write 句柄经 activate(context) 注入。
 */
import { readFile } from 'node:fs/promises'
import {
  absorbLegacyDirs,
  backlinksOf,
  buildReferenceGraph,
  REFERENCE_DIR,
  notesVisibleAt,
  scanReferences
} from '../../protocol/referenceStore.mjs'

export function createHandlers({ host, factStore, prose }) {
  const { apiErrors, sendError, sendJson, text, authorizeRoot, resolveInsideRoot } = host

  async function referenceGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const index = await scanReferences(authorized.root)
    // OS-96：currentChapter 给了＝只回该章节前可见的词条（世界书按首次出现章节过滤，防剧透）
    const currentChapter = Number(request.currentChapter)
    const notes = Number.isFinite(currentChapter) && currentChapter > 0 ? notesVisibleAt(index.notes, currentChapter) : index.notes
    return sendJson(res, 200, { ok: true, ...index, notes, filtered: Number.isFinite(currentChapter) && currentChapter > 0 })
  }

  async function referenceGraphGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const index = await scanReferences(authorized.root)
    // 条目作为只读节点参与图谱（不搬进世界书，只被链接）
    let entries = []
    try {
      const store = factStore.createFactFileStore({ root: authorized.root })
      const listed = store.list({ offset: 0, limit: 500 })
      entries = Array.isArray(listed?.entries) ? listed.entries : []
    } catch { /* 没故事源目录就只有世界书节点 */ }
    const graph = buildReferenceGraph(index, { entries })
    return sendJson(res, 200, { ok: true, ...graph })
  }

  async function referenceNoteGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const requested = text(request.path).trim().replaceAll('\\', '/')
    if (!requested.startsWith(`${REFERENCE_DIR}/`)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `只读世界书目录下的笔记：${requested}`)
    }
    let raw
    try {
      const resolved = resolveInsideRoot(authorized.root, requested, { allowMetadata: false })
      if (!resolved.ok) return sendError(res, resolved.code ?? apiErrors.PATH_ESCAPE, resolved.message)
      raw = await readFile(resolved.path, 'utf-8')
    } catch (error) {
      if (error?.code === 'ENOENT') return sendError(res, apiErrors.NOT_FOUND, `笔记不存在：${requested}`)
      return sendError(res, apiErrors.WRITE_PROTOCOL_IO_FAILED, `读笔记失败：${text(error?.message || error)}`)
    }
    const index = await scanReferences(authorized.root)
    const note = index.notes.find((item) => item.path === requested) ?? null
    const backlinks = backlinksOf(index, requested)
    return sendJson(res, 200, {
      ok: true,
      note: { ...(note || { path: requested, title: requested.split('/').pop() }), text: raw },
      backlinks
    })
  }

  async function referenceAssetGet(ctx) {
    const { res, request, allowlist } = ctx
    // OS-75：世界书图片本体（只读，只放行 世界书/ 下的图片扩展名）。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const assetPath = text(request.path).trim().replaceAll('\x5c', '/')
    if (!assetPath.startsWith(`${REFERENCE_DIR}/`)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `只放行世界书目录下的图片：${assetPath}`)
    }
    if (!/\.(png|jpe?g|webp|gif|avif)$/iu.test(assetPath)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `不是图片扩展名：${assetPath}`)
    }
    const resolvedAsset = resolveInsideRoot(authorized.root, assetPath, { allowMetadata: false })
    if (!resolvedAsset.ok) return sendError(res, resolvedAsset.code ?? apiErrors.PATH_ESCAPE, resolvedAsset.message)
    let buf
    try { buf = await readFile(resolvedAsset.path) } catch (error) {
      if (error?.code === 'ENOENT') return sendError(res, apiErrors.NOT_FOUND, `图片不存在：${assetPath}`)
      return sendError(res, apiErrors.WRITE_PROTOCOL_IO_FAILED, `读图失败：${text(error?.message || error)}`)
    }
    const ext = assetPath.split('.').pop().toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'avif' ? 'image/avif' : 'image/png'
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache', 'content-length': buf.length })
    return res.end(buf)
  }

  async function referenceAbsorb(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    // OS-48：旧目录迁入世界书。规划（哪些搬、哪些目标冲突）在 referenceStore，真搬运走
    // writeChapterWithBackup（原子写目标）+ deleteChapter（源进 .history，可逆）这两条既有通道。
    const planned = await absorbLegacyDirs(authorized.root, Array.isArray(request.dirs) ? request.dirs : [])
    if (!planned.ok) return sendError(res, apiErrors.INVALID_ENTRY, planned.message)
    const moved = []
    const skipped = [...planned.skipped]
    for (const item of planned.moves) {
      let content
      try {
        const src = resolveInsideRoot(authorized.root, item.fromRel, { allowMetadata: false })
        if (!src.ok) {
          skipped.push({ path: item.fromRel, reason: src.message })
          continue
        }
        content = await readFile(src.path, 'utf-8')
      } catch (error) {
        skipped.push({ path: item.fromRel, reason: `读不到：${text(error?.message || error)}` })
        continue
      }
      const written = await prose.writeChapterWithBackup(authorized.root, item.toRel, content)
      if (!written.ok) {
        skipped.push({ path: item.fromRel, reason: written.message })
        continue
      }
      const removed = await prose.deleteChapter(authorized.root, item.fromRel)
      if (!removed.ok) {
        skipped.push({ path: item.fromRel, reason: `目标已写入，但删源失败（旧文件保留原位）：${removed.message}` })
        continue
      }
      moved.push({ from: item.fromRel, to: item.toRel, backup: removed.backup })
    }
    return sendJson(res, 200, { ok: true, moved, skipped })
  }

  return { referenceGet, referenceGraphGet, referenceNoteGet, referenceAssetGet, referenceAbsorb }
}
