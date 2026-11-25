import test from 'node:test'
import assert from 'node:assert/strict'
import {
  MODULE_MANIFESTS,
  SHELF_MANIFESTS,
  ALL_CAPABILITY_MANIFESTS,
  CAPABILITY_SNAPSHOT,
  CAPABILITY_STARTUP_REPORT,
  buildCapabilitySnapshot,
  capabilityStartupReport,
  deriveModuleStateChange,
  moduleDegradation,
  readModuleEnabled,
  readSuiteEnabled
} from '../src/protocol/modules.mjs'
import { API_ERROR_CODES } from '../src/api/contracts.mjs'
import { sendError } from '../src/host/http.mjs'
import { validateCapabilityMigration } from '../src/protocol/capabilityMigration.mjs'

const kernel = (id, capabilities, extra = {}) => ({
  spec: 'openstory-module@2',
  id,
  name: id,
  version: '1.0.0',
  class: 'kernel',
  builtin: true,
  capabilities,
  endpoints: [],
  ...extra
})

const workbench = (id, requires = [], extra = {}) => ({
  spec: 'openstory-module@2',
  id,
  name: id,
  version: '1.0.0',
  class: 'workbench',
  builtin: true,
  requires,
  endpoints: [],
  pages: [{ id: `${id}-page`, label: id }],
  slots: [{ slot: 'tab', page: `${id}-page` }],
  settings: [],
  ...extra
})

const capability = (id, version = 1, golden) => ({ id, version, ...(golden ? { golden } : {}) })
const requirement = (id, min = 1, maxExclusive) => ({ id, min, ...(maxExclusive ? { maxExclusive } : {}) })
const suite = (id, appliesTo, extra = {}) => ({
  spec: 'openstory-module@2',
  id,
  name: id,
  version: '1.0.0',
  class: 'suite',
  builtin: true,
  supplies: ['deduce-rule'],
  entries: { 'deduce-rule': 'rules.json' },
  appliesTo,
  deps: [],
  settings: [],
  ...extra
})

test('能力注册：主版本与消费区间共同决定闭环', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [
      kernel('fact', [capability('fact.store', 3)]),
      workbench('ok', [requirement('fact.store', 3, 4)]),
      workbench('too-old', [requirement('fact.store', 2, 3)]),
      workbench('too-new', [requirement('fact.store', 4)])
    ]
  })
  assert.equal(snapshot.ok, false)
  assert.deepEqual(snapshot.routes['fact.store'], { provider: 'fact', version: 3, builtin: true })
  assert.ok(snapshot.loaded.includes('ok'))
  assert.ok(snapshot.degraded.includes('too-old'))
  assert.ok(snapshot.degraded.includes('too-new'))
  assert.deepEqual(snapshot.issues.filter((item) => item.code === 'CAPABILITY_MISSING').map((item) => item.details.capability), ['fact.store', 'fact.store'])
})

test('hard 缺失不装载消费者，optional 缺失只降级不阻断', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [workbench('hard', [requirement('text.analyze')]), workbench('optional', [], { optionalRequires: [requirement('fact.enrich')] })]
  })
  const hard = snapshot.statuses.find((item) => item.id === 'hard')
  const optional = snapshot.statuses.find((item) => item.id === 'optional')
  assert.equal(hard.active, false)
  assert.equal(optional.active, true)
  assert.equal(optional.status, 'degraded')
  assert.ok(snapshot.loaded.includes('optional'))
  assert.equal(snapshot.issues.filter((item) => item.code === 'CAPABILITY_MISSING').length, 1)
  assert.equal(snapshot.optionalMissing[0].plugin, 'optional')
})

test('底座 hard requires 断链进启动报告，但不阻止进程事实可用', () => {
  const snapshot = buildCapabilitySnapshot({ manifests: [], base: { requires: [requirement('storage.roots')] } })
  assert.equal(snapshot.ok, false)
  assert.deepEqual(snapshot.issues[0].details.consumers, ['base'])
  assert.equal(snapshot.issues[0].code, 'CAPABILITY_MISSING')
})

test('同能力多供给无显式覆盖＝冲突，消费者随之降级', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [kernel('fact-a', [capability('fact.store')]), kernel('fact-b', [capability('fact.store')]), workbench('worldbook', [requirement('fact.store')])]
  })
  assert.equal(snapshot.routes['fact.store'], undefined)
  assert.ok(snapshot.issues.some((item) => item.code === 'CAPABILITY_CONFLICT' && item.details.capability === 'fact.store'))
  assert.ok(snapshot.issues.some((item) => item.code === 'CAPABILITY_MISSING' && item.details.consumers.includes('worldbook')))
  assert.ok(!snapshot.loaded.includes('fact-a'))
  assert.ok(!snapshot.loaded.includes('fact-b'))
})

test('合法能力覆盖只替换目标能力，停用后回退到前一合法供给者', () => {
  const manifests = [
    kernel('fact', [capability('fact.store'), capability('fact.pack')]),
    kernel('fact-local', [capability('fact.store')], { builtin: false, overrides: [{ type: 'capability', target: 'fact.store', from: 1 }] }),
    workbench('worldbook', [requirement('fact.store'), requirement('fact.pack')])
  ]
  const active = buildCapabilitySnapshot({ manifests })
  assert.equal(active.ok, true, active.issues.map((item) => item.message).join('；'))
  assert.equal(active.routes['fact.store'].provider, 'fact-local')
  assert.equal(active.routes['fact.pack'].provider, 'fact')

  const fallback = deriveModuleStateChange({ manifests, patch: { 'modules.enabled.fact-local': false } })
  assert.equal(fallback.ok, true)
  assert.equal(fallback.candidate.routes['fact.store'].provider, 'fact')
  assert.ok(fallback.candidate.loaded.includes('worldbook'))

  // 回退语义：被覆盖的内置供给者停用时，只剩覆盖者一个供给者，覆盖声明不生效，按普通供给者装载。
  const soloManifests = [
    kernel('solo-fact', [capability('fact.store')]),
    kernel('solo-local', [capability('fact.store')], {
      builtin: false,
      overrides: [{ type: 'capability', target: 'fact.store', from: 1 }]
    }),
    workbench('solo-consumer', [requirement('fact.store')])
  ]
  const withoutTarget = deriveModuleStateChange({ manifests: soloManifests, patch: { 'modules.enabled.solo-fact': false } })
  assert.equal(withoutTarget.ok, true, withoutTarget.message ?? '')
  assert.equal(withoutTarget.candidate.routes['fact.store'].provider, 'solo-local')
  assert.ok(withoutTarget.candidate.loaded.includes('solo-local'))
  assert.ok(withoutTarget.candidate.loaded.includes('solo-consumer'))
  assert.ok(!withoutTarget.candidate.issues.some((item) => item.code === 'CAPABILITY_MISSING'))
  assert.ok(!withoutTarget.candidate.issues.some((item) => item.code === 'OVERRIDE_REJECTED' && item.details.reason === 'SELF_OVERRIDE'))
  const bothOff = buildCapabilitySnapshot({
    manifests: soloManifests,
    state: { 'modules.enabled.solo-fact': false, 'modules.enabled.solo-local': false }
  })
  assert.ok(bothOff.issues.some((item) => item.code === 'CAPABILITY_MISSING'
    && item.details.capability === 'fact.store' && item.details.consumers.includes('solo-consumer')))
})

test('两个本机覆盖争抢同一目标时拒绝双方，内置保持兜底，按级退出后回退链生效', () => {
  const manifests = [
    kernel('fact', [capability('fact.store')]),
    kernel('fact-local-a', [capability('fact.store')], {
      builtin: false,
      overrides: [{ type: 'capability', target: 'fact.store', from: 1 }]
    }),
    kernel('fact-local-b', [capability('fact.store')], {
      builtin: false,
      overrides: [{ type: 'capability', target: 'fact.store', from: 1 }]
    })
  ]
  const active = buildCapabilitySnapshot({ manifests })
  assert.equal(active.ok, false)
  assert.equal(active.routes['fact.store'].provider, 'fact')
  assert.ok(active.degraded.includes('fact-local-a'))
  assert.ok(active.degraded.includes('fact-local-b'))

  const oneDisabled = deriveModuleStateChange({ manifests, patch: { 'modules.enabled.fact-local-b': false } })
  assert.equal(oneDisabled.ok, true)
  assert.equal(oneDisabled.candidate.routes['fact.store'].provider, 'fact-local-a')

  const allLocalDisabled = deriveModuleStateChange({
    manifests,
    patch: { 'modules.enabled.fact-local-a': false, 'modules.enabled.fact-local-b': false }
  })
  assert.equal(allLocalDisabled.ok, true)
  assert.equal(allLocalDisabled.candidate.routes['fact.store'].provider, 'fact')
})

test('同级本机覆盖争抢的裁决与装载顺序无关', () => {
  const ordered = [
    kernel('fact', [capability('fact.store')]),
    kernel('fact-local-a', [capability('fact.store')], {
      builtin: false,
      overrides: [{ type: 'capability', target: 'fact.store', from: 1 }]
    }),
    kernel('fact-local-b', [capability('fact.store')], {
      builtin: false,
      overrides: [{ type: 'capability', target: 'fact.store', from: 1 }]
    })
  ]
  const forward = buildCapabilitySnapshot({ manifests: ordered })
  const reversed = buildCapabilitySnapshot({ manifests: [...ordered].reverse() })
  for (const snapshot of [forward, reversed]) {
    assert.equal(snapshot.ok, false)
    assert.equal(snapshot.routes['fact.store'].provider, 'fact')
    assert.ok(snapshot.issues.some((item) => item.code === 'CAPABILITY_CONFLICT' && item.details.reason === 'OVERRIDE_CYCLE'))
  }
  assert.deepEqual([...forward.degraded].sort(), [...reversed.degraded].sort())
})

test('缺 hard 依赖的内核件不得继续供能力，消费者收到真实断链', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [
      kernel('broken', [capability('broken.store')], { requires: [requirement('text.analyze')] }),
      workbench('consumer', [requirement('broken.store')])
    ]
  })
  assert.equal(snapshot.routes['broken.store'], undefined)
  assert.ok(snapshot.issues.some((item) => item.code === 'CAPABILITY_MISSING'
    && item.details.capability === 'text.analyze' && item.details.consumers.includes('broken')))
  assert.ok(snapshot.issues.some((item) => item.code === 'CAPABILITY_MISSING'
    && item.details.capability === 'broken.store' && item.details.consumers.includes('consumer')))
  assert.ok(!snapshot.loaded.includes('broken'))
})

test('升主版本覆盖必须带匹配迁移器，金样能力必须提供新金样', () => {
  const base = kernel('fact', [capability('fact.store', 3, 'fact-store-v3')])
  const local = kernel('fact-local', [capability('fact.store', 4, 'fact-store-v4')], {
    builtin: false,
    overrides: [{ type: 'capability', target: 'fact.store', from: 3 }]
  })
  const missingMigration = buildCapabilitySnapshot({ manifests: [base, local] })
  assert.ok(missingMigration.issues.some((item) => item.code === 'OVERRIDE_REJECTED' && item.details.reason === 'OVERRIDE_MIGRATION_REQUIRED'))
  assert.equal(missingMigration.routes['fact.store'].provider, 'fact')

  const migrated = buildCapabilitySnapshot({
    manifests: [base, { ...local, migrations: [{ capability: 'fact.store', from: 3, to: 4, entry: 'migrate.mjs' }] }]
  })
  assert.equal(migrated.ok, true, migrated.issues.map((item) => item.message).join('；'))
  assert.equal(migrated.routes['fact.store'].provider, 'fact-local')

  const reusedGolden = buildCapabilitySnapshot({
    manifests: [base, kernel('fact-copy', [capability('fact.store', 3, 'fact-store-v3')], {
      overrides: [{ type: 'capability', target: 'fact.store', from: 3 }]
    })]
  })
  assert.ok(reusedGolden.issues.some((item) => item.code === 'OVERRIDE_REJECTED' && item.details.reason === 'OVERRIDE_GOLDEN_REQUIRED'))

  // 校验对齐：同主版本换金样与跨档被拒，3→4 带迁移器通过；两套校验器逐组一致。
  const alignedBase = kernel('fact', [capability('fact.store', 3, 'g3')])
  const consumer = workbench('worldbook', [requirement('fact.store', 3, 6)])
  const groups = [
    { to: 3, golden: 'g3-new', graphReason: 'GOLDEN_CHANGE_REQUIRES_MAJOR', frameworkOk: false },
    { to: 4, golden: 'g4', graphReason: '', frameworkOk: true },
    { to: 5, golden: 'g5', graphReason: 'OVERRIDE_MIGRATION_GAP', frameworkOk: false }
  ]
  for (const group of groups) {
    const alignedLocal = kernel('fact-local', [capability('fact.store', group.to, group.golden)], {
      builtin: false,
      overrides: [{ type: 'capability', target: 'fact.store', from: 3 }],
      migrations: [{ capability: 'fact.store', from: 3, to: group.to, entry: 'm.mjs' }]
    })
    const snapshot = buildCapabilitySnapshot({ manifests: [alignedBase, alignedLocal, consumer] })
    const rejection = snapshot.issues.find((item) => item.code === 'OVERRIDE_REJECTED' && item.details.plugin === 'fact-local')
    assert.equal(rejection?.details.reason ?? '', group.graphReason, `能力图 ${group.to}`)
    const framework = validateCapabilityMigration(
      { plugin: 'fact-local', capability: 'fact.store', from: 3, to: group.to, entry: 'm.mjs' },
      { packageDir: '/tmp/openstory-migration-fixture' }
    )
    assert.equal(framework.ok, group.frameworkOk, `迁移框架 ${group.to}`)
    assert.equal(!rejection, group.frameworkOk, `两套校验器对 ${group.to} 的判定必须一致`)
  }
})

test('自覆盖、覆盖 base、未知目标与版本错位均拒绝', () => {
  const cases = [
    {
      manifests: [kernel('fact', [capability('fact.store')], { overrides: [{ type: 'capability', target: 'fact.store', from: 1 }] })],
      reason: 'SELF_OVERRIDE'
    },
    {
      manifests: [kernel('local', [capability('base.write')], { overrides: [{ type: 'capability', target: 'base.write', from: 1 }] })],
      base: { capabilities: [capability('base.write')] },
      reason: 'BASE_CAPABILITY_NOT_OVERRIDABLE'
    },
    {
      manifests: [kernel('local', [capability('fact.store')], { overrides: [{ type: 'capability', target: 'fact.missing', from: 1 }] })],
      reason: 'OVERRIDE_TARGET_NOT_SUPPLIED'
    },
    {
      manifests: [kernel('fact', [capability('fact.store', 2)]), kernel('local', [capability('fact.store')], { overrides: [{ type: 'capability', target: 'fact.store', from: 1 }] })],
      reason: 'OVERRIDE_VERSION_MISMATCH'
    }
  ]
  for (const item of cases) {
    const snapshot = buildCapabilitySnapshot(item)
    assert.ok(snapshot.issues.some((issue) => issue.code === 'OVERRIDE_REJECTED' && issue.details.reason === item.reason), item.reason)
  }
})

test('互相覆盖成环按冲突处理，环内供给者不装载', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [
      kernel('a', [capability('a.one'), capability('b.one')], { overrides: [{ type: 'capability', target: 'b.one', from: 1 }] }),
      kernel('b', [capability('a.one'), capability('b.one')], { overrides: [{ type: 'capability', target: 'a.one', from: 1 }] })
    ]
  })
  assert.equal(snapshot.issues.filter((item) => item.code === 'CAPABILITY_CONFLICT' && item.details.reason === 'OVERRIDE_CYCLE').length, 1)
  assert.ok(!snapshot.loaded.includes('a'))
  assert.ok(!snapshot.loaded.includes('b'))
})

test('覆盖者必须有合法回退候选，回退目标已被拒绝时覆盖者降级', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [
      kernel('fact', [capability('fact.store')], { overrides: [{ type: 'capability', target: 'fact.missing', from: 1 }] }),
      kernel('fact-local', [capability('fact.store')], { overrides: [{ type: 'capability', target: 'fact.store', from: 1 }] })
    ]
  })
  assert.ok(snapshot.issues.some((item) => item.code === 'OVERRIDE_REJECTED'
    && item.details.plugin === 'fact-local' && item.details.reason === 'OVERRIDE_FALLBACK_UNAVAILABLE'))
  assert.ok(!snapshot.loaded.includes('fact-local'))
})

test('surface 同 id 多供给按冲突处理，显式覆盖后只保留覆盖者', () => {
  const target = workbench('analysis', [], { pages: [{ id: 'analysis-panel', label: '分析' }], slots: [{ slot: 'right', page: 'analysis-panel' }] })
  const other = workbench('analysis-local', [], {
    pages: [{ id: 'analysis-panel', label: '分析' }],
    slots: [{ slot: 'right', page: 'analysis-panel' }],
    overrides: [{ type: 'surface', target: 'analysis-panel', from: 1 }]
  })
  const conflict = buildCapabilitySnapshot({ manifests: [target, { ...other, overrides: [] }] })
  assert.ok(conflict.issues.some((item) => item.code === 'CAPABILITY_CONFLICT' && item.details.type === 'surface'))
  assert.equal(conflict.surfaces['analysis-panel'], undefined)

  const overridden = buildCapabilitySnapshot({ manifests: [target, other] })
  assert.equal(overridden.ok, true, overridden.issues.map((item) => item.message).join('；'))
  assert.deepEqual(overridden.surfaces['analysis-panel'], [{ type: 'surface', provider: 'analysis-local', version: 1 }])
})

test('surface 覆盖停用后回退内置贡献，消费者不因本机包缺席而失去页面', () => {
  const target = workbench('analysis', [], { pages: [{ id: 'analysis-panel', label: '分析' }], slots: [{ slot: 'right', page: 'analysis-panel' }] })
  const local = workbench('analysis-local', [], {
    builtin: false,
    pages: [{ id: 'analysis-panel', label: '分析' }],
    slots: [{ slot: 'right', page: 'analysis-panel' }],
    overrides: [{ type: 'surface', target: 'analysis-panel', from: 1 }]
  })
  const active = buildCapabilitySnapshot({ manifests: [target, local] })
  assert.equal(active.ok, true, active.issues.map((item) => item.message).join('；'))
  assert.deepEqual(active.surfaces['analysis-panel'], [{ type: 'surface', provider: 'analysis-local', version: 1 }])

  const fallback = deriveModuleStateChange({ manifests: [target, local], patch: { 'modules.enabled.analysis-local': false } })
  assert.equal(fallback.ok, true)
  assert.deepEqual(fallback.candidate.surfaces['analysis-panel'], [{ type: 'surface', provider: 'analysis', version: 1 }])
})

test('启停状态：扁平键优先于嵌套键，forceEnabled 只影响候选图', () => {
  assert.equal(readModuleEnabled({ 'modules.enabled.kb': true, modules: { enabled: { kb: false } } }, 'kb'), true)
  assert.equal(readModuleEnabled({ 'modules.enabled.kb': false }, 'kb'), false)
  assert.equal(readModuleEnabled({ modules: { enabled: { kb: false } } }, 'kb', ['kb']), true)
})

test('套件状态独立于模块状态，appliesTo 缺失时套件不装载', () => {
  const manifests = [kernel('deduce', [capability('deduce.engine')]), suite('rules', [requirement('deduce.engine')])]
  const active = buildCapabilitySnapshot({ manifests, suiteState: { suites: { rules: { enabled: true, density: '高' } } } })
  assert.ok(active.loaded.includes('rules'))

  const disabled = buildCapabilitySnapshot({
    manifests,
    state: { 'modules.enabled.rules': true },
    suiteState: { suites: { rules: { enabled: false } } }
  })
  assert.equal(readSuiteEnabled({ suites: { rules: { enabled: false } } }, 'rules'), false)
  assert.ok(disabled.disabled.includes('rules'))
  assert.ok(!disabled.disabled.includes('deduce'))

  const missing = buildCapabilitySnapshot({ manifests: [suite('rules', [requirement('deduce.engine')])] })
  assert.ok(missing.degraded.includes('rules'))
  assert.ok(missing.issues.some((item) => item.code === 'CAPABILITY_MISSING' && item.details.consumers.includes('rules')))
})

test('停用供给者列出全部活跃 hard consumer，optional consumer 不拦', () => {
  const manifests = [
    kernel('fact', [capability('fact.store')]),
    workbench('worldbook', [requirement('fact.store')]),
    workbench('storysource', [requirement('fact.store')]),
    workbench('analysis', [], { optionalRequires: [requirement('fact.store')] })
  ]
  const denied = deriveModuleStateChange({ manifests, patch: { 'modules.enabled.fact': false } })
  assert.equal(denied.ok, false)
  assert.equal(denied.code, 'CAPABILITY_IN_USE')
  assert.deepEqual(denied.details.consumers, ['storysource', 'worldbook'])
  assert.ok(!denied.details.consumers.includes('analysis'))
})

test('已经降级的 hard consumer 不阻止供给者停用，底座硬依赖仍阻止', () => {
  const manifests = [
    kernel('fact', [capability('fact.store')]),
    workbench('already-degraded', [requirement('fact.store'), requirement('text.analyze')])
  ]
  const change = deriveModuleStateChange({ manifests, patch: { 'modules.enabled.fact': false } })
  assert.equal(change.ok, true)
  assert.ok(change.candidate.degraded.includes('already-degraded'))

  const baseChange = deriveModuleStateChange({
    manifests: [kernel('fact', [capability('fact.store')])],
    base: { requires: [requirement('fact.store')] },
    patch: { 'modules.enabled.fact': false }
  })
  assert.equal(baseChange.code, 'CAPABILITY_IN_USE')
  assert.deepEqual(baseChange.details.consumers, ['base'])
})

test('套件事务可先停消费者再停能力供给者，并保留其它套件设置', () => {
  const manifests = [kernel('deduce', [capability('deduce.engine')]), suite('rules', [requirement('deduce.engine')])]
  const suiteState = { suites: { rules: { enabled: true, density: '高' }, other: { enabled: true, tone: '克制' } } }
  const denied = deriveModuleStateChange({ manifests, suiteState, patch: { 'modules.enabled.deduce': false } })
  assert.equal(denied.code, 'CAPABILITY_IN_USE')
  assert.deepEqual(denied.details.consumers, ['rules'])

  const allowed = deriveModuleStateChange({
    manifests,
    suiteState,
    patch: { 'modules.enabled.deduce': false },
    suitePatch: { suites: { rules: { enabled: false } } }
  })
  assert.equal(allowed.ok, true)
  assert.equal(allowed.suiteState.suites.rules.enabled, false)
  assert.equal(allowed.suiteState.suites.rules.density, '高')
  assert.deepEqual(allowed.suiteState.suites.other, { enabled: true, tone: '克制' })
  assert.equal(suiteState.suites.rules.enabled, true)
})

test('同一状态事务可先停消费者再停供给者，候选图通过才提交', () => {
  const manifests = [kernel('fact', [capability('fact.store')]), workbench('worldbook', [requirement('fact.store')])]
  const state = { 'modules.enabled.fact': true, 'modules.enabled.worldbook': true, theme: 'dark' }
  const change = deriveModuleStateChange({
    manifests,
    state,
    patch: { 'modules.enabled.fact': false, 'modules.enabled.worldbook': false }
  })
  assert.equal(change.ok, true)
  assert.equal(change.state.theme, 'dark')
  assert.equal(state['modules.enabled.fact'], true)
  assert.equal(change.candidate.routes['fact.store'], undefined)
})

test('启用候选若引入新冲突则拒绝，当前快照与状态不变', () => {
  const manifests = [kernel('fact', [capability('fact.store')]), kernel('fact-local', [capability('fact.store')])]
  const state = { 'modules.enabled.fact-local': false }
  const change = deriveModuleStateChange({ manifests, state, patch: { 'modules.enabled.fact-local': true } })
  assert.equal(change.ok, false)
  assert.equal(change.code, 'CAPABILITY_CONFLICT')
  assert.equal(change.current.routes['fact.store'].provider, 'fact')
  assert.equal(state['modules.enabled.fact-local'], false)
})

test('模块降级投影：hard 缺失带能力区间，optional 缺失与主动停用不报降级', () => {
  const snapshot = buildCapabilitySnapshot({
    manifests: [
      workbench('hard', [requirement('text.analyze', 2, 3)]),
      workbench('optional', [], { optionalRequires: [requirement('fact.enrich')] })
    ],
    state: { 'modules.enabled.optional': false }
  })
  assert.deepEqual(moduleDegradation(snapshot, 'hard'), {
    module: 'hard',
    reasons: ['CAPABILITY_MISSING'],
    missing: [{ capability: 'text.analyze', min: 2, maxExclusive: 3 }]
  })
  assert.equal(moduleDegradation(snapshot, 'optional'), null)
  assert.equal(moduleDegradation(snapshot, 'unknown'), null)
})

test('快照与启动报告递归冻结，报告只含可公开的路由与问题', () => {
  const snapshot = buildCapabilitySnapshot({ manifests: [kernel('fact', [capability('fact.store')])] })
  const report = capabilityStartupReport(snapshot)
  assert.ok(Object.isFrozen(snapshot))
  assert.ok(Object.isFrozen(snapshot.routes))
  assert.ok(Object.isFrozen(snapshot.routes['fact.store']))
  assert.ok(Object.isFrozen(report))
  assert.equal(report.snapshot, snapshot.id)
  assert.equal('enabled' in report, false)
  assert.equal('statuses' in report, false)
})

test('OS-192 内置能力图干净：模块＋五类货架逐项 loaded，七内核按实际 id 排序', () => {
  assert.equal(CAPABILITY_SNAPSHOT.ok, true)
  assert.deepEqual(CAPABILITY_SNAPSHOT.issues, [])
  assert.equal(MODULE_MANIFESTS.length, 21)
  const kernels = MODULE_MANIFESTS.filter((item) => item.class === 'kernel').map((item) => item.id).sort()
  assert.deepEqual(kernels, ['agent-runtime', 'deduce', 'fact', 'media', 'prose', 'storage', 'text'])
  assert.deepEqual([...CAPABILITY_SNAPSHOT.loaded].sort(), ALL_CAPABILITY_MANIFESTS.map((item) => item.id).sort())
  for (const group of ['技能包', '文风包', '体裁包', '运行时套件', '业务套装']) {
    assert.ok(SHELF_MANIFESTS.some((item) => item.group === group), `${group} 必须进能力图`)
  }
  assert.ok(SHELF_MANIFESTS.some((item) => item.group === '推演规则包'), '推演规则包必须进能力图')
  assert.equal(CAPABILITY_STARTUP_REPORT.ok, true)
  assert.equal(CAPABILITY_STARTUP_REPORT.snapshot, CAPABILITY_SNAPSHOT.id)
})

test('能力错误码与 HTTP 映射遵守协议', () => {
  const expected = {
    CAPABILITY_MISSING: 503,
    CAPABILITY_CONFLICT: 503,
    CAPABILITY_IN_USE: 409,
    OVERRIDE_REJECTED: 400,
    PLUGIN_DEGRADED: 503
  }
  for (const [code, status] of Object.entries(expected)) {
    assert.equal(API_ERROR_CODES[code], code)
    const res = { writeHead(value) { this.status = value }, end() {} }
    sendError(res, code, code)
    assert.equal(res.status, status, code)
  }
})
