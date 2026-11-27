import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { MODULE_MANIFESTS } from '../src/protocol/modules.mjs'
import { countPhysicalLines } from '../tools/arch-stats.mjs'
import {
  APP_JS_LINE_CEILINGS,
  APP_JS_MAX_LINES,
  HOST_DOMAIN_MODULE_IDS,
  NUMBER_ANCHORS_SCHEMA,
  collectStaticAnchors,
  documentAnchorChecks
} from '../tools/number-anchors.mjs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf-8')

test('物理行口径：CRLF/LF 归一，空行与注释计入，末尾换行不另计', () => {
  assert.equal(countPhysicalLines(''), 0)
  assert.equal(countPhysicalLines('a\nb'), 2)
  assert.equal(countPhysicalLines('a\r\n\r\n// 注释\r\n'), 3)
  assert.equal(countPhysicalLines('a\rb\r'), 2)
})

test('静态数字锚直接取契约键、manifest 与物理行实测', () => {
  const anchors = collectStaticAnchors()
  const hostDomainIds = [...new Set(MODULE_MANIFESTS
    .filter((manifest) => HOST_DOMAIN_MODULE_IDS.includes(manifest.id))
    .flatMap((manifest) => manifest.endpoints))].sort()
  assert.equal(anchors.schema, NUMBER_ANCHORS_SCHEMA)
  assert.equal(anchors.endpoints.total, Object.keys(ENDPOINTS).length)
  assert.deepEqual(anchors.endpoints.hostDomainIds, hostDomainIds)
  assert.equal(anchors.endpoints.hostDomain, hostDomainIds.length)
  assert.equal(anchors.appJs.lines, countPhysicalLines(read('public/app.js')))
  assert.equal(anchors.testFiles, readdirSync(new URL('../test/', import.meta.url)).filter((name) => name.endsWith('.test.mjs')).length)
})

test('app.js 上限锚保留 11,886 初始值且只许下调', () => {
  assert.equal(APP_JS_LINE_CEILINGS[0], 11886)
  assert.equal(APP_JS_MAX_LINES, 10500)
  assert.equal(APP_JS_MAX_LINES, APP_JS_LINE_CEILINGS.at(-1))
  for (let index = 1; index < APP_JS_LINE_CEILINGS.length; index++) {
    assert.ok(APP_JS_LINE_CEILINGS[index] <= APP_JS_LINE_CEILINGS[index - 1])
  }
})

test('机器锚与静态实测、当前文档互相一致', () => {
  const persisted = JSON.parse(read('docs/number-anchors.json'))
  const actual = collectStaticAnchors()
  // docs/number-anchors.json 已是阶段 C 当前事实快照；逐字段与实测核对，
  // 任何源码/文档漂移都会红。
  assert.deepEqual({
    schema: actual.schema,
    appJs: actual.appJs,
    modules: actual.modules,
    endpoints: actual.endpoints,
    testFiles: actual.testFiles
  }, {
    schema: persisted.schema,
    appJs: persisted.appJs,
    modules: persisted.modules,
    endpoints: persisted.endpoints,
    testFiles: persisted.testFiles
  })
  assert.equal(actual.appJs.lines, countPhysicalLines(read('public/app.js')))
  assert.equal(actual.appJs.lines, 10047)
  assert.deepEqual(actual.modules, { total: 23, workbench: 13, kernel: 8, hostComposition: 2 })
  assert.deepEqual(actual.endpoints, {
    total: 129, moduleOwned: 57, hostOwned: 72, hostDomain: 0, hostDomainIds: []
  })
  assert.equal(actual.endpoints.total, Object.keys(ENDPOINTS).length)
  assert.equal(actual.endpoints.moduleOwned + actual.endpoints.hostOwned, actual.endpoints.total)
  assert.equal(actual.testFiles, readdirSync(new URL('../test/', import.meta.url)).filter((name) => name.endsWith('.test.mjs')).length)
  // 测试汇总由 S2.8 在真实复跑后核对，避免 JSON 旧状态自指。
  const missing = documentAnchorChecks(persisted)
    .filter((item) => item.label !== '测试汇总')
    .filter((item) => !item.found)
  assert.deepEqual(missing, [])
  assert.ok(persisted.appJs.lines <= persisted.appJs.maxLines)
})
