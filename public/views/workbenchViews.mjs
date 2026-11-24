/**
 * 工作面纯 HTML 构造函数（OS-161，G5b 延续）——从 app.js 迁出的纯函数。
 *
 * 硬约束（与 registry.mjs / settingsAggregation.mjs 同门风）：
 *   · 纯函数：入参进、HTML 字符串出；不读全局 state、不碰 DOM、不写存储、不 import 任何模块
 *     （ui-kit / esc / text / 工具函数全部由调用方注入——S2.2 零边，测试可直接喂夹具）；
 *   · app.js 只保留薄壳（取数＋转交），视图本体只出不进（AGENTS.md 第 20 条增量冻结）。
 *
 * 每个函数配金样测试（test/workbenchViews.test.mjs）：固定夹具 → 固定 HTML。
 */
const NEED_LIBRARY = `<div class="empty-state">
    <h2>先选一个库</h2>
    <p>点右上角的「库」切换器选一个库，OpenStory 才会去读那个文件夹。</p>
    <button class="btn-ghost" data-go="libraries">去库管理</button>
  </div>`

function needLibraryHtml() {
  return NEED_LIBRARY
}

/**
 * 习惯页（OS-92 重做，OS-161 迁出）。
 * @param {object} ctx { current, habits, fields, uiKit, errorBox, logHtml, esc, text }
 */
export function habitsViewHtml({ current, habits, fields, uiKit, errorBox = '', logHtml = '', esc, text }) {
  if (!current) return needLibraryHtml()
  if (!habits) return '<div class="loading">正在读取习惯表…</div>'
  const html = esc ?? ((value) => String(value ?? ''))
  const asText = text ?? ((value) => String(value ?? ''))
  const chipValues = (values) => Array.isArray(values) ? values : []
  const formFields = fields.map((item) => uiKit.chipField({
    key: item.key,
    label: item.label,
    hint: asText(item.hint).replace(/（一行一个）/u, ''),
    values: chipValues(habits[item.key]),
    placeholder: asText(item.ph).split(String.fromCharCode(10))[0] || '输入后按空格添加…',
    max: 60
  })).join('')
  const toneControl = uiKit.select({
    id: 'habit-tone', value: habits.tone || 'direct',
    options: [
      { value: 'direct', label: '直言——编辑体，问题直接说' },
      { value: 'gentle', label: '温和——先扬后抑，问题说成「可以先动的」' }
    ]
  })
  return `<div class="doc-head"><div class="kick">${html(current.name)} / 习惯</div><h1>习惯</h1>
      <div class="doc-meta"><span class="b">你的写作习惯表</span><span>Agent 成文前会逐条遵循；分析引擎按它扫问题</span></div></div>
    ${errorBox}
    <div class="habits-form">
      ${uiKit.field({ label: '口吻', hint: '分析结论的说话方式', control: toneControl })}
      ${uiKit.field({
        label: '文风',
        hint: '一句自述，Agent 成文与总评都以它为基调',
        control: uiKit.textInput({ id: 'habit-style', value: habits.style || '', placeholder: '例如：宋明白话为骨，白描，少形容词' })
      })}
      ${formFields}
      ${uiKit.toolbar({
        left: uiKit.buttonGroup({ items: [{ label: '保存习惯表', kind: 'primary', action: 'habits-save' }] }),
        right: '<span class="uikit-empty-hint">保存后立即生效：Agent 成文注入＋分析扫描</span>'
      })}
    </div>
    ${logHtml}`
}
