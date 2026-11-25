/**
 * artifacts 端点 handler（OS-194 从 src/api/handlers/system.mjs 归位）。
 * 宿主工具经 activate(context) 的 context.host 注入；本文件只 import node:/protocol。
 */
import { listArtifacts } from '../../protocol/libraryInventory.mjs'

export function createHandlers({ host }) {
  const { apiErrors, sendError, sendJson, authorizeRoot } = host

  async function artifactsGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const inventory = await listArtifacts(authorized.root)
    if (!inventory.ok) return sendError(res, inventory.code ?? apiErrors.INVALID_ENTRY, inventory.message)
    return sendJson(res, 200, { ok: true, groups: inventory.groups, totals: inventory.totals })
  }

  return { artifactsGet }
}
