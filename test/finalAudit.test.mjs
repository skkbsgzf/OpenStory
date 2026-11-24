/**
 * OS-168 总复核护栏（只新增测试，不改既有断言）。
 *
 * 钉死三件容易空转的事：
 *   ① final-audit.md 的门禁表必须覆盖 acceptance.mjs 里每个 check('S…') 编号；
 *   ② 路线归档表必须逐条写到 G8a~G10c；
 *   ③ PUBLISHING / 工单体系文档的硬数字必须与 ARCHITECTURE 生成段同源，不手抄漂移。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf-8')

const gateSource = read('tools/acceptance/acceptance.mjs')
const gateIds = [...new Set([...gateSource.matchAll(/check\('(S\d+\.\d+)'/gu)].map((m) => m[1]))].sort()
const auditDoc = read('docs/plan/final-audit.md')
const routeDoc = read('docs/plan/route-batch2-20261123.md')
const publishingDoc = read('docs/PUBLISHING.md')
const systemDoc = read('docs/plan/workorder-system-20261124.md')
const architecture = read('ARCHITECTURE.md')

test('门禁表覆盖：final-audit.md 列出 acceptance 的全部 check 编号', () => {
  assert.equal(gateIds.length, 23, `门禁项数漂移：${gateIds.join('/')}`)
  const missing = gateIds.filter((id) => !auditDoc.includes(`| ${id} |`))
  assert.deepEqual(missing, [])
})

test('路线归档：G8a~e / G9a~f / G10a~c 逐条标结果并给工单提交', () => {
  const ids = [
    'G8a', 'G8b', 'G8c', 'G8d', 'G8e',
    'G9a', 'G9b', 'G9c', 'G9d', 'G9e', 'G9f',
    'G10a', 'G10b', 'G10c'
  ]
  const section = routeDoc.slice(routeDoc.indexOf('## 执行结果'), routeDoc.indexOf('\n---', routeDoc.indexOf('## 执行结果')))
  assert.notEqual(section.length, 0, '缺「执行结果」节')
  for (const id of ids) {
    const row = section.split('\n').find((line) => line.startsWith(`| ${id} |`))
    assert.ok(row, `路线缺行：${id}`)
    assert.match(row, /已做/u, `${id} 未标结果`)
    assert.match(row, /`[0-9a-f]{7}`/u, `${id} 缺提交号`)
  }
})

test('数值锚点：PUBLISHING／工单体系与 ARCHITECTURE 生成段同源', () => {
  const appLines = [...architecture.matchAll(/\| `public\/app\.js` 行数 \| ([\d,]+) \|/gu)].map((m) => m[1])
  const endpointLines = [...architecture.matchAll(/\| 契约端点数（`method:` 计数） \| (\d+) \|/gu)].map((m) => m[1])
  const testLines = [...architecture.matchAll(/\| 测试文件数（`test\/\*\.test\.mjs`） \| (\d+) \|/gu)].map((m) => m[1])
  assert.equal(appLines.length, 1)
  assert.equal(endpointLines.length, 1)
  assert.equal(testLines.length, 1)
  assert.equal(endpointLines[0], '107')
  assert.equal(appLines[0], '11,886')
  assert.equal(testLines[0], '87')

  for (const text of [publishingDoc, systemDoc, auditDoc]) {
    assert.match(text, /682/u, '测试总数锚点缺失')
    assert.match(text, /107/u, '端点数锚点缺失')
    assert.match(text, /11,886/u, 'app.js 行数锚点缺失')
  }
  assert.match(publishingDoc, /23 过 \/ 0 挂 \/ 0 警/u)
  assert.match(systemDoc, /模块 \*\*14\*\*/u)
})

test('总复核命令：测试／门禁／arch check／两条 e2e／MCP／双端口都在清单里', () => {
  for (const needle of [
    'node --test test/*.test.mjs',
    'node tools/acceptance/acceptance.mjs',
    'npm run arch:stats --check',
    'node tools/verify/verify-shuihu.mjs',
    'node tools/verify/verify-newproj.mjs',
    'npm run mcp',
    '两端口一致性'
  ]) {
    assert.ok(auditDoc.includes(needle), `final-audit.md 缺命令：${needle}`)
  }
})
