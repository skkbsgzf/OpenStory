/**
 * AG-UI 协议出口单测（OS-128）。
 * 重点：五种内部事件各一例（帧 kind / 公共字段 / 字段透传）；
 * seq 从 ctx 透传可递增；done 语义——缺省不出现、false 不被真值判断吞掉；
 * 未知事件类型如实 throw（不静默）。
 * 纯函数测试：不碰 daemon/SSE（本批 streamChat/SSE 零改动是规格的一部分）。
 */
import { strict as assert } from 'node:assert'
import test from 'node:test'
import { AGENT_EVENT_TYPES, encodeForAgui } from '../agentEvents.mjs'

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
