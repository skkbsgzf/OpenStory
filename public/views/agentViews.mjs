/** C6：从 public/app.js 逐字迁出的agentViews渲染面。副作用仍由 app.js 持有。 */
export function createAgentViews(scope) {
  const { state, agent, esc, text, formatAt, getTempSessionId, getTempMode, mdReady, mdModule, updateComposerState, updateAgentChip } = scope

function sessionTitle(session, index) {
  const raw = text(session.title).trim()
  const broken = !raw || raw.includes('\uFFFD') || /[\u0000-\u0008\u000B\u000C\u000E-\u001F]/u.test(raw)
  if (!broken) return { label: raw, broken: false }
  const at = text(session.createdAt)
  const stamp = at ? formatAt(at) : ''
  return { label: `会话${index !== undefined ? ` ${index + 1}` : ''}${stamp ? ` · ${stamp}` : ''}`, broken: true }
}

function sessionsHtml() {
  const pinnedId = getTempSessionId()
  const mode = getTempMode()
  // 模式切换（OS-39b）：fixed＝推荐默认，每次添加都切到固定会话；current＝跟当前会话走
  const modeSwitch = `<div class="sess-mode">
      <span class="sm-label">临时需求去哪</span>
      <button class="mode-opt${mode === 'fixed' ? ' on' : ''}" data-action="temp-mode" data-mode="fixed">固定会话（推荐）</button>
      <button class="mode-opt${mode === 'current' ? ' on' : ''}" data-action="temp-mode" data-mode="current">当前会话</button>
    </div>`
  const fixedName = agent.sessions.find((session) => session.id === pinnedId)?.title || '临时需求'
  const hint = mode === 'fixed'
    ? `<div class="sess-hint">润笔/添加到 Agent 都会切到「${esc(fixedName)}」发送，不打断你正在聊的这条；点行上的「设临」可换一条。</div>`
    : `<div class="sess-hint">临时需求会发到你当前打开的会话（不切换）。</div>`
  if (!agent.sessions.length) {
    return `${modeSwitch}${hint}<div class="empty">还没有会话。<br>发第一条消息就会自动建。</div>
      <div class="divider"></div>
      <button class="new" data-action="agent-new-session">＋新会话</button>`
  }
  const rows = agent.sessions.map((session, index) => {
    const title = sessionTitle(session, index)
    // 空会话不摆「0」——只有真聊过才标条数
    const meta = Number.isFinite(session.messageCount) && session.messageCount > 0 ? `${session.messageCount}` : ''
    const isTemp = mode === 'fixed' && session.id === getTempSessionId()
    return `<div class="sess${session.id === agent.sessionId ? ' on' : ''}" data-session-id="${esc(session.id)}" title="${esc(title.label)}${title.broken ? '（历史标题编码损坏，双击重命名）' : '（双击重命名）'}">
      <span class="tt">${esc(title.label)}</span>
      ${meta ? `<span class="meta">${meta} 条</span>` : ''}
      <button class="pin${isTemp ? ' on' : ''}" data-action="session-pin" data-session-id="${esc(session.id)}" title="${isTemp ? '临时需求固定走这条（点一下取消）' : '把这条设为默认临时会话（润笔/分析都走它）'}">${isTemp ? '临时' : '设临'}</button>
      <button class="x" data-session-del="${esc(session.id)}" title="删除会话">×</button>
    </div>`
  }).join('')
  return `${modeSwitch}${hint}${rows}<div class="divider"></div>
    <button class="new" data-action="agent-new-session" title="开始一段新对话">＋新会话</button>`
}

function renderAgentCurrent() {
  const host = document.getElementById('agent-current')
  if (!host) return
  if (!agent.sessionId) { host.innerHTML = ''; return }
  const index = agent.sessions.findIndex((session) => session.id === agent.sessionId)
  const session = agent.sessions[index]
  const title = session ? sessionTitle(session, index) : { label: '未落档的新会话', broken: false }
  host.innerHTML = `<span>当前</span><span class="tt${title.broken ? ' bad' : ''}">${esc(title.label)}</span>`
}

function renderKbChain() {
  const host = document.getElementById('agent-knowledge-chain')
  if (!host) return
  const genre = state.briefGenre?.name || ''
  const picks = state.agent.picksExplicit && state.agent.picks ? state.agent.picks : null
  if (!genre && !picks?.style && !(picks?.methods || []).length) { host.innerHTML = ''; return }
  const styleName = picks?.style || ''
  const methods = picks?.methods || []
  const flash = Date.now() - (state.agent.picksFlashAt || 0) < 1600
  const segs = []
  if (genre) segs.push(`<span class="knowledge-chip" title="题材（写进库简报）">${esc(genre)}</span>`)
  if (styleName) segs.push(`<span class="knowledge-chip style" title="主导文风（每轮注入）">${esc(styleName.replace(/^style-/, ''))}</span>`)
  if (methods.length) segs.push(`<span class="knowledge-chip" title="${esc(methods.join('、'))}">方法论 ×${methods.length}</span>`)
  host.innerHTML = `<button class="knowledge-chain${flash ? ' flash' : ''}" data-action="toggle-style-menu" title="点开调整知识链">知识链 ${segs.join('<i class="knowledge-sep">·</i>')}</button>`
}

function processBlockHtml(proc, { live = false } = {}) {
  if (!proc) return ''
  const tools = Array.isArray(proc.tools) ? proc.tools : []
  const segments = Array.isArray(proc.segments) && proc.segments.length
    ? proc.segments
    : (text(proc.thinking).trim() ? [{ type: 'think', text: text(proc.thinking), closed: true }] : [])
  if (!segments.length && !tools.length) return ''
  const sec = proc.elapsedMs ? (proc.elapsedMs / 1000).toFixed(1) : ''
  const toolCount = tools.length
  const metaParts = [sec ? `${sec}s` : '', toolCount ? `${toolCount} 次工具` : ''].filter(Boolean)
  const label = live ? '思考中' : '思考过程'
  // 序列化段与工具行：think 段有自己的位置；tools 按记录顺序穿插（近似发生顺序）
  const parts = []
  let toolIdx = 0
  const thinkSegs = segments.filter((seg) => seg.type === 'think')
  let thinkIdx = 0
  // 工具发生在「第几段思考之后」无法精确回放，按段数均匀插入
  for (const seg of segments) {
    if (seg.type === 'tool') { parts.push({ type: 'tool', tool: seg }); continue }
    thinkIdx += 1
    parts.push({ type: 'think', seg, index: thinkIdx })
  }
  // 工具行：没有段信息时统一排在思考后面
  if (toolCount && !parts.some((part) => part.type === 'tool')) {
    for (const tool of tools) parts.push({ type: 'tool', tool })
  }
  const thinkParts = parts.filter((part) => part.type === 'think')
  const lastThinkKey = thinkParts.length ? thinkParts[thinkParts.length - 1].seg.t : -1
  const body = parts.map((part) => {
    if (part.type === 'tool') return toolRowHtml(part.tool)
    const seg = part.seg
    const isLast = seg.t === lastThinkKey
    const open = live && isLast && !seg.closed
    const summaryText = seg.closed
      ? (seg.text.trim().split('\n')[0] || '思路').slice(0, 60) + (seg.text.trim().split('\n').length > 1 || seg.text.length > 60 ? '…' : '')
      : '正在想…'
    if (open) {
      return `<div class="proc-seg live"><div class="proc-seg-head"><i class="proc-dot"></i><span class="proc-seg-label">正在想</span></div><div class="proc-think">${esc(seg.text)}</div></div>`
    }
    return `<details class="proc-seg"><summary><span class="proc-seg-label">${esc(summaryText)}</span><span class="proc-seg-n">思路 ${part.index}</span><span class="proc-chev">›</span></summary><div class="proc-think">${esc(seg.text)}</div></details>`
  }).join('')
  return `<details class="proc-block${live ? ' live' : ''}"${live ? ' open' : ''}>
    <summary>
      <span class="proc-label"><i class="proc-dot"></i>${esc(label)}</span>
      ${metaParts.length ? `<span class="proc-meta">${esc(metaParts.join(' · '))}</span>` : ''}
      <span class="proc-chev">›</span>
    </summary>
    <div class="proc-body">${body}</div>
  </details>`
}

function toolMeta(name) {
  const raw = text(name)
  return TOOL_META[raw.toLowerCase()] || { icon: '●', note: raw || '工具' }
}

function toolRowHtml(tool) {
  const meta = toolMeta(tool.name)
  const verb = toolVerb(tool.name)
  const target = toolTarget(tool)
  const took = tool.elapsedMs ? `${(tool.elapsedMs / 1000).toFixed(1)}s` : ''
  const cls = tool.isError ? 'tool-row fail' : 'tool-row'
  // 工具行可点（OS-59）：点了就打开它读写的那份文件（读＝看内容，写＝跳到正文/世界书）
  const clickable = target && !tool.isError ? ` data-action="tool-open" data-tool-target="${esc(target)}" role="button" tabindex="0" title="打开 ${esc(target)}"` : ''
  return `<div class="${cls}${clickable ? ' clickable' : ''}"${clickable}>
    <span class="tool-icon" title="${esc(meta.note)}">${esc(meta.icon)}</span>
    <span class="tool-verb">${esc(verb)}</span>
    ${target ? `<code class="tool-target">${esc(target)}</code>` : ''}
    ${took ? `<span class="tool-took">${esc(took)}</span>` : ''}
    ${tool.isError ? '<span class="tool-fail">失败</span>' : ''}
  </div>`
}

function toolVerb(name) {
  const raw = text(name)
  const lower = raw.toLowerCase()
  if (lower === 'read' || lower === 'read_file') return '读取'
  if (lower === 'write' || lower === 'write_file' || lower === 'create_file') return '新建'
  if (lower === 'edit' || lower === 'str_replace_edit' || lower === 'str_replace_editor') return '改写'
  if (lower === 'grep' || lower === 'search' || lower === 'web_search') return '搜索'
  if (lower === 'glob' || lower === 'list_files') return '列出'
  if (lower === 'bash' || lower === 'pwsh' || lower === 'shell') return '执行'
  if (lower === 'subagent' || lower === 'task') return '子任务'
  if (lower === 'web_fetch' || lower === 'fetch') return '抓取'
  if (lower === 'todo_write') return '待办'
  return raw || '工具'
}

function toolTarget(tool) {
  const input = tool.input
  if (!input || typeof input !== 'object') return ''
  const candidate = input.file_path || input.path || input.file || input.command || input.pattern || input.query || input.prompt || ''
  const raw = text(candidate).trim()
  if (!raw) return ''
  return raw.length > 48 ? `…${raw.slice(-46)}` : raw
}

function proseOutputHtml(raw, files) {
  if (!files.length) return null
  // 多段产出（OS-59）：模型一次给两章时，每个围栏一个正文框，按出现顺序与文件路径配对。
  // 之前只取第一个围栏——第二章直接消失，作者以为模型漏写了。
  const fences = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)]
    .map((match) => match[1].trim())
    .filter((body) => body.replace(/\s/gu, '').length >= 80)
  if (!fences.length) return null
  const renderOne = (body, file) => {
    // 正文按小说排版渲染（OS-51：单换行也成段）
    const paragraphs = body.split(/\n+/u).map((block) => block.trim()).filter(Boolean)
    const rendered = paragraphs.map((block) => `<p>${esc(block)}</p>`).join('')
    return `<div class="prose-out">
    <div class="prose-out-head">
      <span class="po-label">正文</span>
      <code class="po-file">${esc(file)}</code>
      <button class="po-copy" data-action="copy-text" data-copy-target="po-${esc(file.replace(/[^\w]/gu, '_'))}" title="复制这段正文">复制</button>
    </div>
    <div class="prose-out-body" id="po-${esc(file.replace(/[^\w]/gu, '_'))}">${rendered}</div>
  </div>`
  }
  return fences.map((body, index) => renderOne(body, files[index] || files[0])).join('')
}

function assistantBodyHtml(item, streamingThis, files = []) {
  const raw = text(item.content)
  if (!raw) return ''
  // 流式时不渲染 markdown（半截表格/代码块会闪），出完再渲染；这也是 OD 的做法
  if (streamingThis) return `<div class="prose-block streaming">${esc(raw)}</div>`
  // 有正文产出：把那段代码块换成「正文框」
  const output = proseOutputHtml(raw, files)
  if (output) {
    // 把**所有**正文围栏从 markdown 里摘掉，避免渲染两遍（OS-59 多段产出：g 修饰符）
    const rest = raw.replace(/```[^\n]*\n[\s\S]*?```/gu, '')
    const restHtml = (mdReady() && mdModule() && rest.trim()) ? mdModule().renderMarkdown(rest.trim()) : (rest.trim() ? `<p>${esc(rest.trim())}</p>` : '')
    return `${restHtml ? `<div class="prose-block">${restHtml}</div>` : ''}${output}`
  }
  if (!mdReady() || !mdModule()) return `<div class="prose-block">${esc(raw)}</div>`
  try {
    return `<div class="prose-block">${mdModule().renderMarkdown(raw)}</div>`
  } catch {
    return `<div class="prose-block">${esc(raw)}</div>`
  }
}

function proposedFiles(item) {
  const raw = text(item.content)
  if (!raw) return []
  const files = new Set()
  for (const match of raw.matchAll(/(?:正文[\/])?([0-9]{3}[-_—][^`'"）)\n]+?\.md)/gu)) {
    files.add(`正文/${match[1]}`)
  }
  for (const match of raw.matchAll(/(正文[\/][^`'"）)\n]+?\.md)/gu)) {
    files.add(match[1].replaceAll('\\', '/'))
  }
  if (!files.size) return []
  // a) 代码块 ≥80 字（去掉围栏行）——多段产出（模型一次给两章）也认：
  //    按围栏出现顺序与文件路径出现顺序配对，产出多少个正文框由围栏数决定（OS-59）
  const fences = [...raw.matchAll(/```[^\n]*\n([\s\S]*?)```/gu)].map((match) => match[1].trim())
  const usable = fences.filter((block) => block.replace(/\s/gu, '').length >= 80)
  if (usable.length) return [...files]
  // b) 连续引用块 ≥3 行且合计 ≥80 字
  const quoteLines = raw.split('\n').filter((line) => /^\s*>\s?\S/u.test(line))
  if (quoteLines.length >= 3 && quoteLines.join('').replace(/[\s>]/gu, '').length >= 80) return [...files]
  // c) 单行长引用块 ≥60 字（OS-51 放宽：润笔「拟替换 + 引用块」常只有一行长文）
  if (quoteLines.length >= 1 && quoteLines.join('').replace(/[\s>]/gu, '').length >= 60) return [...files]
  return []
}

function appliedChipsHtml(applied) {
  if (!applied) return ''
  const chips = []
  const skills = Array.isArray(applied.craftSkills) ? applied.craftSkills : []
  if (skills.length) {
    const names = skills.map((skill) => skill.name).join('、')
    chips.push(`<span class="ap-chip" title="${esc(skills.map((skill) => `${skill.name}：${skill.description}`).join('\n'))}"><i>✦</i>技法 ${skills.length} 项<span class="ap-more">${esc(names.slice(0, 40))}${names.length > 40 ? '…' : ''}</span></span>`)
  }
  if (applied.brief) {
    chips.push(`<span class="ap-chip" title="项目简报里的体裁/篇幅/分章约束已注入提示词"><i>▤</i>体裁${applied.genre ? ` · ${esc(applied.genre)}` : ''}</span>`)
  }
  if (applied.kb) {
    chips.push(`<span class="ap-chip" title="同题材先例（案例库/套路库）已检索并注入"><i>◈</i>知识库先例</span>`)
  }
  if (applied.canReadFiles) {
    chips.push(`<span class="ap-chip" title="可以读这个库里的文件，但改正文要走待确认"><i>⌸</i>可读库文件</span>`)
  }
  if (applied.chineseReasoning) {
    chips.push(`<span class="ap-chip" title="推理过程用中文（可在设置里关）"><i>文</i>中文推理</span>`)
  }
  return chips.length ? `<div class="ap-chips">${chips.join('')}</div>` : ''
}

function msgHtml(item, index) {
  if (item.role === 'user') return `<div class="bub user">${esc(item.content)}</div>`
  const streamingThis = agent.streaming && index === agent.items.length - 1
  const cursor = streamingThis ? '<span class="cursor"></span>' : ''
  // 过程块：流式时展开（活），结束后收起成「思考过程 · 12.3s · 2 次工具」
  const proc = item.process
  const processBlock = proc ? processBlockHtml(proc, { live: streamingThis && !item.content }) : ''
  // 状态行只在「还没有任何过程、也没出正文」时显示——一句话，不刷屏
  const sec = item.waiting || 0
  const idleLine = streamingThis && !item.content && !processBlock && sec
    ? `<span class="act"><i class="act-dot"></i>${item.activity === 'thinking' ? '思考中' : '准备中'}… ${sec}s</span>`
    : ''
  const truncated = item.truncated
    ? '<span class="partial-tag">回答被模型长度上限截断——可以让我接着写完</span>'
    : ''
  const partial = item.partial
    ? '<span class="partial-tag">已停止——这段是不完整回答，以服务器落档为准</span>'
    : ''
  const files = streamingThis ? [] : proposedFiles(item)
  const body = assistantBodyHtml(item, streamingThis, files)
  // 底部条：复制常驻；「采纳」只在真有产出时出现（OS-43 历史交互口径）
  const copyBtn = item.content
    ? `<button class="msg-act" data-action="msg-copy" data-msg-index="${index}" title="复制这段回复">复制</button>`
    : ''
  const rejected = agent.rejectedMsgs?.[index]
  const adoptBtn = files.length && !rejected
    ? `<button class="msg-act primary" data-action="card-from" data-msg-index="${index}" title="${files.length > 1 ? `把 ${files.length} 段正文分别写进 ${esc(files.slice(0, 2).join('、'))}${files.length > 2 ? ' 等' : ''}` : `把这段写进 ${esc(files[0])}`}">采纳${files.length > 1 ? ` ${files.length} 段` : ''}</button>`
    : ''
  // OS-51：产物形态补齐——驳回（收起这条的产物按钮）与重新修改（带文件上下文重开一轮）
  const redoBtn = files.length && !rejected
    ? `<button class="msg-act" data-action="msg-redo" data-msg-index="${index}" data-file="${esc(files[0])}" title="就这段产物提修改要求">重新修改</button>`
    : ''
  const rejectBtn = files.length && !rejected
    ? `<button class="msg-act" data-action="msg-reject" data-msg-index="${index}" title="不采纳，收起这些按钮">驳回</button>`
    : ''
  const rejectedTag = rejected ? '<span class="msg-act dead">已驳回</span>' : ''
  const foot = (adoptBtn || copyBtn || redoBtn || rejectBtn || rejectedTag)
    ? `<div class="msg-foot">${adoptBtn}${redoBtn}${rejectBtn}${copyBtn}${rejectedTag}</div>`
    : ''
  const appliedChips = appliedChipsHtml(item.applied)
  return `<div class="msg assistant">${idleLine}${processBlock}${body}${cursor}${truncated}${partial}${appliedChips}${foot}</div>`
}

function cardHtml(item) {
  const open = item.state === 'open'
  const snapshotNote = item.snapshot?.exists ? `创建时 ${item.snapshot.chars} 字` : '创建时是新文件'
  const ops = open
    ? `<div class="ops">
        <button class="btn-primary" data-action="card-adopt" data-card-id="${esc(item.id)}">采纳</button>
        <button class="btn-ghost" data-action="card-reject" data-card-id="${esc(item.id)}">驳回</button>
        <span class="count">采纳＝写「${esc(item.file)}」· ${esc(snapshotNote)}</span>
      </div>`
    : `<div class="ops">
        <span class="state-chip${item.state === 'adopted' ? ' ok' : ' dead'}">${item.state === 'adopted' ? '已采纳' : '已驳回'}</span>
        ${item.state === 'adopted' ? `<span class="count">写入「${esc(item.file)}」</span>` : ''}
        ${item.backup ? `<span class="count">上一版备份：${esc(item.backup)}</span>` : ''}
      </div>`
  const revError = agent.cardError?.cardId === item.id ? `<div class="rev-error">${esc(agent.cardError.message)}</div>` : ''
  return `<div class="card-block">
    <div class="head"><b>待确认</b><span class="file">${esc(item.file)}</span></div>
    <div class="body">${esc(item.text)}</div>
    ${item.note ? `<div class="note">备注：${esc(item.note)}</div>` : ''}
    ${ops}${revError}
  </div>`
}

function threadHtml() {
  if (!state.current) {
    return `<div class="agent-empty"><strong>先选一个库</strong>点右上角「库」切换器选一个库，Agent 就绑定到那个库。</div>`
  }
  if (agent.items.length === 0) {
    return `<div class="agent-empty"><strong>问剧情、要一段正文、改设定…</strong>回答可以转成「待确认卡」，采纳后才真正写进正文文件。</div>`
  }
  // 过程行（kind==='process'）挂到相邻的 assistant 消息上——它是那一轮的过程留痕，
  // 不要再单独摆一块，否则对话流被切成两半。落档时 process 一定在 assistant 之前，
  // 但老数据可能反序，所以两边都认。
  const items = []
  for (let i = 0; i < agent.items.length; i += 1) {
    const item = agent.items[i]
    if (item.kind === 'process') continue
    if (item.kind === 'card') { items.push(cardHtml(item)); continue }
    let merged = item
    if (item.kind === 'msg' && item.role === 'assistant') {
      const before = agent.items[i - 1]
      const after = agent.items[i + 1]
      const proc = before?.kind === 'process' ? before : (after?.kind === 'process' ? after : null)
      if (proc) merged = { ...item, process: proc }
    }
    items.push(msgHtml(merged, i))
  }
  return items.join('')
}

function renderThread() {
  const thread = document.getElementById('agent-thread')
  if (!thread) return
  const follow = thread.scrollHeight - thread.scrollTop <= thread.clientHeight + 60
  const notices = agent.notices.slice(-3).map((noticeText) => `<div class="thread-notice">${esc(noticeText)}</div>`).join('')
  thread.innerHTML = threadHtml()
    + notices
    + (agent.lastError ? `<div class="error-box">${esc(agent.lastError)}</div>` : '')
  if (follow) thread.scrollTop = thread.scrollHeight
}

function renderContextChip() {
  const host = document.getElementById('agent-context')
  if (!host) return
  const ctx = state.agent.pendingContext
  if (!ctx) { host.innerHTML = ''; return }
  host.innerHTML = `<div class="ctx-chip">
    <span class="ctx-label">上下文</span>
    <span class="ctx-text" title="${esc(ctx.context)}">${esc(ctx.label)}</span>
    <button class="ctx-x" data-action="clear-agent-context" title="移除上下文">×</button>
  </div>`
}

function renderAgent() {
  renderContextChip()
  renderAgentCurrent()
  renderKbChain()
  const strip = document.getElementById('agent-sess-panel')
  if (strip) strip.innerHTML = sessionsHtml()
  const count = document.getElementById('agent-sess-count')
  if (count) count.textContent = String(agent.sessions.length)
  renderThread()
  updateComposerState()
  updateAgentChip()
}

const TOOL_META = Object.freeze({
  read: { icon: '👁', note: '读文件' },
  read_file: { icon: '👁', note: '读文件' },
  write: { icon: '✎', note: '写文件' },
  write_file: { icon: '✎', note: '写文件' },
  create_file: { icon: '✎', note: '新建文件' },
  edit: { icon: '✐', note: '改文件' },
  str_replace_edit: { icon: '✐', note: '改文件' },
  str_replace_editor: { icon: '✐', note: '改文件' },
  glob: { icon: '🗂', note: '列目录' },
  list_files: { icon: '🗂', note: '列目录' },
  grep: { icon: '🔍', note: '搜内容' },
  search: { icon: '🔍', note: '搜内容' },
  web_search: { icon: '🌐', note: '联网搜索' },
  web_fetch: { icon: '🌐', note: '抓网页' },
  fetch: { icon: '🌐', note: '抓网页' },
  bash: { icon: '▶', note: '跑命令' },
  pwsh: { icon: '▶', note: '跑命令' },
  shell: { icon: '▶', note: '跑命令' },
  subagent: { icon: '⑂', note: '派子任务' },
  task: { icon: '⑂', note: '派子任务' },
  todo_write: { icon: '☑', note: '列待办' }
})

  return { sessionTitle, sessionsHtml, renderAgentCurrent, renderKbChain, processBlockHtml, toolMeta, toolRowHtml, toolVerb, toolTarget, proseOutputHtml, assistantBodyHtml, proposedFiles, appliedChipsHtml, msgHtml, cardHtml, threadHtml, renderThread, renderContextChip, renderAgent, TOOL_META }
}
