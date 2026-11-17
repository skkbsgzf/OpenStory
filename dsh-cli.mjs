/**
 * DSH stdio 桥（OS-19）——照 @open-design/dsh-runtime 的协议直连本地 `dsh` CLI。
 *
 * 协议（od 的 open-design-dsh-runtime-0.1.0，已从 tgz 解包逆向）：
 *   dsh --profile <p> --stdio          ← 起一个短进程（一 run 一进程）
 *   → {"v":1,"type":"ready",...}       ← 插件就绪帧
 *   发  {"v":1,"type":"execute","request_id","cwd","prompt","mcp_servers":[],"resume_session_id"?,"model"?,"reasoning_effort"?}
 *   收  {"type":"session","session_id"...} → {"type":"text","content"}*
 *       → {"type":"thinking","content"}* / {"type":"tool_call"|"tool_result"|"usage"}*
 *       → {"type":"result","status":"completed|cancelled|failed","session_id","output"?,"stop_reason"?,"resume_rejected"?,"error"?}
 *   取消 {"v":1,"type":"cancel","request_id"}
 *
 * 一进程一次 execute（od 同口径：协议进程只接受一个 execute 命令）；
 * 会话续接靠 Harness 自己的会话存储（resume_session_id）。
 * 取消＝先发 cancel 帧让 DSH flush，宽限 2s 再杀进程树。
 */
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'



/** 在 PATH 上解析可执行：Windows 优先 .cmd/.exe/.bat 变体。返回实际路径或空串。 */
export function resolveOnPath(cmd, env = process.env) {
  const raw = String(cmd ?? '')
  if (!raw) return ''
  if (path.isAbsolute(raw) || raw.includes('/') || raw.includes('\\')) {
    return fs.existsSync(raw) ? raw : ''
  }
  const exts = process.platform === 'win32'
    ? (path.extname(raw) ? [''] : ['.cmd', '.exe', '.bat', ''])
    : ['']
  for (const dir of String(env.PATH || env.Path || '').split(path.delimiter)) {
    if (!dir.trim()) continue
    for (const ext of exts) {
      const candidate = path.join(dir, raw + ext)
      try {
        if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate
      } catch { /* 无权限等跳过 */ }
    }
  }
  return ''
}

/**
 * Windows 友好的 spawn：.cmd/.bat 需经 cmd /c（shell:false 时 Node 不解析 shim）。
 * 传裸名（如 'dsh'）时先在 PATH 上解析成实际文件，再决定是否需要 cmd /c。
 */
export function spawnCommand(cmd, args, options = {}) {
  const env = options.env ?? process.env
  const resolved = resolveOnPath(cmd, env)
  const target = resolved || String(cmd ?? '')
  if (process.platform === 'win32' && /\.(?:cmd|bat)$/iu.test(target)) {
    return spawn('cmd', ['/c', target, ...args], options)
  }
  return spawn(target, args, options)
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

/** 从 DSH 帧流里抽正文文本（只认 text 帧——thinking 不能混进正文）。 */
export function dshFrameText(frame) {
  if (!frame || frame.type !== 'text') return ''
  return text(frame.content)
}

/** model 必须是 {provider,id}；'provider/id' 字符串拆开，拆不开返回 null（发了必被拒）。 */
export function dshModelSelection(value) {
  const raw = text(value).trim()
  if (!raw || raw === 'default') return null
  if (value && typeof value === 'object') {
    const provider = text(value.provider).trim()
    const id = text(value.id).trim()
    return provider && id ? { provider, id } : null
  }
  const slash = raw.indexOf('/')
  if (slash <= 0 || slash === raw.length - 1) return null
  const provider = raw.slice(0, slash).trim()
  const id = raw.slice(slash + 1).trim()
  return provider && id ? { provider, id } : null
}

/** 杀进程树：Windows 上裸 child.kill() 只会杀掉 cmd 外壳，真进程会成孤儿。 */
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

/**
 * 跑一次 DSH stdio 对话。
 *
 * 与早期版本的区别（都是实打实踩到的坑）：
 *   1. thinking / tool_call / tool_result / usage 不再丢弃，各自走回调；
 *   2. result 的 stop_reason（max-tokens 截断）与 resume_rejected（会话失效）透传；
 *   3. 取消走协议 cancel 帧 + 宽限期 + 杀进程树；
 *   4. 无输出 watchdog：连续 N 毫秒没有任何帧＝卡死，主动取消；
 *   5. model 按 {provider,id} 发，字符串会拆 'provider/id'，拆不开就不发。
 *
 * 返回：
 *   成功 { ok:true, text, sessionId, usage?, stopReason?, truncated? }
 *   失败 { ok:false, message, code?, resumeRejected?, partialText? }
 */
export async function runDshStdio({
  dshCmd = 'dsh',
  profile = 'openstory',
  cwd = process.cwd(),
  prompt,
  resumeSessionId = '',
  model = '',
  reasoningEffort = '',
  timeoutMs = 600000,
  inactivityMs = 90000,
  signal = null,
  onText = null,
  onThinking = null,
  onToolCall = null,
  onToolResult = null,
  onUsage = null
} = {}) {
  if (!text(prompt).trim()) return { ok: false, message: 'DSH 桥：对话内容为空' }
  const requestId = `os-${randomUUID()}`
  const args = ['--profile', profile, '--stdio']
  const MAX_FRAME_BYTES = 1024 * 1024

  return new Promise((resolvePromise) => {
    let child = null
    let settled = false
    let sessionId = ''
    let collected = ''
    let sawResult = false
    let usage = null
    let cancelling = false
    let graceTimer = null
    let inactivityTimer = null
    let timer = null
    let cancelledBy = ''   // 'user' | 'timeout' | 'inactivity'

    const clearTimers = () => {
      if (timer) clearTimeout(timer)
      if (inactivityTimer) clearTimeout(inactivityTimer)
      if (graceTimer) clearTimeout(graceTimer)
    }

    const finish = (result) => {
      if (settled) return
      settled = true
      clearTimers()
      detachSignal()
      killTree(child)
      resolvePromise({ ...result, ...(collected.trim() && !result.ok ? { partialText: collected } : {}) })
    }

    const cancelRun = (reason) => {
      if (settled || cancelling) return
      cancelling = true
      cancelledBy = reason
      try {
        child?.stdin?.write(`${JSON.stringify({ v: 1, type: 'cancel', request_id: requestId })}\n`)
        child?.stdin?.end()
      } catch { /* 管道已断 */ }
      graceTimer = setTimeout(() => {
        if (settled) return
        finish({
          ok: false,
          code: reason === 'user' ? 'DSH_CANCELLED' : 'DSH_TIMEOUT',
          message: reason === 'user'
            ? '已停止（DSH 侧会话已保存）'
            : reason === 'inactivity'
              ? `DSH 超过 ${Math.round(Number(inactivityMs) / 1000)}s 没有任何输出，判定卡死并已取消`
              : `DSH 超时（${Math.round(Number(timeoutMs) / 1000)}s）`
        })
      }, 2000)
    }

    const bumpInactivity = () => {
      if (!(Number(inactivityMs) > 0) || settled || cancelling) return
      clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(() => cancelRun('inactivity'), Number(inactivityMs))
    }

    timer = setTimeout(() => cancelRun('timeout'), Number(timeoutMs) > 0 ? Number(timeoutMs) : 600000)

    const onAbort = () => cancelRun('user')
    function detachSignal() {
      if (signal && typeof signal.removeEventListener === 'function') signal.removeEventListener('abort', onAbort)
    }
    if (signal) {
      if (signal.aborted) {
        settled = true
        clearTimers()
        return resolvePromise({ ok: false, code: 'DSH_CANCELLED', message: '已停止' })
      }
      signal.addEventListener('abort', onAbort, { once: true })
    }

    try {
      child = spawnCommand(dshCmd, args, { cwd, shell: false, stdio: ['pipe', 'pipe', 'pipe'] })
    } catch (error) {
      finish({ ok: false, message: `dsh 起不来：${text(error?.message || error)}` })
      return
    }
    bumpInactivity()

    let buffer = ''
    let stderr = ''
    child.stdout?.on('data', (chunk) => {
      bumpInactivity()
      buffer += text(chunk)
      let index
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index)
        buffer = buffer.slice(index + 1)
        if (line.length > MAX_FRAME_BYTES) {
          finish({ ok: false, code: 'DSH_FRAME_TOO_LARGE', message: `DSH 帧过大（${line.length} 字节）` })
          return
        }
        const parsed = parseDshFrame(line)
        if (!parsed.ok) continue
        const frame = parsed.frame
        // 帧必须属于本次请求（od 同口径：对不上的丢弃，不致命）
        if (frame.request_id !== undefined && text(frame.request_id) !== requestId) continue
        if (frame.type === 'ready') {
          sendExecute()
          continue
        }
        if (frame.type === 'session') {
          sessionId = text(frame.session_id)
          continue
        }
        if (frame.type === 'thinking') {
          const piece = text(frame.content)
          if (piece && typeof onThinking === 'function') {
            try { onThinking(piece) } catch { /* 回调异常不影响协议 */ }
          }
          continue
        }
        if (frame.type === 'tool_call') {
          let input = null
          const rawArgs = frame.arguments
          if (typeof rawArgs === 'string') {
            try { input = JSON.parse(rawArgs) } catch { input = { raw: rawArgs } }
          } else if (rawArgs && typeof rawArgs === 'object') {
            input = rawArgs
          }
          if (typeof onToolCall === 'function') {
            try { onToolCall({ id: text(frame.call_id), name: text(frame.name) || 'tool', input }) } catch { /* 同上 */ }
          }
          continue
        }
        if (frame.type === 'tool_result') {
          if (typeof onToolResult === 'function') {
            try {
              onToolResult({ id: text(frame.call_id), output: text(frame.output), isError: frame.is_error === true })
            } catch { /* 同上 */ }
          }
          continue
        }
        if (frame.type === 'usage') {
          usage = {
            input: Number(frame.input_tokens) || 0,
            output: Number(frame.output_tokens) || 0,
            cachedRead: Number(frame.cache_read_tokens) || 0,
            cachedWrite: Number(frame.cache_write_tokens) || 0
          }
          usage.total = usage.input + usage.output
          if (typeof onUsage === 'function') {
            try { onUsage(usage) } catch { /* 同上 */ }
          }
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
          finish({ ok: false, code: text(frame.code) || 'DSH_PROTOCOL_ERROR', message: `DSH 协议错误：${text(frame.code)} ${text(frame.message)}` })
          continue
        }
        if (frame.type === 'result') {
          sawResult = true
          const status = text(frame.status)
          const stopReason = text(frame.stop_reason)
          const resumeRejected = frame.resume_rejected === true
          if (cancelling || status === 'cancelled') {
            finish({
              ok: false,
              code: 'DSH_CANCELLED',
              message: cancelledBy === 'user' ? '已停止（DSH 侧会话已保存）' : 'DSH 已取消',
              resumeRejected
            })
            continue
          }
          if (status === 'completed') {
            const body = text(frame.output) || collected
            if (!body.trim()) {
              finish({ ok: false, message: 'DSH 完成但没有输出文本', resumeRejected })
              continue
            }
            finish({
              ok: true,
              text: body,
              sessionId,
              ...(usage ? { usage } : {}),
              ...(stopReason ? { stopReason } : {}),
              // max-tokens ＝ 被模型长度上限截断，不能当成完整回答
              ...(stopReason === 'max-tokens' ? { truncated: true } : {}),
              resumeRejected
            })
          } else {
            const failure = frame.error
            finish({
              ok: false,
              code: text(failure?.code) || 'DSH_RUN_FAILED',
              message: `DSH ${status || 'failed'}${failure?.code ? `（${text(failure.code)}）` : ''}：${text(failure?.message || '未给出原因')}`,
              resumeRejected
            })
          }
        }
      }
    })
    child.stderr?.on('data', (chunk) => {
      bumpInactivity()
      stderr += text(chunk)
    })
    child.on('error', (error) => finish({ ok: false, message: `dsh 起不来：${text(error?.message || error)}` }))
    child.on('exit', (code) => {
      if (settled) return
      if (cancelling) {
        finish({
          ok: false,
          code: cancelledBy === 'user' ? 'DSH_CANCELLED' : 'DSH_TIMEOUT',
          message: cancelledBy === 'user' ? '已停止（DSH 侧会话已保存）' : 'DSH 已取消'
        })
        return
      }
      const detail = stderr.trim().slice(0, 300)
      if (sawResult) {
        finish({ ok: false, message: `DSH 进程退出（码 ${code}）${detail ? `：${detail}` : ''}` })
      } else if (code === 0) {
        finish({ ok: false, message: `DSH 没有产出结果就退出了${detail ? `：${detail}` : ''}` })
      } else {
        finish({ ok: false, message: `DSH 起不来（码 ${code}）${detail ? `：${detail}` : ''}` })
      }
    })

    function sendExecute() {
      const selection = dshModelSelection(model)
      const command = {
        v: 1,
        type: 'execute',
        request_id: requestId,
        cwd,
        prompt,
        mcp_servers: [],
        ...(resumeSessionId ? { resume_session_id: resumeSessionId } : {}),
        ...(selection ? { model: selection } : {}),
        ...(text(reasoningEffort).trim() ? { reasoning_effort: text(reasoningEffort).trim() } : {})
      }
      try {
        child.stdin?.write(`${JSON.stringify(command)}\n`)
      } catch (error) {
        finish({ ok: false, message: `DSH 命令发送失败：${text(error?.message || error)}` })
      }
    }
  })
}
