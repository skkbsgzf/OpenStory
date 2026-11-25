/**
 * OS-161 子件一：习惯升格模块插件（core:false）。
 * 钉死四件事：manifest 形状与独占端点；端点停用回 MODULE_DISABLED；
 * 宿主钩子（lint／提示词注入）停用即跳过；页签可见性按模块开关（缺省全启用）。
 * 夹具一律系统临时目录，不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { HANDLERS } from '../src/api/registry.mjs'
import { moduleManifest, moduleOfEndpoint, isModuleEnabled } from '../src/protocol/modules.mjs'
import { habitLint, habitsForPrompt } from '../src/host/moduleHooks.mjs'
import { computeTabDefs, TAB_REGISTRY } from '../public/views/registry.mjs'

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'os161-habits-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await mkdir(join(root, '习惯'), { recursive: true })
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  await writeFile(join(root, '习惯', 'habits.json'), JSON.stringify({
    schema: 'openstory.habits/v1', tone: 'direct', style: '白描',
    bannedWords: ['效率'], preferredWords: [], bannedPatterns: [], bannedRhetoric: [], formulas: []
  }), 'utf-8')
  return { base, root, preferencesPath }
}

async function setEnabled(root, enabled) {
  await writeFile(join(root, '.openstory', 'ui-state.json'), JSON.stringify({ modules: { enabled: { habits: enabled } } }), 'utf-8')
}

test('manifest：habits 非核心，独占两端点，两者契约都登记 MODULE_DISABLED', () => {
  const manifest = moduleManifest('habits')
  assert.ok(manifest, 'habits manifest 必须装载')
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'core'), false)
  assert.deepEqual([...manifest.endpoints].sort(), ['habitsGet', 'habitsPut'])
  for (const endpoint of manifest.endpoints) {
    assert.ok(HANDLERS[endpoint], `${endpoint} 必须有 handler`)
    assert.ok(ENDPOINTS[endpoint].errors.includes('MODULE_DISABLED'), `${endpoint} 契约须登记 MODULE_DISABLED`)
    assert.equal(moduleOfEndpoint(endpoint), 'habits')
  }
  assert.ok(manifest.settingsHint.trim().length > 0, '无可调项也要给 settingsHint 指路')
})

test('宿主钩子：启用时 lint 命中、提示词注入；停用后两者全跳过', async () => {
  const { base, root } = await makeLibrary()
  try {
    const enabledLint = await habitLint(root, '这个问题很有效率。')
    assert.equal(enabledLint.length, 1, '启用时禁用词命中')
    assert.equal(enabledLint[0].pattern, '效率')
    assert.equal((await habitsForPrompt(root))?.style, '白描', '启用时注入习惯表')

    await setEnabled(root, false)
    assert.equal(await isModuleEnabled(root, 'habits'), false)
    assert.deepEqual(await habitLint(root, '这个问题很有效率。'), [], '停用后 lint 整段跳过')
    assert.equal(await habitsForPrompt(root), null, '停用后提示词不注入')

    // 值仍在：重新启用照常读回（停用不删数据）
    await setEnabled(root, true)
    assert.equal((await habitsForPrompt(root))?.style, '白描')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('页签可见性：ctx 没给 modulesEnabled 视为全启用；给了且缺 habits 则习惯页签消失', () => {
  const ctx = { current: { path: '/lib' }, libDirs: ['习惯', '正文'], brief: null, briefGenre: null, settingsOpen: false }
  const all = computeTabDefs(ctx).map((def) => def.view)
  assert.ok(all.includes('habits'), '缺省全启用：习惯页签在')
  const tab = TAB_REGISTRY.find((entry) => entry.id === 'habits')
  assert.equal(tab.module, 'habits', '注册表须声明 module 归属')

  const disabled = computeTabDefs({ ...ctx, modulesEnabled: new Set(['analysis', 'chapters']) }).map((def) => def.view)
  assert.ok(!disabled.includes('habits'), '显式启用集合缺 habits：页签消失')
  assert.ok(disabled.includes('write'), '其他页签不受影响')

  // 对象/数组两种形态也认（与 isModuleEnabled 的嵌套/扁平兼容同口径）
  assert.ok(!computeTabDefs({ ...ctx, modulesEnabled: ['analysis'] }).map((d) => d.view).includes('habits'))
  assert.ok(computeTabDefs({ ...ctx, modulesEnabled: { habits: true } }).map((d) => d.view).includes('habits'))
})

test('daemon：习惯模块停用 → /api/habits 两端点 MODULE_DISABLED，启用后恢复', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const env = { LOCALAPPDATA: base, APPDATA: base }
  await setEnabled(root, false)
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const q = `root=${encodeURIComponent(root)}`
  try {
    const got = await fetch(`${origin}/api/habits?${q}`)
    assert.equal(got.status, 409)
    assert.equal((await got.json()).error.code, 'MODULE_DISABLED')
    const put = await fetch(`${origin}/api/habits`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, habits: { style: '新文风' } })
    })
    assert.equal(put.status, 409)
    assert.equal((await put.json()).error.code, 'MODULE_DISABLED')

    await setEnabled(root, true)
    const ok = await (await fetch(`${origin}/api/habits?${q}`)).json()
    assert.equal(ok.ok, true)
    assert.equal(ok.habits.style, '白描', '停用期间习惯表没被删')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})
