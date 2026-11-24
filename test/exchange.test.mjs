/**
 * OS-162 导入导出端点测试：临时夹具库，写走共用通道、dryRun 不落盘、幂等与 factEntriesImport
 * 同语义、停用 MODULE_DISABLED、导出不改 fact 文件（mtime＋内容哈希）。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, stat, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { stableEntryId } from '../src/protocol/factDomain.mjs'

const PROV = { book: '水浒传', book_id: 'shuihu', chapters: [1], scenes: [], extractor: 'fixture', quote_hash: 'b'.repeat(40) }
const FP = { vec: [0.3], metrics: {} }
const NAME = '风雪山神庙'
const ENTRY = {
  schema: 'pedia/v1', id: stableEntryId({ layer: 'plot', name: NAME }), layer: 'plot', name: NAME,
  provenance: { ...PROV }, fingerprint: { ...FP }, fact: '林冲雪夜上梁山', events: [{ content: '草料场起火' }]
}

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'os162-exchange-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.pinax'), { recursive: true })
  await mkdir(join(root, '拆解'), { recursive: true })
  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({ recentProjects: [{ path: root, name: '夹具库' }] }), 'utf-8')
  return { base, root, preferencesPath }
}

async function start(base, preferencesPath, root) {
  const daemon = await startDaemon({
    port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} }
  })
  return { daemon, origin: `http://127.0.0.1:${daemon.port}`, q: `root=${encodeURIComponent(root)}` }
}

async function digest(path) {
  try { return createHash('sha256').update(await readFile(path)).digest('hex') } catch { return '' }
}

test('导入：dryRun 不落盘；真写核对 fact 文件；重复导入与 factEntriesImport 同幂等/revision 语义', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const { daemon, origin, q } = await start(base, preferencesPath, root)
  const factPath = join(root, '拆解', 'shuihu.json')
  const call = (dryRun) => fetch(`${origin}/api/exchange/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root, bookId: 'shuihu', format: 'pedia/v1', text: JSON.stringify(ENTRY), dryRun })
  })
  try {
    const preview = await (await call(true)).json()
    assert.equal(preview.ok, true)
    assert.equal(preview.dryRun, true)
    assert.equal(preview.entries, 1)
    assert.equal(await digest(factPath), '', 'dryRun 不落盘')

    const saved = await (await call(false)).json()
    assert.equal(saved.ok, true)
    assert.equal(saved.written.bookId, 'shuihu')
    const first = await digest(factPath)
    assert.ok(first, '真写后 fact 文件存在')
    const fact = JSON.parse(await readFile(factPath, 'utf-8'))
    assert.equal(fact.entries[0].id, ENTRY.id, 'id 不重算')
    assert.equal(fact.entries[0].status, 'draft')
    assert.ok(fact.revision >= 1, 'revision 自增由共用写通道负责')

    // 重复导入：operationId 每次不同（来源前缀+时间）→ 与 factEntriesImport 一样是 update + revision 递增，
    // 不是覆盖式第二写口；条目不重复堆积（同一个 id 走内核合并）。
    const again = await (await call(false)).json()
    assert.equal(again.ok, true)
    const fact2 = JSON.parse(await readFile(factPath, 'utf-8'))
    assert.ok(fact2.revision >= fact.revision, 'revision 不倒退')
    assert.equal(fact2.entries.filter((e) => e.id === ENTRY.id).length, 1, '同 id 不重复堆积')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('导出：fact→pedia 返回丢失清单，不落盘时 fact 的 mtime 与内容哈希都不变', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const { daemon, origin } = await start(base, preferencesPath, root)
  const factPath = join(root, '拆解', 'shuihu.json')
  const beforeHash = await (await fetch(`${origin}/api/exchange/import`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root, bookId: 'shuihu', format: 'pedia/v1', text: JSON.stringify({
      ...ENTRY, status: 'draft', provenance: { ...PROV, mode: 'analyze' }
    }) })
  })).json()
  assert.equal(beforeHash.ok, true, '先写入一条 fact')
  const before = await stat(factPath)
  const hashBefore = await digest(factPath)

  const exported = await (await fetch(`${origin}/api/exchange/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root, bookId: 'shuihu', format: 'pedia/v1' })
  })).json()
  assert.equal(exported.ok, true)
  assert.equal(exported.entries[0].schema, 'pedia/v1')
  assert.ok(Array.isArray(exported.lost))
  assert.equal(exported.file, undefined, '默认不存盘')
  const after = await stat(factPath)
  assert.equal(after.mtimeMs, before.mtimeMs, '导出不改 fact mtime')
  assert.equal(await digest(factPath), hashBefore, '导出不改 fact 内容')

  // save=true 存到库内「导出/」，走宿主写协议，fact 仍不动
  const saved = await (await fetch(`${origin}/api/exchange/export`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root, bookId: 'shuihu', format: 'jsonl', save: true })
  })).json()
  assert.equal(saved.ok, true)
  assert.match(saved.file, /^导出\//u)
  assert.ok(await digest(join(root, saved.file)), '导出文件落盘')
  assert.equal(await digest(factPath), hashBefore, '存盘导出也不碰 fact')
  await daemon.close()
  await rm(base, { recursive: true, force: true })
})

test('停用：两端点回 MODULE_DISABLED，启用恢复', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  await writeFile(join(root, '.pinax', 'ui-state.json'), JSON.stringify({ modules: { enabled: { exchange: false } } }), 'utf-8')
  const { daemon, origin } = await start(base, preferencesPath, root)
  try {
    for (const path of ['exchange/import', 'exchange/export']) {
      const res = await fetch(`${origin}/api/${path}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root, bookId: 'shuihu', format: 'pedia/v1', text: JSON.stringify(ENTRY) })
      })
      assert.equal(res.status, 409)
      assert.equal((await res.json()).error.code, 'MODULE_DISABLED')
    }
    await writeFile(join(root, '.pinax', 'ui-state.json'), JSON.stringify({ modules: { enabled: { exchange: true } } }), 'utf-8')
    const ok = await (await fetch(`${origin}/api/exchange/import`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, bookId: 'shuihu', format: 'pedia/v1', text: JSON.stringify(ENTRY), dryRun: true })
    })).json()
    assert.equal(ok.ok, true)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})
