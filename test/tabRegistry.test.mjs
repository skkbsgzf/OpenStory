/**
 * 视图行为表与 slot 投影（OS-143 立表；OS-198 退为行为表，node:test）。
 *
 * 钉死五件事：
 *   ① 投影快照——九个工作台页签的顺序与显示名只来自 manifest，设置页签固定在后；
 *   ② 停用模块——投影里该页签消失，其余不动；
 *   ③ 第三方 iframe 页面——`module:<模块>/<页面>` 视图与入口；内置视图优先；
 *   ④ 行为表纯度——`TAB_REGISTRY` 不含页签名/目录/模块归属/顺序，注册表零 import；
 *   ⑤ 渲染插座——app.js 的 VIEW_RENDERERS 覆盖全部注册名（含模块 iframe 视图）。
 *
 * 跑法：node --test test/tabRegistry.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  TAB_REGISTRY, BUILTIN_PAGE_IDS,
  DIR_LABELS, DIR_ORDER, READONLY_DIRS, PAGE_TO_DIR_LOCAL,
  DEFAULT_HIDDEN_TABS, RETIRED_DIRS,
  projectedTabDefs, projectedPanelTabs, visibleTabDefs, moduleView, parseModuleView,
  slotState, tabButtonHtml,
  viewKnown, viewScope, renderNameForView, modulePagePlacement, creatableDirNames, sanitizeHiddenTabs
} from '../public/views/registry.mjs'
import { MODULE_MANIFESTS, slotProjection } from '../src/protocol/modules.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const builtinPages = new Set(BUILTIN_PAGE_IDS)
const slotsFor = (enabled = {}, localIds = new Set()) => slotProjection(MODULE_MANIFESTS, enabled, { builtinPages, localIds }).slots
const ctx = (extra = {}) => ({ current: { path: '/lib' }, brief: null, briefGenre: null, libDirs: ['正文', '世界书', '剧本', '故事源', '习惯', '日志'], settingsOpen: false, ...extra })
const viewsOf = (slots, context = ctx()) => projectedTabDefs({ slots, ctx: context }).map((def) => def.view)

const canon = (defs) => defs.map((def) => ({
  view: def.view, label: def.label, ic: def.ic,
  readonly: def.readonly === true, closable: def.closable !== false
}))

test('投影快照：九个工作台页签顺序与显示名只来自 manifest，设置固定在后', () => {
  const slots = slotsFor()
  assert.deepEqual(viewsOf(slots), ['artifacts', 'chapters', 'knowledge-base', 'worldbook', 'dir:剧本', 'dir:日志', 'dir:故事源', 'habits', 'roleplay'])
  assert.deepEqual(projectedTabDefs({ slots, ctx: ctx() }).map((def) => def.label),
    ['产物', '正文', '知识库', '世界书', '剧本', '日志', '故事源', '习惯', '扮演'])
  assert.equal(projectedTabDefs({ slots, ctx: ctx() }).find((def) => def.view === 'dir:日志').readonly, true)
  // 设置是宿主自有页签，打开才出现、永远排在模块页签之后
  const open = projectedTabDefs({ slots, ctx: ctx({ settingsOpen: true }) })
  assert.equal(open.at(-1).view, 'settings')
  assert.equal(open.at(-1).label, '设置')
  // 没库时模块页面不出现；设置打开时只剩设置
  assert.deepEqual(viewsOf(slots, { current: null, libDirs: [], settingsOpen: false }), [])
  assert.deepEqual(viewsOf(slots, { current: null, libDirs: [], settingsOpen: true }), ['settings'])
})

test('停用工作台：投影里该页签消失，其余不动；重新启用即回来', () => {
  const enabled = slotsFor({ habits: false })
  const views = viewsOf(enabled)
  assert.ok(!views.includes('habits'))
  assert.deepEqual(views, ['artifacts', 'chapters', 'knowledge-base', 'worldbook', 'dir:剧本', 'dir:日志', 'dir:故事源', 'roleplay'])
  assert.ok(viewsOf(slotsFor()).includes('habits'))
})

test('OS-203·降级投影：降级位置带标记与 missing，顺序不变；健康输出逐字不变', () => {
  const slots = slotsFor()
  const healthy = projectedTabDefs({ slots, ctx: ctx() })
  assert.ok(healthy.every((def) => !('degraded' in def) && !('missing' in def)), '健康定义不新增字段')
  const degradedSlots = {
    ...slots,
    tab: slots.tab.map((item) => item.module === 'roleplay'
      ? { ...item, degraded: true, missing: [{ capability: 'text.analyze', min: 1, maxExclusive: 2 }] }
      : item)
  }
  const defs = projectedTabDefs({ slots: degradedSlots, ctx: ctx() })
  assert.deepEqual(defs.map((def) => def.view), healthy.map((def) => def.view), '顺序不变')
  const roleplay = defs.find((def) => def.view === 'roleplay')
  assert.equal(roleplay.degraded, true)
  assert.deepEqual(roleplay.missing, [{ capability: 'text.analyze', min: 1, maxExclusive: 2 }])
  assert.deepEqual(canon(defs), canon(healthy), '健康字段一个不变')
  const panel = projectedPanelTabs(degradedSlots, TAB_REGISTRY, ctx())
  assert.equal(panel.find((item) => item.view === 'roleplay').degraded, true)
  assert.deepEqual(panel.find((item) => item.view === 'roleplay').missing, roleplay.missing)
})

test('OS-203·slotState 与页签标记：三态判定＋降级灰显＋健康 HTML 逐字不变', () => {
  assert.deepEqual(slotState({ right: [{ page: 'analysis' }] }, 'right', 'analysis'), { present: true, degraded: false, missing: [] })
  assert.deepEqual(slotState({ right: [] }, 'right', 'analysis'), { present: false, degraded: false, missing: [] })
  assert.deepEqual(slotState({ right: [{ page: 'analysis', degraded: true, missing: ['text.analyze'] }] }, 'right', 'analysis'), { present: true, degraded: true, missing: ['text.analyze'] })
  const esc = (value) => String(value ?? '')
  const html = tabButtonHtml({ view: 'roleplay', label: '扮演', ic: '扮', closable: true, degraded: true, missing: ['text.analyze'] }, {
    esc, missingText: (missing) => `缺少所需能力：${missing.join('、')}`
  })
  assert.match(html, /class="tab tab-degraded"/u)
  assert.match(html, /aria-disabled="true"/u)
  assert.match(html, /title="缺少所需能力：text\.analyze"/u)
  assert.equal(tabButtonHtml({ view: 'chapters', label: '正文', ic: '章', closable: true }, { esc, active: true }),
    '<button class="tab on" data-view="chapters"><span class="ic">章</span>正文<span class="tab-x" data-action="tab-hide" data-tab-view="chapters" title="收起这个页签（不动磁盘上的东西）">×</span></button>')
})

test('第三方 iframe 页面：投影给 iframe 视图，前端生成 module:<模块>/<页面> 与入口', () => {
  const manifests = [{
    id: 'ext', class: 'workbench', pages: [{ id: 'ext-page', label: '外部工作台', kind: 'iframe', entry: 'pages/index.html' }],
    slots: [{ slot: 'tab', page: 'ext-page', order: 5 }]
  }]
  const projection = slotProjection(manifests, {}, { builtinPages, localIds: new Set(['ext']) })
  assert.equal(projection.slots.tab[0].view, 'iframe')
  assert.equal(projection.slots.tab[0].entry, 'pages/index.html')
  const defs = projectedTabDefs({ slots: projection.slots, ctx: ctx() })
  assert.equal(defs[0].view, 'module:ext/ext-page')
  assert.equal(defs[0].label, '外部工作台')
  assert.equal(defs[0].iframe.entry, 'pages/index.html')
  assert.equal(moduleView('ext', 'ext-page'), 'module:ext/ext-page')
  assert.deepEqual(parseModuleView('module:ext/ext-page'), { module: 'ext', page: 'ext-page' })
  assert.equal(parseModuleView('module:ext/ext-page/extra'), null)
  assert.equal(viewKnown('module:ext/ext-page', projection.slots), true)
  assert.equal(renderNameForView('module:ext/ext-page'), 'modulePageHtml')
  // 内置视图优先：同 id 页面即使声明 iframe，投影仍算 builtin
  const override = [{
    id: 'artifacts', class: 'workbench', pages: [{ id: 'artifacts', label: '产物', kind: 'iframe', entry: 'index.html' }],
    slots: [{ slot: 'tab', page: 'artifacts', order: 1 }]
  }]
  const overridden = slotProjection(override, {}, { builtinPages, localIds: new Set(['artifacts']) })
  assert.equal(overridden.slots.tab[0].view, 'builtin')
  assert.equal(projectedTabDefs({ slots: overridden.slots, ctx: ctx() })[0].iframe, undefined)
})

test('投影为空/拿不到：不退回硬编码名单，只有宿主设置页', () => {
  assert.deepEqual(projectedTabDefs({ slots: {}, ctx: ctx() }), [])
  assert.deepEqual(projectedTabDefs({ slots: {}, ctx: ctx({ settingsOpen: true }) }).map((def) => def.view), ['settings'])
  assert.equal(modulePagePlacement('module:ext/ext-page', {}), null)
  assert.equal(viewKnown('module:ext/ext-page', {}), false)
})

test('隐藏过滤与「＋」面板：勾选项只在投影内', () => {
  const slots = slotsFor()
  const defs = projectedTabDefs({ slots, ctx: ctx() })
  assert.deepEqual(visibleTabDefs(defs, new Set(['chapters', 'settings'])).map((def) => def.view),
    ['artifacts', 'knowledge-base', 'worldbook', 'dir:剧本', 'dir:日志', 'dir:故事源', 'habits', 'roleplay'])
  const panel = projectedPanelTabs(slots, TAB_REGISTRY, ctx())
  assert.ok(panel.some((item) => item.view === 'chapters' && item.label === '正文'))
  assert.ok(panel.every((item) => item.view !== 'settings'))
  // 体裁裁剪：世界书目录被排除后，正文/世界书页签按 visibleWhen 消失
  const genre = projectedTabDefs({ slots, ctx: ctx({ brief: {}, briefGenre: { excludedPages: ['worldbook', 'entries'] } }) }).map((def) => def.view)
  assert.ok(!genre.includes('worldbook'))
  // OS-198a：面板列出投影里所有可关闭页签，含第三方 iframe 页；收起后仍可勾回原位。
  const iframeSlots = { tab: [{ slot: 'tab', module: 'ext', page: 'ext-page', label: '外部工作台', view: 'iframe', entry: 'index.html' }] }
  const iframeDefs = projectedTabDefs({ slots: iframeSlots, ctx: ctx() })
  const iframeView = moduleView('ext', 'ext-page')
  assert.ok(iframeDefs.some((def) => def.view === iframeView && def.closable === true))
  assert.ok(visibleTabDefs(iframeDefs, new Set([iframeView])).every((def) => def.view !== iframeView), '收起后页签栏没有它')
  const iframePanel = projectedPanelTabs(iframeSlots, TAB_REGISTRY, ctx())
  assert.ok(iframePanel.some((item) => item.view === iframeView && item.label === '外部工作台' && item.iframe), '面板必须含第三方 iframe 页')
  assert.ok(iframePanel.every((item) => item.view !== 'settings'), '宿主设置页不进面板')
  assert.ok(visibleTabDefs(iframeDefs, new Set()).some((def) => def.view === iframeView), '勾回后按投影原位回页签栏')
})

test('死种子：已退场目录名读时忽略、写时不再追加', () => {
  assert.deepEqual(sanitizeHiddenTabs(['dir:大纲', 'chapters', 'dir:约束', 'module:ext/ext-page']), ['chapters', 'module:ext/ext-page'])
  assert.deepEqual(sanitizeHiddenTabs(null), [])
  assert.deepEqual(sanitizeHiddenTabs([]), [])
})

test('场景：库里没有世界书/目录时世界书页签不出（visibleWhen 门控），其余不动', () => {
  const slots = slotsFor()
  const base = viewsOf(slots)
  assert.ok(base.includes('worldbook'))
  const noWorldbook = viewsOf(slots, ctx({ libDirs: ['正文', '剧本', '故事源', '习惯', '日志'] }))
  assert.ok(!noWorldbook.includes('worldbook'))
  assert.deepEqual(noWorldbook, base.filter((view) => view !== 'worldbook'))
})

test('行为表纯度：没有页签名/目录/模块归属/顺序字段；注册表零 import', () => {
  const forbidden = ['label', 'dir', 'module', 'order', 'panelLabel', 'dirScan', 'kind']
  for (const entry of TAB_REGISTRY) {
    for (const key of forbidden) assert.equal(Object.prototype.hasOwnProperty.call(entry, key), false, `${entry.id} 不该有 ${key}`)
  }
  const source = readFileSync(join(HERE, '..', 'public', 'views', 'registry.mjs'), 'utf-8')
  assert.doesNotMatch(source, /^\s*import\s/m, '注册表不许静态 import 任何模块')
  assert.doesNotMatch(source, /require\(/, '注册表不许 require')
  assert.doesNotMatch(source, /import\(/, '注册表不许动态 import（纯数据＋纯函数）')
  assert.doesNotMatch(source, /\bdocument\b|\bwindow\b|localStorage|sessionStorage/, '注册表不碰 DOM 与浏览器存储')
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1')
  assert.doesNotMatch(code, /app\.js/, '注册表代码不引用 app.js')
})

test('宿主路由与作用域：flow/global 不需要库；dir/module 一律按库页', () => {
  assert.equal(viewScope('settings'), 'global')
  assert.equal(viewScope('libraries'), 'global')
  assert.equal(viewScope('lib-create'), 'flow')
  assert.equal(viewScope('lib-import'), 'flow')
  assert.equal(viewScope('repair'), 'flow')
  for (const view of ['chapters', 'artifacts', 'roleplay', 'worldbook', 'habits']) assert.equal(viewScope(view), 'library')
  assert.equal(viewScope('dir:剧本'), 'library')
  assert.equal(viewScope('module:ext/ext-page'), 'library')
  assert.equal(viewScope('nope'), null)
  assert.equal(viewScope(undefined), null)
})

test('渲染插座：app.js 的 VIEW_RENDERERS 覆盖全部注册名', () => {
  const renderNames = [...new Set(TAB_REGISTRY.filter((entry) => entry.render).map((entry) => entry.render))]
  renderNames.push('modulePageHtml')
  assert.ok(renderNames.length >= 8)
  assert.equal(renderNameForView('chapters'), 'writeHtml')
  assert.equal(renderNameForView('settings'), 'settingsHtml')
  assert.equal(renderNameForView('dir:剧本'), 'dirViewHtml')
  const appSource = readFileSync(join(HERE, '..', 'public', 'app.js'), 'utf-8')
  const match = /const VIEW_RENDERERS = \{([^}]*)\}/.exec(appSource)
  assert.ok(match, 'app.js 必须声明 VIEW_RENDERERS 插座')
  const registered = new Set([...match[1].matchAll(/([A-Za-z]\w*)/g)].map((m) => m[1]))
  for (const name of renderNames) assert.ok(registered.has(name), `VIEW_RENDERERS 缺注册名 ${name}`)
})

test('词表映射原样保真：PAGE_TO_DIR_LOCAL/READONLY_DIRS/DIR_ORDER/DIR_LABELS', () => {
  assert.deepEqual({ ...PAGE_TO_DIR_LOCAL }, { chapters: '正文', write: '正文', worldbook: '世界书', entries: '世界书', script: '剧本' })
  assert.deepEqual([...DIR_ORDER], ['正文', '世界书', '剧本', '日志'])
  assert.deepEqual([...RETIRED_DIRS], ['大纲', '构思', '资料', '约束'])
  assert.ok(READONLY_DIRS.has('日志'))
  assert.equal(READONLY_DIRS.size, 1)
  assert.equal(DIR_LABELS['故事源'], '故事源')
  assert.equal(DIR_LABELS['正文'], '正文')
  assert.deepEqual([...DEFAULT_HIDDEN_TABS], ['dir:大纲', 'dir:构思', 'dir:资料', 'dir:约束'])
  assert.ok(creatableDirNames(['正文', '世界书']).some((item) => item.dir === '剧本'))
  for (const entry of TAB_REGISTRY) {
    if (entry.view && !entry.view.startsWith('dir:')) assert.equal(entry.view, entry.id, `TAB_REGISTRY:${entry.id} 的 view ≠ id`)
  }
})