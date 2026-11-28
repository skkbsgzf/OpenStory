/**
 * 样章生成器（KB-ARCH 验收物）——用完整知识管线写一章：文风包全文＋指纹硬指标＋案例卡真检索＋信号铁律。
 *
 * 用法：
 *   node tools/eval/write-sample.mjs --pack style-wangbuliao-baiyue --task "…" [--chars 3600] [--out docs/samples/xxx.md]
 * 产出：正文＋指纹逐项命中表＋知识引用清单。评分用 text/lint；守卫对语料查重。
 */
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { buildAugmentedPrompt, routeQuery, resolveCollections } from '../../src/modules/knowledge/knowledgeRouter.mjs'
import { fingerprintHint, runStyleCheck } from '../../src/modules/text/lint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')

const args = process.argv.slice(2)
const argOf = (name, fallback = '') => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const PACK = argOf('--pack', 'style-wangbuliao-baiyue')
const CHARS = Number(argOf('--chars', '3600'))
const OUT = argOf('--out', join(ROOT, 'docs', 'samples', `sample-${PACK.replace('style-', '')}-${new Date().toISOString().slice(0, 10)}.md`))
const TASK = argOf('--task', '写一篇番茄短篇小说的一章，3000-4000 字，要有完整的起承转合与收束拍。设定：婚后五年，丈夫的记事本里夹着一张陌生女人的电影票根；我的抽屉深处，也压着同一场次的票根。')

const LLM = {
  // 凭据只从环境变量读：脚本本身绝不落盘、不入库、不打印。
  key: String(process.env.OPENCODE_ZEN_API_KEY ?? '').trim(),
  url: String(process.env.OPENCODE_ZEN_URL ?? 'https://opencode.ai/zen/go/v1/chat/completions').trim(),
  model: String(process.env.OPENCODE_ZEN_MODEL ?? 'deepseek-v4.1-flash').trim()
}
async function llm(prompt, maxTokens) {
  const r = await fetch(LLM.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + LLM.key, 'Content-Type': 'application/json', 'x-opencode-session': randomUUID() },
    body: JSON.stringify({ model: LLM.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.8, reasoning_effort: 'none' })
  })
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json()
  return d.choices?.[0]?.message?.content?.trim() ?? ''
}

function readPackBody(pack) {
  const raw = readFileSync(join(ROOT, 'skills', pack, 'SKILL.md'), 'utf-8')
  return raw.split(/^---$/m).slice(2).join('---').trim()
}
async function retrievePrecedent(query) {
  const cfg = resolveCollections(process.env.OPENSTORY_KB_CONFIG || '')
  if (!cfg.ok) return { hits: [], note: 'kb-config 不可用' }
  const route = routeQuery({ intent: 'precedent' })
  const ids = route.collectionIds.map((a) => cfg.map[a]).filter(Boolean)
  const r = await fetch(cfg.baseUrl + '/api/v1/knowledge-search', {
    method: 'POST',
    headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, knowledge_base_ids: ids, match_count: 1 })
  })
  const d = await r.json()
  const arr = Array.isArray(d.data) ? d.data : []
  const hits = arr.filter((c) => Number(c.score ?? 0) >= 0.45).map((c) => ({ source: 'precedent', title: c.knowledge_title ?? '', text: c.content ?? '', score: c.score }))
  return { hits, note: `${arr.length} 条命中，强命中 ${hits.length}` }
}
function loadCorpus() {
  const parts = []
  const dl = process.env.OPENSTORY_DOWNLOADER_DIR || ''
  for (const f of dl ? readdirSync(dl) : []) if (f.endsWith('.txt')) { try { parts.push(readFileSync(join(dl, f), 'utf-8')) } catch { } }
  const 私人语料库 = process.env.OPENSTORY_CORPUS_TEXT_DIR || ''
  try { for (const f of readdirSync(私人语料库)) if (f.endsWith('.txt')) parts.push(readFileSync(join(私人语料库, f), 'utf-8')) } catch { }
  return parts.join('\n').replace(/\s+/g, '')
}
function guardCheck(text, corpus) {
  const clean = text.replace(/\s+/g, '')
  const hits = []
  for (let i = 0; i < 12; i++) {
    const start = Math.floor((i / 12) * Math.max(clean.length - 14, 1)) + 1
    const shingle = clean.slice(start, start + 12)
    if (shingle.length < 12) continue
    if (corpus.includes(shingle)) hits.push(shingle)
  }
  return { leaks: hits.length, samples: hits.slice(0, 3), pass: hits.length < 2 }
}

console.log('== 知识装配 ==')
const styleBody = readPackBody(PACK)
const prec = await retrievePrecedent('白月光 双向暗恋 婚姻 票根')
console.log('先例检索：' + prec.note + (prec.hits[0] ? '（' + prec.hits[0].title + '）' : ''))
const kbHits = [
  { source: 'style', title: PACK, text: styleBody },
  { source: 'recipe', title: '指纹硬指标', text: fingerprintHint(PACK) },
  ...prec.hits,
  { source: 'signal', title: '读者五铁律', text: readPackBody('reader-needs-ironrules').slice(0, 1600) }
]
const prompt = buildAugmentedPrompt(TASK, kbHits, { requirements: [`全章 ${CHARS} 字左右，单章完整成篇（不要「未完待续」）。`] })
console.log(`注入块总长：${prompt.length} 字`)

console.log('== 生成 ==')
const t0 = Date.now()
const text = await llm(prompt, 8000)
console.log(`产出 ${text.length} 字（${Math.round((Date.now() / 1) % 1 === 0 ? (Date.now() - t0) / 1000 : 0)}s）`.replace('（0s）', `（${Math.round((Date.now() - t0) / 1000)}s）`))

console.log('== 评分 ==')
const check = runStyleCheck(text, PACK)
const corpus = loadCorpus()
const guard = guardCheck(text, corpus)
console.log(`F=${check.F} S=${check.S} pass=${check.pass} 泄漏=${guard.leaks}`)

const refList = [
  `文风包：${PACK}（${styleBody.length} 字全文注入）`,
  `指纹硬指标块：${fingerprintHint(PACK).length} 字`,
  `案例卡：${prec.hits[0]?.title ?? '无（弱命中丢弃）'}`,
  '信号：reader-needs-ironrules（读者五铁律，1600 字节选）',
  `模型：${LLM.model}（reasoning off）`
]
const doc = [
  `# 样章 · ${PACK}`, '',
  `> ${new Date().toISOString().slice(0, 19)}｜知识增强管线产出｜守卫：${guard.pass ? `通过（${guard.leaks} 处 12 字重合，阈值内）` : '未通过'}`, '',
  '## 知识引用清单', '',
  ...refList.map((x) => `- ${x}`), '',
  '## 指纹命中表', '',
  `| 维度 | 项 | 实测 | 判定 |`, '|---|---|---|---|',
  ...check.language.map((x) => `| 语言 | ${x.desc} | ${x.value} | ${x.ok ? '✅' : '❌'} |`),
  ...check.structure.map((x) => `| 结构 | ${x.desc} | — | ${x.ok ? '✅' : '❌'} |`),
  `| **总分** | F=${check.F}｜S=${check.S} | 门禁 0.6/0.5 | ${check.pass ? '✅ PASS' : '❌'} |`, '',
  '## 正文', '',
  text, ''
]
mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, doc.join('\n'), 'utf-8')
console.log('落盘：' + OUT)
