/**
 * OS-135② 写端点直测（真 HTTP＋临时夹具库＋临时端口）：
 *   · chapterPut 的 factStale（FACT-FIRST 规则 5）：正文写入不触发重建，但必须如实回报
 *     「拆解已落后于正文」——没拆解数据时 factStale:false / factEntries:0；
 *     拆解在盘、正文更新后 chapterPut 回 factStale:true + factEntries 计数。
 *   · referenceAbsorb（OS-48 旧目录迁入）：大纲/构思/资料 逐文件搬进 参考/<原名>/，
 *     源文件挪 .history（可逆）；目标已存在＝skip 不覆盖；白名单外的目录＝INVALID_ENTRY。
 *
 * 契约：contracts/chapters.mjs chapterPut —— PUT /api/chapter
 *         contracts/reference.mjs referenceAbsorb —— POST /api/reference/absorb
 *
 * 跑法：node --test test/writeEndpoints.test.mjs
 */
import { strict as assert } from 'node:assert'
import { existsSync, readdirSync, readFileSync, utimesSync } from 'node:fs'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { validateResponse } from '../src/api/contracts.mjs'

let base = ''
let libRoot = ''
let daemon = null
let port = 0

before(async () => {
  const { startDaemon } = await import('../src/host/daemon.mjs')
  base = await mkdtemp(join(tmpdir(), 'os135-write-endpoints-'))
  libRoot = join(base, 'lib')
  await mkdir(join(libRoot, '正文'), { recursive: true })
  await mkdir(join(libRoot, '拆解'), { recursive: true })
  await mkdir(join(libRoot, '大纲'), { recursive: true })
  await mkdir(join(libRoot, '资料'), { recursive: true })
  await writeFile(join(libRoot, '正文', '001-开局.md'), '第一章 开局\n沈岚看到弹幕预警：末世只剩三天。', 'utf-8')
  await writeFile(join(libRoot, '大纲', '主线大纲.md'), '# 主线\n预警→设局→收网。', 'utf-8')
  await writeFile(join(libRoot, '资料', '设定集.md'), '# 设定\n弹幕只在末世前三天可见。', 'utf-8')
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

const request = async (method, path, body) => {
  const response = await fetch(`http://127.0.0.1:${port}${path}`, {
    method,
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body)
  })
  return { status: response.status, body: await response.json() }
}

describe('chapterPut 的 factStale（FACT-FIRST 规则 5）', () => {
  it('没拆解数据时：factStale:false、factEntries:0（如实，不伪造健康度）', async () => {
    const { status, body } = await request('PUT', '/api/chapter', {
      root: libRoot,
      file: '正文/001-开局.md',
      text: '第一章 开局\n（这次保存时库里还没有拆解档。）'
    })
    assert.equal(status, 200, `实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.ok, true)
    assert.equal(validateResponse('chapterPut', body).ok, true, '响应应符合契约形状')
    assert.equal(body.factStale, false)
    assert.equal(body.factEntries, 0)
    assert.ok(body.chars > 0)
    assert.ok(!Number.isNaN(Date.parse(body.savedAt)))
  })

  it('拆解落盘后改正文：chapterPut 回 factStale:true + factEntries 计数（正文比拆解新＝过期）', async () => {
    // 先造拆解档（走 factEntriesImport——与生产同一条写通道）
    const imported = await request('POST', '/api/fact/entries/import', {
      root: libRoot,
      bookId: 'stale-book',
      title: '过期测试书',
      entries: [{
        schema: 'fact.data/v3',
        id: 'plot-1',
        layer: 'plot',
        name: '开局',
        domain: '测试',
        status: 'fact',
        provenance: { book: 'stale-book', book_id: 'stale-book', mode: 'analyze', extractor: 'fact-chain/v1', chapters: [1] },
        who: ['沈岚'],
        events: [{ index: 1, who: '沈岚', channel: 'perceive', content: '沈岚看到弹幕预警。', segments: [{ index: 1, chars: 9 }] }],
        validity: { from: 1, to: 1 }
      }],
      operationId: 'os135-stale-import-1'
    })
    assert.equal(imported.status, 200, `拆解导入应 200：${JSON.stringify(imported.body)}`)
    // mtime 确定性：把拆解档回拨 5 秒，保证接下来的正文写入必然更新
    const factFile = join(libRoot, '拆解', 'stale-book.json')
    const backdated = new Date(Date.now() - 5_000)
    utimesSync(factFile, backdated, backdated)

    const { status, body } = await request('PUT', '/api/chapter', {
      root: libRoot,
      file: '正文/001-开局.md',
      text: '第一章 开局\n沈岚改完了这一章——拆解还停在旧版上。'
    })
    assert.equal(status, 200, `实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.factStale, true, '正文比拆解新 → 必须如实标过期')
    assert.equal(body.factEntries, 1)
    assert.ok(body.backup, '写前应有 .history 备份')
  })
})

describe('referenceAbsorb 旧目录迁入（OS-48）', () => {
  it('大纲/资料 迁入 参考/<原名>/：moved 带备份路径，源文件挪 .history，内容逐字不变', async () => {
    const { status, body } = await request('POST', '/api/reference/absorb', {
      root: libRoot,
      dirs: ['大纲', '资料']
    })
    assert.equal(status, 200, `实际 ${status}：${JSON.stringify(body)}`)
    assert.equal(body.ok, true)
    assert.equal(validateResponse('referenceAbsorb', body).ok, true, '响应应符合契约形状')
    assert.equal(body.moved.length, 2)

    const movedOutline = body.moved.find((item) => item.from === '大纲/主线大纲.md')
    assert.ok(movedOutline, `moved 里应有 大纲/主线大纲.md：${JSON.stringify(body.moved)}`)
    assert.equal(movedOutline.to, '参考/大纲/主线大纲.md')
    assert.match(movedOutline.backup, /\.history\/.+\.deleted-/u, '源文件备份应挪进同目录 .history')

    assert.equal(
      readFileSync(join(libRoot, '参考', '大纲', '主线大纲.md'), 'utf-8'),
      '# 主线\n预警→设局→收网。'
    )
    assert.ok(!existsSync(join(libRoot, '大纲', '主线大纲.md')), '源文件应已不在原位')
    const historyDir = join(libRoot, '大纲', '.history')
    assert.ok(readdirSync(historyDir).some((name) => name.startsWith('主线大纲.md.deleted-')), '源文件应可从 .history 找回')
  })

  it('目标已存在＝skip 不覆盖、源保留原位；白名单外的目录＝INVALID_ENTRY', async () => {
    // 构造同名冲突：大纲/ 与 参考/大纲/ 里各有一份 冲突.md
    await writeFile(join(libRoot, '大纲', '冲突.md'), '大纲版（新写的）', 'utf-8')
    await mkdir(join(libRoot, '参考', '大纲'), { recursive: true })
    await writeFile(join(libRoot, '参考', '大纲', '冲突.md'), '参考版（不许覆盖）', 'utf-8')

    const again = await request('POST', '/api/reference/absorb', { root: libRoot, dirs: ['大纲'] })
    assert.equal(again.status, 200)
    assert.equal(again.body.ok, true)
    assert.equal(again.body.moved.length, 0, '有冲突的文件不得搬')
    const skip = again.body.skipped.find((item) => item.path === '大纲/冲突.md')
    assert.ok(skip, `skipped 里应有 大纲/冲突.md：${JSON.stringify(again.body.skipped)}`)
    assert.match(skip.reason, /目标已存在/u)
    assert.equal(
      readFileSync(join(libRoot, '参考', '大纲', '冲突.md'), 'utf-8'),
      '参考版（不许覆盖）',
      'skip 分支不得覆盖已有参考'
    )
    assert.equal(readFileSync(join(libRoot, '大纲', '冲突.md'), 'utf-8'), '大纲版（新写的）', 'skip 分支不得删源')

    // 白名单外（absorb 只认 大纲/构思/资料）
    const rejected = await request('POST', '/api/reference/absorb', { root: libRoot, dirs: ['正文'] })
    assert.equal(rejected.status, 400)
    assert.equal(rejected.body.ok, false)
    assert.equal(rejected.body.error.code, 'INVALID_ENTRY')
  })
})
