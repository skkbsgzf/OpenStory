/**
 * exchange 端点 handler（OS-194 从 src/api/handlers/exchange.mjs 整体归位）。
 * fact.store / fact.write 句柄经 activate(context) 的 context.resolve 注入。
 */
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { recordChange } from '../../protocol/changelog.mjs'
import { LOG_MODULES, namingEntry } from '../../protocol/naming.mjs'
import { pediaToFactEntry, factEntryToPedia } from '../../protocol/pediaAdapter.mjs'

const FORMATS = new Set(['pedia/v1', 'jsonl'])
const EXCHANGE_DIR = namingEntry('exchange').dir

/** 解析导入文本：JSONL 逐行；pedia/v1 支持单对象或数组。 */
function parseInput(format, raw, { text, isPlainObject }) {
  const body = text(raw).trim()
  if (!body) return { entries: null, error: '文本为空' }
  if (format === 'jsonl') {
    const entries = []
    for (const line of body.split(/\r?\n/u)) {
      if (!line.trim()) continue
      try { entries.push(JSON.parse(line)) } catch (error) { return { entries: null, error: `JSONL 第 ${entries.length + 1} 行解析失败：${text(error?.message || error)}` } }
    }
    return { entries }
  }
  try {
    const parsed = JSON.parse(body)
    if (Array.isArray(parsed)) return { entries: parsed }
    if (isPlainObject(parsed)) {
      // pedia 单条目 or { entries:[...] } 包装
      if (Array.isArray(parsed.entries)) return { entries: parsed.entries }
      return { entries: [parsed] }
    }
    return { entries: null, error: 'pedia/v1 需要条目对象或数组' }
  } catch (error) {
    return { entries: null, error: `JSON 解析失败：${text(error?.message || error)}` }
  }
}

export function createHandlers({ host, factStore, factWrite }) {
  const { apiErrors, sendError, sendJson, text, isPlainObject, authorizeRoot } = host

  async function exchangeImport(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = text(request.bookId).trim()
    if (!bookId) return sendError(res, apiErrors.INVALID_ENTRY, 'bookId 必填')
    const format = text(request.format).trim() || 'pedia/v1'
    if (!FORMATS.has(format)) return sendError(res, apiErrors.INVALID_ENTRY, `format 只许 ${[...FORMATS].join('/')}`)

    const parsed = parseInput(format, request.text, { text, isPlainObject })
    if (!parsed.entries) return sendError(res, apiErrors.INVALID_ENTRY, parsed.error)

    const adapted = []
    const errors = []
    const warnings = []
    const skipped = []
    parsed.entries.forEach((entry, index) => {
      const result = pediaToFactEntry(entry)
      if (result.skipped) { skipped.push({ index, reason: result.reason }); return }
      for (const error of result.errors ?? []) errors.push({ index, ...error })
      for (const warning of result.warnings ?? []) warnings.push({ index, ...warning })
      adapted.push(result.entry)
    })
    if (errors.length) {
      return sendError(res, apiErrors.INVALID_ENTRY, `${errors.length} 条转换后仍不合法（逐条见 details）`, { errors })
    }

    const dryRun = request.dryRun === true
    if (dryRun) {
      return sendJson(res, 200, { ok: true, dryRun: true, entries: adapted.length, errors, warnings, skipped })
    }

    // 写：与 factEntriesImport 共用同一写入函数（原子写＋revision＋幂等＋wiki＋日志）
    const written = await factWrite.writeFactEntries({
      root: authorized.root, bookId, entries: adapted, factStore,
      operationId: `pedia-import-${bookId}-${Date.now().toString(36)}`
    })
    if (!written.ok) return sendError(res, apiErrors[written.code] ?? written.code, written.message, written.details)
    return sendJson(res, 200, {
      ok: true, dryRun: false, entries: written.entries, errors, warnings, skipped,
      written: { bookId: written.bookId, revision: written.revision, backup: written.backup }
    })
  }

  async function exchangeExport(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = text(request.bookId).trim()
    if (!bookId) return sendError(res, apiErrors.INVALID_ENTRY, 'bookId 必填')
    const format = text(request.format).trim() || 'pedia/v1'
    if (!FORMATS.has(format)) return sendError(res, apiErrors.INVALID_ENTRY, `format 只许 ${[...FORMATS].join('/')}`)

    // 经既有 fact 读通道取条目（不另开读口）
    const store = factStore.createFactFileStore({ root: authorized.root })
    const listed = await store.list({})
    if (!listed.ok) return sendError(res, listed.code ?? apiErrors.INVALID_ENTRY, listed.message)
    const entries = (listed.entries ?? []).filter((entry) => text(entry.bookId ?? entry.book?.id) === bookId || !entry.bookId)
    if (!entries.length) return sendError(res, apiErrors.NOT_FOUND, `故事源里没有这本书的条目：${bookId}`)

    const projected = []
    const lostSet = new Set()
    for (const entry of entries) {
      const result = factEntryToPedia(entry)
      projected.push(result.entry)
      for (const field of result.lost) lostSet.add(field)
    }
    const body = format === 'jsonl'
      ? projected.map((entry) => JSON.stringify(entry)).join('\n') + '\n'
      : JSON.stringify(projected, null, 2)

    let file = ''
    if (request.save === true) {
      const rel = `${EXCHANGE_DIR}/${bookId}-pedia.${format === 'jsonl' ? 'jsonl' : 'json'}`
      const path = join(authorized.root, rel)
      try {
        await mkdir(join(authorized.root, EXCHANGE_DIR), { recursive: true })
        await atomicWriteFile(path, body)
        await recordChange({
          root: authorized.root, module: LOG_MODULES.exchange, file: rel,
          op: 'create', before: '', after: body, actor: 'author'
        }).catch(() => {})
        file = rel
      } catch (error) {
        return sendError(res, apiErrors.WRITE_PROTOCOL_IO_FAILED, `导出存盘失败：${text(error?.message || error)}`)
      }
    }
    return sendJson(res, 200, { ok: true, bookId, entries: projected, lost: [...lostSet], ...(file ? { file } : {}) })
  }

  return { exchangeImport, exchangeExport }
}
