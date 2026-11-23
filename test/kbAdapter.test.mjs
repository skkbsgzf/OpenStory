/**
 * KB 适配层用例——mock 后端全链＋WeKnora 响应规整（真实字段形状来自 v0.9.0 源码）。
 *
 * 跑法：
 *   node --test test/kbAdapter.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  KB_ERROR_CODES,
  createKbClient,
  defaultKbConfigPath,
  loadKbConfig,
  normalizeCollections,
  normalizeHits
} from '../src/services/kbAdapter.mjs'

/* ---------- 响应规整（真实形状） ---------- */

test('检索响应：WeKnora {success,data:[chunk]} → 我们的 hit 形状', () => {
  const payload = {
    success: true,
    data: [
      { id: 'c1', content: '结尾一句反转是知乎短篇的标配。', knowledge_id: 'k1', knowledge_base_id: 'kb1', chunk_index: 3, score: 0.82 },
      { id: 'c2', content: '开头 100 字内要出现异常。', knowledge_id: 'k2', knowledge_base_id: 'kb1', chunk_index: 0 }
    ],
    meta: { total: 2 }
  }
  const hits = normalizeHits(payload)
  assert.equal(hits.length, 2)
  assert.equal(hits[0].text, '结尾一句反转是知乎短篇的标配。')
  assert.equal(hits[0].score, 0.82)
  assert.equal(hits[0].meta.knowledgeId, 'k1')
  assert.equal(hits[1].meta.chunkIndex, 0)
})

test('检索响应：空体/坏体不抛，返回空数组', () => {
  assert.deepEqual(normalizeHits(null), [])
  assert.deepEqual(normalizeHits({}), [])
  assert.deepEqual(normalizeHits({ data: [{ id: 'x' }] }), [], '没有内容的项被丢弃')
})

test('列库响应：多种包法都能规整', () => {
  const cases = [
    { data: [{ id: 'kb1', name: '知乎短篇语料', doc_count: 120 }] },
    [{ id: 'kb1', name: '知乎短篇语料', doc_count: 120 }],
    { knowledge_bases: [{ kb_id: 'kb1', title: '知乎短篇语料', count: 120 }] }
  ]
  for (const payload of cases) {
    const collections = normalizeCollections(payload)
    assert.equal(collections.length, 1)
    assert.equal(collections[0].id, 'kb1')
    assert.equal(collections[0].docCount, 120)
  }
})

/* ---------- 配置 ---------- */

test('KB 配置：缺档＝未配置（不是错误）；坏档记 warning；backend 白名单', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-kb-'))
  try {
    const path = join(base, 'kb-config.json')
    const missing = await loadKbConfig(path)
    assert.equal(missing.config.backend, 'none')
    assert.deepEqual(missing.warnings, [])

    await writeFile(path, '{ broken', 'utf-8')
    const corrupt = await loadKbConfig(path)
    assert.equal(corrupt.config.backend, 'none')
    assert.equal(corrupt.warnings[0].code, 'KB_CONFIG_CORRUPT')

    await writeFile(path, JSON.stringify({ backend: 'pinecone' }), 'utf-8')
    assert.equal((await loadKbConfig(path)).warnings[0].code, 'KB_CONFIG_BACKEND')

    await writeFile(path, JSON.stringify({ backend: 'weknora', baseUrl: 'http://127.0.0.1:8080/', apiKey: 'k', spaceId: 's1' }), 'utf-8')
    const good = await loadKbConfig(path)
    assert.equal(good.config.backend, 'weknora')
    assert.equal(good.config.baseUrl, 'http://127.0.0.1:8080', '尾斜杠剥掉')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('默认配置路径：跟随 LOCALAPPDATA', () => {
  assert.equal(
    defaultKbConfigPath({ LOCALAPPDATA: 'C:/x' }).replaceAll('\\', '/'),
    'C:/x/PinaxNext/openstory/kb-config.json'
  )
  assert.equal(defaultKbConfigPath({}), '')
})

/* ---------- 客户端 ---------- */

test('mock 客户端：列库/检索（按 collection 过滤＋query 匹配）/取文档', async () => {
  const client = createKbClient({ backend: 'mock' }, {
    mockData: {
      collections: [{ id: 'kb1', name: '知乎短篇', docCount: 2, desc: '' }],
      hits: [
        { id: 'h1', collection: 'kb1', text: '反转要在最后一句', score: 0.9, source: 'doc1', meta: {}, tags: ['反转'] },
        { id: 'h2', collection: 'kb2', text: '另一库的内容', score: 0.8, source: 'doc2', meta: {} }
      ],
      docs: { doc1: { id: 'doc1', title: '反转技法', source: 'skill', meta: {} } }
    }
  })
  const collections = await client.listCollections()
  assert.equal(collections.collections.length, 1)

  const all = await client.query({ query: '反转', topK: 6 })
  assert.equal(all.hits.length, 1, '按 query 命中 tags')
  assert.equal(all.hits[0].id, 'h1')

  const scoped = await client.query({ collectionIds: ['kb2'], query: '另一库' })
  assert.equal(scoped.hits.length, 1)

  const doc = await client.doc('doc1')
  assert.equal(doc.doc.title, '反转技法')
})

test('未配置客户端：KB_NOT_CONFIGURED 如实报，不返回假命中', async () => {
  const client = createKbClient({ backend: 'none' })
  const result = await client.query({ query: '无尽' })
  assert.equal(result.ok, false)
  assert.equal(result.code, KB_ERROR_CODES.KB_NOT_CONFIGURED)
})

test('weknora 客户端：打真实端点与请求体；不可达＝KB_UNAVAILABLE；401＝KB_UNAUTHORIZED', async () => {
  const calls = []
  const fakeFetch = async (url, init) => {
    calls.push({ url, body: init?.body ? JSON.parse(init.body) : null, headers: init?.headers })
    if (url.includes('/knowledge-bases')) {
      return { ok: true, status: 200, json: async () => ({ success: true, data: [{ id: 'kb1', name: '库', doc_count: 9 }] }) }
    }
    return {
      ok: true, status: 200,
      json: async () => ({ success: true, data: [{ id: 'c1', content: '命中内容', knowledge_id: 'k1', chunk_index: 0 }], meta: { total: 1 } })
    }
  }
  const client = createKbClient({ backend: 'weknora', baseUrl: 'http://127.0.0.1:8080', apiKey: 'sk-x' }, { fetchImpl: fakeFetch })
  const collections = await client.listCollections()
  assert.equal(collections.collections[0].docCount, 9)

  const found = await client.query({ collectionIds: ['kb1'], query: '反转', topK: 8 })
  assert.equal(found.hits[0].text, '命中内容')
  const searchCall = calls.find((call) => call.url.includes('/knowledge-search'))
  assert.ok(searchCall, '走 knowledge-search 端点')
  assert.deepEqual(searchCall.body.knowledge_base_ids, ['kb1'])
  assert.equal(searchCall.body.match_count, 8, 'WeKnora 用 match_count 而非 top_k')
  assert.equal(searchCall.headers['x-api-key'], 'sk-x', 'WeKnora API key 走 X-API-Key 头')

  const down = createKbClient({ backend: 'weknora', baseUrl: 'http://127.0.0.1:1' }, { fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal((await down.query({ collectionIds: ['kb1'], query: 'x' })).code, KB_ERROR_CODES.KB_UNAVAILABLE)

  const denied = createKbClient({ backend: 'weknora', baseUrl: 'http://x' }, { fetchImpl: async () => ({ ok: false, status: 401 }) })
  assert.equal((await denied.listCollections()).code, KB_ERROR_CODES.KB_UNAUTHORIZED)
})
