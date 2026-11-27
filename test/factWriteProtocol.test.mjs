/**
 * OS-156 写协议直测（node:test，零依赖）——src/kernel/fact/factFileStore.mjs。
 *
 * 这是**全仓 fact 写入的唯一通道**（`writeFactFile`：atomic tmp＋rename、顶层 revision 自增、
 * operationId 旁路日志幂等、expectedRevision 乐观并发）。core 原件已随本单删除，此文件是
 * 写协议的行为金样（逐条对应工单 §5）：
 *   ① operationId 幂等：同 operationId 重放 → duplicate:true 且 revision／字节都不动；
 *   ② expectedRevision 冲突 → REVISION_MISMATCH（端口码，本单不改值）；
 *   ③ revision 自增：每次正常写入 +1；
 *   ④ 多条目 upsert：按 id 命中替换、没命中追加，顺序稳定；patch.entries 整份替换；
 *   ⑤ 派生档分离：patch.wiki 进兄弟 `<id>.wiki.json`，主档 entries 一字不动；
 *   ⑥ 失败路径：校验闸拦下时主档一个字节都不动。
 *
 * 所有用例都在 mkdtemp 临时库内跑，绝不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  writeFactFile,
  readFactWiki,
  createFactFileStore,
  FACT_DIR_NAME,
  OPERATIONS_LOG_NAME,
  WIKI_DERIVED_SCHEMA
} from '../src/modules/fact/fact/factFileStore.mjs'
import { stableEntryId } from '../src/modules/fact/fact/domain/stableId.js'

const BOOK_ID = 'book-os156'

function worldviewEntry(name, definition, overrides = {}) {
  return {
    schema: 'fact.data/v3',
    layer: 'worldview',
    name,
    domain: '修炼体系',
    slot: 'power_levels',
    definition,
    rank: 1,
    aliases: [],
    provenance: {
      mode: 'author',
      book: '测试之书',
      book_id: BOOK_ID,
      chapters: [1],
      scenes: [],
      extractor: 'os156-fixture',
      confidence: 0.8,
      quote_hash: 'd41d8cd98f00b204e9800998ecf8427e'
    },
    fingerprint: { vec: [0.1, 0.2], metrics: {} },
    status: 'draft',
    validity: { from: 1, to: 12 },
    id: stableEntryId({ layer: 'worldview', domain: '修炼体系', slot: 'power_levels', name }),
    ...overrides
  }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'os156-writeproto-'))
  return {
    root,
    mainPath: join(root, FACT_DIR_NAME, `${BOOK_ID}.json`),
    wikiPath: join(root, FACT_DIR_NAME, `${BOOK_ID}.wiki.json`),
    cleanup: () => rm(root, { recursive: true, force: true })
  }
}

const readJson = async (path) => JSON.parse(await readFile(path, 'utf-8'))

test('① operationId 幂等：重放回 duplicate:true，revision 不涨、主档字节不动', async () => {
  const { root, mainPath, cleanup } = await fixture()
  try {
    const entry = worldviewEntry('灵潮', '每逢甲子，天地灵气暴涨三月。')
    const first = await writeFactFile({ root, bookId: BOOK_ID, entry, operationId: 'op-1' })
    assert.equal(first.ok, true, `首写失败：${JSON.stringify(first.error ?? first)}`)
    assert.equal(first.duplicate, false)
    assert.equal(first.revision, 1, '首次写入 revision 从 0 → 1')
    assert.equal(first.file, `${FACT_DIR_NAME}/${BOOK_ID}.json`)
    const bytesAfterFirst = await readFile(mainPath)

    const replay = await writeFactFile({ root, bookId: BOOK_ID, entry, operationId: 'op-1' })
    assert.equal(replay.ok, true)
    assert.equal(replay.duplicate, true, '同 operationId 重放必须回 duplicate:true')
    assert.equal(replay.revision, 1, 'revision 不涨')
    assert.deepEqual(await readFile(mainPath), bytesAfterFirst, '重放不写盘：主档逐字节不变')
    const document = await readJson(mainPath)
    assert.deepEqual(document.entries.map((item) => item.id), [entry.id], '条目没有被重复追加')
  } finally { await cleanup() }
})

test('② expectedRevision 冲突：REVISION_MISMATCH，不覆盖不合并', async () => {
  const { root, mainPath, cleanup } = await fixture()
  try {
    const entry = worldviewEntry('灵潮', '每逢甲子，天地灵气暴涨三月。')
    const seeded = await writeFactFile({ root, bookId: BOOK_ID, entry, operationId: 'op-seed' })
    assert.equal(seeded.revision, 1)
    const bytesBefore = await readFile(mainPath)

    const stale = await writeFactFile({
      root,
      bookId: BOOK_ID,
      entry: { ...entry, definition: '这次的新解释不该落盘。' },
      operationId: 'op-stale',
      expectedRevision: 99
    })
    assert.equal(stale.ok, false)
    /* 端口码原样透传（FACT_WRITE_CODES.REVISION_MISMATCH；本单不许改码值） */
    assert.equal(stale.code, 'REVISION_MISMATCH')
    assert.equal(stale.error.code, 'REVISION_MISMATCH')
    assert.deepEqual(stale.error.details, {
      currentRevision: 1,
      expectedRevision: 99,
      file: `${FACT_DIR_NAME}/${BOOK_ID}.json`
    })
    assert.deepEqual(await readFile(mainPath), bytesBefore, '冲突时主档一个字节都不动')
    const document = await readJson(mainPath)
    assert.equal(document.revision, 1, '冲突不推进 revision')
    assert.equal(document.entries[0].definition, entry.definition, '不覆盖、不合并')

    /* 正确带上期望版本则放行 */
    const accepted = await writeFactFile({
      root,
      bookId: BOOK_ID,
      entry: { ...entry, definition: '按第 1 版写入的新解释。' },
      operationId: 'op-accepted',
      expectedRevision: 1
    })
    assert.equal(accepted.ok, true)
    assert.equal(accepted.revision, 2)
  } finally { await cleanup() }
})

test('③ revision 自增：每次正常写入 +1（1 → 2 → 3）', async () => {
  const { root, mainPath, cleanup } = await fixture()
  try {
    const entry = worldviewEntry('灵潮', '每逢甲子，天地灵气暴涨三月。')
    const revisions = []
    for (const [index, operationId] of ['op-a', 'op-b', 'op-c'].entries()) {
      const result = await writeFactFile({
        root,
        bookId: BOOK_ID,
        entry: { ...entry, definition: `第 ${index + 1} 版解释。` },
        operationId
      })
      assert.equal(result.ok, true, `${operationId} 写入失败：${JSON.stringify(result.error)}`)
      revisions.push(result.revision)
      assert.equal((await readJson(mainPath)).revision, result.revision, '磁盘 revision 与返回一致')
    }
    assert.deepEqual(revisions, [1, 2, 3])
  } finally { await cleanup() }
})

test('④ 多条目 upsert：按 id 命中替换、没命中追加，顺序稳定；patch.entries 整份替换', async () => {
  const { root, mainPath, cleanup } = await fixture()
  try {
    const first = worldviewEntry('灵潮', '灵气暴涨。')
    const second = worldviewEntry('潮汐', '潮起潮落。')
    const third = worldviewEntry('门规', '不入门规者不得入内。')
    for (const [index, entry] of [first, second, third].entries()) {
      const result = await writeFactFile({ root, bookId: BOOK_ID, entry, operationId: `op-add-${index}` })
      assert.equal(result.ok, true, JSON.stringify(result.error))
    }
    let document = await readJson(mainPath)
    assert.deepEqual(document.entries.map((item) => item.id), [first.id, second.id, third.id], '追加保持写入顺序')

    /* 命中第二条：原地替换，位置不变 */
    const replaced = await writeFactFile({
      root,
      bookId: BOOK_ID,
      entry: { ...second, definition: '潮起潮落，各有其序。' },
      operationId: 'op-replace-2'
    })
    assert.equal(replaced.ok, true, JSON.stringify(replaced.error))
    document = await readJson(mainPath)
    assert.deepEqual(document.entries.map((item) => item.id), [first.id, second.id, third.id], '替换不改变条目顺序')
    assert.equal(document.entries[1].definition, '潮起潮落，各有其序。', '命中 id 的那条被替换')

    /* patch.entries：整份替换（顺序按传入给的） */
    const replacedAll = await writeFactFile({
      root,
      bookId: BOOK_ID,
      patch: { entries: [third, first] },
      operationId: 'op-replace-all'
    })
    assert.equal(replacedAll.ok, true, JSON.stringify(replacedAll.error))
    document = await readJson(mainPath)
    assert.deepEqual(document.entries.map((item) => item.id), [third.id, first.id], 'patch.entries 整份替换、顺序即入参顺序')
  } finally { await cleanup() }
})

test('⑤ 派生档分离：写 patch.wiki 时主档 entries 一字不动、兄弟 <id>.wiki.json 更新', async () => {
  const { root, mainPath, wikiPath, cleanup } = await fixture()
  try {
    const first = worldviewEntry('灵潮', '灵气暴涨。')
    const second = worldviewEntry('潮汐', '潮起潮落。')
    await writeFactFile({ root, bookId: BOOK_ID, entry: first, operationId: 'op-seed-1' })
    const seeded = await writeFactFile({ root, bookId: BOOK_ID, entry: second, operationId: 'op-seed-2' })
    assert.equal(seeded.revision, 2)
    const entriesBefore = JSON.stringify((await readJson(mainPath)).entries)

    const wiki = { chapters: [{ no: 1, title: '开端' }], characters: [{ name: '林逸' }] }
    const written = await writeFactFile({
      root,
      bookId: BOOK_ID,
      patch: { wiki },
      operationId: 'op-wiki-1'
    })
    assert.equal(written.ok, true, JSON.stringify(written.error))
    assert.equal(written.revision, 3, '写派生也走同一写协议：主档 revision +1')

    const document = await readJson(mainPath)
    assert.equal(JSON.stringify(document.entries), entriesBefore, '主档 entries 逐字未动')
    assert.equal(Object.prototype.hasOwnProperty.call(document, 'wiki'), false, '主档永不落 wiki')

    const sibling = await readJson(wikiPath)
    // OS-211：派生基准＝本次写完后的主档 revision（旧口径用写前 baseRevision，永远落后一版，
    // 同源检查会恒报 stale）。成功写后 derivedFrom.factRevision === document.revision 必须恒成立。
    assert.deepEqual(sibling.derivedFrom, { factRevision: 3, schema: WIKI_DERIVED_SCHEMA }, 'derivedFrom 与写后主档 revision 对齐')
    assert.equal(sibling.derivedFrom.factRevision, document.revision, '派生基准 === 主档 revision（OS-211 对齐口径）')
    assert.deepEqual(sibling.chapters, wiki.chapters)
    assert.deepEqual(sibling.characters, wiki.characters)

    /* 读侧两代兼容：优先兄弟文件 */
    const read = readFactWiki({ root, id: BOOK_ID })
    assert.equal(read.source, 'sibling')
    assert.deepEqual(read.wiki, { ...wiki }, '读回的 wiki 与写入的内容一致（不含 derivedFrom）')
    assert.deepEqual(read.derivedFrom, { factRevision: 3, schema: WIKI_DERIVED_SCHEMA })

    /* store.wikiGet 走同一口径 */
    const store = createFactFileStore({ root })
    assert.deepEqual(store.wikiGet({ bookId: BOOK_ID }).wiki, wiki)
    /* 拆解目录里的 .wiki.json 不混进真源清单 */
    assert.deepEqual(store.list({}).entries.map((item) => item.id), [first.id, second.id])
  } finally { await cleanup() }
})

test('⑥ 失败路径：非法条目被校验闸拦下时主档一个字节都不动', async () => {
  const { root, mainPath, cleanup } = await fixture()
  try {
    const entry = worldviewEntry('灵潮', '灵气暴涨。')
    await writeFactFile({ root, bookId: BOOK_ID, entry, operationId: 'op-seed' })
    const bytesBefore = await readFile(mainPath)
    const namesBefore = (await readdir(join(root, FACT_DIR_NAME))).sort()

    const invalid = worldviewEntry('坏条目', '')
    delete invalid.definition
    const rejected = await writeFactFile({ root, bookId: BOOK_ID, entry: invalid, operationId: 'op-invalid' })
    assert.equal(rejected.ok, false)
    assert.equal(rejected.code, 'VALIDATION_FAILED')
    assert.equal(rejected.error.code, 'VALIDATION_FAILED')
    assert.ok(
      rejected.error.details.errors.some((error) => error.code === 'MISSING_REQUIRED' && error.field === 'definition'),
      `递上来的是信封校验错误：${JSON.stringify(rejected.error.details.errors)}`
    )
    assert.deepEqual(await readFile(mainPath), bytesBefore, '主档逐字节不变')
    assert.deepEqual((await readdir(join(root, FACT_DIR_NAME))).sort(), namesBefore, '既不落临时文件，也不追加 applied 记录')

    /* 没有 operationId 的写入同样被闸门拒（幂等键必填） */
    const noOp = await writeFactFile({ root, bookId: BOOK_ID, entry: worldviewEntry('另条', '随便。') })
    assert.equal(noOp.code, 'OPERATION_ID_REQUIRED')
    assert.deepEqual(await readFile(mainPath), bytesBefore)
  } finally { await cleanup() }
})

test('写协议辅助面：operations 旁路日志按行 append-only，不动主档', async () => {
  const { root, cleanup } = await fixture()
  try {
    const logPath = join(root, FACT_DIR_NAME, OPERATIONS_LOG_NAME)
    assert.equal(existsSync(logPath), false, '首次写入前没有旁路日志')
    const entry = worldviewEntry('灵潮', '灵气暴涨。')
    await writeFactFile({ root, bookId: BOOK_ID, entry, operationId: 'op-log-1' })
    const lines = (await readFile(logPath, 'utf-8')).trim().split('\n').map((line) => JSON.parse(line))
    assert.equal(lines.length, 1)
    assert.equal(lines[0].operationId, 'op-log-1')
    assert.equal(lines[0].outcome, 'applied')
    assert.equal(lines[0].revision, 1)
    assert.equal(lines[0].bookId, BOOK_ID)
    assert.equal(typeof lines[0].at, 'string')
    assert.ok((await stat(logPath)).isFile())
  } finally { await cleanup() }
})
