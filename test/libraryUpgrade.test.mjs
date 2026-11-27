import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import {
  LEGACY_PROJECT_SPECS, LIBRARY_UPGRADE_SPEC, WIKI_DERIVED_SCHEMA, VIEW_ID_RENAMES,
  buildSelfPlan, clearLibraryUpgradeCache, diagnoseLibraryUpgrade, ensureLibraryUpgraded, upgradeLibrary
} from '../src/protocol/libraryUpgrade.mjs'
import { diffPlanBindings, semanticPlan } from '../src/protocol/upgradePlan.mjs'
import {
  applyUpgradePlan, buildLibraryUpgradePlan, clearUpgradePlans, rememberUpgradePlan, resetLibraryMigrations
} from '../src/host/libraryMigrations.mjs'
import { startDaemon } from '../src/host/daemon.mjs'
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
  await checkOs220PreviewZeroWrite()
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

/**
 * OS-220：只读预览零写入、计划项齐全、planId 可复现且绑定文件哈希。
 * 并入既有 test() 计数（不新增 test 条目），断言全部在临时夹具库上跑。
 */
async function checkOs220PreviewZeroWrite() {
  const root = await mkdtemp(join(tmpdir(), 'openstory-upgrade-preview-'))
  try {
    await put(root, '.pinax/project.json', JSON.stringify({
      spec: 'pinax-project@3', schemaVersion: 3, name: '预览夹具',
      carriers: { primary: 'pinax.carrier.novel', enabled: ['pinax.carrier.novel'] }
    }))
    await put(root, '.pinax/ui-state.json', JSON.stringify({ view: 'dir:拆解', tabHidden: ['dir:拆解'] }))
    await put(root, '参考/same.md', '旧参考同名\n')
    await put(root, '世界书/same.md', '新世界书同名\n')
    await put(root, '拆解/book.wiki.json', JSON.stringify({ derivedFrom: { schema: 'pinax-wiki-derived@1' } }))
    await put(root, '.pinax/log/参考/2026-01.jsonl', '{"module":"参考"}\n坏行\n')
    await put(root, '.pinax/bad.json', '{坏档')
    await put(root, '.pinax-tmp-abc', '残留')
    await put(root, '世界书/.pinax-tmp-xyz', '嵌套残留')

    // ① 预览前后整库文件树与字节哈希完全一致（连 .history/.openstory 都没被建出来）。
    const before = await snapshot(root)
    const section = await diagnoseLibraryUpgrade(root, { now: NOW })
    assert.equal(await snapshot(root), before, '预览必须零写入：整库字节哈希不变')
    assert.equal(existsSync(join(root, '.history')), false, '预览不得创建 .history')
    assert.equal(existsSync(join(root, '.openstory', 'upgrade.json')), false, '预览不得创建升级标记')

    // ② 旧目录/同名冲突/坏 JSON/坏 JSONL 行都有计划项。
    assert.equal(section.needed, true)
    assert.ok(section.operations.some((item) => item.kind === 'copy-tree' && item.from === '.pinax' && item.to === '.openstory'))
    assert.ok(section.operations.some((item) => item.kind === 'retire' && item.from === '参考'))
    assert.equal(section.conflicts.length, 1)
    assert.equal(section.conflicts[0].from, '参考/same.md')
    assert.equal(section.conflicts[0].to, '世界书/same.upgrade-2026-11-25T12-34-56-789Z.md')
    assert.equal(section.conflicts[0].blocking, false)
    assert.ok(section.rewrites.some((item) => item.file === '.openstory/project.json' && item.kind === 'project-marker'))
    assert.ok(section.skipped.some((item) => item.file === '.openstory/bad.json'))
    // 计划里的路径与真实升级报告同一口径（升级后的库内路径）。
    assert.ok(section.skipped.some((item) => item.file === '.openstory/log/世界书/2026-01.jsonl' && item.line === 2),
      `坏 JSONL 行号必须入计划：${JSON.stringify(section.skipped)}`)
    assert.equal(section.backup.scope.includes('.pinax'), true)
    assert.equal(section.backup.predictedPath.startsWith('.history/upgrade-'), true)
    // `.pinax-tmp-*` 残留也必须先入计划（真实升级会迁进备份 tmp-residue/）。
    assert.deepEqual(
      section.operations.filter((item) => item.kind === 'archive-tmp-residue').map((item) => item.from).sort(),
      ['.pinax-tmp-abc', '世界书/.pinax-tmp-xyz']
    )

    // ③ planId 稳定可复现：换预览时刻、换进程内缓存都得到同一 planId。
    const planA = buildSelfPlan(root, section, NOW)
    const sectionB = await diagnoseLibraryUpgrade(root, { now: new Date('2027-03-04T05:06:07.008Z') })
    const planB = buildSelfPlan(root, sectionB, new Date('2027-03-04T05:06:07.008Z'))
    assert.equal(planA.planId, planB.planId, '同一输入（排除时间戳）必须同一 planId')
    assert.deepEqual(semanticPlan(planA.sections), semanticPlan(planB.sections))
    assert.match(planA.planId, /^plan-[0-9a-f]{32}$/u)

    // ④ planId 绑定受影响文件哈希：改一个被计划改写的文件 → 漂移可检出、planId 变。
    const actual = Object.fromEntries((section.bindings ?? []).map((item) => [item.id, item.sha256]))
    assert.ok(section.bindings.length > 0, '计划必须带文件摘要绑定')
    assert.deepEqual(diffPlanBindings(planA, actual), [])
    const projectBinding = section.bindings.find((item) => item.path === '.pinax/project.json')
    assert.ok(projectBinding, '项目标记必须进绑定')
    await put(root, '.pinax/project.json', JSON.stringify({
      spec: 'pinax-project@3', schemaVersion: 3, name: '预览夹具（作者改过）',
      carriers: { primary: 'pinax.carrier.novel', enabled: ['pinax.carrier.novel'] }
    }))
    const drifted = diffPlanBindings(planA, Object.fromEntries(
      (await diagnoseLibraryUpgrade(root, { now: NOW })).bindings.map((item) => [item.id, item.sha256])
    ))
    assert.equal(drifted.some((item) => item.id === projectBinding.id && item.reason === 'changed'), true,
      `改稿后必须检出漂移：${JSON.stringify(drifted)}`)
    assert.notEqual(buildSelfPlan(root, await diagnoseLibraryUpgrade(root, { now: NOW }), NOW).planId, planA.planId)
    assert.equal(await snapshot(root) === before, false)

    // ⑤ 真实升级报告改写面与计划一致（计划不是另写一份判断）。
    // 先跑一次真升级，用「计划 × 报告」逐项对照；再把库复原成旧布局跑第二次验证计划本身。
    const result = await upgradeLibrary(root, { now: NOW })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.ok(result.plan?.planId, '升级结果必须带上动笔前的只读计划')
    for (const item of section.rewrites.filter((row) => row.kind === 'project-marker' || row.kind === 'json' || row.kind === 'jsonl')) {
      assert.ok(result.report.rewritten.includes(item.file), `${item.file} 计划改写但报告没改写：${JSON.stringify(result.report.rewritten)}`)
    }
    for (const item of section.skipped) {
      assert.ok(result.report.skipped.some((row) => row.file === item.file && row.line === item.line),
        `${item.file}:${item.line} 计划跳过但报告没跳过：${JSON.stringify(result.report.skipped)}`)
    }
    assert.equal(result.report.frontmatter.length, 0)
    assert.equal(section.rewrites.some((row) => row.kind === 'frontmatter'), false)
    // 计划里的 project 迁移对：旧 spec／旧 carrier 谱系名 → 新 spec／新谱系名。
    assert.deepEqual(section.project, {
      from: { spec: 'pinax-project@3', schemaVersion: 3, primary: 'pinax.carrier.novel', enabled: ['pinax.carrier.novel'] },
      to: { spec: 'openstory-project@4', schemaVersion: 4, primary: 'openstory.carrier.novel', enabled: ['openstory.carrier.novel'] }
    })
    const upgradedProject = JSON.parse(await readFile(join(root, '.openstory/project.json'), 'utf-8'))
    assert.equal(upgradedProject.spec, section.project.to.spec)
    assert.equal(upgradedProject.carriers.primary, section.project.to.primary)
    assert.deepEqual(upgradedProject.carriers.enabled, section.project.to.enabled)
    const after = await diagnoseLibraryUpgrade(root, { now: NOW })
    assert.equal(after.needed, false)
    assert.equal(after.alreadyUpgraded, true, '升级后再次诊断必须报已升级（且不重跑）')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

/* ================================================================
 * OS-222：确认执行闸与 MCP 升级工具的决定性反例
 * ================================================================ */

const emptyLayer = { manifests: [], sources: [], warnings: [] }

async function withApplyFixture(run) {
  const root = await fixture()
  const env = { LOCALAPPDATA: await mkdtemp(join(tmpdir(), 'os222-appdata-')), APPDATA: '' }
  env.APPDATA = env.LOCALAPPDATA
  clearUpgradePlans()
  resetLibraryMigrations(root)
  try {
    return await run(root, env)
  } finally {
    clearUpgradePlans()
    resetLibraryMigrations(root)
    await rm(root, { recursive: true, force: true })
    await rm(env.LOCALAPPDATA, { recursive: true, force: true })
  }
}

test('OS-222：未确认/无计划/过期计划一律零写入拒绝，成功执行走原有备份与标记', async () => {
  await withApplyFixture(async (root) => {
    const plan = await buildLibraryUpgradePlan(root, emptyLayer, { now: NOW })
    assert.equal(plan.writes, false)
    assert.equal(plan.summary.libraryNeeded, true)
    const before = await snapshot(root)

    // confirm:false 与缺失 confirm：都拒绝且零写入。
    let result = await applyUpgradePlan(root, { planId: plan.planId, confirm: false, layer: emptyLayer })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'CONFIRM_REQUIRED')
    assert.equal(await snapshot(root), before)
    result = await applyUpgradePlan(root, { confirm: true, layer: emptyLayer })
    assert.equal(result.code, 'PLAN_REQUIRED')
    assert.equal(await snapshot(root), before)

    // 登记计划但用错 planId：拒绝且零写入。
    rememberUpgradePlan(plan)
    result = await applyUpgradePlan(root, { planId: 'plan-nope', confirm: true, layer: emptyLayer })
    assert.equal(result.code, 'PLAN_NOT_FOUND')
    assert.equal(await snapshot(root), before)

    // 预览后「被计划绑定的文件」变化（摘要漂移）：拒绝且零写入。
    const projectPath = join(root, '.pinax/project.json')
    const originalProject = await readFile(projectPath, 'utf-8')
    assert.ok(plan.bindings.some((item) => item.path === '.pinax/project.json'), '计划必须绑定 project.json')
    await writeFile(projectPath, originalProject.replace('"name": "旧库"', '"name": "旧库-漂移"'), 'utf-8')
    result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer: emptyLayer })
    assert.equal(result.code, 'PLAN_STALE')
    assert.ok(result.drift && result.drift.length > 0, '必须点名漂移项')
    await writeFile(projectPath, originalProject, 'utf-8')

    // 无漂移 + confirm:true：复用 upgradeLibrary 走完，写升级标记与备份。
    result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, operationId: 'op-1', layer: emptyLayer })
    assert.equal(result.ok, true, JSON.stringify(result))
    assert.equal(result.outcome, 'success')
    assert.equal(result.planId, plan.planId)
    assert.equal(result.operationId, 'op-1')
    assert.ok(result.backups.some((item) => item.startsWith('.history/upgrade-')))
    // OS-222 P1 反证：必须真的拿到 libraryUpgrade 日志路径，不许用恒真式兜底。
    assert.ok(result.journals.some((item) => item.startsWith('.openstory/log/') && item.endsWith('.jsonl')),
      `升级日志路径必须在 journals 里（且为库内相对路径）：${JSON.stringify(result.journals)}`)
    assert.ok(result.journals.every((item) => !item.startsWith('/') && !/^[a-zA-Z]:\//u.test(item)),
      'journals 不得含服务器绝对路径')
    const marker = JSON.parse(await readFile(join(root, '.openstory/upgrade.json'), 'utf-8'))
    assert.equal(marker.spec, LIBRARY_UPGRADE_SPEC)

    // 一次性：再执行同一 planId 必须拒绝（需重新 diagnose/plan）。
    result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer: emptyLayer })
    assert.equal(result.code, 'PLAN_NOT_FOUND')
  })
})

test('OS-222：预览端点零写入，普通业务端点仍自动升级（豁免不外溢）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os222-daemon-'))
  const root = join(base, '夹具库')
  try {
    const env = { LOCALAPPDATA: base, APPDATA: base }
    // 复用与 upgrade fixture 相同的旧布局（写到临时库根）。
    const legacy = await fixture()
    for (const entry of await readdir(legacy, { withFileTypes: true })) {
      const src = join(legacy, entry.name)
      const dest = join(root, entry.name)
      await mkdir(dest, { recursive: true })
      const copy = async (from, to) => {
        for (const child of await readdir(from, { withFileTypes: true })) {
          const s = join(from, child.name)
          const d = join(to, child.name)
          if (child.isDirectory()) { await mkdir(d, { recursive: true }); await copy(s, d) }
          else await writeFile(d, await readFile(s))
        }
      }
      if (entry.isDirectory()) await copy(src, dest)
      else await writeFile(dest, await readFile(src))
    }
    await rm(legacy, { recursive: true, force: true })
    const preferencesPath = join(base, 'libraries.json')
    await writeFile(preferencesPath, JSON.stringify({
      schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }]
    }), 'utf-8')
    const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
    try {
      const origin = `http://127.0.0.1:${daemon.port}`
      const before = await snapshot(root)
      const post = async (path, body) => (await fetch(`${origin}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      })).json()
      const plan = await post('/api/library/upgrade-plan', { root })
      assert.equal(plan.ok, true)
      assert.ok(plan.planId)
      assert.equal(plan.writes, false)
      const diag = await (await fetch(`${origin}/api/library/upgrade-diagnose?root=${encodeURIComponent(root)}`)).json()
      assert.equal(diag.ok, true)
      assert.equal(diag.writes, false)
      assert.equal(await snapshot(root), before, 'diagnose/plan 预览必须整库零写入')

      // 普通业务端点仍被自动升级闸接管（豁免不外溢）。
      const list = await (await fetch(`${origin}/api/chapters?root=${encodeURIComponent(root)}&dir=正文`)).json()
      assert.equal(list.ok, true)
      assert.notEqual(await snapshot(root), before, '普通端点应触发首次打开自动升级')
    } finally {
      await daemon.close()
      resetLibraryMigrations(root)
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-222：apply 注入失败证明 rolledBack:true，回滚不完成的 journal 如实报 rolledBack:false 且不自动重试', async () => {
  await withApplyFixture(async (root) => {
    const before = await snapshot(root, true)
    const plan = await buildLibraryUpgradePlan(root, emptyLayer, { now: NOW })
    rememberUpgradePlan(plan)
    // upgradeLibrary 的既有 failAt 注入在真实 journal/备份路径上生效；apply 只透传，
    // 不经 shell/fs 复制覆盖，失败按既有回滚恢复原字节。
    const original = await readFile(join(root, '.pinax/project.json'), 'utf-8')
    const failed = await applyUpgradePlan(root, {
      planId: plan.planId, confirm: true, layer: emptyLayer, upgradeDeps: { failAt: 'write:upgrade.json' }
    })
    assert.equal(failed.ok, false, JSON.stringify(failed))
    assert.equal(failed.outcome, 'rolled-back')
    assert.equal(failed.rolledBack, true)
    assert.equal(failed.libraryUpgrade.rolledBack, true)
    assert.equal(await readFile(join(root, '.pinax/project.json'), 'utf-8'), original)
  })

  // journal 明确 rolledBack:false（且 rollbackErrors 非空）→ apply 如实点名「回滚未完成」。
  await withApplyFixture(async (root) => {
    const plan = await buildLibraryUpgradePlan(root, emptyLayer, { now: NOW })
    rememberUpgradePlan(plan)
    const journalDir = join(root, '.openstory/migrations/fact.store')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, '1-to-2.json'), JSON.stringify({
      spec: 'openstory-capability-migration@1', plugin: 'fact-local', capability: 'fact.store',
      from: 1, to: 2, state: 'failed', rolledBack: false,
      rollbackErrors: [{ path: '故事源/book.json', error: '注入的回滚失败' }],
      files: [{ path: '故事源/book.json', backup: '故事源/book.json', committed: true, beforeHash: null, afterHash: null }]
    }), 'utf-8')
    const result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer: emptyLayer })
    assert.equal(result.ok, false, JSON.stringify(result))
    assert.ok(result.message.includes('回滚未完成') || result.outcome === 'rollback-incomplete', result.message)
    assert.equal(result.rolledBack, false)
    assert.ok(result.rollbackErrors.some((item) => item.error === '注入的回滚失败'))
    // 不给自动重试：同一 planId 仍不可再用。
    const again = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer: emptyLayer })
    assert.equal(again.code, 'PLAN_NOT_FOUND')
  })
})

/**
 * OS-222 P0/P1：真实 daemon HTTP apply 路径。
 * 直接调用 applyUpgradePlan 的测试无法发现 daemon 前置闸在拒绝路径上真动稿的问题；
 * 这里必须走 /api/library/upgrade-apply。
 */
async function withLegacyDaemon(run) {
  const base = await mkdtemp(join(tmpdir(), 'os222-http-'))
  const root = join(base, '夹具库')
  try {
    const legacy = await fixture()
    const copy = async (from, to) => {
      await mkdir(to, { recursive: true })
      for (const child of await readdir(from, { withFileTypes: true })) {
        const s = join(from, child.name)
        const d = join(to, child.name)
        if (child.isDirectory()) await copy(s, d)
        else await writeFile(d, await readFile(s))
      }
    }
    await copy(legacy, root)
    await rm(legacy, { recursive: true, force: true })
    const preferencesPath = join(base, 'libraries.json')
    await writeFile(preferencesPath, JSON.stringify({
      schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }]
    }), 'utf-8')
    const env = { LOCALAPPDATA: base, APPDATA: base }
    clearUpgradePlans()
    resetLibraryMigrations(root)
    const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
    const origin = `http://127.0.0.1:${daemon.port}`
    const post = async (path, body) => {
      const response = await fetch(`${origin}${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
      })
      return { status: response.status, payload: await response.json() }
    }
    try { return await run({ root, origin, post, env }) } finally {
      await daemon.close()
      clearUpgradePlans()
      resetLibraryMigrations(root)
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test('OS-222 P0：HTTP apply 的拒绝路径（confirm:false/无 plan/错 planId/额外参数）零写入', async () => {
  await withLegacyDaemon(async ({ root, post, origin }) => {
    const before = await snapshot(root)
    const denied = await post('/api/library/upgrade-apply', { root, planId: 'plan-x', confirm: false })
    assert.equal(denied.status, 400)
    assert.equal(denied.payload.error.code, 'CONFIRM_REQUIRED')
    assert.equal(await snapshot(root), before, 'confirm:false 拒绝必须零写入，daemon 前置闸不得先升级')

    const noPlan = await post('/api/library/upgrade-apply', { root, confirm: true })
    assert.equal(noPlan.status, 400)
    // planId 是契约必填：无 plan 在契约校验层即以 INVALID_ENTRY 被拒（比 handler 更早，同样零写入）。
    assert.equal(noPlan.payload.error.code, 'INVALID_ENTRY')
    assert.equal(await snapshot(root), before, '无 plan 拒绝必须零写入')

    const wrongPlan = await post('/api/library/upgrade-apply', { root, planId: 'plan-x', confirm: true })
    assert.equal(wrongPlan.status, 404)
    assert.equal(wrongPlan.payload.error.code, 'PLAN_NOT_FOUND')
    assert.equal(await snapshot(root), before, '错 planId 拒绝必须零写入')

    // OS-222：额外参数在业务 handler 前拒绝，不能静默吞掉后继续执行。
    for (const [path, body] of [
      ['/api/library/upgrade-apply', { root, planId: 'plan-x', confirm: true, shell: 'rm -rf' }],
      ['/api/library/upgrade-plan', { root, confirm: true }],
      [`/api/library/upgrade-diagnose?root=${encodeURIComponent(root)}&extra=1`, null]
    ]) {
      const response = body === null
        ? await fetch(`${origin}${path}`)
        : await fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
      const payload = await response.json()
      assert.equal(response.status, 400, `${path} 额外参数必须 400`)
      assert.equal(payload.error.code, 'INVALID_ENTRY')
      assert.equal(await snapshot(root), before, '额外参数拒绝必须零写入')
    }
  })
})

test('OS-220 P1：capability 数据文件进入整库 plan 绑定，仅改数据也会 PLAN_STALE', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os220-capability-binding-'))
  try {
    const root = join(base, 'lib')
    const pkg = join(base, 'pkg')
    await mkdir(join(root, '故事源'), { recursive: true })
    await mkdir(join(pkg, 'fact-plus', 'migrations'), { recursive: true })
    const dataPath = join(root, '故事源', 'book.json')
    await writeFile(dataPath, '{"schema":"fact.data/v3"}', 'utf-8')
    await writeFile(join(pkg, 'fact-plus', 'migrations', 'v3-to-v4.mjs'), `export default async () => ({ files: [{ path: '故事源/book.json', content: '{"schema":"fact.data/v4"}' }] })`, 'utf-8')
    const layer = {
      manifests: [{ id: 'fact-plus', class: 'kernel', entry: 'index.mjs', capabilities: [{ id: 'fact.store', version: 4 }], overrides: [{ type: 'capability', target: 'fact.store', from: 3 }], migrations: [{ capability: 'fact.store', from: 3, to: 4, entry: 'migrations/v3-to-v4.mjs' }] }],
      sources: [{ id: 'fact-plus', source: 'local', sourceDir: join(base, 'pkg') }], warnings: []
    }
    clearUpgradePlans()
    resetLibraryMigrations(root)
    const plan = await buildLibraryUpgradePlan(root, layer, { now: NOW })
    assert.ok(plan.bindings.some((item) => item.path === '故事源/book.json' && item.id.startsWith('capability-file:')),
      `迁移数据文件必须进整库绑定：${JSON.stringify(plan.bindings)}`)
    rememberUpgradePlan(plan)
    await writeFile(dataPath, '{"schema":"fact.data/v3","authorChanged":true}', 'utf-8')
    const result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer })
    assert.equal(result.code, 'PLAN_STALE', '迁移器不变，仅业务数据变化也必须拒绝')
    assert.ok(result.drift.some((item) => item.path === '故事源/book.json'))
  } finally {
    clearUpgradePlans()
    resetLibraryMigrations()
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-220 P1：能力迁移阻断冲突在 apply 前拒绝，零写入', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os220-blocking-conflict-'))
  try {
    const root = join(base, 'lib')
    const pkg = join(base, 'pkg')
    await mkdir(join(root, '故事源'), { recursive: true })
    await mkdir(join(pkg, 'fact-plus', 'migrations'), { recursive: true })
    await writeFile(join(root, '故事源', 'book.json'), '{"schema":"fact.data/v3"}', 'utf-8')
    await writeFile(join(pkg, 'fact-plus', 'migrations', 'v3-to-v4.mjs'), `export default async () => ({ files: [
      { path: '故事源/book.json', content: 'first' },
      { path: '故事源/book.json', content: 'second' }
    ] })`, 'utf-8')
    const layer = {
      manifests: [{ id: 'fact-plus', class: 'kernel', entry: 'index.mjs', capabilities: [{ id: 'fact.store', version: 4 }], overrides: [{ type: 'capability', target: 'fact.store', from: 3 }], migrations: [{ capability: 'fact.store', from: 3, to: 4, entry: 'migrations/v3-to-v4.mjs' }] }],
      sources: [{ id: 'fact-plus', source: 'local', sourceDir: join(base, 'pkg') }], warnings: []
    }
    clearUpgradePlans()
    resetLibraryMigrations(root)
    const plan = await buildLibraryUpgradePlan(root, layer, { now: NOW })
    assert.ok(plan.sections.capabilityMigrations.some((item) => item.conflicts.some((row) => row.blocking)))
    rememberUpgradePlan(plan)
    const before = await snapshot(root)
    const result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'MIGRATION_FAILED')
    assert.match(result.message, /阻断冲突/u)
    assert.equal(await snapshot(root), before)
  } finally {
    clearUpgradePlans()
    resetLibraryMigrations()
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-222 P1：HTTP apply 备份失败必须返回失败且原库逐字节不变，不自动重试', async () => {
  await withLegacyDaemon(async ({ root, post }) => {
    const planned = await post('/api/library/upgrade-plan', { root })
    assert.equal(planned.status, 200, JSON.stringify(planned))
    // 把 .history 占成普通文件：备份目录创建必失败，且不依赖时间戳路径猜测。
    await writeFile(join(root, '.history'), 'blocked', 'utf-8')
    const before = await snapshot(root)
    const failed = await post('/api/library/upgrade-apply', { root, planId: planned.payload.planId, confirm: true })
    assert.equal(failed.status, 500, JSON.stringify(failed))
    assert.equal(failed.payload.ok, false)
    assert.equal(failed.payload.error.code, 'LIBRARY_UPGRADE_FAILED')
    assert.equal(await snapshot(root), before, '备份失败必须零业务改动')
    // 再调用同一 planId：失败计划也已作废，不能自动重试。
    const again = await post('/api/library/upgrade-apply', { root, planId: planned.payload.planId, confirm: true })
    assert.equal(again.payload.error.code, 'PLAN_NOT_FOUND')
    assert.equal(await snapshot(root), before)
  })
})

test('OS-222 P0/P1：HTTP 预览→确认→执行全程走通，journal/backups 全为库内相对路径且 rolledBack:true', async () => {
  await withLegacyDaemon(async ({ root, post, env }) => {
    const before = await snapshot(root)
    const planned = await post('/api/library/upgrade-plan', { root })
    assert.equal(planned.status, 200, JSON.stringify(planned))
    assert.ok(planned.payload.planId)
    assert.equal(planned.payload.plan.sections.libraryUpgrade.needed, true)
    assert.equal(await snapshot(root), before, '预览零写入')

    const applied = await post('/api/library/upgrade-apply', {
      root, planId: planned.payload.planId, confirm: true, operationId: 'http-op-1'
    })
    assert.equal(applied.status, 200, JSON.stringify(applied))
    const result = applied.payload
    assert.equal(result.outcome, 'success', `生产 HTTP apply 必须成功而非 PLAN_STALE：${JSON.stringify(result)}`)
    assert.equal(result.operationId, 'http-op-1')
    // P1：绝对路径不得泄漏，journals 必须含升级 changelog 的相对路径。
    assert.ok(result.journals.every((item) => !item.startsWith('/') && !/^[a-zA-Z]:\//u.test(item)),
      `journals 泄漏绝对路径：${JSON.stringify(result.journals)}`)
    assert.ok(result.backups.every((item) => !item.startsWith('/') && !/^[a-zA-Z]:\//u.test(item)),
      `backups 泄漏绝对路径：${JSON.stringify(result.backups)}`)
    assert.ok(result.journals.some((item) => item.startsWith('.openstory/log/') && item.endsWith('.jsonl')),
      `缺升级日志相对路径：${JSON.stringify(result.journals)}`)
    // P1：成功路径没有回滚，rolledBack 必须为 true（不是回滚未完成）。
    assert.equal(result.rolledBack, true, 'success 不应报 rolledBack:false')
    assert.deepEqual(result.rollbackErrors, [])
    // 执行确实改了库：升级标记与退役目录出现。
    assert.ok((await readdir(root)).some((name) => name.startsWith('.pinax.retired-')))
    assert.ok(existsSync(join(root, '.openstory/upgrade.json')))
    assert.ok(result.backups.some((item) => item.startsWith('.history/upgrade-')))
  })
})

test('OS-222 P1：invalid 迁移器不得被静默跳过后报 success', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os222-invalid-'))
  try {
    const root = join(base, 'lib')
    await mkdir(join(root, '正文'), { recursive: true })
    await writeFile(join(root, '正文/001.md'), '正文', 'utf-8')
    const packageDir = join(base, 'pkg')
    await mkdir(packageDir, { recursive: true })
    const layer = {
      manifests: [{
        id: 'evil', class: 'kernel', entry: 'index.mjs',
        capabilities: [{ id: 'text.analyze', version: 2 }],
        overrides: [{ type: 'capability', target: 'text.analyze', from: 1 }],
        migrations: [{ capability: 'text.analyze', from: 1, to: 2, entry: '../evil.mjs' }]
      }],
      sources: [{ id: 'evil', source: 'local', sourceDir: packageDir }],
      warnings: []
    }
    clearUpgradePlans()
    resetLibraryMigrations(root)
    const plan = await buildLibraryUpgradePlan(root, layer, { now: NOW })
    const invalid = (plan.sections.capabilityMigrations ?? []).filter((item) => item.status === 'invalid')
    assert.ok(invalid.length > 0, '计划必须包含 invalid 迁移项')
    assert.equal(plan.sections.capability.ok, false)
    rememberUpgradePlan(plan)
    const result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer })
    assert.equal(result.ok, false, 'invalid 迁移必须拒绝，不得报 success')
    assert.equal(result.code, 'MIGRATION_FAILED')
    assert.equal(existsSync(join(root, '正文/001.md')), true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-222 P1：DATA_VERSION_AHEAD 必须在 plan 出现并在 apply 拒绝（含无声明迁移层）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os222-ahead-'))
  try {
    const root = join(base, 'lib')
    const journalDir = join(root, '.openstory/migrations/text.analyze')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, '1-to-2.json'), JSON.stringify({
      spec: 'openstory-capability-migration@1', plugin: 'fact-local', capability: 'text.analyze',
      from: 1, to: 2, state: 'done',
      files: [{ path: '故事源/book.json', backup: '', committed: true, beforeHash: null, afterHash: 'x' }]
    }), 'utf-8')
    // 层里没有任何「迁移声明」，但内置 text manifest 提供 text.analyze@1：
    // 数据被 journal 标成 @2 而供给者仍是 @1 → 真实路由回落。旧实现用空路由表
    // dataAheadFrom({}, …) 算，恒空；修复后必须先建路由快照再算。
    const layer = {
      manifests: [{
        id: 'text', class: 'kernel', entry: 'index.mjs', builtin: true,
        capabilities: [{ id: 'text.analyze', version: 1 }]
      }],
      sources: [],
      warnings: []
    }
    clearUpgradePlans()
    resetLibraryMigrations(root)
    const plan = await buildLibraryUpgradePlan(root, layer, { now: NOW })
    assert.ok((plan.sections.dataAhead ?? []).length > 0, 'dataAhead 必须反映真实路由回落')
    rememberUpgradePlan(plan)
    const result = await applyUpgradePlan(root, { planId: plan.planId, confirm: true, layer })
    assert.equal(result.ok, false, 'DATA_VERSION_AHEAD 必须拒绝')
    assert.equal(result.code, 'DATA_VERSION_AHEAD')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
