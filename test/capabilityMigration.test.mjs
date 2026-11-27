import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  dataAheadFrom,
  declaredCapabilityMigrations,
  migrationJournalPath,
  planCapabilityMigration,
  runCapabilityMigrations,
  validateCapabilityMigration
} from '../src/protocol/capabilityMigration.mjs'
import { diffPlanBindings } from '../src/protocol/upgradePlan.mjs'

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
    // 运行态：迁移上下文与提交落盘放开 .openstory/，.history 非本人备份目录仍禁止
    await assertRuntimeState()
    // OS-220：只读计划零写入、条目齐全、planId 绑定迁移器与文件摘要
    await assertOs220ReadonlyPlan()
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
    // 提交前 running 写完整计划；单文件提交失败时逆序回滚并逐条记录
    await assertJournalPlanAndRollback()
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
    // 部分提交恢复只还原已提交、未提交不动；备份缺失导致回滚失败时逐条上报并写 recovered
    await assertPartialRecovery()
    await assertRecoveryRollbackFailure()
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
  // suite 禁止携带迁移器
  assert.deepEqual(declaredCapabilityMigrations([
    { id: 'suite-evil', class: 'suite', migrations: [{ capability: 'fact.store', from: 3, to: 4, entry: 'm.mjs' }] },
    { id: 'fact-local', class: 'kernel', migrations: [{ capability: 'fact.store', from: 3, to: 4, entry: 'm.mjs' }] }
  ], () => '/pkg'), [{
    plugin: 'fact-local', packageDir: '/pkg', capability: 'fact.store', from: 3, to: 4, entry: 'm.mjs'
  }])
})

async function assertJournalPlanAndRollback() {
  const { base, root, pkg } = await makeFixture()
  try {
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator(`
      return { files: [
        { path: '故事源/book.json', content: '{"schema":"fact.data/v4"}' },
        { path: '故事源/book.json/nested.json', content: '{}' }
      ] }`))
    const migration = migrationOf(pkg)
    const result = await runCapabilityMigrations({ root, migrations: [migration] })
    assert.equal(result.ok, false)
    const failure = result.failures[0]
    assert.equal(failure.rolledBack, true)
    assert.deepEqual(failure.restored, ['故事源/book.json'])
    assert.equal(await readFile(join(root, '故事源', 'book.json'), 'utf8'), '{"schema":"fact.data/v3"}')
    assert.match(failure.message, /原数据已原样回滚/u)

    const journal = JSON.parse(await readFile(migrationJournalPath(root, migration), 'utf8'))
    assert.equal(journal.state, 'failed')
    assert.equal(journal.files.length, 2)
    assert.equal(journal.files[0].path, '故事源/book.json')
    assert.notEqual(journal.files[0].beforeHash, null)
    assert.equal(journal.files[0].backup, '故事源/book.json')
    assert.equal(journal.files[0].committed, true)
    assert.equal(journal.files[1].committed, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

async function assertPartialRecovery() {
  const { base, root, pkg } = await makeFixture()
  try {
    await mkdir(join(root, '.openstory', 'migrations', 'fact.store'), { recursive: true })
    await writeFile(join(root, '.openstory', 'state.json'), 'keep-me')
    const backupDir = join(root, '.history', 'capability-fact.store-3-to-4-old')
    await mkdir(join(backupDir, '故事源'), { recursive: true })
    await writeFile(join(backupDir, '故事源', 'book.json'), '{"schema":"fact.data/v3"}')
    const migration = migrationOf(pkg)
    await writeFile(migrationJournalPath(root, migration), JSON.stringify({
      spec: 'openstory-capability-migration@1',
      plugin: 'fact-local',
      capability: 'fact.store',
      from: 3,
      to: 4,
      state: 'running',
      backupPath: '.history/capability-fact.store-3-to-4-old',
      files: [
        { path: '故事源/book.json', backup: '故事源/book.json', committed: true },
        { path: '.openstory/state.json', backup: '.openstory/state.json', committed: false }
      ]
    }))
    await writeFile(join(root, '故事源', 'book.json'), '{"schema":"半迁"}')
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator(`
      return { files: [{ path: '.openstory/observed.json', content: '{"retried":true}' }] }`))

    const result = await runCapabilityMigrations({ root, migrations: [migration] })
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(result.ran[0].restored, ['故事源/book.json'])
    assert.equal(await readFile(join(root, '故事源', 'book.json'), 'utf8'), '{"schema":"fact.data/v3"}')
    assert.equal(await readFile(join(root, '.openstory', 'state.json'), 'utf8'), 'keep-me')
    assert.equal(JSON.parse(await readFile(join(root, '.openstory', 'observed.json'), 'utf8')).retried, true)
    assert.equal(JSON.parse(await readFile(migrationJournalPath(root, migration), 'utf8')).state, 'done')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

async function assertRecoveryRollbackFailure() {
  const { base, root, pkg } = await makeFixture()
  try {
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator('return { files: [] }'))
    await mkdir(join(root, '.history', 'capability-fact.store-3-to-4-old', '故事源'), { recursive: true })
    await mkdir(join(root, '.openstory', 'migrations', 'fact.store'), { recursive: true })
    const migration = migrationOf(pkg)
    await writeFile(migrationJournalPath(root, migration), JSON.stringify({
      spec: 'openstory-capability-migration@1',
      plugin: 'fact-local',
      capability: 'fact.store',
      from: 3,
      to: 4,
      state: 'running',
      backupPath: '.history/capability-fact.store-3-to-4-old',
      files: [{ path: '故事源/book.json', backup: '故事源/book.json', committed: true }]
    }))

    const result = await runCapabilityMigrations({ root, migrations: [migration] })
    assert.equal(result.ok, false)
    const failure = result.failures[0]
    assert.equal(failure.rolledBack, false)
    assert.equal(failure.reason, 'MIGRATION_RECOVERY_FAILED')
    assert.match(failure.message, /回滚未完成/u)
    assert.equal(failure.rollbackErrors.length, 1)
    assert.equal(failure.rollbackErrors[0].path, '故事源/book.json')
    assert.match(failure.rollbackErrors[0].error, /备份文件缺失/u)
    assert.deepEqual(failure.disable, ['fact-local'])

    const journal = JSON.parse(await readFile(migrationJournalPath(root, migration), 'utf8'))
    assert.equal(journal.state, 'recovered')
    assert.equal(journal.rollbackErrors.length, 1)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

async function assertRuntimeState() {
  const { base, root, pkg } = await makeFixture()
  try {
    await mkdir(join(root, '.openstory'), { recursive: true })
    await writeFile(join(root, '.openstory', 'state.json'), '{"schema":"v3"}')
    await mkdir(join(root, '.history'), { recursive: true })
    await writeFile(join(root, '.history', 'outsider.json'), 'secret')
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator(`
      const current = JSON.parse(await ctx.readFile('.openstory/state.json'))
      const files = await ctx.listFiles('.openstory')
      let historyBlocked = false
      try { await ctx.readFile('.history/outsider.json') } catch { historyBlocked = true }
      return { files: [{ path: '.openstory/state.json', content: JSON.stringify({
        schema: 'v4', from: current.schema, historyBlocked, listed: files.includes('state.json')
      }) }] }`))
    const migration = migrationOf(pkg)
    const result = await runCapabilityMigrations({ root, migrations: [migration], now: () => new Date('2026-01-02T03:04:05.000Z') })
    assert.equal(result.ok, true, JSON.stringify(result.failures))
    assert.deepEqual(JSON.parse(await readFile(join(root, '.openstory', 'state.json'), 'utf8')), {
      schema: 'v4', from: 'v3', historyBlocked: true, listed: true
    })
    const backup = await readFile(join(root, '.history', 'capability-fact.store-3-to-4-2026-01-02T03-04-05-000Z', '.openstory', 'state.json'), 'utf8')
    assert.equal(backup, '{"schema":"v3"}')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

/**
 * OS-220：能力迁移的只读计划——不建 journal、不建备份、不改数据；
 * 计划条目含 entrySha256、写前/写后哈希、备份范围、预计 journal/备份路径；
 * planId 绑定迁移器与受影响文件摘要，改文件即漂移。
 */
async function assertOs220ReadonlyPlan() {
  const { base, root, pkg } = await makeFixture()
  try {
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator(`
      const current = JSON.parse(await ctx.readFile('故事源/book.json'))
      return { files: [
        { path: '故事源/book.json', content: JSON.stringify({ schema: 'fact.data/v4' }) },
        { path: '故事源/new.json', content: '{"created":true}' }
      ] }`))
    const migration = migrationOf(pkg)
    const before = await readFile(join(root, '故事源', 'book.json'), 'utf8')
    const plan = await planCapabilityMigration(root, migration, { now: () => new Date('2026-06-07T08:09:10.011Z') })

    // ① 零写入：数据没变、journal 没建、.history 没建。
    assert.equal(await readFile(join(root, '故事源', 'book.json'), 'utf8'), before)
    await assert.rejects(stat(migrationJournalPath(root, migration)), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, '.history')), { code: 'ENOENT' })
    await assert.rejects(stat(join(root, '.openstory', 'migrations')), { code: 'ENOENT' })

    // ② 计划条目：状态、迁移器摘要、逐文件前后哈希、备份范围、预计路径。
    assert.equal(plan.status, 'pending')
    assert.equal(plan.entry, 'migrations/v3-to-v4.mjs')
    assert.match(plan.entrySha256, /^[0-9a-f]{64}$/u)
    assert.deepEqual(plan.backup.scope, ['故事源/book.json'])
    assert.equal(plan.backup.predictedDir, '.history/capability-fact.store-3-to-4-2026-06-07T08-09-10-011Z')
    assert.deepEqual(plan.operations.map((item) => [item.kind, item.path]), [
      ['update', '故事源/book.json'],
      ['create', '故事源/new.json']
    ])
    assert.equal(plan.operations[0].beforeHash.length, 64)
    assert.equal(plan.operations[0].afterHash.length, 64)
    assert.notEqual(plan.operations[0].beforeHash, plan.operations[0].afterHash)
    assert.equal(plan.operations[1].beforeHash, null)
    assert.deepEqual(plan.conflicts, [])
    assert.equal(plan.journal.state, 'absent')
    assert.equal(plan.journal.path, '.openstory/migrations/fact.store/3-to-4.json')

    // ③ 迁移摘要绑定：改迁移器 → 摘要变；改已存在的数据文件 → 文件绑定漂移。
    // 只有「执行前就存在」的文件才有文件绑定（新建文件不绑，靠 planId 的迁移器摘要区分）。
    const bindings = [
      { id: 'migrator', path: plan.entry, sha256: plan.entrySha256 },
      ...plan.operations
        .filter((item) => item.beforeHash)
        .map((item) => ({ id: `file:${item.path}`, path: item.path, sha256: item.beforeHash }))
    ]
    assert.deepEqual(bindings.map((item) => item.id), ['migrator', 'file:故事源/book.json'])
    assert.deepEqual(diffPlanBindings({ bindings }, Object.fromEntries(bindings.map((item) => [item.id, item.sha256]))), [])
    await writeFile(join(pkg, 'migrations', 'v3-to-v4.mjs'), migrator('return { files: [] }'))
    const changedEntry = await planCapabilityMigration(root, migration, { now: () => new Date('2026-06-07T08:09:10.011Z') })
    assert.notEqual(changedEntry.entrySha256, plan.entrySha256, '迁移器改动必须改变摘要')
    assert.deepEqual(changedEntry.operations, [])
    assert.deepEqual(diffPlanBindings({ bindings }, {
      migrator: changedEntry.entrySha256,
      'file:故事源/book.json': plan.operations[0].beforeHash
    }).map((item) => item.id), ['migrator'])

    // ④ 数据超前只报告、不跑降级。
    assert.deepEqual(dataAheadFrom({ 'fact.store': { provider: 'base', version: 3 } }, [{ capability: 'fact.store', to: 4, journalPath: 'j' }]), [{
      capability: 'fact.store', dataVersion: 4, provider: 'base', providerVersion: 3, journalPath: 'j',
      action: 'manual-downgrade-not-automatic',
      message: '库数据已是 fact.store@4，当前供给者 base@3 会误读；不自动降级，请恢复更高版本供给者或人工处置'
    }])

    // ⑤ 迁移器越界/无效声明不加载、不落盘。
    const invalid = await planCapabilityMigration(root, migrationOf(pkg, { entry: '../evil.mjs' }))
    assert.equal(invalid.status, 'invalid')
    assert.equal(invalid.reason, 'MIGRATION_ENTRY_INVALID')
    await assert.rejects(stat(migrationJournalPath(root, migration)), { code: 'ENOENT' })
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}