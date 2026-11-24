/**
 * 剧本工作面纯 HTML 构造函数（OS-163，G5c）——从 app.js 迁出的纯函数。
 *
 * 硬约束（与 workbenchViews.mjs / registry.mjs 同门风）：
 *   · 纯函数：入参进、HTML 字符串出；不读全局 state、不碰 DOM、不写存储、不 import 任何模块
 *     （esc / text / formatBytes / formatAt / refModulesHtml / flowError 全部由调用方注入）；
 *   · app.js 只保留薄壳（取数＋转交），视图本体只出不进（AGENTS.md 第 20 条增量冻结）。
 *
 * scriptToFactFlow 因读 state、调 api、操作 DOM 与起异步流程，按工单留在 app.js。
 *
 * 每个函数配金样测试（test/scriptViews.test.mjs）：固定夹具 → 固定 HTML。
 */

/** 剧本设置项规范化：缺省开（autoFormat / castColors）。原 app.js 的 scriptPrefs() 读 ui-state 后转交这里。 */
export function scriptPrefsFrom(raw) {
  return {
    autoFormat: raw?.autoFormat !== false,
    castColors: raw?.castColors !== false
  }
}

/** 剧本块 HTML → 剧本文本（OS-76：与 blockHtmlToMd 同职责，但保留剧本标记）。
 * 按 data-sc-kind 重建：幕 `# 标题`、场景 `*〔…〕*`、台词 `**名**（提示）：说白`。
 * @param {object} blockEl 块元素（由宿主 querySelector 取得）
 * @param {{text:Function}} tools text() HTML→纯文本，由调用方注入
 */
export function scriptBlockToRaw(blockEl, { text } = {}) {
  const asText = text ?? ((value) => String(value ?? ''))
  // data-sc-kind 渲染在内层块（.sc-line/.sc-act/…）上，不在 doc-block 外层——
  // 先读外层（兼容），再从内层找；两处都没有才算 action。
  const inner = blockEl.querySelector('[data-sc-kind]')
  const kind = blockEl.dataset.scKind || inner?.dataset.scKind || ''
  const raw = blockEl.dataset.raw || ''
  // contenteditable 里 innerText 会受浏览器排版影响；优先用 textContent（不含渲染空白差异）
  const plain = (el) => asText(el?.textContent ?? '').replace(/\s+/gu, ' ').trim()
  if (kind === 'act') return `# ${plain(blockEl) || raw.replace(/^#\s+/u, '')}`
  if (kind === 'stage') return `*〔${plain(blockEl) || raw.replace(/^\*?[〔【\[]/u, '').replace(/[〕】\]]\*?$/u, '')}〕*`
  if (kind === 'line') {
    const who = plain(blockEl.querySelector('.sc-who'))
    const hint = plain(blockEl.querySelector('.sc-hint')).replace(/^[（(]|[）)]$/gu, '')
    const said = plain(blockEl.querySelector('.sc-said'))
    // 结构被浏览器重组（span 丢了）时，用 data-raw 反解出 who/hint 兜底
    if (who && said !== undefined) return `**${who}**${hint ? `（${hint}）` : ''}：${said}`
    if (raw) {
      const m = /^\*\*([^*]+)\*\*\s*(?:[（(]([^）)]*)[）)])?\s*[:：]\s*([\s\S]*)$/u.exec(raw)
      if (m) return `**${m[1].trim()}**${m[2] ? `（${m[2].trim()}）` : ''}：${plain(blockEl) || m[3]}`
    }
    return plain(blockEl)
  }
  return plain(blockEl) || raw
}

/** 剧本出场人物卡：从角色台词里统计谁说了多少句。
 * @param {object} ctx { blocks, esc } blocks 为 splitScriptBlocks 的结果（宿主取数）
 */
export function scriptCastHtml({ blocks, esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const lines = (Array.isArray(blocks) ? blocks : []).filter((b) => b.kind === 'line' && b.who)
  const counts = new Map()
  for (const b of lines) counts.set(b.who, (counts.get(b.who) || 0) + 1)
  if (!counts.size) return '<div class="nav-empty">还没有台词</div>'
  return [...counts.entries()].sort((a, b) => b[1] - a[1])
    .map(([who, n]) => `<div class="cast-row"><span class="cast-name">${html(who)}</span><span class="cast-n">${n} 句</span></div>`).join('')
}

/** 剧本页（OS-75）：与小说同构的「逐块实时编辑」，但按剧本格式渲染。
 * 数据通道不变（/api/files + /api/chapter）——剧本就是 剧本/NNN-标题.md。
 * @param {object} ctx 宿主取数后的全部入参，纯函数不读 state / DOM
 */
export function scriptViewHtml({
  currentName, dir = '剧本', label = dir, work = {}, stats = null, body = '',
  modules = [], refModulesHtml, flowError,
  esc, formatAt, formatBytes, analysisOn = true
} = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const bytes = formatBytes ?? ((value) => String(value ?? ''))
  const stamp = formatAt ?? ((value) => String(value ?? ''))
  const sc = work.loaded && stats ? stats(work.text) : null
  const meta = sc
    ? `<span class="b">${sc.acts} 幕</span><span class="docline-sep">·</span><span>${sc.scenes} 场</span><span class="docline-sep">·</span><span>${sc.lines} 句台词</span><span class="docline-sep">·</span><span id="dir-chars">${sc.chars} 字</span>${sc.cast.length ? `<span class="docline-sep">·</span><span class="count">出场：${html(sc.cast.join('、'))}</span>` : ''}`
    : `<span id="dir-chars">${(work.text || '').length} 字</span>`
  // OS-76：与正文页同构——逐块 contenteditable + data-start/end/raw 偏移，
  // 保存走同一套 commitDocBlock（只是渲染器换成剧本版式）。
  // 文件列表像正文页章节列表一样放左栏，不再占顶部横栏。
  const content = work.loaded
    ? body
    : `<div class="empty-state"><h2>${html(label)}</h2><p>还没有剧本——左侧新建一个，或选已有文件。</p></div>`
  const fileRows = (work.files || []).map((item) => `<button class="ch-row${item.file === work.file ? ' on' : ''}" data-dirfile-pick="${html(item.file)}" title="${html(item.file)}">
      <span class="no">${html(String(item.name || '').slice(0, 2))}</span>
      <span class="tt">${html(String(item.name || '').replace(/\.md$/u, ''))}</span>
      <span class="sz">${bytes(item.size)}</span>
    </button>`).join('')
  const aside = refModulesHtml
    ? refModulesHtml({ modules, prepend: `<section class="ref-mod">
        <div class="ref-mod-head"><span class="rm-toggle">剧本<span class="count">${(work.files || []).length}</span></span></div>
        <div class="sc-file-list">
          ${fileRows || '<div class="nav-empty">还没有剧本</div>'}
          <div class="sc-new-row">
            <input class="file-input" id="dirfile-new-name" placeholder="新剧本.md" value="">
            <button class="btn-ghost" data-action="dirfile-new">新建</button>
          </div>
        </div>
      </section>` })
    : ''
  return `<div class="doc-workspace doc-workspace-sticky">
    <header class="doc-head doc-head-immersive">
      <div class="docline">
        <span class="kick">${html(currentName)}</span>
        <span class="docline-sep">·</span>
        <span class="chap-no">${html(label)}</span>
        <span class="docline-sep">·</span>
        ${meta}
        <span class="sp"></span>
        <span class="doc-autosave" id="doc-autosave"></span>
        <button class="doc-drawer-btn" data-action="refcol-toggle" title="左侧栏（文件/人物/图谱）" aria-label="左侧栏">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><rect x="2.5" y="2.5" width="11" height="11" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M2.5 6h11M2.5 10h11" stroke="currentColor" stroke-width="1.4"/></svg>
        </button>
        <button class="doc-drawer-btn" data-action="analyze-toggle" title="分析本剧" aria-label="分析"${analysisOn ? '' : ' hidden'}><svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="8" cy="8" r="5.4" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M8 2.6A5.4 5.4 0 0 1 13.4 8H8z" fill="currentColor"/></svg></button>
        <button class="doc-icon" data-action="script-more" title="剧本设置（自动排版 / 角色配色 / 互转）" aria-label="剧本设置">
          <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="3.4" cy="8" r="1.35" fill="currentColor"/><circle cx="8" cy="8" r="1.35" fill="currentColor"/><circle cx="12.6" cy="8" r="1.35" fill="currentColor"/></svg>
        </button>
      </div>
      <div class="doc-title-row">
        <h1 class="doc-title">${html(work.file ? work.file.split('/').pop().replace(/\.md$/u, '') : label)}</h1>
        ${work.savedAt ? `<span class="saved-chip">已保存 · ${stamp(work.savedAt)}</span>` : ''}
      </div>
    </header>
    <div class="chapter-grid">
    <aside class="ref-col sc-side" id="ref-col">
      ${aside}
    </aside>
      ${flowError ? flowError(work.error) : ''}
      <div class="doc-scroll" id="doc-scroll">
        <div class="chapter-editor-col">${work.loading && !work.loaded ? '<div class="loading">正在读取…</div>' : content}</div>
      </div>
      <aside class="analyze-panel" id="analyze-panel"></aside>
    </div>
  </div>`
}
