/** OS-206：浏览器 smoke 产物完整性。fail/manual/缺图/空图/缺页都必须红。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const spec = 'openstory.page-test-report@1'
const good = () => ({
  spec, total: 1, pass: 1, fail: 0, browserError: '',
  steps: [{ id: 'libraries', status: 'pass', screenshot: 'screenshots/libraries.png', errors: [], consoleErrors: [], pageErrors: [], failedRequests: [], viewports: [{ width: 1500, height: 980, scrollWidth: 1500, clientWidth: 1500 }] }]
})

async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), 'os-report-check-'))
  await mkdir(join(base, 'screenshots'), { recursive: true })
  await writeFile(join(base, 'screenshots/libraries.png'), Buffer.alloc(2048, 1))
  try { return await run(base) } finally { await rm(base, { recursive: true, force: true }) }
}

test('OS-206 报告校验：完整 pass 产物通过；fail/manual/缺图/空图/缺页/脚本错误分别报红', async () => {
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
    assert.notEqual(await check(failed), 0)
    const manual = good(); manual.steps[0].status = 'manual'
    assert.notEqual(await check(manual), 0)
    const missing = good(); missing.steps = []
    assert.notEqual(await check(missing), 0)
    const absent = good(); absent.steps[0].screenshot = 'screenshots/absent.png'
    assert.notEqual(await check(absent), 0)
    await writeFile(join(base, 'screenshots/libraries.png'), Buffer.alloc(0))
    assert.notEqual(await check(good()), 0)
    await writeFile(join(base, 'screenshots/libraries.png'), Buffer.alloc(2048, 1))
    const scriptError = good(); scriptError.steps[0].pageErrors = ['boom']
    assert.notEqual(await check(scriptError), 0)
  })
})
