/* OpenStory 批次编排器（CodeBuddy CLI 线，主 agent 只调度）
 *
 * 一条命令跑完一个计划里的全部批次：
 *   施工（CodeBuddy CLI，模型 deepseek-v4.1-flash）→ 五道门禁 → 提交 → 不过则返工（带失败输出重派）
 *
 * 用法：node D:/OpenStory/.zcode/os-batch-runner.mjs --plan <plan.json> --status <status.json> [--model deepseek-v4.1-flash] [--rounds 2]
 *
 * 契约：
 *   · 开工前工作树必须干净（不干净直接退出，不动任何文件）
 *   · 施工方不跑 git；提交由本编排器做（git add -A 在干净起点上是安全的）
 *   · 每步把状态写进 status.json（主 agent 只看这个文件）
 *   · 门禁红 → 生成返工工单（原工单 + 失败输出）重派，最多 rounds 轮；仍红则该批失败、计划中止
 */
import { spawnSync } from 'node:child_process'
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
process.chdir(REPO)

function arg(name, fallback) {
  const i = process.argv.indexOf('--' + name)
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback
}

const MODEL = arg('model', 'deepseek-v4.1-flash')
const PLAN = arg('plan')
const STATUS = arg('status')
const ROUNDS = Number(arg('rounds', '2'))
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
  batches: plan.batches.map((item) => ({ id: item.id, title: item.title, state: '排队', round: 0, gates: null, commit: '', note: '' })),
}
function save() {
  writeFileSync(STATUS, JSON.stringify(state, null, 2))
}
function note(id, patch) {
  const slot = state.batches.find((b) => b.id === id)
  if (slot) Object.assign(slot, patch)
  save()
}

function git(args) {
  return spawnSync('git', args, { cwd: REPO, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
}
function treeClean() {
  return (git(['status', '--porcelain']).stdout || '').trim() === ''
}
function run(cmd, args, timeoutMs) {
  const r = spawnSync(cmd, args, { cwd: REPO, encoding: 'utf8', timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}
function testSummary(out) {
  const m = /ℹ tests (\d+)[\s\S]*?ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)[\s\S]*?ℹ skipped (\d+)/.exec(out)
  return m ? `tests ${m[1]} · pass ${m[2]} · fail ${m[3]} · skip ${m[4]}` : '(没读到测试汇总)'
}
function tail(out, n = 2600) {
  return out.split('\n').filter((line) => /✖|not ok|AssertionError|Error:|fail \d|FAIL|✗/.test(line)).join('\n').slice(-n) || out.slice(-n)
}

/** 五道门禁：全量测试 / 验收 / 水浒 / 新建 / vendor 漂移。 */
function gates() {
  const dir = join(REPO, 'test')
  let files = []
  try {
    files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).map((f) => join('test', f))
  } catch {
    files = []
  }
  const tests = run(process.execPath, ['--test', ...files], 420_000)
  const acceptance = run(process.execPath, [join('tools', 'acceptance', 'acceptance.mjs')], 420_000)
  const shuihu = run(process.execPath, [join('scripts', 'verify-shuihu.mjs')], 900_000)
  const newproj = run(process.execPath, [join('scripts', 'verify-newproj.mjs')], 900_000)
  const vendor = run(process.execPath, [join('scripts', 'vendor-drift.mjs'), 'check'], 180_000)
  const ok = [tests, acceptance, shuihu, newproj, vendor].every((r) => r.code === 0)
  const summary = [
    '测试 ' + (tests.code === 0 ? '绿' : '红') + '（' + testSummary(tests.out) + '）',
    '门禁 ' + (acceptance.code === 0 ? '绿' : '红'),
    '水浒 ' + (shuihu.code === 0 ? '绿' : '红'),
    '新建 ' + (newproj.code === 0 ? '绿' : '红'),
    'vendor ' + (vendor.code === 0 ? '未动' : '被改'),
  ].join(' · ')
  const failed = [tests, acceptance, shuihu, newproj, vendor].filter((r) => r.code !== 0)
  return { ok, summary, failTail: failed.map((r) => tail(r.out)).join('\n─────\n') }
}

function dispatch(ticketPath, id, round) {
  const outFile = join(OUTDIR, `${id}-round${round}.json`)
  const started = Date.now()
  const r = spawnSync(process.execPath, [join(REPO, '.zcode', 'dispatch.mjs'), MODEL, ticketPath, outFile], {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 11_000_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, OS_REPO: REPO },
  })
  let parsed = null
  try {
    parsed = JSON.parse(readFileSync(outFile, 'utf-8'))
  } catch {
    parsed = { ok: r.status === 0, result: (r.stdout || '').slice(0, 4000), note: '结果文件读不到，取 stdout' }
  }
  return { ...parsed, durationMs: parsed.durationMs ?? Date.now() - started, exitCode: r.status }
}

function makeFixTicket(originalTicketPath, id, round, gate) {
  const text = readFileSync(originalTicketPath, 'utf-8')
  const path = join(OUTDIR, `fix-${id}-round${round}.md`)
  const body = [
    text,
    '',
    '## 上一轮门禁没过（第 ' + (round - 1) + ' 轮）',
    '',
    '门禁汇总：' + gate.summary,
    '',
    '失败输出（截尾）：',
    '```',
    gate.failTail,
    '```',
    '',
    '请先复现并定位失败原因，再动手修。**不许删除、skip 或放宽既有测试来凑绿**；门禁检查项只许更严。',
    '修完自己跑全量测试与 `node tools/acceptance/acceptance.mjs`，确认全绿再交回。',
  ].join('\n')
  writeFileSync(path, body)
  return path
}

function appLines() {
  const r = run(process.execPath, ['-e', "const{readFileSync}=require('node:fs');try{console.log(readFileSync('public/app.js','utf8').split('\\n').length)}catch(e){console.log('MISSING')}"], 60_000)
  return r.out.trim()
}

// ── 开工前：工作树必须干净 ──
if (!treeClean()) {
  state.finishedAt = new Date().toISOString()
  state.error = '开工前工作树不干净，未动任何文件：' + (git(['status', '--porcelain']).stdout || '').trim().split('\n').slice(0, 10).join(' / ')
  save()
  console.log(JSON.stringify({ ok: false, error: state.error }))
  process.exit(1)
}

for (const batch of plan.batches) {
  state.current = batch.id
  note(batch.id, { state: '施工中', round: 1, appBefore: appLines() })
  let ticket = batch.ticket
  let gate = null
  let outcome = null

  for (let round = 1; round <= ROUNDS; round++) {
    note(batch.id, { state: '施工中', round })
    outcome = dispatch(ticket, batch.id, round)
    note(batch.id, { state: '门禁中', lastReport: String(outcome.result || '').slice(0, 1500) })
    gate = gates()
    note(batch.id, { gates: gate.summary })
    if (gate.ok) break
    if (round < ROUNDS) {
      ticket = makeFixTicket(batch.ticket, batch.id, round + 1, gate)
      note(batch.id, { state: '返工' })
    }
  }

  const appAfter = appLines()
  note(batch.id, { appAfter })

  if (!gate || !gate.ok) {
    note(batch.id, { state: '失败', note: '门禁 ' + ROUNDS + ' 轮后仍红' })
    state.current = null
    state.finishedAt = new Date().toISOString()
    save()
    console.log(JSON.stringify({ ok: false, batch: batch.id, gates: gate?.summary ?? 'unknown' }))
    process.exit(1)
  }

  if (!treeClean()) {
    // 门禁绿但没提交 → 编排器提交（起点干净，这里加的全部是施工产物）
    const add = git(['add', '-A'])
    if (add.status !== 0) {
      note(batch.id, { state: '失败', note: 'git add 失败：' + (add.stderr || '').slice(0, 400) })
      process.exit(1)
    }
    const commit = git(['commit', '-m', batch.title])
    if (commit.status !== 0) {
      note(batch.id, { state: '失败', note: 'git commit 失败：' + ((commit.stderr || '') + (commit.stdout || '')).slice(0, 600) })
      process.exit(1)
    }
  }
  const head = (git(['rev-parse', '--short', 'HEAD']).stdout || '').trim()
  note(batch.id, { state: '完成', commit: head, dirtyAfterCommit: treeClean() ? '' : (git(['status', '--porcelain']).stdout || '').slice(0, 500) })
}

state.current = null
state.finishedAt = new Date().toISOString()
save()

const lines = [
  '# OpenStory 批次编排报告',
  '',
  '- 模型：' + MODEL,
  '- 开始：' + state.startedAt + '　结束：' + state.finishedAt,
  '',
  '| 批次 | 状态 | 轮次 | 提交 | 门禁 |',
  '|---|---|---|---|---|',
  ...state.batches.map((b) => '| ' + b.id + ' ' + b.title + ' | ' + b.state + ' | ' + b.round + ' | ' + (b.commit || '-') + ' | ' + (b.gates || '-') + ' |'),
]
writeFileSync(join(OUTDIR, 'summary.md'), lines.join('\n'))
console.log(JSON.stringify({ ok: state.batches.every((b) => b.state === '完成'), batches: state.batches.map((b) => b.id + ':' + b.state + ':' + b.commit) }))
