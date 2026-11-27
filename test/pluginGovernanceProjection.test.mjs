/**
 * OS-200：治理台数据面——`/api/plugins` 一次给齐依赖解析、反向依赖、降级态与停用预检。
 *
 * 三条纪律：
 *   1. 推导是纯函数（projectModuleGraph），handler 只装配；内置 21 件的边数与连锁清单钉死。
 *   2. 预检与启停闸同源（同一函数、同一份输入）——纯函数与真实 HTTP 两侧都逐件对账。
 *   3. slot 降级件照常出现并带 missing；健康位置形状一个字段都不多。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MODULE_MANIFESTS, CAPABILITY_SNAPSHOT } from '../src/protocol/modules.mjs'
import { BASE_GRAPH } from '../src/protocol/baseCapabilities.mjs'
import { deriveModuleStateChange, projectModuleGraph } from '../src/protocol/capabilityGraph.mjs'
import { slotProjection } from '../src/protocol/slots.mjs'
import { validateResponse } from '../src/api/contracts.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

const INPUTS = {
  snapshot: CAPABILITY_SNAPSHOT,
  manifests: MODULE_MANIFESTS,
  state: {},
  suiteState: {},
  base: BASE_GRAPH
}
const projected = () => projectModuleGraph(INPUTS)
const byId = (payload, id) => payload.modules.find((item) => item.id === id)
const ids = (list) => list.map((item) => item.id ?? item)

async function makeDaemon() {
  const base = await mkdtemp(join(tmpdir(), 'os200-projection-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  return { base, env, root, daemon, origin: `http://127.0.0.1:${daemon.port}` }
}

async function close(item) {
  await item.daemon.close()
  await rm(item.base, { recursive: true, force: true })
}

async function withDaemon(run) {
  const item = await makeDaemon()
  try { return await run(item) } finally { await close(item) }
}

const json = async (response) => ({ status: response.status, payload: await response.json().catch(() => null) })
const get = (origin, path) => fetch(`${origin}${path}`).then(json)
const plugins = (origin, root) => get(origin, `/api/plugins?root=${encodeURIComponent(root)}`)
const put = (origin, root, state) => fetch(`${origin}/api/ui-state`, {
  method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, state })
}).then(async (response) => ({ status: response.status, payload: await response.json().catch(() => null) }))
const post = (origin, path, body) => fetch(`${origin}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}).then(json)

async function writeIframeModule(moduleRoot) {
  const dir = join(moduleRoot, 'ext-frame')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify({
    spec: 'openstory-module@2', id: 'ext-frame', name: '外部工作台', version: '0.1.0',
    class: 'workbench', entry: 'index.mjs', requires: [{ id: 'base.write', min: 1 }],
    slots: [{ slot: 'tab', page: 'ext-page', order: 90 }],
    pages: [{ id: 'ext-page', label: '外部页', kind: 'iframe', entry: 'page.html' }],
    endpoints: []
  }, null, 2), 'utf-8')
  await writeFile(join(dir, 'index.mjs'), `export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  return { pages: { 'ext-page': { id: 'ext-page', label: '外部页' } } }
}`, 'utf-8')
  await writeFile(join(dir, 'page.html'), '<!doctype html><title>外部页</title><p>OS-200</p>', 'utf-8')
  return dir
}

test('OS-200·纯函数健康态：39 条非底座边、12 条底座边，反向依赖与连锁清单逐件对上', () => {
  const { projections, moduleGraph } = projected()
  assert.equal(moduleGraph.spec, 'openstory-module-graph@1')
  assert.equal(moduleGraph.snapshot, CAPABILITY_SNAPSHOT.id)
  assert.equal(moduleGraph.edges.filter((edge) => edge.to !== 'base').length, 39)
  assert.equal(moduleGraph.edges.filter((edge) => edge.to === 'base').length, 12)
  const baseCounts = Object.fromEntries(moduleGraph.base.map((item) => [item.id, item.consumers.length]))
  assert.equal(baseCounts['base.write'], 5)
  assert.equal(baseCounts['base.contract'], 2)
  assert.equal(baseCounts['base.naming'], 5)

  assert.deepEqual(ids(projections.get('fact').dependents), [
    'agentbar', 'chapters', 'deduce', 'exchange', 'library', 'prose', 'roleplay', 'script', 'storysource', 'worldbook'
  ])
  assert.deepEqual(projections.get('fact').impact, ['imagegen', 'log'])

  const roleplay = projections.get('roleplay').requires
  assert.equal(roleplay.length, 4)
  assert.deepEqual(roleplay.map((item) => item.provider), ['deduce', 'fact', 'prose', 'text'])
  assert.ok(roleplay.every((item) => item.ok))

  for (const manifest of MODULE_MANIFESTS.filter((item) => item.class === 'kernel')) {
    const capabilities = projections.get(manifest.id).capabilities
    assert.deepEqual(capabilities, (manifest.capabilities ?? []).map((item) => ({
      id: item.id, version: item.version,
      ...(item.golden !== undefined ? { golden: item.golden } : {})
    })))
  }
  for (const manifest of MODULE_MANIFESTS.filter((item) => item.class !== 'kernel')) {
    assert.deepEqual(projections.get(manifest.id).capabilities, [])
  }
  const workbenches = MODULE_MANIFESTS.filter((item) => item.class === 'workbench')
  assert.equal(workbenches.length, 13)
  assert.ok(workbenches.every((item) => projections.get(item.id).toggleCheck.ok === true))
})

test('OS-200·同源（纯函数）：逐件 deriveModuleStateChange 的 {ok,code} 等于 toggleCheck', () => {
  const { projections } = projected()
  for (const manifest of MODULE_MANIFESTS) {
    const check = deriveModuleStateChange({
      ...INPUTS, patch: { [`modules.enabled.${manifest.id}`]: false }
    })
    const preview = projections.get(manifest.id).toggleCheck
    assert.deepEqual({ ok: preview.ok, code: preview.code ?? null }, { ok: check.ok, code: check.code ?? null }, manifest.id)
  }
  assert.equal(projections.get('fact').toggleCheck.code, 'CAPABILITY_IN_USE')
  assert.equal(projections.get('agentbar').toggleCheck.code, 'INVALID_ENTRY')
  assert.equal(projections.get('library').toggleCheck.code, 'INVALID_ENTRY')
})

test('OS-200·slot：带 statuses 时降级位置标记 missing，不带时健康位置形状逐字不变', () => {
  const statuses = new Map([['roleplay', {
    status: 'degraded', active: false,
    missing: [{ capability: 'text.analyze', min: 1, maxExclusive: 2 }]
  }]])
  const options = { builtinPages: new Set(['roleplay']) }
  const plain = slotProjection(MODULE_MANIFESTS, {}, options)
  const marked = slotProjection(MODULE_MANIFESTS, {}, { ...options, statuses })
  assert.deepEqual(Object.keys(plain.slots.tab[0]), ['slot', 'page', 'module', 'label', 'view'])
  assert.deepEqual(plain.slots.tab, marked.slots.tab.map(({ degraded, missing, ...rest }) => rest))
  const roleplay = marked.slots.tab.find((item) => item.module === 'roleplay')
  assert.equal(roleplay.degraded, true)
  assert.deepEqual(roleplay.missing, [{ capability: 'text.analyze', min: 1, maxExclusive: 2 }])
  // 已启用但只是可选依赖缺失（active:true）不算降级，形状保持健康。
  const optionalOnly = slotProjection(MODULE_MANIFESTS, {}, {
    ...options, statuses: new Map([['roleplay', { status: 'degraded', active: true, missing: [] }]])
  })
  assert.deepEqual(optionalOnly.slots.tab, plain.slots.tab)
})

test('OS-200·daemon 健康库：响应合法、23 件 loaded、9 个页签无降级', async () => {
  await withDaemon(async ({ origin, root }) => {
    const { status, payload } = await plugins(origin, root)
    assert.equal(status, 200)
    assert.deepEqual(validateResponse('pluginsGet', payload), { ok: true, errors: [] })
    const modules = MODULE_MANIFESTS.map((manifest) => byId(payload, manifest.id))
    assert.ok(modules.every(Boolean), '23 件模块都在清单里')
    assert.ok(modules.every((item) => item.status === 'loaded'))
    assert.equal(payload.slots.tab.length, 9)
    assert.ok(payload.slots.tab.every((item) => !('degraded' in item)))
    assert.equal(payload.moduleGraph.edges.filter((edge) => edge.to !== 'base').length, 39)
    assert.ok(Array.isArray(payload.suites))
  })
})

test('OS-200·daemon 降级：缺硬依赖的工作台带标记，停掉后位置消失，反向依赖看见降级态', async () => {
  await withDaemon(async ({ origin, root }) => {
    assert.equal((await put(origin, root, {
      'modules.enabled.analysis': false, 'modules.enabled.habits': false, 'modules.enabled.roleplay': false
    })).status, 200)
    assert.equal((await put(origin, root, { 'modules.enabled.text': false })).status, 200)
    assert.equal((await put(origin, root, { 'modules.enabled.roleplay': true })).status, 200)

    const { payload } = await plugins(origin, root)
    const roleplay = byId(payload, 'roleplay')
    assert.equal(roleplay.status, 'degraded')
    assert.ok(roleplay.missing.some((item) => item.capability === 'text.analyze'
      && item.min === 1 && item.maxExclusive === 2), JSON.stringify(roleplay.missing))
    const textRequire = roleplay.requires.find((item) => item.id === 'text.analyze')
    assert.equal(textRequire.ok, false)
    assert.equal(textRequire.provider, 'text')
    const slot = payload.slots.tab.find((item) => item.module === 'roleplay')
    assert.equal(slot.degraded, true)
    assert.deepEqual(slot.missing, roleplay.missing)
    const dependent = byId(payload, 'text').dependents.find((item) => item.id === 'roleplay')
    assert.equal(dependent.status, 'degraded')

    assert.equal((await put(origin, root, { 'modules.enabled.roleplay': false })).status, 200)
    const after = await plugins(origin, root)
    assert.ok(!after.payload.slots.tab.some((item) => item.module === 'roleplay'))
  })
})

test('OS-200·daemon 同源端到端：逐件停用补丁的 HTTP 结果与 toggleCheck 一致', async () => {
  await withDaemon(async ({ origin, root }) => {
    for (const manifest of MODULE_MANIFESTS) {
      const preview = byId((await plugins(origin, root)).payload, manifest.id).toggleCheck
      const key = `modules.enabled.${manifest.id}`
      const response = await put(origin, root, { [key]: false })
      assert.equal(response.status === 200, preview.ok, `${manifest.id}: ${JSON.stringify(response.payload)}`)
      if (!preview.ok) {
        assert.equal(response.payload?.error?.code, preview.code, manifest.id)
        assert.deepEqual(response.payload?.error?.details?.consumers ?? null, preview.consumers ?? null, manifest.id)
      }
      // 停成功的立刻启回来，下一件仍从健康库出发。
      if (preview.ok) assert.equal((await put(origin, root, { [key]: true })).status, 200)
    }
  })
})

test('OS-200·daemon 本机层：临时模块进清单、带底座边，预检可停', async () => {
  await withDaemon(async ({ base, origin, root }) => {
    await writeIframeModule(join(base, '模块根'))
    const added = await post(origin, '/api/module-roots/add', { path: join(base, '模块根'), confirm: true })
    assert.equal(added.status, 200, JSON.stringify(added.payload))
    const { payload } = await plugins(origin, root)
    const ext = byId(payload, 'ext-frame')
    assert.equal(ext.source, 'local')
    assert.equal(ext.toggleCheck.ok, true)
    assert.ok(payload.moduleGraph.edges.some((edge) => edge.from === 'ext-frame' && edge.to === 'base' && edge.capability === 'base.write'))
  })
})

test('OS-200·daemon 货架：/api/plugins.suites 与 /api/suites.suites 逐条同源', async () => {
  await withDaemon(async ({ origin, root }) => {
    const merged = (await plugins(origin, root)).payload
    const shelf = (await get(origin, `/api/suites?root=${encodeURIComponent(root)}`)).payload
    assert.ok(merged.suites.length > 0)
    const pick = (item) => ({ id: item.id, name: item.name, version: item.version, enabled: item.enabled, blocked: item.blocked })
    assert.deepEqual(merged.suites.map(pick), shelf.suites.map(pick))
    assert.deepEqual(merged.suiteOverrides, shelf.overrides ?? [])
  })
})
