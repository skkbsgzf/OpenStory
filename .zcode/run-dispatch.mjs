/* OpenStory 派发器的 chdir 包装（OS-73 workflow 用）
 *
 * 为什么需要它：world.run 的 cwd 是会话目录（D:\Pinax-e2e），不是仓根。
 * 直接跑 node .zcode/dispatch.mjs 会 ENOENT（找不到文件），但 exit code 可能是 1，
 * 且 stdout 空 → workflow 解析出 null → 整阶段假失败。
 *
 * 用法：node .zcode/run-dispatch.mjs <model> <ticketFile> <outFile>
 * 退出码：透传 dispatch.mjs 的退出码；stdout 原样转发（一行紧凑 JSON）
 */
import { spawnSync } from 'node:child_process'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')

const argv = process.argv.slice(2)
if (argv.length < 3) {
  console.log(JSON.stringify({ ok: false, error: '用法：node .zcode/run-dispatch.mjs <model> <ticketFile> <outFile>' }))
  process.exit(2)
}

const [model, ticket, outFile] = argv
const result = spawnSync(
  process.execPath,
  [join(REPO, '.zcode', 'dispatch.mjs'), model, ticket, outFile],
  {
    cwd: REPO,
    encoding: 'utf8',
    timeout: 10_800_000,
    maxBuffer: 64 * 1024 * 1024,
    env: { ...process.env, OS_REPO: REPO }
  }
)

if (result.stdout) process.stdout.write(result.stdout)
if (result.stderr) process.stderr.write(result.stderr)
process.exit(result.status === null ? 1 : result.status)
