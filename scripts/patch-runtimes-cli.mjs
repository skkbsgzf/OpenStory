import fs from 'node:fs'

let src = fs.readFileSync('runtimes.mjs', 'utf-8')
const OLD = `  } else {
    let url
    try { url = new URL(text(raw.url).trim()) } catch { return bad('RUNTIME_KIT_URL', 'endpoint 缺合法 url') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return bad('RUNTIME_KIT_URL', 'endpoint url 只支持 http/https')
    kit.url = url.origin
  }`
const NEW = `  } else if (kind === 'endpoint') {
    let url
    try { url = new URL(text(raw.url).trim()) } catch { return bad('RUNTIME_KIT_URL', 'endpoint 缺合法 url') }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return bad('RUNTIME_KIT_URL', 'endpoint url 只支持 http/https')
    kit.url = url.origin
  } else {
    // kind:cli——一次性子进程嫁接：probe 必填（安装探测），cliArgs 模板里 {prompt} 占位
    const probe = raw.probe && typeof raw.probe === 'object' ? raw.probe : null
    const probeCmd = text(probe?.cmd).trim()
    if (!probeCmd || probeCmd.includes('/') || probeCmd.includes('\\\\')) {
      return bad('RUNTIME_KIT_PROBE', 'cli kit 必须声明 probe.cmd（PATH 上的可执行名）')
    }
    kit.probe = { cmd: probeCmd, args: Array.isArray(probe.args) ? probe.args.map((arg) => text(arg)) : [] }
    kit.cliArgs = Array.isArray(raw.cliArgs) ? raw.cliArgs.map((arg) => text(arg)) : ['-p', '{prompt}']
    const timeoutMs = Number(raw.timeoutMs)
    kit.timeoutMs = Number.isFinite(timeoutMs) && timeoutMs >= 1000 && timeoutMs <= 900000 ? timeoutMs : 120000
  }`
if (!src.includes(OLD)) {
  console.error('kind branch target missing')
  process.exit(1)
}
src = src.split(OLD).join(NEW)

// probe 通用规整（非 cli 也可声明，用于货架状态标）
const OLD3 = `  if (raw.sha256 !== undefined && !/^[0-9a-f]{64}$/iu.test(text(raw.sha256))) return bad('RUNTIME_KIT_SHA', 'sha256 要是 64 位十六进制')`
const NEW3 = `  if (kind !== 'cli' && raw.probe && typeof raw.probe === 'object' && text(raw.probe.cmd).trim()) {
    kit.probe = { cmd: text(raw.probe.cmd).trim(), args: Array.isArray(raw.probe.args) ? raw.probe.args.map((arg) => text(arg)) : [] }
  }
  if (raw.sha256 !== undefined && !/^[0-9a-f]{64}$/iu.test(text(raw.sha256))) return bad('RUNTIME_KIT_SHA', 'sha256 要是 64 位十六进制')`
if (!src.includes(OLD3)) {
  console.error('probe target missing')
  process.exit(1)
}
src = src.split(OLD3).join(NEW3)

fs.writeFileSync('runtimes.mjs', src, 'utf-8')
console.log('step2 ok')
