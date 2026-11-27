/**
 * OS-194：daemon 级端点分派测试——42 个模块端点全部经真实分派跑到 handler；
 * 停用/启用按库快照换贡献；共用端点不受模块停用影响。
 *
 * 夹具一律临时 LOCALAPPDATA，不碰作者真库与真实配置。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { MODULE_MANIFESTS } from '../src/protocol/modules.mjs'
import { contributionTable } from '../src/host/handlerTable.mjs'

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'os194-dispatch-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  await writeFile(join(root, '正文', '001-第一章.md'), '# 第一章\n正文。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: [{ path: root, name: '夹具库' }]
  }), 'utf-8')
  return { base, root, preferencesPath }
}

function sampleValue(type) {
  if (type.endsWith('?')) return undefined
  switch (type) {
    case 'string': return 'x'
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

/** 按契约形状造一条最小合法请求（额外带 root，便于 daemon 定位库）。 */
function sampleRequest(endpoint, root) {
  const shape = endpoint.request?.query ?? endpoint.request?.body ?? {}
  const out = {}
  for (const [field, type] of Object.entries(shape)) {
    const value = sampleValue(type)
    if (value !== undefined) out[field] = value
  }
  return { ...out, root }
}

async function call(origin, endpointId, root) {
  const endpoint = ENDPOINTS[endpointId]
  const query = Boolean(endpoint.request?.query)
  const value = sampleRequest(endpoint, root)
  const url = new URL(`http://127.0.0.1:${origin.port}${endpoint.path}`)
  const options = { method: endpoint.method }
  if (query) {
    for (const [key, item] of Object.entries(value)) {
      if (item !== undefined) url.searchParams.set(key, String(item))
    }
  } else if (endpoint.method !== 'GET' && endpoint.method !== 'HEAD') {
    // GET 端点契约若写了 body（历史口径），daemon 仍从 body 取参；fetch 不允许 GET 带 body，
    // 这里让它空 body 过去——校验会回 400，已足够证明分派到了 handler。
    options.headers = { 'content-type': 'application/json' }
    options.body = JSON.stringify(value)
  }
  const response = await fetch(url, options)
  const payload = await response.json().catch(() => null)
  return { status: response.status, payload }
}

test('daemon：42 个模块端点全部经真实分派到达 handler（无「端点未实现」）', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath,
    env: { LOCALAPPDATA: base, APPDATA: base },
    logger: { log() {} }
  })
  try {
    const moduleEndpoints = MODULE_MANIFESTS.flatMap((manifest) => manifest.endpoints ?? [])
    assert.equal(moduleEndpoints.length, 42)
    for (const endpointId of moduleEndpoints) {
      const { status, payload } = await call(daemon, endpointId, root)
      // 业务 404（文件/条目不存在）是 handler 正常回话；这里只钉「分派没到 handler」的两种错误。
      assert.notEqual(payload?.error?.message, `端点未实现：${endpointId}`, endpointId)
      assert.notEqual(payload?.error?.message, `没有这个端点：${endpointId}`, endpointId)
      assert.ok(payload && typeof payload === 'object', `${endpointId} 应回 JSON（HTTP ${status}）`)
    }
    // 宿主端点仍走静态表
    const health = await fetch(`http://127.0.0.1:${daemon.port}/api/health`)
    assert.equal(health.status, 200)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon：停用工作台后独占端点 409，共用端点不受影响，重新启用恢复', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath,
    env: { LOCALAPPDATA: base, APPDATA: base },
    logger: { log() {} }
  })
  const uiStatePath = join(root, '.openstory', 'ui-state.json')
  try {
    const before = await contributionTable(root)
    assert.equal(typeof before.artifacts?.artifactsGet, 'function', '启用态贡献里有 handler')

    await writeFile(uiStatePath, JSON.stringify({ 'modules.enabled.artifacts': false }), 'utf-8')
    const disabled = await call(daemon, 'artifactsGet', root)
    assert.equal(disabled.status, 409)
    assert.equal(disabled.payload.error.code, 'MODULE_DISABLED')

    // 共用端点无归属，任何工作台停用都不影响
    const shared = await fetch(`http://127.0.0.1:${daemon.port}/api/fact/books?root=${encodeURIComponent(root)}`)
    assert.equal(shared.status, 200)

    const after = await contributionTable(root)
    assert.equal(after.artifacts, undefined, '停用后该库快照不再贡献 handler')

    await writeFile(uiStatePath, JSON.stringify({ 'modules.enabled.artifacts': true }), 'utf-8')
    const restored = await call(daemon, 'artifactsGet', root)
    assert.notEqual(restored.status, 409)
    assert.notEqual(restored.payload?.error?.message, '端点未实现：artifactsGet')
    const rebuilt = await contributionTable(root)
    assert.equal(typeof rebuilt.artifacts?.artifactsGet, 'function', '重启用后新快照贡献回来')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})
