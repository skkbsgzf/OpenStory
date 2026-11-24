/**
 * OS-165 / G5d：模块覆盖面收口——四条断言，缺一条都红。
 *
 *   a) src/modules 各目录的 module.manifest.json 全部过形状校验；core:true 恰好四枚；
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
import { HANDLERS } from '../src/api/registry.mjs'
import { MODULE_MANIFESTS, moduleOfEndpoint, validateModuleManifest } from '../src/protocol/modules.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const appJs = readFileSync(join(REPO, 'public/app.js'), 'utf-8')
const report = coverageReport()

test('a) 模块清单：src/modules/ 下每个目录都有合法 manifest，core:true 恰好四枚', () => {
  assert.deepEqual(report.noManifest, [], `缺 manifest 的目录：${report.noManifest.join('、')}`)
  assert.deepEqual(report.manifestIssues, [], `manifest 非法：${report.manifestIssues.join('；')}`)
  for (const manifest of MODULE_MANIFESTS) {
    const checked = validateModuleManifest(manifest, { dirName: manifest.id })
    assert.equal(checked.ok, true, `${manifest.id}: ${checked.errors?.join('；')}`)
  }
  assert.deepEqual([...report.coreIds].sort(), ['chapters', 'roleplay', 'script', 'worldbook'])
  assert.equal(report.coreIds.length, 4)
  // 14 个已登记模块：4 个工作面核心 + 6 个普通工作面插件 + 4 个宿主域登记目录
  // （library / deduce / agentbar 零端点零页签，只为清单透明）；每枚 manifest 都在模块目录里。
  assert.equal(report.manifestIds.length, 14)
  assert.equal(report.manifestIds.length, report.moduleDirs.length)
  assert.equal(report.manifestIds.length - report.coreIds.length, 10)
})

test('b) 端点覆盖：107 个 handler 键 100% 有归属或宿主白名单理由', () => {
  const claimed = MODULE_MANIFESTS.flatMap((manifest) => manifest.endpoints)
  assert.equal(report.uncoveredEndpoints.length, 0, `无归属端点：${report.uncoveredEndpoints.join('、')}`)
  assert.equal(claimed.length + report.hostEndpointCount, Object.keys(HANDLERS).length + claimed.filter((id) => hostOwnedEndpointIds().has(id)).length,
    '归属集合与宿主白名单不得重复计数')
  for (const [reason, ids] of Object.entries(HOST_OWNED_ENDPOINTS)) {
    assert.ok(reason.trim().length > 8, `宿主理由不能空：${reason}`)
    for (const id of ids) {
      assert.ok(HANDLERS[id], `宿主白名单里的端点不存在：${id}`)
      assert.equal(moduleOfEndpoint(id), null, `${id} 已有模块归属，不该再占宿主白名单`)
    }
  }
  // 四个核心模块的独占端点必须真落在 manifest 上（不是靠宿主白名单兜底）
  for (const id of report.coreIds) {
    const manifest = MODULE_MANIFESTS.find((item) => item.id === id)
    for (const endpoint of manifest.endpoints) {
      assert.equal(moduleOfEndpoint(endpoint), id)
      assert.ok(!hostOwnedEndpointIds().has(endpoint), `核心端点 ${endpoint} 不该在宿主白名单`)
    }
  }
  assert.equal(report.endpointCount, 107)
  assert.equal(report.claimedEndpointCount + report.hostEndpointCount, 107)
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
  // 四个核心页签的 moduleCore 标记必须在（显式表达「模块级不可停用」）
  for (const id of report.coreIds) {
    const tabs = TAB_REGISTRY.filter((entry) => entry.module === id)
    assert.ok(tabs.length > 0, `核心模块 ${id} 至少有一个页签`)
    for (const tab of tabs) assert.equal(tab.moduleCore, true, `${tab.id} 必须核心恒在`)
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
