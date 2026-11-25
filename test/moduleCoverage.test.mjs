/**
 * OS-165 / G5d：模块覆盖面收口——四条断言，缺一条都红。
 *
 *   a) src/modules 各目录的 module.manifest.json 全部过形状校验；@2 不得残留 core 字段；
 *   b) HANDLERS 每个键要么被某模块独占，要么在宿主白名单（逐组带理由）；
 *   c) TAB_REGISTRY 每个未退场条目要么归属模块，要么是宿主保留页（带理由）；
 *   d) 模块页签的渲染函数本体不在 app.js；留在宿主的必须显式列白名单并写理由。
 *
 * 口径与 tools/acceptance/acceptance.mjs 共用 tools/acceptance/moduleCoverage.mjs（一份真源）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  HOST_KEPT_RENDERERS, HOST_OWNED_ENDPOINTS, HOST_OWNED_TABS,
  coverageReport, hostOwnedEndpointIds
} from '../tools/acceptance/moduleCoverage.mjs'
import { TAB_REGISTRY } from '../public/views/registry.mjs'
import { HOST_HANDLERS } from '../src/api/registry.mjs'
import { allHandlers } from '../src/host/handlerTable.mjs'
import { MODULE_MANIFESTS, moduleOfEndpoint, validateModuleManifest } from '../src/protocol/modules.mjs'
import { auditCapabilityRoutes, auditTransferDuplication } from '../tools/acceptance/capabilityBoundaries.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const appJs = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
const report = coverageReport()

test('a) 模块清单：src/modules/ 下每个目录都有合法 @2 manifest，core 字段为零', () => {
  assert.deepEqual(report.noManifest, [], `缺 manifest 的目录：${report.noManifest.join('、')}`)
  assert.deepEqual(report.manifestIssues, [], `manifest 非法：${report.manifestIssues.join('；')}`)
  for (const manifest of MODULE_MANIFESTS.filter((item) => item.class)) {
    const checked = validateModuleManifest(manifest, { dirName: manifest.id, stage: 'C' })
    assert.equal(checked.ok, true, `${manifest.id}: ${checked.errors?.join('；')}`)
  }
  assert.deepEqual(report.coreFieldOwners, [])
  // C6 实测 20 个已登记模块：11 workbench + 7 kernel + 2 host-composition。
  assert.equal(report.manifestIds.length, 21)
  assert.equal(report.manifestIds.length, report.moduleDirs.length)
  assert.equal(report.sourceGroups.workbench.length, 12)
  assert.deepEqual(report.sourceGroups.kernel, ['agent-runtime', 'deduce', 'fact', 'media', 'prose', 'storage', 'text'])
  assert.deepEqual(report.sourceGroups['host-composition'], ['agentbar', 'library'])
  assert.deepEqual(report.sourceIssues, [])
})

test('C6 能力归属：kernel 零端点/UI，workbench 有 requires/slots，能力图与独占归属干净', () => {
  assert.deepEqual(report.kernelUiIssues, [])
  assert.deepEqual(report.workbenchContractIssues, [])
  assert.deepEqual(report.endpointOwnerIssues, [])
  assert.deepEqual(report.capabilityGraphIssues, [])
  for (const manifest of MODULE_MANIFESTS.filter((item) => item.class === 'kernel')) {
    assert.deepEqual(manifest.endpoints, [])
    assert.equal(manifest.pages, undefined)
    assert.equal(manifest.slots, undefined)
    assert.ok(manifest.capabilities.length > 0)
    assert.ok(manifest.entry)
  }
  for (const manifest of MODULE_MANIFESTS.filter((item) => item.class === 'workbench')) {
    assert.ok(manifest.entry)
    assert.ok(manifest.requires.length > 0)
    assert.ok(manifest.slots.length > 0)
  }

  const routeFixtures = [
    { rel: 'src/modules/prose/index.mjs', src: "import 'node:fs'\nimport '../../protocol/index.mjs'\nimport './write.mjs'" },
    { rel: 'src/modules/prose/bad.mjs', src: "import '../fact/index.mjs'" },
    { rel: 'src/api/handlers/bad.mjs', src: "import '../../modules/prose/index.mjs'" },
    // OS-193：内核转供叶已退役；用仍在工作台层的 worldbookContract 叶验证「协议放行」。
    { rel: 'src/protocol/worldbookContract.mjs', src: "export * from '../modules/worldbook/worldbookFileContract.mjs'" }
  ]
  assert.deepEqual(auditCapabilityRoutes(routeFixtures).map((item) => `${item.from} -> ${item.to}`), [
    'src/modules/prose/bad.mjs -> src/modules/fact/index.mjs',
    'src/api/handlers/bad.mjs -> src/modules/prose/index.mjs'
  ], '协议/本模块放行，跨模块与 API 直连必须报错')

  const copiedBody = `\n  const values = input.map((value) => value * 2).filter((value) => value > 10)\n  return { values, total: values.reduce((sum, value) => sum + value, 0) }\n`
  const duplicateFixtures = [
    { rel: 'src/protocol/worldbookContract.mjs', src: `export function original(input) {${copiedBody}}` },
    { rel: 'src/modules/worldbook/worldbookFileContract.mjs', src: `export const renamed = (input) => {${copiedBody}}` }
  ]
  assert.equal(auditTransferDuplication(duplicateFixtures).length, 1, '转供叶复制函数体，改名/改箭头也拒绝')
  assert.deepEqual(auditTransferDuplication([
    duplicateFixtures[0],
    { rel: 'src/modules/worldbook/worldbookFileContract.mjs', src: "export { original } from './derived.mjs'" }
  ]), [], '纯 re-export 转供叶允许')
})

test('b) 端点覆盖：全量 handler 键 100% 有归属或宿主白名单理由', async () => {
  const claimed = MODULE_MANIFESTS.flatMap((manifest) => manifest.endpoints)
  assert.equal(report.uncoveredEndpoints.length, 0, `无归属端点：${report.uncoveredEndpoints.join('、')}`)
  const table = await allHandlers()
  assert.deepEqual(Object.keys(HOST_HANDLERS).sort(), [...hostOwnedEndpointIds()].sort(),
    '宿主静态表与宿主白名单逐项相等')
  assert.equal(Object.keys(table).length, report.endpointCount,
    '归属集合与宿主白名单不得重复计数')
  for (const [reason, ids] of Object.entries(HOST_OWNED_ENDPOINTS)) {
    assert.ok(reason.trim().length > 8, `宿主理由不能空：${reason}`)
    for (const id of ids) {
      assert.ok(HOST_HANDLERS[id], `宿主白名单里的端点不存在：${id}`)
      assert.equal(moduleOfEndpoint(id), null, `${id} 已有模块归属，不该再占宿主白名单`)
    }
  }
  // 四个完整工作台的独占端点必须真落在 manifest 上（不是靠宿主白名单兜底）
  for (const id of ['chapters', 'worldbook', 'script', 'roleplay']) {
    const manifest = MODULE_MANIFESTS.find((item) => item.id === id)
    for (const endpoint of manifest.endpoints) {
      assert.equal(moduleOfEndpoint(endpoint), id)
      assert.ok(!hostOwnedEndpointIds().has(endpoint), `工作台端点 ${endpoint} 不该在宿主白名单`)
    }
  }
  assert.equal(report.endpointCount, 103)
  assert.equal(report.claimedEndpointCount + report.hostEndpointCount, 103)
})

test('c) 页签覆盖：每个未退场页签归属模块或宿主保留（带理由）', () => {
  assert.deepEqual(report.uncoveredTabs, [], `无归属页签：${report.uncoveredTabs.join('、')}`)
  for (const [id, reason] of Object.entries(HOST_OWNED_TABS)) {
    assert.ok(reason.trim().length > 8, `宿主页签 ${id} 必须写理由`)
    assert.ok(TAB_REGISTRY.some((entry) => entry.id === id && entry.label), `宿主页签 ${id} 不在注册表`)
  }
  for (const entry of TAB_REGISTRY.filter((item) => !item.retired && item.label && item.module)) {
    assert.ok(MODULE_MANIFESTS.some((manifest) => manifest.id === entry.module), `页签 ${entry.id} 指向不存在的模块 ${entry.module}`)
  }
  // 四个完整工作台都必须有可停用的页签归属，不再使用 moduleCore 特例。
  for (const id of ['chapters', 'worldbook', 'script', 'roleplay']) {
    const tabs = TAB_REGISTRY.filter((entry) => entry.module === id)
    assert.ok(tabs.length > 0, `工作台 ${id} 至少有一个页签`)
    for (const tab of tabs) assert.equal(Object.prototype.hasOwnProperty.call(tab, 'moduleCore'), false)
  }
})

/** 取函数体（从参数后的 `{` 起做括号深度扫描；薄壳里没有未平衡字符串）。 */
function functionBody(name) {
  const start = appJs.indexOf(`function ${name}(`)
  if (start < 0) return null
  const open = appJs.indexOf('{', appJs.indexOf(')', start))
  let depth = 0; let close = open
  for (; close < appJs.length; close++) {
    if (appJs[close] === '{') depth++
    else if (appJs[close] === '}' && --depth === 0) break
  }
  return appJs.slice(open + 1, close)
}

test('d) 视图归属：模块页签渲染本体不在 app.js（宿主保留须显式列理由）', () => {
  for (const entry of TAB_REGISTRY.filter((item) => !item.retired && item.module && item.render)) {
    const body = functionBody(entry.render)
    if (body === null) continue // 完全迁出，app.js 连壳都没有
    if (HOST_KEPT_RENDERERS[entry.render]) {
      assert.ok(HOST_KEPT_RENDERERS[entry.render].length > 8, `${entry.render} 的宿主保留理由不能空`)
      continue
    }
    assert.ok(body.length < 2000, `${entry.render} 不是宿主保留项，必须迁出（当前色 ${body.length} 字符）`)
    assert.match(body, /(?:[A-Za-z]+Views|views)\./u, `${entry.render} 的薄壳必须转交 public/views/`)
  }
  // 白名单本身不许腐化：登记的渲染名必须在注册表里真实使用
  const used = new Set(TAB_REGISTRY.map((entry) => entry.render))
  for (const name of Object.keys(HOST_KEPT_RENDERERS)) assert.ok(used.has(name), `宿主白名单登记了不存在的渲染名 ${name}`)
})
