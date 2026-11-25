/**
 * OS-114 同源检查用例：时间戳对齐口径（纯函数，不碰磁盘）。
 *   node --test test/syncCheck.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { checkSameSource } from '../src/services/syncCheck.mjs'

test('时间戳：派生档比事实源旧 → 过期', () => {
  const r = checkSameSource({
    factMtime: '2026-11-19T18:42:49.738Z',
    wikiGeneratedAt: '2026-11-19T06:51:01.998Z'
  })
  assert.equal(r.wikiStale, true)
  assert.match(r.wikiNote, /落后/)
  assert.ok(r.wikiNote.includes('事实源改于'), '文案要带两个时间让人自己判断')
})

test('时间戳：派生档比事实源新 → 一致', () => {
  const r = checkSameSource({
    factMtime: '2026-11-19T06:00:00Z',
    wikiGeneratedAt: '2026-11-19T18:00:00Z'
  })
  assert.equal(r.wikiStale, false)
  assert.match(r.wikiNote, /一致/)
})

test('时间戳：同一时刻 → 一致（不算过期）', () => {
  const t = '2026-11-19T10:00:00Z'
  assert.equal(checkSameSource({ factMtime: t, wikiGeneratedAt: t }).wikiStale, false)
})

test('无派生档：不报过期，提示去跑 enrich', () => {
  const r = checkSameSource({ factMtime: '2026-11-19T06:00:00Z' })
  assert.equal(r.wikiStale, false)
  assert.match(r.wikiNote, /还没有派生档/)
})

test('正文比事实源新 → chaptersNewerThanFact，带人话说明', () => {
  const r = checkSameSource({
    factMtime: '2026-11-19T06:00:00Z',
    wikiGeneratedAt: '2026-11-19T07:00:00Z',
    chaptersMtimeMax: '2026-11-20T10:00:00Z'
  })
  assert.equal(r.chaptersNewerThanFact, true)
  assert.match(r.chaptersNote, /正文最新改动/)
  assert.match(r.chaptersNote, /故事源可能没跟上/)
})

test('正文比事实源旧 → 不提示', () => {
  const r = checkSameSource({
    factMtime: '2026-11-20T10:00:00Z',
    wikiGeneratedAt: '2026-11-20T11:00:00Z',
    chaptersMtimeMax: '2026-11-19T10:00:00Z'
  })
  assert.equal(r.chaptersNewerThanFact, false)
  assert.equal(r.chaptersNote, '')
})

test('时间戳原样透出（ISO 串），供前端格式化', () => {
  const fact = '2026-11-19T18:42:49.738Z'
  const wiki = '2026-11-19T06:51:01.998Z'
  const refs = '2026-11-20T15:05:32.201Z'
  const r = checkSameSource({ factMtime: fact, wikiGeneratedAt: wiki, refsMtimeMax: refs })
  assert.equal(r.factAt, fact)
  assert.equal(r.wikiAt, wiki)
  assert.equal(r.refsAt, refs)
})

test('缺时间戳不崩：全空也返回完整形状', () => {
  const r = checkSameSource({})
  assert.equal(r.wikiStale, false)
  assert.equal(r.factAt, null)
  assert.equal(r.wikiAt, null)
})
