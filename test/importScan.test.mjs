/**
 * OS-150b 用例：验收门禁的共用 import 扫描器与「按边豁免」。
 *
 * 钉三件事（对应 OS-150a 复核的 1 medium ＋ 1 low）：
 *   ① S2.1/S2.2 同一份扫描器——静态 from、动态 import()、副作用 import、单双引号都在面内，
 *      尤其动态 `import('./app.js')` 这种旧 S2.2 正则漏掉的写法必须被抓；
 *   ② 豁免按边（源文件 → 目标文件）登记：只放行登记过的那几条，未登记 → 红；
 *   ③ 真实仓面零违规、登记表零腐化（防「改了代码忘了改登记」）。
 *
 * 反例全在内存字符串里构造——仓里不留任何故意违规的临时文件。
 * 跑法：node --test test/importScan.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  PUBLIC_EDGE_ALLOW,
  auditPublicEdges,
  resolveSpec,
  scanImportSpecs
} from '../tools/acceptance/importScan.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

test('scanImportSpecs：静态 from／动态 import()／副作用 import／单双引号全覆盖', () => {
  const src = [
    "import { a } from './a.mjs'",
    'import { b } from "./b.mjs"',
    "export { c } from './c.mjs'",
    "const d = await import('./d.mjs')",
    "const e = await import(\n  './e.js'\n)",
    "import './side-effect.mjs'",
    "import { x } from 'node:fs'",
    'const notImport = transform(\'+x\')'
  ].join('\n')
  const specs = scanImportSpecs(src).map((item) => item.spec)
  assert.deepEqual(specs, ['./a.mjs', './b.mjs', './c.mjs', './d.mjs', './e.js', './side-effect.mjs', 'node:fs'])
  assert.equal(scanImportSpecs(src).find((item) => item.spec === './d.mjs').line, 4, '行号按物理行给')
})

test('反例：public/views 里动态 import(`./app.js`) 被 S2.2 扫描面抓住（旧正则漏检的那类）', () => {
  const files = [{ rel: 'public/views/bad.mjs', src: "async function boot() { return (await import('./app.js')).default }" }]
  const audit = auditPublicEdges(files)
  assert.equal(audit.violations.length, 1)
  assert.equal(audit.violations[0].tag, 'views/bad.mjs -> views/app.js')
  assert.equal(audit.violations[0].line, 1)
  assert.equal(audit.violations[0].spec, './app.js')

  const up = auditPublicEdges([{ rel: 'public/views/bad.mjs', src: "await import('../app.js')" }])
  assert.deepEqual(up.violations.map((edge) => edge.tag), ['views/bad.mjs -> app.js'], '跨层动态 import 同样在面内')
})

test('反例：未登记的 foo.mjs → ./script.mjs 会红（豁免按边，不按目标文件全局放行）', () => {
  const files = [{ rel: 'public/foo.mjs', src: "import { parseScript } from './script.mjs'" }]
  const audit = auditPublicEdges(files)
  assert.deepEqual(audit.violations.map((edge) => edge.tag), ['foo.mjs -> script.mjs'])
})

test('正例：登记过的边放行；同文件自引用与裸说明符不进 public 边面', () => {
  const files = [
    { rel: 'public/scriptFact.mjs', src: "import { parseScript } from './script.mjs'" },
    { rel: 'public/analysisModules.mjs', src: "if (!engine) engine = import('./analysis.mjs').then((mod) => mod.analyzeChapter)" },
    { rel: 'public/ui-kit.mjs', src: "// 用法：import { chipField } from './ui-kit.mjs'\nimport 'node:fs'" }
  ]
  const audit = auditPublicEdges(files)
  assert.deepEqual(audit.violations, [], '登记边/自引用/裸说明符都不该红')
})

test('豁免表：每条都有边、有理由；真实仓面零违规', () => {
  assert.ok(PUBLIC_EDGE_ALLOW.length >= 2)
  for (const row of PUBLIC_EDGE_ALLOW) {
    assert.match(row.edge, /^[\w./-]+\.mjs -> [\w./-]+\.mjs$/u, `边格式：${row.edge}`)
    assert.ok(row.reason && row.reason.trim().length > 10, `豁免必须写清理由：${row.edge}`)
  }
  const files = [
    ...readdirSync(join(REPO, 'public')).filter((f) => f.endsWith('.mjs')).map((f) => `public/${f}`),
    ...readdirSync(join(REPO, 'public/views')).filter((f) => f.endsWith('.mjs')).map((f) => `public/views/${f}`)
  ].map((rel) => ({ rel, src: readFileSync(join(REPO, rel), 'utf-8') }))
  const audit = auditPublicEdges(files)
  assert.deepEqual(audit.violations.map((edge) => edge.tag), [], '真实仓不该有未登记的前端模块边')
  assert.deepEqual(audit.stale.map((row) => row.edge), [], '登记了却不存在/缺理由＝豁免表腐化')
})

test('resolveSpec：相对路径逐段解析，允许跨层（views → public 根）', () => {
  assert.equal(resolveSpec('public/views/a.mjs', './b.mjs'), 'public/views/b.mjs')
  assert.equal(resolveSpec('public/views/a.mjs', '../app.js'), 'public/app.js')
  assert.equal(resolveSpec('public/a.mjs', './x/y.mjs'), 'public/x/y.mjs')
})
