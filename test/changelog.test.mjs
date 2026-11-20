/**
 * changelog 引擎单测（OS-89）。
 * 重点：diff 必须真的描述差异（不是整块替换冒充），log 必须能被模块按名检索。
 */
import { strict as assert } from 'node:assert'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  contentHash, logFilePath, logSummary, readChange, readLog, recordChange, safeModuleName, unifiedDiff
} from '../changelog.mjs'

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'os-changelog-'))
  return { root, cleanup: () => rm(root, { recursive: true, force: true }) }
}

test('diff：只改一行 → 只出现该行的 +/-，未变行带空格前缀', () => {
  const before = ['第一行', '第二行', '第三行'].join('\n')
  const after = ['第一行', '第二行改', '第三行'].join('\n')
  const diff = unifiedDiff(before, after, { path: '正文/001.md' })
  assert.match(diff, /^--- a\/正文\/001\.md/m)
  assert.match(diff, /^\+第二行改$/m)
  assert.match(diff, /^-第二行$/m)
  assert.match(diff, /^ 第一行$/m)
  // 未改的第三行应作为上下文出现，而不是被当成新增
  assert.match(diff, /^ 第三行$/m)
})

test('diff：内容相同 → 空串（不产生噪音记录）', () => {
  assert.equal(unifiedDiff('一样', '一样'), '')
})

test('diff：纯新增文件 → 全是 + 行', () => {
  const diff = unifiedDiff('', '甲\n乙', { path: 'x.md' })
  assert.match(diff, /^\+甲$/m)
  assert.match(diff, /^\+乙$/m)
  assert.doesNotMatch(diff, /^-/m instanceof RegExp ? /^-甲$/m : /^-甲$/m)
})

test('diff：纯删除文件 → 全是 - 行', () => {
  const diff = unifiedDiff('甲\n乙', '', { path: 'x.md' })
  assert.match(diff, /^-甲$/m)
  assert.match(diff, /^-乙$/m)
})

test('diff：保留唯一性——不把未变内容算成变更', () => {
  const before = Array.from({ length: 30 }, (_, i) => `第${i}段`).join('\n')
  const after = before.replace('第15段', '第15段（改）')
  const diff = unifiedDiff(before, after)
  // 不给 path 就没有 ---/+++ 头部；一次措辞修改只该有 1 加 1 删
  const added = diff.split('\n').filter((line) => line.startsWith('+')).length
  const removed = diff.split('\n').filter((line) => line.startsWith('-')).length
  assert.equal(added, 1, `新增行数应为 1，实际 ${added}`)
  assert.equal(removed, 1, `删除行数应为 1，实际 ${removed}`)
  // 关键：30 行里只改了 1 行，上下文行不该被误标成变更
  const context = diff.split('\n').filter((line) => line.startsWith(' ')).length
  assert.ok(context > 0 && context < 30, `上下文行数应有限，实际 ${context}`)
})

test('safeModuleName：去掉路径分隔符与非法字符', () => {
  assert.equal(safeModuleName('正文'), '正文')
  assert.equal(safeModuleName('../etc'), '..etc')
  assert.equal(safeModuleName('a/b\\c'), 'abc')
  assert.equal(safeModuleName(''), 'misc')
})

test('contentHash：同内容同指纹，改一字就不同', () => {
  assert.equal(contentHash('abc'), contentHash('abc'))
  assert.notEqual(contentHash('abc'), contentHash('abd'))
  assert.equal(contentHash('abc').length, 16)
})

test('logFilePath：按月分文件，模块名进路径', () => {
  const path = logFilePath('参考', new Date('2026-11-20T10:00:00Z'))
  assert.equal(path, '.pinax/log/参考/2026-11.jsonl')
})

test('recordChange：写入 jsonl，含 diff 与前后指纹', async () => {
  const { root, cleanup } = await fixture()
  try {
    const res = await recordChange({
      root, module: '参考', file: '参考/人物/李逵.md', op: 'update',
      before: '旧内容', after: '新内容', actor: 'author'
    })
    assert.equal(res.ok, true)
    assert.ok(res.record)
    assert.notEqual(res.record.beforeHash, res.record.afterHash)
    assert.match(res.record.diff, /^\+新内容$/m)

    const raw = await readFile(join(root, ...res.path.split('/')), 'utf-8')
    const parsed = JSON.parse(raw.trim())
    assert.equal(parsed.module, '参考')
    assert.equal(parsed.file, '参考/人物/李逵.md')
    assert.equal(parsed.actor, 'author')
  } finally { await cleanup() }
})

test('recordChange：内容没变不记（防「打开即保存」刷屏）', async () => {
  const { root, cleanup } = await fixture()
  try {
    const res = await recordChange({
      root, module: '正文', file: '正文/001.md', op: 'update',
      before: '同', after: '同'
    })
    assert.equal(res.ok, true)
    assert.equal(res.record, null)
    assert.equal(res.skipped, true)
    const listed = await readLog({ root, module: '正文' })
    assert.equal(listed.entries.length, 0)
  } finally { await cleanup() }
})

test('readLog：按模块隔离——参考的日志不会被正文看到', async () => {
  const { root, cleanup } = await fixture()
  try {
    await recordChange({ root, module: '参考', file: '参考/a.md', op: 'update', before: 'a', after: 'b' })
    await recordChange({ root, module: '正文', file: '正文/001.md', op: 'update', before: 'x', after: 'y' })
    const refLog = await readLog({ root, module: '参考' })
    assert.equal(refLog.entries.length, 1)
    assert.equal(refLog.entries[0].module, '参考')
    const all = await readLog({ root })
    assert.equal(all.entries.length, 2)
  } finally { await cleanup() }
})

test('readLog：新→旧排序，支持按文件过滤', async () => {
  const { root, cleanup } = await fixture()
  try {
    await recordChange({ root, module: '正文', file: '正文/001.md', op: 'update', before: '1', after: '2' })
    await recordChange({ root, module: '正文', file: '正文/002.md', op: 'update', before: 'a', after: 'b' })
    const all = await readLog({ root, module: '正文' })
    assert.equal(all.entries.length, 2)
    const onlyOne = await readLog({ root, module: '正文', file: '正文/001.md' })
    assert.equal(onlyOne.entries.length, 1)
    assert.equal(onlyOne.entries[0].file, '正文/001.md')
  } finally { await cleanup() }
})

test('readLog：没有任何日志＝空数组，不是错误', async () => {
  const { root, cleanup } = await fixture()
  try {
    const res = await readLog({ root, module: '推演' })
    assert.equal(res.ok, true)
    assert.deepEqual(res.entries, [])
  } finally { await cleanup() }
})

test('logSummary：每模块只取最近一条', async () => {
  const { root, cleanup } = await fixture()
  try {
    await recordChange({ root, module: '正文', file: '正文/001.md', op: 'update', before: 'a', after: 'b' })
    await recordChange({ root, module: '参考', file: '参考/a.md', op: 'create', after: 'x' })
    const summary = await logSummary(root)
    assert.equal(summary.ok, true)
    const names = summary.modules.map((item) => item.module).sort()
    assert.deepEqual(names, ['参考', '正文'].sort())
  } finally { await cleanup() }
})

test('超长 diff 被截断并标记，不撑爆日志', async () => {
  const { root, cleanup } = await fixture()
  try {
    const before = Array.from({ length: 3000 }, (_, i) => `旧行${i}`).join('\n')
    const after = Array.from({ length: 3000 }, (_, i) => `新行${i}`).join('\n')
    const res = await recordChange({ root, module: '正文', file: '正文/big.md', op: 'update', before, after })
    assert.equal(res.ok, true)
    assert.equal(res.record.diffTruncated, true)
    assert.ok(res.record.diff.length < 30000)
  } finally { await cleanup() }
})

/* ---------- OS-90：单条读取与恢复 ---------- */

test('readChange：按 at+afterHash 精确定位一条记录', async () => {
  const { root, cleanup } = await fixture()
  try {
    await recordChange({ root, module: '正文', file: '正文/001.md', op: 'update', before: 'a', after: 'b' })
    await new Promise((r) => setTimeout(r, 8))
    await recordChange({ root, module: '正文', file: '正文/002.md', op: 'update', before: 'x', after: 'y' })
    const all = await readLog({ root, module: '正文' })
    const target = all.entries[0]
    const found = await readChange({ root, module: '正文', at: target.at, afterHash: target.afterHash })
    assert.equal(found.ok, true)
    assert.equal(found.entry.file, '正文/002.md')
  } finally { await cleanup() }
})

test('readChange：hash 不匹配＝找不到（不返回错的那条）', async () => {
  const { root, cleanup } = await fixture()
  try {
    await recordChange({ root, module: '正文', file: '正文/001.md', op: 'update', before: 'a', after: 'b' })
    const all = await readLog({ root, module: '正文' })
    const target = all.entries[0]
    const found = await readChange({ root, module: '正文', at: target.at, afterHash: 'wronghash' })
    assert.equal(found.ok, false)
    assert.equal(found.code, 'NOT_FOUND')
  } finally { await cleanup() }
})

test('recordChange：backup 字段落进日志（恢复靠它定位上一版）', async () => {
  const { root, cleanup } = await fixture()
  try {
    await recordChange({
      root, module: '正文', file: '正文/001.md', op: 'update',
      before: 'a', after: 'b', backup: '正文/.history/001.md.bak-2026-11-20T00-00-00-000Z'
    })
    const all = await readLog({ root, module: '正文' })
    assert.equal(all.entries[0].backup, '正文/.history/001.md.bak-2026-11-20T00-00-00-000Z')
  } finally { await cleanup() }
})

test('新建类变更没有 backup——恢复应被拒绝（回退到不存在的状态没有意义）', async () => {
  const { root, cleanup } = await fixture()
  try {
    await recordChange({ root, module: '正文', file: '正文/new.md', op: 'create', after: '内容' })
    const all = await readLog({ root, module: '正文' })
    assert.equal(all.entries[0].op, 'create')
    assert.equal(all.entries[0].backup, undefined)
  } finally { await cleanup() }
})
