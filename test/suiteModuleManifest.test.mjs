/**
 * OS-186 / D3：套件统一 manifest（openstory-module@2 class:suite）。
 *
 * 货架三层升格后，套件与工作台/内核件共用同一张校验矩阵；能力图直接消费
 * `loadSuiteCapabilityManifests()` 的清单，按 appliesTo 判活跃。legacy page 模式
 * （openstory-suite@2，如漫剧）仍由旧 loader 隔离，不进能力图。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { builtinSuitesDir, loadSuiteCapabilityManifests, loadSuites, normalizeSuite } from '../src/services/suites.mjs'
import { BASE_GRAPH, MODULE_MANIFESTS } from '../src/protocol/modules.mjs'
import { buildCapabilitySnapshot } from '../src/protocol/capabilityGraph.mjs'

const SHELF = {
  spec: 'openstory-module@2',
  id: 'demo-suite',
  name: '示例套件',
  version: '1.0.0',
  class: 'suite',
  builtin: true,
  description: '夹具',
  supplies: ['skill'],
  entries: { skill: 'skills' },
  appliesTo: [{ id: 'prose.write', min: 1 }],
  deps: [],
  settings: [{ key: 'title', label: '默认标题', type: 'string', default: '未命名章' }]
}

async function shelfDir(base, raw = SHELF) {
  const dir = join(base, raw.id)
  await mkdir(join(dir, 'skills'), { recursive: true })
  await writeFile(join(dir, 'skills', 'SKILL.md'), '# 示例\n', 'utf-8')
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(raw), 'utf-8')
  return dir
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-d3-'))
  return { base, builtin: join(base, '内置'), local: join(base, '本机') }
}

test('内置货架：三个套件升格 module@2，漫剧留在 legacy page 模式', () => {
  const { suites, warnings } = loadSuites([builtinSuitesDir()])
  assert.deepEqual(suites.map((suite) => suite.id).sort(), ['comicdrama', 'deduce-rules', 'screenwriting', 'writing'])
  assert.deepEqual(warnings, [])
  const manifests = loadSuiteCapabilityManifests([builtinSuitesDir()])
  assert.deepEqual(manifests.map((suite) => suite.id).sort(), ['deduce-rules', 'screenwriting', 'writing'])
  const deduce = manifests.find((suite) => suite.id === 'deduce-rules')
  assert.equal(deduce.spec, 'openstory-module@2')
  assert.equal(deduce.class, 'suite')
  assert.equal(deduce.builtin, true)
  assert.deepEqual(deduce.supplies, ['deduce-rule'])
  assert.deepEqual(deduce.entries, { 'deduce-rule': 'rules.json' })
  assert.deepEqual(deduce.appliesTo, [{ id: 'deduce.engine', min: 1 }])
  assert.deepEqual(deduce.deps, [])
  const writing = manifests.find((suite) => suite.id === 'writing')
  assert.deepEqual(writing.settings.map((item) => item.key), ['newChapterTitle', 'deduceBranches'])
})

test('module@2 规整：supplies/entries/appliesTo/settings 进规范形状，vendor 按来源派生', async () => {
  const { base, builtin } = await fixture()
  try {
    const dir = await shelfDir(builtin)
    const normalized = normalizeSuite(SHELF, { source: '内置', dir })
    assert.equal(normalized.ok, true)
    assert.equal(normalized.suite.vendor, 'skkbsgzf')
    assert.equal(normalized.suite.builtin, true)
    assert.deepEqual(normalized.suite.supplies, ['skill'])
    assert.deepEqual(normalized.suite.entries, { skill: 'skills' })
    assert.deepEqual(normalized.suite.appliesTo, [{ id: 'prose.write', min: 1 }])
    assert.equal(normalized.suite.capabilities.settings.mode, 'schema')
    assert.equal(normalized.suite.capabilities.pages.length, 0)

    const local = normalizeSuite({ ...SHELF, builtin: false }, { source: '本机', dir })
    assert.equal(local.ok, true)
    assert.equal(local.suite.vendor, '本机')
    assert.equal(local.suite.builtin, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('module@2 拒收：builtin 与来源不一致、entries 越界/缺失、携带可执行代码', async () => {
  const { base, builtin } = await fixture()
  try {
    const dir = await shelfDir(builtin)
    const builtinMismatch = normalizeSuite({ ...SHELF, builtin: false }, { source: '内置', dir })
    assert.equal(builtinMismatch.ok, false)
    assert.equal(builtinMismatch.warning.code, 'SUITE_BUILTIN_MISMATCH')
    const localMismatch = normalizeSuite({ ...SHELF, builtin: true }, { source: '本机', dir })
    assert.equal(localMismatch.warning.code, 'SUITE_BUILTIN_MISMATCH')

    for (const entry of ['../skills', '/etc/skills', 'skills/../../x', 'C:/skills', '']) {
      const escaped = normalizeSuite({ ...SHELF, entries: { skill: entry } }, { source: '内置', dir })
      assert.equal(escaped.ok, false, `entry 应被拒：${entry}`)
      assert.match(escaped.warning.code, /^SUITE_(?:MODULE_SHAPE|ENTRY_INVALID)$/u)
    }
    const missing = normalizeSuite({ ...SHELF, entries: { skill: 'skills-absent' } }, { source: '内置', dir })
    assert.equal(missing.warning.code, 'SUITE_ENTRY_MISSING')

    await writeFile(join(dir, 'tool.mjs'), 'export default 1\n', 'utf-8')
    const scripted = normalizeSuite(SHELF, { source: '内置', dir })
    assert.equal(scripted.ok, false)
    assert.equal(scripted.warning.code, 'SUITE_EXECUTABLE_CODE')
    await rm(join(dir, 'tool.mjs'))
    await writeFile(join(dir, 'page.html'), '<html><script>alert(1)</script></html>', 'utf-8')
    const inline = normalizeSuite(SHELF, { source: '内置', dir })
    assert.equal(inline.warning.code, 'SUITE_EXECUTABLE_CODE', '内联脚本 HTML 同样不入套件')
    await rm(join(dir, 'page.html'))
    await writeFile(join(dir, 'page.html'), '<html><body>纯说明</body></html>', 'utf-8')
    assert.equal(normalizeSuite(SHELF, { source: '内置', dir }).ok, true, '无脚本的说明页可以留')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('能力图集成：套件按 appliesTo 活跃；停推演内核 → deduce-rules 降级，写作套件不受影响', () => {
  const suites = loadSuiteCapabilityManifests([builtinSuitesDir()])
  const manifests = [...MODULE_MANIFESTS, ...suites]
  const all = buildCapabilitySnapshot({ manifests, base: BASE_GRAPH })
  for (const id of ['writing', 'screenwriting', 'deduce-rules']) {
    assert.equal(all.statuses.find((item) => item.id === id).status, 'loaded', `${id} 应活跃`)
  }
  assert.equal(all.ok, true)

  const noDeduce = buildCapabilitySnapshot({ manifests, base: BASE_GRAPH, state: { 'modules.enabled.deduce': false } })
  const deduceRuleStatus = noDeduce.statuses.find((item) => item.id === 'deduce-rules')
  assert.equal(deduceRuleStatus.status, 'degraded')
  assert.ok(deduceRuleStatus.reasons.includes('CAPABILITY_MISSING'))
  assert.equal(noDeduce.statuses.find((item) => item.id === 'writing').status, 'loaded')
  assert.ok(noDeduce.issues.some((item) => item.code === 'CAPABILITY_MISSING'
    && item.details.capability === 'deduce.engine'
    && item.details.consumers.includes('deduce-rules')))

  const suiteOff = buildCapabilitySnapshot({
    manifests,
    base: BASE_GRAPH,
    suiteState: { suites: { writing: { enabled: false } } }
  })
  assert.equal(suiteOff.statuses.find((item) => item.id === 'writing').status, 'disabled')
  assert.equal(suiteOff.statuses.find((item) => item.id === 'screenwriting').status, 'loaded')
})

test('本机覆盖同一套件：按 id 只留一份，能力图不出现重复贡献', async () => {
  const { base, builtin, local } = await fixture()
  try {
    await shelfDir(builtin)
    await shelfDir(local, { ...SHELF, name: '示例套件（本机）', builtin: false })
    const manifests = loadSuiteCapabilityManifests([builtin, local])
    assert.equal(manifests.length, 1)
    assert.equal(manifests[0].builtin, false)
    assert.equal(manifests[0].name, '示例套件（本机）')
    const snapshot = buildCapabilitySnapshot({ manifests: [...MODULE_MANIFESTS, ...manifests], base: BASE_GRAPH })
    assert.equal(snapshot.ok, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})