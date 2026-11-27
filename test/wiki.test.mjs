/** OS-225 中性 wiki 层：合成知识库数据不得带世界书/fact/firstChapter 语义。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildWikiDocumentTree, buildWikiTagTree, filterWikiTree } from '../public/wiki/tree.mjs'
import {
  wikiBacklinksHtml, wikiDetailHtml, wikiGraphViewHtml, wikiNavigationHtml,
  wikiNodeCardHtml, wikiStateHtml
} from '../public/wiki/view.mjs'
import { wikiMarkdownEditorHtml, wikiMarkdownReaderHtml } from '../public/wiki/markdown.mjs'
import { renderInline, renderMarkdown, splitBlocks } from '../public/md.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const docs = [
  { id: 'doc:1', ref: 'docs/剑修.md', title: '剑修', path: 'docs/剑修.md', tags: ['人物/剑修', '修炼'], excerpt: '以剑入道', chars: 42, body: '# 剑修\n\n以剑入道。' },
  { id: 'doc:2', ref: 'docs/丹方.md', title: '丹方', path: 'docs/丹方.md', tags: ['物品'], excerpt: '回气丹', chars: 20 }
]

test('中性树：标签、多挂载、无标签与搜索，不依赖世界书字段', () => {
  const tags = buildWikiTagTree([{ name: '人物/剑修', count: 1 }, { name: '修炼', count: 1 }])
  assert.equal(tags.children.get('人物').count, 1)
  const tree = buildWikiDocumentTree([...docs, { id: 'raw', title: '散篇', tags: [] }])
  assert.equal(tree.items.length, 1)
  assert.equal(tree.children.get('人物').children.get('剑修').items[0].id, 'doc:1')
  assert.equal(tree.children.get('修炼').items[0].id, 'doc:1')
  const filtered = filterWikiTree(tree, '回气')
  assert.equal(filtered.children.get('物品').items[0].id, 'doc:2')
  assert.equal(filtered.children.size, 1)
})

test('中性导航/详情/反链/图谱：合成 KB 数据不含世界书专属策略', () => {
  const nav = wikiNavigationHtml({ items: docs, activeId: 'doc:1' })
  assert.match(nav, /data-wiki-open="doc:1"/u)
  assert.doesNotMatch(nav, /世界书|firstChapter|故事源|fact/u)
  const backlinks = wikiBacklinksHtml({ linked: [docs[1]], unlinked: [], getId: (item) => item.ref })
  assert.match(backlinks, /data-wiki-open="docs\/丹方.md"/u)
  const detail = wikiDetailHtml({ id: 'doc:1', title: '剑修', bodyHtml: '<p>以剑入道</p>', backlinksHtml: backlinks })
  assert.match(detail, /wiki-doc/u)
  assert.match(detail, /已链接/u)
  const graph = wikiGraphViewHtml({
    graph: { nodes: [{ id: 'doc:1', kind: 'document', label: '剑修' }], edges: [], stats: { nodes: 1, edges: 0, byKind: { document: 1 } } },
    kindLabels: { document: { label: '文档', color: 'var(--accent)' } },
    nodeCardHtml: wikiNodeCardHtml({ id: 'doc:1', kind: 'document', label: '剑修' }, { kindLabels: { document: { label: '文档' } } })
  })
  assert.match(graph, /文档/u)
  assert.doesNotMatch(graph, /世界书|artifact|entry/u)
})

test('中性状态：loading/error/degraded/empty 分明', () => {
  assert.match(wikiStateHtml({ loading: true }), /loading/u)
  assert.match(wikiStateHtml({ error: '坏了' }), /error-box/u)
  assert.match(wikiStateHtml({ degraded: '未安装' }), /degraded-note/u)
  assert.match(wikiStateHtml({ empty: '暂无' }), /暂无/u)
})

test('Markdown resolver：默认世界书行为不变，KB 可返回自己的 ref/href', () => {
  assert.match(renderInline('[[剑修]]'), /data-ref="剑修"/u)
  const custom = renderMarkdown('见 [[剑修#剑气]]', {
    resolveWikiLink: ({ target, anchor }) => ({ className: 'kb-link', attrs: { 'data-kb-ref': target, 'data-anchor': anchor } })
  })
  assert.match(custom, /data-kb-ref="剑修"/u)
  assert.match(custom, /data-anchor="剑气"/u)
  assert.doesNotMatch(custom, /data-ref=/u)
})

test('Markdown reader/editor：块 HTML 可参数化，offset 与保存策略分离', () => {
  const source = '# 标题\n\n正文\n\n下一块'
  const reader = wikiMarkdownReaderHtml(source, { md: { renderMarkdown, splitBlocks } })
  assert.match(reader, /wiki-prose/u)
  const editor = wikiMarkdownEditorHtml(source, { md: { renderMarkdown, splitBlocks }, offset: 4, skipHeading: true })
  assert.match(editor, /data-start="10"/u)
  assert.match(editor, /contenteditable="true"/u)
  assert.doesNotMatch(editor, /世界书/u)
})

test('纯度：public/wiki 不访问 DOM/存储，也不 import 世界书实现', () => {
  for (const name of ['tree.mjs', 'view.mjs', 'markdown.mjs']) {
    const src = readFileSync(join(ROOT, 'public/wiki', name), 'utf8')
    assert.doesNotMatch(src, /document|window|localStorage|sessionStorage|indexedDB/u)
    assert.doesNotMatch(src, /referenceStore|worldbook|firstChapter/u)
  }
})
