/**
 * 真实 Chromium 页面 smoke：临时 daemon＋临时库，逐页执行矩阵动作与断言。
 * 用法：node tools/verify/page-browser-smoke.mjs [--out <目录>] [--page <id>]
 * 失败、manual、缺图、空图、页面脚本错误、横向溢出都非零退出。
 */
import { mkdir, stat, writeFile } from 'node:fs/promises'
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
let fixtureOrigin = ''
let browser = null
let browserError = ''

async function callHttp(action) {
  const path = action.path.startsWith('/api/') ? action.path : `/api${action.path}`
  const body = { ...(action.body ?? {}) }
  if (path.startsWith('/api/ui-state') && body.root === undefined) body.root = fixture.root
  if (body.path === '@MODULE_ROOT@') body.path = fixture.moduleRoot
  if (body.root === '@ROOT@') body.root = fixture.root
  const options = { method: action.method }
  if (action.method !== 'GET') {
    options.headers = { 'content-type': 'application/json' }
    options.body = JSON.stringify(body)
  }
  let result = await fixture.json(`${path}${action.method === 'GET' && body.root ? `?root=${encodeURIComponent(body.root)}` : ''}`, options)
  // Windows 上连续原子替换同一 ui-state 偶发 EPERM（旧句柄尚未释放）；测试编排重试，产品错误仍如实返回。
  if (path.startsWith('/api/ui-state') && result.status >= 500) {
    for (let attempt = 0; attempt < 3 && result.status >= 500; attempt += 1) {
      await new Promise((done) => setTimeout(done, 120))
      result = await fixture.json(path, options)
    }
  }
  if (result.status >= 400) throw new Error(`前置 HTTP ${action.method} ${path} 失败：${result.status} ${JSON.stringify(result.payload)}`)
}

async function runAction(browser, action) {
  if (action.type === 'click') await browser.click(action.selector)
  else if (action.type === 'wait') await browser.wait(action.selector, action.timeout)
  else if (action.type === 'evaluate') await browser.evaluate(action.expression)
  else if (action.type === 'assert') {
    const ok = await browser.evaluate(`Boolean(${action.expression})`)
    if (!ok) throw new Error(action.message || `断言失败：${action.expression}`)
  } else if (action.type === 'http') await callHttp(action)
  else throw new Error(`未知页面动作：${action.type}`)
}

async function runPage(browser, item) {
  const step = {
    id: item.id, view: item.view, title: item.title, scope: item.scope,
    status: 'fail', assertions: item.assertions, screenshot: `screenshots/${item.screenshot}`,
    errors: [], consoleErrors: [], failedRequests: [], viewports: [], expectedHttpErrors: item.expectedHttpErrors ?? []
  }
  try {
    for (const action of item.before ?? []) await runAction(browser, action)
    try {
        for (const viewport of item.viewports) {
          await browser.setViewport(viewport.width, viewport.height)
          // 每个视口都重新装载，错误收集不跨视口残留；宽屏先跑，最后一视口执行关键交互与截图。
          browser.consoleErrors.length = 0
          browser.pageErrors.length = 0
          browser.failedRequests.length = 0
          await browser.goto(`${fixture.origin}/`)
      await browser.wait('#view', 10000)
      // 没开库场景必须保持 current=null；其它页面若没有自动开库，则显式打开临时库。
      if (item.setup !== 'no-default-library' && item.id !== 'libraries') {
        await browser.evaluate(`(() => {
          const card = document.querySelector('[data-lib-path]');
          if (card) card.dispatchEvent(new MouseEvent('click', { bubbles: true }));
          return true;
        })()`)
        await browser.wait('#tabs .tab[data-view]', 10000)
      }
      for (const action of item.entry) await runAction(browser, action)
      const visible = []
      for (const selector of item.dom) {
        visible.push(await browser.evaluate(`(() => {
          const el = document.querySelector(${JSON.stringify(selector)});
          if (!el) return false;
          const style = getComputedStyle(el); const r = el.getBoundingClientRect();
          return style.display !== 'none' && style.visibility !== 'hidden' && r.width > 0 && r.height > 0;
        })()`))
      }
      // dom 是“任一可接受主区域”列表；页面只会有其中一种壳/空态。
      if (!visible.some(Boolean)) throw new Error(`主区域不可见或无尺寸：${item.dom.join(' / ')}`)
      const layout = await browser.evaluate(`(() => ({
        title: document.title,
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
        main: (() => { const r=document.querySelector('#view')?.getBoundingClientRect(); return r?{width:r.width,height:r.height}:null })()
      }))()`)
      if (layout.scrollWidth > layout.clientWidth + 2) throw new Error(`横向溢出：${layout.scrollWidth} > ${layout.clientWidth}`)
      step.viewports.push({ width: viewport.width, height: viewport.height, ...layout })
      for (const action of item.checks ?? []) await runAction(browser, action)
      // 关键交互只在最后视口执行并留证，避免多视口截图掩盖弹层/展开卡。
      if (viewport === item.viewports.at(-1)) {
        for (const action of item.actions ?? []) await runAction(browser, action)
        for (const action of item.checksAfter ?? []) await runAction(browser, action)
          }
        }
      } finally {
      for (const action of item.after ?? []) {
        try { await runAction(browser, action) } catch (error) { step.errors.push(`场景恢复失败：${error?.message ?? error}`); step.status = 'fail' }
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
    try { await writeFile(join(out, step.screenshot), await browser.screenshot()) } catch { /* 截图失败也记 fail */ }
  } finally {
    // 页面请求可能晚于断言结束才报错；留一个事件回合，避免把上一页错误带到下一页。
    await new Promise((done) => setTimeout(done, 250))
  }
  step.consoleErrors = browser.consoleErrors.length ? [...browser.consoleErrors] : []
  step.pageErrors = browser.pageErrors.length ? [...browser.pageErrors] : []
  step.failedRequests = browser.failedRequests.length ? [...browser.failedRequests] : []
  const expected = [...(item.expectedHttpErrors ?? []), '/favicon.ico']
  const unexpectedRequests = step.failedRequests.filter((entry) => !expected.some((prefix) => String(entry.url ?? '').includes(prefix)))
  if (unexpectedRequests.length) {
    step.status = 'fail'
    step.errors.push(`非预期 HTTP 错误：${unexpectedRequests[0].url}`)
  }
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
    fixtureOrigin = fx.origin
    const slots = (await fx.json(`/api/plugins?root=${encodeURIComponent(fx.root)}`)).payload?.slots ?? {}
    const matrixCheck = validatePageMatrix(PAGE_MATRIX, { slots })
    if (!matrixCheck.ok) throw new Error(`矩阵与投影不一致：${matrixCheck.errors.join('；')}`)
    const selectedCheck = validatePageMatrix(pages, { slots })
    if (!selectedCheck.ok && !only) throw new Error(`所选页面矩阵不完整：${selectedCheck.errors.join('；')}`)
    browser = await launchCdpBrowser()
    for (const item of pages) await runPage(browser, item)
    return null
  }, { defaultRoot: pages.some((item) => item.scope === 'library'), localModule: pages.some((item) => item.setup === 'local-module'), knowledge: pages.some((item) => item.id.startsWith('knowledge-base')) })
} catch (error) {
  browserError = String(error?.message ?? error)
  console.error(`✗ 浏览器 smoke 启动/执行失败：${browserError}`)
} finally {
  if (browser) await browser.close().catch(() => {})
}

  const failed = steps.filter((step) => step.status !== 'pass').length
  const unexpected = steps.filter((step) => step.failedRequests.some((entry) => {
    const url = String(entry.url ?? '')
    return !url.endsWith('/favicon.ico') && !(step.expectedHttpErrors ?? []).some((prefix) => url.includes(prefix))
  })).length
const missing = pages.filter((item) => !steps.some((step) => step.id === item.id)).map((item) => item.id)
if (missing.length) browserError = `${browserError}；未执行页面：${missing.join(',')}`
const manifest = {
  spec: PAGE_MATRIX_SPEC.replace('matrix', 'report'), startedAt,
  finishedAt: new Date().toISOString(), repo: REPO, origin: fixtureOrigin,
  total: pages.length, pass: steps.length - failed, fail: failed, skipped: 0, unexpectedRequests: unexpected,
  browserError, steps
}
await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
await writeFile(join(out, 'run.log'), `OpenStory page browser smoke\n${manifest.finishedAt}\npass=${manifest.pass} fail=${manifest.fail} total=${manifest.total}\n${browserError}\n`, 'utf-8')
console.log(`\n页面浏览器 smoke：${manifest.pass} 过 / ${manifest.fail} 挂 / ${manifest.total} 总；产物 ${out}`)
process.exit(failed || missing.length || browserError ? 1 : 0)
