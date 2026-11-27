/**
 * OS-217：受限 PUT /api/deduce/asset 服务端前置项（真实临时 daemon）。
 *
 * 只起 port:0 隔离 daemon、临时库与临时 LOCALAPPDATA；不连接 8807、不读真库。
 * 覆盖三类合法素材、严格 base64/签名/大小/路径/归属/覆盖/备份/日志与模块停用。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENDPOINTS, validateResponse } from '../src/api/contracts.mjs'
import { contentHash } from '../src/protocol/changelog.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

const BOOK_ID = 'book-1'
const ROLEPLAY_DIR = '扮演'
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl6x0sAAAAASUVORK5CYII=', 'base64')
const PNG_TWO = Buffer.concat([PNG, Buffer.from([0x50, 0x4c, 0x45, 0x41, 0x53, 0x45])])
const ID3_MP3 = Buffer.from([0x49, 0x44, 0x33, 0x03, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00])
const FRAME_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x64, 0x00, 0x00, 0x00, 0x00])
const MP3_FRAME = Buffer.alloc(417, 0x55)
MP3_FRAME.set([0xff, 0xfb, 0x90, 0x64, 0x00, 0x01, 0xa4, 0x00], 0)

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os217-asset-'))
  const root = join(base, 'fixture-library')
  const appData = join(base, 'appdata')
  await mkdir(join(root, '故事源'), { recursive: true })
  await mkdir(appData, { recursive: true })
  await writeFile(join(root, '故事源', `${BOOK_ID}.json`), JSON.stringify({
    schema: 'fact.data/v3', book: { id: BOOK_ID, title: 'OS-217 临时库' }, entries: [], revision: 1
  }), 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1, libraries: [{ path: root, name: 'OS-217 临时库', addedAt: '2026-11-27T00:00:00.000Z', source: 'openstory' }]
  }), 'utf-8')
  return { base, root, appData, preferencesPath }
}

async function withFixture(run) {
  const fixture = await makeFixture()
  const daemon = await startDaemon({
    port: 0,
    root: fixture.root,
    preferencesPath: fixture.preferencesPath,
    env: { ...process.env, LOCALAPPDATA: fixture.appData, APPDATA: fixture.appData },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    return await run({ ...fixture, daemon, origin })
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
}

async function putAsset(fixture, { bookId = BOOK_ID, path, bytes, overwrite } = {}) {
  return putAssetBody(fixture, {
    root: fixture.root,
    ...(bookId !== undefined ? { bookId } : {}),
    path,
    dataBase64: bytes.toString('base64'),
    ...(overwrite !== undefined ? { overwrite } : {})
  })
}

async function putAssetBody(fixture, body) {
  const response = await fetch(`${fixture.origin}/api/deduce/asset`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: response.status, payload: await response.json() }
}

async function rejectWithoutWrite(fixture, body, code) {
  const rootBefore = await snapshotTree(fixture.root)
  const response = await fetch(`${fixture.origin}/api/deduce/asset`, {
    method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  })
  assert.equal(response.status, code === 'PATH_ESCAPE' ? 403 : 400, JSON.stringify(await response.clone().json()))
  const payload = await response.json()
  assert.equal(payload.ok, false)
  assert.equal(payload.error.code, code)
  assert.deepEqual(await snapshotTree(fixture.root), rootBefore, '校验失败必须零写入（库树逐文件 hash 不变）')
  return payload
}

async function snapshotTree(root) {
  const result = []
  async function walk(abs, rel = '') {
    const entries = await readdir(abs, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name, 'en'))
    for (const entry of entries) {
      const nextRel = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) await walk(join(abs, entry.name), nextRel)
      else if (entry.isFile()) result.push([nextRel, sha256(await readFile(join(abs, entry.name)))])
    }
  }
  await walk(root)
  return result
}

async function assertStored(fixture, relativePath, bytes, payload, mediaType) {
  assert.equal(payload.ok, true)
  assert.equal(payload.path, relativePath)
  assert.equal(payload.bytes, bytes.length)
  assert.equal(payload.mediaType, mediaType)
  assert.equal(payload.sha256, sha256(bytes))
  assert.match(payload.changeId ?? '', /^\.openstory\/log\/扮演\/\d{4}-\d{2}\.jsonl#[0-9a-f]{16}$/u)
  assert.equal(payload.logError, undefined)
  assert.equal(validateResponse('deduceAssetPut', payload).ok, true)
  assert.deepEqual(await readFile(join(fixture.root, ...relativePath.split('/'))), bytes)

  const listed = await (await fetch(`${fixture.origin}/api/deduce/assets?${new URLSearchParams({ root: fixture.root, bookId: BOOK_ID })}`)).json()
  const kind = relativePath.includes('/角色/') ? 'characters' : relativePath.includes('/场景/') ? 'scenes' : 'bgm'
  assert.ok(listed[kind].some((item) => item.path === relativePath), JSON.stringify(listed))

  const logged = await (await fetch(`${fixture.origin}/api/log?${new URLSearchParams({ root: fixture.root, module: ROLEPLAY_DIR })}`)).json()
  const record = logged.entries.find((entry) => entry.file === relativePath)
  assert.ok(record, JSON.stringify(logged))
  assert.equal(record.module, ROLEPLAY_DIR)
  assert.equal(record.afterHash, contentHash(bytes))
  assert.equal(record.afterChars, bytes.length)
  assert.equal(record.diff, '', '二进制日志不得转成 UTF-8 全文 diff')
  assert.equal(record.meta.sha256, sha256(bytes))
  assert.equal(record.meta.bytes, bytes.length)
}

test('OS-217 契约：PUT 与 GET 同路径不同方法，请求/响应形状登记', () => {
  assert.equal(ENDPOINTS.deduceAssetPut.method, 'PUT')
  assert.equal(ENDPOINTS.deduceAssetPut.path, '/api/deduce/asset')
  assert.equal(ENDPOINTS.deduceAssetFile.method, 'GET')
  assert.equal(validateResponse('deduceAssetPut', {
    ok: true, path: '扮演/book-1/素材/角色/沈岚.png', bytes: PNG.length,
    mediaType: 'image/png', sha256: sha256(PNG), backup: 'x', changeId: 'y', logError: 'z'
  }).ok, true)
})

test('OS-217 合法素材：角色/场景 PNG 与 ID3/帧同步 MP3 原子落盘并记二进制日志', async () => {
  await withFixture(async (fixture) => {
    for (const [relativePath, bytes, mediaType] of [
      [`${ROLEPLAY_DIR}/${BOOK_ID}/素材/角色/沈岚.png`, PNG, 'image/png'],
      [`${ROLEPLAY_DIR}/${BOOK_ID}/素材/场景/夜渡.png`, PNG_TWO, 'image/png'],
      [`${ROLEPLAY_DIR}/${BOOK_ID}/素材/bgm/夜渡.mp3`, ID3_MP3, 'audio/mpeg'],
      [`${ROLEPLAY_DIR}/${BOOK_ID}/素材/bgm/无标签.mp3`, MP3_FRAME, 'audio/mpeg']
    ]) {
      const written = await putAsset(fixture, { path: relativePath.slice(`${ROLEPLAY_DIR}/${BOOK_ID}/素材/`.length), bytes })
      assert.equal(written.status, 200, JSON.stringify(written.payload))
      assert.equal(written.payload.backup, undefined)
      await assertStored(fixture, relativePath, bytes, written.payload, mediaType)
    }
    // 省略 bookId：仍走 resolveFactBookId 选中唯一故事源书。
    const defaultBook = await putAsset(fixture, { bookId: undefined, path: '场景/默认书.png', bytes: PNG })
    assert.equal(defaultBook.status, 200)
    await assertStored(fixture, `${ROLEPLAY_DIR}/${BOOK_ID}/素材/场景/默认书.png`, PNG, defaultBook.payload, 'image/png')
    assert.deepEqual(await readdir(join(fixture.root, ROLEPLAY_DIR, BOOK_ID, '素材', '角色')), ['沈岚.png'], '原子写不得留下临时文件')
  })
})

test('OS-217 空/坏 base64 与伪造 PNG/MP3 签名全部零写入', async () => {
  await withFixture(async (fixture) => {
    const baseBody = { root: fixture.root, bookId: BOOK_ID, path: '角色/拒绝.png' }
    for (const bad of ['', '%%%%', 'iVBORw0K', 'iVBORw0K=AAA', 'iVBORw0K AAA', 'iVBORw0K\nAAAA', '____', 'AB==']) {
      await rejectWithoutWrite(fixture, { ...baseBody, dataBase64: bad }, 'INVALID_ENTRY')
    }
    for (const badBytes of [
      Buffer.from('not a png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]),
      Buffer.from([0xff, 0xe0, 0x00, 0x00]), Buffer.from([0x49, 0x44]), FRAME_MP3
    ]) {
      const path = badBytes[0] === 0xff || badBytes[0] === 0x49 ? 'bgm/坏签名.mp3' : '角色/坏签名.png'
      await rejectWithoutWrite(fixture, { ...baseBody, path, dataBase64: badBytes.toString('base64') }, 'INVALID_ENTRY')
    }
  })
})

test('OS-217 超限：16MB+1 素材进入受限端点后被拒且零写入（不打大串日志）', async () => {
  await withFixture(async (fixture) => {
    const rootBefore = await snapshotTree(fixture.root)
    const oversized = Buffer.alloc((16 * 1024 * 1024) + 1, 0x41)
    const response = await putAssetBody(fixture, {
      root: fixture.root, bookId: BOOK_ID, path: '角色/超限.png',
      dataBase64: oversized.toString('base64')
    })
    assert.equal(response.status, 400, JSON.stringify(response.payload?.error))
    assert.equal(response.payload?.error?.code, 'INVALID_ENTRY', '端点 body 可容纳 base64，但解码素材仍须 ≤16MB')
    assert.deepEqual(await snapshotTree(fixture.root), rootBefore, '超限素材必须零写入')
  })
})

test('OS-217 越界/盘符/绝对路径/异扩展名/异目录/嵌套路径全部零写入', async () => {
  await withFixture(async (fixture) => {
    for (const path of [
      '../session.json', '角色/../../../secret.png', 'C:/Windows/win.ini', 'C:\\Windows\\win.ini',
      '/etc/passwd.png', '\\\\server\\share\\图.png', '角色/私货.json', 'bgm/私货.png', '角色/伪装.mp3', '正文/图.png',
      '角色/子目录/图.png', '.history/旧.png', '角色/.hidden.png'
    ]) {
      await rejectWithoutWrite(fixture, {
        root: fixture.root, bookId: BOOK_ID, path, dataBase64: PNG.toString('base64')
      }, path.includes('session.json') || path.includes('secret.png') || path.includes('C:')
        || path.includes('C:\\') || path.includes('/etc/') || path.startsWith('\\\\') ? 'PATH_ESCAPE' : 'INVALID_ENTRY')
    }
    // bookId 先经 safeDeduceBookId；仍必须拒绝任何逃逸语义，不能静默改名后写到别处。
    await rejectWithoutWrite(fixture, {
      root: fixture.root, bookId: '../escape', path: '角色/越界书.png', dataBase64: PNG.toString('base64')
    }, 'PATH_ESCAPE')
  })
})

test('OS-217 覆盖：默认冲突不覆盖，overwrite:true 先按 .history 模式备份', async () => {
  await withFixture(async (fixture) => {
    const path = '角色/沈岚.png'
    const created = await putAsset(fixture, { path, bytes: PNG })
    assert.equal(created.status, 200)
    const beforeConflict = await snapshotTree(fixture.root)
    const conflict = await putAsset(fixture, { path, bytes: PNG_TWO })
    assert.equal(conflict.status, 400)
    assert.equal(conflict.payload.error.code, 'INVALID_ENTRY')
    assert.deepEqual(await snapshotTree(fixture.root), beforeConflict, '默认冲突不得写备份或覆盖')
    assert.deepEqual(await readFile(join(fixture.root, ROLEPLAY_DIR, BOOK_ID, '素材', path)), PNG)

    const overwritten = await putAsset(fixture, { path, bytes: PNG_TWO, overwrite: true })
    assert.equal(overwritten.status, 200, JSON.stringify(overwritten.payload))
    await assertStored(fixture, `${ROLEPLAY_DIR}/${BOOK_ID}/素材/${path}`, PNG_TWO, overwritten.payload, 'image/png')
    assert.match(overwritten.payload.backup, /^扮演\/book-1\/素材\/角色\/\.history\/沈岚\.png\.bak-/u)
    assert.deepEqual(await readFile(join(fixture.root, ...overwritten.payload.backup.split('/'))), PNG)
    const logged = await (await fetch(`${fixture.origin}/api/log?${new URLSearchParams({ root: fixture.root, module: ROLEPLAY_DIR })}`)).json()
    const update = logged.entries.find((entry) => entry.file === `${ROLEPLAY_DIR}/${BOOK_ID}/素材/${path}` && entry.op === 'update')
    assert.equal(update.backup, overwritten.payload.backup)
    assert.equal(update.beforeHash, contentHash(PNG))
    assert.equal(update.beforeChars, PNG.length)
    assert.equal(update.diff, '')
  })
})

test('OS-217 角色扮演模块停用：PUT 端点回 409 MODULE_DISABLED 且零写入', async () => {
  await withFixture(async (fixture) => {
    const disabled = await fetch(`${fixture.origin}/api/ui-state`, {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fixture.root, state: { 'modules.enabled.roleplay': false } })
    })
    assert.equal(disabled.status, 200, await disabled.text())
    const before = await snapshotTree(fixture.root)
    try {
      const response = await putAsset(fixture, { path: '角色/停用.png', bytes: PNG })
      assert.equal(response.status, 409)
      assert.equal(response.payload.error.code, 'MODULE_DISABLED')
      assert.deepEqual(await snapshotTree(fixture.root), before)
    } finally {
      await fetch(`${fixture.origin}/api/ui-state`, {
        method: 'PUT', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: fixture.root, state: { 'modules.enabled.roleplay': true } })
      })
    }
  })
})
