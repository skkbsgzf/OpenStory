/**
 * 故事源条目层（工单 S1）用例：条目级读端点／书目列表。
 * 夹具：拆解/ 两本——一本正常 3 条（plot×2 + character×1），一本 JSON 损坏。
 * 跑法：node --test test/fact-entries.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { validateResponse } from '../src/api/contracts.mjs'

const ENTRIES = [
  {
    schema: 'fact.data/v3',
    id: 'p1',
    layer: 'plot',
    name: '渡口惊变',
    status: 'draft',
    notes: '开场第一拍。'
  },
  {
    schema: 'fact.data/v3',
    id: 'c1',
    layer: 'character',
    name: '林砚',
    status: 'draft',
    definition: '雾港的摆渡人。',
    aliases: ['小砚']
  },
  {
    schema: 'fact.data/v3',
    id: 'p2',
    layer: 'plot',
    name: 'Ferryman Oath',
    status: 'draft',
    notes: '第二拍。'
  }
]

async function makeLibrary(base) {
  const root = join(base, '条目库')
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '拆解'), { recursive: true })
  const fact = {
    book: { id: '好档', title: '好档之书' },
    entries: ENTRIES,
    revision: 3
  }
  await writeFile(join(root, '拆解', '好档.json'), JSON.stringify(fact), 'utf-8')
  await writeFile(join(root, '拆解', '好档.wiki.json'), JSON.stringify({ derivedFrom: { factRevision: 3 } }), 'utf-8')
  await writeFile(join(root, '拆解', '坏档.json'), '{ not json', 'utf-8')
  // 旁路档：没有 entries 不是坏档，静默跳过。
  await writeFile(join(root, '拆解', '拆解汇总.json'), JSON.stringify({ note: '聚合产物' }), 'utf-8')
  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({ recentProjects: [{ path: root, name: '条目库' }] }), 'utf-8')
  return { root, preferencesPath }
}

async function withDaemon(run) {
  const base = await mkdtemp(join(tmpdir(), 'os-fact-entries-'))
  try {
    const { root, preferencesPath } = await makeLibrary(base)
    const daemon = await startDaemon({ port: 0, preferencesPath, env: { ...process.env, LOCALAPPDATA: base }, logger: { log() {} } })
    try {
      const get = async (path, params = {}) => {
        const res = await fetch(`http://127.0.0.1:${daemon.port}${path}?${new URLSearchParams({ root, ...params }).toString()}`)
        return { status: res.status, payload: await res.json() }
      }
      await run({ root, get })
    } finally {
      await daemon.close()
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test('fact/entries：正常书读到 3 条，损坏书跳过且 warnings 有记录，响应过契约', async () => {
  await withDaemon(async ({ get }) => {
    const { status, payload } = await get('/api/fact/entries')
    assert.equal(status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.bookId, '好档')
    assert.equal(payload.revision, 3)
    assert.equal(payload.book.title, '好档之书')
    assert.equal(payload.total, 3)
    assert.equal(payload.entries.length, 3)
    // 溯源字段由内核透传，不重排
    assert.equal(payload.entries.every((entry) => entry.bookId === '好档' && entry.bookName === '好档之书' && entry.revision === 3), true)
    assert.deepEqual(payload.layers, { plot: 2, character: 1 })
    assert.equal(Array.isArray(payload.warnings), true)
    assert.equal(payload.warnings.some((warning) => warning.code === 'FACT_FILE_UNREADABLE' && warning.file.includes('坏档')), true)
    assert.equal(validateResponse('factEntriesGet', payload).ok, true)
  })
})

test('fact/entries：layer 过滤在服务端生效', async () => {
  await withDaemon(async ({ get }) => {
    const { payload } = await get('/api/fact/entries', { layer: 'character' })
    assert.equal(payload.total, 1)
    assert.equal(payload.entries.length, 1)
    assert.equal(payload.entries[0].name, '林砚')
    // layers 仍是过滤前的全量计数（供层筛选器）
    assert.deepEqual(payload.layers, { plot: 2, character: 1 })
  })
})

test('fact/entries：limit=1 分页正确，offset 生效', async () => {
  await withDaemon(async ({ get }) => {
    const first = await get('/api/fact/entries', { limit: '1' })
    assert.equal(first.payload.total, 3)
    assert.equal(first.payload.entries.length, 1)
    assert.equal(first.payload.entries[0].id, 'p1')

    const second = await get('/api/fact/entries', { limit: '1', offset: '1' })
    assert.equal(second.payload.total, 3)
    assert.equal(second.payload.entries.length, 1)
    assert.equal(second.payload.entries[0].id, 'c1')

    // 超上限 clamp 不报错
    const clamped = await get('/api/fact/entries', { limit: '9999' })
    assert.equal(clamped.payload.entries.length, 3)
  })
})

test('fact/entries：q 命中 name（大小写不敏感）', async () => {
  await withDaemon(async ({ get }) => {
    const { payload } = await get('/api/fact/entries', { q: 'FERRY' })
    assert.equal(payload.total, 1)
    assert.equal(payload.entries[0].id, 'p2')
    assert.equal(validateResponse('factEntriesGet', payload).ok, true)
  })
})

test('fact/entries：显式指向坏档＝空条目＋warnings，不整体报错；不存在＝404 NOT_FOUND', async () => {
  await withDaemon(async ({ get }) => {
    const broken = await get('/api/fact/entries', { bookId: '坏档' })
    assert.equal(broken.status, 200)
    assert.equal(broken.payload.total, 0)
    assert.deepEqual(broken.payload.entries, [])
    assert.equal(broken.payload.warnings.some((warning) => warning.code === 'FACT_FILE_UNREADABLE'), true)

    const missing = await get('/api/fact/entries', { bookId: '没有这本' })
    assert.equal(missing.status, 404)
    assert.equal(missing.payload.ok, false)
    assert.equal(missing.payload.error.code, 'NOT_FOUND')
  })
})

test('fact/books：列出两本，好档带 revision/条目数/wiki 有无，坏档标 error', async () => {
  await withDaemon(async ({ get }) => {
    const { status, payload } = await get('/api/fact/books')
    assert.equal(status, 200)
    assert.equal(payload.ok, true)
    assert.equal(payload.books.length, 2)
    const good = payload.books.find((item) => item.bookId === '好档')
    assert.equal(good.revision, 3)
    assert.equal(good.entries, 3)
    assert.equal(good.hasWiki, true)
    assert.equal(good.title, '好档之书')
    assert.equal(good.error, undefined)
    const broken = payload.books.find((item) => item.bookId === '坏档')
    assert.equal(typeof broken.error, 'string')
    assert.equal(broken.entries, 0)
    assert.equal(validateResponse('factBooksGet', payload).ok, true)
  })
})
