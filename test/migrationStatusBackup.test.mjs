/**
 * OS-221：迁移状态与备份产品接口（专用只读端点）。
 *
 * 守护四件事：
 *   ① 真实 daemon 上成功／幂等／running／failed／recovered／done／DATA_VERSION_AHEAD
 *      七种状态都能读，且形状符合契约；
 *   ② 状态与备份读取**零写入**——三种库状态（旧库、failed journal、data-ahead）下，
 *      请求前后整库文件树与字节哈希完全一致；
 *   ③ 备份校验能发现缺文件与哈希不符；越权 root、任意 backupPath、路径逃逸一律拒绝；
 *   ④ 豁免没有外溢：普通业务端点仍被一次性升级／迁移失败／DATA_VERSION_AHEAD 闸拦截。
 *
 * 夹具纪律：临时 LOCALAPPDATA/APPDATA、临时库、port:0 daemon；不碰真实用户目录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, relative } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { resetLibraryMigrations } from '../src/host/libraryMigrations.mjs'

const text = (value) => String(value ?? '')
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

const MANIFEST = {
  spec: 'openstory-module@2',
  id: 'textplus',
  name: '文本增强',
  version: '2.0.0',
  class: 'kernel',
  entry: 'index.mjs',
  requires: [{ id: 'base.naming', min: 1 }],
  capabilities: [{ id: 'text.analyze', version: 2, golden: 'text-analyze-v2' }],
  overrides: [{ type: 'capability', target: 'text.analyze', from: 1 }],
  migrations: [{ capability: 'text.analyze', from: 1, to: 2, entry: 'migrate.mjs' }]
}

const ENTRY = `export async function activate(context) {
  context.resolve('base.naming', { min: 1 })
  return { capabilities: { 'text.analyze': { analyze: () => ({ probe: 'v2' }) } } }
}`

const MIGRATOR = `export default async function migrate(context) {
  const raw = await context.readFile('.openstory/probe-data.json')
  const data = raw ? JSON.parse(raw) : { version: 1 }
  return [{ path: '.openstory/probe-data.json', content: JSON.stringify({ version: data.version + 1, marker: 'v2' }) }]
}`

async function writeModule(moduleRoot, { migrator = MIGRATOR } = {}) {
  const dir = join(moduleRoot, 'textplus')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify(MANIFEST, null, 2), 'utf-8')
  await writeFile(join(dir, 'index.mjs'), ENTRY, 'utf-8')
  await writeFile(join(dir, 'migrate.mjs'), migrator, 'utf-8')
}

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'os221-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  await writeFile(join(root, '.openstory', 'probe-data.json'), JSON.stringify({ version: 1 }), 'utf-8')
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: [{ path: root, name: '夹具库' }]
  }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  return { base, env, root, daemon, origin: `http://127.0.0.1:${daemon.port}`, moduleRoot: join(base, '模块根'), preferencesPath }
}

async function close(item) {
  resetLibraryMigrations(item.root)
  await item.daemon.close()
  await rm(item.base, { recursive: true, force: true })
}

async function withFixture(run) {
  const item = await fixture()
  try { return await run(item) } finally { await close(item) }
}

const json = async (response) => ({ status: response.status, payload: await response.json().catch(() => null) })
const get = (origin, path) => fetch(`${origin}${path}`).then(json)
const post = (origin, path, body) => fetch(`${origin}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
}).then(json)
const status = (item) => get(item.origin, `/api/library/migration-status?root=${encodeURIComponent(item.root)}`)
const backups = (item, extra = '') => get(item.origin, `/api/library/migration-backups?root=${encodeURIComponent(item.root)}${extra}`)
const plugins = (item) => get(item.origin, `/api/plugins?root=${encodeURIComponent(item.root)}`)

/** 整库文件树（含空目录）＋ 逐文件字节哈希：零写入的硬证据。 */
async function treeDigest(root) {
  const out = []
  const walk = async (dir) => {
    const entries = await readdir(dir, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))
    for (const entry of entries) {
      const child = join(dir, entry.name)
      const rel = relative(root, child).split('\\').join('/')
      if (entry.isDirectory()) {
        // 空目录也算写入：mkdir 会改变库形状，必须能发现。
        out.push(`${rel}/:<dir>`)
        await walk(child)
        continue
      }
      if (!entry.isFile()) continue
      out.push(`${rel}:${sha256(await readFile(child))}`)
    }
  }
  await walk(root)
  return out.join('\n')
}

async function addRoot(item, options) {
  await writeModule(item.moduleRoot, options)
  const added = await post(item.origin, '/api/module-roots/add', { path: item.moduleRoot, confirm: true })
  assert.equal(added.status, 200)
  assert.equal(added.payload.localModules.find((mod) => mod.id === 'textplus')?.status, 'loaded')
  return added
}

/** 造一份 capability journal（含备份目录与备份文件），状态由调用方指定。 */
async function writeJournalFixture(item, {
  state = 'done', rolledBack = true, rollbackErrors = [], backupBytes = null, omitBackup = false,
  beforeHash = '', committed = true
} = {}) {
  const backupRelative = '.history/capability-text.analyze-1-to-2-fixture'
  const dataRelative = '.openstory/probe-data.json'
  if (!omitBackup) {
    const bytes = backupBytes ?? Buffer.from(JSON.stringify({ version: 1 }))
    await mkdir(join(item.root, backupRelative, '.openstory'), { recursive: true })
    await writeFile(join(item.root, backupRelative, dataRelative), bytes)
    if (!beforeHash) beforeHash = sha256(await readFile(join(item.root, backupRelative, dataRelative)))
  }
  const journalDir = join(item.root, '.openstory', 'migrations', 'text.analyze')
  await mkdir(journalDir, { recursive: true })
  const journal = {
    spec: 'openstory-capability-migration@1',
    plugin: 'textplus',
    capability: 'text.analyze',
    from: 1,
    to: 2,
    entry: 'migrate.mjs',
    entrySha256: 'a'.repeat(64),
    operationId: `fixture-${state}`,
    startedAt: '2026-11-27T00:00:00.000Z',
    ...(state === 'done' ? { finishedAt: '2026-11-27T00:00:01.000Z' } : {}),
    ...(state === 'recovered' ? { recoveredAt: '2026-11-27T00:00:02.000Z', restored: [dataRelative] } : {}),
    backupPath: backupRelative,
    files: [{ path: dataRelative, beforeHash: beforeHash || null, afterHash: 'b'.repeat(64), backup: dataRelative, committed }],
    state,
    ...(state === 'failed' ? { finishedAt: '2026-11-27T00:00:03.000Z', error: 'migrator boom', rolledBack } : {}),
    ...(rollbackErrors.length ? { rollbackErrors } : {})
  }
  await writeFile(join(journalDir, '1-to-2.json'), JSON.stringify(journal, null, 2), 'utf-8')
  return { journal, backupRelative, dataRelative }
}

test('OS-221-1 空库状态可读、形状合规、零写入', async () => {
  await withFixture(async (item) => {
    const before = await treeDigest(item.root)
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.ok, true)
    assert.equal(read.payload.spec, 'openstory.migration-status/v1')
    assert.equal(read.payload.healthy, true)
    assert.equal(read.payload.status, 'healthy')
    assert.equal(read.payload.writes, false)
    assert.deepEqual(read.payload.journals, [])
    assert.deepEqual(read.payload.dataVersions, [])
    assert.deepEqual(read.payload.dataAhead, [])
    assert.deepEqual(read.payload.issues, [])
    assert.equal(read.payload.upgrade.markerState, 'absent')
    assert.equal(await treeDigest(item.root), before)

    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.spec, 'openstory.migration-backup-report/v1')
    assert.equal(listed.payload.healthy, true)
    assert.equal(listed.payload.writes, false)
    assert.deepEqual(listed.payload.backups, [])
    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-2 done 状态（真实迁移后）可读、幂等、零写入；dataVersions 与 /api/plugins 同源', async () => {
  await withFixture(async (item) => {
    await addRoot(item)
    // 业务请求触发一次性升级与迁移（这是既有链路，不是状态端点）。
    const listed = await plugins(item)
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.moduleMigrations.ran.length, 1)

    const before = await treeDigest(item.root)
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.status, 'healthy')
    assert.equal(read.payload.journals.length, 1)
    const journal = read.payload.journals[0]
    assert.equal(journal.state, 'done')
    assert.equal(journal.capability, 'text.analyze')
    assert.equal(journal.to, 2)
    assert.equal(journal.files.length, 1)
    assert.equal(journal.files[0].backup, '.openstory/probe-data.json')
    assert.equal(read.payload.dataVersions[0].to, 2)
    // 与 /api/plugins 的 moduleMigrations.dataVersions 同源（同一份 journal 读法，不另立真源）。
    const fromPlugins = listed.payload.moduleMigrations.dataVersions.map((row) => `${row.capability}@${row.to}:${row.plugin}`)
    const fromStatus = read.payload.dataVersions.map((row) => `${row.capability}@${row.to}:${row.plugin}`)
    assert.deepEqual(fromStatus, fromPlugins)
    assert.deepEqual(read.payload.failures, [])
    assert.deepEqual(read.payload.dataAhead, [])
    assert.ok(read.payload.backupPaths.length >= 1)
    assert.ok(read.payload.backupPaths.every((path) => text(path).startsWith('.history/capability-text.analyze-1-to-2-')))
    assert.equal(await treeDigest(item.root), before)

    // 再读一次：响应稳定（幂等），且仍不改库。
    const again = await status(item)
    assert.deepEqual(
      { ...again.payload, checkedAt: '' },
      { ...read.payload, checkedAt: '' }
    )
    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-3 failed journal 类型化：rolledBack:true 与回滚未完成分别点名，零写入', async () => {
  await withFixture(async (item) => {
    await writeJournalFixture(item, { state: 'failed', rolledBack: true })
    const before = await treeDigest(item.root)
    const rolledBack = await status(item)
    assert.equal(rolledBack.status, 200)
    assert.equal(rolledBack.payload.status, 'attention')
    assert.equal(rolledBack.payload.healthy, false)
    const failure = rolledBack.payload.failures[0]
    assert.equal(failure.state, 'failed')
    assert.equal(failure.rolledBack, true)
    assert.equal(failure.capability, 'text.analyze')
    assert.equal(rolledBack.payload.rolledBack[0], '.openstory/migrations/text.analyze/1-to-2.json')
    assert.equal(rolledBack.payload.issues.some((issue) => issue.code === 'MIGRATION_FAILED'), true)
    assert.equal(rolledBack.payload.issues.some((issue) => issue.code === 'MIGRATION_ROLLBACK_INCOMPLETE'), false)
    assert.equal(await treeDigest(item.root), before)

    // 回滚未完成：必须单独类型化，不许冒充「已恢复」。
    const failed = await writeJournalFixture(item, {
      state: 'failed',
      rolledBack: false,
      rollbackErrors: [{ path: '.openstory/probe-data.json', error: '备份文件缺失' }]
    })
    assert.equal(failed.journal.state, 'failed')
    const beforeIncomplete = await treeDigest(item.root)
    const incomplete = await status(item)
    assert.equal(incomplete.status, 200)
    assert.equal(incomplete.payload.healthy, false)
    assert.equal(incomplete.payload.failures[0].rolledBack, false)
    assert.equal(incomplete.payload.rollbackErrors[0].error, '备份文件缺失')
    assert.equal(incomplete.payload.issues.some((issue) => issue.code === 'MIGRATION_ROLLBACK_INCOMPLETE'), true)
    assert.equal(await treeDigest(item.root), beforeIncomplete)

    // 备份端点在同样状态下也只读，并报同一类 issue。
    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.equal(await treeDigest(item.root), beforeIncomplete)
  })
})

test('OS-221-4 running/recovered journal 报 in-progress，不当健康也不谎报失败', async () => {
  await withFixture(async (item) => {
    await writeJournalFixture(item, { state: 'running', committed: true })
    const before = await treeDigest(item.root)
    const running = await status(item)
    assert.equal(running.status, 200)
    assert.equal(running.payload.status, 'in-progress')
    assert.equal(running.payload.healthy, false)
    assert.deepEqual(running.payload.running, ['.openstory/migrations/text.analyze/1-to-2.json'])
    assert.deepEqual(running.payload.failures, [])
    assert.equal(await treeDigest(item.root), before)

    await writeJournalFixture(item, { state: 'recovered' })
    // 夹具在两次状态读取之间重写了 journal：零写入基线必须在这个「读之前」重新取。
    const afterRecoveredFixture = await treeDigest(item.root)
    const recovered = await status(item)
    assert.equal(recovered.status, 200)
    assert.equal(recovered.payload.status, 'in-progress')
    assert.deepEqual(recovered.payload.pending, ['.openstory/migrations/text.analyze/1-to-2.json'])
    assert.deepEqual(recovered.payload.failures.map((row) => row.state), ['recovered'])
    assert.equal(await treeDigest(item.root), afterRecoveredFixture)
  })
})

test('OS-221-5 坏 journal 类型化：MIGRATION_JOURNAL_CORRUPT，不当「没有迁移」', async () => {
  await withFixture(async (item) => {
    const journalDir = join(item.root, '.openstory', 'migrations', 'text.analyze')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, '1-to-2.json'), '{ not json', 'utf-8')
    const before = await treeDigest(item.root)

    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.healthy, false)
    assert.equal(read.payload.journals[0].state, 'corrupt')
    assert.equal(read.payload.journals[0].from, 1)
    assert.equal(read.payload.journals[0].to, 2)
    const issue = read.payload.issues.find((row) => row.code === 'MIGRATION_JOURNAL_CORRUPT')
    assert.ok(issue)
    assert.equal(issue.path, '.openstory/migrations/text.analyze/1-to-2.json')
    assert.deepEqual(read.payload.dataVersions, [])

    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.issues.some((row) => row.code === 'MIGRATION_JOURNAL_CORRUPT'), true)
    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-5b 合法 JSON 但 journal 结构损坏也必须报 corrupt，且零写入', async () => {
  await withFixture(async (item) => {
    const journalDir = join(item.root, '.openstory', 'migrations', 'text.analyze')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, '1-to-2.json'), JSON.stringify({
      spec: 'openstory-capability-migration@1', state: 'done', from: 1, to: 2,
      files: 'not-an-array'
    }), 'utf-8')
    const before = await treeDigest(item.root)
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.healthy, false)
    assert.equal(read.payload.journals[0].state, 'corrupt')
    assert.deepEqual(read.payload.dataVersions, [], '结构损坏不得进入 dataVersions 冒充健康')
    assert.ok(read.payload.issues.some((row) => row.code === 'MIGRATION_JOURNAL_CORRUPT'))
    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-5c 旧 failed journal 缺 rolledBack 时，issues 与 failures 字段一致按已回滚', async () => {
  await withFixture(async (item) => {
    const journalDir = join(item.root, '.openstory', 'migrations', 'text.analyze')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, '1-to-2.json'), JSON.stringify({
      spec: 'openstory-capability-migration@1', state: 'failed', from: 1, to: 2,
      plugin: 'legacy', capability: 'text.analyze', files: [], error: 'legacy failure'
    }), 'utf-8')
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.healthy, false)
    assert.equal(read.payload.failures[0].rolledBack, true, '旧 journal 缺省口径＝已回滚')
    assert.ok(read.payload.rolledBack.includes('.openstory/migrations/text.analyze/1-to-2.json'))
    assert.ok(read.payload.issues.some((row) => row.code === 'MIGRATION_FAILED' && /已回滚/u.test(row.message)))
    assert.ok(!read.payload.issues.some((row) => row.code === 'MIGRATION_ROLLBACK_INCOMPLETE'))
  })
})

test('OS-221-6 DATA_VERSION_AHEAD：状态端点 200 且只报告，业务端点仍 409', async () => {
  await withFixture(async (item) => {
    await addRoot(item)
    assert.equal((await plugins(item)).status, 200)
    const removed = await post(item.origin, '/api/module-roots/remove', { path: item.moduleRoot })
    assert.equal(removed.status, 200)

    const before = await treeDigest(item.root)
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.dataAhead.length, 1)
    assert.equal(read.payload.dataAhead[0].capability, 'text.analyze')
    assert.equal(read.payload.dataAhead[0].dataVersion, 2)
    assert.equal(read.payload.dataAhead[0].providerVersion, 1)
    assert.equal(read.payload.dataAhead[0].action, 'manual-downgrade-not-automatic')
    assert.equal(await treeDigest(item.root), before)

    // 豁免没有外溢：业务端点照旧被 DATA_VERSION_AHEAD 闸拦。
    const habits = await get(item.origin, `/api/habits?root=${encodeURIComponent(item.root)}`)
    assert.equal(habits.status, 409)
    assert.equal(habits.payload?.error?.code, 'DATA_VERSION_AHEAD')
    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-7 旧库：读状态不触发一次性升级（零写入），业务端点仍会升级', async () => {
  await withFixture(async (item) => {
    // 造旧库：.pinax 运行态 + 旧目录 参考/ → 升级候选。
    await mkdir(join(item.root, '.pinax'), { recursive: true })
    await writeFile(join(item.root, '.pinax', 'probe.json'), '{"legacy":true}', 'utf-8')
    await mkdir(join(item.root, '参考'), { recursive: true })
    await writeFile(join(item.root, '参考', 'a.md'), '旧参考', 'utf-8')
    const before = await treeDigest(item.root)

    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.legacyPresent, true)
    assert.equal(read.payload.upgrade.needed, true)
    assert.equal(read.payload.upgrade.alreadyUpgraded, false)
    assert.ok(read.payload.upgrade.oldDirs.includes('参考'))
    assert.equal(await treeDigest(item.root), before, '读状态不得升级/写库')

    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.equal(await treeDigest(item.root), before, '读备份不得升级/写库')

    // 业务端点仍走既有一次性升级：升级前状态可读，升级后 marker 变 ok。
    const diagnosed = await get(item.origin, `/api/library/diagnose?root=${encodeURIComponent(item.root)}`)
    assert.equal(diagnosed.status, 200)
    assert.notEqual(await treeDigest(item.root), before, '业务端点必须仍会升级旧库')

    const after = await status(item)
    assert.equal(after.status, 200)
    assert.equal(after.payload.upgrade.markerState, 'ok')
    assert.equal(after.payload.upgrade.alreadyUpgraded, true)
    assert.equal(after.payload.legacyPresent, false)
  })
})

test('OS-221-8 备份校验：缺文件与哈希不符都能发现；正常备份通过', async () => {
  await withFixture(async (item) => {
    const { backupRelative, dataRelative } = await writeJournalFixture(item, { state: 'done' })
    const before = await treeDigest(item.root)

    const healthy = await backups(item)
    assert.equal(healthy.status, 200)
    assert.equal(healthy.payload.healthy, true)
    const backup = healthy.payload.backups.find((row) => row.path === backupRelative)
    assert.ok(backup)
    assert.equal(backup.kind, 'capability')
    assert.equal(backup.fileCount, 1)
    const file = backup.files.find((row) => row.path === dataRelative)
    assert.equal(file.hashMatched, true)
    assert.equal(file.expectedSha256, file.sha256)
    assert.ok(file.bytes > 0)
    // 不提供任意路径下载：响应里只有相对路径、哈希与大小。
    assert.equal(Object.hasOwn(file, 'content'), false)
    assert.equal(Object.hasOwn(healthy.payload, 'download'), false)
    assert.equal(await treeDigest(item.root), before)

    // 哈希不符：改备份内容（不是改 journal）。
    await writeFile(join(item.root, backupRelative, dataRelative), Buffer.from(JSON.stringify({ version: 99 })))
    const mismatched = await backups(item)
    assert.equal(mismatched.status, 200)
    assert.equal(mismatched.payload.healthy, false)
    const mismatch = mismatched.payload.issues.find((row) => row.code === 'MIGRATION_BACKUP_HASH_MISMATCH')
    assert.ok(mismatch)
    assert.equal(mismatch.path, `${backupRelative}/${dataRelative}`)
    assert.equal(mismatched.payload.backups[0].files[0].hashMatched, false)

    // 缺文件：删除备份文件（恢复成先前的备份，再删）。
    await writeFile(join(item.root, backupRelative, dataRelative), Buffer.from(JSON.stringify({ version: 1 })))
    await rm(join(item.root, backupRelative, dataRelative))
    const missing = await backups(item)
    assert.equal(missing.status, 200)
    assert.equal(missing.payload.healthy, false)
    assert.ok(missing.payload.issues.some((row) => row.code === 'MIGRATION_BACKUP_MISSING'))
  })
})

test('OS-221-9 备份目录缺失（journal 指向不存在的备份）类型化', async () => {
  await withFixture(async (item) => {
    await writeJournalFixture(item, { state: 'done', omitBackup: true })
    const before = await treeDigest(item.root)
    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.healthy, false)
    const issue = listed.payload.issues.find((row) => row.code === 'MIGRATION_BACKUP_MISSING')
    assert.ok(issue)
    assert.equal(issue.path, '.history/capability-text.analyze-1-to-2-fixture')
    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-10 越权 root、任意 backupPath、路径逃逸一律拒绝', async () => {
  await withFixture(async (item) => {
    const before = await treeDigest(item.root)

    // 越权 root：不在库清单里 → NO_LIBRARY(403)，不解引用。
    const outside = await get(item.origin, `/api/library/migration-status?root=${encodeURIComponent(join(item.base, '越权库'))}`)
    assert.equal(outside.status, 403)
    assert.equal(outside.payload?.error?.code, 'NO_LIBRARY')
    const outsideBackups = await get(item.origin, `/api/library/migration-backups?root=${encodeURIComponent(join(item.base, '越权库'))}`)
    assert.equal(outsideBackups.status, 403)
    assert.equal(outsideBackups.payload?.error?.code, 'NO_LIBRARY')

    // 任意 backupPath / 路径逃逸：400 + MIGRATION_BACKUP_PATH_INVALID，且不读盘。
    for (const bad of ['/etc/passwd', 'C:/Windows/win.ini', '.history/../.openstory', '正文', '.history/']) {
      const rejected = await backups(item, `&backup=${encodeURIComponent(bad)}`)
      assert.equal(rejected.status, 400, `应拒绝 backup=${bad}`)
      assert.equal(rejected.payload?.error?.code, 'MIGRATION_BACKUP_PATH_INVALID')
    }

    // 缺 root 参数：契约层 400（root 必填）。
    const noRoot = await get(item.origin, '/api/library/migration-status')
    assert.equal(noRoot.status, 400)
    assert.equal(noRoot.payload?.error?.code, 'INVALID_ENTRY')

    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-11 状态响应不含凭据/正文：只有路径、哈希与计数', async () => {
  await withFixture(async (item) => {
    const { backupRelative, dataRelative } = await writeJournalFixture(item, { state: 'done' })
    const read = await status(item)
    assert.equal(read.status, 200)
    const body = JSON.stringify(read.payload)
    assert.equal(body.includes('第一章正文'), false, '状态响应不得带稿件正文')
    assert.equal(body.includes('apiKey'), false)
    assert.equal(body.includes('sk-'), false)
    // 绝对路径只允许出现在「已授权库根」这一个字段；其余字段必须全是库内相对路径。
    const withoutRoot = JSON.stringify({ ...read.payload, root: '' })
    assert.equal(/[A-Za-z]:[\\/]/u.test(withoutRoot), false, `非 root 字段不得出现盘符路径：${withoutRoot.slice(0, 400)}`)
    assert.equal(read.payload.root.replaceAll('\\', '/').endsWith('/夹具库'), true)
    const listed = await backups(item)
    const listedBody = JSON.stringify({ ...listed.payload, root: '' })
    assert.equal(listedBody.includes('第一章正文'), false)
    assert.equal(/[A-Za-z]:[\\/]/u.test(listedBody), false, '备份响应非 root 字段不得出现盘符路径')
    assert.ok(listed.payload.backups.some((row) => row.path === backupRelative))
    assert.ok(listed.payload.backups.flatMap((row) => row.files).some((row) => row.path === dataRelative))
  })
})

test('OS-221-12 指定 backup 只看一份；不存在时类型化为 MIGRATION_BACKUP_MISSING', async () => {
  await withFixture(async (item) => {
    const { backupRelative } = await writeJournalFixture(item, { state: 'done' })
    const one = await backups(item, `&backup=${encodeURIComponent(backupRelative)}`)
    assert.equal(one.status, 200)
    assert.equal(one.payload.backups.length, 1)
    assert.equal(one.payload.backups[0].path, backupRelative)

    const absent = await backups(item, `&backup=${encodeURIComponent('.history/upgrade-2026-01-01')}`)
    assert.equal(absent.status, 200)
    assert.equal(absent.payload.backups.length, 0)
    assert.equal(absent.payload.healthy, false)
    assert.equal(absent.payload.issues.some((row) => row.code === 'MIGRATION_BACKUP_MISSING'), true)
  })
})

test('OS-221-13 升级备份复用 backup-manifest.json：清单声明的内容缺失即报 MIGRATION_BACKUP_MISSING', async () => {  await withFixture(async (item) => {
    const upgradeDir = join(item.root, '.history', 'upgrade-2026-11-27T00-00-00-000Z')
    await mkdir(join(upgradeDir, '.pinax'), { recursive: true })
    await writeFile(join(upgradeDir, '.pinax', 'probe.json'), '{"legacy":true}', 'utf-8')
    const manifest = {
      spec: 'openstory.library-upgrade/v1',
      at: '2026-11-27T00:00:00.000Z',
      copied: ['.pinax', '参考']
    }
    await writeFile(join(upgradeDir, 'backup-manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')

    // 清单声明了 参考，但备份目录里没有它。同时写 upgrade marker 指到这份备份。
    await writeFile(join(item.root, '.openstory', 'upgrade.json'), JSON.stringify({
      spec: 'openstory.library-upgrade/v1',
      at: '2026-11-27T00:00:01.000Z',
      backup: '.history/upgrade-2026-11-27T00-00-00-000Z',
      conflicts: [], rewritten: [], skipped: [], frontmatter: [], tmpResidue: []
    }), 'utf-8')

    const before = await treeDigest(item.root)
    const read = await backups(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.healthy, false)
    const upgradeBackup = read.payload.backups.find((row) => row.kind === 'upgrade')
    assert.ok(upgradeBackup)
    assert.equal(upgradeBackup.manifest.copiedCount, 2)
    assert.deepEqual(upgradeBackup.manifest.copied, ['.pinax', '参考'])
    const issue = read.payload.issues.find((row) => row.code === 'MIGRATION_BACKUP_MISSING'
      && row.path === '.history/upgrade-2026-11-27T00-00-00-000Z/参考')
    assert.ok(issue, '升级备份清单声明却缺失的内容必须点名')
    assert.equal(await treeDigest(item.root), before)

    // 状态端点同步报出 marker 与备份路径，且零写入。
    const statusRead = await status(item)
    assert.equal(statusRead.status, 200)
    assert.equal(statusRead.payload.upgrade.markerState, 'ok')
    assert.equal(statusRead.payload.upgrade.backupPath, '.history/upgrade-2026-11-27T00-00-00-000Z')
    assert.ok(statusRead.payload.backupPaths.includes('.history/upgrade-2026-11-27T00-00-00-000Z'))
    assert.equal(await treeDigest(item.root), before)
  })
})

test('OS-221-14 坏升级标记类型化：不合规 marker 不得被当成健康', async () => {
  await withFixture(async (item) => {
    // 坏 JSON
    await writeFile(join(item.root, '.openstory', 'upgrade.json'), '{ not json', 'utf-8')
    const before = await treeDigest(item.root)
    const corrupt = await status(item)
    assert.equal(corrupt.status, 200)
    assert.equal(corrupt.payload.upgrade.markerState, 'corrupt')
    assert.equal(corrupt.payload.healthy, false)
    assert.equal(corrupt.payload.status, 'attention')
    assert.ok(corrupt.payload.issues.some((row) => row.code === 'LIBRARY_UPGRADE_FAILED'
      && row.scope === 'upgrade-marker'))
    assert.equal(await treeDigest(item.root), before)

    // 外来 spec
    await writeFile(join(item.root, '.openstory', 'upgrade.json'), JSON.stringify({ spec: 'other/v9' }), 'utf-8')
    const fromOther = await treeDigest(item.root)
    const foreign = await status(item)
    assert.equal(foreign.status, 200)
    assert.equal(foreign.payload.upgrade.markerState, 'foreign-spec')
    assert.equal(foreign.payload.healthy, false)
    assert.ok(foreign.payload.issues.some((row) => row.code === 'LIBRARY_UPGRADE_FAILED'
      && row.message.includes('other/v9')))
    assert.equal(await treeDigest(item.root), fromOther)

    // 清单里写明的外来 spec 也一并核对：备份端点同样只读。
    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.equal(await treeDigest(item.root), fromOther)
  })
})

test('OS-221-15 有待跑迁移时：状态/备份端点不触发迁移（业务端点才会）', async () => {
  await withFixture(async (item) => {
    await addRoot(item)
    const dataPath = join(item.root, '.openstory', 'probe-data.json')
    const before = await treeDigest(item.root)
    assert.equal(JSON.parse(await readFile(dataPath, 'utf-8')).version, 1)
    assert.equal(await readFile(join(item.root, '.openstory', 'migrations', 'text.analyze', '1-to-2.json'), 'utf-8').catch(() => null), null)

    // 只读观测：状态与备份都不许执行迁移（数据仍 v1、无 journal、无备份目录）。
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.deepEqual(read.payload.journals, [])
    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.deepEqual(listed.payload.backups, [])
    assert.equal(JSON.parse(await readFile(dataPath, 'utf-8')).version, 1, '状态读取不得执行迁移')
    assert.equal(await treeDigest(item.root), before, '状态/备份读取必须零写入')

    // 业务端点才真跑：迁移执行、journal done、数据升档。
    const triggered = await plugins(item)
    assert.equal(triggered.status, 200)
    assert.equal(triggered.payload.moduleMigrations.ran.length, 1)
    assert.equal(JSON.parse(await readFile(dataPath, 'utf-8')).version, 2)

    const after = await status(item)
    assert.equal(after.payload.journals[0].state, 'done')
  })
})

test('OS-221-16 两个端点响应逐项过契约 validateResponse（含 dataAhead/failed 形态）', async () => {
  await withFixture(async (item) => {
    const { validateResponse } = await import('../src/api/contracts.mjs')
    await writeJournalFixture(item, {
      state: 'failed',
      rolledBack: false,
      rollbackErrors: [{ path: '.openstory/probe-data.json', error: '备份文件缺失' }]
    })
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.deepEqual(validateResponse('libraryMigrationStatusGet', read.payload).errors, [])
    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.deepEqual(validateResponse('libraryMigrationBackupsGet', listed.payload).errors, [])
  })
})

test('OS-221-17 真实迁移失败：业务请求首次撞 MIGRATION_FAILED，failed 状态仍可读且零写入', async () => {
  await withFixture(async (item) => {
    await addRoot(item, { migrator: `export default async function migrate() { throw new Error('boom') }` })
    // 业务端点先撞上迁移：失败门拦成 MIGRATION_FAILED（既有行为不变）。
    const habits = await get(item.origin, `/api/habits?root=${encodeURIComponent(item.root)}`)
    assert.equal(habits.status, 500)
    assert.equal(habits.payload?.error?.code, 'MIGRATION_FAILED')

    // 状态端点在同一库上可读、类型化点名 failed，且不改库。
    const before = await treeDigest(item.root)
    const read = await status(item)
    assert.equal(read.status, 200)
    assert.equal(read.payload.healthy, false)
    assert.equal(read.payload.status, 'attention')
    const failed = read.payload.failures.find((row) => row.state === 'failed')
    assert.ok(failed, `应报 failed：${JSON.stringify(read.payload.failures)}`)
    assert.equal(failed.capability, 'text.analyze')
    assert.match(failed.message, /boom/u)
    assert.equal(read.payload.issues.some((row) => row.code === 'MIGRATION_FAILED'), true)
    assert.equal(await treeDigest(item.root), before)

    // 再次读仍稳定，且没有触发重跑：数据仍是 v1、journal 仍只有那一份 failed。
    const again = await status(item)
    assert.deepEqual({ ...again.payload, checkedAt: '' }, { ...read.payload, checkedAt: '' })
    assert.equal(JSON.parse(await readFile(join(item.root, '.openstory', 'probe-data.json'), 'utf-8')).version, 1)
    assert.equal(again.payload.journals.length, 1)
    assert.equal(again.payload.journals[0].state, 'failed')
    assert.equal(await treeDigest(item.root), before)
    // 既有 OS-197 口径：失败覆盖者已被剔除，后续业务请求回落到内置供给者且不重跑迁移。
    const habitsAgain = await get(item.origin, `/api/habits?root=${encodeURIComponent(item.root)}`)
    assert.equal(habitsAgain.status, 200)
    const listed = await plugins(item)
    assert.equal(listed.payload.localModules.find((mod) => mod.id === 'textplus')?.gate, 'migration')
    assert.equal(JSON.parse(await readFile(join(item.root, '.openstory', 'probe-data.json'), 'utf-8')).version, 1)
  })
})

test('OS-221-18 坏 journal 里带越界 backupPath：备份端点拒用，不走磁盘任意读', async () => {
  await withFixture(async (item) => {
    const journalDir = join(item.root, '.openstory', 'migrations', 'text.analyze')
    await mkdir(journalDir, { recursive: true })
    await writeFile(join(journalDir, '1-to-2.json'), JSON.stringify({
      spec: 'openstory-capability-migration@1',
      plugin: 'textplus',
      capability: 'text.analyze',
      from: 1,
      to: 2,
      state: 'failed',
      rolledBack: true,
      // 恶意/坏值：指向库外或 .history 之外，读侧必须拒绝拼路径。
      backupPath: '../../outside',
      files: [{ path: '.openstory/probe-data.json', beforeHash: 'c'.repeat(64), afterHash: null, backup: '.openstory/probe-data.json', committed: true }]
    }, null, 2), 'utf-8')

    const before = await treeDigest(item.root)
    const listed = await backups(item)
    assert.equal(listed.status, 200)
    assert.equal(listed.payload.healthy, false)
    const issue = listed.payload.issues.find((row) => row.code === 'MIGRATION_BACKUP_PATH_INVALID')
    assert.ok(issue, `应报 MIGRATION_BACKUP_PATH_INVALID：${JSON.stringify(listed.payload.issues)}`)
    assert.equal(issue.path, '.openstory/migrations/text.analyze/1-to-2.json')
    assert.equal(listed.payload.backups.length, 0)
    assert.equal(await treeDigest(item.root), before)
  })
})
