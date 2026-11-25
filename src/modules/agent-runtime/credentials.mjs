/** 凭据只存本机；对外只回尾号掩码。 */
export function maskApiKey(key) {
  const raw = String(key ?? '').trim()
  if (!raw) return ''
  if (raw.length <= 8) return '••••'
  return `••••${raw.slice(-4)}`
}
