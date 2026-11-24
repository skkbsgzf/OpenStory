/**
 * 剧本纯视图金样测试（OS-163，G5c 子件二）：固定夹具 → 固定 HTML；
 * 纯度测试（零 import、零 DOM、零存储）；app.js 薄壳测试（本体只出不进）。
 * 与 workbenchViews.test.mjs 同门风——夹具只用内存对象，不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import {
  scriptPrefsFrom,
  scriptBlockToRaw,
  scriptCastHtml,
  scriptViewHtml
} from '../public/views/scriptViews.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')

function esc(value) {
  return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
}
function text(value) { return String(value ?? '') }
function formatBytes(value) { return `${value} B` }
function formatAt(value) { return String(value) }
function flowError(error) { return error ? `<div class="error-box">${esc(error)}</div>` : '' }
function refModulesHtml({ modules, prepend }) { return `${prepend}<nav>${modules.length}</nav>` }

/** 最小 DOM 替身：只有 dataset / textContent / querySelector，不加载浏览器。 */
function fakeBlock({ kind = '', raw = '', plain = '', who = '', hint = '', said = '' } = {}) {
  const children = {
    '[data-sc-kind]': kind ? { dataset: { scKind: kind } } : null,
    '.sc-who': who ? { textContent: who } : null,
    '.sc-hint': hint ? { textContent: hint } : null,
    '.sc-said': said ? { textContent: said } : null
  }
  // 内层带 data-sc-kind 时外层故意留空，还原真实渲染结构
  return {
    dataset: { scKind: '', raw },
    textContent: plain,
    querySelector(selector) { return children[selector] ?? null }
  }
}

test('scriptPrefsFrom：缺省开，显式 false 才关', () => {
  assert.deepEqual(scriptPrefsFrom(undefined), { autoFormat: true, castColors: true })
  assert.deepEqual(scriptPrefsFrom({}), { autoFormat: true, castColors: true })
  assert.deepEqual(scriptPrefsFrom({ autoFormat: false, castColors: true }), { autoFormat: false, castColors: true })
  assert.deepEqual(scriptPrefsFrom({ autoFormat: true, castColors: false }), { autoFormat: true, castColors: false })
})

test('scriptBlockToRaw：幕/场景/台词三类金样，与 data-raw 兜底', () => {
  const tools = { text }
  assert.equal(scriptBlockToRaw(fakeBlock({ kind: 'act', plain: '第一幕 风雪' }), tools), '# 第一幕 风雪')
  assert.equal(scriptBlockToRaw(fakeBlock({ kind: 'act', raw: '# 第二幕' }), tools), '# 第二幕')
  assert.equal(scriptBlockToRaw(fakeBlock({ kind: 'stage', plain: '风雪山神庙' }), tools), '*〔风雪山神庙〕*')
  assert.equal(scriptBlockToRaw(fakeBlock({ kind: 'stage', raw: '〔草料场〕' }), tools), '*〔草料场〕*')
  assert.equal(scriptBlockToRaw(fakeBlock({
    kind: 'line', who: '林冲', hint: '（低沉）', said: '风雪紧。'
  }), tools), '**林冲**（低沉）：风雪紧。')
  assert.equal(scriptBlockToRaw(fakeBlock({
    kind: 'line', who: '鲁达', said: '洒家去也。'
  }), tools), '**鲁达**：洒家去也。')
  // span 被浏览器重组 → 从 data-raw 反解 who/hint
  assert.equal(scriptBlockToRaw(fakeBlock({
    kind: 'line', plain: '原本说白', raw: '**武松**（冷笑）：你待怎地？'
  }), tools), '**武松**（冷笑）：原本说白')
  // action 块原样保留 textContent
  assert.equal(scriptBlockToRaw(fakeBlock({ plain: '  林冲  推门  ', raw: '原始' }), tools), '林冲 推门')
})

test('scriptCastHtml：按台词数降序统计，空态两种', () => {
  const blocks = [
    { kind: 'line', who: '林冲' }, { kind: 'line', who: '鲁达' },
    { kind: 'line', who: '林冲' }, { kind: 'act' }
  ]
  const html = scriptCastHtml({ blocks, esc })
  assert.match(html, /<div class="cast-row"><span class="cast-name">林冲<\/span><span class="cast-n">2 句<\/span><\/div>/u)
  assert.ok(html.indexOf('林冲') < html.indexOf('鲁达'), '台词多的排前')
  assert.equal(scriptCastHtml({ blocks: [], esc }), '<div class="nav-empty">还没有台词</div>')
  assert.equal(scriptCastHtml(), '<div class="nav-empty">还没有台词</div>')
})

const WORK = {
  loaded: true,
  text: '# 第一幕\n*〔山神庙〕*\n**林冲**：风雪紧。',
  file: '剧本/001-风雪山神庙.md',
  files: [{ file: '剧本/001-风雪山神庙.md', name: '001-风雪山神庙.md', size: 512 }],
  savedAt: '2026-11-24T10:00:00.000Z'
}
const STATS = { acts: 1, scenes: 1, lines: 1, chars: 24, cast: ['林冲'] }
const CTX = {
  currentName: '水浒传', work: WORK,
  stats: () => STATS, body: '<div class="doc-line">正文</div>',
  modules: [{ id: 'cast' }], refModulesHtml, flowError,
  esc, formatAt, formatBytes, analysisOn: true
}

test('scriptViewHtml：金样——统计/文件列表/左栏/保存标记一次渲染稳定', () => {
  const html = scriptViewHtml(CTX)
  assert.match(html, /<div class="doc-workspace doc-workspace-sticky">/u)
  assert.match(html, /<span class="kick">水浒传<\/span>/u)
  assert.match(html, /<span class="b">1 幕<\/span>/u)
  assert.match(html, /出场：林冲/u)
  assert.match(html, /data-dirfile-pick="剧本\/001-风雪山神庙\.md"/u)
  assert.match(html, /<span class="sz">512 B<\/span>/u)
  assert.match(html, /data-action="dirfile-new"/u)
  assert.match(html, /已保存 · 2026-11-24T10:00:00\.000Z/u)
  assert.match(html, /<div class="doc-line">正文<\/div>/u)
  assert.match(html, /<nav>1<\/nav>/u, 'refModulesHtml 由调用方注入并原样执行')
  assert.equal(html, scriptViewHtml(CTX), '固定夹具两次渲染逐字节相等')
})

test('scriptViewHtml：空态与副作用分支全部由入参驱动', () => {
  const empty = scriptViewHtml({ ...CTX, work: { loaded: false, text: '', files: [] } })
  assert.match(empty, /还没有剧本/u)
  assert.match(empty, /id="dir-chars">0 字/u)
  assert.match(empty, /还没有剧本/u)
  const loading = scriptViewHtml({ ...CTX, work: { ...WORK, loading: true, loaded: false } })
  assert.match(loading, /正在读取…/u)
  const off = scriptViewHtml({ ...CTX, analysisOn: false })
  assert.match(off, /aria-label="分析" hidden/u)
  const errored = scriptViewHtml({ ...CTX, work: { ...WORK, error: '读失败' } })
  assert.match(errored, /<div class="error-box">读失败<\/div>/u)
})

test('纯度：scriptViews 零 import、零 DOM、零存储', () => {
  const src = readFileSync(join(REPO, 'public/views/scriptViews.mjs'), 'utf-8')
  assert.doesNotMatch(src, /\bimport\s*\(/u, '不许动态 import')
  assert.doesNotMatch(src, /^\s*import\s/u, '不许静态 import')
  assert.doesNotMatch(src, /document|window|localStorage|sessionStorage|indexedDB/u, '纯函数不碰 DOM/存储')
})

test('纯度：app.js 四个剧本函数本体已迁走（只留薄壳）', () => {
  const src = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  const targets = [
    ['scriptBlockToRaw', 'scriptBlockToRaw'],
    ['scriptPrefs', 'scriptPrefsFrom'],
    ['scriptCastHtml', 'scriptCastHtml'],
    ['scriptViewHtml', 'scriptViewHtml']
  ]
  for (const [name, delegated] of targets) {
    const start = src.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `${name} 薄壳应仍在 app.js 供调用点用`)
    const open = src.indexOf('{', start)
    let depth = 0
    let close = open
    for (; close < src.length; close++) {
      if (src[close] === '{') depth++
      else if (src[close] === '}' && --depth === 0) break
    }
    const shell = src.slice(open + 1, close)
    assert.ok(shell.length < 700, `${name} 应是薄壳（<700 字符），实际 ${shell.length}`)
    assert.ok(shell.includes(`scriptViews.${delegated}`), `${name} 必须转交 scriptViews`)
  }
})
