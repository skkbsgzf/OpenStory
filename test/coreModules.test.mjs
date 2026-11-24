/**
 * OS-163（G5c）：核心模块 chapters / script 的「不可停用」四证据。
 *
 *   ① 恒启用：ui-state 即便被写成 false（扁平键／嵌套键都算），isModuleEnabled 仍 true；
 *   ② 拒写：uiStatePut 写「核心模块＝停用」回 MODULE_CORE，其余键照旧写；
 *   ③ 页签恒在：显式启用集合里没有核心模块，正文／剧本页签仍出现；
 *   ④ 端点恒通：ui-state 写 false 后正文／章节端点照常 200，不被模块闸拦。
 *
 * 夹具一律系统临时目录，绝不碰作者真库。
 * 跑法：node --test test/coreModules.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { HANDLERS } from '../src/api/registry.mjs'
import {
  CORE_MODULE_IDS, MODULE_MANIFESTS, moduleManifest, moduleOfEndpoint,
  isCoreModule, isModuleEnabled, isModuleDisabledFor
} from '../src/protocol/modules.mjs'
import {
  TAB_REGISTRY, computeTabDefs, dirTabDefs
} from '../public/views/registry.mjs'
import {
  aggregateSettings, renderSettingsModules
} from '../public/views/settingsAggregation.mjs'

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'os163-core-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.pinax'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '.pinax', 'ui-state.json'), '{}', 'utf-8')
  await writeFile(join(root, '正文', '001-风雪山神庙.md'), '# 第一章\n林冲推门而入。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ recentProjects: [{ path: root, name: '夹具库' }] }), 'utf-8')
  return { base, root, preferencesPath }
}

/** 同时写扁平键与嵌套键，模拟「有人绕过闸直接改了 ui-state」。 */
async function forceDisable(root) {
  const state = {
    'modules.enabled.chapters': false,
    'modules.enabled.script': false,
    'modules.enabled.habits': false,
    modules: { enabled: { chapters: false, script: false, habits: false } }
  }
  await writeFile(join(root, '.pinax', 'ui-state.json'), JSON.stringify(state), 'utf-8')
}

test('manifest：四个核心模块 core:true，端点归属精确；script 零独占', () => {
  // OS-163 落地 chapters/script；OS-164 再落地 worldbook/roleplay——核心恒为四枚。
  assert.deepEqual([...CORE_MODULE_IDS].sort(), ['chapters', 'roleplay', 'script', 'worldbook'])
  for (const id of CORE_MODULE_IDS) {
    assert.equal(isCoreModule(id), true)
    assert.equal(moduleManifest(id)?.core, true, `${id} 必须 core:true`)
  }
  assert.deepEqual([...moduleManifest('chapters').endpoints].sort(), [
    'chapterDelete', 'chapterGet', 'chapterPut', 'chaptersCreate', 'chaptersGet', 'chaptersRename', 'draftGet'
  ])
  assert.deepEqual([...moduleManifest('script').endpoints], [], '剧本没有独占端点（借 chapters 通道）')
  assert.deepEqual([...moduleManifest('worldbook').endpoints].sort(), [
    'referenceAbsorb', 'referenceAssetGet', 'referenceGet', 'referenceGraphGet', 'referenceNoteGet'
  ], '世界书独占五端点；生图端点不归它')
  assert.equal(moduleManifest('roleplay').endpoints.includes('deduceImage'), false, '生图端点归 comfyui')
  assert.equal(moduleOfEndpoint('deduceImage'), 'comfyui')
  assert.equal(moduleOfEndpoint('referenceImageGenerate'), 'comfyui')
  assert.ok(moduleManifest('roleplay').endpoints.includes('deduceTurn'))
  assert.ok(moduleManifest('roleplay').endpoints.includes('roleplayTurn'))
  for (const endpoint of moduleManifest('chapters').endpoints) {
    assert.ok(HANDLERS[endpoint], `${endpoint} 必须有 handler`)
    assert.ok(ENDPOINTS[endpoint], `${endpoint} 必须登记契约`)
    assert.equal(moduleOfEndpoint(endpoint), 'chapters')
  }
  // changeLog* 是 OS-89 立的跨模块修改痕迹，归宿主，不进核心模块独占表
  assert.equal(moduleOfEndpoint('changeLogGet'), null)
  assert.equal(moduleOfEndpoint('changeLogPut'), null)
  // 核心模块不可能因停用而不可达：端点契约不该有 MODULE_DISABLED
  for (const endpoint of moduleManifest('chapters').endpoints) {
    assert.ok(!ENDPOINTS[endpoint].errors.includes('MODULE_DISABLED'), `${endpoint} 不该登记不可达的 MODULE_DISABLED`)
  }
})

test('证据①恒启用：ui-state 写成 false 也拦不住，独占端点无停用闸', async () => {
  const { base, root } = await makeLibrary()
  try {
    await forceDisable(root)
    for (const id of CORE_MODULE_IDS) assert.equal(await isModuleEnabled(root, id), true, `${id} 恒启用`)
    for (const manifest of MODULE_MANIFESTS.filter((item) => item.core)) {
      for (const endpoint of manifest.endpoints) {
        assert.equal(await isModuleDisabledFor(endpoint, root), null, `${endpoint} 无停用闸`)
      }
    }
    assert.equal(await isModuleEnabled(root, 'habits'), false, '普通模块仍按 ui-state 停用（对照）')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('证据②拒写：daemon uiStatePut 写核心键 false → MODULE_CORE，其它键照旧', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const put = (state) => fetch(`${origin}/api/ui-state`, {
    method: 'PUT', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root, state })
  })
  try {
    const flat = await put({ 'modules.enabled.chapters': false })
    assert.equal(flat.status, 409)
    assert.equal((await flat.json()).error.code, 'MODULE_CORE')
    const nested = await put({ modules: { enabled: { script: false } } })
    assert.equal(nested.status, 409)
    assert.equal((await nested.json()).error.code, 'MODULE_CORE')
    for (const id of ['worldbook', 'roleplay']) {
      const flatOne = await put({ [`modules.enabled.${id}`]: false })
      assert.equal(flatOne.status, 409, `${id} 扁平键写入必须拒`)
      assert.equal((await flatOne.json()).error.code, 'MODULE_CORE')
    }

    // 拒写之后文件没被改写（核心键 false 不落盘）
    const persisted = JSON.parse(await readFile(join(root, '.pinax', 'ui-state.json'), 'utf-8'))
    assert.notEqual(persisted?.['modules.enabled.chapters'], false)

    // 普通模块停用键与其它 ui-state 键照旧写
    const ok = await put({ 'modules.enabled.habits': false, 'ui.skin': 'dark' })
    assert.equal(ok.status, 200, (await ok.text()))
    const after = JSON.parse(await readFile(join(root, '.pinax', 'ui-state.json'), 'utf-8'))
    assert.equal(after['modules.enabled.habits'], false)
    assert.equal(after['ui.skin'], 'dark')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('证据③页签恒在：显式启用集合为空也不裁四个核心页签，注册表声明模块归属', () => {
  for (const [tabId, moduleId] of [['write', 'chapters'], ['script', 'script'], ['reference', 'worldbook'], ['deduce', 'roleplay']]) {
    const tab = TAB_REGISTRY.find((entry) => entry.id === tabId)
    assert.equal(tab.module, moduleId, `${tabId} 的模块归属`)
    assert.equal(tab.moduleCore, true, `${tabId} 核心页签恒在`)
  }

  const ctx = { current: { path: '/lib' }, libDirs: ['正文', '剧本', '参考', '推演'], brief: null, briefGenre: null, settingsOpen: false }
  const empty = computeTabDefs({ ...ctx, modulesEnabled: new Set() }).map((def) => def.view)
  assert.ok(empty.includes('write'), '正文页签恒在')
  assert.ok(empty.includes('dir:剧本'), '剧本页签恒在')
  assert.ok(empty.includes('reference'), '世界书页签恒在')
  assert.ok(empty.includes('deduce'), '扮演页签恒在')
  assert.ok(!empty.includes('habits'), '普通模块仍按启用集合裁掉（对照）')
  // 目录型页签路径也要过同一条闸
  assert.ok(dirTabDefs({ libDirs: ['正文', '剧本', '习惯'], excluded: new Set(), modulesEnabled: new Set() })
    .some((def) => def.view === 'dir:剧本'), 'dirScan 分支同样恒在')
})

test('证据④端点恒通：ui-state 写 false 后正文／章节端点照常 200', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  await forceDisable(root)
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const q = `root=${encodeURIComponent(root)}`
  try {
    const chapters = await fetch(`${origin}/api/chapters?${q}&dir=${encodeURIComponent('正文')}`)
    assert.equal(chapters.status, 200)
    assert.equal((await chapters.json()).ok, true)
    const chapter = await fetch(`${origin}/api/chapter?${q}&file=${encodeURIComponent('正文/001-风雪山神庙.md')}`)
    assert.equal(chapter.status, 200)
    assert.match((await chapter.json()).text, /林冲推门而入/u)
    const reference = await fetch(`${origin}/api/reference?${q}`)
    assert.equal(reference.status, 200, '世界书独占端点恒通')
    assert.equal((await reference.json()).ok, true)
    const sessions = await fetch(`${origin}/api/deduce/sessions?${q}`)
    assert.equal(sessions.status, 200, '扮演独占端点恒通')
    assert.equal((await sessions.json()).ok, true)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('设置页：核心模块恒启用，开关 checked+disabled，带「核心模块」徽标', () => {
  const modules = MODULE_MANIFESTS.map((manifest) => ({ ...manifest }))
  const agg = aggregateSettings({ modules, enabled: { chapters: false, script: false, worldbook: false, roleplay: false }, state: {} })
  const group = agg.groups.find((item) => item.id === 'modules')
  for (const id of CORE_MODULE_IDS) {
    const card = group.modules.find((item) => item.id === id)
    assert.equal(card.core, true)
    assert.equal(card.enabled, true, `${id} 不能因 enabledMap=false 被停用`)
    assert.equal(card.editable !== false, true)
  }
  const html = renderSettingsModules(agg, { esc: (value) => String(value ?? '') })
  assert.match(html, /核心模块/u)
  for (const id of CORE_MODULE_IDS) {
    assert.match(html, new RegExp(`<input type="checkbox" checked disabled data-module-id="${id}">`, 'u'))
  }
})
