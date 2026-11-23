/**
 * OS-145 / G6：设置归一——聚合纯函数、模块自报设置 schema、旧键一次性迁移。
 *
 * 钉死四件事：
 *   ① 三个模块 manifest 的 settings 是可渲染声明（key/label/type/default[/options]），过形状校验；
 *   ② aggregateSettings 输出渲染用分组：内核设置只读；模块设置按 schema 补齐值，停用＝不可编辑；
 *   ③ 停用模块的设置值**保留**（值照样读出来），重新启用即刻恢复；
 *   ④ 旧键迁移只跑一次：marker 就位后不覆盖新值；旧值坏档不抛错。
 *
 * 纯函数全部来自 public/views/settingsAggregation.mjs（零 import，Node 可直接跑）。
 * 夹具只用内存对象——不落盘、不碰作者真库。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  KERNEL_SETTINGS,
  LEGACY_SETTING_MIGRATIONS,
  SETTINGS_MARKER_KEY,
  SETTINGS_MARKER_VERSION,
  aggregateSettings,
  coerceSettingValue,
  migrateLegacySettings,
  moduleSettingKey,
  normalizeSettingsSchema,
  normalizeSettingValue,
  renderSettingsModules
} from '../public/views/settingsAggregation.mjs'
import { loadModuleManifests, validateModuleManifest } from '../src/protocol/modules.mjs'

const MODULES = [
  {
    id: 'analysis',
    name: '分析',
    description: '分析引擎',
    settings: [
      { key: 'analyze.enabled', label: '启用右栏分析卡片', type: 'boolean', default: true },
      { key: 'analyze.deAiThreshold', label: '去 AI 味阈值', type: 'number', default: 45 }
    ]
  },
  {
    id: 'comfyui',
    name: '生图与识图',
    description: '生图后端',
    settings: [
      { key: 'image.backend', label: '生图后端', type: 'select', options: ['openai', 'comfyui'], default: 'openai' },
      { key: 'image.comfyUrl', label: 'ComfyUI 地址', type: 'string', default: 'http://127.0.0.1:8188' }
    ]
  },
  {
    id: 'kb',
    name: '知识库',
    description: '知识库连接',
    settings: [
      { key: 'kb.baseUrl', label: '服务地址', type: 'string', default: 'http://127.0.0.1:8080' },
      { key: 'kb.autoTest', label: '自动测试', type: 'boolean', default: false }
    ]
  }
]

test('聚合：内核组只读＋模块组按 schema 渲染，模块按 id 稳定排序', () => {
  const state = {
    [moduleSettingKey('comfyui', 'image.backend')]: 'comfyui',
    [moduleSettingKey('analysis', 'analyze.enabled')]: false,
    [moduleSettingKey('kb', 'kb.autoTest')]: true
  }
  const agg = aggregateSettings({ modules: MODULES, enabled: {}, state })

  assert.equal(agg.version, 1)
  assert.deepEqual(agg.groups.map((group) => group.id), ['kernel', 'modules'])

  const kernel = agg.groups[0]
  assert.equal(kernel.ownedBy, 'host')
  assert.equal(kernel.editable, false, '内核设置不插件化，永远只读')
  assert.deepEqual(kernel.settings.map((item) => item.id), KERNEL_SETTINGS.map((item) => item.id))
  for (const item of kernel.settings) assert.equal(item.editable, false)

  const group = agg.groups[1]
  assert.equal(group.ownedBy, 'module')
  assert.deepEqual(group.modules.map((module) => module.id), ['analysis', 'comfyui', 'kb'], '按 id 稳定排序')

  const comfy = group.modules.find((module) => module.id === 'comfyui')
  assert.equal(comfy.editable, true)
  assert.equal(comfy.settings[0].value, 'comfyui', '已存值优先于 default')
  assert.equal(comfy.settings[0].stored, true)
  assert.equal(comfy.settings[1].value, 'http://127.0.0.1:8188', '没存过＝回落 default')

  // 每个设置项都要有渲染需要的字段
  for (const module of group.modules) {
    for (const setting of module.settings) {
      assert.ok(setting.key, '缺 key')
      assert.ok(setting.label, '缺 label')
      assert.ok(['string', 'number', 'boolean', 'select'].includes(setting.type), 'type 非法')
      assert.ok(Object.prototype.hasOwnProperty.call(setting, 'value'), '缺 value')
      assert.equal(setting.editable, module.enabled)
    }
  }
})

test('停用模块：不可编辑但值保留；重新启用只改 enabled/editable', () => {
  const state = {
    [moduleSettingKey('analysis', 'analyze.enabled')]: false,
    [moduleSettingKey('analysis', 'analyze.deAiThreshold')]: 70
  }
  const disabled = aggregateSettings({ modules: MODULES, enabled: { analysis: false }, state })
  const analysis = disabled.groups[1].modules.find((module) => module.id === 'analysis')
  assert.equal(analysis.enabled, false)
  assert.equal(analysis.editable, false, '停用＝设置区压暗、不可编辑')
  for (const setting of analysis.settings) assert.equal(setting.editable, false)
  assert.equal(analysis.settings[0].value, false, '停用不清值')
  assert.equal(analysis.settings[1].value, 70, '停用不清值')

  const enabled = aggregateSettings({ modules: MODULES, enabled: { analysis: true }, state })
  const back = enabled.groups[1].modules.find((module) => module.id === 'analysis')
  assert.equal(back.enabled, true)
  assert.equal(back.editable, true)
  assert.equal(back.settings[1].value, 70, '重新启用后值原样回来')
})

test('聚合：坏 manifest / 坏值不崩——跳过坏项，值回落 default', () => {
  const agg = aggregateSettings({
    modules: [
      null,
      { id: 'x', settings: 'not-an-array' },
      { id: 'y', settings: [{ key: 'ok', type: 'boolean', default: true }, { key: 'bad', type: 'nope' }, { type: 'string' }] },
      { name: '没有 id' }
    ],
    enabled: null,
    state: { 'modules.settings.y.ok': '这是字符串不是布尔' }
  })
  const ids = agg.groups[1].modules.map((module) => module.id)
  assert.deepEqual(ids, ['x', 'y'], '没有 id 的模块不进聚合')
  const y = agg.groups[1].modules.find((module) => module.id === 'y')
  assert.deepEqual(y.settings.map((setting) => setting.key), ['ok'], '非法 type / 缺 key 的项被跳过')
  assert.equal(y.settings[0].value, true, '坏值回落 default')
  assert.equal(y.settings[0].stored, false)
})

test('渲染：停用模块整卡带 mp-off 且控件 disabled；启用模块可编辑', () => {
  const agg = aggregateSettings({ modules: MODULES, enabled: { kb: false }, state: {} })
  const esc = (value) => String(value ?? '').replace(/[&<>"]/gu, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]))
  const html = renderSettingsModules(agg, { esc })
  assert.match(html, /模块/u)
  assert.match(html, /内核设置/u, '内核设置属宿主的说明要在')
  assert.match(html, /data-action="plugin-module-toggle" data-module-id="kb"/u)
  assert.match(html, /mp-off/u, '停用模块整卡压暗')
  assert.match(html, /data-module-id="kb"[^>]*disabled/u, '停用模块的设置项不可编辑')
  assert.doesNotMatch(html, /data-module-id="comfyui"[^>]*disabled/u, '启用模块照常可编辑')
})

test('settings schema：类型闸只收四种，select 的值必须在 options 里', () => {
  assert.deepEqual(
    normalizeSettingsSchema([
      { key: 'a', type: 'boolean', default: true },
      { key: 'b', type: 'select', options: ['x', 'y'], default: 'x' },
      { key: 'c', type: 'json' }
    ]).map((setting) => setting.key),
    ['a', 'b']
  )
  assert.equal(normalizeSettingValue({ type: 'select', options: ['x'] }, 'z').ok, false)
  assert.deepEqual(normalizeSettingValue({ type: 'select', options: ['x'] }, 'x'), { ok: true, value: 'x' })
  assert.equal(normalizeSettingValue({ type: 'number' }, Number.NaN).ok, false)
  assert.equal(normalizeSettingValue({ type: 'boolean' }, 'true').ok, false, '字符串 true 不算布尔值')
  assert.equal(coerceSettingValue('number', '12'), 12)
  assert.equal(coerceSettingValue('boolean', 'false'), false)
  assert.equal(coerceSettingValue('number', 'abc'), undefined)
  assert.equal(coerceSettingValue('number', ''), undefined, '清空数字框不等于 0')
})

test('旧键迁移：只迁一次；第二次跑不覆盖新值；原对象不被修改', () => {
  const legacyState = {
    analyzeEnabled: true,
    image: { backend: 'comfyui' },
    'image.comfyUrl': 'http://127.0.0.1:9999',
    'kb.baseUrl': 'http://127.0.0.1:8080'
  }
  const first = migrateLegacySettings(legacyState)
  assert.equal(first.changed, true)
  assert.equal(first.marker, SETTINGS_MARKER_VERSION)
  assert.equal(first.state[SETTINGS_MARKER_KEY], SETTINGS_MARKER_VERSION)
  assert.equal(first.state[moduleSettingKey('analysis', 'analyze.enabled')], true)
  assert.equal(first.state[moduleSettingKey('comfyui', 'image.backend')], 'comfyui')
  assert.equal(first.state[moduleSettingKey('comfyui', 'image.comfyUrl')], 'http://127.0.0.1:9999')
  assert.equal(first.state[moduleSettingKey('kb', 'kb.baseUrl')], 'http://127.0.0.1:8080')
  assert.equal(legacyState[SETTINGS_MARKER_KEY], undefined, '不修改传入对象')
  assert.ok(first.applied.length >= 4)
  assert.deepEqual(LEGACY_SETTING_MIGRATIONS.map((rule) => `${rule.moduleId}:${rule.key}`), [
    'analysis:analyze.enabled',
    'comfyui:image.backend',
    'comfyui:image.comfyUrl',
    'comfyui:image.comfyWorkflow',
    'comfyui:image.comfyNodeMap',
    'kb:kb.baseUrl',
    'kb:kb.spaceId'
  ])

  // 作者后来改了值——第二次进库（marker 已在）绝不覆盖
  const edited = { ...first.state, [moduleSettingKey('comfyui', 'image.backend')]: 'openai' }
  const second = migrateLegacySettings(edited)
  assert.equal(second.changed, false)
  assert.equal(second.applied.length, 0)
  assert.equal(second.state[moduleSettingKey('comfyui', 'image.backend')], 'openai')

  // 新键已存在：旧键不覆盖新值（即使 marker 被删）
  const explicit = { 'image.backend': 'comfyui', [moduleSettingKey('comfyui', 'image.backend')]: 'openai' }
  const kept = migrateLegacySettings(explicit)
  assert.equal(kept.state[moduleSettingKey('comfyui', 'image.backend')], 'openai')
  assert.ok(kept.skipped.some((rule) => rule.reason === 'target-exists'))
})

test('旧键迁移：坏档不崩（数组/对象/数字全跳过），marker 仍写一次', () => {
  const broken = {
    analyzeEnabled: ['chapter-editorial', 'chapter-rhythm'], // OS-144 卡片级清单：不是布尔，不迁
    image: 'garbage',
    'image.comfyUrl': { nested: true },
    'kb.baseUrl': 42
  }
  let first
  assert.doesNotThrow(() => { first = migrateLegacySettings(broken) })
  assert.equal(first.changed, true)
  assert.equal(first.state[SETTINGS_MARKER_KEY], SETTINGS_MARKER_VERSION)
  assert.equal(first.applied.length, 0, '坏值一个都不迁')
  assert.ok(first.skipped.some((rule) => rule.reason === 'legacy-missing-or-invalid'))
  assert.equal(first.state[moduleSettingKey('analysis', 'analyze.enabled')], undefined)
  assert.deepEqual(first.state.analyzeEnabled, broken.analyzeEnabled, '旧卡片级清单原样保留')
  assert.equal(first.state.image, 'garbage', '坏档原样保留，不炸、不静默删')

  // 再跑一次：marker 在，什么都不做
  const again = migrateLegacySettings(first.state)
  assert.equal(again.changed, false)

  // 完全坏掉的输入（null/数组）也不崩
  assert.doesNotThrow(() => migrateLegacySettings(null))
  assert.doesNotThrow(() => migrateLegacySettings([]))
  assert.equal(migrateLegacySettings(null).changed, true, '空状态也要落 marker，避免每次重复扫')
})

test('三个模块 manifest 的 settings 都是合法可渲染声明', () => {
  const { manifests, warnings } = loadModuleManifests()
  assert.deepEqual(warnings, [])
  assert.deepEqual(manifests.map((manifest) => manifest.id).sort(), ['analysis', 'comfyui', 'kb'])
  for (const manifest of manifests) {
    assert.ok(manifest.settings.length > 0, `${manifest.id} 没自报设置项`)
    for (const setting of manifest.settings) {
      assert.match(setting.key, /^[\w.]{1,40}$/u)
      assert.ok(setting.label, `${manifest.id}:${setting.key} 缺 label`)
      assert.ok(['string', 'number', 'boolean', 'select'].includes(setting.type), `${manifest.id}:${setting.key} type 非法`)
      if (setting.type === 'select') {
        assert.ok(Array.isArray(setting.options) && setting.options.length > 0, `${manifest.id}:${setting.key} 缺 options`)
        assert.ok(setting.options.includes(setting.default), `${manifest.id}:${setting.key} default 不在 options 里`)
      }
    }
  }
  // 形状校验能拦住坏声明（不是静默放过）
  const badSelect = validateModuleManifest({
    spec: 'openstory-module@1',
    id: 'demo',
    name: '演示',
    version: '0.1.0',
    core: false,
    endpoints: [],
    pages: [],
    settings: [{ key: 'x.y', label: 'X', type: 'select', options: [] }]
  })
  assert.equal(badSelect.ok, false)
  const badType = validateModuleManifest({
    spec: 'openstory-module@1',
    id: 'demo',
    name: '演示',
    version: '0.1.0',
    core: false,
    endpoints: [],
    pages: [],
    settings: [{ key: 'x.y', label: 'X', type: 'json', default: '{}' }]
  })
  assert.equal(badType.ok, false)
})
