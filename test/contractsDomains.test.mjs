/**
 * OS-130 契约分域守卫：contracts.mjs 的 ENDPOINTS 必须正好是 contracts/<域>.mjs 七域切片的并集。
 * 防两件事：①往域分片加了端点却忘了聚合（或反之）——daemon 经 contracts.mjs 分派，
 * 分片里的孤儿端点等于不存在；②两个域片重复登记同一段形状（静默互相覆盖）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ENDPOINTS, ENDPOINT_LIST, validateRequest, validateResponse } from '../contracts.mjs'
import { libraryEndpoints } from '../contracts/library.mjs'
import { chaptersEndpoints } from '../contracts/chapters.mjs'
import { factEndpoints } from '../contracts/fact.mjs'
import { referenceEndpoints } from '../contracts/reference.mjs'
import { agentEndpoints } from '../contracts/agent.mjs'
import { pluginsEndpoints } from '../contracts/plugins.mjs'
import { systemEndpoints } from '../contracts/system.mjs'

const DOMAINS = [
  ['library', libraryEndpoints],
  ['chapters', chaptersEndpoints],
  ['fact', factEndpoints],
  ['reference', referenceEndpoints],
  ['agent', agentEndpoints],
  ['plugins', pluginsEndpoints],
  ['system', systemEndpoints]
]

test('分域切片：七域并集正好等于聚合 ENDPOINTS（无孤儿、无覆盖）', () => {
  const seen = new Map()
  for (const [domain, slice] of DOMAINS) {
    assert.ok(Object.keys(slice).length > 0, `${domain} 域分片为空`)
    for (const id of Object.keys(slice)) {
      assert.ok(!seen.has(id), `端点 ${id} 在 ${seen.get(id)} 与 ${domain} 两处重复登记`)
      seen.set(id, domain)
    }
  }
  assert.equal(seen.size, Object.keys(ENDPOINTS).length, '分片并集大小与聚合端点数不一致')
  for (const [id, endpoint] of Object.entries(ENDPOINTS)) {
    assert.ok(seen.has(id), `端点 ${id} 在聚合表里有、域分片里没有`)
    const domain = DOMAINS.find(([, slice]) => slice[id])?.[0]
    assert.equal(domain, seen.get(id), `端点 ${id} 归属域不一致`)
    assert.deepEqual(sliceOf(domain)[id], endpoint, `端点 ${id} 的形状在分片与聚合表之间不一致`)
  }
  function sliceOf(domain) { return DOMAINS.find(([d]) => d === domain)[1] }
})

test('分域切片：每个域端点形状合规（method/path/request/response/errors）', () => {
  for (const [, slice] of DOMAINS) {
    for (const [id, endpoint] of Object.entries(slice)) {
      assert.ok(endpoint.method, `${id} 缺 method`)
      assert.ok(endpoint.path.startsWith('/api/'), `${id} 路径不是 /api/`)
      assert.ok(endpoint.request, `${id} 缺 request`)
      assert.ok(endpoint.response, `${id} 缺 response`)
      assert.ok(Array.isArray(endpoint.errors), `${id} 缺 errors`)
    }
  }
})

test('分域切片：ENDPOINT_LIST 与 ENDPOINTS 同源；校验函数走聚合表照常工作', () => {
  assert.equal(ENDPOINT_LIST.length, Object.keys(ENDPOINTS).length)
  // 挑「带非可选字段」的端点验证校验函数真的在拦——query 端点里 libraries 这类空 query 是合法放行的
  const required = (shape) => Object.entries(shape ?? {}).filter(([, t]) => !t.endsWith('?'))
  const anyQueryEndpoint = Object.keys(ENDPOINTS).find((id) => required(ENDPOINTS[id].request.query).length > 0)
  const anyBodyEndpoint = Object.keys(ENDPOINTS).find((id) => required(ENDPOINTS[id].request.body).length > 0)
  assert.ok(anyQueryEndpoint && anyBodyEndpoint, '两类端点都应存在')
  assert.equal(validateRequest(anyQueryEndpoint, {}).ok, false, 'query 端点缺必填应报错')
  assert.equal(validateRequest(anyBodyEndpoint, {}).ok, false, 'body 端点缺必填应报错')
  const firstEndpoint = Object.keys(ENDPOINTS)[0]
  assert.equal(validateResponse(firstEndpoint, {}).ok, false, '响应缺 ok 字段应报错')
})
