/**
 * 本机院子唯一路径来源（OS-166 / G10a＋G10c，品牌分家）。
 *
 * 新院＝%LOCALAPPDATA%/OpenStory/，归 OpenStory；旧院＝%LOCALAPPDATA%/PinaxNext/，
 * **原样保留给 Pinax 桌面端，永不删除、永不改写**。首启时若旧院在、新院不在，
 * 一次性递归拷贝（跳过原子写残留 *.tmp-* 与 daemon.lock），并写迁移标记。
 *
 * 全仓只从这里取院子路径——不再有第二处 `join(base, 'PinaxNext', …)` 拼接。
 * env 注入是测试隔离的唯一手段：夹具一律传临时 LOCALAPPDATA，绝不碰真实院子。
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const COURTYARD_DIR = 'OpenStory'
export const LEGACY_COURTYARD_DIR = 'PinaxNext'
export const MIGRATION_MARKER = '.migrated-from-pinaxnext.json'
export const MIGRATION_SPEC = 'openstory.courtyard-migration/v1'

/** 跳过原子写残留与单实例锁：前者是半成品，后者是新院自己的运行态。 */
function isSkipped(name) {
  return name === 'daemon.lock' || /\.tmp-.+$/u.test(name)
}

/** 递归拷贝（只拷文件与目录；符号链接/其它类型跳过，不跟随）。返回拷贝的文件数。 */
function copyTree(from, to, skipped) {
  let copied = 0
  mkdirSync(to, { recursive: true })
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    const src = join(from, entry.name)
    const dst = join(to, entry.name)
    if (entry.isDirectory()) { copied += copyTree(src, dst, skipped); continue }
    if (!entry.isFile()) continue
    if (isSkipped(entry.name)) { skipped.push(src); continue }
    copyFileSync(src, dst)
    copied++
  }
  return copied
}

/** 已处理过的 base 只解析一次（迁移是一次性的；同进程后续调用零 fs 写）。 */
const handled = new Set()

/** 本机院子所在的父目录：LOCALAPPDATA 优先、APPDATA 兜底；两者都没有返回空串（如实，不猜路径）。 */
export function courtyardBase(env = process.env) {
  return String(env?.LOCALAPPDATA || env?.APPDATA || '').trim()
}

/**
 * 首启迁移：旧院在且新院不在 → 拷贝＋留标记；其余情况原样返回。
 * 同步实现是为了让所有 defaultXxxPath() 仍然是同步函数（调用面不动）。
 */
export function ensureCourtyard(base) {
  const home = String(base ?? '').trim()
  if (!home) return { migrated: false, reason: 'no-base', entries: 0, skipped: [] }
  if (handled.has(home)) return { migrated: false, reason: 'handled', entries: 0, skipped: [] }
  handled.add(home)
  const legacy = join(home, LEGACY_COURTYARD_DIR)
  const target = join(home, COURTYARD_DIR)
  const skipped = []
  let reason = 'noop'
  let entries = 0
  try {
    if (!existsSync(legacy)) {
      // 空环境首启：直接建新院，不给「还没有旧院」留下半成品路径。
      mkdirSync(target, { recursive: true })
      reason = 'created'
    } else if (!statSync(legacy).isDirectory()) {
      mkdirSync(target, { recursive: true })
      reason = 'legacy-not-dir'
    } else if (existsSync(join(target, MIGRATION_MARKER)) || existsSync(target)) {
      reason = 'target-exists'
    } else {
      reason = 'migrated'
      entries = copyTree(legacy, target, skipped)
      writeFileSync(join(target, MIGRATION_MARKER), JSON.stringify({
        schema: MIGRATION_SPEC,
        from: legacy,
        to: target,
        at: new Date().toISOString(),
        entries,
        note: '旧院保留给 Pinax 桌面端（未删除、未改写）'
      }, null, 2) + '\n', 'utf-8')
      console.error(`[courtyard] 已从 ${LEGACY_COURTYARD_DIR} 拷贝 ${entries} 个文件到 ${COURTYARD_DIR}；旧院保留给 Pinax 桌面端，未删除。`)
    }
  } catch (error) {
    reason = `error:${error?.code || error?.message || error}`
  }
  return { migrated: reason === 'migrated', reason, entries, skipped }
}

/**
 * 新院根：`LOCALAPPDATA` 优先、`APPDATA` 兜底；两者都没有返回空串，并由
 * ensureCourtyard('') 给出 `no-base` 可观测原因——绝不静默回落到猜出来的路径。
 * 每次解析都先过一次迁移闸（同 base 只做一次）。
 */
export function courtyardRoot(env = process.env) {
  const base = courtyardBase(env)
  if (!base) return ''
  ensureCourtyard(base)
  return join(base, COURTYARD_DIR)
}

/** 新院下的路径：courtyardPath(env, 'openstory', 'agent-config.json')。 */
export function courtyardPath(env, ...segments) {
  const root = courtyardRoot(env)
  return root ? join(root, ...segments.map((part) => String(part ?? ''))) : ''
}

/** 旧院路径常量：只给迁移代码与文档用，产品读写一律走新院。 */
export function legacyCourtyardPath(env, ...segments) {
  const base = courtyardBase(env)
  return base ? join(base, LEGACY_COURTYARD_DIR, ...segments.map((part) => String(part ?? ''))) : ''
}
