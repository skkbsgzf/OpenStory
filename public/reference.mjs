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
 * 统一目录树（OS-53，作者裁定）：一棵树管完「标签→笔记」的层级浏览——
 *   标签做枝干（按 / 拆层），笔记做叶子，挂在它**最深的一个标签**下；
 *   点击任何节点，子词条就在**正下方原地展开**，绝不滚到别的区域。
 *   点标签行＝展开子树＋定位（activeTag 高亮，祖先自动展开）；点笔记行＝打开详情。
 */
export function buildRefTree(notes) {
  const root = { name: '', full: '', children: new Map(), notes: [], count: 0 }
  const nodeAt = (tagPath) => {
    let node = root
    let prefix = ''
    for (const part of tagPath.split('/').filter(Boolean)) {
      prefix = prefix ? `${prefix}/${part}` : part
      if (!node.children.has(part)) node.children.set(part, { name: part, full: prefix, children: new Map(), notes: [], count: 0 })
      node = node.children.get(part)
      node.count += 1
    }
    return node
  }
  for (const note of Array.isArray(notes) ? notes : []) {
    if (note.isTagNote) continue // 标签定义笔记是「标签的描述」，不是词条，不进目录
    const tags = [...new Set(Array.isArray(note.tags) ? note.tags : [])]
    if (!tags.length) {
      root.notes.push(note)
      continue
    }
    // 多点挂载（Obsidian 标签面板口径）：笔记出现在它每个标签的路径末端——
    // 打 #人物/梁山 的笔记同时是「人物」与「人物/梁山」的成员，一个维度都不丢
    const ends = new Set()
    for (const tag of tags) {
      const end = nodeAt(tag)
      if (!ends.has(end)) { end.notes.push(note); ends.add(end) }
    }
  }
  return root
}

/** 搜索过滤：笔记匹配 title/path/摘要/标签；标签节点保留「子树里有匹配」的。 */
function filterTree(node, needle) {
  const hitNotes = node.notes.filter((note) => {
    const hay = [note.title, note.path, note.excerpt, ...(note.tags || [])].join(' ').toLowerCase()
    return hay.includes(needle)
  })
  const kids = [...node.children.values()]
    .map((kid) => filterTree(kid, needle))
    .filter((kid) => kid.notes.length || kid.children.size)
  return { name: node.name, full: node.full, children: new Map(kids.map((kid) => [kid.name, kid])), notes: hitNotes, count: hitNotes.length + kids.reduce((sum, kid) => sum + kid.count, 0) }
}

function treeNoteRow(note, activePath) {
  return `<button class="nav-row note${note.path === activePath ? ' on' : ''}" data-ref-path="${esc(note.path)}" title="${esc(note.path)}">
      <span class="tag-name">${esc(note.title)}</span>
      <span class="nav-count">${note.chars}</span>
    </button>`
}

function renderTreeBranch(node, { activeTag = '', activePath = '', q = '' } = {}, depth = 0) {
  const kids = [...node.children.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  const on = activeTag && node.full === activeTag ? ' on' : ''
  const row = `<button class="nav-row tag${on}" data-ref-tag="${esc(node.full)}">
      <span class="tag-name">${esc(node.name)}</span>
      <span class="nav-count">${node.count}</span>
    </button>`
  const noteRows = node.notes.map((note) => treeNoteRow(note, activePath)).join('')
  if (!kids.length) {
    if (!noteRows) return `<div class="tag-leaf" style="--depth:${depth}">${row}</div>`
    // 叶子标签挂着笔记：可折叠，点开就在正下方（OS-53）
    const open = (activeTag && activeTag.startsWith(node.full)) || q ? ' open' : ''
    return `<details class="tag-branch"${open} style="--depth:${depth}"><summary>${row}<span class="tw-chev" aria-hidden="true"></span></summary>${noteRows}</details>`
  }
  // 展开推导：activeTag 在本子树内 → 祖先链自动展开；搜索态全展开；顶层默认展开
  const open = (activeTag && activeTag.startsWith(node.full)) || q ? ' open' : ''
  return `<details class="tag-branch"${open} style="--depth:${depth}"><summary>${row}<span class="tw-chev" aria-hidden="true"></span></summary>${kids.map((kid) => renderTreeBranch(kid, { activeTag, activePath, q }, depth + 1)).join('')}${noteRows}</details>`
}

/** 目录树整块（搜索时只重渲这个容器，输入框不丢焦点）。 */
export function refTreeHtml({ notes, tags = [], activeTag = '', activePath = '', q = '' } = {}) {
  const needle = text(q).trim().toLowerCase()
  let tree = buildRefTree(notes)
  if (needle) tree = filterTree(tree, needle)
  const branches = [...tree.children.values()].sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))
  const body = branches.map((kid) => renderTreeBranch(kid, { activeTag, activePath, q })).join('')
  const untagged = !needle && tree.notes.length
    ? `<div class="nav-group-label">未打标签</div>${tree.notes.map((note) => treeNoteRow(note, activePath)).join('')}`
    : ''
  if (!body && !untagged) {
    return needle
      ? '<p class="nav-empty">没有匹配的笔记或标签。</p>'
      : '<p class="nav-empty">还没有参考笔记。<br>点右上「新建笔记」开始。</p>'
  }
  return `${body}${untagged}`
}

export function refNavHtml({ tags = [], notes, activeTag = '', activePath = '', view = 'graph', q = '' } = {}) {
  const views = [
    ['note', '笔记'],
    ['graph', '关系图谱']
  ]
  const viewRows = views.map(([id, label]) =>
    `<button class="nav-row view${view === id ? ' on' : ''}" data-ref-view="${esc(id)}"><span>${esc(label)}</span></button>`
  ).join('')
  const tree = refTreeHtml({ notes, tags, activeTag, activePath, q })
  return `<div class="ref-nav">
    <input class="search" id="ref-search" type="search" placeholder="过滤目录…" value="${esc(q)}">
    <div class="nav-group"><div class="nav-group-label">视图</div>${viewRows}</div>
    <div class="nav-group grow"><div class="nav-group-label">目录</div><div id="ref-tree">${tree}</div></div>
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

/** 笔记视图未选中态（OS-53b）：给两条出路而不是一句提示。 */
function refMainEmptyHtml() {
  return `<div class="ref-empty-lead">
    <p class="rem">在左侧目录点一篇笔记开始；或回到</p>
    <button class="btn-primary" data-ref-view="graph">关系图谱（全库全景）</button>
  </div>`
}

/**
 * 参考页整体骨架（OS-51）：侧栏导航 + 主区全宽（反链并入详情页底部，不再占独立列）。
 * mainHtml 由调用方按 view 给：笔记视图传详情页整块，图谱视图传大画布块。
 */
export function referenceShellHtml({ notes, tags, activeTag, activePath, view = 'graph', q = '', mainHtml = '', stats, absorbable = 0 }) {
  const statsLine = stats
    ? `<span class="count">${stats.notes} 篇 · ${stats.tags} 个标签 · ${stats.links} 条链接</span>`
    : ''
  const nav = refNavHtml({ tags, notes, activeTag, activePath, view, q })
  return `<div class="ref-page">
    <div class="ref-toolbar">
      <h1>世界书</h1>
      ${statsLine}
      <span class="sp"></span>
      ${absorbable > 0 ? `<button class="btn-ghost" data-action="ref-absorb">迁入旧目录（${absorbable} 篇）</button>` : ''}
      <button class="btn-ghost" data-action="ref-new-note">＋ 新建笔记</button>
      <button class="btn-ghost" data-action="ref-new-tag">＋ 新建标签</button>
    </div>
    <div class="ref-grid">
      <aside class="ref-sidenav">${nav}</aside>
      <div class="ref-main">${mainHtml || refMainEmptyHtml()}</div>
    </div>
  </div>`
}
