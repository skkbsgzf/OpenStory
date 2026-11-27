/**
 * OS-192 · 五类货架一个入口、一套治理、依赖闭包。
 *
 * 贴 Production 调用点：
 * - 统一清单：src/protocol/shelfManifests.mjs:loadShelfFacts / loadShelfCapabilityManifests
 * - 进能力图：src/protocol/modules.mjs:SHELF_MANIFESTS → CAPABILITY_SNAPSHOT
 * - 统一启停：src/services/suites.mjs:listSuitesPublic / setSuiteEnabled / saveSuiteSettings
 * - 本机覆盖报告：src/protocol/shelfManifests.mjs:loadShelfFacts.overrides
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  SHELF_GROUPS, loadShelfFacts, loadShelfCapabilityManifests,
  readShelfSuiteState
} from '../src/protocol/shelfManifests.mjs'
import {
  SHELF_MANIFESTS, CAPABILITY_SNAPSHOT, CAPABILITY_STARTUP_REPORT, ALL_CAPABILITY_MANIFESTS
} from '../src/protocol/modules.mjs'
import { listSuitesPublic, setSuiteEnabled } from '../src/services/suites.mjs'
import { listAllPlugins } from '../src/protocol/plugins.mjs'

const BUILTIN = {
  suitesDirs: ['suites'], skillsDirs: ['skills'], stylesDirs: ['styles'],
  genresDirs: ['genres'], runtimesDirs: ['runtimes']
}
const GROUPS = ['技能包', '文风包', '体裁包', '运行时套件', '业务套装', '推演规则包']

function countByGroup(manifests) {
  const out = Object.fromEntries(GROUPS.map((group) => [group, 0]))
  for (const item of manifests) if (item.group in out) out[item.group] += 1
  return out
}

test('唯一清单：五类货架的六组都有投影，全部 module@2 且进能力图', () => {
  assert.deepEqual(SHELF_GROUPS, GROUPS)
  const manifests = loadShelfCapabilityManifests(BUILTIN)
  assert.deepEqual(manifests, SHELF_MANIFESTS, '装载器与能力图读同一份清单')
  const counts = countByGroup(manifests)
  for (const group of GROUPS) assert.ok(counts[group] > 0, `${group} 不能为空`)
  assert.ok(manifests.length >= 40)
  for (const manifest of manifests) {
    assert.equal(manifest.spec, 'openstory-module@2')
    assert.equal(manifest.class, 'suite')
    assert.equal(Array.isArray(manifest.supplies), true)
    assert.equal(Array.isArray(manifest.entries), false)
  }
  assert.deepEqual(counts, countByGroup(SHELF_MANIFESTS))
  assert.equal(ALL_CAPABILITY_MANIFESTS.length, 23 + manifests.length)
  assert.equal(CAPABILITY_SNAPSHOT.ok, true)
  assert.deepEqual(CAPABILITY_SNAPSHOT.issues, [])
  for (const group of GROUPS) assert.ok(SHELF_MANIFESTS.some((item) => item.group === group), `${group} 在能力图`)
  for (const manifest of manifests) assert.ok(CAPABILITY_SNAPSHOT.loaded.includes(manifest.id), `${manifest.id} loaded`)
  assert.deepEqual(CAPABILITY_STARTUP_REPORT.loaded, CAPABILITY_SNAPSHOT.loaded)
})

test('依赖闭包：技能/运行时硬依赖 agent.runtime；体裁依赖 storage.scaffold＋prose.write；文风包允许空', () => {
  const byId = Object.fromEntries(loadShelfCapabilityManifests(BUILTIN).map((item) => [item.id, item]))
  const skill = byId['chapter-rewrite']
  assert.deepEqual(skill.supplies, ['skill'])
  assert.deepEqual(skill.appliesTo, [{ id: 'agent.runtime', min: 1 }])
  const style = byId.coral
  assert.deepEqual(style.supplies, ['resource'])
  assert.equal(style.resourceKind, 'style')
  assert.deepEqual(style.appliesTo, [], '文风包消费方是底座界面，允许空')
  const genre = byId['long-serial']
  assert.equal(genre.resourceKind, 'genre')
  assert.deepEqual(genre.appliesTo.map((item) => item.id), ['storage.scaffold', 'prose.write'])
  const runtime = byId['echo-kit']
  assert.deepEqual(runtime.supplies, ['runtime'])
  assert.deepEqual(runtime.appliesTo, [{ id: 'agent.runtime', min: 1 }])
  const bundle = byId.writing
  assert.deepEqual(bundle.supplies, ['skill'])
  assert.deepEqual(bundle.appliesTo.map((item) => item.id), ['prose.write'])
})

test('统一启停：五类货架都经 suite-state.json，停用只改状态不改清单', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os192-shelves-'))
  const statePath = join(base, 'suite-state.json')
  try {
    const opts = { ...BUILTIN, suiteStatePath: statePath, root: '' }
    const before = await listSuitesPublic(opts)
    for (const group of GROUPS) assert.ok(before.suites.some((item) => item.group === group), `${group} 在统一货架`)
    const ids = ['chapter-rewrite', 'coral', 'long-serial', 'echo-kit', 'writing']
    for (const id of ids) {
      const set = await setSuiteEnabled(opts, '', id, false, '')
      assert.equal(set.ok, true, `${id} 应可停用`)
    }
    const doc = JSON.parse(await readFile(statePath, 'utf-8'))
    for (const id of ids) assert.equal(doc.suites[id].enabled, false, `${id} 落在统一 suite-state`)
    const after = await listSuitesPublic(opts)
    for (const id of ids) assert.equal(after.suites.find((item) => item.id === id).enabled, false)
    assert.equal(after.suites.length, before.suites.length, '停用不撤下货架条目')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('本机覆盖内置：显式列出谁覆盖谁、来自哪个目录，能力图不重复', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os192-override-'))
  try {
    const local = join(base, '本机', 'skills', 'chapter-rewrite')
    await mkdir(local, { recursive: true })
    await writeFile(join(local, 'SKILL.md'), `---
name: chapter-rewrite
description: 本机覆盖版
category: craft
version: 2.0.0
---

# 本机版
`, 'utf-8')
    const facts = loadShelfFacts({
      ...BUILTIN, skillsDirs: ['skills', join(base, '本机', 'skills')]
    })
    const hit = facts.overrides.find((item) => item.id === 'chapter-rewrite')
    assert.ok(hit, '覆盖必须显式列出')
    assert.equal(hit.group, '技能包')
    assert.match(hit.shadowed.dir, /(?:^|[\\/])skills[\\/]chapter-rewrite$/u)
    assert.match(hit.shadowBy.dir, /本机/u)
    assert.equal(facts.manifests.filter((item) => item.id === 'chapter-rewrite').length, 1)
    assert.equal(facts.manifests.find((item) => item.id === 'chapter-rewrite').version, '2.0.0')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('/api/plugins 统一视图：六组与覆盖报告都在，集中式状态读得到', async () => {
  const listed = await listAllPlugins({ ...BUILTIN, suiteStatePath: '' })
  assert.equal(listed.ok, true)
  assert.deepEqual(Object.keys(listed.byGroup), GROUPS)
  for (const group of GROUPS) assert.ok(listed.byGroup[group].length > 0)
  assert.ok(listed.stats.byGroup['技能包'] >= 30)
  assert.ok(listed.stats.byGroup['文风包'] >= 3)
  assert.ok(listed.stats.byGroup['体裁包'] >= 6)
  assert.ok(listed.stats.byGroup['运行时套件'] >= 5)
  assert.ok(listed.stats.byGroup['业务套装'] >= 2)
  assert.ok(Array.isArray(listed.overrides))
  assert.deepEqual(readShelfSuiteState({}), {})
})
