/**
 * KB 文档生成器（M3/M4/M5）——从既有调研数据生成 WeKnora 入库文档。
 *
 * 输入：
 *   D:/Qbook/短篇选题库/选题库.json        （100 本：效率/受众/题材/字数）
 *   D:/Qbook/短篇选题库/拆解/{id}.json     （22 本 fact＋wiki 槽位）
 *   D:/Pinax-e2e/research/reader-signal.json（100 本行为信号聚合）
 * 输出（D:/OpenStory/.cache/gen/）：
 *   信号全表.md
 *   案例卡/案例卡-{书名}.md × 22
 *   套路分册/{题材组}.md × 5
 *
 * 用法：node tools/distill/build-kb-docs.mjs
 */
import { readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const QBOOK = 'D:/Qbook/短篇选题库'
const RESEARCH = 'D:/Pinax-e2e/research'
const OUT = 'D:/OpenStory/.cache/gen'
mkdirSync(join(OUT, '案例卡'), { recursive: true })
mkdirSync(join(OUT, '套路分册'), { recursive: true })

const clip = (s, n) => {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim()
  return t.length > n ? t.slice(0, n) + '……' : t
}
const clean = (s) => String(s ?? '').replace(/[\\/:*?"<>|]/g, '').trim().slice(0, 50)

/* ---------- 装载数据 ---------- */
const lib = JSON.parse(readFileSync(join(QBOOK, '选题库.json'), 'utf-8'))
const libById = new Map(lib.books.map((b) => [b.id, b]))
const signal = JSON.parse(readFileSync(join(RESEARCH, 'reader-signal.json'), 'utf-8'))

const dir = join(QBOOK, '拆解')
const books = []
for (const f of readdirSync(dir)) {
  if (!f.endsWith('.json')) continue
  const id = f.replace('.json', '')
  if (id === '拆解汇总' || id === '拆解索引') continue
  const j = JSON.parse(readFileSync(join(dir, f), 'utf-8'))
  if (!j.book) continue
  let wiki = j.wiki
  if (!wiki || !wiki.storySummary) {
    const wp = join(dir, `${id}.wiki.json`)
    try { wiki = JSON.parse(readFileSync(wp, 'utf-8')) } catch { wiki = null }
  }
  books.push({ id, fact: j, wiki: wiki || {} })
}
books.sort((a, b) => (libById.get(b.id)?.efficiency ?? 0) - (libById.get(a.id)?.efficiency ?? 0))
console.log('装载拆解:', books.length, '本')

/* ---------- M3 信号全表 ---------- */
{
  const L = []
  L.push('# 番茄短篇读者信号全表', '')
  L.push('> 底账：100 本真实短篇（选题库 2026-11-12 抓取），效率＝平均在读 ÷ 字数（人/万字）。**凡文本判断与行为数据冲突，以本表为准。**', '')
  L.push('## 一、受众效率', '', '| 受众 | 本数 | 平均效率 | 平均在读 |', '|---|---|---|---|')
  for (const a of signal.audience) L.push(`| ${a.key} | ${a.n} | ${a.avgEff} | ${a.avgReads} |`)
  L.push('', '**结论**：真正跑量的是「通用」不分频的大众情绪；女频是体量最大的池子但不是最高效率。', '')
  L.push('## 二、篇幅档效率', '', '| 篇幅 | 本数 | 平均效率 |', '|---|---|---|')
  for (const t of signal.tier) L.push(`| ${t.key} | ${t.n} | ${t.avgEff} |`)
  L.push('', '**结论**：超短篇效率是长篇 3 倍——读者要 10 分钟一次情绪结算，不要一段旅程。', '')
  L.push('## 三、场域组效率（8 组）', '', '| 场域 | 本数 | 平均效率 |', '|---|---|---|')
  for (const g of signal.group) L.push(`| ${g.key} | ${g.n} | ${g.avgEff} |`)
  L.push('', '**结论**：家庭/亲属系是高效场域；职场/社会、古装/宫廷是低效场域（立项先过这道闸）。', '')
  L.push('## 四、标签效率全表（TOP 25）', '', '| 标签 | 本数 | 平均效率 | 代表作 |', '|---|---|---|---|')
  const tags = [...signal.tagRank].sort((a, b) => b.avgEff - a.avgEff)
  for (const t of tags.slice(0, 25)) L.push(`| ${t.tag} | ${t.n} | ${t.avgEff} | ${clip(t.titles?.[0] ?? '', 22)} |`)
  L.push('', '**失效标签（BOTTOM 10，同样是真信号）**', '', '| 标签 | 本数 | 平均效率 |', '|---|---|---|')
  for (const t of tags.slice(-10)) L.push(`| ${t.tag} | ${t.n} | ${t.avgEff} |`)
  L.push('', '**共同特征**：失效标签提供的是「被爱」或「宏大」，不是「我夺回了什么」；主角在仰望位。', '')
  L.push('## 五、效率 TOP 15', '', '| 作品 | 效率 | 标签 | 字数 |', '|---|---|---|---|')
  for (const t of signal.topByEff) L.push(`| ${t.title} | ${t.eff} | ${t.tags} | ${t.words} |`)
  L.push('', '## 六、效率 BOTTOM 10', '', '| 作品 | 效率 | 标签 | 字数 |', '|---|---|---|---|')
  for (const t of signal.bottomByEff) L.push(`| ${t.title} | ${t.eff} | ${t.tags} | ${t.words} |`)
  L.push('', '## 七、写作含义（五铁律速查）', '', '1. 先给主角一个「被夺走的位置」，而不是一个「需要爱的人」——第 1 章没有具体可指认的被占位置就别写。')
  L.push('2. 让读者比所有人更早知道真相——前 3 章至少 3 次「我知道但你们不知道」。')
  L.push('3. 压迫写在最亲密的关系名里——反派标签是「敌人」的改掉。')
  L.push('4. 主角的胜利是「撤离」而非「征服」——主角变强＝读者买不起的幻想。')
  L.push('5. 末章让读者后悔一次，后悔的对象是自己。', '', '> 详细推导见《短篇读者需求五铁律》（reader-needs-ironrules）。')
  writeFileSync(join(OUT, '信号全表.md'), L.join('\n'), 'utf-8')
  console.log('M3 信号全表:', L.join('\n').length, '字')
}

/* ---------- M4 案例卡 ---------- */
let cards = 0
for (const { id, fact, wiki } of books) {
  const meta = libById.get(id) ?? {}
  const book = fact.book
  const pd = wiki.slots?.plotDesign ?? {}
  const gi = wiki.slots?.gimmick ?? {}
  const it = wiki.slots?.intro ?? {}
  const st = wiki.slots?.style ?? {}
  const L = []
  L.push(`# 案例卡·《${book.title}》`, '')
  L.push(`**底账**：题材组 ${book.subject_group ?? '—'}｜质量档 ${book.grade ?? '—'}｜字数 ${book.word_count ?? meta.word_count ?? '—'}｜效率 ${meta.efficiency ?? '—'} 人/万字｜受众 ${meta.audience ?? '—'}｜作者 ${book.author ?? '—'}`, '')
  if (gi.logline) L.push(`## 一句话`, '', clip(gi.logline, 160), '')
  L.push('## 钩子与结构', '')
  if (it.hookType) L.push(`- **开局钩子**：${it.hookType}${it.firstBeat ? `——${clip(it.firstBeat, 120)}` : ''}`)
  if (pd.structure?.picked) L.push(`- **结构母型**：${clip(pd.structure.picked, 80)}（置信度 ${pd.structure.confidence ?? '—'}）`)
  if (pd.mainline) L.push(`- **主线**：${clip(pd.mainline, 200)}`)
  if (pd.subplot) L.push(`- **副线**：${clip(pd.subplot, 160)}`)
  if (pd.stages?.length) {
    L.push('- **阶段**：' + pd.stages.map((s) => `${s.phase}（${s.chapters?.join('-') ?? '—'}：${clip(s.job, 40)}）`).join(' → '))
  }
  L.push('')
  if (wiki.arc?.length) {
    L.push('## 弧线', '')
    for (const a of wiki.arc) L.push(`- **${a.phase}**（第 ${a.chapters?.join('-') ?? '—'} 节）：${clip(a.text, 140)}`)
    L.push('')
  }
  if (wiki.chapterSummaries?.length) {
    L.push('## 章节表', '', '| 节 | 功能 | 情绪 | 剧情点 | 小结 |', '|---|---|---|---|---|')
    for (const c of wiki.chapterSummaries) {
      L.push(`| ${c.chapter} | ${c.function ?? '—'} | ${c.emotion ?? '—'} | ${c.beats ?? '—'} | ${clip(c.summary, 48)} |`)
    }
    L.push('')
  }
  if (wiki.characterProfiles?.length) {
    L.push('## 人物卡', '', '| 人物 | 身份 | archetype | 目标 | 弧线 |', '|---|---|---|---|---|')
    for (const c of wiki.characterProfiles) {
      L.push(`| ${c.name} | ${clip(c.identity, 30)} | ${clip(c.archetype, 24)} | ${clip(c.goal, 40)} | ${clip(c.arc?.start, 24)}→${clip(c.arc?.end, 24)} |`)
    }
    L.push('')
  }
  const kl = wiki.ledger?.knowledgeLedger ?? []
  if (kl.length) {
    L.push('## 知情台账', '')
    for (const k of kl) L.push(`- **${k.character}**（${k.chapter ?? '—'}）：${clip(k.knows, 120)}`)
    L.push('')
  }
  if (wiki.foreshadows?.length) {
    L.push('## 伏笔', '')
    for (const f of wiki.foreshadows.slice(0, 14)) L.push(`- （第 ${f.chapter ?? '—'} 节）${clip(f.text, 90)}`)
    L.push('')
  }
  if (st.density || st.sentence) {
    L.push('## 情绪地形与句式', '')
    if (st.density) L.push(`- **密度**：${clip(st.density, 260)}`)
    if (st.sentence) L.push(`- **句式**：${clip(st.sentence, 260)}`)
    L.push('')
  }
  if (gi.empathy || gi.coolPoint) {
    L.push('## 共情与爽点', '')
    if (gi.empathy) L.push(`- **共情**：${clip(gi.empathy, 160)}`)
    if (gi.coolPoint) L.push(`- **爽点**：${clip(gi.coolPoint, 160)}`)
    L.push('')
  }
  L.push(`> 溯源：拆解 fact ${id}.json（溯源率 ${fact.quality?.traceableRate ?? '—'}），wiki enrich @${wiki.version ?? '—'}`)
  const file = join(OUT, '案例卡', `案例卡-${clean(book.title)}.md`)
  writeFileSync(file, L.join('\n'), 'utf-8')
  cards += 1
}
console.log('M4 案例卡:', cards, '张')

/* ---------- M5 套路分册 ---------- */
const byGroup = new Map()
for (const { id, fact, wiki } of books) {
  const g = fact.book.subject_group ?? '其他'
  if (!byGroup.has(g)) byGroup.set(g, [])
  byGroup.get(g).push({ id, fact, wiki, meta: libById.get(id) ?? {} })
}
for (const [group, items] of byGroup) {
  const L = []
  const effs = items.map((x) => x.meta.efficiency).filter(Boolean)
  const words = items.map((x) => x.meta.word_count ?? x.fact.book.word_count).filter(Boolean)
  L.push(`# 套路分册·${group}（${items.length} 本拆解）`, '')
  L.push(`> 底账：${items.length} 本全量拆解｜效率 ${Math.min(...effs)}–${Math.max(...effs)} 人/万字｜字数 ${Math.min(...words)}–${Math.max(...words)}。本册是「同题材内」的套路对照，跨题材共性见《番茄短篇套路手册》。`, '')
  // 结构母型分布
  const structCount = {}
  for (const { wiki } of items) {
    const picked = String(wiki.slots?.plotDesign?.structure?.picked ?? '未标')
      .replace(/（置信度[^）]*）/, '')
      .replace(/^复合（/, '').replace(/）$/, '')
    const main = picked.match(/主：\s*([^/／；;]+)/)?.[1]?.trim() ?? picked.trim()
    structCount[main] = (structCount[main] ?? 0) + 1
  }
  L.push('## 结构母型分布', '', '| 母型 | 本数 |', '|---|---|')
  for (const [k, v] of Object.entries(structCount).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`)
  L.push('')
  // 钩子类型
  const hookCount = {}
  for (const { wiki } of items) {
    const h = wiki.slots?.intro?.hookType
    if (h) for (const part of h.split(/[+＋]/).map((s) => s.trim())) hookCount[part] = (hookCount[part] ?? 0) + 1
  }
  L.push('## 开局钩子成分', '', '| 成分 | 次数 |', '|---|---|')
  for (const [k, v] of Object.entries(hookCount).sort((a, b) => b[1] - a[1])) L.push(`| ${k} | ${v} |`)
  L.push('')
  // 章功能/情绪分布
  const fnCount = {}
  const emCount = {}
  for (const { wiki } of items) {
    for (const c of wiki.chapterSummaries ?? []) {
      if (c.function) fnCount[c.function] = (fnCount[c.function] ?? 0) + 1
      if (c.emotion) emCount[c.emotion] = (emCount[c.emotion] ?? 0) + 1
    }
  }
  const rank = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}${v}`).join('｜')
  L.push('## 章功能分布（按频次）', '', rank(fnCount), '')
  L.push('## 章情绪分布（按频次）', '', rank(emCount), '')
  // 人物原型（TOP 8，低频合并）
  const archeCount = {}
  for (const { wiki } of items) {
    for (const c of wiki.characterProfiles ?? []) {
      const a = String(c.archetype ?? '').split(/[/／、]/).map((s) => s.trim()).filter(Boolean)
      for (const part of a) archeCount[part.replace(/（.*$/, '').trim() || part] = (archeCount[part] ?? 0) + 1
    }
  }
  const archeRank = Object.entries(archeCount).sort((a, b) => b[1] - a[1])
  const topArche = archeRank.slice(0, 8)
  const restArche = archeRank.slice(8).reduce((s, [, v]) => s + v, 0)
  L.push('## 人物 archetype（TOP 8' + (restArche ? `，其余配角 ${restArche} 项略）` : '）'), '', rank(topArche.map(([k, v]) => [k, v])) ? rank(Object.fromEntries(topArche)) : '—', '')
  // 每本速览
  L.push('## 每本速览（按效率降序）', '', '| 作品 | 效率 | 母型 | logline |', '|---|---|---|---|')
  for (const { wiki, meta, fact } of items) {
    const picked = String(wiki.slots?.plotDesign?.structure?.picked ?? '—')
      .replace(/（置信度[^）]*）/, '')
      .replace(/^复合（/, '').replace(/）$/, '')
      .replace(/^主：/, '')
    L.push(`| ${fact.book.title} | ${meta.efficiency ?? '—'} | ${clip(picked, 22)} | ${clip(wiki.slots?.gimmick?.logline, 36)} |`)
  }
  L.push('', '## 爽点与共情清单', '')
  for (const { wiki, fact } of items) {
    if (wiki.slots?.gimmick?.coolPoint) L.push(`- **《${fact.book.title}》**：${clip(wiki.slots.gimmick.coolPoint, 100)}`)
  }
  writeFileSync(join(OUT, '套路分册', `套路分册-${group}.md`), L.join('\n'), 'utf-8')
  console.log('M5 分册:', group, items.length, '本')
}
console.log('生成完毕 →', OUT)
