/* 门禁脚本（OS-61 workflow 用）
 *
 * 为什么需要它：world.run 的 cwd 是会话目录（D:/Pinax-e2e），而仓内部分测试用
 * process.cwd() 拼夹具路径（test/fact-curve.test.mjs）。workflow 里没法改 cwd，
 * 嵌套 spawn 又会卡死。所以放一个独立脚本：它自己 chdir 到仓根再跑测试。
 *
 * 用法：node D:/OpenStory/.zcode/run-gate.mjs [--check file1 file2 ...]
 * 退出码：0 = 全绿；1 = 有失败（stdout 带摘要）
 */
import { spawnSync } from 'node:child_process'
import { readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO = resolve(HERE, '..')
process.chdir(REPO)

const argv = process.argv.slice(2)
const checkIndex = argv.indexOf('--check')
const checkFiles = checkIndex >= 0 ? argv.slice(checkIndex + 1) : []

// ① 语法检查（先做，快失败）
for (const file of checkFiles) {
  const result = spawnSync(process.execPath, ['--check', join(REPO, file)], { encoding: 'utf8' })
  if (result.status !== 0) {
    console.log(`语法检查失败：${file}`)
    console.log((result.stderr || '').slice(0, 2000))
    process.exit(1)
  }
}
if (checkFiles.length) console.log(`语法检查通过：${checkFiles.join(', ')}`)

// ② 全量测试
let files = []
try {
  files = readdirSync(join(REPO, 'test'))
    .filter((name) => name.endsWith('.test.mjs'))
    .map((name) => join('test', name))
} catch (error) {
  console.log(`测试目录读不到：${error.message}`)
  process.exit(1)
}
if (!files.length) {
  console.log('没有测试文件')
  process.exit(1)
}

const result = spawnSync(process.execPath, ['--test', ...files], {
  cwd: REPO,
  encoding: 'utf8',
  timeout: 280_000,
  maxBuffer: 32 * 1024 * 1024
})
const out = `${result.stdout || ''}${result.stderr || ''}`
// 只回最后一段（失败的用例摘要就在末尾）
const lines = out.split('\n')
const tail = lines.slice(-40).join('\n')
const m = /# pass (\d+)[\s\S]*?# fail (\d+)/.exec(out) || /ℹ pass (\d+)[\s\S]*?ℹ fail (\d+)/.exec(out)
console.log(`测试结果：pass=${m?.[1] ?? '?'} fail=${m?.[2] ?? '?'}`)
console.log(tail)
process.exit(result.status === 0 ? 0 : 1)
