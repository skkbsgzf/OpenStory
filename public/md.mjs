/**
 * OpenStory Markdown 渲染器（OS-21）——零依赖、浏览器/Node 双用（ESM）。
 *
 * 为什么不引 marked/DOMPurify：本仓零 npm、daemon 只监听本机。渲染器只产出白名单标签
 * （p/h1-h6/strong/em/code/pre/blockquote/ul/ol/li/hr/a/br），所有文本与属性值一律转义，
 * 因此不需要 sanitizer 二次清洗（这也是唯一安全的零依赖路径）。
 *
 * 支持子集（够小说正文用）：ATX 标题、段落、粗体/斜体/行内码/围栏代码、引用、有序/无序列表、
 * 分割线、链接、硬换行（两空格或行尾反斜杠）、反斜杠转义。
 * 明确不支持（不做半懂）：表格、脚注、HTML 内联、任务列表、自动链接。
 */

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ESCAPES[char])
}

/** 行内渲染：先转义，再按标记替换（顺序敏感：行内码最先切分，避免码内标记被解析）。 */
export function renderInline(text) {
  const raw = String(text ?? '')
  // 行内码先吃掉：用占位符保护
  const codes = []
  let work = raw.replace(/`([^`]+)`/gu, (_, code) => {
    codes.push(`<code>${escapeHtml(code)}</code>`)
    return `\u0000${codes.length - 1}\u0000`
  })
  work = escapeHtml(work)
  // 图片 ![alt](src)：只放行站内相对路径 / http(s) / data:image，其余退化成 alt 文本
  work = work.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/gu, (match, alt, src) => {
    const url = src.trim()
    if (!/^(?:https?:\/\/|\/(?!\/)|\.\/|data:image\/)/iu.test(url)) return alt || match
    return `<img src="${url}" alt="${alt}" loading="lazy" referrerpolicy="no-referrer">`
  })
  // 链接 [text](url)：url 只允许 http(s)/相对/锚点
  work = work.replace(/\[([^\]]+)\]\(([^)\s]+)\)/gu, (match, label, href) => {
    const url = href.trim()
    if (!/^(?:https?:\/\/|\/|#|\.\/)/iu.test(url)) return match
    return `<a href="${url}" target="_blank" rel="noreferrer noopener">${label}</a>`
  })
  work = work.replace(/\*\*([^*]+)\*\*/gu, '<strong>$1</strong>')
  work = work.replace(/(^|[^*])\*([^*\n]+)\*/gu, '$1<em>$2</em>')
  work = work.replace(/__([^_]+)__/gu, '<strong>$1</strong>')
  // 还原行内码
  work = work.replace(/\u0000(\d+)\u0000/gu, (_, index) => codes[Number(index)] ?? '')
  return work
}

/**
 * 表格判定：本行含 | 且下一行是分隔行（--- / :--- / ---: / :---:，每格都对得上）。
 * 照 OpenDesign 的聊天渲染器口径——只认 GFM 管道表，不做复杂方言。
 * 返回 { header: string[], align: ('left'|'center'|'right')[], rows: string[][] } 或 null。
 */
function parseTable(lines, startIndex) {
  const headerLine = lines[startIndex]
  const dividerLine = lines[startIndex + 1]
  if (!headerLine || !dividerLine) return null
  if (!headerLine.includes('|')) return null
  if (!/^\s*\|?[\s:-]*-[\s:|-]*\|?\s*$/u.test(dividerLine)) return null
  const splitRow = (line) => line.trim().replace(/^\|/u, '').replace(/\|$/u, '').split('|').map((cell) => cell.trim())
  const header = splitRow(headerLine)
  const dividers = splitRow(dividerLine)
  if (header.length !== dividers.length) return null
  if (!dividers.every((cell) => /^:?-+:?$/u.test(cell))) return null
  const align = dividers.map((cell) => {
    const left = cell.startsWith(':')
    const right = cell.endsWith(':')
    if (left && right) return 'center'
    if (right) return 'right'
    return 'left'
  })
  const rows = []
  let index = startIndex + 2
  while (index < lines.length) {
    const line = lines[index]
    if (!line.trim() || !line.includes('|')) break
    const cells = splitRow(line)
    // 补齐/裁剪到表头列数，避免坏行把表格撑坏
    while (cells.length < header.length) cells.push('')
    rows.push(cells.slice(0, header.length))
    index += 1
  }
  return { header, align, rows, nextIndex: index }
}

/** 表格 → HTML（外层 div 负责横向滚动，表格本身不缩）。 */
function renderTable(table) {
  const styleOf = (column) => (table.align[column] && table.align[column] !== 'left' ? ` style="text-align:${table.align[column]}"` : '')
  const head = table.header
    .map((cell, column) => `<th${styleOf(column)}>${renderInline(cell)}</th>`)
    .join('')
  const body = table.rows
    .map((row) => `<tr>${row.map((cell, column) => `<td${styleOf(column)}>${renderInline(cell)}</td>`).join('')}</tr>`)
    .join('')
  return `<div class="md-table-wrap"><table class="md-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table></div>`
}

/**
 * 块级渲染。返回 HTML 字符串。
 * 段落之间用空行切分；单换行在段落内保留为 <br>（小说排版按「所见即所得」更直观）。
 */
export function renderMarkdown(source) {
  const lines = String(source ?? '').replace(/\r\n?/gu, '\n').split('\n')
  const out = []
  let paragraph = []
  let listType = ''
  let listItems = []
  let inCode = false
  let codeLang = ''
  let codeLines = []
  let quoteLines = []

  const flushParagraph = () => {
    if (paragraph.length === 0) return
    const body = paragraph.map((line) => renderInline(line)).join('<br>')
    if (body.trim()) out.push(`<p>${body}</p>`)
    paragraph = []
  }
  const flushList = () => {
    if (listItems.length === 0) return
    const tag = listType === 'ol' ? 'ol' : 'ul'
    out.push(`<${tag}>${listItems.map((item) => `<li>${item}</li>`).join('')}</${tag}>`)
    listItems = []
    listType = ''
  }
  const flushQuote = () => {
    if (quoteLines.length === 0) return
    out.push(`<blockquote>${quoteLines.map((line) => renderInline(line)).join('<br>')}</blockquote>`)
    quoteLines = []
  }
  const flushAll = () => {
    flushParagraph()
    flushList()
    flushQuote()
  }

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex]
    // 围栏代码
    const fence = line.match(/^\s*```([\w-]*)\s*$/u)
    if (fence) {
      if (inCode) {
        const lang = codeLang ? ` class="language-${escapeHtml(codeLang)}"` : ''
        out.push(`<pre><code${lang}>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
        inCode = false
        codeLang = ''
        codeLines = []
      } else {
        flushAll()
        inCode = true
        codeLang = fence[1] || ''
      }
      continue
    }
    if (inCode) {
      codeLines.push(line)
      continue
    }
    // 空行：收段落
    if (!line.trim()) {
      flushAll()
      continue
    }
    // 表格（GFM 管道表）：必须在段落收集之前判定，否则会被当一个普通段落吃掉
    if (line.includes('|')) {
      const table = parseTable(lines, lineIndex)
      if (table) {
        flushAll()
        out.push(renderTable(table))
        lineIndex = table.nextIndex - 1
        continue
      }
    }
    // 分割线
    if (/^\s*(?:---|\*\*\*|___)\s*$/u.test(line)) {
      flushAll()
      out.push('<hr>')
      continue
    }
    // ATX 标题
    const heading = line.match(/^\s*(#{1,6})\s+(.*)$/u)
    if (heading) {
      flushAll()
      const level = heading[1].length
      out.push(`<h${level}>${renderInline(heading[2].replace(/\s*#+\s*$/u, ''))}</h${level}>`)
      continue
    }
    // 引用
    const quote = line.match(/^\s*>\s?(.*)$/u)
    if (quote) {
      flushParagraph()
      flushList()
      quoteLines.push(quote[1])
      continue
    }
    if (quoteLines.length) flushQuote()
    // 列表
    const ordered = line.match(/^\s*\d+[.)]\s+(.*)$/u)
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/u)
    if (ordered || bullet) {
      flushParagraph()
      const type = ordered ? 'ol' : 'ul'
      if (listType && listType !== type) flushList()
      listType = type
      listItems.push(renderInline((ordered ?? bullet)[1]))
      continue
    }
    if (listItems.length) flushList()
    // 普通段落行
    paragraph.push(line)
  }
  if (inCode) {
    // 未闭合围栏：按代码块收掉，不吞内容
    out.push(`<pre><code>${escapeHtml(codeLines.join('\n'))}</code></pre>`)
  }
  flushAll()
  return out.join('\n')
}

/** 纯文本提取（用于字数统计/高亮定位：剥掉 md 标记）。 */
export function markdownToPlain(source) {
  return String(source ?? '')
    .replace(/```[\s\S]*?```/gu, (block) => block.replace(/```[\w-]*\n?/gu, ''))
    .replace(/`([^`]+)`/gu, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/gu, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
    .replace(/^\s*#{1,6}\s+/gmu, '')
    .replace(/^\s*>\s?/gmu, '')
    .replace(/^\s*(?:[-*+]|\d+[.)])\s+/gmu, '')
    .replace(/\*\*([^*]+)\*\*/gu, '$1')
    .replace(/[*_]([^*_]+)[*_]/gu, '$1')
    .replace(/\s*---\s*/gu, '')
}

/** 渲染后的段落起点（用于「点入即改」映射：第 n 个空行段的源码偏移）。 */
export function paragraphOffsets(source) {
  const raw = String(source ?? '').replace(/\r\n?/gu, '\n')
  const offsets = []
  let cursor = 0
  let blockStart = 0
  let inFence = false
  const lines = raw.split('\n')
  for (const line of lines) {
    if (/^\s*```/u.test(line)) inFence = !inFence
    if (!inFence && !line.trim()) {
      if (cursor > blockStart) offsets.push(blockStart)
      blockStart = cursor + line.length + 1
    }
    cursor += line.length + 1
  }
  if (cursor > blockStart) offsets.push(blockStart)
  return offsets
}

/**
 * 按空行切块（OS-22）：块＝渲染后的一个「文档组件」，也是实时编辑的最小单位。
 * 返回 [{start, end, text}]——start/end 是源码字符偏移，改一个块只替换这一段。
 */
export function splitBlocks(source) {
  const raw = String(source ?? '').replace(/\r\n?/gu, '\n')
  const blocks = []
  let offset = 0
  let current = null
  let buffer = []
  let inFence = false
  const flush = () => {
    if (current && buffer.length) {
      blocks.push({ start: current.start, end: current.end, text: buffer.join('\n') })
    }
    current = null
    buffer = []
  }
  for (const line of raw.split('\n')) {
    if (/^\s*```/u.test(line)) inFence = !inFence
    const blank = !inFence && !line.trim()
    if (blank) {
      flush()
    } else {
      if (!current) current = { start: offset, end: offset }
      current.end = offset + line.length
      buffer.push(line)
    }
    offset += line.length + 1
  }
  flush()
  return blocks
}
