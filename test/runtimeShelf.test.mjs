/**
 * OpenStory OS-149（G8e）用例——fixture 套件隐身：形状闸、内置 echo-kit 标记、货架过滤纯函数。
 *
 * 跑法：node --test test/runtimeShelf.test.mjs
 *
 * 边界：echo-kit 是 kit 作者的骨架模板＋测试夹具（runtimes.test.mjs 端到端要用它），
 * 所以它必须**照常装载**，只是不进作者可见的运行时货架与下拉。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { builtinRuntimesDir, loadRuntimeKits, normalizeRuntimeKit } from '../src/services/runtimes.mjs'
import {
  AGENT_CHIP_FALLBACK,
  RUNTIME_SHELF_GROUPS,
  agentChipView,
  isFixtureRuntime,
  pluginOverviewItems,
  pluginOverviewStats,
  runtimeKitsByCategory,
  selectableRuntimeKits,
  visibleRuntimeKits
} from '../public/views/runtimeShelf.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

const FIXTURE_SIDECAR = {
  schemaVersion: 'openstory-runtime-kit@1',
  id: 'fixture-kit',
  name: '夹具套件',
  kind: 'sidecar',
  command: { cmd: 'node', args: ['server.mjs'], cwd: '.' },
  chatPath: '/v1/chat/completions',
  healthPath: '/healthz',
  port: 'allocate'
}

test('runtimes：fixture 只收布尔，缺省 false，true 照实带出', () => {
  const absent = normalizeRuntimeKit({ ...FIXTURE_SIDECAR }, { source: '内置', dir: 'D:/kits/a' })
  assert.equal(absent.ok, true)
  assert.equal(absent.kit.fixture, false, '缺省 fixture=false')

  const flagged = normalizeRuntimeKit({ ...FIXTURE_SIDECAR, fixture: true }, { source: '内置', dir: 'D:/kits/b' })
  assert.equal(flagged.ok, true)
  assert.equal(flagged.kit.fixture, true)

  const explicitFalse = normalizeRuntimeKit({ ...FIXTURE_SIDECAR, fixture: false }, { source: '内置', dir: 'D:/kits/c' })
  assert.equal(explicitFalse.ok, true)
  assert.equal(explicitFalse.kit.fixture, false)

  const bad = normalizeRuntimeKit({ ...FIXTURE_SIDECAR, fixture: 'true' }, { source: '内置', dir: 'D:/kits/d' })
  assert.equal(bad.ok, false, '字符串 fixture 是坏档')
  assert.equal(bad.warning.code, 'RUNTIME_KIT_FIXTURE')
})

test('runtimes：内置 echo-kit 仍在货架上，且已被标成 fixture（不删除、不改名）', () => {
  const { kits } = loadRuntimeKits([builtinRuntimesDir()])
  const echo = kits.find((kit) => kit.id === 'echo-kit')
  assert.ok(echo, 'echo-kit 必须照常装载（测试夹具要用）')
  assert.equal(echo.name, '回声参考套件')
  assert.equal(echo.fixture, true)
  assert.equal(kits.find((kit) => kit.id === 'cli-codebuddy')?.fixture, false, '产品套件不受影响')
})

test('runtimeShelf：可见清单去掉 fixture:true，缺字段/坏档不误伤', () => {
  const list = [
    { id: 'pi', name: 'Pi', category: 'native' },
    { id: 'echo-kit', name: '回声参考套件', category: 'native', fixture: true },
    { id: 'dsh', name: 'DSH', category: 'dsh', fixture: false },
    { id: 'weird', name: '坏档', category: 'native', fixture: 'yes' },
    null,
    { id: 'cli-a', name: 'CLI', category: 'cli' }
  ]
  const visible = visibleRuntimeKits(list)
  assert.deepEqual(visible.map((kit) => kit.id), ['pi', 'dsh', 'weird', 'cli-a'])
  assert.equal(visibleRuntimeKits(null).length, 0, '非数组＝空清单，不抛')
  assert.equal(isFixtureRuntime({ fixture: 'true' }), false, '只认严格 true')
})

test('runtimeShelf：分组过滤 fixture，category 缺省 native；下拉再剔无 id 条目', () => {
  const list = [
    { id: '', name: 'Pi（默认兜底）', category: 'native' },
    { id: 'echo-kit', name: '回声参考套件', category: 'native', fixture: true },
    { id: 'kit-a', name: '套件 A' },
    { id: 'dsh', name: 'DSH', category: 'dsh' },
    { id: 'cli-a', name: 'CLI', category: 'cli' }
  ]
  assert.deepEqual(runtimeKitsByCategory(list, 'native').map((kit) => kit.id), ['', 'kit-a'])
  assert.deepEqual(runtimeKitsByCategory(list, 'dsh').map((kit) => kit.id), ['dsh'])
  assert.deepEqual(runtimeKitsByCategory(list, 'cli').map((kit) => kit.id), ['cli-a'])
  assert.deepEqual(selectableRuntimeKits(list).map((kit) => kit.id), ['kit-a', 'dsh', 'cli-a'], '下拉不摆 Pi 空 id，也不摆 fixture')
})

test('runtimeShelf：货架三组声明（native/dsh/cli）', () => {
  assert.deepEqual(RUNTIME_SHELF_GROUPS.map((group) => group.key), ['native', 'dsh', 'cli'])
  assert.equal(RUNTIME_SHELF_GROUPS.every((group) => typeof group.label === 'string' && group.label.length > 0), true)
})

test('接线：app.js 的货架与下拉都走 views/runtimeShelf.mjs（不内联过滤）', () => {
  const src = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
  assert.match(src, /import\('\.\/views\/runtimeShelf\.mjs'\)/u)
  assert.match(src, /runtimeShelf\?\.runtimeKitsByCategory\(/u, '设置页货架走纯函数')
  assert.match(src, /runtimeShelf\?\.selectableRuntimeKits\(/u, 'Agent 运行时下拉走纯函数')
  assert.match(src, /runtimeShelf \? runtimeShelf\.pluginOverviewItems\(bag\.byKind, kind\)/u, '插件总览的渲染数据走同一个过滤纯函数')
})

test('OS-150a：插件总览的运行时分组不含夹具套件，套件/技能原样', () => {
  const suite = { kind: 'suite', id: 'novel' }
  const skill = { kind: 'skill', id: 'craft' }
  const echo = { kind: 'runtime', id: 'echo-kit', name: '回声参考套件', fixture: true }
  const cli = { kind: 'runtime', id: 'cli-a', name: 'CLI', fixture: false }
  const byKind = { suite: [suite], skill: [skill], runtime: [echo, cli] }
  assert.deepEqual(pluginOverviewItems(byKind, 'runtime').map((item) => item.id), ['cli-a'])
  assert.deepEqual(pluginOverviewItems(byKind, 'suite'), [suite], '套件不过滤')
  assert.deepEqual(pluginOverviewItems(byKind, 'skill'), [skill], '技能不过滤')
  assert.deepEqual(pluginOverviewItems(null, 'runtime'), [], 'byKind 缺失＝空清单，不抛')
  assert.deepEqual(pluginOverviewItems({ runtime: 'nope' }, 'runtime'), [], '非数组＝空清单')
  // 顶部汇总也按过滤后的三组重数（服务端 stats 含夹具，页面不直接用）
  assert.deepEqual(pluginOverviewStats(byKind), { total: 3, enabled: 3, blocked: 0 })
  assert.deepEqual(pluginOverviewStats(null), { total: 0, enabled: 0, blocked: 0 })
})

test('OS-150b：Agent 栏 chip 遇到夹具套件降级为默认文案，不显示夹具名', () => {
  const echo = { id: 'echo-kit', name: '回声参考套件', source: '内置', fixture: true }
  const view = agentChipView(echo, { runtime: 'echo-kit' })
  assert.equal(view.hidden, false)
  assert.equal(view.text, AGENT_CHIP_FALLBACK)
  assert.equal(view.text.includes('回声'), false, '夹具名不许露给作者')
  assert.equal(view.title.includes('回声'), false)
  assert.equal(AGENT_CHIP_FALLBACK, '内置默认')

  // 正常套件照旧显示套件名（夹具判定只认严格 true）
  const real = agentChipView({ id: 'cli-a', name: 'CLI A', source: '内置' }, { runtime: 'cli-a', model: 'm1' })
  assert.equal(real.text, 'CLI A')
  assert.match(real.title, /模型：m1/u)
  assert.equal(real.on, true)

  // 没有套件也没有端点/模型＝收起 chip（不摆空药丸）
  assert.deepEqual(agentChipView(null, {}), { hidden: true, text: '', on: false, title: '' })
  // 直连端点：显示模型或端点
  assert.equal(agentChipView(null, { model: 'gpt-x', configured: true }).text, 'gpt-x')
  assert.equal(agentChipView(null, { endpoint: 'http://127.0.0.1:1/v1', configured: true }).text, 'http://127.0.0.1:1/v1')
})
