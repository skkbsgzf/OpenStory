/* OpenStory 批次编排器 v2（CodeBuddy CLI 线，主 agent 只调度）
 *
 * 一条命令跑完一个计划里的全部工单：
 *   施工（CodeBuddy CLI）→ 范围检查 → 五道门禁 → 红线测试 → 不过则返工（带失败输出重派）→ 提交 → 施工回报归档进工单
 *
 * 用法：node .zcode/os-batch-runner.mjs --plan <plan.json> --status <status.json> [--model deepseek-v4.1-flash] [--rounds 2]
 *       node .zcode/os-batch-runner.mjs --scope-selftest      （只验范围匹配逻辑，不派发）
 *
 * plan.json：
 *   { "batches": [{
 *       "id": "OS-148",
 *       "title": "提交标题",
 *       "ticket": "D:/OpenStory/docs/workorders/OS-148-xxx.md",   // 工单（在仓内则施工回报会归档进它）
 *       "allow": ["src/**", "public/**", "test/**", "AGENTS.md"],   // 允许改动范围（越界＝返工）
 *       "mustPass": ["test/tabRegistry.test.mjs"],                  // 红线测试（逐个报告）
 *       "rules": "D:/.../rules.md"                                  // 可选：替换派发头部的「项目硬约束」
 *   }] }
 *
 * 硬闸：
 *   · 开工前工作树必须干净、编排器自身无未提交改动、全量测试基线绿；
 *   · 改动文件必须落在 allow 内；package.json 的版本与依赖不许动；core/**、vendor/** 默认不许动（除非 allow 写明）；
 *   · 疑似临时文件（点开头、probe、.tmp、.bak、~结尾）即使落在 allow 内也不许提交；
 *   · 施工方不跑 git；提交由本编排器做（起点干净，且已做范围检查，所以 git add -A 是安全的）；
 *   · 两轮后仍红或仍越界＝停线，不提交，留给主 agent。
 */
import { spawn, spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
const SELF = ['.zcode/os-batch-runner.mjs', '.zcode/dispatch.mjs']
process.chdir(REPO)

function arg(name, fallback) {
  const index = process.argv.indexOf('--' + name)
  return index > 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

const MODEL = arg('model', 'deepseek-v4.1-flash')
const PLAN = arg('plan')
const STATUS = arg('status')
const ROUNDS = Number(arg('rounds', '2'))
const PROBE_PATTERN = /(^|\/)\.[^/]+$|probe|\.tmp$|\.bak$|~$/

/* ---------- 范围匹配 ---------- */

/** 路径通配：`**` 匹配任意多段，`*` 匹配一段内任意字符，其余按字面。 */
export function globToRegExp(pattern) {
  let source = '^'
  for (let i = 0; i < pattern.length; i += 1) {
    const ch = pattern[i]
    if (ch === '*') {
      if (pattern[i + 1] === '*') {
        source += '.*'
        i += 1
        if (pattern[i + 1] === '/') i += 1
      } else {
        source += '[^/]*'
      }
    } else {
      source += /[.*+?^${}()|[\]\\]/.test(ch) ? '\\' + ch : ch
    }
  }
  return new RegExp(source + '$')
}

function allowedBy(path, allow) {
  return allow.some((pattern) => globToRegExp(pattern).test(path))
}

function scopeSelfTest() {
  const cases = [
    ['src/**', 'src/kernel/a.mjs', true],
    ['src/**', 'src/a/b/c.js', true],
    ['src/**', 'public/src/a.mjs', false],
    ['src/**/*.mjs', 'src/a/b.mjs', true],
    ['src/**/*.mjs', 'src/a/b.js', false],
    ['AGENTS.md', 'AGENTS.md', true],
    ['AGENTS.md', 'docs/AGENTS.md', false],
    ['runtimes/echo-kit/manifest.json', 'runtimes/echo-kit/manifest.json', true],
    ['runtimes/echo-kit/manifest.json', 'runtimes/echo-kit/server.mjs', false],
    ['docs/**', 'docs/workorders/OS-148 命名.md', true],
    ['package.json', 'package.json', true],
    ['tools/acceptance/**', 'tools/acceptance/acceptance.mjs', true],
  ]
  let failed = 0
  for (const [pattern, path, expected] of cases) {
    const actual = allowedBy(path, [pattern])
    if (actual !== expected) { failed += 1; console.log('FAIL', pattern, path, 'expected', expected, 'got', actual) }
  }
  const probes = ['public/.os147probe.mjs', 'src/x.probe.mjs', 'a/b.tmp', 'c.bak', 'd~', 'src/ok.mjs', 'test/naming.test.mjs']
  for (const file of probes) console.log('probe?', file, PROBE_PATTERN.test(file))
  console.log(failed === 0 ? 'scope selftest ok' : 'scope selftest FAILED ' + failed)
  process.exit(failed === 0 ? 0 : 1)
}
if (process.argv.includes('--scope-selftest')) scopeSelfTest()

/* ---------- 基础设施 ---------- */

if (!PLAN || !STATUS) {
  console.log(JSON.stringify({ ok: false, error: '用法：--plan <plan.json> --status <status.json>' }))
  process.exit(2)
}
const OUTDIR = dirname(STATUS)
mkdirSync(OUTDIR, { recursive: true })

const plan = JSON.parse(readFileSync(PLAN, 'utf-8'))
const state = {
  model: MODEL,
  startedAt: new Date().toISOString(),
  finishedAt: null,
  current: null,
  error: null,
  batches: plan.batches.map((item) => ({
    id: item.id, title: item.title, state: '排队', round: 0, gates: null, redLines: null, outOfScope: [], commit: '', note: '', appBefore: '', appAfter: '', lastReport: ''
  })),
}
function note(id, patch) {
  const slot = state.batches.find((item) => item.id === id)
  if (slot) Object.assign(slot, patch)
  save()
}
function save() {
  writeFileSync(STATUS, JSON.stringify(state, null, 2))
}

function git(args) {
  return spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
}
function treeClean() {
  return changedPaths().length === 0
}
function run(cmd, args, timeoutMs) {
  const result = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  return { code: result.status, out: (result.stdout || '') + (result.stderr || '') }
}
function tail(text, limit = 2600) {
  const noisy = text.split('\n').filter((line) => /✖|not ok|AssertionError|Error:|fail \d|FAIL|✗/.test(line)).join('\n')
  return (noisy || text).slice(-limit)
}

/** 改动路径（含改名前后的两个路径），去重。 */
function changedPaths() {
  const parts = (git(['status', '--porcelain=v1', '-z']).stdout || '').split('\0')
  const paths = []
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (!entry) continue
    const code = entry.slice(0, 2)
    paths.push(entry.slice(3))
    if (code[0] === 'R' || code[0] === 'C') i += 1 // 改名的源路径在下一项
  }
  return [...new Set(paths)]
}

function untrackedPaths() {
  const parts = (git(['status', '--porcelain=v1', '-z']).stdout || '').split('\0')
  const paths = []
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i]
    if (!entry) continue
    if (entry.slice(0, 2) === '??') paths.push(entry.slice(3))
    if (entry[0] === 'R' || entry[0] === 'C') i += 1
  }
  return paths
}

function packageFingerprint() {
  const pkg = JSON.parse(readFileSync(join(REPO, 'package.json'), 'utf-8'))
  return JSON.stringify({
    version: pkg.version,
    dependencies: pkg.dependencies ?? null,
    devDependencies: pkg.devDependencies ?? null,
    optionalDependencies: pkg.optionalDependencies ?? null,
    peerDependencies: pkg.peerDependencies ?? null,
  })
}

/* ---------- daemon（两条 e2e 门禁要连它） ---------- */

function daemonHealthy() {
  const probe = run(process.execPath, ['-e', "fetch('http://127.0.0.1:8807/api/health',{signal:AbortSignal.timeout(3000)}).then(function(r){process.exit(r.ok?0:1)}).catch(function(){process.exit(1)})"], 20_000)
  return probe.code === 0
}

/** 坑（2026-11-24 实录）：daemon 挂在宿主进程树下，宿主一退就跟着死，门禁于是报「水浒红／新建红」——看着像代码坏了。
 *  所以门禁前先自检，不在就拉起来，并把「重启过」写进门禁汇总（不静默）。 */
function ensureDaemon() {
  if (daemonHealthy()) return 'daemon 在跑'
  try {
    const child = spawn(process.execPath, ['daemon.mjs', '--port=8807'], { cwd: REPO, detached: true, stdio: 'ignore' })
    child.unref()
  } catch (error) {
    return 'daemon 拉不起来：' + String(error?.message || error)
  }
  for (let i = 0; i < 20; i += 1) {
    spawnSync(process.execPath, ['-e', 'setTimeout(function(){},300)'], { timeout: 5000 })
    if (daemonHealthy()) return 'daemon 曾掉线，已重启'
  }
  return 'daemon 重启后仍不健康（两条 e2e 门禁会红）'
}

/* ---------- 门禁 ---------- */

function testFiles() {
  try {
    return readdirSync(join(REPO, 'test')).filter((name) => name.endsWith('.test.mjs')).map((name) => join('test', name)).sort()
  } catch {
    return []
  }
}
function testSummary(out) {
  const match = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)[\s\S]*?ℹ skipped (\d+)/.exec(out)
  return match ? `tests ${match[1]} · pass ${match[2]} · fail ${match[3]} · skip ${match[4]}` : '(没读到测试汇总)'
}

/** 五道门禁：全量测试 / 验收 / 水浒 / 新建 / vendor 漂移。
 *  坑（2026-11-24 实录，第二条）：daemon 常驻，改了 src/ 不重启，两条 e2e 门禁会对着**旧进程**跑出假绿
 *  （OS-150a 踩过：新脚本期望 FACT_EMPTY、旧进程回 INVALID_ENTRY，编排器却报「新建绿」）。
 *  所以本批改动碰到后端时先重启 daemon 再跑门禁，并把「重启过」写进门禁汇总。 */
function restartDaemon(reason) {
  const probe = run(process.execPath, ['-e', "fetch('http://127.0.0.1:8807/api/health',{signal:AbortSignal.timeout(3000)}).then(r=>r.json()).then(d=>{console.log(String(d.pid||''))}).catch(function(){console.log('')})"], 20_000)
  const pid = probe.out.trim()
  if (pid) spawnSync('taskkill', ['/PID', pid, '/F'], { encoding: 'utf8', timeout: 20_000 })
  spawnSync(process.execPath, ['-e', 'setTimeout(function(){},1200)'], { timeout: 8000 })
  try {
    const child = spawn(process.execPath, ['daemon.mjs', '--port=8807'], { cwd: REPO, detached: true, stdio: 'ignore' })
    child.unref()
  } catch (error) {
    return 'daemon 重启失败：' + String(error?.message || error)
  }
  for (let i = 0; i < 30; i += 1) {
    spawnSync(process.execPath, ['-e', 'setTimeout(function(){},300)'], { timeout: 5000 })
    if (daemonHealthy()) return 'daemon 已重启（' + reason + '）'
  }
  return 'daemon 重启后仍不健康（' + reason + '）'
}

/** 本批改动碰没碰后端（碰了就必须重启 daemon 再跑 e2e 门禁）。 */
function needsDaemonRestart() {
  return changedPaths().some((path) => path.startsWith('src/') || path.startsWith('contracts/') || path === 'daemon.mjs' || path === 'mcp.mjs')
}

function gates(options = {}) {
  const daemonNote = options.restartDaemon ? restartDaemon(options.reason || '本批改了后端') : ensureDaemon()
  const tests = run(process.execPath, ['--test', ...testFiles()], 420_000)
  const acceptance = run(process.execPath, [join('tools', 'acceptance', 'acceptance.mjs')], 420_000)
  const shuihu = run(process.execPath, [join('scripts', 'verify-shuihu.mjs')], 900_000)
  const newproj = run(process.execPath, [join('scripts', 'verify-newproj.mjs')], 900_000)
  const vendor = run(process.execPath, [join('scripts', 'vendor-drift.mjs'), 'check'], 180_000)
  const ok = [tests, acceptance, shuihu, newproj, vendor].every((item) => item.code === 0)
  const summary = [
    '测试 ' + (tests.code === 0 ? '绿' : '红') + '（' + testSummary(tests.out) + '）',
    '门禁 ' + (acceptance.code === 0 ? '绿' : '红'),
    '水浒 ' + (shuihu.code === 0 ? '绿' : '红'),
    '新建 ' + (newproj.code === 0 ? '绿' : '红'),
    'vendor ' + (vendor.code === 0 ? '未动' : '被改'),
    daemonNote,
  ].join(' · ')
  const failed = [tests, acceptance, shuihu, newproj, vendor].filter((item) => item.code !== 0)
  return { ok, summary, failTail: failed.map((item) => tail(item.out)).join('\n─────\n') }
}

/** 红线测试：工单点名的测试文件逐个跑、逐个报。 */
function redLines(files) {
  const rows = []
  for (const file of files || []) {
    const result = run(process.execPath, ['--test', file], 300_000)
    rows.push(file + ' ' + (result.code === 0 ? '绿' : '红') + '（' + testSummary(result.out) + '）')
  }
  return rows
}

/* ---------- 范围检查 ---------- */

/** 返回越界与违规清单；空数组＝通过。 */
function scopeProblems(batch, packageBefore) {
  const problems = []
  const allow = [...(batch.allow || []), batch.ticket ? relative(REPO, batch.ticket).split('\\').join('/') : '']
  for (const path of changedPaths()) {
    if (!allowedBy(path, allow)) problems.push('越界：' + path + '（不在本单允许范围内）')
  }
  for (const path of untrackedPaths()) {
    const exempt = /^\.?(gitignore|gitattributes|editorconfig)$|^\.(ua|zcode|github)\//
    if (PROBE_PATTERN.test(path) && !exempt.test(path)) problems.push('疑似临时文件：' + path + '（不许提交）')
  }
  if (packageFingerprint() !== packageBefore) problems.push('package.json 的版本或依赖被改了（只许动 scripts）')
  return [...new Set(problems)]
}

/* ---------- 派发 ---------- */

function dispatch(batch, ticketPath, round) {
  const outFile = join(OUTDIR, `${batch.id}-round${round}.json`)
  const args = [join(REPO, '.zcode', 'dispatch.mjs'), MODEL, ticketPath, outFile]
  if (batch.rules) args.push(batch.rules)
  const started = Date.now()
  const result = spawnSync(process.execPath, args, { cwd: REPO, encoding: 'utf8', timeout: 11_000_000, maxBuffer: 64 * 1024 * 1024, env: { ...process.env, OS_REPO: REPO } })
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(outFile, 'utf-8'))
  } catch {
    parsed = { ok: result.status === 0, result: (result.stdout || '').slice(0, 4000), note: '结果文件读不到，取 stdout' }
  }
  return { ...parsed, durationMs: parsed.durationMs ?? Date.now() - started, exitCode: result.status }
}

function makeFixTicket(originalPath, id, round, gate, problems) {
  const lines = [readFileSync(originalPath, 'utf-8'), '', '## 上一轮没过（第 ' + (round - 1) + ' 轮）', '']
  if (problems.length) {
    lines.push('范围检查没过：', '', ...problems.map((item) => '- ' + item), '',
      '处理办法：不属于本单的改动请还原（已跟踪的文件恢复成 HEAD 的内容，未跟踪的删掉）；确属本单必须改的，在交付说明的 LIMITATIONS 里逐个说明理由。', '')
  }
  if (gate && !gate.ok) {
    lines.push('门禁汇总：' + gate.summary, '', '失败输出（截尾）：', '```', gate.failTail, '```', '',
      '请先复现并定位失败原因，再动手修。**不许删除、skip 或放宽既有测试来凑绿**；门禁检查项只许更严。')
  }
  lines.push('', '修完自己跑全量测试与 `node tools/acceptance/acceptance.mjs`，确认全绿再交回。')
  const path = join(OUTDIR, `fix-${id}-round${round}.md`)
  writeFileSync(path, lines.join('\n'))
  return path
}

/** 施工回报归档进工单（工单在仓内时）；只保留最后一轮。 */
function appendReport(batch, round, gate, outcome) {
  if (!batch.ticket) return
  const rel = relative(REPO, batch.ticket)
  if (!rel || rel.startsWith('..')) return
  const marker = '\n## 施工回报（编排器自动归档）'
  let doc = readFileSync(batch.ticket, 'utf-8').replace(/\r\n/g, '\n')
  const at = doc.indexOf(marker)
  if (at >= 0) {
    const next = doc.indexOf('\n## 验收记录', at)
    doc = next >= 0 ? doc.slice(0, at) + doc.slice(next) : doc.slice(0, at)
  } else {
    const tailHeading = doc.indexOf('\n## 验收记录')
    doc = tailHeading >= 0 ? doc.slice(0, tailHeading) : doc.replace(/\s*$/, '')
  }
  const text = String(outcome.result || '').replace(/```/g, "'''").slice(0, 6000)
  const block = marker + '\n\n> 模型 ' + MODEL + ' · 第 ' + round + ' 轮 · ' + (gate ? gate.summary : '未到门禁') + '\n\n```text\n' + text + '\n```\n'
  doc = doc.indexOf('\n## 验收记录') >= 0 ? doc.replace('\n## 验收记录', block + '\n## 验收记录') : doc + block
  writeFileSync(batch.ticket, doc)
}

function appLines() {
  const result = run(process.execPath, ['-e', "const{readFileSync}=require('node:fs');try{console.log(readFileSync('public/app.js','utf8').split('\\n').length-1)}catch(e){console.log('MISSING')}"], 60_000)
  return result.out.trim()
}

/* ---------- 主流程 ---------- */

const packageBefore = packageFingerprint()
if (!treeClean()) {
  state.error = '开工前工作树不干净，未动任何文件：' + changedPaths().slice(0, 10).join(' / ')
  finish(false, state.error)
}
if (changedPaths().some((path) => SELF.includes(path))) {
  state.error = '编排器自身有未提交改动，先提交再开工：' + changedPaths().filter((path) => SELF.includes(path)).join(' / ')
  finish(false, state.error)
}
{
  const baseline = run(process.execPath, ['--test', ...testFiles()], 420_000)
  if (baseline.code !== 0) {
    state.error = '开工前全量测试基线是红的：' + testSummary(baseline.out) + '\n' + tail(baseline.out)
    finish(false, state.error)
  }
  state.baseline = testSummary(baseline.out)
  save()
}

function finish(ok, message) {
  state.current = null
  state.finishedAt = new Date().toISOString()
  save()
  const rows = [
    '# 批次编排报告', '', '- 模型：' + MODEL, '- 开始：' + state.startedAt + '　结束：' + state.finishedAt, '',
    '| 工单 | 状态 | 轮次 | 提交 | 门禁 |', '|---|---|---|---|---|',
    ...state.batches.map((item) => '| ' + item.id + ' ' + item.title + ' | ' + item.state + ' | ' + item.round + ' | ' + (item.commit || '-') + ' | ' + (item.gates || '-') + ' |'),
  ]
  writeFileSync(join(OUTDIR, 'summary.md'), rows.join('\n'))
  console.log(JSON.stringify({ ok, message: message || '', batches: state.batches.map((item) => item.id + ':' + item.state + ':' + item.commit) }))
  process.exit(ok ? 0 : 1)
}

for (const batch of plan.batches) {
  state.current = batch.id
  note(batch.id, { state: '施工中', round: 1, appBefore: appLines() })
  let ticket = batch.ticket
  let gate = null
  let problems = []
  let outcome = null

  for (let round = 1; round <= ROUNDS; round += 1) {
    note(batch.id, { state: '施工中', round })
    outcome = dispatch(batch, ticket, round)
    note(batch.id, { state: '检查中', lastReport: String(outcome.result || '').slice(0, 2500) })
    problems = scopeProblems(batch, packageBefore)
    gate = problems.length ? { ok: false, summary: '范围检查未过，门禁未跑', failTail: '' } : gates({ restartDaemon: needsDaemonRestart(), reason: batch.id + ' 改了后端' })
    note(batch.id, { gates: gate.summary, outOfScope: problems, redLines: problems.length ? [] : redLines(batch.mustPass) })
    if (gate.ok) break
    if (round < ROUNDS) {
      ticket = makeFixTicket(batch.ticket, batch.id, round + 1, problems.length ? null : gate, problems)
      note(batch.id, { state: '返工' })
    }
  }

  note(batch.id, { appAfter: appLines() })
  if (!gate || !gate.ok) {
    note(batch.id, { state: problems.length ? '停线' : '失败', note: problems.length ? '仍有越界或违规改动，未提交' : '门禁 ' + ROUNDS + ' 轮后仍红，未提交' })
    finish(false, batch.id + ' 未通过：' + (problems[0] || gate.summary))
  }

  appendReport(batch, state.batches.find((item) => item.id === batch.id).round, gate, outcome)
  git(['add', '-A', '--', '.', ...SELF.map((file) => ':(exclude)' + file)])
  if (git(['diff', '--cached', '--quiet']).status === 0) {
    note(batch.id, { state: '失败', note: '施工方没有任何改动' })
    finish(false, batch.id + ' 没有任何改动')
  }
  const commit = git(['commit', '-m', batch.title])
  if (commit.status !== 0) {
    note(batch.id, { state: '失败', note: 'git commit 失败：' + ((commit.stderr || '') + (commit.stdout || '')).slice(0, 600) })
    finish(false, batch.id + ' 提交失败')
  }
  note(batch.id, { state: '待验收', commit: (git(['rev-parse', '--short', 'HEAD']).stdout || '').trim() })
}

finish(true)
