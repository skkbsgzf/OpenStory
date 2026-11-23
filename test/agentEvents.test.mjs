/**
 * AG-UI 协议出口单测（OS-128）。
 * 重点：五种内部事件各一例（帧 kind / 公共字段 / 字段透传）；
 * seq 从 ctx 透传可递增；done 语义——缺省不出现、false 不被真值判断吞掉；
 * 未知事件类型如实 throw（不静默）。
 * 纯函数测试：不碰 daemon/SSE（本批 streamChat/SSE 零改动是规格的一部分）。
 * OS-131 追加：projectLegacyFrame 逐类型断言——投影对象与 daemon 改前手拼的旧帧
 * 字面量逐字段相同（字段、键序、undefined 丢键的线上字节语义）。
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { AGENT_EVENT_TYPES, AGENT_EVENT_TYPES_SSE, AGENT_EVENT_AGUI_KINDS, encodeForAgui, projectLegacyFrame } from '../src/protocol/agentEvents.mjs'

const ctx = (seq) => ({ runId: 'run-20260301-01', seq })

test('message_chunk → agent.message：kind/text/公共字段齐全', () => {
  const frame = encodeForAgui({ type: 'message_chunk', text: '第三章开头：' }, ctx(3))
  assert.equal(frame.kind, 'agent.message')
  assert.equal(frame.text, '第三章开头：')
  assert.equal(frame.runId, 'run-20260301-01')
  assert.equal(frame.seq, 3)
  assert.equal(typeof frame.ts, 'number')
  assert.ok(frame.ts > 0, `ts 应为正的时间戳，实际 ${frame.ts}`)
  assert.equal(frame.done, undefined, 'done 缺省时帧上不应有该键的值')
})

test('tool_call → tool_call：callId/status/result 全量透传（result 一例）', () => {
  const event = {
    type: 'tool_call',
    toolName: 'chapter_write',
    args: { file: '正文/003-第三章.md' },
    callId: 'call-7',
    status: 'result',
    result: { ok: true, chars: 2400 }
  }
  const frame = encodeForAgui(event, ctx(4))
  assert.equal(frame.kind, 'tool_call')
  assert.equal(frame.toolName, 'chapter_write')
  assert.deepEqual(frame.args, { file: '正文/003-第三章.md' })
  assert.equal(frame.callId, 'call-7')
  assert.equal(frame.status, 'result')
  assert.deepEqual(frame.result, { ok: true, chars: 2400 })
  assert.equal(frame.runId, 'run-20260301-01')
  assert.equal(frame.seq, 4)
})

test('tool_call：可选字段缺省时帧上不出现（最简 call 一例）', () => {
  const frame = encodeForAgui(
    { type: 'tool_call', toolName: 'reference_search', args: { query: '沈小楼' } },
    ctx(0)
  )
  assert.equal(frame.kind, 'tool_call')
  assert.equal(frame.status, undefined)
  assert.ok(!('callId' in frame), 'callId 缺省不应出现在帧上')
  assert.ok(!('result' in frame), 'result 缺省不应出现在帧上')
  assert.equal(frame.seq, 0, 'seq 0 是合法起始序号')
})

test('state_update → state_update：path/value 透传', () => {
  const frame = encodeForAgui(
    { type: 'state_update', path: 'outline.chapter3.status', value: 'drafting' },
    ctx(5)
  )
  assert.equal(frame.kind, 'state_update')
  assert.equal(frame.path, 'outline.chapter3.status')
  assert.equal(frame.value, 'drafting')
  assert.equal(frame.runId, 'run-20260301-01')
  assert.equal(frame.seq, 5)
})

test('run_started → run.lifecycle started（不重复输出 runId 字段）', () => {
  const frame = encodeForAgui({ type: 'run_started', runId: 'run-20260301-01' }, ctx(0))
  assert.equal(frame.kind, 'run.lifecycle')
  assert.equal(frame.status, 'started')
  assert.equal(frame.runId, 'run-20260301-01', '帧 runId 取 ctx.runId 公共字段')
  assert.ok(!('text' in frame))
})

test('run_end → run.lifecycle 透传 status（error 一例）', () => {
  const frame = encodeForAgui(
    { type: 'run_end', runId: 'run-20260301-01', status: 'error' },
    ctx(9)
  )
  assert.equal(frame.kind, 'run.lifecycle')
  assert.equal(frame.status, 'error')
  assert.equal(frame.seq, 9)
})

test('seq 从 ctx 透传：连续编码按调用方给的序号递增', () => {
  let seq = 0
  const frames = [
    encodeForAgui({ type: 'run_started', runId: 'r1' }, { runId: 'r1', seq: seq++ }),
    encodeForAgui({ type: 'message_chunk', text: '第一片' }, { runId: 'r1', seq: seq++ }),
    encodeForAgui({ type: 'message_chunk', text: '第二片', done: true }, { runId: 'r1', seq: seq++ }),
    encodeForAgui({ type: 'run_end', runId: 'r1', status: 'completed' }, { runId: 'r1', seq: seq++ })
  ]
  assert.deepEqual(frames.map((f) => f.seq), [0, 1, 2, 3])
  for (let i = 1; i < frames.length; i++) {
    assert.equal(frames[i].seq, frames[i - 1].seq + 1, `第 ${i} 帧序号应比前一帧大 1`)
  }
  // 同一 run 内 runId 一致；ts 单调不回退（同一毫秒允许相等）
  assert.ok(frames.every((f) => f.runId === 'r1'))
  for (let i = 1; i < frames.length; i++) {
    assert.ok(frames[i].ts >= frames[i - 1].ts, 'ts 不应回退')
  }
})

test('done 语义：false 必须原样保留，不被真值判断吞掉；true 到帧', () => {
  const notDone = encodeForAgui({ type: 'message_chunk', text: '…', done: false }, ctx(1))
  assert.ok('done' in notDone, '显式 done:false 应出现在帧上')
  assert.equal(notDone.done, false)
  const done = encodeForAgui({ type: 'message_chunk', text: '…', done: true }, ctx(2))
  assert.equal(done.done, true)
  const absent = encodeForAgui({ type: 'message_chunk', text: '…' }, ctx(3))
  assert.ok(!('done' in absent), 'done 缺省时帧上不应有 done 键（与显式 false 区分）')
})

test('未知事件类型如实 throw（RangeError，不静默丢帧）', () => {
  assert.throws(
    () => encodeForAgui({ type: 'usage', input: 1, output: 2 }, ctx(0)),
    (err) => err instanceof RangeError && /未知事件类型/.test(err.message)
  )
  assert.throws(
    () => encodeForAgui({ type: 'notice', text: '降级提示' }, ctx(0)),
    /未知事件类型/,
    'SSE 自有附属帧（notice/usage）也属未知：canonical 五类之外一律 throw'
  )
})

test('畸形输入如实 throw：无 type、ctx.runId 缺失、seq 非法', () => {
  assert.throws(() => encodeForAgui(null, ctx(0)), TypeError)
  assert.throws(() => encodeForAgui({ text: '没 type' }, ctx(0)), TypeError)
  assert.throws(() => encodeForAgui({ type: 'message_chunk', text: 'x' }, { seq: 0 }), TypeError)
  assert.throws(
    () => encodeForAgui({ type: 'message_chunk', text: 'x' }, { runId: 'r', seq: 1.5 }),
    TypeError,
    'seq 必须是非负安全整数'
  )
  assert.throws(
    () => encodeForAgui({ type: 'message_chunk', text: 'x' }, { runId: 'r', seq: -1 }),
    TypeError
  )
})

test('AGENT_EVENT_TYPES 全集＝五类 canonical，冻结不可扩', () => {
  assert.deepEqual([...AGENT_EVENT_TYPES], [
    'message_chunk', 'tool_call', 'state_update', 'run_started', 'run_end'
  ])
  assert.throws(() => { AGENT_EVENT_TYPES.push('usage') }, '全集冻结：新增类型必须走代码分支')
})

/* ---------- projectLegacyFrame：旧帧投影逐类型忠实断言（OS-131） ----------
 * 旧帧字面量逐字照抄 daemon.mjs handleAgentChat 改前形状（金样对照基准）：
 *   start   { type:'start', sessionId, runtime, applied }      dsh-cli 路径
 *   start   { type:'start', sessionId, runtime }               cli/直连路径
 *   notice  { type:'notice', text }
 *   thinking{ type:'thinking', text }
 *   tool    { type:'tool', phase:'call', id, name, input }     （dsh-cli call 恒三键 spread）
 *   tool    { type:'tool', phase:'result', id, output, isError }（outcome 恒三键 spread）
 *   usage   { type:'usage', ...usage }                          usage={input,output,cachedRead,cachedWrite,total}
 *   delta   { type:'delta', text }
 *   done    { type:'done', sessionId, chars, ms, ...(truncated?{truncated:true,stopReason}:{}) }
 *   done    { type:'done', sessionId, chars }                   cli/直连路径（无 ms）
 *   error   { type:'error', error:{code,message} }
 */

test('agent_started → start 帧：带 applied（dsh-cli 路径），字段与键序照抄旧字面量', () => {
  const applied = { runtime: 'dsh', skills: ['第一章'] }
  const frame = projectLegacyFrame({ type: 'agent_started', sessionId: 's-1', runtime: 'od-pro', applied })
  assert.deepEqual(frame, { type: 'start', sessionId: 's-1', runtime: 'od-pro', applied })
  assert.deepEqual(Object.keys(frame), ['type', 'sessionId', 'runtime', 'applied'], '键序即线上字节序')
})

test('agent_started → start 帧：applied 缺省＝无 applied 键（cli/直连路径），线上字节与改前一致', () => {
  const frame = projectLegacyFrame({ type: 'agent_started', sessionId: 's-1', runtime: 'pi' })
  assert.deepEqual(frame, { type: 'start', sessionId: 's-1', runtime: 'pi' })
  assert.ok(!('applied' in frame), 'applied 缺省不应出现在帧对象上')
  // 改前字面量在 applied=undefined 时靠 JSON.stringify 丢键——投影的线上字节必须相同
  const before = JSON.stringify({ type: 'start', sessionId: 's-1', runtime: 'pi', applied: undefined })
  assert.equal(JSON.stringify(frame), before)
})

test('notice → notice 帧：type/text，键序照抄', () => {
  const frame = projectLegacyFrame({ type: 'notice', text: '上轮 DSH 会话已失效，已无缝重开一段。' })
  assert.deepEqual(frame, { type: 'notice', text: '上轮 DSH 会话已失效，已无缝重开一段。' })
  assert.deepEqual(Object.keys(frame), ['type', 'text'])
})

test('thinking → thinking 帧：type/text', () => {
  const frame = projectLegacyFrame({ type: 'thinking', text: '（先想开头）' })
  assert.deepEqual(frame, { type: 'thinking', text: '（先想开头）' })
  assert.deepEqual(Object.keys(frame), ['type', 'text'])
})

test('message_chunk → delta 帧：text 透传；done 不外泄（SSE 流结束由 done 帧承担）', () => {
  const frame = projectLegacyFrame({ type: 'message_chunk', text: '雾从水面漫上来' })
  assert.deepEqual(frame, { type: 'delta', text: '雾从水面漫上来' })
  assert.deepEqual(Object.keys(frame), ['type', 'text'])
  const withDone = projectLegacyFrame({ type: 'message_chunk', text: '…', done: true })
  assert.ok(!('done' in withDone), 'done 是 AG-UI 出口语义，旧 delta 帧没有这个键')
})

test('tool_call status=call → tool 帧：canonical 字段名映射回旧名（id/name/input），键序照抄', () => {
  const frame = projectLegacyFrame({
    type: 'tool_call', toolName: 'read_file', args: { file: '正文/001-第一章.md' }, callId: 'call-1', status: 'call'
  })
  // 改前字面量：{ type:'tool', phase:'call', ...call }，call={id,name,input}
  assert.deepEqual(frame, { type: 'tool', phase: 'call', id: 'call-1', name: 'read_file', input: { file: '正文/001-第一章.md' } })
  assert.deepEqual(Object.keys(frame), ['type', 'phase', 'id', 'name', 'input'])
})

test('tool_call status=result → tool 帧：result→output、resultIsError→isError，恒无 name 键', () => {
  const frame = projectLegacyFrame({
    type: 'tool_call', callId: 'call-1', status: 'result', result: '正文内容……', resultIsError: false
  })
  // 改前字面量：{ type:'tool', phase:'result', ...outcome }，outcome={id,output,isError}
  assert.deepEqual(frame, { type: 'tool', phase: 'result', id: 'call-1', output: '正文内容……', isError: false })
  assert.deepEqual(Object.keys(frame), ['type', 'phase', 'id', 'output', 'isError'], 'outcome 无 name 键，投影不得多给')
})

test('usage → usage 帧：五字段俱全，键序＝dsh-cli 构造序（input/output/cachedRead/cachedWrite/total）', () => {
  const frame = projectLegacyFrame({ type: 'usage', input: 12, output: 34, cachedRead: 0, cachedWrite: 5, total: 46 })
  assert.deepEqual(frame, { type: 'usage', input: 12, output: 34, cachedRead: 0, cachedWrite: 5, total: 46 })
  assert.deepEqual(Object.keys(frame), ['type', 'input', 'output', 'cachedRead', 'cachedWrite', 'total'])
})

test('run_end completed（dsh-cli 路径）→ done 帧：ms＋truncated/stopReason，键序照抄', () => {
  const frame = projectLegacyFrame({
    type: 'run_end', status: 'completed', runId: 'r1', sessionId: 's-1', chars: 240, ms: 1500,
    truncated: true, stopReason: 'max_tokens'
  })
  assert.deepEqual(frame, { type: 'done', sessionId: 's-1', chars: 240, ms: 1500, truncated: true, stopReason: 'max_tokens' })
  assert.deepEqual(Object.keys(frame), ['type', 'sessionId', 'chars', 'ms', 'truncated', 'stopReason'])
})

test('run_end completed：truncated 非真值＝无 truncated/stopReason 键（真值判断语义照抄）', () => {
  const frame = projectLegacyFrame({
    type: 'run_end', status: 'completed', sessionId: 's-1', chars: 240, ms: 1500, truncated: false
  })
  assert.deepEqual(frame, { type: 'done', sessionId: 's-1', chars: 240, ms: 1500 })
  assert.ok(!('truncated' in frame) && !('stopReason' in frame))
})

test('run_end completed（cli/直连路径）→ done 帧：无 ms 键', () => {
  const frame = projectLegacyFrame({ type: 'run_end', status: 'completed', sessionId: 's-2', chars: 7 })
  assert.deepEqual(frame, { type: 'done', sessionId: 's-2', chars: 7 })
  assert.deepEqual(Object.keys(frame), ['type', 'sessionId', 'chars'], 'cli/直连路径的 done 帧本来就没有 ms')
  assert.equal(JSON.stringify(frame), JSON.stringify({ type: 'done', sessionId: 's-2', chars: 7 }))
})

test('run_end error → error 帧：error 对象透传 code/message', () => {
  const frame = projectLegacyFrame({
    type: 'run_end', status: 'error', runId: 'r1', error: { code: 'AGENT_UPSTREAM_ERROR', message: 'DSH 无输出' }
  })
  assert.deepEqual(frame, { type: 'error', error: { code: 'AGENT_UPSTREAM_ERROR', message: 'DSH 无输出' } })
  assert.deepEqual(Object.keys(frame), ['type', 'error'])
  assert.deepEqual(Object.keys(frame.error), ['code', 'message'])
})

test('run_end cancelled、run_started、state_update 均无旧帧对应：如实 throw 不硬凑', () => {
  assert.throws(
    () => projectLegacyFrame({ type: 'run_end', status: 'cancelled' }),
    (err) => err instanceof RangeError && /cancelled/.test(err.message),
    '取消时连接已断、现状不发帧'
  )
  assert.throws(
    () => projectLegacyFrame({ type: 'run_started', runId: 'r1' }),
    /无旧帧对应/,
    'start 帧走 agent_started；run_started 是 AG-UI 专属型'
  )
  assert.throws(
    () => projectLegacyFrame({ type: 'state_update', path: 'a.b', value: 1 }),
    /无旧帧对应/,
    'SSE 现状没有状态面帧'
  )
})

test('projectLegacyFrame：畸形输入与未知类型如实 throw', () => {
  assert.throws(() => projectLegacyFrame(null), TypeError)
  assert.throws(() => projectLegacyFrame({ text: '没 type' }), TypeError)
  assert.throws(
    () => projectLegacyFrame({ type: 'usage_v2', input: 1 }),
    (err) => err instanceof RangeError && /未知事件类型/.test(err.message),
    '模型演化后忘了补投影分支＝停下来，不静默产帧'
  )
})

test('线上字节逐字符一致：projectLegacyFrame 与改前手拼字面量的 JSON.stringify 全等', () => {
  // 每型一例，键值 undefined 的键两侧同样靠 stringify 丢键
  const cases = [
    [projectLegacyFrame({ type: 'agent_started', sessionId: 's-1', runtime: 'od-pro', applied: { k: 'v' } }),
      { type: 'start', sessionId: 's-1', runtime: 'od-pro', applied: { k: 'v' } }],
    [projectLegacyFrame({ type: 'agent_started', sessionId: 's-1', runtime: 'od-pro', applied: undefined }),
      { type: 'start', sessionId: 's-1', runtime: 'od-pro', applied: undefined }],
    [projectLegacyFrame({ type: 'notice', text: '降级提示' }), { type: 'notice', text: '降级提示' }],
    [projectLegacyFrame({ type: 'thinking', text: '想' }), { type: 'thinking', text: '想' }],
    [projectLegacyFrame({ type: 'message_chunk', text: '正文' }), { type: 'delta', text: '正文' }],
    [projectLegacyFrame({ type: 'tool_call', toolName: 't', args: null, callId: '', status: 'call' }),
      { type: 'tool', phase: 'call', id: '', name: 't', input: null }],
    [projectLegacyFrame({ type: 'tool_call', callId: 'c1', status: 'result', result: 'out', resultIsError: true }),
      { type: 'tool', phase: 'result', id: 'c1', output: 'out', isError: true }],
    [projectLegacyFrame({ type: 'usage', input: 1, output: 2, cachedRead: 0, cachedWrite: 3, total: 3 }),
      { type: 'usage', input: 1, output: 2, cachedRead: 0, cachedWrite: 3, total: 3 }],
    [projectLegacyFrame({ type: 'run_end', status: 'completed', sessionId: 's-1', chars: 9, ms: 42 }),
      { type: 'done', sessionId: 's-1', chars: 9, ms: 42 }],
    [projectLegacyFrame({ type: 'run_end', status: 'completed', sessionId: 's-1', chars: 9, ms: 42, truncated: true, stopReason: undefined }),
      { type: 'done', sessionId: 's-1', chars: 9, ms: 42, truncated: true, stopReason: undefined }],
    [projectLegacyFrame({ type: 'run_end', status: 'error', error: { code: 'E', message: 'm' } }),
      { type: 'error', error: { code: 'E', message: 'm' } }]
  ]
  for (const [wired, legacy] of cases) {
    assert.equal(JSON.stringify(wired), JSON.stringify(legacy), `线上字节不一致：${JSON.stringify(legacy)}`)
  }
})

test('AGENT_EVENT_TYPES_SSE＝四类 SSE 附属型，冻结；九类全集与 AGUI_KINDS 映射表对齐', () => {
  assert.deepEqual([...AGENT_EVENT_TYPES_SSE], ['agent_started', 'notice', 'thinking', 'usage'])
  assert.throws(() => { AGENT_EVENT_TYPES_SSE.push('delta') }, '附属词表同样冻结')
  // 全集＝五类＋附属四类，不多不少
  const all = [...AGENT_EVENT_TYPES, ...AGENT_EVENT_TYPES_SSE].sort()
  assert.deepEqual(all, Object.keys(AGENT_EVENT_AGUI_KINDS).sort(), '映射表必须覆盖全部内部事件类型')
  // 无 AG-UI 对应的附属型用自定义 kind（x-openstory.*），映射表里如实声明
  assert.equal(AGENT_EVENT_AGUI_KINDS.notice, 'x-openstory.notice')
  assert.equal(AGENT_EVENT_AGUI_KINDS.thinking, 'x-openstory.thinking')
  assert.equal(AGENT_EVENT_AGUI_KINDS.usage, 'x-openstory.usage')
  assert.equal(AGENT_EVENT_AGUI_KINDS.agent_started, 'run.lifecycle', 'agent_started 语义＝AG-UI run started')
})

test('映射表与 encodeForAgui 输出一致（五类，防两处 kind 漂移）', () => {
  const ctx = { runId: 'r', seq: 0 }
  assert.equal(encodeForAgui({ type: 'message_chunk', text: 'x' }, ctx).kind, AGENT_EVENT_AGUI_KINDS.message_chunk)
  assert.equal(encodeForAgui({ type: 'tool_call', toolName: 't', args: {} }, ctx).kind, AGENT_EVENT_AGUI_KINDS.tool_call)
  assert.equal(encodeForAgui({ type: 'state_update', path: 'a', value: 1 }, ctx).kind, AGENT_EVENT_AGUI_KINDS.state_update)
  assert.equal(encodeForAgui({ type: 'run_started' }, ctx).kind, AGENT_EVENT_AGUI_KINDS.run_started)
  assert.equal(encodeForAgui({ type: 'run_end', status: 'completed' }, ctx).kind, AGENT_EVENT_AGUI_KINDS.run_end)
})
