/**
 * OS-136 来源防护用例（node:test，零依赖）。
 *
 * 覆盖四层闸的八种面（对抗请求一律走 node:http 裸请求——fetch 的 Host/Origin
 * 是禁止头，手动设不了，伪造不了浏览器攻击面）：
 *   ① Host 闸：不符回环名＋实际端口 → 403（全局，静态资源同样吃闸）；
 *   ② Origin 闸：跨站 Origin → 403；
 *   ③ Origin: null → 403；
 *   ④ Sec-Fetch-Site: cross-site → 403；
 *   ⑤ text/plain body → 400（UNSUPPORTED_MEDIA_TYPE）；
 *   ⑥ 同源 Origin → 200；
 *   ⑦ 既无 Origin 也无 Sec-Fetch 的 node 客户端（fetch/curl/mcp.mjs 面）→ 200；
 *   ⑧ Host 为 localhost＋实际端口 → 200。
 *
 * 跑法：node .zcode/run-gate.mjs（会 chdir 到仓根后跑全量）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { request as httpRequest } from 'node:http'
import { connect } from 'node:net'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'

/** node:http 裸请求：Host / Origin / Sec-Fetch-Site 想填什么填什么（fetch 做不到）。 */
function rawRequest({ port, path, method = 'GET', headers = {}, body = '' }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const req = httpRequest({ host: '127.0.0.1', port, path, method, headers }, (res) => {
      let raw = ''
      res.on('data', (chunk) => { raw += chunk })
      res.on('end', () => {
        let payload = null
        try { payload = JSON.parse(raw) } catch { /* 非 JSON 响应保持 null */ }
        resolvePromise({ status: res.statusCode, text: raw, payload })
      })
    })
    req.on('error', rejectPromise)
    if (body) req.write(body)
    req.end()
  })
}

/** TCP 裸 socket 请求：测「完全没有 Host 头」——node:http 客户端会自作主张补 Host，绕不开。 */
function rawSocketRequest(port, requestText) {
  return new Promise((resolvePromise, rejectPromise) => {
    const socket = connect(port, '127.0.0.1', () => { socket.write(requestText) })
    let raw = ''
    socket.on('data', (chunk) => { raw += chunk })
    socket.on('close', () => resolvePromise(raw))
    socket.on('error', rejectPromise)
  })
}

async function makeEnv() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-origin-'))
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ recentProjects: [] }), 'utf-8')
  const daemon = await startDaemon({
    port: 0,
    preferencesPath,
    env: { ...process.env, LOCALAPPDATA: base },
    logger: { log() {} }
  })
  return {
    base,
    port: daemon.port,
    origin: `http://127.0.0.1:${daemon.port}`,
    async close() {
      await daemon.close()
      await rm(base, { recursive: true, force: true })
    }
  }
}

test('来源防护①：Host 不在回环白名单（外部域名／错端口）一律 403，静态资源同样吃闸', async () => {
  const env = await makeEnv()
  try {
    const evil = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `evil.example.com:${env.port}` }
    })
    assert.equal(evil.status, 403, `实际 ${evil.status}：${evil.text}`)
    assert.equal(evil.payload?.error?.code, 'FORBIDDEN_ORIGIN')

    // 回环名但端口不对（DNS 重绑定的另一形态：把 127.0.0.1:9999 当 Host）也不放行
    const wrongPort = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port + 1}` }
    })
    assert.equal(wrongPort.status, 403)

    // 全局闸：静态资源路径同样拒——读得到 app.js 就等于读得到一切
    const staticEvil = await rawRequest({
      port: env.port, path: '/',
      headers: { host: `evil.example.com:${env.port}` }
    })
    assert.equal(staticEvil.status, 403)

    // 无 Host 头（HTTP/1.0 客户端）同样拒收——node:http 客户端补不了这种缺口，走裸 socket
    const noHostRaw = await rawSocketRequest(env.port, 'GET /api/health HTTP/1.0\r\n\r\n')
    assert.match(noHostRaw, /^HTTP\/1\.1 403 /u, `无 Host 头要 403，实际：${noHostRaw.split('\r\n')[0]}`)
  } finally {
    await env.close()
  }
})

test('来源防护②：跨站 Origin → 403；不带 Origin 的本机进程不受影响', async () => {
  const env = await makeEnv()
  try {
    const cross = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port}`, origin: 'https://evil.example.com' }
    })
    assert.equal(cross.status, 403, `实际 ${cross.status}：${cross.text}`)
    assert.equal(cross.payload?.error?.code, 'FORBIDDEN_ORIGIN')

    // 别的端口上的同机页面也算跨站（Origin 是源不是主机）
    const otherPort = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port}`, origin: `http://127.0.0.1:${env.port + 1}` }
    })
    assert.equal(otherPort.status, 403)
  } finally {
    await env.close()
  }
})

test('来源防护③：Origin: null → 403（sandbox iframe／重定向都会送这个值）', async () => {
  const env = await makeEnv()
  try {
    const nulled = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port}`, origin: 'null' }
    })
    assert.equal(nulled.status, 403, `实际 ${nulled.status}：${nulled.text}`)
    assert.equal(nulled.payload?.error?.code, 'FORBIDDEN_ORIGIN')
  } finally {
    await env.close()
  }
})

test('来源防护④：Sec-Fetch-Site 为 cross-site / same-site → 403', async () => {
  const env = await makeEnv()
  try {
    const crossSite = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port}`, 'sec-fetch-site': 'cross-site' }
    })
    assert.equal(crossSite.status, 403, `实际 ${crossSite.status}：${crossSite.text}`)
    assert.equal(crossSite.payload?.error?.code, 'FORBIDDEN_ORIGIN')

    const sameSite = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port}`, 'sec-fetch-site': 'same-site' }
    })
    assert.equal(sameSite.status, 403, 'same-site 只差一个端口也算非同源')
  } finally {
    await env.close()
  }
})

test('来源防护⑤：带 body 但 content-type 不是 application/json → 400', async () => {
  const env = await makeEnv()
  const body = JSON.stringify({ path: env.base })
  try {
    const plain = await rawRequest({
      port: env.port, path: '/api/fs/browse', method: 'POST',
      headers: { host: `127.0.0.1:${env.port}`, 'content-type': 'text/plain', 'content-length': Buffer.byteLength(body) },
      body
    })
    assert.equal(plain.status, 400, `实际 ${plain.status}：${plain.text}`)
    assert.equal(plain.payload?.error?.code, 'UNSUPPORTED_MEDIA_TYPE')

    // 完全不带 content-type 的 body 同样拒（这正是跨站表单 GET/POST 的默认形态之一）
    const noType = await rawRequest({
      port: env.port, path: '/api/fs/browse', method: 'POST',
      headers: { host: `127.0.0.1:${env.port}`, 'content-length': Buffer.byteLength(body) },
      body
    })
    assert.equal(noType.status, 400)

    // 允许 charset 等参数后缀
    const withCharset = await rawRequest({
      port: env.port, path: '/api/fs/browse', method: 'POST',
      headers: { host: `127.0.0.1:${env.port}`, 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) },
      body
    })
    assert.equal(withCharset.status, 200, `application/json; charset=utf-8 要放行，实际 ${withCharset.status}：${withCharset.text}`)
  } finally {
    await env.close()
  }
})

test('来源防护⑥：同源 Origin（127.0.0.1 与 localhost 两种写法）→ 200', async () => {
  const env = await makeEnv()
  try {
    const sameIp = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port}`, origin: `http://127.0.0.1:${env.port}` }
    })
    assert.equal(sameIp.status, 200, `实际 ${sameIp.status}：${sameIp.text}`)
    assert.equal(sameIp.payload?.ok, true)

    const sameNamed = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `127.0.0.1:${env.port}`, origin: `http://localhost:${env.port}` }
    })
    assert.equal(sameNamed.status, 200, '页面在 127.0.0.1、Origin 写 localhost：同为回环源，放行')

    // 同源页面的正常写请求形态：Origin ＋ same-origin 标 ＋ JSON body 一起过
    const writer = await rawRequest({
      port: env.port, path: '/api/fs/browse', method: 'POST',
      headers: {
        host: `127.0.0.1:${env.port}`,
        origin: `http://127.0.0.1:${env.port}`,
        'sec-fetch-site': 'same-origin',
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(JSON.stringify({ path: env.base }))
      },
      body: JSON.stringify({ path: env.base })
    })
    assert.equal(writer.status, 200, `实际 ${writer.status}：${writer.text}`)
  } finally {
    await env.close()
  }
})

test('来源防护⑦：既无 Origin 也无 Sec-Fetch 的 node 客户端（mcp.mjs/curl 面）→ 200', async () => {
  const env = await makeEnv()
  try {
    const response = await fetch(`${env.origin}/api/health`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)
  } finally {
    await env.close()
  }
})

test('来源防护⑧：Host 为 localhost＋实际端口 → 200（回环名白名单含 localhost 与 [::1]）', async () => {
  const env = await makeEnv()
  try {
    const response = await fetch(`http://localhost:${env.port}/api/health`)
    assert.equal(response.status, 200)
    const payload = await response.json()
    assert.equal(payload.ok, true)

    // IPv6 回环写法同样在白名单（连接仍走 127.0.0.1，只是 Host 头声明成 [::1]）
    const v6 = await rawRequest({
      port: env.port, path: '/api/health',
      headers: { host: `[::1]:${env.port}` }
    })
    assert.equal(v6.status, 200, `实际 ${v6.status}：${v6.text}`)
  } finally {
    await env.close()
  }
})
