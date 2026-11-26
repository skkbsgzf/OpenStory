/**
 * 页面测试矩阵：页面清单从 manifest slot、TAB_REGISTRY、SETTINGS_NAV 派生。
 * 这里只补测试语义（前置数据、入口动作、必需 API、DOM 标记），不再维护第二份产品页面名/顺序。
 */
import { SETTINGS_NAV } from '../../public/views/settingsViews.mjs'
import { TAB_REGISTRY } from '../../public/views/registry.mjs'

export const PAGE_MATRIX_SPEC = 'openstory.page-test-matrix@1'

const api = (method, path) => ({ method, path })
const click = (selector) => ({ type: 'click', selector })
const wait = (selector, timeout = 5000) => ({ type: 'wait', selector, timeout })
const evaluate = (expression) => ({ type: 'evaluate', expression })
const http = (method, path, body) => ({ type: 'http', method, path, body })
const assertEval = (expression, message) => ({ type: 'assert', expression, message })
const restoreUi = (root) => http('PUT', '/api/ui-state', { root, state: {
  'modules.enabled.analysis': true,
  'modules.enabled.habits': true,
  'modules.enabled.roleplay': true,
  'modules.enabled.text': true
} })

const page = (id, view, title, options = {}) => ({
  id, view, title, scope: 'library',
  entry: options.entry ?? [],
  actions: options.actions ?? [],
  checks: options.checks ?? [],
  checksAfter: options.checksAfter ?? [],
  after: options.after ?? [],
  before: options.before ?? [],
  requiredApi: options.requiredApi ?? [],
  dom: options.dom ?? ['#view'],
  assertions: options.assertions ?? [],
  setup: options.setup ?? 'sample-library',
  screenshot: options.screenshot ?? `${id}.png`,
  allowedStates: options.allowedStates ?? ['loaded'],
  expectedHttpErrors: options.expectedHttpErrors ?? [],
  viewports: options.viewports ?? [{ width: 1500, height: 980 }]
})

const baseApi = [
  api('GET', '/api/plugins'), api('GET', '/api/files'), api('GET', '/api/ui-state'),
  api('GET', '/api/agent/config'), api('GET', '/api/jobs')
]

const workbench = [
  page('artifacts', 'artifacts', '产物', {
    entry: [click('#tabs .tab[data-view="artifacts"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/artifacts')],
    dom: ['#view', '.artifacts-shell, .artifacts, .empty'],
    assertions: ['产物或空态可见']
  }),
  page('chapters', 'chapters', '正文', {
    entry: [click('#tabs .tab[data-view="chapters"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/chapters'), api('GET', '/api/reference'), api('GET', '/api/habits')],
    dom: ['#view', '.doc-paper, .empty, .loading'],
    assertions: ['正文纸面或正常空态可见', '无横向溢出'],
    actions: [click('[data-action="analyze-toggle"]')],
    viewports: [{ width: 1500, height: 980 }, { width: 675, height: 900 }, { width: 420, height: 800 }]
  }),
  page('worldbook', 'worldbook', '世界书', {
    entry: [click('#tabs .tab[data-view="worldbook"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/reference'), api('GET', '/api/reference/graph')],
    dom: ['#view', '.reference-shell, .ref-shell, .empty'],
    assertions: ['世界书主区可见', '无横向溢出'],
    viewports: [{ width: 1500, height: 980 }, { width: 675, height: 900 }, { width: 420, height: 800 }]
  }),
  page('script', 'dir:剧本', '剧本', {
    entry: [click('#tabs .tab[data-view="dir:剧本"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/files')],
    dom: ['#view', '.script-shell, .empty'],
    assertions: ['剧本主区可见']
  }),
  page('log', 'dir:日志', '日志', {
    entry: [click('#tabs .tab[data-view="dir:日志"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/files'), api('GET', '/api/log')],
    dom: ['#view', '.dir-shell, .empty'],
    assertions: ['只读日志主区可见']
  }),
  page('storysource', 'dir:故事源', '故事源', {
    entry: [click('#tabs .tab[data-view="dir:故事源"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/fact/books'), api('GET', '/api/fact/entries'), api('GET', '/api/fact/curve')],
    dom: ['#view', '.ss-shell, .empty'],
    assertions: ['故事源主区可见']
  }),
  page('habits', 'habits', '习惯', {
    entry: [click('#tabs .tab[data-view="habits"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/habits')],
    dom: ['#view', '.habits-shell, .empty'],
    assertions: ['习惯主区可见']
  }),
  page('roleplay', 'roleplay', '扮演', {
    entry: [click('#tabs .tab[data-view="roleplay"]'), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/deduce/session'), api('GET', '/api/deduce/sessions'), api('GET', '/api/deduce/opening')],
    dom: ['#view', '.deduce-shell, .empty'],
    assertions: ['扮演工作台或开局向导可见', '无横向溢出'],
    viewports: [{ width: 1500, height: 980 }, { width: 675, height: 900 }, { width: 420, height: 800 }]
  })
]

const hostPages = [
  page('libraries', 'libraries', '库管理', {
    scope: 'global', setup: 'no-default-library',
    entry: [wait('[data-lib-path], .empty')],
    requiredApi: [api('GET', '/api/libraries')],
    dom: ['#view', '#view [data-lib-path], #view .empty, #view .lib-card, #view .library-card'],
    assertions: ['库管理主区可见']
  }),
  page('lib-create', 'lib-create', '新建库', {
    scope: 'flow', entry: [evaluate("go('lib-create')"), wait('#view')],
    requiredApi: [api('GET', '/api/genres')],
    dom: ['#view', 'input, select, button'],
    assertions: ['建库表单可见']
  }),
  page('lib-import', 'lib-import', '导入稿件', {
    scope: 'flow', entry: [evaluate("go('lib-import')"), wait('#view')],
    requiredApi: [api('GET', '/api/libraries')],
    dom: ['#view', 'input, button'],
    assertions: ['导入表单可见']
  }),
  page('repair', 'repair', '修复', {
    scope: 'flow', entry: [evaluate("go('repair')"), wait('#view')],
    requiredApi: [api('GET', '/api/library/diagnose')],
    dom: ['#view', '.empty, button'],
    assertions: ['修复页或正常空态可见']
  })
]

const settings = SETTINGS_NAV.flatMap((group) => group.sections.map((section) => page(
  `settings-${section.id}`, 'settings', section.label,
  {
    scope: 'global', setup: section.id === 'governance' ? 'sample-library-or-none' : 'sample-library',
    entry: [evaluate("openSettingsTab && openSettingsTab()"), wait('.settings-nav'), click(`[data-settings-section="${section.id}"]`), wait('.settings-content')],
    before: [],
    requiredApi: [...baseApi, ...(section.id === 'about' ? [api('GET', '/api/health')] : [])],
    dom: ['.settings-content', '.settings-nav'],
    assertions: [`设置分区「${section.label}」可见`],
    checks: section.id === 'governance' ? [
      assertEval("document.querySelectorAll('.gov-card').length >= 21", '治理台必须显示全部 21 内置件，本机模块允许额外增加'),
      assertEval("document.querySelectorAll('.gov-card [role=\"switch\"]').length >= 12", '治理台必须显示全部 12 内置工作台开关，本机模块允许额外增加'),
      assertEval("document.querySelectorAll('.gov-graph-node').length >= 21", '能力图必须显示全部 21 内置节点，本机模块允许额外增加')
    ] : [],
    actions: section.id === 'governance' ? [click('[data-gov-action="expand"][data-id="fact"]')] : [],
    viewports: [{ width: 1500, height: 980 }, { width: 675, height: 900 }]
  }
)))

const subviews = [
  page('worldbook-graph', 'worldbook', '世界书关系图谱', {
    entry: [click('#tabs .tab[data-view="worldbook"]'), wait('#view'), evaluate("state.reference.view='graph'; render()"), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/reference/graph')],
    dom: ['#view', '.ref-graph, .graph, svg, .empty'],
    assertions: ['世界书图谱或正常空态可见']
  }),
  page('storysource-outline', 'dir:故事源', '故事源大纲', {
    entry: [click('#tabs .tab[data-view="dir:故事源"]'), wait('#view'), wait('.ss-wrap'), evaluate("state.factView.ss.view='outline'; render()"), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/fact/books'), api('GET', '/api/fact/entries')],
    dom: ['#view', '.ss-outline, .ss-shell, .empty'],
    assertions: ['故事源大纲可见或正常空态']
  }),
  page('storysource-board', 'dir:故事源', '故事源表格', {
    entry: [click('#tabs .tab[data-view="dir:故事源"]'), wait('#view'), evaluate("state.factView.ss.view='board'; render()"), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/fact/books'), api('GET', '/api/fact/entries')],
    dom: ['#view', '.ss-board, .ss-table, .empty'],
    assertions: ['故事源表格可见或正常空态']
  }),
  page('storysource-chart', 'dir:故事源', '故事源图表', {
    entry: [click('#tabs .tab[data-view="dir:故事源"]'), wait('#view'), evaluate("state.factView.ss.view='chart'; render()"), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/fact/books'), api('GET', '/api/fact/entries')],
    dom: ['#view', '.ss-chart, .ss-chart-fallback, .empty'],
    assertions: ['故事源图表或兜底表格可见']
  }),
  page('roleplay-engine', 'roleplay', '扮演叙事流', {
    entry: [click('#tabs .tab[data-view="roleplay"]'), wait('#view'), evaluate("state.deduce.mode='engine'; state.deduce.engine.view='scene'; render()"), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/deduce/session'), api('GET', '/api/deduce/sessions')],
    dom: ['#view', '.deduce-engine, .deduce-shell, .empty'],
    assertions: ['叙事流或开局向导可见']
  }),
  page('roleplay-tree', 'roleplay', '扮演剧情树', {
    entry: [click('#tabs .tab[data-view="roleplay"]'), wait('#view'), evaluate("state.deduce.mode='engine'; state.deduce.engine.view='tree'; render()"), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/deduce/session'), api('GET', '/api/deduce/sessions')],
    dom: ['#view', '.deduce-tree, svg, .empty'],
    assertions: ['剧情树或正常空态可见']
  }),
  page('roleplay-agent', 'roleplay', '扮演 Agent', {
    entry: [click('#tabs .tab[data-view="roleplay"]'), wait('#view'), evaluate("state.deduce.mode='agent'; render()"), wait('#view')],
    requiredApi: [...baseApi, api('GET', '/api/deduce/session')],
    dom: ['#view', '.deduce-agent, form, .empty'],
    assertions: ['Agent 表单或正常空态可见']
  })
]

const overlays = [
  page('overlay-add-tab', 'chapters', '增加页签', {
    entry: [click('#tabs .tab[data-view="chapters"]'), wait('#view'), click('[data-action="tab-add-open"]'), wait('#overlay')],
    requiredApi: [...baseApi],
    dom: ['#overlay', '#modal'],
    assertions: ['增加页签模态可见']
  }),
  page('overlay-exchange', 'chapters', '导入导出', {
    entry: [click('#tabs .tab[data-view="chapters"]'), wait('#view'), evaluate("openExchangeDialog && openExchangeDialog()"), wait('#exchange-dialog')],
    requiredApi: [...baseApi],
    dom: ['#exchange-dialog', 'form, button'],
    assertions: ['导入导出模态可见']
  })
]

const criticalScenarios = [
  page('settings-governance-no-library', 'settings', '没开库的插件治理台', {
    scope: 'global', setup: 'no-default-library',
    entry: [evaluate("state.current=null; state.settings.prevView=''; render(); openSettingsTab()"), wait('.settings-nav'), click('[data-settings-section="governance"]'), wait('.gov')],
    requiredApi: [...baseApi],
    dom: ['.gov', '.gov-graph'],
    checks: [
      assertEval("document.querySelectorAll('.gov-card').length >= 21", '没开库仍显示全部 21 内置件，本机模块允许额外增加'),
      assertEval("[...document.querySelectorAll('.gov-card [role=\"switch\"]')].length >= 12", '没开库仍有全部 12 内置工作台开关')
    ],
    checksAfter: [
      assertEval("[...document.querySelectorAll('.gov-card [role=\"switch\"]')].every((el) => el.disabled)", '没开库所有工作台开关必须 disabled'),
      assertEval("[...document.querySelectorAll('.gov-card [role=\"switch\"]')].every((el) => el.getAttribute('title').includes('先打开一个库'))", '没开库开关必须提示先打开一个库')
    ],
    assertions: ['没开库开关置灰、卡片与能力图仍可看']
  }),
  page('governance-fact-node', 'settings', '能力图点选事实内核', {
    scope: 'global',
    entry: [evaluate("openSettingsTab && openSettingsTab()"), wait('.settings-nav'), click('[data-settings-section="governance"]'), wait('.gov')],
    requiredApi: [...baseApi],
    dom: ['.gov', '.gov-graph'],
    actions: [click('.gov-graph-node[data-id="fact"]'), wait('.gov-card.open[data-gov-id="fact"]')],
    checks: [],
    checksAfter: [
      assertEval("document.querySelectorAll('.gov-graph-edge.hot').length === 14", '点节点后必须高亮 14 条边'),
      assertEval("document.querySelector('.gov-card.open[data-gov-id=\"fact\"]')?.innerText.includes('连锁影响')", '点节点后必须展开事实内核卡')
    ],
    assertions: ['点节点高亮 14 边并展开事实内核卡']
  }),
  page('governance-disable-confirm', 'settings', '停用扮演确认条', {
    scope: 'global',
    entry: [evaluate("openSettingsTab && openSettingsTab()"), wait('.settings-nav'), click('[data-settings-section="governance"]'), wait('.gov')],
    requiredApi: [...baseApi],
    dom: ['.gov', '.gov-card[data-gov-id="roleplay"]'],
    actions: [click('.gov-card[data-gov-id="roleplay"] [data-gov-action="toggle"]'), wait('.gov-confirm')],
    checks: [],
    checksAfter: [
      assertEval("document.querySelector('.gov-confirm')?.innerText.includes('页签「扮演」从导航消失')", '影响面必须按页签位置生成'),
      assertEval("document.querySelector('.gov-confirm')?.innerText.includes('库内数据与配置全部保留')", '必须说明数据与配置保留'),
      assertEval("[...document.querySelectorAll('.gov-confirm button')].some((el) => el.textContent.includes('取消'))", '必须有取消按钮')
    ],
    assertions: ['停用前展示影响面、数据保留与取消操作']
  }),
  page('degraded-roleplay-tab', 'roleplay', '降级扮演页签', {
    before: [
      http('PUT', '/api/ui-state', { state: { 'modules.enabled.analysis': false, 'modules.enabled.habits': false, 'modules.enabled.roleplay': false } }),
      http('PUT', '/api/ui-state', { state: { 'modules.enabled.text': false } }),
      http('PUT', '/api/ui-state', { state: { 'modules.enabled.roleplay': true } })
    ],
    after: [restoreUi('@ROOT@')],
    allowedStates: ['loaded', 'degraded'],
    expectedHttpErrors: ['/api/chapters', '/api/reference/graph'],
    entry: [click('#tabs .tab[data-view="roleplay"]'), wait('#tabs .tab[data-view="roleplay"]')],
    requiredApi: [...baseApi],
    dom: ['#tabs .tab[data-view="roleplay"].tab-degraded'],
    checks: [
      assertEval("document.querySelector('#tabs .tab[data-view=\"roleplay\"]')?.getAttribute('aria-disabled') === 'true'", '降级页签必须 aria-disabled'),
      assertEval("document.querySelector('#tabs .tab[data-view=\"roleplay\"]')?.getAttribute('title').includes('text.analyze')", '降级页签悬停必须列出缺失能力')
    ],
    assertions: ['降级页签灰显、不可点、悬停列出缺失能力']
  }),
  page('degraded-roleplay-view', 'roleplay', '降级扮演说明页', {
    before: [
      http('PUT', '/api/ui-state', { state: { 'modules.enabled.analysis': false, 'modules.enabled.habits': false, 'modules.enabled.roleplay': false } }),
      http('PUT', '/api/ui-state', { state: { 'modules.enabled.text': false } }),
      http('PUT', '/api/ui-state', { state: { 'modules.enabled.roleplay': true } })
    ],
    after: [restoreUi('@ROOT@')],
    allowedStates: ['loaded', 'degraded'],
    expectedHttpErrors: ['/api/reference/graph', '/api/chapters', '/api/deduce/'],
    entry: [evaluate("go('roleplay')"), wait('#view')],
    requiredApi: [...baseApi],
    dom: ['#view'],
    checks: [
      assertEval("document.querySelector('#view')?.innerText.includes('扮演 · 暂不可用')", '直达降级视图必须显示说明页'),
      assertEval("document.querySelector('#view')?.innerText.includes('text.analyze')", '说明页必须点名缺失能力'),
      assertEval("document.querySelector('#view')?.innerText.includes('插件治理台')", '说明页必须提供治理台入口')
    ],
    assertions: ['深链进入降级件显示说明与恢复入口']
  }),
  page('page-test-ext', 'module:page-test-ext/ext-page', '第三方 iframe 页面', {
    setup: 'local-module',
    entry: [wait('#tabs .tab[data-view="module:page-test-ext/ext-page"]'), click('#tabs .tab[data-view="module:page-test-ext/ext-page"]'), wait('#view .module-page')],
    actions: [evaluate("loadPlugins()"), wait('#view .module-page')],
    requiredApi: [...baseApi],
    dom: ['#view iframe'],
    checks: [],
    checksAfter: [
      assertEval("document.querySelector('#view .module-page h1')?.textContent.includes('第三方页')", 'iframe 页必须显示标题条'),
      assertEval("document.querySelector('#view iframe')?.getAttribute('src').includes('/module-page/page-test-ext/page.html')", 'iframe 必须指向声明入口')
    ],
    assertions: ['第三方模块页签与 iframe 入口可见']
  })
]

export const PAGE_MATRIX = Object.freeze([...hostPages, ...workbench, ...settings, ...subviews, ...overlays, ...criticalScenarios].map((item) => Object.freeze(item)))

/** 机械校验覆盖：所有产品顶层页与七设置分区都必须在矩阵里。 */
export function validatePageMatrix(matrix = PAGE_MATRIX, { slots = null, registry = TAB_REGISTRY, settingsNav = SETTINGS_NAV } = {}) {
  const errors = []
  const ids = new Set()
  for (const item of matrix) {
    if (!item || typeof item !== 'object') { errors.push('矩阵项必须是对象'); continue }
    if (!item.id || ids.has(item.id)) errors.push(`页面 id 缺失或重复：${item.id}`)
    ids.add(item.id)
    if (!item.view || !item.title || !item.screenshot) errors.push(`${item.id} 缺 view/title/screenshot`)
    const knownView = registry.some((entry) => entry.view === item.view || entry.id === item.view)
      || item.view.startsWith('dir:') || item.view.startsWith('module:')
    if (!knownView) errors.push(`${item.id} 未知 view：${item.view}`)
    if (!Array.isArray(item.dom) || !item.dom.length) errors.push(`${item.id} 缺 DOM 断言`)
    if (!Array.isArray(item.requiredApi)) errors.push(`${item.id} requiredApi 必须是数组`)
    if (!['library', 'global', 'flow'].includes(item.scope)) errors.push(`${item.id} scope 非法`)
    if (!Array.isArray(item.viewports) || !item.viewports.length) errors.push(`${item.id} 缺 viewports`)
  }
  const top = registry.filter((entry) => !entry.slotOnly)
  for (const entry of top) {
    if (!matrix.some((item) => item.id === entry.id || item.view === entry.view || (entry.id === 'settings' && item.id === 'settings-appearance'))) {
      errors.push(`顶层页面缺测试：${entry.id}`)
    }
  }
  for (const group of settingsNav) for (const section of group.sections) {
    if (!matrix.some((item) => item.id === `settings-${section.id}`)) errors.push(`设置分区缺测试：${section.id}`)
  }
  if (slots) {
    const testedViews = new Set(matrix.map((item) => item.view))
    for (const placement of slots.tab ?? []) {
      if (!testedViews.has(placement.page) && !matrix.some((item) => item.id === placement.page) && !matrix.some((item) => item.view === `module:${placement.module}/${placement.page}`)) errors.push(`投影页缺测试：${placement.page}`)
    }
  }
  return { ok: errors.length === 0, errors }
}

export function pageById(id) { return PAGE_MATRIX.find((item) => item.id === id) ?? null }
