/**
 * 推演会话存储层（OS-61）——「文游」体验的数据容器：拍 → 章缓存区 → 归档。
 *
 * 与 deduceEngine.mjs 的分工：引擎管「这一拍怎么推」（Pinax vendor 链），
 * 本模块管「推出来的拍怎么攒」——每拍一个节点，约一章结束后归档成 markdown，
 * 成文由作者确认后再回合入其他模块（P2/P3 的事，这里只备容器）。
 *
 * 存储：库内 `推演/<bookId>/session.json`（原子写＋.history 备份，与正文/习惯表同一可逆语义）。
 * 归档：`推演/<bookId>/归档/第N章.md`。不碰 .pinax，不碰 vendor。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'

export const DEDUCE_SESSION_SCHEMA = 'openstory.deduce-session/v1'
export const DEDUCE_SESSION_DIR = '推演'

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

/** 待确认事实卡（OS-82 回填闭环）：结算产物不自动落库，作者确认后才写进拆解。
 *  归一只保形状：数组照收、非数组清空——条目本体是内核 settle 产出的合法 fact 条目，不做二次校验。 */
function normalizePending(raw) {
  return Array.isArray(raw) ? raw.filter((item) => item && typeof item === 'object') : []
}

/**
 * 归一校验（PUT 整存与读取共用）：schema 对、nodes 是数组才收；
 * bookId 以调用方给的为准（存哪个库的路径就记哪个库），缺省字段补默认值。
 * 形状不对返回 null（不抛）。
 */
export function normalizeDeduceSession(input, bookId = '') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null
  if (input.schema !== DEDUCE_SESSION_SCHEMA) return null
  if (!Array.isArray(input.nodes)) return null
  return {
    schema: DEDUCE_SESSION_SCHEMA,
    bookId: text(bookId).trim() || text(input.bookId).trim() || 'default',
    branchId: text(input.branchId).trim() || 'main',
    cursor: Number.isSafeInteger(input.cursor) && input.cursor >= 0 ? input.cursor : 0,
    nodes: input.nodes,
    buffer: normalizeBuffer(input.buffer),
    archived: Array.isArray(input.archived) ? input.archived : [],
    pending: normalizePending(input.pending)
  }
}

/** 读会话：无档/坏档/形状不对都返回 null（空态是合法形态，不报错）。 */
export function loadDeduceSession(root, bookId) {
  const path = deduceSessionPath(root, bookId)
  if (!existsSync(path)) return null
  try {
    return normalizeDeduceSession(JSON.parse(readFileSync(path, 'utf-8')), bookId)
  } catch {
    return null
  }
}

/**
 * 原子写（tmp＋rename）＋写前备份到 `推演/<bookId>/.history/`。
 * 失败返回 { ok:false, code, message }，不抛（调用方按契约码透传）。
 */
export async function saveDeduceSession(root, bookId, session) {
  const path = deduceSessionPath(root, bookId)
  try {
    await mkdir(dirname(path), { recursive: true })
    let backup = null
    if (existsSync(path)) {
      const backupPath = join(dirname(path), '.history', `session-${Date.now()}.json`)
      await mkdir(dirname(backupPath), { recursive: true })
      await writeFile(backupPath, readFileSync(path))
      backup = relativeTo(root, backupPath)
    }
    const tmp = `${path}.tmp-${Date.now()}`
    await writeFile(tmp, JSON.stringify(session, null, 2), 'utf-8')
    await rename(tmp, path)
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
    const tmp = `${absPath}.tmp-${Date.now()}`
    await writeFile(tmp, content, 'utf-8')
    await rename(tmp, absPath)
    return { ok: true, backup }
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `归档写入失败：${text(error?.message || error)}` }
  }
}

/**
 * 归档一章：缓存区里的拍整理成 markdown（`# 第N章 标题`＋每拍一节，节内是正文或候选摘要），
 * 写到 `推演/<bookId>/归档/第N章.md`，记入 archived、清缓存区、会话落盘。
 * 返回 { ok, path, words }；缓存区为空或写盘失败＝ok:false（不抛）。
 */
/**
 * 旧引擎会话 → 新会话层的一次性桥接（OS-62）。
 *
 * 背景：OS-61 之前推演状态在 `.openstory/deduce/<bookId>.json`（引擎自己的 sessionState），
 * OS-61 之后「拍 → 章」的容器在 `推演/<bookId>/session.json`。两层没打通，导致老库的
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