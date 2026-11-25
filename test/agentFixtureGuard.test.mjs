/**
 * OS-150b 用例：夹具套件不许被设为激活运行时。
 *
 * 背景（OS-150a 复核 low）：echo-kit 是 kit 作者的骨架模板＋测试夹具，OS-149 已让它不进
 * 作者可见的货架/下拉；但 PUT /api/agent/runtime 只校验 id 在 kits 里，手改配置或直接 PUT
 * 仍能把夹具设成「当前激活」，Agent 栏 chip 于是显示「回声参考套件」。
 *
 * 钉两件事：
 *   ① 后端拒收（AGENT_RUNTIME_FIXTURE，既有错误形状 { ok:false, error:{ code, message, details } }）；
 *   ② 前端 chip 取值函数对夹具返回默认文案（纯函数用例在 runtimeShelf.test.mjs）。
 *
 * 全程临时目录，不碰作者真库与本机 agent-config。
 * 跑法：node --test test/agentFixtureGuard.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { validateResponse, API_ERROR_CODES } from '../src/api/contracts.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-fixture-guard-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1, libraries: [{ path: root, name: '夹具库', at: '2026-11-16T00:00:00.000Z' }]
  }), 'utf-8')
  return {
    base,
    root,
    preferencesPath,
    configPath: join(base, 'agent-config.json'),
    sessionsDir: join(base, 'sessions')
  }
}

test('PUT /api/agent/runtime：夹具套件（echo-kit）被拒，错误码登记在契约里', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({
    port: 0,
    preferencesPath: fixture.preferencesPath,
    agentConfigPath: fixture.configPath,
    agentSessionsDir: fixture.sessionsDir,
    env: { ...process.env, LOCALAPPDATA: fixture.base, DSH_CHAT_ENDPOINT: '' },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const put = async (body) => {
    const res = await fetch(`${origin}/api/agent/runtime`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    })
    return { status: res.status, payload: await res.json() }
  }
  try {
    const blocked = await put({ id: 'echo-kit' })
    assert.equal(blocked.status, 400)
    assert.equal(blocked.payload.ok, false)
    assert.equal(blocked.payload.error.code, API_ERROR_CODES.AGENT_RUNTIME_FIXTURE)
    assert.equal(blocked.payload.error.code, 'AGENT_RUNTIME_FIXTURE')
    assert.match(blocked.payload.error.message, /夹具套件/u)
    assert.equal(blocked.payload.error.details?.id, 'echo-kit')

    // 拒绝不落盘：active 仍是空（Pi 兜底）
    const shelf = await (await fetch(`${origin}/api/agent/runtimes`)).json()
    assert.equal(shelf.active, '')

    // 未知套件仍是原来的 INVALID_ENTRY（两种拒绝可区分）
    const unknown = await put({ id: '没有这个套件' })
    assert.equal(unknown.payload.error.code, 'INVALID_ENTRY')

    // 空 id＝回到 Pi 兜底，照常成功
    const fallback = await put({ id: '' })
    assert.equal(fallback.status, 200)
    assert.equal(fallback.payload.ok, true)
    assert.equal(validateResponse('agentRuntimePut', fallback.payload).ok, true)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
