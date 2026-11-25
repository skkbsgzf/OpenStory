/**
 * OS-161 子件二：故事源（storysource）模块插件——无独占端点，共享 fact 读端点永远属于宿主。
 * 夹具一律临时目录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { moduleManifest, moduleOfEndpoint, isModuleDisabledFor, isModuleEnabled } from '../src/protocol/modules.mjs'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { computeTabDefs } from '../public/views/registry.mjs'

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'os161-ss-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), JSON.stringify({
    modules: { enabled: { storysource: false } }
  }), 'utf-8')
  return { base, root }
}

test('manifest：storysource 非核心、零独占端点，但如实声明共享读端点', () => {
  const manifest = moduleManifest('storysource')
  assert.ok(manifest, 'storysource manifest 必须装载')
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'core'), false)
  assert.deepEqual(manifest.endpoints, [], '没有独占端点')
  assert.match(manifest.description, /factCurveGet[／/]factEntriesGet/u, 'description 要如实点名读哪些共享端点')
  assert.ok(manifest.settingsHint.trim())
})

test('共享端点永远属于宿主：停用故事源后 fact 读端点无归属、闸不住', async () => {
  const { base, root } = await makeLibrary()
  try {
    assert.equal(await isModuleEnabled(root, 'storysource'), false)
    for (const endpoint of ['factCurveGet', 'factEntriesGet', 'factBooksGet']) {
      assert.ok(ENDPOINTS[endpoint], `${endpoint} 端点应存在`)
      assert.equal(moduleOfEndpoint(endpoint), null, `${endpoint} 是共享端点，不能被任何模块独占`)
      assert.equal(await isModuleDisabledFor(endpoint, root), null, `${endpoint} 停用故事源后照常放行`)
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('页签归属：storysource 停用后故事源页签消失，其他页签不受影响', () => {
  const ctx = { current: { path: '/lib' }, libDirs: ['故事源', '正文'], brief: null, briefGenre: null, settingsOpen: false }
  const enabled = computeTabDefs(ctx).map((def) => def.view)
  assert.ok(enabled.includes('dir:故事源'), '缺省启用：故事源页签在')
  const disabled = computeTabDefs({ ...ctx, modulesEnabled: { storysource: false, habits: true, chapters: true } }).map((def) => def.view)
  assert.ok(!disabled.includes('dir:故事源'), '显式停用：故事源页签消失')
  assert.ok(disabled.includes('chapters'), '正文页签不受影响')
})
