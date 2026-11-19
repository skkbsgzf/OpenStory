/**
 * 剧本 ↔ fact 互转（OS-78）——作者口径：「这个不能出岔子」，所以全程纯函数可单测。
 *
 * 方向 A：剧本 → fact 条目
 *   从剧本块里抽：幕（plot，按幕聚合）、角色（character，带台词锚点）、场景（worldview）。
 *   产出符合 fact.data/v3 的条目骨架（id 用 stableEntryId 同算法、fingerprint 占位）。
 *
 * 方向 B：fact 条目 → 剧本
 *   从 fact 的 plot 条目（events[]）与 character 条目（anchors.speech）反向渲染剧本文本。
 *
 * 硬约束：
 *   1. 双向不丢信息：剧本→fact→剧本，幕/场景/台词数量应一致（允许格式规范化）。
 *   2. 不做 LLM 调用——纯结构映射，确定性。
 *   3. fact 侧字段必须过 schema（id 派生 / fingerprint 对象 / castRole 对象 / knowledge 形状）。
 */

import { parseScript } from './script.mjs'

const text = (value) => String(value ?? '')

/** 与 core/pinax stableEntryId 完全同算法：sha1(layer|domain|slot|name)[:12]。
 * 浏览器与 Node 都有 Web Crypto 的 SHA-1；这里返回 Promise（调用方 await）。
 * 用同步缓存避免重复计算同一条目。 */
const ID_CACHE = new Map()

async function sha1Hex(input) {
  const data = new TextEncoder().encode(input)
  const buf = await crypto.subtle.digest('SHA-1', data)
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

async function stableId(layer, domain, slot, name) {
  const key = [layer, domain, slot, name].map((v) => String(v ?? '')).join('|')
  if (ID_CACHE.has(key)) return ID_CACHE.get(key)
  const id = (await sha1Hex(key)).slice(0, 12)
  ID_CACHE.set(key, id)
  return id
}

/**
 * 剧本 → fact 条目（方向 A）。
 * @param {string} source 剧本全文
 * @param {{ bookId?: string, domain?: string }} opts
 * @returns {{ entries: Array, wiki: object, stats: object }}
 */
export async function scriptToFact(source, { bookId = 'screenplay', domain = '舞台剧' } = {}) {
  const blocks = parseScript(source)
  const acts = blocks.filter((b) => b.kind === 'act')
  const stages = blocks.filter((b) => b.kind === 'stage')
  const lines = blocks.filter((b) => b.kind === 'line')
  const actions = blocks.filter((b) => b.kind === 'action')

  /** 按幕分组：块顺序遍历，遇到 act 就开新幕。 */
  const actGroups = []
  let current = { title: '', blocks: [] }
  for (const b of blocks) {
    if (b.kind === 'act') {
      if (current.blocks.length || current.title) actGroups.push(current)
      current = { title: b.raw.replace(/^#{1,3}\s+/u, '').trim(), blocks: [] }
    } else {
      current.blocks.push(b)
    }
  }
  if (current.blocks.length || current.title) actGroups.push(current)

  const entries = []

  // —— plot 条目：每幕一条 ——
  for (const [index, act] of actGroups.entries()) {
    const evs = act.blocks.filter((b) => b.kind === 'line' || b.kind === 'action').map((b, i) => ({
      who: b.kind === 'line' ? b.who : '',
      channel: b.kind === 'line' ? 'say' : 'do',
      content: b.kind === 'line' ? b.said : b.raw,
      index: i + 1,
      track: 'fact',
      refs: b.kind === 'line' && b.who ? [b.who] : [],
      segments: [{ index: index + 1, chars: text(b.raw).replace(/\s/gu, '').length }]
    }))
    const name = act.title || `第${index + 1}幕`
    entries.push({
      schema: 'fact.data/v3',
      id: await stableId('plot', domain, '', name),
      layer: 'plot',
      domain,
      name,
      status: 'adopted',
      fact: act.title ? `第${index + 1}幕「${act.title}」` : `第${index + 1}幕`,
      events: evs,
      span: { from: index + 1, to: index + 1 },
      fingerprint: { vec: null, metrics: { events: evs.length } },
      provenance: { mode: 'author', chapters: [index + 1], segmentIndex: index + 1, quote_hash: `sp-act-${index + 1}` },
      sources: [{ sourceId: '剧本/source.md', segmentId: `sp-${index + 1}:1:${String(index + 1).padStart(2, '0')}`, quote_hash: `hash-sp-${index + 1}` }]
    })
  }

  // —— character 条目：按台词聚合 ——
  const byWho = new Map()
  for (const line of lines) {
    if (!line.who) continue
    if (!byWho.has(line.who)) byWho.set(line.who, { speech: [], hints: [], count: 0 })
    const rec = byWho.get(line.who)
    rec.count++
    if (line.said) rec.speech.push(line.said)
    if (line.hint) rec.hints.push(line.hint)
  }
  for (const [who, rec] of byWho) {
    entries.push({
      schema: 'fact.data/v3',
      id: await stableId('character', domain, '', who),
      layer: 'character',
      domain,
      name: who,
      status: 'adopted',
      castRole: { tier: rec.count >= 10 ? 'protagonist' : rec.count >= 3 ? 'supporting' : 'minor', goal: '', plotFunction: '' },
      identity: rec.hints.length ? rec.hints[0] : '',
      personality: [],
      anchors: { speech: rec.speech.slice(0, 12), behavior: [], catchphrase: [] },
      fingerprint: { vec: null, metrics: { lines: rec.count } },
      provenance: { mode: 'author', chapters: [1], quote_hash: `sp-cast-${who}` },
      sources: [{ sourceId: '剧本/source.md', segmentId: `sp-cast:1:00`, quote_hash: `hash-cast-${who}` }]
    })
  }

  // —— worldview 条目：场景 ——
  const seenScenes = new Set()
  for (const s of stages) {
    const inner = s.raw.replace(/^\*?[〔【\[]/u, '').replace(/[〕】\]]\*?$/u, '').trim()
    const name = inner.replace(/^场景[:：]\s*/u, '').slice(0, 30)
    if (!name || seenScenes.has(name)) continue
    seenScenes.add(name)
    entries.push({
      schema: 'fact.data/v3',
      id: await stableId('worldview', domain, 'locations', name),
      layer: 'worldview',
      domain,
      slot: 'locations',
      rank: seenScenes.size,
      name,
      status: 'adopted',
      definition: inner,
      fingerprint: { vec: null, metrics: {} },
      provenance: { mode: 'author', chapters: [1], quote_hash: `sp-scene-${name}` },
      sources: [{ sourceId: '剧本/source.md', segmentId: `sp-scene:1:00`, quote_hash: `hash-scene-${name}` }]
    })
  }

  const wiki = {
    derivedFrom: { factRevision: 1, schema: 'pinax-wiki-derived@1' },
    version: 'wiki-enrich@3',
    generated_at: new Date().toISOString(),
    protagonist: null,
    pseudoChapters: false,
    chapterSummaries: actGroups.map((act, index) => ({
      chapter: index + 1,
      title: act.title || `第${index + 1}幕`,
      summary: act.blocks.filter((b) => b.kind === 'line').slice(0, 2).map((b) => `${b.who}：${b.said}`).join('；').slice(0, 120),
      function: index === 0 ? '建立' : index === actGroups.length - 1 ? '收束' : '转折',
      emotion: '中',
      beats: act.blocks.length
    })),
    foreshadows: [],
    characterProfiles: [...byWho.entries()].map(([who, rec]) => ({
      name: who,
      chapters: [1],
      identity: rec.hints[0] || '',
      archetype: '',
      goal: '',
      personality: [],
      summary: `共 ${rec.count} 句台词`
    })),
    causalGraph: { nodes: [], edges: [], threads: [] },
    failures: []
  }

  return {
    entries,
    wiki,
    stats: { acts: acts.length, scenes: stages.length, lines: lines.length, actions: actions.length, cast: byWho.size, entries: entries.length, bookId }
  }
}

/**
 * fact 条目 → 剧本（方向 B）。
 * 从 plot 条目按 span.from 排序，events 按 channel 还原台词/动作；
 * character 条目的 anchors.speech 作为该角色台词池（plot 里没有 who 时用它补）。
 * @returns {{ text: string, stats: object }}
 */
export function factToScript(entries, wiki = null) {
  const list = Array.isArray(entries) ? entries : []
  const plots = list.filter((e) => e?.layer === 'plot').slice().sort((a, b) => {
    const af = Number(a?.span?.from ?? a?.provenance?.segmentIndex ?? 0)
    const bf = Number(b?.span?.from ?? b?.provenance?.segmentIndex ?? 0)
    return af - bf
  })
  const chars = new Map()
  for (const e of list) {
    if (e?.layer === 'character' && e?.name) chars.set(e.name, e)
  }

  const out = []
  let actNo = 0
  for (const plot of plots) {
    actNo++
    const title = text(plot.name) || `第${actNo}幕`
    out.push(`# ${/^第/u.test(title) ? title : `第${actNo}幕：${title}`}`)
    out.push('')
    const events = Array.isArray(plot.events) ? plot.events : []
    for (const ev of events) {
      const who = text(ev?.who)
      const channel = text(ev?.channel)
      const content = text(ev?.content)
      if (!content) continue
      if (channel === 'say' && who) {
        out.push(`**${who}**：${content}`)
      } else if (who && channel === 'do') {
        out.push(`*〔${who}${content.startsWith('说') ? '' : ' '}${content}〕*`)
      } else {
        out.push(content)
      }
      out.push('')
    }
    // plot 里没有 events 但有 fact 字段 → 用 fact 当舞台提示
    if (!events.length && text(plot.fact)) {
      out.push(`*〔${text(plot.fact)}〕*`)
      out.push('')
    }
  }

  // 若 plot 全空但有 character 条目 → 至少把台词池渲染出来（避免彻底空剧本）
  if (!plots.length && chars.size) {
    out.push('# 第一幕')
    out.push('')
    for (const [name, entry] of chars) {
      const speech = entry?.anchors?.speech
      if (Array.isArray(speech)) for (const s of speech.slice(0, 5)) out.push(`**${name}**：${text(s)}`)
      out.push('')
    }
  }

  return {
    text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n',
    stats: { acts: plots.length, cast: chars.size, events: plots.reduce((s, p) => s + (p.events?.length || 0), 0) }
  }
}
