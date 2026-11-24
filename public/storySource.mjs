/**
 * 故事源（S2）——Fact 链的三形态纯函数层：大纲树 / 多维表格 / 图表数据。
 *
 * 浏览器与 Node 双用，不碰 DOM、零依赖（风格对齐 storyTree.mjs）。
 * 数据源：/api/fact/entries（条目＋provenance）＋ /api/fact/curve（wiki 章纲）。
 *
 * 双层对齐（作者裁定的硬前置）：
 *   · fact 条目带 provenance.chapters[]（叙事章）与 provenance.segmentIndex（正文段号）
 *   · wiki chapterSummaries[] 是叙事章；两套编号**不总是一致**
 *     （实测 Qbook 短篇：291 条全标 chapter=1，wiki 却有 38 章）
 *   · 优先用 chapters[0]；缺失时按 segmentIndex 均分兜底，并标 alignment: exact|approximate
 *   · 退化保护：整本条目都标同一章、而 wiki 是多章时，chapters[] 不可信——
 *     同样落到段号均分，标 approximate（页头会如实显示「近似」）。
 *
 * 图表数据放在 stats.charts：剧情曲线（张力×事件密度）/ 伏笔回收 / 剧情密度热力图。
 * 颜色与主题不在这里定——那是前端按 CSS 令牌取值的活。
 */

export const STORY_LAYER_LABELS = Object.freeze({
  plot: '剧情',
  character: '角色',
  worldview: '世界观',
  other: '其他'
})

/**
 * 空库专用码（OS-150a）：/api/fact/entries 在拆解/ 下一本书都没有时回这个码，
 * 故事源页据此走引导性空态而不是错误条。码与文案的唯一出口在契约层
 * （API_ERROR_CODES.FACT_EMPTY）；这里只做判定，页面不认字符串。
 */
export const FACT_EMPTY_CODE = 'FACT_EMPTY'

/**
 * 坏档专用码（OS-150b）：拆解/ 下有档但一本都读不出来。与 FACT_EMPTY 是两回事——
 * 「档坏了」要告警，不能摆「还没有故事源」的引导空态把问题盖住。
 * details.books[] 逐本给 bookId/file/error，前端原样带给作者。
 */
export const FACT_UNREADABLE_CODE = 'FACT_UNREADABLE'

export function isFactEmptyError(error) {
  return error?.code === FACT_EMPTY_CODE
}

export function isFactUnreadableError(error) {
  return error?.code === FACT_UNREADABLE_CODE
}

/** 坏档错误的人话（含逐本细节）：页面不自己拼字符串，判定与文案都从码/细节派生。 */
export function factUnreadableText(error) {
  const base = text(error?.message) || '拆解档读不出来'
  const books = Array.isArray(error?.details?.books) ? error.details.books : []
  const detail = books
    .map((book) => `${text(book?.bookId) || text(book?.file) || '未命名'}：${text(book?.error) || '读不了'}`)
    .filter(Boolean)
    .join('；')
  return detail ? `${base}（${detail}）` : base
}

/** 章功能 → 张力基线（与 enrichEngine CHAPTER_FUNCTIONS 同表）。 */
const FUNCTION_TENSION = Object.freeze({
  建立: 32, 铺垫: 40, 叠加: 62, 误导: 66, 打击: 82,
  觉醒: 72, 对峙: 76, 揭露: 86, 收束: 90
})

/** 情绪 → 张力基线（与 enrichEngine EMOTIONS 同表）。 */
const EMOTION_TENSION = Object.freeze({
  甜: 42, 痛: 78, 爽: 72, 悔: 58,
  疑: 55, 燃: 86, 压迫: 80, 释然: 34
})

const LAYER_ORDER = ['plot', 'character', 'worldview', 'other']

function text(value) {
  return String(value ?? '')
}

function listOf(value) {
  return Array.isArray(value) ? value : []
}

function num(value) {
  const number = Number(value)
  return Number.isFinite(number) ? number : null
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** 层归一：只认 plot/character/worldview，其余落 other（保留原 layer 字段供界面显示）。 */
export function storyLayerKey(value) {
  const key = text(value).trim().toLowerCase()
  if (key === 'plot' || key === 'character' || key === 'worldview') return key
  return 'other'
}

function layerLabelOf(entry) {
  const key = storyLayerKey(entry?.layer)
  return STORY_LAYER_LABELS[key] || key
}

/** provenance.chapters 的第一枚正整数——没有就 null（交给段号兜底）。 */
function explicitChapterOf(entry) {
  for (const item of listOf(entry?.provenance?.chapters)) {
    const chapter = num(item)
    if (chapter && chapter > 0) return chapter
  }
  return null
}

function segmentOf(entry) {
  const segment = num(entry?.provenance?.segmentIndex)
  return segment && segment > 0 ? segment : null
}

function eventCountOf(entry) {
  const events = listOf(entry?.events).length
  if (events) return events
  return num(entry?.eventCount) ?? 0
}

/** 出场人物：先认 who，再退事件里的 who；去重、限 6 个。 */
function peopleOf(entry) {
  const people = []
  const push = (value) => {
    const name = text(value).trim()
    if (name && !people.includes(name)) people.push(name)
  }
  const who = entry?.who
  if (Array.isArray(who)) who.forEach(push)
  else text(who).split(/[、,，/]/u).forEach(push)
  if (people.length < 6) {
    for (const event of listOf(entry?.events)) {
      push(event?.who)
      if (people.length >= 6) break
    }
  }
  return people.slice(0, 6)
}

function entryKeyOf(entry, index) {
  return text(entry?.id).trim() || `fact-${index}`
}

/** 章纲归一：认 chapter / no；数字数组也收。按章号排序去重。 */
function normalizeCatalog(chapterSummaries) {
  const rows = []
  listOf(chapterSummaries).forEach((item, index) => {
    if (item === null || item === undefined) return
    const object = typeof item === 'object' ? item : { chapter: item }
    const chapter = num(object.chapter ?? object.no) ?? index + 1
    if (!chapter) return
    rows.push({
      chapter,
      title: text(object.title),
      summary: text(object.summary),
      function: text(object.function),
      emotion: text(object.emotion),
      beats: num(object.beats) ?? 0,
      events: num(object.events) ?? 0,
      foreshadows: Array.isArray(object.foreshadows) ? object.foreshadows.length : (num(object.foreshadows) ?? 0)
    })
  })
  rows.sort((left, right) => left.chapter - right.chapter)
  const seen = new Set()
  return rows.filter((row) => {
    if (seen.has(row.chapter)) return false
    seen.add(row.chapter)
    return true
  })
}

/** 段号 → 章序（按最大段号做秩映射，头尾各贴一章）。 */
function chapterIndexForSegment(segment, segmentMax, chapterCount) {
  if (chapterCount <= 1) return 0
  if (segmentMax <= 1) return 0
  const ratio = (segment - 1) / (segmentMax - 1)
  return clamp(Math.round(ratio * (chapterCount - 1)), 0, chapterCount - 1)
}

function tensionOf(chapter) {
  const byFunction = FUNCTION_TENSION[chapter.function]
  const byEmotion = EMOTION_TENSION[chapter.emotion]
  if (byFunction !== undefined && byEmotion !== undefined) {
    return clamp(Math.round(byFunction * 0.45 + byEmotion * 0.55), 0, 100)
  }
  if (byEmotion !== undefined) return byEmotion
  if (byFunction !== undefined) return byFunction
  return 50
}

/**
 * 章→拍→条目 三层（纯函数）。
 *
 * 拍＝同一正文段（segmentIndex）的 plot 条目一组；非 plot 条目按层归一个「角色/世界观」拍。
 * 返回 { chapters, alignment, exactCount, approximateCount, unassigned, chapterCount, beatCount, entryIndex }。
 * 空输入返回空骨架，不抛。
 */
export function groupByChapter(entries, chapterSummaries) {
  const raw = listOf(entries).filter((entry) => entry && typeof entry === 'object')
  // 视图对象带稳定的 _storyKey（条目 id 缺失时也能点选），正文数据只读不改。
  const items = raw.map((entry, index) => ({ ...entry, _storyKey: entryKeyOf(entry, index) }))
  const catalog = normalizeCatalog(chapterSummaries)
  const explicitNumbers = [...new Set(items.map(explicitChapterOf).filter(Boolean))].sort((left, right) => left - right)
  const segmentNumbers = items.map(segmentOf).filter(Boolean)
  const segmentMax = segmentNumbers.length ? Math.max(...segmentNumbers) : 0

  // 没有 wiki 章纲：用 fact 自报章号搭骨架；连章号都没有时按单章兜底。
  let chapters = catalog
  if (!chapters.length) {
    const numbers = explicitNumbers.length ? explicitNumbers : (segmentMax ? [1] : [])
    chapters = numbers.map((chapter) => ({
      chapter, title: '', summary: '', function: '', emotion: '', beats: 0, events: 0, foreshadows: 0
    }))
  }
  const known = new Set(chapters.map((chapter) => chapter.chapter))
  for (const chapter of explicitNumbers) {
    if (known.has(chapter)) continue
    known.add(chapter)
    chapters.push({ chapter, title: '', summary: '', function: '', emotion: '', beats: 0, events: 0, foreshadows: 0 })
  }
  chapters.sort((left, right) => left.chapter - right.chapter)

  // 退化：fact 全标同一章（且正是章纲首章）、wiki 却是多章——chapters[] 不可信，改走段号均分。
  const explicitSet = new Set(items.map(explicitChapterOf).filter(Boolean))
  const onlyExplicit = explicitSet.size === 1 ? [...explicitSet][0] : null
  const degenerate = chapters.length > 1 && onlyExplicit !== null
    && onlyExplicit === chapters[0].chapter && segmentNumbers.length > 0

  const chapterMap = new Map()
  for (const chapter of chapters) {
    chapterMap.set(chapter.chapter, {
      ...chapter,
      beats: [],
      entries: [],
      eventCount: 0,
      alignment: 'exact',
      exact: 0,
      approximate: 0
    })
  }
  const beatMaps = new Map()
  const entryIndex = {}
  let exactCount = 0
  let approximateCount = 0
  let unassigned = 0

  items.forEach((entry, order) => {
    const explicit = explicitChapterOf(entry)
    const segment = segmentOf(entry)
    let chapterNo = null
    let alignment = 'exact'
    if (degenerate && segment) {
      chapterNo = chapters[chapterIndexForSegment(segment, segmentMax, chapters.length)].chapter
      alignment = 'approximate'
    } else if (explicit) {
      chapterNo = explicit
    } else if (segment && chapters.length) {
      chapterNo = chapters[chapterIndexForSegment(segment, segmentMax, chapters.length)].chapter
      alignment = 'approximate'
    }
    // 既无章号也无段号：归到首章并标近似，宁可显示也别把条目藏掉。
    if (!chapterNo && chapters.length) {
      chapterNo = chapters[0].chapter
      alignment = 'approximate'
    }
    const chapter = chapterNo ? chapterMap.get(chapterNo) : null
    if (!chapter) {
      unassigned += 1
      return
    }

    if (alignment === 'approximate') {
      approximateCount += 1
      chapter.approximate += 1
      chapter.alignment = 'approximate'
    } else {
      exactCount += 1
      chapter.exact += 1
    }
    chapter.entries.push(entry)
    chapter.eventCount += eventCountOf(entry)

    const layerKey = storyLayerKey(entry.layer)
    let beatKey
    let beatLabel
    if (entry.layer === 'plot' && segment) {
      beatKey = `seg:${segment}`
      beatLabel = `段 ${segment}`
    } else if (entry.layer === 'plot') {
      beatKey = `plot:${order}`
      const beatNo = (beatMaps.get(chapterNo)?.size ?? 0) + 1
      beatLabel = `第${beatNo}拍`
    } else {
      beatKey = `layer:${layerKey}`
      beatLabel = layerLabelOf(entry)
    }
    if (!beatMaps.has(chapterNo)) beatMaps.set(chapterNo, new Map())
    const beatMap = beatMaps.get(chapterNo)
    let beat = beatMap.get(beatKey)
    if (!beat) {
      beat = {
        key: beatKey,
        label: beatLabel,
        segment: segment ?? null,
        layer: layerKey,
        alignment: 'exact',
        eventCount: 0,
        entries: []
      }
      beatMap.set(beatKey, beat)
      chapter.beats.push(beat)
    }
    beat.entries.push(entry)
    beat.eventCount += eventCountOf(entry)
    if (alignment === 'approximate') beat.alignment = 'approximate'

    entryIndex[entry._storyKey] = {
      key: entry._storyKey,
      id: text(entry.id),
      chapter: chapter.chapter,
      chapterTitle: chapter.title,
      beat: beatLabel,
      alignment
    }
  })

  // 拍序：有段号的 plot 拍按段号在前；层拍按 plot/character/worldview/other 收尾。
  for (const chapter of chapterMap.values()) {
    chapter.beats.sort((left, right) => {
      const leftSeg = left.segment ?? Number.MAX_SAFE_INTEGER
      const rightSeg = right.segment ?? Number.MAX_SAFE_INTEGER
      if (leftSeg !== rightSeg) return leftSeg - rightSeg
      return LAYER_ORDER.indexOf(left.layer) - LAYER_ORDER.indexOf(right.layer)
    })
  }

  const resultChapters = [...chapterMap.values()]
  const beatCount = resultChapters.reduce((sum, chapter) => sum + chapter.beats.length, 0)
  return {
    chapters: resultChapters,
    alignment: approximateCount > 0 ? 'approximate' : 'exact',
    exactCount,
    approximateCount,
    unassigned,
    chapterCount: resultChapters.length,
    beatCount,
    entryIndex
  }
}

/** 按层分组：plot/character/worldview/other（other 兜未知层，原 layer 字段不丢）。 */
export function groupByLayer(entries) {
  const buckets = { plot: [], character: [], worldview: [], other: [] }
  listOf(entries).forEach((entry) => {
    if (!entry || typeof entry !== 'object') return
    buckets[storyLayerKey(entry.layer)].push(entry)
  })
  return buckets
}

/**
 * 飞书多维表格列定义（P1 只读）。
 * 列固定，不随数据变：名称 / 层 / 状态 / 出场人物 / 章 / 段 / 事件数。
 */
export function toBoardColumns(entries) {
  // 列定义固定，不随数据变（entries 保留为签名参数，列开关留给后续迭代）。
  return [
    { key: 'name', label: '名称', kind: 'text', width: 'minmax(190px, 1.6fr)', align: 'left' },
    { key: 'layerLabel', label: '层', kind: 'tag', width: '86px', align: 'left' },
    { key: 'status', label: '状态', kind: 'text', width: '78px', align: 'left' },
    { key: 'cast', label: '出场人物', kind: 'text', width: 'minmax(130px, 1fr)', align: 'left' },
    { key: 'chapter', label: '章', kind: 'number', width: '56px', align: 'right' },
    { key: 'segment', label: '段', kind: 'number', width: '56px', align: 'right' },
    { key: 'events', label: '事件数', kind: 'number', width: '66px', align: 'right' }
  ]
}

function boardRowOf(entry, meta) {
  const segment = segmentOf(entry)
  const people = peopleOf(entry)
  return {
    id: entry._storyKey,
    name: text(entry.name).trim(),
    layer: storyLayerKey(entry.layer),
    layerLabel: layerLabelOf(entry),
    status: text(entry.status).trim(),
    cast: people.join('、'),
    chapter: meta?.chapter ?? 0,
    segment: segment ?? 0,
    events: eventCountOf(entry),
    alignment: meta?.alignment ?? 'exact',
    entry
  }
}

function buildCharts(chapters, wiki, entries = []) {
  const curve = chapters.map((chapter) => ({
    chapter: chapter.chapter,
    title: chapter.title || `第${chapter.chapter}章`,
    function: chapter.function,
    emotion: chapter.emotion,
    tension: tensionOf(chapter),
    density: chapter.eventCount || chapter.events || 0
  }))
  const maxChapter = chapters.length ? chapters[chapters.length - 1].chapter : 0

  // 伏笔：wiki 有明细就用明细（埋/收/未收），只有计数就退到「累计未收」。
  // OS-74：兼容两种数据形态——
  //   ① 章级：{ chapter, payoffChapter }（老数据）
  //   ② 段级：{ chapter, plantedAt, payoffAt, status }（OS-74 起 enrich/手写都按这个）
  // 段级字段要经「段号→章序」映射，才能和章轴对齐。
  const segMaxForHooks = Math.max(0, ...listOf(entries)
    .map((entry) => num(entry?.provenance?.segmentIndex) ?? 0))
  const segmentToChapterNo = (segment) => {
    if (!segment) return null
    const index = chapterIndexForSegment(segment, Math.max(segMaxForHooks, segment), chapters.length)
    const chapterObj = chapters[index]
    return chapterObj ? chapterObj.chapter : null
  }
  const points = listOf(wiki?.foreshadows).map((hook, index) => {
    const chapter = num(hook?.chapter)
    if (!chapter) return null
    // 优先章级字段（已是章号），其次段级字段（要映射），最后看 status
    const payoffChapter = num(hook?.payoffChapter ?? hook?.payoff ?? hook?.resolvedAt)
      ?? segmentToChapterNo(num(hook?.payoffAt))
    const status = text(hook?.status).toLowerCase()
    const resolved = Boolean(payoffChapter) || hook?.resolved === true || status === 'paid' || status === 'resolved'
    return {
      index,
      id: text(hook?.id) || `f-${index}`,
      chapter,
      text: text(hook?.text ?? hook?.summary),
      plantedAt: num(hook?.plantedAt) ?? null,
      payoffAt: num(hook?.payoffAt) ?? null,
      status: status || (resolved ? 'paid' : 'unresolved'),
      note: text(hook?.note),
      resolved,
      payoffChapter: payoffChapter || null
    }
  }).filter(Boolean)

  const plantedByChapter = new Map()
  for (const point of points) plantedByChapter.set(point.chapter, (plantedByChapter.get(point.chapter) ?? 0) + 1)
  let running = 0
  const foreshadowCounts = chapters.map((chapter) => {
    const planted = points.length ? (plantedByChapter.get(chapter.chapter) ?? 0) : (chapter.foreshadows || 0)
    running += planted
    return { chapter: chapter.chapter, planted, cumulative: running }
  })

  // 剧情密度热力图：横轴章、纵轴章内拍序（只算有段号的 plot 拍）。
  // OS-112 修：没有 wiki 章纲时 chapters 只有 1 个兜底章 → 热力图退化成单列。
  // 这里按条目 span / events.chapter 的真实章号补出章轴，保证图能铺开。
  let chartChapters = chapters
  if (chapters.length <= 1) {
    const chapterNos = new Set()
    for (const entry of listOf(entries)) {
      const from = num(entry?.span?.from)
      const to = num(entry?.span?.to)
      if (from != null) chapterNos.add(from)
      if (to != null) chapterNos.add(to)
      for (const ev of listOf(entry?.events)) {
        const ch = num(ev?.chapter)
        if (ch != null) chapterNos.add(ch)
      }
    }
    if (chapterNos.size > 1) {
      chartChapters = [...chapterNos].sort((a, b) => a - b).map((no) => ({
        chapter: no,
        title: `第${no}章`,
        beats: listOf(entries)
          .filter((entry) => {
            const from = num(entry?.span?.from)
            const to = num(entry?.span?.to)
            return from != null && to != null && no >= from && no <= to
          })
          .map((entry, index) => ({ layer: 'plot', segment: index + 1, eventCount: listOf(entry.events).length }))
      }))
    }
  }
  const cells = []
  const xChapters = chartChapters.map((chapter) => chapter.chapter)
  chartChapters.forEach((chapter, x) => {
    const plotBeats = chapter.beats.filter((beat) => beat.layer === 'plot' && beat.segment)
    plotBeats.forEach((beat, y) => {
      cells.push([x, y, beat.eventCount])
    })
  })
  const maxBeat = cells.length ? Math.max(...cells.map((cell) => cell[1])) + 1 : 0
  const heatmap = {
    xLabels: chartChapters.map((chapter) => String(chapter.chapter)),
    xChapters,
    yLabels: Array.from({ length: maxBeat }, (_, index) => `第${index + 1}拍`),
    data: cells,
    max: cells.length ? Math.max(...cells.map((cell) => cell[2])) : 0
  }

  return {
    curve,
    foreshadows: {
      detail: points.length > 0,
      points,
      counts: foreshadowCounts,
      maxChapter
    },
    heatmap
  }
}

/**
 * 角色泳道时间线（OS-111）：把 fact 条目的事件按「谁（who）× 何时（span/index）」铺开。
 *
 * 作者口径：「一章里可能涉及一个时间线，不同角色在同一轴上不断出场、退场、说话、行动」。
 * fact 条目里的 events 正是这个原料：每个事件带 who（谁）/ channel（说/做/感知/情绪/状态）/
 * index（该条目内的序号）/ 条目 span.from~to（对应正文章节）。
 *
 * 产出四条轴：
 *   tracks      角色泳道（每人在自己的行上，事件按章位置摆放）
 *   chapters    横轴刻度（章号）
 *   channels    事件类型图例（say/do/perceive/feel/state）
 *   spans       条目跨章区间（用于画「这一幕持续第 1–2 章」的横条）
 *
 * 纯函数：不读盘、不依赖浏览器。
 */
export function buildTimeline(entries) {
  const list = (Array.isArray(entries) ? entries : []).filter((e) => e && typeof e === "object")
  const chapterSet = new Set()
  const byWho = new Map()
  const spans = []
  const CHANNEL_LABEL = { say: "说", do: "做", perceive: "感知", feel: "情绪", state: "状态", action: "行动" }

  for (const entry of list) {
    const name = text(entry.name).trim()
    const spanFrom = num(entry?.span?.from)
    const spanTo = num(entry?.span?.to)
    if (spanFrom != null) chapterSet.add(spanFrom)
    if (spanTo != null) chapterSet.add(spanTo)
    if (spanFrom != null && spanTo != null) {
      spans.push({ name, from: spanFrom, to: spanTo })
    }
    const events = listOf(entry.events)
    for (const ev of events) {
      const who = text(ev?.who).trim() || "（未标注）"
      // 章位置：优先事件自带的 chapter，否则用条目 span.from（条目整体发生在该章）
      const chapter = num(ev?.chapter) ?? spanFrom ?? null
      if (chapter != null) chapterSet.add(chapter)
      const channel = text(ev?.channel).trim() || "other"
      if (!byWho.has(who)) byWho.set(who, [])
      byWho.get(who).push({
        entry: name,
        chapter,
        index: num(ev?.index) ?? 0,
        channel,
        channelLabel: CHANNEL_LABEL[channel] ?? channel,
        track: text(ev?.track) || "fact",
        content: text(ev?.content).trim().slice(0, 220)
      })
    }
  }

  const chapters = [...chapterSet].filter((n) => n != null).sort((a, b) => a - b)
  const tracks = [...byWho.entries()]
    .map(([who, events]) => ({
      who,
      count: events.length,
      // 同章内按 index 稳定排序，方便横轴从左到右读
      events: events.sort((a, b) => (a.chapter ?? 0) - (b.chapter ?? 0) || a.index - b.index)
    }))
    .sort((a, b) => b.count - a.count || a.who.localeCompare(b.who, "zh-Hans-CN"))

  const usedChannels = new Set()
  for (const track of tracks) for (const ev of track.events) usedChannels.add(ev.channel)

  return {
    tracks,
    chapters,
    spans: spans.sort((a, b) => a.from - b.from),
    channels: [...usedChannels].map((key) => ({ key, label: CHANNEL_LABEL[key] ?? key })),
    stats: {
      trackCount: tracks.length,
      eventCount: tracks.reduce((sum, t) => sum + t.count, 0),
      chapterCount: chapters.length,
      // 数据够不够画：没有事件就是空图，前端据此给「这份拆解没有事件级数据」的提示
      drawable: tracks.length > 0 && chapters.length > 0
    }
  }
}

/**
 * 故事源总装（纯函数）。
 * 返回 { tree, board, stats }：
 *   tree  = 章→拍→条目 三层＋对齐标记＋entryIndex/byKey
 *   board = 多维表列定义＋行（层/章/段/事件数/出场人物）
 *   stats = 计数、对齐统计、charts（三张图的数据）
 * view 只作元信息（outline/board/chart），三形态数据始终都算好——切形态不重算接口。
 */
export function layoutStorySource({ entries, wiki, view } = {}) {
  const raw = listOf(entries).filter((entry) => entry && typeof entry === 'object')
  const items = raw.map((entry, index) => ({ ...entry, _storyKey: entryKeyOf(entry, index) }))
  const grouped = groupByChapter(items, wiki?.chapterSummaries ?? wiki?.chapters ?? [])
  const layers = groupByLayer(items)
  const layerCounts = {}
  for (const key of LAYER_ORDER) {
    if (layers[key].length) layerCounts[key] = layers[key].length
  }

  const rows = []
  for (const chapter of grouped.chapters) {
    for (const entry of chapter.entries) {
      rows.push(boardRowOf(entry, grouped.entryIndex[entry._storyKey]))
    }
  }
  rows.sort((left, right) => {
    return left.chapter - right.chapter
      || (left.segment || Number.MAX_SAFE_INTEGER) - (right.segment || Number.MAX_SAFE_INTEGER)
      || left.name.localeCompare(right.name, 'zh-Hans-CN')
  })

  const byKey = {}
  for (const entry of items) byKey[entry._storyKey] = entry

  const stats = {
    view: ['outline', 'board', 'chart'].includes(view) ? view : 'outline',
    entries: items.length,
    events: items.reduce((sum, entry) => sum + eventCountOf(entry), 0),
    sources: items.reduce((sum, entry) => sum + listOf(entry.sources).length, 0),
    withSources: items.filter((entry) => listOf(entry.sources).length > 0).length,
    chapters: grouped.chapterCount,
    beats: grouped.beatCount,
    layers: layerCounts,
    alignment: grouped.alignment,
    exact: grouped.exactCount,
    approximate: grouped.approximateCount,
    unassigned: grouped.unassigned
  }
  stats.charts = buildCharts(grouped.chapters, wiki, items)

  return {
    tree: {
      chapters: grouped.chapters,
      alignment: grouped.alignment,
      exactCount: grouped.exactCount,
      approximateCount: grouped.approximateCount,
      unassigned: grouped.unassigned,
      chapterCount: grouped.chapterCount,
      beatCount: grouped.beatCount,
      entryIndex: grouped.entryIndex,
      byKey
    },
    board: {
      columns: toBoardColumns(items),
      rows,
      layerCounts
    },
    stats
  }
}
