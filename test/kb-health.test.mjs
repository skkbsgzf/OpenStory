/**
 * KB 服务健康用例（KB-ARCH P1）——探活降级/状态聚合降级/daemon 端点 e2e。
 * 跑法：node --test test/kb-health.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { collectKbStatus, probeServices } from '../kbHealth.mjs'
import { startDaemon } from '../daemon.mjs'
import { validateResponse } from '../contracts.mjs'

const DEAD_URL = 'http://127.0.0.1:9' // 拒连端口（discard 协议端口，本机不监听）

test('探活：双服务不可达时降级为 up:false，不抛', async () => {
  const snap = await probeServices({ weknoraUrl: DEAD_URL, embedUrl: DEAD_URL, timeoutMs: 800 })
  assert.equal(snap.weknora.up, false)
  assert.equal(snap.embedding.up, false)
  assert.ok(snap.lastCheck)
})

test('聚合：kb-config 缺失 → configured=false，六库空表，形状恒定', async () => {
  const status = await collectKbStatus({
    configPath: 'Z:/nope/kb-config.json',
    weknoraUrl: DEAD_URL,
    embedUrl: DEAD_URL,
    timeoutMs: 800
  })
  assert.equal(status.ok, true)
  assert.equal(status.configured, false)
  assert.equal(status.backend, '')
  assert.deepEqual(status.collections, [])
  assert.equal(status.services.weknora.up, false)
  assert.equal(status.configError.length > 0, true)
  assert.equal(validateResponse('kbStatusGet', status).ok, true)
})

test('聚合：配置在但 WeKnora 拒连 → 六库降级 docs=null，不抛', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-kbhealth-'))
  try {
    const cfgPath = join(base, 'kb-config.json')
    await writeFile(cfgPath, JSON.stringify({
      backend: 'weknora',
      baseUrl: DEAD_URL,
      apiKey: 'sk-test',
      collections: { 技法库: '11111111-1111-4111-8111-111111111111', 文风库: '22222222-2222-4222-8222-222222222222' }
    }), 'utf-8')
    const status = await collectKbStatus({
      configPath: cfgPath,
      weknoraUrl: DEAD_URL,
      embedUrl: DEAD_URL,
      timeoutMs: 800,
      // 注入固定服务快照，避免真实探活的不确定性
      services: {
        weknora: { up: false, version: '', edition: '' },
        embedding: { up: false, model: '', dim: null, autoStarted: false },
        lastCheck: '2026-11-17T00:00:00.000Z',
        autoStarted: false
      }
    })
    assert.equal(status.ok, true)
    assert.equal(status.configured, true)
    assert.equal(status.backend, 'weknora')
    assert.equal(status.collections.length, 2)
    assert.deepEqual(status.collections[0], { alias: '技法库', id: '11111111-1111-4111-8111-111111111111', docs: null, parsed: null })
    assert.equal(validateResponse('kbStatusGet', status).ok, true)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon 端到端：/api/kb/status 无 KB 环境降级 200，close 不悬挂', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-kbhealth-d-'))
  try {
    const root = join(base, '夹具库')
    await mkdir(join(root, '正文'), { recursive: true })
    const preferencesPath = join(base, 'prefs.json')
    await writeFile(preferencesPath, JSON.stringify({ recentProjects: [{ path: root, name: '夹具库' }] }), 'utf-8')
    const daemon = await startDaemon({
      port: 0,
      preferencesPath,
      env: { ...process.env, LOCALAPPDATA: base, PINAX_KB_WATCH: '0' },
      logger: { log() {} }
    })
    const origin = `http://127.0.0.1:${daemon.port}`
    try {
      const res = await fetch(`${origin}/api/kb/status`)
      assert.equal(res.status, 200)
      const status = await res.json()
      assert.equal(status.ok, true)
      assert.equal(status.configured, false) // 测试环境无 kb-config
      assert.equal(validateResponse('kbStatusGet', status).ok, true)
    } finally {
      await daemon.close()
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
