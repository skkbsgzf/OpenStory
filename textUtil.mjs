// OS-123 解耦①：文本解析工具自持层（fork 点，归本仓所有，不再经 vendor 同步）。
// 函数体逐字拷贝自 vendor（提交 70a4f44，见 core/VENDORED.md）：
//   · parseChapterNumber ＋ CHINESE_DIGITS ← core/pinax/server/mcp/projectImport.js:39,58-73
//   · parseWorldbookEntryFile ＋ contractEntryToRuntime ＋ worldbookIsPlainObject ＋
//     worldbookStringList ＋ WORLDBOOK_DERIVED_SRC ← core/pinax/server/services/localMirrorService.js:228,230-236,304-360
// 契约判定（contractParseEntryFile）来自 @pinax/core 的世界书文件契约 v2
// （原经 core/pinax/shared/worldbookFileContract.js 两行垫片 re-export，垫片随 server 层一起移除）。
import { parseWorldbookEntryFile as contractParseEntryFile } from '@pinax/core/domain/worldbookFileContract'

/** 中文数字表（「两」归一为 2；零到九）。 */
const CHINESE_DIGITS = { 零: 0, 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 两: 2 }

/** 中文数字 → 阿拉伯数字（支持到千位；认不出返回 null，不猜）。 */
export function parseChapterNumber(raw) {
  const text = String(raw ?? '').trim()
  if (!text) return null
  if (/^\d+$/u.test(text)) return Number(text)
  if (!/^[零一二三四五六七八九十百千两]+$/u.test(text)) return null
  const unit = { 十: 10, 百: 100, 千: 1000 }
  let total = 0
  let current = 0
  for (const char of text) {
    if (CHINESE_DIGITS[char] !== undefined) current = CHINESE_DIGITS[char]
    else if (unit[char]) { total += (current || 1) * unit[char]; current = 0 }
    else return null
  }
  return total + current
}

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
  if (worldbookIsPlainObject(extra.pinaxRelationExtensions)) { Object.assign(entry.relations, extra.pinaxRelationExtensions); delete extra.pinaxRelationExtensions }
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
