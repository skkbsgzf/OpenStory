/**
 * 剧本原生渲染（OS-75）——剧本 ≠ 小说，但结构同构：逐块实时编辑。
 *
 * 剧本的「块」与小说不同：
 *   · 幕标题    `# 第一幕：雨前`           → .sc-act
 *   · 场景指示  `*〔场景：…〕*`             → .sc-stage
 *   · 角色台词  `**陈守一**（提示）：说白`   → .sc-line
 *   · 动作/其他 普通段落                     → .sc-action
 *
 * 本模块只做「解析 + 渲染」，不碰 state/DOM 之外的东西；
 * 编辑态由 app.js 的 contenteditable 块机制承担（与正文同一套 block 编辑）。
 */

const esc = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => (
  { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
))
const text = (value) => String(value ?? '')

/** 一行剧本 → 块类型判定。 */
export function classifyScriptLine(line) {
  const raw = text(line).trim()
  if (!raw) return { kind: 'blank' }
  if (/^#{1,3}\s+/u.test(raw)) return { kind: 'act' }
  // 场景指示：*〔…〕* 或 〔…〕 或 全角括号包裹的整行
  if (/^\*?[〔【\[].*[〕】\]]\*?$/u.test(raw)) return { kind: 'stage' }
  // 角色台词：**名字**（提示）：说白   或   **名字**：说白
  const lineMatch = /^\*\*([^*]+)\*\*\s*(?:[（(]([^）)]*)[）)])?\s*[:：]\s*([\s\S]*)$/u.exec(raw)
  if (lineMatch) {
    return { kind: 'line', who: lineMatch[1].trim(), hint: (lineMatch[2] || '').trim(), said: lineMatch[3] || '' }
  }
  return { kind: 'action' }
}

/** 把整篇剧本切成块（保持空行分组，块之间用两个换行分隔）。 */
export function parseScript(source) {
  const raw = text(source).replace(/\r\n?/gu, '\n')
  const chunks = raw.split(/\n{2,}/u).map((c) => c.trim()).filter(Boolean)
  return chunks.map((chunk, index) => {
    // 一个 chunk 可能是多行（场景指示跨行），取首行定类型
    const first = chunk.split('\n')[0]
    const info = classifyScriptLine(first)
    return { index, raw: chunk, ...info }
  })
}

/** 单块渲染（只读态）。 */
export function renderScriptBlock(block) {
  const { kind, raw } = block
  if (kind === 'act') {
    const title = raw.replace(/^#{1,3}\s+/u, '').trim()
    return `<div class="sc-act" data-sc-kind="act" data-sc-index="${block.index}">${esc(title)}</div>`
  }
  if (kind === 'stage') {
    const inner = raw.replace(/^\*?[〔【\[]/u, '').replace(/[〕】\]]\*?$/u, '').trim()
    return `<div class="sc-stage" data-sc-kind="stage" data-sc-index="${block.index}">${esc(inner)}</div>`
  }
  if (kind === 'line') {
    const hint = block.hint ? `<span class="sc-hint">（${esc(block.hint)}）</span>` : ''
    return `<div class="sc-line" data-sc-kind="line" data-sc-index="${block.index}">
      <span class="sc-who">${esc(block.who)}</span>${hint}<span class="sc-said">${esc(block.said)}</span>
    </div>`
  }
  return `<div class="sc-action" data-sc-kind="action" data-sc-index="${block.index}">${esc(raw)}</div>`
}

/** 整篇剧本渲染（只读态，供编辑器的 contenteditable 容器使用）。 */
export function renderScriptBody(source) {
  const blocks = parseScript(source)
  if (!blocks.length) return '<div class="sc-empty">还没有内容——写第一幕吧。</div>'
  return blocks.map(renderScriptBlock).join('')
}

/** 统计：幕数 / 台词条数 / 出场角色 / 字数（给页头 meta 用）。 */
export function scriptStats(source) {
  const blocks = parseScript(source)
  const acts = blocks.filter((b) => b.kind === 'act')
  const lines = blocks.filter((b) => b.kind === 'line')
  const cast = [...new Set(lines.map((b) => b.who).filter(Boolean))]
  return {
    acts: acts.length,
    lines: lines.length,
    cast,
    chars: text(source).replace(/\s/gu, '').length,
    scenes: blocks.filter((b) => b.kind === 'stage').length
  }
}


/**
 * 带源码偏移的块解析（OS-76：与 md.splitBlocks 同口径，供 commitDocBlock 复用）。
 * 返回 [{ index, raw, kind, who, hint, said, start, end }]，start/end 指向原文切片。
 * 这样剧本页可以走和正文页完全相同的「逐块 contenteditable + 失焦按偏移写回」链路。
 */
export function splitScriptBlocks(source) {
  const raw = text(source).replace(/\r\n?/gu, '\n')
  const out = []
  const re = /[^\n]+(?:\n(?!\n)[^\n]+)*/gu
  let match
  let guard = 0
  while ((match = re.exec(raw)) !== null && guard++ < 5000) {
    const chunk = match[0]
    if (!chunk.trim()) continue
    const first = chunk.split('\n')[0]
    const info = classifyScriptLine(first)
    out.push({
      index: out.length,
      raw: chunk,
      start: match.index,
      end: match.index + chunk.length,
      ...info
    })
  }
  return out
}
