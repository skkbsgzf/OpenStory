/**
 * 故事源书目盘点与缺省书解析（OS-54/S1，OS-141 daemon 拆分落位）——fact 域 handler
 * 与 syncCheck（世界书域）共用的「书」层助手。
 *
 * 口径：书身份按文件名算（故事源/<id>.json）；坏档只在那一本记 error，其余照常返回
 * ——「坏档不整体失败」是内核与作者同一口径。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { readdir, readFile } from 'node:fs/promises'
import { statSync } from 'node:fs'
import { join } from 'node:path'
import { isPlainObject } from '../../../protocol/contractHelpers.mjs'
import { text } from '../../../protocol/httpText.mjs'
import { namingEntry } from '../../../protocol/naming.mjs'

const FACT_DIR = namingEntry('storysource').dir

/** 故事源目录里可当书的文件名：排除 wiki 派生、操作日志、汇总/索引旁路档。 */
export function isFactBookFileName(name) {
  const lower = String(name).toLowerCase()
  if (!lower.endsWith('.json')) return false
  if (lower.endsWith('.wiki.json')) return false
  if (lower.includes('.operations')) return false
  // 旧目录名旁路档只作兼容排除，不重新生成旧布局。
  return name !== '拆解汇总.json' && name !== '拆解索引.json'
}

/**
 * 书目盘点（factBooksGet／factEntriesGet 共用）：故事源/ 下每本 <id>.json 读顶层
 * book/revision/entries.length，并查兄弟 <id>.wiki.json 是否存在。
 * 坏档只在那一本记 error，其余照常返回——「坏档不整体失败」是内核与作者同一口径。
 */
export async function listFactBooks(root) {
  const dir = join(root, FACT_DIR)
  let names = []
  try {
    names = (await readdir(dir)).filter(isFactBookFileName).sort()
  } catch {
    return []
  }
  const books = []
  for (const name of names) {
    const bookId = name.replace(/\.json$/u, '')
    const path = join(dir, name)
    let mtime = 0
    try { mtime = statSync(path).mtimeMs } catch { mtime = 0 }
    let hasWiki = false
    try { hasWiki = statSync(join(dir, `${bookId}.wiki.json`)).isFile() } catch { hasWiki = false }
    let document = null
    try {
      document = JSON.parse(await readFile(path, 'utf-8'))
    } catch (error) {
      books.push({ bookId, file: name, title: bookId, revision: 0, entries: 0, hasWiki, mtime, error: `故事源文件读不了：${String(error?.message || error)}` })
      continue
    }
    if (!isPlainObject(document) || !Array.isArray(document.entries)) {
      books.push({ bookId, file: name, title: bookId, revision: 0, entries: 0, hasWiki, mtime, error: '故事源文件形状不对：顶层不是对象或 entries 不是数组' })
      continue
    }
    const revision = Number.isSafeInteger(Number(document.revision)) && Number(document.revision) >= 1 ? Number(document.revision) : 1
    const rawBook = isPlainObject(document.book) ? document.book : null
    books.push({
      bookId,
      file: name,
      title: text(rawBook?.title).trim() || text(rawBook?.id).trim() || bookId,
      revision,
      entries: document.entries.length,
      hasWiki,
      mtime,
      book: rawBook
    })
  }
  return books
}

/** 分页参数：非法/负数回落默认值（offset 0，limit 100），limit 上限 500（超限 clamp 不报错）。 */
export function factOffsetOf(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

export function factLimitOf(value) {
  const DEFAULT_LIMIT = 100
  const MAX_LIMIT = 500
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) return DEFAULT_LIMIT
  return Math.min(number, MAX_LIMIT)
}

/**
 * 推演书缺省解析（OS-54）：显式传了 bookId 就用它；没传＝故事源目录里 mtime 最新那份。
 * 与 factCurveGet 的选书口径一致——剔除条目页签后前端不再持有 bookId。
 */
export async function resolveFactBookId(root, wanted) {
  const wantedText = text(wanted).trim()
  if (wantedText) return wantedText
  const dir = join(root, FACT_DIR)
  let files = []
  try { files = (await readdir(dir)).filter((name) => name.endsWith('.json')) } catch { files = [] }
  const pick = files
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)[0]
  return pick ? pick.name.replace(/\.json$/u, '') : 'default'
}
