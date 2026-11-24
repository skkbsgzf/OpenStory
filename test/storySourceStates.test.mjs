/**
 * 故事源空库态（OS-150a）：FACT_EMPTY 是合法空态，不是错误条。
 *
 * 钉三件事：
 *   ① 前端判定只认契约码，不认文案；
 *   ② 前端码与后端 API_ERROR_CODES 同值（两处都不许各写一份新码）；
 *   ③ app.js 的接线：利用 isFactEmptyError 分流到既有引导空态，错误条只留给真错误。
 *
 * 跑法：node --test test/storySourceStates.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { API_ERROR_CODES } from '../src/api/contracts.mjs'
import {
  FACT_EMPTY_CODE,
  FACT_UNREADABLE_CODE,
  factUnreadableText,
  isFactEmptyError,
  isFactUnreadableError
} from '../public/storySource.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

test('FACT_EMPTY：前端判定只认码，前后端同值', () => {
  assert.equal(FACT_EMPTY_CODE, API_ERROR_CODES.FACT_EMPTY)
  assert.equal(isFactEmptyError({ code: 'FACT_EMPTY' }), true)
  assert.equal(isFactEmptyError({ code: 'INVALID_ENTRY', message: '条目清单响应形状不符合契约' }), false)
  assert.equal(isFactEmptyError(null), false)
  assert.equal(isFactEmptyError(''), false)
})

test('app.js 接线：空库走引导空态（isFactEmptyError 分流），错误条只给真错误', () => {
  const src = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  assert.match(src, /!ssModule\.isFactEmptyError\(fv\.entriesError\)/u, '空库码必须从错误条里分流出去')
  assert.match(src, /还没有故事源/u, '引导空态文案复用既有出口（不新增第二份）')
})

test('OS-150b：FACT_UNREADABLE 与空库是两回事——告警分支只认码，细节逐本带上', () => {
  assert.equal(FACT_UNREADABLE_CODE, API_ERROR_CODES.FACT_UNREADABLE)
  assert.equal(isFactUnreadableError({ code: 'FACT_UNREADABLE' }), true)
  assert.equal(isFactUnreadableError({ code: 'FACT_EMPTY' }), false, '空库不能走坏档分支')
  assert.equal(isFactEmptyError({ code: 'FACT_UNREADABLE' }), false, '坏档不能走空库分支')
  assert.equal(isFactUnreadableError(null), false)

  const error = {
    code: 'FACT_UNREADABLE',
    message: '拆解档读不出来',
    details: { books: [{ bookId: '碎档', file: '碎档.json', error: 'Unexpected token' }] }
  }
  assert.equal(factUnreadableText(error), '拆解档读不出来（碎档：Unexpected token）')
  assert.equal(factUnreadableText({ code: 'FACT_UNREADABLE', message: '拆解档读不出来' }), '拆解档读不出来')

  // 页面接线：坏档码有独立告警分支，且该分支先于「还没有故事源」空态
  const src = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  const warnAt = src.indexOf('ssModule.isFactUnreadableError(fv.entriesError)')
  const emptyAt = src.indexOf('empty-state"><h2>还没有故事源')
  assert.ok(warnAt >= 0, 'app.js 必须有 FACT_UNREADABLE 的告警分支')
  assert.ok(emptyAt > warnAt, '告警分支必须先于「还没有故事源」空态')
  assert.match(src, /warn-box/u, '坏档用告警样式，不用引导空态')
})
