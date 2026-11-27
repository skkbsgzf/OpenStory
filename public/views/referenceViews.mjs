/**
 * 世界书工作面纯 HTML 构造函数（OS-164，G5c）——从 app.js 迁出的纯函数。
 *
 * 硬约束（与 scriptViews.mjs / workbenchViews.mjs 同门风）：
 *   · 纯函数：入参进、HTML 字符串出；不读全局 state、不碰 DOM、不写存储、不 import 任何模块
 *     （esc / text / 子视图 / 依赖模块结果全部由调用方注入）；
 *   · app.js 只保留薄壳（取数、装载判定、同源检查等副作用留宿主）。
 *
 * 金样与纯度测试：test/referenceViews.test.mjs。
 */

import {
  wikiBacklinksHtml, wikiDetailHtml, wikiGraphViewHtml, wikiNodeCardHtml
} from '../wiki/view.mjs'

/** 世界书 fact 详情 adapter：字段与只读策略仍归世界书。 */
export function referenceEntryDetailHtml(entryId, factEntries, { esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const entry = (Array.isArray(factEntries) ? factEntries : []).find((item) => String(item?.id ?? '') === String(entryId))
  if (!entry) {
    return `<div class="ref-detail"><div class="ref-detail-head"><h1 class="ref-title">词条不存在</h1></div>
      <p class="ds-empty">这条故事源词条可能已被移除或改过 id——点左侧其他词条看看。</p></div>`
  }
  const LAYER_LABEL = { worldview: '世界观', character: '角色', plot: '剧情', location: '地点', item: '道具', scene: '场景', term: '术语' }
  const layer = String(entry.layer ?? '').toLowerCase()
  const fc = Number(entry.firstChapter)
  const firstChapter = Number.isFinite(fc) && fc >= 0 ? fc : (Array.isArray(entry.chapters) && entry.chapters.length ? Math.min(...entry.chapters.filter(Number.isInteger)) : 0)
  const relations = Array.isArray(entry.relations) ? entry.relations : []
  const anchors = entry.anchors && typeof entry.anchors === 'object' ? entry.anchors : null
  const speech = anchors && Array.isArray(anchors.speech) ? anchors.speech.filter(Boolean) : []
  return wikiDetailHtml({
    id: entry.id,
    title: String(entry.name || '（无名）'),
    subtitleHtml: `<span class="ref-detail-path">故事源词条 · ${html(LAYER_LABEL[layer] || layer || '未分层')}</span>`,
    badgesHtml: `<span class="fc-badge${firstChapter > 0 ? '' : ' fc-base'}">${firstChapter > 0 ? `首次出现在第${firstChapter}章` : '原生共识'}</span><span class="count">只读 · 来源 故事源/（改动请走世界书笔记或 enrich）</span>`,
    summaryHtml: entry.definition ? html(String(entry.definition)) : '<span class="ds-empty">这条词条还没有定义。</span>',
    sideHtml: `<div class="ref-graph-slot"><div class="ref-slot-head">关系图谱</div><div class="graph-box detail"><canvas id="ref-entry-canvas"></canvas></div></div>`,
    bodyHtml: `${entry.fact && entry.fact !== entry.definition ? `<div class="ref-doc"><p class="ds-line">${html(String(entry.fact))}</p></div>` : ''}${speech.length ? `<section class="ds-sec"><h4>关键台词</h4>${speech.slice(0, 6).map((line) => `<p class="ds-line">${html(String(line))}</p>`).join('')}</section>` : ''}${relations.length ? `<section class="ds-sec"><h4>关系</h4>${relations.slice(0, 10).map((rel) => `<p class="ds-line">${html(String(rel?.name ?? rel?.to ?? ''))}${rel?.kind || rel?.type ? `（${html(String(rel.kind || rel.type))}）` : ''}</p>`).join('')}</section>` : ''}${Array.isArray(entry.chapters) && entry.chapters.length ? `<section class="ds-sec"><h4>出现章节</h4><p class="ds-line">${entry.chapters.slice(0, 20).map((n) => `第${n}章`).join('、')}</p></section>` : ''}${entry.status ? `<p class="ds-tension">状态：${html(String(entry.status))}</p>` : ''}`,
    emptyHtml: '<div class="ref-detail"><div class="ref-detail-head"><h1 class="ref-title">词条不存在</h1></div><p class="ds-empty">这条故事源词条可能已被移除或改过 id——点左侧其他词条看看。</p></div>'
  })
}

/**
 * 笔记编辑器（OS-53 实时逐块编辑；OS-81 卡片浮右）。
 * 副作用（ref.noteText / ref.fmLen 的写入）留 app.js 薄壳；这里只吃已切好的 bodySource / body。
 */
export function referenceEditorHtml({ ref = {}, note, bodySource = '', body = '', imagesSlot = '', backlinks = null, esc, text } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const asText = text ?? ((value) => String(value ?? ''))
  if (!note) return ''
  const tagChips = (Array.isArray(note.tags) ? note.tags : [])
    .map((tag) => `<button class="pill tag-pick" data-ref-tag="${html(tag)}" title="按这个标签筛选">#${html(tag)}</button>`).join('')
  const mdPlain = (source) => asText(source).replace(/[*_`#>[\]()|]/gu, ' ').replace(/-{2,}/gu, ' ').replace(/\s+/gu, ' ').trim()
  const excerpt = mdPlain(note.excerpt) || mdPlain(bodySource).slice(0, 120)
  return wikiDetailHtml({
    id: note.path,
    title: note.title || note.path,
    subtitleHtml: `<span class="ref-detail-path">${html(note.path)}${note.chars !== undefined ? ` · ${note.chars} 字` : ''}</span>`,
    badgesHtml: `<label class="fc-edit" title="首次出现章节：这条知识从第几章开始成立（0＝原生共识，开篇即成立）。agent 上下文按它过滤防剧透">首次出现 <input type="number" min="0" class="fc-input" id="ref-first-chapter" value="${Number(note.firstChapter) || 0}" data-fc-path="${html(note.path)}"> 章起</label>`,
    actionsHtml: `${ref.from === 'graph' ? '<button class="btn-ghost" data-action="ref-back-graph" title="回到关系图谱">← 返回图谱</button>' : ''}<span class="doc-autosave" id="ref-autosave"></span><span class="count">点正文直接改，失焦自动保存</span><button class="btn-ghost" data-action="ref-to-agent">发给 Agent</button>`,
    tags: Array.isArray(note.tags) ? note.tags : [],
    getTagAction: (tag) => `data-ref-tag="${html(tag)}"`,
    summaryHtml: html(excerpt),
    sideHtml: `${imagesSlot}<div class="ref-graph-slot"><div class="ref-slot-head">关系图谱</div><div class="graph-box detail"><canvas id="ref-detail-canvas"></canvas></div></div>`,
    bodyHtml: `<div class="ref-doc">${body}</div>`,
    backlinksHtml: backlinks ? wikiBacklinksHtml({ linked: backlinks.linked, unlinked: backlinks.unlinked, openAction: 'data-ref-path' }) : '',
    emptyHtml: ''
  })
}

/** 图谱节点信息卡：类型徽章＋标签＋一句话摘要＋「打开详情」。edges 由调用方注入。 */
export function refNodeCardHtml(node, { edges = [], esc, text, variant = '', kindLabels } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const asText = text ?? ((value) => String(value ?? ''))
  const labels = kindLabels ?? { worldbook: { label: '世界书', color: 'var(--accent)' }, tag: { label: '标签', color: 'var(--warn)' }, artifact: { label: '章节/产物', color: 'var(--ok)' }, entry: { label: '条目', color: 'var(--meta)' } }
  const excerpt = asText(node?.excerpt).replace(/[*_`#>[\]()|]/gu, ' ').replace(/-{2,}/gu, ' ').replace(/\s+/gu, ' ').trim()
  return wikiNodeCardHtml({ ...node, excerpt }, {
    edges, kindLabels: labels, variant,
    openAction: `data-action="ref-node-open" data-node-id="${html(node?.id ?? '')}"`,
    tagAction: 'data-ref-tag'
  })
}

/** 世界书页·关系图谱视图（OS-51）：大画布＋节点信息卡＋标签筛选行。 */
export function referenceGraphHtml({ rc = {}, ref = {}, esc, text, nodeCardHtml } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  if (rc.graphError) return `<div class="error-box">${html(rc.graphError)}</div>`
  if (!rc.graph) return '<div class="loading">正在构图…</div>'
  const stats = rc.graph.stats || {}
  const focusNode = ref.focus ? (rc.graph.nodes || []).find((node) => node.id === ref.focus) : null
  const card = focusNode && nodeCardHtml ? nodeCardHtml(focusNode) : ''
  return wikiGraphViewHtml({
    graph: rc.graph,
    focusId: ref.focus || '',
    tags: ref.tags || [],
    tagFilter: ref.tagFilter || '',
    canvasId: 'ref-graph-canvas',
    filterAction: 'data-action="ref-graph-tag" data-tag',
    kindLabels: {
      worldbook: { label: '世界书', color: 'var(--accent)' },
      tag: { label: '标签', color: 'var(--warn)' },
      artifact: { label: '章节/产物', color: 'var(--ok)' },
      entry: { label: '条目（只读）', color: 'var(--meta)' }
    },
    nodeCardHtml: card,
    emptyHtml: '<span>没有节点</span>'
  })
}

/** 左栏模块卡（章节树／世界书图谱／世界书摘要）——正文页与剧本页共用。
 * hidden / openState / modules / prepend 全部由调用方注入；badge/render 是模块自带函数。 */
export function refModulesHtml({ prepend = '', modules = [], hidden = new Set(), openState = {}, esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const visible = modules.filter((mod) => !hidden.has(mod.id))
  const cards = visible.map((mod) => {
    const open = openState[mod.id] !== false
    const badge = mod.badge()
    const body = open ? mod.render() : ''
    return `<section class="ref-mod" data-ref-mod="${html(mod.id)}" data-open="${open ? '1' : '0'}">
      <div class="ref-mod-head">
        <button class="rm-toggle" data-action="refmod-toggle" data-module-id="${html(mod.id)}" aria-expanded="${open ? 'true' : 'false'}">
          <span class="rm-title">${html(mod.label)}</span>
          ${badge ? `<span class="rm-badge">${html(badge)}</span>` : ''}
          <span class="rm-chev">›</span>
        </button>
        <button class="rm-x" data-action="module-close" data-module-id="${html(mod.id)}" title="关闭「${html(mod.label)}」（设置里可重新打开）" aria-label="关闭">×</button>
      </div>
      ${body ? `<div class="ref-mod-body">${body}</div>` : ''}
    </section>`
  }).join('')
  return prepend + cards
}

/**
 * 世界书页整体外壳（OS-48 侧栏导航＋视图制主区）。
 * sideEffect 的装载/同源检查、refModule.referenceShellHtml、moduleLogHtml 由宿主先算好传进来；
 * 这里只做「同步状态条插入 ref-grid 之前」与 topic-workspace 包装。
 */
export function referencePageHtml({ ref = {}, shell = '', syncBlock = '', errorBox = '', flash = '', esc } = {}) {
  const html = esc ?? ((value) => String(value ?? ''))
  const shellWithSync = syncBlock
    ? (shell.includes('<div class="ref-grid">')
      ? shell.replace('<div class="ref-grid">', () => `${syncBlock}<div class="ref-grid">`)
      : `${syncBlock}${shell}`)
    : shell
  return `<div class="topic-workspace"><div class="topic-main">${errorBox}${ref.flash || flash ? `<div class="ok-note">${html(ref.flash || flash)}</div>` : ''}${shellWithSync}</div></div>`
}
