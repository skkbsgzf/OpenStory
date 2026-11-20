/**
 * OpenStory 前端套件（OS-92）
 *
 * 作者口径：「把硬编码的前端全部打碎重组，我希望相似的前端信息都尽可能复用，
 * 特别是未来开发或者三方开发者开发，都能遵循一套复用度高的前端套件。」
 *
 * 设计原则：
 *   1. **组件只出 HTML 字符串**——与现有 app.js 的渲染方式一致，零框架依赖；
 *   2. **样式只引用令牌**（--ui-fs-* / --ui-ctl-* / --radius / --surface-card）；
 *   3. **状态由调用方持有**——组件不收全局 state，参数进、HTML 出，便于测试与复用；
 *   4. **data-action 约定**——交互通过外壳的 action 分发，组件不绑事件。
 *
 * 使用方式（三方开发者照此写页面）：
 *   import { chipField, field, toolbar, card, emptyState } from './ui-kit.mjs'
 *   `${chipField({ id:'banned', label:'禁用词', values: list })}`
 *
 * 样式在 index.html 的「UI 套件」区块（.uikit-*），同样只用令牌。
 */

const esc = (value) => String(value ?? '')
  .replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;')
  .replace(/"/gu, '&quot;').replace(/'/gu, '&#39;')

/**
 * 标签编辑器（chip field）——替代「一行一个」的 textarea。
 *
 * 交互契约：
 *   · 输入框里打一个词，按 **空格 / 回车 / 逗号** → 变成一个标签
 *   · 每个标签有 × 可单独删（删除态由容器 data-editing 控制）
 *   · 字段头有「增 / 删」按钮：点「删」进入删除态，所有标签显 ×；
 *     再点一次退出（作者原话：「点击删按钮，下面的标签都出现 x 号，可以删除」）
 *
 * @param {object} opts
 * @param {string} opts.key      字段标识（写进 data-chip-key，保存时按它取值）
 * @param {string} opts.label    字段名
 * @param {string} [opts.hint]   右侧说明
 * @param {string[]} [opts.values] 初始标签
 * @param {string} [opts.placeholder]
 * @param {number} [opts.max]    单条最大字数（超出截断，与后端 normalizeHabits 一致）
 */
export function chipField({ key, label = '', hint = '', values = [], placeholder = '', max = 60 } = {}) {
  const list = Array.isArray(values) ? values : []
  const chips = list.map((value, index) => chipChip({ key, value, index, editing: false })).join('')
  return `<div class="uikit-chipfield" data-chip-field="${esc(key)}" data-editing="0" data-max="${Number(max) || 60}">
    <div class="uikit-chipfield-head">
      <span class="uikit-chipfield-label">${esc(label)}</span>
      ${hint ? `<span class="uikit-chipfield-hint">${esc(hint)}</span>` : ''}
      <span class="uikit-chipfield-count" data-chip-count>${list.length}</span>
      <span class="uikit-chipfield-actions">
        <button type="button" class="uikit-btn uikit-btn-ghost" data-action="chip-toggle-edit" data-chip-key="${esc(key)}" title="进入删除态：所有标签显 ×">删</button>
      </span>
    </div>
    <div class="uikit-chipfield-body">
      ${chips || '<span class="uikit-chipfield-empty">还没有条目——在下面输入，按空格添加</span>'}
    </div>
    <div class="uikit-chipfield-inputrow">
      <input type="text" class="uikit-input" data-chip-input data-chip-key="${esc(key)}"
        placeholder="${esc(placeholder || '输入后按空格添加…')}" autocomplete="off">
    </div>
    <input type="hidden" data-chip-value data-chip-key="${esc(key)}" value="${esc(list.join('\n'))}">
  </div>`
}

/** 单个标签（供 chipField 与外部复用）。 */
export function chipChip({ key, value, index, editing = false } = {}) {
  return `<span class="uikit-chip" data-chip-item data-chip-key="${esc(key)}" data-chip-index="${Number(index) || 0}">
    <span class="uikit-chip-text">${esc(value)}</span>
    <button type="button" class="uikit-chip-x${editing ? '' : ' is-hidden'}" data-action="chip-remove"
      data-chip-key="${esc(key)}" data-chip-index="${Number(index) || 0}" title="删除这条" aria-label="删除 ${esc(value)}">×</button>
  </span>`
}

/** 表单字段（label + 控件，统一间距）。 */
export function field({ label = '', hint = '', control = '', id = '' } = {}) {
  return `<div class="uikit-field"${id ? ` data-field="${esc(id)}"` : ''}>
    <label class="uikit-field-label">${esc(label)}${hint ? `<span class="uikit-field-hint">${esc(hint)}</span>` : ''}</label>
    ${control}
  </div>`
}

/** 文本输入（带统一外观）。 */
export function textInput({ id = '', value = '', placeholder = '', ...rest } = {}) {
  return `<input type="text" class="uikit-input"${id ? ` id="${esc(id)}"` : ''}
    value="${esc(value)}" placeholder="${esc(placeholder)}" ${attrs(rest)}>`
}

/** 下拉选择。 */
export function select({ id = '', value = '', options = [], ...rest } = {}) {
  const rows = (Array.isArray(options) ? options : []).map((option) => {
    const isObj = option && typeof option === 'object'
    const val = isObj ? option.value : option
    const label = isObj ? (option.label ?? option.value) : option
    return `<option value="${esc(val)}"${String(val) === String(value) ? ' selected' : ''}>${esc(label)}</option>`
  }).join('')
  return `<select class="uikit-select"${id ? ` id="${esc(id)}"` : ''} ${attrs(rest)}>${rows}</select>`
}

/** 工具栏（左中右三段，自带分隔）。 */
export function toolbar({ left = '', center = '', right = '' } = {}) {
  return `<div class="uikit-toolbar">
    <span class="uikit-toolbar-left">${left}</span>
    <span class="uikit-toolbar-center">${center}</span>
    <span class="uikit-toolbar-right">${right}</span>
  </div>`
}

/** 卡片（标题＋可选副标＋内容）。 */
export function card({ title = '', subtitle = '', badge = '', body = '', actions = '' } = {}) {
  return `<section class="uikit-card">
    ${title || actions ? `<header class="uikit-card-head">
      <h3 class="uikit-card-title">${esc(title)}${badge ? `<span class="uikit-badge">${esc(badge)}</span>` : ''}</h3>
      ${subtitle ? `<span class="uikit-card-sub">${esc(subtitle)}</span>` : ''}
      <span class="uikit-card-actions">${actions}</span>
    </header>` : ''}
    <div class="uikit-card-body">${body}</div>
  </section>`
}

/** 空态（统一的「还没有内容」）。 */
export function emptyState({ title = '', hint = '', action = '' } = {}) {
  return `<div class="uikit-empty">
    ${title ? `<p class="uikit-empty-title">${esc(title)}</p>` : ''}
    ${hint ? `<p class="uikit-empty-hint">${esc(hint)}</p>` : ''}
    ${action}
  </div>`
}

/** 键值表（统一表格外观，替代各页面自写的表格样式）。 */
export function kvTable({ rows = [], columns = null } = {}) {
  const list = Array.isArray(rows) ? rows : []
  if (!list.length) return emptyState({ hint: '没有数据' })
  const cols = Array.isArray(columns) ? columns : (list[0] && typeof list[0] === 'object'
    ? Object.keys(list[0]).map((key) => ({ key, label: key }))
    : [{ key: 'value', label: '' }])
  const head = cols.map((col) => `<th>${esc(col.label)}</th>`).join('')
  const body = list.map((row) => `<tr>${cols.map((col) => {
    const cell = row && typeof row === 'object' ? row[col.key] : row
    return `<td>${col.raw ? String(cell ?? '') : esc(cell)}</td>`
  }).join('')}</tr>`).join('')
  return `<div class="uikit-table-wrap"><table class="uikit-table">
    <thead><tr>${head}</tr></thead><tbody>${body}</tbody>
  </table></div>`
}

/** 按钮组（统一按钮词汇）。 */
export function buttonGroup({ items = [] } = {}) {
  const rows = (Array.isArray(items) ? items : []).map((item) => {
    const kind = item.kind === 'primary' ? ' uikit-btn-primary' : (item.kind === 'ghost' ? ' uikit-btn-ghost' : '')
    return `<button type="button" class="uikit-btn${kind}"${item.action ? ` data-action="${esc(item.action)}"` : ''}${item.disabled ? ' disabled' : ''}>${esc(item.label)}</button>`
  }).join('')
  return `<div class="uikit-buttongroup">${rows}</div>`
}

/** 属性串（过滤 undefined/null/false）。 */
function attrs(map) {
  return Object.entries(map || {})
    .filter(([, value]) => value !== undefined && value !== null && value !== false)
    .map(([key, value]) => value === true ? key : `${key}="${esc(value)}"`)
    .join(' ')
}
