/**
 * 官方样例库首次启动登记（OS-232）。
 *
 * 为什么需要：仓库自带 `samples/水浒传`，但此前只写「导入即可体验」——
 * 产品没有任何一步把它登记进本机库清单，所以清空/首次安装后打开就是「还没有库」。
 * 官方 sample 应该开箱可见，不该让作者手动导入一次。
 *
 * 纪律：
 *   · 只在清单**不存在**时播种（`PREFERENCES_MISSING`）；已有清单（哪怕只有一条）一律不动，
 *     绝不把作者删掉的 sample 又塞回去。
 *   · 只登记仓库内置样例目录；目录不存在、不是本产品库（缺 `.openstory/project.json`）就跳过。
 *   · 播种走既有 `library.list` 能力写清单，不复制业务文件、不触发旧库升级。
 *   · 可用 `OPENSTORY_SEED_SAMPLE=0` 关闭；测试默认注入临时院子，也不会碰到真库。
 */
import { existsSync, readFileSync } from 'node:fs'
import { cp, mkdir, readdir } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { courtyardPath } from '../../protocol/courtyard.mjs'

export const SAMPLE_DIR_NAME = '水浒传'
export const SEED_SAMPLE_ENV = 'OPENSTORY_SEED_SAMPLE'

function text(value) {
  return String(value ?? '')
}

/** 样例库必须是本产品库：存在目录且带 `openstory-project@4` 标记。 */
export function isProductSample(root) {
  const target = text(root).trim()
  if (!target || !existsSync(target)) return false
  try {
    const marker = JSON.parse(readFileSync(join(target, '.openstory', 'project.json'), 'utf-8'))
    return marker?.spec === 'openstory-project@4'
  } catch {
    return false
  }
}

/**
 * 首次启动播种：清单缺失且官方样例可用时登记一条 `source: 'openstory'` 记录。
 * @returns {Promise<{ok:boolean, seeded:boolean, reason?:string, libraries?:object[], path?:string, message?:string}>}
 */
/**
 * 把样例复制到本机院子：**不能直接登记仓库内目录**——daemon 会在库里写
 * `.openstory/ui-state.json`、日志与 `.history`，登记源码树等于污染仓库。
 * 目标目录已存在就复用（作者可能已经在里面写过东西，绝不覆盖）。
 */
async function materializeSample(repoRoot, env) {
  const source = join(text(repoRoot), 'samples', SAMPLE_DIR_NAME)
  const target = courtyardPath(env, 'samples', SAMPLE_DIR_NAME)
  if (!target) return { ok: false, reason: 'no-courtyard', message: '找不到本机院子，无法安放样例副本' }
  if (existsSync(join(target, '.openstory', 'project.json'))) return { ok: true, path: target, reused: true }
  try {
    await mkdir(join(target, '..'), { recursive: true })
    await cp(source, target, { recursive: true, force: false, errorOnExist: false })
    return { ok: true, path: target, reused: false }
  } catch (error) {
    // 并发启动时另一个进程可能刚建好：目标已可识别就当复用。
    if (existsSync(join(target, '.openstory', 'project.json'))) return { ok: true, path: target, reused: true }
    return { ok: false, reason: 'copy-failed', message: `样例复制失败：${text(error?.message || error)}` }
  }
}

export async function seedOfficialSample({ repoRoot, env = process.env, preferencesPath = '', readLibraryManifest, writeLibraryManifest, resolveLibraryManifestPath }) {
  if (text(env?.[SEED_SAMPLE_ENV]).trim() === '0') return { ok: true, seeded: false, reason: 'disabled' }
  // 测试与一次性夹具不该被塞一份样例副本：显式清单路径（含临时院子）＝调用方自己管清单，
  // 播种只服务「作者第一次打开、还没有清单」这一种情形。
  if (text(preferencesPath).trim()) return { ok: true, seeded: false, reason: 'explicit-manifest' }
  if (typeof readLibraryManifest !== 'function' || typeof writeLibraryManifest !== 'function') {
    return { ok: false, seeded: false, reason: 'capability-missing', message: '库清单能力不可用，跳过 sample 播种' }
  }
  const sourceRoot = join(text(repoRoot), 'samples', SAMPLE_DIR_NAME)
  const sampleAvailable = isProductSample(sourceRoot)
  // preferencesPath 已在上方排除（显式清单＝不播种），这里只走院子默认路径。
  const explicit = ''
  const read = readLibraryManifest({ preferencesPath: explicit, env })
  // 已有清单就不动——作者删掉 sample 是明确意图，不能每次启动又塞回来。
  const missing = (read.warnings ?? []).some((item) => item.code === 'PREFERENCES_MISSING')
  if (!missing) return { ok: true, seeded: false, reason: 'manifest-exists', libraries: read.libraries }
  const target = typeof resolveLibraryManifestPath === 'function'
    ? resolveLibraryManifestPath({ preferencesPath: explicit, env })
    : read.path
  if (!target) return { ok: false, seeded: false, reason: 'no-path', message: '找不到库清单路径，跳过 sample 播种' }
  // 部署后必须有一份「加载过的项目」清单可看：样例不可用时也要落一份空清单，
  // 而不是让作者面对「清单不存在」的提示。
  if (!sampleAvailable) {
    const created = await writeLibraryManifest(target, [])
    if (!created.ok) return { ok: false, seeded: false, reason: 'write-failed', message: created.message }
    return { ok: true, seeded: false, reason: 'sample-missing', libraries: created.libraries, path: created.path, manifestCreated: true }
  }
  const placed = await materializeSample(repoRoot, env)
  if (!placed.ok) return { ok: false, seeded: false, reason: placed.reason, message: placed.message }
  const written = await writeLibraryManifest(target, [{
    path: placed.path,
    name: basename(placed.path),
    addedAt: new Date().toISOString(),
    source: 'openstory'
  }])
  if (!written.ok) return { ok: false, seeded: false, reason: 'write-failed', message: written.message }
  return { ok: true, seeded: true, reason: 'seeded', libraries: written.libraries, path: written.path, samplePath: placed.path, manifestCreated: true }
}
