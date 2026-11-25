/**
 * OS-198：本机模块自带页面（iframe）的通用视图。
 *
 * 页面入口只由 `/api/plugins.slots` 投影给出；渲染本体在 views/，app.js 只接线。
 * 交互走同源 HTTP API：库路径放 query，页面自己按需调用。
 */
function pickPlacement(view, slots) {
  const [module, page, ...rest] = String(view ?? '').slice('module:'.length).split('/')
  if (!module || !page || rest.length) return null
  for (const items of Object.values(slots ?? {})) {
    for (const item of Array.isArray(items) ? items : []) {
      if (item?.module === module && item?.page === page && item?.view === 'iframe' && item?.entry) return item
    }
  }
  return null
}

function shortDigest(value) {
  const digest = String(value ?? '')
  return digest ? digest.slice(0, 12) : '—'
}

export function modulePageHtml(view, { slots = {}, modules = [], localModules = [], root = '', esc = (value) => String(value ?? '') } = {}) {
  const placement = pickPlacement(view, slots)
  if (!placement) {
    return `<div class="doc"><div class="empty">这个模块页面不在当前工作台清单里：${esc(view)}</div></div>`
  }
  const module = modules.find((item) => item.id === placement.module) ?? {}
  const local = localModules.find((item) => item.id === placement.module) ?? {}
  const entry = String(placement.entry).split('/').map((segment) => encodeURIComponent(segment)).join('/')
  const src = `/module-page/${encodeURIComponent(placement.module)}/${entry}?root=${encodeURIComponent(root)}`
  const title = placement.label || placement.page
  return `<div class="module-page" style="display:flex;flex-direction:column;height:100%;min-height:0">
    <div class="doc-head" style="display:flex;gap:var(--ui-gap-sm);align-items:baseline;flex-wrap:wrap;padding:var(--ui-row-py) var(--content-px);border-bottom:1px solid var(--line)">
      <h1 style="margin:0;font-size:var(--ui-fs-lg)">${esc(title)}</h1>
      <span class="hint">模块 ${esc(placement.module)} · 版本 ${esc(module.version || local.version || '—')} · 内容摘要 ${esc(shortDigest(local.contentSha256 || module.contentSha256))}</span>
    </div>
    <iframe title="${esc(title)}" src="${esc(src)}" style="flex:1;width:100%;border:0;background:var(--surface-card)"></iframe>
  </div>`
}