/**
 * DSH stdio 桥（OS-19）——照 @open-design/dsh-runtime 的协议直连本地 `dsh` CLI。
 *
 * 协议（od 的 open-design-dsh-runtime-0.1.0，已从 tgz 解包逆向）：
 *   dsh --profile <p> --stdio          ← 起一个短进程（一 run 一进程）
 *   → {"v":1,"type":"ready",...}       ← 插件就绪帧
 *   发  {"v":1,"type":"execute","request_id","cwd","prompt","mcp_servers":[],"resume_session_id"?,"model"?}
 *   收  {"type":"session","session_id"...} → {"type":"text","content"}*
 *       → {"type":"thinking"}* / {"type":"tool_call"|"tool_result"|"usage"}*
 *       → {"type":"result","status":"completed|cancelled|failed","session_id","output"?,"error"?}
 *
 * 一进程一次 execute（od 同口径：协议进程只接受一个 execute 命令）；
 * 会话续接靠 Harness 自己的会话存储（resume_session_id）。
 * 取消＝kill 子进程（进程即 run）；超时同理。
 */
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'


/** Windows：.cmd/.bat 不能直接 spawn（shell:false）——用 cmd /c 包一层；其余原样。 */
export function spawnCommand(cmd, args, options = {}) {
  const raw = String(cmd ?? '')
  if (process.platform === 'win32' && /.(?:cmd|bat)$/iu.test(raw)) {
    return spawn('cmd', ['/c', raw, ...args], options)
  }
  return spawn(raw, args, options)
}

function text(value) {
  return String(value ?? '')
}

/** 每帧 JSONL 解析：返回 {ok, frame} 或 {ok:false}（坏行丢弃不伪造）。 */
export function parseDshFrame(line) {
  const raw = text(line).trim()
  if (!raw) return { ok: false }
  try {
    const frame = JSON.parse(raw)
    if (!frame || typeof frame !== 'object') return { ok: false }
    return { ok: true, frame }
  } catch {
    return { ok: false }
  }
}

/** 从 DSH 帧流里抽正文文本（text 帧）。 */
export function dshFrameText(frame) {
  if (!frame || frame.type !== 'text') return ''
  return text(frame.content)
}

/**
 * 跑一次 DSH stdio 对话。返回 {ok:true, text, sessionId} 或 {ok:false, message}。
 * `dshCmd`＝可执行（'dsh' 或绝对路径）；`profile`＝DSH profile 名（od 用 'open-design'，本仓用 'openstory'）。
 */
export async function runDshStdio({
  dshCmd = 'dsh',
  profile = 'openstory',
  cwd = process.cwd(),
  prompt,
  resumeSessionId = '',
  model = '',
  timeoutMs = 180000,
  onText = null
} = {}) {
  if (!text(prompt).trim()) return { ok: false, message: 'DSH 桥：对话内容为空' }
  const requestId = `os-${randomUUID()}`
  const args = ['--profile', profile, '--stdio']
  return new Promise((resolvePromise) => {
    let child
    let settled = false
    let sessionId = ''
    let collected = ''
    let sawResult = false
    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      try { child?.kill() } catch { /* 已经退出 */ }
      resolvePromise(result)
    }
    const timer = setTimeout(() => {
      finish({ ok: false, message: `DSH 超时（${Math.round(Number(timeoutMs) / 1000)}s）：${profile}` })
    }, Number(timeoutMs) > 0 ? Number(timeoutMs) : 180000)
    try {
      child = spawnCommand(dshCmd, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ ok: false, message: `dsh 起不来：${text(error?.message || error)}` })
      return
    }
    let buffer = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      buffer += text(chunk)
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        const parsed = parseDshFrame(line)
        if (!parsed.ok) continue
        const frame = parsed.frame
        if (frame.type === 'ready') {
          // 就绪即发 execute（od 同口径：先 ready 再命令）
          sendExecute()
          continue
        }
        if (frame.type === 'session') {
          sessionId = text(frame.session_id)
          continue
        }
        const piece = dshFrameText(frame)
        if (piece) {
          collected += piece
          if (typeof onText === 'function') {
            try { onText(piece) } catch { /* 回调异常不影响协议 */ }
          }
          continue
        }
        if (frame.type === 'protocol_error') {
          finish({ ok: false, message: `DSH 协议错误：${text(frame.code)} ${text(frame.message)}` })
          continue
        }
        if (frame.type === 'result') {
          sawResult = true
          if (text(frame.status) === 'completed') {
            const body = text(frame.output) || collected
            finish(body.trim()
              ? { ok: true, text: body, sessionId }
              : { ok: false, message: 'DSH 完成但没有输出文本' })
          } else {
            const failure = frame.error
            finish({
              ok: false,
              message: `DSH ${text(frame.status)}${failure?.code ? `（${text(failure.code)}）` : ''}：${text(failure?.message || '未给出原因')}`
            })
          }
        }
      }
    })
    child.stderr?.on('data', (chunk) => { stderr += text(chunk) })
    child.on('error', (error) => finish({ ok: false, message: `dsh 起不来：${text(error?.message || error)}` }))
    child.on('exit', (code) => {
      if (settled) return
      const detail = stderr.trim().slice(0, 300)
      finish({
        ok: false,
        message: sawResult
          ? `DSH 进程退出（码 ${code}）${detail ? `：${detail}` : ''}`
          : `dsh 不可用（码 ${code}）${detail ? `：${detail}` : ''}——这台机器需要先安装 DeepSeek Harness CLI（npm i -g @deepseek-ai/dsh）`
      })
    })

    function sendExecute() {
      const command = {
        v: 1,
        type: 'execute',
        request_id: requestId,
        cwd,
        prompt,
        mcp_servers: [],
        ...(resumeSessionId ? { resume_session_id: resumeSessionId } : {}),
        ...(model ? { model } : {})
      }
      try {
        child.stdin?.write(`${JSON.stringify(command)}\n`)
      } catch (error) {
        finish({ ok: false, message: `DSH 命令发送失败：${text(error?.message || error)}` })
      }
    }
  })
}
