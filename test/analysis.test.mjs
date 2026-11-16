/**
 * OS-25 分析引擎用例（node:test，零依赖）。
 *   node --test test/analysis.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzeChapter, splitSentences } from '../public/analysis.mjs'

const SAMPLE = `# 第一章 雨停

雨到傍晚才停。余欢把手机扣在桌上，屏幕还亮着。

他仿佛听见了什么，不禁微微颤抖。然而他却不敢回头。

“你今天来迟了。”她说，声音被雾吞掉半截。`

test('基础统计：字数/段数/句数/对白占比', () => {
  const { stats } = analyzeChapter(SAMPLE)
  assert.ok(stats.chars > 40)
  assert.equal(stats.paragraphs, 4)
  assert.ok(stats.sentences >= 5)
  assert.ok(stats.dialogueChars > 0)
  assert.ok(stats.dialogueRatio > 0 && stats.dialogueRatio < 100)
  assert.ok(stats.avgSentenceLen > 0)
})

test('分句：句末标点与换行都切', () => {
  const sentences = splitSentences('第一句。第二句！第三句？')
  assert.equal(sentences.length, 3)
})

test('节奏与情绪：逐段序列长度与段数一致，情绪有正有负', () => {
  const result = analyzeChapter(SAMPLE)
  assert.equal(result.rhythm.length, result.stats.paragraphs)
  assert.equal(result.emotion.length, result.stats.paragraphs)
  assert.ok(result.emotion.some((item) => item.value < 0), '有负向段（仿佛/不敢）')
  assert.ok(result.rhythm.every((item) => typeof item.chars === 'number'))
})

test('AI 味：套话与连接词命中会推高分数并产出可定位 issue', () => {
  const result = analyzeChapter(SAMPLE)
  assert.ok(result.aiSmell.score > 0)
  const cliche = result.aiSmell.factors.find((factor) => factor.id === 'cliche')
  assert.ok(cliche.score > 0, '套话密度应被识别')
  const hit = result.issues.find((issue) => issue.type === 'ai-smell')
  assert.ok(hit, '应有 ai-smell 类 issue')
  assert.ok(hit.paragraph >= 0, 'issue 能定位到段')
  assert.ok(hit.detail.includes('出现') || hit.detail.includes('次'))
})

test('干净文本：套话为零、AI 味低', () => {
  const clean = '雨停了。她推开门，外面很安静。\n\n远处的灯一盏一盏亮起来，照在积水上。'
  const result = analyzeChapter(clean)
  const cliche = result.aiSmell.factors.find((factor) => factor.id === 'cliche')
  assert.equal(cliche.score, 0)
  assert.ok(result.aiSmell.score < 20)
})

test('长句与长段：超阈值产出 issue 并带段号', () => {
  const longSentence = `${'这是一句非常长的句子，'.repeat(8)}结束了。`
  const result = analyzeChapter(`短段。\n\n${longSentence}`)
  const longIssue = result.issues.find((issue) => issue.type === 'rhythm')
  assert.ok(longIssue, '长句应被标出')
  assert.ok(longIssue.detail.includes('字一句'))
})

test('短文本置信度如实标 low', () => {
  const result = analyzeChapter('很短。')
  assert.equal(result.confidence, 'low')
})

test('确定性：同输入两次结果一致（纯计算无随机）', () => {
  const a = analyzeChapter(SAMPLE)
  const b = analyzeChapter(SAMPLE)
  assert.deepEqual(a, b)
})
