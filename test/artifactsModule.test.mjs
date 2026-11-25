/**
 * OS-161 子件三：产物中心（artifacts）模块插件——独占 artifactsGet，停用回 MODULE_DISABLED，
 * 纯视图迁出。夹具一律临时目录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { moduleManifest, moduleOfEndpoint, isModuleDisabledFor } from '../src/protocol/modules.mjs'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { HANDLERS } from '../src/api/registry.mjs'
import { computeTabDefs } from '../public/views/registry.mjs'
import { artifactsHtml } from '../public/views/workbenchViews.mjs'

function esc(value) {
  return String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
    .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')
}

test('manifest：artifacts 非核心，独占 artifactsGet，契约登记 MODULE_DISABLED', () => {
  const manifest = moduleManifest('artifacts')
  assert.ok(manifest)
  assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'core'), false)
  assert.deepEqual(manifest.endpoints, ['artifactsGet'])
  assert.equal(moduleOfEndpoint('artifactsGet'), 'artifacts')
  assert.ok(ENDPOINTS.artifactsGet.errors.includes('MODULE_DISABLED'))
  assert.ok(HANDLERS.artifactsGet)
  assert.ok(manifest.settingsHint.trim())
})

test('daemon：停用后 /api/artifacts 409 MODULE_DISABLED，启用恢复', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os161-artifacts-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '正文', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  const writeState = (enabled) => writeFile(join(root, '.openstory', 'ui-state.json'),
    JSON.stringify({ modules: { enabled: { artifacts: enabled } } }), 'utf-8')
  await writeState(false)
  assert.equal(await isModuleDisabledFor('artifactsGet', root), 'artifacts')
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const q = `root=${encodeURIComponent(root)}`
  try {
    const got = await fetch(`${origin}/api/artifacts?${q}`)
    assert.equal(got.status, 409)
    assert.equal((await got.json()).error.code, 'MODULE_DISABLED')
    await writeState(true)
    const ok = await (await fetch(`${origin}/api/artifacts?${q}`)).json()
    assert.equal(ok.ok, true)
    assert.ok(Array.isArray(ok.groups))
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('页签归属：artifacts 停用后产物页签消失', () => {
  const ctx = { current: { path: '/lib' }, libDirs: [], brief: null, briefGenre: null, settingsOpen: false }
  assert.ok(computeTabDefs(ctx).map((d) => d.view).includes('artifacts'))
  const disabled = computeTabDefs({ ...ctx, modulesEnabled: { artifacts: false, chapters: true } }).map((d) => d.view)
  assert.ok(!disabled.includes('artifacts'))
  assert.ok(disabled.includes('write'), '其他页签不受影响')
})

test('artifactsHtml 金样：纯函数固定夹具 → 稳定 HTML，无副作用', () => {
  const inventory = {
    loading: false, previewFile: '正文/ch1.md', previewText: '正文内容', previewLoading: false,
    groups: [{ dir: '正文', files: [{ file: '正文/ch1.md', name: 'ch1.md', size: 6, mtime: '2026-11-24T00:00:00Z' }], history: [] }],
    totals: { files: 1, bytes: 6, histories: 0 }, error: ''
  }
  const tools = {
    groupLabel: (dir) => dir, formatBytes: (n) => `${n}B`,
    formatAt: (t) => String(t), flowError: (m) => (m ? `<div class="error-box">${esc(m)}</div>` : ''), esc
  }
  const html = artifactsHtml({ current: { name: '夹具库' }, inventory, ...tools })
  assert.match(html, /<h1>产物<\/h1>/u)
  assert.match(html, /data-action="artifact-preview"/u)
  assert.match(html, /ch1\.md/u)
  assert.equal(html, artifactsHtml({ current: { name: '夹具库' }, inventory, ...tools }))
  assert.match(artifactsHtml({ current: null, inventory, ...tools }), /先选一个库/u)
})
