/**
 * OS-166 / OS-189 本机院子：唯一路径来源＋旧院克隆已退役（node:test）。
 *
 * 纪律：所有输入都是临时 LOCALAPPDATA，绝不读、写、删真实院子。
 * 反向守卫：旧院即便在，也只当作无关目录——不读、不写、不删、不留标记。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  COURTYARD_DIR,
  courtyardBase,
  courtyardPath,
  courtyardRoot,
  ensureCourtyard
} from '../src/host/courtyard.mjs'

/** 夹具里的历史目录硬编码：产品代码不再认识这个名字，测试专门用它验证「不被读」。 */
const OLD_COURTYARD = 'PinaxNext'
const OLD_MARKER = '.migrated-from-pinaxnext.json'

function fixture(tag) {
  const base = mkdtempSync(join(tmpdir(), `os189-courtyard-${tag}-`))
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

/** 逐文件字节快照：证明历史目录逐字节不变。 */
function snapshot(root, prefix = '') {
  const out = new Map()
  for (const rel of listFiles(root, prefix)) out.set(rel, readFileSync(join(root, rel)))
  return out
}

function seedOldCourtyard(env) {
  const old = join(env.LOCALAPPDATA, OLD_COURTYARD)
  mkdirSync(join(old, 'openstory', 'nested'), { recursive: true })
  writeFileSync(join(old, 'agent-config.json'), '{"model":"x"}', 'utf-8')
  writeFileSync(join(old, 'kb-config.json'), '{"collections":[]}', 'utf-8')
  writeFileSync(join(old, 'openstory', 'suite-state.json'), '{}', 'utf-8')
  writeFileSync(join(old, 'openstory', 'nested', 'note.md'), '保留', 'utf-8')
  writeFileSync(join(old, OLD_MARKER), '{"schema":"旧标记"}', 'utf-8')
  writeFileSync(join(old, 'agent-config.json.tmp-12345'), '半成品', 'utf-8')
  writeFileSync(join(old, 'openstory', 'daemon.lock'), '{"pid":1}', 'utf-8')
  return old
}

test('空环境首次调用：直接建新院，不留标记', () => {
  const f = fixture('empty')
  try {
    assert.deepEqual(ensureCourtyard(f.base), { created: true, reason: 'created' })
    const root = courtyardRoot(f.env)
    assert.equal(existsSync(root), true)
    assert.equal(statSync(root).isDirectory(), true)
    assert.deepEqual(listFiles(root), [])
  } finally { f.cleanup() }
})

test('旧院在、新院不在：新院空、旧院逐字节不变、没有标记文件、不输出迁移日志', () => {
  const f = fixture('old-present')
  const errors = []
  const original = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    const old = seedOldCourtyard(f.env)
    const before = snapshot(old)

    assert.deepEqual(ensureCourtyard(f.base), { created: true, reason: 'created' })
    const root = courtyardRoot(f.env)

    assert.deepEqual(listFiles(root), [], '新院只有空目录，没有从旧院拷来任何文件')
    assert.deepEqual([...snapshot(old)], [...before], '旧院文件清单不变')
    for (const [rel, bytes] of before) {
      assert.deepEqual(readFileSync(join(old, rel)), bytes, `旧院 ${rel} 逐字节不变`)
    }
    assert.equal(existsSync(join(old, OLD_MARKER)), true, '旧院里已有的标记文件不删')
    assert.equal(existsSync(join(root, OLD_MARKER)), false, '新院没有标记文件')
    assert.deepEqual(errors, [], '没有迁移日志输出')
  } finally {
    console.error = original
    f.cleanup()
  }
})

test('目标院已存在（含已有标记文件）也不删、不改', () => {
  const f = fixture('target-exists')
  try {
    const old = seedOldCourtyard(f.env)
    const before = snapshot(old)
    const target = join(f.base, COURTYARD_DIR)
    mkdirSync(target, { recursive: true })
    writeFileSync(join(target, 'keep-me.json'), '{}', 'utf-8')
    writeFileSync(join(target, OLD_MARKER), '{"existing":true}', 'utf-8')

    assert.deepEqual(ensureCourtyard(f.base), { created: false, reason: 'target-exists' })
    assert.deepEqual(listFiles(target), [OLD_MARKER, 'keep-me.json'])
    assert.equal(readFileSync(join(target, OLD_MARKER), 'utf-8'), '{"existing":true}')
    for (const [rel, bytes] of before) assert.deepEqual(readFileSync(join(old, rel)), bytes)
  } finally { f.cleanup() }
})

test('LOCALAPPDATA 缺失：返回空并给出 no-base 原因，绝不静默猜路径', () => {
  assert.deepEqual(ensureCourtyard(''), { created: false, reason: 'no-base' })
  assert.equal(courtyardBase({}), '')
  assert.equal(courtyardRoot({}), '')
  assert.equal(courtyardPath({}, 'openstory', 'agent-config.json'), '')
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
  } finally { f.cleanup() }
})
