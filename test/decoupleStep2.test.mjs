/**
 * OS-124 解耦② 护栏（node:test，零依赖）——建库自持。
 *
 * 金样（golden）＝OS-124 批内、删除 vendor 之前先调内核建库捕获的冻结值：
 *   createRegistry/createCarrierRegistry（core/index.mjs ＋ core/carrierBootstrap.mjs）
 *   ＋ createProject/initBareProject（core/pinax/next/project/createProject.mjs，
 *   Pinax-next@70a4f44 逐字 vendor）在临时目录建样例库，取
 *   `.openstory/project.json` 内容＋目录清单为金样；随后载体注册体系随本批删除，
 *   金样常量即内核输出的冻结值。projectId/createdAt/updatedAt 每次不同，
 *   其余字段与目录清单深度相等；project.json 的字节布局（字段序、2 空格缩进、
 *   尾随换行）一并锁死——这是与 Pinax 桌面端双向兼容的落盘契约。
 *
 *   · projectDoc.createProject（novel／script 两主载体）建出的库与金样深度相等；
 *   · projectDoc.initBareProject（裸库）与金样深度相等；
 *   · libraryManage.createLibrary（daemon 同一条链）与金样深度相等；
 *   · 本仓载体表/注册表/退化闭包（requires 均为 [] → 恒等）的行为锁。
 *
 * 跑法：node --test openstory/test/decoupleStep2.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createCarrierRegistry,
  createProject,
  createRegistry,
  initBareProject,
  PROJECT_DOC_FIELDS,
  PROJECT_KINDS,
  resolveClosure
} from '../src/modules/storage/projectDoc.mjs'
import { createLibrary } from '../src/host/libraryManage.mjs'

/* ---------- 金样（内核冻结输出，2026-11-22T17:36Z 捕获于 vendor@70a4f44） ---------- */

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const PROJECT_ID_RE = /^proj_[0-9a-z]+$/

const GOLDEN = Object.freeze({
  novel: Object.freeze({
    name: '长夜',
    doc: Object.freeze({
      spec: 'openstory-project@4',
      schemaVersion: 4,
      name: '长夜',
      kind: 'novel',
      carriers: Object.freeze({ primary: 'openstory.carrier.novel', enabled: Object.freeze(['openstory.carrier.novel']), revision: 1 })
    }),
    enabled: Object.freeze(['openstory.carrier.novel']),
    dirs: Object.freeze({
      // OS-172：新库只建正名目录；四个退场目录不再随新库落盘。
      skeleton: Object.freeze(['正文', '世界书', '日志']),
      pluginRegistered: Object.freeze([])
    }),
    listing: Object.freeze(['.openstory', '世界书', '日志', '正文']),
    openstory: Object.freeze(['project.json', 'proposals', 'state'])
  }),
  script: Object.freeze({
    name: '短剧',
    doc: Object.freeze({
      spec: 'openstory-project@4',
      schemaVersion: 4,
      name: '短剧',
      kind: 'screenplay',
      carriers: Object.freeze({ primary: 'openstory.carrier.script', enabled: Object.freeze(['openstory.carrier.script']), revision: 1 })
    }),
    enabled: Object.freeze(['openstory.carrier.script']),
    dirs: Object.freeze({
      // OS-172：剧本库同样只建正名目录。
      skeleton: Object.freeze(['剧本', '人物', '场景', '世界书', '日志']),
      pluginRegistered: Object.freeze([])
    }),
    listing: Object.freeze(['.openstory', '世界书', '人物', '剧本', '场景', '日志']),
    openstory: Object.freeze(['project.json', 'proposals', 'state'])
  }),
  bare: Object.freeze({
    name: '裸库',
    doc: Object.freeze({
      spec: 'openstory-project@4',
      schemaVersion: 4,
      name: '裸库',
      kind: null,
      carriers: Object.freeze({ primary: null, enabled: Object.freeze([]), revision: 0 })
    }),
    enabled: Object.freeze([]),
    needsPrimary: true,
    listing: Object.freeze(['.openstory']),
    openstory: Object.freeze(['project.json', 'proposals', 'state'])
  })
})

const sorted = (names) => [...names].sort()

/** project.json 字节＋值双锁：字段序、carriers 键序、缩进与尾随换行、金样深度相等。 */
async function assertGoldenMarker(root, golden) {
  const raw = await readFile(join(root, '.openstory', 'project.json'), 'utf-8')
  const parsed = JSON.parse(raw)
  assert.deepEqual(Object.keys(parsed), PROJECT_DOC_FIELDS, '字段顺序是落盘契约的一部分')
  assert.deepEqual(Object.keys(parsed.carriers), ['primary', 'enabled', 'revision'], 'carriers 键序是落盘契约的一部分')
  assert.equal(raw, `${JSON.stringify(parsed, null, 2)}\n`, 'project.json 必须保持 2 空格缩进＋尾随换行的原子写布局')
  const { projectId, createdAt, updatedAt, ...rest } = parsed
  assert.match(projectId, PROJECT_ID_RE, 'projectId 形如 proj_<base36>')
  assert.match(createdAt, ISO_RE)
  assert.match(updatedAt, ISO_RE)
  assert.deepEqual(rest, golden.doc, 'project.json 内容（除每次不同的 projectId/createdAt/updatedAt）与内核金样深度相等')
  return parsed
}

/** 整库对照：目录清单＋.openstory 元数据目录＋project.json。 */
async function assertGoldenLibrary(root, golden) {
  assert.deepEqual(sorted(await readdir(root)), golden.listing, '库根目录清单与内核金样一致')
  assert.deepEqual(sorted(await readdir(join(root, '.openstory'))), golden.openstory, '.openstory 元数据目录与内核金样一致')
  await assertGoldenMarker(root, golden)
}

/* ---------- 金样自检：常量与骨架表互相钉住 ---------- */

test('金样自检：冻结常量与 PROJECT_KINDS/PROJECT_DOC_FIELDS 互钉', () => {
  assert.equal(GOLDEN.novel.doc.kind, 'novel')
  assert.deepEqual(GOLDEN.novel.dirs.skeleton, [...PROJECT_KINDS.novel], 'novel 骨架＝PROJECT_KINDS.novel')
  assert.deepEqual(GOLDEN.script.dirs.skeleton, [...PROJECT_KINDS.screenplay], 'script 骨架＝PROJECT_KINDS.screenplay')
  assert.deepEqual(PROJECT_DOC_FIELDS, ['spec', 'schemaVersion', 'projectId', 'name', 'kind', 'createdAt', 'updatedAt', 'carriers'])
  for (const g of [GOLDEN.novel, GOLDEN.script, GOLDEN.bare]) {
    assert.equal(g.doc.spec, 'openstory-project@4')
    assert.equal(g.doc.schemaVersion, 4)
    assert.equal(g.doc.carriers.primary === null, g.doc.kind === null, '裸库才允许 kind 空')
  }
})

/* ---------- projectDoc 建库 vs 金样 ---------- */

test('projectDoc.createProject（novel 主载体）建出的库与内核金样深度相等', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os124-novel-'))
  try {
    const { registry } = await createCarrierRegistry()
    const root = join(base, '长夜')
    const result = await createProject({ root, name: '长夜', primaryCarrier: 'openstory.carrier.novel', registry })
    assert.equal(result.ok, true, `建库失败：${JSON.stringify(result.error ?? result)}`)
    const g = GOLDEN.novel
    assert.deepEqual(result.value.dirs, { skeleton: [...g.dirs.skeleton], pluginRegistered: [] })
    assert.deepEqual(result.value.enabled, [...g.enabled])
    assert.equal(result.value.root, root)
    await assertGoldenLibrary(root, g)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('projectDoc.createProject（script 主载体）建出的库与内核金样深度相等', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os124-script-'))
  try {
    const { registry } = await createCarrierRegistry()
    const root = join(base, '短剧')
    const result = await createProject({ root, name: '短剧', primaryCarrier: 'openstory.carrier.script', registry })
    assert.equal(result.ok, true, `建库失败：${JSON.stringify(result.error ?? result)}`)
    const g = GOLDEN.script
    assert.deepEqual(result.value.dirs, { skeleton: [...g.dirs.skeleton], pluginRegistered: [] })
    assert.deepEqual(result.value.enabled, [...g.enabled])
    await assertGoldenLibrary(root, g)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('projectDoc.initBareProject 建出的裸库与内核金样深度相等', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os124-bare-'))
  try {
    const root = join(base, '裸库')
    const result = await initBareProject({ root, name: '裸库' })
    assert.equal(result.ok, true, `建裸库失败：${JSON.stringify(result.error ?? result)}`)
    const g = GOLDEN.bare
    assert.equal(result.value.needsPrimary, true)
    assert.deepEqual(result.value.dirs, { skeleton: [], pluginRegistered: [] })
    await assertGoldenLibrary(root, g)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- daemon 同链（libraryManage.createLibrary → projectDoc） ---------- */

test('libraryManage.createLibrary 走本仓 projectDoc 链，建出的库与内核金样深度相等', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os124-manage-'))
  try {
    const created = await createLibrary({
      path: join(base, '长夜'),
      name: '长夜',
      primaryCarrier: 'openstory.carrier.novel',
      preferencesPath: join(base, 'libraries.json')
    })
    assert.equal(created.ok, true, `createLibrary 失败：${JSON.stringify(created.error ?? created)}`)
    const g = GOLDEN.novel
    assert.deepEqual(created.enabled, [...g.enabled])
    assert.equal(created.needsPrimary, false)
    const { projectId, createdAt, updatedAt, ...rest } = created.document
    assert.match(projectId, PROJECT_ID_RE)
    assert.match(createdAt, ISO_RE)
    assert.match(updatedAt, ISO_RE)
    assert.deepEqual(rest, g.doc)
    await assertGoldenLibrary(created.root, g)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 载体表／注册表／退化闭包的行为锁 ---------- */

test('载体表与注册表：两主载体逐字装表；坏清单拒装并记 rejected；重复 id 拒装', async () => {
  const { registry, installed, skipped } = await createCarrierRegistry()
  assert.deepEqual(installed, ['openstory.carrier.novel', 'openstory.carrier.script'])
  assert.deepEqual(skipped, [])
  const novel = registry.get('openstory.carrier.novel')
  assert.equal(novel.title, '小说')
  assert.equal(novel.primary.projectKind, 'novel')
  assert.deepEqual(novel.dataDirs, { manuscript: '正文' })
  assert.deepEqual(novel.requires, [], '两载体 requires 均为 []（vendor 清单逐字一致）')
  const script = registry.get('openstory.carrier.script')
  assert.equal(script.title, '剧本')
  assert.equal(script.primary.projectKind, 'screenplay')
  assert.deepEqual(script.dataDirs, { script: '剧本' })
  assert.equal(registry.get('openstory.carrier.comic'), null, 'vendor 其余九载体不在本仓载体表')
  assert.deepEqual(registry.list().map((item) => item.id), ['openstory.carrier.novel', 'openstory.carrier.script'])
  assert.deepEqual(registry.rejected, [])

  // 本仓 createRegistry 的拒装语义（与 vendor「装载失败不抛异常、只记 rejected」对齐）
  const local = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const noId = local.install({ title: '无名' }, {}, {})
  assert.equal(noId.ok, false)
  const badKind = local.install({ id: 'openstory.carrier.x', title: 'x', primary: { projectKind: 'poetry' }, dataDirs: { a: '诗' }, requires: [] }, {}, {})
  assert.equal(badKind.ok, false)
  const badDirs = local.install({ id: 'openstory.carrier.y', title: 'y', primary: { projectKind: 'novel' }, dataDirs: { a: '子/目录' }, requires: [] }, {}, {})
  assert.equal(badDirs.ok, false)
  const okInstall = local.install({ id: 'openstory.carrier.novel', title: '小说', primary: { projectKind: 'novel' }, dataDirs: { manuscript: '正文' }, requires: [] }, {}, {})
  assert.equal(okInstall.ok, true)
  const dup = local.install({ id: 'openstory.carrier.novel', title: '小说', primary: { projectKind: 'novel' }, dataDirs: { manuscript: '正文' }, requires: [] }, {}, {})
  assert.equal(dup.ok, false, '重复 id 拒装')
  assert.equal(local.rejected.length, 4, '四次拒装都进 rejected')
  assert.deepEqual(local.rejected.map((item) => item.stage), ['manifest', 'manifest', 'manifest', 'duplicate'])
})

test('退化闭包：requires 全 [] → enabled＝种子去重；未装种子记 unresolvable（requiredBy null）', async () => {
  const { registry } = await createCarrierRegistry()
  const manifests = registry.manifests()
  const one = resolveClosure(manifests, ['openstory.carrier.novel'])
  assert.deepEqual(one.enabled, ['openstory.carrier.novel'])
  assert.deepEqual(one.unresolvable, [])
  const dup = resolveClosure(manifests, ['openstory.carrier.script', 'openstory.carrier.script'])
  assert.deepEqual(dup.enabled, ['openstory.carrier.script'], '重复种子去重')
  const both = resolveClosure(manifests, ['openstory.carrier.novel', 'openstory.carrier.script'])
  assert.deepEqual(both.enabled, ['openstory.carrier.novel', 'openstory.carrier.script'], '按首次出现序')
  const missing = resolveClosure(manifests, ['openstory.carrier.comic'])
  assert.deepEqual(missing.enabled, [])
  assert.equal(missing.unresolvable.length, 1)
  assert.equal(missing.unresolvable[0].id, 'openstory.carrier.comic')
  assert.equal(missing.unresolvable[0].requiredBy, null, '种子缺失按 vendor 语义记 requiredBy null')
  assert.equal(missing.unresolvable[0].reason, '未安装')
})
