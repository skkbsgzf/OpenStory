import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createCapabilityResolver } from '../src/protocol/capabilityResolver.mjs'
import {
  CAPABILITY_SNAPSHOT,
  buildCapabilitySnapshot,
  moduleDegradationFor,
  moduleManifest
} from '../src/protocol/modules.mjs'
import { resolveDeduceCapability } from '../src/host/capabilityBindings.mjs'
import { deduceCapability } from '../src/modules/deduce/deduceCapability.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const kernel = (id, capabilities, extra = {}) => ({
  spec: 'openstory-module@2', id, name: id, version: '1.0.0', class: 'kernel', builtin: true, capabilities, ...extra
})
const capability = (id, version = 1) => ({ id, version })

test('能力薄代理：按主版本解析，参数透传且句柄递归冻结', () => {
  const snapshot = buildCapabilitySnapshot({ manifests: [kernel('fact', [capability('fact.store', 3)])] })
  let received
  const resolver = createCapabilityResolver({
    snapshot,
    implementations: { fact: { store: (...args) => { received = args; return 'saved' } } }
  })
  const resolved = resolver.resolve('fact.store', { min: 3, maxExclusive: 4 })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.capability.snapshot, snapshot.id)
  assert.equal(resolved.capability.provider, 'fact')
  assert.equal(resolved.capability.version, 3)
  assert.equal(resolved.capability.store('fact-1', { adopt: true }), 'saved')
  assert.deepEqual(received, ['fact-1', { adopt: true }])
  assert.ok(Object.isFrozen(resolver))
  assert.ok(Object.isFrozen(resolved.capability))
  assert.throws(() => { resolved.capability.store = null }, TypeError)
})

test('能力薄代理：未注册、版本错位、实现缺席与非法区间分别如实失败', () => {
  const snapshot = buildCapabilitySnapshot({ manifests: [kernel('fact', [capability('fact.store', 3)])] })
  const resolver = createCapabilityResolver({ snapshot, implementations: { fact: { store() {} } } })
  assert.equal(resolver.resolve('fact.missing').details.reason, 'CAPABILITY_NOT_REGISTERED')
  assert.equal(resolver.resolve('fact.store', { min: 2 }).details.reason, 'CAPABILITY_VERSION_MISMATCH')
  assert.equal(resolver.resolve('fact.store', { min: 3, maxExclusive: 3 }).code, 'INVALID_ENTRY')
  const unavailable = createCapabilityResolver({ snapshot }).resolve('fact.store', { min: 3 })
  assert.equal(unavailable.code, 'CAPABILITY_MISSING')
  assert.equal(unavailable.details.reason, 'CAPABILITY_PROVIDER_UNAVAILABLE')
})

test('能力薄代理：库数据档位高于路由供给者时解析层直接拒发旧句柄（OS-197a）', () => {
  const snapshot = buildCapabilitySnapshot({ manifests: [kernel('text', [capability('text.analyze', 1)])] })
  const resolver = createCapabilityResolver({
    snapshot,
    implementations: { text: { analyze() {} } },
    dataVersions: [{ capability: 'text.analyze', from: 1, to: 2, journalPath: '.openstory/migrations/text.analyze/1-to-2.json' }]
  })
  const blocked = resolver.resolve('text.analyze', { min: 1 })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'DATA_VERSION_AHEAD')
  assert.equal(blocked.details.capability, 'text.analyze')
  assert.equal(blocked.details.dataVersion, 2)
  assert.equal(blocked.details.provider, 'text')
  assert.equal(blocked.details.providerVersion, 1)
  assert.match(blocked.message, /回退迁移/u)
  // 没迁过的库（无 dataVersions）不受影响；供给者升到数据档位后恢复。
  assert.equal(createCapabilityResolver({ snapshot, implementations: { text: { analyze() {} } } }).resolve('text.analyze').ok, true)
  const upgraded = buildCapabilitySnapshot({ manifests: [kernel('text', [capability('text.analyze', 2)])] })
  assert.equal(createCapabilityResolver({ snapshot: upgraded, implementations: { text: { analyze() {} } }, dataVersions: [{ capability: 'text.analyze', to: 2 }] }).resolve('text.analyze', { min: 2 }).ok, true)
})

test('能力薄代理：冲突不伪装成缺失，保留冲突供给者证据', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [kernel('fact-a', [capability('fact.store')]), kernel('fact-b', [capability('fact.store')])]
  })
  const resolved = createCapabilityResolver({ snapshot }).resolve('fact.store')
  assert.equal(resolved.code, 'CAPABILITY_CONFLICT')
  assert.deepEqual(resolved.details.providers, ['fact-a', 'fact-b'])
})

test('能力薄代理：在途句柄继续持旧快照，新请求才拿停用后的新图', () => {
  const manifests = [kernel('fact', [capability('fact.store')])]
  const active = buildCapabilitySnapshot({ manifests })
  const disabled = buildCapabilitySnapshot({ manifests, state: { 'modules.enabled.fact': false } })
  const implementations = { fact: { store: () => 'old-route' } }
  const inFlight = createCapabilityResolver({ snapshot: active, implementations }).resolve('fact.store').capability
  const next = createCapabilityResolver({ snapshot: disabled, implementations }).resolve('fact.store')
  assert.equal(next.ok, false)
  assert.equal(inFlight.store(), 'old-route')
  assert.equal(inFlight.snapshot, active.id)
  assert.notEqual(active.id, disabled.id)
})

test('内置推演能力：manifest 金样、roleplay 硬依赖与真实薄代理一致', async () => {
  const manifest = moduleManifest('deduce')
  assert.deepEqual(manifest.capabilities, [{ id: 'deduce.engine', version: 1, golden: 'deduce-engine-v1' }])
  assert.deepEqual(moduleManifest('roleplay').requires, [
    { id: 'deduce.engine', min: 1 }, { id: 'fact.store', min: 3 },
    { id: 'prose.write', min: 1 }, { id: 'text.analyze', min: 1 }
  ])
  assert.deepEqual(CAPABILITY_SNAPSHOT.routes['deduce.engine'], {
    provider: 'deduce', version: 1, builtin: true, golden: 'deduce-engine-v1'
  })
  const resolved = await resolveDeduceCapability('')
  assert.equal(resolved.ok, true)
  assert.equal(resolved.capability.snapshot, CAPABILITY_SNAPSHOT.id)
  for (const name of Object.keys(deduceCapability)) assert.equal(typeof resolved.capability[name], 'function', name)
  assert.ok(Object.isFrozen(deduceCapability))
})

test('推演端点消费方不再直引引擎与成文内部实现', async () => {
  // OS-194：消费方从 api/handlers 搬到 roleplay 模块；仍不许直引引擎实现，
  // 能力经 activate(context) 的 context.resolve('deduce.engine') 注入。
  const source = await readFile(join(ROOT, 'src', 'modules', 'roleplay', 'handlers.mjs'), 'utf8')
  assert.doesNotMatch(source, /from ['"]\.\.\/\.\.\/modules\/deduce\/(?:deduceEngine|turnProse)\.mjs['"]/u)
  assert.doesNotMatch(source, /deduceStatePath|readFileSync\([^\n]*lastTurn/u)
  const entry = await readFile(join(ROOT, 'src', 'modules', 'roleplay', 'index.mjs'), 'utf8')
  assert.match(entry, /context\.resolve\('deduce\.engine'/u)
})

test('按库快照解析推演能力：停用供给者时角色工作面明确降级', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-capability-resolver-'))
  const root = join(base, '夹具库')
  try {
    await mkdir(join(root, '.openstory'), { recursive: true })
    await writeFile(join(root, '.openstory', 'ui-state.json'), JSON.stringify({ 'modules.enabled.deduce': false }))
    const resolved = await resolveDeduceCapability(root)
    assert.equal(resolved.ok, false)
    assert.equal(resolved.code, 'CAPABILITY_MISSING')
    assert.equal(resolved.details.reason, 'CAPABILITY_NOT_REGISTERED')
    assert.deepEqual(await moduleDegradationFor('deducePresent', root), {
      module: 'roleplay',
      reasons: ['CAPABILITY_MISSING'],
      missing: [{ capability: 'deduce.engine', min: 1, maxExclusive: 2 }],
      endpoint: 'deducePresent'
    })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
