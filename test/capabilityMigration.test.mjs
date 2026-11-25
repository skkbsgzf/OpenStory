import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  declaredCapabilityMigrations,
  migrationJournalPath,
  runCapabilityMigrations,
  validateCapabilityMigration
} from '../src/protocol/capabilityMigration.mjs'

const migrator = (body) => `export default async function migrate(ctx) {\n${body}\n}\n`
const migrationOf = (packageDir, overrides = {}) => ({
  plugin: 'fact-local',
  packageDir,
  capability: 'fact.store',
  from: 3,
  to: 4,
  entry: 'migrations/v3-to-v4.mjs',
  ...overrides
})

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-capability-migration-'))
  const root = join(base, '夹具库')
  const pkg = join(base, '本机包')
  await mkdir(join(root, '故事源'), { recursive: true })
  await mkdir(join(pkg, 'migrations'), { recursive: true })
  await writeFile(join(root, '故事源', 'book.json'), '{"schema":"fact.data/v3"}')
  return { base, root, pkg }
}

async function readAllLogs(root, module) {
  const dir = join(root, '.openstory', 'log', module)
  const files = await readdir(dir)
  const parts = await Promise.all(files.map((file) => readFile(join(dir, file), 'utf8')))
  return parts.join('')
}

test('迁移成功：物理写盘、journal 记 done、备份留 .history、changelog 留痕、重跑幂等跳过', async () => {
  const { base, root, pkg } = await makeFixture()
  try {
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator(`
      const current = await ctx.readFile('故事源/book.json')
      const data = JSON.parse(current)
      data.schema = 'fact.data/v4'
      return { files: [{ path: '故事源/book.json', content: JSON.stringify(data) }] }`))
    const migration = migrationOf(pkg)

    const result = await runCapabilityMigrations({ root, migrations: [migration], now: () => new Date('2026-01-02T03:04:05.000Z') })
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.equal(result.ran.length, 1)
    assert.equal(JSON.parse(await readFile(join(root, '故事源', 'book.json'), 'utf8')).schema, 'fact.data/v4')

    const journal = JSON.parse(await readFile(migrationJournalPath(root, migration), 'utf8'))
    assert.equal(journal.state, 'done')
    assert.equal(journal.spec, 'openstory-capability-migration@1')
    assert.equal(journal.entrySha256.length, 64)
    assert.equal(journal.files.length, 1)
    assert.notEqual(journal.files[0].beforeHash, journal.files[0].afterHash)
    assert.equal(journal.files[0].backup, '故事源/book.json')

    const backup = await readFile(join(root, '.history', 'capability-fact.store-3-to-4-2026-01-02T03-04-05-000Z', '故事源', 'book.json'), 'utf8')
    assert.equal(backup, '{"schema":"fact.data/v3"}')
    assert.match(await readAllLogs(root, 'fact-local'), /"actor":"migration"/u)

    const again = await runCapabilityMigrations({ root, migrations: [migration] })
    assert.equal(again.ok, true)
    assert.equal(again.skipped.length, 1)
    assert.equal(again.skipped[0].entryChanged, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('迁移器抛错：原数据不动、journal 记 failed、覆盖者列入禁用', async () => {
  const { base, root, pkg } = await makeFixture()
  try {
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator(`
      await ctx.readFile('故事源/book.json')
      throw new Error('boom')`))
    const migration = migrationOf(pkg)
    const result = await runCapabilityMigrations({ root, migrations: [migration] })
    assert.equal(result.ok, false)
    assert.equal(result.failures.length, 1)
    assert.equal(result.failures[0].code, 'MIGRATION_FAILED')
    assert.deepEqual(result.disable, ['fact-local'])
    assert.equal(await readFile(join(root, '故事源', 'book.json'), 'utf8'), '{"schema":"fact.data/v3"}')
    const journal = JSON.parse(await readFile(migrationJournalPath(root, migration), 'utf8'))
    assert.equal(journal.state, 'failed')
    assert.match(journal.error, /boom/u)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('迁移声明：跨档、越界入口、非法能力与非法入口后缀一律不受理且不落 journal', async () => {
  const { base, root, pkg } = await makeFixture()
  try {
    assert.equal(validateCapabilityMigration(migrationOf(pkg, { to: 5 }), { packageDir: pkg }).reason, 'MIGRATION_VERSION_GAP')
    assert.equal(validateCapabilityMigration(migrationOf(pkg, { entry: '../evil.mjs' }), { packageDir: pkg }).reason, 'MIGRATION_ENTRY_INVALID')
    assert.equal(validateCapabilityMigration(migrationOf(pkg, { entry: 'migrations/x.js' }), { packageDir: pkg }).reason, 'MIGRATION_ENTRY_INVALID')
    assert.equal(validateCapabilityMigration(migrationOf(pkg, { capability: 'fact' }), { packageDir: pkg }).reason, 'MIGRATION_INVALID')
    assert.equal(validateCapabilityMigration(migrationOf(pkg), { packageDir: '' }).reason, 'MIGRATION_ENTRY_INVALID')

    const result = await runCapabilityMigrations({ root, migrations: [migrationOf(pkg, { entry: '../evil.mjs' })] })
    assert.equal(result.ok, false)
    assert.equal(result.failures[0].reason, 'MIGRATION_ENTRY_INVALID')
    await assert.rejects(stat(migrationJournalPath(root, migrationOf(pkg))))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('中断的 journal：先按备份恢复原格式，再重试，绝不盲跑半迁数据', async () => {
  const { base, root, pkg } = await makeFixture()
  try {
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator(`
      await ctx.readFile('故事源/book.json')
      throw new Error('still-broken')`))
    const migration = migrationOf(pkg)
    const journalPath = migrationJournalPath(root, migration)
    const backupDir = join(root, '.history', 'capability-fact.store-3-to-4-old')
    await mkdir(join(backupDir, '故事源'), { recursive: true })
    await writeFile(join(backupDir, '故事源', 'book.json'), '{"schema":"fact.data/v3"}')
    await mkdir(join(root, '.openstory', 'migrations', 'fact.store'), { recursive: true })
    await writeFile(journalPath, JSON.stringify({
      spec: 'openstory-capability-migration@1',
      plugin: 'fact-local',
      capability: 'fact.store',
      from: 3,
      to: 4,
      state: 'running',
      backupPath: '.history/capability-fact.store-3-to-4-old',
      files: [{ path: '故事源/book.json', backup: '故事源/book.json' }]
    }))
    await writeFile(join(root, '故事源', 'book.json'), '{"schema":"半迁"}')

    const result = await runCapabilityMigrations({ root, migrations: [migration] })
    assert.equal(result.ok, false)
    assert.ok(result.failures[0].restored.includes('故事源/book.json'))
    assert.equal(await readFile(join(root, '故事源', 'book.json'), 'utf8'), '{"schema":"fact.data/v3"}')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('声明收集：manifest 的 migrations 带包目录展开，不改写原始字段', () => {
  const manifests = [
    { id: 'fact-local', migrations: [{ capability: 'fact.store', from: 3, to: 4, entry: 'migrations/v3-to-v4.mjs' }] },
    { id: 'plain', migrations: [] }
  ]
  assert.deepEqual(declaredCapabilityMigrations(manifests, (id) => `/pkg/${id}`), [{
    plugin: 'fact-local',
    packageDir: '/pkg/fact-local',
    capability: 'fact.store',
    from: 3,
    to: 4,
    entry: 'migrations/v3-to-v4.mjs'
  }])
})