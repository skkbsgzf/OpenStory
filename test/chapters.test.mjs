/**
 * OpenStory OS-10 用例（node:test，零依赖）——章节清单/自动编号/重命名/非破坏删除。
 *
 * 跑法：
 *   node --test openstory/test/chapters.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import {
  createChapter,
  deleteChapter,
  listChapters,
  nextChapterNumber,
  parseChapterName,
  renameChapter,
  sanitizeChapterTitle
} from '../src/protocol/chapters.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os10-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '大纲'), { recursive: true })
  await writeFile(join(root, '正文', '001-雨停.md'), '雨到傍晚才停。', 'utf-8')
  await writeFile(join(root, '正文', '002-渡口.md'), '雾从水面漫上来。', 'utf-8')
  await writeFile(join(root, '正文', '第3章 归港.md'), '船靠岸时灯全亮了。', 'utf-8')
  await writeFile(join(root, '正文', '随手记.md'), '不是章节', 'utf-8')
  await writeFile(join(root, '大纲', '总大纲.md'), '三幕。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-15T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath }
}

test('解析：NNN-标题／第N章标题／中文数字；认不出不编', () => {
  assert.deepEqual(parseChapterName('001-雨停.md'), { no: 1, title: '雨停' })
  assert.deepEqual(parseChapterName('第3章 归港.md'), { no: 3, title: '归港' })
  assert.deepEqual(parseChapterName('十二-雾起.md'), { no: 12, title: '雾起' })
  assert.equal(parseChapterName('随手记.md').no, null)
  assert.equal(parseChapterName('随手记.md').title, '随手记')
  assert.equal(sanitizeChapterTitle('雨/停：第一章'), '雨_停：第一章', '全角冒号合法保留，ASCII 斜杠换下划线')
  assert.equal(sanitizeChapterTitle('  '), '')
  assert.equal(nextChapterNumber([{ no: 1 }, { no: 3 }, { no: null }]), 4)
  assert.equal(nextChapterNumber([]), 1)
})

test('清单：有号排序无号排尾、字数现算、跳过隐藏与 .history', async () => {
  const { base, root } = await makeFixture()
  try {
    const listed = await listChapters(root, '正文')
    assert.equal(listed.ok, true)
    assert.deepEqual(listed.chapters.map((chapter) => chapter.no), [1, 2, 3, null])
    assert.equal(listed.chapters[0].title, '雨停')
    assert.ok(listed.chapters[0].chars > 0)
    assert.equal(listed.chapters[3].name, '随手记.md')
    const outline = await listChapters(root, '大纲')
    assert.equal(outline.chapters.length, 1)
    const missing = await listChapters(root, '构思')
    assert.equal(missing.ok, true)
    assert.ok(missing.warnings.some((warning) => warning.code === 'DIR_MISSING'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('新建：自动下一号＋安全化；重名号顺延；非法字符处理', async () => {
  const { base, root } = await makeFixture()
  try {
    const created = await createChapter(root, '正文', '雨夜对峙')
    assert.equal(created.ok, true)
    assert.equal(created.chapter.name, '004-雨夜对峙.md', '第3章 占了 3 号，下一号是 4')
    assert.equal(await readFile(join(root, '正文', '004-雨夜对峙.md'), 'utf-8'), '')

    const created2 = await createChapter(root, '正文', '雨/夜')
    assert.equal(created2.ok, true)
    assert.equal(created2.chapter.name, '005-雨_夜.md')

    const bad = await createChapter(root, '正文', '///')
    assert.equal(bad.ok, false)
    assert.match(bad.message, /标题/)

    const created3 = await createChapter(root, '构思', '一个想法')
    assert.equal(created3.ok, true)
    assert.equal(created3.chapter.name, '001-一个想法.md', '不同目录独立编号')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('重命名：保号换标题；目标冲突拒绝；不存在 404', async () => {
  const { base, root } = await makeFixture()
  try {
    const renamed = await renameChapter(root, '正文/001-雨停.md', '雨停之后')
    assert.equal(renamed.ok, true)
    assert.equal(renamed.chapter.file, '正文/001-雨停之后.md')
    assert.equal(renamed.chapter.no, 1)
    assert.ok(existsSync(join(root, '正文', '001-雨停之后.md')))
    assert.equal(existsSync(join(root, '正文', '001-雨停.md')), false)

    // 真冲突：预置 003-撞名.md，再把「第3章 归港」（保号 3）改成同名标题 → 目标已存在
    await writeFile(join(root, '正文', '003-撞名.md'), '占位', 'utf-8')
    const conflict = await renameChapter(root, '正文/第3章 归港.md', '撞名')
    assert.equal(conflict.ok, false)
    assert.match(conflict.message, /已存在/)

    const missing = await renameChapter(root, '正文/999-无.md', 'x')
    assert.equal(missing.ok, false)
    assert.equal(missing.code, 'NOT_FOUND')

    const escape = await renameChapter(root, '../别的.md', 'x')
    assert.equal(escape.ok, false)
    assert.equal(escape.code, 'PATH_ESCAPE')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('删除：非破坏——原文件消失、.history 里有 .deleted 档；内容原样', async () => {
  const { base, root } = await makeFixture()
  try {
    const removed = await deleteChapter(root, '正文/002-渡口.md')
    assert.equal(removed.ok, true)
    assert.ok(removed.backup.includes('.history/'))
    assert.ok(removed.backup.includes('.deleted-'))
    assert.equal(existsSync(join(root, '正文', '002-渡口.md')), false)
    const history = await readdir(join(root, '正文', '.history'))
    assert.equal(history.length, 1)
    assert.equal(await readFile(join(root, '正文', '.history', history[0]), 'utf-8'), '雾从水面漫上来。')

    const again = await deleteChapter(root, '正文/002-渡口.md')
    assert.equal(again.ok, false)
    assert.equal(again.code, 'NOT_FOUND')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('契约：chapters 四端点形状', () => {
  assert.equal(validateRequest('chaptersGet', { root: 'r', dir: '正文' }).ok, true)
  assert.equal(validateRequest('chaptersGet', { root: 'r' }).ok, false)
  assert.equal(validateRequest('chaptersCreate', { root: 'r', dir: '正文', title: '雨停' }).ok, true)
  assert.equal(validateRequest('chaptersCreate', { root: 'r', dir: '正文' }).ok, true, 'title 缺省＝写作套件默认标题')
  assert.equal(validateRequest('chaptersRename', { root: 'r', file: 'f', title: 't' }).ok, true)
  assert.equal(validateRequest('chapterDelete', { root: 'r', file: 'f' }).ok, true)
  assert.equal(validateResponse('chaptersGet', { ok: true, chapters: [] }).ok, true)
  assert.equal(validateResponse('chaptersCreate', { ok: true, chapter: {} }).ok, true)
})

test('daemon 端到端：create→chapter 读回→rename→list→delete→.history；逃逸拒收', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({ port: 0, preferencesPath: fixture.preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const root = encodeURIComponent(fixture.root)
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const list = await (await fetch(`${origin}/api/chapters?root=${root}&dir=${encodeURIComponent('正文')}`)).json()
    assert.equal(list.chapters.length, 4)

    const created = await post('/api/chapters', { root: fixture.root, dir: '正文', title: '雨夜对峙' })
    assert.equal(created.status, 200)
    const chapter = (await created.json()).chapter

    const read = await (await fetch(`${origin}/api/chapter?root=${root}&file=${encodeURIComponent(chapter.file)}`)).json()
    assert.equal(read.ok, true)
    assert.equal(read.chars, 0)

    await fetch(`${origin}/api/chapter`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root: fixture.root, file: chapter.file, text: '雨夜，船没开。' }) })
    const renamed = await post('/api/chapters/rename', { root: fixture.root, file: chapter.file, title: '雨夜摊牌' })
    assert.equal(renamed.status, 200)
    const renamedFile = (await renamed.json()).chapter.file
    const reread = await (await fetch(`${origin}/api/chapter?root=${root}&file=${encodeURIComponent(renamedFile)}`)).json()
    assert.equal(reread.text, '雨夜，船没开。', '重命名不丢内容')

    const removed = await fetch(`${origin}/api/chapter?root=${root}&file=${encodeURIComponent(renamedFile)}`, { method: 'DELETE' })
    assert.equal(removed.status, 200)
    assert.ok((await removed.json()).backup.includes('.history/'))

    const escape = await fetch(`${origin}/api/chapter?root=${root}&file=${encodeURIComponent('../秘密.md')}`, { method: 'DELETE' })
    assert.equal(escape.status, 403)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
