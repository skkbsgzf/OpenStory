import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createHash } from 'node:crypto'
import { KnowledgeSidecar, SidecarManager, StderrRing, MAX_FRAME_BYTES, MAX_STDERR_BYTES, HYPERGRAPH_COMMIT, KNOWLEDGE_SIDECAR_PROTOCOL } from '../src/modules/knowledge-runtime/sidecar.mjs'
import { createIndexStaging, publishKnowledgeIndex, readKnowledgeIndex, cleanupKnowledgeStaging } from '../src/modules/knowledge-runtime/staging.mjs'
import { knowledgeRuntimeCapability, activate } from '../src/modules/knowledge-runtime/index.mjs'
import { getKnowledgeSidecar, stopAllKnowledgeSidecars } from '../src/modules/knowledge-runtime/sidecar.mjs'

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))
const sha = (value) => createHash('sha256').update(value).digest('hex')
const response = (requestId, result = {}, ok = true, error = null) => ({ protocol: KNOWLEDGE_SIDECAR_PROTOCOL, requestId, ok, ...(ok ? { result } : { error: error || { code: 'FAKE_ERROR', message: 'fake' } }) })

class FakeChild extends EventEmitter {
  constructor(behavior = {}) {
    super()
    this.stdin = new EventEmitter()
    this.stdin.write = (chunk, callback) => {
      const frame = JSON.parse(chunk.toString())
      this.frames ||= []
      this.frames.push(frame)
      callback?.()
      this.onFrame?.(frame)
    }
    this.stdout = new EventEmitter()
    this.stderr = new EventEmitter()
    this.pid = behavior.pid || 43210
    this.exitCode = null
    this.signalCode = null
    this.killed = []
  }
  kill(signal) {
    this.killed.push(signal)
    return true
  }
  reply(frame, result = {}, ok = true, error = null) {
    this.stdout.emit('data', Buffer.from(`${JSON.stringify(response(frame.requestId, result, ok, error))}\n`))
  }
}

function fakeSpawn(behavior = {}) {
  const children = []
  const calls = []
  const spawn = (command, args, options) => {
    calls.push({ command, args, options })
    const child = new FakeChild(behavior)
    child.command = command
    child.onFrame = behavior.onFrame || ((frame) => {
    if (frame.method === 'health') child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }); else child.reply(frame, { method: frame.method, payload: frame.payload })
    })
    children.push(child)
    queueMicrotask(() => child.emit('spawn'))
    return child
  }
  return { spawn, calls, children }
}

async function temp() {
  return mkdtemp(join(tmpdir(), 'openstory-hypergraph-'))
}

async function sourceFixture(root) {
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'docs', 'one.md'), '# One\n\nAlpha source.\n')
  await writeFile(join(root, 'docs', 'two.markdown'), '# Two\n\nBeta source.\n')
}

function documents() {
  return [
    { documentRef: 'docs/one.md', title: 'One', tags: ['alpha'], content: '# One\n\nAlpha source.\n', contentHash: sha('# One\n\nAlpha source.\n') },
    { documentRef: 'docs/two.markdown', title: 'Two', tags: ['beta'], content: '# Two\n\nBeta source.\n', contentHash: sha('# Two\n\nBeta source.\n') }
  ]
}

const indexOptions = (root, source, operationId) => ({
  cacheRoot: root,
  sourceRoot: source,
  libraryId: 'fixture',
  operationId,
  documents: documents(),
  contentRevision: 'revision-one',
  manifestHash: sha('manifest'),
  customizationHash: sha('customization'),
  runtimeCommit: HYPERGRAPH_COMMIT,
  runtimeLockSha256: sha('lock'),
  engineVersion: `HyperGraphRAG@${HYPERGRAPH_COMMIT}`,
  profileVersion: '1'
})

async function markReady(staging) {
  await writeFile(join(staging.outputDir, 'index.json'), JSON.stringify({
    schema: 'hypergraphrag-index@1', schemaVersion: 1, libraryId: staging.libraryId,
    indexHash: staging.indexHash, contentRevision: staging.contentRevision
  }))
  await writeFile(join(staging.outputDir, 'hypergraphrag.ready.json'), JSON.stringify({
    schema: 'openstory.hypergraphrag-ready@1', schemaVersion: 1, libraryId: staging.libraryId,
    operationId: staging.operationId, indexHash: staging.indexHash
  }))
}

test('kernel manifest/activate exposes knowledge.retrieval@1 only', async () => {
  const manifest = JSON.parse(await readFile(new URL('../src/modules/knowledge-runtime/module.manifest.json', import.meta.url), 'utf8'))
  assert.equal(manifest.spec, 'openstory-module@2')
  assert.equal(manifest.class, 'kernel')
  assert.deepEqual(manifest.capabilities, [{ id: 'knowledge.retrieval', version: 1 }])
  assert.deepEqual(manifest.endpoints, [])
  assert.deepEqual(manifest.pages || [], [])
  const activated = await activate({ resolve() { throw new Error('no base dependency expected') } })
  assert.deepEqual(Object.keys(activated.capabilities), ['knowledge.retrieval'])
  for (const method of ['insert', 'query', 'read', 'health', 'indexStatus', 'stop']) assert.equal(typeof knowledgeRuntimeCapability['knowledge.retrieval'][method], 'function')
  const fake = fakeSpawn()
  const runtime = { python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn }
  const resolved = getKnowledgeSidecar(runtime)
  assert.equal(resolved.ok, true)
  const capability = knowledgeRuntimeCapability['knowledge.retrieval']
  assert.equal((await capability.health({ runtime })).ok, true)
  assert.equal((await capability.query({ query: 'one' }, { runtime, deadlineMs: 1000 })).ok, true)
  assert.equal((await capability.read({ ref: 'one' }, { runtime, deadlineMs: 1000 })).ok, true)
  assert.equal((await capability.indexStatus({}, { runtime, deadlineMs: 1000 })).ok, true)
  assert.equal((await capability.insert({}, { runtime, deadlineMs: 1000 })).ok, true)
  assert.equal(fake.children.length, 1)
  await capability.stop()
})

test('spawn is fixed python -I with private stdio and health version check', async () => {
  const fake = fakeSpawn()
  const sidecar = new KnowledgeSidecar({ python: 'C:\\venv\\python.exe', worker: 'C:\\repo\\worker.py',   spawnImpl: fake.spawn })
  const result = await sidecar.start()
  assert.equal(result.ok, true)
  assert.equal(fake.calls[0].command, 'C:\\venv\\python.exe')
  assert.deepEqual(fake.calls[0].args, ['-I', 'C:\\repo\\worker.py'])
  assert.equal(fake.calls[0].options.shell, false)
  assert.deepEqual(fake.calls[0].options.stdio, ['pipe', 'pipe', 'pipe'])
  assert.equal(sidecar.running(), true)
  await sidecar.stop()
})

test('missing runtime is typed and never falls back to python on PATH', async () => {
  const sidecar = new KnowledgeSidecar({ worker: 'C:\\repo\\worker.py', spawnImpl() { throw new Error('must not spawn') } })
  const result = await sidecar.start()
  assert.equal(result.ok, false)
  assert.equal(result.code, 'RUNTIME_MISSING')
})

test('health rejects wrong commit and protocol', async () => {
  for (const [commit, protocol, code] of [
    ['other', KNOWLEDGE_SIDECAR_PROTOCOL, 'RUNTIME_VERSION_MISMATCH'],
    [HYPERGRAPH_COMMIT, 'other', 'PROTOCOL_MISMATCH']
  ]) {
    let child
    const fake = fakeSpawn({ onFrame(frame) { child = fake.children[0]; if (frame.method === 'health') child.reply(frame, { protocol, engine: 'hypergraphrag', commit, ready: true }) } })
    const sidecar = new KnowledgeSidecar({ python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn })
    const result = await sidecar.start()
    assert.equal(result.code, code)
    await sidecar.stop()
  }
})

test('stderr ring is bounded to 64 KiB and retains newest bytes', () => {
  const ring = new StderrRing()
  ring.append('x'.repeat(MAX_STDERR_BYTES - 2))
  ring.append('abcdef')
  assert.equal(Buffer.byteLength(ring.toString()), MAX_STDERR_BYTES)
  assert.equal(ring.toString().slice(-6), 'abcdef')
})

test('request ids are matched exactly and wrong-id frames do not settle request', async () => {
  const fake = fakeSpawn({ onFrame(frame) {
    const child = fake.children.at(-1)
    if (frame.method === 'health') { child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }); return }
    child.stdout.emit('data', Buffer.from(`${JSON.stringify(response('wrong-id', { bad: true }))}\n`))
    setTimeout(() => child.reply(frame, { value: 42 }), 20)
  } })
  const sidecar = new KnowledgeSidecar({ python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn })
  assert.equal((await sidecar.start()).ok, true)
  const result = await sidecar.request('query', { query: 'one' }, { deadlineMs: 1000 })
  assert.equal(result.ok, true)
  assert.deepEqual(result.result, { value: 42 })
  await sidecar.stop()
})

test('invalid stdout JSON and oversized frames fail closed', async () => {
  for (const data of ['not-json\n', `${'x'.repeat(MAX_FRAME_BYTES + 1)}\n`]) {
    const fake = fakeSpawn({ onFrame(frame) {
      if (frame.method === 'health') { fake.children.at(-1).reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }); return }
      if (frame.method !== 'health') fake.children.at(-1).stdout.emit('data', Buffer.from(data))
    } })
    const sidecar = new KnowledgeSidecar({ python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn })
    assert.equal((await sidecar.start()).ok, true)
    const result = await sidecar.request('query', {})
    assert.equal(result.ok, false)
    assert.equal(result.error.code, 'PROTOCOL_MISMATCH')
    await sidecar.stop()
  }
})

test('query deadline maps QUERY_TIMEOUT without poisoning later serial requests', async () => {
  const fake = fakeSpawn({ onFrame(frame) {
    const child = fake.children.at(-1)
    if (frame.method === 'health') { child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }); return }
    if (frame.payload.wait) return
    child.reply(frame, { hits: [] })
  } })
  const manager = new SidecarManager({ python: 'python', worker: 'worker.py', spawnImpl: fake.spawn, processWait: async () => ({ code: 0, signal: null }) })
  assert.equal((await manager.health()).ok, true)
  const timed = await manager.query({ wait: true }, { deadlineMs: 15 })
  assert.equal(timed.code, 'QUERY_TIMEOUT')
  const later = await manager.query({ wait: false }, { deadlineMs: 500 })
  assert.equal(later.ok, true)
  await manager.stop()
})

test('insert deadline maps INDEX_BUILD_TIMEOUT and kills worker', async () => {
  const fake = fakeSpawn({ onFrame(frame) { const child = fake.children.at(-1); if (frame.method === 'health') child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }) } })
  const manager = new SidecarManager({ python: 'python', worker: 'worker.py', spawnImpl: fake.spawn, processWait: async () => ({ code: 0, signal: null }) })
  assert.equal((await manager.health()).ok, true)
  const timed = await manager.insert({}, { deadlineMs: 10 })
  assert.equal(timed.ok, false)
  assert.equal(timed.code, 'INDEX_BUILD_TIMEOUT')
  await sleep(20)
  assert.ok(fake.children[0].killed.length > 0)
  await manager.stop()
})

test('cancel maps REQUEST_CANCELLED and removes abort listener work', async () => {
  const fake = fakeSpawn({ onFrame(frame) { const child = fake.children.at(-1); if (frame.method === 'health') child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }) } })
  const manager = new SidecarManager({ python: 'python', worker: 'worker.py', spawnImpl: fake.spawn, processWait: async () => ({ code: 0, signal: null }) })
  await manager.health()
  const controller = new AbortController()
  const pending = manager.query({}, { deadlineMs: 5000, signal: controller.signal })
  await sleep(5)
  controller.abort()
  const result = await pending
  assert.equal(result.code, 'REQUEST_CANCELLED')
  await manager.stop()
})

test('pre-aborted request never writes to sidecar', async () => {
  const fake = fakeSpawn()
  const sidecar = new KnowledgeSidecar({ python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn })
  await sidecar.start()
  const controller = new AbortController()
  controller.abort()
  const result = await sidecar.request('query', {}, { signal: controller.signal })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'REQUEST_CANCELLED')
  assert.equal(fake.children[0].frames.length, 1)
  await sidecar.stop()
})

test('crash immediately rejects active request with RUNTIME_CRASHED', async () => {
  const fake = fakeSpawn({ onFrame(frame) { const child = fake.children.at(-1); if (frame.method === 'health') { child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }); return }; setTimeout(() => child.emit('exit', 1, null), 5) } })
  const sidecar = new KnowledgeSidecar({ python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn })
  await sidecar.start()
  const started = Date.now()
  const result = await sidecar.request('query', {}, { deadlineMs: 5000 })
  assert.equal(result.code, 'RUNTIME_CRASHED')
  assert.ok(Date.now() - started < 1000)
})

test('manager serializes one library and only uses one active worker', async () => {
  let active = 0
  let max = 0
  const fake = fakeSpawn({ onFrame(frame) {
    const child = fake.children.at(-1)
    if (frame.method === 'health') { child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true }); return }
    active += 1
    max = Math.max(max, active)
    setTimeout(() => { active -= 1; child.reply(frame, { order: frame.payload.order }) }, 10)
  } })
  const manager = new SidecarManager({ python: 'python', worker: 'worker.py', spawnImpl: fake.spawn, processWait: async () => ({ code: 0, signal: null }) })
  await manager.health()
  const results = await Promise.all([1, 2, 3].map((order) => manager.query({ order }, { deadlineMs: 1000 })))
  assert.deepEqual(results.map((item) => item.result.order), [1, 2, 3])
  assert.equal(max, 1)
  assert.equal(fake.children.length, 1)
  await manager.stop()
})

test('direct concurrent request is rejected rather than interleaved', async () => {
  const fake = fakeSpawn({ onFrame(frame) {
    const child = fake.children.at(-1)
    if (frame.method === 'health') child.reply(frame, { protocol: KNOWLEDGE_SIDECAR_PROTOCOL, engine: 'hypergraphrag', commit: HYPERGRAPH_COMMIT, ready: true })
  } })
  const sidecar = new KnowledgeSidecar({ python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn })
  await sidecar.start()
  const first = sidecar.request('query', {})
  const second = await sidecar.request('read', {})
  assert.equal(second.code, 'INVALID_REQUEST')
  assert.equal(fake.children[0].frames.length, 2)
  await sidecar.stop()
})

test('duplicate stop is idempotent', async () => {
  const fake = fakeSpawn()
  const manager = new SidecarManager({ python: 'python', worker: 'worker.py', spawnImpl: fake.spawn, processWait: async () => ({ code: 0, signal: null }) })
  await manager.health()
  const first = await manager.stop()
  const second = await manager.stop()
  assert.equal(first.ok, true)
  assert.equal(second.ok, true)
  assert.equal(second.alreadyStopped, true)
  assert.equal(fake.calls.filter((call) => call.args?.[0] === '-I').length, 1)
})

test('Windows cleanup invokes taskkill /T /F, POSIX uses detached process group', async () => {
  const fake = fakeSpawn()
  const sidecar = new KnowledgeSidecar({ python: 'python', worker: 'worker.py',   spawnImpl: fake.spawn, processWait: async () => ({ code: 0, signal: null }) })
  await sidecar.start()
  await sidecar.stop()
  if (process.platform === 'win32') {
    const killer = fake.calls.find((call) => call.command === 'taskkill')
    assert.ok(killer)
    assert.deepEqual(killer.args, ['/PID', String(fake.children[0].pid), '/T', '/F'])
  } else {
    assert.equal(fake.calls[0].options.detached, true)
    assert.ok(fake.children[0].killed.length > 0)
  }
})

test('operationId staging snapshots source read-only and keeps source hash unchanged', async () => {
  const root = await temp()
  try {
    const source = join(root, 'source')
    await sourceFixture(source)
    const before = sha(await readFile(join(source, 'docs', 'one.md')))
    const staging = await createIndexStaging(indexOptions(join(root, 'cache'), source, 'op-1'))
    assert.equal(staging.ok, true)
    for (const name of ['inputDir', 'outputDir', 'logsDir']) assert.ok(staging[name].endsWith(join('op-1', name.replace('Dir', '').toLowerCase())))
    assert.equal(await readFile(join(staging.inputDir, 'docs', 'one.md'), 'utf8'), await readFile(join(source, 'docs', 'one.md'), 'utf8'))
    assert.equal(sha(await readFile(join(source, 'docs', 'one.md'))), before)
    assert.match(staging.indexHash, /^[a-f0-9]{64}$/)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('successful build publishes immutable indexHash and atomically switches current.json', async () => {
  const root = await temp()
  try {
    const source = join(root, 'source')
    await sourceFixture(source)
    const first = await createIndexStaging(indexOptions(join(root, 'cache'), source, 'op-1'))
    await markReady(first)
    const published = await publishKnowledgeIndex({ ...indexOptions(join(root, 'cache'), source, 'op-1'), indexHash: first.indexHash })
    assert.equal(published.ok, true)
    assert.equal(published.published, true)
    assert.equal(published.indexPath, `indexes/${first.indexHash}`)
    const current = JSON.parse(await readFile(first.currentPath, 'utf8'))
    assert.equal(current.indexHash, first.indexHash)
    const ready = await readKnowledgeIndex({ cacheRoot: join(root, 'cache'), libraryId: 'fixture', contentRevision: 'revision-one' })
    assert.equal(ready.ok, true)
    assert.equal(ready.indexHash, first.indexHash)
    const duplicate = await publishKnowledgeIndex({ ...indexOptions(join(root, 'cache'), source, 'op-1'), indexHash: first.indexHash })
    assert.equal(duplicate.published, false)
    assert.equal(duplicate.alreadyPublished, true)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('failed build never publishes current pointer or index directory', async () => {
  const root = await temp()
  try {
    const source = join(root, 'source')
    await sourceFixture(source)
    const options = indexOptions(join(root, 'cache'), source, 'op-failed')
    const staging = await createIndexStaging(options)
    const result = await publishKnowledgeIndex(options)
    assert.equal(result.ok, false)
    assert.equal(result.code, 'INDEX_NOT_READY')
    assert.equal((await readdir(join(root, 'cache', 'fixture', 'indexes')).catch(() => [])).length, 0)
    await assert.rejects(readFile(staging.currentPath), { code: 'ENOENT' })
    assert.equal((await readdir(staging.outputDir)).length, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('published index is stale after source revision change and pointer path is validated', async () => {
  const root = await temp()
  try {
    const source = join(root, 'source')
    await sourceFixture(source)
    const options = indexOptions(join(root, 'cache'), source, 'op-stale')
    const staging = await createIndexStaging(options)
    await markReady(staging)
    assert.equal((await publishKnowledgeIndex(options)).ok, true)
    const stale = await readKnowledgeIndex({ cacheRoot: join(root, 'cache'), libraryId: 'fixture', contentRevision: 'revision-two' })
    assert.equal(stale.code, 'STALE_INDEX')
    const pointerPath = join(root, 'cache', 'fixture', 'current.json')
    const pointer = JSON.parse(await readFile(pointerPath, 'utf8'))
    pointer.indexPath = '../../escape'
    await writeFile(pointerPath, JSON.stringify(pointer))
    const invalid = await readKnowledgeIndex({ cacheRoot: join(root, 'cache'), libraryId: 'fixture' })
    assert.equal(invalid.code, 'INDEX_NOT_READY')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('cleanup removes only the selected operation staging', async () => {
  const root = await temp()
  try {
    const source = join(root, 'source')
    await sourceFixture(source)
    const one = await createIndexStaging(indexOptions(join(root, 'cache'), source, 'op-1'))
    const two = await createIndexStaging(indexOptions(join(root, 'cache'), source, 'op-2'))
    await cleanupKnowledgeStaging({ cacheRoot: join(root, 'cache'), libraryId: 'fixture', operationId: 'op-1' })
    await assert.rejects(readFile(one.inputDir), { code: 'ENOENT' })
    assert.equal((await readFile(join(two.inputDir, 'snapshot.json'), 'utf8')).includes('op-2'), true)
  } finally { await rm(root, { recursive: true, force: true }) }
})
