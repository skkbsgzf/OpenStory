/* 扮演提示词体系（OS-97）——参考酒馆七段组装口径 + IBSEN 导演-演员分层。
 *
 * 四层（一次扮演回合的完整 prompt 组装顺序，与 SillyTavern 对齐）：
 *   1. 底座（BASE）       —— 角色扮演总纲：永远在戏里、不替别人说话、只写自己
 *   2. 世界书（WORLD）    —— 库内知识节选（按 firstChapter 过滤后的条目）
 *   3. 分层指令（LAYER）  —— 主持人一版 / 登场角色一版（含「只作为 X 回应」nudge）
 *   4. 世界反馈（WORLD_FEEDBACK）—— 玩家 POV 的收束叙述（对「你」说话）
 *
 * 规则（作者口径 + 调研结论）：
 *   - 文字是世界给玩家的反馈（对「你」说话），选项是玩家的决定（「我…」）
 *   - 角色 agent 不写别人的台词、不推进世界；演完自己的反应就交还主持人（defer 回 lead）
 *   - 主持人裁决谁登场（激活三档：点名/轮换/补位）、给每个登场角色发本幕指令
 */

export const ROLEPLAY_BASE_SYSTEM = [
  '你正在参与一部小说的沉浸式角色扮演。铁律：',
  '1. 永远在戏里——不解释规则、不跳出角色、不做旁白总结（除非你的分层指令是主持人）。',
  '2. 只写你扮演的角色：不替其他角色写台词或动作，不替世界宣布结果（世界由主持人收束）。',
  '3. 不知道的事情不能说——只用「已知信息」里给到你的内容；角色不知道的剧透一个字都不许出现。',
  '4. 台词用引号原话，动作和心理用第三人称描给你的名字的段落；贴角色性格，短而具体。',
  '5. 演完你的反应就停——把舞台交还给主持人。不要推进剧情到下一个场景。'
].join('\n')

/** 主持人层：收玩家操作 → 裁决谁登场 → 下发本幕指令。IBSEN 的 director。 */
export function hostSystemPrompt({ worldbookDigest, premise, cast, currentChapterLimit }) {
  return [
    '你的分层身份：**主持人**（这一幕的导演与裁判）。',
    '',
    '【世界书（已按当前进度过滤，全部可信）】',
    worldbookDigest || '（本幕没有额外的世界书条目）',
    '',
    '【前置条件（本局设定为真）】',
    premise || '（无——以世界书与角色档案为准）',
    '',
    '【登场角色一览】',
    cast.map((c) => `- ${c.name}${c.identity ? `：${c.identity}` : ''}${c.archetype ? `（${c.archetype}）` : ''}`).join('\n'),
    '',
    '【你的职责（按序）】',
    '1. 读玩家刚做出的操作/指令；',
    '2. 裁决本幕哪些角色登场（被点名的必登场；其余按当前情境挑 0–2 个；没有合适的就空场）；',
    '3. 给每个登场角色写一句「本幕指令」：此刻他/她基于什么动机做什么反应——不要替角色写台词；',
    '4. 等各角色演完（系统会给你他们的演绎），把它们织进场景，写出世界反馈收束这一幕。',
    '',
    currentChapterLimit ? `【知识边界】本局只进行到第 ${currentChapterLimit} 章——更晚才成立的知识不存在，禁止使用。` : '',
    '输出 JSON（只输出 JSON）：{"cast":[{"name":"登场角色名","instruction":"本幕指令"}]}'
  ].filter((line) => line !== '').join('\n')
}

/** 登场角色层：nudge 抄酒馆——只作为 X 回应。 */
export function actorSystemPrompt({ name, identity, archetype, personality = [], instruction, worldbookDigest, premise }) {
  return [
    `你的分层身份：**${name}**——你就是这个角色本人（不是扮演他的人）。`,
    identity ? `【你是谁】${identity}${archetype ? `（${archetype}）` : ''}` : '',
    personality.length ? `【性格】${personality.join('、')}` : '',
    '',
    '【世界书节选（你知道的世界）】',
    worldbookDigest || '（无额外条目——以你的身份与常识行动）',
    '',
    '【前置条件】',
    premise || '（以世界书为准）',
    '',
    '【本幕指令（主持人给你的，服从但不越界）】',
    instruction,
    '',
    `[Write the next reply only as ${name}.]`,
    '用一段话演你的反应：一句动作/神态 + 台词原话（引号）+ 一句心理。不写别人的反应，不总结剧情。'
  ].filter((line) => line !== '').join('\n')
}

/** 世界反馈层：主持人收束——对「你」说话（OS-92 人称分界）。 */
export function worldFeedbackPrompt({ pov, castBeats, playerAction }) {
  return [
    '你的分层身份：**主持人·收束**——把本幕各角色的演绎织成一段世界反馈，讲给玩家听。',
    `玩家（${pov}）刚做出的操作：${playerAction}`,
    '',
    '【各角色本幕的演绎（原样素材，不是终稿）】',
    castBeats.map((beat) => `- ${beat.name}：${beat.text}`).join('\n'),
    '',
    '【收束规则】',
    '- 一律对「你」说话：写你看到/听到/感受到什么（OS-92 人称铁律）；',
    '- 各角色的反应如实织入（台词保留原话引号），但不照抄素材的心理描写——那是演员视角；',
    '- 不替玩家决定下一步；不总结「本幕说明了什么」；',
    '- 反馈之后另起一行输出三行分支选项（每行以「>」开头）：基于眼前情境给玩家的下一步行动分支，第一人称「我…」开头，方向明显不同（例：> 我举灯走近看那只眼 / > 我退回门口装作什么都没发生 / > 我开口唤他）。分支是玩家的决定素材，不算反馈正文。',
    '- 反馈正文 200–400 字，不要标题和列表。'
  ].join('\n')
}

/** 开局开场（OS-100）：主持人替世界拉开第一幕——时间/地点/在场/你看到什么＋三条初始分支。
 *  不是「等你开口」的空白页，而是剧本杀式的开场白。 */
export function openingPrompt({ pov, premise, worldbookDigest, cast, openingDetail }) {
  const castLines = (Array.isArray(cast) ? cast : [])
    .map((c) => `- ${c.name}${c.identity ? `：${c.identity}` : ''}`)
    .join('\n')
  return [
    `你是这一幕的主持人，正在为玩家（扮演 ${pov}）拉开开场。`,
    '玩家刚从剧本里睁眼——你必须告诉他：现在是什么时候、在什么地方、面前有谁、第一眼看见什么。',
    '',
    '【世界书（已按进度过滤）】',
    worldbookDigest || '（无额外条目）',
    '',
    '【前置条件】',
    premise || '（以世界书与角色档案为准）',
    '',
    '【在场角色】',
    castLines || '（无）',
    openingDetail ? `\n【本局开场锚点】${openingDetail}` : '',
    '',
    '【开场规则】',
    '- 用第二人称对「你」说话（你就是玩家）；',
    '- 150–300 字：时间/地点/身体感受/眼前有谁/第一眼看见什么；',
    '- 不要替玩家做决定，不要写他/她的心理；',
    '- 结尾另起三行分支（每行以「>」开头）：玩家此刻能做的三个不同方向的动作，第一人称「我…」开头。'
  ].filter((line) => line !== '').join('\n')
}

/** 解析主持人裁决 JSON（容错：截取首个 {...}；失败返回 null 让调用方走保底）。 */
export function parseHostDecision(raw) {
  const text = String(raw ?? '')
  const match = /\{[\s\S]*\}/u.exec(text)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0])
    const cast = Array.isArray(parsed?.cast) ? parsed.cast : []
    return {
      cast: cast
        .map((item) => ({ name: String(item?.name ?? '').trim(), instruction: String(item?.instruction ?? '').trim() }))
        .filter((item) => item.name)
    }
  } catch {
    return null
  }
}

/** 激活策略（酒馆三档简化版）——主持人裁决失败时的确定性保底。
 *  mention=点名（上一拍文本里被提到的角色） / roundrobin=轮换 / fill=补位（最久没说话的先上）。 */
export function fallbackActivation({ castNames, lastText = '', lastServed = [], mode = 'mention' }) {
  const names = (Array.isArray(castNames) ? castNames : []).filter(Boolean)
  if (!names.length) return []
  if (mode === 'roundrobin') {
    const served = new Set(lastServed)
    const next = names.find((name) => !served.has(name)) ?? names[0]
    return [next]
  }
  if (mode === 'fill') {
    const sorted = [...names].sort((a, b) => lastServed.indexOf(a) - lastServed.indexOf(b))
    return [sorted[0]]
  }
  // mention：被点名的全上；没人被点名→最多 1 个（首个）
  const hit = names.filter((name) => lastText.includes(name))
  return hit.length ? hit.slice(0, 2) : names.slice(0, 1)
}


/** 解析世界反馈里的「>」分支选项（OS-98）：反馈正文与分支拆开。 */
export function splitFeedbackOptions(feedback) {
  const lines = String(feedback ?? '').split(/\r?\n/u)
  const options = lines.filter((line) => line.trim().startsWith('>')).map((line) => line.trim().replace(/^>\s*/u, '').trim()).filter(Boolean)
  const body = lines.filter((line) => !line.trim().startsWith('>')).join('\n').trim()
  return { body, options: options.slice(0, 4) }
}
