/**
 * D6b：事实链条目 → 世界书笔记 投影（纯函数）回归。
 * 只测投影规则本身（层→目录、frontmatter、双链、分节、同名去重），不碰磁盘。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { factEntryToNote, planNotesFromFact, safeNoteName } from '../src/protocol/factNoteProjection.mjs'

const character = {
  schema: 'fact.data/v3', id: 'a1', layer: 'character', name: '洪信', domain: '水浒传',
  identity: '殿前太尉',
  definition: '奉旨赴龙虎山，误放[[一百单八魔君]]。',
  castRole: { goal: '请天师禳疫', plotFunction: '误放魔君' },
  provenance: { chapters: [1] }
}
const plot = {
  schema: 'fact.data/v3', id: 'p1', layer: 'plot', name: '误走妖魔',
  fact: '洪太尉强开后殿。',
  events: [{ index: 1, who: '洪信', channel: 'action', content: '强开伏魔殿' }],
  provenance: { chapters: [1] }
}
const worldview = {
  schema: 'fact.data/v3', id: 'w1', layer: 'worldview', name: '一百单八魔君', slot: 'creatures',
  definition: '被镇压的魔君。', provenance: { chapters: [1] }
}

test('D6b 层→目录：character→人物 / plot→事件 / worldview→设定', () => {
  assert.equal(factEntryToNote(character).ref, '世界书/人物/洪信.md')
  assert.equal(factEntryToNote(plot).ref, '世界书/事件/误走妖魔.md')
  assert.equal(factEntryToNote(worldview).ref, '世界书/设定/一百单八魔君.md')
})

test('D6b frontmatter：title 取 name，tags 带层名与 domain', () => {
  const note = factEntryToNote(character)
  assert.match(note.text, /^---\ntags: \[人物, 水浒传, 身份\]\ntitle: 洪信\n---\n/u)
  assert.match(note.text, /^# 洪信$/mu)
})

test('D6b 分节：概述/身份/剧情作用/事件流/出处按层出现', () => {
  const c = factEntryToNote(character).text
  assert.match(c, /## 概述/u); assert.match(c, /## 身份/u)
  assert.match(c, /## 剧情作用/u); assert.match(c, /## 出处/u)
  const p = factEntryToNote(plot).text
  assert.match(p, /## 事件流/u); assert.match(p, /强开伏魔殿/u)
  assert.match(p, /第 1 回/u)
})

test('D6b 双链：正文里出现同库其它条目名时挂 [[ ]]', () => {
  const names = ['洪信', '一百单八魔君', '误走妖魔']
  const note = factEntryToNote({ ...plot, fact: '洪信放走一百单八魔君' }, { names })
  assert.match(note.text, /\[\[洪信\]\]/u)
  assert.match(note.text, /\[\[一百单八魔君\]\]/u)
  // 自身名不挂链
  const self = factEntryToNote({ ...plot, fact: '误走妖魔一事' }, { names })
  assert.doesNotMatch(self.text, /\[\[误走妖魔\]\]/u)
})

test('D6b 文件名安全化：去掉路径分隔与保留字符，保留中文', () => {
  assert.equal(safeNoteName('a/b\c:d*e?f"g<h>i|j'), 'abcdefghij')
  assert.equal(safeNoteName('一百单八魔君'), '一百单八魔君')
  assert.equal(safeNoteName('..hidden'), 'hidden')
})

test('D6b planNotesFromFact：39 条全出、同名不静默覆盖、layers 过滤生效', () => {
  const entries = [character, plot, worldview, { ...character, id: 'a2', layer: 'plot', name: '洪信' }]
  const all = planNotesFromFact({ entries })
  assert.equal(all.length, 4)
  const refs = all.map((n) => n.ref)
  assert.equal(new Set(refs).size, 4, '同名不同层要加层后缀，不撞文件名')
  const onlyChar = planNotesFromFact({ entries }, { layers: ['character'] })
  assert.equal(onlyChar.length, 1)
  assert.equal(onlyChar[0].ref, '世界书/人物/洪信.md')
})
