/**
 * 插件最低应用版本闸（OS-121）——学 Obsidian 的 minAppVersion。
 *
 * 三套插件规范（openstory-suite@2 / openstory-skill@1 / openstory-runtime-kit@1）
 * 各有一个可选字段 minOpenStoryVersion（形如 '0.2.0'）：
 *   - 缺字段＝不校验（向后兼容：老插件照常加载）；
 *   - 要求版本 > 当前应用版本 → 该插件跳过加载，记一条 <KIND>_MIN_VERSION warning；
 *   - 字段格式非法 → 照常加载，记一条 <KIND>_MIN_VERSION_BAD warning（fail-open：宁可加载，也不因
 *     一个写坏的版本号把插件关在门外）。
 *
 * 这里只放比对逻辑，不碰三套 spec 的落盘格式；错误码由三个加载器自己按类别填。
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

// 只认 x.y.z 三段全数字——预发布标签/区间（^1.0.0、1.0.0-beta）一律按格式非法处理
const VERSION_RE = /^(\d+)\.(\d+)\.(\d+)$/u

function text(value) {
  return String(value ?? '')
}

// 进程生命周期内 package.json 的 version 不会变：按根目录缓存，避免货架上 N 个插件读 N 次盘
const appVersionCache = new Map()

/**
 * 读应用版本：<repoRoot>/package.json 的 version。
 * 不传 repoRoot＝本模块所在仓根（versionGate.mjs 就在仓根，生产路径零参数即可）。
 * 读不了/没有 version 返回 ''（由调用方按 bad-format 处理，绝不抛）。
 */
export function readAppVersion(repoRoot = HERE) {
  const root = text(repoRoot).trim() || HERE
  if (appVersionCache.has(root)) return appVersionCache.get(root)
  let version = ''
  try {
    const parsed = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8'))
    version = text(parsed?.version).trim()
  } catch {
    version = ''
  }
  appVersionCache.set(root, version)
  return version
}

/** 测试钩子：清版本缓存（测试换了 package.json 夹具时用）。 */
export function resetAppVersionCache() {
  appVersionCache.clear()
}

/**
 * required <= current ？
 * 只支持 x.y.z 全数字段，逐段比大小（1.2.3 vs 1.10.0 必须按数字比，不能按字符串比）。
 * 返回 {ok:true} / {ok:false, reason:'too-old'} / {ok:false, reason:'bad-format'}。
 */
export function satisfiesMinVersion(required, current) {
  const wanted = parseVersion(required)
  const have = parseVersion(current)
  if (!wanted || !have) return { ok: false, reason: 'bad-format' }
  for (let index = 0; index < 3; index += 1) {
    if (have[index] > wanted[index]) return { ok: true }
    if (have[index] < wanted[index]) return { ok: false, reason: 'too-old' }
  }
  return { ok: true }
}

function parseVersion(value) {
  const matched = VERSION_RE.exec(text(value).trim())
  if (!matched) return null
  return [Number(matched[1]), Number(matched[2]), Number(matched[3])]
}

/**
 * 三个加载器共用的一处闸门：把「字段缺失／格式坏／版本不够」翻译成各自的错误码。
 * 返回 { skip, warning, message }：
 *   - 缺字段          → { skip:false, warning:null }（向后兼容，不校验）
 *   - 格式坏          → { skip:false, warning:{code:`${prefix}_MIN_VERSION_BAD`, …} }（照常加载）
 *   - 要求 > 当前      → { skip:true, message }（调用方按「跳过加载」处理）
 */
export function minVersionGate(required, current, { prefix, label = '插件', where = '' } = {}) {
  const want = text(required).trim()
  if (!want) return { skip: false, warning: null, message: '' }
  const verdict = satisfiesMinVersion(want, current)
  if (verdict.reason === 'bad-format') {
    // 分清是谁坏：应用版本读不到时，别把锅甩给插件字段
    const appBroken = !parseVersion(current)
    return {
      skip: false,
      message: '',
      warning: {
        code: `${prefix}_MIN_VERSION_BAD`,
        dir: where,
        message: appBroken
          ? `读不到应用版本（package.json 的 version 缺/非 x.y.z，当前 ${text(current).trim() || '(空)'}），${label}的 minOpenStoryVersion（${want}）暂不校验：${where}`
          : `${label}的 minOpenStoryVersion 不是 x.y.z 三段数字（${want}），按不校验处理：${where}`
      }
    }
  }
  if (!verdict.ok) {
    return {
      skip: true,
      warning: null,
      message: `${label}需要 OpenStory ${want}，当前是 ${text(current).trim() || '(未知)'}`
    }
  }
  return { skip: false, warning: null, message: '' }
}

