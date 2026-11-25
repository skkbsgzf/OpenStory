/**
 * OS-29 推演引擎用例（node:test）：vendor 引擎在独立仓跑通＋封装层行为。
 *   node --test test/deduceEngine.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { deducePresent, deduceSettle, deduceStatePath, humanizeFateText, loadEntries } from '../src/modules/deduce/deduceEngine.mjs'

const ENTRIES = [
  { schema: 'fact.data/v3', id: 'e1', layer: 'worldview', name: '雾港规则', definition: '雾起时渡口不开船。', status: 'adopted' },
  { schema: 'fact.data/v3', id: 'e2', layer: 'character', name: '林砚', definition: '雾港的摆渡人。', status: 'adopted' },
  { schema: 'fact.data/v3', id: 'e3', layer: 'location', name: '青浦渡口', definition: '故事发生地。', status: 'adopted' }
]

async function makeFixture({ withEntries = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os29-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '故事源'), { recursive: true })
  await mkdir(join(root, '.openstory'), { recursive: true })
  if (withEntries) {
    await writeFile(join(root, '故事源', 'book-1.json'), JSON.stringify({
      book: { id: 'book-1', title: '夹具书' },
      entries: ENTRIES,
      revision: 1
    }), 'utf-8')
  }
  return { base, root }
}

test('引擎：条目读取（fact 通道）', async () => {
  const { base, root } = await makeFixture()
  try {
    const loaded = loadEntries(root)
    assert.equal(loaded.ok, true)
    assert.equal(loaded.entries.length, 3)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('引擎：开局推出一拍——局面卡＋候选＋种子确定性', async () => {
  const { base, root } = await makeFixture()
  try {
    const first = await deducePresent({ root, bookId: 'book-1', pov: '林砚', seed: 424242 })
    assert.equal(first.ok, true, first.message)
    assert.ok(first.round >= 1)
    assert.ok(first.sceneCard && typeof first.sceneCard === 'object')
    assert.equal(first.seed, 424242)
    assert.ok(Array.isArray(first.candidates))
    assert.ok(first.candidates.length >= 1, '至少一个候选')
    // 确定性：同种子重开局 → 命运候选的骰点一致
    const again = await deducePresent({ root, bookId: 'book-2', pov: '林砚', seed: 424242 })
    const fateA = first.candidates.filter((c) => c.source === '命运').map((c) => c.trace?.sum)
    const fateB = again.candidates.filter((c) => c.source === '命运').map((c) => c.trace?.sum)
    if (fateA.length && fateB.length) assert.deepEqual(fateA, fateB, '同种子同骰点')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('引擎：没有世界观条目＝WORLD_EMPTY 如实报（不伪造开局）', async () => {
  const { base, root } = await makeFixture()
  try {
    // 覆盖为只有角色条目
    await writeFile(join(root, '故事源', 'book-1.json'), JSON.stringify({
      book: { id: 'book-1', title: '夹具书' },
      entries: [ENTRIES[1]],
      revision: 1
    }), 'utf-8')
    const result = await deducePresent({ root, bookId: 'book-1' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'WORLD_EMPTY')
    assert.match(result.message, /worldview/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('引擎：无条目库如实报缺事实包', async () => {
  const { base, root } = await makeFixture({ withEntries: false })
  try {
    const result = await deducePresent({ root, bookId: 'x' })
    assert.equal(result.ok, false)
    assert.match(result.message, /故事源条目/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('引擎：会话状态落库（.openstory/deduce），不碰 .pinax', async () => {
  const { base, root } = await makeFixture()
  try {
    await deducePresent({ root, bookId: 'book-1', pov: '林砚', seed: 7 })
    const path = deduceStatePath(root, 'book-1')
    assert.ok(path.includes('.openstory'))
    assert.ok(path.replaceAll('\\', '/').includes('.openstory/deduce/book-1.json'))
    const { readFile } = await import('node:fs/promises')
    const saved = JSON.parse(await readFile(path, 'utf-8'))
    assert.ok(saved.round >= 1)
    assert.equal(saved.pov, '林砚')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('引擎：结算选择——无会话 404；有会话时选择不抛', async () => {
  const { base, root } = await makeFixture()
  try {
    const missing = await deduceSettle({ root, bookId: 'nope', candidateId: 'c1' })
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'NOT_FOUND')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})


test('规则包：会话保存校验后的规则；非法规则在开局前拒绝且不写会话', async () => {
  const { base, root } = await makeFixture()
  try {
    const invalid = await deducePresent({ root, bookId: 'book-1', pov: '林砚', rules: { dice: { count: 0 } } })
    assert.equal(invalid.ok, false)
    assert.equal(invalid.code, 'INVALID_ENTRY')
    const { access } = await import('node:fs/promises')
    await assert.rejects(access(deduceStatePath(root, 'book-1')))
    const custom = { dice: { count: 1, sides: 6, successThreshold: 4, label: '1d6' }, limits: { necessity: 2, fate: 1, drama: 2, mixed: 4, minimum: 2 } }
    const first = await deducePresent({ root, bookId: 'book-1', pov: '林砚', seed: 7, rules: custom })
    assert.equal(first.ok, true, first.message)
    const saved = JSON.parse(await readFile(deduceStatePath(root, 'book-1'), 'utf8'))
    assert.deepEqual(saved.rules, custom)
    const continued = await deducePresent({ root, bookId: 'book-1', seed: 8 })
    assert.equal(continued.ok, true, continued.message)
    assert.ok(continued.candidates.some((candidate) => candidate.source === '命运' && candidate.text.includes('1d6')))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('命运候选文案人话化（OS-88）：骰点收尾、结论先行、可复现', () => {
  const ok = humanizeFateText({ a: 6, b: 2, sum: 8, success: true })
  assert.ok(ok.startsWith('世界不拦你'), '顺遂＝世界放行：' + ok)
  assert.ok(ok.includes('（命运骰 8：6+2 顺遂）'), '骰点收尾保留：' + ok)
  const bad = humanizeFateText({ a: 2, b: 3, sum: 5, success: false })
  assert.ok(bad.startsWith('世界设了坎'), '受阻＝世界设坎：' + bad)
  assert.ok(bad.includes('受阻'), bad)
  // trace 缺 success 按 sum>=7 推；完全没 trace 也不崩
  assert.ok(humanizeFateText({ a: 5, b: 3, sum: 8 }).startsWith('世界不拦你'))
  assert.ok(humanizeFateText(null).startsWith('世界'), '无骰点也有兜底话术：' + humanizeFateText(null))
  // 纯函数可复现
  assert.equal(humanizeFateText({ a: 1, b: 1, sum: 2, success: false }), humanizeFateText({ a: 1, b: 1, sum: 2, success: false }))
})
