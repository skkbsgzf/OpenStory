/**
 * OS-196：本机可执行模块的五道门守护测试（daemon 级，真实请求路径）。
 *
 * 夹具一律临时模块根＋临时 LOCALAPPDATA，不碰作者真库与真实院子；
 * 临时 daemon 由 startDaemon({port:0}) 起，全程不连 8807。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeDaemon(withLibrary = false) {
  const base = await mkdtemp(join(tmpdir(), 'os196-dyn-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const preferencesPath = join(base, 'libraries.json')
  let root = ''
  if (withLibrary) {
    root = join(base, '夹具库')
    await mkdir(join(root, '.openstory'), { recursive: true })
    await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  }
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: root ? [{ path: root, name: '夹具库' }] : []
  }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  return { base, env, root, daemon, origin: `http://127.0.0.1:${daemon.port}` }
}

async function closeDaemon(fixture) {
  await fixture.daemon.close()
  await rm(fixture.base, { recursive: true, force: true })
}

async function withDaemon(withLibrary, run) {
  const fixture = await makeDaemon(withLibrary)
  try {
    return await run(fixture)
  } finally {
    await closeDaemon(fixture)
  }
}

async function makeModule(rootDir, id, manifest, entry) {
  const dir = join(rootDir, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  await writeFile(join(dir, 'index.mjs'), entry, 'utf-8')
  return dir
}

const workbenchManifest = (id, endpoints, extra = {}) => ({
  spec: 'openstory-module@2',
  id,
  name: id,
  version: '0.1.0',
  class: 'workbench',
  entry: 'index.mjs',
  requires: [{ id: 'base.write', min: 1 }],
  slots: [{ slot: 'tab', page: `${id}-page` }],
  pages: [{ id: `${id}-page`, label: id }],
  endpoints,
  ...extra
})

const HANDLER_BODY = {
  stylesGet: `{ ok: true, styles: [{ name: '__MARKER__' }], warnings: [], dirs: [] }`,
  genresGet: `{ ok: true, genres: [{ name: '__MARKER__' }], warnings: [] }`,
  artifactsGet: `{ ok: true, groups: [{ name: '__MARKER__' }], totals: { files: 1, bytes: 1, histories: 0 } }`
}

/** 只贡献 manifest 声明过的 handler（OS-194 双向校验）。 */
function handlerEntry(marker, { awaitGate = false, pageId = `${marker}-page`, endpoints = ['stylesGet'] } = {}) {
  const handlers = endpoints.map((id) => `${id}: async ({ res }) => {
        ${awaitGate ? 'await globalThis.__os196Gate' : ''}
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify(${HANDLER_BODY[id].replaceAll('__MARKER__', marker)}))
      }`).join(',\n      ')
  return `export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  return {
    pages: { '${pageId}': { id: '${pageId}', label: '${marker}' } },
    handlers: {
      ${handlers}
    }
  }
}`
}

async function call(origin, endpoint, body) {
  const response = await fetch(`${origin}${endpoint}`, {
    method: body ? 'POST' : 'GET',
    ...(body ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {})
  })
  return { status: response.status, payload: await response.json().catch(() => null) }
}

test('G1-1 未登记的根里有模块：不扫描、不装载、报告里不出现', async () => {
  await withDaemon(false, async ({ base, env, origin }) => {
    const stray = join(base, 'stray-root')
    await makeModule(stray, 'stray-module', workbenchManifest('stray-module', ['stylesGet']), handlerEntry('STRAY', { pageId: 'stray-module-page', endpoints: ['stylesGet'] }))
    const roots = await call(origin, '/api/module-roots')
    assert.equal(roots.status, 200)
    assert.deepEqual(roots.payload.roots, [])
    assert.deepEqual(roots.payload.localModules, [])
    const plugins = await call(origin, '/api/plugins')
    assert.equal(plugins.status, 200)
    assert.ok(!JSON.stringify(plugins.payload).includes('stray-module'), '未登记的根不能出现在 /api/plugins')
    assert.ok(plugins.payload.modules.every((item) => item.source !== 'local'))
    assert.equal(env.LOCALAPPDATA, base)
  })
})

test('G1-2 登记＋确认：端点与 slot 在真实请求上生效；无确认不生效', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'root-2')
    await makeModule(rootDir, 'local-workbench', workbenchManifest('local-workbench', ['stylesGet']), handlerEntry('LOCAL-V1', { pageId: 'local-workbench-page', endpoints: ['stylesGet'] }))

    const denied = await call(origin, '/api/module-roots/add', { path: rootDir, confirm: false })
    assert.equal(denied.status, 400)
    assert.equal(denied.payload.error.code, 'INVALID_ENTRY')
    const before = await call(origin, '/api/styles')
    assert.ok(!JSON.stringify(before.payload).includes('LOCAL-V1'))

    const preview = await call(origin, '/api/module-roots/preview', { path: rootDir })
    assert.equal(preview.status, 200)
    assert.equal(preview.payload.modules[0].id, 'local-workbench')
    assert.ok(preview.payload.modules[0].contentSha256, '预览必须给出内容摘要')
    assert.match(preview.payload.risk, /同进程/)

    const added = await call(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    assert.equal(added.payload.localModules[0].status, 'loaded')
    assert.equal(added.payload.localModules[0].gate, '')

    const styles = await call(origin, '/api/styles')
    assert.equal(styles.status, 200)
    assert.equal(styles.payload.styles[0].name, 'LOCAL-V1', '本机 handler 必须真的拦到请求')
    const placement = added.payload.slotPlacements.tab?.find((item) => item.module === 'local-workbench')
    assert.equal(placement?.page, 'local-workbench-page', 'manifest 声明的 slot 进入当前编排')
    const plugins = await call(origin, '/api/plugins')
    assert.equal(plugins.payload.modules.find((item) => item.id === 'local-workbench')?.source, 'local')
    assert.ok(plugins.payload.moduleSlotPlacements.tab.some((item) => item.module === 'local-workbench'))
  })
})

test('G2-3 同版本改代码：摘要变、快照变、新代码生效（旧激活结果不复用）', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'root-3')
    const manifest = workbenchManifest('code-change', ['stylesGet'])
    await makeModule(rootDir, 'code-change', manifest, handlerEntry('CODE-V1', { pageId: 'code-change-page', endpoints: ['stylesGet'] }))
    const added = await call(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const first = await call(origin, '/api/styles')
    assert.equal(first.payload.styles[0].name, 'CODE-V1')
    const firstDigest = added.payload.localModules[0].contentSha256
    const firstSnapshot = (await call(origin, '/api/plugins')).payload.capabilityReport.snapshot

    await writeFile(join(rootDir, 'code-change', 'index.mjs'), handlerEntry('CODE-V2', { pageId: 'code-change-page', endpoints: ['stylesGet'] }), 'utf-8')
    const beforeRefresh = await call(origin, '/api/styles')
    assert.equal(beforeRefresh.payload.styles[0].name, 'CODE-V1', '未刷新前仍持旧句柄')
    const refreshed = await call(origin, '/api/module-roots/refresh', {})
    assert.equal(refreshed.status, 200)
    const changed = refreshed.payload.localModules.find((item) => item.id === 'code-change')
    assert.equal(changed.version, '0.1.0', '版本未升')
    assert.notEqual(changed.contentSha256, firstDigest, '内容摘要必须变')
    assert.equal(changed.contentChanged, true)
    const secondSnapshot = (await call(origin, '/api/plugins')).payload.capabilityReport.snapshot
    assert.notEqual(secondSnapshot, firstSnapshot, '快照 id 必须变')
    const after = await call(origin, '/api/styles')
    assert.equal(after.payload.styles[0].name, 'CODE-V2', '新代码必须真的生效')
  })
})

test('G3-4 三类越界 import 全部拒装：当前快照不动，报告点名边界门', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const snapshotBefore = (await call(origin, '/api/plugins')).payload.capabilityReport.snapshot
    const rootDir = join(base, 'root-4')
    await makeModule(rootDir, 'escape-import', workbenchManifest('escape-import', ['stylesGet']),
      `import { ok } from '../../src/kernel/index.mjs'\nexport async function activate() { return { handlers: {}, pages: {}, _: ok } }`)
    await makeModule(rootDir, 'bare-import', workbenchManifest('bare-import', ['genresGet']),
      `import x from 'not-installed-package'\nexport async function activate() { void x; return { handlers: {}, pages: {} } }`)
    await makeModule(rootDir, 'dynamic-import', workbenchManifest('dynamic-import', ['stylesGet']),
      `const spec = './helper.mjs'\nexport async function activate() { await import(spec); return { handlers: {}, pages: {} } }`)

    const added = await call(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const byId = Object.fromEntries(added.payload.localModules.map((item) => [item.id, item]))
    for (const id of ['escape-import', 'bare-import', 'dynamic-import']) {
      assert.equal(byId[id].status, 'invalid', id)
      assert.equal(byId[id].gate, 'boundary', id)
    }
    assert.match(byId['escape-import'].reason, /越出包目录|OUT_OF_PACKAGE_IMPORT/)
    assert.match(byId['bare-import'].reason, /裸包名|BARE_SPECIFIER/)
    assert.match(byId['dynamic-import'].reason, /字面量|DYNAMIC_IMPORT_NOT_LITERAL/)
    const snapshotAfter = (await call(origin, '/api/plugins')).payload.capabilityReport.snapshot
    assert.equal(snapshotAfter, snapshotBefore, '拒装后当前快照不动')
    const styles = await call(origin, '/api/styles')
    assert.ok(!JSON.stringify(styles.payload).includes('not-installed-package'))
  })
})

test('G5-5 坏 manifest／声明却没供给的能力：跳过并报告，其余模块照常', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'root-5')
    const badDir = join(rootDir, 'bad-manifest')
    await mkdir(badDir, { recursive: true })
    await writeFile(join(badDir, 'module.manifest.json'), '{ this is not json', 'utf-8')
    await makeModule(rootDir, 'no-supply', {
      spec: 'openstory-module@2', id: 'no-supply', name: 'no-supply', version: '0.1.0',
      class: 'kernel', entry: 'index.mjs', capabilities: [{ id: 'no.supply', version: 1 }]
    }, `export async function activate() { return { capabilities: {} } }`)
    await makeModule(rootDir, 'good-module', workbenchManifest('good-module', ['genresGet']), handlerEntry('GOOD-ONE', { pageId: 'good-module-page', endpoints: ['genresGet'] }))

    const added = await call(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const byId = Object.fromEntries(added.payload.localModules.map((item) => [item.id, item]))
    assert.equal(byId['bad-manifest'].gate, 'identity')
    assert.equal(byId['no-supply'].gate, 'contribution')
    assert.equal(byId['good-module'].status, 'loaded')
    const genres = await call(origin, '/api/genres')
    assert.equal(genres.payload.genres[0].name, 'GOOD-ONE', '坏的跳过不能拖垮同包其它模块')
  })
})

test('G4-6 移除模块根：回到内置层，在途请求持旧句柄到底', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'root-6')
    await makeModule(rootDir, 'inflight', workbenchManifest('inflight', ['stylesGet']), handlerEntry('INFLIGHT-V1', { awaitGate: true, pageId: 'inflight-page', endpoints: ['stylesGet'] }))
    const added = await call(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)

    globalThis.__os196Gate = new Promise((done) => { globalThis.__os196Release = done })
    let release
    try {
      const pending = call(origin, '/api/styles')
      const removed = await call(origin, '/api/module-roots/remove', { path: rootDir })
      assert.equal(removed.status, 200)
      assert.deepEqual(removed.payload.roots, [])
      release = globalThis.__os196Release
      release()
      const inFlight = await pending
      assert.equal(inFlight.status, 200)
      assert.equal(inFlight.payload.styles[0].name, 'INFLIGHT-V1', '在途请求必须持旧句柄到底')
      const fresh = await call(origin, '/api/styles')
      assert.ok(!JSON.stringify(fresh.payload).includes('INFLIGHT-V1'), '新请求回内置层')
      assert.ok(fresh.payload.ok)
    } finally {
      if (release) release()
      delete globalThis.__os196Gate
      delete globalThis.__os196Release
    }
  })
})

test('G4-7 本机同 id 覆盖内置：路由指向本机层，报告显式列出', async () => {
  await withDaemon(true, async ({ base, root, origin }) => {
    const rootDir = join(base, 'root-7')
    await makeModule(rootDir, 'artifacts', workbenchManifest('artifacts', ['artifactsGet']), handlerEntry('OVERRIDE-ARTIFACTS', { pageId: 'artifacts-page', endpoints: ['artifactsGet'] }))
    const added = await call(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const local = added.payload.localModules.find((item) => item.id === 'artifacts')
    assert.equal(local.status, 'loaded')

    const response = await fetch(`${origin}/api/artifacts?root=${encodeURIComponent(root)}`)
    const payload = await response.json()
    assert.equal(response.status, 200)
    assert.equal(payload.groups[0].name, 'OVERRIDE-ARTIFACTS', '路由必须指向本机层')
    const plugins = await call(origin, '/api/plugins')
    const entry = plugins.payload.modules.find((item) => item.id === 'artifacts')
    assert.equal(entry.source, 'local')
    assert.equal(entry.sourceDir, rootDir)
    assert.ok(plugins.payload.localModules.some((item) => item.id === 'artifacts'))
  })
})
