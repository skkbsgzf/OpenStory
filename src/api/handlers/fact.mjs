/**
 * fact 域 handler（OS-141 daemon 拆分）——27 端点，与 contracts/fact.mjs 一一对应：
 * factCurveGet/factEntriesGet/factBooksGet/factEntriesImport（拆解条目层）、
 * deduceOpeningGet/deducePresent/deduceSettle/deduceTurn/deduceBranch/deduceArchive/
 * deduceSessionGet/deduceSessionPut/deduceSessionsGet/deduceSessionManage/deduceExport/
 * deducePromote/deducePendingSettle/deduceImage/deduceAssets/deduceAssetFile（推演文游层）、
 * roleplayOpeningGet/roleplayTurn（扮演层）、enrichRun/enrichStatus/enrichGraph（语义增补）、
 * nativePick/nativeReveal（本机文件面，契约归本域）。
 *
 * 统一签名 `async handler(ctx)`：除 enrichStatus（job 即身份，内存 Map，契约只声明
 * NOT_FOUND，不校验 root）、nativePick/nativeReveal（纯对话框/资源管理器，不读库）外，
 * 第一件事 authorizeRoot。
 */
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { API_ERROR_CODES, isPlainObject, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot, resolveInsideRoot } from '../../host/authorize.mjs'
import { listFactBooks, factOffsetOf, factLimitOf, resolveFactBookId } from '../../services/factBooks.mjs'
import { factStore } from '../../kernel/pinaxAdapter.mjs' // OS-125：内核唯一进口（S2.4），本仓其余模块不许直引 core/**
import { deduceOpening as deduceOpeningEngine, deducePresent as deducePresentEngine, deduceSettle as deduceSettleEngine, loadEntries, deduceStatePath } from '../../modules/deduce/deduceEngine.mjs'
import {
  appendNode,
  archiveChapter,
  createDeduceSession,
  DEDUCE_SESSION_SCHEMA,
  deleteDeduceSession,
  importLegacyDeduce,
  listDeduceSessions,
  loadDeduceSession,
  normalizeDeduceSession,
  readActiveSessionId,
  safeDeduceBookId,
  saveDeduceSession,
  writeActiveSessionId
} from '../../modules/deduce/deduceSession.mjs'
import { readLegacyDeduceState, bridgeDeduceCandidates, turnNodeWords, generateTurnProse, buildDeduceLlmPort } from '../../modules/deduce/turnProse.mjs'
import { buildRoleplayMemory, compressMemory, deAiPass, roleplayOpening as roleplayOpeningEngine, roleplayTurn as roleplayTurnEngine, shouldSummarize } from '../../modules/roleplay/roleplayEngine.mjs'
import { enrichBook, enrichGraph as enrichGraphEngine } from '../../services/enrichEngine.mjs'
import { generateViaComfy } from '../../modules/comfyui/comfyEngine.mjs'
import { isModuleEnabled } from '../../protocol/modules.mjs'
import { loadConfigV2, DEFAULT_IMAGE_STYLE, DEFAULT_IMAGE_NEGATIVE, imagesGenerationsUrl } from '../../services/agentConfig.mjs'
import { chatCompleteViaUpstream, resolveChatUpstream, resolveUpstreamSafe } from '../../services/chatUpstream.mjs'
import { runCliChat } from '../../services/cli-bridge.mjs'
import { runDshStdio } from '../../services/dsh-cli.mjs'
import {
  pickFile,
  pickFolder,
  revealPath,
  readBrowseMemory,
  writeBrowseMemory,
  nativeDialogUnusable,
  markNativeDialogUnusable,
  NATIVE_DIALOG_TIMEOUT_MS
} from '../../services/nativePicker.mjs'
import { writeChapterWithBackup } from '../../protocol/chapterWrite.mjs'
import { createChapter } from '../../protocol/chapters.mjs'
import { recordChange } from '../../protocol/changelog.mjs'
import { LOG_MODULES } from '../../protocol/naming.mjs' // OS-148：日志模块名只从命名表取
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'

/* ---------- 分析面板 fact 曲线（KB-ARCH 对齐拆解线算法）---------- */

// 分析面板 fact 曲线：读库内 拆解/ 的 fact+wiki，给章级曲线数据。
// 无拆解数据时返回 ok:true + chapters:[]（前端降级到本地词典近似），绝不报错。
export async function factCurveGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const dir = join(authorized.root, '拆解')
  let files = []
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith('.json')
      && !name.endsWith('.wiki.json') && !name.includes('.operations')
      && name !== '拆解汇总.json' && name !== '拆解索引.json')
  } catch { files = [] }
  const wanted = text(request.bookId).trim()
  const pickPath = wanted
    ? (files.find((name) => name.replace(/\.json$/, '') === wanted) ? join(dir, wanted + '.json') : null)
    : files.map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
      .sort((left, right) => right.mtime - left.mtime)[0]?.path ?? null
  if (!pickPath) {
    return sendJson(res, 200, { ok: true, bookId: '', title: '', words: 0, chapters: [], foreshadows: [], books: files.map((name) => name.replace(/\.json$/, '')) })
  }
  const bookId = basename(pickPath).replace(/\.json$/, '')
  let document = null
  try { document = JSON.parse(readFileSync(pickPath, 'utf8')) } catch { document = null }
  if (!document) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `拆解文件读不了：${bookId}`)
  const { wiki } = factStore.readFactWiki({ root: authorized.root, id: bookId, document })
  // 事件密度：plot 条目按 provenance.chapters 首章归组计数
  const eventsByChapter = new Map()
  for (const entry of document.entries ?? []) {
    if ((entry.layer ?? entry.type) !== 'plot') continue
    const no = Number(entry.provenance?.chapters?.[0] ?? 0)
    if (!no) continue
    eventsByChapter.set(no, (eventsByChapter.get(no) ?? 0) + (entry.events?.length ?? 1))
  }
  const foreshadowsByChapter = new Map()
  for (const f of wiki?.foreshadows ?? []) {
    const no = Number(f.chapter ?? 0)
    if (!no) continue
    foreshadowsByChapter.set(no, (foreshadowsByChapter.get(no) ?? 0) + 1)
  }
  const chapters = (wiki?.chapterSummaries ?? []).map((c) => ({
    no: Number(c.chapter ?? 0),
    title: text(c.title ?? ''),
    summary: text(c.summary ?? '').slice(0, 120),
    function: text(c.function ?? ''),
    emotion: text(c.emotion ?? ''),
    beats: Number(c.beats ?? 0),
    events: eventsByChapter.get(Number(c.chapter ?? 0)) ?? 0,
    foreshadows: foreshadowsByChapter.get(Number(c.chapter ?? 0)) ?? 0
  }))
  // OS-74：伏笔明细透传（埋/收/未收）——前端「伏笔回收」图需要 plantedAt/payoffAt 才能画点，
  // 只有每章计数画不出埋-收连线。字段宽松：老数据没有 plantedAt 就只用 chapter 归章。
  const foreshadowList = (wiki?.foreshadows ?? []).map((f, index) => ({
    id: text(f.id) || `f-${index}`,
    text: text(f.text),
    chapter: Number(f.chapter ?? 0) || null,
    plantedAt: Number.isFinite(Number(f.plantedAt)) ? Number(f.plantedAt) : null,
    payoffAt: Number.isFinite(Number(f.payoffAt)) ? Number(f.payoffAt) : null,
    status: text(f.status) || 'unresolved',
    note: text(f.note)
  }))
  return sendJson(res, 200, {
    ok: true,
    bookId,
    title: text(document.book?.title ?? ''),
    words: Number(document.book?.word_count ?? 0),
    chapters,
    foreshadows: foreshadowList,
    books: files.map((name) => name.replace(/\.json$/, ''))
  })
}

// 故事源条目层（S1）：条目本体＋溯源＋层筛选。数据只经内核 createFactFileStore().list() 读，
// 不在这里 readdir+JSON.parse 绕过内核（FACT-FIRST 规则 1）；过滤与分页全在服务端。
export async function factEntriesGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const books = await listFactBooks(authorized.root)
  const wantedBookId = text(request.bookId).trim()
  let book = null
  if (wantedBookId) {
    book = books.find((item) => item.bookId === wantedBookId) ?? null
    if (!book) return sendError(res, API_ERROR_CODES.NOT_FOUND, `拆解里没有这本书：${wantedBookId}`)
  } else {
    // 缺省书＝mtime 最新的可读一本（坏档不参与兜底，免得兜底到一本永远读不出条目的书）。
    book = books.filter((item) => !item.error).sort((left, right) => right.mtime - left.mtime)[0] ?? null
  }
  // OS-150a：库里还没有可读的拆解书＝合法空态（前端故事源页据此摆引导空态）。
  // 不能落下去拼一个 bookId:'' 的响应——契约要求 bookId 非空，那会把内部校验错误甩给页面。
  if (!book) return sendError(res, API_ERROR_CODES.FACT_EMPTY, '这个库还没有拆解条目')
  const listed = factStore.createFactFileStore({ root: authorized.root }).list({})
  if (!listed.ok) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, listed?.error?.message ?? '拆解数据读不了', listed?.error?.details)
  }
  // 书的身份按文件名算（与 factCurveGet／推演同口径）；条目溯源里 file 是内核透传的原档名，
  // bookId 可能来自档内 book.id 而与文件名不同——两种都对得上才收进这本书。
  const scoped = book
    ? listed.entries.filter((entry) => (entry.sourceFile
      ? text(entry.sourceFile) === book.file
      : text(entry.bookId) === book.bookId))
    : []
  // layers 是「层/q 过滤前」的全量计数（前端层筛选器的数字来源）。
  const layers = {}
  for (const entry of scoped) {
    const key = text(entry.layer).trim()
    if (!key) continue
    layers[key] = (layers[key] ?? 0) + 1
  }
  const layer = text(request.layer).trim()
  const needle = text(request.q).trim().toLowerCase()
  const filtered = scoped.filter((entry) => {
    if (layer && text(entry.layer).trim() !== layer) return false
    if (needle && !text(entry.name).toLowerCase().includes(needle)) return false
    return true
  })
  const offset = factOffsetOf(request.offset)
  const limit = factLimitOf(request.limit)
  const payload = {
    ok: true,
    bookId: book?.bookId ?? '',
    ...(isPlainObject(book?.book) ? { book: book.book } : {}),
    revision: book?.revision ?? 0,
    total: filtered.length,
    entries: filtered.slice(offset, offset + limit),
    layers,
    ...(listed.warnings?.length ? { warnings: listed.warnings } : {})
  }
  const checked = validateResponse('factEntriesGet', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '条目清单响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

export async function factBooksGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const books = await listFactBooks(authorized.root)
  const payload = {
    ok: true,
    books: books.map((item) => ({
      bookId: item.bookId,
      title: item.title,
      revision: item.revision,
      entries: item.entries,
      hasWiki: item.hasWiki,
      ...(item.error ? { error: item.error } : {})
    }))
  }
  const checked = validateResponse('factBooksGet', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '书目清单响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

/* ---------- 推演引擎层（OS-54/61/86/93/96）---------- */

export async function deduceOpeningGet(ctx) {
  // OS-93 开局三件套（照酒馆：选角色卡 → 选世界书 → 选开头）
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const result = deduceOpeningEngine({ root: authorized.root })
  if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
  return sendJson(res, 200, result)
}

export async function deducePresent(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const result = await deducePresentEngine({
    root: authorized.root,
    bookId: await resolveFactBookId(authorized.root, request.bookId),
    pov: text(request.pov),
    seed: Number.isSafeInteger(request.seed) ? request.seed : null,
    reset: request.reset === true,
    peek: request.peek === true,
    // OS-93：选中的开头（剧情骨架段 definition）——戏剧候选围绕它锚定
    seedPrompt: text(request.seedPrompt),
    // OS-96：扮演底座按章节筛世界书（写到30章的库不给31章以后的知识）
    chapterLimit: Number.isFinite(Number(request.chapterLimit)) && Number(request.chapterLimit) > 0 ? Number(request.chapterLimit) : null,
    sessionId: text(request.sessionId).trim() || readActiveSessionId(authorized.root, await resolveFactBookId(authorized.root, request.bookId)),
    // OS-82：戏剧候选接全局文本模型（没配模型＝null，必然/命运照常）
    llmPort: await buildDeduceLlmPort({ context })
  })
  // peek 且无会话：不是错误——前端维持空态
  if (!result.ok && result.code === 'NO_DEDUCE_SESSION') return sendJson(res, 200, { ok: false, code: 'NO_DEDUCE_SESSION', message: result.message })
  if (!result.ok) return sendError(res, result.code === 'WORLD_EMPTY' ? API_ERROR_CODES.INVALID_ENTRY : (result.code ?? API_ERROR_CODES.INVALID_ENTRY), result.message)
  return sendJson(res, 200, result)
}

export async function deduceSettle(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const result = await deduceSettleEngine({
    root: authorized.root,
    bookId: await resolveFactBookId(authorized.root, request.bookId),
    candidateId: text(request.candidateId),
    action: text(request.action || 'choose'),
    note: text(request.note),
    sessionId: text(request.sessionId).trim() || readActiveSessionId(authorized.root, await resolveFactBookId(authorized.root, request.bookId))
  })
  if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
  return sendJson(res, 200, result)
}

/* 推演会话存储层（OS-61）：「文游」容器——读/整存会话、归档一章。 */

export async function deduceSessionGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = await resolveFactBookId(authorized.root, request.bookId)
  // OS-86：sessionId 缺省＝激活指针（回落主线）——前端不用管「现在在哪局」
  const wanted = text(request.sessionId).trim()
  const sid = wanted || readActiveSessionId(authorized.root, bookId)
  let session = loadDeduceSession(authorized.root, bookId, sid)
  // 自动桥接（OS-62）：新层还没有节点、但旧引擎层推过拍 → 把最后一面导入成首节点。
  // 老库升级后剧情树不再空白；旧档不动，重复读幂等。只桥主线——多局是 OS-86 之后的产物。
  if ((!session || !(session.nodes || []).length) && (sid === 'main' || !wanted)) {
    const legacy = readLegacyDeduceState(authorized.root, bookId)
    if (legacy) {
      const merged = importLegacyDeduce({ legacyState: legacy, session, bookId })
      if (merged.ok && merged.imported) {
        const saved = await saveDeduceSession(authorized.root, bookId, merged.session)
        session = saved.ok ? merged.session : merged.session
      } else if (merged.ok) {
        session = merged.session
      }
    }
  }
  return sendJson(res, 200, { ok: true, session, activeId: sid })
}

export async function deduceSessionPut(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = await resolveFactBookId(authorized.root, request.bookId)
  // OS-86：sessionId 随会话对象走（main＝legacy 路径，其余 sessions/<sid>.json）
  const session = normalizeDeduceSession(request.session, bookId, text(request.session?.sessionId))
  if (!session) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `推演会话形状不对：schema 必须是 ${DEDUCE_SESSION_SCHEMA}，nodes 必须是数组`)
  }
  const saved = await saveDeduceSession(authorized.root, bookId, session)
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
  return sendJson(res, 200, { ok: true, session, ...(saved.backup ? { backup: saved.backup } : {}) })
}

export async function deduceSessionsGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = await resolveFactBookId(authorized.root, request.bookId)
  // OS-86 多局并存：主线（legacy）＋ sessions/ 全部＋激活指针。列表轻量读全文取 meta。
  const listed = listDeduceSessions(authorized.root, bookId)
  return sendJson(res, 200, { ok: true, bookId, ...listed })
}

export async function deduceSessionManage(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = await resolveFactBookId(authorized.root, request.bookId)
  // OS-86 多局管理：new＝新建空局并激活；switch＝激活已有局；delete＝非破坏删除（挪 .deleted）。
  // 最后一局不能删（推演页不能开天窗，清空走「重新开局」）。
  const action = text(request.action || '').trim()
  if (action === 'new') {
    const created = await createDeduceSession(authorized.root, bookId, { title: text(request.title) })
    if (!created.ok) return sendError(res, created.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, created.message ?? '新局创建失败')
    const listed = listDeduceSessions(authorized.root, bookId)
    return sendJson(res, 200, { ok: true, action: 'new', sessionId: created.sessionId, session: created.session, ...listed })
  }
  const sid = text(request.sessionId).trim()
  if (action === 'switch') {
    if (!sid) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'sessionId 必填')
    const session = loadDeduceSession(authorized.root, bookId, sid)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${sid}`)
    const active = await writeActiveSessionId(authorized.root, bookId, sid)
    if (!active.ok) return sendError(res, active.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, active.message)
    return sendJson(res, 200, { ok: true, action: 'switch', sessionId: sid, session })
  }
  if (action === 'delete') {
    if (!sid) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'sessionId 必填')
    const removed = await deleteDeduceSession(authorized.root, bookId, sid)
    if (!removed.ok) return sendError(res, removed.code ?? API_ERROR_CODES.INVALID_ENTRY, removed.message)
    const listed = listDeduceSessions(authorized.root, bookId)
    const session = loadDeduceSession(authorized.root, bookId, listed.activeId)
    return sendJson(res, 200, { ok: true, action: 'delete', sessionId: sid, session, ...listed })
  }
  return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'action 只认 new / switch / delete')
}

export async function deduceArchive(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = await resolveFactBookId(authorized.root, request.bookId)
  const sid = text(request.sessionId).trim() || readActiveSessionId(authorized.root, bookId)
  const session = loadDeduceSession(authorized.root, bookId, sid)
  if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
  const archived = await archiveChapter(authorized.root, session, { title: text(request.title) })
  if (!archived.ok) return sendError(res, archived.code ?? API_ERROR_CODES.INVALID_ENTRY, archived.message)
  return sendJson(res, 200, { ok: true, path: archived.path, words: archived.words })
}

/* 推演回合层（OS-61 P2）：选候选/自定义 → 结算 → 成文草稿 → 拍进会话缓存区。
 * regenerate:true 只重写最后一拍的正文（覆盖 node.prose），不结算、不新增节点。 */
export async function deduceTurn(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = await resolveFactBookId(root, request.bookId)
  // OS-86：局跟 sessionId 走——引擎状态（候选桥接/结算）与会话存储必须同一局
  const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
  const customText = text(request.customText).trim()
  const choiceId = text(request.choiceId).trim()
  const session = loadDeduceSession(root, bookId, sid)
    ?? normalizeDeduceSession({ schema: DEDUCE_SESSION_SCHEMA, nodes: [] }, bookId, sid)
  const branchId = session.branchId || 'main'
  const branchNodes = session.nodes.filter((node) => (text(node?.branchId) || 'main') === branchId)

  if (request.regenerate === true) {
    const last = branchNodes[branchNodes.length - 1]
    if (!last) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '还没有可重写的拍：先选一条候选或自己写一拍')
    const previous = branchNodes[branchNodes.length - 2]
    const gen = await generateTurnProse({ context, root, node: last, previousProse: previous?.prose })
    // 模型不可用时不毁旧稿：prose 保持原样，proseError 如实报
    if (gen.prose) {
      last.prose = gen.prose
      const buffered = (session.buffer?.nodes ?? []).find((node) => node.id === last.id)
      if (buffered) buffered.prose = gen.prose
      if (session.buffer) session.buffer.words = (session.buffer.nodes ?? []).reduce((sum, node) => sum + turnNodeWords(node), 0)
    }
    const saved = await saveDeduceSession(root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, node: last, session, prose: text(last.prose), ...(gen.proseError ? { proseError: gen.proseError } : {}) })
  }

  if (!customText && !choiceId) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '选一条候选（choiceId）或自己写（customText）再结算')
  }
  let settled
  if (customText) {
    settled = await deduceSettleEngine({ root, bookId, action: 'inject', note: customText, sessionId: sid })
  } else {
    const bridged = await bridgeDeduceCandidates(root, bookId, sid)
    if (!bridged.ok) return sendError(res, bridged.code ?? API_ERROR_CODES.INVALID_ENTRY, bridged.message)
    settled = await deduceSettleEngine({ root, bookId, candidateId: choiceId, action: 'choose', sessionId: sid })
  }
  if (!settled.ok) return sendError(res, settled.code ?? API_ERROR_CODES.INVALID_ENTRY, settled.message)
  // OS-82 回填闭环：结算产出的 fact 条目不自动落库——挂会话 pending 队列（待确认卡），
  // 作者点「写入拆解」才走 writeFactFile 单条 upsert；点「忽略」只出队。
  const settledEntry = settled.result?.entry ?? null

  // 局面与候选取自引擎最后一面（present 存的 lastTurn）；自定义拍补一条「作者」候选
  let lastTurn = null
  try { lastTurn = JSON.parse(readFileSync(deduceStatePath(root, bookId, sid), 'utf-8')).lastTurn ?? null } catch { lastTurn = null }
  const sceneCard = lastTurn?.sceneCard ?? {}
  const candidates = (Array.isArray(lastTurn?.candidates) ? lastTurn.candidates : [])
    .map((candidate) => ({ id: text(candidate?.id), source: text(candidate?.source), text: text(candidate?.text) }))
  if (customText) candidates.push({ id: 'custom', source: '作者', text: customText })
  const draft = {
    round: settled.round,
    choiceId: customText ? 'custom' : choiceId,
    scene: {
      who: Array.isArray(sceneCard.who) ? sceneCard.who.filter(Boolean).join('、') : text(sceneCard.who),
      where: text(sceneCard.where),
      tension: text(sceneCard.tension),
      hook: text(sceneCard.hook)
    },
    candidates,
    prose: ''
  }
  const previous = branchNodes[branchNodes.length - 1]
  // 剧情树父链（OS-61 P3）：接本分支上一拍；新分支第一拍没有上一拍＝溯源到分叉节点
  let parentId = text(previous?.id)
  if (!parentId && branchId !== 'main') {
    const fork = session.nodes.find((node) => Array.isArray(node?.forkBranchIds) && node.forkBranchIds.includes(branchId))
    parentId = text(fork?.id)
  }
  draft.parentId = parentId
  const gen = await generateTurnProse({ context, root, node: draft, previousProse: previous?.prose })
  draft.prose = gen.prose
  const node = appendNode(session, draft)
  if (settledEntry) {
    session.pending = Array.isArray(session.pending) ? session.pending : []
    session.pending.push({
      id: `pd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      nodeId: text(node.id),
      round: Number(settled.round) || 0,
      decidedBy: text(settledEntry.provenance?.decidedBy),
      entry: settledEntry,
      addedAt: new Date().toISOString()
    })
  }
  const saved = await saveDeduceSession(root, bookId, session)
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
  return sendJson(res, 200, { ok: true, node, session, prose: node.prose, ...(gen.proseError ? { proseError: gen.proseError } : {}) })
}

/* ---------- 扮演层（OS-96/97/100/102）---------- */

export async function roleplayOpeningGet(ctx) {
  // OS-100 扮演开场：主持人替世界拉开第一幕（时间/地点/在场/第一眼）＋三条初始分支。
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = await resolveFactBookId(root, request.bookId)
  const loaded = loadEntries(root)
  if (!loaded.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, loaded.message)
  // OS-107 修：空事实包不能开局——扮演底座必须有世界书/拆解条目，否则模型凭空编造
  if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这个库还没有事实包（拆解条目/世界书词条）——先补世界书或跑 enrich，再开始扮演')
  }
  const chapterLimit = Number.isFinite(Number(request.chapterLimit)) && Number(request.chapterLimit) > 0 ? Number(request.chapterLimit) : null
  const entries = chapterLimit == null
    ? loaded.entries
    : loaded.entries.filter((entry) => {
        const fc = Number(entry?.firstChapter)
        if (Number.isFinite(fc) && fc >= 0) return fc <= chapterLimit
        const chapters = Array.isArray(entry?.chapters) ? entry.chapters.filter(Number.isInteger) : []
        return chapters.length ? Math.min(...chapters) <= chapterLimit : true
      })
  const cast = entries
    .filter((entry) => text(entry?.layer).toLowerCase() === 'character')
    .map((entry) => ({
      name: text(entry?.name).trim(),
      identity: text(entry?.identity) || text(entry?.definition),
      archetype: text(entry?.archetype)
    }))
    .filter((c) => c.name)
  const pov = text(request.pov).trim()
  if (!pov) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '先选你要扮演谁（pov）')
  const upstream = await resolveUpstreamSafe({ context })
  const chatComplete = async (prompt, opts = {}) => {
    const out = await chatCompleteViaUpstream({ upstream, system: prompt, maxTokens: opts.maxTokens ?? 700, temperature: 0.9, cwd: root })
    if (out.error) throw new Error(out.error)
    return out.text ?? ''
  }
  const result = await roleplayOpeningEngine({
    chatComplete,
    entries,
    premise: text(request.premise),
    cast,
    pov,
    openingDetail: text(request.openingDetail),
    chapterLimit
  })
  if (!result.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, result.error ?? '开场没有产出')
  // OS-102：开场也过 AI 味闸（超阈重写一次；只换文风不动事实）
  // OS-144：分析模块停用＝宿主钩子判定后跳过本闸（不留下「模块停了还被调用」的旁路）
  const gated = await deAiPass({ chatComplete, prose: result.feedback, enabled: await isModuleEnabled(root, 'analysis') })
  return sendJson(res, 200, {
    ok: true,
    feedback: gated.text,
    options: result.options ?? [],
    ...(gated.rewritten ? { deAiSmell: gated.before?.score ?? null } : {})
  })
}

export async function roleplayTurn(ctx) {
  // OS-97 扮演一回合：主持人裁决 → N 角色各自成文 → 主持人收束（对「你」说话）。
  // 世界书按 chapterLimit 过滤（OS-96）；玩家可以扮演任意角色或「主持人」。
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = await resolveFactBookId(root, request.bookId)
  const loaded = loadEntries(root)
  if (!loaded.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, loaded.message)
  // OS-107 修：空事实包不能演——与开场同口径
  if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这个库还没有事实包——扮演需要世界书/拆解条目作底座')
  }
  // 世界书按章过滤（OS-96）：chapterLimit 给了＝晚于该章成立的词条不存在
  const chapterLimit = Number.isFinite(Number(request.chapterLimit)) && Number(request.chapterLimit) > 0 ? Number(request.chapterLimit) : null
  const entries = chapterLimit == null
    ? loaded.entries
    : loaded.entries.filter((entry) => {
        const fc = Number(entry?.firstChapter)
        if (Number.isFinite(fc) && fc >= 0) return fc <= chapterLimit
        const chapters = Array.isArray(entry?.chapters) ? entry.chapters.filter(Number.isInteger) : []
        return chapters.length ? Math.min(...chapters) <= chapterLimit : true
      })
  const cast = entries
    .filter((entry) => text(entry?.layer).toLowerCase() === 'character')
    .map((entry) => ({
      name: text(entry?.name).trim(),
      identity: text(entry?.identity) || text(entry?.definition),
      archetype: text(entry?.archetype),
      personality: Array.isArray(entry?.personality) ? entry.personality.filter(Boolean).slice(0, 5) : []
    }))
    .filter((c) => c.name)
  const pov = text(request.pov).trim()
  const playerAction = text(request.playerAction).trim() || text(request.customText).trim()
  if (!pov) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '先选你要扮演谁（pov）')
  if (!playerAction) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这一幕你做什么/说什么（playerAction）必填')
  // 最近几拍摘要（会话层复用 deduceSession——扮演与推演共用容器）
  const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
  const session = loadDeduceSession(root, bookId, sid)
  // OS-102 长期记忆：滚动摘要（长期）＋最近几拍明细（短期）——跑长了 agent 不会忘前情
  const mem = buildRoleplayMemory(session, { recentLimit: 3 })
  const recent = [mem.summaryText, mem.recentText].filter(Boolean).join('\n\n')
  const upstream = await resolveUpstreamSafe({ context })
  const chatComplete = async (prompt, opts = {}) => {
    const out = await chatCompleteViaUpstream({ upstream, system: prompt, maxTokens: opts.maxTokens ?? 600, temperature: 0.85, cwd: root })
    if (out.error) throw new Error(out.error)
    return out.text ?? ''
  }
  const result = await roleplayTurnEngine({
    chatComplete,
    entries,
    premise: text(request.premise),
    cast,
    playerAction,
    pov,
    recent,
    activation: text(request.activation) || 'mention',
    chapterLimit
  })
  if (!result.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, result.error ?? '本幕没有产出')
  // OS-102：世界反馈落稿前过 AI 味闸（角色演绎 beats 保持原样——那是演员的口吻）
  // OS-144：分析模块停用＝跳过本闸（启用态行为与改前逐字节一致）
  const gated = await deAiPass({ chatComplete, prose: result.feedback, enabled: await isModuleEnabled(root, 'analysis') })
  result.feedback = gated.text
  // 会话落一行节点（复用 deduceSession 容器；kind 标 roleplay）
  const draft = {
    round: (Number(session?.cursor) || 0) + 1,
    choiceId: 'custom',
    scene: { who: result.beats.map((b) => b.name).join('、'), where: '', tension: '', hook: '' },
    candidates: [{ id: 'custom', source: '作者', text: playerAction }],
    prose: result.feedback
  }
  draft.beats = result.beats
  let savedSession = session
  let savedNode = undefined
  let sessionSaveError = ''
  if (savedSession) {
    const node = appendNode(savedSession, draft)
    const saved = await saveDeduceSession(root, bookId, savedSession)
    if (!saved.ok) { /* 会话写失败不吞本幕结果——如实带回 */ savedSession = null; sessionSaveError = saved.message }
    else savedNode = node
  }
  // OS-102：回合完成后检查是否该压缩记忆——异步跑，不拖慢响应；失败静默（下次再压）
  if (session && shouldSummarize(session, { every: 6 })) {
    ;(async () => {
      try {
        const fresh = loadDeduceSession(root, bookId, sid)
        if (!fresh) return
        const compressed = await compressMemory({ chatComplete, session: fresh, batch: 6 })
        if (!compressed.ok) return
        fresh.rollingSummary = compressed.rollingSummary
        await saveDeduceSession(root, bookId, fresh)
      } catch { /* 压缩失败不影响扮演 */ }
    })()
  }
  return sendJson(res, 200, {
    ok: true,
    beats: result.beats,
    feedback: result.feedback,
    options: result.options ?? [],
    ...(savedNode ? { node: savedNode } : {}),
    ...(sessionSaveError ? { sessionError: sessionSaveError } : {})
  })
}

/* ---------- 推演导出 / 转正 / 待确认卡落库（OS-94/OS-82）---------- */

export async function deduceExport(ctx) {
  // OS-94：推演导出——整个会话（每拍的决定＋正文＋归档清单）出 markdown，
  // 落 推演/<bookId>/导出/会话-<bookId>-<sid>-<ts>.md。读侧动作，不改会话。
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = await resolveFactBookId(root, request.bookId)
  const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
  const session = loadDeduceSession(root, bookId, sid)
  if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
  const nodes = Array.isArray(session.nodes) ? session.nodes : []
  const lines = [`# 推演会话 · ${text(session.title)}`, '']
  lines.push(`> 导出于 ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · ${bookId} · 局「${text(session.title)}」（${sid}） · 共 ${nodes.length} 拍`, '')
  for (const node of nodes) {
    const chosen = (Array.isArray(node.candidates) ? node.candidates : []).find((c) => text(c.id) === text(node.choiceId))
    lines.push(`## 第${Number(node?.round) || 0}拍`, '')
    if (chosen && text(chosen.text)) lines.push(`> **你的决定**：${text(chosen.text)}`, '')
    const prose = text(node.prose).trim()
    lines.push(prose || '（本拍没有正文）', '')
  }
  if (Array.isArray(session.archived) && session.archived.length) {
    lines.push('## 已归档章节', '', ...session.archived.map((a) => `- ${text(a.path)}（${Number(a.words) || 0} 字）`), '')
  }
  const exportDir = join(root, '推演', safeDeduceBookId(bookId), '导出')
  await mkdir(exportDir, { recursive: true })
  const fileName = `会话-${safeDeduceBookId(bookId)}-${sid}-${Date.now().toString(36)}.md`
  const outPath = join(exportDir, fileName)
  await writeFile(outPath, lines.join('\n'), 'utf-8')
  return sendJson(res, 200, { ok: true, path: `推演/${safeDeduceBookId(bookId)}/导出/${fileName}`, words: lines.join('\n').length })
}

export async function deducePromote(ctx) {
  // OS-94：转正——把一拍的正文写进 正文/ 成正式章节（createChapter 自动下一章号＋
  // writeChapterWithBackup 备份通道）。prose 为空＝拒绝（先重写或自己写完）。
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = await resolveFactBookId(root, request.bookId)
  const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
  const session = loadDeduceSession(root, bookId, sid)
  if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
  const nodeId = text(request.nodeId).trim()
  const node = (Array.isArray(session.nodes) ? session.nodes : []).find((n) => text(n?.id) === nodeId)
  if (!node) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话里没有这一拍：${nodeId}`)
  const prose = text(node.prose).trim()
  if (!prose) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这一拍还没有正文——先「重写」出稿或自己写完，再转正')
  const created = await createChapter(root, '正文', text(request.title).trim() || `推演第${Number(node.round) || 0}拍`)
  if (!created.ok) return sendError(res, created.code ?? API_ERROR_CODES.INVALID_ENTRY, created.message ?? '章节创建失败')
  const written = await writeChapterWithBackup(root, created.chapter.file, prose)
  if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, written.message ?? '章节写入失败')
  return sendJson(res, 200, { ok: true, file: created.chapter.file, chapter: created.chapter, chars: prose.length })
}

export async function deducePendingSettle(ctx) {
  // OS-82 回填闭环：待确认卡落库（write）/丢弃（dismiss）。写走内核 writeFactFile 的
  // 单条 upsert（entry 形态：按 id 命中替换、没有就追加）——推演一拍只进一条事件，
  // 绝不动拆解文件里其他条目（与 factEntriesImport 的整份替换是两回事）。
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = await resolveFactBookId(root, request.bookId)
  const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
  const pendingId = text(request.pendingId).trim()
  const action = text(request.action || 'write')
  if (!pendingId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'pendingId 必填')
  const session = loadDeduceSession(root, bookId, sid)
  if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, '这个库还没有推演会话')
  const index = (Array.isArray(session.pending) ? session.pending : []).findIndex((item) => text(item?.id) === pendingId)
  if (index < 0) return sendError(res, API_ERROR_CODES.NOT_FOUND, '这条待确认卡已不存在（可能已写入或已忽略）——刷新会话即可')
  const item = session.pending[index]
  if (action === 'dismiss') {
    session.pending.splice(index, 1)
    const saved = await saveDeduceSession(root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, action: 'dismiss', session })
  }
  if (action !== 'write' || !item.entry || typeof item.entry !== 'object') {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'action 只认 write/dismiss，卡上要有结算产出的条目')
  }
  // 写前重读 revision 走乐观并发（与 factEntriesImport 同口径），避免覆盖别人刚写的拆解
  let expectedRevision = null
  let beforeFactRaw = '' // OS-107：写前原文（写后就读不到旧内容了）——变更日志的 diff 靠它
  try {
    const factPath = join(root, '拆解', `${bookId}.json`)
    if (existsSync(factPath)) {
      beforeFactRaw = await readFile(factPath, 'utf-8')
      const existing = JSON.parse(beforeFactRaw)
      const rev = Number(existing?.revision)
      if (Number.isSafeInteger(rev) && rev >= 1) expectedRevision = rev
    }
  } catch { /* 读不到就当新建 */ }
  const entryExisted = beforeFactRaw !== ''
  const written = await factStore.writeFactFile({
    root,
    bookId,
    entry: item.entry,
    operationId: `deduce-backfill-${pendingId}`,
    ...(expectedRevision !== null ? { expectedRevision } : {})
  })
  if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, written.message ?? '写入拆解失败', written.details)
  // OS-107：fact 落盘即留痕（AGENTS.md 第 10 条）。失败分支已提前 return，这里是最窄的
  // 「写成功即记」点；日志写失败不阻断主写入，但要如实回传给调用方。
  let factLogError = ''
  try {
    const factRel = `拆解/${bookId}.json`
    const afterFactRaw = await readFile(join(root, '拆解', `${bookId}.json`), 'utf-8')
    const logged = await recordChange({
      root,
      module: LOG_MODULES.storysource,
      file: factRel,
      op: entryExisted ? 'update' : 'create',
      before: beforeFactRaw,
      after: afterFactRaw,
      actor: 'agent',
      meta: {
        pendingId,
        bookId,
        entryId: text(item.entry.id),
        operationId: `deduce-backfill-${pendingId}`,
        ...(Number(written.revision) ? { revision: Number(written.revision) } : {})
      }
    })
    if (logged.ok === false) factLogError = logged.message
  } catch (error) {
    factLogError = `读回拆解档失败：${text(error?.message || error)}`
  }
  session.pending.splice(index, 1)
  const saved = await saveDeduceSession(root, bookId, session)
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
  return sendJson(res, 200, {
    ok: true,
    action: 'write',
    session,
    ...(Number(written.revision) ? { revision: Number(written.revision) } : {}),
    ...(factLogError ? { logError: factLogError } : {})
  })
}

export async function deduceImage(ctx) {
  // 生图（OS-63 预留转正）：调全局配置的 image 块（OpenAI 兼容 images/generations），
  // 产物落 推演/<bookId>/素材/场景/<name>.png。没开开关/没填端点＝如实报，不假装生成。
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const { config } = await loadConfigV2(context.agentConfigPath)
  const image = config.image
  if (!image.enabled) {
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '生图没启用——设置 · 模型 · 生图里打开开关并填 OpenAI 兼容 images API 的地址与模型后可用')
  }
  const name = text(request.name).trim().slice(0, 40)
  const prompt = text(request.prompt).trim()
  if (!name || !prompt) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'name 与 prompt 必填')
  if (/[\/]|\.\./u.test(name)) return sendError(res, API_ERROR_CODES.PATH_ESCAPE, 'name 不能含路径分隔符')
  const size = text(request.size).trim() || '1024x1024'
  // OS-74：双后端——openai（同步 images/generations）或 comfyui（提交→轮询→取图）
  let b64 = ''
  if (image.backend === 'comfyui') {
    if (!text(image.comfyUrl).trim()) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置 ComfyUI 地址——设置 · 模型 · 生图里切到 ComfyUI 并填端口')
    }
    // 风格提示词优先级：请求覆盖 > 设置里的 stylePrompt > 内置默认「2D彩漫风格」
    const stylePrefix = text(request.stylePrompt).trim() || text(image.stylePrompt).trim() || DEFAULT_IMAGE_STYLE
    const comfy = await generateViaComfy({
      comfyUrl: image.comfyUrl,
      workflowPath: image.comfyWorkflow,
      root: authorized.root,
      nodeMap: image.comfyNodeMap,
      prompt: `${stylePrefix}，${prompt}。无文字。`,
      negative: text(request.negative).trim() || DEFAULT_IMAGE_NEGATIVE,
      size
    })
    if (!comfy.ok) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `ComfyUI 生图失败：${comfy.error}`)
    b64 = comfy.b64
  } else {
    if (!image.endpoint) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置生图端点——设置 · 模型 · 生图里填 OpenAI 兼容 images API 的地址与模型后可用')
    }
    const stylePrefix = text(request.stylePrompt).trim() || text(image.stylePrompt).trim() || DEFAULT_IMAGE_STYLE
    const body = JSON.stringify({ model: text(image.model), prompt: `${stylePrefix}，${prompt}。无文字。`, size, n: 1, response_format: 'b64_json' })
    let payload = null
    try {
      const response = await fetch(imagesGenerationsUrl(image.endpoint), {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(image.apiKey ? { authorization: `Bearer ${image.apiKey}` } : {}) },
        body, signal: AbortSignal.timeout(300_000)
      })
      if (!response.ok) throw new Error(`HTTP ${response.status} · ${(await response.text()).slice(0, 200)}`)
      payload = await response.json()
    } catch (error) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `生图端点失败：${text(error?.message || error)}`)
    }
    b64 = payload?.data?.[0]?.b64_json
    if (!b64) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '生图端点没有返回图片数据（b64_json 为空）')
  }
  const dir = join(authorized.root, '推演', safeDeduceBookId(bookId), '素材', '场景')
  await mkdir(dir, { recursive: true })
  const path = join(dir, `${name}.png`)
  await atomicWriteFile(path, Buffer.from(b64, 'base64')) // 二进制走 hostWrite 二进制分支
  return sendJson(res, 200, { ok: true, name, path: `推演/${safeDeduceBookId(bookId)}/素材/场景/${name}.png`, size })
}

/* 剧情树分支（OS-61 P3）：从某一拍开新分支。只动 branchId/cursor 与分叉溯源，
 * nodes 全量保留；缓存区沿用 switchBranch 语义不动（归档仍按缓存区里的拍走）。 */
export async function deduceBranch(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = await resolveFactBookId(root, request.bookId)
  const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
  const fromNodeId = text(request.fromNodeId).trim()
  if (!fromNodeId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '指明从哪一拍开分支（fromNodeId）')
  const session = loadDeduceSession(root, bookId, sid)
  if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
  const fromNode = session.nodes.find((node) => text(node?.id) === fromNodeId)
  if (!fromNode) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话里没有这一拍：${fromNodeId}`)
  const existing = new Set(session.nodes.map((node) => text(node?.branchId).trim() || 'main'))
  existing.add(text(session.branchId).trim() || 'main')
  let seq = 2
  while (existing.has(`branch-${seq}`)) seq += 1
  const branchId = `branch-${seq}`
  // 分叉溯源记在节点上（会话归一层只认固定顶层字段，节点原样透传）
  if (!Array.isArray(fromNode.forkBranchIds)) fromNode.forkBranchIds = []
  if (!fromNode.forkBranchIds.includes(branchId)) fromNode.forkBranchIds.push(branchId)
  session.branchId = branchId
  session.cursor = Number.isSafeInteger(Number(fromNode.round)) ? Number(fromNode.round) : 0
  const saved = await saveDeduceSession(root, bookId, session)
  if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
  return sendJson(res, 200, { ok: true, session })
}

/* ---------- 文游素材（OS-61 P4）：立绘/BGM 占位骨架 ----------
 * 素材绑定约定（全部可选，缺失时前端用渐变占位块，不同 kind 不同色）：
 *   推演/<bookId>/素材/角色/<角色名>.png   —— 人物立绘/头像（按局面卡 who 匹配）
 *   推演/<bookId>/素材/场景/<场景名>.png   —— 场景立绘（按局面卡 where 匹配）
 *   推演/<bookId>/素材/bgm/<场景或情绪>.mp3 —— 背景乐（按场景名或张力情绪匹配）
 * 素材到位后无需改代码：盘点端点现扫目录，前端按名字对上就换真图。 */

/** 素材单文件上限：立绘/BGM 都是本机小文件，16MB 足够且防误挂大档。 */
const DEDUCE_ASSET_MAX = 16 * 1024 * 1024

/** 素材三类目录 → 响应字段与扩展名。 */
const DEDUCE_ASSET_KINDS = Object.freeze([
  { dir: '角色', field: 'characters', ext: '.png' },
  { dir: '场景', field: 'scenes', ext: '.png' },
  { dir: 'bgm', field: 'bgm', ext: '.mp3' }
])

/** 盘点 推演/<bookId>/素材/：目录不存在＝空数组；隐藏文件/子目录/异扩展名跳过。 */
async function listDeduceAssets(root, bookId) {
  const base = resolveInsideRoot(root, `推演/${bookId}/素材`)
  if (!base.ok) return base
  const result = { ok: true, characters: [], scenes: [], bgm: [] }
  for (const kind of DEDUCE_ASSET_KINDS) {
    let entries = []
    try {
      entries = await readdir(join(base.path, kind.dir), { withFileTypes: true })
    } catch {
      continue
    }
    result[kind.field] = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && extname(entry.name).toLowerCase() === kind.ext)
      .map((entry) => ({
        name: entry.name.slice(0, -kind.ext.length),
        path: `推演/${bookId}/素材/${kind.dir}/${entry.name}`
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
  }
  return result
}

export async function deduceAssets(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = await resolveFactBookId(authorized.root, request.bookId)
  const listed = await listDeduceAssets(authorized.root, bookId)
  if (!listed.ok) return sendError(res, listed.code, listed.message)
  return sendJson(res, 200, { ok: true, bookId, characters: listed.characters, scenes: listed.scenes, bgm: listed.bgm })
}

export async function deduceAssetFile(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = await resolveFactBookId(authorized.root, request.bookId)
  // 盘符注入闸：相对路径段里混进 `C:` 这类盘符会在 Windows 上改指向，直接按逃逸拒收
  if (text(request.path).includes(':')) {
    return sendError(res, API_ERROR_CODES.PATH_ESCAPE, `素材路径不许带盘符：${text(request.path)}`)
  }
  const resolved = resolveInsideRoot(authorized.root, `推演/${bookId}/素材/${text(request.path)}`)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  const ext = extname(resolved.path).toLowerCase()
  if (ext !== '.png' && ext !== '.mp3') {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `素材只收 .png（立绘）与 .mp3（BGM）：${text(request.path)}`)
  }
  let stats
  try {
    stats = statSync(resolved.path)
  } catch {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `素材不存在：${text(request.path)}`)
  }
  if (!stats.isFile() || stats.size > DEDUCE_ASSET_MAX) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `素材不是文件或超过 16MB：${text(request.path)}`)
  }
  res.writeHead(200, {
    'content-type': ext === '.png' ? 'image/png' : 'audio/mpeg',
    'content-length': stats.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  createReadStream(resolved.path).pipe(res)
  return
}

/* ---------- 本机文件面（契约归本域）：原生选择器／资源管理器 ---------- */

export async function nativePick(ctx) {
  const { res, request, context } = ctx
  // OS-108：原生选择器——浏览器拿不到绝对路径，由 daemon 弹 Windows 原生对话框。
  // kind: 'folder'（默认）/ 'file'；取消＝ok:false + CANCELLED（前端静默处理）。
  // 不读库、不写盘，纯对话框；非 Windows 如实报 UNSUPPORTED_PLATFORM。
  const kind = text(request.kind || 'folder').trim()
  const title = text(request.title).trim() || (kind === 'file' ? '选择文件' : '选择文件夹')
  const initialDir = text(request.initialDir).trim()
  // OS-118/119：本机上次已判定弹不出原生框——立刻降级，不让前端白等探测超时。
  // 判定落在 fs-browse.json（跨 daemon 重启复用）：删掉那行 nativeDialog 即可重试。
  if (nativeDialogUnusable(context.env)) {
    markNativeDialogUnusable()
    return sendJson(res, 400, { ok: false, error: { code: 'NO_DESKTOP', message: '服务进程没有交互桌面，显示内建浏览器' } })
  }
  const result = kind === 'file'
    ? await pickFile({ title, initialDir, filter: text(request.filter).trim() || undefined, timeoutMs: NATIVE_DIALOG_TIMEOUT_MS })
    : await pickFolder({ title, initialDir, timeoutMs: NATIVE_DIALOG_TIMEOUT_MS })
  if (!result.ok) {
    // 取消不是错误：200 + ok:false + code，前端据此静默
    if (result.code === 'CANCELLED') return sendJson(res, 200, { ok: false, code: 'CANCELLED', message: '已取消' })
    // NO_DESKTOP：服务进程没有交互桌面（被后台/子进程启动）——400 并把 code 透传，
    // 前端据此提示「请手动启动 daemon 或手填路径」，而不是当成服务器故障
    if (result.code === 'NO_DESKTOP') {
      // 记住：本进程＋本机后续请求直接降级，不再等超时
      markNativeDialogUnusable()
      writeBrowseMemory({ nativeDialog: 'NO_DESKTOP' }, context.env)
      return sendJson(res, 400, { ok: false, error: { code: 'NO_DESKTOP', message: result.message } })
    }
    return sendError(res, result.code === 'UNSUPPORTED_PLATFORM' ? API_ERROR_CODES.INVALID_ENTRY : API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, result.message)
  }
  // 真弹出了（说明有桌面）→ 清掉「弹不出」的记忆，下次 daemon 重启也照样走原生框
  if (readBrowseMemory(context.env).nativeDialog) writeBrowseMemory({ nativeDialog: '' }, context.env)
  return sendJson(res, 200, { ok: true, path: result.path })
}

export async function nativeReveal(ctx) {
  const { res, request } = ctx
  // OS-109：在资源管理器里打开路径（文件夹＝打开；文件＝选中）。路径不存在如实报。
  const p = text(request.path).trim()
  if (!p) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'path 必填')
  const result = await revealPath(p)
  if (!result.ok) {
    const code = result.code === 'NOT_FOUND' ? API_ERROR_CODES.NOT_FOUND : API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED
    return sendError(res, code, result.message)
  }
  return sendJson(res, 200, { ok: true })
}

/* ---------- 拆解整包导入（OS-78/OS-135 修）---------- */

export async function factEntriesImport(ctx) {
  // OS-78：剧本/外部数据 → 拆解条目。走内核 writeFactFile 的唯一写入口
  // （原子写 + revision 自增 + operationId 幂等 + 写前重读复核）。
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = text(request.bookId).trim()
  if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
  const entries = Array.isArray(request.entries) ? request.entries : null
  if (!entries || !entries.length) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'entries 必须是非空数组')
  // operationId：调用方没给就由 daemon 生成（来源前缀 + bookId + 时间），满足内核幂等键要求
  const operationId = text(request.operationId).trim() || `screenplay-import-${bookId}-${Date.now().toString(36)}`
  // 已存在就带 expectedRevision 走乐观并发（避免覆盖别人刚写的）
  let expectedRevision = null
  let beforeFactRaw = '' // OS-107：写前原文（写后读不到旧内容）——变更日志的 before 靠它
  // OS-135 修：路径声明必须提在 try 外——OS-113 起这一行写的是 existsSync(factPath)，
  // 而 factPath 是另一个端点（deducePendingSettle）try 块里的局部 const，这里够不到，
  // ReferenceError 让本端点每次调用都 500；顺带修正 documentPath 自己也只在 try 块内可见的问题。
  const documentPath = join(authorized.root, '拆解', `${bookId}.json`)
  try {
    if (existsSync(documentPath)) {
      beforeFactRaw = await readFile(documentPath, 'utf-8')
      const existing = JSON.parse(beforeFactRaw)
      const rev = Number(existing?.revision)
      if (Number.isSafeInteger(rev) && rev >= 1) expectedRevision = rev
    }
  } catch { /* 读不到就当新建 */ }
  const documentExisted = existsSync(documentPath)  // OS-113：0 字节文件也算已存在（用 existsSync 而非内容非空）
  // 书元数据：写进 patch 的 book 字段（内核要求 patch 顶层浅合并）
  const patch = {
    book: { id: bookId, title: text(request.title).trim() || bookId },
    entries
  }
  const written = await factStore.writeFactFile({
    root: authorized.root,
    bookId,
    patch,
    operationId,
    ...(expectedRevision !== null ? { expectedRevision } : {})
  })
  if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, written.message ?? '写入拆解失败', written.details)
  // 兄弟 wiki 文件（章摘要/角色档/伏笔）——与 fact 主档一起落
  const wiki = request.wiki
  let wikiError = ''
  if (wiki && typeof wiki === 'object') {
    try {
      const wikiPath = join(authorized.root, '拆解', `${bookId}.wiki.json`)
      await atomicWriteFile(wikiPath, JSON.stringify({
        derivedFrom: { factRevision: Number(written.revision) || 1, schema: 'pinax-wiki-derived@1' },
        ...wiki
      }, null, 2))
    } catch (error) {
      // wiki 写失败不影响 fact 主档——但既然要记日志，就得让作者知道这次是同源档缺了一角
      wikiError = `兄弟 wiki 写失败：${text(error?.message || error)}`
    }
  }
  // OS-107：一次导入只留一条日志，并把兄弟 wiki 也算进同一次变更（这里是 wiki 块之后、
  // 响应之前）——before 用写前补读的原文，after 用写后重读的原文（含主档/wiki 的真实落盘结果）。
  let factLogError = ''
  try {
    const factRel = `拆解/${bookId}.json`
    const afterFactRaw = await readFile(join(authorized.root, '拆解', `${bookId}.json`), 'utf-8')
    const logged = await recordChange({
      root: authorized.root,
      module: LOG_MODULES.storysource,
      file: factRel,
      op: documentExisted ? 'update' : 'create',
      before: beforeFactRaw,
      after: afterFactRaw,
      actor: 'author',
      meta: {
        bookId,
        operationId,
        entryCount: entries.length,
        ...(wiki && typeof wiki === 'object' ? { wikiTouched: true } : {}),
        ...(Number(written.revision) ? { revision: Number(written.revision) } : {})
      }
    })
    if (logged.ok === false) factLogError = logged.message
  } catch (error) {
    factLogError = `读回拆解档失败：${text(error?.message || error)}`
  }
  return sendJson(res, 200, {
    ok: true,
    bookId,
    entries: entries.length,
    ...(Number(written.revision) ? { revision: Number(written.revision) } : {}),
    ...(written.backup ? { backup: written.backup } : {}),
    ...(factLogError ? { logError: factLogError } : {}),
    ...(wikiError ? { wikiError } : {})
  })
}

/* ---------- 语义增补（FACT-FIRST 供给端，叙事架构 v2 第一期）---------- */

/** enrich 异步 job 注册表：job 即身份（内存 Map），daemon 重启即清空（与任务中心同口径）。 */
const enrichJobs = new Map()

// enrichStatus 在兜底 root 闸之前接走：job 即身份（内存 Map），契约只声明 NOT_FOUND，不校验 root。
export async function enrichStatus(ctx) {
  const { res, request } = ctx
  const job = enrichJobs.get(text(request.jobId))
  if (!job) return sendError(res, API_ERROR_CODES.NOT_FOUND, `job 不存在：${request.jobId}`)
  return sendJson(res, 200, { ok: true, jobId: job.jobId, state: job.state, progress: job.progress, summary: job.summary, error: job.error })
}

export async function enrichRun(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const bookId = text(request.bookId).trim()
  if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
  const { config } = await loadConfigV2(context.agentConfigPath)
  const upstream = await resolveChatUpstream(config, context)
  if (!upstream.ok) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, upstream.message)
  // llmPort：把「活动运行时」包成引擎要的 prompt→text 形状（OS-58）。
  // 作者裁定：**不接受接口直接接入**，统一走 CLI 子 agent 模式。
  // 三种上游都收敛到同一次「单发单收」调用：
  //   · endpoint  → HTTP chat/completions（保留：本机 sidecar 一类也算 endpoint，但不是主路径）
  //   · cli       → 一次性子进程（cli-bridge.runCliChat），stdout 即回包
  //   · dsh-cli   → 一 run 一进程（dsh-cli.runDshStdio），收 delta 拼成回包
  // enrich 每窗都要结构化 JSON，所以这里对子 agent 额外下硬约束：只输出 JSON。
  const llmPort = async ({ prompt, maxTokens = 2000 }) => {
    const strict = `${prompt}\n\n【输出约束】只输出符合要求的 JSON，不要 markdown 代码围栏，不要任何解释文字。`
    if (upstream.execute === 'cli') {
      const run = await runCliChat(upstream.kit, [{ role: 'user', content: strict }], { model: upstream.model })
      if (!run.ok) throw new Error(`CLI 子 agent 失败：${run.message}`)
      return { text: text(run.text) }
    }
    if (upstream.execute === 'dsh-cli') {
      let collected = ''
      const result = await runDshStdio({
        dshCmd: upstream.dshRun.dshCmd,
        profile: upstream.dshRun.profile,
        cwd: root,
        prompt: strict,
        ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
        // CLI/DSH 子 agent 单窗可能想很久（深析世界要素时尤甚），给足 10 分钟
        inactivityMs: 180_000,
        timeoutMs: 600_000,
        onText: (piece) => { collected += piece }
      })
      if (!result.ok) throw new Error(`DSH 子 agent 失败：${result.message || result.code || 'unknown'}`)
      return { text: text(collected || result.text || '') }
    }
    // endpoint（含 sidecar）：HTTP 单发
    const response = await fetch(upstream.url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...upstream.headers },
      body: JSON.stringify({ model: upstream.model, messages: [{ role: 'user', content: strict }], max_tokens: maxTokens, temperature: 0.4, stream: false }),
      signal: AbortSignal.timeout(180_000)
    })
    if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
    const data = await response.json()
    return { text: data.choices?.[0]?.message?.content ?? '' }
  }
  const jobId = `enrich-${bookId}-${Date.now().toString(36)}`
  // 事实条目与书元数据：factFileStore 取 entries（与 /api/entries 同源），book 从拆解文件读
  const store = factStore.createFactFileStore({ root: authorized.root })
  const listed = await store.list({})
  if (!listed.ok || !listed.entries.length) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '事实链为空——先跑抽取（pinax_extract_*）再 enrich')
  }
  let book = { id: bookId, title: bookId }
  try {
    const dataset = JSON.parse(readFileSync(join(authorized.root, '拆解', `${bookId}.json`), 'utf8'))
    if (dataset.book) book = dataset.book
  } catch { /* 元数据缺失就用 bookId 兜底 */ }
  const job = { jobId, bookId, root: authorized.root, state: 'running', progress: [], summary: null, error: null, startedAt: new Date().toISOString() }
  enrichJobs.set(jobId, job)
  // 异步跑：HTTP 立即回 jobId；进度走 enrichStatus 轮询（6 窗逐窗更新）。
  enrichBook({
    root: authorized.root,
    bookId,
    entries: listed.entries,
    book,
    llmPort,
    onProgress: (note) => job.progress.push(note),
  }).then((result) => {
    job.state = result.ok ? 'done' : 'failed'
    job.summary = result.summary ?? null
    job.error = result.ok ? null : (result.failures?.map((f) => `${f.stage}:${f.reason}`).join('；') || 'failed')
  }).catch((error) => {
    job.state = 'failed'
    job.error = text(error?.message ?? error)
  })
  return sendJson(res, 200, { ok: true, jobId })
}

export async function enrichGraph(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const bookId = text(request.bookId).trim()
  if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
  const result = await enrichGraphEngine({ root: authorized.root, bookId })
  if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
  return sendJson(res, 200, { ok: true, ...result })
}

/** fact 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  factCurveGet,
  factEntriesGet,
  factBooksGet,
  factEntriesImport,
  deduceOpeningGet,
  deducePresent,
  deduceSettle,
  deduceSessionGet,
  deduceSessionPut,
  deduceSessionsGet,
  deduceSessionManage,
  deduceArchive,
  deduceTurn,
  deduceBranch,
  deduceExport,
  deducePromote,
  deducePendingSettle,
  deduceImage,
  deduceAssets,
  deduceAssetFile,
  roleplayOpeningGet,
  roleplayTurn,
  enrichRun,
  enrichStatus,
  enrichGraph,
  nativePick,
  nativeReveal
}
