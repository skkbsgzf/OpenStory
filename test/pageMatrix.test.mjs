/** OS-206：页面矩阵与零依赖浏览器/daemon fixture 的结构护栏。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { PAGE_MATRIX, PAGE_MATRIX_SPEC, validatePageMatrix, pageById } from './helpers/pageMatrix.mjs'
import { TAB_REGISTRY } from '../public/views/registry.mjs'
import { SETTINGS_NAV } from '../public/views/settingsViews.mjs'

const REPO = join(import.meta.dirname, '..')

test('OS-206 页面矩阵：schema、唯一 id、七设置分区与顶层页全覆盖', () => {
  assert.equal(PAGE_MATRIX_SPEC, 'openstory.page-test-matrix@1')
  const ids = PAGE_MATRIX.map((item) => item.id)
  assert.equal(new Set(ids).size, ids.length, '页面 id 不得重复')
  const checked = validatePageMatrix(PAGE_MATRIX)
  assert.equal(checked.ok, true, checked.errors.join('；'))
  for (const entry of TAB_REGISTRY.filter((item) => !item.slotOnly)) {
    assert.ok(PAGE_MATRIX.some((item) => item.id === entry.id || item.view === entry.view || (entry.id === 'settings' && item.id === 'settings-appearance')), `缺顶层页 ${entry.id}`)
  }
  for (const group of SETTINGS_NAV) for (const section of group.sections) {
    assert.ok(pageById(`settings-${section.id}`), `缺设置分区 ${section.id}`)
  }
})

test('OS-206 矩阵反证：重复、未知 view、缺 DOM/截图/viewport 都必须报错', () => {
  const good = PAGE_MATRIX[0]
  assert.equal(validatePageMatrix([good, { ...good }]).ok, false, '重复 id 必须红')
  assert.equal(validatePageMatrix([{ ...good, view: 'not-a-view' }]).ok, false, '未知 view 必须红')
  assert.equal(validatePageMatrix([{ ...good, dom: [] }]).ok, false, '缺 DOM 必须红')
  assert.equal(validatePageMatrix([{ ...good, screenshot: '' }]).ok, false, '缺截图名必须红')
  assert.equal(validatePageMatrix([{ ...good, viewports: [] }]).ok, false, '缺 viewport 必须红')
})

test('OS-206 投影覆盖：传入 slots 后缺任一投影页必须报红', () => {
  const slots = { tab: [{ page: 'artifacts' }, { page: 'chapters' }, { page: 'invented-page' }] }
  const result = validatePageMatrix(PAGE_MATRIX, { slots })
  assert.equal(result.ok, false)
  assert.ok(result.errors.some((line) => line.includes('invented-page')))
})

test('OS-206 CDP 客户端：零第三方 import、只起独立浏览器、不连接已有 8807', () => {
  const source = readFileSync(join(REPO, 'tools/verify/cdp-browser.mjs'), 'utf-8')
  assert.doesNotMatch(source, /from\s+['"](?!node:|\.)[^'"]+/u, 'CDP 客户端不许 import 第三方包')
  assert.match(source, /WebSocket/u)
  assert.match(source, /remote-debugging-port/u)
  assert.match(source, /mkdtemp/u, '浏览器 profile 必须临时')
  assert.doesNotMatch(source, /127\.0\.0\.1:8807/u, '不得硬编码连接常驻 daemon')
  assert.match(source, /Page\.captureScreenshot/u)
  assert.match(source, /Runtime\.exceptionThrown/u)
})

test('OS-206 fixture：只复制仓内样例、port 0、临时 LOCALAPPDATA、finally 清理', () => {
  const source = readFileSync(join(REPO, 'test/helpers/tempDaemon.mjs'), 'utf-8')
  const executableLines = source.split('\n').filter((line) => !line.trim().startsWith('*') && !line.trim().startsWith('/**'))
  const code = executableLines.join('\n')
  assert.match(code, /samples['"], ['"]水浒传/u)
  assert.match(code, /startDaemon\(\{[\s\S]*?port: 0/u)
  assert.match(code, /LOCALAPPDATA/u)
  assert.doesNotMatch(code, /D:[/\\]Projects|8807/u)
  assert.match(code, /finally \{ await fixture\.close\(\)/u)
})
