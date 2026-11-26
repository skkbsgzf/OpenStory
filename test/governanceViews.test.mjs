/**
 * OS-201：插件治理台卡片流——模型、卡片、确认条、没开库、自报设置、降级、空态与接线。
 *
 * 夹具直接用 OS-200 的纯函数（projectModuleGraph/slotProjection）对内置 21 件生成
 * /api/plugins 形状载荷，不手抄名单；测试只用内存对象，不碰真库与本机目录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MODULE_MANIFESTS, CAPABILITY_SNAPSHOT } from '../src/protocol/modules.mjs'
import { BASE_GRAPH } from '../src/protocol/baseCapabilities.mjs'
import { projectModuleGraph } from '../src/protocol/capabilityGraph.mjs'
import { slotProjection } from '../src/protocol/slots.mjs'
import { BUILTIN_PAGE_IDS } from '../src/protocol/naming.mjs'
import * as settingsAggregation from '../public/views/settingsAggregation.mjs'
import {
  governanceModel, isGovernanceModule, pluginCardHtml, confirmStripHtml, governanceHtml, createGovernanceViews
} from '../public/views/governanceViews.mjs'
import { createSettingsViews } from '../public/views/settingsViews.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const esc = (value) => String(value ?? '').replace(/&/gu, '&amp;').replace(/</gu, '&lt;').replace(/>/gu, '&gt;').replace(/"/gu, '&quot;')
const text = (value) => String(value ?? '')
const navLabel = (id) => (id === 'engines' ? '引擎与存储' : text(id))
const deps = { esc, text, navLabel, settingsAggregation }

function buildPayload(overrides = {}) {
  const { projections } = projectModuleGraph({
    snapshot: CAPABILITY_SNAPSHOT, manifests: MODULE_MANIFESTS, state: {}, suiteState: {}, base: BASE_GRAPH
  })
  const modules = MODULE_MANIFESTS.map((manifest) => ({
    ...manifest,
    role: manifest.id === 'agentbar' || manifest.id === 'library' ? 'host-composition' : manifest.class,
    ...projections.get(manifest.id)
  }))
  const slots = slotProjection(MODULE_MANIFESTS, {}, { builtinPages: new Set(BUILTIN_PAGE_IDS) }).slots
  return { modules, slots, ...overrides }
}

const payload = buildPayload()
const model = () => governanceModel(payload, {}, { navLabel, settingsAggregation })
const cardOf = (id, from = model()) => {
  for (const group of from.groups) {
    const card = group.cards.find((item) => item.id === id)
    if (card) return card
  }
  throw new Error(`夹具里没有 ${id}`)
}
const cards = (id) => pluginCardHtml(cardOf(id), { esc, expanded: true })

test('OS-201·模型：三组 7/12/2 顺序固定，摘要按位置口径，surfaces 与 slots 一致', () => {
  const result = model()
  assert.equal(result.total, 21)
  assert.deepEqual(result.groups.map((group) => group.id), ['kernel', 'workbench', 'host'])
  assert.deepEqual(result.groups.map((group) => group.cards.length), [7, 12, 2])
  assert.equal(cardOf('fact', result).summary, '供给 7 项 · 被 10 件依赖')
  assert.match(cardOf('roleplay', result).summary, /页签/u)
  assert.match(cardOf('analysis', result).summary, /右栏/u)
  assert.match(cardOf('exchange', result).summary, /顶栏动作/u)
  assert.match(cardOf('imagegen', result).summary, /设置区/u)
  for (const module of payload.modules) {
    const card = cardOf(module.id, result)
    const expected = ['tab', 'right', 'settings', 'host-actions'].filter((slot) => (payload.slots[slot] ?? []).some((item) => item.module === module.id))
    assert.deepEqual(card.surfaces, expected, module.id)
  }
  assert.equal(cardOf('imagegen', result).jumpLabel, '引擎与存储')
})

test('OS-201·卡片：fact 金样/依赖方/不可停原因/连锁影响；roleplay 依赖有出处；imagegen 指路跳转', () => {
  const fact = cards('fact')
  assert.match(fact, /★金样/u)
  assert.equal((fact.match(/class="gov-dep"/gu) ?? []).length, 10, '10 个依赖方胶囊')
  assert.match(fact, /不可停的原因：/u)
  assert.match(fact, /连锁影响：生图与识图、日志/u)

  const roleplay = cards('roleplay')
  const dependRows = roleplay.match(/class="gov-line"/gu) ?? []
  assert.equal(dependRows.length, 4)
  for (const name of ['推演引擎', '事实内核', '正文内核', '文本内核']) {
    assert.ok(roleplay.includes(name), `依赖行缺供给方名：${name}`)
  }
  assert.match(roleplay, /class="gov-pointer"/u)
  assert.doesNotMatch(roleplay, /data-settings-section=/u, 'roleplay 有指路但没有跳转按钮')

  const imagegen = cards('imagegen')
  assert.match(imagegen, /去 引擎与存储 →/u)
  assert.match(imagegen, /data-settings-section="engines"/u)
  assert.doesNotMatch(cards('fact'), /class="gov-pointer"/u, '内核件不出空指路框')
})

test('OS-201·卡片：工作台开关与内核件/宿主组合面锁；宿主身份说明；名称转义', () => {
  const workbench = pluginCardHtml(cardOf('roleplay'), { esc })
  assert.match(workbench, /role="switch"/u)
  assert.match(workbench, /aria-checked="true"/u)
  const kernel = pluginCardHtml(cardOf('fact'), { esc })
  assert.doesNotMatch(kernel, /role="switch"/u)
  assert.match(kernel, /class="gov-lock"/u)
  assert.match(kernel, /title="不可停：/u)
  const host = cards('agentbar')
  assert.doesNotMatch(host, /role="switch"/u)
  assert.match(host, /class="gov-lock"/u)
  assert.match(host, /随宿主走/u)
  const evil = { ...cardOf('roleplay'), name: '<script>alert("x")</script>' }
  const escaped = pluginCardHtml(evil, { esc })
  assert.doesNotMatch(escaped, /<script>/u)
  assert.match(escaped, /&lt;script&gt;/u)
  assert.match(escaped, /&quot;/u)
})

test('OS-201·确认条：四种位置逐条生成＋固定收尾；不复述指路；多位置连写；降级多一句；停用不出确认条', () => {
  assert.match(confirmStripHtml(cardOf('roleplay')), /停用后，页签「扮演」从导航消失。/u)
  assert.match(confirmStripHtml(cardOf('analysis')), /停用后，正文右栏里它的卡片收起。/u)
  assert.match(confirmStripHtml(cardOf('imagegen')), /停用后，设置页里它的配置区收起，已填的值保留。/u)
  assert.match(confirmStripHtml(cardOf('exchange')), /停用后，顶栏的「导入导出」入口收起。/u)
  for (const card of model().groups.flatMap((group) => group.cards)) {
    const strip = confirmStripHtml(card)
    assert.match(strip, /库内数据与配置全部保留，重新启用即恢复。/u)
    assert.doesNotMatch(strip, /真配置在/u, '确认条不复述 settingsHint')
  }
  const multi = confirmStripHtml({ ...cardOf('roleplay'), surfaces: ['tab', 'right'] })
  assert.match(multi, /页签「扮演」从导航消失/u)
  assert.match(multi, /正文右栏里它的卡片收起/u)
  const degraded = confirmStripHtml({ ...cardOf('roleplay'), status: 'degraded', missing: ['text.analyze'] })
  assert.match(degraded, /它现在缺 text\.analyze；停用后再启用仍是降级，直到依赖恢复。/u)
  const off = pluginCardHtml({ ...cardOf('roleplay'), status: 'disabled' }, { esc, expanded: true, confirming: true })
  assert.doesNotMatch(off, /class="gov-confirm"/u)
})

test('OS-201·没开库：开关置灰并提示先开库；页头写未打开库', () => {
  const views = createGovernanceViews({
    ...deps, state: { current: null, plugins: payload }, uiMemory: () => ({ values: {} }),
    loadPlugins: async () => {}, render: () => {}, setModuleEnabled: async () => {}, uiSet: () => {}
  })
  const html = views.governanceHtml()
  assert.match(html, /未打开库/u)
  assert.match(html, /disabled title="先打开一个库——启停按库分别记"/u)
  assert.match(html, /供给 7 项 · 被 10 件依赖/u, '没开库时能力照常可看')
  assert.match(html, /右栏 · 依赖 1 项/u, '没开库时依赖照常可看')
})

test('OS-201·自报设置项：表单值取 ui-state；停用整块只读且值保留', () => {
  const fixture = {
    modules: [{
      id: 'ext', name: '外部工作台', class: 'workbench', role: 'workbench', version: '0.1.0',
      settings: [{ key: 'tone', label: '语气', type: 'string', default: '平实' }],
      settingsHint: '真配置在别处', slots: []
    }],
    slots: {}
  }
  const uiState = { 'modules.settings.ext.tone': '华丽' }
  const built = governanceModel(fixture, uiState, { navLabel, settingsAggregation })
  const card = cardOf('ext', built)
  assert.equal(card.settings[0].value, '华丽')
  const enabledHtml = pluginCardHtml(card, { esc, expanded: true })
  assert.match(enabledHtml, /class="gov-field"/u)
  assert.match(enabledHtml, /value="华丽"/u)
  assert.doesNotMatch(enabledHtml, /disabled/u)

  const disabledHtml = pluginCardHtml({ ...card, status: 'disabled', enabled: false, settings: card.settings.map((setting) => ({ ...setting, editable: false })) }, { esc, expanded: true })
  assert.match(disabledHtml, /value="华丽"/u, '停用不清值')
  assert.match(disabledHtml, /disabled/u)
})

test('OS-201·降级夹具：状态/摘要/打叉行/恢复办法（无供给方）', () => {
  const fixture = {
    modules: [{
      id: 'ext', name: '外部工作台', class: 'workbench', role: 'workbench', version: '0.1.0',
      status: 'degraded', missing: [{ capability: 'cap.none', min: 1, maxExclusive: 2 }],
      requires: [{ id: 'cap.none', min: 1, maxExclusive: 2, provider: '', ok: false, reason: 'CAPABILITY_NOT_REGISTERED' }],
      slots: []
    }],
    slots: {}
  }
  const card = cardOf('ext', governanceModel(fixture, {}, deps))
  assert.equal(card.status, 'degraded')
  assert.equal(card.summary, '降级 · 缺 cap.none')
  const html = pluginCardHtml(card, { esc, expanded: true })
  assert.match(html, /class="gov-card gov-workbench[^"]*degraded"/u)
  assert.match(html, /class="gov-mark bad">✗/u)
  assert.match(html, /需要一件供给 cap\.none 的插件。/u)
})

test('OS-201·空态：null／畸形载荷不抛错，如实写拿不到插件清单', () => {
  assert.doesNotThrow(() => governanceModel(null))
  assert.deepEqual(governanceModel(null).groups.map((group) => group.cards.length), [0, 0, 0])
  assert.doesNotThrow(() => governanceModel({ modules: 'bad', slots: 3 }))
  assert.match(governanceHtml(), /拿不到插件清单：/u)
  assert.match(governanceHtml({ state: { plugins: { slots: null, error: 'BOOM' } } }), /BOOM/u)
  assert.doesNotMatch(governanceHtml(), /roleplay/u, '空态不退回写死名单')
})

test('OS-201·视图源码与 app.js 接线：零 import、无动态代码/存储，补丁写回并回填内存', () => {
  const view = readFileSync(join(REPO, 'public/views/governanceViews.mjs'), 'utf8')
  assert.doesNotMatch(view, /^\s*import\s|import\s*\(/mu, '视图零 import')
  assert.doesNotMatch(view, /\beval\s*\(|\bnew\s+Function\b|\bwith\s*\(|localStorage|sessionStorage|indexedDB/u)
  assert.match(view, /^function governanceHtml\(/mu)
  const app = readFileSync(join(REPO, 'public/app.js'), 'utf8')
  assert.doesNotMatch(app, /plugin-module-toggle/u)
  assert.doesNotMatch(app, /plugin-module-setting/u)
  const start = app.indexOf('async function setModuleEnabled(')
  assert.ok(start >= 0, 'app.js 有 setModuleEnabled')
  const body = app.slice(start, app.indexOf('\n}', start))
  assert.match(body, /\/api\/ui-state/u)
  assert.match(body, /modules\.enabled/u)
  assert.match(body, /loadUiState\(\)/u, '成功后以库为准回填内存')
  assert.doesNotMatch(body, /mem\.values/u, '不整份内存覆盖写回')
  assert.match(app, /governanceViewsReady/u, 'boot 等待治理台视图 ready')
})

test('OS-201·导航：治理台入口就位、旧 moduleSettings 深链重定向', () => {
  const SETTINGS_GROUPS = [
    { id: 'app', label: '本体设置', hint: '', sections: [{ id: 'appearance', label: '外观', hint: '皮肤' }] },
    { id: 'plugins', label: '插件中心', hint: '', sections: [{ id: 'governance', label: '插件治理台', hint: '能力图 · 启停 · 依赖 · 设置指路' }] }
  ]
  const state = { settings: { section: 'governance', helpOpen: false }, suites: [], plugins: payload, current: null }
  const views = createSettingsViews({
    state, esc, text, uiKit: () => ({}), runtimeShelf: () => ({}), moduleOn: () => true,
    hiddenModules: () => new Set(), WORKBENCH_MODULES: [], SETTINGS_GROUPS,
    scriptPrefs: () => ({}), dirWork: () => null, castColorOf: () => ({}), settingsScriptSectionHtml: () => '',
    settingRuntimeKind: () => '', probeBadgeLabel: () => '', comfyNodeMapText: () => '', typographyState: () => ({}),
    docPrefSlidersHtml: () => '', syncPolicy: () => ({}), syncProblemsFrom: () => [], warningsHtml: () => '',
    uiMemory: () => ({ values: {} }), settingsAggregation: () => settingsAggregation, suitesSectionHtml: () => '',
    pluginsOverviewHtml: () => '', errorHtml: () => '', api: () => {}, render: () => {}, loadPlugins: async () => {},
    governanceHtml: () => '<div class="gov">治理台已装载</div>'
  })
  const html = views.settingsHtml()
  assert.match(html, /插件治理台/u)
  assert.doesNotMatch(html, /data-settings-section="moduleSettings"/u)
  state.settings.section = 'moduleSettings'
  assert.match(views.settingsHtml(), /治理台已装载/u, '旧 id 深链仍渲染治理台')
})

// OS-201a：21 件模块 + 货架条目的真实混合载荷（货架来自五类货架清单，class:'suite'）。
const suiteEntries = [
  { id: 'suite-skill-zz1', name: '货架甲ZZZ', class: 'suite', role: 'suite', version: '1.0.0',
    settings: [{ key: 'tone', label: '语气', type: 'string', default: '平实' }], settingsHint: '真配置在套件状态文件' },
  { id: 'suite-style-zz2', name: '货架乙ZZZ', class: 'suite', role: 'suite', version: '1.0.0',
    settingsHint: '真配置在套件状态文件' },
  { id: 'suite-genre-zz3', name: '货架丙ZZZ', class: 'suite', role: 'suite', version: '1.0.0' },
  { id: 'suite-forged-zz4', name: '伪装货架ZZZ', class: 'suite', role: 'suite', group: 'workbench', version: '1.0.0' }
]
const mixedPayload = buildPayload({ modules: [...payload.modules, ...suiteEntries] })

test('OS-201a·治理台只出 21 件模块：total 是模块数，三组 7/12/2，货架一条都不出卡', () => {
  const result = governanceModel(mixedPayload, {}, deps)
  assert.equal(result.total, 21, 'total 是模块数，不是 modules[] 长度')
  assert.deepEqual(result.groups.map((group) => group.cards.length), [7, 12, 2])
  for (const suite of suiteEntries) {
    for (const group of result.groups) {
      assert.ok(!group.cards.some((card) => card.id === suite.id), `${group.id} 组混进了货架 ${suite.id}`)
    }
  }
})

test('OS-201a·货架带 settings／非空 settingsHint 也不进治理台 HTML（不出 id、不出名称）', () => {
  const views = createGovernanceViews({
    ...deps, state: { current: null, plugins: mixedPayload }, uiMemory: () => ({ values: {} }),
    loadPlugins: async () => {}, render: () => {}, setModuleEnabled: async () => {}, uiSet: () => {}
  })
  const html = views.governanceHtml()
  for (const suite of suiteEntries) {
    assert.ok(!html.includes(suite.id), `治理台 HTML 出现货架 id：${suite.id}`)
    assert.ok(!html.includes(suite.name), `治理台 HTML 出现货架名称：${suite.name}`)
  }
  assert.match(html, /21 件/u, '页头计数仍是模块数')
})

test('OS-201a·isGovernanceModule：kernel／workbench／host-composition 为真，suite／畸形／空载荷为假', () => {
  assert.equal(isGovernanceModule({ class: 'kernel' }), true)
  assert.equal(isGovernanceModule({ class: 'workbench' }), true)
  assert.equal(isGovernanceModule({ role: 'host-composition' }), true)
  assert.equal(isGovernanceModule({ class: 'suite', role: 'suite' }), false)
  assert.equal(isGovernanceModule({ name: '没有归类' }), false)
  assert.equal(isGovernanceModule({}), false)
  assert.equal(isGovernanceModule(null), false)
})

test('OS-201a·回归护栏：货架伪造 group:"workbench" 也仍不出卡（判定看 class／role，不看 group）', () => {
  const forged = suiteEntries.find((entry) => entry.group === 'workbench')
  assert.ok(forged)
  assert.equal(isGovernanceModule(forged), false)
  const result = governanceModel(mixedPayload, {}, deps)
  for (const group of result.groups) {
    assert.ok(!group.cards.some((card) => card.id === forged.id), `${group.id} 组被伪造 group 骗到`)
  }
})

test('OS-201a·展开入口：expandedId 命中卡片默认展开，未命中保持原行为', () => {
  const view = { ...deps, state: { plugins: payload, current: null }, uiMemory: () => ({ values: {} }) }
  const cardHtml = (html, id) => {
    const at = html.indexOf(`data-gov-id="${id}"`)
    assert.ok(at >= 0, `没找到卡片 ${id}`)
    const start = html.lastIndexOf('<article', at)
    const end = html.indexOf('</article>', at)
    return html.slice(start, end + '</article>'.length)
  }
  const located = governanceHtml(view, { expandedId: 'roleplay' })
  assert.match(cardHtml(located, 'roleplay'), /class="gov-card gov-workbench open"/u)
  assert.match(cardHtml(located, 'roleplay'), /class="gov-body"/u)
  assert.doesNotMatch(cardHtml(located, 'fact'), /class="gov-body"/u, '未命中的卡不展开')
  const plain = governanceHtml(view)
  assert.doesNotMatch(cardHtml(plain, 'roleplay'), /class="gov-body"/u, '没有 expandedId 时行为不变')
})
