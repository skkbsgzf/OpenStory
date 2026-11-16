/**
 * 语言 DNA 统计器（蒸馏流水线第③步）——零 LLM，纯统计。
 *
 * 输入：正文 txt（UTF-8）。输出：语言指纹 JSON（句长/段落/标点/对话/高频词）。
 * 用法：node tools/distill/language-dna.mjs <正文.txt> [人物名1,人物名2,...] [输出.json]
 *
 * 指纹口径与彭湃包对齐，便于横向对比：
 *   句长：平均句长 / ≤15 字短句占比 / ≥50 字长句占比（句边界 = 。！？……）
 *   段落：段均字数 / 单句成段占比（段落 = 连续非空行）
 *   标点：每千字频次（逗号/句号/引号/感叹/问号/省略号/破折号）
 *   对话：引号内字数占正文比例
 *   高频词：去人物名＋停用词后的 bigram TOP30（无分词库，n-gram 近似）
 */
import { readFileSync, writeFileSync } from 'node:fs'

const [, , input, namesArg, outputArg] = process.argv
if (!input) {
  console.error('用法：node language-dna.mjs <正文.txt> [人物名csv] [输出.json]')
  process.exit(1)
}

const raw = readFileSync(input, 'utf-8')
const text = raw.replace(/\r\n/g, '\n')
// 顶部目录块/章名重复行不做特殊处理——短篇直接全量
const body = text.split('\n').filter((line) => line.trim())
const flat = body.join('\n')
const totalChars = flat.replace(/\s/g, '').length

const NAMES = new Set((namesArg || '').split(',').map((s) => s.trim()).filter(Boolean))

/* ---------- 句 ---------- */
const sentences = flat.split(/(?<=[。！？]|……)/).map((s) => s.replace(/\s/g, '')).filter(Boolean)
const lens = sentences.map((s) => s.length)
const avgSentence = lens.reduce((a, b) => a + b, 0) / Math.max(lens.length, 1)
const shortRatio = lens.filter((l) => l <= 15).length / Math.max(lens.length, 1)
const longRatio = lens.filter((l) => l >= 50).length / Math.max(lens.length, 1)

/* ---------- 段 ---------- */
const paraLens = body.map((p) => p.replace(/\s/g, '').length)
const avgPara = paraLens.reduce((a, b) => a + b, 0) / Math.max(paraLens.length, 1)
const singleSentenceRatio = body.filter((p) => {
  const t = p.replace(/\s/g, '')
  return t.length <= 15 && /^[^。！？]*[。！？]?……?$/.test(t)
}).length / Math.max(body.length, 1)

/* ---------- 标点（每千字） ---------- */
const puncts = { '逗号，': '，', '句号。': '。', '双引号“': '“', '感叹号！': '！', '问号？': '？', '省略号……': '……', '破折号——': '——' }
const perK = {}
for (const [label, p] of Object.entries(puncts)) {
  const count = flat.split(p).length - 1
  perK[label] = Number(((count / totalChars) * 1000).toFixed(1))
}
// 省略号单独成行（转场符指纹）
const ellipsisLines = body.filter((p) => p.trim() === '……').length
const ellipsisStandalone = perK['省略号……'] ? Number((ellipsisLines / (flat.split('……').length - 1) * 100).toFixed(0)) : 0

/* ---------- 对话占比 ---------- */
const quoted = [...flat.matchAll(/“([^”]*)”/g)].reduce((sum, m) => sum + m[1].length, 0)
const dialogueRatio = Number((quoted / Math.max(totalChars, 1) * 100).toFixed(1))

/* ---------- 高频词（bigram 近似） ---------- */
const STOP = new Set(['的了', '着了', '是他', '是我', '一个', '这个', '那个', '什么', '没有', '不是', '就是', '自己', '他们', '我们', '知道', '觉得', '已经', '这样', '那样', '一下', '起来', '出来', '时候', '现在', '因为', '所以', '但是', '如果', '还是', '只是', '这么', '那么', '一句', '一声', '说着', '看了', '笑道', '说道', '问道', '摇头', '点头'])
const namesClean = flat.replace(/“[^”]*”/g, '') // 词频去对话，聚焦叙述
for (const n of NAMES) namesClean.split(n).join(' ')
const freq = new Map()
for (let i = 0; i < namesClean.length - 1; i++) {
  const a = namesClean[i]
  const b = namesClean[i + 1]
  if (/[\u4e00-\u9fff]/.test(a) && /[\u4e00-\u9fff]/.test(b)) {
    const gram = a + b
    if (!STOP.has(gram) && !NAMES.has(gram)) freq.set(gram, (freq.get(gram) || 0) + 1)
  }
}
const topWords = [...freq.entries()].filter(([, c]) => c >= 3).sort((x, y) => y[1] - x[1]).slice(0, 30).map(([w, c]) => ({ w, c }))

/* ---------- 章节粒度（短篇按空行分块近似） ---------- */
const blocks = text.split(/\n\s*\n/).filter((b) => b.trim())

const result = {
  source: input,
  totalChars,
  paragraphCount: body.length,
  sentence: { avg: Number(avgSentence.toFixed(1)), shortLE15: Number((shortRatio * 100).toFixed(1)), longGE50: Number((longRatio * 100).toFixed(1)) },
  paragraph: { avg: Number(avgPara.toFixed(1)), singleSentenceLE15: Number((singleSentenceRatio * 100).toFixed(1)) },
  punctuationPer1k: perK,
  ellipsisStandalonePercent: ellipsisStandalone,
  dialogueRatio,
  topWords,
  blocks: blocks.length
}
if (outputArg) writeFileSync(outputArg, JSON.stringify(result, null, 2), 'utf-8')
console.log(JSON.stringify({
  totalChars,
  句: result.sentence,
  段: result.paragraph,
  标点每千字: perK,
  省略号独占行占比: ellipsisStandalone + '%',
  对话占比: dialogueRatio + '%',
  topWords: topWords.slice(0, 12).map((x) => x.w + '×' + x.c).join(' ')
}, null, 1))
