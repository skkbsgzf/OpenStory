/**
 * OS-61 推演会话存储层用例（node:test）：拍节点／章缓存区／归档／分支切换。
 *   node --test test/deduceSession.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendNode,
  archiveChapter,
  clearChapterBuffer,
  DEDUCE_SESSION_SCHEMA,
  deduceSessionPath,
  loadDeduceSession,
  normalizeDeduceSession,
  saveDeduceSession,
  startChapterBuffer,
  switchBranch
} from '../deduceSession.mjs'
import { validateRequest, validateResponse } from '../contracts.mjs'

async function makeRoot() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os61-'))
  const root = join(base, '夹具库')
  await mkdir(root, { recursive: true })
  return { base, root }
}

function newSession(bookId = 'book-1') {
  return {
    schema: DEDUCE_SESSION_SCHEMA,
    bookId,
    branchId: 'main',
    cursor: 0,
    nodes: [],
    buffer: { chapterNo: 1, nodes: [], words: 0 },
    archived: []
  }
}

test('会话：空库读会话 → null', async () => {
  const { base, root } = await makeRoot()
  try {
    assert.equal(loadDeduceSession(root, 'book-1'), null)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：存→读往返一致；二次保存留 .history 备份', async () => {
  const { base, root } = await makeRoot()
  try {
    const session = newSession()
    appendNode(session, { scene: { who: '林砚', where: '青浦渡口' }, prose: '雾起了。' })
    const first = await saveDeduceSession(root, 'book-1', session)
    assert.equal(first.ok, true)
    assert.equal(first.backup, null, '首次保存没有旧稿可备')
    const loaded = loadDeduceSession(root, 'book-1')
    assert.deepEqual(loaded, session)
    // 二次保存：旧稿进 推演/<bookId>/.history/
    session.cursor = 99
    const second = await saveDeduceSession(root, 'book-1', session)
    assert.equal(second.ok, true)
    assert.ok(second.backup, '二次保存应回报备份路径')
    assert.ok(second.backup.replaceAll('\\', '/').startsWith('推演/book-1/.history/'))
    const backups = await readdir(join(root, '推演', 'book-1', '.history'))
    assert.equal(backups.length, 1)
    assert.equal(loadDeduceSession(root, 'book-1').cursor, 99)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：appendNode 推节点＋cursor/buffer 累加正确', async () => {
  const { base, root } = await makeRoot()
  try {
    const session = newSession()
    const first = appendNode(session, { prose: '他推开门。', candidates: [{ id: 'c1', source: '命运', text: '不该进字数' }] })
    assert.equal(session.cursor, 1)
    assert.equal(first.round, 1)
    assert.equal(first.branchId, 'main')
    assert.equal(session.nodes.length, 1)
    assert.equal(session.buffer.nodes.length, 1)
    assert.equal(session.buffer.words, '他推开门。'.length, '有正文只算正文字数')
    // 没正文的拍：字数按候选摘要累加
    appendNode(session, { candidates: [{ source: '命运', text: '候选甲' }, { source: '戏剧', text: '候选乙' }] })
    assert.equal(session.cursor, 2)
    assert.equal(session.buffer.nodes.length, 2)
    assert.equal(session.buffer.words, '他推开门。'.length + '候选甲'.length + '候选乙'.length)
    assert.ok(session.nodes[1].id, '缺 id 自动补')
    assert.ok(session.nodes[1].createdAt, '缺时间自动补')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：开章缓存区与清缓存区', async () => {
  const { base, root } = await makeRoot()
  try {
    const session = newSession()
    appendNode(session, { prose: '第一拍。' })
    startChapterBuffer(session, 3)
    assert.deepEqual(session.buffer, { chapterNo: 3, nodes: [], words: 0 })
    appendNode(session, { prose: '第二拍。' })
    assert.equal(session.buffer.words, '第二拍。'.length)
    clearChapterBuffer(session)
    assert.equal(session.buffer.chapterNo, 3, '清缓存区保留章号')
    assert.deepEqual(session.buffer.nodes, [])
    assert.equal(session.buffer.words, 0)
    assert.equal(session.nodes.length, 2, '清缓存区不动 nodes')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：archiveChapter 写出归档 md＋buffer 清零＋archived 记录', async () => {
  const { base, root } = await makeRoot()
  try {
    const session = newSession()
    startChapterBuffer(session, 2)
    appendNode(session, { prose: '他推开门，雾涌了进来。' })
    appendNode(session, { candidates: [{ source: '命运', text: '渡口的钟响了' }] })
    const expectedWords = '他推开门，雾涌了进来。'.length + '渡口的钟响了'.length
    const result = await archiveChapter(root, session, { title: '雾起' })
    assert.equal(result.ok, true, result.message)
    assert.equal(result.path, '推演/book-1/归档/第2章.md')
    assert.equal(result.words, expectedWords)
    const abs = join(root, '推演', 'book-1', '归档', '第2章.md')
    assert.ok(existsSync(abs), '归档文件应存在')
    const md = await readFile(abs, 'utf-8')
    assert.ok(md.includes('# 第2章 雾起'), '含章标题')
    assert.ok(md.includes('## 第1拍'), '每拍一节')
    assert.ok(md.includes('## 第2拍'))
    assert.ok(md.includes('他推开门，雾涌了进来。'), '含正文拍内容')
    assert.ok(md.includes('渡口的钟响了'), '无正文拍落候选摘要')
    // buffer 清零、archived 记录、会话落盘
    assert.deepEqual(session.buffer.nodes, [])
    assert.equal(session.buffer.words, 0)
    assert.equal(session.archived.length, 1)
    assert.equal(session.archived[0].chapterNo, 2)
    assert.equal(session.archived[0].path, result.path)
    assert.equal(session.archived[0].words, expectedWords)
    assert.ok(session.archived[0].at)
    const onDisk = loadDeduceSession(root, 'book-1')
    assert.deepEqual(onDisk.buffer.nodes, [])
    assert.equal(onDisk.archived.length, 1)
    // 空缓存区再归档＝拒绝，不抛
    const empty = await archiveChapter(root, session, { title: '再来' })
    assert.equal(empty.ok, false)
    assert.equal(empty.code, 'INVALID_ENTRY')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：分支切换——两条分支的拍互不干扰', async () => {
  const { base, root } = await makeRoot()
  try {
    const session = newSession()
    const nodeA = appendNode(session, { prose: '主线第一拍。' })
    assert.equal(nodeA.branchId, 'main')
    switchBranch(session, 'if线')
    assert.equal(session.branchId, 'if线')
    assert.equal(session.cursor, 0, '新分支没有拍，cursor 归零')
    const nodeB = appendNode(session, { prose: '支线第一拍。' })
    assert.equal(nodeB.branchId, 'if线')
    assert.equal(nodeB.round, 1)
    // 显式带别的 branchId 的拍：只进 nodes，不进当前缓存区
    const before = session.buffer.words
    appendNode(session, { branchId:'旁支', prose: '旁支拍。' })
    assert.equal(session.buffer.words, before, '非当前分支的拍不进缓存区')
    // 切回主线：cursor 落到主线最后一拍，两条分支的节点都还在、各自字段不变
    switchBranch(session, 'main')
    assert.equal(session.cursor, 1)
    assert.equal(session.nodes.length, 3)
    assert.equal(session.nodes[0].branchId, 'main')
    assert.equal(session.nodes[0].prose, '主线第一拍。')
    assert.equal(session.nodes[1].branchId, 'if线')
    assert.equal(session.nodes[1].prose, '支线第一拍。')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：写入失败路径——ok:false 而非抛', async () => {
  const { base, root } = await makeRoot()
  try {
    // 「推演」占成文件：mkdir 必失败 → save 返回 ok:false
    await writeFile(join(root, '推演'), '我不是目录', 'utf-8')
    const saved = await saveDeduceSession(root, 'book-1', newSession())
    assert.equal(saved.ok, false)
    assert.equal(saved.code, 'WRITE_PROTOCOL_IO_FAILED')
    assert.ok(saved.message)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：归档写盘失败——ok:false 而非抛', async () => {
  const { base, root } = await makeRoot()
  try {
    await mkdir(join(root, '推演', 'book-1'), { recursive: true })
    // 「归档」占成文件：归档 md 写不进去
    await writeFile(join(root, '推演', 'book-1', '归档'), '我不是目录', 'utf-8')
    const session = newSession()
    appendNode(session, { prose: '一拍。' })
    const result = await archiveChapter(root, session, { title: '雾起' })
    assert.equal(result.ok, false)
    assert.equal(result.code, 'WRITE_PROTOCOL_IO_FAILED')
    assert.equal(session.buffer.nodes.length, 1, '写失败不清缓存区')
    assert.equal(session.archived.length, 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('会话：归一校验与三端点契约形状', async () => {
  const { base, root } = await makeRoot()
  try {
    // schema 不对 / nodes 不是数组 → null
    assert.equal(normalizeDeduceSession({ schema: '别的/v1', nodes: [] }, 'book-1'), null)
    assert.equal(normalizeDeduceSession({ schema: DEDUCE_SESSION_SCHEMA, nodes: '不是数组' }, 'book-1'), null)
    assert.equal(normalizeDeduceSession(null, 'book-1'), null)
    const normalized = normalizeDeduceSession({ schema: DEDUCE_SESSION_SCHEMA, nodes: [] }, 'book-1')
    assert.equal(normalized.bookId, 'book-1')
    assert.equal(normalized.branchId, 'main')
    assert.deepEqual(normalized.buffer, { chapterNo: 1, nodes: [], words: 0 })
    // 坏档读回 null（不抛）
    await mkdir(join(root, '推演', 'book-1'), { recursive: true })
    await writeFile(deduceSessionPath(root, 'book-1'), '{ 坏 json', 'utf-8')
    assert.equal(loadDeduceSession(root, 'book-1'), null)
    // 契约：请求/响应形状
    assert.equal(validateRequest('deduceSessionGet', { root: root, bookId: 'book-1' }).ok, true)
    assert.equal(validateRequest('deduceSessionPut', { root: root, session: normalized }).ok, true)
    assert.equal(validateRequest('deduceSessionPut', { root: root }).ok, false, 'session 必填')
    assert.equal(validateRequest('deduceArchive', { root: root, title: '雾起' }).ok, true)
    assert.equal(validateResponse('deduceSessionGet', { ok: true, session: null }).ok, true)
    assert.equal(validateResponse('deduceSessionGet', { ok: true, session: normalized }).ok, true)
    assert.equal(validateResponse('deduceSessionPut', { ok: true, session: normalized, backup: '推演/book-1/.history/x.json' }).ok, true)
    assert.equal(validateResponse('deduceArchive', { ok: true, path: '推演/book-1/归档/第1章.md', words: 12 }).ok, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
test('桥接：旧引擎状态 → 新会话层首节点（OS-62）', async () => {
  const { importLegacyDeduce } = await import('../deduceSession.mjs')
  const legacy = {
    round: 5,
    lastTurn: {
      sceneCard: { who: ['洪信', '范仲淹'], where: '龙虎山', tension: '命运骰 8（顺遂）', hook: '……' },
      candidates: [{ id: 'fate-5-0', source: '命运', text: '剧情检定 6+2=8' }],
      tension: { level: 'low' }
    }
  }
  const result = importLegacyDeduce({ legacyState: legacy, session: null, bookId: 'b1' })
  assert.equal(result.ok, true)
  assert.equal(result.imported, true)
  const session = result.session
  assert.equal(session.nodes.length, 1)
  const node = session.nodes[0]
  assert.equal(node.round, 5)
  assert.equal(node.importedFrom, 'legacy-deduce-state')
  assert.deepEqual(node.scene.who, ['洪信', '范仲淹'])
  assert.equal(node.scene.where, '龙虎山')
  assert.equal(node.candidates.length, 1)
  assert.equal(node.prose, '')
})

test('桥接幂等：同一 round 不重复导入', async () => {
  const { importLegacyDeduce } = await import('../deduceSession.mjs')
  const legacy = { round: 5, lastTurn: { sceneCard: {}, candidates: [] } }
  const first = importLegacyDeduce({ legacyState: legacy, session: null, bookId: 'b1' })
  const second = importLegacyDeduce({ legacyState: legacy, session: first.session, bookId: 'b1' })
  assert.equal(second.imported, false)
  assert.equal(second.added, 0)
  assert.equal(second.reason, 'already-imported')
  assert.equal(second.session.nodes.length, 1)
})

test('桥接：无旧状态/无 round 明确报错不抛', async () => {
  const { importLegacyDeduce } = await import('../deduceSession.mjs')
  assert.equal(importLegacyDeduce({ legacyState: null }).code, 'NO_LEGACY_STATE')
  assert.equal(importLegacyDeduce({ legacyState: { round: 0 } }).code, 'NO_LEGACY_ROUND')
})
