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
import { habitsViewHtml, ssTableHtml, ssOutlineSideHtml, ssTraceHtml, ssChartFallbackHtml } from '../public/views/workbenchViews.mjs'

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

/* ---------- 故事源纯函数金样（OS-161 子件二）---------- */
function truncate(value, n) { return String(value).length > n ? `${String(value).slice(0, n)}…` : String(value) }
const SS_TOOLS = { esc, text, truncate }

const SS_LAYOUT = {
  board: {
    columns: [
      { key: 'name', label: '条目' }, { key: 'layerLabel', label: '层' },
      { key: 'chapter', label: '章' }, { key: 'events', label: '事件', align: 'right' }
    ],
    rows: [
      { id: 'e1', name: '林冲雪夜', layer: 'plot', layerLabel: '剧情', chapter: '第1章', events: 3, entry: { name: '林冲雪夜', layer: 'plot', events: [{ content: '风雪山神庙' }], provenance: { segmentIndex: 2 } } },
      { id: 'e2', name: '鲁达', layer: 'character', layerLabel: '角色', chapter: '第2章', events: 1, entry: { name: '鲁达', layer: 'character' } }
    ]
  },
  tree: {
    alignment: 'exact', chapterCount: 1, beatCount: 1,
    chapters: [{ chapter: 1, title: '风雪山神庙', beats: [{ label: '起', eventCount: 3, entries: [{ _storyKey: 'e1', name: '林冲雪夜', layer: 'plot', events: [{}, {}, {}] }] }] }],
    entryIndex: { e1: { chapter: 1 } }
  },
  stats: {
    charts: {
      curve: [{ chapter: 1, tension: 8, density: 5 }],
      foreshadows: { counts: [{ chapter: 1, planted: 2, cumulative: 2 }] },
      heatmap: { data: [[0, 0, 3]], xChapters: [1] }
    }
  }
}
const SS_STATE = { q: '', layer: 'all', entryId: 'e1', chapter: 1, openChapters: { 1: true } }

test('ssTableHtml：金样——表格稳定 HTML，固定夹具两次相等', () => {
  const html = ssTableHtml(SS_LAYOUT, SS_STATE, SS_TOOLS)
  assert.match(html, /<table class="table">/u)
  assert.match(html, /data-ss-entry="e1"/u)
  assert.match(html, /段2 · 风雪山神庙/u, 'plot 条目用段N · 首事件短名')
  assert.equal(html, ssTableHtml(SS_LAYOUT, SS_STATE, SS_TOOLS))
  const filtered = ssTableHtml(SS_LAYOUT, { ...SS_STATE, q: '鲁达' }, SS_TOOLS)
  assert.match(filtered, /data-ss-entry="e2"/u)
  assert.doesNotMatch(filtered, /data-ss-entry="e1"/u)
})

test('ssOutlineSideHtml：金样——章树稳定 HTML，无副作用', () => {
  const html = ssOutlineSideHtml(SS_LAYOUT, SS_STATE, SS_TOOLS)
  assert.match(html, /章 → 段 → 条目/u)
  assert.match(html, /data-ss-chapter="1"/u)
  assert.match(html, /精确对齐/u)
  assert.equal(html, ssOutlineSideHtml(SS_LAYOUT, SS_STATE, SS_TOOLS))
})

test('ssTraceHtml：金样——溯源/关联/辐射三卡；graph 由入参注入而非读全局', () => {
  const entry = {
    _storyKey: 'e1', name: '林冲雪夜', sources: [{ sourceId: 'src1', segmentId: 's2', quote_hash: 'abcdef123456' }],
    relations: [{ to: '鲁达', type: '结义' }], who: ['林冲']
  }
  const graph = { causalGraph: { nodes: [1, 2], edges: [1] }, ledger: { knowledgeLedger: [1], stateLedger: [] } }
  const withGraph = ssTraceHtml(entry, SS_LAYOUT, SS_STATE, { graph, ...SS_TOOLS })
  assert.match(withGraph, /因果图 2 节点 \/ 1 边 · 台账 1 条/u)
  assert.match(withGraph, /data-ss-ref="鲁达"/u)
  assert.match(withGraph, /data-ss-goto-write="1"/u)
  const noGraph = ssTraceHtml(null, SS_LAYOUT, SS_STATE, { graph: null, ...SS_TOOLS })
  assert.match(noGraph, /先选一条条目/u)
  assert.doesNotMatch(noGraph, /enrich 旁证/u)
})

test('ssChartFallbackHtml：金样——三种图种表格稳定 HTML', () => {
  for (const chart of ['curve', 'foreshadow', 'heatmap']) {
    const html = ssChartFallbackHtml(SS_LAYOUT, chart, '加载失败', { esc })
    assert.match(html, /图表没加载出来/u)
    assert.match(html, /<table/u)
    assert.equal(html, ssChartFallbackHtml(SS_LAYOUT, chart, '加载失败', { esc }))
  }
})

test('纯度：故事源渲染函数本体不在 app.js（薄壳转交）', () => {
  const src = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  for (const name of ['ssTableHtml', 'ssOutlineSideHtml', 'ssTraceHtml', 'ssChartFallbackHtml']) {
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
    assert.ok(shell.length < 500, `${name} 应是薄壳（<500 字符），实际 ${shell.length}`)
    assert.ok(shell.includes(`workbenchViews.${name}`), `${name} 必须转交 views`)
  }
})
