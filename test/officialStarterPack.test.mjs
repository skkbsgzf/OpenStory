/**
 * 官方样板知识库本体初稿护栏（乙批）：只验文档本体与检索夹具结构，不依赖运行时。
 * 真正的索引/检索需要 HyperGraphRAG venv，缺口记在 docs/knowledge-experience-gaps.md。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const docs = [
  ['guanjue-zhidu-sucha.md', 'reference-book', '古代官爵制度速查'],
  ['shenhuadaquan-qibu.md', 'reference-book', '神话大全·起步卷'],
  ['gongdou-liyi-weifen.md', 'craft-manual', '宫斗网文创作手册·礼仪与位分秩序'],
  ['duanpian-qingxu-jiezou.md', 'method-paper', '短篇情绪节奏方法论'],
  ['dushi-yiliao-changshi.md', 'material-notes', '都市文行业常识·医疗篇起步']
]

const read = (name) => readFileSync(new URL(`../knowledge-packs/official-starter/${name}`, import.meta.url), 'utf-8')

test('五篇本体齐：frontmatter 合法、四种形态全覆盖、标题一致', () => {
  const types = new Set()
  for (const [name, type, title] of docs) {
    const text = read(name)
    assert.match(text, /^---\n/u, `${name} 缺 frontmatter 起始`)
    assert.match(text, /^---\nname: [a-z0-9-]+\ntype: [a-z-]+\ntitle: .+\ntags: \[.+\]\nupstream: .+\n---\n/u, `${name} frontmatter 形状不对`)
    assert.ok(text.includes(`type: ${type}`), `${name} type 不对`)
    assert.ok(text.includes(`title: ${title}`), `${name} title 不对`)
    types.add(type)
  }
  assert.deepEqual([...types].sort(), ['craft-manual', 'material-notes', 'method-paper', 'reference-book'])
})

test('每篇都有 QUERY 指南与检索验收夹具（应命中/不应命中各至少两条）', () => {
  for (const [name] of docs) {
    const text = read(name)
    assert.match(text, /## QUERY 指南/u, `${name} 缺 QUERY 指南`)
    assert.match(text, /## 检索验收夹具/u, `${name} 缺检索验收夹具`)
    const fixtures = text.slice(text.indexOf('## 检索验收夹具'))
    assert.equal((fixtures.match(/应命中/gu) || []).length >= 2, true, `${name} 应命中夹具不足`)
    assert.equal((fixtures.match(/不应命中/gu) || []).length >= 2, true, `${name} 不应命中夹具不足`)
  }
})

test('manifest 形状合法且 documentEntry 指向五篇之一', () => {
  const manifest = JSON.parse(readFileSync(new URL('../knowledge-packs/official-starter/knowledge.base.json', import.meta.url), 'utf-8'))
  assert.equal(manifest.schema, 'openstory.knowledge-base@1')
  assert.equal(manifest.id, 'official-starter')
  assert.equal(manifest.license, 'CC-BY-4.0')
  assert.equal(manifest.formats.join(','), '.md')
  assert.ok(docs.some(([name]) => name === manifest.documentEntry), 'documentEntry 不在五篇内')
})
