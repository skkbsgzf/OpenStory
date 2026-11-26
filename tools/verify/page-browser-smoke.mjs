/**
 * 真实 Chromium 页面 smoke：临时 daemon＋临时库，逐页执行矩阵动作与断言。
 * 用法：node tools/verify/page-browser-smoke.mjs [--out <目录>] [--page <id>] [--headed]
 * 失败、manual、缺图、空图、页面脚本错误、横向溢出都非零退出。
 */
import { mkdir, mkdtemp, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PAGE_MATRIX, PAGE_MATRIX_SPEC, validatePageMatrix } from '../../test/helpers/pageMatrix.mjs'
import { withTempDaemon } from '../../test/helpers/tempDaemon.mjs'
import { launchCdpBrowser } from './cdp-browser.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const arg = (name, fallback = '') => {
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}
const out = resolve(arg('out', join(tmpdir(), `openstory-browser-smoke-${Date.now()}`)))
const only = arg('page')
const pages = only ? PAGE_MATRIX.filter((item) => item.id === only) : PAGE_MATRIX
if (!pages.length) throw new Error(`未知页面：${only}`)
await mkdir(join(out, 'screenshots'), { recursive: true })

const startedAt = new Date().toISOString()
const steps = []
let fixture = null
let browser = null
let browserError = ''

async function runPage(browser, item, index) {
  const step = {
    id: item.id, view: item.view, title: item.title, scope: item.scope,
    status: 'fail', assertions: item.assertions, screenshot: `screenshots/${item.screenshot}`,
    errors: [], consoleErrors: [], failedRequests: [], viewports: []
  }
  try {
    for (const viewport of item.viewports) {
      await browser.setViewport(viewport.width, viewport.height)
      await browser.goto(`${fixture.origin}/`)
      await browser.wait('#view', 10000)
      for (const action of item.entry) {
        if (action.type === 'click') await browser.click(action.selector)
        else if (action.type === 'wait') await browser.wait(action.selector, action.timeout)
        else if (action.type === 'evaluate') await browser.evaluate(action.expression)
      }
      for (const selector of item.dom) {
        const visible = await browser.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          const style = getComputedStyle(el); const r = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        })()`)
        if (!visible) {
        const alternatives = item.dom.filter((candidate) => candidate !== selector)
        const anyVisible = alternatives.length === 0 ? false : await browser.evaluate(`(() => ${alternatives.map((candidate) => `Boolean(document.querySelector(${JSON.stringify(candidate)}))`).join(' || ')})()`)
        if (anyVisible) continue
        throw new Error(`主区域不可见或无尺寸：${selector}`)
      }
      }
      const layout = await browser.evaluate(`(() => ({
        title: document.title,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        main: (() => { const r=document.querySelector('#view')?.getBoundingClientRect(); return r?{width:r.width,height:r.height}:null })()
      }))()`)
      if (layout.scrollWidth > layout.clientWidth + 2) throw new Error(`横向溢出：${layout.scrollWidth} > ${layout.clientWidth}`)
      step.viewports.push({ width: viewport.width, height: viewport.height, ...layout })
      // 动作在最后一个视口执行并留证；弹层/展开卡不能被多视口截图掩盖。
      if (viewport === item.viewports.at(-1)) {
        for (const action of item.actions ?? []) {
          if (action.type === 'click') await browser.click(action.selector)
          else if (action.type === 'wait') await browser.wait(action.selector, action.timeout)
          else if (action.type === 'evaluate') await browser.evaluate(action.expression)
        }
      }
    }
    const shot = await browser.screenshot()
    await writeFile(join(out, step.screenshot), shot)
    const info = await stat(join(out, step.screenshot))
    if (info.size < 1024) throw new Error(`截图过小：${info.size} 字节`)
    step.screenshotBytes = info.size
    step.status = 'pass'
  } catch (error) {
    step.errors.push(String(error?.message ?? error))
    try {
      await writeFile(join(out, step.screenshot), await browser.screenshot())
    } catch { /* 截图失败也记 fail */ }
  }
  step.consoleErrors = [...browser.consoleErrors]
  step.pageErrors = [...browser.pageErrors]
  step.failedRequests = [...browser.failedRequests]
  browser.consoleErrors.length = 0
  browser.pageErrors.length = 0
  browser.failedRequests.length = 0
  if (step.consoleErrors.length || step.pageErrors.length) {
    step.status = 'fail'
    step.errors.push('页面脚本错误：console.error 或 pageerror')
  }
  steps.push(step)
  console.log(`${step.status === 'pass' ? '✓' : '✗'} ${item.id} ${item.title}${step.errors[0] ? ` — ${step.errors[0]}` : ''}`)
}

try {
  const check = validatePageMatrix(PAGE_MATRIX)
  if (!check.ok) throw new Error(`页面矩阵不完整：${check.errors.join('；')}`)
  fixture = await withTempDaemon(async (fx) => {
    fixture = fx
    const slots = (await fx.json(`/api/plugins?root=${encodeURIComponent(fx.root)}`)).payload?.slots ?? {}
  const matrixCheck = validatePageMatrix(PAGE_MATRIX, { slots })
  if (!matrixCheck.ok) throw new Error(`矩阵与投影不一致：${matrixCheck.errors.join('；')}`)
  const selectedCheck = validatePageMatrix(pages, { slots })
  if (!selectedCheck.ok && !only) throw new Error(`所选页面矩阵不完整：${selectedCheck.errors.join('；')}`)
    browser = await launchCdpBrowser()
    for (let index = 0; index < pages.length; index += 1) await runPage(browser, pages[index], index)
    return null
  }, { defaultRoot: pages.some((item) => item.scope === 'library') })
} catch (error) {
  browserError = String(error?.message ?? error)
  console.error(`✗ 浏览器 smoke 启动/执行失败：${browserError}`)
} finally {
  if (browser) await browser.close().catch(() => {})
}

const failed = steps.filter((step) => step.status !== 'pass').length
const missing = pages.filter((item) => !steps.some((step) => step.id === item.id)).map((item) => item.id)
if (missing.length) browserError = `${browserError}；未执行页面：${missing.join(',')}`
const manifest = {
  spec: PAGE_MATRIX_SPEC.replace('matrix', 'report'), startedAt,
  finishedAt: new Date().toISOString(), repo: REPO, origin: fixture?.origin ?? '',
  total: pages.length, pass: steps.length - failed, fail: failed,
  browserError, steps
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
await writeFile(join(out, 'run.log'), `OpenStory page browser smoke\n${manifest.finishedAt}\npass=${manifest.pass} fail=${manifest.fail} total=${manifest.total}\n${browserError}\n`, 'utf-8')
console.log(`\n页面浏览器 smoke：${manifest.pass} 过 / ${manifest.fail} 挂 / ${manifest.total} 总；产物 ${out}`)
process.exit(failed || missing.length || browserError ? 1 : 0)
