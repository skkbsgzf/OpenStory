/**
 * 世界书纯视图金样测试（OS-164）：固定夹具 → 固定 HTML；纯度（零 import/DOM/存储）；
 * app.js 薄壳测试（本体只出不进）。全部内存夹具，不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  referenceEntryDetailHtml, referenceEditorHtml, refNodeCardHtml,
  referenceGraphHtml, refModulesHtml, referencePageHtml
} from '../public/views/referenceViews.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
function esc(value) { return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;') }
function text(value) { return String(value ?? '') }

const FACTS = [
  { id: 'c1', name: '林冲', layer: 'character', definition: '八十万禁军教头。', firstChapter: 2,
    fact: '被逼上梁山', anchors: { speech: ['风雪紧'] }, relations: [{ name: '鲁达', kind: '结义' }], chapters: [2, 5], status: 'draft' },
  { id: 'c2', name: '无名', layer: 'worldview' }
]

test('referenceEntryDetailHtml：金样——词条详情只读展示，缺失给空态', () => {
  const html = referenceEntryDetailHtml('c1', FACTS, { esc })
  assert.match(html, /故事源词条 · 角色/u)
  assert.match(html, /首次出现在第2章/u)
  assert.match(html, /关键台词/u)
  assert.match(html, /关系/u)
  assert.match(html, /第2章、第5章/u)
  assert.match(html, /状态：draft/u)
  assert.equal(html, referenceEntryDetailHtml('c1', FACTS, { esc }))
  assert.match(referenceEntryDetailHtml('missing', FACTS, { esc }), /词条不存在/u)
})

test('referenceEditorHtml：金样——from graph 返回、标签、摘要、图片槽由入参注入', () => {
  const note = { title: '林冲', path: '世界书/角色/林冲.md', text: '---\na: 1\n---\n正文', tags: ['角色'], excerpt: '一段摘要', firstChapter: 3, chars: 42 }
  const html = referenceEditorHtml({ ref: { from: 'graph' }, note, bodySource: '正文', body: '<p>正文</p>', imagesSlot: '<div class="slot">图</div>', esc, text })
  assert.match(html, /data-action="ref-back-graph"/u)
  assert.match(html, /data-ref-tag="角色"/u)
  assert.match(html, /一段摘要/u)
  assert.match(html, /<div class="slot">图<\/div>/u)
  assert.match(html, /value="3"/u)
  assert.equal(html, referenceEditorHtml({ ref: { from: 'graph' }, note, bodySource: '正文', body: '<p>正文</p>', imagesSlot: '<div class="slot">图</div>', esc, text }))
  assert.equal(referenceEditorHtml({ note: null, esc, text }), '')
})

test('refNodeCardHtml：度数/标签/摘要由入参算，不读 state', () => {
  const node = { id: 'r1', kind: 'worldbook', label: '林冲', excerpt: '**摘要**', tags: ['角色'] }
  const edges = [{ a: 'r1', b: 't1' }, { a: 't1', b: 'r1' }, { a: 'x', b: 'y' }]
  const html = refNodeCardHtml(node, { edges, esc, text })
  assert.match(html, /2 条关联/u)
  assert.match(html, /data-ref-tag="角色"/u)
  assert.match(html, /摘要/u)
  assert.equal(html, refNodeCardHtml(node, { edges, esc, text }))
})

test('referenceGraphHtml：错误/构图态 + 图例/标签栏/节点卡金样', () => {
  assert.match(referenceGraphHtml({ rc: { graphError: '读失败' }, esc, text }), /error-box/u)
  assert.match(referenceGraphHtml({ rc: {}, esc, text }), /正在构图/u)
  const rc = { graph: { nodes: [{ id: 'r1', label: '林冲' }], edges: [], stats: { nodes: 1, edges: 0, byKind: { reference: 1 } } } }
  const ref = { focus: 'r1', tags: [{ name: '角色', count: 1 }], tagFilter: '' }
  const html = referenceGraphHtml({ rc, ref, esc, text, nodeCardHtml: (node) => refNodeCardHtml(node, { esc, text }) })
  assert.match(html, /1 个节点 · 0 条边/u)
  assert.match(html, /data-action="ref-graph-tag"/u)
  assert.match(html, /ref-node-card/u)
  assert.equal(html, referenceGraphHtml({ rc, ref, esc, text, nodeCardHtml: (node) => refNodeCardHtml(node, { esc, text }) }))
})

test('refModulesHtml：hidden 裁掉、折叠态闭-body、prepend 原样透传', () => {
  const modules = [
    { id: 'graph', label: '世界书图谱', badge: () => '3', render: () => '<div>图</div>' },
    { id: 'summary', label: '世界书摘要', badge: () => '', render: () => '<div>摘要</div>' }
  ]
  const html = refModulesHtml({ prepend: '<section>文件</section>', modules, hidden: new Set(['summary']), openState: { graph: false }, esc })
  assert.match(html, /<section>文件<\/section>/u)
  assert.match(html, /data-ref-mod="graph" data-open="0"/u)
  assert.doesNotMatch(html, /世界书摘要/u)
  assert.doesNotMatch(html, /<div>图<\/div>/u, '折叠时不渲染 body')
})

test('referencePageHtml：同步条插到 ref-grid 前；$& 类序列不被当分组引用吃掉', () => {
  const html = referencePageHtml({ ref: { flash: '好了' }, shell: '<div class="ref-grid">正文</div>', syncBlock: '<div class="sync">$&状态</div>', errorBox: '<div class="error">err</div>', esc })
  assert.match(html, /<div class="sync">\$&状态<\/div><div class="ref-grid">/u)
  assert.match(html, /<div class="ok-note">好了<\/div>/u)
  assert.match(html, /<div class="error">err<\/div>/u)
  const fallback = referencePageHtml({ shell: '<p>无网格</p>', syncBlock: '<div class="sync">s</div>', esc })
  assert.match(fallback, /<div class="sync">s<\/div><p>无网格<\/p>/u)
})

test('纯度：referenceViews 零 import、零 DOM/存储；app.js 六函数只留薄壳', () => {
  const src = readFileSync(join(REPO, 'public/views/referenceViews.mjs'), 'utf-8')
  assert.doesNotMatch(src, /\bimport\s*\(/u)
  assert.doesNotMatch(src, /^\s*import\s/u, '不许静态 import')
  assert.doesNotMatch(src, /document|window|localStorage|sessionStorage|indexedDB/u)
  const app = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  for (const name of ['referenceEntryDetailHtml', 'referenceEditorHtml', 'refNodeCardHtml', 'referenceGraphHtml', 'refModulesHtml', 'referencePageHtml']) {
    const start = app.indexOf(`function ${name}(`)
    assert.ok(start >= 0, `${name} 薄壳应在 app.js`)
    const open = app.indexOf('{', app.indexOf(')', start))
    let depth = 0; let close = open
    for (; close < app.length; close++) {
      if (app[close] === '{') depth++
      else if (app[close] === '}' && --depth === 0) break
    }
    const body = app.slice(open + 1, close)
    // referencePageHtml 的取数壳要装配 refModule.referenceShellHtml 的十余个入参，比一般薄壳长；
    // 仍然只有一次转交、零 HTML 模板，阈值单独放宽到 2000。
    const limit = name === 'referencePageHtml' ? 2000 : 900
    assert.ok(body.length < limit, `${name} 应是薄壳（<${limit}），实际 ${body.length}`)
    assert.match(body, /referenceViews\./u, `${name} 必须转交 views`)
  }
})
