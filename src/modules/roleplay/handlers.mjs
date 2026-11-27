/**
 * roleplay / deduce 端点 handler（OS-194 从 src/api/handlers/fact.mjs 归位 17 个独占端点）。
 *
 * 内核句柄（deduce.engine / fact.store / fact.books / fact.write / prose.write /
 * agent.runtime / media.generate）经 activate(context) 的 context.resolve 注入；
 * 宿主工具经 context.host 注入。本文件只 import node:/protocol/本模块。
 */
import { createHash } from 'node:crypto'
import { createReadStream, existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import {
  buildRoleplayMemory,
  compressMemory,
  deAiPass,
  roleplayOpening as roleplayOpeningEngine,
  roleplayTurn as roleplayTurnEngine,
  shouldSummarize
} from './roleplayEngine.mjs'
import { API_ERROR_CODES as apiErrors } from '../../protocol/apiErrors.mjs'
import { loadDeduceRules } from '../../protocol/deduceRules.mjs'
import { isModuleEnabled } from '../../protocol/modules.mjs'
import { recordChange } from '../../protocol/changelog.mjs'
import { LOG_MODULES, namingEntry } from '../../protocol/naming.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'

const FACT_DIR = namingEntry('storysource').dir
const ROLEPLAY_DIR = namingEntry('roleplay').dir
const text = (value) => String(value ?? '')

/** 素材单文件上限：立绘/BGM 都是本机小文件，16MB 足够且防误挂大档。 */
const DEDUCE_ASSET_MAX = 16 * 1024 * 1024

/** 素材三类目录 → 响应字段与扩展名。 */
const DEDUCE_ASSET_KINDS = Object.freeze([
  { dir: '角色', field: 'characters', ext: '.png', mediaType: 'image/png' },
  { dir: '场景', field: 'scenes', ext: '.png', mediaType: 'image/png' },
  { dir: 'bgm', field: 'bgm', ext: '.mp3', mediaType: 'audio/mpeg' }
])

/** OS-217：素材写入只收严格标准 base64；空串/空白/URL-safe/缺 padding/非法字符全拒。 */
const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

function decodeDeduceAsset(value) {
  const encoded = text(value)
  // 先量长度再逐字符校验：重复分组正则在 22MB 输入上会爆 V8 栈。
  // 16MB+1 字节的 base64 与 16MB 的编码长度相同，必须解码后再按字节数拒收。
  const maxEncoded = Math.ceil(DEDUCE_ASSET_MAX / 3) * 4
  if (!encoded || encoded.length > maxEncoded || encoded.length % 4 !== 0) return null
  let padding = 0
  if (encoded.endsWith('==')) padding = 2
  else if (encoded.endsWith('=')) padding = 1
  const dataLength = encoded.length - padding
  for (let index = 0; index < dataLength; index += 1) {
    if (!BASE64_ALPHABET.includes(encoded[index])) return null
  }
  const decoded = Buffer.from(encoded, 'base64')
  return decoded.length > 0 && decoded.length <= DEDUCE_ASSET_MAX && decoded.toString('base64') === encoded ? decoded : null
}

function deduceAssetKind(relativePath) {
  const parts = relativePath.replaceAll('\\', '/').split('/')
  if (parts.length !== 2) return null
  return DEDUCE_ASSET_KINDS.find((kind) =>
    parts[0] === kind.dir && extname(parts[1]).toLowerCase() === kind.ext && !parts[1].startsWith('.')) ?? null
}

function hasDeduceAssetSignature(kind, bytes) {
  if (kind.ext === '.png') {
    return bytes.length >= PNG_SIGNATURE.length && bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE)
  }
  // MP3：完整 ID3v2 标签头，或合法 MPEG audio frame header。
  // 帧头 11 位同步全 1（FF E0），且 layer/bitrate/sample-rate 不能是保留值；
  // 仅「FF E0 00 00」这种短伪造帧不放行。
  if (bytes.length >= 10 && bytes.subarray(0, 3).equals(Buffer.from('ID3', 'ascii'))) return true
  // 无 ID3 的 MP3 至少要有完整一帧（MPEG1 Layer III 最小 72 字节）；4 字节头不够，
  // 否则测试/攻击者可用 FF E0 00 00 伪造「有签名」。
  if (bytes.length < 72 || bytes[0] !== 0xff || (bytes[1] & 0xe0) !== 0xe0) return false
  const layerBits = (bytes[1] >> 1) & 0x03
  const bitrateIndex = (bytes[2] >> 4) & 0x0f
  const sampleRateIndex = (bytes[2] >> 2) & 0x03
  return layerBits !== 0 && bitrateIndex !== 0 && bitrateIndex !== 0x0f && sampleRateIndex !== 0x03
}

/** OS-217：沿用正文同目录 .history/<原文件名>.bak-<时间戳> 的现有命名模式。 */
function deduceAssetHistoryPath(absPath, now = new Date()) {
  const stamp = now.toISOString().replace(/[:.]/gu, '-')
  return join(dirname(absPath), '.history', `${basename(absPath)}.bak-${stamp}`)
}

function relativeAssetPath(root, absPath) {
  return relative(root, absPath).split(sep).join('/')
}

/** 盘点 扮演/<bookId>/素材/：目录不存在＝空数组；隐藏文件/子目录/异扩展名跳过。 */
async function listDeduceAssets(root, bookId, resolveInsideRoot) {
  const base = resolveInsideRoot(root, `${ROLEPLAY_DIR}/${bookId}/素材`)
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
        path: `${ROLEPLAY_DIR}/${bookId}/素材/${kind.dir}/${entry.name}`
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
  }
  return result
}

export function createHandlers({ host, deduce, factStore, factBooks, prose, agentRuntime, textAnalyze }) {
  // OS-195a：会话容器改从 deduce 能力句柄取（跨模块只经 context.resolve，不 import 对方内部）。
  const {
    appendNode, archiveChapter, createDeduceSession, deleteDeduceSession, importLegacyDeduce,
    listDeduceSessions, loadDeduceSession, normalizeDeduceSession, readActiveSessionId,
    safeDeduceBookId, saveDeduceSession, writeActiveSessionId
  } = deduce
  const DEDUCE_SESSION_SCHEMA = deduce.deduceSessionSchema()
  // OS-195：text.analyze 经 activate(context) 的 context.resolve 句柄注入（不再顶层取实现）。
  const analyze = textAnalyze?.analyzeChapter ?? null
  const { sendError, sendJson, authorizeRoot, resolveInsideRoot } = host
  const resolveBookId = (root, requested) => factBooks.resolveFactBookId(root, requested)

  async function deduceOpeningGet(ctx) {
    // OS-93 开局三件套（照酒馆：选角色卡 → 选世界书 → 选开头）
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = deduce.deduceOpening({ root: authorized.root })
    if (!result.ok) return sendError(res, result.code ?? apiErrors.INVALID_ENTRY, result.message)
    return sendJson(res, 200, result)
  }

  async function deducePresent(ctx) {
    const { res, request, context, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const rulePack = await loadDeduceRules({ suitesDirs: context.suitesDirs, suiteStatePath: context.suiteStatePath, root: authorized.root })
    if (!rulePack.ok) return sendError(res, rulePack.code, rulePack.message)
    const result = await deduce.deducePresent({
      root: authorized.root,
      bookId: await resolveBookId(authorized.root, request.bookId),
      pov: text(request.pov),
      seed: Number.isSafeInteger(request.seed) ? request.seed : null,
      reset: request.reset === true,
      peek: request.peek === true,
      // OS-93：选中的开头（剧情骨架段 definition）——戏剧候选围绕它锚定
      seedPrompt: text(request.seedPrompt),
      rules: request.rules ?? rulePack.rules,
      // OS-96：扮演底座按章节筛世界书（写到30章的库不给31章以后的知识）
      chapterLimit: Number.isFinite(Number(request.chapterLimit)) && Number(request.chapterLimit) > 0 ? Number(request.chapterLimit) : null,
      sessionId: text(request.sessionId).trim() || readActiveSessionId(authorized.root, await resolveBookId(authorized.root, request.bookId)),
      // OS-82：戏剧候选接全局文本模型（没配模型＝null，必然/命运照常）
      llmPort: await deduce.buildDeduceLlmPort({ context })
    })
    // peek 且无会话：不是错误——前端维持空态
    if (!result.ok && result.code === 'NO_DEDUCE_SESSION') return sendJson(res, 200, { ok: false, code: 'NO_DEDUCE_SESSION', message: result.message })
    if (!result.ok) return sendError(res, result.code === 'WORLD_EMPTY' ? apiErrors.INVALID_ENTRY : (result.code ?? apiErrors.INVALID_ENTRY), result.message)
    return sendJson(res, 200, result)
  }

  async function deduceSettle(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await deduce.deduceSettle({
      root: authorized.root,
      bookId: await resolveBookId(authorized.root, request.bookId),
      candidateId: text(request.candidateId),
      action: text(request.action || 'choose'),
      note: text(request.note),
      sessionId: text(request.sessionId).trim() || readActiveSessionId(authorized.root, await resolveBookId(authorized.root, request.bookId))
    })
    if (!result.ok) return sendError(res, result.code ?? apiErrors.INVALID_ENTRY, result.message)
    return sendJson(res, 200, result)
  }

  /* 推演会话存储层（OS-61）：「文游」容器——读/整存会话、归档一章。 */

  async function deduceSessionGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveBookId(authorized.root, request.bookId)
    // OS-86：sessionId 缺省＝激活指针（回落主线）——前端不用管「现在在哪局」
    const wanted = text(request.sessionId).trim()
    const sid = wanted || readActiveSessionId(authorized.root, bookId)
    let session = loadDeduceSession(authorized.root, bookId, sid)
    // 自动桥接（OS-62）：新层还没有节点、但旧引擎层推过拍 → 把最后一面导入成首节点。
    // 老库升级后剧情树不再空白；旧档不动，重复读幂等。只桥主线——多局是 OS-86 之后的产物。
    if ((!session || !(session.nodes || []).length) && (sid === 'main' || !wanted)) {
      const legacy = deduce.readLegacyDeduceState(authorized.root, bookId)
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

  async function deduceSessionPut(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveBookId(authorized.root, request.bookId)
    // OS-86：sessionId 随会话对象走（main＝legacy 路径，其余 sessions/<sid>.json）
    const session = normalizeDeduceSession(request.session, bookId, text(request.session?.sessionId))
    if (!session) {
      return sendError(res, apiErrors.INVALID_ENTRY, `推演会话形状不对：schema 必须是 ${DEDUCE_SESSION_SCHEMA}，nodes 必须是数组`)
    }
    const saved = await saveDeduceSession(authorized.root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, session, ...(saved.backup ? { backup: saved.backup } : {}) })
  }

  async function deduceSessionsGet(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveBookId(authorized.root, request.bookId)
    // OS-86 多局并存：主线（legacy）＋ sessions/ 全部＋激活指针。列表轻量读全文取 meta。
    const listed = listDeduceSessions(authorized.root, bookId)
    return sendJson(res, 200, { ok: true, bookId, ...listed })
  }

  async function deduceSessionManage(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveBookId(authorized.root, request.bookId)
    // OS-86 多局管理：new＝新建空局并激活；switch＝激活已有局；delete＝非破坏删除（挪 .deleted）。
    // 最后一局不能删（推演页不能开天窗，清空走「重新开局」）。
    const action = text(request.action || '').trim()
    if (action === 'new') {
      const created = await createDeduceSession(authorized.root, bookId, { title: text(request.title) })
      if (!created.ok) return sendError(res, created.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, created.message ?? '新局创建失败')
      const listed = listDeduceSessions(authorized.root, bookId)
      return sendJson(res, 200, { ok: true, action: 'new', sessionId: created.sessionId, session: created.session, ...listed })
    }
    const sid = text(request.sessionId).trim()
    if (action === 'switch') {
      if (!sid) return sendError(res, apiErrors.INVALID_ENTRY, 'sessionId 必填')
      const session = loadDeduceSession(authorized.root, bookId, sid)
      if (!session) return sendError(res, apiErrors.NOT_FOUND, `会话不存在：${sid}`)
      const active = await writeActiveSessionId(authorized.root, bookId, sid)
      if (!active.ok) return sendError(res, active.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, active.message)
      return sendJson(res, 200, { ok: true, action: 'switch', sessionId: sid, session })
    }
    if (action === 'delete') {
      if (!sid) return sendError(res, apiErrors.INVALID_ENTRY, 'sessionId 必填')
      const removed = await deleteDeduceSession(authorized.root, bookId, sid)
      if (!removed.ok) return sendError(res, removed.code ?? apiErrors.INVALID_ENTRY, removed.message)
      const listed = listDeduceSessions(authorized.root, bookId)
      const session = loadDeduceSession(authorized.root, bookId, listed.activeId)
      return sendJson(res, 200, { ok: true, action: 'delete', sessionId: sid, session, ...listed })
    }
    return sendError(res, apiErrors.INVALID_ENTRY, 'action 只认 new / switch / delete')
  }

  async function deduceArchive(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveBookId(authorized.root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(authorized.root, bookId)
    const session = loadDeduceSession(authorized.root, bookId, sid)
    if (!session) return sendError(res, apiErrors.NOT_FOUND, `还没有推演会话：${bookId}`)
    const archived = await archiveChapter(authorized.root, session, { title: text(request.title) })
    if (!archived.ok) return sendError(res, archived.code ?? apiErrors.INVALID_ENTRY, archived.message)
    return sendJson(res, 200, { ok: true, path: archived.path, words: archived.words })
  }

  /* 推演回合层（OS-61 P2）：选候选/自定义 → 结算 → 成文草稿 → 拍进会话缓存区。
   * regenerate:true 只重写最后一拍的正文（覆盖 node.prose），不结算、不新增节点。 */
  async function deduceTurn(ctx) {
    const { res, request, context, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveBookId(root, request.bookId)
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
      if (!last) return sendError(res, apiErrors.INVALID_ENTRY, '还没有可重写的拍：先选一条候选或自己写一拍')
      const previous = branchNodes[branchNodes.length - 2]
      const gen = await deduce.generateTurnProse({ context, root, node: last, previousProse: previous?.prose })
      // 模型不可用时不毁旧稿：prose 保持原样，proseError 如实报
      if (gen.prose) {
        last.prose = gen.prose
        const buffered = (session.buffer?.nodes ?? []).find((node) => node.id === last.id)
        if (buffered) buffered.prose = gen.prose
        if (session.buffer) session.buffer.words = (session.buffer.nodes ?? []).reduce((sum, node) => sum + deduce.turnNodeWords(node), 0)
      }
      const saved = await saveDeduceSession(root, bookId, session)
      if (!saved.ok) return sendError(res, saved.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, saved.message)
      return sendJson(res, 200, { ok: true, node: last, session, prose: text(last.prose), ...(gen.proseError ? { proseError: gen.proseError } : {}) })
    }

    if (!customText && !choiceId) {
      return sendError(res, apiErrors.INVALID_ENTRY, '选一条候选（choiceId）或自己写（customText）再结算')
    }
    let settled
    if (customText) {
      settled = await deduce.deduceSettle({ root, bookId, action: 'inject', note: customText, sessionId: sid })
    } else {
      const bridged = await deduce.bridgeDeduceCandidates(root, bookId, sid)
      if (!bridged.ok) return sendError(res, bridged.code ?? apiErrors.INVALID_ENTRY, bridged.message)
      settled = await deduce.deduceSettle({ root, bookId, candidateId: choiceId, action: 'choose', sessionId: sid })
    }
    if (!settled.ok) return sendError(res, settled.code ?? apiErrors.INVALID_ENTRY, settled.message)
    // OS-82 回填闭环：结算产出的 fact 条目不自动落库——挂会话 pending 队列（待确认卡），
    // 作者点「写入故事源」才走 writeFactFile 单条 upsert；点「忽略」只出队。
    const settledEntry = settled.result?.entry ?? null

    // 局面与候选取自引擎最后一面（present 存的 lastTurn）；自定义拍补一条「作者」候选
    const lastTurn = deduce.readLastTurn(root, bookId, sid)
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
    const gen = await deduce.generateTurnProse({ context, root, node: draft, previousProse: previous?.prose })
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
    if (!saved.ok) return sendError(res, saved.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, node, session, prose: node.prose, ...(gen.proseError ? { proseError: gen.proseError } : {}) })
  }

  /* ---------- 扮演层（OS-96/97/100/102）---------- */

  async function roleplayOpeningGet(ctx) {
    // OS-100 扮演开场：主持人替世界拉开第一幕（时间/地点/在场/第一眼）＋三条初始分支。
    const { res, request, context, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveBookId(root, request.bookId)
    const loaded = deduce.loadEntries(root)
    if (!loaded.ok) return sendError(res, apiErrors.INVALID_ENTRY, loaded.message)
    // OS-107 修：空事实包不能开局——扮演底座必须有世界书/故事源条目，否则模型凭空编造
    if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
      return sendError(res, apiErrors.INVALID_ENTRY, '这个库还没有事实包（故事源条目/世界书词条）——先补世界书或跑 enrich，再开始扮演')
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
    if (!pov) return sendError(res, apiErrors.INVALID_ENTRY, '先选你要扮演谁（pov）')
    const upstream = await agentRuntime.resolveUpstreamSafe({ context })
    const chatComplete = async (prompt, opts = {}) => {
      const out = await agentRuntime.chatCompleteViaUpstream({ upstream, system: prompt, maxTokens: opts.maxTokens ?? 700, temperature: 0.9, cwd: root })
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
    if (!result.ok) return sendError(res, apiErrors.INVALID_ENTRY, result.error ?? '开场没有产出')
    // OS-102：开场也过 AI 味闸（超阈重写一次；只换文风不动事实）
    // OS-144：分析模块停用＝宿主钩子判定后跳过本闸（不留下「模块停了还被调用」的旁路）
    const gated = await deAiPass({ chatComplete, prose: result.feedback, analyze, enabled: await isModuleEnabled(root, 'analysis') })
    return sendJson(res, 200, {
      ok: true,
      feedback: gated.text,
      options: result.options ?? [],
      ...(gated.rewritten ? { deAiSmell: gated.before?.score ?? null } : {})
    })
  }

  async function roleplayTurn(ctx) {
    // OS-97 扮演一回合：主持人裁决 → N 角色各自成文 → 主持人收束（对「你」说话）。
    // 世界书按 chapterLimit 过滤（OS-96）；玩家可以扮演任意角色或「主持人」。
    const { res, request, context, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveBookId(root, request.bookId)
    const loaded = deduce.loadEntries(root)
    if (!loaded.ok) return sendError(res, apiErrors.INVALID_ENTRY, loaded.message)
    // OS-107 修：空事实包不能演——与开场同口径
    if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
      return sendError(res, apiErrors.INVALID_ENTRY, '这个库还没有事实包——扮演需要世界书/故事源条目作底座')
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
    if (!pov) return sendError(res, apiErrors.INVALID_ENTRY, '先选你要扮演谁（pov）')
    if (!playerAction) return sendError(res, apiErrors.INVALID_ENTRY, '这一幕你做什么/说什么（playerAction）必填')
    // 最近几拍摘要（会话层复用 deduceSession——扮演与推演共用容器）
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const session = loadDeduceSession(root, bookId, sid)
    // OS-102 长期记忆：滚动摘要（长期）＋最近几拍明细（短期）——跑长了 agent 不会忘前情
    const mem = buildRoleplayMemory(session, { recentLimit: 3 })
    const recent = [mem.summaryText, mem.recentText].filter(Boolean).join('\n\n')
    const upstream = await agentRuntime.resolveUpstreamSafe({ context })
    const chatComplete = async (prompt, opts = {}) => {
      const out = await agentRuntime.chatCompleteViaUpstream({ upstream, system: prompt, maxTokens: opts.maxTokens ?? 600, temperature: 0.85, cwd: root })
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
    if (!result.ok) return sendError(res, apiErrors.INVALID_ENTRY, result.error ?? '本幕没有产出')
    // OS-102：世界反馈落稿前过 AI 味闸（角色演绎 beats 保持原样——那是演员的口吻）
    // OS-144：分析模块停用＝跳过本闸（启用态行为与改前逐字节一致）
    const gated = await deAiPass({ chatComplete, prose: result.feedback, analyze, enabled: await isModuleEnabled(root, 'analysis') })
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

  async function deduceExport(ctx) {
    // OS-94：推演导出——整个会话（每拍的决定＋正文＋归档清单）出 markdown，
    // 落 扮演/<bookId>/导出/会话-<bookId>-<sid>-<ts>.md。读侧动作，不改会话。
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, apiErrors.NOT_FOUND, `还没有推演会话：${bookId}`)
    const nodes = Array.isArray(session.nodes) ? session.nodes : []
    const lines = [`# 推演会话 · ${text(session.title)}`, '']
    lines.push(`> 导出于 ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · ${bookId} · 局「${text(session.title)}」（${sid}） · 共 ${nodes.length} 拍`, '')
    for (const node of nodes) {
      const chosen = (Array.isArray(node.candidates) ? node.candidates : []).find((c) => text(c.id) === text(node.choiceId))
      lines.push(`## 第${Number(node?.round) || 0}拍`, '')
      if (chosen && text(chosen.text)) lines.push(`> **你的决定**：${text(chosen.text)}`, '')
      const proseText = text(node.prose).trim()
      lines.push(proseText || '（本拍没有正文）', '')
    }
    if (Array.isArray(session.archived) && session.archived.length) {
      lines.push('## 已归档章节', '', ...session.archived.map((a) => `- ${text(a.path)}（${Number(a.words) || 0} 字）`), '')
    }
    const exportDir = join(root, ROLEPLAY_DIR, safeDeduceBookId(bookId), '导出')
    await mkdir(exportDir, { recursive: true })
    const fileName = `会话-${safeDeduceBookId(bookId)}-${sid}-${Date.now().toString(36)}.md`
    const outPath = join(exportDir, fileName)
    await writeFile(outPath, lines.join('\n'), 'utf-8')
    return sendJson(res, 200, { ok: true, path: `${ROLEPLAY_DIR}/${safeDeduceBookId(bookId)}/导出/${fileName}`, words: lines.join('\n').length })
  }

  async function deducePromote(ctx) {
    // OS-94：转正——把一拍的正文写进 正文/ 成正式章节（createChapter 自动下一章号＋
    // writeChapterWithBackup 备份通道）。prose 为空＝拒绝（先重写或自己写完）。
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, apiErrors.NOT_FOUND, `还没有推演会话：${bookId}`)
    const nodeId = text(request.nodeId).trim()
    const node = (Array.isArray(session.nodes) ? session.nodes : []).find((n) => text(n?.id) === nodeId)
    if (!node) return sendError(res, apiErrors.NOT_FOUND, `会话里没有这一拍：${nodeId}`)
    const proseText = text(node.prose).trim()
    if (!proseText) return sendError(res, apiErrors.INVALID_ENTRY, '这一拍还没有正文——先「重写」出稿或自己写完，再转正')
    const created = await prose.createChapter(root, '正文', text(request.title).trim() || `推演第${Number(node.round) || 0}拍`)
    if (!created.ok) return sendError(res, created.code ?? apiErrors.INVALID_ENTRY, created.message ?? '章节创建失败')
    const written = await prose.writeChapterWithBackup(root, created.chapter.file, proseText)
    if (!written.ok) return sendError(res, written.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, written.message ?? '章节写入失败')
    return sendJson(res, 200, { ok: true, file: created.chapter.file, chapter: created.chapter, chars: proseText.length })
  }

  async function deducePendingSettle(ctx) {
    // OS-82 回填闭环：待确认卡落库（write）/丢弃（dismiss）。写走内核 writeFactFile 的
    // 单条 upsert（entry 形态：按 id 命中替换、没有就追加）——推演一拍只进一条事件，
    // 绝不动故事源文件里其他条目（与 factEntriesImport 的整份替换是两回事）。
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const pendingId = text(request.pendingId).trim()
    const action = text(request.action || 'write')
    if (!pendingId) return sendError(res, apiErrors.INVALID_ENTRY, 'pendingId 必填')
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, apiErrors.NOT_FOUND, '这个库还没有推演会话')
    const index = (Array.isArray(session.pending) ? session.pending : []).findIndex((item) => text(item?.id) === pendingId)
    if (index < 0) return sendError(res, apiErrors.NOT_FOUND, '这条待确认卡已不存在（可能已写入或已忽略）——刷新会话即可')
    const item = session.pending[index]
    if (action === 'dismiss') {
      session.pending.splice(index, 1)
      const saved = await saveDeduceSession(root, bookId, session)
      if (!saved.ok) return sendError(res, saved.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, saved.message)
      return sendJson(res, 200, { ok: true, action: 'dismiss', session })
    }
    if (action !== 'write' || !item.entry || typeof item.entry !== 'object') {
      return sendError(res, apiErrors.INVALID_ENTRY, 'action 只认 write/dismiss，卡上要有结算产出的条目')
    }
    // 写前重读 revision 走乐观并发（与 factEntriesImport 同口径），避免覆盖别人刚写的故事源
    let expectedRevision = null
    let beforeFactRaw = '' // OS-107：写前原文（写后就读不到旧内容了）——变更日志的 diff 靠它
    try {
      const factPath = join(root, FACT_DIR, `${bookId}.json`)
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
    if (!written.ok) return sendError(res, written.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, written.message ?? '写入故事源失败', written.details)
    // OS-107：fact 落盘即留痕（AGENTS.md 第 10 条）。失败分支已提前 return，这里是最窄的
    // 「写成功即记」点；日志写失败不阻断主写入，但要如实回传给调用方。
    let factLogError = ''
    try {
      const factRel = `${FACT_DIR}/${bookId}.json`
      const afterFactRaw = await readFile(join(root, FACT_DIR, `${bookId}.json`), 'utf-8')
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
      factLogError = `读回故事源档失败：${text(error?.message || error)}`
    }
    session.pending.splice(index, 1)
    const saved = await saveDeduceSession(root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, {
      ok: true,
      action: 'write',
      session,
      ...(Number(written.revision) ? { revision: Number(written.revision) } : {}),
      ...(factLogError ? { logError: factLogError } : {})
    })
  }

  /* 剧情树分支（OS-61 P3）：从某一拍开新分支。只动 branchId/cursor 与分叉溯源，
   * nodes 全量保留；缓存区沿用 switchBranch 语义不动（归档仍按缓存区里的拍走）。 */
  async function deduceBranch(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const fromNodeId = text(request.fromNodeId).trim()
    if (!fromNodeId) return sendError(res, apiErrors.INVALID_ENTRY, '指明从哪一拍开分支（fromNodeId）')
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, apiErrors.NOT_FOUND, `还没有推演会话：${bookId}`)
    const fromNode = session.nodes.find((node) => text(node?.id) === fromNodeId)
    if (!fromNode) return sendError(res, apiErrors.NOT_FOUND, `会话里没有这一拍：${fromNodeId}`)
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
    if (!saved.ok) return sendError(res, saved.code ?? apiErrors.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, session })
  }

  async function deduceAssets(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveBookId(authorized.root, request.bookId)
    const listed = await listDeduceAssets(authorized.root, bookId, resolveInsideRoot)
    if (!listed.ok) return sendError(res, listed.code, listed.message)
    return sendJson(res, 200, { ok: true, bookId, characters: listed.characters, scenes: listed.scenes, bgm: listed.bgm })
  }

  async function deduceAssetFile(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveBookId(authorized.root, request.bookId)
    // 盘符注入闸：相对路径段里混进 `C:` 这类盘符会在 Windows 上改指向，直接按逃逸拒收
    if (text(request.path).includes(':')) {
      return sendError(res, apiErrors.PATH_ESCAPE, `素材路径不许带盘符：${text(request.path)}`)
    }
    const resolved = resolveInsideRoot(authorized.root, `${ROLEPLAY_DIR}/${bookId}/素材/${text(request.path)}`)
    if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
    const ext = extname(resolved.path).toLowerCase()
    if (ext !== '.png' && ext !== '.mp3') {
      return sendError(res, apiErrors.INVALID_ENTRY, `素材只收 .png（立绘）与 .mp3（BGM）：${text(request.path)}`)
    }
    let stats
    try {
      stats = statSync(resolved.path)
    } catch {
      return sendError(res, apiErrors.NOT_FOUND, `素材不存在：${text(request.path)}`)
    }
    if (!stats.isFile() || stats.size > DEDUCE_ASSET_MAX) {
      return sendError(res, apiErrors.INVALID_ENTRY, `素材不是文件或超过 16MB：${text(request.path)}`)
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

  async function deduceAssetPut(ctx) {
    const { res, request, allowlist } = ctx
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const resolvedBookId = await resolveBookId(authorized.root, request.bookId)
    const bookId = safeDeduceBookId(resolvedBookId)
    const rawPath = text(request.path)
    // path 是素材库内相对路径；先单独拦盘符/UNC/根路径，不能依赖拼接后藏在路径中段的盘符。
    if (rawPath.includes(':') || rawPath.includes('\0') || /^[\\/]/u.test(rawPath)) {
      return sendError(res, apiErrors.PATH_ESCAPE, `素材路径不合法或越出库根：${rawPath}`)
    }
    // 再显式拦住 bookId 的逃逸语义；safeDeduceBookId 不能把 ../ 静默改名成可写目录。
    if (text(resolvedBookId).includes(':') || /[\\/]/u.test(text(resolvedBookId)) || text(resolvedBookId).includes('\0')) {
      return sendError(res, apiErrors.PATH_ESCAPE, `素材 bookId 不合法：${text(resolvedBookId)}`)
    }
    // 先过库根解析，再用 exactly-two-segments 白名单钉在 素材/{角色,场景,bgm}/<file>。
    const resolved = resolveInsideRoot(authorized.root, `${ROLEPLAY_DIR}/${bookId}/素材/${rawPath}`)
    if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
    const kind = deduceAssetKind(resolved.relative.slice(`${ROLEPLAY_DIR}/${bookId}/素材/`.length))
    if (!kind) {
      return sendError(res, apiErrors.INVALID_ENTRY, `素材只收 角色/*.png、场景/*.png、bgm/*.mp3：${rawPath}`)
    }
    const bytes = decodeDeduceAsset(request.dataBase64)
    if (!bytes) return sendError(res, apiErrors.INVALID_ENTRY, 'dataBase64 必须是严格标准 base64，解码后非空且不超过 16MB')
    if (bytes.length > DEDUCE_ASSET_MAX) return sendError(res, apiErrors.INVALID_ENTRY, '素材超过 16MB 上限')
    if (!hasDeduceAssetSignature(kind, bytes)) {
      return sendError(res, apiErrors.INVALID_ENTRY, `素材签名与 ${kind.ext} 扩展名不符`)
    }

    // 校验全部通过后才允许任何 I/O；已有文件缺省冲突，不读、不备份、不落盘。
    let before = null
    if (existsSync(resolved.path)) {
      if (request.overwrite !== true) {
        return sendError(res, apiErrors.INVALID_ENTRY, `素材已存在（默认不覆盖）：${rawPath}`)
      }
      try {
        const stats = statSync(resolved.path)
        if (!stats.isFile()) return sendError(res, apiErrors.INVALID_ENTRY, `素材目标不是文件：${rawPath}`)
        before = await readFile(resolved.path)
      } catch (error) {
        return sendError(res, apiErrors.WRITE_PROTOCOL_IO_FAILED, `读取旧素材失败：${text(error?.message || error)}`)
      }
    }

    let backup = ''
    try {
      if (before) {
        const backupPath = deduceAssetHistoryPath(resolved.path)
        await mkdir(dirname(backupPath), { recursive: true })
        await writeFile(backupPath, before)
        backup = relativeAssetPath(authorized.root, backupPath)
      }
      await mkdir(dirname(resolved.path), { recursive: true })
      await atomicWriteFile(resolved.path, bytes)
    } catch (error) {
      return sendError(res, apiErrors.WRITE_PROTOCOL_IO_FAILED, `素材写入失败：${text(error?.message || error)}`)
    }

    let logError = ''
    let changeId = ''
    try {
      // Buffer 原样交给日志通道：只落 hash/字节，不把二进制全文转成 UTF-8 文本。
      const logged = await recordChange({
        root: authorized.root,
        module: LOG_MODULES.roleplay,
        file: resolved.relative,
        op: before ? 'update' : 'create',
        before: before ?? Buffer.alloc(0),
        after: bytes,
        actor: 'agent',
        backup,
        meta: { bookId, mediaType: kind.mediaType, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') }
      })
      if (logged.ok === false) logError = logged.message
      else if (logged.record) changeId = `${logged.path}#${logged.record.afterHash}`
    } catch (error) {
      logError = `写素材变更日志失败：${text(error?.message || error)}`
    }
    const sha256 = createHash('sha256').update(bytes).digest('hex')
    return sendJson(res, 200, {
      ok: true,
      path: resolved.relative,
      bytes: bytes.length,
      mediaType: kind.mediaType,
      sha256,
      ...(backup ? { backup } : {}),
      ...(changeId ? { changeId } : {}),
      ...(logError ? { logError } : {})
    })
  }

  return {
    deducePresent,
    deduceOpeningGet,
    deduceSettle,
    deduceSessionGet,
    deduceSessionPut,
    deduceArchive,
    deduceTurn,
    roleplayOpeningGet,
    roleplayTurn,
    deduceExport,
    deducePromote,
    deducePendingSettle,
    deduceSessionsGet,
    deduceSessionManage,
    deduceBranch,
    deduceAssets,
    deduceAssetFile,
    deduceAssetPut
  }
}
