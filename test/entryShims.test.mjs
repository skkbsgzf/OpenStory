/**
 * 入口垫片用例（OS-140 布局归一，node:test）——仓根 daemon.mjs / mcp.mjs 两个垫片的契约。
 *
 * 布局宪法：41 个 .mjs 收进 src/ 六目录后，仓根只留两个入口垫片。垫片有两个坑，这里钉死：
 *   ① 垫片必须再出口实现文件的全部具名符号——约 24 个测试/工具按 '../daemon.mjs' 引
 *      startDaemon 等符号，`export * from` 断了它们就运行期才炸（这里以 startDaemon 抽样）；
 *   ② 垫片不许在 import 时启动服务——纯 import（测试/工具面）不得挂 stdio、不得监听端口。
 *      判定手法：子进程里 import 垫片，LOCALAPPDATA 注入临时目录，等 1.2s 后断言
 *      （a）daemon.lock 从未出现（真启动会先过单实例闸写锁）；（b）stdout 无「OpenStory daemon 启动」；
 *      （c）mcp 垫片 stderr 无「已就绪」banner（banner 只在 main() 里写）。
 *   ③ 直跑链路：`node daemon.mjs --port=<随机高位>` 能起，/api/health 返回 200 后杀掉退出
 *      （走垫片的 isMain 判定 → 实现 main(argv) 全链，LOCALAPPDATA 隔离不碰真机锁）。
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
const DAEMON_URL = pathToFileURL(join(HERE, 'daemon.mjs')).href
const MCP_URL = pathToFileURL(join(HERE, 'mcp.mjs')).href
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

/** 隔离的锁环境：子进程把 LOCALAPPDATA 指到临时目录，绝不碰开发者真机的锁。 */
function makeLockEnv() {
  const lockDir = mkdtempSync(join(tmpdir(), 'openstory-os140-'))
  const env = { ...process.env, LOCALAPPDATA: lockDir }
  const lockPath = join(lockDir, 'PinaxNext', 'openstory', 'daemon.lock')
  const cleanup = () => rmSync(lockDir, { recursive: true, force: true })
  return { env, lockPath, cleanup }
}

test('布局宪法：仓根 .mjs 恰好两个入口垫片（daemon/mcp），实现都在 src/host/', () => {
  const rootMjs = readdirSync(HERE).filter((f) => f.endsWith('.mjs')).sort()
  assert.deepEqual(rootMjs, ['daemon.mjs', 'mcp.mjs'], `仓根应只有两个垫片，实际：${rootMjs.join(', ')}`)
  assert.equal(existsSync(join(HERE, 'src', 'host', 'daemon.mjs')), true)
  assert.equal(existsSync(join(HERE, 'src', 'host', 'mcp.mjs')), true)
})

test('垫片再出口实现符号：从 ../daemon.mjs 拿 startDaemon/DEFAULT_PORT（24 个测试文件的用法抽样）', async () => {
  const shim = await import('../daemon.mjs')
  assert.equal(typeof shim.startDaemon, 'function')
  assert.equal(typeof shim.main, 'function')
  assert.equal(typeof shim.DEFAULT_PORT, 'number')
  assert.equal(typeof shim.acquireDaemonLock, 'function')
  const impl = await import('../src/host/daemon.mjs')
  assert.equal(typeof impl.startDaemon, 'function')
})

test('import 垫片不起服务：daemon.lock 不出现、无启动输出（daemon＋mcp 双垫片）', async () => {
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
      const timer = setTimeout(() => reject(new Error('import 垫片子进程超时')), 20_000)
      child.on('exit', (c) => { clearTimeout(timer); resolve(c) })
    })
    assert.equal(code, 0, `import 垫片应干净退出，stderr：${stderr.slice(0, 500)}`)
    assert.ok(stdout.includes('IMPORT-SETTLED'), '子进程应跑完全程')
    assert.equal(existsSync(lockPath), false, '纯 import 垫片不得过单实例闸写锁（＝不得启动服务）')
    assert.equal(stdout.includes('OpenStory daemon 启动'), false, '纯 import 不得出现 daemon 启动输出')
    assert.equal(stderr.includes('已就绪'), false, '纯 import 不得出现 MCP 就绪 banner（banner 只在 main() 里）')
  } finally {
    cleanup()
  }
})

test('直跑链路：node daemon.mjs --port=<随机高位> 能起，/api/health 200 后退出', async () => {
  const { env, cleanup } = makeLockEnv()
  const port = 20000 + Math.floor(Math.random() * 5000)
  const child = spawn(process.execPath, [join(HERE, 'daemon.mjs'), `--port=${port}`], { env, stdio: ['pipe', 'pipe', 'pipe'] })
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
    assert.ok(health, 'daemon 垫片直跑应在 20s 内探到 /api/health 200')
    assert.equal(health.port, port)
    assert.equal(typeof health.pid, 'number')
  } finally {
    try { child.kill() } catch { /* 已经死了不算错 */ }
    await wait(300)
    cleanup()
  }
})
