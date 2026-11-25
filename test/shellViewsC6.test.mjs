/** C6：六个前端渲染面的静态导入、HTML 金样、异步依赖晚绑定与壳迁移门禁。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSettingsViews } from '../public/views/settingsViews.mjs'
import { createAnalysisViews } from '../public/views/analysisViews.mjs'
import { createAgentViews } from '../public/views/agentViews.mjs'
import { createLibraryFlowViews } from '../public/views/libraryFlowViews.mjs'
import { createSyncViews } from '../public/views/syncViews.mjs'
import { createReferencePageViews } from '../public/views/referencePageViews.mjs'
import { countPhysicalLines } from '../tools/arch-stats.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const esc = (value) => String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
const text = (value) => String(value ?? '')
const formatAt = (value) => `时间:${text(value)}`
const noop = () => ''

function settingsFixture() {
  const state = {
    current: { name: '长夜' }, preferencesPath: '', warnings: [], settings: { section: 'about', suiteId: '', helpOpen: false },
    styles: [{ id: 'coral', name: '珊瑚', source: '内置', description: '默认' }], skin: 'coral', stylesDirs: [],
    kbStatus: null, kbConfig: null, kbMsg: '', sync: { data: null }, suites: [], plugins: { modules: [] }, analyze: {}
  }
  const agent = { runtime: '', runtimeList: [], endpoint: '', model: '', apiKeyMasked: '', config: null, dshModels: [], probes: {}, configPath: '', dshReasoningOptions: [] }
  let kit = null
  let shelf = null
  let aggregation = null
  const views = createSettingsViews({
    state, agent, esc, text, uiKit: () => kit, runtimeShelf: () => shelf, moduleOn: () => true,
    hiddenModules: () => new Set(), WORKBENCH_MODULES: [], SETTINGS_GROUPS: [], scriptPrefs: () => ({}),
    dirWork: () => null, castColorOf: () => ({}), settingsScriptSectionHtml: noop, settingRuntimeKind: () => 'pi',
    probeBadgeLabel: () => '未测试', comfyNodeMapText: () => '', typographyState: () => ({ ui: 'comfortable', doc: 'm' }),
    docPrefSlidersHtml: () => '<div class="sliders"></div>', syncPolicy: () => ({ checkOn: 'enter', action: 'remind' }),
    syncProblemsFrom: () => [], warningsHtml: () => '', uiMemory: () => ({ values: {} }),
    settingsAggregation: () => aggregation, suitesSectionHtml: noop, pluginsOverviewHtml: noop, errorHtml: noop
  })
  return { views, state, agent, setKit: (value) => { kit = value }, setShelf: (value) => { shelf = value }, setAggregation: (value) => { aggregation = value } }
}

test('settingsViews：模型/字号/知识库金样；uiKit、runtimeShelf、聚合模块均晚绑定', () => {
  const fx = settingsFixture()
  assert.match(fx.views.settingsRuntimeSectionHtml(), /Agent 运行时/u)
  assert.match(fx.views.settingsTypographySectionHtml(), /data-action="typo-ui"/u)
  assert.match(fx.views.settingsTypographySectionHtml(), /data-action="typo-doc"/u)
  assert.match(fx.views.settingsCombinedDataSectionHtml(), /data-action="sync-policy-checkon"/u)
  assert.match(fx.views.settingsHtml(), /<h1>设置<\/h1>/u)
  assert.match(fx.views.settingsModuleSettingsSectionHtml(), /正在读取模块清单/u)

  fx.setShelf({ selectableRuntimeKits: () => [{ id: 'dsh', name: 'DSH', source: '本机' }] })
  fx.agent.config = { text: { endpoint: 'http://127.0.0.1/v1', model: 'local' }, image: { backend: 'comfyui' }, vision: {}, agent: {} }
  fx.agent.runtime = 'dsh'
  const models = fx.views.settingsModelsSectionHtml()
  assert.match(models, /value="dsh" selected/u)
  assert.match(models, /data-cfg-card="image"/u)
  assert.match(models, /id="mcfg-comfy-nodemap"/u)

  fx.setKit({ field: ({ control }) => `<label>${control}</label>`, textInput: ({ id, value }) => `<input id="${esc(id)}" value="${esc(value)}">` })
  fx.state.kbConfig = { baseUrl: 'http://127.0.0.1:8080', collections: { style: 'c1' }, configPath: 'kb.json' }
  const kb = fx.views.settingsKbSectionHtml()
  assert.match(kb, /id="knowledge-base-url"/u)
  assert.match(kb, /data-knowledge-collection-alias value="style"/u)
  assert.match(kb, /data-action="knowledge-test"/u)

  fx.setAggregation({ moduleSettingsSectionHtml: () => '<div class="step">模块已装载</div>' })
  assert.match(fx.views.settingsModuleSettingsSectionHtml(), /模块已装载/u)
})

test('analysisViews：选择器、章节/作品卡与 SVG 金样；charts 和注册表晚绑定', () => {
  let charts = null
  let registry = null
  const mods = [
    { id: 'chapter-editorial', label: '编辑总评', scope: 'chapter', render: (_result, view) => `<b>${view.chapterNo}</b>` },
    { id: 'work-summary', label: '全书摘要', scope: 'work', render: (result) => `<p>${esc(result.summary)}</p>` }
  ]
  const state = { chapterFile: '正文/003-风雪.md', analyze: { pickerOpen: true, dismissed: {}, activePara: -1, expandOthers: false, modOpen: {}, fact: null, factTab: 'emotion', result: {}, busy: false, work: { 'work-summary': { result: { summary: '梗概' } } } } }
  const views = createAnalysisViews({
    state, esc, hiddenModules: () => new Set(), chapterNoFromFile: () => 3, analyzeEnabled: () => mods.map((mod) => mod.id),
    analyzeModulesFor: (scope) => mods.filter((mod) => mod.scope === scope), analyzeModuleById: (id) => mods.find((mod) => mod.id === id),
    chartsModule: () => charts, analysisModules: () => registry
  })
  const panel = views.analyzePanelHtml()
  assert.match(panel, /data-action="analyze-module-toggle"/u)
  assert.match(panel, /<b>3<\/b>/u)
  assert.match(panel, /<p>梗概<\/p>/u)
  assert.match(views.sparkline([-2, 0, 4]), /<svg class="spark"/u)
  assert.match(views.barRow({ label: '<节奏>', score: 120, detail: '过快' }), /width:100%/u)
  charts = { ready: true }
  registry = { ready: true }
  assert.equal(views.analyzeChapterView().charts, charts)
})

test('agentViews：会话/过程/正文产出金样；Markdown 模块晚绑定且文件判定不误报', () => {
  let mdReady = false
  let mdModule = null
  const agent = { sessions: [{ id: 's1', title: '\uFFFD', createdAt: '2026-01-01', messageCount: 2 }], sessionId: 's1', items: [], streaming: false, rejectedMsgs: {}, notices: [], lastError: '', cardError: null }
  const state = { current: { path: 'D:/长夜' }, agent, briefGenre: null }
  const views = createAgentViews({
    state, agent, esc, text, formatAt, getTempSessionId: () => 's1', getTempMode: () => 'fixed', mdReady: () => mdReady, mdModule: () => mdModule,
    updateComposerState: noop, updateAgentChip: noop
  })
  const sessions = views.sessionsHtml()
  assert.match(sessions, /历史标题编码损坏/u)
  assert.match(sessions, /2 条/u)
  assert.match(views.sessionTitle({ title: '正常' }, 0).label, /^正常$/u)
  const process = views.processBlockHtml({ thinking: '先读文件', tools: [{ name: 'read_file', input: { file_path: '正文/001.md' }, elapsedMs: 1200 }] })
  assert.match(process, /思考过程/u)
  assert.match(process, /data-action="tool-open"/u)
  assert.equal(views.proposedFiles({ content: '只是提到 正文/001-夜.md，没有可采纳正文。' }).length, 0)
  const draft = `正文/001-夜.md\n\`\`\`\n${'长'.repeat(90)}\n\`\`\``
  assert.deepEqual(views.proposedFiles({ content: draft }), ['正文/001-夜.md'])
  assert.match(views.proseOutputHtml(draft, ['正文/001-夜.md']), /class="prose-out"/u)
  assert.match(views.assistantBodyHtml({ content: '**回答**' }, false), /\*\*回答\*\*/u)
  mdReady = true
  mdModule = { renderMarkdown: (raw) => `<em>${esc(raw)}</em>` }
  assert.match(views.assistantBodyHtml({ content: '**回答**' }, false), /<em>\*\*回答\*\*<\/em>/u)
  assert.match(views.threadHtml(), /先选一个库|问剧情/u)
})

test('libraryFlowViews：新建/导入预览/报告/修复金样，路径拼接保持 Windows 语义', () => {
  let modal = ''
  const state = {
    create: { parent: 'D:/写作', name: '长夜', primary: 'openstory.carrier.novel', genre: '', length: null, deliverables: [], result: null, error: '' },
    genres: [], impo: { root: 'D:/长夜', source: 'D:/旧稿', running: false, error: '', plan: null, report: null },
    libraries: [{ path: 'D:/长夜', name: '长夜' }], current: { path: 'D:/长夜' }, repair: null, fsBrowse: null
  }
  const views = createLibraryFlowViews({
    state, esc, text, needLibraryHtml: () => '<div>请选库</div>', errorHtml: noop, warningsHtml: noop,
    unitLabel: () => '字', divideLabel: () => '章', deliverableLabel: () => '小说', openModal: (html) => { modal = html }
  })
  assert.equal(views.joinDir('D:\\写作\\', ' 长夜 '), 'D:\\写作\\长夜')
  assert.match(views.createHtml(), /将创建：D:\/写作\\长夜/u)
  assert.match(views.importHtml(), /源目录永远只读/u)
  assert.match(views.planHtml({ items: [{ decision: 'chapter', source: '旧/一.md', target: '正文/一.md' }] }), /正文 → 可导入|旧\/一.md → 正文\/一.md/u)
  assert.match(views.reportHtml({ written: [{ target: '正文/一.md' }], writeFailures: [] }), /同内容复用/u)
  state.repair = { path: 'D:/旧稿', shape: {}, verdict: { title: '发现稿件', detail: '可导入', action: 'import-here' } }
  assert.match(views.repairHtml(), /data-action="repair-import"/u)
  state.fsBrowse = { open: true, entries: [{ kind: 'folder', name: '长夜', path: 'D:/长夜' }], path: 'D:/', parent: '', loading: false, error: '', note: '', defaultRoot: '', lastPicked: '' }
  views.renderFsBrowserModal()
  assert.match(modal, /data-action="fsb-go"/u)
})

test('syncViews：异形回包不拖垮页面；过期/外部改动/提示横幅金样', () => {
  const state = { current: { path: 'D:/长夜' }, reference: { notes: [] }, sync: { data: null, error: '', prompt: null } }
  const views = createSyncViews({ state, esc, text, formatAt })
  assert.equal(views.syncBarHtml(), '')
  state.sync.data = 'bad-response'
  state.sync.error = '<离线>'
  assert.match(views.syncBarHtml(), /同源检查不可用/u)
  state.sync.data = { sameSource: { wikiStale: true, wikiNote: '派生档旧于事实源' }, external: { externalChanges: [{ path: '世界书/甲.md', reason: '外部改写' }] } }
  state.sync.openList = true
  const bar = views.syncBarHtml()
  assert.match(bar, /class="sync-bar bad"/u)
  assert.match(bar, /世界书\/甲.md/u)
  assert.match(bar, /data-action="sync-regen-wiki"/u)
  state.sync.prompt = { root: 'D:/长夜', problems: [{ label: '派生档过期' }, { label: '另一项' }] }
  assert.match(views.syncPromptHtml(), /另有 1 项/u)
})

test('referencePageViews：章节分组、图片槽、图谱与剧本人物金样；registry/scriptViews 晚绑定', () => {
  let registry = null
  let scriptViews = null
  let work = { text: '' }
  const state = { current: { path: 'D:/长夜' }, chapterFile: '正文/卷一/001-夜.md', write: { chapters: [{ file: '正文/卷一/001-夜.md', no: 1, title: '夜' }] }, refCol: { graph: null, summary: '', summaryBusy: false, summaryError: '' }, scriptModule: null }
  const views = createReferencePageViews({
    state, esc, text, moduleOn: () => false, registryModule: () => registry, refNodeCardHtml: () => '<div class="node-card"></div>',
    refModulesHtml: () => '<div class="modules"></div>', dirWork: () => work, scriptViews: () => scriptViews
  })
  assert.match(views.chapterTreeHtml(), /class="ct-vol">卷一/u)
  assert.match(views.chapterRowsHtml([]), /还没有章节/u)
  assert.match(views.refImagesSlotHtml({ title: '夜', images: ['世界书/夜.png'] }), /api\/reference\/asset/u)
  assert.match(views.refImagesSlotHtml({}), /class="ref-img-slot empty"/u)
  assert.match(views.graphModuleHtml(), /世界书图谱/u)
  registry = { namingEntry: () => ({ tab: '世界书', graphLabel: '关系图谱' }) }
  state.refCol.graph = { nodes: [{ id: 'n1' }], edges: [], stats: { nodes: 1, edges: 0, byKind: { worldbook: 1 } } }
  state.refCol.pick = 'n1'
  assert.match(views.graphModuleHtml(), /关系图谱|世界书/u)
  assert.match(views.graphModuleHtml(), /class="node-card"/u)
  assert.match(views.refColHtml(), /class="modules"/u)
  state.scriptModule = { splitScriptBlocks: () => [{ who: '林冲' }] }
  work = { text: '林冲：夜。' }
  scriptViews = { scriptCastHtml: () => '<div class="cast">林冲</div>' }
  assert.match(views.scriptCastHtml(), /class="cast"/u)
})

test('C6 壳门禁：app.js ≤10500 行、views ≥14 个；渲染本体只留转交壳且 boot 等待全部 ready', () => {
  const app = readFileSync(join(REPO, 'public/app.js'), 'utf8')
  assert.ok(countPhysicalLines(app) <= 10500, `app.js ${countPhysicalLines(app)} 行超过 C6 行数硬目标`)
  const viewFiles = readdirSync(join(REPO, 'public/views')).filter((name) => name.endsWith('.mjs'))
  assert.ok(viewFiles.length >= 14, 'views/.mjs 至少 14 个')
  const moved = {
    settingsViews: ['settingsModelsSectionHtml', 'settingsHtml', 'settingsKbSectionHtml'],
    analysisViews: ['analyzePanelHtml', 'analyzeChapterView'],
    agentViews: ['threadHtml', 'processBlockHtml', 'renderAgent'],
    libraryFlowViews: ['createHtml', 'importHtml', 'repairHtml'],
    syncViews: ['syncBarHtml', 'syncPromptHtml'],
    referencePageViews: ['chapterTreeHtml', 'graphModuleHtml', 'refImagesSlotHtml']
  }
  for (const [moduleName, names] of Object.entries(moved)) {
    const source = readFileSync(join(REPO, `public/views/${moduleName}.mjs`), 'utf8')
    assert.doesNotMatch(source, /^\s*import\s|import\s*\(/u, `${moduleName} 不引入模块`)
    assert.doesNotMatch(source, /\beval\s*\(|\bnew\s+Function\b|\bwith\s*\(|localStorage|sessionStorage|indexedDB/u, `${moduleName} 不破坏 CSP/本地化`)
    for (const name of names) {
      assert.match(source, new RegExp(`^function ${name}\\(`, 'mu'), `${name} 本体应住 views`)
      assert.match(app, new RegExp(`^function ${name}\\([^\\n]*\\{ return ${moduleName}\\?\\.${name}\\(`, 'mu'), `${name} 在 app.js 只留转交壳`)
    }
    assert.match(app, new RegExp(`\\b${moduleName}Ready\\b`), `${moduleName} ready 应接入 boot`)
  }
  const boot = app.slice(app.indexOf('async function boot()'), app.indexOf('async function openLibrary('))
  for (const moduleName of Object.keys(moved)) assert.match(boot, new RegExp(`\\b${moduleName}Ready\\b`))
})
