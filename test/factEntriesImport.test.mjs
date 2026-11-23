/**
 * OS-135①/② factEntriesImport 端点直测（真 HTTP＋临时夹具库）。
 *
 * ① 回归：OS-113 引入的 ReferenceError——分支里写了 `existsSync(factPath)`，但
 *   factPath 是另一个端点（deducePendingSettle）try 块里的局部 const，够不到；
 *   documentPath 自己也声明在 try 块内、出了 try 不可见。双重作用域错误让端点
 *   每次 500（2026-11-21 起，无测试覆盖静默两天）。修复：documentPath 提到 try 外。
 * ② 直测：全新库首写／已有档再导入（expectedRevision 并发路径）／同一 operationId
 *   重放幂等（内核 .operations 只留一条 applied）／已存在 0 字节文件（内核拒绝覆盖坏档，
 *   端点如实回错而不是 ReferenceError）／兄弟 wiki 落盘。
 *
 * 契约：contracts/fact.mjs factEntriesImport —— POST /api/fact/entries/import
 *   请求 { root, bookId, title?, entries, wiki?, operationId? }
 *   响应 { ok, bookId, entries, revision?, backup? }
 *
 * 跑法：node --test test/factEntriesImport.test.mjs
 */
import { strict as assert } from 'node:assert'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { validateResponse } from '../contracts.mjs'

let base = ''
let libRoot = ''
let daemon = null
let port = 0

const factFileOf = (bookId) => join(libRoot, '拆解', `${bookId}.json`)

const entryOf = (bookId, id, chapter, content) => ({
  schema: 'fact.data/v3',
  id,
  layer: 'plot',
  name: `第${chapter}章`,
  domain: '测试',
  status: 'fact',
  provenance: { book: bookId, book_id: bookId, mode: 'analyze', extractor: 'fact-chain/v1', chapters: [chapter] },
  who: ['沈岚'],
  events: [{ index: 1, who: '沈岚', channel: 'perceive', content, segments: [{ index: 1, chars: content.length }] }],
  validity: { from: chapter, to: chapter }
})

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

const importBook = ({ bookId, entries, wiki, operationId, title }) =>
  post('/api/fact/entries/import', { root: libRoot, bookId, title, entries, wiki, operationId })

/** 数 .operations.jsonl 里某 operationId 的 applied 记录条数（幂等断言用）。 */
const appliedCount = (operationId) => {
  const logPath = join(libRoot, '拆解', '.operations.jsonl')
  if (!existsSync(logPath)) return 0
  return readFileSync(logPath, 'utf-8').split('\n')
    .filter((line) => line.trim())
    .map((line) => { try { return JSON.parse(line) } catch { return {} } })
    .filter((record) => record.operationId === operationId && record.outcome === 'applied')
    .length
}

describe('factEntriesImport 回归（OS-113 的 factPath ReferenceError）', () => {
  it('全新库首次导入：200 + revision 1 + 条目真实落盘（修复前这里 500：factPath is not defined）', async () => {
    const factPath = factFileOf('reg-book')
    assert.ok(!existsSync(factPath), '前置：这是全新库，fact 文件还不存在')

    const { status, body } = await importBook({
      bookId: 'reg-book',
      title: '回归测试书',
      entries: [entryOf('reg-book', 'plot-1', 1, '沈岚看到弹幕预警。')],
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

describe('factEntriesImport 写端点直测（OS-135②）', () => {
  it('已有 fact 文件再导入：走 expectedRevision 并发路径，revision 递增、entries 整份替换', async () => {
    const before = JSON.parse(readFileSync(factFileOf('reg-book'), 'utf-8'))
    assert.equal(before.revision, 1, '前置：上一例已写入 revision 1')

    const { status, body } = await importBook({
      bookId: 'reg-book',
      title: '回归测试书',
      entries: [
        entryOf('reg-book', 'plot-1', 1, '沈岚看到弹幕预警（修订）。'),
        entryOf('reg-book', 'plot-2', 2, '沈岚决定反向设局。')
      ],
      wiki: { slots: { logline: '末世三天，她反杀囤货的男友。' } },
      operationId: 'os135-regression-second-1'
    })
    assert.equal(status, 200, `再导入应 200，实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.ok, true)
    assert.equal(body.revision, 2, '已有档再导入 revision 应 1→2')

    // 整份替换 + 兄弟 wiki 落盘（derivedFrom.factRevision 对齐主档 revision）
    const onDisk = JSON.parse(readFileSync(factFileOf('reg-book'), 'utf-8'))
    assert.equal(onDisk.revision, 2)
    assert.equal(onDisk.entries.length, 2)
    assert.equal(onDisk.entries[0].events[0].content, '沈岚看到弹幕预警（修订）。', '整份替换：旧内容应被新 entries 覆盖')
    assert.equal(onDisk.entries[1].id, 'plot-2')
    const wikiOnDisk = JSON.parse(readFileSync(factFileOf('reg-book').replace(/\.json$/u, '.wiki.json'), 'utf-8'))
    assert.equal(wikiOnDisk.derivedFrom.factRevision, 2)
    assert.equal(wikiOnDisk.slots.logline, '末世三天，她反杀囤货的男友。')
  })

  it('同一 operationId 重放幂等：revision 不动、落盘内容逐字节不变、.operations 只留一条 applied', async () => {
    const beforeRaw = readFileSync(factFileOf('reg-book'), 'utf-8')
    const beforeRevision = JSON.parse(beforeRaw).revision
    assert.equal(beforeRevision, 2, '前置：上一例已写入 revision 2')

    const { status, body } = await importBook({
      bookId: 'reg-book',
      entries: [entryOf('reg-book', 'plot-1', 1, '重放载荷——内核应按幂等键拦下，不落盘。')],
      operationId: 'os135-regression-second-1' // 与上一例同一 operationId
    })
    assert.equal(status, 200, `重放应 200，实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.ok, true)
    assert.equal(body.revision, 2, '重放不得再自增 revision')
    assert.equal(readFileSync(factFileOf('reg-book'), 'utf-8'), beforeRaw, '落盘内容应逐字节不变')
    assert.equal(appliedCount('os135-regression-second-1'), 1, '同一 operationId 只应有一条 applied 记录')
  })

  it('已存在 0 字节文件：按「已存在」处理，内核拒绝覆盖无效 JSON——如实报错而不是 ReferenceError', async () => {
    const zeroPath = factFileOf('zero-book')
    await writeFile(zeroPath, '', 'utf-8') // OS-113 关心的形态：0 字节 fact 文件先躺在盘上

    const { status, body } = await importBook({
      bookId: 'zero-book',
      title: '零字节书',
      entries: [entryOf('zero-book', 'plot-1', 1, '零字节档上的首次导入。')],
      operationId: 'os135-regression-zero-1'
    })
    // 修复前：这里连报错都到不了——直接 500「factPath is not defined」。
    // 修复后：内核读出 0 字节不是有效 JSON，拒绝覆盖（IO_FAILED），0 字节原样保留。
    // 注：内核失败信封的 message 嵌在 error 里（{ok,code,error:{code,message}}），
    // daemon 读 written.message 落空 → 回兜底文案「写入拆解失败」——如实锁当前行为。
    assert.equal(status, 500)
    assert.equal(body.ok, false)
    assert.equal(body.error.code, 'PINAX_IO_FAILED', '内核 IO_FAILED 原样透出（daemon 未映射，落 500 桶）')
    assert.equal(body.error.message, '写入拆解失败')
    assert.equal(statSync(zeroPath).size, 0, '内核拒绝覆盖，0 字节文件不得被改动')
    assert.equal(appliedCount('os135-regression-zero-1'), 0, '失败的写不得留 applied 记录')
  })

  it('换一本全新书再导入：daemon 未传 expectedRevision（读不到旧档），内核按新建 revision 1 落档', async () => {
    const { status, body } = await importBook({
      bookId: 'fresh-book',
      entries: [entryOf('fresh-book', 'plot-9', 9, '另一本书的第一条。')],
      operationId: 'os135-regression-fresh-2'
    })
    assert.equal(status, 200, `实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.revision, 1)
    const onDisk = JSON.parse(readFileSync(factFileOf('fresh-book'), 'utf-8'))
    assert.equal(onDisk.revision, 1)
    assert.equal(onDisk.entries[0].id, 'plot-9')
  })
})
