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
import { existsSync, statSync } from 'node:fs'

const t = (v) => String(v ?? '')

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
