import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { withTempDaemon } from './helpers/tempDaemon.mjs'
import { previewKnowledgeLibrary, registerKnowledgeLibrary } from '../src/modules/knowledge-base/knowledgeLibraryStore.mjs'

async function knowledgeFixture(base) {
  const root = join(base, 'kb')
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'knowledge.base.json'), JSON.stringify({ schema: 'openstory.knowledge-base@1', schemaVersion: 1, id: 'e2e', name: 'E2E 知识库', version: '1.0.0', vendor: 'OpenStory', license: 'MIT', documentEntry: 'docs/index.md', formats: ['.md'], exclude: [], retrievalDefaults: { topK: 6, minScore: 0.3, budgetChars: 6000 }, tagMap: {}, nodeMap: {}, edgeMap: {} }))
  await writeFile(join(root, 'docs/index.md'), '# 索引\n\n跨项目知识。')
  await writeFile(join(root, 'docs/技法.md'), '# 三拍法\n\n代价、失效、兑现。 #技法')
  return root
}

test('知识库真实 daemon：preview→confirm→列表/文档/图谱；源只读；坏 ref 拒绝', async () => {
  await withTempDaemon(async (fixture) => {
    const source = await knowledgeFixture(fixture.base)
    const before = await readFile(join(source, 'docs/技法.md'))
    const preview = await previewKnowledgeLibrary({ root: source }, fixture.env)
    assert.equal(preview.ok, true)
    const registered = await fixture.json('/api/knowledge/library/register', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ previewId: preview.previewId, confirm: true }) })
    assert.equal(registered.status, 200, JSON.stringify(registered.payload))
    const list = await fixture.json('/api/knowledge/libraries')
    assert.equal(list.status, 200, JSON.stringify(list.payload))
    assert.equal(list.payload.libraries.length, 1)
    assert.equal(list.payload.libraries[0].root, undefined)
    const docs = await fixture.json('/api/knowledge/documents?libraryId=e2e')
    assert.equal(docs.status, 200, JSON.stringify(docs.payload))
    assert.equal(docs.payload.documents.length, 2)
    assert.equal(docs.payload.indexStatus, 'stale', 'runtime 未安装不能伪装 fresh')
    if (docs.status >= 500) console.error('KB_DOCS_500', docs.payload)
    const doc = await fixture.json('/api/knowledge/document?libraryId=e2e&documentRef=docs/%E6%8A%80%E6%B3%95.md')
    assert.equal(doc.status, 200, JSON.stringify(doc.payload))
    assert.equal(doc.payload.document.ref, 'docs/技法.md')
    const graph = await fixture.json('/api/knowledge/graph?libraryId=e2e')
    assert.equal(graph.payload.graph.nodes.some((node) => node.kind === 'document'), true)
    const escape = await fixture.json('/api/knowledge/document?libraryId=e2e&documentRef=../secret.md')
    assert.equal(escape.status, 403)
    assert.equal(escape.payload.error.code, 'PATH_ESCAPE')
    assert.deepEqual(await readFile(join(source, 'docs/技法.md')), before)
    await fixture.close()
  })
})

test('知识库 daemon：模块停用后数据保留，端点 MODULE_DISABLED', async () => {
  await withTempDaemon(async (fixture) => {
    const source = await knowledgeFixture(fixture.base)
    const preview = await previewKnowledgeLibrary({ root: source }, fixture.env)
    await registerKnowledgeLibrary({ previewId: preview.previewId, confirm: true }, fixture.env)
    const disabled = await fixture.json('/api/ui-state', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: fixture.root, state: { 'modules.enabled.knowledge-base': false } }) })
    assert.equal(disabled.status, 200, JSON.stringify(disabled.payload))
    const response = await fixture.json('/api/knowledge/libraries')
    assert.equal(response.status, 409)
    assert.equal(response.payload.error.code, 'MODULE_DISABLED')
    const path = join(fixture.appData, 'OpenStory', 'openstory', 'knowledge-libraries.json')
    assert.equal(JSON.parse(await readFile(path, 'utf8')).libraries.length, 1)
  })
})

void mkdtemp
void tmpdir
