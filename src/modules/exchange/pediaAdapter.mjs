/**
 * NovelPedia 薄适配器（ADR 0001 / G7，OS-162）——pedia/v1 ↔ fact.data/v3 纯字段映射。
 *
 * 硬约束：
 *   · 纯函数、零 fs、零网络——只做字段投影，读写一律走既有 fact 写通道
 *     （src/services/factImportWrite.mjs，factEntriesImport 也调它）；
 *   · 只照 ADR 0001 附录 A 的表落字段——表外字段不臆造；id 不重算（两边同式，实测逐位相同）；
 *   · style 层无归宿：不转换、如实单列；反向投影返回丢失字段清单，不静默丢。
 *
 * 依赖：域校验器经 protocol/factDomain.mjs 转供叶子取（S2.1 模块不许直引 kernel）。
 */
import { validateFactEntry, FACT_SCHEMA } from '../../protocol/factDomain.mjs'

const PEDIA_SCHEMA = 'pedia/v1'
const PEDIA_STYLE_LAYER = 'style'

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/** 原样拷贝一个值（数组/对象深拷贝，其他原样）——映射只改字段名，不改内容。 */
function copy(value) {
  if (Array.isArray(value)) return value.map(copy)
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copy(item)]))
  return value
}

/** 附录 A · 原样同名同形的字段（含 provenance、fingerprint、各层 optional）。 */
const PASS_FIELDS = [
  'id', 'layer', 'name', 'domain', 'slot', 'rank', 'definition',
  'aliases', 'relations', 'stats', 'votes', 'span',
  'provenance', 'fingerprint',
  // character 层 optional
  'identity', 'personality', 'trajectory',
  // plot 层 optional
  'fact', 'hypothesis', 'events'
]

/**
 * pedia/v1 → fact.data/v3（ADR 附录 A2）。
 * 规则：schema 改名、补 status:'draft' 与 provenance.mode:'analyze'、其余同名原样、id 不重算；
 * layer:style 不转换（返回 skipped）。转换结果逐条过 validateFactEntry。
 *
 * @param {object} entry pedia 条目
 * @returns {{ entry?:object, skipped?:boolean, reason?:string, errors?:object[], warnings?:object[] }}
 */
export function pediaToFactEntry(entry) {
  if (!isObject(entry)) return { errors: [{ code: 'INVALID_ENTRY', field: 'entry', message: 'pedia 条目必须是对象' }] }
  const layer = String(entry.layer ?? '')
  if (layer === PEDIA_STYLE_LAYER) {
    return { skipped: true, reason: 'style 层已解耦、不进 fact 条目层（ADR 0001 附录 A1）——原样保留在 pedia 侧' }
  }
  const out = {}
  for (const key of PASS_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(entry, key)) out[key] = copy(entry[key])
  }
  out.schema = FACT_SCHEMA
  out.status = 'draft' // 导入不替作者拍板，落默认态（附录 A2）
  const provenance = isObject(out.provenance) ? out.provenance : {}
  if (!provenance.mode) provenance.mode = 'analyze' // pedia 条目都是拆书抽取产物（附录 A2）
  out.provenance = provenance
  const checked = validateFactEntry(out)
  return { entry: out, errors: checked.errors, warnings: checked.warnings }
}

/** ADR 附录 A3：fact→pedia 回写时无处安放的字段清单（按层分别列出）。 */
export const PEDIA_LOSS_FIELDS = Object.freeze({
  top: Object.freeze(['status', 'validity', 'readerCognition', 'provenance.mode']),
  character: Object.freeze(['anchors', 'memoryPoints', 'castRole', 'knowledge']),
  plot: Object.freeze(['rhythmSpec', 'structureTemplates', 'events[].track', 'events[].novelty', 'events[].segments'])
})

/**
 * fact.data/v3 → pedia/v1（附录 A3）：投影 + 丢失字段清单。
 * events 本身带得走（pedia plot 层 optional 有 events），但内部 track/novelty/segments 单列丢失。
 *
 * @param {object} entry fact 条目
 * @returns {{ entry:object, lost:string[] }}
 */
export function factEntryToPedia(entry) {
  if (!isObject(entry)) return { entry: entry, lost: [] }
  const out = {}
  for (const key of PASS_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(entry, key)) continue
    // events 本身带得走，但事件内的 track/novelty/segments 是 v3 增量、pedia 侧读不懂——
    // 剥离出来并计入 lost（ADR 附录 A3），不静默透传。
    if (key === 'events' && Array.isArray(entry.events)) {
      out.events = entry.events.map((event) => {
        if (!isObject(event)) return copy(event)
        const { track, novelty, segments, ...rest } = event
        return copy(rest)
      })
    } else {
      out[key] = copy(entry[key])
    }
  }
  out.schema = PEDIA_SCHEMA

  const lost = []
  const topLost = PEDIA_LOSS_FIELDS.top.filter((field) => {
    if (field === 'provenance.mode') return Boolean(entry.provenance?.mode)
    return entry[field] !== undefined
  }).map((field) => (field === 'provenance.mode' ? field : field))
  lost.push(...topLost)
  if (entry.layer === 'character') {
    lost.push(...PEDIA_LOSS_FIELDS.character.filter((field) => entry[field] !== undefined))
  }
  if (entry.layer === 'plot') {
    lost.push(...PEDIA_LOSS_FIELDS.plot.filter((field) => {
      if (field.startsWith('events[]')) {
        return (Array.isArray(entry.events) ? entry.events : []).some((event) => isObject(event) && event[field.slice(9)] !== undefined)
      }
      return entry[field] !== undefined
    }))
  }
  return { entry: out, lost }
}
