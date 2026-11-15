import fs from 'node:fs'

let src = fs.readFileSync('runtimes.mjs', 'utf-8')
const OLD = `    if (!probeCmd || probeCmd.includes('/') || probeCmd.includes('\\\\')) {
      return bad('RUNTIME_KIT_PROBE', 'cli kit 必须声明 probe.cmd（PATH 上的可执行名）')
    }`
const NEW = `    if (!probeCmd) return bad('RUNTIME_KIT_PROBE', 'cli kit 必须声明 probe.cmd')
    // 允许 PATH 名或绝对路径（本机 manifest 可信；是否真能执行由 probe 实测）`
if (!src.includes(OLD)) {
  console.error('probe loosen target missing')
  process.exit(1)
}
src = src.split(OLD).join(NEW)
fs.writeFileSync('runtimes.mjs', src, 'utf-8')
console.log('loosened ok')
