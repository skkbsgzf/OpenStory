/**
 * 语义增补引擎（FACT-FIRST 数据底座的供给端）。
 *
 * 把 Pinax-next devtools/wiki-enrich-run.mjs 的六槽位管线封装成宿主可调用的引擎：
 *   ① 章批五合一（小标题/梗概/章节功能/情绪/剧情点/伏笔/高光片段）
 *   ② 因果图（nodes/edges/threads——A1/B1/C1 的共同底座）
 *   ③ 人物卡＋马斯洛需求层级（identity/archetype/goal/needs/arc/keyChoices/mirror）
 *   ④ 世界要素（场景/道具）
 *   ⑤ 状态台账（知情/状态）
 *   ⑥ 四槽位（gimmick/plot-design/intro）＋文风九维＋全书梗概
 *
 * 与 devtools 版的差异只有两处：
 *   · LLM 走注入的 llmPort（宿主接 runtime kit），不再绑死 dispatchDotsCompletion；
 *   · 事实条目由调用方传入（factFileStore 取），不再自己读拆解 JSON。
 * 落盘走 writeFactFile 写兄弟 `<bookId>.wiki.json`（S2 契约，旁挂优先）。
 *
 * 溯源纪律（TRACE_HEADER）沿用 Pinax 六槽位口径：章号证据 / 三态置信 / 引用≤40字。
 * 长任务：全书 6 窗约 12–35 次调用、2–6 分钟——调用方应做成异步 job，不要同步阻塞 HTTP。
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { factStore, enrich } from '../kernel/pinaxAdapter.mjs' // OS-125：内核唯一进口（S2.4），本仓其余模块不许直引 core/**
import { recordChange } from '../protocol/changelog.mjs'

const TRACE_HEADER = [
  '推理纪律：',
  '1) 所有判断必须给章号依据；不得补写人物经历、不得虚构未读取的情节；',
  '2) 三态区分：原文事实 / 合理推断 / 暂时无法确认——推断与未确认在对应字段注明；',
  '3) 引用原文仅限极短（≤40 字），其余用概括。'
].join('\n')

const STRUCTURE_TYPES = ['复仇', '救猫咪', '逆袭升级', '双线交叉', '倒钩回归', '单元宿命', '复合（须注明主辅）']
const CHAPTER_FUNCTIONS = ['建立', '铺垫', '叠加', '误导', '打击', '觉醒', '对峙', '揭露', '收束']
const EMOTIONS = ['甜', '痛', '爽', '悔', '疑', '燃', '压迫', '释然']
const MASLOW_LEVELS = { 1: '生理', 2: '安全', 3: '归属', 4: '尊重', 5: '自我实现' }
const CAUSAL_KINDS = ['action', 'revelation', 'decision', 'accident']
const CAUSAL_EDGE_TYPES = ['trigger', 'cause', 'enables', 'prevents', 'reveals']
const CAUSAL_EDGE_LIMIT = 40
const EVENT_TEXT_LIMIT = 2400

function text(value) {
  return String(value ?? '')
}

/**
 * 解析子 agent 的 JSON 回包（OS-58）。
 * CLI/DSH 子 agent 不像 chat 接口那样保证纯 JSON——常见三种脏形态：
 *   ① ```json 围栏；② 围栏前有「好的，这是结果：」之类开场；③ 末尾带解释。
 * 全部走「截取第一个 { 到最后一个 }（或 []）」的容错，再不行才判失败。
 */
function parseReply(body) {
  let raw = text(body).replace(/^\uFEFF/u, '').trim()
  raw = raw.replace(/^```(?:json)?\s*/iu, '').replace(/\s*```$/u, '').trim()
  try { return JSON.parse(raw) } catch { /* 继续容错 */ }
  const start = raw.search(/[[{]/u)
  if (start === -1) return null
  const endCurly = raw.lastIndexOf('}')
  const endSquare = raw.lastIndexOf(']')
  const end = Math.max(endCurly, endSquare)
  if (end <= start) return null
  try { return JSON.parse(raw.slice(start, end + 1)) } catch { return null }
}

/** 层名归一：接受 1-5、数字串、中文层名、英文 need 名，统一成 {level, need}。 */
function normalizeNeedLevel(rawLevel, rawNeed) {
  const name = text(rawNeed).trim()
  const byName = Object.entries(MASLOW_LEVELS).find(([, levelName]) => levelName === name)
  if (byName) return { level: Number(byName[0]), need: name }
  const level = Math.round(Number(rawLevel))
  if (Number.isInteger(level) && MASLOW_LEVELS[level]) return { level, need: MASLOW_LEVELS[level] }
  const alias = { physiological: 1, safety: 2, belonging: 3, esteem: 4, 'self-actualization': 5, selfactualization: 5 }
  const hit = alias[name.toLowerCase()]
  return hit ? { level: hit, need: MASLOW_LEVELS[hit] } : null
}

/** needs 解析：evidence 必须带章号——写不出章号的需求宁可丢，不落无法回查的依据。 */
function parseNeeds(raw) {
  if (!Array.isArray(raw)) return []
  return raw.slice(0, 3).map((item) => {
    const norm = normalizeNeedLevel(item?.level, item?.need)
    if (!norm) return null
    const evidence = text(item?.evidence).slice(0, 80)
    return {
      level: norm.level,
      need: norm.need,
      object: text(item?.object).slice(0, 40),
      fear: text(item?.fear).slice(0, 40),
      cost: text(item?.cost).slice(0, 40),
      evidence
    }
  }).filter((item) => item && item.need && /第\s*\d+/u.test(item.evidence))
}

/** 因果图单批归一：kind/type 出枚举退默认，strength 缺省 0.5——为瑕疵丢整条边图就断了。 */
function normalizeCausal(raw) {
  const nodes = (Array.isArray(raw?.nodes) ? raw.nodes : []).map((item) => {
    const chapter = Math.round(Number(item?.chapter))
    const kind = text(item?.kind)
    return {
      chapter: Number.isInteger(chapter) && chapter >= 1 ? chapter : null,
      event: text(item?.event).slice(0, 40),
      kind: CAUSAL_KINDS.includes(kind) ? kind : 'action'
    }
  }).filter((item) => item.chapter !== null && item.event)

  const edges = (Array.isArray(raw?.edges) ? raw.edges : []).map((item) => {
    const fromChapter = Math.round(Number(item?.fromChapter))
    const toChapter = Math.round(Number(item?.toChapter))
    const type = text(item?.type)
    const strength = Number(item?.strength)
    return {
      fromChapter,
      toChapter,
      type: CAUSAL_EDGE_TYPES.includes(type) ? type : 'cause',
      strength: Number.isFinite(strength) ? Math.max(0, Math.min(1, strength)) : 0.5,
      evidence: text(item?.evidence).slice(0, 60)
    }
  })

  const threads = (Array.isArray(raw?.threads) ? raw.threads : []).map((item) => ({
    name: text(item?.name).slice(0, 20),
    chapters: Array.isArray(item?.chapters) ? item.chapters.map(Number).filter(Number.isInteger).sort((a, b) => a - b) : [],
    closed: item?.closed === true
  }))

  return { nodes, edges, threads }
}

/** 因果图合并＋清洗：孤儿端点丢弃、同 (from,to,type) 去重、按 strength 截 40。 */
function finalizeCausal(parts) {
  const nodeByChapter = new Map()
  for (const part of parts) {
    for (const node of part.nodes) {
      const existing = nodeByChapter.get(node.chapter)
      const isFocus = part.focus ? part.focus.has(node.chapter) : false
      if (!existing) nodeByChapter.set(node.chapter, { node, isFocus })
      else if (isFocus && !existing.isFocus) nodeByChapter.set(node.chapter, { node, isFocus })
    }
  }
  const nodes = [...nodeByChapter.values()].map((entry) => entry.node).sort((a, b) => a.chapter - b.chapter)

  const chapterSet = new Set(nodes.map((node) => node.chapter))
  const edgeSeen = new Set()
  const edges = []
  let dropped = 0
  for (const part of parts) {
    for (const edge of part.edges) {
      const valid = Number.isInteger(edge.fromChapter) && Number.isInteger(edge.toChapter)
        && edge.fromChapter >= 1 && edge.toChapter >= 1
        && edge.fromChapter !== edge.toChapter
        && chapterSet.has(edge.fromChapter) && chapterSet.has(edge.toChapter)
        && Boolean(edge.evidence)
      if (!valid) { dropped += 1; continue }
      const key = `${edge.fromChapter}->${edge.toChapter}:${edge.type}`
      if (edgeSeen.has(key)) continue
      edgeSeen.add(key)
      edges.push(edge)
    }
  }
  edges.sort((a, b) => b.strength - a.strength)
  const keptEdges = edges.slice(0, CAUSAL_EDGE_LIMIT)

  const threads = []
  for (const part of parts) {
    for (const thread of part.threads) {
      if (!thread.name || thread.chapters.length < 2) continue
      const existing = threads.find((item) => item.name === thread.name)
      if (existing) {
        existing.chapters = [...new Set([...existing.chapters, ...thread.chapters])].sort((a, b) => a - b)
        existing.closed = existing.closed || thread.closed
        continue
      }
      threads.push(thread)
    }
  }

  // 下游按 node.id / thread.nodes 取数（章号即 id，一章一节点天然唯一）。
  const idOf = (chapter) => `ch-${chapter}`
  const landedNodes = nodes.map((node) => ({ ...node, id: idOf(node.chapter) }))
  const landedThreads = threads.slice(0, 5).map((thread) => ({
    ...thread,
    nodes: thread.chapters.map(idOf)
  }))

  return { graph: { nodes: landedNodes, edges: keptEdges, threads: landedThreads }, dropped }
}

/**
 * 单本语义增补（六槽位全量）。
 *
 * @param {object} input
 * @param {string} input.root 库根
 * @param {string} input.bookId 书 ID（拆解文件名主干）
 * @param {object[]} input.entries 事实条目（factFileStore.list 取）
 * @param {object} input.book 书元数据（{id,title,author,word_count,subject_group?…}）
 * @param {({prompt:string, maxTokens?:number}) => Promise<{text:string}>} input.llmPort 模型通道
 * @param {string|null} [input.protagonist] 主角名（识别产物透传）
 * @param {((note:object) => void)} [input.onProgress] 进度回调（每窗一条）
 * @returns {Promise<{ok:boolean, wiki:object|null, summary:object, failures:object[], notes:string[]}>}
 */
export async function enrichBook({ root, bookId, entries, book, llmPort, protagonist = null, onProgress } = {}) {
  if (typeof llmPort !== 'function') {
    return { ok: false, wiki: null, summary: {}, failures: [{ stage: 'llmPort', reason: 'llmPort 未注入' }], notes: ['llmPort 必须注入：enrich 的全部产出都是模型窄窗归纳'] }
  }
  const allEntries = Array.isArray(entries) ? entries : []
  const plots = allEntries.filter((entry) => entry.layer === 'plot')
  if (!plots.length) {
    return { ok: false, wiki: null, summary: {}, failures: [{ stage: 'entries', reason: 'no-plot-entries' }], notes: ['事实链里没有 plot 条目——先跑抽取'] }
  }
  const failures = []
  const progress = (stage, detail) => { if (typeof onProgress === 'function') onProgress({ stage, detail: text(detail).slice(0, 80) }) }

  async function callJson(prompt, maxTokens = 2000) {
    const answer = await llmPort({ prompt, maxTokens })
    const parsed = parseReply(answer?.text)
    if (!parsed) throw new Error('parse-failed')
    return parsed
  }

  const book_id = text(book?.id) || text(bookId)
  const totalChars = Number(book?.word_count) || plots.reduce((sum, plot) => sum + (plot.events ?? []).reduce((inner, event) => inner + text(event.content).length, 0), 0)

  // 章分组：真章按 validity.from；无标记书按段号伪章（与 build-wiki 同公式，章号对齐）
  const usePseudo = !enrich.hasRealChapters(plots)
  const chapterGroups = usePseudo
    ? enrich.derivePseudoChapters(plots, totalChars)
    : [...new Set(plots.map((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : 0)))]
        .sort((a, b) => a - b)
        .map((chapter) => ({ no: chapter, plots: plots.filter((plot) => (Number.isInteger(plot.validity?.from) ? plot.validity.from : 0) === chapter) }))

  const chapterInputs = chapterGroups.map((group) => ({
    chapter: group.no,
    text: group.plots.flatMap((plot) => (plot.events ?? []).map((event) => event.content)).join('\n').slice(0, EVENT_TEXT_LIMIT)
  }))

  // 人物输入：出场段数 top12（言行取事件原文）
  const byName = new Map()
  for (const plot of plots) {
    const chapter = Number.isInteger(plot.validity?.from) ? plot.validity.from : 0
    for (const event of plot.events ?? []) {
      const who = event.who
      if (!who) continue
      if (!byName.has(who)) byName.set(who, { name: who, speech: [], behavior: [], chapters: new Set() })
      const record = byName.get(who)
      record.chapters.add(chapter)
      if (event.channel === 'say' && record.speech.length < 14) record.speech.push(event.content)
      if (event.channel === 'do' && record.behavior.length < 14) record.behavior.push(event.content)
    }
  }
  const personInputs = [...byName.values()]
    .map((record) => ({ ...record, chapters: [...record.chapters].sort((a, b) => a - b) }))
    .sort((a, b) => (b.speech.length + b.behavior.length) - (a.speech.length + a.behavior.length))
    .slice(0, 12)

  progress('chapter-batch', `${chapterInputs.length} ${usePseudo ? '节' : '章'} / ${personInputs.length} 人物`)

  /* ---------- 章批五合一（小标题/梗概/功能/情绪/剧情点/伏笔/高光） ---------- */
  const chapterSummaries = []
  const foreshadows = []
  const excerpts = []
  for (let start = 0; start < chapterInputs.length; start += 3) {
    const batch = chapterInputs.slice(start, start + 3)
    const prompt = [
      '你是小说章节拆解器（细化层）。输入是若干章的事件文本（按章分组、按原文顺序）。',
      '对每一章输出：',
      '1) title：2–6 字小标题；',
      '2) summary：2–3 句剧情梗概（60–120 字，只概括原文发生的事）；',
      `3) function：本章主功能，从 [${CHAPTER_FUNCTIONS.join('/')}] 里选一个；`,
      `4) emotion：本章核心情绪，从 [${EMOTIONS.join('/')}] 里选一个；`,
      '5) beats：本章承载的剧情点数（1–5 的整数，推进了多少个独立剧情点）；',
      '6) foreshadows：埋下的伏笔/悬念 0–3 条；',
      '7) excerpt：本章最高光片段 { "beat": "场景概括 ≤40 字", "quote": "原文摘引 ≤40 字" }（没有高光就给 null）。',
      '',
      TRACE_HEADER,
      '',
      `只输出 JSON：{"chapters":[{"chapter":章号,"title":"","summary":"","function":"","emotion":"","beats":1,"foreshadows":[],"excerpt":null}]}`,
      '',
      ...batch.map((item) => `【第 ${item.chapter} ${usePseudo ? '节' : '章'}事件】\n${item.text}`)
    ].join('\n\n')
    let parsed = null
    for (let attempt = 0; attempt < 2 && !parsed; attempt += 1) {
      try {
        parsed = await callJson(prompt, 5200)
        if (!parsed && attempt === 0) await new Promise((resolve) => setTimeout(resolve, 3000))
      } catch (error) {
        if (attempt === 1) failures.push({ stage: 'chapter-batch', chapter: batch.map((b) => b.chapter).join(','), reason: text(error?.message ?? error) })
      }
    }
    // 整批失败或个别章空 summary → 单章补（token 1/N，实测成功率显著更高）
    const emptyChapters = parsed ? batch.filter((item) => {
      const row = parsed.chapters?.find((c) => Number(c.chapter) === item.chapter)
      return !row || !text(row.summary).trim()
    }) : []
    if (!parsed || emptyChapters.length) {
      for (const item of (parsed ? emptyChapters : batch)) {
        try {
          const singlePrompt = [
            '你是小说章节拆解器（细化层）。输入是一章的事件文本。',
            '对这一章输出：1) title 2–6 字；2) summary 60–120 字；',
            `3) function 从 [${CHAPTER_FUNCTIONS.join('/')}] 选一；4) emotion 从 [${EMOTIONS.join('/')}] 选一；`,
            '5) beats 1–5；6) foreshadows 0–3 条；7) excerpt {beat,quote} 或 null。',
            '',
            TRACE_HEADER,
            '',
            `只输出 JSON：{"chapters":[{"chapter":${item.chapter},"title":"","summary":"","function":"","emotion":"","beats":1,"foreshadows":[],"excerpt":null}]}`,
            '',
            `【第 ${item.chapter} ${usePseudo ? '节' : '章'}事件】\n${item.text}`
          ].join('\n')
          const single = await callJson(singlePrompt, 2200)
          if (single?.chapters?.length) {
            const list = [...(parsed?.chapters ?? [])]
            for (const row of single.chapters) {
              const index = list.findIndex((existing) => Number(existing.chapter) === Number(row.chapter))
              if (index >= 0) list[index] = row
              else list.push(row)
            }
            parsed = { chapters: list }
          }
        } catch { /* 单章也失败就记账 */ }
      }
      if (!parsed) failures.push({ stage: 'chapter-batch', chapter: batch.map((b) => b.chapter).join(','), reason: 'parse-failed-single-retry' })
    }
    for (const item of batch) {
      const row = parsed?.chapters?.find((c) => Number(c.chapter) === item.chapter)
      const hooks = Array.isArray(row?.foreshadows) ? row.foreshadows.slice(0, 3).map(String).filter(Boolean) : []
      chapterSummaries.push({
        chapter: item.chapter,
        title: text(row?.title),
        summary: text(row?.summary),
        function: CHAPTER_FUNCTIONS.includes(row?.function) ? row.function : '',
        emotion: EMOTIONS.includes(row?.emotion) ? row.emotion : '',
        beats: Number.isInteger(row?.beats) ? Math.max(1, Math.min(5, row.beats)) : null
      })
      for (const hook of hooks) foreshadows.push({ chapter: item.chapter, text: hook })
      if (row?.excerpt && typeof row.excerpt === 'object' && row.excerpt.beat) {
        excerpts.push({ chapter: item.chapter, beat: text(row.excerpt.beat).slice(0, 60), quote: text(row.excerpt.quote).slice(0, 60) })
      }
    }
  }
  progress('chapter-batch', '章批完成')

  /* ---------- 槽位 gimmick ---------- */
  let gimmick = null
  {
    const titleList = chapterSummaries.map((c) => `第${c.chapter}${usePseudo ? '节' : '章'}「${c.title}」`).join('、')
    const prompt = [
      '你是拆书器（槽位 gimmick·梗）。输入是书名、题材标签与全书章纲。',
      '输出 JSON：{',
      ' "logline": "一句话卖点（≤40 字，谁+什么处境+遇到什么+结果钩子）",',
      ' "elements": ["题材元素组合", "…"],',
      ' "empathy": "共情点：击中目标读者的什么处境与渴望",',
      ' "coolPoint": "爽点内核：以什么对什么形成什么压制与释放",',
      ` "emotionPromise": "核心情绪承诺，从 [${EMOTIONS.join('/')}] 里选主情绪并一句话说明",`,
      ' "confidence": "fact|inferred|unconfirmed"',
      '}',
      '',
      TRACE_HEADER,
      '',
      `【书名】${book?.title ?? book_id}`,
      `【题材】${text(book?.subject_group) || '未标注'}`,
      `【章纲】${titleList}`
    ].join('\n')
    try {
      progress('gimmick')
      const parsed = await callJson(prompt, 1200)
      if (parsed?.logline) gimmick = parsed
      else failures.push({ stage: 'gimmick', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'gimmick', reason: text(error?.message ?? error) }) }
  }

  /* ---------- 槽位 plot-design ---------- */
  let plotDesign = null
  {
    const outline = chapterSummaries.map((c) => `第${c.chapter}${usePseudo ? '节' : '章'}「${c.title}」：${c.summary}`).join('\n')
    const prompt = [
      '你是拆书器（槽位 plot-design·剧情设计/宏观骨架）。输入是全书章纲。',
      `结构母型枚举：[${STRUCTURE_TYPES.join('/')}]。`,
      '输出 JSON：{',
      ' "structure": { "picked": "母型名", "evidence": "判定依据（引章号）", "confidence": "fact|inferred|unconfirmed" },',
      ' "mainline": "主线一句话",',
      ' "subplot": "支线一句话（没有就空串）",',
      ' "stages": [ { "phase": "阶段名", "chapters": [起,止], "job": "该阶段在结构里干什么" } ],',
      ' "turningPoints": [ { "chapter": 章, "event": "转折事件 ≤30 字" } ]',
      '}',
      '',
      TRACE_HEADER,
      '',
      outline
    ].join('\n')
    try {
      progress('plot-design')
      const parsed = await callJson(prompt, 2000)
      if (parsed?.structure?.picked) plotDesign = parsed
      else failures.push({ stage: 'plot-design', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'plot-design', reason: text(error?.message ?? error) }) }
  }

  /* ---------- 槽位 intro ---------- */
  let intro = null
  {
    const head = chapterInputs.slice(0, 2).map((item) => `【第 ${item.chapter} ${usePseudo ? '节' : '章'}】\n${item.text}`).join('\n\n')
    const prompt = [
      '你是拆书器（槽位 intro·导语设计）。输入是全书开头（前两章）事件文本。',
      '输出 JSON：{',
      ' "entry": "切入方式一句话（从什么状态/场景切入）",',
      ' "hookType": "钩子类型（悬念/反常/身份落差/危机开局/金手指亮出/其他，可组合）",',
      ' "firstBeat": "开局第一拍是什么（≤30 字）",',
      ' "expectation": "建立的核心期待",',
      ' "confidence": "fact|inferred|unconfirmed"',
      '}',
      '',
      TRACE_HEADER,
      '',
      head || '（无文本）'
    ].join('\n')
    try {
      progress('intro')
      const parsed = await callJson(prompt, 1200)
      if (parsed?.entry) intro = parsed
      else failures.push({ stage: 'intro', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'intro', reason: text(error?.message ?? error) }) }
  }

  /* ---------- 文风画像（文学层·九维） ---------- */
  let style = null
  {
    const sample = chapterInputs
      .map((item) => item.text.slice(0, Math.ceil(EVENT_TEXT_LIMIT / Math.max(1, Math.min(6, chapterInputs.length)))))
      .join('\n')
      .slice(0, 2600)
    const prompt = [
      '你是文风拆解器（文学层·九维观察）。输入是全书事件文本抽样。',
      '标尺：写什么不重要，怎么写才重要；产物必须是可直接执行的写手规则，不是评论。',
      '输出 JSON：{',
      ' "density": "情绪笔墨密度规律（何处放慢细写、何处果断带过，引章号例证）",',
      ' "sentence": "句式与段落节奏（句长配比/独句成段/段尾翻转补刀）",',
      ' "pov": "叙述视角与信息控制（读者跟随谁的认知；何时给何时藏）",',
      ' "dialogue": "对话写法（标签/密度/留白/短-短-长；权力关系如何经话语暴露）",',
      ' "action": "动作写法（动作代心理的具体规律）",',
      ' "character": "人物写法（标签特征/情绪按钮/靠选择与沉默站住）",',
      ' "environment": "环境写法（是否作为情绪容器）",',
      ' "transition": "转场与时间处理",',
      ' "ending": "章节收束方式（钩子类型）",',
      ' "rules": ["可直接执行的写手规则 3–6 条"]',
      '}',
      '',
      TRACE_HEADER,
      '',
      sample || '（无文本）'
    ].join('\n')
    try {
      progress('style')
      const parsed = await callJson(prompt, 2200)
      if (parsed?.rules?.length) style = parsed
      else failures.push({ stage: 'style', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'style', reason: text(error?.message ?? error) }) }
  }

  /* ---------- 人物卡＋马斯洛需求（needs 复用本窗输入，0 增调用） ---------- */
  const characterProfiles = []
  for (const person of personInputs) {
    const prompt = [
      '你是人物拆解器（槽位 character·人物卡）。输入是某角色全书的台词与行为/经历（取自原文）。',
      '输出 JSON：{',
      ' "identity": "一句话身份定位",',
      ' "archetype": "人设模式（如 替罪羊/觉醒者/镜像施害者/守护者，贴人物本身）",',
      ' "goal": "人物动机/目标（推动力：想要什么、为什么；≤40 字；推不出给空串）",',
      ' "personality": ["性格词 2–4 个"],',
      ' "arc": { "start": "起点状态", "end": "终点状态", "turnChapter": 转变章号或 null, "evidence": "转变依据（引章号）" },',
      ' "keyChoices": [ { "chapter": 章, "choice": "关键选择 ≤25 字" } ],',
      ' "needs": [ { "level": 1-5, "need": "生理|安全|归属|尊重|自我实现", "object": "这个需求具体指向谁/什么 ≤20 字", "fear": "满足不了会怎样 ≤20 字", "cost": "为满足它愿意付出什么代价 ≤20 字", "evidence": "第N节/章的行为依据" } ],',
      ' "mirror": "镜像/对立人物是谁、如何互为镜像（没有就空串）",',
      ' "summary": "2–3 句人物小传"',
      '}',
      '',
      'needs 说明（马斯洛需求层级，1 生理 / 2 安全 / 3 归属 / 4 尊重 / 5 自我实现）：',
      '· 一个角色 1–3 条，按对行为的驱动力从强到弱排序；只写有行为证据的，推不出就给空数组；',
      '· 层级按「这个需求真正在驱动什么」判，不按表面处境：为被爱而自毁仍是归属不是安全；',
      `· evidence 必须带${usePseudo ? '节' : '章'}号，写清是哪个行为/台词暴露了这条需求。`,
      '',
      TRACE_HEADER,
      '',
      `【角色名】${person.name}`,
      `【台词】\n${person.speech.map((line) => `「${line}」`).join('\n') || '（无台词）'}`,
      `【行为/经历】\n${person.behavior.map((line) => `- ${line}`).join('\n') || '（无）'}`,
      `【出场】第 ${person.chapters.join('、')} 章`
    ].join('\n')
    try {
      progress('character', person.name)
      const parsed = await callJson(prompt, 1800)
      const needs = parseNeeds(parsed?.needs)
      if (Array.isArray(parsed?.needs) && parsed.needs.length && !needs.length) {
        failures.push({ stage: 'needs', name: person.name, reason: 'all-dropped-no-chapter-evidence' })
      }
      characterProfiles.push({
        name: person.name,
        chapters: person.chapters,
        identity: text(parsed?.identity),
        archetype: text(parsed?.archetype),
        goal: text(parsed?.goal),
        needs,
        personality: Array.isArray(parsed?.personality) ? parsed.personality.slice(0, 4).map(String) : [],
        arc: parsed?.arc && typeof parsed.arc === 'object' ? {
          start: text(parsed.arc.start),
          end: text(parsed.arc.end),
          turnChapter: Number.isInteger(parsed.arc.turnChapter) ? parsed.arc.turnChapter : null,
          evidence: text(parsed.arc.evidence)
        } : null,
        keyChoices: Array.isArray(parsed?.keyChoices) ? parsed.keyChoices.slice(0, 5).map((item) => ({
          chapter: Number(item?.chapter) || null,
          choice: text(item?.choice).slice(0, 40)
        })).filter((item) => item.choice) : [],
        mirror: text(parsed?.mirror),
        summary: text(parsed?.summary)
      })
    } catch (error) {
      failures.push({ stage: 'character', name: person.name, reason: text(error?.message ?? error) })
      characterProfiles.push({ name: person.name, identity: '', archetype: '', goal: '', needs: [], personality: [], arc: null, keyChoices: [], mirror: '', summary: '' })
    }
  }

  /* ---------- 因果图（A1/B1/C1 共同底座） ---------- */
  let causalGraph = null
  {
    const usable = chapterSummaries.filter((item) => item.summary)
    if (!usable.length) {
      failures.push({ stage: 'causalGraph', reason: 'no-chapter-summary' })
    } else {
      const hookLines = foreshadows.slice(0, 20).map((hook) => `第${hook.chapter}${usePseudo ? '节' : '章'}：${hook.text}`)
      const arcLines = characterProfiles
        .filter((profile) => profile.arc?.start || profile.arc?.end)
        .map((profile) => `${profile.name}：${profile.arc.start || '？'} → ${profile.arc.end || '？'}${profile.arc.turnChapter ? `（第${profile.arc.turnChapter}${usePseudo ? '节' : '章'}转向）` : ''}`)
      const outlineOf = (list) => list.map((item) => (
        `第${item.chapter}${usePseudo ? '节' : '章'}「${item.title || '无题'}」[${item.function || '未定'}/${item.emotion || '未定'}/剧情点${item.beats ?? '?'}]：${item.summary}`
      )).join('\n')

      const buildPrompt = (focus, full) => [
        '你是因果图构建器。输入是一本小说的章纲、伏笔清单与人物弧光。',
        '要建的是「因果图」，不是时间线：',
        '· 只有「A 导致 / 阻止 / 使能 / 揭示 B」才连边；「A 之后发生 B」不算因果，不要连。',
        '· 拿不准就问自己：没有 A，B 还会发生吗？会 → 不是因果；不会或明显不同 → 是因果。',
        '· strength 0–1，表示「无此因则果不成立」的程度：1=没它就没有 B，0.3=只是加速或加重了 B。',
        '· 整本 30–40 条边（本批至少 8 条，章本身少于 6 章可更少）；只收推动主线或人物转向的，不复述琐事。',
        '',
        '输出 JSON：{',
        ' "nodes": [ { "chapter": 章号, "event": "该章的关键事件 ≤15 字", "kind": "action|revelation|decision|accident" } ],',
        ' "edges": [ { "fromChapter": 章号, "toChapter": 章号, "type": "trigger|cause|enables|prevents|reveals", "strength": 0.8, "evidence": "为什么是因果，≤30 字" } ],',
        ' "threads": [ { "name": "情节线名", "chapters": [贯穿章号], "closed": true } ]',
        '}',
        '规则：nodes 每个关键章一条；threads 2–5 条，是贯穿全书的情节线，不是单章事件。',
        '本批重点章：' + focus.map((item) => `第${item.chapter}${usePseudo ? '节' : '章'}`).join('、'),
        '',
        TRACE_HEADER,
        '',
        `【全书章纲（可用于分析跨章因果）】\n${outlineOf(full)}`,
        `【伏笔清单】\n${hookLines.join('\n') || '（无）'}`,
        `【人物弧光】\n${arcLines.join('\n') || '（无）'}`
      ].join('\n')

      // 章多劈两批：每批仍给全书章纲（跨章因果不能瞎），只收窄「重点章」；两批的边合并成一张图。
      const batches = usable.length > 16
        ? [usable.slice(0, Math.ceil(usable.length / 2)), usable.slice(Math.ceil(usable.length / 2))]
        : [usable]
      const parts = []
      for (const focus of batches) {
        const prompt = buildPrompt(focus, usable)
        const focusTag = focus.map((item) => item.chapter).join(',')
        let parsed = null
        let lastError = ''
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            parsed = await callJson(prompt, 3200)
            lastError = parsed ? '' : 'parse-failed'
            if (parsed?.nodes?.length || parsed?.edges?.length) break
            parsed = null
            lastError = lastError || 'empty'
            if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 3000))
          } catch (error) { lastError = text(error?.message ?? error) }
        }
        if (!parsed) {
          failures.push({ stage: 'causalGraph', chapters: focusTag, reason: `${lastError || 'empty'}-single-retry` })
          continue
        }
        parts.push({ ...normalizeCausal(parsed), focus: new Set(focus.map((item) => item.chapter)) })
      }

      if (parts.length) {
        const finalized = finalizeCausal(parts)
        if (finalized.dropped) failures.push({ stage: 'causalGraph', reason: `dropped-invalid-edges:${finalized.dropped}` })
        if (!finalized.graph.nodes.length) failures.push({ stage: 'causalGraph', reason: 'empty-nodes' })
        else {
          if (finalized.graph.nodes.length >= 6 && finalized.graph.threads.length < 2) {
            failures.push({ stage: 'causalGraph', reason: `threads-below-2:${finalized.graph.threads.length}` })
          }
          if (finalized.graph.nodes.length >= 6 && !finalized.graph.edges.length) {
            failures.push({ stage: 'causalGraph', reason: 'no-edges' })
          }
          causalGraph = finalized.graph
        }
      }
    }
  }

  /* ---------- 世界要素（场景/道具——知识图谱一等公民） ---------- */
  let worldElements = null
  {
    const outline = chapterSummaries
      .filter((item) => item.summary)
      .map((item) => `第${item.chapter}${usePseudo ? '节' : '章'}「${item.title}」：${item.summary}`)
      .join('\n')
    const prompt = [
      '你是世界要素登记员。输入是全书章纲。',
      '输出 JSON：{',
      ' "scenes": [ { "name": "场景名（具体地点）", "chapters": [出现章号], "desc": "一句话（这里发生了什么）" } ],',
      ' "items": [ { "name": "道具/关键物名", "chapters": [出现章号], "holder": "目前掌握者", "desc": "一句话（它推动了什么）" } ]',
      '}',
      '规则：scenes 3–10 个、items 3–10 个，按剧情重要性排序；只登记章纲里实际出现过的，不编造。',
      '',
      TRACE_HEADER,
      '',
      outline || '（无章纲）'
    ].join('\n')
    try {
      progress('worldElements')
      const parsed = await callJson(prompt, 1800)
      if (parsed?.scenes?.length || parsed?.items?.length) {
        worldElements = {
          scenes: (parsed.scenes ?? []).slice(0, 10).map((item) => ({
            name: text(item?.name).slice(0, 20),
            chapters: Array.isArray(item?.chapters) ? item.chapters.filter(Number.isInteger) : [],
            // OS-96：首次出现章节＝chapters 最小值（没有章节信息＝0 原生共识）
            firstChapter: (Array.isArray(item?.chapters) ? item.chapters.filter(Number.isInteger) : []).length ? Math.min(...item.chapters.filter(Number.isInteger)) : 0,
            desc: text(item?.desc).slice(0, 60)
          })).filter((item) => item.name),
          items: (parsed.items ?? []).slice(0, 10).map((item) => ({
            name: text(item?.name).slice(0, 20),
            chapters: Array.isArray(item?.chapters) ? item.chapters.filter(Number.isInteger) : [],
            firstChapter: (Array.isArray(item?.chapters) ? item.chapters.filter(Number.isInteger) : []).length ? Math.min(...item.chapters.filter(Number.isInteger)) : 0,
            holder: text(item?.holder).slice(0, 16),
            desc: text(item?.desc).slice(0, 60)
          })).filter((item) => item.name)
        }
      } else failures.push({ stage: 'worldElements', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'worldElements', reason: text(error?.message ?? error) }) }
  }

  /* ---------- 状态台账（continuity 终局快照） ---------- */
  let ledger = null
  {
    const outline = chapterSummaries
      .filter((item) => item.summary)
      .map((item) => `第${item.chapter}${usePseudo ? '节' : '章'}「${item.title}」：${item.summary}`)
      .join('\n')
    const cast = personInputs.map((person) => person.name).join('、')
    const prompt = [
      '你是状态台账登记员。输入是全书章纲与主要人物表。',
      '输出 JSON：{',
      ' "knowledgeLedger": [ { "character": "谁", "knows": "知道的关键信息", "chapter": 章号 } ],',
      ' "stateLedger": [ { "object": "关键物/身世/关系状态", "state": "终局状态", "chapter": 最后确认章号 } ]',
      '}',
      '只登记对后续剧情有意义的条目；knowledge 3–8 条、state 3–8 条。',
      '',
      TRACE_HEADER,
      '',
      `【主要人物】${cast}`,
      outline || '（无章纲）'
    ].join('\n')
    try {
      progress('ledger')
      const parsed = await callJson(prompt, 1800)
      if (parsed?.knowledgeLedger?.length || parsed?.stateLedger?.length) {
        ledger = {
          knowledgeLedger: (parsed.knowledgeLedger ?? []).slice(0, 8).map((item) => ({
            character: text(item?.character),
            knows: text(item?.knows).slice(0, 60),
            chapter: item?.chapter ?? null
          })),
          stateLedger: (parsed.stateLedger ?? []).slice(0, 8).map((item) => ({
            object: text(item?.object).slice(0, 30),
            state: text(item?.state).slice(0, 60),
            chapter: item?.chapter ?? null
          }))
        }
      } else failures.push({ stage: 'ledger', reason: 'empty' })
    } catch (error) { failures.push({ stage: 'ledger', reason: text(error?.message ?? error) }) }
  }

  /* ---------- 全书梗概 ---------- */
  let storySummary = ''
  let arc = []
  const storyInput = chapterSummaries
    .filter((item) => item.summary)
    .map((item) => `第${item.chapter}${usePseudo ? '节' : '章'}${item.title ? `「${item.title}」` : ''}：${item.summary}`)
    .join('\n')
  if (storyInput) {
    const prompt = [
      '你是小说梗概器。输入是全书各章的剧情梗概（按章序）。',
      '输出 JSON：{"storySummary":"全书梗概 3–6 句","arc":[{"phase":"阶段名","chapters":[起,止],"text":"该阶段剧情"}]}',
      '只依据输入，不引入外部信息。',
      '',
      storyInput
    ].join('\n')
    try {
      progress('storySummary')
      const parsed = await callJson(prompt, 1500)
      storySummary = text(parsed?.storySummary)
      arc = Array.isArray(parsed?.arc) ? parsed.arc.slice(0, 6).map((item) => ({
        phase: text(item?.phase),
        chapters: Array.isArray(item?.chapters) ? item.chapters : [],
        text: text(item?.text)
      })) : []
    } catch { /* 不阻塞 */ }
  }

  const wiki = {
    version: 'wiki-enrich@3',
    generated_at: new Date().toISOString(),
    protagonist: protagonist ?? null,
    pseudoChapters: usePseudo,
    enums: { structures: STRUCTURE_TYPES, chapterFunctions: CHAPTER_FUNCTIONS, emotions: EMOTIONS },
    slots: { gimmick, plotDesign, intro, style },
    worldElements,
    ledger,
    storySummary,
    arc,
    chapterSummaries,
    foreshadows,
    excerpts,
    characterProfiles,
    causalGraph,
    failures
  }

  // 落盘走 writeFactFile（S2 契约）：patch 只带 wiki，主 JSON 的 entries/book 一字不动，
  // 实际落在兄弟 `<bookId>.wiki.json`。revision 冲突时不覆盖不合并。
  progress('write')
  // OS-107：写前留原文（写后读不到旧内容）——变更日志的 diff/before 靠它。
  // 只写兄弟 wiki 档：记日志的 file 必须是 `<bookId>.wiki.json`，不能记主档
  // （主档 revision 与派生档 derivedFrom.factRevision 不是同一个版本语义）。
  const wikiRel = `拆解/${bookId}.wiki.json`
  let beforeWikiRaw = ''
  try { beforeWikiRaw = readFileSync(join(root, '拆解', `${bookId}.wiki.json`), 'utf-8') } catch { beforeWikiRaw = '' }
  const written = await factStore.writeFactFile({
    root,
    bookId,
    patch: { wiki },
    operationId: `wiki-enrich-${bookId}-${Date.now().toString(36)}`,
    expectedRevision: Number.isSafeInteger(arguments[0]?.expectedRevision) ? arguments[0].expectedRevision : undefined
  }).catch((error) => ({ ok: false, error: { code: 'WRITE_FAILED', message: text(error?.message ?? error) } }))
  if (!written.ok) {
    failures.push({ stage: 'write', reason: `${written.error?.code}：${written.error?.message}` })
  } else {
    // 写成功即记（日志失败不阻断 enrich，但进 failures 如实报——不假装记上了）。
    try {
      const afterWikiRaw = readFileSync(join(root, '拆解', `${bookId}.wiki.json`), 'utf-8')
      const logged = await recordChange({
        root,
        module: '拆解',
        file: wikiRel,
        op: beforeWikiRaw ? 'update' : 'create',
        before: beforeWikiRaw,
        after: afterWikiRaw,
        actor: 'agent',
        meta: {
          bookId,
          kind: 'wiki-enrich',
          // 主档 revision（派生档自己的基准在兄弟文件的 derivedFrom.factRevision 里，别混用）
          ...(Number(written.revision) ? { mainRevision: Number(written.revision) } : {}),
          ...(text(written.operationId) ? { operationId: text(written.operationId) } : {})
        }
      })
      if (logged.ok === false) failures.push({ stage: 'log', reason: `changelog：${text(logged.message)}` })
    } catch (error) {
      failures.push({ stage: 'log', reason: `读回派生档失败：${text(error?.message ?? error)}` })
    }
  }

  const slotsLanded = [gimmick, plotDesign, intro, style].filter(Boolean).length
  const stats = {
    bookId,
    title: book?.title ?? bookId,
    chapters: chapterInputs.length,
    pseudo: usePseudo,
    summaries: chapterSummaries.filter((item) => item.summary).length,
    functions: chapterSummaries.filter((item) => item.function).length,
    emotions: chapterSummaries.filter((item) => item.emotion).length,
    excerpts: excerpts.length,
    profiles: characterProfiles.filter((item) => item.identity || item.summary).length,
    arcs: characterProfiles.filter((item) => item.arc?.end).length,
    needs: characterProfiles.reduce((sum, item) => sum + (item.needs?.length ?? 0), 0),
    causalNodes: causalGraph?.nodes.length ?? 0,
    causalEdges: causalGraph?.edges.length ?? 0,
    threads: causalGraph?.threads.length ?? 0,
    slots: `${slotsLanded}/4`,
    ledger: ledger ? `${ledger.knowledgeLedger.length}知/${ledger.stateLedger.length}态` : '—',
    world: worldElements ? `${worldElements.scenes.length}景/${worldElements.items.length}物` : '—',
    failures: failures.length,
    storySummary: Boolean(storySummary),
    writtenToSidecar: written.ok
  }
  return { ok: failures.every((item) => item.stage !== 'write') && chapterSummaries.some((item) => item.summary), wiki, summary: stats, failures, notes: [] }
}

/** 读已产出的因果图并算指标（enrichGraph 端点的数据源）。 */
export async function enrichGraph({ root, bookId } = {}) {
  try {
    const store = factStore.createFactFileStore({ root })
    const listed = await store.list({})
    const entries = listed.entries ?? []
    // wiki 旁挂/内嵌双代兼容走 readFactWiki（同 daemon entries 通道口径）
    const datasetPath = join(root, '拆解', `${bookId}.json`)
    let document = null
    try { document = JSON.parse(readFileSync(datasetPath, 'utf8')) } catch { document = null }
    if (!document) return { ok: false, code: 'NOT_FOUND', message: `拆解文件不存在：${bookId}` }
    const { wiki } = factStore.readFactWiki({ root, id: bookId, document })
    const causalGraph = wiki?.causalGraph ?? null
    const metrics = causalGraph ? enrich.causalSummary(causalGraph) : null
    const needs = (wiki?.characterProfiles ?? []).map((profile) => ({
      name: profile.name,
      needs: profile.needs ?? [],
      arc: profile.arc ?? null
    }))
    return { ok: true, bookId, causalGraph, metrics, needs, slots: wiki?.slots ?? null, ledger: wiki?.ledger ?? null, failures: wiki?.failures ?? [] }
  } catch (error) {
    return { ok: false, code: 'ENRICH_GRAPH_FAILED', message: text(error?.message ?? error) }
  }
}
