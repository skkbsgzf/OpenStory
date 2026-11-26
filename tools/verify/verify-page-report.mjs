/** 校验页面 smoke 报告完整性：缺页、fail、manual、缺图、空图、脚本错误都非零退出。 */
import { open, readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { PAGE_MATRIX, PAGE_MATRIX_SPEC } from '../../test/helpers/pageMatrix.mjs'

const root = resolve(process.argv[2] || '')
if (!process.argv[2]) { console.error('用法：node tools/verify/verify-page-report.mjs <报告目录>'); process.exit(2) }
let manifest
try { manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf-8')) } catch (error) {
  console.error(`✗ manifest 不可读：${error.message}`); process.exit(1)
}
const errors = []
if (manifest.spec !== PAGE_MATRIX_SPEC.replace('matrix', 'report')) errors.push('manifest spec 非法')
if (manifest.browserError) errors.push(`浏览器执行错误：${manifest.browserError}`)
if (!Array.isArray(manifest.steps)) errors.push('steps 必须是数组')
const steps = Array.isArray(manifest.steps) ? manifest.steps : []
const expected = new Set(PAGE_MATRIX.map((item) => item.id))
// 单页调试允许 --page；正式 CI 不带 --page，必须全矩阵。
const pageArg = process.argv.indexOf('--page')
const selectedId = pageArg >= 0 && process.argv[pageArg + 1] ? process.argv[pageArg + 1] : ''
if (selectedId) {
  expected.clear()
  expected.add(selectedId)
}
const actual = new Set(steps.map((step) => step?.id))
for (const id of expected) if (!actual.has(id)) errors.push(`缺页面：${id}`)
for (const id of actual) {
  if (!expected.has(id)) errors.push(`未知页面：${id}`)
  else if (steps.filter((step) => step?.id === id).length !== 1) errors.push(`页面重复：${id}`)
}
const source = await readFile(join(root, 'manifest.json'), 'utf-8')
for (const disallowed of ['"manual"', '"skip"']) if (source.includes(disallowed)) errors.push(`报告含禁用状态：${disallowed}`)
for (const step of steps) {
  if (!step || typeof step !== 'object') { errors.push('步骤不是对象'); continue }
  if (step.status !== 'pass') errors.push(`${step.id} 状态不是 pass：${step.status}`)
  for (const field of ['errors', 'consoleErrors', 'pageErrors', 'failedRequests', 'viewports', 'expectedHttpErrors']) {
    if (!Array.isArray(step[field])) errors.push(`${step.id} 缺数组字段：${field}`)
  }
  if (!step.screenshot || typeof step.screenshot !== 'string') { errors.push(`${step.id} 缺截图路径`); continue }
  const screenshotPath = resolve(root, step.screenshot)
  const rel = relative(root, screenshotPath)
  if (isAbsolute(step.screenshot) || rel.startsWith(`..${sep}`) || rel === '..') {
    errors.push(`${step.id} 截图路径越出报告目录`)
    continue
  }
  try {
    const info = await stat(screenshotPath)
    if (!info.isFile()) errors.push(`${step.id} 截图不是文件`)
    else if (info.size < 1024) errors.push(`${step.id} 截图过小：${info.size}`)
    else {
      const header = Buffer.alloc(8)
      const handle = await open(screenshotPath, 'r')
      try { await handle.read(header, 0, 8, 0) } finally { await handle.close() }
      if (header.subarray(1, 4).toString('ascii') !== 'PNG') errors.push(`${step.id} 截图不是 PNG`)
    }
  } catch { errors.push(`${step.id} 截图不存在：${step.screenshot}`) }
  if (step.errors?.length) errors.push(`${step.id} 有断言错误：${step.errors[0]}`)
  if (step.consoleErrors?.length) errors.push(`${step.id} 有 console.error`)
  if (step.pageErrors?.length) errors.push(`${step.id} 有 pageerror`)
  if (step.failedRequests?.some((item) => !String(item.url ?? '').endsWith('/favicon.ico')
    && !(step.expectedHttpErrors ?? []).some((prefix) => String(item.url ?? '').includes(prefix)))) errors.push(`${step.id} 有非预期请求错误`)
  if (!Array.isArray(step.viewports) || !step.viewports.length) errors.push(`${step.id} 无 viewport 记录`)
  for (const view of step.viewports ?? []) {
    if (!(view.width > 0 && view.height > 0)) errors.push(`${step.id} viewport 尺寸非法`)
    if (!(view.scrollWidth > view.clientWidth + 2)) continue
    errors.push(`${step.id} 横向溢出`)
  }
}
const pass = steps.filter((step) => step?.status === 'pass').length
const fail = steps.length - pass
if (manifest.total !== expected.size || manifest.pass !== pass || manifest.fail !== fail || manifest.skipped !== 0) errors.push('manifest 汇总数与实际步骤不一致')
if (errors.length) {
  console.error(`✗ 页面报告校验失败（${errors.length} 项）：\n${errors.slice(0, 30).map((line) => `  · ${line}`).join('\n')}`)
  process.exit(1)
}
console.log(`✓ 页面报告完整：${expected.size} 页全通过、截图齐全、无脚本错误`)
