/**
 * worldbook 端点 handler（OS-194 归位 5 个 reference 独占端点；OS-195a 从 imagegen 收回
 * referenceImageGenerate——它读写世界书条目，走本模块端点分派，不跨模块 import referenceStore）。
 * syncCheck 是跨故事源/正文/世界书的宿主共享端点，仍留契约壳。
 * fact.store / prose.write / media.generate / agent.runtime 句柄经 activate(context) 注入。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { LOG_MODULES } from '../../protocol/naming.mjs'
import {
  absorbLegacyDirs,
  backlinksOf,
  buildReferenceGraph,
  parseFrontmatter,
  REFERENCE_DIR,
  notesVisibleAt,
  scanReferences,
  serializeFrontmatter
} from './referenceStore.mjs'

export function createHandlers({ host, factStore, prose, mediaGenerate, agentRuntime }) {
  const {
    apiErrors, sendError, sendJson, text, authorizeRoot, resolveInsideRoot,
    defaultPort, submitJob
  } = host

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

  /** OS-211：世界书专用写端点。归属本模块（manifest endpoints），停用即 MODULE_DISABLED。 */
  async function referenceNotePut(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const requested = text(request.path).trim().replaceAll('\\', '/')
    if (!requested.startsWith(`${REFERENCE_DIR}/`)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `只写世界书目录下的笔记：${requested}`, { worldbookDir: REFERENCE_DIR })
    }
    if (typeof request.text !== 'string') {
      return sendError(res, apiErrors.INVALID_ENTRY, 'text 必须是字符串（整篇写入）')
    }
    // 写实现只有一份：复用宿主正文写通道（原子写＋.history 备份＋changelog 留痕）。
    // 日志模块名从命名表取（LOG_MODULES.worldbook），不写字面量（OS-148/G8a）。
    const written = await prose.writeChapterWithBackup(authorized.root, requested, request.text, {
      module: LOG_MODULES.worldbook,
      actor: 'author'
    })
    if (!written.ok) return sendError(res, written.code, written.message, written.details)
    return sendJson(res, 200, {
      ok: true,
      path: requested,
      chars: written.chars,
      savedAt: written.savedAt,
      ...(written.backup ? { backup: written.backup } : {})
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

  /** OS-63/OS-195a：设定图生成——端点归世界书（写的是条目 frontmatter 与 世界书/assets）。 */
  async function referenceImageGenerate(ctx) {
    const { res, request, context, allowlist } = ctx
    // OS-80：生图改异步——先提交到全局任务中心（立刻返回 jobId），任务后台跑。
    // 作者口径：「切走再回来不应丢状态」，进度要能跨页面看到。
    // async:true 时走任务中心；不带 async 保留原同步行为（MCP / 兼容用）。
    if (request.async === true) {
      const authorized0 = authorizeRoot(allowlist, request.root)
      if (!authorized0.ok) return sendError(res, authorized0.code, authorized0.message, authorized0.details)
      const reqPath = text(request.path).trim()
      const title = reqPath.split('/').pop().replace(/\.md$/u, '')
      const port = context.port || defaultPort
      const job = submitJob({
        kind: 'image',
        label: `生成设定图：${title}`,
        root: authorized0.root,
        run: async ({ update, signal }) => {
          update('正在生图（ComfyUI 约 2–3 分钟）…')
          // 同进程回环调用同步端点：逻辑与 MCP/界面点「生成」完全一致，只有一份实现
          const resp = await fetch(`http://127.0.0.1:${port}/api/reference/image`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...request, async: undefined }),
            signal: signal ?? undefined
          })
          const payload = await resp.json().catch(() => null)
          if (!resp.ok || payload?.ok === false) {
            throw new Error(payload?.error?.message || `生图失败（HTTP ${resp.status}）`)
          }
          update(`已生成：${payload.imagePath}`)
          return payload
        }
      })
      return sendJson(res, 200, { ok: true, jobId: job.id, async: true })
    }
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const requested = text(request.path).trim().replaceAll('\\', '/')
    if (!requested.startsWith(`${REFERENCE_DIR}/`)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `只给世界书目录下的条目生图：${requested}`)
    }
    const resolved = resolveInsideRoot(authorized.root, requested, { allowMetadata: false })
    if (!resolved.ok) return sendError(res, resolved.code ?? apiErrors.PATH_ESCAPE, resolved.message)

    const { config } = await agentRuntime.loadConfigV2(context.agentConfigPath)
    const image = config.image
    if (!image.enabled) {
      return sendError(res, apiErrors.AGENT_UPSTREAM_ERROR, '生图没启用——设置 · 模型 · 生图里打开开关')
    }

    // 读条目原文，拿 title / 正文摘要 作为生图描述（作者可显式传 prompt 覆盖）
    let noteRaw = ''
    try { noteRaw = await readFile(resolved.path, 'utf-8') } catch (error) {
      return sendError(res, apiErrors.NOT_FOUND, `条目读不了：${text(error?.message || error)}`)
    }
    const parsed = parseFrontmatter(noteRaw)
    const noteTitle = text(parsed.data?.title).trim() || text(requested).split('/').pop().replace(/\.md$/u, '')
    const noteKind = text(request.kind).trim() || text(parsed.data?.kind).trim() || 'character'
    const bodyExcerpt = text(parsed.body).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 200)

    const describe = text(request.prompt).trim()
      || `${noteKind === 'scene' ? '场景' : noteKind === 'item' ? '道具' : '人物'}设定图：${noteTitle}。${bodyExcerpt || '（按条目名想象）'}`
    const size = text(request.size).trim() || '1024x1024'
    const generated = await mediaGenerate.generate({
      image,
      root: authorized.root,
      prompt: describe,
      stylePrompt: text(request.stylePrompt),
      size
    })
    if (!generated.ok) return sendError(res, apiErrors.AGENT_UPSTREAM_ERROR, generated.error)
    const b64 = generated.b64

    // 落盘：世界书/<条目目录>/assets/<条目名>.png（安全名）
    const safeName = noteTitle.replace(/[\\/:*?"<>|]/gu, '_').slice(0, 40) || 'image'
    const noteDir = requested.split('/').slice(0, -1).join('/')
    const imageRel = `${noteDir}/assets/${safeName}.png`
    const imageAbs = resolveInsideRoot(authorized.root, imageRel, { allowMetadata: false })
    if (!imageAbs.ok) return sendError(res, imageAbs.code ?? apiErrors.PATH_ESCAPE, imageAbs.message)
    await mkdir(dirname(imageAbs.path), { recursive: true })
    await atomicWriteFile(imageAbs.path, Buffer.from(b64, 'base64')) // 二进制走 hostWrite 二进制分支

    // 回填 frontmatter：cover 指向新图，images 数组追加（去重，保留最近 6 张）
    const nextData = { ...parsed.data }
    const images = Array.isArray(nextData.images) ? nextData.images.map((x) => text(x).trim()).filter(Boolean) : []
    if (!images.includes(imageRel)) images.unshift(imageRel)
    nextData.images = images.slice(0, 6)
    if (!text(nextData.cover).trim()) nextData.cover = imageRel
    const nextRaw = `${serializeFrontmatter(nextData)}\n${parsed.body}`
    const written = await prose.writeChapterWithBackup(authorized.root, requested, nextRaw)
    if (!written.ok) return sendError(res, written.code, written.message, written.details)

    return sendJson(res, 200, {
      ok: true,
      path: requested,
      imagePath: imageRel,
      frontmatter: nextData,
      chars: nextRaw.length
    })
  }

  return { referenceGet, referenceGraphGet, referenceNoteGet, referenceNotePut, referenceAssetGet, referenceAbsorb, referenceImageGenerate }
}
