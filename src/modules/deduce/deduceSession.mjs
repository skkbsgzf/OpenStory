/**
 * 推演会话存储层（OS-61）——「文游」体验的数据容器：拍 → 章缓存区 → 归档。
 *
 * 与 deduceEngine.mjs 的分工：引擎管「这一拍怎么推」（本仓自持推演链），
 * 本模块管「推出来的拍怎么攒」——每拍一个节点，约一章结束后归档成 markdown，
 * 成文由作者确认后再回合入其他模块（P2/P3 的事，这里只备容器）。
 *
 * 存储：库内 `扮演/<bookId>/session.json`（原子写＋.history 备份，与正文/习惯表同一可逆语义）。
 * 归档：`扮演/<bookId>/归档/第N章.md`。不碰旧元数据目录，不碰已退役的 vendor。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { LOG_MODULES, namingEntry } from '../../protocol/naming.mjs' // OS-148：目录名/日志模块名只从命名表取

export const DEDUCE_SESSION_SCHEMA = 'openstory.deduce-session/v1'
/** 会话目录名（命名表 roleplay 行的 dir——当前正名为「扮演」）。 */
export const DEDUCE_SESSION_DIR = namingEntry('roleplay').dir

function text(value) {
  return String(value ?? '')
}

/** bookId 安全化：与 deduceEngine.deduceStatePath 同口径（只留 \w-，截 64 位）。 */
export function safeDeduceBookId(bookId) {
  return text(bookId).replace(/[^\w-]/gu, '_').slice(0, 64) || 'default'
}

/** 会话文件路径（库内）。 */
export function deduceSessionPath(root, bookId) {
  return join(root, DEDUCE_SESSION_DIR, safeDeduceBookId(bookId), 'session.json')
}

/**
 * 会话文件路径（OS-86 多局并存）：sessionId='main' 就是既有 session.json（legacy 主线，
 * 零迁移），其余会话落 扮演/<bookId>/sessions/<sid>.json——一个库可以同时养好几局
 * 平行世界（不同前提/POV/种子），切换走激活指针而不是覆盖文件。
 */
export function deduceSessionFile(root, bookId, sessionId = '') {
  const safe = safeDeduceBookId(bookId)
  const sid = text(sessionId).trim() || 'main'
  if (sid === 'main') return join(root, DEDUCE_SESSION_DIR, safe, 'session.json')
  return join(root, DEDUCE_SESSION_DIR, safe, 'sessions', `${sid}.json`)
}

/** 激活指针（OS-86）：扮演/<bookId>/active.json = { id }；没有/坏档回落 'main'。 */
export function deduceActivePath(root, bookId) {
  return join(root, DEDUCE_SESSION_DIR, safeDeduceBookId(bookId), 'active.json')
}

function relativeTo(root, absPath) {
  return relative(root, absPath).split(sep).join('/')
}

/** 一拍的字数：有正文算正文，没正文算候选摘要（缓存区攒的是「这一拍值多少字」）。 */
function nodeWords(node) {
  const prose = text(node?.prose)
  if (prose.trim()) return prose.length
  const candidates = Array.isArray(node?.candidates) ? node.candidates : []
  return candidates.reduce((sum, candidate) => sum + text(candidate?.text).length, 0)
}

function normalizeBuffer(raw) {
  const buffer = raw && typeof raw === 'object' ? raw : {}
  return {
    chapterNo: Number.isSafeInteger(buffer.chapterNo) && buffer.chapterNo > 0 ? buffer.chapterNo : 1,
    nodes: Array.isArray(buffer.nodes) ? buffer.nodes : [],
    words: Number.isFinite(Number(buffer.words)) && Number(buffer.words) >= 0 ? Number(buffer.words) : 0
  }
}

/** 滚动摘要（OS-102）：{ text, coveredToRound, updatedAt }——浓缩到第 coveredToRound 拍为止的剧情。 */
function normalizeRolling(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const text = String(raw.text ?? '').trim()
  if (!text) return null
  const covered = Number(raw.coveredToRound)
  return {
    text: text.slice(0, 4000),
    coveredToRound: Number.isSafeInteger(covered) && covered >= 0 ? covered : 0,
    updatedAt: String(raw.updatedAt ?? '') || new Date().toISOString()
  }
}

/** 待确认事实卡（OS-82 回填闭环）：结算产物不自动落库，作者确认后才写进故事源。
 *  归一只保形状：数组照收、非数组清空——条目本体是内核 settle 产出的合法 fact 条目，不做二次校验。 */
function normalizePending(raw) {
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : []
}

/**
 * 归一校验（PUT 整存与读取共用）：schema 对、nodes 是数组才收；
 * bookId 以调用方给的为准（存哪个库的路径就记哪个库），缺省字段补默认值。
 * 形状不对返回 null（不抛）。sessionId/title 随会话走（OS-86 多局）。
 */
export function normalizeDeduceSession(input, bookId = '', sessionId = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (input.schema !== DEDUCE_SESSION_SCHEMA) return null
  if (!Array.isArray(input.nodes)) return null
  return {
    schema: DEDUCE_SESSION_SCHEMA,
    bookId: text(bookId).trim() || text(input.bookId).trim() || 'default',
    sessionId: text(sessionId).trim() || text(input.sessionId).trim() || 'main',
    title: text(input.title).trim() || '主线',
    branchId: text(input.branchId).trim() || 'main',
    cursor: Number.isSafeInteger(input.cursor) && input.cursor >= 0 ? input.cursor : 0,
    nodes: input.nodes,
    buffer: normalizeBuffer(input.buffer),
    archived: Array.isArray(input.archived) ? input.archived : [],
    pending: normalizePending(input.pending),
    // OS-102 长期记忆：滚动摘要（每 N 拍压缩一次）——跑长了 agent 不会忘前情
    rollingSummary: normalizeRolling(input.rollingSummary)
  }
}

/** 读会话：无档/坏档/形状不对都返回 null（空态是合法形态，不报错）。 */
export function loadDeduceSession(root, bookId, sessionId = '') {
  const path = deduceSessionFile(root, bookId, sessionId)
  if (!existsSync(path)) return null
  try {
    return normalizeDeduceSession(JSON.parse(readFileSync(path, 'utf-8')), bookId, sessionId)
  } catch {
    return null
  }
}

/** 读激活会话 id（OS-86）：指针缺省/坏档/指向不存在的会话都回落 'main'。 */
export function readActiveSessionId(root, bookId) {
  const path = deduceActivePath(root, bookId)
  let id = 'main'
  if (existsSync(path)) {
    try { id = text(JSON.parse(readFileSync(path, 'utf-8'))?.id).trim() || 'main' } catch { id = 'main' }
  }
  if (id !== 'main' && !existsSync(deduceSessionFile(root, bookId, id))) return 'main'
  return id
}

/** 写激活指针（原子写）。失败返回 { ok:false }，不抛——激活指针丢了对旧版只是回落主线。 */
export async function writeActiveSessionId(root, bookId, sessionId) {
  const sid = text(sessionId).trim() || 'main'
  const path = deduceActivePath(root, bookId)
  try {
    await mkdir(dirname(path), { recursive: true })
    await atomicWriteFile(path, JSON.stringify({ id: sid }, null, 2))
    return { ok: true }
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `激活指针写入失败：${text(error?.message || error)}` }
  }
}

/** 单会话轻量摘要（列表用）：读全文取 meta——会话文件都是小档，不值得另建索引。 */
function sessionMeta(root, bookId, sid) {
  const session = loadDeduceSession(root, bookId, sid)
  if (!session) return null
  const words = (session.buffer?.nodes ?? []).reduce((sum, item) => sum + nodeWords(item), 0)
  return {
    id: sid,
    title: text(session.title) || (sid === 'main' ? '主线' : sid),
    rounds: (session.nodes ?? []).length,
    words,
    branchId: text(session.branchId) || 'main',
    pending: (session.pending ?? []).length,
    hasSummary: Boolean(session.rollingSummary?.text)
  }
}

/**
 * 列会话（OS-86）：主线（legacy，哪怕文件还没有也占位）＋ sessions/ 目录全部。
 * 返回 { activeId, sessions: [meta] }——主线永远排最前，其余按文件名倒序（新局在上）。
 */
export function listDeduceSessions(root, bookId) {
  const safe = safeDeduceBookId(bookId)
  const dir = join(root, DEDUCE_SESSION_DIR, safe, 'sessions')
  const extra = []
  try {
    for (const name of readdirSync(dir)) {
      if (name.endsWith('.json')) extra.push(name.replace(/\.json$/u, ''))
    }
  } catch { /* 没有 sessions 目录＝只有主线 */ }
  // 新局在上：s-<时间36进制> 定宽前缀，倒序即建局倒序
  extra.sort((a, b) => b.localeCompare(a))
  const sessions = ['main', ...extra]
    .map((sid) => {
      // 主线还没有文件也占位——列表永远能看见主线，进推演页就有落点
      if (sid === 'main' && !existsSync(deduceSessionFile(root, bookId, 'main'))) {
        return { id: 'main', title: '主线', rounds: 0, words: 0, branchId: 'main', pending: 0 }
      }
      return sessionMeta(root, bookId, sid)
    })
    .filter(Boolean)
  return { activeId: readActiveSessionId(root, bookId), sessions }
}

/** 新局 id：s-<时间36进制>-<随机4位>——文件名安全、排序即建局顺序。 */
function newSessionId() {
  return `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

/**
 * 新开一局（OS-86）：空会话落 sessions/<sid>.json 并激活。title 缺省＝「第N局」。
 * 返回 { ok, sessionId, session }。
 */
export async function createDeduceSession(root, bookId, { title = '' } = {}) {
  const sid = newSessionId()
  const safe = safeDeduceBookId(bookId)
  const dir = join(root, DEDUCE_SESSION_DIR, safe, 'sessions')
  const existing = (() => { try { return readdirSync(dir).filter((n) => n.endsWith('.json')).length } catch { return 0 } })()
  const session = normalizeDeduceSession({
    schema: DEDUCE_SESSION_SCHEMA,
    title: text(title).trim() || `第${existing + 1}局`,
    nodes: []
  }, bookId, sid)
  const saved = await saveDeduceSession(root, bookId, session)
  if (!saved.ok) return saved
  const active = await writeActiveSessionId(root, bookId, sid)
  if (!active.ok) return active
  return { ok: true, sessionId: sid, session }
}

/**
 * 删除一局（OS-86）：非破坏——文件挪 扮演/<bookId>/.deleted/sessions/<sid>-<ts>.json。
 * 主线可以删吗？可以——但删到一份都不剩时拒绝（推演页不能开天窗）；
 * 删的是当前激活局时，激活指针回落到还存在的第一局（主线优先）。
 */
export async function deleteDeduceSession(root, bookId, sessionId) {
  const sid = text(sessionId).trim()
  if (!sid) return { ok: false, code: 'INVALID_ENTRY', message: 'sessionId 必填' }
  const { activeId, sessions } = listDeduceSessions(root, bookId)
  if (sessions.length <= 1) {
    return { ok: false, code: 'INVALID_ENTRY', message: '这是最后一局了——不能删（要清空就用「重新开局」）' }
  }
  const file = deduceSessionFile(root, bookId, sid)
  if (!existsSync(file)) return { ok: false, code: 'NOT_FOUND', message: `会话不存在：${sid}` }
  const safe = safeDeduceBookId(bookId)
  const trashDir = join(root, DEDUCE_SESSION_DIR, safe, '.deleted', 'sessions')
  const trashPath = join(trashDir, `${sid}-${Date.now()}.json`)
  try {
    await mkdir(trashDir, { recursive: true })
    await rename(file, trashPath)
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `会话删除失败：${text(error?.message || error)}` }
  }
  let nextActive = activeId
  if (activeId === sid) {
    nextActive = sessions.find((m) => m.id !== sid && m.id === 'main')?.id
      ?? sessions.find((m) => m.id !== sid)?.id ?? 'main'
    await writeActiveSessionId(root, bookId, nextActive)
  }
  return { ok: true, deleted: sid, activeId: nextActive, trash: trashPath }
}

/**
 * 原子写（tmp＋rename）＋写前备份到 `扮演/<bookId>/.history/`。
 * 落点按 session.sessionId 分档（OS-86：main＝legacy session.json，其余 sessions/<sid>.json）。
 * 失败返回 { ok:false, code, message }，不抛（调用方按契约码透传）。
 */
export async function saveDeduceSession(root, bookId, session) {
  const path = deduceSessionFile(root, bookId, session?.sessionId)
  try {
    await mkdir(dirname(path), { recursive: true })
    let backup = null
    let beforeText = ''
    let existed = false
    if (existsSync(path)) {
      const sid = text(session?.sessionId).trim() || 'main'
      const backupPath = join(dirname(path), '.history', `session-${sid}-${Date.now()}.json`)
      await mkdir(dirname(backupPath), { recursive: true })
      const prev = readFileSync(path)
      beforeText = prev.toString('utf-8')
      existed = true
      await writeFile(backupPath, prev)
      backup = relativeTo(root, backupPath)
    }
    const nextText = JSON.stringify(session, null, 2)
    await atomicWriteFile(path, nextText)
    // OS-89：推演会话每次落盘都留 diff + log（AGENTS.md 第 10/11 条：
    // 推演中未被采纳的拍同样是本地数据，改动必须可追溯）
    try {
      const { recordChange } = await import('../../protocol/changelog.mjs')
      await recordChange({
        root,
        module: LOG_MODULES.roleplay,
        file: relativeTo(root, path).split('\\').join('/'),
        op: existed ? 'update' : 'create',
        before: beforeText,
        after: nextText,
        actor: 'author',
        meta: { bookId, sessionId: text(session?.sessionId) || 'main' }
      })
    } catch { /* 日志失败不阻断会话保存 */ }
    return { ok: true, backup }
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `推演会话写入失败：${text(error?.message || error)}` }
  }
}

/**
 * 推一拍：节点进 nodes、cursor+1、当前分支的拍进缓存区（字数累加）。
 * 别的分支的拍只进 nodes 不进缓存区——分支之间互不干扰。
 */
export function appendNode(session, node) {
  session.cursor = (Number.isSafeInteger(session.cursor) ? session.cursor : 0) + 1
  const normalized = {
    id: text(node?.id) || `n${session.cursor}-${Date.now().toString(36)}`,
    round: Number.isSafeInteger(node?.round) ? node.round : session.cursor,
    branchId: text(node?.branchId).trim() || session.branchId || 'main',
    parentId: text(node?.parentId),
    choiceId: text(node?.choiceId),
    scene: {
      who: text(node?.scene?.who),
      where: text(node?.scene?.where),
      tension: text(node?.scene?.tension),
      hook: text(node?.scene?.hook)
    },
    candidates: (Array.isArray(node?.candidates) ? node.candidates : []).map((candidate, index) => ({
      id: text(candidate?.id) || `c${index}`,
      source: text(candidate?.source),
      text: text(candidate?.text)
    })),
    prose: text(node?.prose),
    events: Array.isArray(node?.events) ? node.events : [],
    createdAt: text(node?.createdAt) || new Date().toISOString()
  }
  session.nodes.push(normalized)
  if (!session.buffer) session.buffer = normalizeBuffer(null)
  if (normalized.branchId === (session.branchId || 'main')) {
    session.buffer.nodes.push(normalized)
    session.buffer.words += nodeWords(normalized)
  }
  return normalized
}

/** 开一章的缓存区：章号给定，拍与字数清零。 */
export function startChapterBuffer(session, chapterNo) {
  session.buffer = {
    chapterNo: Number.isSafeInteger(chapterNo) && chapterNo > 0 ? chapterNo : 1,
    nodes: [],
    words: 0
  }
  return session.buffer
}

/** 清缓存区（章号保留）：归档后或作者主动丢弃时用。 */
export function clearChapterBuffer(session) {
  if (!session.buffer) session.buffer = normalizeBuffer(null)
  session.buffer.nodes = []
  session.buffer.words = 0
  return session.buffer
}

/**
 * 切分支（P3 用）：只改当前分支与 cursor——cursor 落到目标分支最后一拍的拍号，
 * 没有拍就归零。nodes 全量保留，两条分支的拍互不干扰。
 */
export function switchBranch(session, branchId) {
  const target = text(branchId).trim() || 'main'
  session.branchId = target
  const rounds = (Array.isArray(session.nodes) ? session.nodes : [])
    .filter((node) => (text(node?.branchId) || 'main') === target)
    .map((node) => Number(node?.round) || 0)
  session.cursor = rounds.length ? Math.max(...rounds) : 0
  return session
}

/** 文本原子写＋同目录 .history 备份（归档 md 用；失败返回 ok:false 不抛）。 */
async function writeTextWithBackup(root, absPath, content) {
  try {
    await mkdir(dirname(absPath), { recursive: true })
    let backup = null
    if (existsSync(absPath)) {
      const backupPath = join(dirname(absPath), '.history', `${Date.now()}-${absPath.split(/[\\/]/u).pop()}`)
      await mkdir(dirname(backupPath), { recursive: true })
      await writeFile(backupPath, readFileSync(absPath))
      backup = relativeTo(root, backupPath)
    }
    await atomicWriteFile(absPath, content)
    return { ok: true, backup }
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `归档写入失败：${text(error?.message || error)}` }
  }
}

/**
 * 归档一章：缓存区里的拍整理成 markdown（`# 第N章 标题`＋每拍一节，节内是正文或候选摘要），
 * 写到 `扮演/<bookId>/归档/第N章.md`，记入 archived、清缓存区、会话落盘。
 * 返回 { ok, path, words }；缓存区为空或写盘失败＝ok:false（不抛）。
 */
/**
 * 旧引擎会话 → 新会话层的一次性桥接（OS-62）。
 *
 * 背景：OS-61 之前推演状态在 `.openstory/deduce/<bookId>.json`（引擎自己的 sessionState），
 * OS-61 之后「拍 → 章」的容器在 `扮演/<bookId>/session.json`。两层没打通，导致老库的
 * 推演历史在剧情树里看不到（树读新层，旧层有 round 却没有 nodes）。
 *
 * 口径：**只补历史，不动旧档**。把旧状态里的 lastTurn（最后一面：局面卡＋候选＋张力）
 * 与它的 round 一起，作为新层的第一个节点插进去，prose 留空（旧层没存正文）。
 * 重复调用幂等：已有节点的 round 与旧状态相同就不插。
 */
export function importLegacyDeduce({ legacyState, session, bookId = '' } = {}) {
  const legacy = legacyState && typeof legacyState === 'object' ? legacyState : null
  if (!legacy) return { ok: false, code: 'NO_LEGACY_STATE', imported: false, added: 0 }
  const round = Number(legacy.round)
  if (!Number.isSafeInteger(round) || round <= 0) {
    return { ok: false, code: 'NO_LEGACY_ROUND', imported: false, added: 0 }
  }
  const current = session || normalizeDeduceSession({
    schema: DEDUCE_SESSION_SCHEMA,
    bookId,
    branchId: 'main',
    cursor: 0,
    nodes: [],
    buffer: { chapterNo: 1, nodes: [], words: 0 },
    archived: []
  }, bookId)
  if (!current) return { ok: false, code: 'BAD_SESSION', imported: false, added: 0 }

  // 幂等：同一 round 的节点已经在（不论分支）就不重复导入
  const exists = (current.nodes || []).some((node) => Number(node?.round) === round)
  if (exists) return { ok: true, imported: false, added: 0, session: current, reason: 'already-imported' }

  const last = legacy.lastTurn && typeof legacy.lastTurn === 'object' ? legacy.lastTurn : {}
  const sceneCard = last.sceneCard && typeof last.sceneCard === 'object' ? last.sceneCard : {}
  const candidates = Array.isArray(last.candidates) ? last.candidates : []
  const node = {
    id: `legacy-${round}`,
    round,
    branchId: 'main',
    parentId: '',
    choiceId: '',
    scene: {
      who: Array.isArray(sceneCard.who) ? sceneCard.who.filter(Boolean) : [],
      where: text(sceneCard.where),
      tension: text(sceneCard.tension),
      hook: text(sceneCard.hook)
    },
    candidates: candidates.map((item, index) => ({
      id: text(item?.id) || `legacy-${round}-${index}`,
      source: text(item?.source),
      text: text(item?.text)
    })),
    prose: '',
    events: [],
    createdAt: new Date().toISOString(),
    importedFrom: 'legacy-deduce-state'
  }
  // 不走 appendNode：它按「引擎实时产出的节点」形状重建对象，会把 who 数组压成字符串、
  // 也会丢掉 importedFrom 标记。桥接直接按会话层的规范形状推入，语义与 appendNode 一致
  // （cursor+1、进 buffer、字数累加）。
  current.cursor = (Number.isSafeInteger(current.cursor) ? current.cursor : 0) + 1
  if (!current.buffer) current.buffer = normalizeBuffer(null)
  current.nodes.push(node)
  current.buffer.nodes.push(node)
  return { ok: true, imported: true, added: 1, session: current, round, nodeId: node.id }
}

export async function archiveChapter(root, session, { title = '' } = {}) {
  const buffer = session?.buffer
  if (!buffer || !Array.isArray(buffer.nodes) || buffer.nodes.length === 0) {
    return { ok: false, code: 'INVALID_ENTRY', message: '缓存区是空的：先攒几拍再归档' }
  }
  const chapterNo = Number.isSafeInteger(buffer.chapterNo) && buffer.chapterNo > 0
    ? buffer.chapterNo
    : ((session.archived ?? []).reduce((max, item) => Math.max(max, Number(item?.chapterNo) || 0), 0) + 1)
  const lines = [`# 第${chapterNo}章 ${text(title).trim()}`.trimEnd(), '']
  let words = 0
  for (const node of buffer.nodes) {
    lines.push(`## 第${Number(node?.round) || 0}拍`, '')
    const prose = text(node?.prose)
    if (prose.trim()) {
      lines.push(prose, '')
    } else {
      const candidates = Array.isArray(node?.candidates) ? node.candidates : []
      if (candidates.length) {
        for (const candidate of candidates) {
          lines.push(`- 【${text(candidate?.source) || '候选'}】${text(candidate?.text)}`)
        }
        lines.push('')
      } else {
        lines.push('（本拍没有正文也没有候选）', '')
      }
    }
    words += nodeWords(node)
  }
  const relPath = `${DEDUCE_SESSION_DIR}/${safeDeduceBookId(session.bookId)}/归档/第${chapterNo}章.md`
  const written = await writeTextWithBackup(root, join(root, ...relPath.split('/')), lines.join('\n'))
  if (!written.ok) return written
  if (!Array.isArray(session.archived)) session.archived = []
  session.archived.push({ chapterNo, path: relPath, words, at: new Date().toISOString() })
  clearChapterBuffer(session)
  const saved = await saveDeduceSession(root, session.bookId, session)
  if (!saved.ok) return saved
  return { ok: true, path: relPath, words }
}