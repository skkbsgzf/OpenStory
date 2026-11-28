import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { knowledgeBaseHtml } from '../public/views/knowledgeBaseViews.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const library = { id: 'fixture', name: '修仙库', enabled: true, customization: { displayName: '修仙', retrieval: { topK: 6, minScore: 0.3, budgetChars: 6000 } } }
const documents = [{ ref: 'docs/剑修.md', title: '剑修', tags: ['人物'], chars: 20, text: '以剑入道' }]

test('知识库工作台：空库、登记表单、wiki、搜索、索引降级', () => {
  const empty = knowledgeBaseHtml({ loaded: true, libraries: [], form: { kind: 'register', root: '', id: '', name: '' } })
  assert.match(empty, /还没有知识库/u)
  assert.match(empty, /登记已有知识库/u)
  const state = { loaded: true, libraries: [library], activeLibraryId: 'fixture', documents, activeRef: 'docs/剑修.md', document: documents[0], backlinks: { linked: [], unlinked: [] }, indexStatus: 'stale', runtimeAvailable: false, graph: { nodes: [{ id: 'docs/剑修.md', kind: 'document', label: '剑修' }], edges: [], stats: { nodes: 1, edges: 0, byKind: { document: 1 } } } }
  const html = knowledgeBaseHtml(state)
  assert.match(html, /知识库/u)
  assert.match(html, /data-wiki-open="docs\/剑修.md"/u)
  assert.match(html, /HyperGraphRAG/u)
  assert.match(html, /语义检索与同步会明确降级/u)
  assert.match(html, /同步索引/u)
  assert.doesNotMatch(html, /世界书/u)
  const graph = knowledgeBaseHtml({ ...state, view: 'graph' })
  assert.match(graph, /kb-graph-canvas/u)
  assert.match(graph, /文档/u)
})

test('知识库 controller：API 路径与确认/切换逻辑均为生产调用', () => {
  const src = readFileSync(join(ROOT, 'public/views/knowledgeBaseController.mjs'), 'utf8')
  assert.match(src, /\/api\/knowledge\/libraries/u)
  assert.match(src, /confirm: true/u)
  assert.match(src, /\/api\/knowledge\/search/u)
  const app = readFileSync(join(ROOT, 'public/app.js'), 'utf8')
  // 点击必须经控制器，但只有控制器认领的点击才拦截——否则知识库视图会吞掉顶栏/页签点击。
  assert.match(app, /knowledgeBaseController\?\.owns\(target\)/u)
  assert.match(app, /knowledgeBaseController\.click\(target\)/u)
  assert.match(src, /owns\(target\)/u)
  assert.match(app, /knowledgeBaseHtml: \(\) => knowledgeBaseController/u)
})
