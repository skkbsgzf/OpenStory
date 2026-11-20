/**
 * 原生文件选择器（OS-108）：浏览器拿不到绝对路径（安全限制），
 * 由 daemon 起一个短命的 PowerShell 进程弹 Windows 原生对话框。
 *
 * Windows 用 System.Windows.Forms.FolderBrowserDialog / OpenFileDialog；
 * 非 Windows 平台（本仓主要面向 Windows）返回 unsupported，前端退回手填。
 */
import { spawn } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'

const t = (v) => String(v ?? '')

/** 跑一段 PowerShell，拿 stdout（一次性，超时 5 分钟＝用户在对话框里慢慢选）。 */
function runPowerShell(script, { timeoutMs = 300_000 } = {}) {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') {
      resolve({ ok: false, code: 'UNSUPPORTED_PLATFORM', message: '原生选择器目前只支持 Windows' })
      return
    }
    // -STA 是 WinForms 对话框的前提；-NoProfile 避免用户 profile 干扰
    const child = spawn('powershell.exe', ['-NoProfile', '-STA', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe']
    })
    let out = ''
    let err = ''
    const timer = setTimeout(() => {
      try { child.kill() } catch { /* 已退出 */ }
      resolve({ ok: false, code: 'DIALOG_TIMEOUT', message: '对话框超时（5 分钟）' })
    }, timeoutMs)
    child.stdout.on('data', (chunk) => { out += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { err += chunk.toString('utf8') })
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({ ok: false, code: 'SPAWN_FAILED', message: t(error?.message || error) })
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const path = out.trim().split(/\r?\n/u).filter(Boolean).pop() ?? ''
      if (code !== 0) {
        resolve({ ok: false, code: 'DIALOG_ERROR', message: err.trim() || `退出码 ${code}` })
        return
      }
      // 用户取消：PowerShell 输出空行
      if (!path) { resolve({ ok: false, code: 'CANCELLED', message: '已取消' }); return }
      resolve({ ok: true, path })
    })
  })
}

/** 转义单引号（PowerShell 单引号字符串里 ' 要写 ''）。 */
function psQuote(value) {
  return `'${t(value).replaceAll("'", "''")}'`
}

/**
 * 弹「选择文件夹」对话框。
 * @returns {Promise<{ok:boolean, path?:string, code?:string, message?:string}>}
 */
export async function pickFolder({ title = '选择文件夹', initialDir = '' } = {}) {
  const lines = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$d = New-Object System.Windows.Forms.FolderBrowserDialog',
    `$d.Description = ${psQuote(title)}`,
    "$d.ShowNewFolderButton = $true",
    "$d.RootFolder = 'MyComputer'",
    initialDir && existsSync(initialDir) ? `$d.SelectedPath = ${psQuote(initialDir)}` : '',
    '$r = $d.ShowDialog()',
    "if ($r -eq 'OK') { Write-Output $d.SelectedPath }"
  ].filter(Boolean).join('; ')
  return runPowerShell(lines)
}

/**
 * 弹「选择文件」对话框。
 * @returns {Promise<{ok:boolean, path?:string, code?:string, message?:string}>}
 */
export async function pickFile({ title = '选择文件', initialDir = '', filter = '所有文件 (*.*)|*.*' } = {}) {
  const lines = [
    'Add-Type -AssemblyName System.Windows.Forms | Out-Null',
    '$d = New-Object System.Windows.Forms.OpenFileDialog',
    `$d.Title = ${psQuote(title)}`,
    `$d.Filter = ${psQuote(filter)}`,
    "$d.CheckFileExists = $true",
    initialDir && existsSync(initialDir) ? `$d.InitialDirectory = ${psQuote(initialDir)}` : '',
    '$r = $d.ShowDialog()',
    "if ($r -eq 'OK') { Write-Output $d.FileName }"
  ].filter(Boolean).join('; ')
  return runPowerShell(lines)
}

/**
 * 在资源管理器里打开一个路径（OS-109）：文件夹＝打开；文件＝选中它。
 * 用 explorer.exe（Windows 原生，不阻塞 daemon——explorer 立刻 detach）。
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
      // 文件夹直接开；文件用 /select,（打开所在目录并选中该文件）
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
