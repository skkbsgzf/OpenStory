/**
 * OS-152 管道件转自有护栏（node:test，零依赖）——src/kernel/{errors,atomicWrite,fsDurability}.mjs。
 *
 * 影子迁移（设计稿 §0.3-1）：三件**复制**进 src/kernel/（OS-156 起 core 原件已删，本目录是唯一真源）。
 * 因此这里做三类锁：
 *   ① 码表 26 个**值**逐字锁定（快照式）——表名可改（NEXT_ERROR_CODES→KERNEL_ERROR_CODES），
 *      值一条都不许动（值就是经 /api 出去的 code，OS-157 才谈改名）；
 *   ② 行为锁：未知码回落 INVALID_INPUT、原子写的失败清场/前缀/目录 fsync、syncDirectory
 *      对「平台不支持目录 fsync」的免疫；
 *   ③ 金样锁：三件的调用序/返回值/字节在 OS-156 删除 core 原件前由 src≡core 实测冻结，
 *      此后按金样逐字比对（core 不再需要）。
 *
 * 测试只碰 mkdtemp 临时目录，绝不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, open, readdir, readFile, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'

import { KERNEL_ERROR_CODES, ok, fail, throwFailure } from '../src/kernel/errors.mjs'
import { writeFileAtomic, TMP_PREFIX, recoverInterruptedWrites } from '../src/kernel/atomicWrite.mjs'
import { syncDirectory } from '../src/kernel/fsDurability.mjs'

/** 码表值快照（键序＝源文件声明序）。改这里＝改对外 code，要等 OS-157 的显式改名单。
 *  条数说明：工单/设计稿写「26 个码」，源文件实测 25 条（core 原件同）——快照按实测锁 25，
 *  不为了让数字对上而复刻一条不存在的码（见交付说明 limitations）。 */
const CODE_SNAPSHOT = {
  INVALID_MANIFEST: 'PINAX_INVALID_MANIFEST',
  DUPLICATE_PLUGIN: 'PINAX_DUPLICATE_PLUGIN',
  KERNEL_INCOMPATIBLE: 'PINAX_KERNEL_INCOMPATIBLE',
  RESERVED_SLOT: 'PINAX_RESERVED_SLOT',
  TOOL_CONFLICT: 'PINAX_TOOL_CONFLICT',
  UNKNOWN_CAPABILITY: 'PINAX_UNKNOWN_CAPABILITY',
  DIR_CONFLICT: 'PINAX_DIR_CONFLICT',
  SCOPE_NOT_GRANTED: 'PINAX_SCOPE_NOT_GRANTED',
  SCOPE_OUTSIDE_OWNER: 'PINAX_SCOPE_OUTSIDE_OWNER',
  RESERVED_VIEW_TYPE: 'PINAX_RESERVED_VIEW_TYPE',
  UNKNOWN_SUBSCRIPTION: 'PINAX_UNKNOWN_SUBSCRIPTION',
  INVALID_ENTRY: 'PINAX_INVALID_ENTRY',
  INVALID_SERVICE: 'PINAX_INVALID_SERVICE',
  INVALID_MCP: 'PINAX_INVALID_MCP',
  INVALID_EFFECT: 'PINAX_INVALID_EFFECT',
  EFFECT_ON_DISPOSED: 'PINAX_EFFECT_ON_DISPOSED',
  PATH_OUTSIDE_PROJECT: 'PINAX_PATH_OUTSIDE_PROJECT',
  STALE_REVISION: 'PINAX_STALE_REVISION',
  DEPENDENCY_UNMET: 'PINAX_DEPENDENCY_UNMET',
  PRIMARY_CARRIER_MISSING: 'PINAX_PRIMARY_CARRIER_MISSING',
  PRIMARY_CARRIER_NOT_ENABLED: 'PINAX_PRIMARY_CARRIER_NOT_ENABLED',
  IO_FAILED: 'PINAX_IO_FAILED',
  INVALID_INPUT: 'PINAX_INVALID_INPUT',
  FACT_NOT_FOUND: 'PINAX_FACT_NOT_FOUND',
  WRITE_PROTOCOL_NOT_STARTED: 'PINAX_WRITE_PROTOCOL_NOT_STARTED'
}

async function fixture(prefix = 'os152-plumber-') {
  const root = await mkdtemp(join(tmpdir(), prefix))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function tmpLeftovers(dir) {
  return (await readdir(dir)).filter((name) => name.startsWith(TMP_PREFIX))
}

/** 记录一切调用的假文件句柄（配合注入的 open 桩，可观察 fsync/close 次序）。 */
function recordingHandle(calls) {
  return {
    writeFile: async (contents, encoding) => { calls.push(['writeFile', contents, encoding]) },
    sync: async () => { calls.push(['sync']) },
    close: async () => { calls.push(['close']) }
  }
}

/** 注入桩版 writeFileAtomic 的依赖包：open 记账、rename/unlink 可编程。 */
function stubDeps({ calls = [], rename, unlink } = {}) {
  const openStub = async (path, flag) => {
    calls.push(['open', path, flag])
    return recordingHandle(calls)
  }
  return {
    calls,
    deps: {
      open: openStub,
      rename: rename || (async (from, to) => { calls.push(['rename', from, to]) }),
      unlink: unlink || (async (path) => { calls.push(['unlink', path]) })
    }
  }
}

/* ---------- ① 码表逐字锁定 ---------- */

test('码表值逐字锁定（表名 KERNEL_ERROR_CODES；值仍是 PINAX_*，本单不改值）', () => {
  const keys = Object.keys(KERNEL_ERROR_CODES)
  assert.equal(keys.length, 25, '码表条数＝25（源文件实测；少一条/多一条都是破坏对外 code 词表）')
  assert.equal(keys.length, Object.keys(CODE_SNAPSHOT).length)
  assert.deepEqual(keys, Object.keys(CODE_SNAPSHOT), '键序与声明序一致（防顺手重排）')
  assert.deepEqual({ ...KERNEL_ERROR_CODES }, CODE_SNAPSHOT)
  for (const [key, value] of Object.entries(CODE_SNAPSHOT)) {
    assert.equal(typeof value, 'string', `${key} 的值必须是字符串`)
    assert.ok(value.startsWith('PINAX_'), `${key} 的值仍带 PINAX_ 前缀：${value}`)
  }
  assert.equal(Object.isFrozen(KERNEL_ERROR_CODES), true, '码表冻结，消费方不许改写')
})

test('未知码回落 INVALID_INPUT（值仍是 PINAX_INVALID_INPUT）', () => {
  const rejection = fail('不存在的码', '人话')
  assert.equal(rejection.ok, false)
  assert.equal(rejection.error.code, 'PINAX_INVALID_INPUT')
  assert.equal(rejection.error.code, KERNEL_ERROR_CODES.INVALID_INPUT)
  assert.equal(rejection.error.message, '人话')
  assert.equal('details' in rejection.error, false, '空 details 不挂字段')
})

test('ok／fail／throwFailure 信封形状逐字保留', () => {
  assert.deepEqual(ok(42), { ok: true, value: 42 })
  assert.deepEqual(ok(undefined), { ok: true, value: undefined })
  assert.deepEqual(fail('STALE_REVISION', '过期', { expected: 1, actual: 2 }), {
    ok: false,
    error: { code: 'PINAX_STALE_REVISION', message: '过期', details: { expected: 1, actual: 2 } }
  })
  assert.deepEqual(fail('STALE_REVISION', '过期', {}), { ok: false, error: { code: 'PINAX_STALE_REVISION', message: '过期' } })
  assert.throws(() => throwFailure(fail('IO_FAILED', '写失败', { path: 'x' })), (error) => {
    assert.equal(error.message, '写失败')
    assert.equal(error.code, 'PINAX_IO_FAILED')
    assert.deepEqual(error.details, { path: 'x' })
    return true
  })
  assert.throws(() => throwFailure({ ok: false }), (error) => {
    assert.equal(error.code, 'PINAX_INVALID_INPUT')
    assert.equal(error.details, null)
    return true
  })
})

/* ---------- ② writeFileAtomic 三条行为 ---------- */

test('writeFileAtomic 成功：完整落盘＋前缀正确＋目录 fsync 真被调用（open 桩取证）', async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, '正文', '001-第一章.md')
    await mkdir(dirname(target), { recursive: true })
    const contents = '# 第一章\n\n中文段落：山有扶苏。\n'
    const returned = await writeFileAtomic(target, contents)
    assert.equal(returned, target, '返回目标绝对路径')
    assert.equal(await readFile(target, 'utf-8'), contents)
    assert.deepEqual(await tmpLeftovers(root), [], '成功后不留临时文件')

    /* 注入桩：第一次 open＝临时文件（同目录、TMP_PREFIX 前缀、'w'），
       第二次 open＝syncDirectory 打开目录（'r'）——即目录 fsync 真被调用。 */
    const { calls, deps } = stubDeps()
    const stubbed = join(root, '正文', 'stub.md')
    await writeFileAtomic(stubbed, 'x', deps)
    const opens = calls.filter(([kind]) => kind === 'open')
    assert.equal(opens.length, 2, `应有两次 open（临时文件＋目录），实际：${JSON.stringify(opens)}`)
    assert.equal(dirname(opens[0][1]), dirname(stubbed), '临时文件与目标同目录（rename 才原子）')
    assert.ok(basename(opens[0][1]).startsWith('.pinax-tmp-'), `临时文件名带前缀：${basename(opens[0][1])}`)
    assert.equal(opens[0][2], 'w')
    assert.equal(opens[1][1], dirname(stubbed), '第二次 open 是目录（syncDirectory）')
    assert.equal(opens[1][2], 'r')
    assert.equal(calls.filter(([kind]) => kind === 'sync').length, 2, '文件 fsync ＋目录 fsync 各一次')
  } finally { await cleanup() }
})

test('writeFileAtomic 失败清场：临时文件必被 unlink，目标文件原样', async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, 'state.json')
    await writeFile(target, '{"keep":"原稿"}', 'utf-8')
    /* rename 抛错＝写完临时文件后失败：应 unlink 临时文件并原样抛错 */
    const removed = []
    const { deps } = stubDeps({
      rename: async () => { throw Object.assign(new Error('rename 失败'), { code: 'EIO' }) },
      unlink: async (path) => { removed.push(path) }
    })
    await assert.rejects(() => writeFileAtomic(target, '{"new":"覆盖"}', deps), (error) => error.code === 'EIO')
    assert.equal(removed.length, 1, '失败必须清场（unlink 临时文件）')
    assert.ok(basename(removed[0]).startsWith('.pinax-tmp-'), '清的是临时文件，不是正文')
    assert.equal(await readFile(target, 'utf-8'), '{"keep":"原稿"}', '目标文件完好')

    /* 真文件系统同一路径再验一遍：干净目录里不留半成品（open/unlink 走真 fs，rename 注入失败） */
    const fresh = join(root, 'fresh')
    await mkdir(fresh)
    const freshTarget = join(fresh, 'a.md')
    await assert.rejects(
      () => writeFileAtomic(freshTarget, 'x', { open, unlink, rename: async () => { throw Object.assign(new Error('boom'), { code: 'EIO' }) } }),
      (error) => error.code === 'EIO'
    )
    assert.deepEqual(await tmpLeftovers(fresh), [], '失败后目录里没有 .pinax-tmp-*')
  } finally { await cleanup() }
})

test('TMP_PREFIX 是 .pinax-tmp-（recoverInterruptedWrites 的回收口径）', () => {
  assert.equal(TMP_PREFIX, '.pinax-tmp-')
})

test('recoverInterruptedWrites 只清 .pinax-tmp-*，绝不误删正文；目录缺失＝skipped', async () => {
  const { root, cleanup } = await fixture()
  try {
    await writeFile(join(root, '001-第一章.md'), '正文', 'utf-8')
    await writeFile(join(root, `${TMP_PREFIX}aaaaaa`), '半成品', 'utf-8')
    await writeFile(join(root, `${TMP_PREFIX}bbbbbb`), '半成品', 'utf-8')
    const recovered = await recoverInterruptedWrites(root)
    assert.equal(recovered.skipped, false)
    assert.deepEqual(recovered.removed.sort(), [`${TMP_PREFIX}aaaaaa`, `${TMP_PREFIX}bbbbbb`])
    assert.deepEqual((await readdir(root)).sort(), ['001-第一章.md'])
    const missing = await recoverInterruptedWrites(join(root, '不存在'))
    assert.deepEqual(missing, { removed: [], skipped: true })
  } finally { await cleanup() }
})

/* ---------- ③ syncDirectory 的免疫面 ---------- */

test('syncDirectory：平台不支持的目录 fsync（EINVAL/ENOTSUP/EISDIR/win32 EPERM）静默通过，真错照抛', async () => {
  const swallow = ['EINVAL', 'ENOTSUP', 'EISDIR']
  for (const code of swallow) {
    await syncDirectory('/whatever', { open: async () => { throw Object.assign(new Error(code), { code }) }, platform: 'linux' })
  }
  /* win32 的 EPERM（目录句柄不可 fsync）按平台豁免 */
  await syncDirectory('/whatever', { open: async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) }, platform: 'win32' })
  /* 非 win32 的 EPERM、或其它错码＝真错，必须抛出 */
  await assert.rejects(
    () => syncDirectory('/whatever', { open: async () => { throw Object.assign(new Error('EPERM'), { code: 'EPERM' }) }, platform: 'linux' }),
    (error) => error.code === 'EPERM'
  )
  await assert.rejects(
    () => syncDirectory('/whatever', { open: async () => { throw Object.assign(new Error('no'), { code: 'EACCES' }) }, platform: 'win32' }),
    (error) => error.code === 'EACCES'
  )
  /* 成功路径：开目录 → sync → close */
  const calls = []
  await syncDirectory('/whatever', { open: async (path, flag) => { calls.push(['open', path, flag]); return recordingHandle(calls) } })
  assert.deepEqual(calls.map(([kind]) => kind), ['open', 'sync', 'close'])
  assert.equal(calls[0][2], 'r')
})

/* ---------- ④ 金样（OS-156 删除 core 原件前，src≡core 对拍实测冻结） ---------- */

test('金样：码表 × fail 输出的全矩阵冻结（键序/值/details 分支/未知码回落/ok）', () => {
  const matrix = []
  for (const key of Object.keys(KERNEL_ERROR_CODES)) matrix.push([key, fail(key, 'msg')])
  matrix.push(['UNKNOWN_CODENAME', fail('UNKNOWN_CODENAME', 'msg')])
  matrix.push(['IO_FAILED+details', fail('IO_FAILED', 'msg', { a: 1 })])
  matrix.push(['ok', ok({ a: 1 })])
  const digest = createHash('sha256').update(JSON.stringify(matrix)).digest('hex')
  /* 删除 core 原件前的实测值：当时同一矩阵与 core 原件 fail/ok 输出逐条深等。 */
  assert.equal(digest, '037fdac7038d546ef3d35c002c6e275ff0d0b04fc755a0d00766d88a42c7c2fe')
})

test('金样：writeFileAtomic 同一注入桩下调用序与返回值冻结（临时文件→fsync→rename→目录 fsync）', async () => {
  const target = join(tmpdir(), 'os152-equiv', 'x.md')
  /* 临时文件名含随机 hex、target 含机器相关 tmpdir：都洗成占位符后比调用序（顺序与参数一个不许差） */
  const scrub = (value) => {
    if (typeof value !== 'string') return value
    if (basename(value).startsWith(TMP_PREFIX)) return '<tmp>'
    if (value === target) return '<target>'
    if (value === dirname(target)) return '<dir>'
    return value
  }
  const { calls, deps } = stubDeps()
  const returned = await writeFileAtomic(target, '内容', deps)
  assert.equal(returned, target, '返回目标绝对路径')
  assert.deepEqual(calls.map(([kind, ...rest]) => [kind, ...rest.map(scrub)]), [
    ['open', '<tmp>', 'w'],
    ['writeFile', '内容', 'utf-8'],
    ['sync'],
    ['close'],
    ['rename', '<tmp>', '<target>'],
    ['open', '<dir>', 'r'],
    ['sync'],
    ['close']
  ])
})

test('金样：recoverInterruptedWrites 对同一现场返回同一结果（removed 列表与 skipped 档）', async () => {
  const { root, cleanup } = await fixture('os152-rec-')
  try {
    await writeFile(join(root, '正文.md'), '正文', 'utf-8')
    await writeFile(join(root, `${TMP_PREFIX}123456`), 'x', 'utf-8')
    await writeFile(join(root, `${TMP_PREFIX}654321`), 'x', 'utf-8')
    const recovered = await recoverInterruptedWrites(root)
    assert.deepEqual({ ...recovered, removed: [...recovered.removed].sort() }, {
      removed: [`${TMP_PREFIX}123456`, `${TMP_PREFIX}654321`],
      skipped: false
    })
    assert.deepEqual((await readdir(root)).sort(), ['正文.md'], '半成品清干净、正文完好')
    assert.deepEqual(await recoverInterruptedWrites(join(root, '不存在')), { removed: [], skipped: true })
  } finally { await cleanup() }
})

test('金样：syncDirectory 对错码 × 平台的吞吐矩阵冻结（豁免面与 core 原件同口径）', async () => {
  const cases = [
    { code: 'EINVAL', platform: 'linux' },
    { code: 'ENOTSUP', platform: 'linux' },
    { code: 'EISDIR', platform: 'linux' },
    { code: 'EPERM', platform: 'win32' },
    { code: 'EPERM', platform: 'linux' },
    { code: 'EACCES', platform: 'win32' },
    { code: 'ENOENT', platform: 'linux' }
  ]
  /* 删除 core 原件前的实测值（当时与 core 原件逐格同值） */
  const golden = [
    'resolved',
    'resolved',
    'resolved',
    'resolved',
    'rejected:EPERM',
    'rejected:EACCES',
    'rejected:ENOENT'
  ]
  for (const [index, item] of cases.entries()) {
    const outcome = await (async () => {
      try {
        await syncDirectory('/whatever', { open: async () => { throw Object.assign(new Error(item.code), { code: item.code }) }, platform: item.platform })
        return 'resolved'
      } catch (error) {
        return `rejected:${error.code}`
      }
    })()
    assert.equal(outcome, golden[index], `${item.platform}/${item.code} 行为与金样不符`)
  }
})

test('金样：真落盘字节逐字节冻结（CRLF 原样保留，不做行尾改写）', async () => {
  const { root, cleanup } = await fixture('os152-bytes-')
  try {
    const contents = '第一章\r\n中文：隰有荷华。\n尾行\n'
    await writeFileAtomic(join(root, 'x.md'), contents)
    const written = await readFile(join(root, 'x.md'))
    assert.deepEqual(written, Buffer.from(contents, 'utf-8'), '写入字节与入参逐字节相同')
  } finally { await cleanup() }
})
