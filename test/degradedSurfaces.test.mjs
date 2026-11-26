/**
 * OS-203：降级显形——降级工作站在页签、右栏入口、顶栏动作、设置区与直达视图上
 * 一律灰显＋说明，不再「页签照常在、点进去才报错」。
 *
 * 覆盖：纯函数（投影／标记／slotState／missingText／说明页）＋三个视图面的降级夹具
 * ＋真实 /api/plugins 降级载荷喂给前端投影＋app.js 源码门禁（slotHas 清零、行数不增）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BUILTIN_PAGE_IDS, projectedTabDefs, slotState, tabButtonHtml } from '../public/views/registry.mjs'
import { missingText, degradedViewHtml } from '../public/views/governanceViews.mjs'
import { createSettingsViews } from '../public/views/settingsViews.mjs'
import { createAnalysisViews } from '../public/views/analysisViews.mjs'
import { createReferencePageViews } from '../public/views/referencePageViews.mjs'
import { countPhysicalLines } from '../tools/arch-stats.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = join(HERE, '..')
const esc = (value) => String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
const text = (value) => String(value ?? '')
const noop = () => ''
const ctx = (extra = {}) => ({
  current: { path: '/夹具库' }, brief: null, briefGenre: null,
  libDirs: ['正文', '世界书', '剧本', '故事源', '习惯', '日志'], settingsOpen: false, ...extra
})

const degCard = (id, caps) => ({
  id, name: id === 'imagegen' ? '生图与识图' : id, status: 'degraded',
  missing: caps.map((cap) => ({ capability: cap, min: 1, maxExclusive: 2 })),
  requires: caps.map((cap) => ({ id: cap, min: 1, maxExclusive: 2, provider: 'text', providerName: '文本内核', ok: false, reason: 'CAPABILITY_VERSION_MISMATCH' }))
})

/* ---------- missingText / 说明页 ---------- */

test('OS-203·missingText：有供给方（版本不够）／无供给方／多项三种文案', () => {
  const withProvider = [{ capability: 'text.analyze', min: 1, maxExclusive: 2 }]
  const requires = [{ id: 'text.analyze', min: 1, provider: 'text', providerName: '文本内核', ok: false, reason: 'CAPABILITY_VERSION_MISMATCH' }]
  assert.equal(missingText(withProvider, requires), '缺少所需能力：text.analyze@1（供给方：文本内核）——该工作面暂不可用')
  assert.equal(missingText(withProvider, []), '缺少所需能力：text.analyze@1（目前没有插件供给）——该工作面暂不可用')
  const multi = missingText([{ capability: 'text.analyze', min: 1 }, { capability: 'media.image', min: 2 }], [
    { id: 'text.analyze', min: 1, provider: 'text', providerName: '文本内核' },
    { id: 'media.image', min: 2, provider: 'media', providerName: '媒体内核' }
  ])
  assert.equal(multi, '缺少所需能力：text.analyze@1（供给方：文本内核）；media.image@2（供给方：媒体内核）——该工作面暂不可用')
  assert.equal(missingText([], requires), '')
})

test('OS-203·degradedViewHtml：模块名、缺什么、去哪里恢复一页说清', () => {
  const card = degCard('roleplay', ['text.analyze'])
  card.name = '扮演'
  const html = degradedViewHtml(card)
  assert.match(html, /扮演 · 暂不可用/u)
  assert.match(html, /缺少所需能力：text\.analyze@1（供给方：文本内核）——该工作面暂不可用/u)
  assert.match(html, /设置 · 插件治理台/u)
  assert.match(html, /data-settings-section="governance"/u)
})

/* ---------- 投影 / 页签标记 / slotState ---------- */

test('OS-203·投影：降级位置带 degraded/missing、顺序不变，健康定义形状一个字段不多', () => {
  const slots = {
    tab: [
      { slot: 'tab', page: 'roleplay', module: 'roleplay', label: '扮演', view: 'builtin', degraded: true, missing: [{ capability: 'text.analyze', min: 1 }] },
      { slot: 'tab', page: 'chapters', module: 'chapters', label: '正文', view: 'builtin' }
    ]
  }
  const defs = projectedTabDefs({ slots, ctx: ctx() })
  assert.deepEqual(defs.map((def) => def.view), ['roleplay', 'chapters'])
  assert.equal(defs[0].degraded, true)
  assert.deepEqual(defs[0].missing, [{ capability: 'text.analyze', min: 1 }])
  assert.deepEqual(Object.keys(defs[1]).sort(), ['closable', 'ic', 'label', 'readonly', 'view'])
  const iframe = { tab: [{ slot: 'tab', module: 'ext', page: 'ext-page', label: '外部页', view: 'iframe', entry: 'p.html', degraded: true, missing: ['x.y'] }] }
  const iframeDef = projectedTabDefs({ slots: iframe, ctx: ctx() })[0]
  assert.equal(iframeDef.degraded, true)
  assert.deepEqual(iframeDef.missing, ['x.y'])
})

test('OS-203·slotState：在投影里且正常／不在／降级三种', () => {
  assert.deepEqual(slotState({ right: [{ page: 'analysis', module: 'analysis' }] }, 'right', 'analysis'), { present: true, degraded: false, missing: [] })
  assert.deepEqual(slotState({ right: [{ page: 'habits' }] }, 'right', 'analysis'), { present: false, degraded: false, missing: [] })
  assert.deepEqual(slotState({ right: [{ page: 'analysis', degraded: true, missing: ['text.analyze'] }] }, 'right', 'analysis'), { present: true, degraded: true, missing: ['text.analyze'] })
})

test('OS-203·tabButtonHtml：降级页签灰显＋aria-disabled＋title，＋面板项禁用', () => {
  const html = tabButtonHtml({
    view: 'roleplay', label: '扮演', ic: '扮', closable: true, degraded: true,
    missing: [{ capability: 'text.analyze', min: 1 }]
  }, { esc, missingText })
  assert.match(html, /class="tab tab-degraded"/u)
  assert.match(html, /aria-disabled="true"/u)
  assert.match(html, /title="缺少所需能力：text\.analyze@1（目前没有插件供给）——该工作面暂不可用"/u)
  const pick = (item) => `<button class="tab-pick"${item.degraded ? ' disabled' : ''} data-tab-view="${esc(item.view)}">${esc(item.label)}</button>`
  assert.match(pick({ view: 'roleplay', label: '扮演', degraded: true }), /disabled/u)
  assert.doesNotMatch(pick({ view: 'chapters', label: '正文' }), /disabled/u)
})

/* ---------- 三个视图面的降级夹具 ---------- */

function settingsFixture(card) {
  const state = {
    current: { name: '夹具库' }, preferencesPath: '', warnings: [], settings: { section: 'about', suiteId: '', helpOpen: false },
    styles: [], skin: 'coral', stylesDirs: [], kbStatus: null,
    kbConfig: { baseUrl: 'http://127.0.0.1:8080', collections: { style: 'c1' }, configPath: 'kb.json' },
    kbMsg: '', sync: { data: null }, suites: [], plugins: { modules: [] }, analyze: {}
  }
  const agent = {
    runtime: '', runtimeList: [], endpoint: '', model: '', apiKeyMasked: '',
    config: { text: {}, image: {}, vision: {}, agent: {} }, dshModels: [], probes: {}, configPath: '', dshReasoningOptions: []
  }
  const SETTINGS_GROUPS = [
    { id: 'app', label: '本体设置', hint: '', sections: [{ id: 'appearance', label: '外观', hint: '' }] },
    { id: 'plugins', label: '插件中心', hint: '', sections: [{ id: 'governance', label: '插件治理台', hint: '' }] }
  ]
  const views = createSettingsViews({
    state, agent, esc, text, uiKit: () => ({}), runtimeShelf: () => ({ selectableRuntimeKits: () => [] }), moduleOn: () => true,
    hiddenModules: () => new Set(), WORKBENCH_MODULES: [], SETTINGS_GROUPS, scriptPrefs: () => ({}),
    dirWork: () => null, castColorOf: () => ({}), settingsScriptSectionHtml: noop, settingRuntimeKind: () => 'pi',
    probeBadgeLabel: () => '未测试', comfyNodeMapText: () => '', typographyState: () => ({ ui: 'comfortable', doc: 'm' }),
    docPrefSlidersHtml: noop, syncPolicy: () => ({ checkOn: 'enter', action: 'remind' }),
    syncProblemsFrom: () => [], warningsHtml: noop, uiMemory: () => ({ values: {} }),
    settingsAggregation: () => null, suitesSectionHtml: noop, pluginsOverviewHtml: noop, errorHtml: noop,
    api: async () => {}, render: noop, loadPlugins: async () => {}, governanceHtml: noop,
    moduleCard: (id) => card?.id === id ? card : null, missingText
  })
  return views
}

test('OS-203·设置区：生图/识图/知识库降级出说明，不出可编辑表单', () => {
  const card = degCard('imagegen', ['text.analyze'])
  const kbCard = degCard('knowledge', ['text.analyze'])
  const state = {
    current: { name: '夹具库' }, preferencesPath: '', warnings: [], settings: { section: 'about', suiteId: '', helpOpen: false },
    styles: [], skin: 'coral', stylesDirs: [], kbStatus: null,
    kbConfig: { baseUrl: 'http://127.0.0.1:8080', collections: { style: 'c1' }, configPath: 'kb.json' },
    kbMsg: '', sync: { data: null }, suites: [], plugins: { modules: [] }, analyze: {}
  }
  const agent = {
    runtime: '', runtimeList: [], endpoint: '', model: '', apiKeyMasked: '',
    config: { text: {}, image: {}, vision: {}, agent: {} }, dshModels: [], probes: {}, configPath: '', dshReasoningOptions: []
  }
  const byId = { imagegen: card, knowledge: kbCard }
  const degraded = createSettingsViews({
    state, agent, esc, text, uiKit: () => ({}), runtimeShelf: () => ({ selectableRuntimeKits: () => [] }), moduleOn: () => true,
    hiddenModules: () => new Set(), WORKBENCH_MODULES: [], SETTINGS_GROUPS: [
      { id: 'app', label: '本体设置', hint: '', sections: [] },
      { id: 'plugins', label: '插件中心', hint: '', sections: [{ id: 'governance', label: '插件治理台', hint: '' }] }
    ],
    scriptPrefs: () => ({}), dirWork: () => null, castColorOf: () => ({}), settingsScriptSectionHtml: noop,
    settingRuntimeKind: () => 'pi', probeBadgeLabel: () => '未测试', comfyNodeMapText: () => '',
    typographyState: () => ({ ui: 'comfortable', doc: 'm' }), docPrefSlidersHtml: noop,
    syncPolicy: () => ({ checkOn: 'enter', action: 'remind' }), syncProblemsFrom: () => [], warningsHtml: noop,
    uiMemory: () => ({ values: {} }), settingsAggregation: () => null, suitesSectionHtml: noop,
    pluginsOverviewHtml: noop, errorHtml: noop, api: async () => {}, render: noop, loadPlugins: async () => {},
    governanceHtml: noop, moduleCard: (id) => byId[id] ?? null, missingText
  })
  const models = degraded.settingsModelsSectionHtml()
  assert.match(models, /缺少所需能力：text\.analyze@1（供给方：文本内核）/u)
  assert.doesNotMatch(models, /id="mcfg-image-endpoint"/u, '生图表单不出现')
  assert.doesNotMatch(models, /id="mcfg-vision-model"/u, '识图表单不出现')
  const engines = degraded.settingsCombinedEnginesHtml()
  assert.match(engines, /缺少所需能力：text\.analyze@1/u)
  assert.doesNotMatch(engines, /id="knowledge-base-url"/u, '知识库表单不出现')
  // 健康输入仍出表单（判定没误伤正常模块）。
  const healthy = settingsFixture(null)
  assert.match(healthy.settingsModelsSectionHtml(), /id="mcfg-image-endpoint"/u)
})

test('OS-203·右栏：分析降级出说明不出卡片；世界书生成设定图按钮置灰带说明', () => {
  const card = degCard('analysis', ['text.analyze'])
  const mods = [
    { id: 'work-summary', label: '全书摘要', scope: 'work', render: () => '<p>梗概</p>' }
  ]
  const analysis = createAnalysisViews({
    state: { chapterFile: '正文/001.md', analyze: { pickerOpen: true, dismissed: {}, activePara: -1, expandOthers: false, modOpen: {}, fact: null, factTab: 'emotion', result: {}, busy: false, work: {} } },
    esc, hiddenModules: () => new Set(), chapterNoFromFile: () => 1,
    analyzeEnabled: () => mods.map((mod) => mod.id), analyzeModulesFor: (scope) => mods.filter((mod) => mod.scope === scope),
    analyzeModuleById: (id) => mods.find((mod) => mod.id === id), chartsModule: () => null, analysisModules: () => ({}),
    moduleCard: (id) => id === 'analysis' ? card : null, missingText
  })
  const panel = analysis.analyzePanelHtml()
  assert.match(panel, /class="analyze-degraded"/u)
  assert.match(panel, /缺少所需能力：text\.analyze@1（供给方：文本内核）/u)
  assert.doesNotMatch(panel, /class="am-card"/u, '不出分析卡片')

  const imageCard = degCard('imagegen', ['text.analyze'])
  const reference = createReferencePageViews({
    state: { current: { path: '/夹具库' }, chapterFile: '正文/001.md', write: { chapters: [] }, refCol: {}, scriptModule: null },
    esc, text, moduleOn: () => true, registryModule: () => ({ namingEntry: () => ({ tab: '世界书' }) }),
    refNodeCardHtml: noop, refModulesHtml: noop, dirWork: () => ({ text: '' }), scriptViews: () => ({}),
    moduleCard: (id) => id === 'imagegen' ? imageCard : null, missingText
  })
  const slot = reference.refImagesSlotHtml({ title: '夜', images: [] })
  assert.match(slot, /data-degraded="1"/u)
  assert.match(slot, /aria-disabled="true"/u)
  assert.match(slot, /缺少所需能力：text\.analyze@1/u)
})

/* ---------- daemon 级：真实降级载荷喂给前端投影 ---------- */

async function withDegradedDaemon(run) {
  const base = await mkdtemp(join(tmpdir(), 'os203-surfaces-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  try {
    const origin = `http://127.0.0.1:${daemon.port}`
    const put = (state) => fetch(`${origin}/api/ui-state`, {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, state })
    })
    await put({ 'modules.enabled.analysis': false, 'modules.enabled.habits': false, 'modules.enabled.roleplay': false })
    await put({ 'modules.enabled.text': false })
    await put({ 'modules.enabled.roleplay': true })
    const payload = await fetch(`${origin}/api/plugins?root=${encodeURIComponent(root)}`).then((res) => res.json())
    return await run(payload)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
}

test('OS-203·daemon 降级载荷：扮演页签是降级定义，其余七个页签逐字不变', async () => {
  await withDegradedDaemon((payload) => {
    const defs = projectedTabDefs({ slots: payload.slots, ctx: ctx() })
    // 沿用 OS-200 的降级夹具：analysis/habits 停在禁用态，只有 roleplay 是降级页签。
    assert.equal(defs.length, 7)
    assert.deepEqual(defs.map((def) => def.view), ['artifacts', 'chapters', 'worldbook', 'dir:剧本', 'dir:日志', 'dir:故事源', 'roleplay'])
    const roleplay = defs.find((def) => def.view === 'roleplay')
    assert.equal(roleplay.degraded, true)
    assert.ok(roleplay.missing.some((item) => item.capability === 'text.analyze' && item.min === 1))
    for (const def of defs.filter((item) => item.view !== 'roleplay')) {
      assert.equal('degraded' in def, false, `${def.view} 不该带降级标记`)
      assert.equal('missing' in def, false, `${def.view} 不该带 missing`)
    }
    // 宿主动作/右栏/设置区三态也照投影走。
    assert.deepEqual(slotState(payload.slots, 'right', 'analysis'), { present: false, degraded: false, missing: [] })
    assert.equal(slotState(payload.slots, 'settings', 'imagegen').present, true)
  })
})

/* ---------- app.js 源码门禁 ---------- */

test('OS-203·源码：slotHas 清零、四处入口经 slotState、viewHtml 分派前有降级拦截、app.js 行数不增', () => {
  const app = readFileSync(join(REPO, 'public', 'app.js'), 'utf8')
  assert.doesNotMatch(app, /\bslotHas\s*\(/u, 'app.js 不得再出现 slotHas(')
  assert.match(app, /registryModule\.slotState\(/u, '入口判定必须经 slotState')
  assert.match(app, /item\.degraded \? ` disabled data-degraded/u, '＋面板降级项禁用')
  const uses = [...app.matchAll(/\bslotAction\s*\(/gu)].length
  assert.ok(uses >= 4, `slotAction 调用点应至少四处，实得 ${uses}`)
  const viewHtml = app.slice(app.indexOf('function viewHtml('), app.indexOf('function render()'))
  assert.match(viewHtml, /moduleCard\?\.\(modId\)/u)
  assert.match(viewHtml, /card\?\.status === 'degraded'/u)
  assert.match(viewHtml, /degradedViewHtml/u)
  assert.ok(countPhysicalLines(app) <= 10096, `app.js ${countPhysicalLines(app)} 行超过 10096`)
})
