/**
 * OS-167 库清单自持与旧 Pinax 清单导入（node:test）。
 *
 * 纪律：临时 LOCALAPPDATA ＋ 临时库目录；不碰真实院子与作者真库。
 * 钉死五件事：新院 libraries.json 读写、坏档不覆盖、旧清单只读扫描/勾选导入、
 * 旧环境变量不回落、--root 显式授权不依赖清单。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createRootAllowlist } from '../src/host/authorize.mjs'
import {
  LIBRARY_MANIFEST_FILE,
  defaultLibraryManifestPath,
  importPinaxLibraries,
  inspectPinaxLibraries,
  pinaxPreferencesPath,
  readLibraryManifest,
  writeLibraryManifest
} from '../src/protocol/libraryManifest.mjs'
import { pinaxImportSectionHtml } from '../public/views/settingsAggregation.mjs'

function fixture(tag) {
  const base = mkdtempSync(join(tmpdir(), `os167-${tag}-`))
  return {
    base,
    env: { LOCALAPPDATA: base, APPDATA: '' },
    manifest: join(base, 'OpenStory', LIBRARY_MANIFEST_FILE),
    oldList: pinaxPreferencesPath({ LOCALAPPDATA: base, APPDATA: '' }),
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
    mkdirSync(join(root, '.pinax'), { recursive: true })
    writeFileSync(join(root, '.pinax', 'project.json'), '{"spec":"pinax-project@3"}', 'utf-8')
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
      { path: `${root}/`, name: '重复路径', addedAt: '2026-11-25T00:00:00.000Z', source: 'imported-pinax' }
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
    const { registerLibrary } = await import('../src/modules/library/libraryManage.mjs')
    const rejected = await registerLibrary(f.manifest, root, '长夜')
    assert.equal(rejected.ok, false)
    assert.equal(readFileSync(f.manifest, 'utf-8'), '{ broken')
  } finally { f.cleanup() }
})

test('旧清单扫描：三项体检，缺目录/无 project.json 标灰，不写任何文件', async () => {
  const f = fixture('scan')
  const good = makeLibrary(f.base, '正常库')
  const noProject = makeLibrary(f.base, '无工程库', false)
  const missing = join(f.base, '已搬走的库')
  try {
    seedOldList(f, [
      { path: good, name: '正常库', at: '2026-11-20T00:00:00.000Z' },
      { path: missing, name: '已搬走的库', at: '2026-11-21T00:00:00.000Z' },
      { path: noProject, name: '无工程库', at: '2026-11-22T00:00:00.000Z' }
    ])
    const before = readFileSync(f.oldList, 'utf-8')
    const scanned = inspectPinaxLibraries(f.env)
    assert.equal(scanned.libraries.length, 3)
    assert.deepEqual(scanned.libraries.map((item) => item.ok), [true, false, false])
    assert.equal(scanned.libraries[1].reason, '目录不存在')
    assert.equal(scanned.libraries[2].reason, '没有 .pinax/project.json')
    assert.equal(readFileSync(f.oldList, 'utf-8'), before)
    assert.equal(existsSync(f.manifest), false)
  } finally { f.cleanup() }
})

test('勾选导入：只写新院清单且 source=imported-pinax，拒绝项不进清单，旧院零改写', async () => {
  const f = fixture('import')
  const good = makeLibrary(f.base, '正常库')
  const noProject = makeLibrary(f.base, '无工程库', false)
  try {
    seedOldList(f, [
      { path: good, name: '正常库', at: '2026-11-20T00:00:00.000Z' },
      { path: noProject, name: '无工程库', at: '2026-11-22T00:00:00.000Z' }
    ])
    const before = readFileSync(f.oldList, 'utf-8')
    const result = await importPinaxLibraries({ paths: [good, noProject], env: f.env })
    assert.equal(result.ok, true)
    assert.equal(result.imported.length, 1)
    assert.deepEqual(result.rejected, [{ path: noProject, reason: '没有 .pinax/project.json' }])
    const doc = JSON.parse(readFileSync(f.manifest, 'utf-8'))
    assert.equal(doc.libraries.length, 1)
    assert.equal(doc.libraries[0].source, 'imported-pinax')
    assert.equal(doc.libraries[0].addedAt, '2026-11-20T00:00:00.000Z')
    assert.equal(readFileSync(f.oldList, 'utf-8'), before)
    // 重复导入不新增条目
    const again = await importPinaxLibraries({ paths: [good], env: f.env })
    assert.equal(again.ok, true)
    assert.equal(JSON.parse(readFileSync(f.manifest, 'utf-8')).libraries.length, 1)
  } finally { f.cleanup() }
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

test('设置页纯视图：合法项可勾选，非法项标灰带原因，零存储零 DOM', () => {
  const html = pinaxImportSectionHtml({
    esc: (v) => String(v ?? ''),
    scan: {
      source: 'C:/tmp/PinaxNext/next-preferences.json',
      libraries: [
        { path: 'C:/好库', name: '好库', ok: true, reason: '' },
        { path: 'C:/坏库', name: '坏库', ok: false, reason: '目录不存在' }
      ],
      selected: ['C:/好库'],
      warnings: [],
      result: null
    }
  })
  assert.match(html, /data-pinax-path="C:\/好库" checked/u)
  assert.match(html, /data-pinax-path="C:\/坏库" disabled/u)
  assert.match(html, /目录不存在/u)
  assert.match(html, /data-action="pinax-import-apply"/u)
  assert.doesNotMatch(html, /localStorage|sessionStorage|document\./u)
})
