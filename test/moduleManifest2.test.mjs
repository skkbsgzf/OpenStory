import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  LEGACY_MODULE_SPEC, MODULE_SPEC, MODULE_MANIFESTS, MODULE_MANIFEST_WARNINGS, MODULE_MANIFEST_NOTICES,
  MODULE_SOURCES, MODULE_SOURCE_GROUPS, HOST_COMPOSITION_IDS, moduleRole, moduleSource, moduleManifest,
  loadModuleManifests, migrateModuleManifest, validateModuleManifest, readModuleEnabled, deriveModuleStateChange
} from '../src/protocol/modules.mjs'

const BUILTIN_KERNEL_IDS = Object.freeze(['agent-runtime', 'deduce', 'fact', 'media', 'prose', 'storage', 'text'])

const legacy = (id, extra = {}) => ({
  spec: LEGACY_MODULE_SPEC,
  id,
  name: id,
  version: '0.1.0',
  core: false,
  description: `${id} 模块`,
  endpoints: [],
  pages: [{ id: `${id}-page`, label: id, slot: 'tab' }],
  settings: [],
  ...extra
})

const kernel = {
  spec: MODULE_SPEC,
  id: 'fact',
  name: '事实引擎',
  version: '1.0.0',
  class: 'kernel',
  builtin: true,
  entry: 'index.mjs',
  capabilities: [{ id: 'fact.store', version: 3, golden: 'fact-store-v3' }],
  requires: [{ id: 'storage.roots', min: 1 }],
  endpoints: []
}

test('@1 双读：旧 manifest 继续通过，core 只作迁移输入且不进入运行态', () => {
  const checked = validateModuleManifest(legacy('habits', { core: true }), { dirName: 'habits' })
  assert.equal(checked.ok, true, checked.errors.join('；'))
  assert.equal(checked.manifest.spec, LEGACY_MODULE_SPEC)
  assert.equal(Object.prototype.hasOwnProperty.call(checked.manifest, 'core'), false)
  assert.equal(checked.manifest.pages[0].slot, 'tab')
  assert.equal(checked.incomplete, false)
})

test('@1→@2：普通模块推断 workbench，page.slot 提升为顶层 slots', () => {
  const result = migrateModuleManifest(legacy('habits', {
    endpoints: ['habitsGet', 'habitsPut'],
    settingsHint: '在习惯页编辑'
  }), { dirName: 'habits' })
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.equal(result.changed, true)
  assert.equal(result.candidate.spec, MODULE_SPEC)
  assert.equal(result.candidate.class, 'workbench')
  assert.equal(result.candidate.builtin, true)
  assert.deepEqual(result.candidate.pages, [{ id: 'habits-page', label: 'habits' }])
  assert.deepEqual(result.candidate.slots, [{ slot: 'tab', page: 'habits-page' }])
  assert.equal(result.candidate.settingsHint, '在习惯页编辑')
  assert.equal(result.candidate.core, undefined)
  assert.ok(result.warnings.includes('MODULE_CORE_DEPRECATED'))
})

test('@1→@2：旧 core 不等于 kernel，chapters 仍推断 workbench', () => {
  const result = migrateModuleManifest(legacy('chapters', { core: true }), { dirName: 'chapters' })
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.equal(result.candidate.class, 'workbench')
  assert.equal(result.candidate.core, undefined, '旧 core 只作迁移报告，不进入 @2')
  assert.equal(result.report.splitPending, '写协议后续拆入 prose kernel')
})

test('@1→@2：deduce 推断 kernel 并丢弃界面指路字段', () => {
  const result = migrateModuleManifest(legacy('deduce', { settingsHint: '宿主域实现' }), { dirName: 'deduce' })
  assert.equal(result.ok, true, result.errors.join('；'))
  assert.equal(result.candidate.class, 'kernel')
  assert.equal(result.candidate.pages, undefined)
  assert.equal(result.candidate.slots, undefined)
  assert.equal(result.candidate.settings, undefined)
  assert.equal(result.candidate.settingsHint, undefined)
  assert.deepEqual(result.report.droppedFields, ['settingsHint'])
})

test('@1→@2：agentbar/library 归宿主组合面，不猜 workbench 或内核件', () => {
  for (const id of ['agentbar', 'library']) {
    const result = migrateModuleManifest(legacy(id), { dirName: id })
    assert.equal(result.ok, true, result.errors.join('；'))
    assert.equal(result.candidate.class, undefined)
    assert.equal(result.incomplete, true)
    assert.equal(result.report.role, 'host-composition')
    assert.equal(result.report.hostComposition, true)
    assert.ok(result.warnings.includes('MODULE_CORE_DEPRECATED'))
    assert.ok(!result.warnings.includes('MODULE_CLASS_INCOMPLETE'))
    assert.deepEqual(result.notices, ['MODULE_HOST_COMPOSITION'])
  }
})

test('@1→@2：未知模块拒绝自动推断，迁移幂等', () => {
  const unknown = migrateModuleManifest(legacy('third-party'), { dirName: 'third-party' })
  assert.equal(unknown.ok, false)
  assert.match(unknown.errors.join('；'), /不得自动推断 class/u)

  const first = migrateModuleManifest(legacy('artifacts'), { dirName: 'artifacts' })
  const second = migrateModuleManifest(first.candidate, { dirName: 'artifacts' })
  assert.equal(second.ok, true, second.errors.join('；'))
  assert.equal(second.changed, false)
})

test('@2 B 过渡：最小形状可受理，但标记 incomplete，不伪装完整协议', () => {
  const checked = validateModuleManifest({ spec: MODULE_SPEC, id: 'pending', name: '待归类', version: '0.1.0' }, { dirName: 'pending', stage: 'B' })
  assert.equal(checked.ok, true, checked.errors.join('；'))
  assert.equal(checked.incomplete, true)
  assert.deepEqual(checked.manifest.endpoints, [])
  assert.ok(checked.warnings.includes('MODULE_CLASS_INCOMPLETE'))
})

test('@2 校验：未知字段、page.slot、悬空 slot 与 class 禁字段都拒绝', () => {
  const base = { spec: MODULE_SPEC, id: 'analysis', name: '分析', version: '0.1.0', class: 'workbench', builtin: true }
  const cases = [
    { ...base, typo: true },
    { ...base, pages: [{ id: 'analysis-panel', label: '分析', slot: 'right' }] },
    { ...base, pages: [{ id: 'analysis-panel', label: '分析' }], slots: [{ slot: 'right', page: 'missing' }] },
    { ...base, capabilities: [{ id: 'text.analyze', version: 1 }] },
    { ...base, slots: ['right'] },
    { ...base, core: true }
  ]
  for (const raw of cases) assert.equal(validateModuleManifest(raw, { dirName: 'analysis' }).ok, false)
})

test('@2 能力形状：两段 slug、正整数主版本与消费上界', () => {
  const valid = validateModuleManifest({
    ...kernel,
    capabilities: [{ id: 'fact.store', version: 3, golden: 'fact-store-v3' }],
    requires: [{ id: 'storage.roots', min: 1, maxExclusive: 2 }]
  }, { dirName: 'fact', stage: 'C' })
  assert.equal(valid.ok, true, valid.errors.join('；'))

  for (const requires of [
    [{ id: 'fact', min: 1 }],
    [{ id: 'fact.store', min: 0 }],
    [{ id: 'fact.store', min: 3, maxExclusive: 3 }],
    [{ id: 'fact.store', min: 3 }, { id: 'fact.store', min: 3 }]
  ]) {
    assert.equal(validateModuleManifest({ ...kernel, requires }, { dirName: 'fact' }).ok, false)
  }
  assert.equal(validateModuleManifest({ ...kernel, capabilities: [{ id: 'fact.store', version: 0 }] }, { dirName: 'fact' }).ok, false)
})

test('@2 C 必填矩阵：kernel 正例与缺 entry/capabilities 反例', () => {
  assert.equal(validateModuleManifest(kernel, { dirName: 'fact', stage: 'C' }).ok, true)
  assert.equal(validateModuleManifest({ ...kernel, entry: undefined }, { dirName: 'fact', stage: 'C' }).ok, false)
  assert.equal(validateModuleManifest({ ...kernel, capabilities: [] }, { dirName: 'fact', stage: 'C' }).ok, false)
  assert.equal(validateModuleManifest({ ...kernel, core: false }, { dirName: 'fact', stage: 'C' }).ok, false)
})

test('@2 C 严格拒绝缺 class/core；B 双读仍保留迁移入口', () => {
  const pending = { spec: MODULE_SPEC, id: 'pending', name: '待归类', version: '0.1.0' }
  const transition = validateModuleManifest(pending, { dirName: 'pending', stage: 'B' })
  assert.equal(transition.ok, true)
  assert.equal(transition.incomplete, true)
  const strict = validateModuleManifest(pending, { dirName: 'pending', stage: 'C' })
  assert.equal(strict.ok, false)
  assert.ok(strict.errors.some((error) => error.includes('class 必填')))

  const withCore = { ...kernel, core: false }
  const core = validateModuleManifest(withCore, { dirName: 'fact', stage: 'C' })
  assert.equal(core.ok, false)
  assert.ok(core.errors.some((error) => error.includes('禁止 core')))
})

test('@2 C 必填矩阵：workbench 需要 entry/requires/slots', () => {
  const workbench = {
    spec: MODULE_SPEC, id: 'analysis', name: '分析', version: '1.0.0', class: 'workbench', builtin: true,
    entry: 'index.mjs', requires: [{ id: 'text.analyze', min: 1 }],
    pages: [{ id: 'analysis-panel', label: '分析' }], slots: [{ slot: 'right', page: 'analysis-panel' }]
  }
  assert.equal(validateModuleManifest(workbench, { dirName: 'analysis', stage: 'C' }).ok, true)
  for (const key of ['entry', 'requires', 'slots']) {
    assert.equal(validateModuleManifest({ ...workbench, [key]: undefined }, { dirName: 'analysis', stage: 'C' }).ok, false)
  }
})

test('@2 C 必填矩阵：suite 数据契约与 bundle 依赖', () => {
  const suite = {
    spec: MODULE_SPEC, id: 'default-rules', name: '默认推演规则', version: '1.0.0', class: 'suite', builtin: true,
    supplies: ['deduce-rule'], entries: { 'deduce-rule': 'rules.json' },
    appliesTo: [{ id: 'deduce.engine', min: 1 }], deps: []
  }
  assert.equal(validateModuleManifest(suite, { dirName: 'default-rules', stage: 'C' }).ok, true)
  assert.equal(validateModuleManifest({ ...suite, entries: {} }, { dirName: 'default-rules', stage: 'C' }).ok, false)
  assert.equal(validateModuleManifest({ ...suite, supplies: ['resource'] }, { dirName: 'default-rules', stage: 'C' }).ok, false)
  assert.equal(validateModuleManifest({ ...suite, supplies: ['bundle'], entries: { bundle: 'bundle.json' }, deps: [] }, { dirName: 'default-rules', stage: 'C' }).ok, false)
})

test('装载器双读：显式 stage B 接受 @1 与 @2，坏 manifest 只记 warning', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-module2-'))
  try {
    for (const [id, raw] of [['old', legacy('old')], ['fact', kernel]]) {
      const dir = join(base, id)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, 'module.manifest.json'), JSON.stringify(raw), 'utf-8')
    }
    const bad = join(base, 'bad')
    await mkdir(bad, { recursive: true })
    await writeFile(join(bad, 'module.manifest.json'), '{bad', 'utf-8')
    const loaded = loadModuleManifests(base, { stage: 'B' })
    assert.deepEqual(loaded.manifests.map((item) => item.id), ['fact', 'old'])
    assert.equal(loaded.warnings[0].code, 'MODULE_MANIFEST_UNREADABLE')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('装载器校验内置来源：固定目录中的 manifest 不得声明 builtin:false', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-module-source-'))
  try {
    const dir = join(base, 'fake')
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'module.manifest.json'), JSON.stringify({ ...kernel, id: 'fake', builtin: false }), 'utf-8')
    const loaded = loadModuleManifests(base)
    assert.deepEqual(loaded.manifests, [])
    assert.equal(loaded.warnings[0].code, 'MODULE_MANIFEST_INVALID')
    assert.match(loaded.warnings[0].message, /builtin:false/u)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('C6 内置 20 份 manifest 已升 @2；七内核、十一工作台、两个宿主组合面', () => {
  assert.equal(MODULE_MANIFESTS.length, 20)
  for (const manifest of MODULE_MANIFESTS) {
    assert.equal(manifest.spec, MODULE_SPEC)
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'core'), false)
    assert.equal(validateModuleManifest(manifest, { dirName: manifest.id, stage: 'C' }).ok, true)
  }
  assert.equal(MODULE_MANIFESTS.filter((item) => item.class === 'workbench').length, 11)
  assert.equal(MODULE_MANIFESTS.filter((item) => item.class === 'kernel').length, 7)
  assert.equal(MODULE_MANIFESTS.filter((item) => !item.class).length, 2)
  assert.ok(MODULE_MANIFEST_NOTICES.some((item) => item.code === 'MODULE_HOST_COMPOSITION' && item.id === 'agentbar'))
  assert.ok(MODULE_MANIFEST_NOTICES.some((item) => item.code === 'MODULE_HOST_COMPOSITION' && item.id === 'library'))
  assert.deepEqual(MODULE_MANIFEST_WARNINGS, [])
})

test('C6 内置来源：内核/工作台/宿主面分区，目录与 manifest 哈希可追溯', () => {
  assert.deepEqual(MODULE_SOURCE_GROUPS.kernel, BUILTIN_KERNEL_IDS)
  assert.deepEqual(MODULE_SOURCE_GROUPS['host-composition'], ['agentbar', 'library'])
  assert.equal(MODULE_SOURCE_GROUPS.workbench.length, 11)
  assert.equal(MODULE_SOURCE_GROUPS.suite.length, 0)
  assert.equal(MODULE_SOURCE_GROUPS.unclassified.length, 0)
  assert.equal(MODULE_SOURCES.length, MODULE_MANIFESTS.length)
  for (const source of MODULE_SOURCES) {
    assert.equal(source.source, 'builtin')
    assert.equal(source.sourceDir, `src/modules/${source.id}`)
    assert.match(source.manifestSha256, /^[a-f0-9]{64}$/u)
    assert.equal(source.role, moduleRole(moduleManifest(source.id)))
    assert.equal(moduleSource(source.id), source)
  }
})

test('B4 宿主组合面：旧 false 状态不生效，状态事务也不得伪装成工作台停用', () => {
  const state = {
    'modules.enabled.agentbar': false,
    'modules.enabled.library': false,
    modules: { enabled: { agentbar: false, library: false } }
  }
  for (const id of HOST_COMPOSITION_IDS) assert.equal(readModuleEnabled(state, id), true)
  for (const patch of [
    { 'modules.enabled.agentbar': false },
    { modules: { enabled: { library: false } } }
  ]) {
    const change = deriveModuleStateChange({ manifests: MODULE_MANIFESTS, state: {}, patch })
    assert.equal(change.ok, false)
    assert.equal(change.code, 'INVALID_ENTRY')
  }
})
