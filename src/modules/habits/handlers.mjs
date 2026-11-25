/**
 * habits 端点 handler（OS-194 从 src/api/handlers/system.mjs 归位）。
 */
import { readHabits, normalizeHabits, writeHabitsWithBackup } from '../../protocol/habits.mjs'

export function createHandlers({ host }) {
  const { apiErrors, sendError, sendJson, authorizeRoot } = host

  async function habitsGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    return sendJson(res, 200, { ok: true, habits: readHabits(authorized.root) })
  }

  async function habitsPut(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const habits = normalizeHabits(request.habits)
    if (!habits) return sendError(res, apiErrors.INVALID_ENTRY, '习惯表形状不对：需要 { tone, style, bannedWords, preferredWords, bannedPatterns, bannedRhetoric, formulas }')
    const backup = await writeHabitsWithBackup(authorized.root, habits)
    return sendJson(res, 200, { ok: true, habits, backup })
  }

  return { habitsGet, habitsPut }
}
