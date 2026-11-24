/**
 * OS-154 fact 派生与包装转自有护栏（node:test，零依赖）。
 *
 * 影子迁移（设计稿 §6.3）：四件逐字复制进 `src/kernel/`（`fact/wikiDerive.mjs`、
 * `fact/factPack.mjs`、`enrich/{pseudoChapters,metrics}.mjs`），本批同时把伪章公式合并成
 * 一份（§9-6）并删除 core 侧 enrich 两件。这里锁四类：
 *   ① 伪章数 `clamp(round(chars/2200), 4, 12)` 的边界（0／1／恰好 2200／4-12 两端／超大）；
 *   ② `wikiDerive` 转出的伪章结果与 `enrich/pseudoChapters` 同值（合并后不许再分叉）；
 *   ③ `causalSummary` 三指标对固定小图的读数（闭环率／耦合度／断点敏感度）；
 *   ④ `deriveWiki` 幂等；`factPack` 打包形状与查询区间语义（无界／相交／角色知情）。
 * 另有等价锁：`deriveWiki` 与本批仍保留的 core 原件同输入深等；`buildFactPack` 的 core 原件
 * 已在 OS-155 删除，等价锁改为**摘要金样**（下列 8 组查询的输出 sha256 在删除前由 src≡core
 * 的等价对拍实测冻结——同一份锁，core 原件不再需要）。
 *
 * 全部是纯函数用例，不落盘——绝不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

import * as enrichPseudo from '../src/kernel/enrich/pseudoChapters.mjs'
import * as enrichMetrics from '../src/kernel/enrich/metrics.mjs'
import * as wikiDerive from '../src/kernel/fact/wikiDerive.mjs'
import { buildFactPack } from '../src/kernel/fact/factPack.mjs'
/* core 原件只读引用（测试文件不在 S2.4 扫描面；等价对的对照组。wikiDerive 本批不删；
    factPack 的 core 原件已随 OS-155 删除——它的等价锁改为下方的摘要金样） */
import * as coreWikiDerive from '../core/pinax/next/kernel/wikiDerive.mjs'

/* ---------- ① 伪章数边界 ---------- */

test('伪章数 clamp(round(chars/2200), 4, 12) 的边界', () => {
  const count = enrichPseudo.pseudoChapterCount
  assert.equal(count(0), 4, '0 字也至少 4 节')
  assert.equal(count(1), 4, '1 字也至少 4 节')
  assert.equal(count(2199), 4, 'round(0.9995)=1 → 仍被下限抬到 4')
  assert.equal(count(2200), 4, '恰好 2200 字 = 1 节 → 被下限抬到 4')
  // 4→5 的下界：round(7699/2200)=round(3.4995)=3；round(7700/2200)=round(3.5)=4
  assert.equal(count(7699), 4)
  assert.equal(count(7700), 4)
  assert.equal(count(10999), 5, 'round(4.9995)=5')
  assert.equal(count(11000), 5)
  // 12 的上界：round(25299/2200)=round(11.4995)=11；round(25300/2200)=round(11.5)=12
  assert.equal(count(25299), 11)
  assert.equal(count(25300), 12)
  assert.equal(count(999999), 12, '超大正文仍封顶 12 节')
})

test('伪章切分：空 plot 空表；全无段信息落单节；按段号均分', () => {
  assert.deepEqual(enrichPseudo.derivePseudoChapters([], 8800), [])
  const noSeg = [{ name: '甲', events: [] }, { name: '乙', events: [] }]
  const single = enrichPseudo.derivePseudoChapters(noSeg, 8800)
  assert.equal(single.length, 1)
  assert.equal(single[0].no, 1)
  assert.deepEqual(single[0].plots, noSeg)

  // 12 个 plot、段号 0..11、8800 字（K=4）→ 每节段宽 3，均分四节
  const plots = Array.from({ length: 12 }, (_, index) => ({ name: `p${index}`, events: [{ segments: [{ index }] }] }))
  const groups = enrichPseudo.derivePseudoChapters(plots, 8800)
  assert.deepEqual(groups.map((group) => group.no), [1, 2, 3, 4])
  assert.deepEqual(groups.map((group) => group.plots.length), [3, 3, 3, 3])
  assert.deepEqual(groups.map((group) => [group.segStart, group.segEnd]), [[0, 2], [3, 5], [6, 8], [9, 11]])
})

/* ---------- ② wikiDerive 与 enrich 伪章同值（§9-6 合并后的锁） ---------- */

test('wikiDerive 转出的伪章结果与 enrich/pseudoChapters 同值（0/1/2200/4-12 边界/超大）', () => {
  const plots = Array.from({ length: 12 }, (_, index) => ({
    name: `p${index}`,
    validity: { from: 1 },
    who: ['林逸'],
    events: [{ who: '林逸', channel: 'do', content: `动作第${index}条`, segments: [{ index }] }]
  }))
  const samples = [0, 1, 2199, 2200, 7699, 7700, 10999, 11000, 25299, 25300, 999999]
  for (const chars of samples) {
    assert.equal(
      wikiDerive.pseudoChapterCount(chars),
      enrichPseudo.pseudoChapterCount(chars),
      `pseudoChapterCount(${chars}) 两份实现必须同值`
    )
    assert.deepEqual(
      wikiDerive.derivePseudoChapters(plots, chars),
      enrichPseudo.derivePseudoChapters(plots, chars),
      `derivePseudoChapters(plots, ${chars}) 两份实现必须同值`
    )
  }
  // 转出面本身也不能缩水：四个导出名与 core 原件一致
  for (const name of ['plotMinSegment', 'pseudoChapterCount', 'derivePseudoChapters', 'hasRealChapters']) {
    assert.equal(typeof wikiDerive[name], typeof coreWikiDerive[name], `导出 ${name} 必须仍可经 wikiDerive 取到`)
  }
})

/* ---------- ③ causalSummary 三指标 ---------- */

test('causalSummary：固定小图的闭环率/耦合度/断点敏感度', () => {
  const graph = {
    nodes: [
      { id: 'a', chapter: 1, event: '起', kind: 'cause' },
      { id: 'b', chapter: 2, event: '承', kind: 'effect' },
      { id: 'c', chapter: 3, event: '转', kind: 'effect' },
      { id: 'd', chapter: 4, event: '合', kind: 'effect' },
      { id: 'e', chapter: 5, event: '收', kind: 'effect' }
    ],
    edges: [
      { from: 'a', to: 'b', type: 'causes', strength: 3, evidence: '因为所以' },
      { from: 'b', to: 'c', type: 'causes', strength: 2, evidence: '' },
      { from: 'c', to: 'd', type: 'causes', strength: 2, evidence: '' },
      { from: 'd', to: 'e', type: 'causes', strength: 1, evidence: '' }
    ],
    threads: [
      { id: 't1', name: '主线', nodes: ['a', 'b', 'c', 'd', 'e'], closed: true },
      { id: 't2', name: '支线', nodes: ['b', 'c'], closed: false }
    ]
  }
  const summary = enrichMetrics.causalSummary(graph)
  assert.deepEqual(Object.keys(summary), ['nodeCount', 'edgeCount', 'threadCount', 'closedRate', 'coupling', 'maxImpact', 'hasCycles'])
  assert.equal(summary.nodeCount, 5)
  assert.equal(summary.edgeCount, 4)
  assert.equal(summary.threadCount, 2)
  assert.equal(summary.closedRate, 0.5, '两条线索一条闭环')
  assert.equal(summary.coupling, 0.25, '5 章尾部 20%＝1 章，汇入第 5 章的边 1/4')
  assert.equal(summary.maxImpact, 4, '断掉 a→b，后 4 章从第 1 章不可达')
  assert.equal(summary.hasCycles, false)

  // 三指标单点出口：closedThreadRate／couplingScore／breakSensitivity 与汇总读数同值
  assert.equal(enrichMetrics.closedThreadRate(graph), summary.closedRate)
  assert.equal(enrichMetrics.couplingScore(graph), summary.coupling)
  assert.equal(enrichMetrics.breakSensitivity(graph).maxImpact, summary.maxImpact)
})

/* ---------- ④ deriveWiki 幂等 ---------- */

function characterEntry(name, { aliases = [], tier = 1 } = {}) {
  return {
    id: `c-${name}`,
    layer: 'character',
    name,
    aliases,
    identity: `${name}的身份`,
    traits: ['谨慎'],
    castRole: { tier },
    anchors: { speech: [`${name}说的第一句完整台词`], behavior: [`${name}推开门走进屋子`] },
    validity: { from: 1 }
  }
}

function plotEntries() {
  return Array.from({ length: 12 }, (_, index) => ({
    id: `p${index}`,
    layer: 'plot',
    name: `事件${index}`,
    validity: { from: 1 },
    who: index % 3 === 0 ? ['林逸', '苏晚'] : ['林逸'],
    events: [{
      who: index % 3 === 0 ? '苏晚' : '林逸',
      channel: index % 2 === 0 ? 'do' : 'say',
      content: `第${index}条足够长的言行内容`,
      segments: [{ index }]
    }],
    relations: index === 0 ? [{ from: '林逸', to: '苏晚', type: '同门', how: '拜入同一门下' }] : [],
    hooks: []
  }))
}

function wikiEnvelope() {
  return {
    book: { id: 'book-os154', title: '测试之书', author: '甲', word_count: 8800 },
    source: { chars: 8800 },
    entries: [characterEntry('林逸', { aliases: ['小逸'] }), characterEntry('苏晚'), ...plotEntries()],
    quality: { traceableRate: 0.91 },
    perspective: '三'
  }
}

test('deriveWiki 幂等：同输入跑两遍深等（含伪章/人物/图谱/时间线）', () => {
  const options = { sourceText: '第1章 开端\n第2章 承接\n' }
  const first = wikiDerive.deriveWiki(wikiEnvelope(), options)
  const second = wikiDerive.deriveWiki(wikiEnvelope(), options)
  assert.deepEqual(second, first)
  assert.equal(first.pseudoChapters, true, '全 plot validity.from=1 → 走伪章')
  assert.deepEqual(first.chapters.map((chapter) => chapter.no), [1, 2, 3, 4])
  assert.deepEqual(first.characters.map((person) => person.name).sort(), ['林逸', '苏晚'])
  assert.equal(first.book.words, 8800)
  assert.equal(first.quality.traceableRate, 0.91)
})

test('等价：deriveWiki 与 core 原件同输入深等', () => {
  const options = { sourceText: '第1章 开端\n' }
  assert.deepEqual(wikiDerive.deriveWiki(wikiEnvelope(), options), coreWikiDerive.deriveWiki(wikiEnvelope(), options))
  // 真章书分支也对照一次（distinct validity.from > 1 时不走伪章）
  const real = wikiEnvelope()
  real.entries = real.entries.map((entry, index) => entry.layer === 'plot'
    ? { ...entry, validity: { from: Math.floor(index / 3) } }
    : entry)
  assert.deepEqual(wikiDerive.deriveWiki(real, options), coreWikiDerive.deriveWiki(real, options))
})

/* ---------- ⑤ factPack 打包形状与查询语义 ---------- */

function factEntries() {
  return [
    {
      id: 'w1', layer: 'worldview', name: '灵潮', slot: 'power_levels', rank: 1,
      definition: '每逢甲子，天地灵气暴涨三月。', status: 'adopted', validity: { from: 1, to: 12 }
    },
    {
      id: 'w2', layer: 'worldview', name: '潮汐', slot: 'power_levels', rank: 2,
      definition: '潮起潮落，各有其序。', status: 'adopted', validity: { from: 2, to: 8 },
      readerCognition: { firstMention: true, supplementNeeded: false }
    },
    {
      id: 'w3', layer: 'worldview', name: '门规', definition: '不入门规者不得入内。', status: 'draft',
      validity: { from: 5 }
    },
    {
      id: 'p1', layer: 'plot', name: '初遇', validity: { from: 1, to: 3 },
      events: [
        { index: 1, title: '相遇', track: 'fact', refs: ['w1'], segments: [{ index: 0, chapter: 1 }], novelty: [] },
        { index: 2, title: '猜测', track: 'hypothesis', refs: [], segments: [], novelty: [] }
      ]
    },
    {
      id: 'p2', layer: 'plot', name: '再会', validity: { from: 7, to: 9 },
      events: [{ index: 3, title: '重逢', track: 'fact', refs: [], segments: [{ index: 20, chapter: 7 }], novelty: [] }]
    },
    {
      id: 'c1', layer: 'character', name: '林逸', aliases: ['小逸'], castRole: { tier: 1 },
      anchors: { speech: ['你好'] }, memoryPoints: ['记得灵潮'], validity: { from: 1 },
      knowledge: [
        { fromEntry: 'w1', kind: 'learned', atSpan: { from: 2, to: 2 } },
        { fromEntry: 'w3', kind: 'learned', atSpan: { from: 5, to: 5 } }
      ]
    }
  ]
}

test('factPack 打包形状：顶层键与各段键齐全、顺序稳定', () => {
  const pack = buildFactPack(factEntries(), {})
  assert.deepEqual(Object.keys(pack), [
    'ok', 'query', 'world', 'events', 'characters', 'supplements', 'effective', 'counts', 'warnings', 'losses'
  ])
  assert.deepEqual(Object.keys(pack.query), ['span', 'character', 'slots', 'layer', 'domain'])
  assert.deepEqual(Object.keys(pack.world), ['slots', 'ordered', 'rules'])
  assert.deepEqual(Object.keys(pack.events), ['facts', 'hypotheses'])
  assert.deepEqual(Object.keys(pack.counts), ['entries', 'worldview', 'facts', 'hypotheses', 'characters'])
  assert.equal(pack.ok, true)
  assert.deepEqual(pack.counts, { entries: 6, worldview: 3, facts: 2, hypotheses: 1, characters: 1 })
  assert.deepEqual(Object.keys(pack.world.slots), ['power_levels', 'other'])
  assert.deepEqual(pack.world.ordered, [{
    slot: 'power_levels',
    items: [{ id: 'w1', name: '灵潮', rank: 1 }, { id: 'w2', name: '潮汐', rank: 2 }]
  }])
  assert.deepEqual(pack.supplements, [{ id: 'w2', name: '潮汐', firstMention: true, supplementNeeded: false }])
  assert.deepEqual(pack.events.facts.map((event) => event.title), ['相遇', '重逢'])
  assert.deepEqual(pack.events.hypotheses.map((event) => event.title), ['猜测'])
})

test('factPack 查询区间语义：无界/相交/角色知情', () => {
  const entries = factEntries()
  // 无界查询＝全时段，所有条目生效
  const unbounded = buildFactPack(entries, {})
  assert.deepEqual(unbounded.query.span, { from: null, to: null })
  assert.equal(unbounded.counts.entries, 6)

  // 整数 span 归一成单点区间；validity 与 span 相交才命中
  const at4 = buildFactPack(entries, { span: 4 })
  assert.deepEqual(at4.query.span, { from: 4, to: 4 })
  assert.deepEqual(at4.effective.map((entry) => entry.id).sort(), ['c1', 'w1', 'w2'])
  assert.equal(at4.counts.entries, 3)

  const at8 = buildFactPack(entries, { span: { from: 8, to: 8 } })
  assert.deepEqual(at8.effective.map((entry) => entry.id).sort(), ['c1', 'p2', 'w1', 'w2', 'w3'])

  // includeInactive 关闭生效过滤（失效条目也投影）
  const at20 = buildFactPack(entries, { span: 20 })
  assert.deepEqual(at20.effective.map((entry) => entry.id).sort(), ['c1', 'w3'])
  const all = buildFactPack(entries, { span: 20, includeInactive: true })
  assert.equal(all.counts.entries, 6)

  // 角色知情：已知时点 ≤ 查询起点才收（更早知道的仍然记得）
  const at3 = buildFactPack(entries, { span: 3, character: '林逸' })
  assert.deepEqual(at3.characters['林逸'].knowledge, [{ fromEntry: 'w1', kind: 'learned', atSpan: { from: 2, to: 2 } }])
  const at6 = buildFactPack(entries, { span: 6, character: '林逸' })
  assert.equal(at6.characters['林逸'].knowledge.length, 2)

  // 角色查询走别名解析：小逸 → 林逸
  const alias = buildFactPack(entries, { character: '小逸' })
  assert.deepEqual(Object.keys(alias.characters), ['林逸'])
  assert.deepEqual(alias.query.character, '小逸')

  // 槽位过滤只影响 world.slots，不影响 effective
  const slots = buildFactPack(entries, { slots: ['other'] })
  assert.deepEqual(Object.keys(slots.world.slots), ['other'])
  assert.deepEqual(slots.query.slots, ['other'])
})

test('金样：factPack 多组查询输出的 sha256 逐组锁死（OS-155 删除 core 原件前由 src≡core 等价对拍冻结）', () => {
  const entries = factEntries()
  const queries = [
    {},
    { span: 4 },
    { span: { from: 8, to: 8 } },
    { span: 20, includeInactive: true },
    { span: 3, character: '林逸' },
    { character: '小逸' },
    { slots: ['other'], layer: 'worldview' },
    { domain: '修炼体系' }
  ]
  // 金样＝删除 core 原件当日实测（当时 `buildFactPack` 与 core 原件对拍深等），顺序与 queries 一一对应。
  const golden = [
    'e8622a87dc123ac403c9634c2770850d76db37e81376d83f00cfb36d0589085e',
    'e44a20caf3412ab64c8c782a90fa6f42a7ffb1c64ff3d9acfd180ea067bafcca',
    'c98d545b13bad3eb5a30997efc044504b1d5387775dd2f16fb7e0c270fc72f3c',
    '3b0880b76067ed25307c851bed80899d7cc2e8579f7d85994c5b1bd8136e8759',
    'e64b35e936e3d6d7a3f33703c40412a8617eeb55c94bfd274a1f9edbfc690da1',
    'c52506ed46902845b4167b3706f560cbf0116036fcd04b80c9e6b1d2cca993d8',
    'c6bc9bfc9d9d43f6a46563d3ccddcb9aa4c850722b0dc65957c6eded544158bc',
    '456623d42a74b898c505cea048fc30c976006d65e0c75e6450810a4ecd02315b'
  ]
  queries.forEach((query, index) => {
    const digest = createHash('sha256').update(JSON.stringify(buildFactPack(entries, query))).digest('hex')
    assert.equal(digest, golden[index], `查询 ${JSON.stringify(query)} 的输出与金样不符（行为漂移）`)
  })
})
