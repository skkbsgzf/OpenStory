/**
 * B3 / OS-176：core 字段与 MODULE_CORE 拒写语义退役。
 *
 *   ① 四个原核心工作台与普通模块同口径，可停用、端点受闸、数据保留；
 *   ② uiStatePut 不再特殊拒写，候选能力图仍是唯一事务裁判；
 *   ③ 页签级 core 仍表示顶栏可达面，模块停用后归属 slot 消失；
 *   ④ 重新启用后端点与页签恢复，磁盘稿件从未被停用动作改动。
 *
 * 夹具一律系统临时目录，绝不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { API_ERROR_CODES, ENDPOINTS } from '../src/api/contracts.mjs'
import { allHandlers } from '../src/host/handlerTable.mjs'
import {
  MODULE_MANIFESTS, moduleManifest, moduleOfEndpoint, moduleRole,
  isModuleEnabled, isModuleDisabledFor, slotProjection
} from '../src/protocol/modules.mjs'
import {
  projectedTabDefs, BUILTIN_PAGE_IDS
} from '../public/views/registry.mjs'
import { governanceModel, pluginCardHtml } from '../public/views/governanceViews.mjs'
import * as settingsAggregationModule from '../public/views/settingsAggregation.mjs'

const FORMER_CORE_IDS = ['chapters', 'roleplay', 'script', 'worldbook']

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'os176-core-retire-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '世界书'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  await writeFile(join(root, '正文', '001-风雪山神庙.md'), '# 第一章\n林冲推门而入。', 'utf-8')
  await writeFile(join(root, '世界书', '梁山.md'), '# 梁山\n好汉聚义之地。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  return { base, root, preferencesPath }
}

async function forceDisable(root) {
  const state = {
    'modules.enabled.chapters': false,
    'modules.enabled.script': false,
    'modules.enabled.worldbook': false,
    'modules.enabled.roleplay': false,
    'modules.enabled.habits': false,
    modules: { enabled: { chapters: false, script: false, worldbook: false, roleplay: false, habits: false } }
  }
  await writeFile(join(root, '.openstory', 'ui-state.json'), JSON.stringify(state), 'utf-8')
}

test('manifest：四个原核心工作台已去 core，端点归属与错误契约仍精确', async () => {
  for (const id of FORMER_CORE_IDS) {
    const manifest = moduleManifest(id)
    assert.equal(manifest.class, 'workbench')
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'core'), false, `${id} 不得声明 core`)
  }
  assert.deepEqual([...moduleManifest('chapters').endpoints].sort(), [
    'chapterDelete', 'chapterGet', 'chapterPut', 'chaptersCreate', 'chaptersGet', 'chaptersRename', 'draftGet'
  ])
  assert.deepEqual([...moduleManifest('script').endpoints], [], '剧本没有独占端点（借 chapters 通道）')
  assert.deepEqual([...moduleManifest('worldbook').endpoints].sort(), [
    'referenceAbsorb', 'referenceAssetGet', 'referenceGet', 'referenceGraphGet', 'referenceImageGenerate', 'referenceNoteGet'
  ])
  assert.equal(moduleManifest('roleplay').endpoints.includes('deduceImage'), false)
  assert.equal(moduleOfEndpoint('deduceImage'), 'imagegen')
  // OS-195a：写世界书条目的端点归世界书（端点分派），生图模块不再 import referenceStore。
  assert.equal(moduleOfEndpoint('referenceImageGenerate'), 'worldbook')
  const table = await allHandlers()
  for (const manifest of MODULE_MANIFESTS) {
    for (const endpoint of manifest.endpoints) {
      assert.ok(table[endpoint], `${endpoint} 必须有 handler`)
      assert.ok(ENDPOINTS[endpoint].errors.includes('MODULE_DISABLED'), `${endpoint} 必须登记可停用语义`)
      assert.equal(moduleOfEndpoint(endpoint), manifest.id)
    }
  }
  assert.equal(moduleOfEndpoint('changeLogGet'), null, '跨模块日志仍归宿主')
  assert.equal(Object.prototype.hasOwnProperty.call(API_ERROR_CODES, 'MODULE_CORE'), false)
  assert.equal(ENDPOINTS.uiStatePut.errors.includes('MODULE_CORE'), false)
})

test('证据①可停用：ui-state 的 false 对四个工作台一致生效，独占端点全部受闸', async () => {
  const { base, root } = await makeLibrary()
  try {
    await forceDisable(root)
    for (const id of FORMER_CORE_IDS) assert.equal(await isModuleEnabled(root, id), false, `${id} 应按状态停用`)
    for (const id of FORMER_CORE_IDS) {
      for (const endpoint of moduleManifest(id).endpoints) {
        assert.equal(await isModuleDisabledFor(endpoint, root), id, `${endpoint} 应受 ${id} 停用闸约束`)
      }
    }
    assert.equal(await isModuleEnabled(root, 'habits'), false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('证据②可写：daemon uiStatePut 接收四工作台停用键并原样落库', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const put = (state) => fetch(`${origin}/api/ui-state`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root, state })
  })
  try {
    const flat = await put({ 'modules.enabled.chapters': false })
    assert.equal(flat.status, 200, (await flat.text()))
    const nested = await put({ modules: { enabled: { script: false, worldbook: false, roleplay: false } } })
    assert.equal(nested.status, 200, (await nested.text()))
    const persisted = JSON.parse(await readFile(join(root, '.openstory', 'ui-state.json'), 'utf-8'))
    assert.equal(persisted['modules.enabled.chapters'], false)
    assert.deepEqual(persisted.modules.enabled, { script: false, worldbook: false, roleplay: false })
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('证据③slot 跟随模块：停用后四个归属页签消失，重新启用恢复', () => {
  for (const id of FORMER_CORE_IDS) {
    const manifest = MODULE_MANIFESTS.find((item) => item.id === id)
    assert.ok(manifest.slots.some((placement) => placement.slot === 'tab' && placement.page === id), `${id} 须声明页签位置`)
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'moduleCore'), false)
  }
  const ctx = { current: { path: '/lib' }, libDirs: ['正文', '剧本', '世界书', '习惯'], brief: null, briefGenre: null, settingsOpen: false }
  const slots = (enabled) => slotProjection(MODULE_MANIFESTS, enabled, { builtinPages: new Set(BUILTIN_PAGE_IDS) }).slots
  const empty = projectedTabDefs({ slots: slots(Object.fromEntries([...FORMER_CORE_IDS, 'habits'].map((id) => [id, false]))), ctx }).map((def) => def.view)
  for (const view of ['chapters', 'dir:剧本', 'worldbook', 'roleplay', 'habits']) assert.ok(!empty.includes(view), `${view} 应随模块停用消失`)
  const enabled = projectedTabDefs({ slots: slots(), ctx }).map((def) => def.view)
  for (const view of ['chapters', 'dir:剧本', 'worldbook', 'roleplay', 'habits']) assert.ok(enabled.includes(view), `${view} 启用后应恢复`)
})

test('证据④端点可恢复：停用回 409，重新启用回 200，稿件字节不变', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const before = await readFile(join(root, '正文', '001-风雪山神庙.md'))
  await forceDisable(root)
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const q = `root=${encodeURIComponent(root)}`
  const put = (state) => fetch(`${origin}/api/ui-state`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, state })
  })
  try {
    for (const [path, id] of [
      [`/api/chapters?${q}&dir=${encodeURIComponent('正文')}`, 'chapters'],
      [`/api/reference?${q}`, 'worldbook'],
      [`/api/deduce/sessions?${q}`, 'roleplay']
    ]) {
      const denied = await fetch(`${origin}${path}`)
      assert.equal(denied.status, 409, `${id} 停用端点应回 409`)
      const payload = await denied.json()
      assert.equal(payload.error.code, 'MODULE_DISABLED')
    }
    assert.deepEqual(await readFile(join(root, '正文', '001-风雪山神庙.md')), before, '停用不改稿件')
    const enabled = await put({ 'modules.enabled.chapters': true, 'modules.enabled.worldbook': true, 'modules.enabled.roleplay': true })
    assert.equal(enabled.status, 200, (await enabled.text()))
    const chapters = await fetch(`${origin}/api/chapters?${q}&dir=${encodeURIComponent('正文')}`)
    assert.equal(chapters.status, 200)
    const reference = await fetch(`${origin}/api/reference?${q}`)
    assert.equal(reference.status, 200)
    const sessions = await fetch(`${origin}/api/deduce/sessions?${q}`)
    assert.equal(sessions.status, 200)
    assert.deepEqual(await readFile(join(root, '正文', '001-风雪山神庙.md')), before, '重新启用也不改稿件')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('治理台：四工作台是普通可启停卡，停用后标记已停用且不出现核心徽标', () => {
  const modules = MODULE_MANIFESTS.map((manifest) => ({
    ...manifest,
    role: moduleRole(manifest),
    status: FORMER_CORE_IDS.includes(manifest.id) ? 'disabled' : 'loaded',
    enabled: !FORMER_CORE_IDS.includes(manifest.id)
  }))
  const cards = governanceModel({ modules, slots: {} }, {}, { settingsAggregation: settingsAggregationModule }).groups.flatMap((group) => group.cards)
  const byId = (id) => cards.find((card) => card.id === id)
  const htmlOf = (id) => pluginCardHtml(byId(id), { esc: (value) => String(value ?? '') })
  for (const id of FORMER_CORE_IDS) {
    assert.equal(byId(id).group, 'workbench')
    assert.equal(byId(id).summary, '已停用 · 数据与配置保留')
    assert.equal(byId(id).enabled, false)
    assert.match(htmlOf(id), /aria-checked="false"/u)
    assert.match(htmlOf(id), /off/u, '停用卡压暗')
  }
  for (const id of ['agentbar', 'library', 'deduce']) {
    assert.notEqual(byId(id).group, 'workbench', `${id} 不是工作台启停卡`)
    assert.doesNotMatch(htmlOf(id), /role="switch"/u)
  }
  assert.doesNotMatch(FORMER_CORE_IDS.map(htmlOf).join(''), /核心模块/u)
})
