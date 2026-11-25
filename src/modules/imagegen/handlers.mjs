/**
 * imagegen 端点 handler（OS-194 三处归位）：
 *   deduceImage           ← src/api/handlers/fact.mjs
 *   referenceImageGenerate ← src/api/handlers/reference.mjs
 *   visionDescribe        ← src/api/handlers/system.mjs
 * 内核句柄（fact.books / agent.runtime / media.* / prose.write）经 activate(context) 注入。
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { namingEntry } from '../../protocol/naming.mjs'
import { parseFrontmatter, serializeFrontmatter, REFERENCE_DIR } from '../../protocol/referenceStore.mjs'
import { safeDeduceBookId } from '../../protocol/deduceSession.mjs'

const ROLEPLAY_DIR = namingEntry('roleplay').dir

export function createHandlers({ host, factBooks, agentRuntime, mediaGenerate, mediaDescribe, prose }) {
  const {
    apiErrors, sendError, sendJson, text, authorizeRoot, resolveInsideRoot,
    defaultPort, submitJob
  } = host

  async function deduceImage(ctx) {
    // 生图（OS-63 预留转正）：调全局配置的 image 块（OpenAI 兼容 images/generations），
    // 产物落 扮演/<bookId>/素材/场景/<name>.png。没开开关/没填端点＝如实报，不假装生成。
    const { res, request, context, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await factBooks.resolveFactBookId(authorized.root, request.bookId)
    const { config } = await agentRuntime.loadConfigV2(context.agentConfigPath)
    const image = config.image
    if (!image.enabled) {
      return sendError(res, apiErrors.AGENT_UPSTREAM_ERROR, '生图没启用——设置 · 模型 · 生图里打开开关并填 OpenAI 兼容 images API 的地址与模型后可用')
    }
    const name = text(request.name).trim().slice(0, 40)
    const prompt = text(request.prompt).trim()
    if (!name || !prompt) return sendError(res, apiErrors.INVALID_ENTRY, 'name 与 prompt 必填')
    if (/[\/]|\.\./u.test(name)) return sendError(res, apiErrors.PATH_ESCAPE, 'name 不能含路径分隔符')
    const size = text(request.size).trim() || '1024x1024'
    const generated = await mediaGenerate.generate({
      image,
      root: authorized.root,
      prompt,
      stylePrompt: text(request.stylePrompt),
      negative: text(request.negative),
      size
    })
    if (!generated.ok) return sendError(res, apiErrors.AGENT_UPSTREAM_ERROR, generated.error)
    const b64 = generated.b64
    const dir = join(authorized.root, ROLEPLAY_DIR, safeDeduceBookId(bookId), '素材', '场景')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${name}.png`)
    await atomicWriteFile(path, Buffer.from(b64, 'base64')) // 二进制走 hostWrite 二进制分支
    return sendJson(res, 200, { ok: true, name, path: `${ROLEPLAY_DIR}/${safeDeduceBookId(bookId)}/素材/场景/${name}.png`, size })
  }

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

  async function visionDescribe(ctx) {
    const { res, request, context, allowlist } = ctx
    // OS-76：识图走 DSH 子 agent（不是 LLM API）——DSH 有内置 read_image 工具，
    // 子 agent 用「设置里指定的 vision 模型」读图，按预设提示词写文学白描。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const imageRel = text(request.image).trim().replaceAll('\x5c', '/')
    if (!imageRel) return sendError(res, apiErrors.INVALID_ENTRY, 'image 必填（库内图片相对路径）')
    if (!/\.(png|jpe?g|webp|gif|avif)$/iu.test(imageRel)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `不是图片：${imageRel}`)
    }
    const resolvedImage = resolveInsideRoot(authorized.root, imageRel, { allowMetadata: false })
    if (!resolvedImage.ok) return sendError(res, resolvedImage.code ?? apiErrors.PATH_ESCAPE, resolvedImage.message)
    if (!existsSync(resolvedImage.path)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `图片不存在：${imageRel}`)
    }

    const { config } = await agentRuntime.loadConfigV2(context.agentConfigPath)
    const described = await mediaDescribe.describe({
      imagePath: resolvedImage.path,
      root: authorized.root,
      vision: config.vision,
      target: text(request.target).trim() || 'character',
      focus: text(request.focus).trim(),
      habitContext: text(request.habitContext).trim(),
      env: context.env ?? process.env,
      runtime: agentRuntime
    })
    if (!described.ok) return sendError(res, apiErrors.AGENT_UPSTREAM_ERROR, described.error)
    return sendJson(res, 200, { ok: true, text: described.text, chars: described.chars, ...(described.model ? { model: described.model } : {}) })
  }

  return { deduceImage, referenceImageGenerate, visionDescribe }
}
