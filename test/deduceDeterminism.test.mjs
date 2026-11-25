/**
 * OS-155 推演链归位护栏（node:test，零依赖）——引擎搬到 `src/modules/deduce/engine/` 之后：
 *
 *   ① 确定性：同种子＋同事实包＝同一拍（两种子，逐字段锁：局面卡/张力/候选/场景上下文）；
 *   ② patchChannel 幂等：同一事件回写两次＝一条（同 id、reconcile 判 same-id 重复）；
 *   ③ fronts 只进不退：时钟格数单调不减，满格后不再涨、结掉后拒推进；
 *   ④ llmPort 三种形态：正常 propose / 返回 null / 返回坏形状——行为分别是什么，且都不得抛。
 *
 * ④ 走 `deduceEngine.deducePresent`（形状校验发生在封装层）；①②③ 走引擎端子本体（纯内存）。
 * 落盘只用临时夹具库（mkdtemp），绝不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { openDeduceSession, presentTurn } from '../src/modules/deduce/engine/index.mjs'
import { buildWorldbookPatch, reconcilePatches } from '../src/modules/deduce/engine/patchChannel.mjs'
import { createFront, advanceFront, resolveFront } from '../src/modules/deduce/engine/fronts.mjs'
import { deducePresent } from '../src/modules/deduce/deduceEngine.mjs'

const ENTRIES = [
  { schema: 'fact.data/v3', id: 'w1', layer: 'worldview', name: '雾港规则', slot: 'rules', status: 'adopted',
    definition: '雾起时渡口不开船。',
    fronts: { name: '封渡之雾', threat: '雾越浓，渡口越像坟场', danger: 'high', max: 4, idleThreshold: 2, trigger: '雾漫上街' } },
  { schema: 'fact.data/v3', id: 'w2', layer: 'worldview', name: '灵潮', slot: 'power_levels', rank: 1, status: 'adopted', definition: '每逢甲子灵气暴涨。' },
  { schema: 'fact.data/v3', id: 'c1', layer: 'character', name: '林砚', status: 'adopted', definition: '雾港的摆渡人。', appearances: 9,
    castRole: { tier: 'protagonist' },
    knowledge: [
      { fromEntry: '雾港规则', kind: 'learned', atSpan: { from: 1, to: 1 } },
      { fromEntry: '沈禾', kind: 'learned', atSpan: { from: 1, to: 1 } },
      { fromEntry: '青浦渡口', kind: 'learned', atSpan: { from: 1, to: 1 } }
    ] },
  { schema: 'fact.data/v3', id: 'c2', layer: 'character', name: '沈禾', status: 'adopted', definition: '守灯人。', appearances: 4, castRole: { tier: 'supporting' } },
  { schema: 'fact.data/v3', id: 'c3', layer: 'character', name: '老周', status: 'adopted', definition: '船工。', appearances: 2, castRole: { tier: 'minor' } },
  { schema: 'fact.data/v3', id: 'l1', layer: 'location', name: '青浦渡口', status: 'adopted', definition: '故事发生地。' },
  { schema: 'fact.data/v3', id: 'p1', layer: 'plot', name: '第1拍·雾里有人', status: 'adopted', hypothesis: true, open: true,
    definition: '雾里传来桨声，却不见船。', validity: { from: 1, to: null } }
]

/** 开一局并推进一拍（每次全新会话对象，保证不串状态）。 */
function oneTurn(seed) {
  const opened = openDeduceSession({ entries: ENTRIES, pov: '林砚', runId: 'os155-determinism' })
  return presentTurn({ state: opened.state, entries: ENTRIES, pov: '林砚', seed })
}

/* ---------- ① 同种子＋同事实包＝同一拍 ---------- */

const GOLDEN = {
  1: {
    sceneCard: { who: ['林砚', '沈禾'], where: '未标记地点', tension: '封渡之雾 0/4', hook: '伏笔·雾里传来桨声，却不见船。' },
    tension: { version: 'fronts-clock@1', active: 1, resolved: 0, heat: 0, level: 'low', filled: [] },
    candidates: [
      { id: 'necessity-w1', source: '必然', text: '雾港规则——雾起时渡口不开船。', trace: null },
      { id: 'fate-1-0', source: '命运', text: '剧情检定 2d6=4+1=5：受阻', trace: { a: 4, b: 1, sum: 5, success: false } }
    ]
  },
  424242: {
    sceneCard: { who: ['林砚', '沈禾'], where: '未标记地点', tension: '封渡之雾 0/4', hook: '伏笔·雾里传来桨声，却不见船。' },
    tension: { version: 'fronts-clock@1', active: 1, resolved: 0, heat: 0, level: 'low', filled: [] },
    candidates: [
      { id: 'necessity-w1', source: '必然', text: '雾港规则——雾起时渡口不开船。', trace: null },
      { id: 'fate-1-0', source: '命运', text: '剧情检定 2d6=1+2=3：受阻', trace: { a: 1, b: 2, sum: 3, success: false } }
    ]
  }
}

for (const seed of [1, 424242]) {
  test(`确定性：seed=${seed} 同种子同事实包＝同一拍（逐字段锁）`, async () => {
    const first = await oneTurn(seed)
    const again = await oneTurn(seed)
    // 整拍深等（rngState 是函数闭包，逐次身份不同——改为比它接下来的序列）：引擎任何字段漂移都在这里红
    const { rngState: firstRng, ...firstRest } = first
    const { rngState: secondRng, ...secondRest } = again
    assert.deepEqual(secondRest, firstRest, '同种子同事实包必须逐字段相同')
    assert.equal(typeof firstRng, 'function')
    assert.deepEqual(
      [secondRng(), secondRng(), secondRng()],
      [firstRng(), firstRng(), firstRng()],
      '同种子下随机流也必须同序列（引擎状态未漂移）'
    )

    const expected = GOLDEN[seed]
    assert.deepEqual(first.sceneCard, expected.sceneCard, '局面卡四字段')
    assert.deepEqual(first.tension, expected.tension, '张力读数')
    assert.deepEqual(
      first.candidates.map((c) => ({ id: c.id, source: c.source, text: c.text, trace: c.trace ?? null })),
      expected.candidates,
      '候选（必然+命运）逐条锁'
    )
    // 场景上下文：知情账本裁剪出在场角色 / 悬置伏笔进钩子
    assert.deepEqual(first.sceneContext.present.map((item) => item.name), ['沈禾'])
    assert.deepEqual(first.sceneContext.known, ['林砚', '雾港规则', '沈禾', '青浦渡口'])
    assert.equal(first.sceneContext.knowledgeFidelity, 'ledger')
    assert.equal(first.sceneContext.openHypotheses.length, 1, '悬置伏笔一条')
    assert.deepEqual(first.triggers, [], '没有已触发的前线')
    assert.deepEqual(first.braided, [], '前线已有一条，不编织')
  })
}

test('规则包：默认数据规则保持原金样；替代 1d6 规则产生独立新金样', async () => {
  const original = await oneTurn(1)
  assert.deepEqual(original.candidates.map((candidate) => candidate.trace ?? null), [null, { a: 4, b: 1, sum: 5, success: false }])
  const opened = openDeduceSession({ entries: ENTRIES, pov: '林砚', runId: 'os-c5-rules' })
  const alternate = await presentTurn({
    state: opened.state, entries: ENTRIES, pov: '林砚', seed: 1,
    rules: { dice: { count: 1, sides: 6, successThreshold: 4, label: '1d6' }, limits: { necessity: 2, fate: 1, drama: 2, mixed: 4, minimum: 2 } }
  })
  assert.deepEqual(alternate.candidates.map((candidate) => candidate.trace ?? null), [null, { a: 4, b: 0, sum: 4, success: true, label: '1d6', rolls: [4] }])
  assert.match(alternate.candidates[1].text, /剧情检定 1d6=4=4：顺遂/u)
})

test('确定性：换种子＝换骰点（证明 seed 真接进引擎，不是固定输出）', async () => {
  const a = await oneTurn(1)
  const b = await oneTurn(424242)
  const fate = (turn) => turn.candidates.filter((c) => c.source === '命运').map((c) => c.trace.sum)
  assert.deepEqual(fate(a), [5])
  assert.deepEqual(fate(b), [3])
})

/* ---------- ② patchChannel 幂等 ---------- */

test('patchChannel 幂等：同一事件回写两次＝一条', () => {
  const events = [
    { type: 'settle', text: '我推门进去', pov: '林砚', round: 1, runId: 'run-a', decidedBy: 'fate', source: '命运' },
    { type: 'settle', hypothesis: true, text: '雾里有人', pov: '林砚', round: 1 } // 假设轨不算已确认
  ]
  const first = buildWorldbookPatch({ events, domain: 'book-1', bookId: 'book-1' })
  const second = buildWorldbookPatch({ events, domain: 'book-1', bookId: 'book-1' })
  assert.equal(first.ok, true)
  assert.equal(first.patches.length, 1, '只有已确认拍进补丁')
  assert.deepEqual(second.patches, first.patches, '同输入同 id（stableEntryId 幂等）')
  assert.equal(first.patches[0].status, 'proposed', '补丁不直接改世界书')

  const reconciled = reconcilePatches(first.patches, second.patches)
  assert.equal(reconciled.accepted.length, 0, '第二次回写不新增')
  assert.deepEqual(reconciled.duplicates.map((d) => d.reason), ['same-id'])

  // 已存在同 id 条目时同样判重（existingIds 口径）
  const withExisting = buildWorldbookPatch({ events, domain: 'book-1', bookId: 'book-1', existingIds: [first.patches[0].id] })
  assert.equal(withExisting.patches.length, 0)
  assert.equal(withExisting.counts.duplicate, 1)
})

/* ---------- ③ fronts 只进不退 ---------- */

test('fronts 只进不退：推进单调不减，满格停摆，结掉后拒推进', () => {
  const fronts = [createFront({ name: '封渡之雾', max: 4 })]
  const values = []
  for (let round = 1; round <= 8; round += 1) {
    const result = advanceFront(fronts, fronts[0].id, { round, source: 'director', note: '推进' })
    assert.equal(result.ok, true)
    values.push(result.value)
  }
  assert.deepEqual(values, [1, 2, 3, 4, 4, 4, 4, 4], '只进不退：满格（4）后不再涨')
  for (let i = 1; i < values.length; i += 1) assert.ok(values[i] >= values[i - 1], '单调不减')
  assert.equal(fronts[0].clocks.impending.filled, true)

  const resolved = resolveFront(fronts, fronts[0].id, { round: 9, note: '结掉' })
  assert.equal(resolved.ok, true)
  const blocked = advanceFront(fronts, fronts[0].id, { round: 10, source: 'director' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'FRONT_RESOLVED')
  assert.equal(fronts[0].clocks.impending.value, 4, '结掉也不回退')
})

/* ---------- ④ llmPort 三种形态 ---------- */

async function makeFixture(tag) {
  const base = await mkdtemp(join(tmpdir(), `openstory-os155-${tag}-`))
  const root = join(base, '夹具库')
  await mkdir(join(root, '故事源'), { recursive: true })
  await writeFile(join(root, '故事源', 'book-1.json'), JSON.stringify({
    book: { id: 'book-1', title: '夹具书' }, entries: ENTRIES, revision: 1
  }), 'utf-8')
  return { base, root }
}

function sources(result) {
  return result.candidates.map((candidate) => candidate.source)
}

test('llmPort 形态一：正常 propose → 戏剧候选入列（规范接口文档化形状）', async () => {
  const { base, root } = await makeFixture('port-ok')
  try {
    const result = await deducePresent({
      root, bookId: 'book-1', pov: '林砚', seed: 7,
      llmPort: { propose: async ({ prompt, refs }) => {
        assert.equal(typeof prompt, 'string', 'propose 收到 prompt')
        assert.deepEqual(refs, [], 'propose 收到 refs')
        return [{ text: '我现在上前一步搭话', refs: [] }]
      } }
    })
    assert.equal(result.ok, true, result.message)
    assert.ok(sources(result).includes('戏剧'), `戏剧候选应入列：${sources(result).join('/')}`)
    assert.equal(result.llmPortNote, undefined, '正常端口不留形状告警')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('llmPort 形态二：返回 null → 戏剧缺席，其余两层照常，不抛', async () => {
  const { base, root } = await makeFixture('port-null')
  try {
    const result = await deducePresent({
      root, bookId: 'book-1', pov: '林砚', seed: 7,
      llmPort: { propose: async () => null }
    })
    assert.equal(result.ok, true, result.message)
    assert.equal(sources(result).includes('戏剧'), false)
    assert.ok(sources(result).includes('必然'), '必然层照常')
    assert.equal(result.llmPortNote, undefined, 'null 是合法返回，不算形状坏')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('llmPort 形态三：返回坏形状 → 视为 null 并如实记录，不抛', async () => {
  const { base, root } = await makeFixture('port-bad')
  try {
    const result = await deducePresent({
      root, bookId: 'book-1', pov: '林砚', seed: 7,
      llmPort: { propose: async () => 42 }
    })
    assert.equal(result.ok, true, result.message)
    assert.equal(sources(result).includes('戏剧'), false)
    assert.match(String(result.llmPortNote), /不是数组/u, `坏形状要如实带出：${result.llmPortNote}`)

    // 既没有 propose 也没有 complete 的对象：同样按 null 处理并记录
    const result2 = await deducePresent({
      root, bookId: 'book-2', pov: '林砚', seed: 7, llmPort: { complete: 'not-a-function' }
    })
    assert.equal(result2.ok, true, result2.message)
    assert.equal(sources(result2).includes('戏剧'), false)
    assert.match(String(result2.llmPortNote), /既没有 propose 也没有 complete/u)

    // 条目形状坏：坏的丢弃、好的保留
    const result3 = await deducePresent({
      root, bookId: 'book-3', pov: '林砚', seed: 7,
      llmPort: { propose: async () => [{ text: '' }, { text: '我现在绕到灯下去', refs: ['沈禾'] }] }
    })
    assert.equal(result3.ok, true, result3.message)
    assert.ok(sources(result3).includes('戏剧'), '形状好的条目照常入列')
    assert.match(String(result3.llmPortNote), /形状坏/u)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
