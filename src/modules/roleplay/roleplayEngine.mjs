/* 扮演调度器（OS-97）——主持人 + N 登场角色的多子 agent 同幕扮演。
 *
 * 一回合的编排（chatComplete 由 daemon 注入——同一份全局文本模型上游）：
 *   1. host     主持人裁决：读玩家操作 → 本幕登场名单＋每人一句本幕指令（JSON）
 *      失败保底：fallbackActivation（点名/轮换/补位三档，确定性）
 *   2. actors   每个登场角色**独立一次** LLM 调用（酒馆群聊口径——各自 system、
 *      nudge「只作为 X 回应」），顺序执行，产出各自的演绎
 *   3. world    主持人收束：把各角色演绎织成对「你」说话的世界反馈
 *
 * 全程不落库——条目/会话/事件由调用方（daemon）按既有协议写。
 */
import { analyzeChapter } from '../../../public/analysis.mjs'
import {
  ROLEPLAY_BASE_SYSTEM,
  hostSystemPrompt,
  actorSystemPrompt,
  worldFeedbackPrompt,
  openingPrompt,
  summaryPrompt,
  parseHostDecision,
  splitFeedbackOptions,
  fallbackActivation
} from './roleplayPrompts.mjs'

const text = (value) => String(value ?? '')

/** 世界书摘要（给主持人/角色共用一份）：条目名＋一句定义，限 12 条。 */
export function worldbookDigestOf(entries, { limit = 12 } = {}) {
  const lines = (Array.isArray(entries) ? entries : [])
    .filter((entry) => text(entry?.name))
    .slice(0, limit)
    .map((entry) => `- ${text(entry.name)}：${text(entry.definition || entry.desc || '').slice(0, 60)}`)
  return lines.join('\n')
}

/**
 * 扮演一回合。
 * @param {object} opts
 * @param {(prompt: string, opts?: object) => Promise<string>} opts.chatComplete  文本模型调用（daemon 注入）
 * @param {Array} opts.entries       世界书/事实条目（已按 chapterLimit 过滤）
 * @param {string} opts.premise      前置条件（本局设定为真）
 * @param {Array<{name,identity,archetype,personality}>} opts.cast  可用角色卡（拆解 character 条目）
 * @param {string} opts.playerAction 玩家本回合的操作（选项文本或自由输入）
 * @param {string} opts.pov          玩家扮演谁（='主持人' 时玩家就是主持人本人）
 * @param {string} opts.recent       最近几拍的剧情摘要（给上下文）
 * @param {string} [opts.activation] 保底激活模式 mention/roundrobin/fill
 * @param {number|null} [opts.chapterLimit] 知识边界（第几章为止）
 * @returns {Promise<{ok:boolean, beats:Array<{name,instruction,text}>, feedback:string, error?:string}>}
 */
export async function roleplayTurn({
  chatComplete,
  entries = [],
  premise = '',
  cast = [],
  playerAction = '',
  pov = '',
  recent = '',
  activation = 'mention',
  chapterLimit = null
} = {}) {
  if (typeof chatComplete !== 'function') return { ok: false, beats: [], feedback: '', error: '模型不可用' }
  const worldbookDigest = worldbookDigestOf(entries)
  const castClean = (Array.isArray(cast) ? cast : []).filter((c) => text(c?.name))
  const castNames = castClean.map((c) => c.name)

  /* —— 1) 主持人裁决 —— */
  const hostPrompt = [
    ROLEPLAY_BASE_SYSTEM,
    '',
    hostSystemPrompt({ worldbookDigest, premise, cast: castClean, currentChapterLimit: chapterLimit }),
    '',
    recent ? `【前情（最近几拍）】\n${recent}` : '',
    '',
    `【玩家的操作】${playerAction || '（玩家没有具体动作——推进下一幕）'}`
  ].filter((line) => line !== '').join('\n')
  let decision = null
  try {
    decision = parseHostDecision(await chatComplete(hostPrompt, { maxTokens: 400 }))
  } catch { decision = null }
  if (!decision || !decision.cast.length) {
    // 保底：确定性激活——主持人缺席也要有戏
    decision = {
      cast: fallbackActivation({ castNames, lastText: playerAction, mode: activation })
        .map((name) => ({ name, instruction: `基于当前情境，${name}对玩家的操作做出贴合性格的即时反应` }))
    }
  }
  // 玩家扮演的角色不自己演自己（玩家已是它）；名字不在 cast 里的裁决项剔除
  const stage = decision.cast
    .filter((item) => castNames.includes(item.name) && item.name !== pov)

  /* —— 2) 各角色独立演绎（顺序执行；单个失败不炸整幕） —— */
  const beats = []
  for (const item of stage) {
    const card = castClean.find((c) => c.name === item.name) ?? { name: item.name }
    const actorPrompt = [
      ROLEPLAY_BASE_SYSTEM,
      '',
      actorSystemPrompt({
        name: item.name,
        identity: card.identity,
        archetype: card.archetype,
        personality: Array.isArray(card.personality) ? card.personality : [],
        instruction: item.instruction,
        worldbookDigest,
        premise
      }),
      '',
      recent ? `【前情（最近几拍）】\n${recent}` : '',
      '',
      `【玩家（${pov}）刚做出的操作】${playerAction || '（推进下一幕）'}`
    ].filter((line) => line !== '').join('\n')
    try {
      const played = text(await chatComplete(actorPrompt, { maxTokens: 500 })).trim()
      if (played) beats.push({ name: item.name, instruction: item.instruction, text: played })
    } catch { /* 这个角色这一幕哑火——主持人收束时如实少一个声音 */ }
  }

  /* —— 3) 主持人收束（对「你」说话） —— */
  let feedback = ''
  const worldPrompt = [
    ROLEPLAY_BASE_SYSTEM,
    '',
    worldFeedbackPrompt({ pov, castBeats: beats, playerAction: playerAction || '（推进下一幕）' }),
    '',
    recent ? `【前情（最近几拍）】\n${recent}` : '',
    '',
    worldbookDigest ? `【世界书节选（收束时保持一致）】\n${worldbookDigest}` : ''
  ].filter((line) => line !== '').join('\n')
  try {
    feedback = text(await chatComplete(worldPrompt, { maxTokens: 800 })).trim()
  } catch { feedback = '' }
  if (!feedback && !beats.length) {
    return { ok: false, beats: [], feedback: '', error: '模型不可用——本幕没有产出' }
  }
  // OS-98：反馈正文与情境分支拆开（分支是玩家的决定素材）
  const { body, options } = splitFeedbackOptions(feedback)
  return { ok: true, beats, feedback: body, options }
}


/**
 * 扮演开局（OS-100）：主持人替世界拉开第一幕——不摆引擎局面，也不是空白等玩家开口。
 * 返回 { ok, feedback, options }（无 beats——开场还没有角色演绎）。
 */
export async function roleplayOpening({
  chatComplete,
  entries = [],
  premise = '',
  cast = [],
  pov = '',
  openingDetail = '',
  chapterLimit = null
} = {}) {
  if (typeof chatComplete !== 'function') return { ok: false, feedback: '', options: [], error: '模型不可用' }
  const worldbookDigest = worldbookDigestOf(entries)
  const prompt = [
    ROLEPLAY_BASE_SYSTEM,
    '',
    openingPrompt({ pov, premise, worldbookDigest, cast, openingDetail }),
    chapterLimit ? `\n【知识边界】本局只进行到第 ${chapterLimit} 章——更晚才成立的知识不存在。` : ''
  ].filter((line) => line !== '').join('\n')
  let raw = ''
  try {
    raw = String(await chatComplete(prompt, { maxTokens: 700 })).trim()
  } catch {
    return { ok: false, feedback: '', options: [], error: '模型不可用——开场没有产出' }
  }
  if (!raw) return { ok: false, feedback: '', options: [], error: '模型返回为空' }
  const { body, options } = splitFeedbackOptions(raw)
  return { ok: true, feedback: body, options }
}


/** 组装扮演上下文记忆（OS-102）：滚动摘要（长期）＋最近 N 拍明细（短期）。
 *  取 3 拍明细：再往前的内容都在摘要里，避免上下文无限膨胀。 */
export function buildRoleplayMemory(session, { recentLimit = 3 } = {}) {
  const nodes = Array.isArray(session?.nodes) ? session.nodes : []
  const summary = session?.rollingSummary ?? null
  const covered = Number(summary?.coveredToRound) || 0
  // 摘要覆盖之外的拍才算"最近"。若没有摘要，取最后 N 拍。
  const freshNodes = covered > 0
    ? nodes.filter((node) => (Number(node?.round) || 0) > covered)
    : nodes
  const recent = freshNodes.slice(-Math.max(1, recentLimit))
  const recentText = recent.map((node) => {
    const chosen = (Array.isArray(node?.candidates) ? node.candidates : []).find((c) => String(c.id) === String(node.choiceId))
    const act = chosen ? `（你：${String(chosen.text ?? '').slice(0, 60)}）` : ''
    const beats = (Array.isArray(node?.beats) ? node.beats : []).map((b) => `[${b.name}] ${String(b.text ?? '').slice(0, 50)}`).join(' ')
    return `第${Number(node?.round) || 0}拍 ${act}${String(node?.prose ?? '').slice(0, 120)}${beats ? ' ' + beats : ''}`
  }).join('\n')
  return {
    summaryText: summary?.text ? `【长期记忆（此前剧情摘要，已发生的事实）】\n${summary.text}` : '',
    recentText: recentText ? `【最近几拍】\n${recentText}` : '',
    coveredToRound: covered,
    freshCount: freshNodes.length
  }
}

/** 是否该压缩（OS-102）：自上次摘要后又攒了 N 拍就压一次。 */
export function shouldSummarize(session, { every = 6 } = {}) {
  const covered = Number(session?.rollingSummary?.coveredToRound) || 0
  const nodes = Array.isArray(session?.nodes) ? session.nodes : []
  const fresh = nodes.filter((node) => (Number(node?.round) || 0) > covered)
  return fresh.length >= every
}

/**
 * 压缩一次（OS-102）：取 fresh 里最早的 N 拍，与旧摘要一起压成新摘要。
 * 返回 { ok, rollingSummary } 供调用方写回会话。
 */
export async function compressMemory({ chatComplete, session, batch = 6 } = {}) {
  const covered = Number(session?.rollingSummary?.coveredToRound) || 0
  const nodes = (Array.isArray(session?.nodes) ? session.nodes : [])
    .filter((node) => (Number(node?.round) || 0) > covered)
    .sort((a, b) => (Number(a.round) || 0) - (Number(b.round) || 0))
  if (nodes.length < batch) return { ok: false, reason: 'not-enough' }
  const slice = nodes.slice(0, batch)
  const coveredFrom = Number(slice[0]?.round) || 0
  const coveredTo = Number(slice[slice.length - 1]?.round) || 0
  let text = ''
  try {
    text = String(await chatComplete(summaryPrompt({
      prevSummary: session?.rollingSummary?.text ?? '',
      nodes: slice,
      coveredFrom,
      coveredTo
    }), { maxTokens: 600 })).trim()
  } catch {
    return { ok: false, reason: 'model-failed' }
  }
  if (!text) return { ok: false, reason: 'empty' }
  return {
    ok: true,
    rollingSummary: {
      text: text.slice(0, 4000),
      coveredToRound: coveredTo,
      updatedAt: new Date().toISOString()
    }
  }
}


/** AI 味过检（OS-102）：世界反馈落稿前跑 analysis.mjs 的四因子；
 *  总分超阈就用提示词重写一次（只改文风，不改事实）。失败则保留原稿。
 *  作者对 AI 味敏感——扮演成文不能绕过这道闸。
 *  OS-144：分析模块停用时由宿主传 enabled:false 跳过（停用＝不过闸），原文逐字返回。 */
export async function deAiPass({ chatComplete, prose, threshold = 45, enabled = true } = {}) {
  const text = String(prose ?? '').trim()
  if (!text || enabled === false) return { text, aiSmell: null, rewritten: false }
  let aiSmell = null
  try {
    aiSmell = analyzeChapter(text)?.aiSmell ?? null
  } catch { aiSmell = null }
  if (!aiSmell || Number(aiSmell.score ?? 0) < threshold) {
    return { text, aiSmell, rewritten: false }
  }
  // 超阈：带上命中的具体词重写——告诉模型"哪里像模板文"，而不是空泛地要求
  const hits = [
    ...(Array.isArray(aiSmell.cliches) ? aiSmell.cliches.slice(0, 6).map((h) => h.word ?? h.text ?? String(h)) : []),
    ...(Array.isArray(aiSmell.connectives) ? aiSmell.connectives.slice(0, 4).map((h) => h.word ?? h.text ?? String(h)) : [])
  ].filter(Boolean)
  const prompt = [
    '下面这段小说正文有模板化/AI 味，请改写一遍（保持所有事实、对话、动作、人物不变，只换文风）：',
    hits.length ? `要清掉的词：${hits.join('、')}` : '',
    '要求：句子长短错落；少用四字套话与连接词；用具体的感官细节替代抽象形容；',
    '对话保持原话；不要增加新情节；只输出改写后的正文。',
    '',
    '【原文】',
    text
  ].filter((line) => line !== '').join('\n')
  try {
    const rewritten = String(await chatComplete(prompt, { maxTokens: 900 })).trim()
    if (!rewritten) return { text, aiSmell, rewritten: false }
    // 改写后再测一次（只报告，不无限循环）
    let after = null
    try { after = analyzeChapter(rewritten)?.aiSmell ?? null } catch { after = null }
    return { text: rewritten, aiSmell: after ?? aiSmell, before: aiSmell, rewritten: true }
  } catch {
    return { text, aiSmell, rewritten: false }
  }
}
