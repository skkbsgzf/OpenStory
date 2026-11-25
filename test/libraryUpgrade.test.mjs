import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import {
  LEGACY_PROJECT_SPECS, LIBRARY_UPGRADE_SPEC, WIKI_DERIVED_SCHEMA, VIEW_ID_RENAMES,
  clearLibraryUpgradeCache, ensureLibraryUpgraded, upgradeLibrary
} from '../src/protocol/libraryUpgrade.mjs'
import { TAB_REGISTRY } from '../public/views/registry.mjs'
import { parseWorldbookEntryFile } from '../src/modules/library/textUtil.mjs'

const NOW = new Date('2026-11-25T12:34:56.789Z')

async function put(root, path, content) {
  const abs = join(root, path)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, content, 'utf-8')
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-'))
  await put(root, '.pinax/project.json', `${JSON.stringify({
    spec: 'pinax-project@3', schemaVersion: 3, projectId: 'proj_old', name: '旧库', kind: 'novel',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    carriers: { primary: 'pinax.carrier.novel', enabled: ['pinax.carrier.novel'], revision: 1 }
  }, null, 2)}\n`)
  await put(root, '.pinax/ui-state.json', JSON.stringify({ view: 'dir:拆解', tabHidden: ['dir:拆解'], typography: { ui: 1, doc: 17 } }))
  await put(root, '.pinax/drafts/推演/r1.json', JSON.stringify({ module: '推演', id: 'r1', text: '参考/拆解/推演 是正文，不改' }))
  await put(root, '.pinax/log/参考/2026-01.jsonl', '{"module":"参考","file":"参考/a.md"}\n坏行原样保留\n')
  await put(root, '.pinax/sync-state.json', JSON.stringify({ files: { '拆解/a.json': { hash: 'x' } } }))
  await put(root, '.openstory/existing.json', '{"path":"拆解/a.json"}\n')
  await put(root, '参考/same.md', '旧参考同名\n')
  await put(root, '参考/sub/same.md', '旧子目录\n')
  await put(root, '世界书/same.md', '新世界书同名\n')
  await put(root, '世界书/sub/same.md', '新子目录同名\n')
  await put(root, '拆解/book.json', JSON.stringify({ book: { id: 'book' }, entries: [] }))
  await put(root, '拆解/book.wiki.json', JSON.stringify({ derivedFrom: { schema: 'pinax-wiki-derived@1', factRevision: 1 }, summary: '旧派生' }))
  await put(root, '推演/book/session.json', JSON.stringify({ path: '推演/book/归档/第1章.md', archives: [{ path: '推演/book/归档/第1章.md' }] }))
  await put(root, '导出/shuihu.jsonl', '{"schema":"pedia/v1"}\n')
  await put(root, '正文/001.md', '正文\n')
  return root
}

async function snapshot(root, omitHistory = false) {
  const hash = createHash('sha256')
  async function walk(abs) {
    const entries = await readdir(abs, { withFileTypes: true })
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (omitHistory && entry.name === '.history') continue
      const path = join(abs, entry.name)
      const rel = relative(root, path).split(sep).join('/')
      hash.update(`${entry.isDirectory() ? 'd' : 'f'}:${rel}\n`)
      if (entry.isDirectory()) await walk(path)
      else hash.update(await readFile(path))
    }
  }
  await walk(root)
  return hash.digest('hex')
}

async function withFixture(run) {
  const root = await fixture()
  try { return await run(root) } finally { await rm(root, { recursive: true, force: true }) }
}

test('OS-172 成功迁移：新目录、新谱系、备份、退役、冲突后缀与内部路径一次完成', async () => {
  await withFixture(async (root) => {
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.upgraded, true)
    assert.equal(result.report.conflicts.length, 2)
    assert.ok(result.report.conflicts.every((item) => item.to.includes('.upgrade-2026-11-25T12-34-56-789Z')))
    for (const dir of ['世界书', '故事源', '扮演', '导入导出', '.openstory']) {
      assert.equal((await readdir(join(root, dir))).length > 0, true, `${dir} 应有内容`)
    }
    for (const dir of ['.pinax', '参考', '拆解', '推演', '导出']) {
      await assert.rejects(readdir(join(root, dir)), { code: 'ENOENT' }, `${dir} 不应再作为活目录存在`)
    }
    assert.ok((await readdir(root)).some((name) => name.startsWith('.pinax.retired-')))
    assert.ok((await readdir(root)).some((name) => name.startsWith('参考.retired-')))
    assert.ok((await readdir(root)).some((name) => name.startsWith('拆解.retired-')))
    assert.ok((await readdir(root)).some((name) => name.startsWith('推演.retired-')))
    assert.ok((await readdir(root)).some((name) => name.startsWith('导出.retired-')))
    assert.equal(await readFile(join(root, '导入导出/shuihu.jsonl'), 'utf-8'), '{"schema":"pedia/v1"}\n')
    const project = JSON.parse(await readFile(join(root, '.openstory/project.json'), 'utf-8'))
    assert.equal(project.spec, 'openstory-project@4')
    assert.equal(project.schemaVersion, 4)
    assert.equal(project.carriers.primary, 'openstory.carrier.novel')
    assert.deepEqual(project.carriers.enabled, ['openstory.carrier.novel'])
    const wiki = JSON.parse(await readFile(join(root, '故事源/book.wiki.json'), 'utf-8'))
    assert.equal(wiki.derivedFrom.schema, WIKI_DERIVED_SCHEMA)
    const ui = JSON.parse(await readFile(join(root, '.openstory/ui-state.json'), 'utf-8'))
    assert.equal(ui.view, 'dir:故事源')
    assert.deepEqual(ui.tabHidden, ['dir:故事源'])
    const syncState = JSON.parse(await readFile(join(root, '.openstory/sync-state.json'), 'utf-8'))
    assert.equal(syncState.files['故事源/a.json'].hash, 'x')
    assert.equal(syncState.files['拆解/a.json'], undefined)
    const draft = JSON.parse(await readFile(join(root, '.openstory/drafts/扮演/r1.json'), 'utf-8'))
    assert.equal(draft.module, '扮演')
    assert.equal(draft.text, '参考/拆解/推演 是正文，不改')
    const session = JSON.parse(await readFile(join(root, '扮演/book/session.json'), 'utf-8'))
    assert.equal(session.path, '扮演/book/归档/第1章.md')
    assert.equal(session.archives[0].path, '扮演/book/归档/第1章.md')
    assert.equal((await readdir(join(root, '.openstory/log/世界书'))).length, 1)
    const migratedLog = await readFile(join(root, '.openstory/log/世界书/2026-01.jsonl'), 'utf-8')
    assert.equal(migratedLog, '{"module":"世界书","file":"世界书/a.md"}\n坏行原样保留\n')
    const upgradeLog = JSON.parse((await readFile(join(root, '.openstory/log/库升级/2026-11.jsonl'), 'utf-8')).trim())
    assert.equal(upgradeLog.module, '库升级')
    assert.equal(upgradeLog.file, '.openstory/upgrade.json')
    assert.equal(upgradeLog.meta.backup, '.history/upgrade-2026-11-25T12-34-56-789Z')
    const marker = JSON.parse(await readFile(join(root, '.openstory/upgrade.json'), 'utf-8'))
    assert.equal(marker.spec, LIBRARY_UPGRADE_SPEC)
    assert.equal(marker.backup, '.history/upgrade-2026-11-25T12-34-56-789Z')
    assert.equal((await readdir(join(root, marker.backup))).includes('backup-manifest.json'), true)
    assert.equal(await readFile(join(root, marker.backup, '世界书/same.md'), 'utf-8'), '新世界书同名\n')
    const backupManifest = JSON.parse(await readFile(join(root, marker.backup, 'backup-manifest.json'), 'utf-8'))
    assert.ok(backupManifest.copied.includes('世界书'))
    assert.ok(backupManifest.copied.includes('.openstory'))
    assert.equal(await readFile(join(root, marker.backup, '.openstory/existing.json'), 'utf-8'), '{"path":"拆解/a.json"}\n')
    assert.equal(JSON.parse(await readFile(join(root, '.openstory/existing.json'), 'utf-8')).path, '故事源/a.json')
  })
  // 断言等价加强既有测试，不新增 test() 计数（全仓数字锚不动）。
  await checkOs190IdMapping()
  await checkOs188aPathAnchoring()
  await checkOs188aRelationKey()
  await checkOs188aResidue()
})

test('OS-172 只有旧业务目录的库也会创建运行态目录，失败时逐字节回滚', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-dirs-'))
  try {
    await put(root, '拆解/book.json', '{"book":{"id":"book"},"entries":[]}\n')
    const before = await snapshot(root, true)
    const failed = await upgradeLibrary(root, { now: NOW, deps: { failAt: 'write:upgrade.json' } })
    assert.equal(failed.ok, false)
    assert.equal(failed.rolledBack, true)
    assert.equal(await snapshot(root, true), before)
    await assert.rejects(readdir(join(root, '.openstory')), { code: 'ENOENT' })
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal((await readdir(join(root, '故事源'))).includes('book.json'), true)
    assert.equal((await readdir(join(root, '.openstory'))).includes('upgrade.json'), true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OS-172 重复打开幂等：不重复备份、不改写、不再退役', async () => {
  await withFixture(async (root) => {
    assert.equal((await upgradeLibrary(root, { now: NOW })).upgraded, true)
    const before = await snapshot(root)
    const again = await upgradeLibrary(root, { now: new Date('2026-11-26T00:00:00.000Z') })
    assert.equal(again.ok, true)
    assert.equal(again.upgraded, false)
    assert.equal(await snapshot(root), before)
  })
})

test('OS-172 新布局库直接通过，不制造升级备份', async () => {
  await withFixture(async (root) => {
    await put(root, '.openstory/project.json', JSON.stringify({
      spec: 'openstory-project@4', schemaVersion: 4, projectId: 'proj_new', name: '新库', kind: 'novel',
      carriers: { primary: 'openstory.carrier.novel', enabled: ['openstory.carrier.novel'], revision: 1 }
    }))
    await rm(join(root, '.pinax'), { recursive: true, force: true })
    for (const dir of ['参考', '拆解', '推演', '导出']) await rm(join(root, dir), { recursive: true, force: true })
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true)
    assert.equal(result.upgraded, false)
    await assert.rejects(readdir(join(root, '.history')), { code: 'ENOENT' })
  })
})

test('OS-172 状态文件路径键合并冲突时拒绝静默覆盖并原样回滚', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-key-conflict-'))
  try {
    await put(root, '.pinax/project.json', JSON.stringify({ spec: 'pinax-project@3', carriers: { primary: 'pinax.carrier.novel' } }))
    await put(root, '.pinax/sync-state.json', JSON.stringify({
      files: { '拆解/a.json': { hash: 'old' }, '故事源/a.json': { hash: 'new' } }
    }))
    const before = await snapshot(root, true)
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, false)
    assert.equal(result.phase, 'stored-paths')
    assert.equal(result.rolledBack, true)
    assert.match(result.message, /升级路径冲突/u)
    assert.equal(await snapshot(root, true), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OS-172 JSONL 状态路径键合并冲突时同样拒绝静默覆盖并原样回滚', async () => {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-jsonl-conflict-'))
  try {
    await put(root, '.pinax/project.json', JSON.stringify({ spec: 'pinax-project@3', carriers: { primary: 'pinax.carrier.novel' } }))
    await put(root, '.pinax/log/参考/2026-01.jsonl', `${JSON.stringify({
      files: { '拆解/a.json': { hash: 'old' }, '故事源/a.json': { hash: 'new' } }
    })}\n`)
    const before = await snapshot(root, true)
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, false)
    assert.equal(result.phase, 'stored-paths')
    assert.equal(result.rolledBack, true)
    assert.match(result.message, /升级路径冲突/u)
    assert.equal(await snapshot(root, true), before)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('OS-172 每个关键步骤注入失败都原样回滚', async () => {
  const failures = [
    'backup:.pinax',
    'move:.pinax/project.json',
    'retire:.pinax',
    'move:参考/same.md',
    'move:参考/sub/same.md',
    'retire:参考',
    'copy:拆解',
    'retire:拆解',
    'copy:推演',
    'retire:推演',
    'copy:导出',
    'retire:导出',
    'copy:.openstory/log/参考',
    'retire:.openstory/log/参考',
    'copy:.openstory/drafts/推演',
    'retire:.openstory/drafts/推演',
    'rewrite:.openstory/project.json',
    'rewrite:故事源/book.wiki.json',
    'rewrite:.openstory/ui-state.json',
    'rewrite:扮演/book/session.json',
    'write:upgrade.json',
    'write:upgrade-log'
  ]
  for (const failAt of failures) {
    await withFixture(async (root) => {
      const before = await snapshot(root, true)
      const result = await upgradeLibrary(root, { now: NOW, deps: { failAt } })
      assert.equal(result.ok, false, `${failAt} 应失败`)
      assert.equal(result.rolledBack, true, `${failAt}: ${JSON.stringify(result)}`)
      assert.equal(await snapshot(root, true), before, `${failAt} 回滚后库内容必须逐字节一致`)
      assert.equal((await readdir(join(root, '.pinax'))).includes('project.json'), true)
    })
  }
})

test('OS-172 备份阶段失败不触碰原库；坏 project.json 在迁移阶段失败并回滚', async () => {
  await withFixture(async (root) => {
    const before = await snapshot(root, true)
    const backupFailure = await upgradeLibrary(root, { now: NOW, deps: { failAt: 'backup:.pinax' } })
    assert.equal(backupFailure.ok, false)
    assert.equal(backupFailure.rolledBack, true)
    assert.equal(await snapshot(root, true), before)
    await assert.rejects(readdir(join(root, '.history')), { code: 'ENOENT' })
    await put(root, '.pinax/project.json', '{坏档')
    const malformedBefore = await snapshot(root, true)
    const malformed = await upgradeLibrary(root, { now: NOW })
    assert.equal(malformed.ok, false)
    assert.equal(malformed.phase, 'project-marker')
    assert.equal(malformed.rolledBack, true)
    assert.equal(await snapshot(root, true), malformedBefore)
  })
})

test('OS-172 读侧兼容旧 spec 列表，daemon 入口串行且缓存成功结果', async () => {
  assert.deepEqual(LEGACY_PROJECT_SPECS, ['pinax-project@1', 'pinax-project@2', 'pinax-project@3'])
  clearLibraryUpgradeCache()
  await withFixture(async (root) => {
    const [first, second] = await Promise.all([ensureLibraryUpgraded(root), ensureLibraryUpgraded(root)])
    assert.equal(first.ok, true)
    assert.equal(second.ok, true)
    assert.equal(first.upgraded, true)
    assert.equal(second.upgraded, true)
    const before = await snapshot(root)
    assert.equal((await ensureLibraryUpgraded(root)).upgraded, false)
    assert.equal(await snapshot(root), before)
  })
  clearLibraryUpgradeCache()
})

/** OS-190：旧 id 直接映射到新 id（扁平/嵌套键都认，重复打开幂等）。并入既有测试计数。 */
async function checkOs190IdMapping() {
  // OS-190a：升级目标值必须是前端认得的视图键。OS-198 起 TAB_REGISTRY 不再存目录，
  // 目录型视图（dir:剧本/故事源/日志）本身就在 view 列里，直接取即可。
  const views = new Set(TAB_REGISTRY.map((entry) => entry.view))
  for (const [from, to] of Object.entries(VIEW_ID_RENAMES)) {
    assert.ok(views.has(to), `VIEW_ID_RENAMES[${from}]＝${to} 不在前端视图集合`)
  }
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-os190-'))
  try {
    await minimalLegacy(root)
    await put(root, '.pinax/ui-state.json', JSON.stringify({
      view: 'write',
      tabHidden: ['reference', 'dir:推演', 'storySource'],
      selectedTab: 'deduce',
      'modules.enabled.comfyui': false,
      'modules.enabled.kb': false,
      'modules.settings.comfyui.image.backend': 'comfyui',
      'modules.settings.kb.kb.baseUrl': 'http://127.0.0.1:8080'
    }))
    await put(root, '.pinax/plugins.json', JSON.stringify({
      modules: {
        enabled: { comfyui: false, kb: true },
        settings: { comfyui: { 'image.backend': 'comfyui' }, kb: { 'kb.baseUrl': 'http://127.0.0.1:8080' } }
      }
    }))
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true, JSON.stringify(result))

    const ui = JSON.parse(await readFile(join(root, '.openstory/ui-state.json'), 'utf-8'))
    // 视图键直接映射到新页面 id
    assert.equal(ui.view, 'chapters')
    assert.deepEqual(ui.tabHidden, ['worldbook', 'roleplay', 'dir:故事源'])
    assert.equal(ui.selectedTab, 'roleplay')
    // 扁平启停/设置键
    assert.equal(ui['modules.enabled.imagegen'], false)
    assert.equal(ui['modules.enabled.knowledge'], false)
    assert.equal(ui['modules.settings.imagegen.image.backend'], 'comfyui')
    assert.equal(ui['modules.settings.knowledge.kb.baseUrl'], 'http://127.0.0.1:8080')
    assert.equal(ui['modules.enabled.comfyui'], undefined)
    assert.equal(ui['modules.enabled.kb'], undefined)
    assert.equal(ui['modules.settings.comfyui.image.backend'], undefined)
    assert.equal(ui['modules.settings.kb.kb.baseUrl'], undefined)
    // 嵌套启停/设置键
    const plugins = JSON.parse(await readFile(join(root, '.openstory/plugins.json'), 'utf-8'))
    assert.equal(plugins.modules.enabled.imagegen, false)
    assert.equal(plugins.modules.enabled.knowledge, true)
    assert.equal(plugins.modules.settings.imagegen['image.backend'], 'comfyui')
    assert.equal(plugins.modules.settings.knowledge['kb.baseUrl'], 'http://127.0.0.1:8080')
    assert.equal(plugins.modules.enabled.comfyui, undefined)
    assert.equal(plugins.modules.settings.kb, undefined)

    const before = await snapshot(root)
    const again = await upgradeLibrary(root, { now: new Date('2026-11-26T00:00:00.000Z') })
    assert.equal(again.ok, true)
    assert.equal(again.upgraded, false)
    assert.equal(await snapshot(root), before, '重复打开幂等')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/* ---------- OS-188a：路径锚定、旧键抬升、残留归档与解析失败报告 ---------- */

/** 最小旧库夹具：只放升级判定所需的 project.json，其余用例各自写。 */
async function minimalLegacy(root) {
  await put(root, '.pinax/project.json', JSON.stringify({
    spec: 'pinax-project@3', schemaVersion: 3, name: '锚定夹具',
    carriers: { primary: 'pinax.carrier.novel', enabled: ['pinax.carrier.novel'] }
  }))
}

/** OS-188a 三组断言并入既有测试：不新增 test() 计数，避免牵动全仓数字锚文档。 */
async function checkOs188aPathAnchoring() {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-anchor-'))
  try {
    await minimalLegacy(root)
    await put(root, '.pinax/ui-state.json', JSON.stringify({
      view: 'dir:参考',
      file: '推演/素材/a.png',
      nested: { file: '世界书/参考/人物/a.md', path: '扮演/推演/素材/b.png' }
    }))
    await put(root, '.pinax/sync-state.json', JSON.stringify({
      files: {
        '推演/素材/a.png': { hash: 'a' },
        '参考/人物/a.md': { hash: 'b' },
        '世界书/参考/人物/a.md': { hash: 'c' },
        '扮演/推演/素材/b.png': { hash: 'd' },
        '.pinax/drafts/推演/r1.json': { hash: 'e' },
        '.pinax/log/参考/2026-01.jsonl': { hash: 'f' }
      }
    }))
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true, JSON.stringify(result))

    // 值：首段改，中间同名段不动；视图键直接映射到新页面 id（OS-190）。
    const ui = JSON.parse(await readFile(join(root, '.openstory/ui-state.json'), 'utf-8'))
    assert.equal(ui.view, 'worldbook')
    assert.equal(ui.file, '扮演/素材/a.png')
    assert.equal(ui.nested.file, '世界书/参考/人物/a.md')
    assert.equal(ui.nested.path, '扮演/推演/素材/b.png')

    // 对象键：同样三条规则。
    const sync = JSON.parse(await readFile(join(root, '.openstory/sync-state.json'), 'utf-8'))
    assert.equal(sync.files['扮演/素材/a.png']?.hash, 'a')
    assert.equal(sync.files['世界书/人物/a.md']?.hash, 'b')
    assert.equal(sync.files['世界书/参考/人物/a.md']?.hash, 'c')
    assert.equal(sync.files['扮演/推演/素材/b.png']?.hash, 'd')
    assert.equal(sync.files['.openstory/drafts/扮演/r1.json']?.hash, 'e')
    assert.equal(sync.files['.openstory/log/世界书/2026-01.jsonl']?.hash, 'f')
    assert.equal(Object.keys(sync.files).length, 6, '不该多出或丢失键')
    for (const oldKey of ['推演/素材/a.png', '参考/人物/a.md', '.pinax/drafts/推演/r1.json', '.pinax/log/参考/2026-01.jsonl']) {
      assert.equal(sync.files[oldKey], undefined, `旧键 ${oldKey} 不该留下`)
    }
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function checkOs188aRelationKey() {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-key-'))
  try {
    await minimalLegacy(root)
    const original = '---\nschemaVersion: 1\nid: e1\nname: 测试\npinaxRelationExtensions:\n  characters: [甲]\n---\n正文第一行\n\n正文第二行\n'
    const lifted = original.replace('pinaxRelationExtensions:', 'relationExtensions:')
    await put(root, '世界书/e1.md', original)

    // 读侧：旧键不认（留在 extra），新键认（并进 relations）。
    const before = parseWorldbookEntryFile(original)
    assert.equal(before.ok, true)
    assert.deepEqual(before.entry.relations.characters, [])
    assert.deepEqual(before.entry.extra.pinaxRelationExtensions, { characters: ['甲'] })
    assert.deepEqual(parseWorldbookEntryFile(lifted).entry.relations.characters, ['甲'])

    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.deepEqual(result.report.frontmatter, ['世界书/e1.md'])
    assert.equal(await readFile(join(root, '世界书/e1.md'), 'utf-8'), lifted, '除键名那一行外必须逐字节不变')
    assert.deepEqual(parseWorldbookEntryFile(await readFile(join(root, '世界书/e1.md'), 'utf-8')).entry.relations.characters, ['甲'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

async function checkOs188aResidue() {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-residue-'))
  try {
    await minimalLegacy(root)
    await put(root, '.pinax-tmp-abc', '残留')
    await put(root, '世界书/.pinax-tmp-xyz', '嵌套残留')
    await put(root, '.pinax/bad.json', '{坏档')
    await put(root, '.pinax/log/参考/2026-01.jsonl', '{"module":"参考"}\n坏行\n')

    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.upgraded, true)
    assert.deepEqual([...result.report.tmpResidue].sort(), ['.pinax-tmp-abc', '世界书/.pinax-tmp-xyz'])
    assert.equal(existsSync(join(root, '.pinax-tmp-abc')), false)
    assert.equal(existsSync(join(root, '世界书/.pinax-tmp-xyz')), false)
    assert.equal(await readFile(join(root, result.report.backup, 'tmp-residue/.pinax-tmp-abc'), 'utf-8'), '残留')
    assert.equal(await readFile(join(root, result.report.backup, 'tmp-residue/世界书/.pinax-tmp-xyz'), 'utf-8'), '嵌套残留')

    assert.ok(result.report.skipped.some((item) => item.file === '.openstory/bad.json'), '坏 JSON 必须入报告')
    assert.ok(result.report.skipped.some((item) => item.file === '.openstory/log/世界书/2026-01.jsonl' && item.line === 2),
      `坏 JSONL 行号必须入报告：${JSON.stringify(result.report.skipped)}`)
    assert.equal(await readFile(join(root, '.openstory/log/世界书/2026-01.jsonl'), 'utf-8'), '{"module":"世界书"}\n坏行\n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}
