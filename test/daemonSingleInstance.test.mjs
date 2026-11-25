/**
 * OS-127 进程治理用例（node:test）：单实例锁＋stamp＋generation＋健康端点。
 *
 * 背景事故 OS-93：多 daemon 竞听 8807，页面拿到混合包、卡片点不了。
 * 覆盖四件事：
 *   ① 锁路径与首启占位：daemonLockPath 跟着 LOCALAPPDATA 走（测试注入临时目录，不碰真机锁），
 *      acquireDaemonLock 首启写 {pid,port,generation,startedAt}，generation=1；
 *   ② 单实例闸：同 pid 再闸 → ok:false（CLI 层会打「已在运行」并 exit 0）；
 *      坏档/清过的锁（pid=0）/死 pid → 陈旧抢占，generation=旧值+1；
 *   ③ stamp 与清锁：监听后 boundPort 落档；clearDaemonLock 清 pid 占位、generation 留档
 *      （这是「锁文件被清 → 再起 generation 递增」能同时成立的原因：占位清掉，代际续上）；
 *   ④ CLI 子进程全链：第一个 daemon 起来（health 可探）→ 第二个 exit 0 且喊「已在运行」→
 *      杀掉第一个 → 锁成陈旧（Windows 下 child.kill 是硬杀，处理器不跑，锁留死 pid，
 *      这正是 generation 抢占要处理的形态）→ 再起 generation=2、pid 换人。
 *
 * 跑法：node --test test/daemonSingleInstance.test.mjs（或 node .zcode/run-gate.mjs 全量）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateResponse } from '../src/api/contracts.mjs'
import {
  acquireDaemonLock,
  clearDaemonLock,
  daemonLockPath,
  stampDaemonLock
} from '../src/host/daemon.mjs'

const HERE = join(fileURLToPath(import.meta.url), '..', '..')

/** 隔离的锁环境：子进程与单测都把 LOCALAPPDATA 指到临时目录，绝不碰开发者真机的锁。 */
function makeLockEnv() {
  const lockDir = mkdtempSync(join(tmpdir(), 'openstory-os127-'))
  const env = { ...process.env, LOCALAPPDATA: lockDir }
  const lockPath = join(lockDir, 'OpenStory', 'openstory', 'daemon.lock')
  const cleanup = () => rmSync(lockDir, { recursive: true, force: true })
  return { lockDir, env, lockPath, cleanup }
}

function readLock(lockPath) {
  return JSON.parse(readFileSync(lockPath, 'utf-8'))
}

function pidAlive(pid) {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

/** 拿一个确认已死的 pid（起一个立即退出的子进程）。 */
function deadPid() {
  const gone = spawnSync(process.execPath, ['-e', 'process.exit(0)'])
  assert.equal(gone.status, 0)
  assert.ok(!pidAlive(gone.pid), '测试前置：这个 pid 应该已经死了')
  return gone.pid
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms))

async function waitHealthy(port, pid, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const health = await (await fetch(`http://127.0.0.1:${port}/api/health`)).json()
      if (health?.pid === pid) return health
    } catch { /* daemon 还没起来，继续等 */ }
    await wait(200)
  }
  assert.fail(`daemon(${pid}) 在 ${timeoutMs}ms 内没能监听 :${port}`)
}

/* ---------- ① 锁路径 ---------- */

test('锁路径：跟 LOCALAPPDATA 走，缺了退 APPDATA，再缺就是无处落锁', () => {
  assert.equal(
    daemonLockPath({ LOCALAPPDATA: 'D:/临时' }),
    join('D:/临时', 'OpenStory', 'openstory', 'daemon.lock')
  )
  assert.equal(daemonLockPath({ APPDATA: 'E:/漫游' }), join('E:/漫游', 'OpenStory', 'openstory', 'daemon.lock'))
  assert.equal(daemonLockPath({}), '')
})

/* ---------- ② 单实例闸 ---------- */

test('闸：首启占位 generation=1；锁活着→拒 second；死 pid/清过的 pid=0→抢占 generation+1', () => {
  const { env, lockPath, cleanup } = makeLockEnv()
  try {
    // 首启：无锁 → generation 1，四件套落档
    const first = acquireDaemonLock({ env, port: 18807 })
    assert.equal(first.ok, true)
    assert.equal(first.preempted, false)
    assert.deepEqual(readLock(lockPath), {
      pid: process.pid,
      port: 18807,
      generation: 1,
      startedAt: readLock(lockPath).startedAt
    })
    assert.ok(!Number.isNaN(Date.parse(readLock(lockPath).startedAt)))

    // 本进程还活着，同 env 再闸 → ok:false，锁内容原样带回（CLI 据此打「已在运行」并 exit 0）
    const busy = acquireDaemonLock({ env, port: 18807 })
    assert.equal(busy.ok, false)
    assert.equal(busy.lock.pid, process.pid)
    assert.equal(busy.lock.generation, 1)
    assert.equal(readLock(lockPath).generation, 1, 'busy 分支不得改写锁')

    // 陈旧抢占：锁里的 pid 换成一个死人 → generation = 旧值+1
    writeFileSync(lockPath, JSON.stringify({ pid: deadPid(), port: 18807, generation: 7, startedAt: '2026-11-01T00:00:00.000Z' }), 'utf-8')
    const preempt = acquireDaemonLock({ env, port: 18807 })
    assert.equal(preempt.ok, true)
    assert.equal(preempt.preempted, true)
    assert.equal(preempt.lock.generation, 8)
    assert.equal(readLock(lockPath).pid, process.pid)
    assert.equal(readLock(lockPath).generation, 8)

    // 清过的锁（pid=0，见 clearDaemonLock）→ 同样走抢占继承代际
    clearDaemonLock(env)
    assert.equal(readLock(lockPath).pid, 0)
    const afterClear = acquireDaemonLock({ env, port: 18807 })
    assert.equal(afterClear.ok, true)
    assert.equal(afterClear.preempted, true)
    assert.equal(afterClear.lock.generation, 9)

    // 坏档 → 当无锁，generation 从 1 重新数（内容不可信就不继承）
    writeFileSync(lockPath, '{ not json', 'utf-8')
    const corrupt = acquireDaemonLock({ env, port: 18807 })
    assert.equal(corrupt.ok, true)
    assert.equal(corrupt.preempted, false)
    assert.equal(corrupt.lock.generation, 1)
  } finally {
    cleanup()
  }
})

/* ---------- ③ stamp 与清锁 ---------- */

test('stamp：监听成功后 boundPort 落档；清锁只清 pid 占位，generation 留档', () => {
  const { env, lockPath, cleanup } = makeLockEnv()
  try {
    const gate = acquireDaemonLock({ env, port: 0 })
    assert.equal(gate.ok, true)
    // --port=0 时锁里只有请求值 0；真实端口要靠 stamp 回写
    const stamped = stampDaemonLock({ env, port: 18999, lock: gate.lock })
    assert.equal(stamped, true)
    const lock = readLock(lockPath)
    assert.equal(lock.boundPort, 18999)
    assert.equal(lock.pid, process.pid)

    // 清锁：pid 占位清零（下一次闸按陈旧抢占继承代际），其余字段不动
    assert.equal(clearDaemonLock(env), true)
    const cleared = readLock(lockPath)
    assert.equal(cleared.pid, 0)
    assert.equal(cleared.generation, 1)
    assert.equal(cleared.boundPort, 18999)
    // 已清过再清 → false（无占位可清）
    assert.equal(clearDaemonLock(env), false)
  } finally {
    cleanup()
  }
})

/* ---------- ④ CLI 子进程全链（ask 步骤 4 的主流程） ---------- */

test('CLI 全链：双开友好退出 0＋「已在运行」；杀掉后锁陈旧；再起 generation 递增', async () => {
  const { env, lockPath, cleanup } = makeLockEnv()
  const port = 18000 + Math.floor(Math.random() * 2000)
  const children = []
  const killAll = () => {
    for (const child of children.splice(0)) {
      try { child.kill() } catch { /* 已经死了不算错 */ }
    }
  }
  try {
    // 第一个 daemon：随机高位端口，等 /api/health 可探
    const first = spawn(process.execPath, [join(HERE, 'src', 'host', 'daemon.mjs'), `--port=${port}`], { env })
    children.push(first)
    const health1 = await waitHealthy(port, first.pid)
    assert.equal(validateResponse('healthGet', health1).ok, true, 'health 响应符合契约')
    assert.equal(health1.generation, 1)
    assert.equal(health1.port, port)
    assert.ok(Number.isSafeInteger(health1.uptimeMs) && health1.uptimeMs >= 0)
    assert.ok(!Number.isNaN(Date.parse(health1.startedAt)))
    // 锁四件套 + stamp：pid 是第一个子进程、boundPort 是真实端口
    const lock1 = readLock(lockPath)
    assert.equal(lock1.pid, first.pid)
    assert.equal(lock1.generation, 1)
    assert.equal(lock1.boundPort, port)

    // 第二个 daemon（spawnSync）：同 pid 活着 → 友好退出，exit 0，喊「已在运行」
    const second = spawnSync(process.execPath, [join(HERE, 'src', 'host', 'daemon.mjs'), `--port=${port}`], { env, encoding: 'utf-8' })
    assert.equal(second.status, 0, `第二个实例应 exit 0，实际 stderr：${second.stderr}`)
    assert.ok(String(second.stdout).includes('已在运行'), `输出缺「已在运行」：${second.stdout}`)
    assert.ok(String(second.stdout).includes(`pid ${first.pid}`), `输出应带在跑实例的 pid：${second.stdout}`)
    assert.equal(readLock(lockPath).pid, first.pid, 'busy 分支不得改写锁')

    // 杀第一个：要的是「硬杀＝清锁处理器不跑」这一形态。
    // Windows 的 child.kill() 本就是硬杀（TerminateProcess）；POSIX 上 SIGTERM 会跑清理处理器，
    // 必须用 SIGKILL 才是同一个语义（2026-11-26 ubuntu CI 首跑就栽在这条假言上）。
    first.kill(process.platform === 'win32' ? undefined : 'SIGKILL')
    await new Promise((r) => first.once('exit', r))
    for (let i = 0; i < 50 && pidAlive(first.pid); i += 1) await wait(100)
    assert.ok(!pidAlive(first.pid), '第一个 daemon 应已退出')
    const stale = readLock(lockPath)
    assert.equal(stale.pid, first.pid)
    assert.equal(stale.generation, 1, '硬杀后锁还在（陈旧而非丢失），generation 才有得继承')

    // 等端口真正释放，再起第三个：读到死 pid → 抢占，generation = 1+1
    for (let i = 0; i < 50; i += 1) {
      try { await fetch(`http://127.0.0.1:${port}/api/health`); await wait(100) } catch { break }
    }
    const third = spawn(process.execPath, [join(HERE, 'src', 'host', 'daemon.mjs'), `--port=${port}`], { env })
    children.push(third)
    const health3 = await waitHealthy(port, third.pid)
    assert.equal(health3.generation, 2, '新代际 = 旧锁代际 1 + 1')
    const lock3 = readLock(lockPath)
    assert.equal(lock3.pid, third.pid)
    assert.equal(lock3.generation, 2)
    assert.equal(lock3.boundPort, port)
    assert.equal(validateResponse('healthGet', health3).ok, true)
  } finally {
    killAll()
    cleanup()
  }
})

test('健康端点（内嵌 startDaemon）：免 root 授权，未授权 root 也能探活', async () => {
  const { startDaemon } = await import('../src/host/daemon.mjs')
  const base = mkdtempSync(join(tmpdir(), 'openstory-os127-health-'))
  const preferencesPath = join(base, 'libraries.json')
  writeFileSync(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [] }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, logger: { log() {} } })
  try {
    const payload = await (await fetch(`http://127.0.0.1:${daemon.port}/api/health`)).json()
    assert.equal(validateResponse('healthGet', payload).ok, true)
    assert.equal(payload.pid, process.pid)
    assert.equal(payload.port, daemon.port)
    assert.ok(Number.isSafeInteger(payload.generation))
    assert.ok(!Number.isNaN(Date.parse(payload.startedAt)))
    assert.ok(Number.isSafeInteger(payload.uptimeMs) && payload.uptimeMs >= 0)
    // 404 面：/api/health 只有 GET；错误路径不串门
    const wrong = await fetch(`http://127.0.0.1:${daemon.port}/api/health`, { method: 'POST' })
    assert.equal(wrong.status, 404)
  } finally {
    await daemon.close()
    rmSync(base, { recursive: true, force: true })
  }
})

/* 每个用例的 finally 负责 kill 子进程与清临时锁目录；子进程引用不出用例作用域。 */
