/**
 * OS-138：宿主写通道唯一入口（原子写收敛）。
 *
 * 全仓 22 处内联「写临时文件再 rename」归一到 atomicWriteFile：
 *   · 文本内容 —— 直通内核 writeFileAtomic（fsync＋rename＋目录 fsync），经 pinaxAdapter
 *     转出（内核唯一进口纪律不变，S2.4）。
 *   · 二进制内容（Buffer/TypedArray/ArrayBuffer）—— 内核实现是 `String(contents)`＋utf-8
 *     （core/pinax/next/fs/atomicWrite.mjs:18），直传二进制会损坏字节；这里按同一模式补一条
 *     二进制分支：同前缀 `.pinax-tmp-`（内核 recoverInterruptedWrites 可回收）＋ fsync＋
 *     rename＋目录 fsync（syncDirectory 亦经 pinaxAdapter 转出）。
 *
 * 与各调用点原实现的一致性：本函数**不建目录**——目录创建留在调用点（原实现各自
 * mkdir 的时机与目标不同，见 daemon.mjs 拆解 wiki 旁挂等无 mkdir 的调用点）。
 * 临时文件前缀统一为点开头的 `.pinax-tmp-<hex>`：`.pinax-tmp-` 不含子串 `.tmp-`
 * （`tmp-` 前是 `-`），扫描侧既有的 `!item.includes('.tmp-')` 过滤（agentStore.mjs
 * 会话列举、stylePacks.mjs 套件列举）对其继续由各自的扩展名主过滤兜底成立。
 * 后续布局批次会把本文件迁入目录结构。
 */
import { open, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { writeFileAtomic, TMP_PREFIX, syncDirectory } from './pinaxAdapter.mjs'

function isBinaryContent(contents) {
  return ArrayBuffer.isView(contents) || contents instanceof ArrayBuffer
}

/** 二进制分支：与内核 writeFileAtomic 同模式（同前缀、fsync、rename、目录 fsync、失败清场）。 */
async function atomicWriteBinary(absPath, contents) {
  const directory = dirname(absPath)
  const tmpPath = join(directory, `${TMP_PREFIX}${randomBytes(6).toString('hex')}`)
  let handle
  try {
    handle = await open(tmpPath, 'w')
    await handle.writeFile(contents)
    await handle.sync()
    await handle.close()
    handle = null
    await rename(tmpPath, absPath)
    await syncDirectory(directory)
  } catch (error) {
    if (handle) await handle.close().catch(() => {})
    await unlink(tmpPath).catch(() => {})
    throw error
  }
  return absPath
}

/**
 * 原子落盘：写同目录 `.pinax-tmp-*` 临时文件 → fsync → rename → 目录 fsync；
 * 任一步失败收掉临时文件后原样抛错，目标文件（若已存在）完好。
 * contents 为字符串走内核实现；Buffer/TypedArray/ArrayBuffer 走二进制分支。
 * 不建目录——目录不存在时以 ENOENT 抛出（调用点按各自原语义先 mkdir）。
 */
export async function atomicWriteFile(absPath, contents) {
  if (isBinaryContent(contents)) return atomicWriteBinary(absPath, contents)
  return writeFileAtomic(absPath, contents)
}
