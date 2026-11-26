/** OS-206/210：浏览器 smoke 产物完整性。fail/manual/skip/缺图/坏图/缺页/脚本错误都必须红。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const spec = 'openstory.page-test-report@1'
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(2040, 1)
])
const good = () => ({
  spec, total: 1, pass: 1, fail: 0, skipped: 0, browserError: '',
  steps: [{
    id: 'libraries', status: 'pass', screenshot: 'screenshots/libraries.png',
    errors: [], consoleErrors: [], pageErrors: [], failedRequests: [], expectedHttpErrors: [],
    viewports: [{ width: 1500, height: 980, scrollWidth: 1500, clientWidth: 1500 }]
  }]
})

async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), 'os-report-check-'))
  await mkdir(join(base, 'screenshots'), { recursive: true })
  await writeFile(join(base, 'screenshots/libraries.png'), png)
  try { return await run(base) } finally { await rm(base, { recursive: true, force: true }) }
}

test('OS-206/210 报告校验：完整 pass 产物通过；fail/manual/skip/缺图/空图/坏图/缺页/脚本错误分别报红', async () => {
  await fixture(async (base) => {
    const check = async (manifest) => {
      await writeFile(join(base, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
      const { spawnSync } = await import('node:child_process')
      const result = spawnSync(process.execPath, ['tools/verify/verify-page-report.mjs', base, '--page', 'libraries'], { cwd: join(import.meta.dirname, '..'), encoding: 'utf8' })
      return { status: result.status, stdout: result.stdout, stderr: result.stderr }
    }
    const initial = await check(good())
    assert.equal(initial.status, 0, initial.stderr)
    const failed = good(); failed.steps[0].status = 'fail'; failed.fail = 1; failed.pass = 0
    assert.notEqual((await check(failed)).status, 0)
    const manual = good(); manual.steps[0].status = 'manual'
    assert.notEqual((await check(manual)).status, 0)
    const skipped = good(); skipped.skipped = 1; skipped.pass = 0
    assert.notEqual((await check(skipped)).status, 0)
    const missing = good(); missing.steps = []
    assert.notEqual((await check(missing)).status, 0)
    const absent = good(); absent.steps[0].screenshot = 'screenshots/absent.png'
    assert.notEqual((await check(absent)).status, 0)
    await writeFile(join(base, 'screenshots/libraries.png'), Buffer.alloc(0))
    assert.notEqual((await check(good())).status, 0)
    await writeFile(join(base, 'screenshots/libraries.png'), Buffer.alloc(2048, 1))
    assert.notEqual((await check(good())).status, 0)
    await writeFile(join(base, 'screenshots/libraries.png'), png)
    const scriptError = good(); scriptError.steps[0].pageErrors = ['boom']
    assert.notEqual((await check(scriptError)).status, 0)
    const escape = good(); escape.steps[0].screenshot = '../outside.png'
    assert.notEqual((await check(escape)).status, 0)
  })
})

test('OS-210 报告入口：无目录非零；CI workflow 必须保留隔离 E2E 与独立浏览器 job', async () => {
  const { spawnSync } = await import('node:child_process')
  const root = join(import.meta.dirname, '..')
  const missing = spawnSync(process.execPath, ['tools/verify/verify-page-report.mjs'], { cwd: root, encoding: 'utf8' })
  assert.notEqual(missing.status, 0)
  const source = await readFile(join(root, '.github/workflows/ci.yml'), 'utf-8')
  assert.match(source, /node tools\/verify\/verify-os172-e2e\.mjs/u)
  assert.match(source, /\n  browser-smoke:\n/u)
  assert.match(source, /node tools\/verify\/page-browser-smoke\.mjs --out/u)
  assert.match(source, /node tools\/verify\/verify-page-report\.mjs/u)
  assert.match(source, /Upload page report and screenshots/u)
})
