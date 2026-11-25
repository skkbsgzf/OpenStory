/**
 * OS-197：能力迁移的生产链路守护测试（真实 daemon＋临时库＋临时模块根）。
 *
 * 覆盖：迁移先于路由生效且幂等；迁移器抛错→数据原样、覆盖者剔除、报告点名；
 * 覆盖者退场→旧供给者拒读新格式（DATA_VERSION_AHEAD）；中断 journal 先恢复再重试。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { resetLibraryMigrations } from '../src/host/libraryMigrations.mjs'
import { resolveCapability, resolveStorageCapability } from '../src/host/capabilityBindings.mjs'

const text = (value) => String(value ?? '')

const MANIFEST = {
  spec: 'openstory-module@2',
  id: 'textplus',
  name: '文本增强',
  version: '2.0.0',
  class: 'kernel',
  entry: 'index.mjs',
  requires: [{ id: 'base.naming', min: 1 }],
  capabilities: [{ id: 'text.analyze', version: 2, golden: 'text-analyze-v2' }],
  overrides: [{ type: 'capability', target: 'text.analyze', from: 1 }],
  migrations: [{ capability: 'text.analyze', from: 1, to: 2, entry: 'migrate.mjs' }]
}

const ENTRY = `export async function activate(context) {
  context.resolve('base.naming', { min: 1 })
  return { capabilities: { 'text.analyze': { analyze: () => ({ probe: 'v2' }) } } }
}`

const MIGRATOR = `export default async function migrate(context) {
  const raw = await context.readFile('.openstory/probe-data.json')
  const data = raw ? JSON.parse(raw) : { version: 1 }
  return [{ path: '.openstory/probe-data.json', content: JSON.stringify({ version: data.version + 1, marker: 'v2' }) }]
}`

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'os197-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  await writeFile(join(root, '.openstory', 'probe-data.json'), JSON.stringify({ version: 1 }), 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: [{ path: root, name: '夹具库' }]
  }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  return { base, env, root, daemon, origin: `http://127.0.0.1:${daemon.port}`, moduleRoot: join(base, '模块根') }
}

async function close(item) {
  resetLibraryMigrations(item.root)
  await item.daemon.close()
  await rm(item.base, { recursive: true, force: true })
}

async function withFixture(run) {
  const item = await fixture()
  try { return await run(item) } finally { await close(item) }
}

async function writeModule(moduleRoot, { migrator = MIGRATOR } = {}) {
  const dir = join(moduleRoot, 'textplus')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify(MANIFEST, null, 2), 'utf-8')
  await writeFile(join(dir, 'index.mjs'), ENTRY, 'utf-8')
  await writeFile(join(dir, 'migrate.mjs'), migrator, 'utf-8')
}

const json = async (response) => ({ status: response.status, payload: await response.json().catch(() => null) })
const get = (origin, path) => fetch(`${origin}${path}`).then(json)
const post = (origin, path, body) => fetch(`${origin}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}).then(json)
const diagnose = (origin, root) => get(origin, `/api/library/diagnose?root=${encodeURIComponent(root)}`)
const plugins = (origin, root) => get(origin, `/api/plugins?root=${encodeURIComponent(root)}`)
const readData = (root) => readFile(join(root, '.openstory', 'probe-data.json'), 'utf-8').then(JSON.parse)

async function addRoot(item) {
  await writeModule(item.moduleRoot)
  const added = await post(item.origin, '/api/module-roots/add', { path: item.moduleRoot, confirm: true })
  assert.equal(added.status, 200)
  assert.equal(added.payload.localModules.find((mod) => mod.id === 'textplus')?.status, 'loaded')
  return added
}

test('OS-197-1 迁移先于路由生效：数据升档、路由指向覆盖者、重开幂等不重跑', async () => {
  await withFixture(async (item) => {
    await addRoot(item)
    const first = await diagnose(item.origin, item.root)
    assert.equal(first.status, 200)
    assert.deepEqual(await readData(item.root), { version: 2, marker: 'v2' })

    const listed = await plugins(item.origin, item.root)
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.capabilityReport.routes['text.analyze'].provider, 'textplus')
    assert.equal(listed.payload.capabilityReport.routes['text.analyze'].version, 2)
    assert.equal(listed.payload.moduleMigrations.ran.length, 1)
    assert.equal(listed.payload.moduleMigrations.failures.length, 0)
    assert.equal(listed.payload.moduleMigrations.dataVersions.find((row) => row.capability === 'text.analyze')?.to, 2)

    // 模拟重开 daemon：缓存清掉后 journal done 直接跳过，数据不再被加一档。
    resetLibraryMigrations(item.root)
    const second = await diagnose(item.origin, item.root)
    assert.equal(second.status, 200)
    assert.deepEqual(await readData(item.root), { version: 2, marker: 'v2' })
    const again = await plugins(item.origin, item.root)
    assert.equal(again.payload.moduleMigrations.ran.length, 0)
    assert.equal(again.payload.moduleMigrations.skipped.length, 1)
  })
})

test('OS-197-2 迁移器抛错：数据逐字节原样、覆盖者剔除、报告点名 MIGRATION_FAILED', async () => {
  await withFixture(async (item) => {
    await writeModule(item.moduleRoot, { migrator: `export default async function migrate() { throw new Error('boom') }` })
    const added = await post(item.origin, '/api/module-roots/add', { path: item.moduleRoot, confirm: true })
    assert.equal(added.status, 200)
    const before = await readFile(join(item.root, '.openstory', 'probe-data.json'))

    const failed = await diagnose(item.origin, item.root)
    assert.equal(failed.status, 500)
    assert.equal(failed.payload?.error?.code, 'MIGRATION_FAILED')
    assert.deepEqual(failed.payload.error.details?.excluded, ['textplus'])
    assert.deepEqual(await readFile(join(item.root, '.openstory', 'probe-data.json')), before)

    const listed = await plugins(item.origin, item.root)
    assert.equal(listed.status, 200)
    const failure = listed.payload.moduleMigrations.failures[0]
    assert.equal(failure.module, 'textplus')
    assert.equal(failure.reason, 'MIGRATION_FAILED')
    assert.equal(failure.rolledBack, true)
    assert.equal(listed.payload.capabilityReport.routes['text.analyze'].provider, 'text')
    assert.equal(listed.payload.localModules.find((mod) => mod.id === 'textplus')?.gate, 'migration')
    assert.equal(listed.payload.localModules.find((mod) => mod.id === 'textplus')?.status, 'invalid')
  })
})

test('OS-197-3 回退保护：覆盖者退场后旧供给者拒读新格式（DATA_VERSION_AHEAD）', async () => {
  await withFixture(async (item) => {
    await addRoot(item)
    assert.equal((await diagnose(item.origin, item.root)).status, 200)
    assert.equal((await readData(item.root)).version, 2)

    const removed = await post(item.origin, '/api/module-roots/remove', { path: item.moduleRoot })
    assert.equal(removed.status, 200)

    const habits = await get(item.origin, `/api/habits?root=${encodeURIComponent(item.root)}`)
    assert.equal(habits.status, 409)
    assert.equal(habits.payload?.error?.code, 'DATA_VERSION_AHEAD')
    const details = habits.payload.error.details
    assert.equal(details.provider, 'text')
    assert.equal(details.providerVersion, 1)
    assert.equal(details.dataVersion, 2)
    assert.match(text(details.message), /覆盖者|回退迁移/u)

    const listed = await plugins(item.origin, item.root)
    assert.equal(listed.payload.moduleMigrations.dataAhead[0].capability, 'text.analyze')
  })
})

test('OS-197-4 中断的 journal：先按备份恢复原格式，再重试迁移', async () => {
  await withFixture(async (item) => {
    // 人为造一份「写了一半」的 running journal：数据已是 v2，备份里是 v1。
    const backupRelative = '.history/capability-text.analyze-1-to-2-fixture'
    const backupDir = join(item.root, backupRelative, '.openstory')
    await mkdir(backupDir, { recursive: true })
    await writeFile(join(backupDir, 'probe-data.json'), JSON.stringify({ version: 1 }), 'utf-8')
    await writeFile(join(item.root, '.openstory', 'probe-data.json'), JSON.stringify({ version: 2, marker: 'partial' }), 'utf-8')
    const journalDir = join(item.root, '.openstory', 'migrations', 'text.analyze')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, '1-to-2.json'), JSON.stringify({
      spec: 'openstory-capability-migration@1',
      plugin: 'textplus',
      capability: 'text.analyze',
      from: 1,
      to: 2,
      entry: 'migrate.mjs',
      entrySha256: '',
      operationId: 'fixture-crash',
      startedAt: new Date().toISOString(),
      backupPath: backupRelative,
      files: [{ path: '.openstory/probe-data.json', beforeHash: '', afterHash: '', backup: '.openstory/probe-data.json', committed: true }],
      state: 'running'
    }, null, 2), 'utf-8')

    await addRoot(item)
    const triggered = await diagnose(item.origin, item.root)
    assert.equal(triggered.status, 200)
    assert.deepEqual(await readData(item.root), { version: 2, marker: 'v2' })

    const listed = await plugins(item.origin, item.root)
    assert.equal(listed.payload.moduleMigrations.ran.length, 1)
    assert.ok(listed.payload.moduleMigrations.ran[0].restored.includes('.openstory/probe-data.json'))
    const journal = JSON.parse(await readFile(join(journalDir, '1-to-2.json'), 'utf-8'))
    assert.equal(journal.state, 'done')
  })
})

test('OS-197a-1 修好迁移器后刷新＝新层＝重试：数据 v2、路由指向覆盖者、journal done', async () => {
  await withFixture(async (item) => {
    const broken = `export default async function migrate() { throw new Error('boom') }`
    await writeModule(item.moduleRoot, { migrator: broken })
    const added = await post(item.origin, '/api/module-roots/add', { path: item.moduleRoot, confirm: true })
    assert.equal(added.status, 200)
    assert.equal((await diagnose(item.origin, item.root)).status, 500)
    assert.deepEqual(await readData(item.root), { version: 1 })

    // 只修迁移器：manifest 与模块入口一字不动，刷新必须拿到新代码并重新尝试。
    await writeFile(join(item.moduleRoot, 'textplus', 'migrate.mjs'), MIGRATOR, 'utf-8')
    const refreshed = await post(item.origin, '/api/module-roots/refresh', {})
    assert.equal(refreshed.status, 200)
    assert.equal((await diagnose(item.origin, item.root)).status, 200)
    assert.deepEqual(await readData(item.root), { version: 2, marker: 'v2' })

    const listed = await plugins(item.origin, item.root)
    assert.equal(listed.payload.capabilityReport.routes['text.analyze'].provider, 'textplus')
    assert.equal(listed.payload.moduleMigrations.ran.length, 1)
    assert.equal(listed.payload.moduleMigrations.failures.length, 0)
    const journal = JSON.parse(await readFile(join(item.root, '.openstory', 'migrations', 'text.analyze', '1-to-2.json'), 'utf-8'))
    assert.equal(journal.state, 'done')
  })
})

test('OS-197a-2 回退保护下沉解析层：旧供给者不发句柄，未迁库不受影响，重新启用即恢复', async () => {
  await withFixture(async (item) => {
    await addRoot(item)
    assert.equal((await diagnose(item.origin, item.root)).status, 200)
    assert.equal((await readData(item.root)).version, 2)

    const removed = await post(item.origin, '/api/module-roots/remove', { path: item.moduleRoot })
    assert.equal(removed.status, 200)

    // 没迁过的库没有任何数据档位：同一解析路径照常发给内置供给者。
    const untouched = join(item.base, '未迁库')
    await mkdir(join(untouched, '.openstory'), { recursive: true })
    await writeFile(join(untouched, '.openstory', 'ui-state.json'), '{}', 'utf-8')
    const clean = await resolveCapability(untouched, 'text.analyze', { min: 1 }, item.env)
    assert.equal(clean.ok, true)
    assert.equal(clean.capability.provider, 'text')

    // 迁过的库：覆盖者退场后供给者自己在解析层拒绝，不等 HTTP 端点闸兜底。
    const direct = await resolveCapability(item.root, 'text.analyze', { min: 1 }, item.env)
    assert.equal(direct.ok, false)
    assert.equal(direct.code, 'DATA_VERSION_AHEAD')
    assert.equal(direct.details.dataVersion, 2)
    assert.equal(direct.details.providerVersion, 1)
    assert.ok(direct.details.journalPath)
    assert.match(text(direct.message), /覆盖者|回退迁移/u)

    // 下游 resolve*Capability 与宿主端点、钩子、MCP 直连共用同一入口，同样拿不到旧句柄。
    const downstream = await resolveStorageCapability(item.root, 'text.analyze', item.env)
    assert.equal(downstream.ok, false)
    assert.equal(downstream.code, 'DATA_VERSION_AHEAD')

    const readded = await post(item.origin, '/api/module-roots/add', { path: item.moduleRoot, confirm: true })
    assert.equal(readded.status, 200)
    const restored = await resolveCapability(item.root, 'text.analyze', { min: 2 }, item.env)
    assert.equal(restored.ok, true)
    assert.equal(restored.capability.provider, 'textplus')
    assert.equal(restored.capability.version, 2)
  })
})