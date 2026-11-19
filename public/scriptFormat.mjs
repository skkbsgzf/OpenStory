/**
 * 剧本自动排版（OS-78）——把「自由输入」转成规范剧本格式。
 *
 * 作者口径：用户输入是自由的文本，通过通配符识别后转换成规范剧本格式。
 * 所以这里不做强制格式，只做「识别 + 规范化」：
 *
 *   `洪信：你来了。`                    → **洪信**：你来了。
 *   `洪信（压低声音）：你来了。`          → **洪信**（压低声音）：你来了。
 *   `洪信: 你来了。`  （半角冒号）        → **洪信**：你来了。
 *   `【场景】山道` / `[场景] 山道`        → *〔场景：山道〕*
 *   `（幕落）` / `(幕落)`                → *〔幕落〕*
 *   `第一幕` / `第一场` / `幕一`          → # 第一幕
 *   `# 第一幕`                          → 原样（已是规范）
 *
 * 设计原则：
 *   1. **幂等**：已规范的文本再跑一次，输出与输入相同（绝不二次包装）。
 *   2. **保守**：不确定的行不动（宁可少转，不可错转）。
 *   3. **可关**：设置里有开关，关掉就纯自由文本。
 */

const text = (value) => String(value ?? '')

/** 台词识别：`名字：说白` / `名字（提示）：说白` / 半角冒号。 */
const LINE_RE = /^([^\s：:（）()【】\[\]〔〕#*]{1,12})\s*(?:[（(]([^）)]{0,40})[）)])?\s*[：:]\s*([\s\S]+)$/u

/** 场景指示识别：`【场景】…` / `[场景] …` / 整行括号包裹。 */
const STAGE_BRACKET_RE = /^[【\[]\s*(?:场景|地点|时间|舞台|场景提示)?\s*[】\]]\s*([\s\S]*)$/u
const STAGE_PAREN_RE = /^[（(]\s*([^）)]{2,60})\s*[）)]$/u

/** 幕/场标题识别：`第一幕` / `第 1 幕` / `第一场` / `幕一`。 */
const ACT_RE = /^第?\s*[一二三四五六七八九十\d]+\s*[幕场]\s*[:：]?\s*(.*)$/u

/** 已经是规范格式的行（不该再动）。 */
const ALREADY = {
  act: /^#{1,3}\s+/u,
  stage: /^\*?[〔【\[]/u,
  line: /^\*\*[^*]+\*\*/u
}

/**
 * 规范化一行。返回 `{ text, changed, kind }`。
 * kind: 'act' | 'stage' | 'line' | 'action' | 'blank'
 */
export function normalizeScriptLine(line) {
  const raw = text(line)
  const trimmed = raw.trim()
  if (!trimmed) return { text: raw, changed: false, kind: 'blank' }

  // 已规范 → 原样返回（幂等保证）
  if (ALREADY.act.test(trimmed)) return { text: trimmed, changed: trimmed !== raw, kind: 'act' }
  if (ALREADY.line.test(trimmed)) {
    // `**名字**：说白` 已是规范；但若是 `**名字**` 后面没冒号，补上
    if (!/[：:]\s*/u.test(trimmed)) return { text: `${trimmed}：`, changed: true, kind: 'line' }
    return { text: trimmed, changed: trimmed !== raw, kind: 'line' }
  }
  if (/^\*〔[\s\S]*〕\*$/u.test(trimmed)) return { text: trimmed, changed: trimmed !== raw, kind: 'stage' }

  // 幕/场标题优先于台词判定（「第一幕：雨前」不能被当成「第一幕说话」）
  const actMatch = ACT_RE.exec(trimmed)
  if (actMatch) {
    return { text: `# ${trimmed}`, changed: true, kind: 'act' }
  }

  // 台词：`名字：说白`
  const lineMatch = LINE_RE.exec(trimmed)
  if (lineMatch) {
    const who = lineMatch[1].trim()
    const hint = (lineMatch[2] || '').trim()
    const said = lineMatch[3].trim()
    // 排除误判：说白太短（如 "12:30" 之类）或名字像数字
    if (said.length >= 1 && !/^\d+$/u.test(who)) {
      return {
        text: `**${who}**${hint ? `（${hint}）` : ''}：${said}`,
        changed: true,
        kind: 'line'
      }
    }
  }

  // 场景指示：`【场景】…`
  const stageBracket = STAGE_BRACKET_RE.exec(trimmed)
  if (stageBracket) {
    const inner = stageBracket[1].trim()
    return { text: `*〔${inner ? `场景：${inner}` : '场景'}〕*`, changed: true, kind: 'stage' }
  }

  // 场景指示：整行括号 `（幕落）`
  const stageParen = STAGE_PAREN_RE.exec(trimmed)
  if (stageParen) {
    const inner = stageParen[1].trim()
    // 排除「（她笑了）」这类叙事括注——只有短句且像舞台提示才转
    if (/^(幕落|幕启|灯暗|灯亮|音乐|音效|雨声|雷声|静止|停顿|暗场|亮场|转场|结束|开场|全场|追光|幻灯)/u.test(inner)) {
      return { text: `*〔${inner}〕*`, changed: true, kind: 'stage' }
    }
  }

  return { text: trimmed, changed: trimmed !== raw, kind: 'action' }
}

/**
 * 整篇规范化。返回 `{ text, changes, stats }`。
 * 只在「设置开启自动排版」时由前端调用。
 */
export function normalizeScript(source) {
  const raw = text(source).replace(/\r\n?/gu, '\n')
  const blocks = raw.split(/\n{2,}/u)
  const changes = []
  const out = blocks.map((chunk) => {
    const lines = chunk.split('\n')
    const nextLines = lines.map((line) => {
      const r = normalizeScriptLine(line)
      if (r.changed) changes.push({ from: line.trim(), to: r.text, kind: r.kind })
      return r.text
    })
    return nextLines.join('\n')
  })
  const next = out.join('\n\n')
  const kinds = {}
  for (const line of next.split('\n')) {
    const r = normalizeScriptLine(line)
    kinds[r.kind] = (kinds[r.kind] || 0) + 1
  }
  return { text: next, changes, stats: kinds }
}

/** 快速判断是否需要排版（避免无谓的全量写盘）。 */
export function needsNormalize(source) {
  return normalizeScript(source).changes.length > 0
}
