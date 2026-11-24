/**
 * agent 域 handler（OS-141 daemon 拆分）——17 端点，与 contracts/agent.mjs 一一对应：
 * agentConfigGet/agentConfigPut（旧形状配置，MCP/旧前端还在用）、agentRuntimesGet/agentRuntimePut/
 * agentRuntimeSetup（运行时货架）、agentDshModelsGet（DSH 模型清单）、
 * agentSessions/Create/Get/Rename/Delete（会话 JSONL）、agentChat（流式转发）、
 * agentCardCreate/agentCardAdopt/agentCardReject（待确认卡）、agentPicksGet/agentPicksPut（技能勾选）。
 *
 * Agent 通道（OS-4/9）：会话 JSONL ＋ 活动运行时（kit 优先，Pi 兜底）流式转发。
 * 帧协议（daemon 自有）：notice? → start（回填 sessionId）→ delta* → done；出错发 error 帧。
 * 凭据只来自本机配置/kit manifest，不回显、不进日志；上游失败如实报，不伪造回答。
 * 统一签名 `async handler(ctx)`：会话/卡片端点需要库，第一件事 authorizeRoot；
 * 配置与货架端点不碰库文件，不做 root 校验（与拆分前一致）。
 */
import { API_ERROR_CODES } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { sseOpen, sseFrame } from '../../host/sse.mjs'
import { authorizeRoot, resolveInsideRoot } from '../../host/authorize.mjs'
import {
  appendSession,
  buildUpstreamMessages,
  createSession,
  createSseDeltaParser,
  deleteSession,
  fileSnapshot,
  lastSessionId,
  listSessions,
  newCardId,
  newMessageId,
  patchSessionMeta,
  readSession,
  renameSession,
  snapshotsMatch,
  updateCard
} from '../../modules/agentbar/agentStore.mjs'
import { loadConfigV2, saveConfigV2, configPublicLegacy, configTextBlock } from '../../services/agentConfig.mjs'
import { resolveChatUpstream } from '../../services/chatUpstream.mjs'
import { systemPromptFor } from '../../services/systemPrompt.mjs'
import { loadRuntimeKits, probeRuntimeKit, sidecarRunning } from '../../services/runtimes.mjs'
import { detectDshAny, detectDshModels, probeDshStack, setupDshStack } from '../../services/dsh-bridge.mjs'
import { runCliChat } from '../../services/cli-bridge.mjs'
import { runDshStdio } from '../../services/dsh-cli.mjs'
import { projectLegacyFrame } from '../../protocol/agentEvents.mjs'
import { readHabits, lintHabits } from '../../services/habits.mjs'
import { writeChapterWithBackup } from '../../protocol/chapterWrite.mjs'
import { readAgentPicks, writeAgentPicks } from '../../services/skills.mjs'

export async function agentConfigGet(ctx) {
  const { res, context } = ctx
  // 旧端点保留（MCP/旧前端还在用）：返回旧形状，值来自 text 块。
  const { config } = await loadConfigV2(context.agentConfigPath)
  return sendJson(res, 200, configPublicLegacy(config, context.agentConfigPath))
}

export async function agentConfigPut(ctx) {
  const { res, request, context } = ctx
  // 旧端点保留：请求是旧的扁平字段，写进 text 块，响应回旧形状。
  const config = await saveConfigV2(context.agentConfigPath, { text: { ...request } })
  return sendJson(res, 200, configPublicLegacy(config, context.agentConfigPath))
}

/** 运行时货架：Pi 兜底（内置伪条目）＋各 kit（内置/本机）。userDir 供设置页展示。 */
export async function agentRuntimesGet(ctx) {
  const { res, context } = ctx
  const { config } = await loadConfigV2(context.agentConfigPath)
  const textBlock = config.text
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  // OS-18：货架三组（native＝Pi/DSH/套件侧车；cli＝CLI 嫁接），CLI 与 DSH 带实测状态
  const enriched = []
  for (const kit of kits) {
    let probeResult = null
    if (kit.probe) {
      if (kit.kind === 'dsh') {
        // od 口径分层：CLI → profile → runtime 组件 → 就绪；每层都带「下一步」
        const stack = await probeDshStack({ env: context.env })
        if (stack.state === 'ready') {
          probeResult = { installed: true, version: `就绪（${stack.version ?? 'dsh'} · profile ${stack.profile}）`, state: 'ready' }
        } else {
          const http = await detectDshAny({ env: context.env })
          probeResult = http.running && http.mode === 'http'
            ? { installed: true, version: `chat 端点就绪（${http.source}）`, state: 'ready', mode: 'http' }
            : { installed: false, state: stack.state, message: stack.message, commands: stack.commands ?? [] }
        }
      } else {
        probeResult = await probeRuntimeKit(kit)
      }
    }
    enriched.push({
      id: kit.id,
      name: kit.name,
      kind: kit.kind,
      category: kit.category ?? 'native',
      source: kit.source,
      status: kit.kind === 'sidecar'
        ? (sidecarRunning(kit.id) ? 'running' : 'idle')
        : probeResult
          ? (probeResult.installed ? 'ready' : 'missing')
          : 'ready',
      description: kit.description,
      // OS-149（G8e）：夹具标记照实回传——货架清单不隐瞒，前端各自决定要不要露给作者
      fixture: kit.fixture === true,
      // OS-74：CLI kit 的模型清单透传给设置页（下拉选项来源）
      ...(Array.isArray(kit.models) && kit.models.length ? { models: kit.models } : {}),
      ...(kit.defaultModel ? { defaultModel: kit.defaultModel } : {}),
      ...(probeResult ? { probe: probeResult } : {})
    })
  }
  const runtimes = [
    {
      id: '',
      name: 'Pi（默认兜底）',
      kind: 'pi',
      category: 'native',
      source: '内置',
      status: text(textBlock.endpoint).trim() ? 'ready' : 'unconfigured',
      description: '直连 OpenAI 兼容端点（下方字段）；没装任何 kit 时的原生兜底，也是默认运行时'
    },
    ...enriched
  ]
  const userDir = Array.isArray(context.runtimesDirs) && context.runtimesDirs[1] ? context.runtimesDirs[1] : ''
  return sendJson(res, 200, { ok: true, active: text(textBlock.runtime).trim(), runtimes, ...(userDir ? { userDir } : {}) })
}

export async function agentRuntimePut(ctx) {
  const { res, request, context } = ctx
  const id = text(request.id).trim()
  if (id) {
    const { kits } = loadRuntimeKits(context.runtimesDirs)
    if (!kits.some((kit) => kit.id === id)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `货架上没有这个运行时套件：${id}`)
    }
  }
  const config = await saveConfigV2(context.agentConfigPath, { text: { runtime: id } })
  return sendJson(res, 200, { ok: true, active: text(config.text.runtime).trim() })
}

export async function agentDshModelsGet(ctx) {
  const { res, request, context } = ctx
  const profile = text(request.profile).trim() || text(context.env?.DSH_PROFILE || 'openstory').trim()
  const probed = await detectDshModels({ env: context.env, profile })
  return sendJson(res, 200, {
    ok: true,
    models: probed.models ?? [],
    ...(probed.ok ? {} : { message: probed.message })
  })
}

export async function agentRuntimeSetup(ctx) {
  const { res, request, context } = ctx
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  const kit = kits.find((item) => item.id === text(request.id).trim())
  if (!kit) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `货架上没有这个运行时套件：${text(request.id)}`)
  if (kit.kind !== 'dsh') {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '只有 DSH 原生支持一键修复（CLI 服务请按货架提示自行安装）')
  }
  const tarball = text(request.runtimeTarball || kit.setup?.runtimeTarball || context.env.DSH_RUNTIME_TARBALL)
  const fixed = await setupDshStack({ env: context.env, dshCmd: text(context.env.DSH_CLI || 'dsh'), runtimeTarball: tarball })
  if (!fixed.ok) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, fixed.message, { steps: fixed.steps })
  }
  return sendJson(res, 200, { ok: true, state: fixed.state ?? 'ready', steps: fixed.steps, message: fixed.message })
}

export async function agentPicksGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const picks = await readAgentPicks(authorized.root)
  return sendJson(res, 200, { ok: true, picks: picks ?? null, explicit: picks !== null })
}

export async function agentPicksPut(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const written = await writeAgentPicks(authorized.root, context.skillsDirs, request)
  if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.INVALID_ENTRY, written.message)
  return sendJson(res, 200, { ok: true, picks: written.picks, path: written.path })
}

/**
 * DSH 单条 prompt 组装（DSH 只有「一条 prompt」通道，系统提示也得拼进去）。
 * - systemPrompt 放最前，用明确分隔线与对话历史隔开
 * - 已采纳的 card 也带上（文件＋摘要）——只收 kind==='msg' 会把这一段上下文丢掉
 * - 截断时插显式标记，不再静默砍头
 * - onlyTail：resume 时只发最后一轮（DSH 自己有前文，重复发会翻倍算 token）
 */
function composeDshPrompt(items, { systemPrompt = '', maxMessages = 24, maxChars = 48000, onlyTail = false } = {}) {
  const all = (Array.isArray(items) ? items : [])
    .filter((item) => item?.kind === 'msg' || item?.kind === 'card')
    .map((item) => {
      if (item.kind === 'card') {
        const body = text(item.text).trim()
        if (!body) return null
        return { role: 'card', content: `【已采纳的稿：${text(item.file) || '正文'}】\n${body}` }
      }
      return { role: item.role === 'assistant' ? 'assistant' : 'user', content: text(item.content) }
    })
    .filter((message) => message && message.content.trim())

  let picked = all
  let dropped = 0
  if (onlyTail) {
    // resume 模式：DSH 自己记得前文，这里只发本轮新问的那句。
    // 关键：绝不能在这里补「更早的对话已省略 N 条」——DSH 会照字面以为自己失忆了。
    picked = all.slice(-1)
  } else {
    const budgeted = []
    let used = 0
    for (let index = all.length - 1; index >= 0 && budgeted.length < maxMessages; index -= 1) {
      const message = all[index]
      if (used + message.content.length > maxChars && budgeted.length > 0) { dropped = index + 1; break }
      budgeted.unshift(message)
      used += message.content.length
    }
    picked = budgeted
    dropped = Math.max(dropped, all.length - budgeted.length)
  }

  const lines = picked.map((message) => {
    if (message.role === 'card') return message.content
    return message.role === 'assistant' ? `【助手】${message.content}` : `【作者】${message.content}`
  })
  const head = []
  if (systemPrompt.trim()) {
    head.push(systemPrompt.trim())
    head.push('---')
  }
  if (dropped > 0) head.push(`【更早的对话已省略 ${dropped} 条】`)
  return [...head, ...lines].join('\n\n')
}

/**
 * 这个本地会话对应的 DSH 会话指纹是否还可用。
 * 模型或 cwd 变了就作废——DSH 侧会话跟运行环境绑定，硬 resume 会报 mismatch。
 */
async function resolveDshResume({ sessionsDir, root, session, ephemeral, model }) {
  if (ephemeral) return { resumeSessionId: '', notice: '' }
  const dshSessionId = text(session?.dshSessionId)
  if (!dshSessionId) return { resumeSessionId: '', notice: '' }
  const prevModel = text(session?.dshModel)
  const prevCwd = text(session?.dshCwd)
  const modelChanged = Boolean(prevModel) && Boolean(model) && prevModel !== model
  const cwdChanged = Boolean(prevCwd) && prevCwd !== root
  if (modelChanged || cwdChanged) {
    await patchSessionMeta(sessionsDir, root, session.id, { dshSessionId: '', dshModel: '', dshCwd: '' })
    const why = modelChanged ? '模型换了' : '库路径变了'
    return { resumeSessionId: '', notice: `${why}，DSH 会话已重开（前文仍在本条会话里）。` }
  }
  return { resumeSessionId: dshSessionId, notice: '' }
}

/**
 * Agent 对话（OS-4/9）：会话 JSONL ＋ 活动运行时（kit 优先，Pi 兜底）流式转发。
 * 帧协议（daemon 自有）：notice? → start（回填 sessionId）→ delta* → done；出错发 error 帧。
 * 凭据只来自本机配置/kit manifest，不回显、不进日志；上游失败如实报，不伪造回答。
 */
export async function agentChat(ctx) {
  const { req, res, request, context, allowlist, loaded } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const libraries = loaded.libraries
  const { config } = await loadConfigV2(context.agentConfigPath)
  const upstream = await resolveChatUpstream(config, context)
  if (!upstream.ok) {
    return sendError(res, upstream.code ?? API_ERROR_CODES.AGENT_UPSTREAM_ERROR, upstream.message)
  }
  const targetUrl = upstream.url ? new URL(upstream.url) : null

  // ephemeral：一次性工具调用（润笔/讨论/单段分析）——不建会话、不落档、不留痕。
  // 否则每润一次笔就在会话列表里多一条「【润笔请求】…」，作者的真会话会被淹没。
  const ephemeral = request.ephemeral === true

  // 会话：显式给了就用它（不存在就如实报）；没给则优先「接着上次聊」，真没有才新建。
  // newSession:true ＝作者主动点了「＋新会话」，强制开新的，不吃 lastSessionId。
  const sessionsDir = context.agentSessionsDir
  const wantNew = request.newSession === true
  const requestedId = text(request.sessionId)
  let sessionLoaded = requestedId ? await readSession(sessionsDir, root, requestedId) : null
  if (requestedId && !sessionLoaded) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${requestedId}`)
  }
  let sessionId = ''
  let history = { items: [] }
  if (ephemeral) {
    // 一次性调用：只带这一条，不读也不写任何会话文件
    history = { items: [{ kind: 'msg', role: 'user', content: request.content, at: new Date().toISOString() }] }
  } else {
    if (!sessionLoaded && !wantNew) {
      // 默认会话：接着这个库上次聊的那条（作者口径：不要每次进来都是新会话）
      const last = await lastSessionId(sessionsDir, root)
      if (last) sessionLoaded = await readSession(sessionsDir, root, last)
    }
    if (!sessionLoaded) {
      const title = text(request.content).replace(/\s+/gu, ' ').trim().slice(0, 24) || '新会话'
      const created = await createSession(sessionsDir, root, title)
      sessionLoaded = { session: created, items: [] }
    }
    sessionId = sessionLoaded.session.id
    await appendSession(sessionsDir, root, sessionId, [{
      t: 'msg', id: newMessageId(), role: 'user', content: request.content, at: new Date().toISOString()
    }])
    history = await readSession(sessionsDir, root, sessionId)
  }
  const promptBundle = await systemPromptFor(root, libraries, context.genresDirs, context.skillsDirs, { suitesDirs: context.suitesDirs, suiteStatePath: context.suiteStatePath, env: context.env })
  const upstreamMessages = buildUpstreamMessages(promptBundle.prompt, history.items)
  const model = text(request.model || upstream.model).trim()

  const headers = { 'content-type': 'application/json', accept: 'text/event-stream', ...upstream.headers }

  const controller = new AbortController()
  let clientGone = false
  // res 'close'＝连接提前断开（工作台点了停止/关页）；正常结束后 res 的 close 不触发 abort。
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true
      controller.abort()
    }
  })
  // 断连守卫（OS-135）：runCliChat / runDshStdio 可能跑几分钟——期间客户端点了停止/关页
  // （clientGone 置位、res 已销毁），回包帧再往 res 写就是 write-after-end。
  // 落档照旧（断连不丢回答），只是不再对已断的连接发帧。三处分支共用这一个守卫。
  const safeSend = (frame) => {
    if (clientGone || res.writableEnded) return
    try { sseFrame(res, frame) } catch { /* 连接已断，静默 */ }
  }

  if (upstream.execute === 'dsh-cli') {
    // DSH stdio（od 协议）：start → (thinking|tool|usage|delta)* → done
    // 会话连续性：resume_session_id 换 DSH 侧真会话；续上了才有跨轮记忆、才会触发 DSH 自己的上下文压缩。
    sseOpen(res)
    // DSH 带完整工具链 + cwd=库根：告诉它「你能读，但改正文要走卡」，别再说假话
    const promptBundle = await systemPromptFor(root, libraries, context.genresDirs, context.skillsDirs, {
      canReadFiles: true,
      chineseReasoning: configTextBlock(config).chineseReasoning !== false,
      suitesDirs: context.suitesDirs,
      suiteStatePath: context.suiteStatePath,
      env: context.env
    })
    const systemPrompt = promptBundle.prompt
    const applied = promptBundle.applied
    // start 帧带上「这轮生效了什么」（运行时/技能/体裁/KB），界面据此标注。
    // OS-131：先构造 canonical 事件再投影成旧帧——线上字节与改前逐字符一致。
    sseFrame(res, projectLegacyFrame({ type: 'agent_started', sessionId, runtime: upstream.runtimeName, applied }))
    if (upstream.notice) sseFrame(res, projectLegacyFrame({ type: 'notice', text: upstream.notice }))
    const dshModel = text(upstream.model).trim()
    // resume 前置：模型/cwd 变了就作废（DSH 侧会话与运行环境绑定）
    const stitched = await resolveDshResume({ sessionsDir, root, session: sessionLoaded?.session, ephemeral, model: dshModel })
    const resumeSessionId = stitched.resumeSessionId
    if (stitched.notice) safeSend(projectLegacyFrame({ type: 'notice', text: stitched.notice }))

    // resume 时 DSH 自己记得前文，只发最新一轮；冷启才发全量历史
    const dshPrompt = resumeSessionId
      ? composeDshPrompt(history.items, { systemPrompt, onlyTail: true })
      : composeDshPrompt(history.items, { systemPrompt })

    let collected = ''
    let sawText = false
    // 过程留痕（OS-42）：思考轨迹与工具调用单独收，跟最终答案分开落档。
    // 不做的话刷新一次这些过程就全丢了，作者回头看不到「它当时在想什么、查了什么」。
    let thinkingBuf = ''
    const toolTrace = []
    const toolStarted = new Map()
    const traceStart = Date.now()
    const onThinkingPiece = (piece) => {
      thinkingBuf += piece
      safeSend(projectLegacyFrame({ type: 'thinking', text: piece }))
    }
    const onToolCallFrame = (call) => {
      // 调用当下就记一条（有些工具 DSH 只发 tool_call、不发 tool_result——
      // 结果直接喂给模型了，界面就再也等不到返回帧）。这样至少能保留「调了什么」。
      const key = call.id || call.name
      toolStarted.set(key, { at: Date.now(), name: call.name, input: call.input })
      toolTrace.push({
        id: call.id,
        name: call.name || 'tool',
        input: call.input ?? null,
        output: '',
        isError: false,
        elapsedMs: 0
      })
      safeSend(projectLegacyFrame({
        type: 'tool_call',
        toolName: call.name,
        args: call.input,
        callId: call.id,
        status: 'call'
      }))
    }
    const onToolResultFrame = (outcome) => {
      const started = toolStarted.get(outcome.id || '')
      // 回填刚才那条（有就更新，没有就补一条）
      const existing = toolTrace.find((tool) => tool.id && tool.id === outcome.id)
      if (existing) {
        existing.output = outcome.output
        existing.isError = outcome.isError === true
        existing.elapsedMs = started ? Date.now() - started.at : 0
      } else {
        toolTrace.push({
          id: outcome.id,
          name: started?.name || outcome.name || 'tool',
          input: started?.input ?? null,
          output: outcome.output,
          isError: outcome.isError === true,
          elapsedMs: started ? Date.now() - started.at : 0
        })
      }
      safeSend(projectLegacyFrame({
        type: 'tool_call',
        callId: outcome.id,
        status: 'result',
        result: outcome.output,
        resultIsError: outcome.isError
      }))
    }
    const startedAt = Date.now()
    let result = await runDshStdio({
      dshCmd: upstream.dshRun.dshCmd,
      profile: upstream.dshRun.profile,
      cwd: root,
      prompt: dshPrompt,
      resumeSessionId,
      ...(dshModel ? { model: dshModel } : {}),
      ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
      signal: controller.signal,
      inactivityMs: 90000,
      timeoutMs: 600000,
      onText: (piece) => {
        sawText = true
        collected += piece
        safeSend(projectLegacyFrame({ type: 'message_chunk', text: piece }))
      },
      onThinking: onThinkingPiece,
      onToolCall: onToolCallFrame,
      onToolResult: onToolResultFrame,
      onUsage: (usage) => safeSend(projectLegacyFrame({
        type: 'usage',
        input: usage.input,
        output: usage.output,
        cachedRead: usage.cachedRead,
        cachedWrite: usage.cachedWrite,
        total: usage.total
      }))
    })

    // resume 被 DSH 拒（会话过期/被清理）：清指纹，用全量历史冷重启一次
    if (!result.ok && result.resumeRejected && !ephemeral) {
      safeSend(projectLegacyFrame({ type: 'notice', text: '上轮 DSH 会话已失效，已无缝重开一段。' }))
      await patchSessionMeta(sessionsDir, root, sessionId, { dshSessionId: '', dshModel: '', dshCwd: '' })
      const coldPrompt = composeDshPrompt(history.items, { systemPrompt })
      collected = ''
      sawText = false
      thinkingBuf = ''
      toolTrace.length = 0
      toolStarted.clear()
      result = await runDshStdio({
        dshCmd: upstream.dshRun.dshCmd,
        profile: upstream.dshRun.profile,
        cwd: root,
        prompt: coldPrompt,
        ...(dshModel ? { model: dshModel } : {}),
        ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
        signal: controller.signal,
        inactivityMs: 90000,
        timeoutMs: 600000,
        onText: (piece) => {
          sawText = true
          collected += piece
          safeSend(projectLegacyFrame({ type: 'message_chunk', text: piece }))
        },
        onThinking: onThinkingPiece,
        onToolCall: onToolCallFrame,
        onToolResult: onToolResultFrame,
        onUsage: (usage) => safeSend(projectLegacyFrame({
          type: 'usage',
          input: usage.input,
          output: usage.output,
          cachedRead: usage.cachedRead,
          cachedWrite: usage.cachedWrite,
          total: usage.total
        }))
      })
    }

    if (result.ok && result.text.trim()) {
      if (!ephemeral) {
        // 先落过程再落答案：读回来时 process 行紧挨在 assistant 之前，
        // 前端 threadHtml 靠这个相邻关系把过程挂到对应消息上。
        if (thinkingBuf.trim() || toolTrace.length) {
          await appendSession(sessionsDir, root, sessionId, [{
            t: 'process',
            id: newMessageId(),
            at: new Date().toISOString(),
            thinking: thinkingBuf,
            tools: toolTrace,
            elapsedMs: Date.now() - traceStart
          }])
        }
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'msg', id: newMessageId(), role: 'assistant', content: result.text,
          at: new Date().toISOString(),
          // 用量/截断/生效清单一起落档：刷新后 reloadThread 才不会把这些冲掉
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.truncated ? { truncated: true } : {}),
          ...(applied ? { applied } : {})
        }])
        // 记住 DSH 会话指纹：下一轮靠它续上
        if (result.sessionId) {
          await patchSessionMeta(sessionsDir, root, sessionId, {
            dshSessionId: result.sessionId,
            dshModel,
            dshCwd: root
          })
        }
      }
      safeSend(projectLegacyFrame({
        type: 'run_end',
        status: 'completed',
        sessionId,
        chars: result.text.length,
        ms: Date.now() - startedAt,
        ...(result.truncated ? { truncated: true, stopReason: result.stopReason } : {})
      }))
    } else {
      // 中断/失败：已收到的部分回答要落档（partial），否则 reloadThread 会把它冲掉
      if (!ephemeral && sawText && collected.trim()) {
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'msg', id: newMessageId(), role: 'assistant', content: collected,
          at: new Date().toISOString(), partial: true
        }])
      }
      // 过程也要留：即使没出正文，「它想了什么、查了什么」也是有价值的记录
      if (!ephemeral && (thinkingBuf.trim() || toolTrace.length)) {
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'process',
          id: newMessageId(),
          at: new Date().toISOString(),
          thinking: thinkingBuf,
          tools: toolTrace,
          elapsedMs: Date.now() - traceStart
        }])
      }
      safeSend(projectLegacyFrame({
        type: 'run_end',
        status: 'error',
        error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: result.message ?? 'DSH 无输出' }
      }))
    }
    if (!clientGone && !res.writableEnded) res.end()
    return
  }

  if (upstream.execute === 'cli') {
    // CLI 嫁接：一次性子进程 → 整段一片 SSE（daemon 自有帧协议不变）
    sseOpen(res)
    sseFrame(res, projectLegacyFrame({ type: 'agent_started', sessionId, runtime: upstream.runtimeName }))
    if (upstream.notice) sseFrame(res, projectLegacyFrame({ type: 'notice', text: upstream.notice }))
    const cli = await runCliChat(upstream.kit, upstreamMessages, { model: upstream.model })
    if (cli.ok) {
      safeSend(projectLegacyFrame({ type: 'message_chunk', text: cli.text }))
      if (!ephemeral) {
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'msg', id: newMessageId(), role: 'assistant', content: cli.text, at: new Date().toISOString()
        }])
      }
      safeSend(projectLegacyFrame({ type: 'run_end', status: 'completed', sessionId, chars: cli.text.length }))
    } else {
      safeSend(projectLegacyFrame({
        type: 'run_end',
        status: 'error',
        error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: cli.message }
      }))
    }
    if (!clientGone && !res.writableEnded) res.end()
    return
  }

  let upstreamRes
  try {
    upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...(model ? { model } : {}), messages: upstreamMessages, stream: true }),
      signal: controller.signal
    })
  } catch (error) {
    if (clientGone) return
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `模型端点连不上：${text(error?.message || error)}`)
  }

  if (!upstreamRes.ok) {
    if (clientGone) return
    const detail = text(await upstreamRes.text().catch(() => '')).slice(0, 500)
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `模型端点返回 ${upstreamRes.status}`, { status: upstreamRes.status, detail })
  }

  sseOpen(res)
  sseFrame(res, projectLegacyFrame({ type: 'agent_started', sessionId, runtime: upstream.runtimeName }))
  if (upstream.notice) sseFrame(res, projectLegacyFrame({ type: 'notice', text: upstream.notice }))

  const decoder = new TextDecoder()
  let full = ''
  const parser = createSseDeltaParser((piece) => {
    full += piece
    if (!res.writableEnded) sseFrame(res, projectLegacyFrame({ type: 'message_chunk', text: piece }))
  })

  let upstreamError = ''
  try {
    if (upstreamRes.body) {
      for await (const chunk of upstreamRes.body) {
        parser.feed(decoder.decode(chunk, { stream: true }))
      }
      parser.feed(decoder.decode())
    }
    parser.end()
  } catch (error) {
    if (!clientGone && !controller.signal.aborted) {
      upstreamError = text(error?.message || error)
      sseFrame(res, projectLegacyFrame({
        type: 'run_end',
        status: 'error',
        error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: upstreamError }
      }))
    }
  }

  // 落档：完整回答、或被停止/中断的部分回答，partial 如实标；空回答不落（错误帧已如实报）。
  // ephemeral（润笔这类一次性调用）不落档。
  if (!ephemeral && full.trim()) {
    const partial = controller.signal.aborted || Boolean(upstreamError)
    await appendSession(sessionsDir, root, sessionId, [{
      t: 'msg', id: newMessageId(), role: 'assistant', content: full,
      at: new Date().toISOString(), ...(partial ? { partial: true } : {})
    }])
  }
  if (!clientGone && !res.writableEnded) {
    sseFrame(res, projectLegacyFrame({ type: 'run_end', status: 'completed', sessionId, chars: full.length }))
  }
  res.end()
}

/** 待确认卡：创建即取目标正文快照——「卡创建→采纳」窗口的修订闸从这里起算。 */
export async function agentCardCreate(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const loaded = await readSession(context.agentSessionsDir, root, request.sessionId)
  if (!loaded) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.sessionId}`)
  const resolved = resolveInsideRoot(root, request.file)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  let snapshot
  try {
    snapshot = fileSnapshot(resolved.path)
  } catch (error) {
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `目标文件快照失败：${text(error?.message || error)}`, { file: request.file })
  }
  const note = text(request.note).trim()
  const card = {
    t: 'card',
    id: newCardId(),
    state: 'open',
    file: resolved.relative,
    text: request.text,
    ...(note ? { note } : {}),
    chars: request.text.length,
    snapshot,
    createdAt: new Date().toISOString()
  }
  await appendSession(context.agentSessionsDir, root, request.sessionId, [card])
  return sendJson(res, 200, {
    ok: true,
    card: {
      kind: 'card',
      id: card.id,
      state: card.state,
      file: card.file,
      text: card.text,
      ...(card.note ? { note: card.note } : {}),
      chars: card.chars,
      snapshot: card.snapshot,
      createdAt: card.createdAt
    }
  })
}

async function findOpenCard(context, root, sessionId, cardId) {
  const loaded = await readSession(context.agentSessionsDir, root, sessionId)
  if (!loaded) return { error: { code: API_ERROR_CODES.NOT_FOUND, message: `会话不存在：${sessionId}` } }
  const card = loaded.items.find((item) => item.kind === 'card' && item.id === cardId)
  if (!card) return { error: { code: API_ERROR_CODES.NOT_FOUND, message: `待确认卡不存在：${cardId}` } }
  if (card.state !== 'open') {
    return { error: { code: API_ERROR_CODES.INVALID_ENTRY, message: `这张卡已处理过（${card.state === 'adopted' ? '已采纳' : '已拒绝'}），不能再改` } }
  }
  return { card }
}

export async function agentCardAdopt(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const found = await findOpenCard(context, root, request.sessionId, request.id)
  if (found.error) return sendError(res, found.error.code, found.error.message)
  const card = found.card
  const resolved = resolveInsideRoot(root, card.file)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  let current
  try {
    current = fileSnapshot(resolved.path)
  } catch (error) {
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `正文快照失败：${text(error?.message || error)}`, { file: card.file })
  }
  if (!snapshotsMatch(current, card.snapshot)) {
    return sendError(res, API_ERROR_CODES.REVISION_MISMATCH,
      `正文在卡片创建后被改过（创建时 ${card.snapshot.exists ? `${card.snapshot.chars} 字` : '不存在'}，现在 ${current.exists ? `${current.chars} 字` : '不存在'}），拒绝覆盖。请重新创建待确认卡。`,
      { file: card.file, expected: card.snapshot, actual: current })
  }
  // 习惯 lint（OS-59）：采纳前对产物跑禁用词/句式检测。命中且未确认 → 409 让前端弹确认；
  // 作者确认后带 confirm:true 再来一次。只提醒不阻断（习惯表是作者自己的规矩）。
  const habits = readHabits(root)
  const habitHits = lintHabits(card.text, habits)
  if (habitHits.length && request.confirm !== true) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY,
      `这段产物命中了你的习惯表：${habitHits.map((hit) => hit.message).join('；')}。确认仍要采纳？`,
      { habitHits, needsConfirm: true, file: card.file })
  }
  const written = await writeChapterWithBackup(root, card.file, card.text)
  if (!written.ok) return sendError(res, written.code, written.message, written.details)
  const updated = await updateCard(context.agentSessionsDir, root, request.sessionId, request.id, {
    state: 'adopted',
    resolvedAt: new Date().toISOString(),
    ...(written.backup ? { backup: written.backup } : {})
  })
  return sendJson(res, 200, {
    ok: true,
    card: updated,
    chars: written.chars,
    savedAt: written.savedAt,
    ...(written.backup ? { backup: written.backup } : {}),
    ...(habitHits.length ? { habitHits } : {})
  })
}

export async function agentCardReject(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const found = await findOpenCard(context, root, request.sessionId, request.id)
  if (found.error) return sendError(res, found.error.code, found.error.message)
  const updated = await updateCard(context.agentSessionsDir, root, request.sessionId, request.id, {
    state: 'rejected',
    resolvedAt: new Date().toISOString()
  })
  return sendJson(res, 200, { ok: true, card: updated })
}

/* ---------- 会话清单（读侧，root 来自授权）---------- */

export async function agentSessions(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const sessions = await listSessions(context.agentSessionsDir, authorized.root)
  return sendJson(res, 200, { ok: true, sessions })
}

export async function agentSessionCreate(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const session = await createSession(context.agentSessionsDir, authorized.root, request.title)
  return sendJson(res, 200, { ok: true, session })
}

export async function agentSessionGet(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const loaded = await readSession(context.agentSessionsDir, authorized.root, request.id)
  if (!loaded) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
  return sendJson(res, 200, { ok: true, session: loaded.session, items: loaded.items })
}

export async function agentSessionRename(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const session = await renameSession(context.agentSessionsDir, authorized.root, request.id, request.title)
  if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
  return sendJson(res, 200, { ok: true, session })
}

export async function agentSessionDelete(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const removed = await deleteSession(context.agentSessionsDir, authorized.root, request.id)
  if (!removed) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
  return sendJson(res, 200, { ok: true })
}

/** agent 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  agentConfigGet,
  agentConfigPut,
  agentRuntimesGet,
  agentRuntimePut,
  agentRuntimeSetup,
  agentDshModelsGet,
  agentPicksGet,
  agentPicksPut,
  agentSessions,
  agentSessionCreate,
  agentSessionGet,
  agentSessionRename,
  agentSessionDelete,
  agentChat,
  agentCardCreate,
  agentCardAdopt,
  agentCardReject
}
