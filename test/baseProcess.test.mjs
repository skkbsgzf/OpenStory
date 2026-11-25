/**
 * OS-188 收口：base.process 完整服务映射。
 *
 * 底座进程服务（health/代际/锁探测/任务中心/Agent 事件/SSE）经能力句柄取用；
 * 锁只读探测，不抢占不改写；任务与事件仍是进程内、不落盘。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { baseCapabilities } from '../src/host/baseCapabilities.mjs'
import { PROCESS_RUNTIME } from '../src/host/processServices.mjs'
import { CAPABILITY_SNAPSHOT } from '../src/protocol/modules.mjs'
import { createCapabilityResolver } from '../src/protocol/capabilityResolver.mjs'

const process = baseCapabilities['base.process']

test('base.process 服务面：health／代际／锁／jobs／events／sse 六组齐全', () => {
  assert.deepEqual(Object.keys(process).sort(), ['events', 'generation', 'health', 'jobs', 'lock', 'sse', 'startedAt'])
  const health = process.health()
  assert.equal(health.ok, true)
  assert.equal(health.pid, globalThis.process.pid)
  assert.equal(typeof health.uptimeMs, 'number')
  assert.equal(health.generation, PROCESS_RUNTIME.generation)
  assert.equal(health.startedAt, PROCESS_RUNTIME.startedAt)
  assert.equal(process.generation(), PROCESS_RUNTIME.generation)
  assert.equal(process.startedAt(), PROCESS_RUNTIME.startedAt)
  assert.ok(Object.isFrozen(health))
})

test('base.process.lock：只读探测临时进程院子里的锁档，坏档当无锁', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-base-process-'))
  const env = { LOCALAPPDATA: base }
  const lockDir = join(base, 'OpenStory', 'openstory')
  try {
    const absent = await process.lock(env)
    assert.equal(absent.lock, null)
    assert.ok(absent.path.endsWith('daemon.lock'))

    await mkdir(lockDir, { recursive: true })
    await writeFile(join(lockDir, 'daemon.lock'), JSON.stringify({ pid: 4242, port: 8807, generation: 3, startedAt: '2026-11-25T00:00:00.000Z' }))
    const locked = await process.lock(env)
    assert.equal(locked.lock.pid, 4242)
    assert.equal(locked.lock.generation, 3)

    await writeFile(join(lockDir, 'daemon.lock'), '{坏档')
    assert.equal((await process.lock(env)).lock, null)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('base.process.jobs：登记、查询、取消同一条进程内任务', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const jobs = process.jobs()
  const job = jobs.submitJob({ kind: 'test', label: '夹具任务', root: '/夹具库', run: async (handle) => { await gate; handle.setResult?.({ ok: true }) } })
  assert.equal(job.state === 'queued' || job.state === 'running', true)
  assert.equal(jobs.getJob(job.id).label, '夹具任务')
  assert.ok(jobs.listJobs({ root: '/夹具库' }).some((item) => item.id === job.id))
  release()
  await new Promise((resolve) => setTimeout(resolve, 10))
  jobs.clearSettled({ root: '/夹具库' })
  assert.equal(jobs.getJob(job.id), null)
})

test('base.process.events／sse：Agent 事件词表与 SSE 帧工具可用', () => {
  const events = process.events()
  assert.ok(events.AGENT_EVENT_TYPES.includes('message_chunk'))
  assert.equal(typeof events.projectLegacyFrame, 'function')
  const sse = process.sse()
  assert.equal(typeof sse.open, 'function')
  const chunks = []
  sse.frame({ write: (chunk) => chunks.push(chunk) }, { type: 'delta', text: '好' })
  assert.match(chunks.join(''), /^data: \{.*"text":"好".*\}\n\n$/u)
})

test('能力句柄：base.process 经薄代理解析，方法可调用', () => {
  const resolver = createCapabilityResolver({ snapshot: CAPABILITY_SNAPSHOT, implementations: { base: baseCapabilities } })
  const resolved = resolver.resolve('base.process', { min: 1 })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.capability.provider, 'base')
  assert.equal(typeof resolved.capability.health, 'function')
  assert.equal(typeof resolved.capability.jobs().submitJob, 'function')
  assert.equal(resolved.capability.health().ok, true)
})