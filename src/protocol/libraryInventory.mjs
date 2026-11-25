/**
 * 库内盘点与文件清单（OS-8/OS-11/OS-12，OS-141 daemon 拆分落位）——全库只读。
 *
 *   · listArtifacts：顶层目录分组（组内递归文本文件）＋版本与历史——.history/ 里的
 *     bak/deleted 档按原文件归组；.openstory 与隐藏目录绝不进清单。
 *   · listLibraryFiles：业务页的「列」拼图；dir 缺省＝顶层扫描（dirs＋files），
 *     dir＝单段目录名递归深度≤3；读/写文件本体仍走 chapter 通道，本模块只管「列」。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { statSync } from 'node:fs'
import { readdir } from 'node:fs/promises'
import { basename, isAbsolute, join, relative, sep } from 'node:path'
import { API_ERROR_CODES } from './apiErrors.mjs' // OS-142：错误码词表经协议层叶子转出（模块纪律：modules 不直引 api）
import { canonicalRoot, pathFail, text, METADATA_DIR } from './authorize.mjs' // OS-142：路径授权经协议层叶子转出（模块纪律：modules 不直引 host）

const ARTIFACT_LIMIT = 1000

const FILE_DIR_NAME = /^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9._ -]{0,30}$/u
const FILE_TEXT_EXT = /\.(?:md|txt|markdown|json)$/iu
const FILE_LIST_LIMIT = 500
const FILE_LIST_DEPTH = 3

function fileEntry(root, absPath, stats) {
  const file = relative(root, absPath).split(sep).join('/')
  return { file, name: basename(absPath), size: stats.size, mtime: stats.mtime.toISOString() }
}

/**
 * 全库盘点（OS-12 升级）：顶层目录分组（组内递归文本文件）＋版本与历史——
 * .history/ 里的 bak/deleted 档按原文件归组（file/name/original/kind/size/mtime）。
 * .openstory 与隐藏目录照旧绝不进清单。
 */
export async function listArtifacts(root) {
  const base = canonicalRoot(root)
  if (!base) return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '盘点需要一个项目根（root）' }
  const groups = new Map()
  let bytes = 0
  let count = 0
  let histories = 0
  const groupOf = (topDir) => {
    if (!groups.has(topDir)) groups.set(topDir, { files: [], history: [] })
    return groups.get(topDir)
  }
  /** .history 档 → 版本记录：name 形如 <原文件名>.bak-<ts> / .deleted-<ts>。 */
  const collectHistory = async (historyDir, topDir, parentRel) => {
    let entries
    try {
      entries = await readdir(historyDir, { withFileTypes: true })
    } catch { /* 读不了就跳过这组历史 */ return }
    for (const entry of entries) {
      if (!entry.isFile() || count + histories >= ARTIFACT_LIMIT) continue
      const kind = entry.name.includes('.deleted-') ? 'deleted' : entry.name.includes('.bak-') ? 'bak' : null
      if (!kind) continue
      const originalName = entry.name.split('.bak-')[0].split('.deleted-')[0]
      const childAbs = join(historyDir, entry.name)
      let stats
      try {
        stats = statSync(childAbs)
      } catch { continue }
      const file = relative(base, childAbs).split(sep).join('/')
      const original = parentRel ? `${parentRel}/${originalName}` : originalName
      groupOf(topDir).history.push({ file, name: entry.name, original, originalName, kind, size: stats.size, mtime: stats.mtime.toISOString() })
      histories += 1
    }
  }
  const walk = async (current, depth) => {
    if (depth > FILE_LIST_DEPTH || count >= ARTIFACT_LIMIT) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    const relDir = relative(base, current).split(sep).join('/')
    const topDir = relDir === '.' ? '' : relDir.split('/')[0]
    const parentRel = relDir === '.' ? '' : relDir
    for (const entry of entries) {
      if (count >= ARTIFACT_LIMIT) return
      if (entry.name === METADATA_DIR || entry.name.startsWith('.')) {
        if (entry.name === '.history' && entry.isDirectory()) {
          await collectHistory(join(current, entry.name), topDir, parentRel)
        }
        continue
      }
      const childAbs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(childAbs, depth + 1)
        continue
      }
      if (!entry.isFile() || !FILE_TEXT_EXT.test(entry.name)) continue
      let stats
      try {
        stats = statSync(childAbs)
      } catch { /* 竞态跳过 */ continue }
      const file = relative(base, childAbs).split(sep).join('/')
      groupOf(topDir).files.push({ file, name: entry.name, size: stats.size, mtime: stats.mtime.toISOString() })
      count += 1
      bytes += stats.size
    }
  }
  try {
    await walk(base, 0)
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `盘点失败：${text(error?.message || error)}` }
  }
  const groupList = [...groups.entries()]
    .map(([dir, group]) => ({
      dir,
      files: group.files.sort((left, right) => left.file.localeCompare(right.file, 'zh-Hans-CN')),
      ...(group.history.length ? { history: group.history.sort((left, right) => right.mtime.localeCompare(left.mtime)) } : {})
    }))
    .sort((left, right) => left.dir.localeCompare(right.dir, 'zh-Hans-CN'))
  return { ok: true, groups: groupList, totals: { files: count, bytes, histories } }
}

/**
 * 列库内文本文件。dir 缺省＝顶层扫描（dirs＋files）；dir＝单段目录名，递归深度≤3。
 * 跳过 `.` 开头/`.openstory`/`.history`；只收 md/txt/markdown/json；≤500 个。
 * 目录不存在＝空清单＋warning（空目录是合法形态，不报错）。
 */
export async function listLibraryFiles(root, dir = '') {
  const base = canonicalRoot(root)
  if (!base) return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '列文件需要一个项目根（root）' }
  const rawDir = text(dir).trim()
  const warnings = []
  if (!rawDir) {
    let topLevel
    try {
      topLevel = await readdir(base, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, dirs: [], files: [], warnings: [{ code: 'DIR_MISSING', message: `库根还不存在：${base}` }] }
      return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `顶层扫描失败：${text(error?.message || error)}` }
    }
    const dirs = []
    const files = []
    for (const entry of topLevel) {
      if (entry.name.startsWith('.') || entry.name === METADATA_DIR) continue
      if (entry.isDirectory()) dirs.push(entry.name)
      else if (entry.isFile() && FILE_TEXT_EXT.test(entry.name)) {
        try {
          files.push(fileEntry(base, join(base, entry.name), statSync(join(base, entry.name))))
        } catch { /* 竞态消失的文件跳过 */ }
      }
    }
    return { ok: true, dirs: dirs.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')), files }
  }
  if (rawDir.includes('/') || rawDir.includes('\\') || rawDir === '.' || rawDir === '..' || rawDir === METADATA_DIR || !FILE_DIR_NAME.test(rawDir)) {
    return pathFail(`目录名必须是单段合法目录名：${rawDir}`, rawDir)
  }
  const dirAbs = join(base, rawDir)
  const rel = relative(base, dirAbs)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return pathFail(`目录解析后落在库根之外：${rawDir}`, rawDir)
  }
  const files = []
  const walk = async (current, depth) => {
    if (files.length >= FILE_LIST_LIMIT || depth > FILE_LIST_DEPTH) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        if (current === dirAbs) warnings.push({ code: 'DIR_MISSING', message: `目录还不存在（保存新文件会自动建出）：${rawDir}` })
        return
      }
      throw error
    }
    for (const entry of entries) {
      if (files.length >= FILE_LIST_LIMIT) return
      if (entry.name.startsWith('.') || entry.name === METADATA_DIR || entry.name === '.history') continue
      const childAbs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(childAbs, depth + 1)
      } else if (entry.isFile() && FILE_TEXT_EXT.test(entry.name)) {
        try {
          files.push(fileEntry(base, childAbs, statSync(childAbs)))
        } catch { /* 竞态跳过 */ }
      }
    }
  }
  try {
    await walk(dirAbs, 0)
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `目录扫描失败：${text(error?.message || error)}` }
  }
  files.sort((left, right) => left.file.localeCompare(right.file, 'zh-Hans-CN'))
  return { ok: true, files, ...(warnings.length ? { warnings } : {}) }
}
