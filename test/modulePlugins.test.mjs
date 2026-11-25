/**
 * 模块插件（OS-144 / G5a）：分析 / 生图识图 / 知识库。
 *
 * 钉死四件事：
 *   ① 三个 manifest 过契约形状校验，端点归属只登记**独占**端点；
 *   ② 启停判定只有单一入口 isModuleEnabled（ui-state `modules.enabled.<id>`，缺省 true）；
 *   ③ daemon 独占端点停用 → MODULE_DISABLED，共用端点照常，重新启用即恢复，值不丢；
 *   ④ 分析停用时旁路一并收口：扮演 AI 味闸跳过、MCP 分析工具回 MODULE_DISABLED
 *      （MCP 只在显式给 root 时才判定——没 root 没有库上下文，OS-146）。
 *
 * 夹具纪律：全部在系统临时目录建库，绝不碰作者真库。
 * 跑法：node --test test/modulePlugins.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENDPOINTS } from '../src/api/contracts.mjs'
import { HANDLERS, ENDPOINT_MODULES, HANDLER_MODULE_SOURCES } from '../src/api/registry.mjs'
import {
  MODULE_MANIFESTS,
  MODULE_SPEC,
  isModuleEnabled,
  isModuleDisabledFor,
  moduleOfEndpoint,
  validateModuleManifest
} from '../src/protocol/modules.mjs'
import { deAiPass } from '../src/modules/roleplay/roleplayEngine.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

async function makeLibrary() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os144-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  await writeFile(join(root, '正文', 'ch1.md'), '第一章正文。', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-24T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath }
}

async function writeUiState(root, state) {
  await writeFile(join(root, '.openstory', 'ui-state.json'), JSON.stringify(state, null, 2), 'utf-8')
}

/** 起 MCP 子进程，收 newline-delimited JSON-RPC 回包。 */
function startMcp(env = process.env) {
  const child = spawn(process.execPath, [join(ROOT, 'src', 'host', 'mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env })
  const pending = new Map()
  let buf = ''
  let nextId = 1
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buf += chunk
    let index
    while ((index = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, index).trim()
      buf = buf.slice(index + 1)
      if (!line) continue
      try {
        const message = JSON.parse(line)
        if (message.id !== undefined && pending.has(message.id)) {
          pending.get(message.id)(message)
          pending.delete(message.id)
        }
      } catch { /* 非 JSON 行忽略 */ }
    }
  })
  const request = (method, params) => new Promise((resolve) => {
    const id = nextId++
    pending.set(id, resolve)
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n')
  })
  return { request, close: () => child.kill() }
}

test('模块 manifest：全部工作台过形状校验，core 已退役且端点错误契约完备', () => {
  const ids = MODULE_MANIFESTS.map((manifest) => manifest.id).sort()
  for (const id of ['analysis', 'comfyui', 'kb', 'habits', 'storysource', 'artifacts', 'exchange', 'chapters', 'script', 'worldbook', 'roleplay']) assert.ok(ids.includes(id), `模块 ${id} 必须在清单`)
  for (const manifest of MODULE_MANIFESTS) {
    const checked = validateModuleManifest(manifest, { dirName: manifest.id })
    assert.equal(checked.ok, true, `${manifest.id} 应过校验：${checked.errors?.join('；')}`)
    assert.equal(manifest.spec, MODULE_SPEC)
    assert.equal(Object.prototype.hasOwnProperty.call(manifest, 'core'), false, `${manifest.id} 不得再声明 core`)
    for (const endpoint of manifest.endpoints) {
      assert.ok(Object.prototype.hasOwnProperty.call(ENDPOINTS, endpoint), `${manifest.id} 声明的端点不存在：${endpoint}`)
      assert.ok(ENDPOINTS[endpoint].errors.includes('MODULE_DISABLED'), `${endpoint} 的契约 errors 应登记 MODULE_DISABLED`)
      if (manifest.requires?.length) {
        assert.ok(ENDPOINTS[endpoint].errors.includes('PLUGIN_DEGRADED'), `${endpoint} 的契约 errors 应登记 PLUGIN_DEGRADED`)
      }
    }
  }
  assert.equal(validateModuleManifest({ spec: 'x' }).ok, false)
  assert.equal(validateModuleManifest({ ...MODULE_MANIFESTS[0], core: true }).ok, false, '@2 的 core 字段必须拒绝')
})

test('端点归属：只登记独占端点，共用端点没有归属', () => {
  assert.equal(moduleOfEndpoint('kbStatusGet'), 'kb')
  assert.equal(moduleOfEndpoint('kbConfigPut'), 'kb')
  assert.equal(moduleOfEndpoint('deduceImage'), 'comfyui')
  assert.equal(moduleOfEndpoint('referenceImageGenerate'), 'comfyui')
  assert.equal(moduleOfEndpoint('visionDescribe'), 'comfyui')
  // 共用端点：任何模块停用都不该影响
  assert.equal(moduleOfEndpoint('factCurveGet'), null)
  // chapterGet 归正文工作台独占；停用正文时与其它工作台一样返回 MODULE_DISABLED。
  assert.equal(moduleOfEndpoint('chapterGet'), 'chapters')
  // 分析没有 daemon 端点（纯本地引擎），表里不该硬塞
  assert.equal(ENDPOINT_MODULES.analysis, undefined)
  // OS-161 起模块清单按批扩大：断言改为「与 manifest 装载结果一致」的动态等价加强——
  // 每个 manifest 都进来源表、且没有多余项；强度不减（原来也是全等比较，只是写死集合）。
  assert.deepEqual(
    HANDLER_MODULE_SOURCES.map((item) => item.id).sort(),
    MODULE_MANIFESTS.map((item) => item.id).sort()
  )
  for (const id of ['analysis', 'comfyui', 'kb', 'habits', 'storysource', 'artifacts', 'exchange']) {
    assert.ok(HANDLER_MODULE_SOURCES.some((item) => item.id === id), `段 C 前已落地模块 ${id} 必须在来源表`)
  }
  for (const endpoint of Object.keys(ENDPOINT_MODULES)) assert.ok(HANDLERS[endpoint], `归属端点缺 handler：${endpoint}`)
})

test('isModuleEnabled：单一判定入口，缺省启用，嵌套与扁平键都认', async () => {
  const { base, root } = await makeLibrary()
  try {
    assert.equal(await isModuleEnabled(root, 'kb'), true, '没有 ui-state ＝ 缺省启用')
    assert.equal(await isModuleEnabled('', 'kb'), true, '没有库根按启用处理')

    await writeUiState(root, { modules: { enabled: { kb: false } } })
    assert.equal(await isModuleEnabled(root, 'kb'), false)
    assert.equal(await isModuleEnabled(root, 'comfyui'), true, '没被点名的模块不受影响')
    assert.equal(await isModuleDisabledFor('kbStatusGet', root), 'kb')
    assert.equal(await isModuleDisabledFor('factCurveGet', root), null, '共用端点永不因模块停用失效')

    await writeUiState(root, { 'modules.enabled.kb': false })
    assert.equal(await isModuleEnabled(root, 'kb'), false, '扁平键同样生效')

    await writeUiState(root, { modules: { enabled: { kb: true } } })
    assert.equal(await isModuleEnabled(root, 'kb'), true)
    assert.equal(await isModuleDisabledFor('kbStatusGet', root), null)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon 宿主组合面：拒绝写成停用插件，存量 false 键也不会关闭库管理与 Agent 栏', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const denied = await fetch(`${origin}/api/ui-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, state: { 'modules.enabled.agentbar': false, 'modules.enabled.library': false } })
    })
    assert.equal(denied.status, 400)
    assert.equal((await denied.json()).error.code, 'INVALID_ENTRY')

    await writeFile(join(root, '.openstory', 'ui-state.json'), JSON.stringify({
      'modules.enabled.agentbar': false,
      'modules.enabled.library': false
    }), 'utf-8')
    const libraries = await fetch(`${origin}/api/libraries`)
    assert.equal(libraries.status, 200)
    const sessions = await fetch(`${origin}/api/agent/sessions?root=${encodeURIComponent(root)}`)
    assert.equal(sessions.status, 200)
    assert.equal((await sessions.json()).ok, true)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon：独占端点停用返回 MODULE_DISABLED，共用端点照常，启用恢复且值保留', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const env = { LOCALAPPDATA: base, APPDATA: base }
  await writeUiState(root, { modules: { enabled: { kb: false, comfyui: false } }, theme: 'dark' })
  const daemon = await startDaemon({ port: 0, preferencesPath, env, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const kbStatus = await fetch(`${origin}/api/kb/status`)
    assert.equal(kbStatus.status, 409)
    assert.equal((await kbStatus.json()).error.code, 'MODULE_DISABLED')

    const image = await fetch(`${origin}/api/deduce/image`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, name: '场景', prompt: '山道' })
    })
    assert.equal(image.status, 409)
    assert.equal((await image.json()).error.code, 'MODULE_DISABLED')

    // 共用端点不受影响（fact 读＝多方共用，任何模块停用都不许让它失效）。
    // OS-161 起 habits 已升为独占端点，不能再当共用端点的例子——这里只钉 fact 读。
    const entries = await (await fetch(`${origin}/api/fact/curve?root=${encodeURIComponent(root)}`)).json()
    assert.equal(entries.ok, true, 'fact 读端点不能被模块停用带走')

    // 重新启用：值（theme）原封不动，端点恢复
    const put = await fetch(`${origin}/api/ui-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, state: { modules: { enabled: { kb: true } } } })
    })
    assert.equal(put.status, 200)
    const enabledStatus = await (await fetch(`${origin}/api/kb/status`)).json()
    assert.equal(enabledStatus.ok, true)
    const saved = JSON.parse(await readFile(join(root, '.openstory', 'ui-state.json'), 'utf-8'))
    assert.equal(saved.theme, 'dark', '停用/启用不该清掉别的界面状态')
    assert.equal(saved.modules.enabled.kb, true)
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon kb 闸：多库时按请求 root 判定（A 停用 kb、B 启用 → 带 B 的 root 必须 200）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os146-'))
  const rootA = join(base, '夹具库A')
  const rootB = join(base, '夹具库B')
  for (const root of [rootA, rootB]) {
    await mkdir(join(root, '.openstory'), { recursive: true })
    await mkdir(join(root, '正文'), { recursive: true })
  }
  await writeUiState(rootA, { modules: { enabled: { kb: false } } })
  await writeUiState(rootB, { modules: { enabled: { kb: true } } })
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [
      { path: rootA, name: '夹具库A', at: '2026-11-24T00:00:00.000Z' },
      { path: rootB, name: '夹具库B', at: '2026-11-23T00:00:00.000Z' }
    ]
  }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    // 不带 root：兜底按库清单第一条（A，已停用）——这是兜底，不是语义
    const fallback = await fetch(`${origin}/api/kb/status`)
    assert.equal(fallback.status, 409)

    // 带 B 的 root：按 B 判定（kb 启用）→ 放行，不被另一个库的停用误拦
    const bStatus = await fetch(`${origin}/api/kb/status?root=${encodeURIComponent(rootB)}`)
    assert.equal(bStatus.status, 200, '带 B 的 root 时不该被 A 的停用拦住')
    assert.equal((await bStatus.json()).ok, true)

    const bConfig = await fetch(`${origin}/api/kb/config?root=${encodeURIComponent(rootB)}`)
    assert.equal(bConfig.status, 200, 'kbConfigGet 同样吃 root')

    const aStatus = await fetch(`${origin}/api/kb/status?root=${encodeURIComponent(rootA)}`)
    assert.equal(aStatus.status, 409, '带 A 的 root 仍按 A 的停用判定')
    assert.equal((await aStatus.json()).error.code, 'MODULE_DISABLED')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('daemon 推演能力：活跃消费者拦住停用，存量断链端点回 PLUGIN_DEGRADED', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  const daemon = await startDaemon({ port: 0, preferencesPath, env: { LOCALAPPDATA: base, APPDATA: base }, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const denied = await fetch(`${origin}/api/ui-state`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, state: { 'modules.enabled.deduce': false } })
    })
    assert.equal(denied.status, 409)
    const deniedPayload = await denied.json()
    assert.equal(deniedPayload.error.code, 'CAPABILITY_IN_USE')
    assert.deepEqual(deniedPayload.error.details.consumers, ['roleplay'])

    await writeUiState(root, { 'modules.enabled.deduce': false })
    const present = await fetch(`${origin}/api/deduce/present`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root, bookId: 'default' })
    })
    assert.equal(present.status, 503)
    const payload = await present.json()
    assert.equal(payload.error.code, 'PLUGIN_DEGRADED')
    assert.equal(payload.error.details.module, 'roleplay')
    assert.deepEqual(payload.error.details.missing, [{ capability: 'deduce.engine', min: 1, maxExclusive: 2 }])

    const shared = await fetch(`${origin}/api/fact/curve?root=${encodeURIComponent(root)}`)
    assert.equal(shared.status, 200, '共用 fact 读端点不随推演能力断链失效')
  } finally {
    await daemon.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('分析停用：扮演的去 AI 味闸跳过（不调用模型、原文逐字返回）；启用态照旧过闸', async () => {
  const prose = '他忽然觉得这一切仿佛宛如犹如一场梦。与此同时，然而，综上所述。'
  let calls = 0
  const skipped = await deAiPass({
    chatComplete: async () => { calls += 1; return '不该被调用' },
    prose,
    enabled: false
  })
  assert.equal(calls, 0, '停用＝不过闸，模型一次都不该被调')
  assert.equal(skipped.text, prose)
  assert.equal(skipped.rewritten, false)

  const gated = await deAiPass({
    chatComplete: async () => { calls += 1; return '改写后的正文。' },
    prose,
    threshold: 0,
    enabled: true
  })
  assert.equal(calls, 1, '启用态照旧调模型做改写')
  assert.equal(gated.rewritten, true)
  assert.equal(gated.text, '改写后的正文。')
})

test('MCP 分析工具：不带 root ＝没有库上下文，不做模块闸（即使本机库清单里的库停用了分析）', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  await writeUiState(root, { modules: { enabled: { analysis: false } } })
  // 只给库清单、不给 root：工具不该去读这份清单——分析吃纯文本，不绑定库（OS-146）
  const mcp = startMcp({ ...process.env, OPENSTORY_PREFERENCES: preferencesPath })
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05' })
    const allowed = await mcp.request('tools/call', {
      name: 'openstory_analysis_chapter',
      arguments: { text: '他笑了。\n\n她哭了。' }
    })
    assert.equal(allowed.result.isError, false, '不带 root 必须仍然真算，不得读本机库清单')
    const payload = JSON.parse(allowed.result.content[0].text)
    assert.ok(payload.stats.chars > 0, '真的算了正文')
  } finally {
    mcp.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('MCP 分析工具：同一库带 root ＝按该库判定，停用回 MODULE_DISABLED', async () => {
  const { base, root, preferencesPath } = await makeLibrary()
  await writeUiState(root, { modules: { enabled: { analysis: false } } })
  const mcp = startMcp({ ...process.env, OPENSTORY_PREFERENCES: preferencesPath })
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05' })
    const blocked = await mcp.request('tools/call', {
      name: 'openstory_analysis_chapter',
      arguments: { text: '他笑了。\n\n她哭了。', root }
    })
    assert.equal(blocked.result.isError, true)
    assert.match(blocked.result.content[0].text, /^MODULE_DISABLED/u)
  } finally {
    mcp.close()
    await rm(base, { recursive: true, force: true })
  }
})

test('分析停用：MCP 分析工具回 MODULE_DISABLED；重新启用后照常真算', async () => {
  const { base, root } = await makeLibrary()
  await writeUiState(root, { modules: { enabled: { analysis: false } } })
  const mcp = startMcp()
  try {
    await mcp.request('initialize', { protocolVersion: '2024-11-05' })
    const blocked = await mcp.request('tools/call', {
      name: 'openstory_analysis_chapter',
      arguments: { text: '他笑了。\n\n她哭了。', root }
    })
    assert.equal(blocked.result.isError, true)
    assert.match(blocked.result.content[0].text, /^MODULE_DISABLED/u)

    await writeUiState(root, { modules: { enabled: { analysis: true } } })
    const allowed = await mcp.request('tools/call', {
      name: 'openstory_analysis_chapter',
      arguments: { text: '他笑了。\n\n她哭了。', root }
    })
    assert.equal(allowed.result.isError, false)
    const payload = JSON.parse(allowed.result.content[0].text)
    assert.ok(payload.stats.chars > 0)
  } finally {
    mcp.close()
    await rm(base, { recursive: true, force: true })
  }
})
