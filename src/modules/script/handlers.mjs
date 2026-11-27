/**
 * 剧本域处理器（OS-214）：剧本 ↔ fact 互转的服务端入口。
 *
 * 互转算法本身是纯函数（`./scriptFact.mjs`），本文件只负责：
 *   · 授权 root（allowlist 同一道闸，不新开旁路）；
 *   · 取 fact 条目（from-fact 方向可选按 bookId 读现档）；
 *   · 契约响应校验。
 * **不写盘**——写入一律由调用方另走 `/api/fact/entries/import`（schema/revision/operationId/备份
 * 都在那边，这里再开一个写口就等于复制写协议）。
 */
import { factToScript, scriptToFact } from './scriptFact.mjs'

export function createHandlers({ host, factStore }) {
  // OS-214/S2.1：工作台不得反向 import 底座契约——validateResponse 从 host 工具袋取
  // （与 worldbook/chapters 等模块同一口径）。
  const { apiErrors, sendError, sendJson, text, authorizeRoot, validateResponse } = host

  async function resolveEntries(root, request) {
    if (Array.isArray(request.entries)) return { ok: true, entries: request.entries }
    const bookId = text(request.bookId).trim()
    const store = factStore.createFactFileStore({ root })
    const listed = store.list({})
    if (!listed.ok) {
      return { ok: false, code: apiErrors.INVALID_ENTRY, message: listed?.error?.message ?? '故事源数据读不了', details: listed?.error?.details }
    }
    const entries = Array.isArray(listed.entries) ? listed.entries : []
    if (!entries.length) return { ok: false, code: apiErrors.FACT_EMPTY ?? apiErrors.INVALID_ENTRY, message: '这个库还没有故事源条目' }
    if (!bookId) return { ok: true, entries }
    const scoped = entries.filter((entry) => (entry.sourceFile
      ? text(entry.sourceFile) === bookId || text(entry.bookId) === bookId
      : text(entry.bookId) === bookId))
    if (!scoped.length) {
      return { ok: false, code: apiErrors.NOT_FOUND, message: `故事源里没有这本书：${bookId}` }
    }
    return { ok: true, entries: scoped }
  }

  /** 剧本 → fact 条目骨架（不写盘）。 */
  async function scriptToFactHandler(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    if (typeof request.text !== 'string') {
      return sendError(res, apiErrors.INVALID_ENTRY, 'text 必须是剧本全文（字符串）')
    }
    let converted
    try {
      converted = await scriptToFact(request.text, {
        ...(text(request.bookId).trim() ? { bookId: text(request.bookId).trim() } : {}),
        ...(text(request.domain).trim() ? { domain: text(request.domain).trim() } : {})
      })
    } catch (error) {
      return sendError(res, apiErrors.INVALID_ENTRY, `剧本解析失败：${text(error?.message || error)}`)
    }
    const payload = {
      ok: true,
      entries: Array.isArray(converted.entries) ? converted.entries : [],
      wiki: converted.wiki ?? {},
      stats: converted.stats ?? {}
    }
    const checked = validateResponse('scriptToFact', payload)
    if (!checked.ok) return sendError(res, apiErrors.INVALID_ENTRY, '剧本互转响应形状不符合契约', { errors: checked.errors })
    return sendJson(res, 200, payload)
  }

  /** fact 条目 → 剧本文本（不写盘）。 */
  async function scriptFromFactHandler(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const resolved = await resolveEntries(authorized.root, request)
    if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
    // 空条目不是「渲染出空剧本」而是没有可渲染的东西——如实报错，别让调用方以为成功。
    if (!resolved.entries.length) {
      return sendError(res, apiErrors.INVALID_ENTRY, '没有可渲染的 fact 条目（传 entries 或先构建故事源）', { entries: 0 })
    }
    let rendered
    try {
      rendered = factToScript(resolved.entries, request.wiki ?? null)
    } catch (error) {
      return sendError(res, apiErrors.INVALID_ENTRY, `剧本渲染失败：${text(error?.message || error)}`)
    }
    // factToScript 历史上返回 { text, stats }，也兼容直接返回字符串的实现。
    const scriptText = typeof rendered === 'string' ? rendered : text(rendered?.text)
    const stats = typeof rendered === 'string' ? {} : (rendered?.stats ?? {})
    const payload = { ok: true, text: scriptText, stats }
    const checked = validateResponse('scriptFromFact', payload)
    if (!checked.ok) return sendError(res, apiErrors.INVALID_ENTRY, '剧本渲染响应形状不符合契约', { errors: checked.errors })
    return sendJson(res, 200, payload)
  }

  return { scriptToFact: scriptToFactHandler, scriptFromFact: scriptFromFactHandler }
}
