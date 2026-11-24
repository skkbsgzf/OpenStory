/**
 * 启动入口用例（OS-140 建立 → OS-159 归位重写，node:test）——实现文件即入口的契约。
 *
 * OS-159 删掉仓根两个垫片（daemon.mjs / mcp.mjs）：实现文件 src/host/{daemon,mcp}.mjs
 * 本就带直跑判定（pathToFileURL(resolve(argv[1])) === import.meta.url），直接
 * `node src/host/daemon.mjs` / `node src/host/mcp.mjs` 即可启动，中转垫片成了多余的散落 .mjs。
 * 这里钉死三条（强度不减，只换落点）：
 *   ① 根目录零 .mjs（布局宪法 OS-159），实现文件在原位且导出全部符号；
 *   ② 纯 import 实现文件不起服务——子进程 import 后 LOCALAPPDATA 临时注入，
 *      等 1.2s 断言 daemon.lock 未出现、无启动输出、无 MCP 就绪 banner；
 *   ③ 直跑链路：`node src/host/daemon.mjs --port=<随机高位>` 能起，/api/health 200 后退出。
 *
 * 跑法：node --test test/entryShims.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const HERE = join(fileURLToPath(import.meta.url), '..', '..')
// Windows 上 ESM 只认 file:// URL——绝对路径直给 import() 会炸 ERR_UNSUPPORTED_ESM_URL_SCHEME。
const DAEMON_URL = pathToFileURL(join(HERE, 'src', 'host', 'daemon.mjs')).href
const MCP_URL = pathToFileURL(join(HERE, 'src', 'host', 'mcp.mjs')).href
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 隔离的锁环境：子进程把 LOCALAPPDATA 指到临时目录，绝不碰开发者真机的锁。 */
function makeLockEnv() {
  const lockDir = mkdtempSync(join(tmpdir(), 'openstory-os159-'))
  const env = { ...process.env, LOCALAPPDATA: lockDir }
  const lockPath = join(lockDir, 'PinaxNext', 'openstory', 'daemon.lock')
  const cleanup = () => rmSync(lockDir, { recursive: true, force: true })
  return { env, lockPath, cleanup }
}

test('布局宪法：根目录零 .mjs，daemon/mcp 实现都在 src/host/', () => {
  const rootMjs = readdirSync(HERE).filter((f) => f.endsWith('.mjs'))
  assert.deepEqual(rootMjs, [], `根目录不该有散落 .mjs，实际：${rootMjs.join(', ')}`)
  assert.equal(existsSync(join(HERE, 'src', 'host', 'daemon.mjs')), true)
  assert.equal(existsSync(join(HERE, 'src', 'host', 'mcp.mjs')), true)
})

test('实现文件导出符号：从 src/host/daemon.mjs 拿 startDaemon/DEFAULT_PORT/main', async () => {
  const impl = await import('../src/host/daemon.mjs')
  assert.equal(typeof impl.startDaemon, 'function')
  assert.equal(typeof impl.main, 'function')
  assert.equal(typeof impl.DEFAULT_PORT, 'number')
  assert.equal(typeof impl.acquireDaemonLock, 'function')
  const mcp = await import('../src/host/mcp.mjs')
  assert.equal(typeof mcp.main, 'function')
})

test('import 实现文件不起服务：daemon.lock 不出现、无启动输出（daemon＋mcp 双入口）', async () => {
  const { env, lockPath, cleanup } = makeLockEnv()
  try {
    const child = spawn(process.execPath, [
      '-e',
      `
      const wait = (ms) => new Promise((r) => setTimeout(r, ms))
      await import(${JSON.stringify(DAEMON_URL)})
      await import(${JSON.stringify(MCP_URL)})
      await wait(1200)
      console.log('IMPORT-SETTLED')
      process.exit(0)
      `
    ], { env, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (c) => { stdout += c })
    child.stderr.on('data', (c) => { stderr += c })
    const code = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('import 实现文件子进程超时')), 20_000)
      child.on('exit', (c) => { clearTimeout(timer); resolve(c) })
    })
    assert.equal(code, 0, `import 实现文件应干净退出，stderr：${stderr.slice(0, 500)}`)
    assert.ok(stdout.includes('IMPORT-SETTLED'), '子进程应跑完全程')
    assert.equal(existsSync(lockPath), false, '纯 import 不得过单实例闸写锁（＝不得启动服务）')
    assert.equal(stdout.includes('OpenStory daemon 启动'), false, '纯 import 不得出现 daemon 启动输出')
    assert.equal(stderr.includes('已就绪'), false, '纯 import 不得出现 MCP 就绪 banner（banner 只在 main() 里）')
  } finally {
    cleanup()
  }
})

test('直跑链路：node src/host/daemon.mjs --port=<随机高位> 能起，/api/health 200 后退出', async () => {
  const { env, cleanup } = makeLockEnv()
  const port = 20000 + Math.floor(Math.random() * 5000)
  const child = spawn(process.execPath, [join(HERE, 'src', 'host', 'daemon.mjs'), `--port=${port}`], { env, stdio: ['pipe', 'pipe', 'pipe'] })
  try {
    const deadline = Date.now() + 20_000
    let health = null
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/api/health`)
        if (res.status === 200) { health = await res.json(); break }
      } catch { /* 还没起来，继续等 */ }
      await wait(200)
    }
    assert.ok(health, 'daemon 实现文件直跑应在 20s 内探到 /api/health 200')
    assert.equal(health.port, port)
    assert.equal(typeof health.pid, 'number')
  } finally {
    try { child.kill() } catch { /* 已经死了不算错 */ }
    await wait(300)
    cleanup()
  }
})
