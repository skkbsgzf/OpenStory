/* OpenStory 工单派发器（OS-73 workflow 专用）
 *
 * 为什么不用 workflow 的 agent()：CodeBuddy CLI 是外部进程，agent() 只能调本机 provider。
 * 所以子 agent 走 world.run 派发到 CodeBuddy CLI（模型由参数指定）。
 *
 * 契约：
 *   node .zcode/dispatch.mjs <model> <ticketFile> <outFile>
 *   model：hy4-preview（写实现）/ deepseek-v4.1-flash（快验/小改）
 *   ticketFile：一段 markdown 工单（角色/任务/约束/交付物/验收）
 *   outFile：结果 JSON（{ ok, result, durationMs, log, limitations }）
 * stdout：只输出一行紧凑 JSON（world.run 的 stdout 有上限，进度全落日志文件）
 */
import { spawn } from 'node:child_process'
import { readFileSync, writeFileSync, writeSync, openSync, closeSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

const CODEBUDDY = 'C:/Users/Administrator/AppData/Roaming/npm/codebuddy.cmd'
const REPO = process.env.OS_REPO || 'D:/OpenStory'

const model = process.argv[2]
const ticketFile = process.argv[3]
const outFile = process.argv[4]
if (!model || !ticketFile || !outFile) {
  console.log(JSON.stringify({ ok: false, error: '用法：node dispatch.mjs <model> <ticketFile> <outFile>' }))
  process.exit(2)
}

let ticket = ''
try { ticket = readFileSync(ticketFile, 'utf-8') } catch (error) {
  console.log(JSON.stringify({ ok: false, error: `工单读不到：${error.message}` }))
  process.exit(2)
}

const logPath = resolve(dirname(outFile), `cb-${Date.now()}.log`)
mkdirSync(dirname(logPath), { recursive: true })

// 可选第 5 参数（argv[5]，前三个是 model / ticket / out）：规则文件。给了就用它的内容替换下面的「项目硬约束」（段 B 内核自有化那类
// 需要放行 core/ 迁出的工单用）；没给走默认。交付纪律一段不受影响。
const rulesFile = process.argv[5]
const DEFAULT_RULES = [
  '1. core/pinax/** 是逐字 vendor 的内核，一个字都不能改。',
  '2. 零 npm 依赖：不许加 package.json 依赖，不许 import 第三方库（前端 ECharts 走本地 vendor 单文件，见工单说明）。',
  '3. daemon 只监听 127.0.0.1；凭据只存本机且响应只回掩码。',
  '4. 功能模块间禁止直接 import——只经 src/api/contracts.mjs / src/protocol/chapters.mjs 协议层与 vendor 内核（OS-140 布局归一后自持模块在 src/ 六目录）。',
  '5. 前端颜色必须走 CSS 令牌（public/index.html 的 :root）；令牌区外禁止裸色值。',
  '6. 侧栏是绝对定位浮层，禁止挤压正文（OS-48 宪法）。'
]
const hardRules = rulesFile
  ? readFileSync(rulesFile, 'utf-8').split(/\r?\n/).filter((line, index, all) => line.trim() !== '' || (index > 0 && index < all.length - 1))
  : DEFAULT_RULES

const prompt = [
  '你是 OpenStory 的实现工程师，在 D:/OpenStory 仓库工作。',
  '',
  '项目硬约束（违反即返工）：',
  ...hardRules,
  '',
  '交付纪律：',
  '- 只改工单允许的文件；改动必须落在工单「允许改动」范围内，范围外的文件一个都不要动。',
  '- 临时探针、调试脚本用完必须删，不许留在仓里。',
  '- 不执行任何 git 命令（不 add/commit/push）。',
  '- 不启动、不杀 daemon 进程。',
  '- 改完自己跑门禁：node tools/acceptance/acceptance.mjs（检查项必须全过）。',
  '- 做不到的、有疑问的，写进结果最后一节「limitations」，不要假装完成。',
  '',
  '=== 工单开始 ===',
  ticket,
  '=== 工单结束 ===',
  '',
  '完成后请用如下格式回复（不要多余内容）：',
  'CHANGED: 逐个列出你改/新建的文件路径',
  'VERIFIED: 你实际跑了什么命令、结果如何',
  'LIMITATIONS: 没做到或不确定的地方（没有就写「无」）'
].join('\n')

const started = Date.now()
const logFd = openSync(logPath, 'w')
const child = spawn(CODEBUDDY, [
  '-p',
  '--model', model,
  '--output-format', 'json',
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
  // CodeBuddy 的 json 输出是数组：[{type:"result", subtype:"success", result:"<最终文本>", ...}]
  let parsed = null
  try {
    const all = JSON.parse(stdout.trim())
    const arr = Array.isArray(all) ? all : [all]
    parsed = arr.find((x) => x && (x.type === 'result' || typeof x.result === 'string')) ?? arr[arr.length - 1] ?? null
  } catch {
    // 兜底：逐行找 JSON
    const lines = stdout.split('\n').map((line) => line.trim()).filter(Boolean)
    for (const line of lines.reverse()) {
      if (!line.startsWith('{') && !line.startsWith('[')) continue
      try { const v = JSON.parse(line); parsed = Array.isArray(v) ? v.find((x) => x?.result) : v; break } catch { /* 继续 */ }
    }
  }
  const text = String(parsed?.result ?? parsed?.content ?? '').trim()
  const result = {
    ok: code === 0 && parsed?.is_error !== true,
    model,
    exitCode: code,
    result: text.slice(0, 8000),
    durationMs,
    log: logPath,
    ...(parsed?.is_error ? { error: text.slice(0, 800) } : {}),
    ...(stderr.trim() ? { stderr: stderr.trim().slice(0, 1200) } : {})
  }
  try { writeFileSync(outFile, JSON.stringify(result, null, 2)) } catch { /* 写不出不影响 stdout */ }
  console.log(JSON.stringify({ ok: result.ok, model, exitCode: code, durationMs, log: logPath, result: result.result.slice(0, 1200) }))
})
