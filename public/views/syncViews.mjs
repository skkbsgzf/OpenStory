/** C6：从 public/app.js 逐字迁出的syncViews渲染面。副作用仍由 app.js 持有。 */
export function createSyncViews(scope) {
  const { state, esc, text, formatAt } = scope

function syncPromptHtml() {
  const sync = state.sync
  const prompt = sync?.prompt
  if (!prompt || prompt.root !== state.current?.path) return ''
  const first = prompt.problems[0]
  const more = prompt.problems.length > 1 ? `（另有 ${prompt.problems.length - 1} 项）` : ''
  return `<div class="sync-prompt">
    <span class="sync-prompt-ic">⟳</span>
    <span class="sync-prompt-body">
      <b>发现不同步</b>
      <span class="sync-prompt-why">${esc(first?.label || '派生档落后于事实源')}${esc(more)}</span>
    </span>
    <span class="sync-prompt-ops">
      <button class="btn-primary" data-action="sync-prompt-go"${sync.regenBusy ? ' disabled' : ''}>${sync.regenBusy ? '同步中…' : '立即同步'}</button>
      <button class="btn-ghost" data-action="sync-prompt-later">稍后</button>
    </span>
  </div>`
}

function syncLatestNoteAt() {
  const notes = state.reference?.notes
  if (!Array.isArray(notes) || !notes.length) return ''
  let newest = 0
  for (const note of notes) {
    const at = Date.parse(text(note?.mtime))
    if (Number.isFinite(at) && at > newest) newest = at
  }
  return newest ? new Date(newest).toISOString() : ''
}

function syncBarHtml() {
  // 状态条是附加信息：任何异形回包/SaaS 字段缺失都不许把世界书页和故事源页一起拖下水
  try {
    return syncBarHtmlUnsafe()
  } catch {
    return ''
  }
}

function syncBarHtmlUnsafe() {
  const sync = state.sync || {}
  const data = sync.data
  // 只认对象回包；字符串/数组这种异形响应当没有数据（否则会误报「同源一致」）
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    if (!sync.error) return ''
    return `<div class="sync-bar bad" title="${esc(sync.error)}">
      <span class="sync-dot"></span>
      <span class="sync-main">同源检查不可用</span>
      <button class="sync-btn" data-action="sync-recheck" title="再试一次：${esc(sync.error)}">重试</button>
    </div>`
  }
  const same = data.sameSource && typeof data.sameSource === 'object' ? data.sameSource : {}
  const external = data.external && typeof data.external === 'object' ? data.external : {}
  const current = Number(data.factRevision) || 0
  // wikiFactRevision 在「无派生档 / 读不出基准」时是 null——不能当 0 显示，那会谎报「基于 revision 0」
  const rawWikiRev = Number(same.wikiFactRevision)
  const wikiRevKnown = Number.isSafeInteger(rawWikiRev) && rawWikiRev >= 0
  const stale = same.wikiStale === true
  const changes = Array.isArray(external.externalChanges) ? external.externalChanges.filter(Boolean) : []
  const firstSeen = Array.isArray(external.firstSeen) ? external.firstSeen.filter(Boolean) : []

  const parts = []
  // OS-114：过期判定改用时间戳——作者看不懂「revision 差几版」，要看「谁比谁新」。
  const factAt = text(same.factAt || same.factMtime).trim()
  const wikiAt = text(same.wikiAt || same.wikiGeneratedAt).trim()
  if (stale) {
    // 后端 wikiNote 已经是完整人话（含两个时间），直接用它当主文案
    const why = text(same.wikiNote).trim()
    const main = why || `派生档生成于 ${wikiAt ? formatAt(wikiAt) : '未知'}，事实源改于 ${factAt ? formatAt(factAt) : '未知'}——建议重新生成`
    parts.push(`<span class="sync-main">${esc(main)}</span>
      <button class="sync-btn" data-action="sync-regen-wiki"${sync.regenBusy ? ' disabled' : ''} title="重新生成走 enrich（设置里配了模型才可用）">${sync.regenBusy ? '提交中…' : '重新生成'}</button>`)
  }
  if (changes.length) {
    const shown = changes.slice(0, 40)
    const rows = shown.map((item) => {
      const path = typeof item === 'string' ? item : text(item?.path || item?.file || '')
      const reason = typeof item === 'string' ? '' : text(item?.reason || '')
      return `<li><span class="sync-path">${esc(path)}</span>${reason ? `<span class="sync-reason">${esc(reason)}</span>` : ''}</li>`
    }).join('')
    const rest = changes.length > shown.length
      ? `<li><span class="sync-reason">还有 ${changes.length - shown.length} 处未列出</span></li>`
      : ''
    // 展开态存在 state.sync 上：render() 整块换 innerHTML，原生的 <details> open 会被冲掉
    parts.push(`<span class="sync-main">检测到 ${changes.length} 处未经写通道的改动</span>
      <button class="sync-btn" data-action="sync-toggle-list">${sync.openList ? '收起列表' : '展开列表'}</button>
      ${sync.openList ? `<ul class="sync-list">${rows}${rest}</ul>` : ''}`)
  }
  if (!parts.length) {
    const stamp = factAt ? `事实源 ${formatAt(factAt)}` : ''
    const wikiStamp = wikiAt ? `派生档 ${formatAt(wikiAt)}` : ''
    parts.push(`<span class="sync-main">同源一致${stamp ? ` · ${esc(stamp)}` : ''}${wikiStamp ? ` · ${esc(wikiStamp)}` : ''}</span>`)
  }

  const metas = []
  // 世界书笔记最新更新时间：后端 sameSource.refsMtimeMax 是**ISO 时间串**（不是「几篇更新」的计数）。
  // 两种键名都读：接口草稿里叫 refsNewerThan，落地实现叫 refsMtimeMax。
  // 都没有时退回前端扫 state.reference.notes 的 mtime；再没有就不显示。
  const refsRaw = text(same.refsMtimeMax || same.refsNewerThan).trim()
  const refAt = /^\d{4}-\d{2}-\d{2}T/u.test(refsRaw) ? refsRaw : syncLatestNoteAt()
  if (refAt) metas.push(`世界书笔记最近更新 ${esc(formatAt(refAt))}`)
  if (firstSeen.length) metas.push(`另有 ${firstSeen.length} 处首次发现`)
  // OS-114：正文比事实源新——故事源可能没跟上（提示，不判错）
  if (same.chaptersNewerThanFact === true && text(same.chaptersNote).trim()) {
    metas.push(esc(text(same.chaptersNote).trim()))
  }
  const checkedAt = text(external.checkedAt).trim()
  if (checkedAt) metas.push(`核对于 ${esc(formatAt(checkedAt))}`)
  if (sync.error) metas.push('本次刷新失败，显示上次结果')

  const cls = changes.length ? 'bad' : (stale ? 'warn' : 'ok')
  return `<div class="sync-bar ${cls}">
    <span class="sync-dot"></span>
    ${parts.join('<span class="sync-sep">·</span>')}
    ${metas.length ? `<span class="sync-meta">${metas.join(' · ')}</span>` : ''}
    ${sync.notice ? `<span class="sync-notice">${esc(sync.notice)}</span>` : ''}
  </div>`
}

  return { syncPromptHtml, syncLatestNoteAt, syncBarHtml, syncBarHtmlUnsafe }
}
