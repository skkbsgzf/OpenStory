/**
 * fact 域 handler（OS-141 daemon 拆分）——27 端点，与 contracts/fact.mjs 一一对应：
 * factCurveGet/factEntriesGet/factBooksGet/factEntriesImport（故事源条目层）、
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
import { readFileSync, statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { API_ERROR_CODES, isPlainObject, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot, resolveInsideRoot } from '../../host/authorize.mjs'
import { resolveFactCapability } from '../../host/capabilityBindings.mjs'
import { listFactBooks, factOffsetOf, factLimitOf } from '../../services/factBooks.mjs'
import { writeFactEntries } from '../../services/factImportWrite.mjs' // OS-162：fact 写通道唯一实现
import { enrichBook, enrichGraph as enrichGraphEngine } from '../../services/enrichEngine.mjs'
import { loadConfigV2 } from '../../services/agentConfig.mjs'
import { resolveChatUpstream } from '../../services/chatUpstream.mjs'
import { runCliChat } from '../../services/cli-bridge.mjs'
import { runDshStdio } from '../../services/dsh-cli.mjs'
import { pickFile, pickFolder, revealPath, readBrowseMemory, writeBrowseMemory, nativeDialogUnusable, markNativeDialogUnusable, NATIVE_DIALOG_TIMEOUT_MS } from '../../host/nativePicker.mjs'
import { namingEntry } from '../../protocol/naming.mjs'
const FACT_DIR = namingEntry('storysource').dir
async function factCapabilityOrError(res, root, id = 'fact.store', range) {
  const resolved = await resolveFactCapability(root, id, range)
  if (!resolved.ok) {
    sendError(res, API_ERROR_CODES.PLUGIN_DEGRADED, resolved.message, resolved.details)
    return null
  }
  return resolved.capability
}

/* ---------- 分析面板 fact 曲线（KB-ARCH 对齐故事源曲线算法）---------- */

// 分析面板 fact 曲线：读库内 故事源/ 的 fact+wiki，给章级曲线数据。
// 无故事源数据时返回 ok:true + chapters:[]（前端降级到本地词典近似），绝不报错。
export async function factCurveGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const dir = join(authorized.root, FACT_DIR)
  let files = []
  try {
    files = (await readdir(dir)).filter((name) => name.endsWith('.json')
      && !name.endsWith('.wiki.json') && !name.includes('.operations')
      // 旧目录名旁路档只作兼容排除，不重新生成旧布局。
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
  if (!document) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `故事源文件读不了：${bookId}`)
  const factStore = await factCapabilityOrError(res, authorized.root)
  if (!factStore) return null
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
    if (!book) return sendError(res, API_ERROR_CODES.NOT_FOUND, `故事源里没有这本书：${wantedBookId}`)
  } else {
    // 缺省书＝mtime 最新的可读一本（坏档不参与兜底，免得兜底到一本永远读不出条目的书）。
    book = books.filter((item) => !item.error).sort((left, right) => right.mtime - left.mtime)[0] ?? null
  }
  // OS-150a：库里还没有故事源书＝合法空态（前端故事源页据此摆引导空态）。
  // OS-150b：有档但一本都读不出来＝坏档，必须与空态分开报（前端显示告警，不摆「还没有故事源」）。
  // 两种判定都只认 error.code，页面不认文案。不能落下去拼 bookId:'' 的响应——契约要求非空。
  if (!book) {
    const unreadable = books.filter((item) => item.error)
    if (unreadable.length) {
      return sendError(res, API_ERROR_CODES.FACT_UNREADABLE, '故事源档读不出来', {
        books: unreadable.map((item) => ({ bookId: item.bookId, file: item.file, error: item.error }))
      })
    }
    return sendError(res, API_ERROR_CODES.FACT_EMPTY, '这个库还没有故事源条目')
  }
  const factStore = await factCapabilityOrError(res, authorized.root)
  if (!factStore) return null
  const listed = factStore.createFactFileStore({ root: authorized.root }).list({})
  if (!listed.ok) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, listed?.error?.message ?? '故事源数据读不了', listed?.error?.details)
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

/* 推演会话存储层（OS-61）：「文游」容器——读/整存会话、归档一章。 */

/* 推演回合层（OS-61 P2）：选候选/自定义 → 结算 → 成文草稿 → 拍进会话缓存区。
 * regenerate:true 只重写最后一拍的正文（覆盖 node.prose），不结算、不新增节点。 */
/* ---------- 扮演层（OS-96/97/100/102）---------- */

/* ---------- 推演导出 / 转正 / 待确认卡落库（OS-94/OS-82）---------- */

/* 剧情树分支（OS-61 P3）：从某一拍开新分支。只动 branchId/cursor 与分叉溯源，
 * nodes 全量保留；缓存区沿用 switchBranch 语义不动（归档仍按缓存区里的拍走）。 */
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

/* ---------- 故事源整包导入（OS-78/OS-135 修）---------- */

export async function factEntriesImport(ctx) {
  // OS-162：写逻辑抽入 src/services/factImportWrite.mjs（exchange 适配器共用同一份）——
  // 这里只做授权、参数整形与响应，不再自己碰 writeFactFile。
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const operationId = text(request.operationId).trim()
    || `screenplay-import-${text(request.bookId).trim()}-${Date.now().toString(36)}`
  const factStore = await factCapabilityOrError(res, authorized.root)
  if (!factStore) return null
  const result = await writeFactEntries({
    root: authorized.root,
    factStore,
    bookId: request.bookId,
    entries: request.entries,
    title: request.title,
    wiki: request.wiki,
    operationId
  })
  if (!result.ok) return sendError(res, API_ERROR_CODES[result.code] ?? result.code, result.message, result.details)
  return sendJson(res, 200, {
    ok: true, bookId: result.bookId, entries: result.entries,
    ...(result.revision ? { revision: result.revision } : {}),
    ...(result.backup ? { backup: result.backup } : {}),
    ...(result.logError ? { logError: result.logError } : {}),
    ...(result.wikiError ? { wikiError: result.wikiError } : {})
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
  // 事实条目与书元数据：factFileStore 取 entries（与 /api/entries 同源），book 从故事源文件读
  const factStore = await factCapabilityOrError(res, authorized.root)
  if (!factStore) return null
  const store = factStore.createFactFileStore({ root: authorized.root })
  const listed = await store.list({})
  if (!listed.ok || !listed.entries.length) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '事实链为空——先导入或生成故事源条目，再运行 enrich')
  }
  let book = { id: bookId, title: bookId }
  try {
    const dataset = JSON.parse(readFileSync(join(authorized.root, FACT_DIR, `${bookId}.json`), 'utf8'))
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
  enrichRun,
  enrichStatus,
  enrichGraph,
  nativePick,
  nativeReveal
}
