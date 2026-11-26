/**
 * OS-204：设置页收敛——两大域七项单一定义、旧分区集中重定向、面板独立成节、
 * 插件单一装载、版本取自 /api/health。夹具全在内存与临时目录，不碰真机库与真实 LOCALAPPDATA。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SETTINGS_NAV, SETTINGS_REDIRECT, settingsNavLabel, createSettingsViews } from '../public/views/settingsViews.mjs'
import { createSuiteShelfViews } from '../public/views/suiteShelfViews.mjs'
import { ENDPOINTS, validateResponse } from '../src/api/contracts.mjs'
import { startDaemon } from '../src/host/daemon.mjs'
import { countPhysicalLines } from '../tools/arch-stats.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const esc = (value) => String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
const text = (value) => String(value ?? '')
const WORKBENCH = Object.freeze([
  { id: 'chapters', label: '章节树', slot: '左栏', hint: '卷/章两级' },
  { id: 'graph', label: '世界书图谱', slot: '左栏', hint: '关系图' },
  { id: 'summary', label: '世界书摘要', slot: '左栏', hint: '本章要点' },
  { id: 'plotCurve', label: '剧情曲线', slot: '右栏', hint: '情绪曲线' },
  { id: 'style', label: '文风分析', slot: '右栏', hint: '句长变异' },
  { id: 'rhythm', label: '节奏', slot: '右栏', hint: '逐段字数' },
  { id: 'aiSmell', label: 'AI 味', slot: '右栏', hint: '四因子' },
  { id: 'annotations', label: '本段批注', slot: '右栏', hint: '问题卡' }
])

function fixture({ section = 'about', hidden = new Set(), suites = [], appVersion = '' } = {}) {
  const state = {
    current: { name: '长夜', path: '' },
    settings: { section, suiteId: '', helpOpen: false },
    styles: [{ id: 'coral', name: '珊瑚', source: '内置' }], skin: 'coral', stylesDirs: [],
    kbStatus: null, kbConfig: null, sync: { data: null }, suites,
    plugins: { modules: [] }, warnings: [], appVersion
  }
  const agent = {
    runtime: '', runtimeList: [], endpoint: '', model: '', apiKeyMasked: '',
    config: null, dshModels: [], probes: {}, configPath: '', dshReasoningOptions: []
  }
  const views = createSettingsViews({
    state, agent, esc, text,
    uiKit: () => ({}),
    runtimeShelf: () => ({ selectableRuntimeKits: () => [], runtimeKitsByCategory: () => [] }),
    moduleOn: () => true,
    hiddenModules: () => hidden,
    WORKBENCH_MODULES: WORKBENCH,
    scriptPrefs: () => ({}), dirWork: () => null, castColorOf: () => ({}),
    settingsScriptSectionHtml: () => '<div class="script">剧本</div>',
    settingRuntimeKind: () => 'pi', probeBadgeLabel: () => '未测试', comfyNodeMapText: () => '',
    typographyState: () => ({ ui: 'comfortable', doc: 'm' }), docPrefSlidersHtml: () => '',
    syncPolicy: () => ({ checkOn: 'enter', action: 'remind' }), syncProblemsFrom: () => [], warningsHtml: () => '',
    uiMemory: () => ({ values: {} }), settingsAggregation: () => ({}),
    suitesSectionHtml: () => '<div class="suite-center">套件主面</div>',
    pluginsOverviewHtml: () => '<div>总览</div>', errorHtml: () => '',
    api: async () => {}, render: () => {}, loadPlugins: async () => {},
    governanceHtml: () => '<div class="gov">治理台已装载</div>',
    missingText: () => ''
  })
  return { state, agent, views, hidden }
}

test('导航：恰为两组七项，组序/项序/id 与任务一致；取表函数只从这一份拿', () => {
  assert.equal(SETTINGS_NAV.length, 2)
  assert.deepEqual(SETTINGS_NAV.map((group) => group.id), ['app', 'plugins'])
  assert.deepEqual(SETTINGS_NAV.map((group) => group.label), ['本体设置', '插件中心'])
  assert.deepEqual(SETTINGS_NAV.map((group) => group.sections.length), [3, 4])
  assert.deepEqual(SETTINGS_NAV[0].sections.map((item) => item.id), ['appearance', 'engines', 'about'])
  assert.deepEqual(SETTINGS_NAV[1].sections.map((item) => item.id), ['governance', 'panels', 'suites', 'localModules'])
  assert.equal(settingsNavLabel('engines'), '引擎与存储')
  assert.equal(settingsNavLabel('panels'), '面板')
  assert.equal(settingsNavLabel('never-existed'), '')
})

test('settingsHtml 只照导航真源渲染：七项、上下两行、无逐套件行，本机模块在插件中心组', () => {
  const fx = fixture({ suites: [{ id: 'novel', name: '小说套件', group: '业务套装', domains: ['小说'] }] })
  const html = fx.views.settingsHtml()
  const nav = html.match(/<nav class="settings-nav">([\s\S]*?)<\/nav>/u)?.[1]
  assert.ok(nav, '设置页要有左导航')
  assert.equal((nav.match(/data-settings-section="/gu) ?? []).length, 7)
  assert.doesNotMatch(nav, /data-action="suite-select"/u, '不再把套件逐个铺成导航行')
  assert.doesNotMatch(nav, /settings-nav-sub|nav-off-tag/u, '货架分组小标题与停用角标都不在导航里')
  const heads = nav.split('settings-nav-grouphead').slice(1)
  assert.equal(heads.length, 2)
  assert.match(heads[0], /本体设置/u)
  assert.match(heads[1], /插件中心/u)
  assert.match(heads[1], /data-settings-section="localModules"/u, '本机模块列在插件中心组')
  assert.doesNotMatch(heads[0], /data-settings-section="localModules"/u)
  assert.match(nav, /<b>外观<\/b>\s*<span>皮肤主题与字号档位<\/span>/u, '标签与提示是上下两行')
})

test('重定向：13 个旧 id 逐个渲染出目标分区内容，且只写在这一张表里', () => {
  const expected = {
    moduleSettings: 'governance',
    pluginsOverview: 'suites', plugins: 'suites', suite: 'suites', suiteSettings: 'suites', suiteDetail: 'suites',
    typography: 'appearance',
    models: 'engines', kb: 'engines', data: 'engines', runtimes: 'engines', runtime: 'engines', discover: 'engines'
  }
  assert.deepEqual({ ...SETTINGS_REDIRECT }, expected)
  const markers = {
    governance: /治理台已装载/u,
    suites: /套件主面/u,
    appearance: /皮肤主题/u,
    engines: /对话模型与运行时/u
  }
  const fx = fixture()
  for (const [oldId, target] of Object.entries(SETTINGS_REDIRECT)) {
    fx.state.settings.section = oldId
    assert.match(fx.views.settingsHtml(), markers[target], `${oldId} 应渲染 ${target}`)
  }
})

test('面板：8 个面板按左/右分组，开关仍写 moduleHidden；套件详情不再嵌工作台模块小节', () => {
  const hidden = new Set(['chapters'])
  const fx = fixture({ section: 'panels', hidden })
  const html = fx.views.settingsHtml()
  assert.equal((html.match(/data-action="module-toggle"/gu) ?? []).length, 8)
  assert.match(html, />左栏</u)
  assert.match(html, />右栏</u)
  assert.match(html, /当前库/u, '保留「当前库」按库分别记的提示')
  for (const mod of WORKBENCH) assert.ok(html.includes(`data-module-id="${mod.id}"`), `缺面板 ${mod.id}`)
  assert.match(html, /data-module-id="chapters">/u, '被隐藏的面板不勾')
  assert.match(html, /data-module-id="graph" checked/u, '未隐藏的面板勾上')
  fx.hidden.add('graph')
  const again = fx.views.settingsHtml()
  assert.doesNotMatch(again, /data-module-id="graph" checked/u)

  const suiteSource = readFileSync(join(REPO, 'public/views/suiteShelfViews.mjs'), 'utf8')
  assert.doesNotMatch(suiteSource, /工作台模块/u, '套件详情不再有工作台模块小节')
  const shelf = createSuiteShelfViews({
    state: { settings: { suiteOverrides: [] }, suites: [] }, esc, text, isDarkSurface: () => false
  })
  const detail = shelf.suiteDetailPaneHtml({ id: 'writing', name: '写作套件', capabilities: { settings: { mode: 'none' } } })
  assert.doesNotMatch(detail, /工作台模块/u)
})

test('单一装载：前端无套件端点请求与旧装载函数；loadPlugins 写 state.suites', () => {
  const app = readFileSync(join(REPO, 'public/app.js'), 'utf8')
  assert.doesNotMatch(app, /\/api\/suites/u, 'app.js 不再请求套件端点')
  assert.doesNotMatch(app, /\bloadSuites\b/u, 'app.js 不再有旧装载函数')
  for (const name of readdirSync(join(REPO, 'public/views')).filter((item) => item.endsWith('.mjs'))) {
    const source = readFileSync(join(REPO, 'public/views', name), 'utf8')
    assert.doesNotMatch(source, /\/api\/suites/u, `${name} 不再请求套件端点`)
    assert.doesNotMatch(source, /\bloadSuites\b/u, `${name} 不再引用旧装载函数`)
  }
  const start = app.indexOf('async function loadPlugins(')
  assert.ok(start >= 0, 'app.js 有唯一装载函数 loadPlugins')
  const body = app.slice(start, app.indexOf('\n}', start))
  assert.match(body, /state\.suites\s*=\s*Array\.isArray\(payload\.suites\)/u, 'suites 写进 state.suites')
  assert.match(body, /state\.settings\.suiteOverrides\s*=/u)
  assert.match(body, /state\.settings\.suitesUserDir\s*=/u)
  assert.match(body, /state\.settings\.suiteWarnings\s*=/u)
})

test('版本：契约有 appVersion；临时 daemon 回包等于 package.json；关于页显示它或未知', async () => {
  assert.equal(ENDPOINTS.healthGet.response.appVersion, 'string')
  const expected = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf8')).version
  const base = mkdtempSync(join(tmpdir(), 'openstory-os204-'))
  const preferencesPath = join(base, 'libraries.json')
  writeFileSync(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [] }), 'utf8')
  const env = { ...process.env, LOCALAPPDATA: base, APPDATA: base }
  let daemon = null
  try {
    daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
    const payload = await (await fetch(`http://127.0.0.1:${daemon.port}/api/health`)).json()
    assert.equal(payload.appVersion, expected, '返回包版本号与 package.json 一致')
    assert.equal(validateResponse('healthGet', payload).ok, true)
  } finally {
    if (daemon) await daemon.close()
    rmSync(base, { recursive: true, force: true })
  }
  const withVersion = fixture({ section: 'about', appVersion: expected }).views.settingsHtml()
  assert.ok(withVersion.includes(`<span class="v">${expected}</span>`), '关于页显示真实版本')
  const without = fixture({ section: 'about' }).views.settingsHtml()
  assert.match(without, /<span class="v">未知<\/span>/u, '取不到写未知')
})

test('app.js 行数不增（开工实测 10095 行）', () => {
  const lines = countPhysicalLines(readFileSync(join(REPO, 'public/app.js'), 'utf8'))
  assert.ok(lines <= 10095, `app.js ${lines} 行超过开工时 10095 行`)
})
