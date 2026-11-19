/**
 * 库内状态存储单测（OS-89）。
 * 覆盖 AGENTS.md 第 8/9/11 条：界面状态与草稿必须落库内、可复原、可留痕。
 */
import { strict as assert } from 'node:assert'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { readLog } from '../changelog.mjs'
import {
  DRAFT_DIR, dropDraft, listDrafts, loadDraft, readUiState, safeId, safeModule, saveDraft, writeUiState
} from '../libState.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'os-libstate-'))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('ui-state：首次读取＝空对象，不是错误', async () => {
  const { root, cleanup } = await fixture()
  try {
    const res = await readUiState(root)
    assert.equal(res.ok, true)
    assert.deepEqual(res.state, {})
  } finally { await cleanup() }
})

test('ui-state：写入后落 .pinax/ui-state.json，重新打开能复原（第 8 条）', async () => {
  const { root, cleanup } = await fixture()
  try {
    await writeUiState(root, { tabHidden: ['dir:剧本'], skin: 'dark' })
    const abs = join(root, '.pinax', 'ui-state.json')
    assert.equal(existsSync(abs), true, '桌面文件必须真实存在')
    const onDisk = JSON.parse(await readFile(abs, 'utf-8'))
    assert.deepEqual(onDisk.tabHidden, ['dir:剧本'])

    const reread = await readUiState(root)
    assert.deepEqual(reread.state.tabHidden, ['dir:剧本'])
    assert.equal(reread.state.skin, 'dark')
  } finally { await cleanup() }
})

test('ui-state：浅合并——只改一个键不动其它键', async () => {
  const { root, cleanup } = await fixture()
  try {
    await writeUiState(root, { a: 1, b: 2 })
    await writeUiState(root, { b: 9 })
    const { state } = await readUiState(root)
    assert.equal(state.a, 1)
    assert.equal(state.b, 9)
  } finally { await cleanup() }
})

test('ui-state：null 值＝删除该键', async () => {
  const { root, cleanup } = await fixture()
  try {
    await writeUiState(root, { keep: 'x', drop: 'y' })
    await writeUiState(root, { drop: null })
    const { state } = await readUiState(root)
    assert.equal(state.keep, 'x')
    assert.equal('drop' in state, false)
  } finally { await cleanup() }
})

test('ui-state：写前备份到 .history', async () => {
  const { root, cleanup } = await fixture()
  try {
    await writeUiState(root, { v: 1 })
    const res = await writeUiState(root, { v: 2 })
    assert.ok(res.backup, '应返回备份路径')
    assert.equal(existsSync(join(root, '.pinax', '.history')), true)
  } finally { await cleanup() }
})

test('ui-state：坏档不阻断界面（回空状态，原文件保留）', async () => {
  const { root, cleanup } = await fixture()
  try {
    await writeUiState(root, { v: 1 })
    const abs = join(root, '.pinax', 'ui-state.json')
    const { writeFile } = await import('node:fs/promises')
    await writeFile(abs, '{ 这不是 json', 'utf-8')
    const res = await readUiState(root)
    assert.equal(res.ok, true)
    assert.deepEqual(res.state, {})
    assert.equal(res.corrupted, true)
  } finally { await cleanup() }
})

test('draft：存草稿落 .pinax/drafts/<module>/<id>.json（第 11 条）', async () => {
  const { root, cleanup } = await fixture()
  try {
    const res = await saveDraft(root, { module: '正文', id: '001', text: '还没保存的段落' })
    assert.equal(res.ok, true)
    const abs = join(root, DRAFT_DIR, '正文', '001.json')
    assert.equal(existsSync(abs), true)
    const onDisk = JSON.parse(await readFile(abs, 'utf-8'))
    assert.equal(onDisk.text, '还没保存的段落')
    assert.equal(onDisk.chars, '还没保存的段落'.length)
  } finally { await cleanup() }
})

test('draft：读回单份草稿', async () => {
  const { root, cleanup } = await fixture()
  try {
    await saveDraft(root, { module: '推演', id: 'r14', text: '第十四拍的正文', meta: { round: 14 } })
    const res = await loadDraft(root, '推演', 'r14')
    assert.equal(res.draft.text, '第十四拍的正文')
    assert.equal(res.draft.meta.round, 14)
  } finally { await cleanup() }
})

test('draft：不存在的草稿＝null，不是错误', async () => {
  const { root, cleanup } = await fixture()
  try {
    const res = await loadDraft(root, '正文', 'nope')
    assert.equal(res.ok, true)
    assert.equal(res.draft, null)
  } finally { await cleanup() }
})

test('draft：列某模块全部草稿（新→旧）', async () => {
  const { root, cleanup } = await fixture()
  try {
    await saveDraft(root, { module: '正文', id: 'a', text: 'A' })
    await new Promise((resolve) => setTimeout(resolve, 5))
    await saveDraft(root, { module: '正文', id: 'b', text: 'B' })
    const res = await listDrafts(root, '正文')
    assert.equal(res.drafts.length, 2)
    assert.equal(res.drafts[0].id, 'b', '最新的在前')
  } finally { await cleanup() }
})

test('draft：模块隔离——正文的草稿不会出现在推演', async () => {
  const { root, cleanup } = await fixture()
  try {
    await saveDraft(root, { module: '正文', id: 'a', text: 'A' })
    await saveDraft(root, { module: '推演', id: 'b', text: 'B' })
    const body = await listDrafts(root, '正文')
    const deduce = await listDrafts(root, '推演')
    assert.equal(body.drafts.length, 1)
    assert.equal(deduce.drafts.length, 1)
    assert.equal(body.drafts[0].id, 'a')
  } finally { await cleanup() }
})

test('draft：删除草稿', async () => {
  const { root, cleanup } = await fixture()
  try {
    await saveDraft(root, { module: '正文', id: 'x', text: 'X' })
    const dropped = await dropDraft(root, '正文', 'x')
    assert.equal(dropped.removed, true)
    const res = await loadDraft(root, '正文', 'x')
    assert.equal(res.draft, null)
  } finally { await cleanup() }
})

test('落盘即留痕：存草稿会写进该模块的 changelog（第 10 条）', async () => {
  const { root, cleanup } = await fixture()
  try {
    await saveDraft(root, { module: '正文', id: 'a', text: '第一版' })
    await saveDraft(root, { module: '正文', id: 'a', text: '第二版' })
    const log = await readLog({ root, module: '正文' })
    assert.equal(log.entries.length, 2)
    assert.equal(log.entries[0].op, 'update')
    assert.equal(log.entries[1].op, 'create')
    // diff 必须描述真实差异
    assert.match(log.entries[0].diff, /\+第二版/m)
    assert.match(log.entries[0].diff, /-第一版/m)
  } finally { await cleanup() }
})

test('safeModule / safeId：防路径穿越', () => {
  assert.equal(safeModule('正文'), '正文')
  assert.equal(safeModule('../etc'), '..etc')
  assert.equal(safeModule('a/b'), 'ab')
  assert.equal(safeId('../../evil'), '.._.._evil')
  assert.equal(safeId(''), 'default')
})
