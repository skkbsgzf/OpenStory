/**
 * CLI 嫁接桥（OS-18）——把本地 CLI（CodeBuddy/Qoder/Claude…）当一次性「模型」用。
 *
 * 口径：daemon 每次对话 spawn 一次 CLI（batch 式，CLI 本身多为此形态），把
 * system 守则＋最近会话历史拼成单条 prompt 传进去（cliArgs 模板 {prompt} 占位），
 * 收 stdout 整段回给上层（上层以 OpenAI 兼容 SSE 一片回吐）。超时 kill，输出空如实报。
 * OpenDesign 用 sidecar 长驻；这类 CLI 没有服务面，嫁接＝一次性子进程。
 */
import { spawn } from 'node:child_process'

function text(value) {
  return String(value ?? '')
}

/** 把 OpenAI 风格 messages 拼成 CLI 单条 prompt（system 在前、历史顺排）。 */
export function composeCliPrompt(messages) {
  const lines = []
  for (const message of Array.isArray(messages) ? messages : []) {
    const role = text(message?.role).trim()
    const content = text(message?.content)
    if (!content.trim()) continue
    if (role === 'system') lines.push(content.trim())
    else if (role === 'assistant') lines.push(`【助手】${content.trim()}`)
    else lines.push(`【作者】${content.trim()}`)
  }
  return lines.join('\n\n')
}

/** cliArgs 模板 → 实际 argv（{prompt} 占位替换；其余原样）。 */
export function buildCliArgs(cliArgs, prompt) {
  const template = Array.isArray(cliArgs) && cliArgs.length ? cliArgs : ['-p', '{prompt}']
  const args = template.map((arg) => text(arg).replaceAll('{prompt}', prompt))
  // 模板里没有 {prompt} 占位＝prompt 走 stdin（如 `cat` 类工具）
  return { args, useStdin: !template.some((arg) => text(arg).includes('{prompt}')) }
}

/**
 * 跑一次 CLI 对话。返回 {ok:true, text} 或 {ok:false, message}。
 * shell:false；超时 kill 整棵进程树（Windows 用 taskkill /T）；stdout+stderr 合并取内容。
 */
export async function runCliChat(kit, messages) {
  const prompt = composeCliPrompt(messages)
  if (!prompt.trim()) return { ok: false, message: 'CLI 嫁接：对话内容为空' }
  const { args, useStdin } = buildCliArgs(kit.cliArgs, prompt)
  const timeoutMs = Number(kit.timeoutMs) > 0 ? Number(kit.timeoutMs) : 120000
  return new Promise((resolvePromise) => {
    let child
    let settled = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise(result)
    }
    const timer = setTimeout(() => {
      killTree(child)
      finish({ ok: false, message: `CLI 超时（${Math.round(timeoutMs / 1000)}s）：${kit.probe?.cmd ?? kit.id}` })
    }, timeoutMs)
    try {
      child = spawn(kit.probe.cmd, args, { shell: false, stdio: [useStdin ? 'pipe' : 'ignore', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ ok: false, message: `CLI 起不来：${text(error?.message || error)}` })
      return
    }
    let out = ''
    child.stdout?.on('data', (chunk) => { out += chunk })
    child.stderr?.on('data', (chunk) => { out += chunk })
    child.on('error', (error) => finish({ ok: false, message: `CLI 起不来：${text(error?.message || error)}` }))
    child.on('exit', (code) => {
      const body = out.trim()
      if (code !== 0) {
        finish({ ok: false, message: `CLI 退出码 ${code}${body ? `：${body.slice(0, 300)}` : ''}` })
        return
      }
      if (!body) {
        finish({ ok: false, message: 'CLI 无输出（退出码 0 但 stdout/stderr 都空）' })
        return
      }
      finish({ ok: true, text: body })
    })
    if (useStdin) {
      try {
        child.stdin?.end(prompt)
      } catch { /* stdin 已关 */ }
    }
  })
}

function killTree(child) {
  if (!child?.pid) return
  try {
    if (process.platform === 'win32') {
      spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { shell: false, stdio: 'ignore' })
    } else {
      child.kill('SIGKILL')
    }
  } catch { /* 已经死了 */ }
}
