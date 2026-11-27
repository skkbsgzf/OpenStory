/** 统一检索服务：canonical hits/provenance、总预算、去重、stale/down 与缓存失效。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { KnowledgeSearchService } from '../src/modules/knowledge-base/knowledgeSearchService.mjs'
import { previewKnowledgeLibrary, registerKnowledgeLibrary, setKnowledgeLibraryState } from '../src/modules/knowledge-base/knowledgeLibraryStore.mjs'

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-kb-search-'))
  const root = join(base, 'kb')
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'knowledge.base.json'), JSON.stringify({ schema: 'openstory.knowledge-base@1', schemaVersion: 1, id: 'fixture', name: '检索夹具', version: '1.0.0', vendor: 'OpenStory', license: 'MIT', documentEntry: 'docs/index.md', formats: ['.md'], exclude: [], retrievalDefaults: { topK: 6, minScore: 0.3, budgetChars: 1000 }, tagMap: {}, nodeMap: {}, edgeMap: {} }))
  await writeFile(join(root, 'docs/index.md'), '# 索引\n\n入口')
  await writeFile(join(root, 'docs/a.md'), '# A\n\nabcdefghij')
  await writeFile(join(root, 'docs/b.md'), '# B\n\nklmnopqrst')
  const env = { LOCALAPPDATA: join(base, 'local'), APPDATA: join(base, 'local') }
  const preview = await previewKnowledgeLibrary({ root }, env)
  await registerKnowledgeLibrary({ previewId: preview.previewId, confirm: true }, env)
  const record = (await import('../src/modules/knowledge-base/knowledgeLibraryStore.mjs')).readKnowledgeLibraries(env)
  const table = await record
  const library = table.table.libraries[0]
  library.index = { status: 'fresh', contentRevision: library.contentRevision, indexHash: 'index-1', runtimeVersion: 'hypergraph-test', builtAt: new Date().toISOString(), error: null }
  await setKnowledgeLibraryState(library.id, { activate: true }, env)
  await writeFile(requirePath(env), JSON.stringify(table.table, null, 2))
  return { base, root, env }
}

function requirePath(env) { return join(env.LOCALAPPDATA, 'OpenStory', 'openstory', 'knowledge-libraries.json') }

test('统一检索：canonical hit、去重、总预算与 provenance', async () => {
  const { base, env } = await fixture()
  try {
    let calls = 0
    const runtime = {
      health: () => ({ ok: true, version: 'hypergraph-test', engine: 'hypergraphrag' }),
      query: async () => { calls++; return { ok: true, provider: 'hypergraphrag', hits: [
        { ref: 'docs/a.md', title: 'A', text: 'abcdefghij', score: 0.9, documentHash: 'ha', chunkId: 'c1' },
        { ref: 'docs/a.md', title: 'A', text: 'abcdefghij', score: 0.8, documentHash: 'ha', chunkId: 'c1' },
        { ref: 'docs/b.md', title: 'B', text: 'klmnopqrst', score: 0.7, documentHash: 'hb', chunkId: 'c2' }
      ] } }
    }
    const service = new KnowledgeSearchService({ env, resolveCapability: () => runtime })
    const result = await service.search({ query: '测试', budgetChars: 15 })
    assert.equal(result.ok, true)
    assert.equal(result.hits.length, 2)
    assert.equal(result.hits.reduce((sum, hit) => sum + hit.text.length, 0) <= 15, true)
    assert.equal(result.hits[0].provenance.documentRef, 'docs/a.md')
    assert.equal(result.hits[0].provenance.chunkId, 'c1')
    assert.equal(result.hits[0].libraryId, 'fixture')
    await service.search({ query: '测试', budgetChars: 15 })
    assert.equal(calls, 1, '成功结果按完整身份缓存')
    await service.search({ query: '测试', budgetChars: 16 })
    assert.equal(calls, 2, '预算变化必须换 key')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('统一检索：runtime down/stale 不返回假空 hits，切库失效', async () => {
  const { base, env } = await fixture()
  try {
    const down = new KnowledgeSearchService({ env, resolveCapability: () => null })
    assert.equal((await down.search({ query: 'x' })).code, 'PLUGIN_DEGRADED')
    const runtime = { health: () => ({ ok: true, version: 'wrong' }), query: async () => ({ ok: true, hits: [] }) }
    const stale = new KnowledgeSearchService({ env, resolveCapability: () => runtime })
    assert.equal((await stale.search({ query: 'x' })).code, 'STALE_INDEX')
    const read = await stale.read({ documentRef: 'docs/a.md' })
    assert.equal(read.ok, true, 'runtime 不可用时文档浏览仍可用')
    assert.equal((await stale.read({ documentRef: '../secret.md' })).code, 'PATH_ESCAPE')
  } finally { await rm(base, { recursive: true, force: true }) }
})
