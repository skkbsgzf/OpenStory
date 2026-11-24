/**
 * root 授权与路径安全（OS-141 daemon 拆分）——daemon 与 handler 共用的纯函数层。
 *
 * 三件事：
 *   · 库清单：OS-167 起读 OpenStory 自持的 %LOCALAPPDATA%/OpenStory/libraries.json；
 *     旧 Pinax 清单不再隐式读取，只在设置页显式导入；坏档/缺档按空清单＋warning 回；
 *   · root 白名单：库清单 ＋ 启动时 `--root=` 显式授权——作者指定了哪个库，daemon 才敢碰哪个库；
 *   · 路径安全：相对路径 resolve 后必须落在 root 内（照 S2 的路径逃逸拒收写法），
 *     `.pinax/` 元数据目录默认禁入（只归 Electron 内核写）。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { API_ERROR_CODES, normalizeLibraries } from '../api/contracts.mjs'
import {
  defaultLibraryManifestPath,
  readLibraryManifest,
  resolveLibraryManifestPath
} from '../protocol/libraryManifest.mjs'

export function text(value) {
  return String(value ?? '')
}

/** 元数据目录名：库内 .pinax/ 只归 Pinax 内核写，OpenStory 读都要显式放行。 */
export const METADATA_DIR = '.pinax'

/** 库内不许当页签目录的名字：元数据与备份目录。 */
export const RESERVED_LIB_DIRS = new Set([METADATA_DIR, '.history', '.openstory', 'node_modules'])

/** 新院自持库清单路径（保留旧函数名给 CLI/测试调用点，语义已换）。 */
export function defaultPreferencesPath(env = process.env) {
  return defaultLibraryManifestPath(env)
}

/** 解析清单路径：显式 preferencesPath ＞ OPENSTORY_PREFERENCES ＞ 新院 libraries.json。旧环境变量不再参与。 */
export function resolvePreferencesEnv(env = process.env) {
  return resolveLibraryManifestPath({ env })
}

/**
 * 读库清单（OS-167：新院 libraries.json 为真源）。坏档/缺档不拦启动：
 * 按空清单回并记 warning；显式传旧形状文件时兼容读，但标 legacy:true 且永不写回。
 */
export function loadLibraries({ preferencesPath, env = process.env } = {}) {
  const read = readLibraryManifest({ preferencesPath, env })
  // 上屏形状继续走契约层归一化（kind/count/at 保底），与旧口径等价；source 留在清单文件里。
  const normalized = normalizeLibraries(read.libraries)
  return {
    libraries: normalized.libraries,
    warnings: [...read.warnings, ...normalized.warnings],
    preferencesPath: read.path,
    legacy: read.legacy
  }
}

export function canonicalRoot(value) {
  const raw = text(value).trim()
  if (!raw) return ''
  const absolute = resolve(raw)
  // Windows 会把 8.3 短名与长名当成同一目录：先 realpath 归一再比，避免
  // `ADMINI~1` 与 `Administrator` 明明同一个库却互相不认。路径不存在时回落 resolve。
  try {
    return realpathSync.native(absolute)
  } catch {
    return absolute
  }
}

export function rootKey(value) {
  const canonical = canonicalRoot(value)
  if (!canonical) return ''
  return process.platform === 'win32' ? canonical.toLowerCase() : canonical
}

/**
 * root 白名单＝库清单 ＋ 启动时 `--root=` 的显式授权。
 * 显式 CLI 授权与库登记等价：作者指定了哪个库，daemon 才敢碰哪个库。
 */
export function createRootAllowlist(libraries = [], extraRoots = []) {
  const byKey = new Map()
  for (const library of libraries) {
    const root = canonicalRoot(library?.path)
    if (root) byKey.set(rootKey(root), root)
  }
  for (const extra of extraRoots) {
    const root = canonicalRoot(extra)
    if (root) byKey.set(rootKey(root), root)
  }
  const resolveRoot = (value) => {
    const key = rootKey(value)
    return key ? (byKey.get(key) ?? null) : null
  }
  return {
    roots: [...byKey.values()],
    resolve: resolveRoot,
    isAllowed(value) {
      return Boolean(resolveRoot(value))
    }
  }
}

/** root 授权的统一失败形状（NO_LIBRARY ＋ 人话）：handler 拿到 ok:false 直接 sendError。 */
export function authorizeRoot(allowlist, requested) {
  const root = allowlist.resolve(requested)
  if (!root) {
    return {
      ok: false,
      code: API_ERROR_CODES.NO_LIBRARY,
      message: `root 不在库清单里：${text(requested)}`,
      details: { root: text(requested) }
    }
  }
  return { ok: true, root }
}

export function pathFail(message, path) {
  return { ok: false, code: API_ERROR_CODES.PATH_ESCAPE, message, details: path ? { path } : undefined }
}

/**
 * 相对路径 → 绝对路径，并保证落在 root 内。照 S2 `validateRelativePath` 的口径：
 * 不得绝对、不得含 `.`/`..`/空段、不得碰 `.pinax/`（元数据只归 Electron 内核写）。
 * 额外用 path.relative 复核一次，防止符号链接/大小写以外的拼接意外。
 */
export function resolveInsideRoot(root, relativePath, { allowMetadata = false } = {}) {
  const base = canonicalRoot(root)
  if (!base) {
    return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '文件路径需要一个项目根（root）' }
  }
  const raw = text(relativePath).trim()
  if (!raw || raw.includes('\0')) return pathFail('路径必须是非空字符串', raw)
  const normalized = raw.replaceAll('\\', '/').replace(/^\.\//u, '')
  const segments = normalized.split('/')
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//u.test(normalized)
    || segments.some((part) => !part || part === '.' || part === '..')) {
    return pathFail(`路径不合法或越出库根：${raw}`, normalized)
  }
  if (!allowMetadata && segments.some((part) => part.toLowerCase() === METADATA_DIR)) {
    return pathFail(`${METADATA_DIR}/ 只归 Pinax 内核写，OpenStory 不碰`, normalized)
  }
  const target = resolve(base, normalized)
  const rel = relative(base, target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return pathFail(`路径解析后落在库根之外：${raw}`, normalized)
  }
  return { ok: true, path: target, relative: normalized }
}
