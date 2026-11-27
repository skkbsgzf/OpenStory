/** OS-209：模块独占端点的停用→409→恢复矩阵（端点数随 manifest 增长）。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { MODULE_MANIFESTS } from '../src/protocol/modules.mjs'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

const endpointId = (method, path) => Object.entries(ENDPOINTS).find(([, endpoint]) => endpoint.method === method && endpoint.path === path)?.[0]
const owners = MODULE_MANIFESTS.filter((manifest) => manifest.class === 'workbench' && manifest.endpoints?.length)
  .map((manifest) => ({ id: manifest.id, endpoints: manifest.endpoints }))

function sample(type, key = '') {
  if (type.endsWith('?')) return undefined
  switch (type) {
    case 'string': return key === 'file' || key === 'path' ? '正文/001-第一回 张天师祈禳瘟疫.md' : 'x'
    case 'integer':
    case 'number': return 1
    case 'boolean': return false
    case 'true': return true
    case 'object': return {}
    case 'array': return []
    case 'messages': return [{ role: 'user', content: 'hi' }]
    default: return undefined
  }
}

async function invoke(fx, id, root) {
  const endpoint = ENDPOINTS[id]
  const query = Boolean(endpoint.request.query)
  const input = {}
  for (const [key, type] of Object.entries(endpoint.request.query ?? endpoint.request.body ?? {})) {
    const value = sample(type, key)
    if (value !== undefined) input[key] = value
  }
  if (endpoint.request.query?.root || endpoint.request.body?.root) input.root = root
  const url = new URL(`http://127.0.0.1:${fx.daemon.port}${endpoint.path}`)
  const options = { method: endpoint.method }
  if (query) {
    for (const [key, value] of Object.entries(input)) if (value !== undefined) url.searchParams.set(key, String(value))
  } else if (endpoint.method !== 'GET') {
    options.headers = { 'content-type': 'application/json' }
    options.body = JSON.stringify(input)
  }
  const response = await fetch(url, options)
  return { status: response.status, payload: await response.json().catch(() => null) }
}

test('OS-209 模块端点：逐所属工作台停用→409 MODULE_DISABLED→恢复→不再 409', async () => {
  await withTempDaemon(async (fx) => {
    const all = owners.flatMap((owner) => owner.endpoints)
    assert.ok(all.length >= 42, "模块端点至少 42（随 manifest 增长）")
    const tested = []
    for (const owner of owners) {
      for (const id of owner.endpoints) {
        assert.ok(ENDPOINTS[id], `${owner.id} 声明了未知端点 ${id}`)
        const disabled = await fx.json('/api/ui-state', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: fx.root, state: { [`modules.enabled.${owner.id}`]: false } })
        })
        assert.equal(disabled.status, 200, `停用 ${owner.id} 失败`)
        const blocked = await invoke(fx, id, fx.root)
        assert.equal(blocked.status, 409, `${id} 停用后应 409，实得 ${blocked.status}`)
        assert.equal(blocked.payload?.error?.code, 'MODULE_DISABLED', `${id} 停用后错误码不对`)
        const restored = await fx.json('/api/ui-state', {
          method: 'PUT', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ root: fx.root, state: { [`modules.enabled.${owner.id}`]: true } })
        })
        assert.equal(restored.status, 200, `恢复 ${owner.id} 失败`)
        const active = await invoke(fx, id, fx.root)
        assert.notEqual(active.status, 409, `${id} 恢复后不应仍 MODULE_DISABLED`)
        assert.notEqual(active.payload?.error?.message, `端点未实现：${id}`)
        tested.push(id)
      }
    }
    assert.equal(new Set(tested).size, all.length, "每个声明端点都必须被测到（无遗漏）")
    // 共享宿主端点不受工作台停用影响。
    await fx.json('/api/ui-state', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fx.root, state: Object.fromEntries(owners.map((owner) => [`modules.enabled.${owner.id}`, false])) })
    })
    const shared = await fx.json(`/api/fact/books?root=${encodeURIComponent(fx.root)}`)
    assert.equal(shared.status, 200)
    assert.ok(Array.isArray(shared.payload.books))
  }, { upstream: true })
})
