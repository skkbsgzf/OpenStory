/**
 * API handler 注册表用例（OS-141 daemon 拆分，node:test）。
 *
 * 契约分域（OS-130）落了执行面：contracts/<域>.mjs 声明形状，src/api/handlers/<域>.mjs
 * 实现行为，src/api/registry.mjs 把七个域合成一张表（键＝endpointId）。这里钉死两条：
 *   ① 注册表的键集合与 ENDPOINTS 的键集合完全相等——不多不少（漏一个键＝端点在
 *      路由层「端点未实现」，多一个键＝注册表游离于契约之外，都不许）；
 *   ② 每个 handler 调用后返回 Promise（统一签名 `async handler(ctx)`，daemon 路由
 *      直接 await 它）——用隔离夹具环境真实调用全部 101 个 handler。
 *
 * 夹具纪律：LOCALAPPDATA 指向临时目录；fs-browse.json 预写 nativeDialog=NO_DESKTOP
 * （nativePick 首查即早退，绝不弹真对话框）；DSH_CLI 指向不存在的命令（模型探测
 * spawn 即 ENOENT 快速失败）；货架目录全空；配置/状态路径全落夹具内——全部 handler
 * 的真实首段都在夹具内完成，不碰作者真机、不联网写盘。
 *
 * 跑法：node --test test/apiRegistry.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { HANDLERS } from '../src/api/registry.mjs'
import { createRootAllowlist, loadLibraries } from '../src/host/authorize.mjs'

/** 隔离夹具：临时 LOCALAPPDATA＋预置 NO_DESKTOP 记忆＋空货架目录。 */
function makeFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'openstory-os141-'))
  const openstoryDir = join(fixtureDir, 'PinaxNext', 'openstory')
  mkdirSync(openstoryDir, { recursive: true })
  // nativePick 首查「本机弹不出原生框」的记忆（OS-118/119）——预写后立即 400 早退，不 spawn PowerShell。
  writeFileSync(join(openstoryDir, 'fs-browse.json'), JSON.stringify({ nativeDialog: 'NO_DESKTOP' }), 'utf-8')
  const cleanup = () => rmSync(fixtureDir, { recursive: true, force: true })
  return { fixtureDir, cleanup }
}

/** 假 res：接住 sendJson/writeHead 的最小表面（handler 断言只看「返回了 Promise」）。 */
function makeRes() {
  return {
    headersSent: false,
    statusCode: 0,
    body: null,
    writeHead(status) {
      this.headersSent = true
      this.statusCode = status
    },
    end(body) {
      this.body = body ?? null
    },
    write() {
      return true
    }
  }
}

/** handler 统一调用的 ctx：allowlist 恒空（root 端点第一件事就早退 NO_LIBRARY），
 * context 全部指向夹具（配置/状态写盘都在夹具内），request 给空对象（handler 只读字段）。 */
function makeContext(fixtureDir) {
  return {
    port: 0,
    preferencesPath: join(fixtureDir, 'PinaxNext', 'next-preferences.json'),
    extraRoots: [],
    defaultRoot: '',
    agentConfigPath: join(fixtureDir, 'PinaxNext', 'openstory', 'agent-config.json'),
    agentSessionsDir: join(fixtureDir, 'PinaxNext', 'openstory', 'sessions'),
    stylesDirs: [],
    runtimesDirs: [],
    suitesDirs: [],
    suiteStatePath: join(fixtureDir, 'PinaxNext', 'openstory', 'suite-state.json'),
    genresDirs: [],
    skillsDirs: [],
    // 只有夹具 LOCALAPPDATA＋无效 DSH_CLI：模型探测 spawn 即 ENOENT，绝不碰真机 dsh
    env: { LOCALAPPDATA: fixtureDir, DSH_CLI: 'dsh-not-installed-os141-test' },
    runtime: { generation: 0, startedAt: '', booted: false },
    currentPort: () => 0
  }
}

test('注册表键集合与 ENDPOINTS 键集合完全相等（不多不少）', () => {
  const registryKeys = Object.keys(HANDLERS).sort()
  const endpointIds = Object.keys(ENDPOINTS).sort()
  assert.equal(registryKeys.length, endpointIds.length,
    `键数应相等：注册表 ${registryKeys.length} vs 契约 ${endpointIds.length}`)
  const onlyInRegistry = registryKeys.filter((id) => !Object.prototype.hasOwnProperty.call(ENDPOINTS, id))
  const onlyInEndpoints = endpointIds.filter((id) => !Object.prototype.hasOwnProperty.call(HANDLERS, id))
  assert.deepEqual(onlyInRegistry, [], `注册表多出的键（契约里没有）：${onlyInRegistry.join(', ')}`)
  assert.deepEqual(onlyInEndpoints, [], `注册表缺的键（契约里有但没实现）：${onlyInEndpoints.join(', ')}`)
  assert.deepEqual(registryKeys, endpointIds, '键集合应逐项相等')
})

test('每个 handler 调用后返回 Promise（隔离夹具内真实调用全部端点）', async () => {
  const { fixtureDir, cleanup } = makeFixture()
  try {
    const context = makeContext(fixtureDir)
    const loaded = loadLibraries({ preferencesPath: context.preferencesPath, env: context.env })
    const allowlist = createRootAllowlist(loaded.libraries, context.extraRoots)
    const url = new URL('http://127.0.0.1/api/probe')
    // 逐个调用（config 一族都要原子写同一份 agent-config.json，并发会撞 rename），
    // 每个都先断言返回 Promise，再限时等落定（拒绝也吃掉，避免 unhandled rejection 噪音）。
    // 限时器要 clear——否则 101 个 20s 定时器会把测试进程吊到超时才退。
    for (const [endpointId, handler] of Object.entries(HANDLERS)) {
      assert.equal(typeof handler, 'function', `handler ${endpointId} 应是函数`)
      const res = makeRes()
      const outcome = handler({ req: { method: 'GET' }, res, url, request: {}, context, allowlist, loaded })
      assert.ok(outcome instanceof Promise, `handler ${endpointId} 应返回 Promise，实际 ${typeof outcome}`)
      let timer = null
      const hung = await Promise.race([
        outcome.then(() => false, () => false),
        new Promise((resolve) => { timer = setTimeout(() => resolve(true), 20_000) })
      ])
      clearTimeout(timer)
      assert.equal(hung, false, `handler ${endpointId} 20s 未落定（夹具内不该有慢路径）`)
    }
  } finally {
    cleanup()
  }
})

test('注册表是冻结的：路由层不能被运行期改表', () => {
  assert.equal(Object.isFrozen(HANDLERS), true, 'HANDLERS 应 Object.freeze')
})
