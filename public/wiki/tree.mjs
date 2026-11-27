/**
 * 中性 wiki 树模型（OS-225）。
 * 纯函数：只认 item id/title/tags/path/excerpt/chars；作品专属策略由 adapter 注入。
 */
function text(value) { return String(value ?? '') }
function list(value) { return Array.isArray(value) ? value : [] }

export function buildWikiTagTree(tags, { separator = '/' } = {}) {
  const root = { name: '', full: '', children: new Map(), count: 0, description: '', color: '' }
  for (const tag of list(tags)) {
    const parts = text(tag?.name).split(separator).filter(Boolean)
    if (!parts.length) continue
    let node = root
    let prefix = ''
    for (const part of parts) {
      prefix = prefix ? `${prefix}${separator}${part}` : part
      if (!node.children.has(part)) {
        node.children.set(part, { name: part, full: prefix, children: new Map(), count: 0, description: '', color: '' })
      }
      node = node.children.get(part)
      node.count += Number(tag?.count) || 0
    }
    if (tag?.description) node.description = text(tag.description)
    if (tag?.color) node.color = text(tag.color)
  }
  return root
}

export function buildWikiDocumentTree(items, { separator = '/', include = () => true } = {}) {
  const root = { name: '', full: '', children: new Map(), items: [], count: 0 }
  const nodeAt = (tagPath) => {
    let node = root
    let prefix = ''
    for (const part of text(tagPath).split(separator).filter(Boolean)) {
      prefix = prefix ? `${prefix}${separator}${part}` : part
      if (!node.children.has(part)) node.children.set(part, { name: part, full: prefix, children: new Map(), items: [], count: 0 })
      node = node.children.get(part)
      node.count += 1
    }
    return node
  }
  for (const item of list(items)) {
    if (!include(item)) continue
    const tags = [...new Set(list(item?.tags).map(text).filter(Boolean))]
    if (!tags.length) {
      root.items.push(item)
      continue
    }
    const ends = new Set()
    for (const tag of tags) {
      const end = nodeAt(tag)
      if (!ends.has(end)) { end.items.push(item); ends.add(end) }
    }
  }
  root.count = root.items.length + [...root.children.values()].reduce((sum, node) => sum + node.count, 0)
  return root
}

export function filterWikiTree(node, query, { searchFields = ['title', 'path', 'excerpt', 'tags'] } = {}) {
  const needle = text(query).trim().toLowerCase()
  if (!needle) return node
  const hitItems = list(node.items).filter((item) => {
    const hay = searchFields.map((field) => {
      const value = item?.[field]
      return Array.isArray(value) ? value.join(' ') : text(value)
    }).join(' ').toLowerCase()
    return hay.includes(needle)
  })
  const children = [...node.children.values()]
    .map((child) => filterWikiTree(child, query, { searchFields }))
    .filter((child) => child.items.length || child.children.size)
  return {
    ...node,
    children: new Map(children.map((child) => [child.name, child])),
    items: hitItems,
    count: hitItems.length + children.reduce((sum, child) => sum + child.count, 0)
  }
}
