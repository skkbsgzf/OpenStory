/**
 * 同源版本检查 ＋ 外部变更检测（OS-107）。
 *
 * 两件事：
 *   A) `checkSameSource()` —— **纯函数，不碰磁盘**：拆解 fact 的修改时间、兄弟 wiki 的
 *      生成时间、参考笔记最新 mtime 三者摆在一起，回答两个问题：
 *      「派生档是不是比 fact 旧」（wikiStale）与「参考笔记最新改动是什么时候」。
 *
 *   **对齐口径：一律用时间戳**（OS-114）。revision 是内核内部计数器，作者看不懂
 *   「revision 1 与 4 差几版」；真实写作是频繁小改，需要的是「谁比谁新」。
 *   B) `snapshotAndDiff()` —— 唯一读盘入口：读 `<库>/.pinax/sync-state.json` 的上次快照，
 *      与本次正文快照比对，捞出「hash 变了、但变更日志里没有对应记录」的文件
 *      （＝绕过了写通道被外部改过），然后原子写回新快照（OS-138 归一 hostWrite.atomicWriteFile）。
 *
 * 判定口径（与 AGENTS.md 第 10 条对齐——每一次修改都必须留 log）：
 *   · 上次快照里没有该文件           → `firstSeen`（第一次见到，不是外部改动）；
 *   · hash 变了 且 (没有 log 或 mtime 晚于最近一条 log) → `externalChanges`；
 *   · hash 没变                      → 什么都不报（正常保存过、或压根没动）。
 *
 * 零 npm 依赖；hash 复用 `changelog.mjs` 的 `contentHash()`，不在本模块重写一套指纹。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { contentHash } from '../protocol/changelog.mjs'
import { atomicWriteFile } from '../protocol/hostWrite.mjs'

/** 库内固定位置（AGENTS.md 第 9 条：界面/状态类数据都落 `.pinax/` 下）。 */
export const SYNC_STATE_PATH = '.pinax/sync-state.json'

const text = (value) => String(value ?? '')

/** ISO 别名：Date/数字/可解析字符串都收敛成 `toISOString()`；解析不了原样留着（不编时间）。 */
function isoOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (typeof value === 'number') return Number.isFinite(value) ? new Date(value).toISOString() : null
  const raw = text(value).trim()
  if (!raw) return null
  const parsed = Date.parse(raw)
  return Number.isFinite(parsed) ? new Date(parsed).toISOString() : raw
}

/** mtime 是否严格晚于 loggedAt。任一侧缺失/不可解析＝判不了，按「不晚」处理（不冤枉写通道）。 */
function isLaterThan(mtime, loggedAt) {
  if (!mtime || !loggedAt) return false
  const left = Date.parse(text(mtime))
  const right = Date.parse(text(loggedAt))
  if (Number.isFinite(left) && Number.isFinite(right)) return left > right
  return text(mtime) > text(loggedAt) // 兜底：同为 ISO 串时字典序＝时间序
}

/**
 * A) 同源检查（纯函数，不读盘、不写盘）。
 *
 * @param {object} opts
 * @param {string} [opts.root]               库根——只作调用方对称（本函数不碰磁盘），不参与计算
 * @param {number} [opts.factRevision]       拆解主档顶层 revision；非安全整数时按条目数兜底（有条目＝1，没有＝0）
 * @param {object|null} [opts.wikiDerivedFrom] 兄弟 `<id>.wiki.json` 的 `derivedFrom`
 * @param {string|Date|number|null} [opts.refsMtimeMax] 参考笔记最新 mtime
 * @param {Array} [opts.entries]             主档 entries（只用于 revision 缺省时的兜底判定）
 * @returns {{factRevision:number, wikiFactRevision:number|null, wikiStale:boolean, wikiNote:string, refsNewerThan:string|null}}
 */
export function checkSameSource({
  root = '',
  factMtime = null,
  wikiGeneratedAt = null,
  refsMtimeMax = null,
  chaptersMtimeMax = null,
  factRevision,
  entries = []
} = {}) {
  void root // 纯函数：root 只为与 snapshotAndDiff 的调用形状对称，这里不读盘
  const entryList = Array.isArray(entries) ? entries : []

  // revision 只作诊断字段保留（内核语义），不再参与「过期」判定
  const given = Number(factRevision)
  const revision = Number.isSafeInteger(given) && given >= 0
    ? given
    : (entryList.length ? 1 : 0)

  const factAt = isoOrNull(factMtime)
  const wikiAt = isoOrNull(wikiGeneratedAt)
  const refsAt = isoOrNull(refsMtimeMax)
  const chaptersAt = isoOrNull(chaptersMtimeMax)

  // 时间戳比较（OS-114）：同一次写入会连写主档＋派生档，两者 mtime 常只差几毫秒到几秒，
  // 不能判过期。容差 5 秒内一律算「同批写入」。
  const TOLERANCE_MS = 5_000
  const ms = (iso) => {
    const t = Date.parse(String(iso ?? ''))
    return Number.isFinite(t) ? t : null
  }
  const newer = (a, b) => {
    const ta = ms(a)
    const tb = ms(b)
    if (ta === null || tb === null) return null
    return ta - tb > TOLERANCE_MS
  }

  // wiki 过期：fact 比 wiki 新 = 派生档落后
  const factNewerThanWiki = newer(factAt, wikiAt)
  const wikiStale = factNewerThanWiki === true

  // 正文比 fact 新 = 拆解可能没跟上正文（提示，不判错）
  const chaptersNewerThanFact = newer(chaptersAt, factAt)

  // 参考笔记比 fact 新 = 跟 fact 无关（笔记是手写设定，随时改），只作展示

  let wikiNote = '无派生档'
  if (!wikiAt) {
    wikiNote = factAt ? '还没有派生档（跑 enrich 生成）' : '无派生档'
  } else if (!factAt) {
    wikiNote = '派生档有生成时间，fact 无修改时间（异常）'
  } else if (wikiStale) {
    wikiNote = `派生档生成于 ${fmt(wikiAt)}，事实源改于 ${fmt(factAt)}——派生档落后，建议重新生成`
  } else {
    wikiNote = `一致（派生档 ${fmt(wikiAt)}，事实源 ${fmt(factAt)}）`
  }

  const chaptersNote = chaptersNewerThanFact === true
    ? `正文最新改动 ${fmt(chaptersAt)}，晚于事实源 ${fmt(factAt)}——拆解可能没跟上`
    : ''

  return {
    // 时间戳（新口径：唯一判定依据）
    factAt,
    wikiAt,
    refsAt,
    chaptersAt,
    // 派生档状态
    wikiStale,
    wikiNote,
    factNewerThanWiki,
    chaptersNewerThanFact,
    chaptersNote,
    // 兼容旧调用方（诊断用，不再参与判定）
    factRevision: revision,
    wikiFactRevision: null,
    refsNewerThan: refsAt
  }
}

/** ISO 时间 → 人类可读（月-日 时:分），解析失败原样返回。 */
function fmt(iso) {
  const t = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(t)) return String(iso ?? '')
  const d = new Date(t)
  const pad = (n) => String(n).padStart(2, '0')
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`
}

/** 快照文件绝对路径（库内固定位置）。 */
export function syncStateFile(root) {
  return join(text(root), ...SYNC_STATE_PATH.split('/'))
}

/** 读上次快照：缺失/坏档/形状不对一律按「空快照」——首次运行不是错误。 */
export async function readSyncState(root) {
  try {
    const parsed = JSON.parse(await readFile(syncStateFile(root), 'utf-8'))
    if (parsed && typeof parsed === 'object' && parsed.files && typeof parsed.files === 'object' && !Array.isArray(parsed.files)) {
      return { checkedAt: text(parsed.checkedAt), files: parsed.files }
    }
    return { checkedAt: '', files: {} }
  } catch {
    return { checkedAt: '', files: {} }
  }
}

/** 本次快照里某文件的 hash：调用方给了就用；没给就按库内相对路径现读现算。 */
async function hashOf(root, relPath, given) {
  const hash = text(given).trim()
  if (hash) return hash
  try {
    return contentHash(await readFile(join(root, ...relPath.split('/'))))
  } catch {
    return '' // 读不到（竞态消失/权限）＝没有可信指纹，本轮不参与比对
  }
}

/**
 * B) 读上次快照 → 与本次快照比对 → 原子写回新快照。
 *
 * @param {object} opts
 * @param {string} opts.root   库根（绝对路径）
 * @param {Array<{path:string, hash?:string, mtime:string|null, loggedAt:string|null}>} opts.files
 *        当前快照；`path` 是库内相对路径（`正文/001-xxx.md`），`loggedAt`＝该文件最近一条
 *        changelog 时间（没有就 null）
 * @returns {Promise<{externalChanges:Array<{path:string, reason:string}>, firstSeen:string[], checkedAt:string}>}
 *          快照写盘失败时抛错（带 code）——调用方必须如实报，不能假装检查过
 */
export async function snapshotAndDiff({ root, files = [] } = {}) {
  const projectRoot = text(root).trim()
  if (!projectRoot) {
    const error = new Error('snapshotAndDiff 需要一个项目根（root）')
    error.code = 'NO_LIBRARY'
    throw error
  }

  const previous = await readSyncState(projectRoot)
  const current = Array.isArray(files) ? files : []
  const externalChanges = []
  const firstSeen = []
  const stateFiles = {}

  for (const item of current) {
    const relPath = text(item?.path).trim().replaceAll('\\', '/')
    if (!relPath) continue
    const hash = await hashOf(projectRoot, relPath, item?.hash)
    const mtime = isoOrNull(item?.mtime)
    const loggedAt = isoOrNull(item?.loggedAt)
    const prev = previous.files[relPath] && typeof previous.files[relPath] === 'object'
      ? previous.files[relPath]
      : null

    if (!hash) {
      // 没有可信指纹：沿用上次记录（有的话），不产生误报。
      if (prev) stateFiles[relPath] = { hash: text(prev.hash), mtime: isoOrNull(prev.mtime), loggedAt: isoOrNull(prev.loggedAt) }
      continue
    }

    if (!prev || !text(prev.hash)) {
      // 第一次见到这个文件，或上次没留下可信指纹：不是「外部改动」，只是基线补齐。
      firstSeen.push(relPath)
    } else if (text(prev.hash) !== hash && (loggedAt === null || isLaterThan(mtime, loggedAt))) {
      // hash 变了却找不到对应的变更日志（或日志早于文件 mtime）＝绕过了写通道。
      externalChanges.push({ path: relPath, reason: '文件被改但变更日志里没有对应记录' })
    }

    stateFiles[relPath] = { hash, mtime, loggedAt }
  }

  const checkedAt = new Date().toISOString()
  const target = syncStateFile(projectRoot)
  try {
    await mkdir(dirname(target), { recursive: true })
    // OS-138：原子替换归一 hostWrite.atomicWriteFile（fsync＋rename＋目录 fsync）——
    // 半截写入永远不会被当成有效快照；失败时临时文件由写协议统一收走（原 `${tmp}.orphan`
    // 留档不再生成，临时文件名归协议内部，见 hostWrite.mjs）。
    await atomicWriteFile(target, `${JSON.stringify({ checkedAt, files: stateFiles }, null, 2)}\n`)
  } catch (error) {
    const failure = new Error(`同源快照写盘失败：${text(error?.message || error)}`)
    failure.code = 'WRITE_PROTOCOL_IO_FAILED'
    throw failure
  }

  return { externalChanges, firstSeen, checkedAt }
}
