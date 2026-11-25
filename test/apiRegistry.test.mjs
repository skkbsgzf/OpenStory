/**
 * API handler 注册表用例（OS-141 拆分 / OS-194 归插件后重写）。
 *
 * 契约壳现在只持有宿主端点（62）；模块声明的 41 个端点经 activate() 贡献登记。
 * 这里钉死三条：
 *   ① 宿主表键集合＝宿主端点集合，全量表（宿主＋贡献）键集合＝ENDPOINTS 键集合；
 *   ② 每个 handler 调用后返回 Promise——用隔离夹具真实调用全部 103 个 handler；
 *   ③ 宿主表与贡献表都冻结，路由层不能被运行期改表。
 *
 * 夹具纪律：LOCALAPPDATA 指向临时目录；fs-browse.json 预写 nativeDialog=NO_DESKTOP
 * （nativePick 首查即早退，绝不弹真对话框）；DSH_CLI 指向不存在的命令；货架目录全空。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { HOST_HANDLERS } from '../src/api/registry.mjs'
import { allHandlers } from '../src/host/handlerTable.mjs'
import { hostOwnedEndpointIds } from '../tools/acceptance/moduleCoverage.mjs'
import { createRootAllowlist, loadLibraries } from '../src/host/authorize.mjs'

function makeFixture() {
  const fixtureDir = mkdtempSync(join(tmpdir(), 'openstory-os141-'))
  const openstoryDir = join(fixtureDir, 'OpenStory', 'openstory')
  mkdirSync(openstoryDir, { recursive: true })
  writeFileSync(join(openstoryDir, 'fs-browse.json'), JSON.stringify({ nativeDialog: 'NO_DESKTOP' }), 'utf-8')
  return { fixtureDir, cleanup: () => rmSync(fixtureDir, { recursive: true, force: true }) }
}

function makeRes() {
  return {
    headersSent: false,
    statusCode: 0,
    body: null,
    writeHead(status) { this.headersSent = true; this.statusCode = status },
    end(body) { this.body = body ?? null },
    write() { return true }
  }
}

function makeContext(fixtureDir) {
  return {
    port: 0,
    preferencesPath: join(fixtureDir, 'OpenStory', 'libraries.json'),
    extraRoots: [],
    defaultRoot: '',
    agentConfigPath: join(fixtureDir, 'OpenStory', 'openstory', 'agent-config.json'),
    agentSessionsDir: join(fixtureDir, 'OpenStory', 'openstory', 'sessions'),
    stylesDirs: [],
    runtimesDirs: [],
    suitesDirs: [],
    suiteStatePath: join(fixtureDir, 'OpenStory', 'openstory', 'suite-state.json'),
    genresDirs: [],
    skillsDirs: [],
    env: { LOCALAPPDATA: fixtureDir, DSH_CLI: 'dsh-not-installed-os141-test' },
    runtime: { generation: 0, startedAt: '', booted: false },
    currentPort: () => 0
  }
}

test('注册表键集合：宿主表＝宿主白名单，全量表＝ENDPOINTS（不多不少）', async () => {
  const hostIds = Object.keys(HOST_HANDLERS).sort()
  const expectedHost = [...hostOwnedEndpointIds()].sort()
  assert.deepEqual(hostIds, expectedHost, '宿主静态表只许放宿主白名单端点')
  const table = await allHandlers()
  const contributed = Object.keys(table).filter((id) => !hostOwnedEndpointIds().has(id))
  assert.equal(contributed.length, 41, '模块贡献恰为 41 个独占端点')
  assert.deepEqual(Object.keys(table).sort(), Object.keys(ENDPOINTS).sort())
})

test('每个 handler 调用后返回 Promise（隔离夹具内真实调用全部端点）', async () => {
  const { fixtureDir, cleanup } = makeFixture()
  try {
    const context = makeContext(fixtureDir)
    const loaded = loadLibraries({ preferencesPath: context.preferencesPath, env: context.env })
    const allowlist = createRootAllowlist(loaded.libraries, context.extraRoots)
    const url = new URL('http://127.0.0.1/api/probe')
    const table = await allHandlers()
    for (const [endpointId, handler] of Object.entries(table)) {
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

test('注册表是冻结的：路由层不能被运行期改表', async () => {
  assert.equal(Object.isFrozen(HOST_HANDLERS), true, 'HOST_HANDLERS 应 Object.freeze')
  const table = await allHandlers()
  assert.equal(Object.isFrozen(table), true, '全量 handler 表应 Object.freeze')
})
