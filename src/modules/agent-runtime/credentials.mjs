/**
 * 底座契约：本机凭据对外只回尾号掩码（OS-195 下沉）。
 *
 * 纯函数、无 I/O、无工作台归属；凭据本体仍只存本机 agent-config.json，
 * 任何响应只回本文件产出的掩码。agent-runtime 内核与 Agent 存储共用这一份。
 */
export function maskApiKey(key) {
  const raw = String(key ?? '').trim()
  if (!raw) return ''
  if (raw.length <= 8) return '••••'
  return `••••${raw.slice(-4)}`
}
