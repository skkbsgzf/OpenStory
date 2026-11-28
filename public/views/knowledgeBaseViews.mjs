/** 独立知识库工作台纯视图（OS-227）；复用 OS-225 中性 wiki 层。 */
import {
  wikiBacklinksHtml, wikiDetailHtml, wikiGraphViewHtml, wikiNavigationHtml,
  wikiNodeCardHtml, wikiStateHtml
} from '../wiki/view.mjs'
import { wikiMarkdownReaderHtml } from '../wiki/markdown.mjs'

/** 知识库源文档是纯 md（可能带 frontmatter）；详情只渲染正文，frontmatter 不外露。 */
function bodyWithoutFrontmatter(source) {
  const value = String(source ?? '')
  const match = value.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/u)
  return match ? value.slice(match[0].length) : value
}

const esc = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const text = (value) => String(value ?? '')

function libraryPickerHtml(state) {
  return `<div class="kb-library-picker"><label>当前知识库<select data-action="kb-active-library">${(state.libraries || []).map((item) => `<option value="${esc(item.id)}"${item.id === state.activeLibraryId ? ' selected' : ''}>${esc(item.customization?.displayName || item.name)}${item.enabled ? '' : '（已停用）'}</option>`).join('')}</select></label><button class="btn-ghost" data-action="kb-register">登记已有目录</button><button class="btn-ghost" data-action="kb-create">新建空库</button></div>`
}

function registrationHtml(state) {
  if (!state.form) return ''
  const form = state.form
  return `<section class="kb-form"><h3>${form.kind === 'create' ? '新建空知识库' : '登记已有知识库'}</h3><p class="kb-form-hint">${form.kind === 'create' ? '新建一个空目录当知识库源；之后可往里放 Markdown。' : '指向已有知识库源目录（含 knowledge.base.json）。先预览、核对无误再确认登记。'}</p><label>库 id<input data-kb-field="id" value="${esc(form.id || '')}" placeholder="my-knowledge"></label><label>显示名<input data-kb-field="name" value="${esc(form.name || '')}"></label><label>源目录（绝对路径）<input data-kb-field="root" value="${esc(form.root || '')}"></label>${state.formError ? `<div class="error-box">${esc(state.formError)}</div>` : ''}${form.preview ? `<div class="kb-preview"><b>${esc(form.preview.preview.name)}</b><span>${form.preview.preview.documentCount} 篇文档 · revision ${esc(form.preview.preview.contentRevision.slice(0, 12))}</span></div>` : ''}<div class="kb-actions">${form.preview ? '<button class="btn-primary" data-action="kb-register-confirm">确认登记</button>' : '<button class="btn-primary" data-action="kb-preview">预览</button>'}${form.kind === 'create' ? '<button class="btn-primary" data-action="kb-create-confirm">创建</button>' : ''}<button class="btn-ghost" data-action="kb-form-cancel">取消</button></div></section>`
}

function customizationHtml(state) {
  const library = (state.libraries || []).find((item) => item.id === state.activeLibraryId)
  if (!library) return ''
  const value = library.customization || {}
  // 默认收起：这三个检索参数绝大多数时候不用改，常驻展开会把正文挤下去。
  const open = state.customOpen === true
  const summary = `topK ${value.retrieval?.topK ?? 6} · minScore ${value.retrieval?.minScore ?? 0.3} · 预算 ${value.retrieval?.budgetChars ?? 6000}`
  const body = `<div class="kb-custom-body"><label>显示名<input data-kb-custom="displayName" value="${esc(value.displayName || '')}"></label><label>描述<input data-kb-custom="description" value="${esc(value.description || '')}"></label><label>topK<input type="number" min="1" max="50" data-kb-retrieval="topK" value="${value.retrieval?.topK ?? 6}"></label><label>minScore<input type="number" min="0" max="1" step="0.05" data-kb-retrieval="minScore" value="${value.retrieval?.minScore ?? 0.3}"></label><label>总字符预算<input type="number" min="1" data-kb-retrieval="budgetChars" value="${value.retrieval?.budgetChars ?? 6000}"></label><button class="btn-ghost" data-action="kb-custom-save">保存定制</button></div>`
  return `<details class="kb-customization"${open ? ' open' : ''}><summary><h3>定制</h3><span class="kb-custom-hint">${esc(summary)}</span></summary>${body}</details>`
}

function indexStatusHtml(state) {
  const status = state.indexStatus || 'never-indexed'
  const label = { 'never-indexed': '尚未索引', building: '构建中', fresh: '已就绪', stale: '已过期', failed: '失败' }[status] || status
  // 状态要能自解释：为什么过期、点了会发生什么，别只丢一个词让作者猜。
  const why = {
    'never-indexed': '还从没建过语义索引——只影响语义检索，文档浏览不受影响。',
    building: '正在建索引，长任务，可先浏览文档。',
    fresh: '索引与当前内容版本一致。',
    stale: '库里的文档改过，索引还是旧版本——需要重新同步才能按新内容检索。',
    failed: '上次建索引失败，详情见任务中心；可重试同步。'
  }[status] || ''
  const runtimeNote = state.runtimeAvailable ? '' : '<p class="degraded-note">检索运行时（HyperGraphRAG）未就绪：文档浏览照常，语义检索与同步会明确降级，不会返回假结果。</p>'
  return `<section class="kb-index"><h3>索引状态</h3><span class="kb-status ${esc(status)}">${esc(label)}</span>${why ? `<span class="kb-index-why">${esc(why)}</span>` : ''}${runtimeNote}<button class="btn-ghost" data-action="kb-sync"${state.runtimeAvailable && status !== 'building' ? '' : ' disabled'}>同步索引</button></section>`
}

function searchHtml(state) {
  return `<section class="kb-search"><input type="search" data-kb-query placeholder="搜索知识库…" value="${esc(state.query || '')}"><button class="btn-primary" data-action="kb-search">搜索</button></section>${state.searchError ? `<div class="error-box">${esc(state.searchError)}</div>` : ''}${state.searching ? '<div class="loading">正在检索…</div>' : (state.hits || []).map((hit) => `<article class="kb-hit"><b>${esc(hit.title || hit.ref)}</b><span>${esc(hit.ref)} · ${Number(hit.score || 0).toFixed(3)}</span><p>${esc(hit.text)}</p></article>`).join('')}`
}

export function knowledgeBaseHtml(state = {}) {
  // 首次加载也先出工作台外壳：入口/测试等的是「知识库主区」，不是某一次请求的完成时刻。
  if (state.loading && !state.loaded) return '<div class="topic-workspace kb-workspace"><div class="topic-main"><div class="loading">正在读取知识库…</div></div></div>'
  if (state.error) return `<div class="topic-workspace kb-workspace"><div class="topic-main"><div class="error-box">${esc(state.error)}</div></div></div>`
  const library = (state.libraries || []).find((item) => item.id === state.activeLibraryId)
  if (!library) return `<div class="topic-workspace"><div class="topic-main">${wikiStateHtml({ empty: '还没有知识库。登记一个已有目录，或新建空库。', kind: 'empty' })}${registrationHtml(state)}</div></div>`
  const documents = state.documents || []
  const selected = documents.find((item) => item.ref === state.activeRef)
  const backlinks = state.backlinks || { linked: [], unlinked: [] }
  const detail = selected ? wikiDetailHtml({
    id: selected.ref, title: selected.title,
    subtitleHtml: `<span class="wiki-path">${esc(selected.ref)} · ${selected.chars} 字</span>`,
    tags: selected.tags || [], getTagAction: (tag) => `data-kb-tag="${esc(tag)}"`,
    bodyHtml: state.documentLoading ? '<div class="loading">正在读取文档…</div>' : wikiMarkdownReaderHtml(bodyWithoutFrontmatter(selected.text), { md: state.md }),
    backlinksHtml: wikiBacklinksHtml({ linked: backlinks.linked, unlinked: backlinks.unlinked, getId: (item) => item.ref }),
    emptyHtml: ''
  }) : wikiStateHtml({ empty: '从左侧选择一篇文档。', kind: 'empty' })
  const graph = state.view === 'graph' ? wikiGraphViewHtml({
    graph: state.graph, loading: state.graphLoading, error: state.graphError,
    kindLabels: { document: { label: '文档', color: 'var(--accent)' }, tag: { label: '标签', color: 'var(--warn)' } },
    tags: state.tags || [], canvasId: 'kb-graph-canvas', filterAction: 'data-kb-graph-tag',
    nodeCardHtml: state.picked ? wikiNodeCardHtml(state.picked, { edges: state.graph?.edges || [], kindLabels: { document: { label: '文档' }, tag: { label: '标签' } } }) : ''
  }) : ''
  // 目录树：知识库文档常常「一个文档一个标签、标签名又等于标题」，走通用标签树会出现
  // 「干扰项 1」下面又是「干扰项 75」这种同名两行。这里标签只当分组标题，文档行显示
  // 标题（frontmatter 的 title，退回文件名），中文语义优先，不再重复渲染同名条目。
  const seenDoc = new Set()
  const docLabel = (item) => {
    const title = String(item.title || '').trim()
    if (title) return title
    const name = String(item.ref || '').split('/').pop() || ''
    return name.replace(/\.md$/iu, '')
  }
  // 一篇文章挂多个标签时，标签树里会重复出现在多个分组；同一文档只渲染第一次，
  // 否则左栏同一篇出现两三次，作者点哪个都一样，纯噪声。
  const renderDocRow = (item, { active }) => {
    if (seenDoc.has(item.ref)) return ''
    seenDoc.add(item.ref)
    return `<button class="nav-row note${active ? ' on' : ''}" data-action="kb-open-document" data-wiki-open="${esc(item.ref)}" title="${esc(item.ref)}"><span class="tag-name">${esc(docLabel(item))}</span><span class="nav-count">${item.chars ?? ''}</span></button>`
  }
  const nav = wikiNavigationHtml({
    items: documents, activeId: state.activeRef || '', activeTag: state.activeTag || '', query: state.treeQuery || '',
    getId: (item) => item.ref, getTitle: docLabel, getPath: (item) => item.ref,
    searchAction: 'data-kb-tree-query placeholder="过滤目录…"',
    renderItem: renderDocRow,
    hideEmptyBranches: true, // 多标签去重后剩下的空标签组不显示
    renderBadge: () => ''
  })
  return `<div class="topic-workspace kb-workspace"><div class="topic-main"><header class="kb-toolbar"><h1>知识库</h1><span class="count">${documents.length} 篇文档</span><button class="btn-ghost${state.view === 'graph' ? ' on' : ''}" data-action="kb-view-graph">图谱</button><button class="btn-ghost" data-action="kb-toggle-enabled">${library.enabled ? '停用此库' : '启用此库'}</button><span class="sp"></span>${indexStatusHtml(state)}</header>${libraryPickerHtml(state)}${registrationHtml(state)}${searchHtml(state)}<div class="ref-grid"><aside class="ref-sidenav">${nav}</aside><div class="ref-main">${graph || detail}</div></div>${customizationHtml(state)}</div></div>`
}
