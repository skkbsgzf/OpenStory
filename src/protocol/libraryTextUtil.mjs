/**
 * 底座契约：库内文本解析（章节号与世界书条目投影）。纯函数，无 I/O、无工作台归属。
 * OS-195 由 library 模块下移；出处见 docs/kernel-provenance.md。
 */

import { parseWorldbookEntryFile as contractParseEntryFile } from './worldbookContract.mjs'

export { parseChapterNumber } from './chapterNumber.mjs'

/** 运行时桶派生边的 src 保留字（读回时据此还原为 relations 对象桶；真富关系不用该值）。 */
const WORLDBOOK_DERIVED_SRC = 'entry'

function worldbookIsPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function worldbookStringList(value) {
  return Array.isArray(value) ? value.map((item) => (typeof item === 'string' ? item : String(item ?? ''))) : []
}

/** 契约条目 → 运行时条目（读侧投影 = A2 读回形状）：src:'entry' 派生边还原为对象桶
 *  （placeIds/characterIds 归并 locations/characters），其余为 relationsRich；metadata/extra
 *  还位；空 profile/extra/version 等不产出键。 */
function contractEntryToRuntime(parsed) {
  const tags = worldbookStringList(parsed.tags)
  const rich = []
  const buckets = { locations: [], characters: [], events: [] }
  const bucketOf = { location: 'locations', character: 'characters', event: 'events' }
  for (const rel of Array.isArray(parsed.relations) ? parsed.relations : []) {
    if (!worldbookIsPlainObject(rel)) continue
    if (rel.src === WORLDBOOK_DERIVED_SRC) {
      const to = String(rel.to ?? '').trim()
      const bucket = bucketOf[String(rel.type ?? '')]
      if (bucket && to && !buckets[bucket].includes(to)) buckets[bucket].push(to)
      continue
    }
    rich.push(rel)
  }
  const entry = {
    id: String(parsed.id ?? ''),
    name: String(parsed.name ?? ''),
    type: String(parsed.type ?? '') || String(parsed.kind ?? '') || 'general',
    keys: worldbookStringList(parsed.keys),
    keysSecondary: worldbookStringList(parsed.keysSecondary),
    content: typeof parsed.content === 'string' ? parsed.content : String(parsed.content ?? '')
  }
  if (parsed.kind) entry.kind = parsed.kind
  entry.status = String(parsed.status ?? '') || 'active'
  entry.tags = tags
  entry.links = worldbookStringList(parsed.links)
  entry.cat = worldbookStringList(parsed.cat)
  if (parsed.version !== undefined && parsed.version !== '') entry.version = parsed.version
  if (parsed.summary) entry.summary = parsed.summary
  entry.sourceRefs = worldbookStringList(parsed.sourceRefs)
  if (parsed.updatedAt) entry.updatedAt = parsed.updatedAt
  if (worldbookIsPlainObject(parsed.injection) && Object.keys(parsed.injection).length) entry.injection = parsed.injection
  if (worldbookIsPlainObject(parsed.profile) && Object.keys(parsed.profile).length) entry.profile = parsed.profile
  entry.relations = { tags: tags.slice(), ...buckets }
  if (rich.length) entry.relationsRich = rich
  const extra = worldbookIsPlainObject(parsed.extra) ? { ...parsed.extra } : {}
  if (worldbookIsPlainObject(extra.relationExtensions)) { Object.assign(entry.relations, extra.relationExtensions); delete extra.relationExtensions }
  if (extra.metadata !== undefined) {
    entry.metadata = extra.metadata
    delete extra.metadata
  }
  if (Object.keys(extra).length) entry.extra = extra
  return entry
}

/** md 全文 → 运行时条目。ok:false 原样透传契约错误码（MISSING_FRONTMATTER/MISSING_ID/…）。 */
export function parseWorldbookEntryFile(text) {
  const parsed = contractParseEntryFile(String(text ?? '').replace(/\r\n/g, '\n'))
  if (!parsed.ok) return parsed
  return { ok: true, entry: contractEntryToRuntime(parsed.entry) }
}
