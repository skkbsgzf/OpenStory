/**
 * OpenStory OS-18 用例（node:test，零依赖）——CLI 嫁接＋DSH 适配＋货架分组。
 *
 * 跑法：
 *   node --test test/agentRuntimes.test.mjs
 *
 * 夹具：临时目录里造一个假 CLI（node 脚本，读 argv 里 prompt，打印固定回答）——
 * 走真实 spawn 路径，不碰真 CodeBuddy/Qoder/Claude。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildCliArgs, composeCliPrompt, runCliChat } from '../src/services/cli-bridge.mjs'
import { detectDsh, pickChatBase } from '../src/services/dsh-bridge.mjs'
import { loadRuntimeKits, normalizeRuntimeKit, probeRuntimeKit, resetProbeCache, builtinRuntimesDir } from '../src/services/runtimes.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os18-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-16T00:00:00.000Z' }]
  }), 'utf-8')

  // 假 CLI：`node fake-cli.mjs -p <prompt>` → 打印「假CLI：<末 40 字>」
  const fakeCli = join(base, 'fake-cli.mjs')
  await writeFile(fakeCli, `
const args = process.argv.slice(2)
const flag = args.indexOf('-p')
const prompt = flag >= 0 ? args[flag + 1] : args.join(' ')
const lastLine = String(prompt ?? '').split('\\n').filter(Boolean).pop() ?? ''
process.stdout.write('假CLI：' + lastLine.slice(-40))
`, 'utf-8')
  // 会挂住的假 CLI（测超时 kill）
  const hangCli = join(base, 'hang-cli.mjs')
  await writeFile(hangCli, `setTimeout(() => {}, 600000)`, 'utf-8')

  return {
    base, root, preferencesPath, fakeCli, hangCli,
    configPath: join(base, 'agent-config.json'),
    sessionsDir: join(base, 'sessions'),
    runtimesDir: join(base, 'OpenStory', 'openstory', 'runtimes'),
    // env.LOCALAPPDATA=base 时默认货架＝base/OpenStory/openstory/runtimes（上面那行）
  }
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

/* ---------- 纯函数 ---------- */

test('CLI 提示词拼装：system 在前、历史顺排、角色标人话', () => {
  const prompt = composeCliPrompt([
    { role: 'system', content: '你是写作助手。' },
    { role: 'user', content: '第一章怎么开头？' },
    { role: 'assistant', content: '先写雾。' },
    { role: 'user', content: '再改一遍。' }
  ])
  assert.ok(prompt.startsWith('你是写作助手。'))
  assert.ok(prompt.includes('【作者】第一章怎么开头？'))
  assert.ok(prompt.includes('【助手】先写雾。'))
  assert.equal(buildCliArgs(['-p', '{prompt}'], 'X').args.join('|'), '-p|X')
  const stdinMode = buildCliArgs(['--chat'], 'Y')
  assert.equal(stdinMode.useStdin, true, '模板无 {prompt}＝走 stdin')
})

test('kit 规整：kind:cli 必须有 probe；kind:dsh 收；category 三值把门', () => {
  const cli = normalizeRuntimeKit({
    schemaVersion: 'openstory-runtime-kit@1', id: 'cli-x', name: 'X', kind: 'cli',
    probe: { cmd: 'node', args: ['--version'] }, cliArgs: ['-p', '{prompt}'], timeoutMs: 5000
  }, { source: '内置', dir: 'D:/k' })
  assert.equal(cli.ok, true)
  assert.equal(cli.kit.category, 'cli')
  assert.equal(cli.kit.timeoutMs, 5000)

  assert.equal(normalizeRuntimeKit({ schemaVersion: 'openstory-runtime-kit@1', id: 'cli-y', name: 'Y', kind: 'cli' }, { source: '内置', dir: 'd' }).ok, false, 'cli 缺 probe 拒')
  const dsh = normalizeRuntimeKit({ schemaVersion: 'openstory-runtime-kit@1', id: 'dsh', name: 'D', kind: 'dsh', category: 'dsh' }, { source: '内置', dir: 'D:/k' })
  assert.equal(dsh.ok, true)
  assert.equal(normalizeRuntimeKit({ schemaVersion: 'openstory-runtime-kit@1', id: 'z', name: 'Z', kind: 'sidecar', category: 'weird', command: { cmd: 'node' } }, { source: '内置', dir: 'd' }).ok, false)
})

test('货架：内置含四新 kit（三 CLI＋DSH）＋echo-kit', () => {
  const { kits } = loadRuntimeKits([builtinRuntimesDir()])
  const ids = kits.map((kit) => kit.id)
  for (const id of ['cli-codebuddy', 'cli-qoder', 'cli-claude', 'dsh', 'echo-kit']) assert.ok(ids.includes(id), `缺 ${id}`)
  assert.equal(kits.find((kit) => kit.id === 'cli-codebuddy').category, 'cli')
  assert.equal(kits.find((kit) => kit.id === 'dsh').category, 'dsh')
})

/* ---------- probe ---------- */

test('probe：真可执行＝installed＋版本行；不存在＝installed:false', async () => {
  resetProbeCache()
  const okKit = { id: 'probe-ok', probe: { cmd: process.execPath, args: ['--version'] } }
  const result = await probeRuntimeKit(okKit, { force: true })
  assert.equal(result.installed, true)
  assert.ok(result.version.length > 0)

  const missing = await probeRuntimeKit({ id: 'probe-missing', probe: { cmd: '绝对不存在的命令-xyz', args: [] } }, { force: true })
  assert.equal(missing.installed, false)
})

/* ---------- CLI 桥 ---------- */

test('CLI 桥：真 spawn 假 CLI → 输出回收；超时 kill 如实报', async () => {
  const { fakeCli, hangCli } = await makeFixture()
  try {
    const kit = { id: 'fake', probe: { cmd: process.execPath, args: [] }, cliArgs: [fakeCli, '-p', '{prompt}'], timeoutMs: 15000 }
    const ok = await runCliChat(kit, [{ role: 'system', content: '系统守则' }, { role: 'user', content: '第一章给一段' }])
    assert.equal(ok.ok, true)
    assert.ok(ok.text.includes('假CLI：'), ok.text)
    assert.ok(ok.text.includes('第一章给一段'))

    const hangKit = { id: 'hang', probe: { cmd: process.execPath, args: [] }, cliArgs: [hangCli], timeoutMs: 1200 }
    const started = Date.now()
    const timedOut = await runCliChat(hangKit, [{ role: 'user', content: 'x' }])
    assert.equal(timedOut.ok, false)
    assert.match(timedOut.message, /超时/)
    assert.ok(Date.now() - started < 12000, '按时 kill 不拖满')
  } finally {
    await rm((await import('node:path')).dirname(fakeCli), { recursive: true, force: true })
  }
})

/* ---------- DSH ---------- */

test('DSH 探测：显式 env 优先；无 env 且端口不通＝未运行；studio 文件挑 chat base', async () => {
  const explicit = await detectDsh({ env: { DSH_CHAT_ENDPOINT: 'http://127.0.0.1:9999/', LOCALAPPDATA: 'Z:/none' } })
  assert.equal(explicit.running, true)
  assert.equal(explicit.chatBase, 'http://127.0.0.1:9999')

  const off = await detectDsh({ env: { LOCALAPPDATA: 'Z:/definitely-none' }, fetchImpl: async () => { throw new Error('ECONNREFUSED') } })
  assert.equal(off.running, false)
  assert.match(off.message, /未运行/)

  assert.equal(pickChatBase({ studioUrl: 'http://127.0.0.1:8807/studio' }), 'http://127.0.0.1:8807')
  assert.equal(pickChatBase({ chatUrl: 'http://127.0.0.1:7000/chat' }), 'http://127.0.0.1:7000/chat')
  assert.equal(pickChatBase({}), '')
})

/* ---------- daemon 端到端（假 CLI 走真 spawn） ---------- */

test('daemon 端到端：选 cli kit（假 CLI）→ SSE 一片回吐→会话落档；未装 CLI→兜底 notice', async () => {
  const fixture = await makeFixture()
  await mkdir(join(fixture.runtimesDir, 'fake-cli'), { recursive: true })
  await writeFile(join(fixture.runtimesDir, 'fake-cli', 'manifest.json'), JSON.stringify({
    schemaVersion: 'openstory-runtime-kit@1',
    id: 'fake-cli',
    name: '假 CLI',
    kind: 'cli',
    probe: { cmd: process.execPath, args: ['--version'] },
    cliArgs: [fixture.fakeCli, '-p', '{prompt}']
  }), 'utf-8')
  await mkdir(join(fixture.runtimesDir, 'gone-cli'), { recursive: true })
  await writeFile(join(fixture.runtimesDir, 'gone-cli', 'manifest.json'), JSON.stringify({
    schemaVersion: 'openstory-runtime-kit@1',
    id: 'gone-cli',
    name: '不存在的 CLI',
    kind: 'cli',
    probe: { cmd: '绝对不存在的命令-abc', args: [] },
    cliArgs: ['-p', '{prompt}']
  }), 'utf-8')

  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    env: { ...process.env, LOCALAPPDATA: fixture.base, DSH_CHAT_ENDPOINT: '' },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const put = (path, body) => fetch(`${origin}${path}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const post = (path, body) => fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    // 货架：分组字段＋CLI 探测状态（假 CLI ready、不存在 missing、内置 CLI 至少一条）
    const shelves = await (await fetch(`${origin}/api/agent/runtimes`)).json()
    const fake = shelves.runtimes.find((runtime) => runtime.id === 'fake-cli')
    assert.equal(fake.status, 'ready')
    assert.equal(fake.category, 'cli')
    const gone = shelves.runtimes.find((runtime) => runtime.id === 'gone-cli')
    assert.equal(gone.status, 'missing')

    // 选假 CLI → 对话（一次性子进程）→ 一片 delta＋done，会话落档两条
    await put('/api/agent/runtime', { id: 'fake-cli' })
    const chat = await post('/api/agent/chat', { root: fixture.root, content: '第一章的开头给一段' })
    assert.equal(chat.status, 200)
    const frames = await readChatStream(chat)
    const startFrame = frames.find((frame) => frame.type === 'start')
    assert.equal(startFrame.runtime, '假 CLI')
    const deltas = frames.filter((frame) => frame.type === 'delta').map((frame) => frame.text).join('')
    assert.ok(deltas.includes('假CLI：'), deltas.slice(0, 80))
    const done = frames.find((frame) => frame.type === 'done')
    assert.equal(done.chars, deltas.length)
    const thread = await (await fetch(`${origin}/api/agent/session?root=${encodeURIComponent(fixture.root)}&id=${startFrame.sessionId}`)).json()
    assert.equal(thread.items.filter((item) => item.kind === 'msg').length, 2)

    // 选不存在的 CLI：无 Pi 端点 → 如实报错（不伪造）
    await put('/api/agent/runtime', { id: 'gone-cli' })
    const blocked = await post('/api/agent/chat', { root: fixture.root, content: '再来一段' })
    assert.equal(blocked.status, 502)
    const body = await blocked.json()
    assert.match(JSON.stringify(body), /CLI 不可用|不存在/)

    // 配了 Pi → 兜底 notice
    await put('/api/agent/config', { endpoint: 'http://127.0.0.1:1/v1/chat/completions', model: 'm' })
    const fallback = await post('/api/agent/chat', { root: fixture.root, content: '兜底' })
    // 上游 1 端口连不上 → 502（notice 先于上游失败不会出现——这里只验不静默成功）
    assert.equal(fallback.status, 502)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
