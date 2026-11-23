/**
 * hostWrite 单测（OS-138 原子写收敛）。
 * 钉宿主写协议唯一入口 atomicWriteFile 的三条硬保证：
 *   ① 目标已存在＝完整替换（不追写、不留旧字节）；
 *   ② 落盘内容逐字节一致（文本含多字节中文；二进制 Buffer 不经 String/utf-8 损坏）；
 *   ③ 写失败＝原文件完好＋目录里不留 .pinax-tmp-* 半成品（内核/分支的失败清场）。
 * 失败注入按平台取确定性手法：win32 用只读属性（MoveFileEx 拒绝替换只读目标），
 * posix 用目录 0o555（临时文件 open 直接 EACCES）。
 */
import { strict as assert } from 'node:assert'
import { readdir, readFile, writeFile, chmod, mkdir } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { atomicWriteFile } from '../src/protocol/hostWrite.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'os-hostwrite-'))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

async function tmpLeftovers(dir) {
  return (await readdir(dir)).filter((name) => name.startsWith('.pinax-tmp-'))
}

test('目标文件已存在时被完整替换：新内容更短也不残留旧字节', async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, 'state.json')
    await writeFile(target, '{"old":"这是很长很长的旧内容，故意比新内容长-many-many-bytes-long"}', 'utf-8')
    await atomicWriteFile(target, '{"new":"短"}')
    assert.equal(await readFile(target, 'utf-8'), '{"new":"短"}')
    assert.deepEqual(await tmpLeftovers(root), [])
  } finally { await cleanup() }
})

test('文本逐字节一致：多字节中文与换行原样落盘（走内核 fsync＋rename）', async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, '正文', '001-第一章.md')
    await mkdir(join(target, '..'), { recursive: true })
    const contents = '# 第一章\n\n中文段落：山有扶苏，隰有荷华。\n结尾不留多余字节'
    await atomicWriteFile(target, contents)
    const actual = await readFile(target)
    assert.ok(actual.equals(Buffer.from(contents, 'utf-8')), '落盘字节与源 utf-8 字节逐字节一致')
  } finally { await cleanup() }
})

test('二进制逐字节一致：Buffer 直写不经字符串化（0x00-0xFF 全字节＋PNG 魔数）', async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, '场景', '第01拍.png')
    await mkdir(join(target, '..'), { recursive: true })
    const pngMagic = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
    const allBytes = Buffer.from(Array.from({ length: 256 }, (_, i) => i))
    const contents = Buffer.concat([pngMagic, allBytes])
    await atomicWriteFile(target, contents)
    const actual = await readFile(target)
    assert.equal(actual.length, contents.length)
    assert.ok(actual.equals(contents), '二进制字节逐字节一致（未被 utf-8 解码损坏）')
  } finally { await cleanup() }
})

test('二进制也能完整替换已存在的文本目标', async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, 'cover.png')
    await writeFile(target, '旧的文本内容，将被二进制整体替换', 'utf-8')
    const contents = Buffer.from([0x00, 0xff, 0x10, 0x80, 0x7f])
    await atomicWriteFile(target, contents)
    const actual = await readFile(target)
    assert.ok(actual.equals(contents))
    assert.deepEqual(await tmpLeftovers(root), [])
  } finally { await cleanup() }
})

test('写失败时原文件完好且不留半成品（win32：只读目标让 rename 拒绝替换）', { skip: process.platform !== 'win32' }, async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, 'config.json')
    await writeFile(target, '{"keep":"原稿"}', 'utf-8')
    await chmod(target, 0o444) // Windows 只读属性：MOVEFILE_REPLACE_EXISTING 拒绝覆盖只读文件
    await assert.rejects(() => atomicWriteFile(target, '{"new":"覆盖"}'))
    assert.equal(await readFile(target, 'utf-8'), '{"keep":"原稿"}', '原文件完好')
    assert.deepEqual(await tmpLeftovers(root), [], '失败后不留 .pinax-tmp-* 半成品')
  } finally {
    await chmod(join(root, 'config.json'), 0o666).catch(() => {})
    await cleanup()
  }
})

test('写失败时原文件完好且不留半成品（posix：目录不可写让临时文件 open 失败）', { skip: process.platform === 'win32' }, async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, 'config.json')
    await writeFile(target, '{"keep":"原稿"}', 'utf-8')
    await chmod(root, 0o555) // 目录不可写：open(tmp) 直接 EACCES，rename 尚未发生
    await assert.rejects(() => atomicWriteFile(target, '{"new":"覆盖"}'))
    assert.equal(await readFile(target, 'utf-8'), '{"keep":"原稿"}', '原文件完好')
    assert.deepEqual(await tmpLeftovers(root), [], '失败后不留半成品')
  } finally {
    await chmod(root, 0o755).catch(() => {})
    await cleanup()
  }
})

test('目录不存在＝ENOENT 抛出、不代建目录（建目录留调用点，与各原实现口径一致）', async () => {
  const { root, cleanup } = await fixture()
  try {
    const target = join(root, '不存在', 'x.json')
    await assert.rejects(() => atomicWriteFile(target, '{}'), (error) => error.code === 'ENOENT')
    assert.deepEqual(await readdir(root), [], '父目录不被代建')
  } finally { await cleanup() }
})
