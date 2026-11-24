/**
 * 工作面纯视图金样测试（OS-161）：固定夹具 → 固定 HTML；纯度测试（零 import、零 DOM、零存储）。
 * 与 analysisModules / registry 的测试同门风——视图本体在 public/views/，测试可直接喂夹具。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import * as uiKit from '../public/ui-kit.mjs'
import { habitsViewHtml } from '../public/views/workbenchViews.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

function esc(value) {
  return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
}
function text(value) { return String(value ?? '') }

const FIELDS = [
  { key: 'bannedWords', label: '禁用词', hint: '出现即改的词（一行一个）', ph: '例如：心理活动\n压力\n效率' },
  { key: 'preferredWords', label: '惯用词', hint: '希望多用的词（一行一个）', ph: '例如：恁地\n那厮' },
  { key: 'bannedPatterns', label: '禁用句式', hint: '句式模板（… 表示中间可隔字）', ph: '例如：不是…而是…' },
  { key: 'bannedRhetoric', label: '禁用修辞', hint: '不想看到的修辞（一行一个）', ph: '例如：排比三连\n通篇比喻' },
  { key: 'formulas', label: '喜好的描述公式', hint: '惯用的写法公式（一行一个）', ph: '例如：动作+后果，不写血腥细节' }
]

const HABITS = {
  schema: 'openstory.habits/v1', tone: 'gentle', style: '宋明白话为骨',
  bannedWords: ['心理活动', '效率'], preferredWords: ['恁地'],
  bannedPatterns: [], bannedRhetoric: [], formulas: []
}

function render(ctx = {}) {
  return habitsViewHtml({
    current: ctx.current === undefined ? { name: '水浒传' } : ctx.current,
    habits: ctx.habits === undefined ? HABITS : ctx.habits,
    fields: FIELDS, uiKit, esc, text,
    errorBox: ctx.errorBox ?? '', logHtml: ctx.logHtml ?? ''
  })
}

test('habitsViewHtml：无库 → 选库空态，不读习惯', () => {
  const html = render({ current: null })
  assert.match(html, /先选一个库/u)
  assert.doesNotMatch(html, /habits-form/u)
})

test('habitsViewHtml：读库中 → loading', () => {
  assert.equal(render({ habits: null }), '<div class="loading">正在读取习惯表…</div>')
})

test('habitsViewHtml：金样——填入习惯表生成稳定 HTML', () => {
  const html = render()
  assert.match(html, /<h1>习惯<\/h1>/u)
  assert.match(html, /宋明白话为骨/u)
  assert.match(html, /data-chip-field="bannedWords"/u)
  assert.match(html, /data-action="habits-save"/u)
  // 注入的 errorBox / logHtml 原样透传（app.js 侧负责取数，纯函数不读全局）
  const withExtras = render({ errorBox: '<div class="error-box">x</div>', logHtml: '<div class="modlog">log</div>' })
  assert.match(withExtras, /<div class="error-box">x<\/div>/u)
  assert.match(withExtras, /<div class="modlog">log<\/div>/u)
  // 固定夹具 → 两次渲染逐字节相等
  assert.equal(render(), html)
})

test('纯度：workbenchViews 零 import、零 DOM、零存储', () => {
  const src = readFileSync(join(REPO, 'public/views/workbenchViews.mjs'), 'utf-8')
  assert.doesNotMatch(src, /\bimport\s*\(/u, '不许动态 import')
  assert.doesNotMatch(src, /^\s*import\s/u, '不许静态 import')
  assert.doesNotMatch(src, /document|window|localStorage|sessionStorage|indexedDB/u, '纯函数不碰 DOM/存储')
})

test('纯度：app.js 不再持有 habitsViewHtml 本体（只留薄壳）', () => {
  const src = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  const body = src.match(/function habitsViewHtml\(\)\s*\{([\s\S]*?)\n\}/)?.[1] ?? ''
  assert.ok(body.length < 800, 'app.js 的 habitsViewHtml 应是薄壳（<800 字符）')
  assert.match(body, /workbenchViews\.habitsViewHtml/u, '薄壳必须转交 views 纯函数')
})
