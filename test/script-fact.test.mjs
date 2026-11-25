/**
 * 剧本 ↔ fact 互转用例（OS-78）
 * 跑法：node --test test/script-fact.test.mjs
 *
 * 作者口径「这个不能出岔子」——所以这里验的是**往返不丢信息**：
 *   剧本 → fact → 剧本，幕数/台词数/角色数必须一致（允许格式规范化）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { scriptToFact, factToScript } from '../public/scriptFact.mjs'
import { parseScript } from '../public/script.mjs'
import { validateFactEntry } from '../src/modules/fact/fact/domain/index.mjs'

const SAMPLE = join(process.cwd(), 'test', 'fixtures', 'screenplay-sample.md')

const SIMPLE = `# 第一幕：雨前

*〔场景：旧戏院后门〕*

**陈守一**（管事）：这一场再没人来，明天就散了。

**沈小楼**：散就散。

*〔远处一声闷雷〕*

# 第二幕：雨落

**沈小楼**（念白）：我这一生，唱的都是别人的故事。

**陆书白**：我写了三幕。
`

test('剧本→fact：幕/角色/场景三类条目都抽出来', async () => {
  const { entries, stats } = await scriptToFact(SIMPLE)
  assert.equal(stats.acts, 2, '两幕')
  assert.equal(stats.cast, 3, '三个角色（陈守一/沈小楼/陆书白）')
  assert.ok(stats.scenes >= 1, '至少一个场景')
  assert.equal(entries.filter((e) => e.layer === 'plot').length, 2, '每幕一条 plot')
  assert.equal(entries.filter((e) => e.layer === 'character').length, 3, '每角色一条')
  assert.ok(entries.some((e) => e.layer === 'worldview'), '有世界观/场景条目')
})

test('剧本→fact：所有条目通过内核 schema 校验', async () => {
  const { entries } = await scriptToFact(SIMPLE)
  for (const entry of entries) {
    const result = validateFactEntry(entry, { mode: 'author' })
    assert.equal(result.ok, true, `${entry.layer}/${entry.name} 校验失败：${JSON.stringify(result.errors).slice(0, 200)}`)
  }
})

test('剧本→fact：角色台词锚点按角色聚合', async () => {
  const { entries } = await scriptToFact(SIMPLE)
  const shen = entries.find((e) => e.layer === 'character' && e.name === '沈小楼')
  assert.ok(shen, '沈小楼条目存在')
  assert.equal(shen.anchors.speech.length, 2, '沈小楼两句台词都进锚点')
  assert.ok(shen.anchors.speech.some((s) => s.includes('别人的故事')))
})

test('剧本→fact：plot 事件带 who/channel/content', async () => {
  const { entries } = await scriptToFact(SIMPLE)
  const act1 = entries.find((e) => e.layer === 'plot' && e.name.includes('雨前'))
  assert.ok(act1, '第一幕 plot 存在')
  assert.ok(act1.events.length >= 2, '第一幕至少两个事件')
  const say = act1.events.filter((e) => e.channel === 'say')
  assert.ok(say.length >= 2, '有台词事件')
  assert.ok(say.every((e) => e.who && e.content), '台词事件带 who 和 content')
})

test('fact→剧本：能还原出幕标题与台词', async () => {
  const { entries } = await scriptToFact(SIMPLE)
  const back = factToScript(entries)
  assert.ok(back.text.includes('# 第一幕'), '幕标题还原')
  assert.ok(back.text.includes('**沈小楼**'), '角色标记还原')
  assert.ok(back.text.includes('别人的故事'), '台词内容还原')
})

test('往返一致：幕数与台词数不丢', async () => {
  const before = parseScript(SIMPLE)
  const beforeActs = before.filter((b) => b.kind === 'act').length
  const beforeLines = before.filter((b) => b.kind === 'line').length
  const beforeCast = new Set(before.filter((b) => b.kind === 'line').map((b) => b.who)).size

  const { entries } = await scriptToFact(SIMPLE)
  const back = factToScript(entries)
  const after = parseScript(back.text)
  const afterActs = after.filter((b) => b.kind === 'act').length
  const afterLines = after.filter((b) => b.kind === 'line').length
  const afterCast = new Set(after.filter((b) => b.kind === 'line').map((b) => b.who)).size

  assert.equal(afterActs, beforeActs, `幕数往返一致（${beforeActs}→${afterActs}）`)
  assert.equal(afterCast, beforeCast, `角色数往返一致（${beforeCast}→${afterCast}）`)
  assert.ok(afterLines >= beforeLines, `台词数不丢（${beforeLines}→${afterLines}）`)
})

test('往返：真实三幕剧本（戏院三部曲）也不丢结构', { skip: !existsSafe(SAMPLE) }, async () => {
  const source = readFileSync(SAMPLE, 'utf-8')
  const before = parseScript(source)
  const beforeActs = before.filter((b) => b.kind === 'act').length
  const beforeLines = before.filter((b) => b.kind === 'line').length
  const beforeCast = new Set(before.filter((b) => b.kind === 'line').map((b) => b.who)).size

  const { entries, stats } = await scriptToFact(source)
  assert.equal(stats.acts, beforeActs, '抽取的幕数＝原文幕数')
  assert.equal(stats.lines, beforeLines, '抽取的台词数＝原文台词数')
  assert.equal(stats.cast, beforeCast, '抽取的角色数＝原文角色数')

  const back = factToScript(entries)
  const after = parseScript(back.text)
  assert.equal(after.filter((b) => b.kind === 'act').length, beforeActs, '往返幕数一致')
  assert.ok(after.filter((b) => b.kind === 'line').length >= beforeLines, '往返台词不丢')
})

test('空剧本：两个方向都不抛，返回空', async () => {
  const a = await scriptToFact('')
  assert.equal(a.entries.length, 0)
  const b = factToScript([])
  assert.equal(b.text.trim(), '')
})

test('确定性：同输入两次结果完全相同（含 id）', async () => {
  const a = await scriptToFact(SIMPLE)
  const b = await scriptToFact(SIMPLE)
  assert.deepEqual(a.entries.map((e) => e.id), b.entries.map((e) => e.id), 'id 稳定')
  assert.deepEqual(
    a.entries.map((e) => e.name),
    b.entries.map((e) => e.name),
    '条目名稳定'
  )
})

function existsSafe(path) {
  try { readFileSync(path, { flag: 'r' }); return true } catch { return false }
}
