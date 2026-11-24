/**
 * 导入导出域 handler（OS-162）：pedia/v1 ↔ fact.data/v3 薄适配端点。
 * 写一律走 factEntriesImport 抽出的同一写入函数；导出经既有 fact 读通道，存盘走宿主写协议。
 */
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { API_ERROR_CODES, isPlainObject } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot } from '../../host/authorize.mjs'
import { factStore } from '../../kernel/index.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { recordChange } from '../../protocol/changelog.mjs'
import { LOG_MODULES } from '../../protocol/naming.mjs'
import { pediaToFactEntry, factEntryToPedia } from '../../modules/exchange/pediaAdapter.mjs'
import { writeFactEntries } from '../../services/factImportWrite.mjs'

const FORMATS = new Set(['pedia/v1', 'jsonl'])

/** 解析导入文本：JSONL 逐行；pedia/v1 支持单对象或数组。 */
function parseInput(format, raw) {
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

export async function exchangeImport(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = text(request.bookId).trim()
  if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
  const format = text(request.format).trim() || 'pedia/v1'
  if (!FORMATS.has(format)) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `format 只许 ${[...FORMATS].join('/')}`)

  const parsed = parseInput(format, request.text)
  if (!parsed.entries) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, parsed.error)

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
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `${errors.length} 条转换后仍不合法（逐条见 details）`, { errors })
  }

  const dryRun = request.dryRun === true
  if (dryRun) {
    return sendJson(res, 200, { ok: true, dryRun: true, entries: adapted.length, errors, warnings, skipped })
  }

  // 写：与 factEntriesImport 共用同一写入函数（原子写＋revision＋幂等＋wiki＋日志）
  const written = await writeFactEntries({
    root: authorized.root, bookId, entries: adapted,
    operationId: `pedia-import-${bookId}-${Date.now().toString(36)}`
  })
  if (!written.ok) return sendError(res, API_ERROR_CODES[written.code] ?? written.code, written.message, written.details)
  return sendJson(res, 200, {
    ok: true, dryRun: false, entries: written.entries, errors, warnings, skipped,
    written: { bookId: written.bookId, revision: written.revision, backup: written.backup }
  })
}

export async function exchangeExport(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = text(request.bookId).trim()
  if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
  const format = text(request.format).trim() || 'pedia/v1'
  if (!FORMATS.has(format)) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `format 只许 ${[...FORMATS].join('/')}`)

  // 经既有 fact 读通道取条目（不另开读口）
  const store = factStore.createFactFileStore({ root: authorized.root })
  const listed = await store.list({})
  if (!listed.ok) return sendError(res, listed.code ?? API_ERROR_CODES.INVALID_ENTRY, listed.message)
  const entries = (listed.entries ?? []).filter((entry) => text(entry.bookId ?? entry.book?.id) === bookId || !entry.bookId)
  if (!entries.length) return sendError(res, API_ERROR_CODES.NOT_FOUND, `拆解里没有这本书的条目：${bookId}`)

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
    const rel = `导出/${bookId}-pedia.${format === 'jsonl' ? 'jsonl' : 'json'}`
    const path = join(authorized.root, rel)
    try {
      await mkdir(join(authorized.root, '导出'), { recursive: true })
      await atomicWriteFile(path, body)
      await recordChange({
        root: authorized.root, module: LOG_MODULES.storysource, file: rel,
        op: 'create', before: '', after: body, actor: 'author'
      }).catch(() => {})
      file = rel
    } catch (error) {
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `导出存盘失败：${text(error?.message || error)}`)
    }
  }
  return sendJson(res, 200, { ok: true, bookId, entries: projected, lost: [...lostSet], ...(file ? { file } : {}) })
}

/** exchange 域端点 → handler 注册表片段。 */
export const handlers = { exchangeImport, exchangeExport }
