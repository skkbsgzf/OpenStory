/**
 * OS-218：把 OS-217 clean-room 候选样本整体替换进 samples/水浒传。
 *
 * 前置：候选必须由 tools/verify/verify-mcp-build-e2e.mjs --out 生成，report.digest 与
 * 当前构建器重跑一致。脚本不生成业务内容，只做洁净检查、同盘备份、整体换入与失败回滚。
 *
 * 用法：node tools/samples/install-shuihu-sample.mjs --candidate <目录>
 */
import { createHash } from 'node:crypto'
import {
  closeSync, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync,
  readdirSync, renameSync, rmSync, writeFileSync
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildShuihuWithMcp } from './build-shuihu-mcp.mjs'
import { SHUIHU_FULL_RECIPE } from './shuihu-full-recipe.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const SAMPLE = join(REPO, 'samples', '水浒传')
const DIRTY = /(?:^|\/)(?:\.history|\.openstory\/log)\/|\.openstory-tmp-|\.bak-|[A-Za-z]:\\Users\\|D:\\Projects\\/iu

function fail(message) { throw new Error(message) }
function copyTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isSymbolicLink()) fail(`样本不许含符号链接：${from}`)
    else {
      const bytes = readFileSync(from)
      if (DIRTY.test(from) || DIRTY.test(bytes.toString('utf8'))) fail(`候选样本不洁净：${from}`)
      mkdirSync(dirname(to), { recursive: true })
      const fd = openSync(to, 'wx')
      try { writeFileSync(fd, bytes) } finally { closeSync(fd) }
    }
  }
}

function digestFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

function treeDigest(root) {
  const files = []
  const walk = (abs, rel = '') => {
    for (const entry of readdirSync(abs, { withFileTypes: true })) {
      const next = rel ? `${rel}/${entry.name}` : entry.name
      if (entry.isDirectory()) walk(join(abs, entry.name), next)
      else if (entry.isFile()) files.push([next, digestFile(join(abs, entry.name))])
    }
  }
  walk(root)
  files.sort(([a], [b]) => a.localeCompare(b))
  return createHash('sha256').update(JSON.stringify(files)).digest('hex')
}

const arg = process.argv[2] === '--candidate' ? resolve(process.argv[3] ?? '') : ''
if (!arg) fail('用法：node tools/samples/install-shuihu-sample.mjs --candidate <目录>')
const candidate = existsSync(join(arg, 'report.json')) ? join(arg, '水浒传') : arg
if (!existsSync(candidate)) fail(`候选不存在：${candidate}`)
const report = JSON.parse(readFileSync(join(arg, 'report.json'), 'utf8'))
if (report.ok !== true || report.stats?.semanticModelVerified !== false) fail('候选报告不是通过的 MCP-only clean-room 结果')

// 独立重跑一次，证明候选 digest 仍与当前构建器一致，而不是接受一份陈旧报告。
const verifyBase = join(REPO, '.zcode', 'tmp', 'os218-recheck-base')
const verificationRoot = join(REPO, '.zcode', 'tmp', 'os218-recheck')
rmSync(verifyBase, { recursive: true, force: true })
rmSync(verificationRoot, { recursive: true, force: true })
const rebuilt = await buildShuihuWithMcp({ baseDir: verifyBase, root: verificationRoot, recipe: SHUIHU_FULL_RECIPE, keep: true, cleanup: false })
if (!rebuilt.ok) fail(`重跑失败：${rebuilt.error.code} · ${rebuilt.error.message}`)
if (rebuilt.digest !== report.digest) fail(`候选 digest 与当前构建器不一致：${report.digest} != ${rebuilt.digest}`)
rmSync(verificationRoot, { recursive: true, force: true })
rmSync(verifyBase, { recursive: true, force: true })

const base = mkdtempSync(join(dirname(SAMPLE), '.shuihu-install-'))
const staged = join(base, 'staged')
const previous = join(base, 'previous')
copyTree(candidate, staged)
let moved = false
try {
  renameSync(SAMPLE, previous)
  moved = true
  try {
    renameSync(staged, SAMPLE)
  } catch (error) {
    renameSync(previous, SAMPLE)
    moved = false
    throw error
  }
  console.log(JSON.stringify({
    ok: true,
    sample: SAMPLE,
    digest: report.digest,
    candidateTreeDigest: treeDigest(SAMPLE),
    backup: previous,
    note: '旧样本在同盘临时备份中；安装成功后不自动删除，调用方可从 backup 找回。'
  }, null, 2))
} finally {
  if (!moved && existsSync(previous) && !existsSync(SAMPLE)) {
    try { renameSync(previous, SAMPLE) } catch { /* 保留现场供人工恢复 */ }
  }
}
