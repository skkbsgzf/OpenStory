/**
 * OpenStory 分析引擎（OS-25）——纯函数、零依赖，浏览器与 Node 双用。
 *
 * 定位（作者口径）：分析属于「插件自己的功能」——正文面板自己算、自己画、自己标注，
 * 不走 daemon、不新增契约。全部指标基于文本本身，可解释（每个数字都能指到具体词/句）。
 *
 * 五个维度：
 *   stats    基础统计（字数/段数/句数/对白比例/平均句长）
 *   rhythm   节奏（逐段字数序列，供曲线）
 *   emotion  情绪密度（词典驱动的逐段强度，供曲线）
 *   style    文风（句长分布、段落密度、标点习惯）
 *   aiSmell  AI 味（连接词密度/套话密度/句长方差过低/排比句式过匀）
 * 另出 issues：可定位到段落区间的问题清单（供文档内标注与侧边气泡）。
 */

/* ---------- 词典（可解释：命中就报出来） ---------- */

/** 情绪正负词（小说常用，短表够用；命中数少时如实说明置信度低）。 */
const POSITIVE = ['笑', '喜', '欢', '暖', '甜', '柔', '静', '安', '轻', '亮', '光', '希望', '爱', '亲', '抱', '温', '美', '好', '快', '乐']
const NEGATIVE = ['泪', '痛', '冷', '恨', '怕', '苦', '死', '血', '暗', '黑', '哭', '怒', '恨', '悲', '孤', '寂', '颤', '抖', '慌', '怖', '绝望', '沉默', '冰']

/** 套话（"AI 味"高频嫌疑短语）。 */
const CLICHES = ['不禁', '仿佛', '宛如', '犹如', '似乎', '深深地', '渐渐地', '缓缓地', '微微', '轻轻', '不知不觉', '无可避免', '令人', '让人', '值得一提', '总而言之', '与此同时']

/** 连接词（书面堆砌感）。 */
const CONNECTIVES = ['然而', '因此', '此外', '总之', '与此同时', '不仅如此', '另一方面', '首先', '其次', '最后', '综上所述', '值得一提的是']

/** 长句阈值、长段阈值。 */
const LONG_SENTENCE = 75
const LONG_PARAGRAPH = 420

/* ---------- 工具 ---------- */

function text(value) {
  return String(value ?? '')
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

/** 中文分句：按句末标点与换行切。 */
export function splitSentences(source) {
  return text(source)
    .split(/(?<=[。！？!?…])\s*|\n+/u)
    .map((line) => line.trim())
    .filter(Boolean)
}

/** 中文分词近似：连续汉字 2-4 字切块（不做真分词，够做重复度与节奏）。 */
function grams(source, size) {
  const clean = text(source).replace(/[^\u4e00-\u9fff]/gu, '')
  const out = []
  for (let index = 0; index + size <= clean.length; index += 1) out.push(clean.slice(index, index + size))
  return out
}

function countHits(source, words) {
  const hits = []
  for (const word of words) {
    const matches = text(source).split(word).length - 1
    if (matches > 0) hits.push({ word, count: matches })
  }
  return hits
}

/* ---------- 主分析 ---------- */

/**
 * 分析一章。返回 {stats, rhythm, emotion, style, aiSmell, issues}。
 * `paragraphs` 来自调用方（正文面板按块给出），也接受原始 md（内部自己切）。
 */
export function analyzeChapter(source, { paragraphs = null } = {}) {
  const raw = text(source)
  const paras = (Array.isArray(paragraphs) && paragraphs.length ? paragraphs : raw.split(/\n{2,}/u))
    .map((line) => text(line).trim())
    .filter(Boolean)

  const allText = paras.join('\n')
  const chars = allText.replace(/\s/gu, '').length
  const sentences = splitSentences(allText)
  const sentenceLens = sentences.map((line) => line.replace(/\s/gu, '').length).filter((len) => len > 0)
  const avgSentence = sentenceLens.length ? sentenceLens.reduce((sum, len) => sum + len, 0) / sentenceLens.length : 0
  const variance = sentenceLens.length > 1
    ? sentenceLens.reduce((sum, len) => sum + (len - avgSentence) ** 2, 0) / sentenceLens.length
    : 0

  // 对白：引号内的字符占比
  const dialogues = [...allText.matchAll(/[「“"]([^」”"]*)[」”"]/gu)].map((match) => match[1])
  const dialogueChars = dialogues.reduce((sum, line) => sum + line.replace(/\s/gu, '').length, 0)

  // 节奏：逐段字数
  const rhythm = paras.map((line, index) => ({
    index,
    chars: line.replace(/\s/gu, '').length,
    excerpt: line.slice(0, 24)
  }))

  // 情绪：逐段 正-负 命中强度（每千字标准化，避免长段天然更高）
  const emotion = paras.map((line, index) => {
    const pos = countHits(line, POSITIVE).reduce((sum, hit) => sum + hit.count, 0)
    const neg = countHits(line, NEGATIVE).reduce((sum, hit) => sum + hit.count, 0)
    const words = Math.max(1, line.replace(/\s/gu, '').length)
    const intensity = ((pos - neg) / words) * 1000
    return {
      index,
      value: Math.round(intensity * 10) / 10,
      pos,
      neg,
      excerpt: line.slice(0, 24)
    }
  })

  // AI 味四因子（0-100，越高越像模板文）
  const clicheHits = countHits(allText, CLICHES)
  const connectiveHits = countHits(allText, CONNECTIVES)
  const clicheCount = clicheHits.reduce((sum, hit) => sum + hit.count, 0)
  const connectiveCount = connectiveHits.reduce((sum, hit) => sum + hit.count, 0)
  const per1000 = (count) => (chars > 0 ? (count / chars) * 1000 : 0)

  const factorCliche = clamp(per1000(clicheCount) * 25, 0, 100)
  const factorConnective = clamp(per1000(connectiveCount) * 30, 0, 100)
  // 句长方差过低＝句子长得太整齐（AI 典型）；用标准差/均值衡量
  const cv = avgSentence > 0 ? Math.sqrt(variance) / avgSentence : 0
  const factorUniform = clamp((0.55 - cv) * 200, 0, 100)
  // 段落长度过于均匀（每段都差不多长）
  const paraLens = rhythm.map((item) => item.chars)
  const paraAvg = paraLens.length ? paraLens.reduce((sum, len) => sum + len, 0) / paraLens.length : 0
  const paraCv = paraLens.length > 1 && paraAvg > 0
    ? Math.sqrt(paraLens.reduce((sum, len) => sum + (len - paraAvg) ** 2, 0) / paraLens.length) / paraAvg
    : 0
  const factorParaUniform = clamp((0.5 - paraCv) * 160, 0, 100)

  const aiScore = Math.round((factorCliche * 0.3 + factorConnective * 0.2 + factorUniform * 0.3 + factorParaUniform * 0.2) * 10) / 10

  // 问题清单（可定位：段号 + 该段内区间）
  const issues = []
  for (const sentence of sentences) {
    const clean = sentence.replace(/\s/gu, '')
    if (clean.length > LONG_SENTENCE) {
      issues.push({
        id: `long-sentence-${issues.length}`,
        type: 'rhythm',
        severity: clean.length > LONG_SENTENCE * 1.5 ? 'high' : 'medium',
        label: '长句',
        excerpt: clean.slice(0, 40),
        detail: `${clean.length} 字一句（阈值 ${LONG_SENTENCE}）——中文长句易失焦，建议断成两到三句。`,
        paragraph: paras.findIndex((line) => line.includes(sentence.slice(0, 12)))
      })
    }
  }
  paras.forEach((line, index) => {
    const clean = line.replace(/\s/gu, '')
    if (clean.length > LONG_PARAGRAPH) {
      issues.push({
        id: `long-paragraph-${index}`,
        type: 'layout',
        severity: clean.length > LONG_PARAGRAPH * 1.6 ? 'high' : 'medium',
        label: '长段',
        excerpt: clean.slice(0, 40),
        detail: `${clean.length} 字一段（阈值 ${LONG_PARAGRAPH}）——移动端会糊成一团，建议按场景/动作切段。`,
        paragraph: index
      })
    }
  })
  for (const hit of clicheHits) {
    issues.push({
      id: `cliche-${hit.word}-${issues.length}`,
      type: 'ai-smell',
      severity: hit.count >= 4 ? 'high' : 'medium',
      label: `套话「${hit.word}」`,
      excerpt: hit.word,
      detail: `全文出现 ${hit.count} 次——这类副词/短语是模板文高频特征，可换成具体动作或删掉。`,
      paragraph: paras.findIndex((line) => line.includes(hit.word))
    })
  }
  for (const hit of connectiveHits) {
    issues.push({
      id: `connective-${hit.word}-${issues.length}`,
      type: 'ai-smell',
      severity: hit.count >= 3 ? 'medium' : 'low',
      label: `连接词「${hit.word}」`,
      excerpt: hit.word,
      detail: `出现 ${hit.count} 次——书面连接词堆砌会让叙述变"报告体"。`,
      paragraph: paras.findIndex((line) => line.includes(hit.word))
    })
  }
  // 重复用词（4 字块出现 ≥4 次）
  const gramCount = new Map()
  for (const gram of grams(allText, 4)) gramCount.set(gram, (gramCount.get(gram) ?? 0) + 1)
  for (const [gram, count] of gramCount) {
    if (count >= 4 && !/^[\u4e00-\u9fff]{1}$/u.test(gram)) {
      issues.push({
        id: `repeat-${gram}-${issues.length}`,
        type: 'style',
        severity: count >= 7 ? 'high' : 'low',
        label: `重复「${gram}」`,
        excerpt: gram,
        detail: `4 字串在全文重复 ${count} 次——若非刻意回环，建议换说法。`,
        paragraph: paras.findIndex((line) => line.includes(gram))
      })
    }
  }

  // 排序：高优先，且带段号的在前
  issues.sort((left, right) => {
    const rank = { high: 0, medium: 1, low: 2 }
    return (rank[left.severity] ?? 3) - (rank[right.severity] ?? 3)
  })

  return {
    stats: {
      chars,
      paragraphs: paras.length,
      sentences: sentences.length,
      avgSentenceLen: Math.round(avgSentence * 10) / 10,
      dialogueChars,
      dialogueRatio: chars > 0 ? Math.round((dialogueChars / chars) * 1000) / 10 : 0
    },
    rhythm,
    emotion,
    style: {
      sentenceLens,
      sentenceCv: Math.round(cv * 100) / 100,
      paraCv: Math.round(paraCv * 100) / 100,
      cliches: clicheHits,
      connectives: connectiveHits
    },
    aiSmell: {
      score: aiScore,
      factors: [
        { id: 'cliche', label: '套话密度', score: Math.round(factorCliche), detail: `${clicheCount} 处（每千字 ${per1000(clicheCount).toFixed(1)}）` },
        { id: 'connective', label: '连接词堆砌', score: Math.round(factorConnective), detail: `${connectiveCount} 处` },
        { id: 'sentence-uniform', label: '句式过于整齐', score: Math.round(factorUniform), detail: `句长变异系数 ${cv.toFixed(2)}（>0.55 更自然）` },
        { id: 'para-uniform', label: '段落过于均匀', score: Math.round(factorParaUniform), detail: `段长变异系数 ${paraCv.toFixed(2)}` }
      ]
    },
    issues: issues.slice(0, 40),
    confidence: chars >= 800 ? 'ok' : 'low'
  }
}
