/**
 * 测试夹具：按平台造一个「跑本机 Node 脚本」的可执行 shim。
 *
 * 为什么需要：dsh 桥接的守护测试要伪造一个 `dsh` 命令。Windows 上是 `.cmd`，
 * Linux/macOS 上必须是带 `#!/bin/sh` 且有可执行位的脚本——否则 spawn 直接 EACCES/ENOENT，
 * 测试在 ubuntu CI 上整组变红（2026-11-26 首跑就是这样）。
 *
 * 用法：
 *   const shim = await writeNodeShim(base, 'dsh', join(base, 'fake-dsh.mjs'))
 *   // Windows → base/dsh.cmd（内容 @echo off + node）
 *   // POSIX   → base/dsh（内容 #!/bin/sh + chmod 0o755）
 * 返回可执行文件路径。
 */
import { chmod, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const isWindows = process.platform === 'win32'

/**
 * @param {string} dir      放 shim 的目录（通常是 mkdtemp 出来的夹具根）
 * @param {string} name     shim 名（不带扩展名）
 * @param {string} scriptPath 要跑的 Node 脚本绝对路径
 * @param {string} [nodePath] Node 可执行文件（默认 process.execPath）
 * @returns {Promise<string>} shim 的可执行路径
 */
export async function writeNodeShim(dir, name, scriptPath, nodePath = process.execPath) {
  if (isWindows) {
    const file = join(dir, `${name}.cmd`)
    await writeFile(file, `@echo off\r\n"${nodePath}" "${scriptPath}" %*\r\n`, 'utf-8')
    return file
  }
  const file = join(dir, name)
  // 用 exec 让信号直达子进程（测试里的取消/超时用例依赖这一点）。
  const quoted = (value) => `'${String(value).replaceAll("'", `'\\''`)}'`
  await writeFile(file, `#!/bin/sh\nexec ${quoted(nodePath)} ${quoted(scriptPath)} "$@"\n`, 'utf-8')
  await chmod(file, 0o755)
  return file
}

/** 平台无关的「硬杀」：Windows 的 kill() 本就是硬杀，POSIX 上必须 SIGKILL 才不跑清理处理器。 */
export function hardKill(child) {
  if (!child || child.exitCode !== null) return
  try {
    child.kill(isWindows ? undefined : 'SIGKILL')
  } catch {
    /* 已经死了不算错 */
  }
}
