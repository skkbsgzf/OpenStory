/**
 * 页面/API 测试共用临时夹具。
 * 只复制 samples/水浒传 到系统临时目录；LOCALAPPDATA/APPDATA 全部注入临时值。
 * 不读取作者库清单，不连接 8807，不写 samples 原目录。
 */
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDaemon } from '../../src/host/daemon.mjs'

export const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAMPLE = join(REPO, 'samples', '水浒传')
const WORKBENCH_DIRS = ['正文', '世界书', '剧本', '日志', '故事源', '习惯', '扮演', '导入导出', '产物']

async function copyTree(source, target) {
  await mkdir(target, { recursive: true })
  const { readdir } = await import('node:fs/promises')
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) await copyTree(from, to)
    else if (entry.isSymbolicLink()) throw new Error(`样例库不应含符号链接：${from}`)
    else await cp(from, to)
  }
}

function projectMarker(name = '水浒传（测试副本）') {
  const now = new Date().toISOString()
  return {
    spec: 'openstory-project@4', schemaVersion: 4, projectId: 'proj_page_test_fixture',
    name, kind: 'novel', createdAt: now, updatedAt: now,
    carriers: { primary: 'openstory.carrier.novel', enabled: ['openstory.carrier.novel'], revision: 1 }
  }
}

/** 建一份稳定可见的临时样例库；clearUi 只清隐藏/启停键，不动稿件与设置值。 */
export async function makeTestLibrary(base, { name = '水浒传（测试副本）', clearUi = true } = {}) {
  const root = join(base, 'fixture-library')
  await copyTree(SAMPLE, root)
  for (const dir of WORKBENCH_DIRS) await mkdir(join(root, dir), { recursive: true })
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'project.json'), JSON.stringify(projectMarker(name), null, 2), 'utf-8')
  const statePath = join(root, '.openstory', 'ui-state.json')
  let state = {}
  try { state = JSON.parse(await readFile(statePath, 'utf-8')) } catch { /* 样例没有就用空状态 */ }
  if (clearUi) {
    for (const key of Object.keys(state)) {
      if (key.startsWith('modules.enabled.') || ['tabHidden', 'moduleHidden', 'analyzeEnabled'].includes(key)) delete state[key]
    }
  }
  await writeFile(statePath, JSON.stringify(state, null, 2), 'utf-8')
  const safeFiles = [
    ['世界书', '检视示例.md', '# 检视示例\n\n这是临时测试库中的安全示例。\n'],
    ['剧本', '检视示例.md', '# 检视示例\n\n第一场：临时测试。\n']
  ]
  for (const [dir, file, body] of safeFiles) {
    await writeFile(join(root, dir, file), body, 'utf-8').catch(async () => {
      await mkdir(dirname(join(root, dir, file)), { recursive: true })
      await writeFile(join(root, dir, file), body, 'utf-8')
    })
  }
  return root
}

/** 起一个隔离 daemon。defaultRoot=false 时首页停在库管理，便于覆盖全局页。 */
export async function makeTempDaemon({ defaultRoot = true, clearUi = true, sample = true, upstream = false } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'openstory-page-test-'))
  const appData = join(base, 'appdata')
  const env = { ...process.env, LOCALAPPDATA: appData, APPDATA: appData }
  await mkdir(appData, { recursive: true })
  const root = sample ? await makeTestLibrary(base, { clearUi }) : ''
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: root ? [{ path: root, name: '水浒传（测试副本）', addedAt: new Date().toISOString(), source: 'openstory' }] : []
  }, null, 2), 'utf-8')
  const agentConfigPath = join(appData, 'OpenStory', 'openstory', 'agent-config.json')
  let upstreamServer = null
  let upstreamRequests = 0
  if (upstream) {
    const { createServer } = await import('node:http')
    upstreamServer = createServer((req, res) => {
      let body = ''
      req.setEncoding('utf-8')
      req.on('data', (chunk) => { body += chunk })
      req.on('end', () => {
        upstreamRequests += 1
        if (req.url !== '/v1/chat/completions') { res.writeHead(404).end(); return }
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '测试上游已响应。' } }] }))
      })
    })
    await new Promise((done, fail) => { upstreamServer.once('error', fail); upstreamServer.listen(0, '127.0.0.1', done) })
    await mkdir(dirname(agentConfigPath), { recursive: true })
    await writeFile(agentConfigPath, JSON.stringify({ text: {
      endpoint: `http://127.0.0.1:${upstreamServer.address().port}/v1/chat/completions`,
      model: 'page-test-stub', apiKey: '', runtime: '', reasoningEffort: '', chineseReasoning: true
    } }), 'utf-8')
  }
  const daemon = await startDaemon({
    port: 0,
    root: defaultRoot ? root : '',
    preferencesPath,
    agentConfigPath: upstream ? agentConfigPath : null,
    env,
    logger: { log() {} }
  })
  const fixture = {
    base, appData, root, preferencesPath, env, daemon,
    origin: `http://127.0.0.1:${daemon.port}`,
    upstreamRequests: () => upstreamRequests,
    json: async (path, options) => {
      const response = await fetch(`${fixture.origin}${path}`, options)
      const payload = await response.json().catch(() => null)
      return { status: response.status, payload, headers: response.headers }
    },
    close: async () => {
      await daemon.close()
      if (upstreamServer) {
        upstreamServer.closeAllConnections?.()
        await new Promise((done) => upstreamServer.close(done))
      }
      await rm(base, { recursive: true, force: true })
    }
  }
  return fixture
}

export async function withTempDaemon(run, options = {}) {
  const fixture = await makeTempDaemon(options)
  try { return await run(fixture) } finally { await fixture.close() }
}
