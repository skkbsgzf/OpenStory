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
import {
  ROLEPLAY_BASE_SYSTEM,
  hostSystemPrompt,
  actorSystemPrompt,
  worldFeedbackPrompt,
  parseHostDecision,
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
  return { ok: true, beats, feedback }
}
