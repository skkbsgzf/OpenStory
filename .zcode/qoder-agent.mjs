/* Qoder 子 agent 派发器（OS-61 workflow 专用）
 *
 * 为什么不让 workflow 的 agent() 直接跑：workflow 的 subagent_model 只能选本机 provider
 * 的模型；Qoder 是外部 CLI，所以子 agent 走 world.run 派发到 Qoder CLI（模型 Qwen4-Max）。
 *
 * 契约（供 workflow 脚本调用）：
 *   node .zcode/qoder-agent.mjs <ticketFile> <outFile>
 *   ticketFile：一段 markdown 工单（角色/任务/约束/交付物）
 *   outFile：结果 JSON（{ ok, result, durationMs, log }）
 * stdout：**只输出一行紧凑 JSON**（world.run 的 stdout 有上限，进度全落日志文件）
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, writeSync, openSync, closeSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const QODER = 'C:/Users/Administrator/.qoder/entry/qoder.cmd'
const MODEL = process.env.QODER_MODEL || 'Qwen4-Max'
const REPO = process.env.QODER_REPO || 'D:/OpenStory'

const ticketFile = process.argv[2]
const outFile = process.argv[3]
if (!ticketFile || !outFile) {
  console.log(JSON.stringify({ ok: false, error: '用法：node qoder-agent.mjs <ticketFile> <outFile>' }))
  process.exit(2)
}

let ticket = ''
try { ticket = readFileSync(ticketFile, 'utf-8') } catch (error) {
  console.log(JSON.stringify({ ok: false, error: `工单读不到：${error.message}` }))
  process.exit(2)
}

const logPath = resolve(dirname(outFile), `qoder-${Date.now()}.log`)
mkdirSync(dirname(logPath), { recursive: true })

const prompt = [
  '你是 OpenStory 的实现工程师，在 D:/OpenStory 仓库工作。',
  '严格按工单执行；只改工单允许的文件；不执行 git 命令；不启动服务。',
  '做不到的写进 limitations，不要假装完成。',
  '',
  '=== 工单开始 ===',
  ticket,
  '=== 工单结束 ==='
].join('\n')

const started = Date.now()
const logFd = openSync(logPath, 'w')
const child = spawn(QODER, [
  '-p',
  '--model', MODEL,
  '--output-format', 'json',
  '--no-session-persistence',
  '--dangerously-skip-permissions'
], { cwd: REPO, stdio: ['pipe', 'pipe', 'pipe'], shell: true, timeout: 10_800_000 })

let stdout = ''
let stderr = ''
child.stdout.on('data', (chunk) => { stdout += chunk; writeSync(logFd, chunk) })
child.stderr.on('data', (chunk) => { stderr += chunk; writeSync(logFd, chunk) })
child.stdin.write(prompt)
child.stdin.end()

child.on('close', (code) => {
  try { closeSync(logFd) } catch { /* 已关 */ }
  const durationMs = Date.now() - started
  // Qoder 的 json 输出是单发 {"type":"result",...,"result":"<最终文本>"}
  let parsed = null
  const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
  for (const line of lines.reverse()) {
    if (!line.startsWith('{')) continue
    try { parsed = JSON.parse(line); break } catch { /* 继续找 */ }
  }
  const result = {
    ok: code === 0 && parsed?.is_error !== true,
    exitCode: code,
    result: String(parsed?.result ?? '').trim(),
    durationMs,
    turns: parsed?.num_turns ?? null,
    log: logPath,
    ...(parsed?.is_error ? { error: String(parsed?.result ?? '').slice(0, 500) } : {}),
    ...(stderr.trim() ? { stderr: stderr.trim().slice(0, 800) } : {})
  }
  try {
    mkdirSync(dirname(outFile), { recursive: true })
    writeFileSync(outFile, JSON.stringify(result, null, 2))
  } catch { /* 写不出也不影响 stdout */ }
  // stdout 只留一行紧凑 JSON
  console.log(JSON.stringify(result))
})
