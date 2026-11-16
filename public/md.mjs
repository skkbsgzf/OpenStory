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

  for (const line of lines) {
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
