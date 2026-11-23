/**
 * 原生文件选择器（OS-110 重写）。
 *
 * 关键约束（本轮实测得出）：
 *   如果 daemon 是被非交互父进程拉起的（例如 Agent/CI 通过 bash 启动），
 *   它以及它 spawn 的所有子进程都**没有交互桌面栈**——WinForms 模态对话框会
 *   立即返回 Cancel（实测：ShowDialog 6 秒内退出、窗口句柄 0、屏幕上看不到窗口）。
 *   这不是代码 bug，是 Windows 前台权限 + 桌面会话的限制。
 *
 * 因此本模块对「对话框没显示」如实报 NO_DESKTOP（而不是伪装成用户取消），
 * 前端据此提示「请手动启动 daemon，或直接手填路径」。
 *
 * 资源管理器（revealPath）不受此限：explorer.exe 由 shell 转发到前台桌面。
 */
import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

const t = (v) => String(v ?? '')

/* ---------- 本机偏好（OS-119，OS-141 daemon 拆分落位）----------
 * 目录浏览器「上次选的文件夹」记忆与「弹不出原生框」降级记忆都落
 * %LOCALAPPDATA%/PinaxNext/openstory/fs-browse.json（本机一级，与库无关）：
 * 新建库时还没有库可写，而「浏览」按钮在建库表单里就要用——只能落本机。 */

/** OS-119：目录浏览器「上次选的文件夹」记忆（本机偏好，与库无关）。 */
export function browseMemoryPath(env = process.env) {
  const base = t(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'fs-browse.json') : ''
}

export function readBrowseMemory(env = process.env) {
  const target = browseMemoryPath(env)
  if (!target) return { lastPicked: '', nativeDialog: '' }
  try {
    const raw = JSON.parse(readFileSync(target, 'utf-8'))
    return {
      lastPicked: t(raw?.lastPicked).trim(),
      // 原生框能力判定（OS-119）：本机这台机器上「上次试的结果」，跨 daemon 重启复用
      nativeDialog: t(raw?.nativeDialog).trim()
    }
  } catch {
    return { lastPicked: '', nativeDialog: '' }
  }
}

export function writeBrowseMemory(patch, env = process.env) {
  const target = browseMemoryPath(env)
  if (!target) return
  try {
    const next = { ...readBrowseMemory(env), ...patch }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify(next, null, 2) + '\n', 'utf-8')
  } catch (error) {
    // 记不住不算错（浏览器照常能用），但要留痕——静默失败排查过一次就够
    console.error('[fs-browse] 记忆写入失败:', t(error?.message || error))
  }
}

/** 默认根：C 盘用户目录下的 OpenStory（作者口径「默认目录始终选择用户 C 盘的
 *  openstory project」）。不存在就建出来，省得每次从头选。 */
export function defaultBrowseRoot(env = process.env) {
  const home = t(env.USERPROFILE || env.HOME).trim()
  return home ? join(home, 'OpenStory') : ''
}

/** OS-118：本进程能否弹原生对话框。首次真正试一次（8 秒超时），判定 NO_DESKTOP 后
 *  记住，后续请求立刻返回——不再让用户每次白等 8 秒。daemon 重启会重试一次
 *  （万一是被正常终端启动的，就恢复原生框）。 */
let NATIVE_DIALOG_UNUSABLE = false
/** 已知有桌面 → 用户真要动手选，超时必须放宽；否则 8 秒就掐掉了正常操作。
 *  未知 → 8 秒探测（失败即判无桌面）。 */
export const NATIVE_DIALOG_TIMEOUT_MS = 8_000

/** 本进程已判定弹不出原生框（先查进程内记忆，再查跨重启的 fs-browse.json 记忆）。 */
export function nativeDialogUnusable(env = process.env) {
  return NATIVE_DIALOG_UNUSABLE || readBrowseMemory(env).nativeDialog === 'NO_DESKTOP'
}

/** 记住「本进程弹不出」：后续请求立刻降级，不再等超时。 */
export function markNativeDialogUnusable() {
  NATIVE_DIALOG_UNUSABLE = true
}


/** 跑 PowerShell（一次性）。脚本用 `RESULT=<path>` 或 `RESULT=<NULL>` 回报。 */
function runPowerShell(script, { timeoutMs = 8_000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, code: 'UNSUPPORTED_PLATFORM', message: '原生选择器目前只支持 Windows' })
      return
    }
    // 不加 -NonInteractive（它阻止模态窗口）；windowsHide 必须 false。
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-Command', script], {
      windowsHide: false,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    const startedAt = Date.now()
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 已退出 */ }
      // 超时基本等于「对话框显示在看不到的地方」——按无桌面处理，让前端降级
      resolve({ ok: false, code: 'NO_DESKTOP', message: '对话框没有显示出来（8 秒无响应）' })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { err += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: 'SPAWN_FAILED', message: t(error?.message || error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const elapsed = Date.now() - startedAt
      const lines = out.trim().split(/\r?\n/u).map((x) => x.trim()).filter(Boolean)
      const hit = lines.find((line) => line.startsWith('RESULT='))
      if (hit) {
        const path = hit.slice('RESULT='.length).trim()
        if (!path || path === '<NULL>') return resolve({ ok: false, code: 'CANCELLED', message: '已取消' })
        return resolve({ ok: true, path })
      }
      // 没有 RESULT：真取消 vs 对话框根本没显示。
      // 判定：极快返回（<3s）且无 stderr → 无桌面栈（对话框没能创建出来）
      if (elapsed < 3000 && !err.trim()) {
        return resolve({
          ok: false,
          code: 'NO_DESKTOP',
          message: '服务进程没有交互桌面（通常是被后台/子进程启动的），系统不允许它弹模态对话框。请在终端里手动启动 daemon，或直接手填路径。'
        })
      }
      if (code !== 0 && !hit) {
        return resolve({ ok: false, code: 'DIALOG_ERROR', message: err.trim() || `退出码 ${code}` })
      }
      resolve({ ok: false, code: 'CANCELLED', message: '已取消' })
    })
  })
}

/** 转义单引号（PowerShell 单引号字符串里 ' 要写 ''）。 */
function psQuote(value) {
  return `'${t(value).replaceAll("'", "''")}'`
}

/** 弹「选择文件夹」对话框。 */
export async function pickFolder({ title = '选择文件夹', initialDir = '', timeoutMs = 8_000 } = {}) {
  const lines = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$d.Description = ${psQuote(title)}`,
    '$d.ShowNewFolderButton = $true',
    "$d.RootFolder = 'MyComputer'",
    initialDir && existsSync(initialDir) ? `$d.SelectedPath = ${psQuote(initialDir)}` : '',
    '$r = $d.ShowDialog()',
    "if ($r -eq 'OK') { Write-Output ('RESULT=' + $d.SelectedPath) } else { Write-Output 'RESULT=<NULL>' }"
  ].filter(Boolean).join('; ')
  return runPowerShell(lines, { timeoutMs })
}

/** 弹「选择文件」对话框。 */
export async function pickFile({ title = '选择文件', initialDir = '', filter = '所有文件 (*.*)|*.*', timeoutMs = 8_000 } = {}) {
  const lines = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    `$d.Title = ${psQuote(title)}`,
    `$d.Filter = ${psQuote(filter)}`,
    '$d.CheckFileExists = $true',
    initialDir && existsSync(initialDir) ? `$d.InitialDirectory = ${psQuote(initialDir)}` : '',
    '$r = $d.ShowDialog()',
    "if ($r -eq 'OK') { Write-Output ('RESULT=' + $d.FileName) } else { Write-Output 'RESULT=<NULL>' }"
  ].filter(Boolean).join('; ')
  return runPowerShell(lines, { timeoutMs })
}

/**
 * 在资源管理器里打开一个路径：文件夹＝打开；文件＝打开所在目录并选中它。
 * explorer.exe 由 shell 转发到前台桌面，不受本进程无桌面栈的影响。
 */
export function revealPath(target) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, code: 'UNSUPPORTED_PLATFORM', message: '资源管理器打开目前只支持 Windows' })
      return
    }
    const p = t(target).trim()
    if (!p) { resolve({ ok: false, code: 'INVALID_ENTRY', message: '路径为空' }); return }
    if (!existsSync(p)) { resolve({ ok: false, code: 'NOT_FOUND', message: `路径不存在：${p}` }); return }
    try {
      const isDir = statSync(p).isDirectory()
      const args = isDir ? [p] : ['/select,', p]
      const child = spawn('explorer.exe', args, { detached: true, stdio: 'ignore', windowsHide: false })
      child.unref()
      resolve({ ok: true })
    } catch (error) {
      resolve({ ok: false, code: 'SPAWN_FAILED', message: t(error?.message || error) })
    }
  })
}
