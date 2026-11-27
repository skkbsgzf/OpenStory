/** 中性 wiki HTML 呈现层（OS-225）。所有动作属性/标签/badge 由调用方注入。 */

function list(value) { return Array.isArray(value) ? value : [] }

export function escapeWikiHtml(value) {
  return String(value ?? '').replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]))
}

export function wikiActions(actions = {}, values = {}) {
  return Object.entries(actions).map(([key, attr]) => ` ${attr}="${escapeWikiHtml(values[key] ?? '')}"`).join('')
}

export function wikiTreeHtml({
  items = [], tags = [], activeId = '', activeTag = '', query = '',
  getId = (item) => item?.id ?? item?.path ?? '', getTitle = (item) => item?.title ?? item?.name ?? '',
  getPath = (item) => item?.path ?? item?.ref ?? '', getExcerpt = (item) => item?.excerpt ?? '',
  getTags = (item) => item?.tags ?? [], getCount = (item) => item?.chars ?? '',
  include = () => true, renderBadge = () => '', renderItem, renderTag,
  openAction = 'data-wiki-open', tagAction = 'data-wiki-tag', searchAction = 'data-wiki-search',
  emptyHtml = '<p class="nav-empty">这里还没有文档。</p>', untaggedLabel = '未打标签',
  buildTree, filterTree
}) {
  const tree = filterTree
    ? filterTree(buildTree(items.filter(include)), query)
    : buildWikiFallbackTree(items.filter(include), query, { getId, getTitle, getPath, getExcerpt, getTags })
  const renderRows = (nodes, depth = 0) => [...(nodes?.values?.() ?? list(nodes))].sort((a, b) => b.count - a.count || String(a.name).localeCompare(String(b.name), 'zh-Hans-CN')).map((node) => {
    const open = activeTag && (node.full === activeTag || activeTag.startsWith(`${node.full}/`)) || query
    const row = renderTag
      ? renderTag(node, { active: activeTag === node.full, open: Boolean(open), depth })
      : `<button class="nav-row tag${activeTag === node.full ? ' on' : ''}" ${tagAction}="${escapeWikiHtml(node.full)}"><span class="tag-name">${escapeWikiHtml(node.name)}</span><span class="nav-count">${node.count}</span></button>`
    const docs = list(node.items).map((item) => renderItem(item, { active: getId(item) === activeId, depth })).join('')
    const kids = renderRows(node.children, depth + 1)
    return `<details class="tag-branch${open ? ' open' : ''}" style="--depth:${depth}"><summary>${row}<span class="tw-chev" aria-hidden="true"></span></summary>${kids}${docs}</details>`
  }).join('')
  const roots = renderRows(tree.children)
  const untagged = list(tree.items).length
    ? `${untaggedLabel ? `<div class="nav-group-label">${escapeWikiHtml(untaggedLabel)}</div>` : ''}${list(tree.items).map((item) => renderItem(item, { active: getId(item) === activeId, depth: 0 })).join('')}`
    : ''
  if (!roots && !untagged) return query ? '<p class="nav-empty">没有匹配的文档或标签。</p>' : emptyHtml
  return `${roots}${untagged}`
}

function buildWikiFallbackTree(items, query, getters) {
  const needle = String(query ?? '').trim().toLowerCase()
  const filtered = needle ? items.filter((item) => [getters.getTitle(item), getters.getPath(item), getters.getExcerpt(item), ...(Array.isArray(getters.getTags(item)) ? getters.getTags(item) : [])].join(' ').toLowerCase().includes(needle)) : items
  const root = { name: '', full: '', children: new Map(), items: [], count: 0 }
  for (const item of filtered) {
    const tags = [...new Set((Array.isArray(getters.getTags(item)) ? getters.getTags(item) : []).map(String).filter(Boolean))]
    if (!tags.length) { root.items.push(item); continue }
    for (const tag of tags) {
      let node = root
      let full = ''
      for (const part of tag.split('/').filter(Boolean)) {
        full = full ? `${full}/${part}` : part
        if (!node.children.has(part)) node.children.set(part, { name: part, full, children: new Map(), items: [], count: 0 })
        node = node.children.get(part)
        node.count += 1
      }
      if (!node.items.some((entry) => getters.getId(entry) === getters.getId(item))) node.items.push(item)
    }
  }
  return root
}

export function wikiNavigationHtml({
  items = [], tags = [], activeId = '', activeTag = '', query = '', ...options
} = {}) {
  const openAction = options.openAction ?? 'data-wiki-open'
  const tagAction = options.tagAction ?? 'data-wiki-tag'
  const searchAttr = options.searchAction ?? 'data-wiki-search'
  const searchAction = searchAttr.includes(' ') ? searchAttr : `${searchAttr}=""`
  const getId = options.getId ?? ((item) => item?.id ?? item?.path ?? '')
  const getTitle = options.getTitle ?? ((item) => item?.title ?? item?.name ?? '')
  const getPath = options.getPath ?? ((item) => item?.path ?? item?.ref ?? '')
  const renderItem = options.renderItem ?? ((item, state) => `<button class="nav-row note${state.active ? ' on' : ''}" ${openAction}="${escapeWikiHtml(getId(item))}" title="${escapeWikiHtml(getPath(item))}"><span class="tag-name">${escapeWikiHtml(getTitle(item))}</span><span class="nav-count">${escapeWikiHtml(item?.chars ?? '')}</span></button>`)
  const tree = wikiTreeHtml({
    ...options, items, tags, activeId, activeTag, query,
    getId, getTitle, getPath, renderItem, openAction, tagAction
  })
  return `<div class="wiki-nav"><input class="search" ${searchAction} value="${escapeWikiHtml(query)}"><div class="nav-group grow">${tree}</div></div>`
}

export function wikiDetailHtml({
  id = '', title = '', subtitleHtml = '', badgesHtml = '', actionsHtml = '',
  summaryHtml = '', bodyHtml = '', tags = [], sideHtml = '', backlinksHtml = '',
  getTagAction = () => '', emptyHtml = '<p class="ds-empty">选择一篇文档开始。</p>'
}) {
  if (!id && !title) return emptyHtml
  const chips = tags.map((tag) => `<button class="pill tag-pick" ${getTagAction(tag)}>#${escapeWikiHtml(tag)}</button>`).join('')
  return `<div class="wiki-detail"><div class="wiki-detail-head"><h1 class="wiki-title">${escapeWikiHtml(title)}</h1>${subtitleHtml}${badgesHtml}<span class="sp"></span>${actionsHtml}</div><div class="wiki-flow">${sideHtml ? `<aside class="wiki-side">${sideHtml}</aside>` : ''}<div class="wiki-content">${chips ? `<div class="brief-tags">${chips}</div>` : ''}${summaryHtml ? `<p class="brief-text">${summaryHtml}</p>` : ''}<div class="wiki-doc">${bodyHtml}</div>${backlinksHtml}</div></div></div>`
}

export function wikiBacklinksHtml({
  linked = [], unlinked = [], getId = (item) => item?.id ?? item?.path ?? item?.ref ?? '',
  getTitle = (item) => item?.title ?? '', getExcerpt = (item) => item?.excerpt ?? '',
  openAction = 'data-wiki-open', linkedTitle = '已链接', unlinkedTitle = '未链接'
}) {
  const block = (label, items, cls) => `<section class="bl-sec ${cls}"><h5>${escapeWikiHtml(label)} <span class="count">${items.length}</span></h5>${items.length ? items.map((item) => `<button class="bl-row" ${openAction}="${escapeWikiHtml(getId(item))}" title="${escapeWikiHtml(getExcerpt(item))}"><b>${escapeWikiHtml(getTitle(item))}</b><span>${escapeWikiHtml(getExcerpt(item))}</span></button>`).join('') : '<p class="empty">没有</p>'}</section>`
  return block(linkedTitle, linked, 'linked') + block(unlinkedTitle, unlinked, 'unlinked')
}

export function wikiGraphViewHtml({
  graph = null, graphError = '', loading = false, focusId = '', tags = [], tagFilter = '',
  kindLabels = {}, tagNodeId = (tag) => `tag:${tag}`, canvasId = 'wiki-graph-canvas',
  filterAction = 'data-wiki-filter', nodeCardHtml = '', emptyHtml = '<div class="empty">没有节点。</div>'
}) {
  if (graphError) return `<div class="error-box">${escapeWikiHtml(graphError)}</div>`
  if (loading || !graph) return '<div class="loading">正在构图…</div>'
  if (!(graph.nodes || []).length) return emptyHtml
  const byKind = graph.stats?.byKind ?? {}
  const legend = Object.entries(kindLabels).filter(([kind]) => byKind[kind]).map(([kind, item]) => `<span><i style="background:${escapeWikiHtml(item.color ?? 'var(--meta)')}"></i>${escapeWikiHtml(item.label ?? kind)}</span>`).join('')
  const focus = (graph.nodes || []).find((node) => node.id === focusId)
  const filterBar = tags.length ? `<div class="wiki-graph-tagbar"><button class="chart-tab${tagFilter ? '' : ' on'}" ${filterAction}="">全部</button>${tags.slice(0, 10).map((tag) => `<button class="chart-tab${tagFilter === tag.name ? ' on' : ''}" ${filterAction}="${escapeWikiHtml(tag.name)}">#${escapeWikiHtml(tag.name)} ${tag.count ?? ''}</button>`).join('')}</div>` : ''
  return `<div class="wiki-graph"><div class="wiki-graph-meta">${graph.stats?.nodes ?? graph.nodes.length} 个节点 · ${graph.stats?.edges ?? graph.edges.length} 条边${focus ? ` · 聚焦「${escapeWikiHtml(focus.label || focus.id)}」` : ''}</div>${filterBar}<div class="graph-box big" id="${escapeWikiHtml(canvasId)}-box"><canvas id="${escapeWikiHtml(canvasId)}"></canvas>${nodeCardHtml}</div><div class="graph-legend">${legend || '<span>没有节点</span>'}</div></div>`
}

export function wikiNodeCardHtml(node, {
  edges = [], kindLabels = {}, openAction = 'data-wiki-open', tagAction = 'data-wiki-tag', variant = ''
} = {}) {
  const degree = edges.filter((edge) => edge.a === node?.id || edge.b === node?.id).length
  const tags = Array.isArray(node?.tags) ? node.tags : []
  const kind = kindLabels[node?.kind]
  return `<div class="ref-node-card${variant ? ` ${escapeWikiHtml(variant)}` : ''}"><div class="rn-head"><span class="rn-kind">${escapeWikiHtml(kind?.label ?? node?.kind ?? '')}</span><b>${escapeWikiHtml(node?.label || node?.id)}</b></div>${tags.length ? `<div class="rn-tags">${tags.map((tag) => `<button class="pill tag-pick" ${tagAction}="${escapeWikiHtml(tag)}">#${escapeWikiHtml(tag)}</button>`).join('')}</div>` : ''}${node?.excerpt ? `<p class="rn-excerpt">${escapeWikiHtml(String(node.excerpt).slice(0, 90))}</p>` : ''}<div class="rn-ops"><span class="rn-deg">${degree} 条关联</span><span class="sp"></span><button class="btn-ghost" ${nodeOpenAttrs(node, openAction)}>打开详情 →</button></div></div>`
}

function nodeOpenAttrs(node, openAction) {
  const id = escapeWikiHtml(node?.id ?? '')
  return openAction.includes('=')
    ? openAction.replace(/=["'][^"']*["']$/u, `="${id}"`)
    : `${openAction}="${id}"`
}

export function wikiStateHtml({ loading = false, error = '', degraded = '', empty = '', kind = 'empty' } = {}) {
  if (loading) return '<div class="loading">正在读取…</div>'
  if (error) return `<div class="error-box">${escapeWikiHtml(error)}</div>`
  if (degraded) return `<div class="degraded-note">${escapeWikiHtml(degraded)}</div>`
  return empty ? `<div class="${escapeWikiHtml(kind)}">${escapeWikiHtml(empty)}</div>` : ''
}
