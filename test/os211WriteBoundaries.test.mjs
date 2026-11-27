/**
 * OS-211 写边界与 fact 完整性反证（真 HTTP＋临时夹具库＋port:0 daemon；MCP 走真 stdio）。
 *
 * 五组反证，逐条对应工单任务 1–5：
 *   ① 通用章节端点写 `故事源/`、`世界书/`、`故事源/*.json`、`.openstory/` 一律拒（400/403），
 *      文件不落盘、fact 不被绕过；`正文/`、`剧本/` 照常可写。
 *   ② 世界书专用端点 `PUT /api/reference/note`：只放行 `世界书/`；worldbook 模块停用＝409
 *      MODULE_DISABLED（归属正确）；宿主共享的章节端点停用 chapters 不受本端点影响。
 *   ③ `writeFactFile` 的 `patch.entries` 逐条 `validateFactEntry`：一条坏＝整份拒绝、零写入
 *      （主档字节不变、无 .operations applied 记录、无兄弟 wiki）。
 *   ④ fact/wiki revision 对齐：成功写后 `derivedFrom.factRevision === document.revision`；
 *      同一 operationId 重放幂等（主档与派生档都不再落盘）。
 *   ⑤ `checkSameSource` 真消费 `wikiDerivedFrom.factRevision`：两边可信且不等＝wikiStale，
 *      并覆盖「旧 samples/水浒传 的 7 条 fact 为何不合法、正确形状长什么样」的修复路径。
 *
 * 所有夹具都在系统临时目录；LOCALAPPDATA／APPDATA 全部注入临时值，不碰作者真库与本机配置。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { validateFactEntry, stableEntryId } from '../src/modules/fact/fact/domain/index.mjs'
import { writeFactFile, FACT_DIR_NAME, WIKI_DERIVED_SCHEMA } from '../src/modules/fact/fact/factFileStore.mjs'
import { checkSameSource } from '../src/services/syncCheck.mjs'
import { recordChange } from '../src/protocol/changelog.mjs'

/* ---------- 夹具 ---------- */

const FACT_DIR = '故事源'
const BOOK_ID = 'os211-book'

/** 合法 v3 plot 条目（与 test/factWriteProtocol.test.mjs 同一套字段口径）。 */
function plotEntry(name, { domain = '测试', chapters = [1], overrides = {} } = {}) {
  return {
    schema: 'fact.data/v3',
    id: stableEntryId({ layer: 'plot', domain, slot: '', name }),
    layer: 'plot',
    name,
    domain,
    status: 'adopted',
    provenance: {
      mode: 'analyze', book: BOOK_ID, book_id: BOOK_ID,
      chapters, scenes: [], extractor: 'os211-fixture'
    },
    fingerprint: { vec: null, metrics: {} },
    events: [{ index: 1, who: '沈岚', channel: 'perceive', content: `${name}这一段。`, segments: [{ index: 1, chars: 6 }] }],
    validity: { from: chapters[0] ?? null, to: chapters[0] ?? null },
    ...overrides
  }
}

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'os211-write-boundaries-'))
  const root = join(base, 'lib')
  for (const dir of ['正文', '剧本', '世界书', '故事源', '.openstory']) {
    await mkdir(join(root, dir), { recursive: true })
  }
  await writeFile(join(root, '正文', '001-开局.md'), '第一章 开局\n沈岚看到弹幕预警。', 'utf-8')
  await writeFile(join(root, '剧本', '001-第一场.md'), '第一场\n林冲：有人来了。\n', 'utf-8')
  await writeFile(join(root, '世界书', '人物', '..', 'placeholder').replace('人物/../placeholder', '检视示例.md'), '# 检视示例\n\n安全示例。\n', 'utf-8')
  await writeFile(join(root, FACT_DIR, `${BOOK_ID}.json`), JSON.stringify({
    book: { id: BOOK_ID, title: 'OS-211 夹具书' },
    entries: [plotEntry('第一章 开局')],
    revision: 1
  }, null, 2), 'utf-8')
  await writeFile(join(root, FACT_DIR, `${BOOK_ID}.wiki.json`), JSON.stringify({
    derivedFrom: { factRevision: 1, schema: WIKI_DERIVED_SCHEMA },
    chapterSummaries: []
  }, null, 2), 'utf-8')
  await mkdir(join(base, 'appdata'), { recursive: true })
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: [{ path: root, name: 'OS-211 夹具库', source: 'openstory' }]
  }, null, 2), 'utf-8')
  return { base, root, preferencesPath }
}

async function withDaemon(run) {
  const fixture = await makeLibrary()
  const daemon = await startDaemon({
    port: 0,
    root: fixture.root,
    preferencesPath: fixture.preferencesPath,
    env: { ...process.env, LOCALAPPDATA: join(fixture.base, 'appdata'), APPDATA: join(fixture.base, 'appdata') },
    logger: { log: () => {} }
  })
  const call = async (method, path, body) => {
    const response = await fetch(`http://127.0.0.1:${daemon.port}${path}`, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    return { status: response.status, payload: await response.json().catch(() => null) }
  }
  try {
    await run({ ...fixture, daemon, call })
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
}

const digestOf = (path) => {
  try { return createHash('sha256').update(readFileSync(path)).digest('hex') } catch { return '' }
}

/* ---------- ① 通用章节端点：非载体目录一律拒 ---------- */

test('OS-211 ① chapterPut 拒非载体目录：故事源/世界书/.openstory 均不落盘（fact 不被绕过）', async () => {
  await withDaemon(async ({ root, call }) => {
    const factPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const before = digestOf(factPath)
    const rejected = [
      { file: `${FACT_DIR}/${BOOK_ID}.json`, code: 'INVALID_ENTRY', label: '故事源主档' },
      { file: `${FACT_DIR}/${BOOK_ID}.wiki.json`, code: 'INVALID_ENTRY', label: '故事源派生档' },
      { file: '世界书/人物/宋江.md', code: 'INVALID_ENTRY', label: '世界书笔记（应走世界书端点）' },
      { file: '.openstory/project.json', code: 'INVALID_ENTRY', label: '元数据目录' },
      { file: '大纲/主线.md', code: 'INVALID_ENTRY', label: '已退场旧目录' },
      { file: '正文/.history/001-开局.md', code: 'INVALID_ENTRY', label: '备份目录' },
      { file: '../逃逸.md', code: 'PATH_ESCAPE', label: '路径逃逸' }
    ]
    for (const item of rejected) {
      const written = await call('PUT', '/api/chapter', { root, file: item.file, text: '{"entries":[]}' })
      assert.equal(written.status, item.code === 'PATH_ESCAPE' ? 403 : 400, `${item.label} 应被拒：${JSON.stringify(written.payload)}`)
      assert.equal(written.payload?.ok, false, `${item.label} 不得成功`)
      assert.equal(written.payload?.error?.code, item.code, `${item.label} 错误码不对：${JSON.stringify(written.payload)}`)
    }
    assert.equal(digestOf(factPath), before, '故事源主档逐字节不变（通用端点没绕过 fact 协议）')
    assert.equal(existsSync(join(root, '世界书', '人物', '宋江.md')), false, '世界书笔记没有被通用端点写出')

    // 载体目录照常可写（不误伤正常写作）
    const okBody = await call('PUT', '/api/chapter', { root, file: '正文/001-开局.md', text: '第一章 开局\n改过的一段。' })
    assert.equal(okBody.status, 200, JSON.stringify(okBody.payload))
    assert.ok(okBody.payload.backup, '写前 .history 备份语义不变')
    const scriptOk = await call('PUT', '/api/chapter', { root, file: '剧本/001-第一场.md', text: '第一场\n林冲：有人来了。\n' })
    assert.equal(scriptOk.status, 200, JSON.stringify(scriptOk.payload))
  })
})

test('OS-211 ① chaptersCreate/rename/delete 同闸：非载体目录建/改/删都不许', async () => {
  await withDaemon(async ({ root, call }) => {
    const created = await call('POST', '/api/chapters', { root, dir: FACT_DIR, title: '偷建一章' })
    assert.equal(created.status, 400, JSON.stringify(created.payload))
    assert.equal(created.payload?.error?.code, 'INVALID_ENTRY')
    assert.equal(existsSync(join(root, FACT_DIR, '001-偷建一章.md')), false)

    const renamed = await call('POST', '/api/chapters/rename', { root, file: `${FACT_DIR}/${BOOK_ID}.json`, title: '改名' })
    assert.equal(renamed.status, 400, JSON.stringify(renamed.payload))
    const removed = await call('DELETE', `/api/chapter?root=${encodeURIComponent(root)}&file=${encodeURIComponent(`${FACT_DIR}/${BOOK_ID}.json`)}`)
    assert.equal(removed.status, 400, JSON.stringify(removed.payload))
    assert.equal(existsSync(join(root, FACT_DIR, `${BOOK_ID}.json`)), true, '故事源主档仍在原处')
  })
})

test('OS-211 ① 日志恢复也不许整份覆盖 故事源/（载体＋世界书以外一律拒；世界书仍可恢复）', async () => {
  await withDaemon(async ({ root, call }) => {
    // 造一条「历史上有过」的恢复记录：recordChange 记 file=故事源/x.json，backup 指向一个真文件。
    // 真实历史里这种记录可能存在（旧版本允许），恢复动作必须被写边界拦下——否则文本通道
    // 就绕过了 schema/revision/operationId。
    const factPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const before = digestOf(factPath)
    const backupRel = `世界书/.history/假备份.md.bak-2026-11-26T00-00-00-000Z`
    await mkdir(join(root, '世界书', '.history'), { recursive: true })
    await writeFile(join(root, backupRel), '{"entries":[]}', 'utf-8')
    const recorded = await recordChange({
      root, module: '故事源', file: `${FACT_DIR}/${BOOK_ID}.json`,
      op: 'update', before: '{"entries":[1]}', after: readFileSync(factPath, 'utf-8'),
      actor: 'author', backup: backupRel
    })
    assert.equal(recorded.ok, true, JSON.stringify(recorded))

    const rejected = await call('POST', '/api/log/restore', {
      root, module: '故事源', at: recorded.record.at, afterHash: recorded.record.afterHash
    })
    assert.equal(rejected.status, 400, JSON.stringify(rejected.payload))
    assert.equal(rejected.payload?.error?.code, 'INVALID_ENTRY')
    assert.match(rejected.payload?.error?.message ?? '', /日志恢复不放行/u)
    assert.equal(digestOf(factPath), before, '故事源主档逐字节不变（恢复没写进去）')

    // 世界书笔记的恢复照常放行（不误伤合法回写）
    const noteRel = '世界书/人物/恢复试验.md'
    await mkdir(join(root, '世界书', '人物'), { recursive: true })
    await writeFile(join(root, noteRel), '第一版\n', 'utf-8')
    const noteBackupRel = '世界书/人物/.history/恢复试验.md.bak-2026-11-26T00-00-00-000Z'
    await mkdir(join(root, '世界书', '人物', '.history'), { recursive: true })
    await writeFile(join(root, noteBackupRel), '第一版\n', 'utf-8')
    await writeFile(join(root, noteRel), '第二版\n', 'utf-8')
    const noteRecord = await recordChange({
      root, module: '世界书', file: noteRel, op: 'update', before: '第一版\n', after: '第二版\n',
      actor: 'author', backup: noteBackupRel
    })
    assert.equal(noteRecord.ok, true, JSON.stringify(noteRecord))
    const restored = await call('POST', '/api/log/restore', {
      root, module: '世界书', at: noteRecord.record.at, afterHash: noteRecord.record.afterHash
    })
    assert.equal(restored.status, 200, JSON.stringify(restored.payload))
    assert.equal(readFileSync(join(root, noteRel), 'utf-8'), '第一版\n', '世界书恢复真回写了上一版')
  })
})

/* ---------- ② 世界书专用写端点 ---------- */

test('OS-211 ② PUT /api/reference/note 只写 世界书/：成功带备份、越界拒、worldbook 停用 409', async () => {
  await withDaemon(async ({ root, call }) => {
    const created = await call('PUT', '/api/reference/note', { root, path: '世界书/人物/宋江.md', text: '---\ntags: [人物]\n---\n\n# 宋江\n\n呼保义。\n' })
    assert.equal(created.status, 200, JSON.stringify(created.payload))
    assert.equal(created.payload.ok, true)
    assert.equal(created.payload.path, '世界书/人物/宋江.md')
    assert.equal(created.payload.backup, undefined, '新建无备份（对标 chapterPut：不存在时无 .history）')
    assert.equal(readFileSync(join(root, '世界书', '人物', '宋江.md'), 'utf-8').includes('呼保义'), true)

    const updated = await call('PUT', '/api/reference/note', { root, path: '世界书/人物/宋江.md', text: '---\ntags: [人物]\n---\n\n# 宋江\n\n及时雨。\n' })
    assert.equal(updated.status, 200, JSON.stringify(updated.payload))
    assert.match(String(updated.payload.backup), /^世界书\/人物\/\.history\//u, `改稿应有 .history 备份：${JSON.stringify(updated.payload)}`)
    assert.match(readFileSync(join(root, updated.payload.backup), 'utf-8'), /呼保义/u, '备份里是上一版内容')

    // 其它目录一律拒：正文／剧本／故事源／元数据
    for (const path of ['正文/001-开局.md', '剧本/001-第一场.md', `${FACT_DIR}/${BOOK_ID}.json`, '.openstory/project.json']) {
      const rejected = await call('PUT', '/api/reference/note', { root, path, text: '越界写入' })
      assert.equal(rejected.status, 400, `${path} 应被拒：${JSON.stringify(rejected.payload)}`)
      assert.equal(rejected.payload?.error?.code, 'INVALID_ENTRY')
    }
    assert.equal(readFileSync(join(root, '正文', '001-开局.md'), 'utf-8').includes('越界写入'), false)

    // 模块闸：worldbook 停用 → 409 MODULE_DISABLED；chapters 停用不影响本端点
    await call('PUT', '/api/ui-state', { root, state: { 'modules.enabled.worldbook': false } })
    const disabled = await call('PUT', '/api/reference/note', { root, path: '世界书/人物/宋江.md', text: '停用期间不该写进去' })
    assert.equal(disabled.status, 409, JSON.stringify(disabled.payload))
    assert.equal(disabled.payload?.error?.code, 'MODULE_DISABLED')
    assert.equal(readFileSync(join(root, '世界书', '人物', '宋江.md'), 'utf-8').includes('停用期间'), false)
    await call('PUT', '/api/ui-state', { root, state: { 'modules.enabled.worldbook': true } })

    await call('PUT', '/api/ui-state', { root, state: { 'modules.enabled.chapters': false } })
    const stillOk = await call('PUT', '/api/reference/note', { root, path: '世界书/人物/宋江.md', text: '---\ntags: [人物]\n---\n\n# 宋江\n\nchapters 停用不影响世界书写。\n' })
    assert.equal(stillOk.status, 200, JSON.stringify(stillOk.payload))
    await call('PUT', '/api/ui-state', { root, state: { 'modules.enabled.chapters': true } })
  })
})

test('OS-211 ② 反向：世界书端点不可写正文（写通道归属互不越界）', async () => {
  await withDaemon(async ({ root, call }) => {
    const body = await call('PUT', '/api/reference/note', { root, path: '正文/001-开局.md', text: '想从世界书端点改正文' })
    assert.equal(body.status, 400, JSON.stringify(body.payload))
    assert.equal(body.payload?.error?.details?.worldbookDir, '世界书')
    assert.equal(readFileSync(join(root, '正文', '001-开局.md'), 'utf-8').includes('想从世界书端点改正文'), false)
  })
})

test('OS-211 ② 产物「恢复此版本」链：世界书历史档 → 原文件（chapter 通道 400 / reference 通道 200 且留备份）', async () => {
  // 评审 P1 反证：产物面板对世界书 .history 档照样渲染「恢复此版本」按钮。
  // 恢复链＝读历史档 → 回写原文件；世界书目标必须走 referenceNotePut，走 chapter 必被载体闸拒。
  const { artifactRestoreRoute } = await import('../public/views/workbenchViews.mjs')
  await withDaemon(async ({ root, call }) => {
    const noteRel = '世界书/人物/宋江.md'
    // 造出真实历史档：两次写入，第二次的响应带 .history 备份路径
    await call('PUT', '/api/reference/note', { root, path: noteRel, text: '第一版\n' })
    const second = await call('PUT', '/api/reference/note', { root, path: noteRel, text: '第二版\n' })
    assert.equal(second.status, 200, JSON.stringify(second.payload))
    const historyFile = second.payload.backup
    assert.match(String(historyFile), /^世界书\/人物\/\.history\//u, `历史档路径：${historyFile}`)

    // 产物盘点给出的 original 正是原笔记路径（恢复按钮拿它当目标）
    const inventory = await call('GET', `/api/artifacts?root=${encodeURIComponent(root)}`)
    const worldbookGroup = inventory.payload.groups.find((group) => group.dir === '世界书')
    const historyItem = worldbookGroup?.history?.find((item) => item.file === historyFile)
    assert.ok(historyItem, `盘点应列出这条历史档：${JSON.stringify(worldbookGroup?.history)}`)
    assert.equal(historyItem.original, noteRel)

    // ① 目标在世界书下 → 路由必须选 referenceNotePut（chapter 已不收世界书）
    const route = artifactRestoreRoute(historyItem.original, { worldbookDir: '世界书' })
    assert.equal(route.kind, 'worldbook')
    assert.equal(route.put, '/api/reference/note')
    assert.equal(route.read, '/api/reference/note')

    // ② 旧路径（chapter 通道）写世界书：必须 400，且笔记内容不变
    const viaChapter = await call('PUT', '/api/chapter', { root, file: noteRel, text: '第一版\n' })
    assert.equal(viaChapter.status, 400, `chapter 通道写世界书必须被拒：${JSON.stringify(viaChapter.payload)}`)
    assert.equal(viaChapter.payload?.error?.code, 'INVALID_ENTRY')
    assert.equal(readFileSync(join(root, noteRel), 'utf-8'), '第二版\n', '被拒后笔记内容不变')

    // ③ 新路径：读历史档（referenceNoteGet 也能读 .history 下的路径）→ 写回原文件
    const version = await call('GET', `/api/reference/note?${new URLSearchParams({ root, path: historyFile })}`)
    assert.equal(version.status, 200, JSON.stringify(version.payload))
    assert.equal(version.payload.note.text, '第一版\n')
    const restored = await call('PUT', route.put, { root, path: historyItem.original, text: version.payload.note.text })
    assert.equal(restored.status, 200, `世界书恢复必须 200：${JSON.stringify(restored.payload)}`)
    assert.match(String(restored.payload.backup), /^世界书\/人物\/\.history\//u, '恢复动作本身也要先备份（可回退）')
    assert.equal(readFileSync(join(root, noteRel), 'utf-8'), '第一版\n', '恢复真的把上一版写回原文件')

    // ④ 反向确认：同一条链对载体（正文）仍走 chapter 且成功
    const carrierRoute = artifactRestoreRoute('正文/001-开局.md', { worldbookDir: '世界书' })
    assert.equal(carrierRoute.put, '/api/chapter')
    const chapterHistory = await call('PUT', '/api/chapter', { root, file: '正文/001-开局.md', text: '正文第二版\n' })
    assert.equal(chapterHistory.status, 200, JSON.stringify(chapterHistory.payload))
    const chapterVersion = await call('GET', `/api/chapter?${new URLSearchParams({ root, file: chapterHistory.payload.backup })}`)
    assert.equal(chapterVersion.status, 200)
    const chapterRestored = await call('PUT', carrierRoute.put, {
      root, file: '正文/001-开局.md', text: chapterVersion.payload.text
    })
    assert.equal(chapterRestored.status, 200, JSON.stringify(chapterRestored.payload))
  })
})

/* ---------- ③ patch.entries 逐条校验：一条坏＝整份拒绝、零写入 ---------- */

test('OS-211 ③ writeFactFile patch.entries 有一条不合法：整份拒绝、主档逐字节不变、无 applied 记录', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os211-patch-'))
  const root = join(base, 'lib')
  try {
    const seeded = await writeFactFile({ root, bookId: BOOK_ID, entry: plotEntry('第一章 开局'), operationId: 'op-seed' })
    assert.equal(seeded.ok, true, JSON.stringify(seeded.error))
    const mainPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const before = digestOf(mainPath)
    const namesBefore = (await readdir(join(root, FACT_DIR))).sort()

    const good = plotEntry('第二章 设局', { chapters: [2] })
    // 坏条目：schema 版本错（信封校验必拦）
    const bad = { ...plotEntry('第三章 收网', { chapters: [3] }), schema: 'fact.data/v1' }
    const rejected = await writeFactFile({
      root, bookId: BOOK_ID,
      patch: { entries: [good, bad] },
      operationId: 'op-bad-entries'
    })
    assert.equal(rejected.ok, false, '整份替换必须被拒')
    assert.equal(rejected.code, 'VALIDATION_FAILED')
    const entries = rejected.error?.details?.entries ?? rejected.details?.entries ?? []
    assert.equal(entries.length, 1, `只有坏的那条被点名：${JSON.stringify(rejected.error ?? rejected.details)}`)
    assert.equal(entries[0].index, 1)
    assert.ok(entries[0].errors.some((item) => item.code === 'SCHEMA_MISMATCH'), JSON.stringify(entries[0]))

    assert.equal(digestOf(mainPath), before, '主档逐字节不变（零写入）')
    assert.deepEqual((await readdir(join(root, FACT_DIR))).sort(), namesBefore, '不落临时档／派生档')
    const operations = readFileSync(join(root, FACT_DIR, '.operations.jsonl'), 'utf-8').trim().split('\n').map((line) => JSON.parse(line))
    assert.ok(!operations.some((record) => record.operationId === 'op-bad-entries'), '失败的写不留 applied 记录')

    // 同样两条但全合法：整份替换成功，revision +1
    const accepted = await writeFactFile({
      root, bookId: BOOK_ID,
      patch: { entries: [good, plotEntry('第三章 收网', { chapters: [3] })] },
      operationId: 'op-good-entries'
    })
    assert.equal(accepted.ok, true, JSON.stringify(accepted.error))
    const document = JSON.parse(readFileSync(mainPath, 'utf-8'))
    assert.equal(document.revision, 2)
    assert.deepEqual(document.entries.map((item) => item.name), ['第二章 设局', '第三章 收网'])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-211 ③ 缺 id 的条目同样被拒（patch.entries 按 id 定位，空 id 不是合法条目）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os211-patch-id-'))
  const root = join(base, 'lib')
  try {
    const orphan = plotEntry('无 id')
    delete orphan.id
    const rejected = await writeFactFile({ root, bookId: BOOK_ID, patch: { entries: [orphan] }, operationId: 'op-no-id' })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'VALIDATION_FAILED')
    assert.equal(existsSync(join(root, FACT_DIR, `${BOOK_ID}.json`)), false, '失败写连主档都不新建')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-211 ③ 单条 upsert 与 patch.entries 走同一份校验（旧合法数据不受影响）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os211-same-check-'))
  const root = join(base, 'lib')
  try {
    const entry = plotEntry('第一章 开局')
    assert.equal(validateFactEntry(entry).ok, true, '夹具本身必须合法')

    // 单条通道拒绝同一份坏条目，理由与 patch 通道同一套码
    const single = await writeFactFile({ root, bookId: BOOK_ID, entry: { ...entry, status: 'fact' }, operationId: 'op-single-bad' })
    assert.equal(single.code, 'VALIDATION_FAILED')
    const patch = await writeFactFile({ root, bookId: BOOK_ID, patch: { entries: [{ ...entry, status: 'fact' }] }, operationId: 'op-patch-bad' })
    assert.equal(patch.code, 'VALIDATION_FAILED')
    const singleCodes = new Set((single.error?.details?.errors ?? []).map((item) => item.code))
    const patchCodes = new Set((patch.error?.details?.entries?.[0]?.errors ?? patch.details?.entries?.[0]?.errors ?? []).map((item) => item.code))
    assert.deepEqual([...patchCodes].sort(), [...singleCodes].sort(), '两条通道的校验码集合一致')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- ④ fact/wiki revision 对齐 + 幂等 ---------- */

test('OS-211 ④ writeFactFile 写完 patch.wiki：derivedFrom.factRevision === document.revision（含每次递增）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os211-wiki-rev-'))
  const root = join(base, 'lib')
  try {
    const mainPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const wikiPath = join(root, FACT_DIR, `${BOOK_ID}.wiki.json`)
    for (const [index, name] of ['第一章 开局', '第二章 设局', '第三章 收网'].entries()) {
      const written = await writeFactFile({
        root, bookId: BOOK_ID,
        entry: plotEntry(name, { chapters: [index + 1] }),
        // 每轮回带 wiki：验证「同一笔写里主档与派生档对齐」而不是只在首写成立
        patch: { wiki: { chapterSummaries: [{ chapter: index + 1, title: name }] } },
        operationId: `op-wiki-${index}`
      })
      assert.equal(written.ok, true, JSON.stringify(written.error))
      const document = JSON.parse(readFileSync(mainPath, 'utf-8'))
      const sibling = JSON.parse(readFileSync(wikiPath, 'utf-8'))
      assert.equal(written.revision, index + 1)
      assert.equal(document.revision, index + 1)
      assert.equal(sibling.derivedFrom.factRevision, document.revision, `第 ${index + 1} 轮派生基准必须等于主档 revision`)
      assert.equal(sibling.derivedFrom.schema, WIKI_DERIVED_SCHEMA)
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-211 ④ 入参自带 derivedFrom 不得覆盖内核基准（真实生产 wiki 形状）', async () => {
  // 评审 P1 反证：真实调用链 public/scriptFact.mjs 产出的 wiki 硬编码
  // `derivedFrom:{factRevision:1}`（真源在那里，但它不是基准的权威）。旧实现把
  // `...wiki` 展开在 derivedFrom 之后 → 入参盖掉内核算的值 → 基准恒为 1 → 同源检查永久 stale。
  const base = await mkdtemp(join(tmpdir(), 'os211-wiki-incoming-'))
  const root = join(base, 'lib')
  try {
    const mainPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const wikiPath = join(root, FACT_DIR, `${BOOK_ID}.wiki.json`)
    const incomingDerivedFrom = { factRevision: 1, schema: 'openstory-wiki-derived@2' }
    for (const [index, name] of ['第一章 开局', '第二章 设局', '第三章 收网'].entries()) {
      const written = await writeFactFile({
        root, bookId: BOOK_ID,
        entry: plotEntry(name, { chapters: [index + 1] }),
        patch: {
          wiki: {
            derivedFrom: incomingDerivedFrom,      // 调用方自带的（恒为 1）——必须被覆盖
            version: 'wiki-enrich@3',
            chapterSummaries: [{ chapter: index + 1, title: name }]
          }
        },
        operationId: `op-incoming-${index}`
      })
      assert.equal(written.ok, true, JSON.stringify(written.error))
      const document = JSON.parse(readFileSync(mainPath, 'utf-8'))
      const sibling = JSON.parse(readFileSync(wikiPath, 'utf-8'))
      assert.equal(
        sibling.derivedFrom.factRevision, document.revision,
        `第 ${index + 1} 轮：入参 derivedFrom=${incomingDerivedFrom.factRevision} 不得盖掉内核基准`
      )
      assert.equal(sibling.derivedFrom.schema, WIKI_DERIVED_SCHEMA, 'schema 也由内核定')
      assert.equal(sibling.version, 'wiki-enrich@3', '其余 wiki 字段原样保留')
      assert.deepEqual(sibling.chapterSummaries, [{ chapter: index + 1, title: name }])
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-211 ④ 真实生产链（scriptToFact→importWrite→writeFactFile）：不变式成立且同源检查不误报 stale', async () => {
  // 走真实入口，不手搓 wiki：public/scriptFact.mjs 的 scriptToFact() 就是前端「剧本→故事源」
  // 按钮用的那一个（public/app.js 送 /api/fact/entries/import → handlers/fact.mjs → importWrite）。
  const { scriptToFact } = await import('../public/scriptFact.mjs')
  const { writeFactEntries } = await import('../src/modules/fact/fact/importWrite.mjs')
  const base = await mkdtemp(join(tmpdir(), 'os211-script-chain-'))
  const root = join(base, 'lib')
  try {
    const script = [
      '# 第一幕 风声', '', '〔荒原〕', '', '林冲：（压低声音）有人来了。', '',
      '# 第二幕 雪夜', '', '〔山神庙〕', '', '林冲：此仇不报非君子。'
    ].join('\n')
    const { entries, wiki } = await scriptToFact(script, { bookId: BOOK_ID, domain: '舞台剧' })
    assert.equal(wiki.derivedFrom.factRevision, 1, '前置：生产入口自带的基准恒为 1（正是被覆盖的那份）')

    // 连写三次：真实入口每次都带同一份硬编码 derivedFrom
    let last = null
    for (let round = 0; round < 3; round += 1) {
      last = await writeFactEntries({ root, bookId: BOOK_ID, entries, wiki, operationId: `script-chain-${round}` })
      assert.equal(last.ok, true, JSON.stringify(last))
      const document = JSON.parse(readFileSync(join(root, FACT_DIR, `${BOOK_ID}.json`), 'utf-8'))
      const sibling = JSON.parse(readFileSync(join(root, FACT_DIR, `${BOOK_ID}.wiki.json`), 'utf-8'))
      assert.equal(
        sibling.derivedFrom.factRevision, document.revision,
        `第 ${round + 1} 轮不变式必须成立（revision=${document.revision}）`
      )
    }

    // 同源检查真读这条链落下的两个文件：不得误报 stale
    const document = JSON.parse(readFileSync(join(root, FACT_DIR, `${BOOK_ID}.json`), 'utf-8'))
    const sibling = JSON.parse(readFileSync(join(root, FACT_DIR, `${BOOK_ID}.wiki.json`), 'utf-8'))
    const same = checkSameSource({
      factRevision: document.revision,
      wikiDerivedFrom: sibling.derivedFrom,
      factMtime: new Date().toISOString(),
      wikiGeneratedAt: new Date().toISOString()
    })
    assert.equal(same.revisionComparable, true, '两边 revision 都可信')
    assert.equal(same.wikiFactRevision, document.revision)
    assert.equal(same.wikiStale, false, `同一次写入后不得报过期：${JSON.stringify(same)}`)
    assert.match(same.wikiNote, /一致/u)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-211 ④ 同一 operationId 重放：主档与兄弟 wiki 都不再落盘（幂等含派生档）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os211-wiki-idem-'))
  const root = join(base, 'lib')
  try {
    const mainPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const wikiPath = join(root, FACT_DIR, `${BOOK_ID}.wiki.json`)
    const first = await writeFactFile({
      root, bookId: BOOK_ID,
      entry: plotEntry('第一章 开局'),
      patch: { wiki: { chapterSummaries: [{ chapter: 1, title: '开局' }] } },
      operationId: 'op-idem'
    })
    assert.equal(first.ok, true, JSON.stringify(first.error))
    const mainBytes = readFileSync(mainPath)
    const wikiBytes = readFileSync(wikiPath)

    const replay = await writeFactFile({
      root, bookId: BOOK_ID,
      entry: plotEntry('第一章 开局', { overrides: { definition: '重放载荷不该落盘' } }),
      patch: { wiki: { chapterSummaries: [{ chapter: 1, title: '重放' }] } },
      operationId: 'op-idem'
    })
    assert.equal(replay.ok, true)
    assert.equal(replay.duplicate, true)
    assert.equal(replay.revision, first.revision, '重放不推进 revision')
    assert.deepEqual(readFileSync(mainPath), mainBytes, '主档逐字节不变')
    assert.deepEqual(readFileSync(wikiPath), wikiBytes, '派生档逐字节不变')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- ⑤ syncCheck 消费 revision ---------- */

test('OS-211 ⑤ checkSameSource：两边 revision 可信且不等＝wikiStale（时间戳一致也不放过）', () => {
  const at = '2026-11-26T10:00:00.000Z'
  const stale = checkSameSource({
    factMtime: at,
    wikiGeneratedAt: at,           // 时间戳完全一致——旧口径会判「一致」
    factRevision: 5,
    wikiDerivedFrom: { factRevision: 4, schema: WIKI_DERIVED_SCHEMA }
  })
  assert.equal(stale.wikiStale, true, 'revision 不一致必须报 stale（真实样本：主档 5 / wiki 4）')
  assert.equal(stale.factRevision, 5)
  assert.equal(stale.wikiFactRevision, 4)
  assert.equal(stale.revisionComparable, true)
  assert.match(stale.wikiNote, /第 4 版/u)
  assert.match(stale.wikiNote, /第 5 版/u)

  const aligned = checkSameSource({
    factMtime: at,
    wikiGeneratedAt: at,
    factRevision: 5,
    wikiDerivedFrom: { factRevision: 5, schema: WIKI_DERIVED_SCHEMA }
  })
  assert.equal(aligned.wikiStale, false, 'revision 相等＝一致')
  assert.equal(aligned.revisionComparable, true)
})

test('OS-211 ⑤ checkSameSource：revision 不可信时退回时间戳，并把可信度如实报出来', () => {
  const fact = '2026-11-19T18:42:49.738Z'
  const wiki = '2026-11-19T06:51:01.998Z'
  // 旧信封没有 derivedFrom → wikiFactRevision=null，只能靠时间戳
  const legacy = checkSameSource({ factMtime: fact, wikiGeneratedAt: wiki, factRevision: 4 })
  assert.equal(legacy.revisionComparable, false)
  assert.equal(legacy.wikiFactRevision, null)
  assert.equal(legacy.wikiStale, true, '时间戳兜底仍然报过期')
  assert.equal(legacy.factRevision, 4)

  // 主档 revision 读不到（null）也不许被 Number(null) 悄悄算成 0
  const unknown = checkSameSource({
    factMtime: fact, wikiGeneratedAt: wiki,
    factRevision: null, entries: [{ id: 'a' }],
    wikiDerivedFrom: { factRevision: 0 }
  })
  assert.equal(unknown.revisionComparable, false, 'revision 读不到＝不可比')
  assert.equal(unknown.wikiStale, true)
})

test('OS-211 ⑤ 修复路径：旧 samples 的 7 条 fact 为何不合法，正确形状能过同一校验', async () => {
  // 工单验收：「新样本构建前，7 条旧 fact 的问题有明确修复路径；本单不手改 samples」。
  // 这里直接拿 samples/水浒传/故事源/shuihu.json 的现存条目跑校验，逐条列出原因——
  // 断言的是「当前确实不合法」这一事实（样本由 OS-218 重建，本单只证明路径）。
  const samplePath = new URL('../samples/水浒传/故事源/shuihu.json', import.meta.url)
  const sample = JSON.parse(readFileSync(samplePath, 'utf-8'))
  assert.equal(sample.entries.length, 7, '样本仍是 7 条（本单不手改 samples）')
  const reasons = sample.entries.map((entry) => ({ id: entry.id, errors: validateFactEntry(entry).errors.map((item) => `${item.code}:${item.field}`) }))
  for (const item of reasons) {
    assert.ok(item.errors.length > 0, `旧样本条目 ${item.id} 应当被校验拦下（这正是不合法的证据）`)
  }
  assert.deepEqual(reasons.map((item) => item.id), ['w1', 'w2', 'c1', 'c2', 'c3', 'p1', 'p2'], '样本条目未变（本单不手改）')
  const allCodes = new Set(reasons.flatMap((item) => item.errors.map((code) => code.split(':')[0])))
  for (const code of ['MISSING_REQUIRED', 'ID_FORMAT']) {
    assert.ok(allCodes.has(code), `修复清单必须覆盖 ${code}：${[...allCodes].join(',')}`)
  }

  // 正确形状：按同一层补齐 domain/slot/provenance/fingerprint、id 用 stableEntryId → 过校验。
  const rebuilt = {
    schema: 'fact.data/v3',
    id: stableEntryId({ layer: 'worldview', domain: '水浒世界', slot: 'concepts', name: '一百单八魔君' }),
    layer: 'worldview',
    name: '一百单八魔君',
    domain: '水浒世界',
    slot: 'concepts',
    definition: '一百单八个魔君，被镇在龙虎山伏魔殿。',
    provenance: { mode: 'analyze', book: '水浒传', book_id: 'shuihu', chapters: [1], scenes: [], extractor: 'fact-chain/v1' },
    fingerprint: { vec: null, metrics: {} },
    status: 'adopted'
  }
  const checked = validateFactEntry(rebuilt)
  assert.equal(checked.ok, true, `补齐后的形状必须合法：${JSON.stringify(checked.errors)}`)

  // 而且真能经写协议落盘（patch.entries 通道也不再拒绝它）
  const base = await mkdtemp(join(tmpdir(), 'os211-sample-fix-'))
  try {
    const written = await writeFactFile({
      root: join(base, 'lib'), bookId: 'shuihu',
      patch: { entries: [rebuilt] }, operationId: 'op-rebuilt-sample'
    })
    assert.equal(written.ok, true, JSON.stringify(written.error))
    assert.equal(written.revision, 1)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 待确认卡：同一道闸 ---------- */

test('OS-211 ① 待确认卡目标也受载体约束（采纳走同一写通道，建卡时就拒）', async () => {
  await withDaemon(async ({ root, daemon, call }) => {
    const mcpLike = null
    void mcpLike
    const session = await call('POST', '/api/agent/sessions', { root, title: 'OS-211 边界' })
    assert.equal(session.status, 200, JSON.stringify(session.payload))
    const sessionId = session.payload?.session?.id
    assert.ok(sessionId, '应建出会话')

    const factPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const before = digestOf(factPath)
    for (const file of [`${FACT_DIR}/${BOOK_ID}.json`, '世界书/人物/宋江.md', '.openstory/project.json']) {
      const card = await call('POST', '/api/agent/cards', { root, sessionId, file, text: '{"entries":[]}' })
      assert.equal(card.status, 400, `${file} 建卡应被拒：${JSON.stringify(card.payload)}`)
      assert.equal(card.payload?.error?.code, 'INVALID_ENTRY')
    }
    assert.equal(digestOf(factPath), before, '故事源主档逐字节不变')

    const okCard = await call('POST', '/api/agent/cards', { root, sessionId, file: '正文/001-开局.md', text: '第一章 开局\n卡片正文。' })
    assert.equal(okCard.status, 200, JSON.stringify(okCard.payload))
    assert.equal(okCard.payload.card.file, '正文/001-开局.md')
    void daemon
  })
})

test('OS-211 ① 绕过建卡闸：直接改会话 jsonl 把 open 卡指向故事源，adopt 必须拒且主档不变', async () => {
  // 评审 P1 反证：卡的目标来自会话 jsonl，历史数据与外部工具都能往里塞一张 open 卡——
  // 只守建卡端点不够，落盘点（agentCardAdopt）必须自己再判一次载体目录。
  const { fileSnapshot } = await import('../src/modules/agentbar/agentStore.mjs')
  await withDaemon(async ({ base, root, call }) => {
    const session = await call('POST', '/api/agent/sessions', { root, title: 'OS-211 采纳边界' })
    const sessionId = session.payload?.session?.id
    assert.ok(sessionId)
    const card = await call('POST', '/api/agent/cards', { root, sessionId, file: '正文/001-开局.md', text: '卡片正文' })
    assert.equal(card.status, 200, JSON.stringify(card.payload))
    const cardId = card.payload.card.id

    // 定位 daemon 实际使用的会话 jsonl（临时 LOCALAPPDATA 下，按 root 分目录）
    const findJsonl = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          const hit = await findJsonl(path)
          if (hit) return hit
        } else if (entry.name.endsWith('.jsonl')) return path
      }
      return null
    }
    const jsonl = await findJsonl(base)
    assert.ok(jsonl, '应找到会话 jsonl')
    const lines = readFileSync(jsonl, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
    const index = lines.findIndex((line) => line.t === 'card' && line.id === cardId)
    assert.ok(index >= 0, '会话里应有这张卡')
    // 模拟「历史数据/外部工具」把目标改成故事源主档，并同步快照让快照闸放行
    const factPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const before = readFileSync(factPath, 'utf-8')
    const forgedText = JSON.stringify({ book: { id: BOOK_ID }, entries: [{ id: 'evil' }], revision: 999 })
    lines[index] = {
      ...lines[index],
      file: `${FACT_DIR}/${BOOK_ID}.json`,
      text: forgedText,
      snapshot: fileSnapshot(factPath)
    }
    await writeFile(jsonl, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf-8')

    const adopted = await call('POST', '/api/agent/cards/adopt', { root, sessionId, id: cardId })
    assert.equal(adopted.status, 400, `绕过建卡闸的采纳必须被拒：${JSON.stringify(adopted.payload)}`)
    assert.equal(adopted.payload?.error?.code, 'INVALID_ENTRY')
    assert.match(adopted.payload?.error?.message ?? '', /载体目录/u)
    assert.equal(readFileSync(factPath, 'utf-8'), before, '故事源主档逐字节不变（采纳没写进去）')

    // 同一张卡改回正文目标后仍可正常采纳（闸不放宽，也不误伤）
    lines[index] = { ...lines[index], file: '正文/001-开局.md', text: '第一章 开局\n经采纳写入。', snapshot: fileSnapshot(join(root, '正文', '001-开局.md')) }
    await writeFile(jsonl, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf-8')
    const ok = await call('POST', '/api/agent/cards/adopt', { root, sessionId, id: cardId })
    assert.equal(ok.status, 200, JSON.stringify(ok.payload))
    assert.equal(ok.payload.ok, true)
    assert.match(readFileSync(join(root, '正文', '001-开局.md'), 'utf-8'), /经采纳写入/u)
  })
})

test('OS-211 ③ /api/agent/cards/adopt 直接指向 故事源/*.json：逐路径断言拒绝（不只看建卡阶段）', async () => {
  // 评审第三轮 ③：adopt 落盘点必须自己拒，不能靠建卡闸兜。
  // 每个目标都造一张 open 卡（改 jsonl 绕过建卡），逐个打 adopt，断言 400 + 主档不变。
  const { fileSnapshot } = await import('../src/modules/agentbar/agentStore.mjs')
  await withDaemon(async ({ base, root, call }) => {
    const session = await call('POST', '/api/agent/sessions', { root, title: 'OS-211 adopt 矩阵' })
    const sessionId = session.payload?.session?.id
    assert.ok(sessionId)

    const findJsonl = async (dir) => {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name)
        if (entry.isDirectory()) {
          const hit = await findJsonl(path)
          if (hit) return hit
        } else if (entry.name.endsWith('.jsonl')) return path
      }
      return null
    }
    const jsonl = await findJsonl(base)
    assert.ok(jsonl, '应找到会话 jsonl')
    const factPath = join(root, FACT_DIR, `${BOOK_ID}.json`)
    const factBefore = readFileSync(factPath, 'utf-8')

    const targets = [
      `${FACT_DIR}/${BOOK_ID}.json`,
      `${FACT_DIR}/${BOOK_ID}.wiki.json`,
      '世界书/人物/宋江.md',
      '.openstory/project.json'
    ]
    for (const [index, target] of targets.entries()) {
      const cardId = `c-direct-${index}`
      const lines = readFileSync(jsonl, 'utf-8').split('\n').filter(Boolean).map((line) => JSON.parse(line))
      lines.push({
        t: 'card', id: cardId, state: 'open', file: target,
        text: '{"entries":[],"revision":404}',
        chars: 30,
        snapshot: fileSnapshot(join(root, target)),
        createdAt: new Date().toISOString()
      })
      await writeFile(jsonl, `${lines.map((line) => JSON.stringify(line)).join('\n')}\n`, 'utf-8')
      const adopted = await call('POST', '/api/agent/cards/adopt', { root, sessionId, id: cardId })
      assert.equal(adopted.status, 400, `adopt(${target}) 必须 400：${JSON.stringify(adopted.payload)}`)
      assert.equal(adopted.payload?.error?.code, 'INVALID_ENTRY', `adopt(${target}) 错误码`)
    }
    assert.equal(readFileSync(factPath, 'utf-8'), factBefore, '故事源主档逐字节不变')
    assert.equal(existsSync(join(root, '世界书', '人物', '宋江.md')), false, '世界书笔记没被采纳写出')
  })
})

/* ---------- MCP 路径：同一道闸 ---------- */
function startMcp(port, env = {}) {
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'host', 'mcp.mjs')], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, ...env, OPENSTORY_PORT: String(port) }
  })
  const pending = new Map()
  let buffer = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', () => {})
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (!line) continue
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) {
        pending.get(message.id)(message)
        pending.delete(message.id)
      }
    }
  })
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = nextId += 1
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP 超时 ${method}`)) }, 20_000)
    pending.set(id, (message) => { clearTimeout(timer); resolve(message) })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
  })
  return {
    request,
    close: async () => { child.kill(); await new Promise((done) => child.once('exit', done)) }
  }
}

test('OS-211 MCP：世界书写工具经专用端点成功，章节工具写世界书/故事源被同一道闸拒', async () => {
  await withDaemon(async ({ root, daemon }) => {
    const mcp = startMcp(await Promise.resolve(daemon.port))
    try {
      const call = async (name, args) => {
        const reply = await mcp.request('tools/call', { name, arguments: args })
        assert.equal(reply.error, undefined, JSON.stringify(reply.error))
        return reply.result
      }
      // 世界书写：走 referenceNotePut（工具名不变）
      const noteWritten = JSON.parse((await call('openstory_reference_write_note', {
        root, file: '世界书/人物/吴用.md', text: '---\ntags: [人物]\n---\n\n# 吴用\n\n智多星。\n'
      })).content[0].text)
      assert.ok(noteWritten.chars > 0, JSON.stringify(noteWritten))
      assert.match(readFileSync(join(root, '世界书', '人物', '吴用.md'), 'utf-8'), /智多星/u)

      // 章节写工具（工具名不变，但目标必须落在载体目录）
      const chapterPayload = JSON.parse((await call('openstory_novel_write_chapter', {
        root, file: '正文/001-开局.md', text: '第一章 开局\n经 MCP 改过。\n'
      })).content[0].text)
      assert.ok(chapterPayload.chars > 0, JSON.stringify(chapterPayload))

      const bypass = await call('openstory_novel_write_chapter', { root, file: `${FACT_DIR}/${BOOK_ID}.json`, text: '{"entries":[]}' })
      assert.equal(bypass.isError, true, 'MCP 章节工具写故事源必须失败')
      assert.match(bypass.content[0].text, /INVALID_ENTRY/u)
      const worldbookViaChapter = await call('openstory_novel_write_chapter', { root, file: '世界书/人物/吴用.md', text: '从章节工具改世界书' })
      assert.equal(worldbookViaChapter.isError, true, 'MCP 章节工具写世界书也必须失败')
      assert.match(worldbookViaChapter.content[0].text, /INVALID_ENTRY/u)
      assert.equal(readFileSync(join(root, '世界书', '人物', '吴用.md'), 'utf-8').includes('从章节工具改世界书'), false)
    } finally {
      await mcp.close()
    }
  })
})
