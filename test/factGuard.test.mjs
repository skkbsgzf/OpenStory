/**
 * FACT-FIRST 守卫测试（node:test，零依赖）。
 *
 * 钉住三件事：
 *   ① 事实链有数据时，loadFactContext 必须返回 source=fact 且不读正文；
 *   ② 事实链为空时必须降级读正文，且 degraded=true（不许假装有 fact）；
 *   ③ 想绕过闸门直接读正文，必须给 reason（否则拒绝）。
 *
 * OS-195b：断言走 prose.write 能力面，事实只读经 fact.store/fact.pack 句柄注入。
 * 跑法：node --test test/factGuard.test.mjs
 */
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { factCapability } from '../src/modules/fact/index.mjs'
import { proseCapability } from '../src/modules/prose/index.mjs'

// OS-195b：守卫归 prose.write；事实只读经 fact.store/fact.pack 句柄注入，断言等价迁到能力面。
const guard = proseCapability['prose.write']
guard.setFactGuardHandles({
  store: factCapability['fact.store'],
  pack: factCapability['fact.pack']
})
const { CONTEXT_SOURCE, allowProseDirectRead, factHealth, loadFactContext, loadFactDerived, resetProseAudit, buildFactPackView } = guard

/** 造一个最小库：正文两章 + 可选的事实链。 */
function makeLibrary({ withFact = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fact-guard-'))
  mkdirSync(join(root, '正文'), { recursive: true })
  writeFileSync(join(root, '正文', '001-开局.md'), '第一章正文：林逸去了超市。\n\n他什么也没买。', 'utf8')
  writeFileSync(join(root, '正文', '002-转折.md'), '第二章正文：沈岚决定买房。', 'utf8')

  if (withFact) {
    mkdirSync(join(root, '故事源'), { recursive: true })
    // 真实格式（factFileStore.readFactDir 的口径）：顶层 {book, entries[]}。
    // 早先按 {current:{entries}} 造夹具是错的——那会让 store.list 静默返回空表。
    const dataset = {
      book: { id: 'test-book', title: '测试书' },
      entries: [
        {
          schema: 'fact.data/v3',
          id: 'plot-0001',
          layer: 'plot',
          name: '林逸买米失败',
          domain: '短篇',
          status: 'fact',
          sources: [{ sourceId: '正文/001-开局.md', segmentId: 'seg-1', quote_hash: 'abc12345' }],
          provenance: { book: '测试书', book_id: 'test-book', mode: 'analyze', extractor: 'fact-chain/v1', chapters: [1] },
          fingerprint: 'fp-1',
          who: ['林逸'],
          events: [
            { index: 1, who: '林逸', channel: 'do', content: '林逸去了超市。', segments: [{ index: 1, chars: 9 }] }
          ],
          validity: { from: 1, to: 1 }
        },
        {
          schema: 'fact.data/v3',
          id: 'plot-0002',
          layer: 'plot',
          name: '沈岚买房',
          domain: '短篇',
          status: 'fact',
          sources: [{ sourceId: '正文/002-转折.md', segmentId: 'seg-2', quote_hash: 'def67890' }],
          provenance: { book: '测试书', book_id: 'test-book', mode: 'analyze', extractor: 'fact-chain/v1', chapters: [2] },
          fingerprint: 'fp-2',
          who: ['沈岚'],
          events: [
            { index: 1, who: '沈岚', channel: 'decision', content: '沈岚决定买房。', segments: [{ index: 2, chars: 8 }] }
          ],
          validity: { from: 2, to: 2 }
        }
      ]
    }
    writeFileSync(join(root, '故事源', 'test-book.json'), JSON.stringify(dataset, null, 1), 'utf8')
  }
  return root
}

test('事实链有数据：loadFactContext 返回 fact，且不读正文', async () => {
  const root = makeLibrary({ withFact: true })
  try {
    const context = await loadFactContext({ root, chapterNo: 1 })
    assert.equal(context.source, CONTEXT_SOURCE.FACT)
    assert.equal(context.degraded, false)
    assert.ok(context.entries.length > 0, '应该有事实链条目')
    assert.ok(context.events.length > 0, '应该投影出事件')
    assert.equal(context.proseText, null, '有 fact 时不许读正文')
    assert.equal(context.events[0].who, '林逸')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('事实链为空：降级读正文，degraded=true 且带说明', async () => {
  const root = makeLibrary({ withFact: false })
  try {
    const context = await loadFactContext({ root, chapterNo: 1 })
    assert.equal(context.source, CONTEXT_SOURCE.PROSE_FALLBACK)
    assert.equal(context.degraded, true)
    assert.ok(context.proseText.includes('林逸去了超市'), '降级路径必须真的读到正文')
    assert.ok(context.notes.some((note) => note.includes('降级')), '降级必须留痕')
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('事实链不覆盖请求章：标 partial，不静默当全覆盖', async () => {
  const root = makeLibrary({ withFact: true })
  try {
    // 事实链只有第 1/2 章；请求第 2 章应命中，请求不存在的第 99 章应降级
    const context = await loadFactContext({ root, chapterNo: 99 })
    assert.ok(context.source === CONTEXT_SOURCE.EMPTY || context.source === CONTEXT_SOURCE.PROSE_FALLBACK)
    assert.equal(context.degraded, true)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('直接读正文闸门：无理由拒绝，有理由放行并记账', () => {
  resetProseAudit()
  const denied = allowProseDirectRead({ caller: 'test' })
  assert.equal(denied.allowed, false, '无 reason 必须拒绝')

  const allowed = allowProseDirectRead({ caller: 'test', reason: '作者要求看原文' })
  assert.equal(allowed.allowed, true)
  assert.equal(allowed.audited, true)
})

test('factHealth：有事实链时 present=true，条目数与层数正确', async () => {
  const root = makeLibrary({ withFact: true })
  try {
    const health = await factHealth(root)
    assert.equal(health.present, true)
    assert.ok(health.entries >= 2)
    assert.equal(health.layers.plot, 2)
    assert.ok(health.chapters.includes(1))
    assert.ok(health.chapters.includes(2))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('factHealth：无事实链时 present=false（不抛错）', async () => {
  const root = makeLibrary({ withFact: false })
  try {
    const health = await factHealth(root)
    assert.equal(health.present, false)
    assert.equal(health.entries, 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('派生层缺失时返回 ok=false 并说明原因', async () => {
  const root = makeLibrary({ withFact: true })
  try {
    const derived = await loadFactDerived({ root, bookId: 'test-book' })
    // 夹具没写 .wiki.json，派生层应为空
    assert.equal(derived.ok, false)
    assert.ok(derived.notes.length > 0)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('守卫的 fact.pack 口走同一实现（转出不换实现）', () => {
  const entries = [{ id: 'e1', layer: 'plot', name: '事件', validity: { from: 1, to: 1 }, events: [] }]
  const query = { span: { from: 1, to: 1 } }
  assert.deepEqual(buildFactPackView(entries, query), factCapability['fact.pack'].buildFactPack(entries, query))
})
