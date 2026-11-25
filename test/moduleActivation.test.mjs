import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activateModules } from '../src/host/moduleLoader.mjs'
import { createModuleActivationContext, validateModuleContribution } from '../src/protocol/moduleActivation.mjs'
import { CAPABILITY_SNAPSHOT, MODULE_MANIFESTS } from '../src/protocol/modules.mjs'

async function fixture(run) {
  const dir = await mkdtemp(join(tmpdir(), 'openstory-activation-'))
  try {
    await run(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

const manifest = (id, extra = {}) => ({
  id,
  class: 'kernel',
  entry: 'index.mjs',
  capabilities: [{ id: `${id}.run`, version: 1 }],
  requires: [],
  ...extra
})

const snapshot = (enabled) => ({ id: `test-${Object.values(enabled).join('-')}`, enabled })
const resolver = () => ({ resolve: () => ({ ok: true, capability: { run() {} } }) })

test('activate：真实导入入口、解析依赖并按快照缓存', async () => {
  await fixture(async (dir) => {
    const moduleDir = join(dir, 'alpha')
    await mkdir(moduleDir)
    await writeFile(join(moduleDir, 'index.mjs'), `export async function activate(context) {
      const dependency = context.resolve('base.write', { min: 1 })
      return { capabilities: { 'alpha.run': { run: () => dependency.snapshot } } }
    }`)
    const options = { snapshot: snapshot({ alpha: true }), manifests: [manifest('alpha', { requires: [{ id: 'base.write', min: 1 }] })], modulesDir: dir, resolver: resolver() }
    const first = await activateModules(options)
    const second = await activateModules(options)
    assert.equal(first, second)
    assert.equal(first.activated.length, 1)
    assert.equal(first.activated[0].resolved[0].id, 'base.write')
    assert.equal(first.activated[0].contribution.capabilities['alpha.run'].run(), undefined)
  })
})

test('activate：依赖缺失即失败，不静默装载半成品', async () => {
  await fixture(async (dir) => {
    const moduleDir = join(dir, 'alpha')
    await mkdir(moduleDir)
    await writeFile(join(moduleDir, 'index.mjs'), `export async function activate(context) {
      context.resolve('missing.run', { min: 1 })
      return { capabilities: { 'alpha.run': { run() {} } } }
    }`)
    await assert.rejects(
      activateModules({ snapshot: snapshot({ alpha: true }), manifests: [manifest('alpha')], modulesDir: dir, resolver: { resolve: () => ({ ok: false, code: 'CAPABILITY_MISSING', message: 'missing' }) } }),
      (error) => error.code === 'CAPABILITY_MISSING'
    )
  })
})

test('activate：未声明贡献与越界 entry 均拒绝', async () => {
  await fixture(async (dir) => {
    const moduleDir = join(dir, 'alpha')
    await mkdir(moduleDir)
    await writeFile(join(moduleDir, 'index.mjs'), `export async function activate() {
      return { capabilities: { 'other.run': { run() {} } } }
    }`)
    await assert.rejects(
      activateModules({ snapshot: snapshot({ alpha: true }), manifests: [manifest('alpha')], modulesDir: dir, resolver: resolver() }),
      /未在 manifest 声明/u
    )
    await assert.rejects(
      activateModules({ snapshot: snapshot({ alpha: true }), manifests: [manifest('alpha', { entry: '../outside.mjs' })], modulesDir: dir, resolver: resolver() }),
      /越出模块目录/u
    )
  })
})

test('activate：停用模块不导入入口', async () => {
  await fixture(async (dir) => {
    const result = await activateModules({ snapshot: snapshot({ alpha: false }), manifests: [manifest('alpha')], modulesDir: dir, resolver: resolver() })
    assert.deepEqual(result.activated, [])
  })
})

test('激活上下文：记录依赖句柄，贡献白名单不收未知字段', () => {
  const capability = Object.freeze({ snapshot: 'old-snapshot', run() {} })
  const context = createModuleActivationContext(manifest('alpha'), () => ({ ok: true, capability }))
  assert.equal(context.resolve('base.write', { min: 1, maxExclusive: 2 }), capability)
  assert.equal(context.resolved[0].capability.snapshot, 'old-snapshot')
  assert.equal(validateModuleContribution(manifest('alpha'), { capabilities: { 'alpha.run': { run() {} } }, rogue: {} }).ok, false)
})

test('生产能力图：20 个内置入口全部真实激活，七内核贡献完整且零图问题', async () => {
  assert.deepEqual(CAPABILITY_SNAPSHOT.issues, [])
  const result = await activateModules({ snapshot: CAPABILITY_SNAPSHOT, manifests: MODULE_MANIFESTS })
  assert.deepEqual(result.activated.map((item) => item.id), MODULE_MANIFESTS.map((item) => item.id))
  assert.equal(result.activated.length, 21)
  assert.deepEqual(
    result.activated.filter((item) => MODULE_MANIFESTS.find((manifest) => manifest.id === item.id)?.class === 'kernel')
      .flatMap((item) => Object.keys(item.contribution.capabilities)).sort(),
    ['agent.runtime', 'deduce.engine', 'fact.books', 'fact.domain', 'fact.engine', 'fact.enrich', 'fact.pack', 'fact.store', 'fact.write', 'media.describe', 'media.generate', 'prose.write', 'storage.roots', 'storage.scaffold', 'library.list', 'text.analyze'].sort()
  )
  for (const item of result.activated) {
    assert.ok(item.resolved.length > 0, `${item.id} 必须真实解析依赖`)
    for (const dependency of item.resolved) assert.equal(dependency.capability.snapshot, CAPABILITY_SNAPSHOT.id)
  }
})
