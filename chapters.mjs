/**
 * OpenStory 章节工作面（OS-10）——章节清单/自动编号新建/保号重命名/非破坏删除。
 *
 * 复用面：章节号解析＝textUtil.mjs 的 parseChapterNumber（OS-123 解耦①收编为本仓自持；
 * 逐字拷贝自 vendor server/mcp/projectImport.js，中文数字一体认）；文件名约定 `NNN-标题.md`
 * （conformance 口径）。
 * 删除永远非破坏：先挪进同目录 .history/<file>.deleted-<时间戳>，再删原文件。
 * 文件本体读写仍走 daemon 的 chapter 通道；本模块只管「章」这一层。
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, rename, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { parseChapterNumber } from './textUtil.mjs'
import { API_ERROR_CODES } from './contracts.mjs'

function text(value) {
  return String(value ?? '')
}

function fail(code, message, details) {
  return { ok: false, code, message, ...(details ? { details } : {}) }
}

/** 标题安全化：文件名非法字符与分隔符换下划线，控长。认不出安全名返回空串（调用方拒绝）。 */
export function sanitizeChapterTitle(title) {
  const cleaned = text(title)
    .replace(/[\\/:*?"<>|]/gu, '_')
    .replace(/^[\s·・:：、,，.。_\-—]+|[“”‘’'「」『』《》〈〉\s]+$/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
  return cleaned.slice(0, 60)
}

/** `NNN-标题.md`／`第N章 标题.md` → { no, title }；认不出＝{ no: null, title: 去扩展名 }（不编）。 */
export function parseChapterName(fileName) {
  const base = text(fileName).replace(/\.(?:md|txt|markdown)$/iu, '').trim()
  const leading = base.match(/^([0-9零一二三四五六七八九十百千两]{1,6})\s*[-_.—、·:：\s]\s*(.+)$/u)
  if (leading) {
    const no = parseChapterNumber(leading[1])
    if (no !== null) return { no, title: leading[2].trim() || base }
  }
  const chapterWord = base.match(/^第\s*([0-9零一二三四五六七八九十百千两]+)\s*[章节回]\s*[·・:：、,，.。_\-—]?\s*(.*)$/u)
  if (chapterWord) {
    const no = parseChapterNumber(chapterWord[1])
    if (no !== null) return { no, title: chapterWord[2].trim() || base }
  }
  return { no: null, title: base }
}

export function chapterFileName(no, title) {
  return `${String(no).padStart(3, '0')}-${title}.md`
}

/** 清单排序：有号按号，无号排尾按名。 */
function sortChapters(chapters) {
  return chapters.sort((left, right) => {
    if (left.no !== null && right.no !== null) return left.no - right.no
    if (left.no !== null) return -1
    if (right.no !== null) return 1
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
}

/** 列章节：dir 下递归 md/txt/markdown（与 filesGet 同一套扫描口径），逐个解析＋字数现算。 */
export async function listChapters(root, dir) {
  const base = resolve(text(root))
  const dirAbs = join(base, text(dir).trim())
  const rel = relative(base, dirAbs)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`)) {
    return fail(API_ERROR_CODES.PATH_ESCAPE, `目录越出库根：${text(dir)}`)
  }
  let entries
  try {
    entries = await readdir(dirAbs, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return { ok: true, chapters: [], warnings: [{ code: 'DIR_MISSING', message: `目录还不存在（新建章节会自动建出）：${text(dir)}` }] }
    }
    return fail(API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `目录读取失败：${text(error?.message || error)}`)
  }
  const chapters = []
  const walk = async (current, depth) => {
    if (depth > 3 || chapters.length >= 500) return
    for (const entry of await readdir(current, { withFileTypes: true })) {
      if (entry.name.startsWith('.') || entry.name === '.history' || entry.name === '.pinax') continue
      const childAbs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(childAbs, depth + 1)
        continue
      }
      if (!entry.isFile() || !/\.(?:md|txt|markdown)$/iu.test(entry.name)) continue
      const file = relative(base, childAbs).split(sep).join('/')
      const parsed = parseChapterName(entry.name)
      let chars = 0
      let mtime = ''
      try {
        const stats = await stat(childAbs)
        chars = stats.size
        mtime = stats.mtime.toISOString()
      } catch { /* 竞态跳过元数据 */ }
      chapters.push({ file, name: entry.name, no: parsed.no, title: parsed.title, chars, mtime })
    }
  }
  await walk(dirAbs, 0)
  return { ok: true, chapters: sortChapters(chapters) }
}

/** 下一号：现有最大号＋1（空目录从 1 起）；号被占用则继续顺延。 */
export function nextChapterNumber(chapters) {
  const used = new Set(chapters.map((chapter) => chapter.no).filter((no) => no !== null))
  let no = used.size ? Math.max(...used) + 1 : 1
  while (used.has(no)) no += 1
  return no
}

function insideRootPath(root, file) {
  const base = resolve(text(root))
  const abs = resolve(base, text(file).replaceAll('\\', '/'))
  const rel = relative(base, abs)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || abs === base) {
    return { ok: false, code: API_ERROR_CODES.PATH_ESCAPE, message: `路径越出库根：${text(file)}` }
  }
  if (rel.split(sep).some((part) => part === '.pinax' || part.startsWith('.'))) {
    return fail(API_ERROR_CODES.PATH_ESCAPE, '隐藏目录与 .pinax 不归章节工作面管')
  }
  return { ok: true, abs, relFile: rel.split(sep).join('/') }
}

/** 新建章节：自动下一号＋标题安全化；目录不存在自动建；空文件落盘。 */
export async function createChapter(root, dir, title) {
  const cleanTitle = sanitizeChapterTitle(title)
  if (!cleanTitle) return fail(API_ERROR_CODES.INVALID_ENTRY, '章节标题要有实际内容（不能全是符号）')
  const listing = await listChapters(root, dir)
  if (!listing.ok) return listing
  const no = nextChapterNumber(listing.chapters)
  const fileName = chapterFileName(no, cleanTitle)
  const file = `${text(dir).replace(/[\\/]+$/u, '')}/${fileName}`
  const target = insideRootPath(root, file)
  if (!target.ok) return target
  if (existsSync(target.abs)) return fail(API_ERROR_CODES.INVALID_ENTRY, `章节文件已存在：${fileName}`)
  try {
    await mkdir(dirname(target.abs), { recursive: true })
    await writeFile(target.abs, '', 'utf-8')
  } catch (error) {
    return fail(API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `章节文件创建失败：${text(error?.message || error)}`)
  }
  return { ok: true, chapter: { file: target.relFile, name: fileName, no, title: cleanTitle, chars: 0, mtime: new Date().toISOString() } }
}

/** 保号重命名：只换标题段；目标已存在拒绝。 */
export async function renameChapter(root, file, title) {
  const cleanTitle = sanitizeChapterTitle(title)
  if (!cleanTitle) return fail(API_ERROR_CODES.INVALID_ENTRY, '章节标题要有实际内容（不能全是符号）')
  const source = insideRootPath(root, file)
  if (!source.ok) return source
  if (!existsSync(source.abs)) return fail(API_ERROR_CODES.NOT_FOUND, `章节文件不存在：${text(file)}`)
  const parsed = parseChapterName(basename(source.abs))
  const no = parsed.no ?? nextChapterNumber(await listChapters(root, dirname(source.relFile)).then((r) => (r.ok ? r.chapters : [])))
  const fileName = chapterFileName(no, cleanTitle)
  const targetRel = `${dirname(source.relFile).split('\\').join('/')}/${fileName}`
  const target = insideRootPath(root, targetRel)
  if (!target.ok) return target
  if (target.abs === source.abs) return { ok: true, chapter: { file: source.relFile, name: basename(source.abs), no, title: cleanTitle }, unchanged: true }
  if (existsSync(target.abs)) return fail(API_ERROR_CODES.INVALID_ENTRY, `目标章节文件已存在：${fileName}`)
  try {
    await rename(source.abs, target.abs)
  } catch (error) {
    return fail(API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `重命名失败：${text(error?.message || error)}`)
  }
  return { ok: true, chapter: { file: target.relFile, name: fileName, no, title: cleanTitle, chars: statSync(target.abs).size, mtime: new Date().toISOString() }, previousFile: source.relFile }
}

/** 非破坏删除：挪进同目录 .history/<file>.deleted-<时间戳>。 */
export async function deleteChapter(root, file) {
  const source = insideRootPath(root, file)
  if (!source.ok) return source
  if (!existsSync(source.abs)) return fail(API_ERROR_CODES.NOT_FOUND, `章节文件不存在：${text(file)}`)
  const stamp = new Date().toISOString().replace(/[:.]/gu, '-')
  const historyDir = join(dirname(source.abs), '.history')
  const backupAbs = join(historyDir, `${basename(source.abs)}.deleted-${stamp}`)
  try {
    await mkdir(historyDir, { recursive: true })
    await rename(source.abs, backupAbs)
  } catch (error) {
    return fail(API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `删除（挪入历史）失败：${text(error?.message || error)}`)
  }
  const relDir = dirname(source.relFile).split('\\').join('/')
  const backupRel = `${relDir === '.' ? '' : `${relDir}/`}.history/${basename(source.abs)}.deleted-${stamp}`
  return { ok: true, backup: backupRel }
}
