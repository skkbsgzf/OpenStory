/**
 * 宿主正文写通道（OS-141 daemon 拆分）——「原子写 ＋ .history 备份 ＋ changelog 留痕」的唯一实现。
 *
 * 复用面：`PUT /api/chapter`（手工保存）、待确认卡采纳、扮演转正、世界书迁移/生图回填、
 * 变更恢复共用同一条实现，保证所有路的落盘行为完全一致（写通道收敛红线）。
 * 备份路径：同目录 `.history/<file>.bak-<时间戳>`；保留策略（OS-137）：每文件配额＋日锚，
 * 滚动删除留痕 `.openstory/log/history-prune/`。落盘一律走 hostWrite.atomicWriteFile（OS-138）。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { appendFile, copyFile, mkdir, readFile, readdir, unlink } from 'node:fs/promises'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, dirname, join, relative, sep } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import { recordChange, logFilePath } from '../../protocol/changelog.mjs'
import { logModuleForDir, namingEntry } from '../../protocol/naming.mjs' // OS-148：目录→日志模块名只从命名表取
import { API_ERROR_CODES } from '../../protocol/apiErrors.mjs'
import { resolveInsideRoot, text } from '../../protocol/rootPath.mjs'

/** 写前备份路径：同目录 `.history/<file>.bak-<时间戳>`（不覆盖旧备份）。 */
export function historyBackupPath(root, file, now = new Date()) {
  const resolved = resolveInsideRoot(root, file)
  if (!resolved.ok) return resolved
  const stamp = now.toISOString().replace(/[:.]/gu, '-')
  return {
    ok: true,
    path: join(dirname(resolved.path), '.history', `${basename(resolved.path)}.bak-${stamp}`),
    relative: `${dirname(resolved.relative)}/.history/${basename(resolved.relative)}.bak-${stamp}`.replace(/^\.\//u, '')
  }
}

/** 每个原文件的备份配额缺省：50 份。环境变量 OPENSTORY_HISTORY_KEEP 可覆盖。 */
export const HISTORY_KEEP_DEFAULT = 50

/**
 * 解析每文件备份配额。环境变量只认「纯数字且 ≥1」；解析失败/非法值（0、负数、
 * 带尾巴的数字、乱码）一律回缺省——.history 是作者的救命索，策略宁可保守。
 */
export function resolveHistoryKeepPerFile(raw = process.env.OPENSTORY_HISTORY_KEEP) {
  const trimmed = text(raw).trim()
  if (!/^[0-9]+$/u.test(trimmed)) return HISTORY_KEEP_DEFAULT
  const parsed = Number.parseInt(trimmed, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return HISTORY_KEEP_DEFAULT
  return parsed
}

/** mtime → 可比较毫秒；解析不了返回 null（调用方一律当「不能排则不能删」）。 */
function historyTime(mtime) {
  const at = mtime instanceof Date ? mtime.getTime() : new Date(mtime).getTime()
  return Number.isFinite(at) ? at : null
}

/** 自然日键（本机时区）：日锚按「天」算，不按毫秒差算。 */
function historyDayKey(at) {
  const day = new Date(at)
  return `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`
}

/**
 * OS-137：.history 保留策略（纯函数，不碰盘）。
 *
 * 规则（按保守优先排序）：
 *   1. 绝不删最新一份——每个原文件 mtime 最新的备份永远保留；
 *   2. 任何自然日至少保留该日最后一份（日锚）——高频编辑冲不掉跨天的历史；
 *   3. 每个原文件保留最新 keepPerFile 份，超出的从最旧开始删。
 * entries 是 [{ name, original, mtime }]（original＝原文件名/路径标识，mtime＝ISO 串或 Date），
 * 按 original 分组、各组独立算配额；mtime 解析不了的条目绝不进删除清单。
 * 返回应删清单（原条目对象），按 mtime 从旧到新。
 */
export function pruneHistoryBackups(entries, options = {}) {
  const keepPerFile = resolveHistoryKeepPerFile(options.keepPerFile ?? process.env.OPENSTORY_HISTORY_KEEP)
  const groups = new Map()
  for (const entry of (Array.isArray(entries) ? entries : [])) {
    if (!entry || typeof entry !== 'object') continue
    const original = text(entry.original) || text(entry.name)
    if (!groups.has(original)) groups.set(original, [])
    groups.get(original).push(entry)
  }
  const deletions = []
  for (const group of groups.values()) {
    // mtime 解析不了的先摘出去——排不了序就绝不定罪
    const valid = []
    for (const entry of group) {
      const at = historyTime(entry.mtime)
      if (at !== null) valid.push({ entry, at })
    }
    // 新→旧；时间相等再比文件名，乱序输入也有确定结果
    valid.sort((left, right) => right.at - left.at || text(left.entry.name).localeCompare(text(right.entry.name)))
    const keep = new Set()
    valid.forEach((ranked, index) => {
      if (index < keepPerFile) keep.add(ranked.entry)   // 规则 3：配额内（index 0 即最新一份）
    })
    const latestOfDay = new Map()
    for (const ranked of valid) {
      const day = historyDayKey(ranked.at)
      if (!latestOfDay.has(day)) latestOfDay.set(day, ranked)  // valid 已按新→旧，先见即该日最新
    }
    for (const ranked of latestOfDay.values()) keep.add(ranked.entry)  // 规则 2：日锚
    if (valid.length > 0) keep.add(valid[0].entry)  // 规则 1：最新一份（显式红线，配额内已含，重复标记是有意保险）
    for (const ranked of valid) {
      if (!keep.has(ranked.entry)) deletions.push(ranked)
    }
  }
  deletions.sort((left, right) => left.at - right.at)
  return deletions.map((ranked) => ranked.entry)
}

/**
 * OS-137：备份落盘后，对「同一原文件」的既有备份跑一次保留策略。
 * 只扫这一个 .history 目录（不全库遍历），只认 `<原文件名>.bak-` 前缀
 * （`.deleted-` 档与别人的备份不动）。每删一份往
 * `.openstory/log/history-prune/<yyyy-mm>.jsonl` 追加一行留痕；有删除时在
 * daemon 控制台打一行汇总。任何失败只报错不抛——保留策略绝不反噬救命索。
 */
async function pruneHistoryForFile(root, originalPath, keepPerFile) {
  const historyDir = join(dirname(originalPath), '.history')
  const prefix = `${basename(originalPath)}.bak-`
  const runAt = new Date().toISOString()
  let dirents
  try {
    dirents = await readdir(historyDir, { withFileTypes: true })
  } catch { /* 没有这个 .history 目录＝没东西可删 */ return { ok: true, deleted: 0 } }
  const entries = []
  for (const dirent of dirents) {
    if (!dirent.isFile() || !dirent.name.startsWith(prefix)) continue
    let stats
    try {
      stats = statSync(join(historyDir, dirent.name))
    } catch { continue }
    entries.push({ name: dirent.name, original: basename(originalPath), mtime: stats.mtime.toISOString() })
  }
  const doomed = pruneHistoryBackups(entries, { keepPerFile })
  let deleted = 0
  for (const entry of doomed) {
    const backupAbs = join(historyDir, entry.name)
    const backupRel = relative(root, backupAbs).split(sep).join('/')
    try {
      await unlink(backupAbs)
    } catch (error) {
      console.error(`[history-prune] 删 ${backupRel} 失败：${text(error?.message || error)}`)
      continue
    }
    deleted += 1
    try {
      const logRel = logFilePath('history-prune')
      const logAbs = join(root, ...logRel.split('/'))
      await mkdir(dirname(logAbs), { recursive: true })
      const line = JSON.stringify({ file: backupRel, deleted: true, reason: 'over-quota', keepPerFile, runAt })
      await appendFile(logAbs, `${line}\n`, 'utf-8')
    } catch (error) {
      console.error(`[history-prune] 写留痕日志失败：${text(error?.message || error)}`)
    }
  }
  if (deleted > 0) {
    const dirRel = relative(root, historyDir).split(sep).join('/')
    console.log(`[history-prune] ${dirRel}：滚动删除 ${deleted} 份旧备份（每文件配额 ${keepPerFile}，留痕 .openstory/log/history-prune/）`)
  }
  return { ok: true, deleted }
}

/**
 * S2 的失败码 → OpenStory 契约码。OS-157 起内核码已去前缀，这里按语义归并；
 * 未识别的写失败统一 WRITE_PROTOCOL_IO_FAILED（不假装成功）。
 * 内核 `STALE_REVISION` 与宿主 `REVISION_MISMATCH` 两名同义，在此显式对应。
 */
export function mapWriteErrorCode(code) {
  const upper = text(code).trim().toUpperCase()
  if (upper.includes('OPERATION_ID_REQUIRED')) return API_ERROR_CODES.WRITE_PROTOCOL_OPERATION_ID_REQUIRED
  if (upper.includes('VALIDATION_FAILED')) return API_ERROR_CODES.WRITE_PROTOCOL_VALIDATION_FAILED
  if (upper.includes('STALE_REVISION') || upper.includes('REVISION_MISMATCH')) return API_ERROR_CODES.REVISION_MISMATCH
  if (upper.includes('NOT_FOUND')) return API_ERROR_CODES.WRITE_PROTOCOL_NOT_FOUND
  if (upper.includes('INVALID_INPUT')) return API_ERROR_CODES.WRITE_PROTOCOL_INVALID_INPUT
  if (upper.includes('INVALID_ENTRY')) return API_ERROR_CODES.WRITE_PROTOCOL_VALIDATION_FAILED
  return API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED
}

/**
 * OS-211：载体写目录白名单（正文、剧本）——章节写端点只许落在这里。
 *
 * 真源是命名表（`chapters`／`script` 的 `dir` 列），不另抄一份字面量；载体表
 * （`storage/projectDoc.mjs` 的 CARRIERS.dataDirs）指向的正是这两个目录。
 * `故事源/`（fact 协议独占）、`世界书/`（走世界书写端点）、`.openstory/`（宿主写通道）
 * 与任意其它目录一律拒绝——通用章节通道不是「任意文件写」。
 */
export const CARRIER_WRITE_DIRS = Object.freeze([
  namingEntry('chapters')?.dir,
  namingEntry('script')?.dir
].filter(Boolean))

/** 世界书载体目录（日志恢复等宿主级文本回写放行的第二个目录）。 */
const WORLDBOOK_DIR = namingEntry('worldbook')?.dir ?? ''

function firstSegmentOf(file) {
  return text(file).trim().replaceAll('\\', '/').replace(/^\.\//u, '').split('/')[0] || ''
}

/** 路径里是否有隐藏段（`.history/…` 这类备份目录不许当稿子写）。 */
function hasHiddenSegment(file) {
  return text(file).trim().replaceAll('\\', '/').replace(/^\.\//u, '')
    .split('/').some((part) => part.startsWith('.') && part !== '.' && part !== '..')
}

/**
 * 章节写边界判定（OS-211）。返回 `{ ok:true, dir }` 或 `{ ok:false, code, message, details }`。
 * 路径逃逸形态与 resolveInsideRoot 同判（PATH_ESCAPE，403），目录归属不符回 INVALID_ENTRY（400）。
 */
export function assertCarrierWrite(file) {
  const normalized = text(file).trim().replaceAll('\\', '/').replace(/^\.\//u, '')
  if (!normalized) {
    return { ok: false, code: API_ERROR_CODES.INVALID_ENTRY, message: '章节写入需要 file（库内相对路径）', details: { file: normalized } }
  }
  const segments = normalized.split('/')
  // 逃逸形态先在写边界拦下：绝对路径、盘符、`.`/`..`/空段——与 resolveInsideRoot 同一口径。
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)
    || segments.some((part) => !part || part === '.' || part === '..')) {
    return {
      ok: false, code: API_ERROR_CODES.PATH_ESCAPE,
      message: `路径不合法或越出库根：${normalized}`,
      details: { file: normalized, carrierDirs: CARRIER_WRITE_DIRS }
    }
  }
  if (hasHiddenSegment(normalized)) {
    return {
      ok: false, code: API_ERROR_CODES.INVALID_ENTRY,
      message: `章节写入不接受隐藏目录或备份目录：${normalized}`,
      details: { file: normalized, carrierDirs: CARRIER_WRITE_DIRS }
    }
  }
  const dir = segments[0]
  if (!CARRIER_WRITE_DIRS.includes(dir)) {
    return {
      ok: false, code: API_ERROR_CODES.INVALID_ENTRY,
      message: `章节写入只允许载体目录（${CARRIER_WRITE_DIRS.join(' / ')}）：${normalized} 不在其中`,
      details: { file: normalized, carrierDirs: CARRIER_WRITE_DIRS }
    }
  }
  return { ok: true, dir }
}

/**
 * 宿主文本回写边界（OS-211）：载体目录＋世界书目录。日志恢复一类的通用回写只许
 * 回这两处——`故事源/` 必须经 fact 写协议（schema/revision/operationId），不许被文本通道
 * 整份覆盖；`.openstory/` 归宿主写通道，不走这里。
 */
export function assertGuardedTextWrite(file) {
  const normalized = text(file).trim().replaceAll('\\', '/')
  const dir = firstSegmentOf(normalized)
  if (dir && dir === WORLDBOOK_DIR) return { ok: true, dir }
  return assertCarrierWrite(file)
}

/**
 * OS-89：从库内相对路径推模块名（'世界书/人物/李逵.md' → '世界书'）。
 * 写通道的调用方大多不必显式传 module，靠这个默认推断即可。
 * OS-148：目录→模块名唯一真源在命名表（故事源目录的既有日志名是「故事源」，不迁移）。
 */
export function moduleOfPath(file) {
  const first = text(file).split('/')[0] || ''
  return logModuleForDir(first) ?? (first || 'misc')
}

/**
 * 正文原子写（tmp＋rename）＋写前 .history 备份。`PUT /api/chapter`（手工保存）与
 * 待确认卡采纳共用同一条实现，保证两条路的落盘行为完全一致。
 */
export async function writeChapterWithBackup(root, file, newText, logOptions = {}) {
  const resolved = resolveInsideRoot(root, file)
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message, details: resolved.details }
  try {
    await mkdir(dirname(resolved.path), { recursive: true })
    let backupRelative = null
    let beforeText = ''
    let existed = false
    if (existsSync(resolved.path)) {
      // v1 粗保护：写前把原内容复制到同目录 .history/。OpenStory 与 Electron 同时写同一库时，
      // 这里不拦冲突（不做跨进程 revision 闸），只保证「上一版还能捞回来」。
      // 待确认卡另有快照闸（卡创建→采纳窗口），见 agentStore.fileSnapshot/snapshotsMatch。
      const backup = historyBackupPath(root, file)
      if (!backup.ok) return { ok: false, code: backup.code, message: backup.message, details: backup.details }
      await mkdir(dirname(backup.path), { recursive: true })
      await copyFile(resolved.path, backup.path)
      backupRelative = backup.relative
      // OS-137：新备份落盘后，对同一原文件的既有备份跑一次保留策略（滚动删除＋留痕）。
      // 失败只报错不阻断写盘——清理是锦上添花，绝不能反噬救命索。
      try {
        await pruneHistoryForFile(root, resolved.path, resolveHistoryKeepPerFile())
      } catch (error) {
        console.error(`[history-prune] 保留策略执行失败：${text(error?.message || error)}`)
      }
      // OS-89：读旧内容用于算 diff（.history 只是二进制快照，日志要的是可读差异）
      try { beforeText = await readFile(resolved.path, 'utf-8') } catch { beforeText = '' }
      existed = true
    }
    await atomicWriteFile(resolved.path, newText)
    // OS-89：每一次修改都留 diff + log（AGENTS.md 第 10 条）。日志失败不影响写盘结果，
    // 但要如实回传给调用方，不能假装记上了。
    const logged = await recordChange({
      root,
      module: logOptions.module || moduleOfPath(file),
      file,
      op: existed ? 'update' : 'create',
      before: beforeText,
      after: newText,
      actor: logOptions.actor || 'author',
      meta: logOptions.meta || null,
      backup: backupRelative || ''   // OS-90：恢复时直接按这个路径取上一版
    })
    return {
      ok: true,
      chars: newText.length,
      savedAt: new Date().toISOString(),
      ...(backupRelative ? { backup: backupRelative } : {}),
      ...(logged.ok === false ? { logError: logged.message } : {}),
      ...(logged.record ? { changeId: `${logged.path}#${logged.record.afterHash}` } : {})
    }
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `正文写入失败：${text(error?.message || error)}`, details: { file } }
  }
}
