/**
 * OS-135① 回归测试：factEntriesImport 端点的 ReferenceError（OS-113 引入）。
 *
 * 事故：daemon.mjs 的 factEntriesImport 分支里写了 `existsSync(factPath)`，
 * 但这个作用域里的变量叫 `documentPath`——`factPath` 是另一个端点（deducePendingSettle）
 * try 块里的局部 const，够不到。结果该端点从 OS-113 起每次调用都 500
 * （「daemon 内部错误：factPath is not defined」），因无测试覆盖而静默了两天。
 *
 * 本文件先于修复写成：修复前 fresh import 必失败（500 + factPath is not defined），
 * 修复后通过。OS-135② 在同文件补齐写端点直测（expectedRevision 并发／0 字节／幂等）。
 *
 * 跑法：node --test test/factEntriesImport.test.mjs
 */
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { validateResponse } from '../contracts.mjs'

let base = ''
let libRoot = ''
let daemon = null
let port = 0

const ENTRIES = [
  {
    schema: 'fact.data/v3',
    id: 'plot-1',
    layer: 'plot',
    name: '开局',
    domain: '测试',
    status: 'fact',
    provenance: { book: 'reg-book', book_id: 'reg-book', mode: 'analyze', extractor: 'fact-chain/v1', chapters: [1] },
    who: ['沈岚'],
    events: [{ index: 1, who: '沈岚', channel: 'perceive', content: '沈岚看到弹幕预警。', segments: [{ index: 1, chars: 9 }] }],
    validity: { from: 1, to: 1 }
  }
]

before(async () => {
  const { startDaemon } = await import('../daemon.mjs')
  base = await mkdtemp(join(tmpdir(), 'os135-fact-import-'))
  libRoot = join(base, 'lib')
  await mkdir(join(libRoot, '拆解'), { recursive: true })
  // OS-127 单实例锁：LOCALAPPDATA 指到临时目录，绝不碰开发者真机的锁
  await mkdir(join(base, 'appdata'), { recursive: true })
  daemon = await startDaemon({
    port: 0,
    root: libRoot,
    preferencesPath: join(base, 'prefs.json'),
    env: { ...process.env, LOCALAPPDATA: join(base, 'appdata') },
    logger: { log: () => {} }
  })
  port = await Promise.resolve(daemon.port)
})

after(async () => {
  if (daemon) await daemon.close()
  await rm(base, { recursive: true, force: true })
})

const post = async (path, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

describe('factEntriesImport 回归（OS-113 的 factPath ReferenceError）', () => {
  it('全新库首次导入：200 + revision 1 + 条目真实落盘（修复前这里 500：factPath is not defined）', async () => {
    const factPath = join(libRoot, '拆解', 'reg-book.json')
    assert.ok(!existsSync(factPath), '前置：这是全新库，fact 文件还不存在')

    const { status, body } = await post('/api/fact/entries/import', {
      root: libRoot,
      bookId: 'reg-book',
      title: '回归测试书',
      entries: ENTRIES,
      operationId: 'os135-regression-fresh-1'
    })
    // 修复前：status 500、body.error.message 含「factPath is not defined」
    assert.equal(status, 200, `首次导入应 200，实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.ok, true)
    assert.equal(body.bookId, 'reg-book')
    assert.equal(body.entries, 1)
    assert.equal(body.revision, 1, '新档首写 revision 应为 1')
    assert.equal(validateResponse('factEntriesImport', body).ok, true, '响应应符合契约形状')

    // 落盘内容：entries 真在文件里，revision/updatedAt 受管字段由内核写上
    const onDisk = JSON.parse(readFileSync(factPath, 'utf-8'))
    assert.equal(onDisk.revision, 1)
    assert.equal(onDisk.book.id, 'reg-book')
    assert.equal(onDisk.book.title, '回归测试书')
    assert.equal(onDisk.entries.length, 1)
    assert.equal(onDisk.entries[0].id, 'plot-1')
  })
})
