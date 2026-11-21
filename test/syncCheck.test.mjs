/**
 * OS-113 同源检查用例：纯函数口径（不碰磁盘的那半）。
 *   node --test test/syncCheck.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkSameSource } from '../syncCheck.mjs'

test('同源：派生档落后 1 版＝一致（写入语义偏移，不算过期）', () => {
  const r = checkSameSource({ factRevision: 5, wikiDerivedFrom: { factRevision: 4 } })
  assert.equal(r.factRevision, 5)
  assert.equal(r.wikiFactRevision, 4)
  assert.equal(r.wikiStale, false, '差 1 版是内核写入语义，不该报过期')
  assert.match(r.wikiNote, /一致/)
})

test('同源：派生档落后 >1 版＝真过期', () => {
  const r = checkSameSource({ factRevision: 9, wikiDerivedFrom: { factRevision: 2 } })
  assert.equal(r.wikiStale, true)
  assert.match(r.wikiNote, /落后 7 版/)
})

test('同源：无派生档＝不报过期，note 说明', () => {
  const r = checkSameSource({ factRevision: 3, wikiDerivedFrom: null })
  assert.equal(r.wikiFactRevision, null)
  assert.equal(r.wikiStale, false)
  assert.equal(r.wikiNote, '无派生档')
})

test('同源：derivedFrom 形状坏（无 factRevision）按无派生档处理', () => {
  const r = checkSameSource({ factRevision: 3, wikiDerivedFrom: { schema: 'x' } })
  assert.equal(r.wikiFactRevision, null, '读不出基准就不假装一致')
  assert.equal(r.wikiStale, false)
})

test('同源：参考笔记 mtime 原样透出为 ISO 串', () => {
  const iso = '2026-11-20T15:05:32.201Z'
  const r = checkSameSource({ factRevision: 1, wikiDerivedFrom: null, refsMtimeMax: iso })
  assert.equal(r.refsNewerThan, iso)
})

test('同源：factRevision 缺省按条目数兜底，空条目＝0', () => {
  assert.equal(checkSameSource({ factRevision: 0, wikiDerivedFrom: null }).factRevision, 0)
  assert.equal(checkSameSource({ wikiDerivedFrom: null, entries: [] }).factRevision, 0)
  assert.equal(checkSameSource({ wikiDerivedFrom: null, entries: [{}, {}] }).factRevision, 1)
})
