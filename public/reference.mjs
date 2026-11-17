/**
 * 参考页（OS-44）——把 Obsidian 式笔记系统搬进 OpenStory。
 *
 * OS-51 概念修正（作者口径）：
 *   · 标签不是与笔记并列的载体，是**给笔记附加的数据属性**——侧栏里它只是筛选器，
 *     图谱里可按它筛子图，详情页里它出现在简介卡上
 *   · 侧栏目录＝树状：标签筛选是可折叠的三级树（子级在父级下方，层次清楚），
 *     笔记按子目录分组是主体
 *   · 详情页 Wiki 式分层：上半＝左简介＋右关系图谱，下半＝词条详情，最下＝关联说明
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

/** 标签按 `/` 拆层，做成树（Obsidian 的 nested tags）。 */
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

/**
 * 标签筛选树：真正的三级折叠目录——子级在父级下方缩进展开，不是平铺到别处。
 * 点名字＝选中筛选（再点同一个＝取消）；有子级时行前有 ▸/▾ 折叠指示。
 */
function renderTagBranch(node, activeTag = '', depth = 0) {
  const kids = [...node.children.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  const title = node.description ? ` title="${esc(node.description)}"` : ''
  const badge = node.description ? '<i class="tag-desc-dot" title="这个标签有描述"></i>' : ''
  const on = activeTag && node.full === activeTag ? ' on' : ''
  const row = `<button class="nav-row${on}" data-ref-tag="${esc(node.full)}"${title}>
      <span class="tag-name">${esc(node.name)}${badge}</span>
      <span class="nav-count">${node.count}</span>
    </button>`
  if (!kids.length) return `<div class="tag-leaf" style="--depth:${depth}">${row}</div>`
  return `<details class="tag-branch"${depth < 1 ? ' open' : ''} style="--depth:${depth}">
      <summary>${row}<span class="tw-chev" aria-hidden="true"></span></summary>
      ${kids.map((kid) => renderTagBranch(kid, activeTag, depth + 1)).join('')}
    </details>`
}

/**
 * 笔记组（侧栏主体）：按子目录分组 + activeTag/q 双重过滤。
 * 单独导出：搜索框逐字过滤时只换这个组，不打断输入焦点。
 */
export function refNotesGroupHtml({ notes, activeTag = '', activePath = '', q = '' } = {}) {
  const needle = text(q).trim().toLowerCase()
  const list = (Array.isArray(notes) ? notes : [])
    .filter((note) => !activeTag || note.tags.includes(activeTag))
    .filter((note) => {
      if (!needle) return true
      const hay = [note.title, note.path, note.excerpt, ...(note.tags || [])].join(' ').toLowerCase()
      return hay.includes(needle)
    })
  const groups = new Map()
  for (const note of list) {
    const parts = text(note.path).split('/')
    const group = parts.length > 2 ? parts[1] : ''
    if (!groups.has(group)) groups.set(group, [])
    groups.get(group).push(note)
  }
  const rows = [...groups.entries()].map(([group, items]) => {
    const head = group ? `<div class="nav-group-label">${esc(group)}</div>` : ''
    const body = items.map((note) => `
      <button class="nav-row note${note.path === activePath ? ' on' : ''}" data-ref-path="${esc(note.path)}" title="${esc(note.path)}">
        <span class="tag-name">${esc(note.title)}</span>
        <span class="nav-count">${note.chars}</span>
      </button>`).join('')
    return head + body
  }).join('')
  const header = `笔记${activeTag ? ` · #${esc(activeTag)}` : ''}`
  return `<div class="nav-group grow"><div class="nav-group-label">${esc(header)}</div>${rows || '<p class="nav-empty">没有匹配的笔记。</p>'}</div>`
}

/**
 * 侧栏导航（OS-51 修正语义）：
 *   视图：笔记 / 关系图谱（页面级切换）
 *   按标签筛选：标签是笔记的属性——这里只是筛选器，三级折叠树
 *   笔记：主体，按子目录分组，受标签 + 搜索词双重过滤
 */
export function refNavHtml({ tags, notes, activeTag = '', activePath = '', view = 'note', q = '' } = {}) {
  // 视图组
  const views = [
    ['note', '笔记'],
    ['graph', '关系图谱']
  ]
  const viewRows = views.map(([id, label]) =>
    `<button class="nav-row view${view === id ? ' on' : ''}" data-ref-view="${esc(id)}"><span>${esc(label)}</span></button>`
  ).join('')
  // 标签筛选组（三级折叠树）
  const tree = buildTagTree(tags)
  const tagKids = [...tree.children.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  const tagRows = tagKids.length
    ? tagKids.map((kid) => renderTagBranch(kid, activeTag)).join('')
    : '<p class="nav-empty">在笔记里写 <code>#标签</code> 就会自动出现。</p>'
  const notesGroup = refNotesGroupHtml({ notes, activeTag, activePath, q })
  return `<div class="ref-nav">
    <input class="search" id="ref-search" type="search" placeholder="过滤笔记 / 标签…" value="${esc(q)}">
    <div class="nav-group"><div class="nav-group-label">视图</div>${viewRows}</div>
    <div class="nav-group"><div class="nav-group-label">按标签筛选</div>${tagRows}</div>
    ${notesGroup}
  </div>`
}

/** 反链（双段：已链接 / 未链接）。OS-51：不再占独立列，作为「关联说明」进详情页底部。 */
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

/**
 * 参考页整体骨架（OS-51）：侧栏导航 + 主区全宽（反链并入详情页底部，不再占独立列）。
 * mainHtml 由调用方按 view 给：笔记视图传详情页整块，图谱视图传大画布块。
 */
export function referenceShellHtml({ notes, tags, activeTag, activePath, view = 'note', q = '', mainHtml = '', stats, absorbable = 0 }) {
  const statsLine = stats
    ? `<span class="count">${stats.notes} 篇 · ${stats.tags} 个标签 · ${stats.links} 条链接</span>`
    : ''
  const nav = refNavHtml({ tags, notes, activeTag, activePath, view, q })
  return `<div class="ref-page">
    <div class="ref-toolbar">
      <h1>参考</h1>
      ${statsLine}
      <span class="sp"></span>
      ${absorbable > 0 ? `<button class="btn-ghost" data-action="ref-absorb">迁入旧目录（${absorbable} 篇）</button>` : ''}
      <button class="btn-ghost" data-action="ref-new-note">＋ 新建笔记</button>
      <button class="btn-ghost" data-action="ref-new-tag">＋ 新建标签</button>
    </div>
    <div class="ref-grid">
      <aside class="ref-sidenav">${nav}</aside>
      <div class="ref-main">${mainHtml || '<div class="empty">左边选一篇笔记。</div>'}</div>
    </div>
  </div>`
}
