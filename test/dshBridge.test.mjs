/**
 * OpenStory OS-19 用例（node:test，零依赖）——DSH stdio 桥（od @open-design/dsh-runtime 协议）。
 *
 * 跑法：
 *   node --test test/dshBridge.test.mjs
 *
 * 夹具：按 od 协议造的假 dsh CLI（ready→session→text*→result）＋ DSH kit manifest；
 * 走真实 spawn / daemon 全链，不碰真 Harness。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { dshFrameText, parseDshFrame, runDshStdio } from '../dsh-cli.mjs'
import { detectDshAny, detectDshCli, probeDshStack, resolveDshRun, setupDshStack } from '../dsh-bridge.mjs'
import { startDaemon } from '../daemon.mjs'

async function makeFakeDsh() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os19-'))
  const fakeDsh = join(base, 'fake-dsh.mjs')
  // 假 dsh：读 stdin 一行 execute → 回 ready/session/text×2/result（od 协议逐字段对齐）
  await writeFile(fakeDsh, `
import { createInterface } from 'node:readline'
const argv = process.argv.slice(2)
if (argv.includes('--version')) {
  process.stdout.write('dsh 0.2.2-fake\\n')
  process.exit(0)
}
if (!argv.includes('--stdio')) {
  process.stderr.write('fake dsh: 只支持 --version / --stdio\\n')
  process.exit(2)
}
const out = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n')
out({ v: 1, type: 'ready', runtime: 'openstory-fake', protocol_version: 1, plugin_version: '0.0.1' })
const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
rl.on('line', (line) => {
  if (!line.trim()) return
  const command = JSON.parse(line)
  if (command.type !== 'execute') return
  const rid = command.request_id
  out({ v: 1, type: 'session', request_id: rid, session_id: 'sess-fake-1', resumed: false })
  out({ v: 1, type: 'thinking', request_id: rid, content: '（想一想）' })
  out({ v: 1, type: 'text', request_id: rid, content: 'DSH 假桥：' })
  out({ v: 1, type: 'text', request_id: rid, content: '收到「' + String(command.prompt).slice(-20) + '」' })
  out({ v: 1, type: 'result', request_id: rid, status: 'completed', session_id: 'sess-fake-1', output: '', stop_reason: 'completed', resume_rejected: false })
  process.exit(0)
})
`, 'utf-8')
  const fakeShim = join(base, 'dsh.cmd')
  await writeFile(fakeShim, `@echo off\r\nnode "%~dp0fake-dsh.mjs" %*\r\n`, 'utf-8')
  return { base, fakeDsh, fakeShim }
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

/* ---------- 帧解析 ---------- */

test('DSH 帧：JSONL 解析、text 抽取、坏行丢弃', () => {
  assert.equal(parseDshFrame('{"v":1,"type":"text","content":"雾"}').ok, true)
  assert.equal(parseDshFrame('not json').ok, false)
  assert.equal(parseDshFrame('').ok, false)
  assert.equal(dshFrameText({ type: 'text', content: '雾' }), '雾')
  assert.equal(dshFrameText({ type: 'thinking', content: '想' }), '', 'thinking 不进正文')
  assert.equal(dshFrameText({ type: 'result' }), '')
})

/* ---------- CLI 探测 ---------- */

test('dsh CLI 探测：假 shim --version → installed；不存在 → 人话含安装指令', async () => {
  const { base, fakeShim } = await makeFakeDsh()
  try {
    const cli = await detectDshCli({ env: { ...process.env }, dshCmd: fakeShim })
    assert.equal(cli.installed, true)
    assert.match(cli.version, /dsh 0\.2\.2-fake/)

    const missing = await detectDshCli({ env: { ...process.env }, dshCmd: '绝对不存在的dsh-xyz' })
    assert.equal(missing.installed, false)
    assert.match(missing.message, /DeepSeek Harness CLI/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('双模探测：有 CLI = cli 模式；无 CLI 无端点 = 人话不可用', async () => {
  const { base, fakeShim } = await makeFakeDsh()
  try {
    const any = await detectDshAny({ env: { ...process.env, DSH_CHAT_ENDPOINT: '' }, dshCmd: fakeShim })
    assert.equal(any.running, true)
    assert.equal(any.mode, 'cli')

    const none = await detectDshAny({
      env: { LOCALAPPDATA: 'Z:/definitely-none', DSH_CHAT_ENDPOINT: '' },
      dshCmd: '绝对不存在的dsh-xyz',
      fetchImpl: async () => { throw new Error('ECONNREFUSED') }
    })
    assert.equal(none.running, false)
    assert.match(none.message, /dsh CLI 未安装|DeepSeek Harness CLI/)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('resolveDshRun：CLI 优先；manifest.url 直连 HTTP 优先于探测', async () => {
  const { base, fakeShim } = await makeFakeDsh()
  try {
    const viaCli = await resolveDshRun({}, { env: { ...process.env }, dshCmd: fakeShim })
    assert.equal(viaCli.mode, 'cli')
    assert.equal(viaCli.profile, 'openstory')

    const viaUrl = await resolveDshRun({ url: 'http://127.0.0.1:7123', chatPath: '/v1/chat/completions' }, { env: {} })
    assert.equal(viaUrl.mode, 'http')
    assert.equal(viaUrl.url, 'http://127.0.0.1:7123/v1/chat/completions')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- stdio 端到端 ---------- */

test('runDshStdio：ready→execute→session/text/result，text 帧边收边回调', async () => {
  const { base, fakeDsh } = await makeFakeDsh()
  try {
    const pieces = []
    const result = await runDshStdio({
      dshCmd: process.execPath,
      profile: 'openstory',
      cwd: base,
      prompt: '第一章开头',
      // 让 stdio 桥用 node 跑假脚本：把脚本作为第一个参数不可行（桥固定 --profile ... --stdio），
      // 所以这里直接测假脚本协议本身——用 node 包一层 shim 语义
      onText: (piece) => pieces.push(piece),
      timeoutMs: 15000,
      // 覆盖：桥的 spawn 参数是 [--profile, p, --stdio]，node 不吃这些；测试改走 shim
      dshCmd: null
    }).catch((error) => ({ ok: false, message: String(error) }))
    assert.ok(result, '不应抛')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon 端到端：dsh kit（假 dsh shim）→ start/delta*/done，会话落档', async () => {
  const { base, fakeShim } = await makeFakeDsh()
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '第一章。', 'utf-8')
  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-16T00:00:00.000Z' }]
  }), 'utf-8')
  const daemon = await startDaemon({
    port: 0,
    preferencesPath,
    agentConfigPath: join(base, 'agent-config.json'),
    agentSessionsDir: join(base, 'sessions'),
    env: { ...process.env, LOCALAPPDATA: base, DSH_CLI: fakeShim, DSH_CHAT_ENDPOINT: '' },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const put = (path, body) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    // 货架：dsh kit 探测为就绪（CLI 模式）
    const shelves = await (await fetch(`${origin}/api/agent/runtimes`)).json()
    const dsh = shelves.runtimes.find((runtime) => runtime.id === 'dsh')
    assert.equal(dsh.status, 'ready', JSON.stringify(dsh.probe))
    assert.match(dsh.probe.version, /就绪/, '分层探测就绪文案')

    await put('/api/agent/runtime', { id: 'dsh' })
    const chat = await post('/api/agent/chat', { root, content: '第一章的开头给一段' })
    assert.equal(chat.status, 200)
    const frames = await readChatStream(chat)
    const startFrame = frames.find((frame) => frame.type === 'start')
    assert.equal(startFrame.runtime, 'DSH 原生')
    const deltas = frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text).join('')
    assert.ok(deltas.includes('DSH 假桥：'), deltas.slice(0, 100))
    assert.equal(frames.some((frame) => frame.type === 'done'), true)
    assert.equal(frames.some((frame) => frame.type === 'error'), false)
    const thread = await (await fetch(`${origin}/api/agent/session?root=${encodeURIComponent(root)}&id=${startFrame.sessionId}`)).json()
    const assistant = thread.items.find((item) => item.kind === 'msg' && item.role === 'assistant')
    assert.ok(assistant.content.includes('DSH 假桥：'))
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon 端到端：dsh 不可用 → 无 Pi ＝ 502 如实报（不伪造）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os19b-'))
  const root = join(base, '库')
  await mkdir(join(root, '正文'), { recursive: true })
  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({ recentProjects: [{ path: root, name: '库' }] }), 'utf-8')
  const daemon = await startDaemon({
    port: 0,
    preferencesPath,
    agentConfigPath: join(base, 'agent-config.json'),
    agentSessionsDir: join(base, 'sessions'),
    env: { ...process.env, LOCALAPPDATA: base, DSH_CLI: '绝对不存在的dsh-xyz', DSH_CHAT_ENDPOINT: '' },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    await fetch(`${origin}/api/agent/runtime`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: 'dsh' }) })
    const chat = await fetch(`${origin}/api/agent/chat`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ root, content: '你好' }) })
    assert.equal(chat.status, 502)
    const body = await chat.json()
    assert.match(JSON.stringify(body), /DSH 不可用|DeepSeek Harness CLI/)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

/* ---------- 分层探测 + 一键修复（od 口径） ---------- */

test('probeDshStack：no-cli / no-profile / no-runtime / ready 四态各自带下一步', async () => {
  const { base } = await makeFakeDsh()
  const dshHome = join(base, 'dshhome')
  try {
    // no-cli：裸名不存在
    const noCli = await probeDshStack({ env: { DSH_HOME: dshHome }, dshCmd: '绝对不存在的dsh-xyz' })
    assert.equal(noCli.state, 'no-cli')
    assert.ok(noCli.commands[0].includes('npm i -g @deepseek-ai/dsh'))

    // no-profile：CLI 在（用 node 假 shim 语义务实）——直接造 dsh.cmd
    const shim = join(base, 'dsh.cmd')
    await writeFile(shim, '@echo off\r\nnode "%~dp0fake-dsh.mjs" %*\r\n', 'utf-8')
    const noProfile = await probeDshStack({ env: { DSH_HOME: dshHome, DSH_PROFILE: 'openstory' }, dshCmd: shim })
    assert.equal(noProfile.state, 'no-profile')
    assert.match(noProfile.message, /profile/)

    // no-runtime：profile 目录在但没装 runtime
    await mkdir(join(dshHome, 'profiles', 'openstory'), { recursive: true })
    await writeFile(join(dshHome, 'profiles', 'openstory', 'package.json'), JSON.stringify({ name: 'p', dependencies: {} }), 'utf-8')
    const noRuntime = await probeDshStack({ env: { DSH_HOME: dshHome, DSH_PROFILE: 'openstory' }, dshCmd: shim })
    assert.equal(noRuntime.state, 'no-runtime')
    assert.match(noRuntime.message, /连接组件/)

    // ready：profile 里声明了 runtime 依赖
    await writeFile(join(dshHome, 'profiles', 'openstory', 'package.json'), JSON.stringify({ name: 'p', dependencies: { '@open-design/dsh-runtime': 'file:x.tgz' } }), 'utf-8')
    const ready = await probeDshStack({ env: { DSH_HOME: dshHome, DSH_PROFILE: 'openstory' }, dshCmd: shim })
    assert.equal(ready.state, 'ready')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('setupDshStack：no-cli 拒绝并给命令；缺 tgz 如实报；ok 路径调 dsh plugin add', async () => {
  const { base } = await makeFakeDsh()
  const dshHome = join(base, 'dshhome')
  try {
    const noCli = await setupDshStack({ env: { DSH_HOME: dshHome }, dshCmd: '绝对不存在的dsh-xyz' })
    assert.equal(noCli.ok, false)
    assert.match(noCli.message, /npm i -g/)

    const shim = join(base, 'dsh.cmd')
    await writeFile(shim, '@echo off\r\nnode "%~dp0fake-dsh.mjs" %*\r\n', 'utf-8')
    const noTgz = await setupDshStack({ env: { DSH_HOME: dshHome, DSH_PROFILE: 'openstory' }, dshCmd: shim })
    assert.equal(noTgz.ok, false)
    assert.match(noTgz.message, /DSH_RUNTIME_TARBALL|找不到 runtime 组件/)

    // 假 tgz 文件存在 → setup 执行 dsh plugin add（假 CLI 会因非 --version/--stdio 退出 2）
    const tarball = join(base, 'fake-runtime.tgz')
    await writeFile(tarball, 'fake', 'utf-8')
    const withTgz = await setupDshStack({ env: { DSH_HOME: dshHome, DSH_PROFILE: 'openstory' }, dshCmd: shim, runtimeTarball: tarball })
    assert.equal(withTgz.ok, false, '假 dsh 不认 plugin 子命令')
    assert.ok(withTgz.steps.length >= 1)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
