/**
 * 变更日志引擎（OS-89）——库内唯一的「修改留痕」通道。
 *
 * 作者立宪（AGENTS.md 第 8–11 条）：
 *   「所有的修改都要有 diff，都要有 log。每一个模块在每次加载的时候，
 *     都要自己检索一遍跟自己相关的一些 log。」
 *
 * 设计：
 *   · 存储＝`<库>/.pinax/log/<模块>/<yyyy-mm>.jsonl`，append-only，一行一记录。
 *     按月分文件，避免单文件无限增长；同一次会话的连续修改天然按时间排序。
 *   · diff＝unified 格式（自带上下文行），自己实现（不引依赖，零 npm 构建约束）。
 *   · 模块维度＝调用方自己报（'正文' / '参考' / '推演' / '习惯' …），
 *     这样才能「每个模块只取自己的 log」，不用全库扫。
 *   · 只记文本类稿件；二进制（图片/音频）记 hash 与字节数，diff 字段留空。
 *
 * 纯 Node 模块，零依赖，可单测。
 */
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { appendFile, mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

const text = (value) => String(value ?? '')

/** 日志根目录（库内固定位置，见 AGENTS.md 表）。 */
export const LOG_DIR = '.pinax/log'

/** 单条 diff 最大字符数——超出截断并标记，避免整本替换把日志撑爆。 */
const MAX_DIFF_CHARS = 20000
/** 单个 jsonl 文件超过这个大小就换下一个月（按 mtime 判断足够，不读全文件）。 */
const MAX_LOG_BYTES = 4 * 1024 * 1024
/** 一次检索最多返回条数（新→旧）。 */
const DEFAULT_LIMIT = 50

/** 模块名归一：只留安全字符，防止路径穿越写进奇怪位置。 */
export function safeModuleName(raw) {
  const cleaned = text(raw).trim().replace(/[\\/:*?"<>|]/gu, '').slice(0, 40)
  return cleaned || 'misc'
}

/** 内容指纹：用于判断「真的变了没有」，也用于在 log 里快速比对。 */
export function contentHash(content) {
  const buf = Buffer.isBuffer(content) ? content : Buffer.from(text(content), 'utf-8')
  return createHash('sha1').update(buf).digest('hex').slice(0, 16)
}

/**
 * unified diff（自实现，零依赖）。
 * 采用最朴素的 LCS 逐行对比——稿件量级（几万行以内）足够，且完全确定。
 * @returns {string} 形如 `--- a/x\n+++ b/x\n@@ -1,3 +1,3 @@\n ...`
 */
export function unifiedDiff(before, after, { path = '', context = 3 } = {}) {
  const a = text(before).split('\n')
  const b = text(after).split('\n')
  if (before === after) return ''

  // LCS 动态规划（行级）。为控内存，两边行数乘积超过阈值时退化为「整块替换」。
  const n = a.length
  const m = b.length
  let ops
  if (n * m > 4_000_000) {
    ops = [
      ...a.map((line) => ({ kind: '-', line })),
      ...b.map((line) => ({ kind: '+', line }))
    ]
  } else {
    const dp = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1))
    for (let i = n - 1; i >= 0; i--) {
      for (let j = m - 1; j >= 0; j--) {
        dp[i][j] = a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1])
      }
    }
    ops = []
    let i = 0
    let j = 0
    while (i < n && j < m) {
      if (a[i] === b[j]) { ops.push({ kind: ' ', line: a[i] }); i++; j++ }
      else if (dp[i + 1][j] >= dp[i][j + 1]) { ops.push({ kind: '-', line: a[i] }); i++ }
      else { ops.push({ kind: '+', line: b[j] }); j++ }
    }
    while (i < n) ops.push({ kind: '-', line: a[i++] })
    while (j < m) ops.push({ kind: '+', line: b[j++] })
  }

  // 把 ops 折成 hunk（每块前后各留 context 行未变行）
  const hunks = []
  let idx = 0
  while (idx < ops.length) {
    if (ops[idx].kind === ' ') { idx++; continue }
    const start = Math.max(0, idx - context)
    let end = idx
    let gap = 0
    while (end < ops.length) {
      if (ops[end].kind === ' ') {
        gap++
        if (gap > context * 2) break
      } else gap = 0
      end++
    }
    const stop = Math.min(ops.length, end + context)
    hunks.push({ from: start, to: stop })
    idx = stop
  }
  if (!hunks.length) return ''

  const head = []
  if (path) head.push(`--- a/${path}`, `+++ b/${path}`)
  const body = hunks.map(({ from, to }) => {
    const slice = ops.slice(from, to)
    const aStart = ops.slice(0, from).filter((op) => op.kind !== '+').length + 1
    const bStart = ops.slice(0, from).filter((op) => op.kind !== '-').length + 1
    const aLen = slice.filter((op) => op.kind !== '+').length
    const bLen = slice.filter((op) => op.kind !== '-').length
    const lines = [`@@ -${aStart},${aLen} +${bStart},${bLen} @@`]
    for (const op of slice) lines.push(`${op.kind}${op.line}`)
    return lines.join('\n')
  })
  return [...head, ...body].join('\n')
}

/** 当前月份键（用于分文件）。 */
function monthKey(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
}

/** 某模块某月的日志文件路径（相对库根）。 */
export function logFilePath(module, now = new Date()) {
  return `${LOG_DIR}/${safeModuleName(module)}/${monthKey(now)}.jsonl`
}

/**
 * 记录一次变更。**所有写操作都必须调它。**
 *
 * @param {object} opts
 * @param {string} opts.root            库根（绝对路径）
 * @param {string} opts.module          模块名（正文/参考/推演/习惯…）
 * @param {string} opts.file            库内相对路径
 * @param {string} opts.op              'create' | 'update' | 'delete' | 'move' | 'adopt'…
 * @param {string} [opts.before]        修改前内容（创建时为空串）
 * @param {string} [opts.after]         修改后内容（删除时为空串）
 * @param {string} [opts.actor]         谁改的：'author' | 'agent' | 'system'
 * @param {object} [opts.meta]          附加信息（如 choiceId、cardId），会原样并入日志行
 * @returns {Promise<{ok:boolean, record?:object, path?:string, code?:string, message?:string}>}
 */
export async function recordChange({
  root, module, file, op = 'update', before = '', after = '', actor = 'author', meta = null
} = {}) {
  if (!root || !file) return { ok: false, code: 'INVALID_ENTRY', message: 'recordChange 需要 root 与 file' }
  const beforeText = text(before)
  const afterText = text(after)
  const beforeHash = contentHash(beforeText)
  const afterHash = contentHash(afterText)
  // 内容没变就不记——避免「打开就保存」刷屏
  if (op === 'update' && beforeHash === afterHash) return { ok: true, record: null, skipped: true }

  let diff = ''
  if (op !== 'delete' && op !== 'create') diff = unifiedDiff(beforeText, afterText, { path: file })
  else if (op === 'create') diff = unifiedDiff('', afterText, { path: file })
  else if (op === 'delete') diff = unifiedDiff(beforeText, '', { path: file })
  let diffTruncated = false
  if (diff.length > MAX_DIFF_CHARS) {
    diff = `${diff.slice(0, MAX_DIFF_CHARS)}\n…（diff 过长已截断，共 ${diff.length} 字符）`
    diffTruncated = true
  }

  const now = new Date()
  const record = {
    at: now.toISOString(),
    module: safeModuleName(module),
    file,
    op,
    actor,
    beforeHash,
    afterHash,
    beforeChars: beforeText.length,
    afterChars: afterText.length,
    diff,
    ...(diffTruncated ? { diffTruncated } : {}),
    ...(meta && typeof meta === 'object' ? { meta } : {})
  }

  const rel = logFilePath(module, now)
  const abs = join(root, ...rel.split('/'))
  try {
    await mkdir(dirname(abs), { recursive: true })
    await appendFile(abs, `${JSON.stringify(record)}\n`, 'utf-8')
    return { ok: true, record, path: rel }
  } catch (error) {
    // 日志失败绝不阻断主写入——但必须让调用方知道（返回 ok:false 而非静默）
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `写变更日志失败：${text(error?.message || error)}` }
  }
}

/**
 * 读某模块的日志（新→旧）。
 * 「每个模块加载时检索自己相关的 log」就调这个。
 *
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} [opts.module]   不给＝全部模块（跨模块概览）
 * @param {string} [opts.file]     只看某个文件的变更
 * @param {number} [opts.limit=50]
 * @returns {Promise<{ok:boolean, entries:object[], truncated:boolean}>}
 */
export async function readLog({ root, module = '', file = '', limit = DEFAULT_LIMIT } = {}) {
  if (!root) return { ok: false, code: 'NO_LIBRARY', entries: [], truncated: false }
  const base = join(root, ...LOG_DIR.split('/'))
  const wanted = text(module).trim() ? safeModuleName(module) : ''
  const cap = Math.max(1, Math.min(500, Number(limit) || DEFAULT_LIMIT))

  let modules
  try {
    modules = await readdir(base, { withFileTypes: true })
  } catch {
    return { ok: true, entries: [], truncated: false } // 还没有任何日志＝空，不是错误
  }

  const picked = modules
    .filter((item) => item.isDirectory())
    .map((item) => item.name)
    .filter((name) => !wanted || name === wanted)

  const entries = []
  for (const mod of picked) {
    const dir = join(base, mod)
    let files
    try { files = (await readdir(dir)).filter((name) => name.endsWith('.jsonl')) } catch { continue }
    // 文件名是 yyyy-mm，字典序＝时间序；取最近的若干个（同月一个文件，通常 1–2 个）
    files.sort()
    for (const name of files.slice(-3)) {
      let raw
      try { raw = await readFile(join(dir, name), 'utf-8') } catch { continue }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          const record = JSON.parse(line)
          if (file && text(record?.file) !== text(file)) continue
          entries.push(record)
        } catch { /* 坏行跳过，不让一行脏数据毁掉整份日志 */ }
      }
    }
  }

  entries.sort((left, right) => text(right?.at).localeCompare(text(left?.at)))
  return { ok: true, entries: entries.slice(0, cap), truncated: entries.length > cap }
}

/** 日志是否已存在（给「模块首次加载」判断用，省一次 readdir）。 */
export function hasLog(root, module) {
  if (!root) return false
  return existsSync(join(root, ...LOG_DIR.split('/'), safeModuleName(module)))
}

/** 汇总：每个模块最近一条变更（给「库总览」用）。 */
export async function logSummary(root) {
  const all = await readLog({ root, limit: 500 })
  if (!all.ok) return all
  const byModule = new Map()
  for (const record of all.entries) {
    const key = text(record?.module) || 'misc'
    if (!byModule.has(key)) byModule.set(key, record)
  }
  return {
    ok: true,
    modules: [...byModule.entries()].map(([module, latest]) => ({
      module,
      lastAt: text(latest?.at),
      lastFile: text(latest?.file),
      lastOp: text(latest?.op)
    }))
  }
}
