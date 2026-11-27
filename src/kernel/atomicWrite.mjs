import { open, readdir, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { syncDirectory } from './fsDurability.mjs'
import { TMP_PREFIX } from './identity.mjs'

export { TMP_PREFIX }

/**
 * 原子落盘（继承桌面轨已验证的做法：同目录临时文件 → fsync → rename → 目录 fsync）。
 * 桌面轨实现见 electron/projects/fsDurability.mjs，这里补上可重入清理。
 * 运行时只认 TMP_PREFIX；历史前缀的残留由库升级（OS-188a）归档，不在这里回收。
 */

export async function writeFileAtomic(absPath, contents, deps = {}) {
  const directory = dirname(absPath)
  const tmpPath = join(directory, `${TMP_PREFIX}${randomBytes(6).toString('hex')}`)
  const openFile = deps.open || open
  const move = deps.rename || rename
  const remove = deps.unlink || unlink
  const wait = deps.wait || ((ms) => new Promise((done) => setTimeout(done, ms)))
  const platform = deps.platform || process.platform
  let handle
  try {
    handle = await openFile(tmpPath, 'w')
    await handle.writeFile(String(contents ?? ''), 'utf-8')
    await handle.sync()
    await handle.close()
    handle = null
    await renameWithRetry(move, tmpPath, absPath, { platform, wait })
    await syncDirectory(directory, { open: openFile })
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await remove(tmpPath).catch(() => {})
    throw error
  }
  return absPath
}

/**
 * Windows 上「目标文件正被别的句柄短暂持有」时，rename 覆盖会偶发 EPERM/EBUSY/EACCES；
 * 这不是数据错误，重试几次即可（编辑器/杀毒/索引器持有句柄是常态）。
 * 只对这三类可重试错误重试，其它错误立刻抛出，失败清场语义不变。
 */
const RETRYABLE_RENAME_CODES = new Set(['EPERM', 'EBUSY', 'EACCES'])

async function renameWithRetry(move, from, to, { platform, wait }) {
  const maxAttempts = platform === 'win32' ? 5 : 1
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await move(from, to)
    } catch (error) {
      if (attempt >= maxAttempts || !RETRYABLE_RENAME_CODES.has(error?.code)) throw error
      await wait(attempt * 25)
    }
  }
}

/** 崩溃恢复：清掉同目录遗留的 TMP_PREFIX 半成品，绝不误删正文。 */
export async function recoverInterruptedWrites(directory, deps = {}) {
  const list = deps.readdir || readdir
  const remove = deps.unlink || unlink
  let entries
  try {
    entries = await list(directory)
  } catch {
    return { removed: [], skipped: true }
  }
  const removed = entries.filter((name) => name.startsWith(TMP_PREFIX))
  for (const name of removed) await remove(join(directory, name)).catch(() => {})
  return { removed, skipped: false }
}
