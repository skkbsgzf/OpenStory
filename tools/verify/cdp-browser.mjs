/**
 * 零依赖 Chromium CDP 客户端（页面测试用，不连接任何已运行浏览器/daemon）。
 * Node >=22 内置 WebSocket；浏览器路径可由 CHROMIUM_PATH/CHROME_PATH/EDGE_PATH 指定。
 */
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function findBrowser() {
  const candidates = [
    process.env.CHROMIUM_PATH, process.env.CHROME_PATH, process.env.EDGE_PATH,
    // Linux CI：GitHub runner 预装 google-chrome，比 apt 的 chromium（snap 过渡包，
    // 容器里常直接起不来）可靠；/usr/bin/chromium 的 snap shim 排在其后。
    '/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/opt/google/chrome/chrome',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    join(process.env.LOCALAPPDATA || '', 'Google/Chrome/Application/chrome.exe'),
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/chromium', '/usr/bin/chromium-browser'
  ].filter(Boolean)
  return candidates.find((file) => existsSync(file)) ?? ''
}

async function freePort() {
  const { createServer } = await import('node:http')
  return new Promise((done, fail) => {
    const server = createServer()
    server.once('error', fail)
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port
      server.close((error) => error ? fail(error) : done(port))
    })
  })
}

class CdpConnection {
  constructor(url) {
    this.url = url
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.ws = new WebSocket(url)
    this.open = new Promise((done, fail) => {
      this.ws.addEventListener('open', done, { once: true })
      this.ws.addEventListener('error', () => fail(new Error(`CDP WebSocket 连接失败：${url}`)), { once: true })
    })
    this.ws.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.id && this.pending.has(message.id)) {
        const { done, fail } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) fail(new Error(`${message.error.message} (${message.error.code})`))
        else done(message.result ?? {})
        return
      }
      for (const handler of this.handlers.get(message.method) ?? []) handler(message.params ?? {})
    })
  }

  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
  }

  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(new Error(`CDP 超时：${method}`)) }, timeoutMs)
      this.pending.set(id, {
        done: (value) => { clearTimeout(timer); done(value) },
        fail: (error) => { clearTimeout(timer); fail(error) }
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async close() {
    try { this.ws.close() } catch { /* 已关 */ }
  }
}

export class CdpBrowser {
  constructor({ browser, port, userDataDir, child, connection, page }) {
    this.browser = browser
    this.port = port
    this.userDataDir = userDataDir
    this.child = child
    this.connection = connection
    this.page = page
    this.consoleErrors = []
    this.pageErrors = []
    this.failedRequests = []
    this._wireEvents()
  }

  _wireEvents() {
    const c = this.connection
    c.on('Runtime.consoleAPICalled', ({ type, args }) => {
      if (type === 'error') this.consoleErrors.push(args.map((arg) => arg.value ?? arg.description ?? '').join(' '))
    })
    c.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
      this.pageErrors.push(exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'pageerror')
    })
    c.on('Log.entryAdded', ({ entry }) => {
      if (entry?.level === 'error' && !String(entry.url ?? '').startsWith('devtools://')) {
        this.failedRequests.push({ url: entry.url ?? '', text: entry.text ?? '' })
      }
    })
    c.on('Page.loadEventFired', () => { this.loaded = true })
  }

  async send(method, params = {}, timeoutMs) { return this.connection.send(method, params, timeoutMs) }

  async evaluate(expression, { timeoutMs = 10000 } = {}) {
    const result = await this.send('Runtime.evaluate', {
      expression, awaitPromise: true, returnByValue: true, userGesture: true, timeout: timeoutMs
    }, timeoutMs + 2000)
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails?.exception?.description ?? result.exceptionDetails?.text ?? '页面脚本异常')
    }
    return result.result?.value
  }

  async goto(url, { timeoutMs = 20000 } = {}) {
    this.loaded = false
    await this.send('Page.enable')
    await this.send('Runtime.enable')
    await this.send('Log.enable')
    await this.send('Page.navigate', { url }, timeoutMs)
    const deadline = Date.now() + timeoutMs
    while (!this.loaded && Date.now() < deadline) await sleep(50)
    if (!this.loaded) throw new Error(`页面加载超时：${url}`)
    await sleep(150)
  }

  async setViewport(width, height) {
    await this.send('Emulation.setDeviceMetricsOverride', {
      width, height, deviceScaleFactor: 1, mobile: false, screenWidth: width, screenHeight: height
    })
  }

  async click(selector) {
    const point = await this.evaluate(`(() => {
      const el = document.querySelector(${JSON.stringify(selector)});
      if (!el) return null;
      el.scrollIntoView({ block: 'center', inline: 'center' });
      const r = el.getBoundingClientRect();
      return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
    })()`)
    if (!point) throw new Error(`点击目标不存在：${selector}`)
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button: 'left', clickCount: 1 })
    await sleep(120)
  }

  async type(selector, text) {
    await this.evaluate(`(() => { const el=document.querySelector(${JSON.stringify(selector)}); if(el){el.focus(); el.value=${JSON.stringify(text)}; el.dispatchEvent(new Event('input',{bubbles:true})); el.dispatchEvent(new Event('change',{bubbles:true}));} })()`)
  }

  async wait(selector, timeout = 5000) {
    const deadline = Date.now() + timeout
    while (Date.now() < deadline) {
      if (await this.evaluate(`Boolean(document.querySelector(${JSON.stringify(selector)}))`)) return
      await sleep(100)
    }
    throw new Error(`等待元素超时：${selector}`)
  }

  async screenshot() {
    const result = await this.send('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false })
    return Buffer.from(result.data, 'base64')
  }

  async close() {
    await this.connection.close().catch(() => {})
    if (this.child && !this.child.killed) {
      this.child.kill()
      await Promise.race([new Promise((done) => this.child.once('exit', done)), sleep(3000)])
      if (!this.child.killed) this.child.kill('SIGKILL')
    }
    await rm(this.userDataDir, { recursive: true, force: true })
  }
}

export async function launchCdpBrowser({ executablePath = '', viewport = { width: 1500, height: 980 } } = {}) {
  const browser = executablePath || findBrowser()
  if (!browser) throw new Error('未找到 Chromium/Chrome/Edge；请设置 CHROMIUM_PATH')
  const port = await freePort()
  const userDataDir = await mkdtemp(join(tmpdir(), 'openstory-cdp-'))
  // CI（ubuntu-latest 容器）里 Chromium 以 root 跑、/dev/shm 只有 64MB，
  // 不带 --no-sandbox / --disable-dev-shm-usage 会静默启动失败，表现为 CDP 端口永不监听。
  const args = [
    '--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${userDataDir}`,
    '--no-first-run', '--no-default-browser-check', '--disable-background-networking',
    '--disable-component-update', '--disable-sync', '--disable-extensions', '--mute-audio',
    '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--disable-software-rasterizer'
  ]
  if (process.env.CDP_EXTRA_ARGS) args.push(...process.env.CDP_EXTRA_ARGS.split(/\s+/).filter(Boolean))
  args.push('about:blank')
  // stderr 收进环形缓冲：启动失败时报出浏览器自己说的话，否则只能看到「超时」。
  const child = spawn(browser, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
  let stderrTail = ''
  child.stderr?.setEncoding('utf8')
  child.stderr?.on('data', (chunk) => { stderrTail = (stderrTail + chunk).slice(-4000) })
  const deadline = Date.now() + 20000
  let version = null
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`浏览器启动失败：exit=${child.exitCode}${stderrTail ? `\n${stderrTail}` : ''}`)
    try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json() } catch { /* 等监听 */ }
    if (version?.webSocketDebuggerUrl) break
    await sleep(100)
  }
  if (!version?.webSocketDebuggerUrl) {
    child.kill('SIGKILL')
    await rm(userDataDir, { recursive: true, force: true })
    throw new Error(`Chromium CDP 启动超时（20s 内 :${port}/json/version 未监听）${stderrTail ? `\n${stderrTail}` : ''}`)
  }
  const connection = new CdpConnection(version.webSocketDebuggerUrl)
  await connection.open
  const { targetId } = await connection.send('Target.createTarget', { url: 'about:blank' })
  const flat = await connection.send('Target.attachToTarget', { targetId, flatten: true })
  const page = new CdpConnectionFromSession(connection, flat.sessionId)
  const instance = new CdpBrowser({ browser, port, userDataDir, child, connection: page, page: targetId })
  await instance.send('Page.enable')
  await instance.send('Runtime.enable')
  await instance.setViewport(viewport.width, viewport.height)
  return instance
}

/** 扁平 session：在 browser socket 上按 sessionId 转发。 */
class CdpConnectionFromSession {
  constructor(parent, sessionId) {
    this.parent = parent
    this.sessionId = sessionId
    this.id = 0
    this.pending = new Map()
    this.handlers = new Map()
    this.open = parent.open
    this.parent.ws.addEventListener('message', (event) => {
      let message
      try { message = JSON.parse(String(event.data)) } catch { return }
      if (message.sessionId !== this.sessionId) return
      if (message.id && this.pending.has(message.id)) {
        const { done, fail } = this.pending.get(message.id)
        this.pending.delete(message.id)
        if (message.error) fail(new Error(message.error.message))
        else done(message.result ?? {})
      } else {
        for (const handler of this.handlers.get(message.method) ?? []) handler(message.params ?? {})
      }
    })
  }
  on(method, handler) {
    if (!this.handlers.has(method)) this.handlers.set(method, [])
    this.handlers.get(method).push(handler)
  }
  send(method, params = {}, timeoutMs = 15000) {
    const id = ++this.id
    return new Promise((done, fail) => {
      const timer = setTimeout(() => { this.pending.delete(id); fail(new Error(`CDP 超时：${method}`)) }, timeoutMs)
      this.pending.set(id, { done: (v) => { clearTimeout(timer); done(v) }, fail: (e) => { clearTimeout(timer); fail(e) } })
      this.parent.ws.send(JSON.stringify({ id, method, params, sessionId: this.sessionId }))
    })
  }
  async close() { await this.parent.close() }
}
