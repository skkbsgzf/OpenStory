/**
 * OS-224：update-project 独立迁移 E2E。
 *
 * 全部使用系统临时目录、临时 LOCALAPPDATA/APPDATA、port:0 daemon 与 MCP 子进程；
 * 不连接/重启生产 8807，不读作者真库。旧库、能力迁移、DATA_VERSION_AHEAD、
 * plan 漂移、确认闸、备份/回滚失败在同一入口串起。
 *
 * 用法：node tools/verify/verify-upgrade-e2e.mjs [--out <目录>]
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDaemon } from '../../src/host/daemon.mjs'
import { runCapabilityMigrations } from '../../src/protocol/capabilityMigration.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const results = []
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')
const text = (value) => String(value ?? '')

async function put(root, rel, body) {
  const abs = join(root, rel)
  await mkdir(dirname(abs), { recursive: true })
  await writeFile(abs, body, 'utf8')
}

async function legacyLibrary(root) {
  await put(root, '.旧版库/project.json', JSON.stringify({
    spec: '旧版库-project@3', schemaVersion: 3, projectId: 'proj_old', name: '旧库', kind: 'novel',
    createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
    carriers: { primary: '旧版库.carrier.novel', enabled: ['旧版库.carrier.novel'], revision: 1 }
  }, null, 2))
  await put(root, '.旧版库/ui-state.json', JSON.stringify({ view: 'dir:拆解', tabHidden: ['dir:拆解'] }))
  await put(root, '.旧版库/log/参考/2026-01.jsonl', '{"module":"参考"}\n坏行保留\n')
  await put(root, '参考/same.md', '旧参考\n')
  await put(root, '参考/sub/same.md', '旧子目录\n')
  await put(root, '世界书/same.md', '新世界书\n')
  await put(root, '世界书/sub/same.md', '新世界书子目录\n')
  await put(root, '.旧版库/drafts/推演/r1.json', '{"module":"推演","text":"old"}')
  await put(root, '.openstory/existing.json', '{"path":"拆解/a.json"}')
  await put(root, '推演/book/session.json', JSON.stringify({ path: '推演/book/归档/第1章.md', archives: [{ path: '推演/book/归档/第1章.md' }] }))
  await put(root, '导出/shuihu.jsonl', '{"schema":"pedia/v1"}\n')
  await put(root, '拆解/book.json', JSON.stringify({ book: { id: 'book' }, entries: [] }))
  await put(root, '拆解/book.wiki.json', JSON.stringify({ derivedFrom: { schema: '旧版库-wiki-derived@1', factRevision: 1 } }))
  await put(root, '正文/001.md', '旧正文\n')
}

async function snapshot(root, omitHistory = false) {
  const rows = []
  const walk = async (abs, rel = '') => {
    for (const entry of (await readdir(abs, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (omitHistory && entry.name === '.history') continue
      const next = rel ? `${rel}/${entry.name}` : entry.name
      const full = join(abs, entry.name)
      if (entry.isDirectory()) await walk(full, next)
      else if (entry.isFile()) rows.push([next, sha256(await readFile(full))])
    }
  }
  await walk(root)
  return rows
}

function startMcp(port) {
  const child = spawn(process.execPath, [join(REPO, 'src', 'host', 'mcp.mjs')], {
    cwd: REPO, env: { ...process.env, OPENSTORY_PORT: String(port) }, stdio: ['pipe', 'pipe', 'pipe']
  })
  const pending = new Map()
  let buffer = '', nextId = 1, exited = false, stderr = ''
  child.stdout.setEncoding('utf8')
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => { stderr += chunk })
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1)
      if (!line) continue
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    }
  })
  child.on('exit', () => { exited = true })
  const request = (method, params) => new Promise((resolveRequest, reject) => {
    const id = nextId++
    const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP 超时 ${method}`)) }, 30000)
    pending.set(id, (message) => { clearTimeout(timer); resolveRequest(message) })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) })}\n`)
  })
  return {
    request,
    close: async () => { if (!exited) { child.kill(); await new Promise((done) => child.once('exit', done)) } },
    stderr: () => stderr
  }
}
const call = async (mcp, name, args = {}) => {
  const reply = await mcp.request('tools/call', { name, arguments: args })
  assert.equal(reply.error, undefined, JSON.stringify(reply.error))
  return reply.result
}
const payload = (result) => {
  if (!result || result.isError) throw new Error(result?.content?.[0]?.text ?? 'MCP 调用失败')
  return JSON.parse(result.content[0].text)
}

async function startFakeUpstream() {
  const server = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: '测试上游' } }] }))
    })
  })
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  return server
}

function parseArgv(argv) {
  let out = ''
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--out') out = resolve(argv[++index] ?? '')
    else throw new Error(`未知参数：${argv[index]}`)
  }
  return { out: out ? resolve(out) : null }
}

const options = parseArgv(process.argv.slice(2))
const base = options.out ?? (await mkdtemp(join(tmpdir(), 'os224-upgrade-e2e-')) + '-out')
await mkdir(base, { recursive: true })
const appData = join(base, 'appdata')
await mkdir(appData, { recursive: true })
const preferencesPath = join(base, 'libraries.json')
const root = join(base, 'legacy-library')
const rootAhead = join(base, 'ahead-library')
const rootHealthy = join(base, 'healthy-library')
let daemon = null, upstream = null, mcp = null

try {
  await legacyLibrary(root)
  const recoveryRoot = join(base, 'recovery-library')
  await mkdir(rootAhead, { recursive: true })
  await mkdir(rootHealthy, { recursive: true })
  await mkdir(recoveryRoot, { recursive: true })
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1,
    libraries: [root, rootAhead, rootHealthy, recoveryRoot].map((path, index) => ({ path, name: `fixture-${index}`, addedAt: '2026-01-01T00:00:00.000Z', source: 'openstory' }))
  }), 'utf8')
  upstream = await startFakeUpstream()
  await put(appData, 'OpenStory/openstory/agent-config.json', JSON.stringify({
    text: { endpoint: `http://127.0.0.1:${upstream.address().port}/v1/chat/completions`, model: 'os224-stub', apiKey: '', runtime: '' }
  }))
  daemon = await startDaemon({
    port: 0, root, preferencesPath, agentConfigPath: join(appData, 'OpenStory', 'openstory', 'agent-config.json'),
    env: { ...process.env, LOCALAPPDATA: appData, APPDATA: appData }, logger: { log() {} }
  })
  mcp = startMcp(daemon.port)
  await mcp.request('initialize', { protocolVersion: '2024-11-05' })
  const origin = `http://127.0.0.1:${daemon.port}`
  const post = async (path, body) => {
    const response = await fetch(`${origin}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
    return { status: response.status, payload: await response.json().catch(() => null) }
  }

  // ① diagnose/plan 预览零写入。
  const before = await snapshot(root)
  const diagnose = payload(await call(mcp, 'openstory_upgrade_diagnose', { root }))
  check('OS-224 ① diagnose 只读且 reports needed', diagnose.writes === false && diagnose.section.needed === true)
  const plan = payload(await call(mcp, 'openstory_upgrade_plan', { root }))
  check('OS-224 ① plan 绑定 root/files/migrator 且零写入', plan.planId && plan.plan.writes === false && plan.plan.bindings.length >= 2)
  check('OS-224 ① preview 前后整库字节完全一致', JSON.stringify(await snapshot(root)) === JSON.stringify(before))

  // ② confirm 缺失/低级别/额外参数全部零写入。
  const denied = await call(mcp, 'openstory_upgrade_apply', { root, planId: plan.planId })
  check('OS-224 ② MCP apply 缺确认拒绝', denied.isError === true && /CONFIRM_REQUIRED/u.test(denied.content[0].text))
  const low = await call(mcp, 'openstory_upgrade_apply', { root, planId: plan.planId, confirm: 'create' })
  check('OS-224 ② MCP apply 低确认拒绝', low.isError === true && /CONFIRM_REQUIRED/u.test(low.content[0].text))
  const extra = await post('/api/library/upgrade-apply', { root, planId: plan.planId, confirm: true, shell: 'x' })
  check('OS-224 ② HTTP 额外参数拒绝', extra.status === 400 && extra.payload?.error?.code === 'INVALID_ENTRY')
  check('OS-224 ② 拒绝路径零写入', JSON.stringify(await snapshot(root)) === JSON.stringify(before))

  // ③ 文件漂移：仅改被绑定数据，planId 必须失效。
  const changedFile = plan.plan.bindings.find((item) => item.path === '.旧版库/project.json')
  assert.ok(changedFile, '计划必须绑定旧 project.json')
  await put(root, '.旧版库/project.json', JSON.stringify({ spec: '旧版库-project@3', schemaVersion: 3, name: '作者改稿', carriers: { primary: '旧版库.carrier.novel' } }))
  const drifted = await call(mcp, 'openstory_upgrade_apply', { root, planId: plan.planId, confirm: 'migrate' })
  check('OS-224 ③ plan 文件漂移拒绝', drifted.isError === true && /PLAN_STALE/u.test(drifted.content[0].text))
  await put(root, '.旧版库/project.json', JSON.stringify({ spec: '旧版库-project@3', schemaVersion: 3, name: '旧库', carriers: { primary: '旧版库.carrier.novel' } }))
  const replanned = payload(await call(mcp, 'openstory_upgrade_plan', { root }))

  // ④ MCP 成功 apply → status → backup verify。
  const applied = payload(await call(mcp, 'openstory_upgrade_apply', { root, planId: replanned.planId, confirm: 'migrate' }))
  check('OS-224 ④ MCP 升级成功', applied.outcome === 'success' && applied.rolledBack === true, applied.message)
  check('OS-224 ④ 目录/schema 升级且退役保留', existsSync(join(root, '.openstory', 'project.json')) && (await readdir(root)).some((name) => name.startsWith('.旧版库.retired-')))
  const status = payload(await call(mcp, 'openstory_upgrade_status', { root }))
  check('OS-224 ④ status 读到升级标记', status.status?.upgrade?.markerState === 'ok' && status.status?.writes === false, JSON.stringify(status.status?.upgrade))
  const backups = payload(await call(mcp, 'openstory_upgrade_backup_verify', { root }))
  check('OS-224 ④ backup verify 健康', backups.healthy === true && backups.backups.some((item) => item.kind === 'upgrade'))
  const replay = await call(mcp, 'openstory_upgrade_apply', { root, planId: replanned.planId, confirm: 'migrate' })
  check('OS-224 ④ planId 一次性', replay.isError === true && /PLAN_NOT_FOUND/u.test(replay.content[0].text))

  // ⑤ capability migration 成功、失败回滚、回滚未完成。
  const pkg = join(base, 'migration-package', 'textplus')
  await mkdir(join(pkg, 'migrations'), { recursive: true })
  const dataRel = '.openstory/migration-data.json'
  await put(root, dataRel, '{"version":1}')
  await put(pkg, 'migrations/v1-to-v2.mjs', `export default async () => ({ files: [{ path: '${dataRel}', content: '{"version":2}' }] })`)
  const migration = { plugin: 'textplus', packageDir: pkg, capability: 'text.analyze', from: 1, to: 2, entry: 'migrations/v1-to-v2.mjs' }
  const ran = await runCapabilityMigrations({ root, migrations: [migration] })
  check('OS-224 ⑤ capability 成功 journal done', ran.ok === true && ran.ran?.[0]?.ok === true)
  const doneJournal = JSON.parse(await readFile(join(root, '.openstory/migrations/text.analyze/1-to-2.json'), 'utf8'))
  check('OS-224 ⑤ capability dataVersion=2', doneJournal.state === 'done' && doneJournal.to === 2)
  // 状态端点的纯读 routes 必须来自真实当前层；内置 text.analyze@1 会让 @2 数据 Ahead。
  // 若运行层未装载 textplus，也仍然按内置 @1 回落报告。
  const statusAfterDone = payload(await call(mcp, 'openstory_upgrade_status', { root }))
  check('OS-224 ⑤ status 读到 capability done', statusAfterDone.status?.journals?.some((item) => item.capability === 'text.analyze' && item.state === 'done'), JSON.stringify(statusAfterDone.status?.journals))

  await put(root, dataRel, '{"version":2,"injected":true}')
  await put(pkg, 'migrations/v2-to-v3.mjs', `export default async () => { throw new Error('injected failure') }`)
  const failedMigration = await runCapabilityMigrations({ root, migrations: [{ ...migration, from: 2, to: 3, entry: 'migrations/v2-to-v3.mjs' }] })
  check('OS-224 ⑤ capability 失败回滚', failedMigration.ok === false && failedMigration.failures?.[0]?.rolledBack === true)
  check('OS-224 ⑤ capability 失败原数据保留', await readFile(join(root, dataRel), 'utf8') === '{"version":2,"injected":true}')

  // 回滚未完成：另造一份 running journal，声明已提交但备份缺失；恢复失败必须
  // 写 recovered + rollbackErrors，且状态面 rolledBack:false。不能只删刚才成功迁移的备份。
  await legacyLibrary(recoveryRoot)
  const recoveryRel = '.openstory/recovery-data.json'
  await put(recoveryRoot, recoveryRel, '{"version":2}')
  await mkdir(join(recoveryRoot, '.openstory/migrations/text.analyze'), { recursive: true })
  await writeFile(join(recoveryRoot, '.openstory/migrations/text.analyze/2-to-3.json'), JSON.stringify({
    spec: 'openstory-capability-migration@1', plugin: 'textplus', capability: 'text.analyze',
    from: 2, to: 3, state: 'running', backupPath: '.history/capability-text.analyze-2-to-3-missing',
    files: [{ path: recoveryRel, backup: recoveryRel, committed: true, beforeHash: null, afterHash: 'a'.repeat(64) }]
  }), 'utf8')
  const recoveryRun = await runCapabilityMigrations({ root: recoveryRoot, migrations: [{ ...migration, from: 2, to: 3, entry: 'migrations/v2-to-v3.mjs' }] })
  check('OS-224 ⑤ 恢复失败 rolledBack:false', recoveryRun.ok === false && recoveryRun.failures?.[0]?.rolledBack === false)
  const recoveryStatus = payload(await call(mcp, 'openstory_upgrade_status', { root: recoveryRoot }))
  check('OS-224 ⑤ status 不伪装回滚完成', recoveryStatus.status?.failures?.some((item) => item.state === 'recovered' && item.rolledBack === false), JSON.stringify(recoveryStatus.status?.failures))

  // ⑥ DATA_VERSION_AHEAD：状态端点 200 只报告，业务端点/MCP 不误读。
  // 清掉 rootAhead 的升级标记等状态，只留 capability journal，避免旧库自动升级干扰。
  await put(rootAhead, '.openstory/migrations/text.analyze/1-to-2.json', JSON.stringify({
    spec: 'openstory-capability-migration@1', state: 'done', from: 1, to: 2,
    plugin: 'ahead', capability: 'text.analyze', files: []
  }))
  const aheadStatus = payload(await call(mcp, 'openstory_upgrade_status', { root: rootAhead }))
  check('OS-224 ⑥ MCP status dataAhead 只报告', aheadStatus.status?.dataAhead?.length > 0, JSON.stringify(aheadStatus.status?.dataAhead))
  const aheadPlan = payload(await call(mcp, 'openstory_upgrade_plan', { root: rootAhead }))
  const aheadApply = await call(mcp, 'openstory_upgrade_apply', { root: rootAhead, planId: aheadPlan.planId, confirm: 'migrate' })
  check('OS-224 ⑥ MCP apply DATA_VERSION_AHEAD 拒绝', aheadApply.isError === true && /DATA_VERSION_AHEAD/u.test(aheadApply.content[0].text))
  const healthyStatus = payload(await call(mcp, 'openstory_upgrade_status', { root: rootHealthy }))
  check('OS-224 ⑥ 未迁库不受影响', healthyStatus.status?.dataAhead?.length === 0 && healthyStatus.status?.healthy === true, JSON.stringify(healthyStatus.status))

  // ⑦ 22+ 既有失败注入汇总：从测试 fixture 复用同一 upgradeLibrary 生产入口。
  const { upgradeLibrary } = await import('../../src/protocol/libraryUpgrade.mjs')
  const injectionPoints = [
    'backup:mkdir', 'backup:.旧版库', 'backup:manifest',
    'move:.旧版库/project.json', 'retire:.旧版库',
    'move:参考/same.md', 'move:参考/sub/same.md', 'retire:参考', 'copy:拆解', 'retire:拆解', 'copy:推演', 'retire:推演', 'copy:导出', 'retire:导出',
    'copy:.openstory/log/参考', 'retire:.openstory/log/参考',
    'copy:.openstory/drafts/推演', 'retire:.openstory/drafts/推演',
    'rewrite:.openstory/project.json', 'rewrite:故事源/book.wiki.json', 'rewrite:.openstory/ui-state.json',
    'write:upgrade.json', 'write:upgrade-log'
  ]
  let rollbackPass = 0
  const injectionMisses = []
  for (const failAt of injectionPoints) {
    const caseRoot = join(base, `injection-${injectionPoints.indexOf(failAt)}`)
    await legacyLibrary(caseRoot)
    const beforeInjection = await snapshot(caseRoot, true)
    const injected = await upgradeLibrary(caseRoot, { deps: { failAt } })
    if (injected.ok === false && injected.rolledBack === true && JSON.stringify(await snapshot(caseRoot, true)) === JSON.stringify(beforeInjection)) rollbackPass += 1
    else injectionMisses.push({ failAt, ok: injected.ok, phase: injected.phase, rolledBack: injected.rolledBack, message: injected.message })
  }
  check(`OS-224 ⑦ 失败注入 ${rollbackPass}/${injectionPoints.length} 均 rolledBack 且逐字节复原`, rollbackPass === injectionPoints.length, JSON.stringify(injectionMisses))

  const report = { ok: process.exitCode !== 1, root, checks: results, fakeUpstream: true, semanticModelVerified: false }
  await writeFile(join(base, 'report.json'), JSON.stringify(report, null, 2), 'utf8')
  console.log(JSON.stringify({ ok: report.ok, checks: results.length, passed: results.filter((item) => item.ok).length, report: join(base, 'report.json') }, null, 2))
} catch (error) {
  console.error(error?.stack || error)
  process.exitCode = 1
} finally {
  if (mcp) await mcp.close()
  if (daemon) await daemon.close()
  if (upstream) await new Promise((done) => { upstream.closeAllConnections?.(); upstream.close(() => done()) })
  if (!options.out) await rm(base, { recursive: true, force: true })
}
