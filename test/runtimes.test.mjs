/**
 * OpenStory OS-9 用例（node:test，零依赖）——运行时 kit 货架：发现/校验/sidecar 生命周期/兜底。
 *
 * 跑法：
 *   node --test openstory/test/runtimes.test.mjs
 *
 * 端到端走内置 echo-kit（参考套件＝测试夹具）与本机夹具上游（Pi 兜底），不碰真实模型端点。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer as createHttpServer } from 'node:http'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import {
  builtinRuntimesDir,
  loadRuntimeKits,
  normalizeRuntimeKit,
  sidecarRunning
} from '../src/services/runtimes.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os9-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1, libraries: [{ path: root, name: '夹具库', at: '2026-11-15T00:00:00.000Z' }]
  }), 'utf-8')
  return {
    base, root, preferencesPath,
    configPath: join(base, 'agent-config.json'),
    sessionsDir: join(base, 'sessions'),
    userRuntimes: join(base, 'OpenStory', 'openstory', 'runtimes')
  }
}

/** Pi 兜底用的夹具上游（标准 SSE 回声，与 agent.test.mjs 同款）。 */
async function startFakeUpstream() {
  const server = createHttpServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      server.lastBody = (() => { try { return JSON.parse(body || '{}') } catch { return {} } })()
      const lastUser = [...(server.lastBody.messages || [])].reverse().find((message) => message.role === 'user')
      const reply = `Pi 说：${String(lastUser?.content ?? '').slice(0, 60)}`
      res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8' })
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`)
      res.write('data: [DONE]\n\n')
      res.end()
    })
  })
  await new Promise((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise))
  return { server, url: `http://127.0.0.1:${server.address().port}/v1/chat/completions` }
}

async function readChatStream(response) {
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let raw = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    raw += decoder.decode(value, { stream: true })
  }
  return raw.split('\n\n').filter((block) => block.trim()).map((block) => {
    const line = block.split('\n').find((row) => row.startsWith('data:'))
    return line ? JSON.parse(line.slice(5).trim()) : null
  }).filter(Boolean)
}

/* ---------- kit 规整 ---------- */

const GOOD_SIDECAR = {
  schemaVersion: 'openstory-runtime-kit@1',
  id: 'echo-kit',
  name: '回声参考套件',
  kind: 'sidecar',
  command: { cmd: 'node', args: ['server.mjs'], cwd: '.' },
  chatPath: '/v1/chat/completions',
  healthPath: '/healthz',
  port: 'allocate'
}

test('kit 规整：合法 sidecar/endpoint 收下；schema/id/command/url/port/chatPath 逐项把门', () => {
  const ok = normalizeRuntimeKit(GOOD_SIDECAR, { source: '内置', dir: 'D:/kits/echo-kit' })
  assert.equal(ok.ok, true)
  assert.equal(ok.kit.command.cwd.includes('echo-kit'), true, 'cwd 相对 kit 目录解析')
  assert.equal(ok.kit.port, 'allocate')

  const endpoint = normalizeRuntimeKit({ ...GOOD_SIDECAR, id: 'dsh', kind: 'endpoint', url: 'http://127.0.0.1:9230' }, { source: '本机', dir: 'D:/kits/dsh' })
  assert.equal(endpoint.ok, true)
  assert.equal(endpoint.kit.url, 'http://127.0.0.1:9230')

  assert.equal(normalizeRuntimeKit({ ...GOOD_SIDECAR, schemaVersion: 'x' }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeRuntimeKit({ ...GOOD_SIDECAR, id: '坏 id' }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeRuntimeKit({ ...GOOD_SIDECAR, command: {} }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeRuntimeKit({ ...GOOD_SIDECAR, kind: 'endpoint' }, { source: '内置', dir: 'd' }).ok, false, 'endpoint 缺 url')
  assert.equal(normalizeRuntimeKit({ ...GOOD_SIDECAR, kind: 'endpoint', url: 'ftp://x' }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeRuntimeKit({ ...GOOD_SIDECAR, port: 99999 }, { source: '内置', dir: 'd' }).ok, false)
  assert.equal(normalizeRuntimeKit({ ...GOOD_SIDECAR, chatPath: '/a?b=c' }, { source: '内置', dir: 'd' }).ok, false)
})

test('kit 货架：内置有 echo-kit；本机覆盖同名；坏 kit 记 warning', async () => {
  const { base, userRuntimes } = await makeFixture()
  try {
    const builtin = loadRuntimeKits([builtinRuntimesDir(), userRuntimes])
    assert.ok(builtin.kits.some((kit) => kit.id === 'echo-kit' && kit.source === '内置'))

    await mkdir(join(userRuntimes, 'echo-kit'), { recursive: true })
    await writeFile(join(userRuntimes, 'echo-kit', 'manifest.json'), JSON.stringify({
      ...GOOD_SIDECAR, name: '回声（本机改）'
    }), 'utf-8')
    await mkdir(join(userRuntimes, '坏kit'), { recursive: true })
    await writeFile(join(userRuntimes, '坏kit', 'manifest.json'), JSON.stringify({ id: 'x' }), 'utf-8')
    const merged = loadRuntimeKits([builtinRuntimesDir(), userRuntimes])
    const echo = merged.kits.find((kit) => kit.id === 'echo-kit')
    assert.equal(echo.name, '回声（本机改）')
    assert.equal(echo.source, '本机')
    assert.ok(merged.warnings.some((warning) => warning.code === 'RUNTIME_KIT_SPEC'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 契约 ---------- */

test('契约：agentRuntimesGet/agentRuntimePut 形状', () => {
  assert.equal(validateRequest('agentRuntimesGet', {}).ok, true)
  assert.equal(validateRequest('agentRuntimePut', { id: 'echo-kit' }).ok, true)
  assert.equal(validateRequest('agentRuntimePut', { id: '' }).ok, true, '空串＝回 Pi 兜底')
  assert.equal(validateResponse('agentRuntimesGet', { ok: true, active: '', runtimes: [] }).ok, true)
  assert.equal(validateResponse('agentRuntimePut', { ok: true, active: 'echo-kit' }).ok, true)
})

/* ---------- daemon 端到端 ---------- */

test('daemon 端到端：选 echo-kit→sidecar 拉起→chat 回声落档；切回 Pi；坏 kit→兜底 notice', async () => {
  const fixture = await makeFixture()
  const upstream = await startFakeUpstream()
  // OS-150b：内置 echo-kit 是 fixture 套件，PUT 已拒收（AGENT_RUNTIME_FIXTURE）。
  // 这里用同一份 sidecar 实现的非夹具克隆（fixture 缺省 false）跑端到端——
  // 验的还是 sidecar 生命周期/回声/落档，不验「夹具可以被激活」。
  await mkdir(join(fixture.userRuntimes, 'echo-live'), { recursive: true })
  await writeFile(join(fixture.userRuntimes, 'echo-live', 'manifest.json'), JSON.stringify({
    ...GOOD_SIDECAR,
    id: 'echo-live',
    name: '回声（测试用非夹具）',
    command: { cmd: 'node', args: [join(builtinRuntimesDir(), 'echo-kit', 'server.mjs')], cwd: '.' }
  }), 'utf-8')
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    env: { ...process.env, LOCALAPPDATA: fixture.base },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const put = (path, body) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    // 货架：Pi＋内置 echo-kit
    const shelves = await (await fetch(`${origin}/api/agent/runtimes`)).json()
    assert.equal(shelves.ok, true)
    assert.equal(shelves.active, '')
    assert.equal(shelves.runtimes[0].id, '')
    assert.equal(shelves.runtimes[0].kind, 'pi')
    assert.ok(shelves.runtimes.some((runtime) => runtime.id === 'echo-kit' && runtime.source === '内置'))

    // 选非夹具 sidecar 克隆 → 不配 Pi 端点也能聊（sidecar 自动拉起）
    const selected = await put('/api/agent/runtime', { id: 'echo-live' })
    assert.equal((await selected.json()).active, 'echo-live')
    const cfg = await (await fetch(`${origin}/api/agent/config`)).json()
    assert.equal(cfg.runtime, 'echo-live')
    assert.equal(cfg.configured, true, '有活动 kit 即 configured')

    const chat = await post('/api/agent/chat', { root: fixture.root, content: '第一章怎么开头？' })
    assert.equal(chat.status, 200)
    const frames = await readChatStream(chat)
    assert.equal(frames[0].type, 'start')
    const sessionId = frames[0].sessionId
    const deltas = frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text).join('')
    assert.ok(deltas.includes('回声（echo-kit）：第一章怎么开头'), `echo-kit 接管：${deltas.slice(0, 80)}`)
    assert.equal(sidecarRunning('echo-live'), true, 'sidecar 已被 daemon 拉起并存活')
    const thread = await (await fetch(`${origin}/api/agent/session?root=${encodeURIComponent(fixture.root)}&id=${sessionId}`)).json()
    assert.equal(thread.items.filter((item) => item.kind === 'msg').length, 2, '会话照常落档')

    // 未货架的 kit 拒收
    const badSelect = await put('/api/agent/runtime', { id: 'nope' })
    assert.equal(badSelect.status, 400)

    // 切回 Pi：配夹具上游 → chat 走 Pi
    await put('/api/agent/config', { endpoint: upstream.url, model: '夹具模型' })
    await put('/api/agent/runtime', { id: '' })
    const chatPi = await post('/api/agent/chat', { root: fixture.root, content: '第二句呢？' })
    const framesPi = await readChatStream(chatPi)
    const deltasPi = framesPi.filter((frame) => frame.type === 'delta').map((frame) => frame.text).join('')
    assert.ok(deltasPi.includes('Pi 说：'), `Pi 兜底接管：${deltasPi.slice(0, 60)}`)

    // 坏 kit（命令指不到文件）→ 起不来 → 兜底 notice＋Pi 接管
    await mkdir(join(fixture.userRuntimes, 'broken-kit'), { recursive: true })
    await writeFile(join(fixture.userRuntimes, 'broken-kit', 'manifest.json'), JSON.stringify({
      ...GOOD_SIDECAR, id: 'broken-kit', name: '坏套件', command: { cmd: 'node', args: ['绝不存在的文件.mjs'] }
    }), 'utf-8')
    // daemon 的货架每请求现读；本机位＝LOCALAPPDATA（已由 env 指向夹具）。
    await put('/api/agent/runtime', { id: 'broken-kit' })
    const chatFallback = await post('/api/agent/chat', { root: fixture.root, content: '兜底测试' })
    const framesFallback = await readChatStream(chatFallback)
    const notice = framesFallback.find((frame) => frame.type === 'notice')
    assert.ok(notice, '兜底要发 notice 帧')
    assert.match(notice.text, /坏套件/)
    const deltasFallback = framesFallback.filter((frame) => frame.type === 'delta').map((frame) => frame.text).join('')
    assert.ok(deltasFallback.includes('Pi 说：'), 'kit 起不来时 Pi 接管')
  } finally {
    await daemon.close()
    await new Promise((resolvePromise) => upstream.server.close(resolvePromise))
    await rm(fixture.base, { recursive: true, force: true })
  }
})
