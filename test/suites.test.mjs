/**
 * OpenStory OS-15 用例（node:test，零依赖）——业务套件：manifest 规整/货架/值校验/启停/接线。
 *
 * 跑法：
 *   node --test openstory/test/suites.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import {
  builtinSuitesDir,
  defaultSuiteStatePath,
  defaultUserSuitesDir,
  listSuitesPublic,
  loadSuites,
  normalizeSuite,
  saveSuiteSettings,
  setSuiteEnabled,
  suiteValue
} from '../src/services/suites.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

const GOOD = {
  spec: 'openstory-module@2',
  id: 'writing',
  name: '写作套件',
  version: '0.1.0',
  class: 'suite',
  builtin: true,
  description: '小说写作',
  supplies: ['skill'],
  entries: { skill: 'manifest.json' },
  appliesTo: [{ id: 'prose.write', min: 1 }],
  deps: [],
  settings: [
    { key: 'newChapterTitle', label: '新建章节默认标题', type: 'string', default: '未命名章' },
    { key: 'deduceBranches', label: '推演默认分支数', type: 'number', default: 2 }
  ]
}

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os15-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1, libraries: [{ path: root, name: '夹具库', at: '2026-11-15T00:00:00.000Z' }]
  }), 'utf-8')
  return {
    base, root, preferencesPath,
    configPath: join(base, 'agent-config.json'),
    sessionsDir: join(base, 'sessions'),
    userSuites: join(base, 'OpenStory', 'openstory', 'suites'),
    suiteStatePath: join(base, 'OpenStory', 'openstory', 'suite-state.json')
  }
}

test('套件规整：只认 module@2；legacy @1/@2 页面模式直接拒收并给出警告', async () => {
  const { base } = await makeFixture()
  try {
    const suiteDir = join(base, 'writing')
    await mkdir(suiteDir, { recursive: true })
    await writeFile(join(suiteDir, 'manifest.json'), JSON.stringify(GOOD), 'utf-8')
    const ok = normalizeSuite(GOOD, { source: '内置', dir: suiteDir })
    assert.equal(ok.ok, true)
    assert.equal(ok.suite.version, '0.1.0')
    assert.equal(ok.suite.capabilities.settings.mode, 'schema')
    assert.equal(ok.suite.capabilities.pages.length, 0, 'module@2 套件不携带可执行页面')

    const legacy1 = normalizeSuite({ ...GOOD, spec: 'openstory-suite@1', schemaVersion: 'openstory-suite@1' }, { source: '内置', dir: suiteDir })
    assert.equal(legacy1.ok, false)
    assert.equal(legacy1.warning.code, 'SUITE_SPEC')
    const legacy2 = normalizeSuite({ ...GOOD, spec: 'openstory-suite@2', schemaVersion: 'openstory-suite@2' }, { source: '内置', dir: suiteDir })
    assert.equal(legacy2.ok, false)
    assert.equal(legacy2.warning.code, 'SUITE_SPEC')

    assert.equal(normalizeSuite({ ...GOOD, settings: [{ key: 'k', type: 'magic' }] }, { source: '内置', dir: suiteDir }).ok, false)
    assert.equal(normalizeSuite({ ...GOOD, settings: [{ key: 'k', type: 'select', options: [], default: 'a' }] }, { source: '内置', dir: suiteDir }).ok, false)
    const select = normalizeSuite({ ...GOOD, settings: [{ key: 'ratio', label: '画幅比例', type: 'select', options: ['16:9', '4:3'], default: '4:3' }] }, { source: '内置', dir: suiteDir })
    assert.equal(select.ok, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-192 套件货架：漫剧占位已删，内置写作/编剧/推演规则；本机覆盖；坏 kit 记 warning', async () => {
  const { base, userSuites } = await makeFixture()
  try {
    const builtin = loadSuites([builtinSuitesDir(), userSuites])
    const ids = builtin.suites.map((suite) => suite.id)
    for (const id of ['writing', 'screenwriting', 'deduce-rules']) assert.ok(ids.includes(id), `缺 ${id}`)
    assert.equal(ids.includes('comicdrama'), false, '漫剧占位套件已退役')

    await mkdir(join(userSuites, 'writing'), { recursive: true })
    await writeFile(join(userSuites, 'writing', 'manifest.json'), JSON.stringify({ ...GOOD, builtin: false, name: '写作（本机改）', version: '0.2.0' }), 'utf-8')
    await mkdir(join(userSuites, '坏套件'), { recursive: true })
    await writeFile(join(userSuites, '坏套件', 'manifest.json'), JSON.stringify({ id: 'x' }), 'utf-8')
    const merged = loadSuites([builtinSuitesDir(), userSuites])
    const writing = merged.suites.find((suite) => suite.id === 'writing')
    assert.equal(writing.name, '写作（本机改）')
    assert.equal(writing.version, '0.2.0')
    assert.ok(merged.warnings.some((warning) => warning.code === 'SUITE_SPEC'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('套件状态：值按 schema 校验（坏值拒）、启用缺省 true、停用不清值', async () => {
  const { base, userSuites, suiteStatePath } = await makeFixture()
  try {
    await mkdir(join(userSuites, 'writing'), { recursive: true })
    await writeFile(join(userSuites, 'writing', 'manifest.json'), JSON.stringify(GOOD), 'utf-8')
    const dirs = [builtinSuitesDir(), userSuites]

    const listed = await listSuitesPublic(dirs, suiteStatePath)
    const writing = listed.suites.find((suite) => suite.id === 'writing')
    assert.equal(writing.enabled, true, '缺省启用')
    assert.equal(writing.values.newChapterTitle, '未命名章', 'default 归一')

    const bad = await saveSuiteSettings(dirs, suiteStatePath, 'writing', { deduceBranches: '很多' })
    assert.equal(bad.ok, false)
    assert.match(bad.message, /number/)

    const saved = await saveSuiteSettings(dirs, suiteStatePath, 'writing', { newChapterTitle: '草稿', deduceBranches: 3, hacked: 'x' })
    assert.equal(saved.ok, true)
    assert.equal(saved.values.newChapterTitle, '草稿')
    assert.equal(saved.values.deduceBranches, 3)
    assert.equal(saved.values.hacked, undefined, '未知键丢弃')

    await setSuiteEnabled(dirs, suiteStatePath, 'writing', false)
    assert.equal(await suiteValue(dirs, suiteStatePath, 'writing', 'newChapterTitle', '回退'), '回退', '停用＝退回默认')
    const stateDoc = JSON.parse(await readFile(suiteStatePath, 'utf-8'))
    assert.equal(stateDoc.suites.writing.values.newChapterTitle, '草稿', '停用不清值')
    await setSuiteEnabled(dirs, suiteStatePath, 'writing', true)
    assert.equal(await suiteValue(dirs, suiteStatePath, 'writing', 'newChapterTitle', '回退'), '草稿', '启用即恢复')

    const unknown = await setSuiteEnabled(dirs, suiteStatePath, 'nope', false)
    assert.equal(unknown.ok, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('契约：suites 三端点形状', () => {
  assert.equal(validateRequest('suitesGet', {}).ok, true)
  assert.equal(validateRequest('suiteSettingsPut', { id: 'writing', values: {} }).ok, true)
  assert.equal(validateRequest('suiteSettingsPut', { id: 'writing' }).ok, false)
  assert.equal(validateRequest('suiteStatePut', { id: 'writing', enabled: true }).ok, true)
  assert.equal(validateRequest('suiteStatePut', { id: 'writing', enabled: 'yes' }).ok, false)
  assert.equal(validateResponse('suitesGet', { ok: true, suites: [] }).ok, true)
  assert.equal(validateResponse('suiteSettingsPut', { ok: true, values: {} }).ok, true)
  assert.equal(validateResponse('suiteStatePut', { ok: true, enabled: false }).ok, true)
})

test('默认路径：跟随 LOCALAPPDATA/OpenStory/openstory', () => {
  assert.equal(
    defaultSuiteStatePath({ LOCALAPPDATA: 'X:/fixture-home/AppData/Local' }).replaceAll('\\', '/'),
    'X:/fixture-home/AppData/Local/OpenStory/openstory/suite-state.json'
  )
  assert.equal(defaultUserSuitesDir({}).replaceAll('\\', '/').endsWith('openstory/suites'), false)
  assert.equal(defaultUserSuitesDir({}), '')
})

test('OS-192 退役守卫：/suite-assets 路由与两个 state-data 端点都不存在', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    env: { ...process.env, LOCALAPPDATA: fixture.base },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const page = await fetch(`${origin}/suite-assets/writing/settings.html`)
    assert.equal(page.status, 404, 'legacy page 模式资产路由已退役')
    const tokens = await fetch(`${origin}/suite-assets/_tokens.css`)
    assert.equal(tokens.status, 404, '令牌桥随 page 模式一并退役')
    const get = await fetch(`${origin}/api/suite/state-data?id=writing`)
    assert.equal(get.status, 404, 'suiteStateDataGet 已退役')
    const put = await fetch(`${origin}/api/suite/state-data`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: 'writing', values: { x: 1 } })
    })
    assert.equal(put.status, 404, 'suiteStateDataPut 已退役')
    // 正常读写端点仍在（三端点契约不变）
    const shelves = await (await fetch(`${origin}/api/suites`)).json()
    assert.equal(shelves.ok, true)
    assert.ok(Array.isArray(shelves.overrides))
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})

test('daemon 端到端：货架→存值→停用→新建空标题被拦→启用→默认标题生效', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    env: { ...process.env, LOCALAPPDATA: fixture.base },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const put = (path, body) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const shelves = await (await fetch(`${origin}/api/suites`)).json()
    assert.equal(shelves.ok, true)
    assert.ok(shelves.suites.some((suite) => suite.id === 'writing' && suite.vendor === 'skkbsgzf' && suite.source === '内置'))

    // 写作套件：存默认标题 → 新建章不填标题 → 用默认标题
    await put('/api/suite/settings', { id: 'writing', values: { newChapterTitle: '草稿章' } })
    const created = await post('/api/chapters', { root: fixture.root, dir: '正文', title: '' })
    assert.equal(created.status, 200)
    assert.equal((await created.json()).chapter.name, '001-草稿章.md')

    // 停用写作套件 → 空标题被拦（规则退回内置默认＝没有默认）
    await put('/api/suite/state', { id: 'writing', enabled: false })
    const blocked = await post('/api/chapters', { root: fixture.root, dir: '正文', title: '' })
    assert.equal(blocked.status, 400)

    // 坏值 400
    await put('/api/suite/state', { id: 'writing', enabled: true })
    const bad = await put('/api/suite/settings', { id: 'writing', values: { deduceBranches: '很多' } })
    assert.equal(bad.status, 400)

    // 未知套件拒收
    const unknown = await put('/api/suite/state', { id: 'nope', enabled: false })
    assert.equal(unknown.status, 400)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})

/* ---------- OS-68：套件捆绑技能 ---------- */

test('daemon 端到端：套件捆绑技能——启用上货架＋详情页可见＋停用撤下', async () => {
  const fixture = await makeFixture()
  const suiteDir = join(fixture.userSuites, 'bundling')
  await mkdir(join(suiteDir, 'skills', 'suite-only'), { recursive: true })
  await writeFile(join(suiteDir, 'manifest.json'), JSON.stringify({
    spec: 'openstory-module@2',
    id: 'bundling',
    name: '捆绑测试套件',
    version: '0.1.0',
    class: 'suite',
    builtin: false,
    description: '验证捆绑技能随启停生效',
    supplies: ['skill'],
    entries: { skill: 'skills/suite-only/SKILL.md' },
    appliesTo: [{ id: 'prose.write', min: 1 }],
    deps: [],
    settings: []
  }), 'utf-8')
  await writeFile(join(suiteDir, 'skills', 'suite-only', 'SKILL.md'), `---
name: suite-only
description: 套件专属技能
version: 0.1.0
vendor: Test
category: review
---

# 套件专属

- 只随套件启停出现的技能
`, 'utf-8')
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    env: { ...process.env, LOCALAPPDATA: fixture.base },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const put = (path, body) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    // 1) 货架可见捆绑技能清单（详情页数据）
    const shelves = await (await fetch(`${origin}/api/suites`)).json()
    const suite = shelves.suites.find((item) => item.id === 'bundling')
    assert.ok(suite, '用户套件应上架')
    assert.deepEqual(suite.bundledSkills.map((skill) => skill.name), ['suite-only'])
    assert.equal(suite.bundledSkills[0].category, 'review')

    // 2) 技能货架包含套件技能，来源＝套件名
    const skills = await (await fetch(`${origin}/api/skills`)).json()
    const bundled = skills.skills.find((skill) => skill.name === 'suite-only')
    assert.ok(bundled, '启用套件的技能应上货架')
    assert.equal(bundled.source, '套件·捆绑测试套件')

    // 3) 停用套件 → 技能撤下货架（套件本体还在，bundledSkills 仍可展示）
    await put('/api/suite/state', { id: 'bundling', enabled: false })
    const after = await (await fetch(`${origin}/api/skills`)).json()
    assert.ok(!after.skills.some((skill) => skill.name === 'suite-only'), '停用后技能应下架')

    // 4) 再启用 → 回来
    await put('/api/suite/state', { id: 'bundling', enabled: true })
    const back = await (await fetch(`${origin}/api/skills`)).json()
    assert.ok(back.skills.some((skill) => skill.name === 'suite-only'), '重新启用后技能应回到货架')
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
