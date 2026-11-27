/** 独立知识库工作台纯视图（OS-227）；复用 OS-225 中性 wiki 层。 */
import {
  wikiBacklinksHtml, wikiDetailHtml, wikiGraphViewHtml, wikiNavigationHtml,
  wikiNodeCardHtml, wikiStateHtml
} from '../wiki/view.mjs'

const esc = (value) => String(value ?? '').replace(/[&<>"']/gu, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]))
const text = (value) => String(value ?? '')

function libraryPickerHtml(state) {
  return `<div class="kb-library-picker"><label>当前知识库<select data-action="kb-active-library">${(state.libraries || []).map((item) => `<option value="${esc(item.id)}"${item.id === state.activeLibraryId ? ' selected' : ''}>${esc(item.customization?.displayName || item.name)}${item.enabled ? '' : '（已停用）'}</option>`).join('')}</select></label><button class="btn-ghost" data-action="kb-register">登记已有目录</button><button class="btn-ghost" data-action="kb-create">新建空库</button></div>`
}

function registrationHtml(state) {
  if (!state.form) return ''
  const form = state.form
  return `<section class="kb-form"><h3>${form.kind === 'create' ? '新建空知识库' : '登记已有知识库'}</h3><label>库 id<input data-kb-field="id" value="${esc(form.id || '')}" placeholder="my-knowledge"></label><label>显示名<input data-kb-field="name" value="${esc(form.name || '')}"></label><label>源目录（绝对路径）<input data-kb-field="root" value="${esc(form.root || '')}"></label>${form.preview ? `<div class="kb-preview"><b>${esc(form.preview.preview.name)}</b><span>${form.preview.preview.documentCount} 篇文档 · revision ${esc(form.preview.preview.contentRevision.slice(0, 12))}</span></div>` : ''}<div class="kb-actions">${form.preview ? '<button class="btn-primary" data-action="kb-register-confirm">确认登记</button>' : '<button class="btn-primary" data-action="kb-preview">预览</button>'}${form.kind === 'create' ? '<button class="btn-primary" data-action="kb-create-confirm">创建</button>' : ''}<button class="btn-ghost" data-action="kb-form-cancel">取消</button></div></section>`
}

function customizationHtml(state) {
  const library = (state.libraries || []).find((item) => item.id === state.activeLibraryId)
  if (!library) return ''
  const value = library.customization || {}
  return `<section class="kb-customization"><h3>定制</h3><label>显示名<input data-kb-custom="displayName" value="${esc(value.displayName || '')}"></label><label>描述<input data-kb-custom="description" value="${esc(value.description || '')}"></label><label>topK<input type="number" min="1" max="50" data-kb-retrieval="topK" value="${value.retrieval?.topK ?? 6}"></label><label>minScore<input type="number" min="0" max="1" step="0.05" data-kb-retrieval="minScore" value="${value.retrieval?.minScore ?? 0.3}"></label><label>总字符预算<input type="number" min="1" data-kb-retrieval="budgetChars" value="${value.retrieval?.budgetChars ?? 6000}"></label><button class="btn-ghost" data-action="kb-custom-save">保存定制</button></section>`
}

function indexStatusHtml(state) {
  const status = state.indexStatus || 'never-indexed'
  const label = { 'never-indexed': '尚未索引', building: '构建中', fresh: '已就绪', stale: '已过期', failed: '失败' }[status] || status
  return `<section class="kb-index"><h3>索引状态</h3><span class="kb-status ${esc(status)}">${esc(label)}</span>${state.runtimeAvailable ? '' : '<p class="degraded-note">HyperGraphRAG runtime 未就绪：文档浏览仍可用，检索与同步明确降级。</p>'}<button class="btn-ghost" data-action="kb-sync"${state.runtimeAvailable && status !== 'building' ? '' : ' disabled'}>同步索引</button></section>`
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
    bodyHtml: state.documentLoading ? '<div class="loading">正在读取文档…</div>' : `<pre class="kb-document-text">${esc(selected.text || '')}</pre>`,
    backlinksHtml: wikiBacklinksHtml({ linked: backlinks.linked, unlinked: backlinks.unlinked, getId: (item) => item.ref }),
    emptyHtml: ''
  }) : wikiStateHtml({ empty: '从左侧选择一篇文档。', kind: 'empty' })
  const graph = state.view === 'graph' ? wikiGraphViewHtml({
    graph: state.graph, loading: state.graphLoading, error: state.graphError,
    kindLabels: { document: { label: '文档', color: 'var(--accent)' }, tag: { label: '标签', color: 'var(--warn)' } },
    tags: state.tags || [], canvasId: 'kb-graph-canvas', filterAction: 'data-kb-graph-tag',
    nodeCardHtml: state.picked ? wikiNodeCardHtml(state.picked, { edges: state.graph?.edges || [], kindLabels: { document: { label: '文档' }, tag: { label: '标签' } } }) : ''
  }) : ''
  const nav = wikiNavigationHtml({
    items: documents, activeId: state.activeRef || '', activeTag: state.activeTag || '', query: state.treeQuery || '',
    getId: (item) => item.ref, getTitle: (item) => item.title, getPath: (item) => item.ref,
    searchAction: 'data-kb-tree-query placeholder="过滤目录…"',
    renderItem: (item, { active }) => `<button class="nav-row note${active ? ' on' : ''}" data-action="kb-open-document" data-wiki-open="${esc(item.ref)}" title="${esc(item.ref)}"><span class="tag-name">${esc(item.title)}</span><span class="nav-count">${item.chars ?? ''}</span></button>`,
    renderBadge: () => ''
  })
  return `<div class="topic-workspace kb-workspace"><div class="topic-main"><header class="kb-toolbar"><h1>知识库</h1><span class="count">${documents.length} 篇文档</span><button class="btn-ghost${state.view === 'graph' ? ' on' : ''}" data-action="kb-view-graph">图谱</button><button class="btn-ghost" data-action="kb-toggle-enabled">${library.enabled ? '停用此库' : '启用此库'}</button><span class="sp"></span>${indexStatusHtml(state)}</header>${libraryPickerHtml(state)}${registrationHtml(state)}${searchHtml(state)}<div class="ref-grid"><aside class="ref-sidenav">${nav}</aside><div class="ref-main">${graph || detail}</div></div>${customizationHtml(state)}</div></div>`
}
