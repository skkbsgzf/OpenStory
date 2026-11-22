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
 * SSE 现状 → canonical 的投影对照（只作参照，不代表已接线）：
 *   SSE start             → run_started
 *   SSE delta / thinking  → message_chunk（thinking 不进正文，投影层自行区分）
 *   SSE tool phase=call   → tool_call{status:'call'}
 *   SSE tool phase=result → tool_call{status:'result', result}
 *   SSE done              → run_end{status:'completed'}
 *   SSE error             → run_end{status:'error'}
 *   SSE notice / usage    → 暂无 canonical 对应（daemon 自有附属帧，如实列出，不硬凑）
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
 */

/**
 * @typedef {MessageChunkEvent|ToolCallEvent|StateUpdateEvent|RunStartedEvent|RunEndEvent} AgentEvent
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
