/**
 * Agent 内部事件模型＋AG-UI 协议出口（OS-128，对标 @open-design/agui-adapter 118 行）。
 *
 * 定位（写死，别含糊）：
 *   · 本文件定义的内部事件模型从此是 **canonical（唯一真源）**；
 *   · daemon.mjs 现有的 SSE 帧协议（见 contracts.mjs agentChat 注释：
 *     start / notice / thinking / tool / usage / delta / done / error，
 *     由 daemon.mjs sseFrame() 逐帧 `data: {json}` 推出）是它的一种**投影**——
 *     本批 SSE 现状零改动，这里只加纯函数与测试。
 *   · 未来第三方客户端（任何支持 AG-UI 的前端）从这里拿编码后的帧，
 *     内部事件模型自由演化不再绑死 SSE 字符串拼接。
 *
 * 与 AG-UI（Agent-User Interaction Protocol）的关系：kind 命名沿用对标实现
 *   （agent.message / tool_call / state_update / run.lifecycle）。本仓不引入任何
 *   npm 包——纯函数自持，零构建依赖是本仓宪法。
 *
 * SSE 现状 → canonical 的投影对照（OS-131 起已接线：daemon handleAgentChat 每个
 *   发帧点都是「构造 AgentEvent → projectLegacyFrame() → sseFrame()」，见下）：
 *   SSE start             → agent_started{sessionId,runtime,applied?}（OS-131 新增型）
 *   SSE notice            → notice{text}（OS-131 新增型，daemon 自有附属帧）
 *   SSE thinking          → thinking{text}（OS-131 新增型；不进正文，与 delta 分声道）
 *   SSE delta             → message_chunk{text}
 *   SSE tool phase=call   → tool_call{status:'call'}
 *   SSE tool phase=result → tool_call{status:'result', result}
 *   SSE usage             → usage{input,output,cachedRead,cachedWrite,total}（OS-131 新增型）
 *   SSE done              → run_end{status:'completed'}（携带 sessionId/chars/ms 投影字段）
 *   SSE error             → run_end{status:'error'}（携带 error:{code,message}）
 *   （SSE 现状没有 state_update / 纯 AG-UI run_started 对应的帧——这两型只进 AG-UI 出口。）
 *
 * OS-131 设计约束（与 OS-128 金样测试共存）：AGENT_EVENT_TYPES 仍恰为 AG-UI 五类
 *   （test/agentEvents.test.mjs 金样钉死其形状，且钉死 encodeForAgui 对 usage/notice
 *   throw）——daemon 现状帧里五类盖不住的种类另立 AGENT_EVENT_TYPES_SSE 词表，
 *   不进 encodeForAgui 的分支（它们的 AG-UI 映射以 AGENT_EVENT_AGUI_KINDS 表声明）。
 *
 * 纯 Node 模块，零依赖，可单测。
 */

/** 内部事件类型的全集（canonical，五类）。新增类型必须同时补 encoder 分支与单测。 */
export const AGENT_EVENT_TYPES = Object.freeze([
  'message_chunk',
  'tool_call',
  'state_update',
  'run_started',
  'run_end'
])

/**
 * SSE 附属型（OS-131）：daemon agentChat 现状帧里 AG-UI 五类盖不住的种类。
 * 与五类合并成内部事件模型的全部种类；AG-UI 映射见 AGENT_EVENT_AGUI_KINDS。
 * 冻结词表：新增类型走代码分支＋单测，不许运行期扩。
 */
export const AGENT_EVENT_TYPES_SSE = Object.freeze([
  'agent_started',
  'notice',
  'thinking',
  'usage'
])

/**
 * 内部事件类型 → AG-UI kind 映射表（全量九类的声明，OS-131）。
 * 五类的 kind 与 encodeForAgui 的输出一致（有单测钉住一致性）；
 * 无 AG-UI 对应的 SSE 附属型映射成自定义 kind（x-openstory.* 前缀，协议惯例）：
 *   · notice  → 'x-openstory.notice'  ：AG-UI 无系统提示/降级告示的帧型；
 *   · thinking→ 'x-openstory.thinking'：AG-UI message 无推理声道（OS-128 定的
 *     「thinking 走 message_chunk 型」是对内部模型的归属，AG-UI 帧上仍需区分声道，
 *     不混进正文 kind——如实拆成自定义 kind）；
 *   · usage   → 'x-openstory.usage'   ：AG-UI 无 token 用量帧型。
 * agent_started 语义上就是 AG-UI 的 run started（'run.lifecycle'），sessionId/runtime/
 *   applied 作为 OpenStory 扩展字段随帧携带（AG-UI 允许实现自有扩展字段）。
 */
export const AGENT_EVENT_AGUI_KINDS = Object.freeze({
  message_chunk: 'agent.message',
  tool_call: 'tool_call',
  state_update: 'state_update',
  run_started: 'run.lifecycle',
  run_end: 'run.lifecycle',
  agent_started: 'run.lifecycle',
  notice: 'x-openstory.notice',
  thinking: 'x-openstory.thinking',
  usage: 'x-openstory.usage'
})

/**
 * 正文/推理增量。
 *
 * @typedef {object} MessageChunkEvent
 * @property {'message_chunk'} type 事件类型。
 * @property {string} text 本片新增的增量文本（不是累计全文；thinking 片也走这型，投影层再区分）。
 * @property {boolean} [done] true＝这是该条消息的最后一片（流结束标记）。
 *   缺省＝后面还有片。false 与缺省语义不同：false 是显式「未完」，编码时必须原样保留，
 *   不许用真值判断把 false 吞掉。
 */

/**
 * 工具调用（一次调用一事件；call 与 result 两阶段用 status 区分）。
 *
 * @typedef {object} ToolCallEvent
 * @property {'tool_call'} type 事件类型。
 * @property {string} toolName 工具名（如 'chapter_write'）。
 * @property {*} args 调用参数（JSON 可序列化对象；投影层负责 stringify）。
 * @property {string} [callId] 调用标识——同一工具多路并发时配对 call/result 用。
 * @property {'call'|'result'} [status] 阶段：'call'＝发起，'result'＝返回。缺省＝'call' 语义。
 * @property {*} [result] 工具返回值（仅 status:'result' 时有意义）。
 * @property {boolean} [resultIsError] 工具返回是否为业务错误（对齐 SSE 帧 isError 的如实语义）。
 */

/**
 * 状态面更新（Agent 侧对共享状态的定点修改）。
 *
 * @typedef {object} StateUpdateEvent
 * @property {'state_update'} type 事件类型。
 * @property {string} path 状态路径（点分，如 'outline.chapter3.status'）。
 * @property {*} value 该路径的新值（JSON 可序列化）。
 */

/**
 * 一轮运行开始。
 *
 * @typedef {object} RunStartedEvent
 * @property {'run_started'} type 事件类型。
 * @property {string} runId 本轮运行标识。帧上的 runId 以 ctx.runId 为准（公共字段），
 *   不再重复输出，避免同一帧里出现两个可能不一致的 runId。
 */

/**
 * 一轮运行结束。
 *
 * @typedef {object} RunEndEvent
 * @property {'run_end'} type 事件类型。
 * @property {string} runId 本轮运行标识（同上，帧 runId 取 ctx.runId）。
 * @property {'completed'|'error'|'cancelled'} status 结束态：正常完成 / 上游失败或中断 / 作者取消。
 *   以下全是 SSE 投影字段（OS-131）：AG-UI 帧不输出它们，projectLegacyFrame 用。
 * @property {string} [sessionId] 会话标识（done 帧回填给工作台）。
 * @property {number} [chars] 本轮正文字符数（done 帧）。缺省＝帧上无 ms 同理无该键。
 * @property {number} [ms] 本轮耗时毫秒（done 帧）。缺省＝cli/直连路径的 done 帧就没有 ms。
 * @property {boolean} [truncated] 被长度上限截断（done 帧；真值才投影出 truncated+stopReason 键，
 *   与 daemon 现状字面量的真值判断逐语义一致）。
 * @property {string} [stopReason] 截断原因（仅 truncated 真值时随 truncated 一起投影）。
 * @property {{code: string, message: string}} [error] 上游失败信息（status:'error' 时投影成
 *   error 帧的 error 对象；daemon 恒给全 code/message）。
 */

/**
 * 一轮 Agent 对话开始（SSE start 帧的 canonical 型，OS-131）。
 * 与 run_started 的分工：agent_started 携带库侧元数据，投影出 daemon 现状 start 帧；
 * run_started 是 AG-UI 语义的轮次开始（无库侧字段），只进 AG-UI 出口。
 *
 * @typedef {object} AgentStartedEvent
 * @property {'agent_started'} type 事件类型。
 * @property {string} sessionId 会话标识（新建或续聊的那条）。
 * @property {string} runtime 运行时名（upstream.runtimeName，界面据此标注）。
 * @property {*} [applied] 本轮生效清单（运行时/技能/体裁/KB）；缺省＝cli/直连路径的
 *   start 帧就没有 applied 键。dsh-cli 路径恒传（promptBundle.applied）。
 */

/**
 * 系统告示（SSE notice 帧，daemon 自有附属帧，OS-131 补 canonical）。
 * 降级提示、DSH 会话失效重开这类「要给作者看的一句话」。
 *
 * @typedef {object} NoticeEvent
 * @property {'notice'} type 事件类型。
 * @property {string} text 告示文本。
 */

/**
 * 推理增量（SSE thinking 帧，OS-131 补 canonical）。
 * 模型的中文推理片段——永不进正文，与 message_chunk 分声道；投影层据此区分帧型。
 *
 * @typedef {object} ThinkingEvent
 * @property {'thinking'} type 事件类型。
 * @property {string} text 本片新增的推理文本。
 */

/**
 * token 用量（SSE usage 帧，OS-131 补 canonical）。
 * 字段形状以 dsh-cli.mjs 构造为准（恒五字段；usage.total 后补但恒在）。
 *
 * @typedef {object} UsageEvent
 * @property {'usage'} type 事件类型。
 * @property {number} input 输入 token 数。
 * @property {number} output 输出 token 数。
 * @property {number} cachedRead 缓存读 token 数。
 * @property {number} cachedWrite 缓存写 token 数。
 * @property {number} total 总量（input+output）。
 */

/**
 * @typedef {MessageChunkEvent|ToolCallEvent|StateUpdateEvent|RunStartedEvent|RunEndEvent
 *   |AgentStartedEvent|NoticeEvent|ThinkingEvent|UsageEvent} AgentEvent
 */

/**
 * @typedef {object} AguiEncodeCtx
 * @property {string} runId 帧公共字段：本轮运行标识（必填，非空）。
 * @property {number} seq 帧公共字段：本帧在本次运行内的序号（调用方自持递增；编码器透传不重排）。
 */

/**
 * 把一条内部事件编码成 AG-UI 帧。
 *
 * 帧公共字段 runId / ts / seq 每帧必有；ts 取编码时刻（Date.now()）。
 * 可选字段（done / callId / status / result）只在事件里真的给了才出现在帧上——
 * done:false 必须原样保留（见 MessageChunkEvent 注释）。
 * 字段形状是调用方的契约（见上 JSDoc）：编码器只做类型分发，不做深校验，
 * 但**未知事件类型如实 throw，绝不静默丢弃**。
 *
 * @param {AgentEvent} event 内部事件（canonical，见本文件头部五类定义）。
 * @param {AguiEncodeCtx} ctx 编码上下文：{runId, seq}。
 * @returns {object} AG-UI 帧（纯新对象，不共享内部引用——args/value/result 原样携带，
 *   调用方 JSON.stringify 前自行保证可序列化）。
 * @throws {TypeError} event 不是带 type 的对象、ctx.runId 缺失或 seq 不是非负安全整数。
 * @throws {RangeError} event.type 不在 AGENT_EVENT_TYPES 全集内（未知类型不静默）。
 */
export function encodeForAgui(event, ctx) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    throw new TypeError('encodeForAgui：事件必须是带 type 字符串字段的对象')
  }
  if (!ctx || typeof ctx !== 'object' || typeof ctx.runId !== 'string' || ctx.runId.trim() === '') {
    throw new TypeError('encodeForAgui：ctx.runId 必须是非空字符串')
  }
  if (!Number.isSafeInteger(ctx.seq) || ctx.seq < 0) {
    throw new TypeError(`encodeForAgui：ctx.seq 必须是非负安全整数，实际 ${ctx.seq}`)
  }
  const base = { runId: ctx.runId, ts: Date.now(), seq: ctx.seq }
  switch (event.type) {
    case 'message_chunk':
      return {
        ...base,
        kind: 'agent.message',
        text: event.text,
        ...(event.done !== undefined ? { done: event.done } : {})
      }
    case 'tool_call':
      return {
        ...base,
        kind: 'tool_call',
        toolName: event.toolName,
        args: event.args,
        ...(event.callId !== undefined ? { callId: event.callId } : {}),
        ...(event.status !== undefined ? { status: event.status } : {}),
        ...(event.result !== undefined ? { result: event.result } : {}),
        ...(event.resultIsError !== undefined ? { resultIsError: event.resultIsError } : {})
      }
    case 'state_update':
      return { ...base, kind: 'state_update', path: event.path, value: event.value }
    case 'run_started':
      return { ...base, kind: 'run.lifecycle', status: 'started' }
    case 'run_end':
      return { ...base, kind: 'run.lifecycle', status: event.status }
    default:
      throw new RangeError(`encodeForAgui：未知事件类型（不静默丢弃）：${event.type}`)
  }
}

/**
 * 把一条内部事件投影成 daemon 现状 SSE 旧帧（OS-131）。
 *
 * 忠实性承诺（对外帧形状一个字符不许变）：
 *   · 返回对象的字段与键序逐项照抄 daemon.mjs handleAgentChat 改前字面量——
 *     sseFrame 用 JSON.stringify 序列化，键序即线上字节序；
 *   · 键值 undefined 时 JSON.stringify 丢键——现状字面量里 applied / truncated 等
 *     「可能 undefined」的字段同样靠 stringify 丢键，两侧线上字节逐字符一致；
 *     本函数对象层面用条件展开表达同一语义。
 *   · 事件没带足投影字段（如 tool_call result 缺 resultIsError）时，帧上对应键值
 *     为 undefined（线上丢键）——daemon 各发帧点恒传全字段，注释如实声明即可。
 *
 * 无旧帧对应的类型如实 throw（绝不静默产帧）：
 *   · run_started / state_update：SSE 现状没有这两帧（AG-UI 专属型；start 帧走
 *     agent_started）；
 *   · run_end{status:'cancelled'}：取消时连接已断、现状不发任何帧；
 *   · 未知类型：模型演化后忘了补投影分支——停下来，别让新事件悄悄漏到线上。
 *
 * @param {AgentEvent} event 内部事件（canonical，见本文件头部九类定义）。
 * @returns {object} 旧帧对象（纯新对象，不共享内部引用）。
 * @throws {TypeError} event 不是带 type 字符串字段的对象。
 * @throws {RangeError} 类型无旧帧对应（含未知类型、cancelled 终态）。
 */
export function projectLegacyFrame(event) {
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') {
    throw new TypeError('projectLegacyFrame：事件必须是带 type 字符串字段的对象')
  }
  switch (event.type) {
    case 'agent_started':
      // 改前字面量：{ type: 'start', sessionId, runtime, applied }（cli/直连路径无 applied）
      return {
        type: 'start',
        sessionId: event.sessionId,
        runtime: event.runtime,
        ...(event.applied !== undefined ? { applied: event.applied } : {})
      }
    case 'notice':
      // 改前字面量：{ type: 'notice', text }
      return { type: 'notice', text: event.text }
    case 'thinking':
      // 改前字面量：{ type: 'thinking', text }
      return { type: 'thinking', text: event.text }
    case 'message_chunk':
      // 改前字面量：{ type: 'delta', text }。SSE delta 帧没有 done 概念——
      // 事件上的 done 是 AG-UI 出口的流结束标记，投影层一律不外泄（流结束由 done 帧承担）。
      return { type: 'delta', text: event.text }
    case 'tool_call':
      // 改前字面量：{ type: 'tool', phase: 'call', ...call } / { type: 'tool', phase: 'result', ...outcome }
      // call={id,name,input}、outcome={id,output,isError}（dsh-cli.mjs onToolCall/onToolResult 恒三键）
      // → canonical 字段名映射：callId→id、toolName→name、args→input、result→output、resultIsError→isError。
      // 键恒在（值可能 undefined→stringify 丢键，与 spread 语义一致）；result 帧恒无 name 键。
      if (event.status === 'result') {
        return {
          type: 'tool',
          phase: 'result',
          id: event.callId,
          output: event.result,
          isError: event.resultIsError
        }
      }
      return {
        type: 'tool',
        phase: 'call',
        id: event.callId,
        name: event.toolName,
        input: event.args
      }
    case 'usage':
      // 改前字面量：{ type: 'usage', ...usage }（usage 恒五字段，dsh-cli.mjs 构造序即此键序）
      return {
        type: 'usage',
        input: event.input,
        output: event.output,
        cachedRead: event.cachedRead,
        cachedWrite: event.cachedWrite,
        total: event.total
      }
    case 'run_end':
      if (event.status === 'completed') {
        // 改前字面量：{ type: 'done', sessionId, chars, ms, ...(truncated ? {truncated:true, stopReason} : {}) }
        // ms 缺省＝cli/直连路径的 done 帧本来就没有 ms 键
        return {
          type: 'done',
          sessionId: event.sessionId,
          chars: event.chars,
          ...(event.ms !== undefined ? { ms: event.ms } : {}),
          ...(event.truncated ? { truncated: true, stopReason: event.stopReason } : {})
        }
      }
      if (event.status === 'error') {
        // 改前字面量：{ type: 'error', error: { code, message } }
        return { type: 'error', error: { code: event.error?.code, message: event.error?.message } }
      }
      // cancelled：取消时连接已断、现状不发帧——不硬凑
      throw new RangeError('projectLegacyFrame：run_end status "cancelled" 无对应旧帧（取消路径不发帧，现状如此）')
    case 'run_started':
    case 'state_update':
      throw new RangeError(`projectLegacyFrame：类型 "${event.type}" 无旧帧对应（AG-UI 专属型；start 帧走 agent_started）`)
    default:
      throw new RangeError(`projectLegacyFrame：未知事件类型（不静默丢弃）：${event.type}`)
  }
}
