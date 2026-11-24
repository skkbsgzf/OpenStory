/**
 * 事实链优先守卫（FACT-FIRST.md 规则 1/2/3 的代码级兑现）。
 *
 * 声明在文档里只是约定，这里是「谁能读正文喂模型」的唯一闸门：
 *   ① 想拿上下文 → 先问 loadFactContext：事实链有就给事实，没有才降级读正文，并如实标注。
 *   ② 想绕过闸门直接读正文喂模型 → 必须显式声明 reason，guard 会记下来（可审计）。
 *
 * 设计取舍：不做「硬失败」。作者急着写作时，事实链没建好也得能写——但降级必须留痕，
 * 否则「事实链是一级公民」就成了一句空话。所以这里一律返回 { source, degraded, notes }。
 *
 * 依赖：只依赖内核 fact 存储协议（`src/kernel/index.mjs` 的 factStore 出口，OS-157 起
 * 内核公开面直取，与 /api/entries 同源）＋ Node fs。
 */
import { existsSync, readdirSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { factStore } from '../kernel/index.mjs' // OS-157：内核公开面唯一出口（S2.4'），本仓其余模块不许绕过协议层

/** 一次读取的结果来源标记——调用方据此决定要不要提示作者「正在用降级数据」。 */
export const CONTEXT_SOURCE = Object.freeze({
  FACT: 'fact', // 全量来自事实链
  FACT_PARTIAL: 'fact-partial', // 事实链有，但不覆盖请求范围
  PROSE_FALLBACK: 'prose-fallback', // 事实链没有 → 降级读正文
  EMPTY: 'empty' // 两边都没有
})

function text(value) {
  return String(value ?? '')
}

/** 章节文件名 → 章号的宽松解析（`001-标题.md` / `第3章.md` 都能认）。解析不出返回 null。 */
function chapterNoOf(file) {
  const name = text(file)
  const padded = /^(\d{1,4})[-_.\s]/u.exec(name)
  if (padded) return Number(padded[1])
  const cn = /第\s*(\d+)\s*章/u.exec(name)
  if (cn) return Number(cn[1])
  return null
}

/** 列出库内正文章节（`正文/` 或 `chapters/`）。 */
function listProseFiles(root) {
  for (const dir of ['正文', 'chapters']) {
    const full = join(root, dir)
    if (!existsSync(full)) continue
    try {
      return readdirSync(full)
        .filter((name) => /\.(md|txt)$/iu.test(name))
        .map((name) => ({ file: join(dir, name), name, chapterNo: chapterNoOf(name) }))
        .sort((a, b) => (a.chapterNo ?? 9999) - (b.chapterNo ?? 9999))
    } catch { /* 目录不可读继续试下一个 */ }
  }
  return []
}

/**
 * 事实链健康度：有没有、覆盖几章、revision 与正文新旧关系。
 * 这是 /api/fact/status 的数据源，也是 UI 显示「事实链已过期」的依据。
 *
 * @param {string} root 库根
 * @returns {Promise<{present:boolean, entries:number, layers:object, chapters:number[], revision:number|null, ...}>}
 */
export async function factHealth(root) {
  const notes = []
  let entries = []
  let revision = null
  try {
    const store = factStore.createFactFileStore({ root })
    const listed = await store.list({})
    entries = listed.entries ?? []
    revision = Number.isSafeInteger(listed.revision) ? listed.revision : null
    for (const warning of listed.warnings ?? []) notes.push(text(warning))
  } catch (error) {
    notes.push(`事实链不可读：${text(error?.message ?? error)}`)
  }

  const layers = entries.reduce((acc, entry) => {
    acc[entry.layer] = (acc[entry.layer] ?? 0) + 1
    return acc
  }, {})

  const chapters = [...new Set(entries
    .flatMap((entry) => [entry.validity?.from, entry.validity?.to])
    .filter(Number.isInteger))].sort((a, b) => a - b)

  // 事实链是否过期：正文最新 mtime > 事实链文件的 mtime
  let stale = false
  let staleReason = ''
  try {
    const proseFiles = listProseFiles(root)
    const newestProse = proseFiles.reduce((newest, item) => {
      try {
        const mtime = statSync(join(root, item.file)).mtimeMs
        return mtime > newest ? mtime : newest
      } catch { return newest }
    }, 0)
    for (const candidate of [factStore.FACT_DIR_NAME, '.pinax/extractions', '.pinax/deduce']) {
      const dir = join(root, candidate)
      if (!existsSync(dir)) continue
      const newestFact = readdirSync(dir).reduce((newest, name) => {
        try {
          const mtime = statSync(join(dir, name)).mtimeMs
          return mtime > newest ? mtime : newest
        } catch { return newest }
      }, 0)
      if (newestFact && newestProse > newestFact) {
        stale = true
        staleReason = `正文比 ${candidate} 更新`
        break
      }
    }
  } catch { /* 检查失败不算 stale，避免误报 */ }

  return {
    present: entries.length > 0,
    entries: entries.length,
    layers,
    chapters,
    revision,
    stale,
    staleReason,
    notes
  }
}

/**
 * 取某一章的上下文——**事实链优先，正文兜底**（FACT-FIRST 规则 2）。
 *
 * 返回结构刻意统一：调用方不关心数据从哪来，只看 `source` 决定是否提示降级。
 *
 * @param {object} input
 * @param {string} input.root 库根
 * @param {number} [input.chapterNo] 章号；省略＝全书
 * @param {number} [input.limit] 条目上限
 * @returns {Promise<{source:string, entries:object[], events:object[], proseText:string|null, degraded:boolean, notes:string[]}>}
 */
export async function loadFactContext({ root, chapterNo = null, limit = 400 } = {}) {
  const notes = []
  let entries = []
  try {
    const store = factStore.createFactFileStore({ root })
    const listed = await store.list({})
    entries = listed.entries ?? []
    for (const warning of listed.warnings ?? []) notes.push(text(warning))
  } catch (error) {
    notes.push(`事实链读取失败：${text(error?.message ?? error)}`)
  }

  const inRange = (entry) => {
    if (chapterNo == null) return true
    const from = entry.validity?.from
    const to = entry.validity?.to ?? from
    return Number.isInteger(from) && Number.isInteger(to) && chapterNo >= from && chapterNo <= to
  }
  const scoped = entries.filter(inRange).slice(0, limit)
  const events = scoped
    .filter((entry) => entry.layer === 'plot')
    .flatMap((entry) => (entry.events ?? []).map((event) => ({ ...event, entryId: entry.id, chapter: entry.validity?.from ?? null })))

  if (scoped.length) {
    const covered = new Set(scoped.flatMap((entry) => {
      const from = entry.validity?.from
      const to = entry.validity?.to ?? from
      if (!Number.isInteger(from) || !Number.isInteger(to)) return []
      const list = []
      for (let n = from; n <= to; n += 1) list.push(n)
      return list
    }))
    const partial = chapterNo != null && !covered.has(chapterNo)
    return {
      source: partial ? CONTEXT_SOURCE.FACT_PARTIAL : CONTEXT_SOURCE.FACT,
      entries: scoped,
      events,
      proseText: null,
      degraded: partial,
      notes: partial ? [...notes, `事实链未覆盖第 ${chapterNo} 章（已覆盖：${[...covered].sort((a, b) => a - b).join('、')}）`] : notes
    }
  }

  // 降级：读正文（这是 FACT-FIRST 唯一允许的正文读取路径，且必须留痕）
  const proseFiles = listProseFiles(root)
  const target = chapterNo == null
    ? proseFiles
    : proseFiles.filter((item) => item.chapterNo === chapterNo)
  if (!target.length) {
    return { source: CONTEXT_SOURCE.EMPTY, entries: [], events: [], proseText: null, degraded: true, notes: [...notes, '事实链与正文均无数据'] }
  }
  const chunks = []
  for (const item of target) {
    try {
      chunks.push(await readFile(join(root, item.file), 'utf8'))
    } catch (error) {
      notes.push(`正文读取失败 ${item.file}：${text(error?.message ?? error)}`)
    }
  }
  if (!chunks.length) {
    return { source: CONTEXT_SOURCE.EMPTY, entries: [], events: [], proseText: null, degraded: true, notes }
  }
  return {
    source: CONTEXT_SOURCE.PROSE_FALLBACK,
    entries: [],
    events: [],
    proseText: chunks.join('\n\n'),
    degraded: true,
    notes: [...notes, '事实链为空 → 已降级读正文（建议跑一次抽取）']
  }
}

/**
 * 取派生语义（六槽位/因果图/需求/台账）——FACT-FIRST 里的「事实链派生层」。
 * 落盘规范同 build-wiki：兄弟 `<id>.wiki.json` 优先，回落信封内嵌。
 *
 * @param {object} input
 * @param {string} input.root 库根
 * @param {string} input.bookId 书 ID（extraction 文件名主干）
 * @returns {Promise<{ok:boolean, wiki:object|null, notes:string[]}>}
 */
export async function loadFactDerived({ root, bookId } = {}) {
  const notes = []
  try {
    // 派生层走 readFactWiki 单口：它自己找兄弟 `<id>.wiki.json`，缺了回落信封内嵌。
    // 不在这里拼路径——目录名归 factFileStore 的 FACT_DIR_NAME 管（当前是「拆解」），
    // 早先硬编码 `.pinax/extractions/` 是错的，在真库上必然 ENOENT。
    const { wiki } = factStore.readFactWiki({ root, id: bookId })
    if (!wiki || !Object.keys(wiki).length) {
      return { ok: false, wiki: null, notes: ['派生层为空（先跑 enrich）'] }
    }
    return { ok: true, wiki, notes }
  } catch (error) {
    return { ok: false, wiki: null, notes: [`派生层读取失败：${text(error?.message ?? error)}`] }
  }
}

/** 最近的直接读正文记录（诊断用）。 */
export const PROSE_DIRECT_READS = []

/**
 * 声明式闸门：调用方想「不用事实链、直接读正文」时必须过这里。
 *
 * 用途不是拦人，是**留审计痕迹**——把降级决定变成可查询的记录，而不是散落在各处的静默 fallback。
 *
 * @returns {{allowed:boolean, reason:string, audited:true}}
 */
export function allowProseDirectRead({ caller = '', reason = '' } = {}) {
  const why = text(reason).trim()
  if (!why) {
    return { allowed: false, reason: 'FACT-FIRST 规则 1：直接读正文必须说明理由（reason）', audited: true }
  }
  const record = { at: new Date().toISOString(), caller: text(caller) || 'unknown', reason: why }
  PROSE_DIRECT_READS.push(record)
  if (PROSE_DIRECT_READS.length > 200) PROSE_DIRECT_READS.shift()
  return { allowed: true, reason: why, audited: true }
}

/** 测试用：清空审计记录。 */
export function resetProseAudit() {
  PROSE_DIRECT_READS.length = 0
}
