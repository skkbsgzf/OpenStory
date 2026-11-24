/**
 * 推演引擎封装（OS-29；OS-155 引擎归位到 `./engine/`）——把确定性推演链接进 OpenStory daemon。
 *
 * 复用面（扮演模块自有，`src/modules/deduce/engine/`：OS-155 自 core 平移、逻辑逐字未改）：
 *   openDeduceSession（开局：worldview 必需，无则 WORLD_EMPTY 如实报）→ presentTurn（定局面卡＋候选）
 *   → applyDirectorAction（导演动作）→ settle（作者选择→事件条目）。
 * 引擎本身确定性（mulberry32 种子化 2d6），LLM 只是「戏剧」候选的可选来源——没配模型也能跑。
 * llmPort 规范接口见 docs/deduce-llm-port.md（本封装做显式形状校验，坏形状＝当 null 不炸）。
 *
 * 会话状态：一个库一个推演会话文件 `.openstory/deduce/<bookId>.json`（原子写，不碰 Pinax 元数据）。
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fact } from '../../protocol/index.mjs' // OS-142：内核能力经 Host API fact 命名空间转出（模块纪律：modules 不直引内核实现）
import { openDeduceSession, presentTurn, applyDirectorAction, settleChoice } from './engine/index.mjs'
import { buildNarrativeContext, firstPersonify, readWikiSafe } from './deduceNarrative.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'

const { factStore } = fact // OS-125 出口组的 fact 存储协议（经协议层转出）；推演端子 OS-155 起归本模块 engine/

function text(value) {
  return String(value ?? '')
}

export const DEDUCE_DIR = '.openstory/deduce'

/** 推演会话文件路径（库内，不碰 .pinax）。OS-86：sessionId='main'＝legacy 单文件，
 *  其余局走 <bookId>@<sid>.json——引擎状态（round/seed/lastCandidates/fronts）跟局走。 */
export function deduceStatePath(root, bookId, sessionId = '') {
  const safe = text(bookId).replace(/[^\w-]/gu, '_').slice(0, 64) || 'default'
  const sid = text(sessionId).trim() || 'main'
  if (sid === 'main') return join(root, DEDUCE_DIR, `${safe}.json`)
  return join(root, DEDUCE_DIR, `${safe}@${sid}.json`)
}

/** 读库内拆解条目（fact 通道，与 /api/entries 同源）。 */
export function loadEntries(root) {
  const store = factStore.createFactFileStore({ root })
  const listed = store.list({ limit: 5000 })
  if (!listed.ok) return { ok: false, message: text(listed.error?.message || '条目读取失败') }
  return { ok: true, entries: listed.entries ?? [] }
}

/**
 * 开局三件套（OS-93，照酒馆：选角色卡 → 选世界书 → 选开头）：
 *   books     拆解目录里的书（bookId＋标题＋各类条目数）＝世界书候选
 *   characters 角色卡（character 条目：名字/identity/archetype/出场数）
 *   openings  开头候选：引擎摆局（默认）＋剧情条目（每条剧情事实都是一个可进入的开头，
 *             对应酒馆 alternate_greetings 的位置——选它＝戏剧候选围绕这段锚定）
 */
export function deduceOpening({ root }) {
  const loaded = loadEntries(root)
  if (!loaded.ok) return { ok: false, code: 'INVALID_ENTRY', message: loaded.message }
  const entries = loaded.entries
  const books = []
  const dir = join(root, '拆解')
  try {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith('.json') || name.endsWith('.wiki.json')) continue  // wiki 是派生档不是世界书
      const bookId = name.replace(/\.json$/u, '')
      try {
        const doc = JSON.parse(readFileSync(join(dir, name), 'utf-8'))
        const list = Array.isArray(doc?.entries) ? doc.entries : []
        const count = (layer) => list.filter((entry) => text(entry?.layer).toLowerCase() === layer).length
        books.push({
          bookId,
          title: text(doc?.book?.title) || bookId,
          total: list.length,
          worldview: count('worldview'),
          characters: count('character'),
          plot: count('plot'),
          // OS-96：条目的首次出现章节分布（世界书按章过滤的依据）
          firstChapterOf: (entry) => {
            const fc = Number(entry?.firstChapter)
            if (Number.isFinite(fc) && fc >= 0) return fc
            const chapters = Array.isArray(entry?.chapters) ? entry.chapters.filter(Number.isInteger) : []
            return chapters.length ? Math.min(...chapters) : 0
          }
        })
      } catch { /* 坏档跳过 */ }
    }
  } catch { /* 没有拆解目录 */ }
  const characters = entries
    .filter((entry) => text(entry?.layer).toLowerCase() === 'character')
    .map((entry) => ({
      name: text(entry?.name).trim(),
      identity: text(entry?.identity) || text(entry?.definition),
      archetype: text(entry?.archetype),
      appearances: Number(entry?.appearances) || 0
    }))
    .filter((entry) => entry.name)
  characters.sort((left, right) => right.appearances - left.appearances)
  const openings = [
    { id: 'free', label: '引擎摆局', detail: '不锚定具体剧情——世界按现状摆一个局面，从眼前的动静开始' },
    ...entries
      .filter((entry) => text(entry?.layer).toLowerCase() === 'plot' && (text(entry?.definition) || text(entry?.fact)))
      .slice(0, 12)
      .map((entry) => ({ id: text(entry.id), label: text(entry.name), detail: text(entry.definition) || text(entry.fact) }))
  ]
  return { ok: true, books, characters, openings }
}

function loadState(root, bookId, sessionId = '') {
  const path = deduceStatePath(root, bookId, sessionId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

async function saveState(root, bookId, state, sessionId = '') {
  const path = deduceStatePath(root, bookId, sessionId)
  await mkdir(dirname(path), { recursive: true })
  await atomicWriteFile(path, JSON.stringify(state, null, 2))
}

/**
 * 呈现一拍：开局（或续用已有会话）→ 局面卡＋候选。
 * 返回 {ok, round, sceneCard, candidates, tension, fronts, budget} 或 {ok:false, code, message}
 */
/** 缺省主视角：character 层里出场最多者；没有 character 条目返回 null（如实报 POV_NOT_FOUND）。 */
function defaultPov(entries) {
  const chars = (Array.isArray(entries) ? entries : [])
    .filter((entry) => text(entry?.layer).trim().toLowerCase() === 'character')
    .map((entry) => ({ name: text(entry?.name).trim(), appearances: Number(entry?.appearances) || 0 }))
    .filter((item) => item.name)
  chars.sort((left, right) => right.appearances - left.appearances)
  return chars[0]?.name ?? null
}

/**
 * llmPort 归一（OS-155，规范接口见 docs/deduce-llm-port.md）：
 *   propose({ prompt, refs }) → [{ text, refs }] | null     ← 规范形状
 *   complete({ system, maxTokens }) → { text }              ← 宿主历史形状（等价支持）
 * 返回 { port, notes }：port 是给引擎的 `{ complete }`（形状坏＝null）；notes 收集形状问题
 * 由调用方在响应里如实带出——坏端口只让本拍戏剧候选缺席，绝不让整拍抛错。
 */
function normalizeLlmPort(llmPort) {
  if (!llmPort || typeof llmPort !== 'object') return { port: null, notes: [] }
  if (typeof llmPort.complete === 'function') {
    return { port: { complete: (payload) => llmPort.complete(payload) }, notes: [] }
  }
  if (typeof llmPort.propose !== 'function') {
    return { port: null, notes: ['llmPort 既没有 propose 也没有 complete：本拍戏剧候选缺席'] }
  }
  const notes = []
  const port = {
    async complete({ system = '' } = {}) {
      let answer
      try {
        answer = await llmPort.propose({ prompt: system, refs: [] })
      } catch (error) {
        notes.push(`llmPort.propose 抛错：${text(error?.message || error)}`)
        return { text: '' }
      }
      if (answer === null || answer === undefined) return { text: '' }
      if (!Array.isArray(answer)) {
        notes.push('llmPort.propose 返回值不是数组：按 null 处理（本拍戏剧候选缺席）')
        return { text: '' }
      }
      const proposals = []
      for (const item of answer) {
        if (!item || typeof item.text !== 'string' || !item.text.trim()) {
          notes.push('llmPort.propose 有条目形状坏（缺 text）：已丢弃')
          continue
        }
        proposals.push({ text: item.text, refs: Array.isArray(item.refs) ? item.refs.map(String) : [] })
      }
      return { text: JSON.stringify({ proposals }) }
    }
  }
  return { port, notes }
}

export async function deducePresent({ root, bookId = 'default', pov = '', seed = null, reset = false, peek = false, llmPort = null, sessionId = '', seedPrompt = '', chapterLimit = null } = {}) {
  const loaded = loadEntries(root)
  if (!loaded.ok) return { ok: false, code: 'INVALID_ENTRY', message: loaded.message }
  // OS-96：chapterLimit 给了＝世界书词条按首次出现章节过滤（写 到30 章 的库不给 31 章以后的知识）
  const limit = Number.isFinite(Number(chapterLimit)) && Number(chapterLimit) > 0 ? Number(chapterLimit) : null
  const entries = limit == null
    ? loaded.entries
    : loaded.entries.filter((entry) => {
      const fc = Number(entry?.firstChapter)
      if (Number.isFinite(fc) && fc >= 0) return fc <= limit
      const chapters = Array.isArray(entry?.chapters) ? entry.chapters.filter(Number.isInteger) : []
      return chapters.length ? Math.min(...chapters) <= limit : true
    })
  if (!entries.length) {
    return { ok: false, code: 'INVALID_ENTRY', message: '这个库还没有拆解条目（worldview/角色/剧情），推演引擎需要事实包才能开局' }
  }
  let state = reset ? null : loadState(root, bookId, sessionId)
  // peek（OS-60）：界面进入时只读当前局面，**不推进一拍**。
  if (peek) {
    if (!state) return { ok: false, code: 'NO_DEDUCE_SESSION', message: '这个库还没有推演会话' }
    const last = state.lastTurn || null
    const pov = text(state.pov || (last?.sceneCard?.who ?? [])[0] || '').trim()
    // OS-79：peek 也带叙事上下文（前情/身份/场景）——进页面就能看到「我是谁、前面发生了什么」
    const wiki = readWikiSafe(root, bookId)
    const narrative = buildNarrativeContext({
      entries, wiki, session: state, sceneCard: last?.sceneCard ?? null, pov,
      currentChapter: Number(state.chapter) || 1
    })
    return {
      ok: true,
      peek: true,
      bookId,
      round: state.round ?? 0,
      seed: state.seed ?? null,
      sceneCard: last?.sceneCard ?? null,
      // OS-92：选项＝我的决定——存量候选显示层纠偏（命运补人话文案、其余把 POV 名换成「我」）
      candidates: Array.isArray(last?.candidates)
        ? last.candidates.map((candidate) => ({
            ...candidate,
            text: text(candidate.source) === '命运' && candidate.trace
              ? humanizeFateText(candidate.trace)
              : firstPersonify(candidate.text, pov)
          }))
        : [],
      tension: last?.tension ?? null,
      fronts: summarizeFronts(state.fronts),
      budget: { used: state.aiSpent ?? 0, max: state.budgetMax ?? 8 },
      pov,
      narrative,
      characters: entries
        .filter((entry) => text(entry?.layer).trim().toLowerCase() === 'character')
        .map((entry) => text(entry?.name).trim())
        .filter(Boolean)
    }
  }
  if (!state) {
    let opened
    try {
      // POV 缺省（OS-54）：没填就取出场最多的角色——条目页签剔除后角色名单从 present
      // 响应的 characters 来，第一次点「呈现」就能直接开局
      opened = openDeduceSession({ entries, pov: pov || (state ? state.pov : null) || defaultPov(entries), runId: `os-${Date.now().toString(36)}` })
    } catch (error) {
      // 引擎的前置校验（如 WORLD_EMPTY）如实透传，不伪造开局
      return { ok: false, code: text(error?.code || 'INVALID_ENTRY'), message: text(error?.message || error) }
    }
    state = opened.state ?? opened
  } else if (pov) {
    state.pov = pov
  }
  const useSeed = Number.isSafeInteger(seed) ? seed : (state.seed ?? (Math.floor(Math.random() * 1e9)))
  state.seed = useSeed
  // OS-155：llmPort 显式形状校验（docs/deduce-llm-port.md）——坏形状只让戏剧候选缺席，不炸拍。
  const { port: safeLlmPort, notes: llmPortNotes } = normalizeLlmPort(llmPort)
  let turn
  try {
    // OS-82：llmPort 透传给引擎——「戏剧✦」候选从配置的文本模型来（没配模型时 dramaCandidates
    // 自己返回空数组，必然/命运两层照常跑，推演永远不被模型不可用卡死）。
    // OS-93：seedPrompt＝玩家选的开头（剧情骨架段）——戏剧候选围绕它锚定。
    turn = await presentTurn({
      state, entries, pov: pov || state.pov || null, seed: useSeed,
      ...(seedPrompt ? { seedPrompt } : {}), ...(safeLlmPort ? { llmPort: safeLlmPort } : {})
    })
  } catch (error) {
    return { ok: false, code: text(error?.code || 'INVALID_ENTRY'), message: text(error?.message || error) }
  }
  // OS-88/92：候选统一映射——命运文案人话化（骰点收尾）；其余候选把 POV 名换成「我」
  // （选项＝我的决定，哪怕 vendor/存量给的是第三人称）。一处重写全链路受益。
  const mappedCandidates = (turn.candidates ?? []).map((candidate, index) => ({
    id: text(candidate.id) ? `${text(candidate.id)}-${index}` : `c${index}`,
    source: text(candidate.source),
    text: text(candidate.source) === '命运'
      ? humanizeFateText(candidate.trace)
      : firstPersonify(candidate.text, state.pov),
    refs: Array.isArray(candidate.refs) ? candidate.refs : [],
    trace: candidate.trace ?? null
  }))
  // OS-93 候选保底：命运不进选项，模型缺席＋事实包薄时可见候选可能为 0——
  // 开局永远有得选：从局面本身（在场/钩子/地点）推确定性分支，标记「眼前」。
  const visible = mappedCandidates.filter((candidate) => candidate.source !== '命运')
  if (visible.length < 2) {
    const card = turn.sceneCard ?? {}
    const others = (Array.isArray(card.who) ? card.who : []).filter((name) => text(name) && text(name) !== text(state.pov))
    const where = text(card.where)
    const pool = [
      others.length ? { id: `scene-greet-${state.round}`, text: `叫住${others[0]}，先把眼前这个人的来历问清楚`, refs: [others[0]] } : null,
      text(card.hook) ? { id: `scene-hook-${state.round}`, text: '顺着眼前的动静查下去，看个究竟', refs: [] } : null,
      { id: `scene-look-${state.round}`, text: where && where !== '未标记地点' ? `在${where}附近转一圈，把周围的环境摸清楚` : '原地观察一会儿，等事情自己露头', refs: [] }
    ].filter(Boolean)
    for (const item of pool.slice(0, 2)) {
      mappedCandidates.push({
        id: item.id, source: '眼前', text: item.text, refs: item.refs, trace: null
      })
    }
  }
  // 存最后一面（OS-60）：进入推演页时 peek 回放这一面，不额外推进
  state.lastTurn = {
    sceneCard: turn.sceneCard ?? null,
    candidates: mappedCandidates,
    tension: turn.tension ?? null
  }
  await saveState(root, bookId, state, sessionId)
  // OS-79：present 也带叙事上下文（与 peek 同结构），开局那一次就能看到「我是谁/前情/场景」
  const presentPov = text(state.pov || (turn.sceneCard?.who ?? [])[0] || '').trim()
  const presentWiki = readWikiSafe(root, bookId)
  const presentNarrative = buildNarrativeContext({
    entries, wiki: presentWiki, session: state, sceneCard: turn.sceneCard ?? null, pov: presentPov,
    currentChapter: Number(state.chapter) || 1
  })
  return {
    ok: true,
    bookId,
    round: state.round ?? 0,
    seed: useSeed,
    sceneCard: turn.sceneCard,
    candidates: mappedCandidates,
    tension: turn.tension ?? null,
    fronts: summarizeFronts(state.fronts),
    budget: { used: state.aiSpent ?? 0, max: state.budgetMax ?? 8 },
    pov: presentPov,
    narrative: presentNarrative,
    // OS-155：坏 llmPort 的形状问题如实带出（前端可忽略；不写日志、不落库，纯本拍信息）
    ...(llmPortNotes.length ? { llmPortNote: llmPortNotes.join('；') } : {}),
    // POV 候选（OS-54）：条目页签剔除后，角色名单由 present 响应直接带——
    // 前端 datalist 不再依赖 /api/entries 侧通道
    characters: entries
      .filter((entry) => text(entry?.layer).trim().toLowerCase() === 'character')
      .map((entry) => text(entry?.name).trim())
      .filter(Boolean)
  }
}

/**
 * 命运候选的人话文案（OS-88，作者实测「检定 2d6=6+2=8：顺遂到底是什么意思」）：
 * vendor 的 `剧情检定 2d6=a+b=sum：顺遂/受阻` 是跑团黑话——玩家不知道自己选的是什么。
 * 这里按骰点翻成一句话：先说人话结论，骰点收尾（条目名截 18 字也截在语义上）。
 * 纯函数：同 trace 同文案，不破坏引擎「同种子同事实＝同一拍」的可复现承诺。
 */
export function humanizeFateText(trace) {
  const t = trace ?? {}
  const a = Number.isFinite(Number(t.a)) ? Number(t.a) : null
  const b = Number.isFinite(Number(t.b)) ? Number(t.b) : null
  const sum = Number.isFinite(Number(t.sum)) ? Number(t.sum) : (a !== null && b !== null ? a + b : null)
  const success = t.success === undefined || t.success === null ? (sum !== null && sum >= 7) : t.success === true
  const roll = sum !== null ? `（命运骰 ${sum}：${a}+${b} ${success ? '顺遂' : '受阻'}）` : ''
  if (success) return `世界不拦你——事情按眼下最自然的走向推进${roll}`
  return `世界设了坎——这一步会受阻，有代价要收拾${roll}`
}

function summarizeFronts(fronts) {
  const list = Array.isArray(fronts) ? fronts : (fronts?.fronts ?? [])
  return list.map((front) => ({
    id: text(front.id),
    name: text(front.name),
    value: Number(front.value) || 0,
    max: Number(front.max) || 6,
    resolved: front.resolved === true
  }))
}

/**
 * 结算一拍：作者选择某候选（或否决）。
 * 返回 {ok, action, entry?} —— entry 是引擎产出的事件条目（不自动写回库，交由待确认卡/后续批次）。
 */
export async function deduceSettle({ root, bookId = 'default', candidateId = '', action = 'choose', note = '', sessionId = '' } = {}) {
  const state = loadState(root, bookId, sessionId)
  if (!state) return { ok: false, code: 'NOT_FOUND', message: '还没有推演会话：先呈现一拍' }
  const loaded = loadEntries(root)
  if (!loaded.ok) return { ok: false, code: 'INVALID_ENTRY', message: loaded.message }
  const candidates = state.lastCandidates ?? []
  const candidate = candidates.find((item) => text(item.id) === text(candidateId))
  if (action === 'choose' && !candidate) {
    return { ok: false, code: 'INVALID_ENTRY', message: `候选不在本拍里：${text(candidateId)}` }
  }
  let settled
  try {
    if (action === 'choose') {
      settled = settleChoice({ state, domain: 'deduce', candidate })
    } else {
      settled = applyDirectorAction({ state, action, candidate, name: note })
    }
  } catch (error) {
    return { ok: false, code: text(error?.code || 'INVALID_ENTRY'), message: text(error?.message || error) }
  }
  await saveState(root, bookId, state, sessionId)
  return { ok: true, action, result: settled ?? null, round: state.round ?? 0 }
}
