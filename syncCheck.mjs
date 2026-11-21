/**
 * 同源版本检查 ＋ 外部变更检测（OS-107）。
 *
 * 两件事：
 *   A) `checkSameSource()` —— **纯函数，不碰磁盘**：拆解 fact 的 revision、兄弟 wiki 的
 *      `derivedFrom.factRevision`、参考笔记最新 mtime 三者摆在一起，回答两个问题：
 *      「派生档是不是基于旧 revision 算的」（wikiStale）与「参考笔记最新改动是什么时候」。
 *   B) `snapshotAndDiff()` —— 唯一读盘入口：读 `<库>/.pinax/sync-state.json` 的上次快照，
 *      与本次正文快照比对，捞出「hash 变了、但变更日志里没有对应记录」的文件
 *      （＝绕过了写通道被外部改过），然后原子写回新快照（tmp ＋ rename）。
 *
 * 判定口径（与 AGENTS.md 第 10 条对齐——每一次修改都必须留 log）：
 *   · 上次快照里没有该文件           → `firstSeen`（第一次见到，不是外部改动）；
 *   · hash 变了 且 (没有 log 或 mtime 晚于最近一条 log) → `externalChanges`；
 *   · hash 没变                      → 什么都不报（正常保存过、或压根没动）。
 *
 * 零 npm 依赖；hash 复用 `changelog.mjs` 的 `contentHash()`，不在本模块重写一套指纹。
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { contentHash } from './changelog.mjs'

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
  factRevision,
  wikiDerivedFrom = null,
  refsMtimeMax = null,
  entries = []
} = {}) {
  void root // 纯函数：root 只为与 snapshotAndDiff 的调用形状对称，这里不读盘
  const entryList = Array.isArray(entries) ? entries : []
  const given = Number(factRevision)
  const revision = Number.isSafeInteger(given) && given >= 0
    ? given
    : (entryList.length ? 1 : 0)

  const derived = wikiDerivedFrom && typeof wikiDerivedFrom === 'object' ? wikiDerivedFrom : null
  const derivedRaw = derived ? Number(derived.factRevision) : Number.NaN
  // 有派生档但 derivedFrom 里没有可用的 factRevision＝读不出基准，按「没有」处理（不假装一致）。
  const wikiFactRevision = Number.isSafeInteger(derivedRaw) && derivedRaw >= 0 ? derivedRaw : null
  // OS-113 修：derivedFrom.factRevision 的语义是「派生档所基于的那一版 fact」，
  // 而写它的时候（内核 factFileStore 与 daemon 的 import 通道）主档 revision 已被 +1，
  // 所以「wiki 的基准」与「当前 revision」天然差 1，直接比大小会永久误报过期。
  // 正确口径：派生档覆盖到 revision N，只要求 N >= 1 且不是「明显落后于多次写入」——
  // 这里用「差值 > 1」作为判定（差 1 是写入语义本身的偏移，不算过期）。
  const wikiGap = wikiFactRevision === null ? 0 : revision - wikiFactRevision
  const wikiStale = wikiFactRevision !== null && wikiGap > 1

  let wikiNote = '无派生档'
  if (wikiFactRevision !== null) {
    wikiNote = wikiStale
      ? `派生档基于 revision ${wikiFactRevision}，当前 ${revision}（落后 ${wikiGap} 版，建议重新生成）`
      : (wikiGap === 1 ? '一致（派生档随上次写入）' : '一致')
  }

  return {
    factRevision: revision,
    wikiFactRevision,
    wikiStale,
    wikiNote,
    refsNewerThan: isoOrNull(refsMtimeMax)
  }
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
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`
  try {
    await mkdir(dirname(target), { recursive: true })
    await writeFile(tmp, `${JSON.stringify({ checkedAt, files: stateFiles }, null, 2)}\n`, 'utf-8')
    await rename(tmp, target) // 原子替换：半截写入永远不会被当成有效快照
  } catch (error) {
    try { await rename(tmp, `${tmp}.orphan`) } catch { /* 临时文件清理失败不影响主结论 */ }
    const failure = new Error(`同源快照写盘失败：${text(error?.message || error)}`)
    failure.code = 'WRITE_PROTOCOL_IO_FAILED'
    throw failure
  }

  return { externalChanges, firstSeen, checkedAt }
}
