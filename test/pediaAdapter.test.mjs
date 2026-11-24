/**
 * ADR 0001 附录 A 逐条钉死：pedia/v1 ↔ fact.data/v3 薄适配（OS-162）。
 * 三层样本按规范 entry 模板构造（与 ADR 同源），投喂本仓校验器——转换后零 error、
 * id 逐位不变；style 层单列；反向丢失清单与 A3 逐项一致。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stableEntryId } from '../src/protocol/factDomain.mjs'
import {
  pediaToFactEntry, factEntryToPedia, PEDIA_LOSS_FIELDS
} from '../src/modules/exchange/pediaAdapter.mjs'
import { FACT_SCHEMA } from '../src/protocol/factDomain.mjs'

const PROV = { book: '水浒传', book_id: 'shuihu', chapters: [1], scenes: [], extractor: 'pedia-fixture', quote_hash: 'a'.repeat(40) }
const FP = { vec: [0.1, 0.2], metrics: {} }

function idOf(layer, domain, slot, name) {
  return stableEntryId({ layer, domain, slot, name })
}

function worldview() {
  const name = '梁山泊'
  return {
    schema: 'pedia/v1', id: idOf('worldview', '水浒', 'locations', name),
    layer: 'worldview', name, domain: '水浒', slot: 'locations', definition: '水泊梁山',
    aliases: ['梁山'], relations: [{ to: '宋江', type: '据点' }], stats: {}, votes: {},
    span: { first_chapter: 1, last_chapter: 10 }, provenance: { ...PROV }, fingerprint: { ...FP }
  }
}
function character() {
  const name = '林冲'
  return {
    schema: 'pedia/v1', id: idOf('character', '', '', name), layer: 'character', name,
    provenance: { ...PROV }, fingerprint: { ...FP },
    identity: '八十万禁军教头', personality: '隐忍', trajectory: '逼上梁山'
  }
}
function plot() {
  const name = '风雪山神庙'
  return {
    schema: 'pedia/v1', id: idOf('plot', '', '', name), layer: 'plot', name,
    provenance: { ...PROV }, fingerprint: { ...FP },
    fact: '林冲雪夜上梁山', hypothesis: '陆虞侯设计', events: [{ content: '草料场起火', track: 'fact' }]
  }
}

test('A2：三层样本转换后零 error，schema 改名、status/provenance.mode 补齐，id 逐位不变', () => {
  for (const sample of [worldview(), character(), plot()]) {
    const result = pediaToFactEntry(sample)
    assert.deepEqual(result.errors, [], `${sample.layer} 应零 error：${JSON.stringify(result.errors)}`)
    assert.equal(result.entry.id, sample.id, 'id 原样保留（不重算）')
    assert.equal(result.entry.schema, FACT_SCHEMA)
    assert.equal(result.entry.status, 'draft')
    assert.equal(result.entry.provenance.mode, 'analyze')
    // 其余字段原样（抽查 aliases/relations/span/各层 optional）
    for (const key of ['layer', 'name', 'aliases', 'relations', 'span', 'identity', 'personality', 'trajectory', 'fact', 'hypothesis', 'events']) {
      if (sample[key] !== undefined) assert.deepEqual(result.entry[key], sample[key], `${key} 原样`)
    }
  }
})

test('A1/A2：style 层无归宿——不转换、单列 skipped 与原因', () => {
  const result = pediaToFactEntry({ schema: 'pedia/v1', layer: 'style', name: '白描', id: 'whatever' })
  assert.equal(result.skipped, true)
  assert.match(result.reason, /style 层已解耦/u)
  assert.equal(result.entry, undefined, '不给 fact 条目')
})

test('A3：反向投影返回丢失字段清单，逐项与附录一致', () => {
  const factW = pediaToFactEntry(worldview()).entry
  const outW = factEntryToPedia(factW)
  assert.equal(outW.entry.schema, 'pedia/v1')
  assert.equal(outW.entry.id, factW.id, '反向也原样保留 id')
  assert.deepEqual(outW.lost.sort(), ['status', 'provenance.mode'].sort())

  const factC = pediaToFactEntry(character()).entry
  const withCharExtras = {
    ...factC, anchors: [{ name: '棍' }], memoryPoints: ['东京'], castRole: '主角', knowledge: ['禁军']
  }
  const outC = factEntryToPedia(withCharExtras)
  for (const field of PEDIA_LOSS_FIELDS.character) assert.ok(outC.lost.includes(field), `${field} 必须列入丢失`)

  const factP = pediaToFactEntry(plot()).entry
  const withPlotExtras = {
    ...factP, rhythmSpec: {}, structureTemplates: [],
    events: [{ content: '草料场起火', track: '主线', novelty: 0.5, segments: [1] }]
  }
  const outP = factEntryToPedia(withPlotExtras)
  for (const field of PEDIA_LOSS_FIELDS.plot) assert.ok(outP.lost.includes(field), `${field} 必须列入丢失`)
  assert.ok(outP.entry.events?.[0]?.content, 'events 本身带得走')
  assert.equal(outP.entry.events[0].track, undefined, '事件内 track 不出现在 pedia 投影')
})

test('纯函数：字段原样不共享引用（深拷贝），坏输入如实报错不崩', () => {
  const sample = worldview()
  const result = pediaToFactEntry(sample).entry
  result.aliases.push('改后')
  assert.deepEqual(sample.aliases, ['梁山'], '适配器深拷贝，不改入参')
  assert.equal(pediaToFactEntry(null).errors[0].code, 'INVALID_ENTRY')
})
