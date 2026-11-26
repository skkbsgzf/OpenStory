/** OS-209：本机模块运行期契约的响应校验、失败门与旧层保持。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { validateModuleContracts } from '../src/host/moduleContracts.mjs'

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'os209-runtime-contract-'))
  const env = { LOCALAPPDATA: join(base, 'appdata'), APPDATA: join(base, 'appdata') }
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [] }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  return { base, env, preferencesPath, daemon, origin: `http://127.0.0.1:${daemon.port}` }
}
async function close(fx) { await fx.daemon.close(); await rm(fx.base, { recursive: true, force: true }) }
const post = (origin, path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (response) => ({ status: response.status, payload: await response.json().catch(() => null) }))
async function putModule(rootDir, id, response, extra = {}) {
  const dir = join(rootDir, id)
  const endpointId = `${id}Get`
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify({
    spec: 'openstory-module@2', id, name: id, version: '0.1.0', class: 'workbench', entry: 'index.mjs',
    requires: [{ id: 'base.write', min: 1 }], pages: [{ id: `${id}-page`, label: id }], slots: [{ slot: 'tab', page: `${id}-page` }], endpoints: [endpointId], ...extra
  }, null, 2), 'utf-8')
  await writeFile(join(dir, 'index.mjs'), `export async function activate() {
  return {
    pages: { '${id}-page': { id: '${id}-page', label: '${id}' } },
    handlers: { ${endpointId}: async ({ res }) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(${JSON.stringify(JSON.stringify(response))}); } },
    contracts: { ${endpointId}: { method: 'GET', path: '/api/modules/${id}/value', request: {}, response: { ok: 'true', value: 'string' }, errors: [] } }
  }
}`, 'utf-8')
  return dir
}

test('OS-209 本机契约：合法 JSON 放行、缺字段/错类型/非 JSON 都在发车前拒绝', async () => {
  const fx = await fixture()
  try {
    const rootDir = join(fx.base, 'modules')
    await putModule(rootDir, 'good', { ok: true, value: 'ok' })
    await putModule(rootDir, 'missing', { ok: true })
    await putModule(rootDir, 'wrongtype', { ok: true, value: 42 })
    const nonJsonDir = join(rootDir, 'nonjson')
    await mkdir(nonJsonDir, { recursive: true })
    await writeFile(join(nonJsonDir, 'module.manifest.json'), JSON.stringify({
      spec: 'openstory-module@2', id: 'nonjson', name: 'nonjson', version: '0.1.0', class: 'workbench', entry: 'index.mjs',
      requires: [{ id: 'base.write', min: 1 }], pages: [{ id: 'nonjson-page', label: 'nonjson' }], slots: [{ slot: 'tab', page: 'nonjson-page' }], endpoints: ['nonjsonGet']
    }), 'utf-8')
    await writeFile(join(nonJsonDir, 'index.mjs'), `export async function activate() { return {
      pages: { 'nonjson-page': { id: 'nonjson-page', label: 'nonjson' } },
      handlers: { nonjsonGet: async ({ res }) => { res.writeHead(200, { 'content-type': 'text/plain' }); res.end('not-json'); } },
      contracts: { nonjsonGet: { method: 'GET', path: '/api/modules/nonjson/value', request: {}, response: { ok: 'true' }, errors: [] } }
    } }`, 'utf-8')
    const added = await post(fx.origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200, JSON.stringify(added.payload))
    const good = await fetch(`${fx.origin}/api/modules/good/value`)
    assert.equal(good.status, 200)
    assert.deepEqual(await good.json(), { ok: true, value: 'ok' })
    for (const id of ['missing', 'wrongtype']) {
      const bad = await fetch(`${fx.origin}/api/modules/${id}/value`)
      assert.equal(bad.status, 400, `${id} 应响应契约拒绝，实得 ${bad.status}`)
      const payload = await bad.json()
      assert.equal(payload.error.code, 'INVALID_ENTRY')
      assert.match(payload.error.message, /响应不符合自带契约/u)
      assert.ok(payload.error.details.errors.length > 0)
    }
    const nonJson = await fetch(`${fx.origin}/api/modules/nonjson/value`)
    assert.equal(nonJson.status, 400)
    assert.match((await nonJson.json()).error.message, /必须返回 JSON 对象/u)
  } finally { await close(fx) }
})

test('OS-209 模块根：confirm:false/相对路径/不存在/重复根/移除恢复', async () => {
  const fx = await fixture()
  try {
    const rootDir = join(fx.base, 'modules')
    await putModule(rootDir, 'good', { ok: true, value: 'ok' })
    const noConfirm = await post(fx.origin, '/api/module-roots/add', { path: rootDir, confirm: false })
    assert.equal(noConfirm.status, 400)
    const relative = await post(fx.origin, '/api/module-roots/add', { path: 'relative/path', confirm: true })
    assert.equal(relative.status, 400)
    const missing = await post(fx.origin, '/api/module-roots/add', { path: join(fx.base, 'absent'), confirm: true })
    assert.equal(missing.status, 400)
    const added = await post(fx.origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const duplicate = await post(fx.origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(duplicate.status, 200)
    assert.equal(duplicate.payload.roots.length, 1)
    const before = (await (await fetch(`${fx.origin}/api/plugins`)).json()).capabilityReport.snapshot
    const removed = await post(fx.origin, '/api/module-roots/remove', { path: rootDir })
    assert.equal(removed.status, 200)
    assert.equal(removed.payload.roots.length, 0)
    const after = (await (await fetch(`${fx.origin}/api/plugins`)).json()).capabilityReport.snapshot
    assert.notEqual(after, before)
    const gone = await fetch(`${fx.origin}/api/modules/good/value`)
    assert.equal(gone.status, 404)
  } finally { await close(fx) }
})

test('OS-209 模块契约静态校验：非法类型与路径越界在 activate 前拒绝', () => {
  const manifest = { id: 'x', endpoints: ['get'] }
  assert.equal(validateModuleContracts(manifest, { get: { method: 'GET', path: '/api/modules/x/v', request: {}, response: { ok: 'true', x: 'true|false' } } }).ok, false)
  assert.equal(validateModuleContracts(manifest, { get: { method: 'GET', path: '/api/host/x', request: {}, response: { ok: 'true' } } }).ok, false)
  assert.equal(validateModuleContracts(manifest, { get: { method: 'GET', path: '/api/modules/x/v', request: {}, response: { ok: 'true' } } }).ok, true)
})
