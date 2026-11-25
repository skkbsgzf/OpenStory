/**
 * imagegen 端点 handler（OS-194 归位；OS-195a 把写世界书条目的参考图端点交还世界书）：
 *   deduceImage    ← src/api/handlers/fact.mjs
 *   visionDescribe ← src/api/handlers/system.mjs
 * referenceImageGenerate 归世界书模块——它读写的是世界书条目，走端点分派，不跨模块 import。
 * 内核句柄（deduce.engine / fact.books / agent.runtime / media.*）经 activate(context) 注入。
 */
import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { namingEntry } from '../../protocol/naming.mjs'

const ROLEPLAY_DIR = namingEntry('roleplay').dir

export function createHandlers({ host, deduce, factBooks, agentRuntime, mediaGenerate, mediaDescribe }) {
  const { safeDeduceBookId } = deduce
  const {
    apiErrors, sendError, sendJson, text, authorizeRoot, resolveInsideRoot
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

  return { deduceImage, visionDescribe }
}
