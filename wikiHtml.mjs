/**
 * OpenStory wiki 派生 HTML（OS-6）——把 `wikiGet` 派生的同一份 JSON 渲成独立 HTML 文档。
 *
 * 边界：next/kernel/wikiDerive.mjs 一字不改（硬约束），HTML 渲染落在 openstory 层——
 * daemon 每次从 wiki JSON 现渲，iframe 沙箱装载（sandbox 空串＝禁脚本禁同源）。
 *
 * 防注入三条：
 *   · 全文逃逸（esc）——wiki 里的标题/摘要再脏也只是文字；
 *   · 色参只收 #rgb/#rrggbb（isHexColor），daemon 侧同样校验；
 *   · 文档带 CSP `default-src 'none'`（inline style 之外什么都不许跑）。
 * 零脚本、零外链（字体走系统栈），适合纯静态沙箱。
 */

function text(value) {
  return String(value ?? '')
}

function esc(value) {
  return text(value).replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char])
}

export function isHexColor(value) {
  return /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(text(value).trim())
}

function count(wiki, key) {
  return Array.isArray(wiki?.[key]) ? wiki[key].length : 0
}

/** wiki JSON → 独立 HTML 文档（内联 CSS，无脚本）。 */
export function wikiHtmlDocument(wiki, { accent = '#ff385c', bg = '#ffffff', ink = '#222222' } = {}) {
  const colors = {
    accent: isHexColor(accent) ? text(accent).trim() : '#ff385c',
    bg: isHexColor(bg) ? text(bg).trim() : '#ffffff',
    ink: isHexColor(ink) ? text(ink).trim() : '#222222'
  }
  const safeWiki = wiki && typeof wiki === 'object' ? wiki : null
  const book = safeWiki?.book && typeof safeWiki.book === 'object' ? safeWiki.book : {}
  const characters = Array.isArray(safeWiki?.characters) ? safeWiki.characters : []
  const chapters = Array.isArray(safeWiki?.chapters) ? safeWiki.chapters : []
  const terms = Array.isArray(safeWiki?.terms) ? safeWiki.terms : []
  const title = text(book.title).trim() || '未命名书'

  const meta = [
    text(book.author).trim() ? `作者 ${esc(text(book.author).trim())}` : '',
    text(book.group).trim() ? esc(text(book.group).trim()) : '',
    chapters.length ? `${chapters.length} 章` : '',
    characters.length ? `${characters.length} 人` : '',
    terms.length ? `${terms.length} 术语` : ''
  ].filter(Boolean).map((item) => `<span>${item}</span>`).join('')

  const characterCards = characters.map((character) => {
    const detail = [character?.identity, character?.archetype, character?.summary]
      .map((value) => text(value).trim())
      .filter(Boolean)
      .join(' · ')
    const appearances = Number(character?.appearances) > 0 ? ` · 出现 ${Number(character.appearances)} 次` : ''
    return `<div class="card"><b>${esc(character?.name || '—')}</b><span>${esc(detail || '（无画像）')}${appearances}</span></div>`
  }).join('')

  const chapterLines = chapters.map((chapter) => {
    const no = text(chapter?.no).trim() || '—'
    const chapterTitle = text(chapter?.title).trim() || (no !== '—' ? `第 ${no} 章` : '未命名章')
    const summary = text(chapter?.summary).trim()
    return `<div class="line"><span class="no">${esc(no)}</span><span class="tt">${esc(chapterTitle)}${summary ? ` · ${esc(summary)}` : ''}</span></div>`
  }).join('')

  const termCards = terms.map((term) => {
    const name = text(term?.name || term?.term).trim() || '—'
    const summary = text(term?.summary || term?.definition).trim()
    return `<div class="card"><b>${esc(name)}</b><span>${esc(summary || '—')}</span></div>`
  }).join('')

  const empty = !safeWiki || (chapters.length === 0 && characters.length === 0 && terms.length === 0)

  return `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} · wiki</title>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<style>
:root { --accent: ${colors.accent}; --bg: ${colors.bg}; --ink: ${colors.ink}; --muted: rgba(85,85,85,.75); --muted: color-mix(in srgb, ${colors.ink} 55%, ${colors.bg}); --hair: rgba(0,0,0,.12); --hair: color-mix(in srgb, ${colors.ink} 10%, ${colors.bg}); }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--ink); font: 14px/1.7 -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Microsoft YaHei', 'PingFang SC', sans-serif; padding: 34px 40px; }
.wrap { max-width: 1080px; margin: 0 auto; }
.kick { font-size: 12px; color: var(--accent); letter-spacing: .14em; margin-bottom: 6px; }
h1 { font-family: 'Noto Serif SC', 'Songti SC', Georgia, serif; font-size: 30px; margin: 0 0 8px; }
.meta { display: flex; gap: 14px; font-size: 12px; color: var(--muted); border-bottom: 1px solid var(--hair); padding-bottom: 14px; flex-wrap: wrap; }
section { margin-top: 24px; }
section h2 { font-size: 15px; margin: 0 0 10px; }
.cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 10px; }
.card { border: 1px solid var(--hair); border-radius: 10px; padding: 10px 12px; }
.card b { display: block; margin-bottom: 4px; }
.card span { color: var(--muted); font-size: 12px; line-height: 1.6; }
.line { display: grid; grid-template-columns: 64px 1fr; gap: 10px; padding: 7px 0; border-bottom: 1px dashed var(--hair); font-size: 13px; }
.line .no { color: var(--muted); font-family: Consolas, monospace; font-size: 12px; }
.line .tt { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.empty { margin: 60px auto; max-width: 420px; text-align: center; color: var(--muted); line-height: 1.9; }
.empty b { display: block; color: var(--ink); font-size: 19px; margin-bottom: 6px; }
</style>
</head>
<body>
<div class="wrap">
  <div class="kick">WIKI · 派生</div>
  <h1>${esc(title)}</h1>
  ${meta ? `<div class="meta">${meta}</div>` : ''}
  ${empty ? '<div class="empty"><b>这本书还没有派生 wiki</b>回工作台 Wiki 页签点「派生 wiki」，零模型纯计算，随时可重建。</div>' : `
  ${characters.length ? `<section><h2>人物 · ${characters.length}</h2><div class="cards">${characterCards}</div></section>` : ''}
  ${chapters.length ? `<section><h2>章节 · ${chapters.length}</h2>${chapterLines}</section>` : ''}
  ${terms.length ? `<section><h2>术语 · ${terms.length}</h2><div class="cards">${termCards}</div></section>` : ''}`}
</div>
</body>
</html>`
}
