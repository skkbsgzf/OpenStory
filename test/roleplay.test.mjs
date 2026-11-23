/**
 * OS-97 扮演体系用例：提示词四层＋调度器编排（stub LLM，不真调模型）。
 *   node --test test/roleplay.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  ROLEPLAY_BASE_SYSTEM,
  hostSystemPrompt,
  actorSystemPrompt,
  worldFeedbackPrompt,
  parseHostDecision,
  fallbackActivation
} from '../src/modules/roleplay/roleplayPrompts.mjs'
import { roleplayTurn, worldbookDigestOf } from '../src/modules/roleplay/roleplayEngine.mjs'

test('提示词四层：底座铁律/主持人/角色 nudge/世界反馈人称', () => {
  assert.match(ROLEPLAY_BASE_SYSTEM, /不替其他角色/, '底座有越界禁令')
  const host = hostSystemPrompt({ worldbookDigest: '- 松木地板：藏尸处', premise: '第八夜', cast: [{ name: '老人' }], currentChapterLimit: 12 })
  assert.match(host, /主持人/)
  assert.match(host, /第 12 章/, '知识边界注入')
  assert.match(host, /只输出 JSON/)
  const actor = actorSystemPrompt({ name: '老人', identity: '同住者', instruction: '惊醒喝问', worldbookDigest: '', premise: '' })
  assert.match(actor, /\[Write the next reply only as 老人\.\]/, '酒馆口径 nudge')
  assert.match(actor, /不写别人的反应/)
  const fb = worldFeedbackPrompt({ pov: '叙述者', castBeats: [{ name: '老人', text: '「谁？」他坐起来。' }], playerAction: '我推门' })
  assert.match(fb, /对「你」说话/, 'OS-92 人称铁律')
})

test('裁决 JSON 解析：容错截取/坏 JSON 返回 null', () => {
  const ok = parseHostDecision('noise {"cast":[{"name":"老人","instruction":"喝问"}]} tail')
  assert.deepEqual(ok, { cast: [{ name: '老人', instruction: '喝问' }] })
  assert.equal(parseHostDecision('不是 JSON'), null)
  assert.equal(parseHostDecision('{"cast":[{"instruction":"没有名字"}]}').cast.length, 0, '无名条目剔除')
})

test('保底激活三档：mention 点名/roundrobin 轮换/fill 补位', () => {
  assert.deepEqual(fallbackActivation({ castNames: ['老人', '警察'], lastText: '你朝老人喊了一声' }), ['老人'])
  assert.deepEqual(fallbackActivation({ castNames: ['老人', '警察'], lastText: '', mode: 'roundrobin' }), ['老人'])
  const rr2 = fallbackActivation({ castNames: ['老人', '警察'], lastText: '', lastServed: ['老人'], mode: 'roundrobin' })
  assert.deepEqual(rr2, ['警察'])
  assert.deepEqual(fallbackActivation({ castNames: ['老人', '警察'], lastServed: ['警察'], mode: 'fill' }), ['老人'])
})

test('调度器：主持人裁决→角色各自成文→世界反馈（3 次调用链）', async () => {
  const calls = []
  const chatComplete = async (prompt) => {
    calls.push(prompt)
    if (calls.length === 1) return '{"cast":[{"name":"老人","instruction":"被灯光惊醒，喝问是谁"},{"name":"幽灵","instruction":"不该登场"}]}'
    return calls.length === 2 ? '「谁？」老人坐起来，手里的拐杖敲了两下床沿。' : '你推开房门，灯光扫过床沿。老人坐起身，拐杖敲着床沿：「谁？」'
  }
  const r = await roleplayTurn({
    chatComplete,
    entries: [{ name: '松木地板夹层', definition: '藏尸处' }],
    premise: '第八夜',
    cast: [{ name: '老人', identity: '同住者' }, { name: '叙述者', identity: 'POV 本人' }],
    playerAction: '我端着灯推开他的房门',
    pov: '叙述者'
  })
  assert.equal(r.ok, true)
  assert.equal(calls.length, 3, '裁决+演员+收束=3 次')
  assert.equal(r.beats.length, 1, '幽灵不在 cast 里被剔除；玩家 POV 不自演')
  assert.equal(r.beats[0].name, '老人')
  assert.match(r.feedback, /你推开房门/, '世界反馈对「你」说话')
  assert.match(calls[0], /松木地板夹层/, '世界书注入主持人')
  assert.match(calls[1], /only as 老人/, '角色 nudge')
})

test('调度器：模型全挂→ok:false 如实报；主持人裁决坏 JSON→确定性保底仍有一幕', async () => {
  const dead = async () => { throw new Error('down') }
  const r1 = await roleplayTurn({ chatComplete: dead, cast: [{ name: '老人' }], playerAction: '推门', pov: '叙述者' })
  assert.equal(r1.ok, false)
  assert.ok(r1.error)
  // 主持人挂但角色可用：裁决走保底
  let n = 0
  const hostOnlyDead = async () => { n += 1; if (n === 1) throw new Error('host down'); return '「谁在那儿？」' }
  const r2 = await roleplayTurn({ chatComplete: hostOnlyDead, cast: [{ name: '老人' }], playerAction: '推门', pov: '叙述者' })
  assert.equal(r2.ok, true)
  assert.equal(r2.beats.length, 1, '保底激活让老人登场')
})

test('世界书摘要：限条数、空条目剔除', () => {
  const digest = worldbookDigestOf([
    { name: '夹层', definition: '藏尸处' },
    { name: '', definition: '无名剔除' },
    { name: '第八夜', desc: '杀意定局' }
  ], { limit: 1 })
  assert.equal(digest.split('\n').length, 1)
  assert.match(digest, /夹层/)
})

test('世界反馈带情境分支（OS-98）：正文与「>」选项拆开', async () => {
  const chatComplete = async (prompt) => {
    if (prompt.includes('收束')) return '你推开门，灯影里那只眼睁开了。\n\n> 我举灯走近看那只眼\n> 我退回门口装作什么都没发生\n> 我开口唤他'
    if (prompt.includes('主持人')) return '{"cast":[{"name":"老人","instruction":"惊醒"}]}'
    return '「谁？」'
  }
  const r = await roleplayTurn({
    chatComplete,
    cast: [{ name: '老人', identity: '同住者' }],
    playerAction: '我推门',
    pov: '叙述者'
  })
  assert.equal(r.ok, true)
  assert.doesNotMatch(r.feedback, /^>/m, '反馈正文不含分支行')
  assert.deepEqual(r.options, ['我举灯走近看那只眼', '我退回门口装作什么都没发生', '我开口唤他'])
})

test('扮演开场（OS-100）：主持人拉开第一幕＋三条初始分支', async () => {
  const { roleplayOpening } = await import('../src/modules/roleplay/roleplayEngine.mjs')
  const { openingPrompt } = await import('../src/modules/roleplay/roleplayPrompts.mjs')
  const p = openingPrompt({ pov: '叙述者', premise: '第八夜', worldbookDigest: '- 夹层：藏尸处', cast: [{ name: '老人', identity: '同住者' }], openingDetail: '起意' })
  assert.match(p, /扮演 叙述者/)
  assert.match(p, /时间\/地点\/身体感受/)
  assert.match(p, /起意/, '开场锚点注入')
  const stub = async () => '深夜。油灯铺开一片昏黄。\n\n> 我俯身去看\n> 我后退一步\n> 我停在原地'
  const r = await roleplayOpening({ chatComplete: stub, entries: [{ name: '夹层', definition: '藏尸处' }], cast: [{ name: '老人' }], pov: '叙述者', openingDetail: '起意' })
  assert.equal(r.ok, true)
  assert.match(r.feedback, /深夜/)
  assert.equal(r.options.length, 3)
  // 模型挂→如实失败
  const dead = await roleplayOpening({ chatComplete: async () => { throw new Error('x') }, pov: '叙述者' })
  assert.equal(dead.ok, false)
})

test('长期记忆（OS-102）：摘要＋最近明细＋压缩阈值', async () => {
  const { buildRoleplayMemory, shouldSummarize, compressMemory } = await import('../src/modules/roleplay/roleplayEngine.mjs')
  const { summaryPrompt } = await import('../src/modules/roleplay/roleplayPrompts.mjs')
  const mk = (n) => ({ rollingSummary: null, nodes: Array.from({ length: n }, (_, i) => ({ round: i + 1, prose: `第${i + 1}拍正文`, choiceId: 'custom', candidates: [{ id: 'custom', text: `动作${i + 1}` }], beats: [] })) })
  const s8 = mk(8)
  const mem = buildRoleplayMemory(s8)
  assert.equal(mem.freshCount, 8)
  assert.match(mem.recentText, /第8拍/)
  assert.equal(mem.summaryText, '', '无摘要时没有长期记忆段')
  // 阈值：攒够 6 拍才压
  assert.equal(shouldSummarize(mk(5), { every: 6 }), false)
  assert.equal(shouldSummarize(mk(6), { every: 6 }), true)
  // 压缩：覆盖到第 6 拍，之后 recent 只剩 7-8
  const stub = async () => '- 玩家连续推进六拍'
  const r = await compressMemory({ chatComplete: stub, session: s8, batch: 6 })
  assert.equal(r.ok, true)
  assert.equal(r.rollingSummary.coveredToRound, 6)
  const s2 = { ...s8, rollingSummary: r.rollingSummary }
  const mem2 = buildRoleplayMemory(s2)
  assert.match(mem2.summaryText, /长期记忆/)
  assert.doesNotMatch(mem2.recentText, /第1拍/)
  assert.match(mem2.recentText, /第8拍/)
  // 提示词含旧摘要段与压缩规则
  const p = summaryPrompt({ prevSummary: '- 旧', nodes: [{ round: 7, prose: 'x' }], coveredFrom: 7, coveredTo: 7 })
  assert.match(p, /旧摘要/)
  assert.match(p, /不要编造/)
})

test('AI 味过检（OS-102）：超阈重写、干净稿直通、模型挂保留原稿', async () => {
  const { deAiPass } = await import('../src/modules/roleplay/roleplayEngine.mjs')
  // 套话堆砌：必须触发重写
  const cliche = '他轻轻地缓缓地走向窗边，仿佛有什么在召唤他。不禁感叹，似乎一切都值得回味。深深地吸了一口气。'
  let calls = 0
  const r = await deAiPass({ chatComplete: async () => { calls++; return '他走到窗边。风把帘子掀起来。' }, prose: cliche })
  assert.equal(r.rewritten, true, '高 AI 味稿应重写')
  assert.equal(calls, 1, '只重写一次，不无限循环')
  assert.match(r.text, /风把帘子掀起来/)
  assert.ok(Number(r.before?.score) > 45, '原稿分应超阈：' + r.before?.score)
  // 干净稿：不调模型
  let called = 0
  const r2 = await deAiPass({ chatComplete: async () => { called++; return 'x' }, prose: '他走到窗边，把帘子掀开一条缝。外头没人。' })
  assert.equal(r2.rewritten, false)
  assert.equal(called, 0)
  // 模型挂：保留原稿，不炸
  const r3 = await deAiPass({ chatComplete: async () => { throw new Error('down') }, prose: cliche })
  assert.equal(r3.rewritten, false)
  assert.equal(r3.text, cliche)
})
