/**
 * OS-196a G3：本机模块边界的**运行期强制**。
 *
 * 静态扫描（src/protocol/localModuleBoundary.mjs）只是预览提示，真正挡截的是这里的
 * `module.registerHooks({ resolve })`：任何从已登记模块根下发出的 import / require，
 * 只许解析到 node: 内置模块或**同一个包目录内**的真实路径（按 realpath 比，符号链接
 * 指到包外一样拒）。同时在解析时按逐文件内容摘要改写 URL，使「改依赖文件后刷新」
 * 真正拿到新代码（Node 的模块缓存按 URL 键，不再缓存到旧 helper）。
 *
 * 这不是沙箱：登记的模块与 daemon 同进程同权限，eval/Function 直接摸 process、
 * node:fs 等内置模块不在本门的管辖范围。文档必须照实说。
 */
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as nodeModule from 'node:module'

export const MODULE_BOUNDARY_VIOLATION = 'MODULE_BOUNDARY_VIOLATION'
/** 逐文件摘要的查询参数名（与入口 ?v= 区分开）。 */
export const FILE_DIGEST_PARAM = 'osv'

const roots = new Set()
let registered = false
let available = typeof nodeModule.registerHooks === 'function'
let lastError = ''

const sha256Hex = (value) => createHash('sha256').update(String(value ?? '')).digest('hex')
const within = (child, parent) => {
  const rel = relative(parent, child)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function boundaryError(specifier, parentURL, target, pkg) {
  const error = new Error(
    `本机模块 ${pkg.id} 的 import/require 越出包目录：${specifier} → ${target}`
  )
  error.code = MODULE_BOUNDARY_VIOLATION
  error.details = { specifier, parentURL, target, packageDir: pkg.dir }
  return error
}

/** 从 parentURL 找到它所属的包目录：根下第一段即模块 id（与 inspectRoot 的枚举口径一致）。 */
function packageForParent(parentURL) {
  if (!parentURL || !parentURL.startsWith('file:')) return null
  let parentPath
  try { parentPath = realpathSync(fileURLToPath(new URL(parentURL))) } catch { return null }
  for (const root of roots) {
    let realRoot
    try { realRoot = realpathSync(root) } catch { continue }
    const rel = relative(realRoot, parentPath)
    const segments = rel.split(/[\\/]/u)
    if (!rel || segments[0] === '..' || isAbsolute(rel)) continue
    const id = segments[0]
    const dir = join(realRoot, id)
    let realDir
    try { realDir = realpathSync(dir) } catch { continue }
    return { root: realRoot, dir: realDir, id }
  }
  return null
}

function resolveHook(specifier, context, nextResolve) {
  const pkg = packageForParent(context?.parentURL)
  if (!pkg) return nextResolve(specifier, context)
  // 只有 node: 内置是允许的；data: 里藏第二层 import 会绕开 parentURL 判定，一并拒。
  if (specifier.startsWith('node:')) return nextResolve(specifier, context)
  const resolved = nextResolve(specifier, context)
  if (!resolved?.url?.startsWith('file:')) {
    throw boundaryError(specifier, context?.parentURL, resolved?.url ?? specifier, pkg)
  }

  let target
  try { target = realpathSync(fileURLToPath(new URL(resolved.url))) } catch {
    throw boundaryError(specifier, context?.parentURL, resolved.url, pkg)
  }
  if (!within(target, pkg.dir)) throw boundaryError(specifier, context?.parentURL, target, pkg)

  // require（CJS）的 URL 带查询串会破坏 CJS 缓存键，只做边界检查、不改写。
  if (resolved.format === 'commonjs') return resolved
  try {
    const url = new URL(resolved.url)
    url.searchParams.set(FILE_DIGEST_PARAM, sha256Hex(readFileSync(target)))
    return { ...resolved, url: url.href, shortCircuit: true }
  } catch {
    // 读不了的目标让 Node 自己按 ERR_MODULE_NOT_FOUND 报错，不冒充边界违规。
    return resolved
  }
}

/**
 * 注册一次；不支持 registerHooks 的 Node（18/20）如实降级为「只静态提示」，
 * 由 moduleRuntime 在报告里写明「依赖文件已变，需重启 daemon 才生效」。
 */
export function ensureModuleBoundaryHooks() {
  if (registered) return available
  if (!available) return false
  try {
    nodeModule.registerHooks({ resolve: resolveHook })
    registered = true
  } catch (error) {
    available = false
    lastError = String(error?.message || error)
  }
  return available
}

/** 切换层时同步信任的根（替换而非累积，避免拆根后仍被当成模块包）。 */
export function syncModuleBoundaryRoots(paths = []) {
  roots.clear()
  for (const item of paths) {
    if (!item) continue
    try { roots.add(resolve(item)) } catch { /* 坏路径不进信任集 */ }
  }
}

export function boundaryHooksStatus() {
  return {
    available: available && registered,
    supported: typeof nodeModule.registerHooks === 'function',
    reason: lastError,
    roots: Object.freeze([...roots].sort())
  }
}

