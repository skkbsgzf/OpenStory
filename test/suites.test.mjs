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
  getSuiteStateData,
  listSuitesPublic,
  loadSuites,
  normalizeSuite,
  saveSuiteSettings,
  saveSuiteStateData,
  setSuiteEnabled,
  suiteValue
} from '../src/services/suites.mjs'
import { resolveSuiteAssetPath, startDaemon } from '../src/host/daemon.mjs'

const GOOD = {
  schemaVersion: 'openstory-suite@1',
  id: 'writing',
  name: '写作套件',
  version: '0.1.0',
  vendor: 'skkbsgzf',
  description: '小说写作',
  domains: ['写作'],
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

test('套件规整：@1 兼容（settings→schema 模式）；@2 能力声明逐项把门', () => {
  const ok = normalizeSuite(GOOD, { source: '内置', dir: 'D:/s/writing' })
  assert.equal(ok.ok, true)
  assert.equal(ok.suite.version, '0.1.0')
  assert.equal(ok.suite.capabilities.settings.mode, 'schema', '@1 顶层 settings 自动按 schema 模式兼容')

  assert.equal(normalizeSuite({ ...GOOD, schemaVersion: 'x' }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeSuite({ ...GOOD, version: '0.1' }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeSuite({ ...GOOD, vendor: '' }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeSuite({ ...GOOD, settings: [{ key: 'k', type: 'magic' }] }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeSuite({ ...GOOD, settings: [{ key: 'k', type: 'select', options: [], default: 'a' }] }, { source: '内置', dir: 'd' }).ok, false)
  const select = normalizeSuite({ ...GOOD, settings: [{ key: 'ratio', type: 'select', options: ['16:9', '4:3'], default: '4:3' }] }, { source: '内置', dir: 'd' })
  assert.equal(select.ok, true)
})

test('套件规整 @2：page 模式（entry 文件必须在）、pages/services 登记、坏能力拒', async () => {
  const { base } = await makeFixture()
  try {
    const suiteDir = join(base, 'kit')
    await mkdir(suiteDir, { recursive: true })
    await writeFile(join(suiteDir, 'settings.html'), '<html></html>', 'utf-8')
    const page = normalizeSuite({
      schemaVersion: 'openstory-suite@2', id: 'comicdrama', name: '漫剧', version: '0.2.0', vendor: 'skkbsgzf',
      domains: ['漫剧'],
      capabilities: { settings: { mode: 'page', entry: 'settings.html' }, pages: [{ id: 'board', title: '分镜板', entry: 'board.html' }], services: [] }
    }, { source: '内置', dir: suiteDir })
    assert.equal(page.ok, true)
    assert.equal(page.suite.capabilities.settings.mode, 'page')
    assert.deepEqual(page.suite.capabilities.pages, [{ id: 'board', title: '分镜板', entry: 'board.html' }])

    assert.equal(normalizeSuite({ schemaVersion: 'openstory-suite@2', id: 'x', name: 'x', version: '0.1.0', vendor: 'v', capabilities: { settings: { mode: 'page', entry: '不存在.html' } } }, { source: '内置', dir: suiteDir }).ok, false, 'entry 文件不在＝拒')
    assert.equal(normalizeSuite({ schemaVersion: 'openstory-suite@2', id: 'x', name: 'x', version: '0.1.0', vendor: 'v', capabilities: { settings: { mode: 'telepathy' } } }, { source: '内置', dir: suiteDir }).ok, false)
    assert.equal(normalizeSuite({ schemaVersion: 'openstory-suite@2', id: 'x', name: 'x', version: '0.1.0', vendor: 'v', capabilities: { pages: [{ id: 'bad id!', entry: 'a.html' }] } }, { source: '内置', dir: suiteDir }).ok, false)
    const none = normalizeSuite({ schemaVersion: 'openstory-suite@2', id: 'x', name: 'x', version: '0.1.0', vendor: 'v' }, { source: '内置', dir: suiteDir })
    assert.equal(none.ok, true)
    assert.equal(none.suite.capabilities.settings.mode, 'none', '无能力声明＝不摆设置')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('套件货架：内置有写作/编剧/漫剧；本机覆盖；坏 kit 记 warning', async () => {
  const { base, userSuites } = await makeFixture()
  try {
    const builtin = loadSuites([builtinSuitesDir(), userSuites])
    const ids = builtin.suites.map((suite) => suite.id)
    for (const id of ['writing', 'screenwriting', 'comicdrama']) assert.ok(ids.includes(id), `缺 ${id}`)

    await mkdir(join(userSuites, 'writing'), { recursive: true })
    await writeFile(join(userSuites, 'writing', 'manifest.json'), JSON.stringify({ ...GOOD, name: '写作（本机改）', version: '0.2.0' }), 'utf-8')
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

test('套件资产路径闸：../、绝对、.pinax 逐段拒收（服务端真闸）', () => {
  const dir = 'D:/s/comicdrama'
  assert.equal(resolveSuiteAssetPath(dir, '../writing/manifest.json').code, 'PATH_ESCAPE')
  assert.equal(resolveSuiteAssetPath(dir, '..\\writing\\manifest.json').code, 'PATH_ESCAPE')
  assert.equal(resolveSuiteAssetPath(dir, '.pinax/project.json').code, 'PATH_ESCAPE')
  assert.equal(resolveSuiteAssetPath(dir, '/etc/passwd').code, 'PATH_ESCAPE')
  assert.equal(resolveSuiteAssetPath(dir, '').ok, false)
  const ok = resolveSuiteAssetPath(dir, 'settings.html')
  assert.equal(ok.ok, true)
  assert.ok(ok.abs.includes('comicdrama'))
})

test('daemon 端到端：page 模式套件——assets 同源装载＋state-data 往返＋逃逸 403', async () => {
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
    // 漫剧是 @2 page 模式（内置）：自带设置页同源可达
    const page = await fetch(`${origin}/suite-assets/comicdrama/settings.html`)
    assert.equal(page.status, 200)
    assert.match(page.headers.get('content-type'), /text\/html/u)
    assert.ok((await page.text()).includes('漫剧套件 · 设置'))

    // state-data 往返（宿主只存不校验形状；PUT 的 id 在 body）
    const put = await fetch(`${origin}/api/suite/state-data`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'comicdrama', values: { boardRatio: '2.35:1', gridColumns: 4, nested: { ok: true } } }) })
    assert.equal(put.status, 200)
    const got = await (await fetch(`${origin}/api/suite/state-data?id=comicdrama`)).json()
    assert.deepEqual(got.values, { boardRatio: '2.35:1', gridColumns: 4, nested: { ok: true } })

    // values 非对象拒收；逃逸与未知套件拒收
    const bad = await fetch(`${origin}/api/suite/state-data`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'comicdrama', values: [1, 2] }) })
    assert.equal(bad.status, 400)
    // URL 解析器（浏览器同理）会把 %2e%2e 归一成 ..——落到 /suite-assets/writing/manifest.json，
    // 仍是货架内合法资产；服务端逐段拒 `..` 的闸在纯函数层（resolveSuiteAssetPath）另测。
    const normalizedEscape = await fetch(`${origin}/suite-assets/comicdrama/%2e%2e/writing/manifest.json`)
    if (normalizedEscape.status === 200) {
      assert.match(await normalizedEscape.text(), /openstory-(?:suite|module)@/u, '归一后仍只可能落在货架内套件资产上')
    }
    const unknown = await fetch(`${origin}/suite-assets/nope/settings.html`)
    assert.equal(unknown.status, 404)
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
    schemaVersion: 'openstory-suite@1',
    id: 'bundling',
    name: '捆绑测试套件',
    version: '0.1.0',
    vendor: 'Test',
    description: '验证捆绑技能随启停生效',
    domains: ['测试'],
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
