/**
 * 参考页（OS-44）——把 Obsidian 式笔记系统搬进 OpenStory。
 *
 * 结构（照 Obsidian 的双段反链口径）：
 *   左：标签树（可折叠、带计数、hover 看描述）
 *   中：笔记列表 / 笔记详情（Markdown 渲染，[[双链]] 可点跳转）
 *   右：反链面板（已链接 / 未链接 两段）
 *
 * 数据全部来自 daemon 的 /api/reference 与 /api/reference/note，
 * 本模块只负责渲染——不持有任何真相。
 */

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]
  ))
}

function text(value) {
  return String(value ?? '')
}

/** 标签按 `/` 拆层，做成可折叠的树（Obsidian 的 nested tags）。 */
export function buildTagTree(tags) {
  const root = { name: '', children: new Map(), count: 0, description: '', color: '' }
  for (const tag of Array.isArray(tags) ? tags : []) {
    const parts = text(tag.name).split('/').filter(Boolean)
    if (!parts.length) continue
    let node = root
    let prefix = ''
    for (const part of parts) {
      prefix = prefix ? `${prefix}/${part}` : part
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, full: prefix, children: new Map(), count: 0, description: '', color: '' })
      }
      node = node.children.get(part)
      node.count += Number(tag.count) || 0
    }
    // 叶子挂描述/颜色
    if (tag.description) node.description = text(tag.description)
    if (tag.color) node.color = text(tag.color)
  }
  return root
}

function renderTagNode(node, depth = 0) {
  const kids = [...node.children.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  const title = node.description ? ` title="${esc(node.description)}"` : ''
  const badge = node.description ? '<i class="tag-desc-dot" title="这个标签有描述"></i>' : ''
  const row = `<button class="tag-row" data-ref-tag="${esc(node.full)}"${title}>
      <span class="tag-name">${esc(node.name)}${badge}</span>
      <span class="tag-count">${node.count}</span>
    </button>`
  if (!kids.length) return `<div class="tag-leaf" style="--depth:${depth}">${row}</div>`
  return `<details class="tag-branch"${depth < 2 ? ' open' : ''} style="--depth:${depth}">
      <summary>${row}</summary>
      ${kids.map((kid) => renderTagNode(kid, depth + 1)).join('')}
    </details>`
}

/** 标签树面板。 */
export function tagTreeHtml(tags, activeTag = '') {
  const tree = buildTagTree(tags)
  const kids = [...tree.children.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  if (!kids.length) return '<div class="empty">还没有标签。<br>在笔记里写 <code>#标签</code> 就会自动出现。</div>'
  const all = `<button class="tag-row${activeTag ? '' : ' on'}" data-ref-tag="">
      <span class="tag-name">全部</span><span class="tag-count">${[...tree.children.values()].reduce((sum, kid) => sum + kid.count, 0)}</span>
    </button>`
  return `${all}${kids.map((kid) => renderTagNode(kid)).join('')}`
}

/** 笔记列表。 */
export function noteListHtml(notes, { activePath = '', activeTag = '' } = {}) {
  const list = (Array.isArray(notes) ? notes : [])
    .filter((note) => !note.isTagNote)
    .filter((note) => !activeTag || note.tags.includes(activeTag))
  if (!list.length) {
    return `<div class="empty">${activeTag ? `没有标签为 #${esc(activeTag)} 的笔记。` : '还没有参考笔记。<br>点右上「新建笔记」开始。'}</div>`
  }
  return list.map((note) => `
    <button class="ref-row${note.path === activePath ? ' on' : ''}" data-ref-path="${esc(note.path)}" title="${esc(note.path)}">
      <span class="rt">${esc(note.title)}</span>
      <span class="rm">${note.chars} 字${note.tags.length ? ` · ${note.tags.slice(0, 2).map((tag) => `#${esc(tag)}`).join(' ')}` : ''}</span>
      ${note.excerpt ? `<span class="re">${esc(note.excerpt)}</span>` : ''}
    </button>`).join('')
}

/** 反链面板（双段：已链接 / 未链接）。 */
export function backlinksHtml(backlinks) {
  const linked = Array.isArray(backlinks?.linked) ? backlinks.linked : []
  const unlinked = Array.isArray(backlinks?.unlinked) ? backlinks.unlinked : []
  const block = (label, items, cls) => `
    <section class="bl-sec ${cls}">
      <h5>${label} <span class="count">${items.length}</span></h5>
      ${items.length
        ? items.map((item) => `<button class="bl-row" data-ref-path="${esc(item.path)}" title="${esc(item.excerpt)}">
            <b>${esc(item.title)}</b><span>${esc(item.excerpt)}</span>
          </button>`).join('')
        : '<p class="empty">没有</p>'}
    </section>`
  return block('已链接', linked, 'linked') + block('未链接（提到了但没建链）', unlinked, 'unlinked')
}

/** 参考页整体骨架。 */
export function referenceShellHtml({ notes, tags, activeTag, activePath, editorHtml, backlinks, stats }) {
  const tagPanel = tagTreeHtml(tags, activeTag)
  const listPanel = noteListHtml(notes, { activePath, activeTag })
  const statsLine = stats
    ? `<span class="count">${stats.notes} 篇 · ${stats.tags} 个标签 · ${stats.links} 条链接</span>`
    : ''
  return `<div class="ref-page">
    <div class="ref-toolbar">
      <h1>参考</h1>
      ${statsLine}
      <span class="sp"></span>
      <button class="btn-ghost" data-action="ref-new-note">＋ 新建笔记</button>
      <button class="btn-ghost" data-action="ref-new-tag">＋ 新建标签</button>
    </div>
    <div class="ref-grid">
      <aside class="ref-tags">${tagPanel}</aside>
      <div class="ref-list">${listPanel}</div>
      <div class="ref-main">${editorHtml || '<div class="empty">左边选一篇笔记。</div>'}</div>
      <aside class="ref-backlinks">${activePath ? backlinksHtml(backlinks) : '<div class="empty">选中笔记后显示反链。</div>'}</aside>
    </div>
  </div>`
}
