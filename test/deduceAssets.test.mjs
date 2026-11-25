/**
 * OS-61 P4 文游素材端点用例（node:test，零依赖）。
 *
 * 跑法：node --test openstory/test/deduceAssets.test.mjs
 * 覆盖：空素材空态 / 假 png 盘点 / 路径逃逸拒收 / 素材本体流 / root 白名单。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateResponse } from '../src/api/contracts.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

// 1x1 透明 png 的头几字节足够当假素材——盘点只看文件名，本体只比对字节
const FAKE_PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01])
const FAKE_MP3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x02])

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-assets-'))
  const root = join(base, '素材夹具库')
  await mkdir(join(root, '故事源'), { recursive: true })
  await writeFile(join(root, '故事源', 'book-1.json'), JSON.stringify({
    book: { id: 'book-1', title: '素材夹具书' },
    entries: [],
    revision: 1
  }), 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '素材夹具库', at: '2026-11-18T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath }
}

function assetQuery(root, extra = {}) {
  return new URLSearchParams({ root, ...extra }).toString()
}

test('素材盘点：目录不存在＝三个空数组，不报错（OS-61 P4）', async () => {
  const { base, root, preferencesPath } = await makeFixture()
  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const response = await fetch(`${origin}/api/deduce/assets?${assetQuery(root, { bookId: 'book-1' })}`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.bookId, 'book-1')
    assert.deepEqual(payload.characters, [])
    assert.deepEqual(payload.scenes, [])
    assert.deepEqual(payload.bgm, [])
    assert.equal(validateResponse('deduceAssets', payload).ok, true)

    // 素材目录建了但还是空＝同样空态
    await mkdir(join(root, '扮演', 'book-1', '素材', '角色'), { recursive: true })
    const again = await (await fetch(`${origin}/api/deduce/assets?${assetQuery(root, { bookId: 'book-1' })}`)).json()
    assert.deepEqual(again.characters, [])
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('素材盘点：放假 png 后 characters 列出 name＋相对路径；异扩展名/隐藏文件跳过（OS-61 P4）', async () => {
  const { base, root, preferencesPath } = await makeFixture()
  const assetsDir = join(root, '扮演', 'book-1', '素材')
  await mkdir(join(assetsDir, '角色'), { recursive: true })
  await mkdir(join(assetsDir, '场景'), { recursive: true })
  await mkdir(join(assetsDir, 'bgm'), { recursive: true })
  await writeFile(join(assetsDir, '角色', '林砚.png'), FAKE_PNG)
  await writeFile(join(assetsDir, '角色', '备注.txt'), '不是立绘', 'utf-8')
  await writeFile(join(assetsDir, '角色', '.hidden.png'), FAKE_PNG)
  await writeFile(join(assetsDir, '场景', '雾港.png'), FAKE_PNG)
  await writeFile(join(assetsDir, 'bgm', '雾港.mp3'), FAKE_MP3)
  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const payload = await (await fetch(`${origin}/api/deduce/assets?${assetQuery(root, { bookId: 'book-1' })}`)).json()
    assert.equal(payload.ok, true)
    assert.deepEqual(payload.characters, [{ name: '林砚', path: '扮演/book-1/素材/角色/林砚.png' }])
    assert.deepEqual(payload.scenes, [{ name: '雾港', path: '扮演/book-1/素材/场景/雾港.png' }])
    assert.deepEqual(payload.bgm, [{ name: '雾港', path: '扮演/book-1/素材/bgm/雾港.mp3' }])
    assert.equal(validateResponse('deduceAssets', payload).ok, true)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('素材路径安全：bookId 与 path 的 ../ 逃逸、绝对路径全部拒收（OS-61 P4）', async () => {
  const { base, root, preferencesPath } = await makeFixture()
  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const escapeBook = await fetch(`${origin}/api/deduce/assets?${assetQuery(root, { bookId: '../别的库' })}`)
    assert.equal(escapeBook.status, 403)
    assert.equal((await escapeBook.json()).error.code, 'PATH_ESCAPE')

    const escapePath = await fetch(`${origin}/api/deduce/asset?${assetQuery(root, { bookId: 'book-1', path: '../session.json' })}`)
    assert.equal(escapePath.status, 403)
    assert.equal((await escapePath.json()).error.code, 'PATH_ESCAPE')

    const deepEscape = await fetch(`${origin}/api/deduce/asset?${assetQuery(root, { bookId: 'book-1', path: '角色/../../../secret.png' })}`)
    assert.equal(deepEscape.status, 403)
    assert.equal((await deepEscape.json()).error.code, 'PATH_ESCAPE')

    const absolute = await fetch(`${origin}/api/deduce/asset?${assetQuery(root, { bookId: 'book-1', path: 'C:/Windows/win.ini' })}`)
    assert.equal(absolute.status, 403)
    assert.equal((await absolute.json()).error.code, 'PATH_ESCAPE')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('素材本体：png/mp3 按 MIME 流出且字节一致；缺档 404、异扩展名 400（OS-61 P4）', async () => {
  const { base, root, preferencesPath } = await makeFixture()
  const assetsDir = join(root, '扮演', 'book-1', '素材')
  await mkdir(join(assetsDir, '角色'), { recursive: true })
  await mkdir(join(assetsDir, 'bgm'), { recursive: true })
  await writeFile(join(assetsDir, '角色', '林砚.png'), FAKE_PNG)
  await writeFile(join(assetsDir, 'bgm', '平静.mp3'), FAKE_MP3)
  await writeFile(join(assetsDir, '角色', '私货.json'), '{}', 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const png = await fetch(`${origin}/api/deduce/asset?${assetQuery(root, { bookId: 'book-1', path: '角色/林砚.png' })}`)
    assert.equal(png.status, 200)
    assert.equal(png.headers.get('content-type'), 'image/png')
    assert.deepEqual(Buffer.from(await png.arrayBuffer()), FAKE_PNG)

    const mp3 = await fetch(`${origin}/api/deduce/asset?${assetQuery(root, { bookId: 'book-1', path: 'bgm/平静.mp3' })}`)
    assert.equal(mp3.status, 200)
    assert.equal(mp3.headers.get('content-type'), 'audio/mpeg')
    assert.deepEqual(Buffer.from(await mp3.arrayBuffer()), FAKE_MP3)

    const missing = await fetch(`${origin}/api/deduce/asset?${assetQuery(root, { bookId: 'book-1', path: '角色/没有这个人.png' })}`)
    assert.equal(missing.status, 404)
    assert.equal((await missing.json()).error.code, 'NOT_FOUND')

    const wrongExt = await fetch(`${origin}/api/deduce/asset?${assetQuery(root, { bookId: 'book-1', path: '角色/私货.json' })}`)
    assert.equal(wrongExt.status, 400)
    assert.equal((await wrongExt.json()).error.code, 'INVALID_ENTRY')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('素材端点：未登记 root 拒收；bookId 缺省走故事源最新一本（OS-61 P4）', async () => {
  const { base, root, preferencesPath } = await makeFixture()
  const assetsDir = join(root, '扮演', 'book-1', '素材', '场景')
  await mkdir(assetsDir, { recursive: true })
  await writeFile(join(assetsDir, '雾港.png'), FAKE_PNG)
  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const unregistered = await fetch(`${origin}/api/deduce/assets?${assetQuery(join(base, '别的库'))}`)
    assert.equal(unregistered.status, 403)
    assert.equal((await unregistered.json()).error.code, 'NO_LIBRARY')

    // 不传 bookId：故事源目录只有 book-1.json，应解析到它并列出素材
    const payload = await (await fetch(`${origin}/api/deduce/assets?${assetQuery(root)}`)).json()
    assert.equal(payload.ok, true)
    assert.equal(payload.bookId, 'book-1')
    assert.deepEqual(payload.scenes, [{ name: '雾港', path: '扮演/book-1/素材/场景/雾港.png' }])
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})