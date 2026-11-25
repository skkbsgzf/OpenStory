/**
 * OS-196a：动态装载三道门返工的端到端守护测试。
 *
 * 七/八个静态绕法逐个登记、CJS require 的运行期边界、抢端点不跑 activate、
 * 依赖与 JSON 摘要整图失效、自带端点契约与请求校验、宿主端点拒接管、
 * 本机钩子贡献与停用回收——全部走真实 daemon 与临时院子/临时根，不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { hooksFor } from '../src/host/handlerTable.mjs'
import { scanModuleImportGraph } from '../src/protocol/localModuleBoundary.mjs'
import { contentDigest } from '../src/protocol/localModuleContract.mjs'

const text = (value) => String(value ?? '')

async function fixture(withLibrary = false) {
  const base = await mkdtemp(join(tmpdir(), 'os196a-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const root = withLibrary ? join(base, '夹具库') : ''
  if (root) {
    await mkdir(join(root, '.openstory'), { recursive: true })
    await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  }
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: root ? [{ path: root, name: '夹具库' }] : []
  }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  return { base, env, root, daemon, origin: `http://127.0.0.1:${daemon.port}` }
}

async function close(fixture) {
  await fixture.daemon.close()
  await rm(fixture.base, { recursive: true, force: true })
}

async function withDaemon(withLibrary, run) {
  const item = await fixture(withLibrary)
  try { return await run(item) } finally { await close(item) }
}

const kernelManifest = (id, capabilityId = `probe.${id}`) => ({
  spec: 'openstory-module@2', id, name: id, version: '0.1.0', class: 'kernel', entry: 'index.mjs',
  requires: [{ id: 'base.naming', min: 1 }], capabilities: [{ id: capabilityId, version: 1 }]
})

const workbenchManifest = (id, endpoints = [], extra = {}) => ({
  spec: 'openstory-module@2', id, name: id, version: '0.1.0', class: 'workbench', entry: 'index.mjs',
  requires: [{ id: 'base.write', min: 1 }], slots: [{ slot: 'tab', page: `${id}-page` }],
  pages: [{ id: `${id}-page`, label: id }], endpoints, ...extra
})

async function putModule(rootDir, id, manifest, files) {
  const dir = join(rootDir, id)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  for (const [name, source] of Object.entries(files)) await writeFile(join(dir, name), source, 'utf-8')
  return dir
}

const post = (origin, path, body) => fetch(`${origin}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}).then(async (response) => ({ status: response.status, payload: await response.json().catch(() => null) }))

const get = (origin, path) => fetch(`${origin}${path}`)
  .then(async (response) => ({ status: response.status, payload: await response.json().catch(() => null) }))

const snapshotOf = async (origin) => (await get(origin, '/api/plugins')).payload.capabilityReport.snapshot

/** 纯扫描器：七个绕法都要点名，合规样例放行。 */
test('G3-a 静态扫描点名七个绕法（降级为提示，不再是唯一依据）', () => {
  const cases = {
    '字符串藏注释符': [`const a = "/*"`, `import { K } from '../../outside.mjs'`, `const b = "*/"`].join('\n'),
    'createRequire 改名': `import { createRequire as mk } from 'node:module'\nconst r = mk(import.meta.url)\nr('node:fs')`,
    'unicode 转义 eval': `const v = ev\\u0061l('process.version')`,
    '间接 eval': `const v = (0, eval)('process.version')`,
    'Function 不带 new': `const f = Function('return process.version')`,
    'getBuiltinModule': `const { createRequire } = process.getBuiltinModule('node:module')`,
    'AsyncFunction 构造器': `const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor\nnew AsyncFunction('return 1')`,
    '计算属性取 createRequire': `import * as mod from 'node:module'\nmod['create' + 'Require'](import.meta.url)`
  }
  const files = (source) => [{ path: 'index.mjs', source }, { path: 'helper.mjs', source: 'export const helper = 1' }]
  const ok = scanModuleImportGraph(files(`import { readFile } from 'node:fs/promises'\nimport { helper } from './helper.mjs'\nexport async function activate() { return { capabilities: { 'x.y': { ping: () => helper(readFile) } } } }`))
  assert.equal(ok.ok, true)
  for (const [name, source] of Object.entries(cases)) {
    const result = scanModuleImportGraph(files(source))
    assert.equal(result.ok, false, name)
    assert.ok(result.violations.length > 0, `${name} 必须点名具体行`)
    assert.match(result.violations[0].reason, /OUT_OF_PACKAGE|FORBIDDEN|BARE|ABSOLUTE/, name)
  }
})

test('G3-b 八个绕法逐个登记：装载失败、点名边界门、当前层不变、标记文件没写', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'boundary-root')
    await mkdir(rootDir, { recursive: true })
    const before = await snapshotOf(origin)
    const cases = {
      commenteat: `const a = "/*"\nimport '../../outside.mjs'\nconst b = "*/"`,
      renamedrequire: `import { createRequire as mk } from 'node:module'\nmk(import.meta.url)('node:fs')`,
      unicodeeval: `const v = ev\\u0061l('process.version')`,
      indirecteval: `const v = (0, eval)('process.version')`,
      barefunction: `const f = Function('return process.version')`,
      getbuiltin: `process.getBuiltinModule('node:module')`,
      asynctor: `const F = Object.getPrototypeOf(async function () {}).constructor\nnew F('return 1')`,
      computedrequire: `import * as mod from 'node:module'\nmod['create' + 'Require'](import.meta.url)`
    }
    const markers = []
    for (const [id, snippet] of Object.entries(cases)) {
      const marker = join(base, `${id}-ran.txt`)
      markers.push(marker)
      const entry = `import { writeFileSync } from 'node:fs'\n${snippet}\nexport async function activate() { writeFileSync(${JSON.stringify(marker)}, 'RAN'); return { capabilities: { 'probe.${id}': { ping: () => 1 } } } }`
      await putModule(rootDir, id, kernelManifest(id, `probe.${id}`), { 'index.mjs': entry })
    }
    const added = await post(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const byId = Object.fromEntries(added.payload.localModules.map((item) => [item.id, item]))
    for (const id of Object.keys(cases)) {
      assert.equal(byId[id].status, 'invalid', id)
      assert.equal(byId[id].gate, 'boundary', `${id} 必须点名边界门`)
      assert.ok(byId[id].reason.length > 0, id)
      assert.equal(existsSync(join(base, `${id}-ran.txt`)), false, `${id} 的 activate 不能跑`)
    }
    assert.equal(await snapshotOf(origin), before, '拒装后当前快照不动')
    for (const marker of markers) assert.equal(existsSync(marker), false)
  })
})

test('G3-c 运行期钩子挡住静态扫不到的 CJS require 越界', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'runtime-root')
    await mkdir(rootDir, { recursive: true })
    const marker = join(base, 'cjs-escaped.txt')
    await writeFile(join(rootDir, 'outside.cjs'), `require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ESCAPED')\nmodule.exports = 'OUTSIDE'\n`, 'utf-8')
    // bridge.cjs 的 require() 不会被静态 import 扫描发现；运行期解析钩子必须挡下。
    await putModule(rootDir, 'cjs-escape', kernelManifest('cjs-escape'), {
      'index.mjs': `import { value } from './bridge.cjs'\nexport async function activate() { return { capabilities: { 'probe.cjs': { ping: () => value } } } }`,
      'bridge.cjs': `exports.value = require('../outside.cjs')\n`
    })
    const before = await snapshotOf(origin)
    const added = await post(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const item = added.payload.localModules.find((entry) => entry.id === 'cjs-escape')
    assert.equal(item.status, 'invalid')
    assert.equal(item.gate, 'boundary')
    assert.match(item.reason, /越出包目录/)
    assert.equal(existsSync(marker), false, '越界 require 不能真的执行')
    assert.equal(await snapshotOf(origin), before)
  })
})

test('G4-a 两个工作台抢同一端点：两者 activate 都不跑，报告点名双方', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'conflict-root')
    const markers = []
    for (const id of ['wb-alpha', 'wb-beta']) {
      const marker = join(base, `${id}-ran.txt`)
      markers.push(marker)
      const entry = `import { writeFileSync } from 'node:fs'\nexport async function activate() { writeFileSync(${JSON.stringify(marker)}, 'RAN'); return { pages: { '${id}-page': { id: '${id}-page', label: '${id}' } }, handlers: { sharedGet: async ({ res }) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}') } }, contracts: { sharedGet: { method: 'GET', path: '/api/modules/${id}/shared', request: {}, response: { ok: 'true' }, errors: [] } } } }`
      await putModule(rootDir, id, workbenchManifest(id, ['sharedGet']), { 'index.mjs': entry })
    }
    const before = await snapshotOf(origin)
    const added = await post(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    const byId = Object.fromEntries(added.payload.localModules.map((item) => [item.id, item]))
    for (const id of ['wb-alpha', 'wb-beta']) {
      assert.equal(byId[id].status, 'invalid')
      assert.equal(byId[id].gate, 'switch')
      assert.match(byId[id].reason, /sharedGet/)
      assert.match(byId[id].reason, /wb-alpha.*wb-beta|wb-beta.*wb-alpha/)
    }
    for (const marker of markers) assert.equal(existsSync(marker), false, '抢端点的双方都不许跑 activate')
    assert.equal(await snapshotOf(origin), before)
    assert.equal((await get(origin, '/api/modules/wb-alpha/shared')).status, 404)
  })
})

test('G2-a 改依赖 .mjs 与 JSON 数据：刷新后 activate 看到新值', async () => {
  await withDaemon(false, async ({ base, origin }) => {
    const rootDir = join(base, 'deps-root')
    const log = join(base, 'deps-log.txt')
    const entry = `import { VERSION } from './helper.mjs'\nimport extra from './data.json' with { type: 'json' }\nimport { appendFileSync } from 'node:fs'\nexport async function activate() { appendFileSync(${JSON.stringify(log)}, VERSION + ':' + extra.tag + '\\n'); return { capabilities: { 'probe.deps': { read: () => VERSION + extra.tag } } } }`
    await putModule(rootDir, 'deps', kernelManifest('deps', 'probe.deps'), {
      'index.mjs': entry,
      'helper.mjs': `export const VERSION = 'v1'\n`,
      'data.json': `{"tag":"j1"}\n`
    })
    await writeFile(log, '', 'utf-8')
    const added = await post(origin, '/api/module-roots/add', { path: rootDir, confirm: true })
    assert.equal(added.status, 200)
    assert.equal(text(await readFile(log, 'utf-8')).trim(), 'v1:j1')

    await writeFile(join(rootDir, 'deps', 'helper.mjs'), `export const VERSION = 'v2'\n`, 'utf-8')
    await writeFile(join(rootDir, 'deps', 'data.json'), `{"tag":"j2"}\n`, 'utf-8')
    const refreshed = await post(origin, '/api/module-roots/refresh', {})
    assert.equal(refreshed.status, 200)
    const item = refreshed.payload.localModules.find((entry) => entry.id === 'deps')
    assert.equal(item.status, 'loaded')
    assert.equal(item.contentChanged, true)
    assert.equal(text(await readFile(log, 'utf-8')).trim().split('\n').join(' → '), 'v1:j1 → v2:j2')
  })
})

test('G2-a2 迁移器入口计入 import 图与内容摘要，缺失即身份门点名（OS-197a）', () => {
  const files = [
    { path: 'index.mjs', source: 'export async function activate() { return { capabilities: {} } }' },
    { path: 'migrate.mjs', source: "import { helper } from './helper.mjs'\nexport default async function migrate() { return helper() }" },
    { path: 'helper.mjs', source: 'export const helper = () => []' }
  ]
  const scanned = scanModuleImportGraph(files, { entries: ['index.mjs', 'migrate.mjs'] })
  assert.equal(scanned.ok, true)
  assert.deepEqual(scanned.visited.map((item) => item.path), ['helper.mjs', 'index.mjs', 'migrate.mjs'])
  const before = contentDigest(scanned.visited)
  const edited = files.map((item) => item.path === 'helper.mjs'
    ? { ...item, source: 'export const helper = () => [1]' } : item)
  assert.notEqual(contentDigest(scanModuleImportGraph(edited, { entries: ['index.mjs', 'migrate.mjs'] }).visited), before,
    '改迁移器依赖必须换摘要')
  const missing = scanModuleImportGraph(files.slice(0, 1), { entries: ['index.mjs', 'migrate.mjs'] })
  assert.equal(missing.ok, false)
  assert.equal(missing.violations[0].reason, 'ENTRY_NOT_FOUND')
})

test('G4-b 自带端点真实请求经请求校验；停用 409、启用恢复', async () => {
  await withDaemon(true, async ({ root, origin }) => {
    // 模块根放在库外也能登记；这里用 base 下的独立目录避免落进库内稿件目录。
    const moduleRoot = join(root, '..', 'notes-root')
    const entry = `export async function activate() { return { pages: { 'notes-page': { id: 'notes-page', label: 'notes' } }, handlers: { notesGet: async ({ request, res }) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, items: [{ count: request.count }] })) } }, contracts: { notesGet: { method: 'GET', path: '/api/modules/notes/list', request: { query: { count: 'integer' } }, response: { ok: 'true', items: 'array' }, errors: [] } } } }`
    await putModule(moduleRoot, 'notes', workbenchManifest('notes', ['notesGet']), { 'index.mjs': entry })
    const added = await post(origin, '/api/module-roots/add', { path: moduleRoot, confirm: true })
    assert.equal(added.status, 200)
    assert.equal(added.payload.localModules.find((item) => item.id === 'notes').status, 'loaded')

    const bad = await get(origin, '/api/modules/notes/list')
    assert.equal(bad.status, 400, '缺少 count 必须被契约校验挡下')
    assert.equal(bad.payload.error.code, 'INVALID_ENTRY')
    const good = await get(origin, '/api/modules/notes/list?count=2')
    assert.equal(good.status, 200)
    assert.deepEqual(good.payload.items, [{ count: 2 }])

    const statePath = join(root, '.openstory', 'ui-state.json')
    await writeFile(statePath, JSON.stringify({ 'modules.enabled.notes': false }), 'utf-8')
    const disabled = await get(origin, `/api/modules/notes/list?count=2&root=${encodeURIComponent(root)}`)
    assert.equal(disabled.status, 409)
    assert.equal(disabled.payload.error.code, 'MODULE_DISABLED')
    await writeFile(statePath, JSON.stringify({ 'modules.enabled.notes': true }), 'utf-8')
    const restored = await get(origin, `/api/modules/notes/list?count=2&root=${encodeURIComponent(root)}`)
    assert.equal(restored.status, 200)
  })
})

test('G4-c 声明宿主端点 uiStatePut 被拒；宿主行为不变', async () => {
  await withDaemon(true, async ({ root, origin }) => {
    const moduleRoot = join(root, '..', 'hijack-root')
    const entry = `export async function activate() { return { pages: { 'hijack-page': { id: 'hijack-page', label: 'hijack' } }, handlers: { uiStatePut: async ({ res }) => { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, hijacked: true })) } } } }`
    await putModule(moduleRoot, 'hijack', workbenchManifest('hijack', ['uiStatePut']), { 'index.mjs': entry })
    const added = await post(origin, '/api/module-roots/add', { path: moduleRoot, confirm: true })
    assert.equal(added.status, 200)
    const item = added.payload.localModules.find((entry) => entry.id === 'hijack')
    assert.equal(item.status, 'invalid')
    assert.equal(item.gate, 'switch')
    assert.match(item.reason, /宿主自有/)

    const response = await fetch(`${origin}/api/ui-state`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, state: { probe: 196 } })
    })
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.state.probe, 196)
    assert.equal(payload.hijacked, undefined, '宿主端点没有被本机模块接管')
  })
})

test('G1-d 本机钩子贡献接入宿主；停用后消失', async () => {
  await withDaemon(true, async ({ root, origin, env }) => {
    const moduleRoot = join(root, '..', 'hook-root')
    const entry = `export async function activate() { return { pages: { 'hookmod-page': { id: 'hookmod-page', label: 'hook' } }, hooks: { beforeWrite: { localLint: async () => [{ rule: 'LOCAL-HOOK' }] }, promptContext: { localCtx: async () => 'LOCAL-CTX' } } } }`
    await putModule(moduleRoot, 'hookmod', workbenchManifest('hookmod', []), { 'index.mjs': entry })
    const added = await post(origin, '/api/module-roots/add', { path: moduleRoot, confirm: true })
    assert.equal(added.status, 200)
    const hookModule = added.payload.localModules.find((item) => item.id === 'hookmod')
    assert.equal(hookModule.status, 'loaded', `${hookModule.gate}: ${hookModule.reason}`)
    const beforeWrite = await hooksFor(root, 'beforeWrite', env)
    assert.equal(typeof beforeWrite.localLint, 'function', '宿主取得到本机 beforeWrite 钩子')
    const promptContext = await hooksFor(root, 'promptContext', env)
    assert.equal(typeof promptContext.localCtx, 'function', '宿主取得到本机 promptContext 钩子')
    assert.equal(await promptContext.localCtx(), 'LOCAL-CTX')

    const statePath = join(root, '.openstory', 'ui-state.json')
    await writeFile(statePath, JSON.stringify({ 'modules.enabled.hookmod': false }), 'utf-8')
    // 贡献按库快照换表：停用后同名钩子必须消失。
    assert.equal((await hooksFor(root, 'beforeWrite', env)).localLint, undefined, '停用后 beforeWrite 钩子消失')
    assert.equal((await hooksFor(root, 'promptContext', env)).localCtx, undefined, '停用后 promptContext 钩子消失')
  })
})
