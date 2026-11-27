import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { canonicalKnowledgeRoot, normalizeDocumentRef, resolveKnowledgeDocument } from '../src/modules/knowledge-base/knowledgePaths.mjs'
import { validateKnowledgeBaseManifest } from '../src/modules/knowledge-base/knowledgeManifest.mjs'
import { contentRevision, loadKnowledgeManifest, scanKnowledgeDocuments } from '../src/modules/knowledge-base/knowledgeScanner.mjs'
import { deriveKnowledgeIndexState } from '../src/modules/knowledge-base/knowledgeIndexState.mjs'
import {
  createEmptyKnowledgeLibrary, knowledgeLibrariesPath, normalizeKnowledgeLibraries,
  previewKnowledgeLibrary, publicKnowledgeLibrary, readKnowledgeLibraries,
  registerKnowledgeLibrary, setKnowledgeLibraryState
} from '../src/modules/knowledge-base/knowledgeLibraryStore.mjs'

const manifest = {
  schema: 'openstory.knowledge-base@1', schemaVersion: 1, id: 'fixture', name: '夹具库', version: '1.0.0',
  vendor: 'OpenStory', license: 'CC-BY-4.0', documentEntry: 'docs/index.md', formats: ['.md'],
  exclude: ['drafts/**', '.git/**'], retrievalDefaults: { topK: 6, minScore: 0.3, budgetChars: 6000 },
  tagMap: {}, nodeMap: {}, edgeMap: {}
}
const env = () => ({ LOCALAPPDATA: process.env.LOCALAPPDATA })

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-knowledge-'))
  const root = join(base, 'kb')
  const local = join(base, 'localapp')
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'knowledge.base.json'), JSON.stringify(manifest))
  await writeFile(join(root, 'docs/index.md'), '---\ntags: [索引]\n---\n# 索引\n\n知识库入口。')
  await writeFile(join(root, 'docs/剑修.md'), '# 剑修\n\n以剑入道。 #人物/剑修 见 [[丹方]]')
  await writeFile(join(root, 'docs/丹方.md'), '# 丹方\n\n回气丹。')
  await writeFile(join(root, 'docs/忽略.md'), '# 忽略\n\n不应出现。')
  return { base, root, local, testEnv: { LOCALAPPDATA: local, APPDATA: local } }
}

async function treeDigest(root) {
  const rows = []
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) await walk(path)
      else rows.push([path.slice(root.length), await readFile(path)])
    }
  }
  await walk(root)
  return rows
}

test('manifest：合法形状通过，凭据/路径/错误 schema 拒绝', () => {
  assert.equal(validateKnowledgeBaseManifest(manifest).ok, true)
  assert.equal(validateKnowledgeBaseManifest({ ...manifest, apiKey: 'oc_sk_secret' }).ok, false)
  assert.equal(validateKnowledgeBaseManifest({ ...manifest, documentEntry: '../secret.md' }).ok, false)
  assert.equal(validateKnowledgeBaseManifest({ ...manifest, schema: 'other' }).ok, false)
})

test('documentRef：绝对路径/盘符/..//symlink 拒绝', async () => {
  for (const ref of ['../x.md', '/x.md', 'C:/x.md', 'a//b.md', 'a\\..\\b.md', 'x.txt']) assert.equal(normalizeDocumentRef(ref).ok, false)
  const { base, root } = await fixture()
  try {
    assert.equal((await resolveKnowledgeDocument(root, 'docs/剑修.md')).ok, true)
    const outside = join(base, 'outside.md')
    await writeFile(outside, '# 外面')
    await symlink(outside, join(root, 'docs/link.md'), 'file')
    assert.equal((await resolveKnowledgeDocument(root, 'docs/link.md')).code, 'PATH_ESCAPE')
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('扫描：tags/双链/反链/revision；源树字节不变', async () => {
  const { base, root } = await fixture()
  try {
    const before = await treeDigest(root)
    const loaded = await loadKnowledgeManifest(root)
    assert.equal(loaded.ok, true)
    const scanned = await scanKnowledgeDocuments(root, loaded.manifest, { exclude: ['docs/忽略.md'] })
    assert.equal(scanned.ok, true)
    assert.equal(scanned.files.length, 3)
    assert.deepEqual(scanned.files.find((file) => file.ref === 'docs/剑修.md').tags, ['人物/剑修'])
    assert.equal(scanned.backlinks['docs/丹方.md'].linked[0].ref, 'docs/剑修.md')
    assert.equal(scanned.revision, contentRevision(scanned.files))
    assert.deepEqual(await treeDigest(root), before)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('清单：preview 零写入、confirm 登记、启停/切换/定制与 active 不变量', async () => {
  const { base, root, testEnv } = await fixture()
  try {
    const before = await treeDigest(root)
    const preview = await previewKnowledgeLibrary({ root }, testEnv)
    assert.equal(preview.ok, true)
    const path = knowledgeLibrariesPath(testEnv)
    await assert.rejects(readFile(path), { code: 'ENOENT' })
    assert.equal((await registerKnowledgeLibrary({ previewId: preview.previewId, confirm: false }, testEnv)).code, 'CONFIRM_REQUIRED')
    const registered = await registerKnowledgeLibrary({ previewId: preview.previewId, confirm: true }, testEnv)
    assert.equal(registered.ok, true)
    let table = await readKnowledgeLibraries(testEnv)
    assert.equal(table.table.activeLibraryId, 'fixture')
    assert.equal(table.table.libraries.length, 1)
    assert.equal(publicKnowledgeLibrary(table.table.libraries[0]).root, undefined)
    await setKnowledgeLibraryState('fixture', { enabled: false }, testEnv)
    table = await readKnowledgeLibraries(testEnv)
    assert.equal(table.table.activeLibraryId, null)
    await setKnowledgeLibraryState('fixture', { enabled: true, activate: true, customization: { displayName: '修仙', retrieval: { topK: 9 } } }, testEnv)
    table = await readKnowledgeLibraries(testEnv)
    assert.equal(table.table.activeLibraryId, 'fixture')
    assert.equal(table.table.libraries[0].customization.displayName, '修仙')
    assert.equal(table.table.libraries[0].customization.retrieval.topK, 9)
    assert.deepEqual(await treeDigest(root), before)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('预览后内容漂移拒绝；坏清单不覆盖', async () => {
  const { base, root, testEnv } = await fixture()
  try {
    const preview = await previewKnowledgeLibrary({ root }, testEnv)
    await writeFile(join(root, 'docs/剑修.md'), '# 剑修\n\n改过了。')
    assert.equal((await registerKnowledgeLibrary({ previewId: preview.previewId, confirm: true }, testEnv)).code, 'PLAN_STALE')
    const path = knowledgeLibrariesPath(testEnv)
    await mkdir(join(testEnv.LOCALAPPDATA, 'OpenStory', 'openstory'), { recursive: true })
    await writeFile(path, '{bad json')
    const before = await readFile(path)
    assert.equal((await readKnowledgeLibraries(testEnv)).code, 'KNOWLEDGE_LIBRARY_CORRUPT')
    assert.equal((await createEmptyKnowledgeLibrary({ id: 'empty', root }, testEnv)).code, 'KNOWLEDGE_LIBRARY_CORRUPT')
    assert.deepEqual(await readFile(path), before)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('索引五态：never/fresh/stale/failed/runtime missing', () => {
  assert.equal(deriveKnowledgeIndexState().status, 'never-indexed')
  const index = { status: 'fresh', contentRevision: 'r1', indexHash: 'h1', runtimeVersion: 'v1', builtAt: '', error: null }
  assert.equal(deriveKnowledgeIndexState(index, { contentRevision: 'r1', runtimeVersion: 'v1' }).status, 'fresh')
  assert.equal(deriveKnowledgeIndexState(index, { contentRevision: 'r2', runtimeVersion: 'v1' }).status, 'stale')
  assert.equal(deriveKnowledgeIndexState(index, { contentRevision: 'r1', runtimeVersion: 'v2' }).status, 'stale')
  assert.equal(deriveKnowledgeIndexState(index, { contentRevision: 'r1', runtimeAvailable: false }).status, 'stale')
  assert.equal(deriveKnowledgeIndexState({ ...index, status: 'failed' }, { contentRevision: 'r1', runtimeAvailable: false }).status, 'failed')
})

test('清单 shape：重复 id/根与悬空 active 拒绝', () => {
  const record = { id: 'a', root: 'D:/KB', realRoot: 'D:/KB', enabled: true }
  assert.equal(normalizeKnowledgeLibraries({ schema: 'openstory.knowledge-library@1', schemaVersion: 1, activeLibraryId: null, libraries: [record, { ...record, root: 'd:/kb' }] }).ok, false)
  assert.equal(normalizeKnowledgeLibraries({ schema: 'openstory.knowledge-library@1', schemaVersion: 1, activeLibraryId: 'missing', libraries: [] }).ok, false)
})

void env
void canonicalKnowledgeRoot
