/**
 * OS-167 / OS-172 / OS-189 库清单自持与旧形状退役（node:test）。
 *
 * 纪律：临时 LOCALAPPDATA ＋ 临时库目录；不碰真实院子与作者真库。
 * 钉死：新院 libraries.json 读写、坏档不覆盖、非本产品形状只读告警、旧环境变量不回落、
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
  const base = mkdtempSync(join(tmpdir(), `os189-manifest-${tag}-`))
  return {
    base,
    env: { LOCALAPPDATA: base, APPDATA: '' },
    manifest: join(base, 'OpenStory', LIBRARY_MANIFEST_FILE),
    otherList: join(base, 'OpenStory', 'other-list.json'),
    cleanup: () => rmSync(base, { recursive: true, force: true })
  }
}

function seedOtherShape(f, rows) {
  mkdirSync(dirname(f.otherList), { recursive: true })
  writeFileSync(f.otherList, JSON.stringify({ recentProjects: rows }), 'utf-8')
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

test('空环境：默认落新院 libraries.json，空清单＋可观测 warning', () => {
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
    assert.equal(read.legacy, undefined, '旧 legacy 字段已退役')
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

test('反向守卫：旧形状 {recentProjects:[…]} 回空清单＋PREFERENCES_SHAPE，不写回', async () => {
  const f = fixture('old-shape')
  const root = makeLibrary(f.base, '旧库')
  try {
    seedOtherShape(f, [{ path: root, name: '旧库', at: '2026-11-20T00:00:00.000Z' }])
    const before = readFileSync(f.otherList, 'utf-8')
    const read = readLibraryManifest({ preferencesPath: f.otherList })
    assert.equal(read.ok, true)
    assert.deepEqual(read.libraries, [])
    assert.ok(read.warnings.some((warning) => warning.code === 'PREFERENCES_SHAPE'))
    assert.equal(readFileSync(f.otherList, 'utf-8'), before)
    assert.equal(existsSync(f.manifest), false, '不自动导入到新清单')

    const { registerLibrary } = await import('../src/host/libraryManage.mjs')
    const rejected = await registerLibrary(f.otherList, root, '旧库')
    assert.equal(rejected.ok, false)
    assert.equal(readFileSync(f.otherList, 'utf-8'), before)
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

test('不回落旧环境变量：PINAX_OS_PREFERENCES 指向旧形状文件也按空清单回', () => {
  const f = fixture('legacy-env')
  const root = makeLibrary(f.base, '旧库')
  try {
    seedOtherShape(f, [{ path: root, name: '旧库' }])
    const env = { LOCALAPPDATA: f.base, APPDATA: '', PINAX_OS_PREFERENCES: f.otherList }
    const read = readLibraryManifest({ env })
    assert.equal(read.libraries.length, 0)
    assert.equal(read.path.replaceAll('\\', '/'), f.manifest.replaceAll('\\', '/'))
  } finally { f.cleanup() }
})

test('反向守卫：目标文件存在且不是本产品形状 → 拒绝覆盖，原文不变（不认文件名）', async () => {
  const f = fixture('write-protect')
  const root = makeLibrary(f.base, '显式库')
  try {
    mkdirSync(dirname(f.otherList), { recursive: true })
    writeFileSync(f.otherList, JSON.stringify({ recentProjects: [{ path: root }] }), 'utf-8')
    const denied = await writeLibraryManifest(f.otherList, [{ path: root, name: '显式库' }])
    assert.equal(denied.ok, false)
    assert.match(denied.message, /不是本产品库清单形状/u)
    assert.equal(readFileSync(f.otherList, 'utf-8'), JSON.stringify({ recentProjects: [{ path: root }] }))

    const allowlist = createRootAllowlist([], [root])
    assert.equal(allowlist.isAllowed(root), true)
  } finally { f.cleanup() }
})

test('同文件名但内容为本产品形状 → 允许追加，证明写保护只看内容不看文件名', async () => {
  const f = fixture('shape-based')
  const root = makeLibrary(f.base, '显式库')
  try {
    mkdirSync(dirname(f.otherList), { recursive: true })
    writeFileSync(f.otherList, JSON.stringify({ schemaVersion: 1, libraries: [] }), 'utf-8')
    const written = await writeLibraryManifest(f.otherList, [{ path: root, name: '显式库' }])
    assert.equal(written.ok, true)
    assert.equal(written.libraries.length, 1)
    assert.equal(readFileSync(f.otherList, 'utf-8'), `${JSON.stringify(written.document, null, 2)}\n`)
  } finally { f.cleanup() }
})

test('设置页不再渲染旧清单导入表单，也不使用浏览器存储', () => {
  const settings = readFileSync(new URL('../public/views/settingsAggregation.mjs', import.meta.url), 'utf-8')
  assert.doesNotMatch(settings, /data-pinax-path|pinax-import-(?:scan|apply)|localStorage|sessionStorage/u)
})
