/**
 * reference 域 handler（OS-141 daemon 拆分）——7 端点，与 contracts/reference.mjs 一一对应：
 * referenceGet/referenceGraphGet/referenceNoteGet（索引·图谱·笔记本体）、
 * referenceAssetGet/referenceImageGenerate（图片本体·设定图生成）、referenceAbsorb（旧目录迁入）、
 * syncCheck（同源版本＋外部变更检测）。
 *
 * 统一签名 `async handler(ctx)`：全部端点都需要库，第一件事 authorizeRoot。
 */
import { existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { API_ERROR_CODES, isPlainObject, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot } from '../../host/authorize.mjs'
import { checkSameSource, snapshotAndDiff, scanProseFiles } from '../../services/syncCheck.mjs'
import { readLatestByFile } from '../../protocol/changelog.mjs'
import { resolveFactCapability, resolveProseCapability } from '../../host/capabilityBindings.mjs'
// OS-195a：世界书索引经钩子贡献取；故事源书目盘点经 fact.books 句柄取。
import { referenceIndexFor } from '../../host/moduleHooks.mjs'
import { namingEntry } from '../../protocol/naming.mjs'

const FACT_DIR = namingEntry('storysource').dir

async function factCapabilityOrError(res, root) {
  const resolved = await resolveFactCapability(root, 'fact.store')
  if (!resolved.ok) {
    sendError(res, API_ERROR_CODES.PLUGIN_DEGRADED, resolved.message, resolved.details)
    return null
  }
  return resolved.capability
}

async function proseCapabilityOrError(res, root) {
  const resolved = await resolveProseCapability(root)
  if (!resolved.ok) {
    sendError(res, API_ERROR_CODES.PLUGIN_DEGRADED, resolved.message, resolved.details)
    return null
  }
  return resolved.capability
}

export async function syncCheck(ctx) {
  // OS-107：同源版本检查 ＋ 外部变更检测。一次读盘回答两件事：
  //   ① fact revision 与兄弟 wiki 的 derivedFrom.factRevision 是否同源（wikiStale）；
  //   ② 正文文件的 hash/mtime 与 changelog 对照，捞出绕过写通道的外部改动。
  // 检查本身会刷新 .openstory/sync-state.json 快照（POST 而非 GET 的原因）。
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root

  // ① 故事源：最新一本书的主档 revision ＋ 兄弟 wiki 的派生基准（两代兼容走 readFactWiki）
  const factBooks = await resolveFactCapability(root, 'fact.books')
  if (!factBooks.ok) {
    sendError(res, API_ERROR_CODES.PLUGIN_DEGRADED, factBooks.message, factBooks.details)
    return null
  }
  let bookId = await factBooks.capability.resolveFactBookId(root, '')
  // resolveFactBookId 挑「最新 .json」时会把兄弟 `<id>.wiki.json` 也算进去（同样以 .json 结尾）。
  // 同源检查要的是主档：命中派生档就退回同 id 的主档（主档存在时）。
  if (/\.wiki$/u.test(bookId) && existsSync(join(root, FACT_DIR, `${bookId.slice(0, -'.wiki'.length)}.json`))) {
    bookId = bookId.slice(0, -'.wiki'.length)
  }
  let document = null
  try { document = JSON.parse(await readFile(join(root, FACT_DIR, `${bookId}.json`), 'utf-8')) } catch { document = null }
  if (document && !isPlainObject(document)) document = null
  const entries = Array.isArray(document?.entries) ? document.entries : []
  const rawRevision = Number(document?.revision)
  const factRevision = Number.isSafeInteger(rawRevision) && rawRevision >= 0 ? rawRevision : null
  const factStore = await factCapabilityOrError(res, root)
  if (!factStore) return null
  const wikiRead = factStore.readFactWiki({ root, id: bookId, document })
  // 旧信封里的 wiki 没有 derivedFrom（内嵌形态）——按「无派生档」如实报，不编基准版本。
  const wikiDerivedFrom = isPlainObject(wikiRead.derivedFrom) ? wikiRead.derivedFrom : null

  // OS-114：时间戳对齐——revision 是内核计数器，作者看不懂「差几版」；
  // 真实写作频繁小改，要的是「谁比谁新」。三个时间戳：
  //   factAt      = 故事源主档文件的 mtime（最后一次写盘时间）
  //   wikiAt      = 派生档的 generated_at（生成时刻；没有就退文件 mtime）
  //   chaptersAt  = 正文最新一个文件的 mtime
  let factAt = null
  try {
    factAt = statSync(join(root, FACT_DIR, `${bookId}.json`)).mtime.toISOString()
  } catch { factAt = null }
  let wikiAt = null
  try {
    const wikiPath = join(root, FACT_DIR, `${bookId}.wiki.json`)
    const wikiDoc = JSON.parse(await readFile(wikiPath, 'utf-8'))
    // generated_at 是 enrich 写的权威生成时刻；没有就退文件 mtime
    wikiAt = text(wikiDoc?.generated_at) || statSync(wikiPath).mtime.toISOString()
  } catch { wikiAt = null }

  // ② 世界书笔记最新 mtime（scanReferences 已导出，索引里就是 ISO 串）
  const referenceIndex = await referenceIndexFor(root)
  const refsMtimeMax = (Array.isArray(referenceIndex.notes) ? referenceIndex.notes : [])
    .map((note) => text(note?.mtime))
    .filter(Boolean)
    .sort()
    .pop() ?? null

  // ③ 正文快照 ＋ 每个文件最近一条变更日志的时间（判定「改动走没走写通道」的依据）
  // 不按 module 过滤：同一文件可能被别的通道（剧本转正/迁移）以不同模块名记过，
  // 只看 '正文' 会把那些正常写入误判成外部改动。files 白名单已经收窄了范围。
  const prose = await scanProseFiles(root)
  // 正文最新改动时刻（OS-114）：与 factAt 比，判断「正文改了但故事源没跟上」
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
    // OS-211：主档 revision 读不到就原样传 null——不许在这里补 1／0 冒充「可信版本」，
    // 否则 revision 判定会把「没读到」当成「第 0 版」，同源检查就失去权威依据。
    factRevision,
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

  syncCheck
}
