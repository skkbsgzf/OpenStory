/**
 * OS-166 本机院子：唯一路径来源＋首启迁移（node:test）。
 *
 * 纪律：所有输入都是临时 LOCALAPPDATA，绝不读、写、删真实院子；
 * 旧院只在夹具里造，且用 courtyard 导出的常量拼路径，不在测试里复制品牌字面量。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COURTYARD_DIR,
  LEGACY_COURTYARD_DIR,
  MIGRATION_MARKER,
  MIGRATION_SPEC,
  courtyardBase,
  courtyardPath,
  courtyardRoot,
  ensureCourtyard,
  legacyCourtyardPath
} from '../src/host/courtyard.mjs'

function fixture(tag) {
  const base = mkdtempSync(join(tmpdir(), `os166-${tag}-`))
  return {
    base,
    env: { LOCALAPPDATA: base, APPDATA: '' },
    cleanup: () => rmSync(base, { recursive: true, force: true })
  }
}

/** 递归列文件（相对路径、排序），不列目录项本身。 */
function listFiles(root, prefix = '') {
  if (!existsSync(root)) return []
  const out = []
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) out.push(...listFiles(join(root, entry.name), rel))
    else if (entry.isFile()) out.push(rel.replaceAll('\\', '/'))
  }
  return out.sort()
}

function seedLegacy(env, { withResidue = true } = {}) {
  const legacy = legacyCourtyardPath(env)
  mkdirSync(join(legacy, 'openstory', 'nested'), { recursive: true })
  writeFileSync(legacyCourtyardPath(env, 'agent-config.json'), '{"model":"x"}', 'utf-8')
  writeFileSync(legacyCourtyardPath(env, 'kb-config.json'), '{"collections":[]}', 'utf-8')
  writeFileSync(legacyCourtyardPath(env, 'openstory', 'suite-state.json'), '{}', 'utf-8')
  writeFileSync(legacyCourtyardPath(env, 'openstory', 'nested', 'note.md'), '保留', 'utf-8')
  if (withResidue) {
    writeFileSync(legacyCourtyardPath(env, 'agent-config.json.tmp-12345'), '半成品', 'utf-8')
    writeFileSync(legacyCourtyardPath(env, 'openstory', 'daemon.lock'), '{"pid":1}', 'utf-8')
  }
  return legacy
}

test('空环境首次调用：直接建新院，reason=created，不留半成品', () => {
  const f = fixture('empty')
  try {
    const first = ensureCourtyard(f.base)
    assert.deepEqual(first, { migrated: false, reason: 'created', entries: 0, skipped: [] })
    const root = courtyardRoot(f.env)
    assert.equal(existsSync(root), true)
    assert.equal(statSync(root).isDirectory(), true)
    assert.deepEqual(listFiles(root), [])
    assert.equal(existsSync(legacyCourtyardPath(f.env)), false)
  } finally { f.cleanup() }
})

test('旧院有数据：迁移留标记、跳过 *.tmp-* 与 daemon.lock、旧院原样保留', () => {
  const f = fixture('migrate')
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    const legacy = seedLegacy(f.env)
    const before = listFiles(legacy)
    const result = ensureCourtyard(f.base)

    assert.equal(result.migrated, true)
    assert.equal(result.reason, 'migrated')
    assert.equal(result.entries, 4)
    assert.deepEqual(result.skipped.map((p) => p.replaceAll('\\', '/')).sort(), [
      legacyCourtyardPath(f.env, 'agent-config.json.tmp-12345').replaceAll('\\', '/'),
      legacyCourtyardPath(f.env, 'openstory', 'daemon.lock').replaceAll('\\', '/')
    ].sort())

    const root = courtyardRoot(f.env)
    const files = listFiles(root)
    assert.deepEqual(files, [
      '.migrated-from-pinaxnext.json',
      'agent-config.json',
      'kb-config.json',
      'openstory/nested/note.md',
      'openstory/suite-state.json'
    ])

    const marker = JSON.parse(readFileSync(join(root, MIGRATION_MARKER), 'utf-8'))
    assert.equal(marker.schema, MIGRATION_SPEC)
    assert.equal(marker.from.replaceAll('\\', '/'), legacy.replaceAll('\\', '/'))
    assert.equal(marker.to.replaceAll('\\', '/'), root.replaceAll('\\', '/'))
    assert.equal(marker.entries, 4)
    assert.match(marker.at, /^\d{4}-\d{2}-\d{2}T/u)
    assert.match(marker.note, /旧院保留给 Pinax 桌面端/u)

    assert.deepEqual(listFiles(legacy), before)
    assert.equal(readFileSync(legacyCourtyardPath(f.env, 'agent-config.json'), 'utf-8'), '{"model":"x"}')
    assert.equal(existsSync(legacyCourtyardPath(f.env, 'agent-config.json.tmp-12345')), true)
    assert.equal(existsSync(join(root, 'agent-config.json.tmp-12345')), false)
    assert.equal(existsSync(join(root, 'openstory', 'daemon.lock')), false)
    assert.equal(errors.some((line) => line.includes('旧院保留给 Pinax 桌面端')), true)
  } finally {
    console.error = original
    f.cleanup()
  }
})

test('重复调用幂等：第二次不重拷、不改标记', () => {
  const f = fixture('idempotent')
  try {
    seedLegacy(f.env, { withResidue: false })
    const first = ensureCourtyard(f.base)
    const root = courtyardRoot(f.env)
    const markerBefore = readFileSync(join(root, MIGRATION_MARKER), 'utf-8')
    const second = ensureCourtyard(f.base)
    assert.deepEqual(second, { migrated: false, reason: 'handled', entries: 0, skipped: [] })
    assert.equal(first.migrated, true)
    assert.equal(readFileSync(join(root, MIGRATION_MARKER), 'utf-8'), markerBefore)
    assert.deepEqual(listFiles(root), [
      '.migrated-from-pinaxnext.json',
      'agent-config.json',
      'kb-config.json',
      'openstory/nested/note.md',
      'openstory/suite-state.json'
    ])
  } finally { f.cleanup() }
})

test('目标院已存在（哪怕没标记）也不重复迁移，旧院不动', () => {
  const f = fixture('target-exists')
  try {
    const legacy = seedLegacy(f.env, { withResidue: false })
    const before = listFiles(legacy)
    const target = join(f.base, COURTYARD_DIR)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'keep-me.json'), '{}', 'utf-8')
    const result = ensureCourtyard(f.base)
    assert.equal(result.migrated, false)
    assert.equal(result.reason, 'target-exists')
    assert.deepEqual(listFiles(target), ['keep-me.json'])
    assert.equal(existsSync(join(target, MIGRATION_MARKER)), false)
    assert.deepEqual(listFiles(legacy), before)
  } finally { f.cleanup() }
})

test('LOCALAPPDATA 缺失：返回空并给出 no-base 原因，绝不静默猜路径', () => {
  assert.deepEqual(ensureCourtyard(''), { migrated: false, reason: 'no-base', entries: 0, skipped: [] })
  assert.equal(courtyardBase({}), '')
  assert.equal(courtyardRoot({}), '')
  assert.equal(courtyardPath({}, 'openstory', 'agent-config.json'), '')
  assert.equal(legacyCourtyardPath({}, 'next-preferences.json'), '')
})

test('APPDATA 兜底与路径拼接：所有调用点都从新院根派生', () => {
  const f = fixture('fallback')
  try {
    const env = { LOCALAPPDATA: '', APPDATA: f.base }
    const root = courtyardRoot(env)
    assert.equal(root.replaceAll('\\', '/'), join(f.base, COURTYARD_DIR).replaceAll('\\', '/'))
    assert.equal(existsSync(root), true)
    assert.equal(
      courtyardPath(env, 'openstory', 'agent-config.json').replaceAll('\\', '/'),
      join(root, 'openstory', 'agent-config.json').replaceAll('\\', '/')
    )
    assert.equal(
      legacyCourtyardPath(env, 'next-preferences.json').replaceAll('\\', '/'),
      join(f.base, LEGACY_COURTYARD_DIR, 'next-preferences.json').replaceAll('\\', '/')
    )
  } finally { f.cleanup() }
})
