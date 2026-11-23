/**
 * reference 域 handler（OS-141 daemon 拆分）——7 端点，与 contracts/reference.mjs 一一对应：
 * referenceGet/referenceGraphGet/referenceNoteGet（索引·图谱·笔记本体）、
 * referenceAssetGet/referenceImageGenerate（图片本体·设定图生成）、referenceAbsorb（旧目录迁入）、
 * syncCheck（同源版本＋外部变更检测）。
 *
 * 统一签名 `async handler(ctx)`：全部端点都需要库，第一件事 authorizeRoot。
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { API_ERROR_CODES, isPlainObject, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text, DEFAULT_PORT } from '../../host/http.mjs'
import { authorizeRoot, resolveInsideRoot } from '../../host/authorize.mjs'
import {
  absorbLegacyDirs,
  backlinksOf,
  buildReferenceGraph,
  REFERENCE_DIR,
  notesVisibleAt,
  parseFrontmatter,
  scanReferences,
  serializeFrontmatter
} from '../../modules/worldbook/referenceStore.mjs'
import { checkSameSource, snapshotAndDiff, scanProseFiles } from '../../services/syncCheck.mjs'
import { resolveFactBookId } from '../../services/factBooks.mjs'
import { readLatestByFile } from '../../protocol/changelog.mjs'
import { writeChapterWithBackup } from '../../protocol/chapterWrite.mjs'
import { deleteChapter } from '../../protocol/chapters.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { factStore } from '../../kernel/pinaxAdapter.mjs'
import { loadConfigV2, DEFAULT_IMAGE_STYLE, DEFAULT_IMAGE_NEGATIVE, imagesGenerationsUrl } from '../../services/agentConfig.mjs'
import { generateViaComfy } from '../../services/comfyEngine.mjs'
import { submitJob } from '../../services/jobCenter.mjs'

export async function referenceGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const index = await scanReferences(authorized.root)
  // OS-96：currentChapter 给了＝只回该章节前可见的词条（世界书按首次出现章节过滤，防剧透）
  const currentChapter = Number(request.currentChapter)
  const notes = Number.isFinite(currentChapter) && currentChapter > 0 ? notesVisibleAt(index.notes, currentChapter) : index.notes
  return sendJson(res, 200, { ok: true, ...index, notes, filtered: Number.isFinite(currentChapter) && currentChapter > 0 })
}

export async function referenceGraphGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const index = await scanReferences(authorized.root)
  // 条目作为只读节点参与图谱（不搬进参考，只被链接）
  let entries = []
  try {
    const store = factStore.createFactFileStore({ root: authorized.root })
    const listed = store.list({ offset: 0, limit: 500 })
    entries = Array.isArray(listed?.entries) ? listed.entries : []
  } catch { /* 没拆解目录就只有参考节点 */ }
  const graph = buildReferenceGraph(index, { entries })
  return sendJson(res, 200, { ok: true, ...graph })
}

export async function referenceNoteGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const requested = text(request.path).trim().replaceAll('\\', '/')
  if (!requested.startsWith(`${REFERENCE_DIR}/`)) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `只读参考目录下的笔记：${requested}`)
  }
  let raw
  try {
    const resolved = resolveInsideRoot(authorized.root, requested, { allowMetadata: false })
    if (!resolved.ok) return sendError(res, resolved.code ?? API_ERROR_CODES.PATH_ESCAPE, resolved.message)
    raw = await readFile(resolved.path, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return sendError(res, API_ERROR_CODES.NOT_FOUND, `笔记不存在：${requested}`)
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `读笔记失败：${text(error?.message || error)}`)
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

export async function referenceAssetGet(ctx) {
  const { res, request, allowlist } = ctx
  // OS-75：世界书图片本体（只读，只放行 参考/ 下的图片扩展名）。
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const assetPath = text(request.path).trim().replaceAll('\x5c', '/')
  if (!assetPath.startsWith(`${REFERENCE_DIR}/`)) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `只放行参考目录下的图片：${assetPath}`)
  }
  if (!/\.(png|jpe?g|webp|gif|avif)$/iu.test(assetPath)) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `不是图片扩展名：${assetPath}`)
  }
  const resolvedAsset = resolveInsideRoot(authorized.root, assetPath, { allowMetadata: false })
  if (!resolvedAsset.ok) return sendError(res, resolvedAsset.code ?? API_ERROR_CODES.PATH_ESCAPE, resolvedAsset.message)
  let buf
  try { buf = await readFile(resolvedAsset.path) } catch (error) {
    if (error?.code === 'ENOENT') return sendError(res, API_ERROR_CODES.NOT_FOUND, `图片不存在：${assetPath}`)
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `读图失败：${text(error?.message || error)}`)
  }
  const ext = assetPath.split('.').pop().toLowerCase()
  const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'avif' ? 'image/avif' : 'image/png'
  res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache', 'content-length': buf.length })
  return res.end(buf)
}

export async function referenceImageGenerate(ctx) {
  const { res, request, context, allowlist } = ctx
  // OS-80：生图改异步——先提交到全局任务中心（立刻返回 jobId），任务后台跑。
  // 作者口径：「切走再回来不应丢状态」，进度要能跨页面看到。
  // async:true 时走任务中心；不带 async 保留原同步行为（MCP / 兼容用）。
  if (request.async === true) {
    const authorized0 = authorizeRoot(allowlist, request.root)
    if (!authorized0.ok) return sendError(res, authorized0.code, authorized0.message, authorized0.details)
    const reqPath = text(request.path).trim()
    const title = reqPath.split('/').pop().replace(/\.md$/u, '')
    const port = context.port || DEFAULT_PORT
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
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `只给参考目录下的条目生图：${requested}`)
  }
  const resolved = resolveInsideRoot(authorized.root, requested, { allowMetadata: false })
  if (!resolved.ok) return sendError(res, resolved.code ?? API_ERROR_CODES.PATH_ESCAPE, resolved.message)

  const { config } = await loadConfigV2(context.agentConfigPath)
  const image = config.image
  if (!image.enabled) {
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '生图没启用——设置 · 模型 · 生图里打开开关')
  }

  // 读条目原文，拿 title / 正文摘要 作为生图描述（作者可显式传 prompt 覆盖）
  let noteRaw = ''
  try { noteRaw = await readFile(resolved.path, 'utf-8') } catch (error) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `条目读不了：${text(error?.message || error)}`)
  }
  const parsed = parseFrontmatter(noteRaw)
  const noteTitle = text(parsed.data?.title).trim() || text(requested).split('/').pop().replace(/\.md$/u, '')
  const noteKind = text(request.kind).trim() || text(parsed.data?.kind).trim() || 'character'
  const bodyExcerpt = text(parsed.body).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 200)

  const describe = text(request.prompt).trim()
    || `${noteKind === 'scene' ? '场景' : noteKind === 'item' ? '道具' : '人物'}设定图：${noteTitle}。${bodyExcerpt || '（按条目名想象）'}`
  const stylePrefix = text(request.stylePrompt).trim() || text(image.stylePrompt).trim() || DEFAULT_IMAGE_STYLE
  const size = text(request.size).trim() || '1024x1024'

  let b64 = ''
  if (image.backend === 'comfyui') {
    if (!text(image.comfyUrl).trim()) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置 ComfyUI 地址')
    }
    const comfy = await generateViaComfy({
      comfyUrl: image.comfyUrl,
      workflowPath: image.comfyWorkflow,
      root: authorized.root,
      nodeMap: image.comfyNodeMap,
      prompt: `${stylePrefix}，${describe}。无文字。`,
      negative: DEFAULT_IMAGE_NEGATIVE,
      size
    })
    if (!comfy.ok) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `ComfyUI 生图失败：${comfy.error}`)
    b64 = comfy.b64
  } else {
    if (!image.endpoint) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置生图端点')
    }
    try {
      const response = await fetch(imagesGenerationsUrl(image.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(image.apiKey ? { authorization: `Bearer ${image.apiKey}` } : {}) },
        body: JSON.stringify({ model: text(image.model), prompt: `${stylePrefix}，${describe}。无文字。`, size, n: 1, response_format: 'b64_json' }),
        signal: AbortSignal.timeout(300_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} · ${(await response.text()).slice(0, 200)}`)
      const payload = await response.json()
      b64 = payload?.data?.[0]?.b64_json
      if (!b64) throw new Error('端点没返回 b64_json')
    } catch (error) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `生图端点失败：${text(error?.message || error)}`)
    }
  }

  // 落盘：参考/<条目目录>/assets/<条目名>.png（安全名）
  const safeName = noteTitle.replace(/[\\/:*?"<>|]/gu, '_').slice(0, 40) || 'image'
  const noteDir = requested.split('/').slice(0, -1).join('/')
  const imageRel = `${noteDir}/assets/${safeName}.png`
  const imageAbs = resolveInsideRoot(authorized.root, imageRel, { allowMetadata: false })
  if (!imageAbs.ok) return sendError(res, imageAbs.code ?? API_ERROR_CODES.PATH_ESCAPE, imageAbs.message)
  await mkdir(dirname(imageAbs.path), { recursive: true })
  await atomicWriteFile(imageAbs.path, Buffer.from(b64, 'base64')) // 二进制走 hostWrite 二进制分支

  // 回填 frontmatter：cover 指向新图，images 数组追加（去重，保留最近 6 张）
  const nextData = { ...parsed.data }
  const images = Array.isArray(nextData.images) ? nextData.images.map((x) => text(x).trim()).filter(Boolean) : []
  if (!images.includes(imageRel)) images.unshift(imageRel)
  nextData.images = images.slice(0, 6)
  if (!text(nextData.cover).trim()) nextData.cover = imageRel
  const nextRaw = `${serializeFrontmatter(nextData)}\n${parsed.body}`
  const written = await writeChapterWithBackup(authorized.root, requested, nextRaw)
  if (!written.ok) return sendError(res, written.code, written.message, written.details)

  return sendJson(res, 200, {
    ok: true,
    path: requested,
    imagePath: imageRel,
    frontmatter: nextData,
    chars: nextRaw.length
  })
}

export async function referenceAbsorb(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  // OS-48：旧目录迁入参考。规划（哪些搬、哪些目标冲突）在 referenceStore，真搬运走
  // writeChapterWithBackup（原子写目标）+ deleteChapter（源进 .history，可逆）这两条既有通道。
  const planned = await absorbLegacyDirs(authorized.root, Array.isArray(request.dirs) ? request.dirs : [])
  if (!planned.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, planned.message)
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
    const written = await writeChapterWithBackup(authorized.root, item.toRel, content)
    if (!written.ok) {
      skipped.push({ path: item.fromRel, reason: written.message })
      continue
    }
    const removed = await deleteChapter(authorized.root, item.fromRel)
    if (!removed.ok) {
      skipped.push({ path: item.fromRel, reason: `目标已写入，但删源失败（旧文件保留原位）：${removed.message}` })
      continue
    }
    moved.push({ from: item.fromRel, to: item.toRel, backup: removed.backup })
  }
  return sendJson(res, 200, { ok: true, moved, skipped })
}

export async function syncCheck(ctx) {
  // OS-107：同源版本检查 ＋ 外部变更检测。一次读盘回答两件事：
  //   ① fact revision 与兄弟 wiki 的 derivedFrom.factRevision 是否同源（wikiStale）；
  //   ② 正文文件的 hash/mtime 与 changelog 对照，捞出绕过写通道的外部改动。
  // 检查本身会刷新 .pinax/sync-state.json 快照（POST 而非 GET 的原因）。
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root

  // ① 拆解：最新一本书的主档 revision ＋ 兄弟 wiki 的派生基准（两代兼容走 readFactWiki）
  let bookId = await resolveFactBookId(root, '')
  // resolveFactBookId 挑「最新 .json」时会把兄弟 `<id>.wiki.json` 也算进去（同样以 .json 结尾）。
  // 同源检查要的是主档：命中派生档就退回同 id 的主档（主档存在时）。
  if (/\.wiki$/u.test(bookId) && existsSync(join(root, '拆解', `${bookId.slice(0, -'.wiki'.length)}.json`))) {
    bookId = bookId.slice(0, -'.wiki'.length)
  }
  let document = null
  try { document = JSON.parse(await readFile(join(root, '拆解', `${bookId}.json`), 'utf-8')) } catch { document = null }
  if (document && !isPlainObject(document)) document = null
  const entries = Array.isArray(document?.entries) ? document.entries : []
  const rawRevision = Number(document?.revision)
  const factRevision = Number.isSafeInteger(rawRevision) && rawRevision >= 0 ? rawRevision : null
  const wikiRead = factStore.readFactWiki({ root, id: bookId, document })
  // 旧信封里的 wiki 没有 derivedFrom（内嵌形态）——按「无派生档」如实报，不编基准版本。
  const wikiDerivedFrom = isPlainObject(wikiRead.derivedFrom) ? wikiRead.derivedFrom : null

  // OS-114：时间戳对齐——revision 是内核计数器，作者看不懂「差几版」；
  // 真实写作频繁小改，要的是「谁比谁新」。三个时间戳：
  //   factAt      = 拆解主档文件的 mtime（最后一次写盘时间）
  //   wikiAt      = 派生档的 generated_at（生成时刻；没有就退文件 mtime）
  //   chaptersAt  = 正文最新一个文件的 mtime
  let factAt = null
  try {
    factAt = statSync(join(root, '拆解', `${bookId}.json`)).mtime.toISOString()
  } catch { factAt = null }
  let wikiAt = null
  try {
    const wikiPath = join(root, '拆解', `${bookId}.wiki.json`)
    const wikiDoc = JSON.parse(await readFile(wikiPath, 'utf-8'))
    // generated_at 是 enrich 写的权威生成时刻；没有就退文件 mtime
    wikiAt = text(wikiDoc?.generated_at) || statSync(wikiPath).mtime.toISOString()
  } catch { wikiAt = null }

  // ② 参考笔记最新 mtime（scanReferences 已导出，索引里就是 ISO 串）
  const referenceIndex = await scanReferences(root)
  const refsMtimeMax = (Array.isArray(referenceIndex.notes) ? referenceIndex.notes : [])
    .map((note) => text(note?.mtime))
    .filter(Boolean)
    .sort()
    .pop() ?? null

  // ③ 正文快照 ＋ 每个文件最近一条变更日志的时间（判定「改动走没走写通道」的依据）
  // 不按 module 过滤：同一文件可能被别的通道（剧本转正/迁移）以不同模块名记过，
  // 只看 '正文' 会把那些正常写入误判成外部改动。files 白名单已经收窄了范围。
  const prose = await scanProseFiles(root)
  // 正文最新改动时刻（OS-114）：与 factAt 比，判断「正文改了但拆解没跟上」
  const chaptersAt = prose
    .map((item) => text(item?.mtime))
    .filter(Boolean)
    .sort()
    .pop() ?? null
  const logged = await readLatestByFile({ root, files: prose.map((item) => item.path) })
  if (!logged.ok) {
    return sendError(res, logged.code ?? API_ERROR_CODES.INVALID_ENTRY, '读变更日志失败：同源检查没法判定哪些改动没留痕')
  }
  const snapshot = prose.map((item) => ({
    path: item.path,
    hash: item.hash,
    mtime: item.mtime,
    loggedAt: text(logged.latest?.[item.path]) || null
  }))

  let external
  try {
    external = await snapshotAndDiff({ root, files: snapshot })
  } catch (error) {
    return sendError(res, error?.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, text(error?.message || error))
  }

  const sameSource = checkSameSource({
    root,
    factMtime: factAt,
    wikiGeneratedAt: wikiAt,
    refsMtimeMax,
    chaptersMtimeMax: chaptersAt,
    factRevision: factRevision ?? (entries.length ? 1 : 0),
    wikiDerivedFrom,
    entries
  })
  const payload = {
    ok: true,
    sameSource,
    external,
    factRevision: sameSource.factRevision
  }
  const checked = validateResponse('syncCheck', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '同源检查响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

/** reference 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  referenceGet,
  referenceGraphGet,
  referenceNoteGet,
  referenceAssetGet,
  referenceImageGenerate,
  referenceAbsorb,
  syncCheck
}
