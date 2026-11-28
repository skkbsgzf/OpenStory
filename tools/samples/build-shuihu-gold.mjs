/**
 * 从《水浒传》前 10 回**事实链**生成 OS-230 黄金 query（唯一事实源口径）。
 *
 * FACT-FIRST 纪律：expected 指向 fact 条目 id（权威源），正文只作逐字出处；
 * 每回至少一条正查询，另加跨章因果查询与负查询。本脚本只生成数据，不写业务稿。
 *
 * 用法：node tools/samples/build-shuihu-gold.mjs --out knowledge-packs/shuihu-10ch/gold.json
 */
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { SHUIHU_10CH_FACTS } from './shuihu-10ch-facts.mjs'
import { SHUIHU_10CH_WIKI } from './shuihu-10ch-wiki.mjs'

const byName = new Map(SHUIHU_10CH_FACTS.map((entry) => [entry.name, entry.id]))
const factsFor = (names) => names.map((name) => {
  const id = byName.get(name)
  if (!id) throw new Error(`事实链缺条目：${name}`)
  return id
})

// 正查询：问题只问「发生了什么/谁做了什么」，expected 是事实链条目 id，不按 title/正文去重。
const positives = [
  { id: 'shuihu-01', query: '洪太尉为什么误放了一百单八魔君？', names: ['误走妖魔', '一百单八魔君'] },
  { id: 'shuihu-02', query: '王进为什么连夜离开东京？', names: ['王进私走延安府', '高俅'] },
  { id: 'shuihu-03', query: '史进为什么烧了庄院上少华山？', names: ['史进烧庄上华山', '史进'] },
  { id: 'shuihu-04', query: '鲁达为什么拳打镇关西？', names: ['拳打镇关西', '郑屠'] },
  { id: 'shuihu-05', query: '鲁智深为什么被荐往东京大相国寺？', names: ['鲁智深大闹五台山', '智真长老'] },
  { id: 'shuihu-06', query: '鲁智深在菜园怎样收服泼皮并结识林冲？', names: ['倒拔垂杨柳', '菜园泼皮'] },
  { id: 'shuihu-07', query: '高俅怎样设计陷害林冲？', names: ['误入白虎堂', '陆谦', '白虎节堂'] },
  { id: 'shuihu-08', query: '林冲在山神庙为什么杀了陆谦？', names: ['风雪山神庙', '山神庙'] },
  { id: 'shuihu-09', query: '晁盖吴用怎样取生辰纲？', names: ['智取生辰纲', '生辰纲', '吴用'] },
  { id: 'shuihu-10', query: '林冲为什么火并王伦、谁做了梁山寨主？', names: ['火并王伦', '梁山泊'] },
  { id: 'shuihu-11', query: '宋江为什么私放晁盖？', names: ['私放晁天王', '晁盖'] },
  { id: 'shuihu-12', query: '宋江为什么杀了阎婆惜？', names: ['怒杀阎婆惜', '阎婆惜'] },
  { id: 'shuihu-13', query: '野猪林里是谁救了林冲？', names: ['误入白虎堂', '鲁达'] },
  { id: 'shuihu-14', query: '林冲被逼上梁山的因果链是什么？', names: ['高衙内', '陆谦', '风雪山神庙'] }
]

const negatives = [
  { id: 'shuihu-neg-1', query: '量子计算机散热风扇型号', names: [] },
  { id: 'shuihu-neg-2', query: '修仙境界突破怎样避免只换称号', names: [] }
]

const sourceHash = createHash('sha256')
  .update(JSON.stringify({
    facts: SHUIHU_10CH_FACTS.map((f) => ({ id: f.id, name: f.name, provenance: f.provenance })),
    chapters: SHUIHU_10CH_WIKI.chapterSummaries
  }))
  .digest('hex')

const gold = {
  schema: 'openstory.knowledge-gold@1',
  corpus: 'shuihu-10ch',
  genre: '古典白话',
  factSource: { scope: '水浒传前10回', policy: 'FACT-FIRST：事实链优先、正文为出处', sourceHash, factEntryCount: SHUIHU_10CH_FACTS.length },
  thresholds: { sourceAccuracy: 1, negativePrecision: 1, macroRecallAt5: 0.85, perGenreRecallAt5: 0.75 },
  queries: [...positives, ...negatives].map(({ id, query, names }) => ({
    id,
    query,
    expected: factsFor(names),
    negative: names.length === 0
  }))
}

const out = resolve(process.argv[process.argv.indexOf('--out') + 1] ?? 'knowledge-packs/shuihu-10ch/gold.json')
await mkdir(dirname(out), { recursive: true })
await writeFile(out, `${JSON.stringify(gold, null, 2)}\n`, 'utf8')
console.log(JSON.stringify({ ok: true, file: out, queries: gold.queries.length, positives: positives.length, negatives: negatives.length, sourceHash }, null, 2))
