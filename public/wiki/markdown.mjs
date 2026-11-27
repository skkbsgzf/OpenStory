/** wiki Markdown 阅读/逐块编辑 HTML（OS-225）；保存与 frontmatter 偏移由调用方负责。 */
export function wikiMarkdownReaderHtml(source, { md, renderMarkdown, splitBlocks } = {}) {
  if (!md && typeof renderMarkdown !== 'function') return `<div class="wiki-prose prose"><pre>${escapeText(String(source ?? ''))}</pre></div>`
  const render = md?.renderMarkdown ?? renderMarkdown
  const blocks = md?.splitBlocks ? md.splitBlocks(source) : [{ start: 0, end: 0, text: String(source ?? '') }]
  return `<div class="wiki-prose prose">${blocks.map((block) => render(block.text)).join('')}</div>`
}

export function wikiMarkdownEditorHtml(source, {
  md, renderMarkdown, splitBlocks, offset = 0, skipHeading = false,
  blockAttr = (name, value) => ` data-${name}="${escapeText(value)}"`
} = {}) {
  const render = md?.renderMarkdown ?? renderMarkdown
  const split = md?.splitBlocks ?? splitBlocks
  if (typeof render !== 'function' || typeof split !== 'function') return wikiMarkdownReaderHtml(source, { md, renderMarkdown, splitBlocks })
  const blocks = split(source).filter((block) => !skipHeading || !/^\s*#\s+/u.test(block.text))
  return `<div class="wiki-prose prose">${blocks.map((block, index) => `<div class="wiki-line"${blockAttr('line', index)}><div class="doc-block" contenteditable="true" spellcheck="false"${blockAttr('block', index)}${blockAttr('start', block.start + Number(offset || 0))}${blockAttr('end', block.end + Number(offset || 0))}${blockAttr('raw', block.text)}>${render(block.text)}</div></div>`).join('')}</div>`
}

function escapeText(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
}
