/**
 * root 授权与路径安全（OS-141 daemon 拆分）——daemon 与 handler 共用的纯函数层。
 *
 * 三件事：
 *   · 库清单：OS-167 起读 OpenStory 自持的 %LOCALAPPDATA%/OpenStory/libraries.json；
 *     旧格式清单不再隐式读取，也不会被自动导入；坏档/缺档按空清单＋warning 回；
 *   · root 白名单：库清单 ＋ 启动时 `--root=` 显式授权——作者指定了哪个库，daemon 才敢碰哪个库；
 *   · 路径安全：相对路径 resolve 后必须落在 root 内（照 S2 的路径逃逸拒收写法），
 *     `${METADATA_DIR}/` 元数据目录默认禁入（只归 OpenStory 宿主写通道管理）。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { API_ERROR_CODES, normalizeLibraries } from '../api/contracts.mjs'
import { namingEntry } from '../protocol/naming.mjs'
import { text, METADATA_DIR, canonicalRoot, resolveInsideRoot } from '../protocol/rootPath.mjs'
import { CAPABILITY_SNAPSHOT } from '../protocol/modules.mjs'
import { capabilityResolver } from './capabilityBindings.mjs'

function libraryListCapability() {
  // OS-195b：宿主只经能力解析取句柄，不在模块顶层持有实现登记表。
  return capabilityResolver(CAPABILITY_SNAPSHOT).resolve('library.list')
}

export { text, METADATA_DIR, canonicalRoot, resolveInsideRoot }

/** 库内不许当页签目录的名字：元数据与备份目录。 */
export const RESERVED_LIB_DIRS = new Set([METADATA_DIR, '.history', 'node_modules'])

/** 新院自持库清单路径（保留旧函数名给 CLI/测试调用点，语义已换）。 */
export function defaultPreferencesPath(env = process.env) {
  const resolved = libraryListCapability()
  return resolved.ok ? resolved.capability.defaultLibraryManifestPath(env) : ''
}

/** 解析清单路径：显式 preferencesPath ＞ OPENSTORY_PREFERENCES ＞ 新院 libraries.json。旧环境变量不再参与。 */
export function resolvePreferencesEnv(env = process.env) {
  const resolved = libraryListCapability()
  return resolved.ok ? resolved.capability.resolveLibraryManifestPath({ env }) : ''
}

/**
 * 读库清单（OS-167：新院 libraries.json 为真源）。坏档/缺档不拦启动：
 * 按空清单回并记 warning；不是本产品形状的文件只读告警，不写回。
 */
export function loadLibraries({ preferencesPath, env = process.env } = {}) {
  const resolved = libraryListCapability()
  if (!resolved.ok) {
    return {
      libraries: [],
      warnings: [{ code: 'PLUGIN_DEGRADED', message: resolved.message, details: resolved.details }],
      preferencesPath: ''
    }
  }
  const read = resolved.capability.readLibraryManifest({ preferencesPath, env })
  // 上屏形状继续走契约层归一化（kind/count/at 保底），与旧口径等价；source 留在清单文件里。
  const normalized = normalizeLibraries(read.libraries)
  return {
    libraries: normalized.libraries,
    warnings: [...read.warnings, ...normalized.warnings],
    preferencesPath: read.path
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
