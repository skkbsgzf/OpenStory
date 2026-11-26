/**
 * OS-208：页面矩阵所需 API 的真实 HTTP 契约测试。
 * 每个 requiredApi 至少一次；所有夹具均为临时库/临时 LOCALAPPDATA/port:0。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { PAGE_MATRIX } from './helpers/pageMatrix.mjs'
import { withTempDaemon } from './helpers/tempDaemon.mjs'
import { ENDPOINTS, validateResponse } from '../src/api/contracts.mjs'

const unique = new Map()
for (const page of PAGE_MATRIX) {
  for (const item of page.requiredApi) unique.set(`${item.method} ${item.path}`, item)
}

function queryFor(endpoint, root) {
  const out = { root }
  const shape = endpoint.request?.query ?? {}
  if (shape.dir !== undefined) out.dir = '正文'
  if (shape.limit !== undefined) out.limit = '20'
  return out
}

async function requestApi(fx, method, path) {
  const endpoint = Object.values(ENDPOINTS).find((item) => item.method === method && item.path === path)
  assert.ok(endpoint, `契约里没有 ${method} ${path}`)
  const endpointId = Object.entries(ENDPOINTS).find(([, item]) => item === endpoint)?.[0]
  const query = queryFor(endpoint, fx.root)
  const url = new URL(`http://127.0.0.1:${fx.daemon.port}${path}`)
  for (const [key, value] of Object.entries(query)) if (value !== undefined) url.searchParams.set(key, String(value))
  const response = await fetch(url)
  const payload = await response.json().catch(() => null)
  return { endpointId, status: response.status, payload }
}

test('OS-208 页面矩阵：每个 requiredApi 都有真实 HTTP 成功用例且响应符合契约', async () => {
  await withTempDaemon(async (fx) => {
    assert.ok(unique.size >= 20, `页面 API 覆盖不足：${unique.size}`)
    for (const [key, item] of unique) {
      const result = await requestApi(fx, item.method, item.path)
      assert.equal(result.status, 200, `${key} 应 200，实得 ${result.status} ${JSON.stringify(result.payload)}`)
      assert.ok(result.payload?.ok === true, `${key} 应回 ok:true`)
      const checked = validateResponse(result.endpointId, result.payload)
      assert.equal(checked.ok, true, `${key} 响应契约不符：${JSON.stringify(checked.errors)}`)
    }
  }, { defaultRoot: true, upstream: true })
})

test('OS-208 两库隔离：相同 API 按 root 返回各自数据，不串库', async () => {
  const { mkdtemp, mkdir, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { startDaemon } = await import('../src/host/daemon.mjs')
  const base = await mkdtemp(join(tmpdir(), 'os208-two-libs-'))
  const env = { LOCALAPPDATA: join(base, 'appdata'), APPDATA: join(base, 'appdata') }
  const roots = []
  try {
    for (const [name, title] of [['库甲', '甲库正文'], ['库乙', '乙库正文']]) {
      const root = join(base, name)
      await mkdir(join(root, '.openstory'), { recursive: true })
      await mkdir(join(root, '正文'), { recursive: true })
      await writeFile(join(root, '.openstory', 'project.json'), JSON.stringify({
        spec: 'openstory-project@4', schemaVersion: 4, projectId: `proj_${name}`, name, kind: 'novel',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
        carriers: { primary: 'openstory.carrier.novel', enabled: ['openstory.carrier.novel'], revision: 1 }
      }), 'utf-8')
      await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
      await writeFile(join(root, '正文', '001-章节.md'), `# ${title}\n\n${title}内容。\n`, 'utf-8')
      roots.push(root)
    }
    const preferencesPath = join(base, 'libraries.json')
    await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: roots.map((path, i) => ({ path, name: i ? '库乙' : '库甲' })) }), 'utf-8')
    const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
    try {
      for (let i = 0; i < roots.length; i += 1) {
        const response = await fetch(`http://127.0.0.1:${daemon.port}/api/chapter?root=${encodeURIComponent(roots[i])}&file=${encodeURIComponent('正文/001-章节.md')}`)
        assert.equal(response.status, 200)
        const payload = await response.json()
        assert.ok(payload.text.includes(i ? '乙库正文' : '甲库正文'))
        assert.ok(!payload.text.includes(i ? '甲库正文' : '乙库正文'))
      }
    } finally { await daemon.close() }
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('OS-208 未授权 root 与缺必填参数必须明确拒绝', async () => {
  await withTempDaemon(async (fx) => {
    const badRoot = await fetch(`http://127.0.0.1:${fx.daemon.port}/api/chapters?root=${encodeURIComponent(join(fx.base, 'not-registered'))}&dir=正文`)
    assert.equal(badRoot.status, 403)
    assert.equal((await badRoot.json()).error.code, 'NO_LIBRARY')
    const missing = await fetch(`http://127.0.0.1:${fx.daemon.port}/api/chapters?dir=正文`)
    assert.equal(missing.status, 400)
    assert.equal((await missing.json()).error.code, 'INVALID_ENTRY')
    const pathEscape = await fetch(`http://127.0.0.1:${fx.daemon.port}/api/chapter?root=${encodeURIComponent(fx.root)}&file=${encodeURIComponent('../outside.md')}`)
    assert.equal(pathEscape.status, 403)
    assert.equal((await pathEscape.json()).error.code, 'PATH_ESCAPE')
  })
})
