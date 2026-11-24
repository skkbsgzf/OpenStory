/**
 * 扮演工作面纯 HTML 构造函数（OS-164，G5c）——从 app.js 迁出的纯函数。
 *
 * 硬约束（与 scriptViews.mjs / referenceViews.mjs 同门风）：
 *   · 纯函数：入参进、HTML 字符串出；不读全局 state、不碰 DOM、不写存储、不 import 任何模块；
 *   · 打字机、定时器、滚动跟随、会话状态机（deduceEngineHtml / mountDeduceTree / engine* 流程）
 *     一律留在 app.js——它们不是「纯 HTML 构造」。
 *
 * 金样与纯度测试：test/deduceViews.test.mjs。
 */

/** 剧情树选中节点提示（OS-61 P3）。 */
export function deduceTreePickHtml({ engine = {}, esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const node = (engine.session?.nodes || []).find((item) => item.id === engine.treePick)
  if (!node) return ''
  const branchLabel = (node.branchId || 'main') === 'main' ? '主线' : node.branchId
  return `<span class="ded-tree-pick-label">选中：第 ${Number(node.round) || 0} 拍 · ${html(branchLabel)}</span>
    <button class="btn-primary" data-action="deduce-tree-back"${engine.turnBusy ? ' disabled' : ''} title="切到这一拍所在的分支与拍号，回「当前局面」继续">回到这一拍</button>
    <button class="btn-ghost" data-action="deduce-tree-branch"${engine.turnBusy ? ' disabled' : ''} title="以这一拍为分叉点开一条新分支，下一拍走新路">从这拍开新分支</button>`
}

/** 剧情树视图：整宽画布＋右上选中提示。 */
export function deduceTreeHtml({ engine = {}, esc, flowError, pickHtml = '' } = {}) {
  const nodes = engine.session?.nodes || []
  const branchCount = new Set(nodes.map((node) => node.branchId || 'main')).size
  return `${flowError ? flowError(engine.error || '') : ''}
    <div class="ded-tree-wrap">
      <div class="ded-tree-bar">
        <span class="ded-buffer-stat">共 ${nodes.length} 拍 · ${branchCount} 条分支</span>
        <span class="sub">横轴＝拍号，纵轴＝分支 · 点节点选中，空白拖动平移，滚轮缩放</span>
      </div>
      <div class="ded-tree-host" id="deduce-tree-host"></div>
      <div class="ded-tree-pick" id="deduce-tree-pick"${engine.treePick ? '' : ' hidden'}>${pickHtml}</div>
    </div>`
}

/** 事实包健康度（OS-60）：如实告诉作者缺什么，而不是让他对着检定单发呆。 */
export function dedPackHtml({ data = {}, esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const who = Array.isArray(data.sceneCard?.who) ? data.sceneCard.who.filter(Boolean).length : 0
  const where = data.sceneCard?.where && data.sceneCard.where !== '未标记地点'
  const hook = data.sceneCard?.hook && data.sceneCard.hook !== '……'
  const fronts = Array.isArray(data.fronts) ? data.fronts.length : 0
  const sources = new Set((data.candidates || []).map((candidate) => candidate.source))
  const rich = sources.has('必然') || sources.has('戏剧')
  const items = [
    { ok: who >= 2, label: '在场角色', hint: who >= 2 ? `${who} 人` : '太少——补 character 条目' },
    { ok: Boolean(where), label: '地点', hint: where ? '已标' : '世界书里还没有他知道的地点' },
    { ok: Boolean(hook), label: '挂起伏笔', hint: hook ? '有' : '没有悬着的伏笔，扮演张力会平' },
    { ok: fronts > 0, label: '前线时钟', hint: fronts ? `${fronts} 条在走` : '没有前线——威胁不会被推着走' },
    { ok: rich, label: '候选来源', hint: rich ? [...sources].join('／') : '只有命运骰——补条目才会出「必然」' }
  ]
  return `<section class="ded-card ded-pack">
      <div class="ded-card-head"><h3>世界底账</h3><span class="sub">扮演的根基在这份拆解里</span></div>
      ${items.map((item) => `<div class="ded-pack-row ${item.ok ? 'ok' : 'gap'}">
        <span class="ded-pack-ic">${item.ok ? '✓' : '○'}</span>
        <span class="ded-pack-label">${html(item.label)}</span>
        <span class="ded-pack-hint">${html(item.hint)}</span>
      </div>`).join('')}
    </section>`
}

/** 序章消息：◆ 你是谁 / 眼前场景 默认展开，前情提要默认收起。 */
export function deducePrologueHtml({ narrative = {}, recapOpen = false, esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const id = narrative.identity || null
  const idLine = !id
    ? '<p class="fl-line is-missing">还没选定视角人物——设置里填「以谁的眼睛看」，这里会显示你的身份与目标。</p>'
    : id.missing
      ? `<p class="fl-line">你扮演 <b>${html(id.name)}</b>。<span class="is-missing">这个角色还没有档案（去世界书写一条，或跑 enrich 生成人物档）。</span></p>`
      : `<p class="fl-line">你扮演 <b>${html(id.name)}</b>${id.archetype ? `<span class="fl-arch">${html(id.archetype)}</span>` : ''}${id.identity ? `，${html(id.identity)}` : ''}。</p>
        ${id.goal ? `<p class="fl-goal">你要 ${html(id.goal)}</p>` : ''}
        <p class="fl-line is-missing fl-role-hint">下面的选项都是你（${html(id.name)}）能做的事；别人（场景里其他角色）会自己行动，世界也会回应。</p>
        ${id.personality && id.personality.length ? `<p class="fl-chips-row">${id.personality.map((p) => `<span class="fl-chip">${html(p)}</span>`).join('')}</p>` : ''}`
  const sc = narrative.scene || { text: '', others: [], where: '' }
  const othersInline = (sc.others || []).map((o) => `<b>${html(o.name)}</b>`).join('、')
  const sceneLine = `${sc.text ? `<p class="fl-line fl-scene">${html(sc.text)}</p>` : ''}
    ${othersInline ? `<p class="fl-line">你面前：${othersInline}。</p>` : ''}
    ${!sc.where ? '<p class="fl-line is-missing">地点未标注——在世界书里给这个场景补一条地点条目，这里会说明你在哪。</p>' : ''}`
  const rc = narrative.recap || { story: '', soFar: [], recent: [] }
  const recapRows = []
  if (rc.story) recapRows.push(`<p class="fl-line fl-story">${html(rc.story)}</p>`)
  if (rc.soFar && rc.soFar.length) {
    recapRows.push(`<div class="fl-sofar">${rc.soFar.map((c) => `<div class="fl-sofar-row"><b>第${c.chapter}章${c.title ? ` ${html(c.title)}` : ''}</b><span>${html(c.summary)}</span></div>`).join('')}</div>`)
  }
  if (rc.recent && rc.recent.length) {
    recapRows.push(`<div class="fl-recent">${rc.recent.map((r) => `<div class="fl-recent-row"><span class="fl-rn-inline">第${r.round}拍</span>${html(r.excerpt)}…</div>`).join('')}</div>`)
  }
  const missingNote = narrative.missing && narrative.missing.length
    ? `<div class="fl-missing-note">缺：${narrative.missing.map((m) => ({ pov: '视角人物', 'character-profile': '角色档案', location: '地点', recap: '前情' }[m] || m)).join(' · ')}</div>`
    : ''
  return `<section class="fl-msg fl-msg-prologue">
    <span class="fl-rn">序章</span>
    <div class="fl-prose">
      <div class="fl-prologue-head"><span class="fl-prologue-mark">◆</span>序章</div>
      ${idLine}
      ${sceneLine}
      <button class="fl-recap-toggle" data-action="gg-toggle" data-gg-key="recap" aria-expanded="${recapOpen ? 'true' : 'false'}">${recapOpen ? '▾ 收起前情提要' : '▸ 前情提要'}</button>
      ${recapOpen ? `<div class="fl-recap-body">${recapRows.join('') || '<p class="fl-line is-missing">这本书还没有摘要——跑 enrich 后这里会显示整本书讲了什么。</p>'}</div>` : ''}
      ${missingNote}
    </div>
  </section>`
}

/** 命运回合行的人话文案（OS-88）：历史拍没 trace，从文本拆骰点翻人话。 */
export function fateHumanFromLegacy(chosen, { text } = {}) {
  const asText = text ?? ((value) => String(value ?? ''))
  const m = /^剧情检定 2d6=(\d+)\+(\d+)=(\d+)：(顺遂|受阻)$/u.exec(asText(chosen?.text || ''))
  if (!m) return ''
  const a = Number(m[1]); const b = Number(m[2]); const sum = Number(m[3])
  const success = m[4] === '顺遂'
  return success
    ? `世界不拦你——事情按眼下最自然的走向推进（命运骰 ${sum}：${a}+${b} 顺遂）`
    : `世界设了坎——这一步会受阻，有代价要收拾（命运骰 ${sum}：${a}+${b} 受阻）`
}

/** 你的回合：这一拍选了哪条候选（history 回放同源）。 */
export function deduceTurnLineHtml(node, { esc, text, fateHuman } = {}) {
  const chosen = (node.candidates || []).find((candidate) => candidate.id === node.choiceId)
  if (!node.choiceId || !chosen) return ''
  const human = fateHuman ?? ((item) => fateHumanFromLegacy(item, { text }))
  const chosenText = chosen.source === '命运' ? (human(chosen) || chosen.text) : chosen.text
  const html = esc ?? ((value) => String(value ?? ''))
  return `<div class="fl-you"><span class="fl-you-text">${html(chosenText)}</span></div>`
}

/** 待确认事实卡（OS-82）：写进拆解前的最后一道闸。 */
export function deducePendingFactHtml(item, { esc, text } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const asText = text ?? ((value) => String(value ?? ''))
  const entry = item?.entry ?? {}
  const decidedBy = asText(item?.decidedBy)
  const decidedLabel = decidedBy === 'author' ? '作者裁定' : decidedBy === 'fate' ? '命运之笔' : decidedBy || '推演产出'
  return `<section class="fl-msg ded-factcard" data-pending-id="${html(asText(item?.id))}">
    <div class="ded-factcard-head">
      <span class="ded-factcard-badge">事实待确认</span>
      <span class="ded-factcard-meta">${html(asText(entry.layer || 'plot'))} · 第 ${Number(item?.round) || 0} 拍 · ${html(decidedLabel)}</span>
    </div>
    <p class="ded-factcard-name">${html(asText(entry.name))}</p>
    <p class="ded-factcard-def">${html(asText(entry.definition))}</p>
    <div class="ded-factcard-ops">
      <button class="fl-btn is-primary" data-action="deduce-pending-write" data-id="${html(asText(item?.id))}" title="写入库内拆解文件（单条追加，不动其他条目）">写入拆解</button>
      <button class="fl-btn" data-action="deduce-pending-dismiss" data-id="${html(asText(item?.id))}" title="不落库，把这张卡移出队列">忽略</button>
    </div>
  </section>`
}

/** 本拍正文：历史拍静态纸卡；最新一拍带打字机槽（打字机本体留 app.js）。 */
export function deduceProseMsgHtml(node, live, { engine = {}, esc, text } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const asText = text ?? ((value) => String(value ?? ''))
  const round = Number(node.round) || 0
  if (!live) {
    const prose = asText(node.prose).trim()
    const beatsHtml = (Array.isArray(node.beats) ? node.beats : []).map((beat) => `<div class="fl-beat"><span class="fl-beat-name">${html(beat.name)}</span><span class="fl-beat-text">${html(beat.text)}</span></div>`).join('')
    return `<section class="fl-msg">
      <span class="fl-rn">第 ${round} 拍</span>
      <div class="fl-prose"><p class="fl-text${prose ? '' : ' is-empty'}">${prose ? html(prose) : '（这一拍没有正文）'}</p></div>
      ${beatsHtml}
    </section>`
  }
  const draft = engine.draft
  const editing = engine.draftEdit === true
  const head = `<span class="fl-rn">第 ${round} 拍${draft?.prose ? ` · ${asText(draft.prose).length} 字` : ''}</span>`
  const proseError = draft?.proseError ? `<div class="warn-box">${html(draft.proseError)}——可以直接改，或点「↻ 重写」。</div>` : ''
  if (editing) {
    return `<section class="fl-msg is-live">
      ${head}
      <div class="fl-prose">
        ${proseError}
        <textarea class="fl-draft-input" id="deduce-draft" placeholder="这一拍的正文草稿（200–400 字）">${html(draft.prose)}</textarea>
        <div class="fl-actions">
          <span class="fl-actions-note" id="deduce-draft-chars">${asText(draft.prose).length} 字 · 失焦自动保存</span>
          <button class="fl-btn is-primary" data-action="deduce-engine-next"${engine.turnBusy || engine.busy ? ' disabled' : ''} title="收下这一拍进本章缓冲，推新的局面">下一拍 →</button>
          <button class="fl-btn" data-action="deduce-engine-regen"${engine.turnBusy ? ' disabled' : ''} title="让模型重写这一拍的正文（覆盖草稿）">${engine.turnBusy ? '成文中…' : '↻ 重写'}</button>
          <button class="fl-btn" data-action="deduce-promote-flow" title="把这一拍正文写进 正文/ 成正式章节（自动下一章号）">⇪ 转正</button>
          <button class="fl-btn" data-action="deduce-draft-edit" title="收起编辑器，回到展示">✓ 收起</button>
        </div>
      </div>
    </section>`
  }
  const stageText = asText(draft.prose).trim()
    ? asText(draft.prose)
    : '（这一拍还没有正文——点「✎ 编辑」自己写，或点「↻ 重写」让模型出稿。）'
  return `<section class="fl-msg is-live">
    ${head}
    <div class="fl-prose">
      ${proseError}
      <div class="fl-text-body" data-action="deduce-tw-skip" title="点一下立即全显">
        <span class="fl-text" id="deduce-dialog-text" data-stage-text="${html(stageText)}"></span><span class="fl-caret" id="deduce-dialog-caret">▍</span>
      </div>
      <div class="fl-actions">
        <span class="fl-actions-note">进本章缓冲 · 「下一拍」后可继续写</span>
        <button class="fl-btn is-primary" data-action="deduce-engine-next"${engine.turnBusy || engine.busy ? ' disabled' : ''} title="收下这一拍进本章缓冲，推新的局面">下一拍 →</button>
        <button class="fl-btn" data-action="deduce-engine-regen"${engine.turnBusy ? ' disabled' : ''} title="让模型重写这一拍的正文（覆盖草稿）">${engine.turnBusy ? '成文中…' : '↻ 重写'}</button>
        <button class="fl-btn" data-action="deduce-draft-edit" title="就地编辑这一拍的正文草稿">✎ 编辑</button>
      </div>
    </div>
  </section>`
}

/** 在场小头像（立绘有图用图，没有用首字色块）。 */
export function deduceWhoChipsHtml(who, { assets = {}, dedAssetUrl, esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const names = Array.isArray(who) ? who : []
  if (!names.length) return '<span class="fl-who-none">这一拍无人在场</span>'
  const characters = Array.isArray(assets.characters) ? assets.characters : []
  return names.map((name) => {
    const asset = characters.find((item) => item.name === name)
    const hue = [...name].reduce((sum, char) => sum + char.codePointAt(0), 0) % 360
    return `<span class="fl-who" title="${html(name)}">
      ${asset && dedAssetUrl
        ? `<img src="${dedAssetUrl(asset)}" alt="${html(name)}">`
        : `<i style="background:hsl(${hue} 42% 84%);color:hsl(${hue} 45% 30%)">${html(name.slice(0, 1))}</i>`}
      ${html(name)}
    </span>`
  }).join('')
}

/** 待决回合：流末候选（必然/戏剧/眼前）＋否决。候选为空时从局面推三条确定性分支。 */
export function deducePendingHtml(data, { engine = {}, esc, text, whoChipsHtml } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const asText = text ?? ((value) => String(value ?? ''))
  const card = data.sceneCard ?? {}
  // OS-91：命运是世界的暗手，不进玩家选项
  let candidates = (Array.isArray(data.candidates) ? data.candidates : []).filter((candidate) => candidate.source !== '命运')
  // OS-101：who/where 必须先算——空候选兜底要用（OS-164 修掉原先后置声明导致的 TDZ）
  const who = Array.isArray(card.who) ? card.who.filter(Boolean) : []
  const where = card.where && card.where !== '未标记地点' ? asText(card.where) : '地点未标'
  if (candidates.length === 0) {
    const others = who.filter((name) => asText(name) && asText(name) !== asText(data.pov))
    const place = where !== '地点未标' ? where : ''
    candidates = [
      ...(others.length ? [{ id: 'fallback-talk', source: '眼前', text: `我开口对${others[0]}说点什么，先探探他/她的反应`, refs: [others[0]] }] : []),
      { id: 'fallback-look', source: '眼前', text: place ? `我在${place}里再仔细看一圈，找刚才漏掉的细节` : '我把眼前的东西一件件看过去，找刚才漏掉的细节', refs: [] },
      { id: 'fallback-wait', source: '眼前', text: '我停在原地不动，等对方先开口或先动', refs: [] }
    ].slice(0, 3)
  }
  const hook = card.hook && card.hook !== '……' ? asText(card.hook).split(asText(data.pov)).join('你') : ''
  const sourceNote = { 必然: '世界规矩', 戏剧: '另一种可能', 眼前: '从这个局面直接走' }
  const describeCandidate = (candidate) => {
    if (candidate.source === '必然') {
      const fact = asText(candidate.text).replace(/^剧情检定[^：]*：/u, '').trim()
      return { title: fact || '按世界的规矩来', sub: '从世界事实推出来的——不这么做也会发生', roll: '' }
    }
    return { title: asText(candidate.text) || '（空候选）', sub: hook ? `牵动：${hook}` : '', roll: '' }
  }
  const optRows = candidates.map((candidate) => {
    const kind = { 必然: 'certain', 命运: 'fate', 戏剧: 'drama', 眼前: 'scene' }[candidate.source] || 'other'
    const info = describeCandidate(candidate)
    return `<div class="ded-opt-row src-${kind}">
      <button class="ded-opt" data-action="deduce-engine-choose" data-candidate-id="${html(candidate.id)}"${engine.turnBusy ? ' disabled' : ''}>
        <span class="ded-opt-head"><span class="ded-badge">${html(candidate.source || '候选')}</span><span class="ded-cand-note">${html(sourceNote[candidate.source] || '')}</span></span>
        <span class="ded-opt-title">${html(info.title)}</span>
        ${info.sub ? `<span class="ded-opt-sub">${html(info.sub)}</span>` : ''}
      </button>
      <button class="ded-opt-veto" data-action="deduce-engine-veto" data-candidate-id="${html(candidate.id)}" title="只记账，不落库">否决</button>
    </div>`
  }).join('')
  const busyNote = engine.busy
    ? '<div class="fl-typing">推演中——正在摆局面…</div>'
    : (engine.turnBusy ? '<div class="fl-typing">成文中——这一拍正在落字…</div>' : '')
  const chips = whoChipsHtml ? whoChipsHtml(who.filter((name) => name !== data.pov)) : ''
  return `<section class="fl-pending">
    <div class="fl-pending-scene">
      <span class="fl-pending-rn">第 ${Number(data.round) || 0} 拍</span>
      <span class="fl-pending-where">${html(where)}</span>
      ${chips}
    </div>
    <p class="fl-prompt">轮到你了——选一条走向，或在下面说你自己的动作</p>
    ${busyNote}
    ${optRows || (engine.busy || engine.turnBusy ? '' : '<p class="fl-no-cand">这一拍没有候选——事实包不够（世界观／角色／剧情条目太少）或预算用尽。点下方自己写一拍，或去设置里重掷。</p>')}
  </section>`
}

/** 已知信息牌（OS-91）：剧本杀式左栏，全部来自 present 的叙事上下文。 */
export function deduceSideHtml(data, { esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const n = data?.narrative
  if (!n) return ''
  const id = n.identity || null
  const sc = n.scene || { others: [], where: '', text: '', tension: '' }
  const rc = n.recap || {}
  const sec = (title, body) => body ? `<section class="ds-sec"><h4>${title}</h4>${body}</section>` : ''
  const whoYouAre = !id
    ? '<p class="ds-empty">还没选定视角——⚙ 设置里选「以谁的眼睛看」</p>'
    : `<p class="ds-name">${html(id.name)}${id.archetype ? `<i>${html(id.archetype)}</i>` : ''}<button class="ds-edit" data-action="roleplay-edit-card" data-name="${html(id.name)}" title="编辑这个角色的档案（写回库内世界书）">✎</button></p>
      ${id.identity ? `<p class="ds-line">${html(id.identity)}</p>` : ''}
      ${id.goal ? `<p class="ds-goal">你要 ${html(id.goal)}</p>` : ''}
      ${id.personality && id.personality.length ? `<p class="ds-tags">${id.personality.map((p) => `<span>${html(p)}</span>`).join('')}</p>` : ''}`
  const others = Array.isArray(sc.others) ? sc.others : []
  const beforeYou = others.length
    ? others.map((o) => `<div class="ds-person"><b>${html(o.name)}</b>${o.identity ? `<span>${html(o.identity)}</span>` : ''}${o.archetype ? `<i>${html(o.archetype)}</i>` : ''}</div>`).join('')
    : '<p class="ds-empty">眼前没有别人——只有你和这个地方</p>'
  const whereSec = `<p class="ds-line">${sc.text ? html(sc.text) : (sc.where ? `你在${html(sc.where)}。` : '还没人知道这里是什么地方——去世界书补一条地点条目。')}</p>
      ${sc.tension ? `<p class="ds-tension">气氛：${html(sc.tension)}</p>` : ''}`
  const past = (Array.isArray(rc.recent) ? rc.recent : []).map((r) => `<div class="ds-mem"><span>第${r.round}拍</span>${html(r.excerpt)}…</div>`).join('')
  const pastSec = `${rc.story ? `<p class="ds-line ds-story">${html(rc.story)}</p>` : ''}${past}`
  const fronts = Array.isArray(data?.fronts) ? data.fronts : []
  const frontsSec = fronts.map((f) => {
    const filled = Number(f.filled) || 0
    const max = Number(f.max) || 0
    const pct = max ? Math.round((filled / max) * 100) : 0
    return `<div class="ds-front"><div class="ds-front-row"><span>${html(f.name || f.id || '前线')}</span><span>${filled}/${max}</span></div><div class="ds-front-bar"><i style="width:${pct}%"></i></div></div>`
  }).join('')
  return [
    sec('你扮演', whoYouAre),
    sec('在你面前', beforeYou),
    sec('这里', whereSec),
    sec('你经历过的', pastSec),
    sec('世界的暗流', frontsSec)
  ].join('')
}

/** Agent 分支推演表单（与引擎分支同一页壳）。 */
export function deduceAgentHtml({ deduce = {}, configured = false, esc, flowError } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  return `${flowError ? flowError(deduce.error) : ''}
    <div class="deduce-grid">
      <div class="step">
        <h3><span class="no">1</span>前提（设定为真）</h3>
        <textarea class="deduce-input" id="deduce-premise" placeholder="目前故事走到哪、哪些设定是铁的…">${html(deduce.premise)}</textarea>
        <h3><span class="no">2</span>变量（每行一个可能拨动的开关）</h3>
        <textarea class="deduce-input" id="deduce-variables" placeholder="林砚知道真相&#10;大雾提前散了">${html(deduce.variables)}</textarea>
        <h3><span class="no">3</span>要推演的问题</h3>
        <input id="deduce-question" placeholder="如果林砚选择沉默，第 3 章会走向哪里？" value="${html(deduce.question)}">
        <div class="row">
          <button class="btn-primary" data-action="deduce-start"${deduce.streaming || !configured ? ' disabled' : ''}>${deduce.streaming ? '推演中…' : '开始推演'}</button>
          <button class="btn-ghost" data-action="deduce-stop"${deduce.streaming ? '' : ' hidden'}>停止</button>
          ${!configured ? '<span class="count">先在右上角设置里配好模型端点。</span>' : '<span class="count">Agent 分支推理；产出经待确认卡落正文。</span>'}
        </div>
      </div>
      <div class="step">
        <h3><span class="no">→</span>推演回答</h3>
        <div class="deduce-reply">${deduce.reply ? html(deduce.reply) : (deduce.streaming ? '推演中…' : '填好左边三段，点「开始推演」。回答可整段转成待确认卡，采纳后写进正文。')}</div>
        ${deduce.reply && !deduce.streaming ? '<div class="repair-actions"><button class="btn-primary" data-action="deduce-card">转为待确认卡（写正文）</button></div>' : ''}
      </div>
    </div>`
}
