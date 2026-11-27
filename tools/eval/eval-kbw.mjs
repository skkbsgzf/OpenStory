/**
 * KBW 评测循环（KB-ARCH P0 验收）——知识增强写作 vs 基线写作的双臂对照。
 *
 * 指标：
 *   主指标 KBWPR ＝ 增强臂达标任务数 / 6（达标 = G 全过 且 F ≥ 0.6 且 S ≥ 0.5），目标 ≥ 5/6
 *   佐证 ΔF ＝ F̄(增强) − F̄(基线)，目标 ≥ +0.25
 * 评分：text/lint.runStyleCheck（规则可判、可复算）；守卫 G＝产出对语料 12 字逐字 shingle 查重（≥2 处命中即泄漏）。
 *
 * 用法：
 *   node tools/eval/eval-kbw.mjs                # 全量跑（双臂×6）
 *   node tools/eval/eval-kbw.mjs --reuse        # 命中缓存的不重生成
 *   node tools/eval/eval-kbw.mjs --only T1,T2   # 只跑指定任务
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'
import { buildAugmentedPrompt, routeQuery, resolveCollections } from '../../src/modules/knowledge/knowledgeRouter.mjs'
import { fingerprintHint, runStyleCheck } from '../../src/modules/text/lint.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..', '..')
const OUT = join(ROOT, '.cache', 'eval')
mkdirSync(OUT, { recursive: true })

const args = process.argv.slice(2)
const REUSE = args.includes('--reuse')
const ONLY = args.includes('--only') ? args[args.indexOf('--only') + 1].split(',') : null

/* ---------- LLM 客户端（opencode zen · DeepSeek v4.1-flash，关推理） ---------- */
const LLM = {
  // 凭据只从环境变量读：脚本本身绝不落盘、不入库、不打印。
  key: String(process.env.OPENCODE_ZEN_API_KEY ?? '').trim(),
  url: String(process.env.OPENCODE_ZEN_URL ?? 'https://opencode.ai/zen/go/v1/chat/completions').trim(),
  model: String(process.env.OPENCODE_ZEN_MODEL ?? 'deepseek-v4.1-flash').trim()
}
async function llm(prompt, maxTokens = 4000) {
  const r = await fetch(LLM.url, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + LLM.key, 'Content-Type': 'application/json', 'x-opencode-session': randomUUID() },
    body: JSON.stringify({
      model: LLM.model,
      messages: [{ role: 'user', content: prompt }],
      max_tokens: maxTokens,
      temperature: 0.8,
      reasoning_effort: 'none'
    })
  })
  if (!r.ok) throw new Error(`LLM ${r.status}: ${(await r.text()).slice(0, 200)}`)
  const d = await r.json()
  return d.choices?.[0]?.message?.content?.trim() ?? ''
}

/* ---------- 评测集 ---------- */
const TASKS = [
  {
    id: 'T1', genre: 'short-story', pack: 'style-wangbuliao-baiyue',
    task: '写一篇番茄短篇小说的开头，约 2000 字。设定：婚后三年，丈夫心里始终放不下他的白月光；而“我”心里其实也一直藏着一个人。',
    query: '白月光 双向暗恋 婚姻 纯爱'
  },
  {
    id: 'T2', genre: 'short-story', pack: 'style-moshi-danmu',
    task: '写一篇番茄短篇小说的开头，约 2000 字。设定：主角获得了能看见弹幕的金手指，弹幕说末世三天就结束；男友却正在让她花 200 万囤 100 吨米。',
    query: '弹幕 金手指 末世 囤货'
  },
  {
    id: 'T3', genre: 'short-story', pack: 'style-nianshang-yinshi',
    task: '写一篇番茄短篇小说的开头，约 2000 字。设定：女主嫁给了大她七岁的清冷教授，婚后生活完美到让她隐隐不安。',
    query: '年上 清冷 婚后 甜宠'
  },
  {
    id: 'T4', genre: 'long-serial', pack: 'style-rejinzhi',
    task: '写一部长篇古言权谋小说的第一章，约 2000 字。设定：罪臣之女带着一份满朝文武的点评名单，去见一位势力通天的年轻权臣，要做一笔交易。',
    query: '古言 权谋 交易 灾星'
  },
  {
    id: 'T5', genre: 'long-serial', pack: 'style-shangan-guanchang',
    task: '写一部长篇官场小说的第一章，约 2000 字。设定：2005 年，县城青年的女友考上公务员后立刻提分手，他立誓要往上爬。',
    query: '官场 上岸 分身 体制'
  },
  {
    id: 'T6', genre: 'long-serial', pack: 'style-da-qin-yaoren',
    task: '写一部长篇历史脑洞小说的第一章，约 2000 字。设定：主角拥有从时空长河里召唤历史名人的能力，第一个被召唤到秦始皇面前的是诸葛亮。',
    query: '历史 名人 召唤 秦始皇'
  }
]

/* ---------- 知识装配 ---------- */
function readPackBody(pack) {
  const p = join(ROOT, 'skills', pack, 'SKILL.md')
  const raw = readFileSync(p, 'utf-8')
  return raw.split(/^---$/m).slice(2).join('---').trim()
}
function readSignalBody() {
  return readPackBody('reader-needs-ironrules')
}
/** 真检索：kbAdapter 直连 WeKnora knowledge-search（precedent 意图，弱命中丢弃）。 */
async function retrievePrecedent(task) {
  const cfg = resolveCollections('C:/Users/Administrator/AppData/Local/OpenStory/openstory/kb-config.json')
  if (!cfg.ok) return { hits: [], note: 'kb-config 不可用：' + cfg.error }
  const route = routeQuery({ genre: task.genre, intent: 'precedent' })
  const ids = route.collectionIds.map((alias) => cfg.map[alias]).filter(Boolean)
  if (!ids.length) return { hits: [], note: '路由库不在配置里' }
  try {
    const r = await fetch(cfg.baseUrl + '/api/v1/knowledge-search', {
      method: 'POST',
      headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: task.query, knowledge_base_ids: ids, match_count: 2 })
    })
    const d = await r.json()
    const arr = Array.isArray(d.data) ? d.data : []
    const hits = arr
      .filter((c) => Number(c.score ?? 0) >= 0.45)
      .map((c) => ({ source: 'precedent', title: c.knowledge_title ?? '', text: c.content ?? '', score: c.score }))
    return { hits, note: `检索 ${arr.length} 条，强命中 ${hits.length} 条（≥0.45）` }
  } catch (error) {
    return { hits: [], note: '检索失败：' + error.message }
  }
}

/* ---------- 守卫：语料逐字 shingle 查重 ---------- */
function loadCorpus() {
  const parts = []
  const dl = 'C:/Users/Administrator/D盘归档/写作/写作/02_工具/番茄小说下载器/'
  for (const f of readdirSync(dl)) {
    if (f.endsWith('.txt')) {
      try { parts.push(readFileSync(join(dl, f), 'utf-8')) } catch { /* 跳过大文件失败 */ }
    }
  }
  const qbook = 'D:/Qbook/短篇选题库/正文/'
  try {
    for (const f of readdirSync(qbook)) {
      if (f.endsWith('.txt')) parts.push(readFileSync(join(qbook, f), 'utf-8'))
    }
  } catch { /* 目录不可用就只用下载器语料 */ }
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

/* ---------- 主流程 ---------- */
const corpus = loadCorpus()
console.log(`语料装载：${corpus.length} 字（守卫用）`)
const results = []

for (const task of TASKS) {
  if (ONLY && !ONLY.includes(task.id)) continue
  console.log(`\n==== ${task.id}（${task.pack}）`)
  // 知识装配
  const styleBody = readPackBody(task.pack)
  const prec = await retrievePrecedent(task)
  console.log('  先例检索：' + prec.note)
  const kbHits = [
    { source: 'style', title: task.pack, text: styleBody },
    { source: 'recipe', title: '指纹硬指标', text: fingerprintHint(task.pack) },
    ...prec.hits,
    { source: 'signal', title: '读者五铁律', text: readSignalBody().slice(0, 1600) }
  ]
  const enhancedPrompt = buildAugmentedPrompt(task.task, kbHits)
  const baselinePrompt = `${task.task}\n\n【要求】\n- 按番茄平台的风格写好。`

  // 双臂生成（带缓存）
  const gen = async (arm, prompt) => {
    const cache = join(OUT, `${task.id}-${arm}.txt`)
    if (REUSE && existsSync(cache)) {
      console.log(`  ${arm}: 缓存复用`)
      return readFileSync(cache, 'utf-8')
    }
    const t0 = Date.now()
    const text = await llm(prompt)
    writeFileSync(cache, text, 'utf-8')
    console.log(`  ${arm}: 生成 ${text.length} 字（${Math.round((Date.now() - t0) / 1000)}s）`)
    return text
  }
  const [baseText, enhText] = await Promise.all([
    gen('baseline', baselinePrompt),
    gen('enhanced', enhancedPrompt)
  ])

  // 评分（两臂都按同一包的指纹判，算 ΔF）
  const baseCheck = runStyleCheck(baseText, task.pack)
  const enhCheck = runStyleCheck(enhText, task.pack)
  const guard = guardCheck(enhText, corpus)
  const pass = baseCheck.ok && enhCheck.ok && enhCheck.pass && guard.pass
  results.push({
    id: task.id, pack: task.pack,
    baseline: { F: baseCheck.F ?? 0, S: baseCheck.S ?? 0, chars: baseCheck.chars ?? 0 },
    enhanced: { F: enhCheck.F ?? 0, S: enhCheck.S ?? 0, chars: enhCheck.chars ?? 0, leaks: guard.leaks },
    pass, guardPass: guard.pass,
    diagnosis: [
      ...(enhCheck.ok ? enhCheck.language.filter((x) => !x.ok).map((x) => `F✗ ${x.desc}（实测 ${x.value}）`) : [enhCheck.error ?? '']),
      ...(enhCheck.ok ? enhCheck.structure.filter((x) => !x.ok).map((x) => `S✗ ${x.desc}`) : []),
      ...(guard.pass ? [] : [`G✗ 语料泄漏 ${guard.leaks} 处：${guard.samples.join(' / ')}`])
    ]
  })
  console.log(`  基线 F=${baseCheck.F} S=${baseCheck.S} ｜ 增强 F=${enhCheck.F} S=${enhCheck.S} ｜ 泄漏=${guard.leaks} ｜ ${pass ? '✅ 达标' : '❌ 未达标'}`)
  for (const d of results[results.length - 1].diagnosis) console.log('    ' + d)
}

/* ---------- 汇总 ---------- */
const passes = results.filter((x) => x.pass).length
const kbwpr = results.length ? passes / results.length : 0
const dF = results.length ? results.reduce((s, x) => s + (x.enhanced.F - x.baseline.F), 0) / results.length : 0
const dS = results.length ? results.reduce((s, x) => s + (x.enhanced.S - x.baseline.S), 0) / results.length : 0
const summary = {
  generatedAt: new Date().toISOString(),
  kbwpr, passes, total: results.length, target: 5 / 6,
  dF: Math.round(dF * 100) / 100, dS: Math.round(dS * 100) / 100, dFTarget: 0.25,
  verdict: kbwpr >= 5 / 6 && dF >= 0.25 ? 'PASS' : 'CONTINUE',
  results
}
writeFileSync(join(OUT, 'report.json'), JSON.stringify(summary, null, 2), 'utf-8')

const md = [
  '# KBW 评测报告（知识增强写作双臂对照）', '',
  `> ${summary.generatedAt}｜模型 ${LLM.model}｜守卫语料 ${corpus.length} 字`, '',
  `## 指标`, '',
  `| 指标 | 实测 | 目标 | 判定 |`,
  `|---|---|---|---|`,
  `| KBWPR（增强臂达标率） | ${passes}/${results.length} | ≥5/6 | ${kbwpr >= 5 / 6 ? '✅' : '❌'} |`,
  `| ΔF（指纹分增量） | ${dF >= 0 ? '+' : ''}${Math.round(dF * 100) / 100} | ≥+0.25 | ${dF >= 0.25 ? '✅' : '❌'} |`,
  `| ΔS（结构分增量） | ${dS >= 0 ? '+' : ''}${Math.round(dS * 100) / 100} | 参考 | — |`, '',
  `## 逐任务`, '',
  `| 任务 | 包 | 基线 F/S | 增强 F/S | 泄漏 | 判定 |`,
  `|---|---|---|---|---|---|`
]
for (const r of results) {
  md.push(`| ${r.id} | ${r.pack.replace('style-', '')} | ${r.baseline.F}/${r.baseline.S} | ${r.enhanced.F}/${r.enhanced.S} | ${r.enhanced.leaks} | ${r.pass ? '✅' : '❌'} |`)
  if (r.diagnosis.length) md.push(`> - ${r.id}：${r.diagnosis.join('；')}`)
}
writeFileSync(join(OUT, 'report.md'), md.join('\n'), 'utf-8')
console.log(`\n====== 汇总：KBWPR ${passes}/${results.length}（目标 5/6）｜ΔF ${dF >= 0 ? '+' : ''}${Math.round(dF * 100) / 100}（目标 +0.25）｜判定 ${summary.verdict}`)
console.log('报告：' + join(OUT, 'report.md'))
