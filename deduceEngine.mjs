/**
 * 推演引擎封装（OS-29）——把 Pinax 的 fact 推演链接进 OpenStory daemon。
 *
 * 复用面（core/pinax/ 逐字 vendor，见 scripts/vendor-deduce.mjs）：
 *   openDeduceSession（开局：worldview 必需，无则 WORLD_EMPTY 如实报）→ presentTurn（定局面卡＋候选）
 *   → applyDirectorAction（导演动作）→ settle（作者选择→事件条目）。
 * 引擎本身确定性（mulberry32 种子化 2d6），LLM 只是「戏剧」候选的可选来源——没配模型也能跑。
 *
 * 会话状态：一个库一个推演会话文件 `.openstory/deduce/<bookId>.json`（原子写，不碰 Pinax 元数据）。
 */
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { openDeduceSession } from './core/pinax/next/fact/usecases/deduce/opening.js'
import { presentTurn, applyDirectorAction } from './core/pinax/next/fact/usecases/deduce/turn.js'
import { settleChoice } from './core/pinax/next/fact/usecases/deduce/settle.js'
import { createFactFileStore } from './core/pinax/next/kernel/factFileStore.mjs'

function text(value) {
  return String(value ?? '')
}

export const DEDUCE_DIR = '.openstory/deduce'

/** 推演会话文件路径（库内，不碰 .pinax）。 */
export function deduceStatePath(root, bookId) {
  const safe = text(bookId).replace(/[^\w-]/gu, '_').slice(0, 64) || 'default'
  return join(root, DEDUCE_DIR, `${safe}.json`)
}

/** 读库内拆解条目（fact 通道，与 /api/entries 同源）。 */
export function loadEntries(root) {
  const store = createFactFileStore({ root })
  const listed = store.list({ limit: 5000 })
  if (!listed.ok) return { ok: false, message: text(listed.error?.message || '条目读取失败') }
  return { ok: true, entries: listed.entries ?? [] }
}

function loadState(root, bookId) {
  const path = deduceStatePath(root, bookId)
  if (!existsSync(path)) return null
  try {
    return JSON.parse(readFileSync(path, 'utf-8'))
  } catch {
    return null
  }
}

async function saveState(root, bookId, state) {
  const path = deduceStatePath(root, bookId)
  await mkdir(dirname(path), { recursive: true })
  const tmp = `${path}.tmp-${Date.now()}`
  await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
  await rename(tmp, path)
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

export async function deducePresent({ root, bookId = 'default', pov = '', seed = null, reset = false, peek = false } = {}) {
  const loaded = loadEntries(root)
  if (!loaded.ok) return { ok: false, code: 'INVALID_ENTRY', message: loaded.message }
  const entries = loaded.entries
  if (!entries.length) {
    return { ok: false, code: 'INVALID_ENTRY', message: '这个库还没有拆解条目（worldview/角色/剧情），推演引擎需要事实包才能开局' }
  }
  let state = reset ? null : loadState(root, bookId)
  // peek（OS-60）：界面进入时只读当前局面，**不推进一拍**。
  if (peek) {
    if (!state) return { ok: false, code: 'NO_DEDUCE_SESSION', message: '这个库还没有推演会话' }
    const last = state.lastTurn || null
    return {
      ok: true,
      peek: true,
      bookId,
      round: state.round ?? 0,
      seed: state.seed ?? null,
      sceneCard: last?.sceneCard ?? null,
      candidates: Array.isArray(last?.candidates) ? last.candidates : [],
      tension: last?.tension ?? null,
      fronts: summarizeFronts(state.fronts),
      budget: { used: state.aiSpent ?? 0, max: state.budgetMax ?? 8 },
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
  let turn
  try {
    turn = await presentTurn({ state, entries, pov: pov || state.pov || null, seed: useSeed })
  } catch (error) {
    return { ok: false, code: text(error?.code || 'INVALID_ENTRY'), message: text(error?.message || error) }
  }
  // 存最后一面（OS-60）：进入推演页时 peek 回放这一面，不额外推进
  state.lastTurn = {
    sceneCard: turn.sceneCard ?? null,
    candidates: (turn.candidates ?? []).map((candidate, index) => ({
      id: text(candidate.id) ? `${text(candidate.id)}-${index}` : `c${index}`,
      source: text(candidate.source),
      text: text(candidate.text),
      refs: Array.isArray(candidate.refs) ? candidate.refs : [],
      trace: candidate.trace ?? null
    })),
    tension: turn.tension ?? null
  }
  await saveState(root, bookId, state)
  return {
    ok: true,
    bookId,
    round: state.round ?? 0,
    seed: useSeed,
    sceneCard: turn.sceneCard,
    candidates: (turn.candidates ?? []).map((candidate, index) => ({
      id: text(candidate.id) ? `${text(candidate.id)}-${index}` : `c${index}`,
      source: text(candidate.source),
      text: text(candidate.text),
      refs: Array.isArray(candidate.refs) ? candidate.refs : [],
      trace: candidate.trace ?? null
    })),
    tension: turn.tension ?? null,
    fronts: summarizeFronts(state.fronts),
    budget: { used: state.aiSpent ?? 0, max: state.budgetMax ?? 8 },
    // POV 候选（OS-54）：条目页签剔除后，角色名单由 present 响应直接带——
    // 前端 datalist 不再依赖 /api/entries 侧通道
    characters: entries
      .filter((entry) => text(entry?.layer).trim().toLowerCase() === 'character')
      .map((entry) => text(entry?.name).trim())
      .filter(Boolean)
  }
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
export async function deduceSettle({ root, bookId = 'default', candidateId = '', action = 'choose', note = '' } = {}) {
  const state = loadState(root, bookId)
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
  await saveState(root, bookId, state)
  return { ok: true, action, result: settled ?? null, round: state.round ?? 0 }
}
