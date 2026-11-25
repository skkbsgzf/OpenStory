/**
 * OS-167 / OS-172 库清单自持与旧导入通道退役（node:test）。
 *
 * 纪律：临时 LOCALAPPDATA ＋ 临时库目录；不碰真实院子与作者真库。
 * 钉死：新院 libraries.json 读写、坏档不覆盖、旧清单只读兼容、旧环境变量不回落、
 * --root 显式授权不依赖清单，以及旧清单扫描/导入端点与设置入口已彻底退役。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { createRootAllowlist } from '../src/host/authorize.mjs'
import {
  LIBRARY_MANIFEST_FILE,
  defaultLibraryManifestPath,
  readLibraryManifest,
  writeLibraryManifest
} from '../src/modules/storage/libraryManifest.mjs'

function fixture(tag) {
  const base = mkdtempSync(join(tmpdir(), `os172-manifest-${tag}-`))
  return {
    base,
    env: { LOCALAPPDATA: base, APPDATA: '' },
    manifest: join(base, 'OpenStory', LIBRARY_MANIFEST_FILE),
    oldList: join(base, 'PinaxNext', 'next-preferences.json'),
    cleanup: () => rmSync(base, { recursive: true, force: true })
  }
}

function seedOldList(f, rows) {
  mkdirSync(dirname(f.oldList), { recursive: true })
  writeFileSync(f.oldList, JSON.stringify({ recentProjects: rows }), 'utf-8')
}

function makeLibrary(base, name, withProject = true) {
  const root = join(base, name)
  mkdirSync(root, { recursive: true })
  if (withProject) {
    mkdirSync(join(root, '.openstory'), { recursive: true })
    writeFileSync(join(root, '.openstory', 'project.json'), '{"spec":"openstory-project@4"}', 'utf-8')
  }
  return root
}

test('空环境：默认落新院 libraries.json，空清单＋可观测 warning，不读旧清单', () => {
  const f = fixture('empty')
  try {
    assert.equal(defaultLibraryManifestPath(f.env).replaceAll('\\', '/'), f.manifest.replaceAll('\\', '/'))
    const read = readLibraryManifest({ env: f.env })
    assert.deepEqual(read.libraries, [])
    assert.equal(read.warnings[0].code, 'PREFERENCES_MISSING')
    assert.equal(existsSync(f.manifest), false)
  } finally { f.cleanup() }
})

test('写读往返：schemaVersion/libraries/source/addedAt 逐字段保真，去重按路径', async () => {
  const f = fixture('roundtrip')
  const root = makeLibrary(f.base, '长夜')
  try {
    const written = await writeLibraryManifest(f.manifest, [
      { path: root, name: '长夜', addedAt: '2026-11-24T00:00:00.000Z', source: 'openstory' },
      { path: `${root}/`, name: '重复路径', addedAt: '2026-11-25T00:00:00.000Z', source: 'imported' }
    ])
    assert.equal(written.ok, true)
    assert.equal(written.libraries.length, 1)
    const doc = JSON.parse(readFileSync(f.manifest, 'utf-8'))
    assert.deepEqual(Object.keys(doc).sort(), ['libraries', 'schemaVersion'])
    assert.equal(doc.schemaVersion, 1)
    assert.equal(doc.libraries[0].source, 'openstory')
    assert.equal(doc.libraries[0].addedAt, '2026-11-24T00:00:00.000Z')
    const read = readLibraryManifest({ env: f.env })
    assert.equal(read.libraries[0].path.replaceAll('\\', '/'), root.replaceAll('\\', '/'))
    assert.equal(read.legacy, false)
  } finally { f.cleanup() }
})

test('坏档：如实 warning，登记拒绝且不覆盖原文', async () => {
  const f = fixture('corrupt')
  const root = makeLibrary(f.base, '长夜')
  try {
    mkdirSync(join(f.base, 'OpenStory'), { recursive: true })
    writeFileSync(f.manifest, '{ broken', 'utf-8')
    const read = readLibraryManifest({ env: f.env })
    assert.equal(read.warnings[0].code, 'PREFERENCES_CORRUPT')
    assert.deepEqual(read.libraries, [])
    const { registerLibrary } = await import('../src/host/libraryManage.mjs')
    const rejected = await registerLibrary(f.manifest, root, '长夜')
    assert.equal(rejected.ok, false)
    assert.equal(readFileSync(f.manifest, 'utf-8'), '{ broken')
  } finally { f.cleanup() }
})

test('旧清单只读兼容：显式路径可读并归一 source，绝不自动导入或写回', async () => {
  const f = fixture('legacy-read')
  const root = makeLibrary(f.base, '旧库')
  try {
    seedOldList(f, [{ path: root, name: '旧库', at: '2026-11-20T00:00:00.000Z' }])
    const before = readFileSync(f.oldList, 'utf-8')
    const read = readLibraryManifest({ preferencesPath: f.oldList })
    assert.equal(read.ok, true)
    assert.equal(read.legacy, true)
    assert.equal(read.libraries.length, 1)
    assert.equal(read.libraries[0].source, 'imported')
    assert.ok(read.warnings.some((warning) => warning.code === 'PREFERENCES_LEGACY_READONLY'))
    assert.equal(readFileSync(f.oldList, 'utf-8'), before)
    assert.equal(existsSync(f.manifest), false)
  } finally { f.cleanup() }
})

test('旧导入通道退役：端点、协议函数、前端状态与设置入口均不存在', () => {
  assert.equal(Object.hasOwn(ENDPOINTS, 'pinaxListGet'), false)
  assert.equal(Object.hasOwn(ENDPOINTS, 'pinaxListImport'), false)
  const protocol = readFileSync(new URL('../src/modules/storage/libraryManifest.mjs', import.meta.url), 'utf-8')
  const app = readFileSync(new URL('../public/app.js', import.meta.url), 'utf-8')
  const settings = readFileSync(new URL('../public/views/settingsAggregation.mjs', import.meta.url), 'utf-8')
  for (const symbol of ['inspectPinaxLibraries', 'importPinaxLibraries', 'pinaxPreferencesPath']) {
    assert.doesNotMatch(protocol, new RegExp(`export\\s+(?:async\\s+)?function\\s+${symbol}`, 'u'))
  }
  assert.doesNotMatch(app, /pinaxImport|scanPinaxList|applyPinaxImport|pinax-import-/u)
  assert.doesNotMatch(settings, /pinaxImportSectionHtml|pinax-import-/u)
})

test('不回落旧环境变量：PINAX_OS_PREFERENCES 指向旧清单也按空清单回', () => {
  const f = fixture('legacy-env')
  try {
    const root = makeLibrary(f.base, '旧库')
    seedOldList(f, [{ path: root, name: '旧库' }])
    const env = { LOCALAPPDATA: f.base, APPDATA: '', PINAX_OS_PREFERENCES: f.oldList }
    const read = readLibraryManifest({ env })
    assert.equal(read.libraries.length, 0)
    assert.equal(read.path.replaceAll('\\', '/'), f.manifest.replaceAll('\\', '/'))
  } finally { f.cleanup() }
})

test('--root 显式授权不依赖清单；写通道拒绝 next-preferences.json', async () => {
  const f = fixture('root')
  const root = makeLibrary(f.base, '显式库')
  try {
    const allowlist = createRootAllowlist([], [root])
    assert.equal(allowlist.isAllowed(root), true)
    const denied = await writeLibraryManifest(f.oldList, [{ path: root, name: '显式库' }])
    assert.equal(denied.ok, false)
    assert.match(denied.message, /不写回/u)
    assert.equal(existsSync(f.oldList), false)
  } finally { f.cleanup() }
})

test('设置页不再渲染旧清单导入表单，也不使用浏览器存储', () => {
  const settings = readFileSync(new URL('../public/views/settingsAggregation.mjs', import.meta.url), 'utf-8')
  assert.doesNotMatch(settings, /data-pinax-path|pinax-import-(?:scan|apply)|localStorage|sessionStorage/u)
})
