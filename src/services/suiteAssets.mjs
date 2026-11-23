/**
 * 套件资产静态服务（OS-95，OS-141 daemon 拆分落位）——page 模式设置页的同源装载。
 *
 *   · GET /suite-assets/_tokens.css：宿主 UI 令牌桥——插件页跑在同源 iframe 里拿不到
 *     父文档的 CSS 变量，宿主主动下发一套具体 px 的令牌（跟随 ?theme=dark 换暗色基底）。
 *   · GET /suite-assets/<id>/<相对路径>：套件自带页同源装载，只读＋路径安全化（≤2MB）。
 * 全仓只此一份定义；daemon 静态托管从这里 import，不许复制。
 */
import { createReadStream, statSync } from 'node:fs'
import { extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { API_ERROR_CODES } from '../api/contracts.mjs'
import { sendError, text } from '../host/http.mjs'
import { loadSuites } from './suites.mjs'

/** 套件资产 MIME（page 模式自带页同源装载）。 */
const SUITE_ASSET_MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2'
})
const SUITE_ASSET_MAX = 2 * 1024 * 1024

/** 套件资产路径解析（纯函数，供单测直打逃逸闸）：合法＝{ok, abs}，否则 {ok:false, code, message}。 */
export function resolveSuiteAssetPath(suiteDir, relPath) {
  const raw = text(relPath).replaceAll('\\', '/')
  const segments = raw.split('/')
  if (!raw || segments.some((part) => !part || part === '.' || part === '..' || part.startsWith('.'))) {
    return { ok: false, code: API_ERROR_CODES.PATH_ESCAPE, message: `套件资产路径不合法：${raw}` }
  }
  const target = join(resolve(text(suiteDir)), ...segments)
  const rel = relative(resolve(text(suiteDir)), target)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return { ok: false, code: API_ERROR_CODES.PATH_ESCAPE, message: `套件资产越出套件目录：${raw}` }
  }
  return { ok: true, abs: target }
}

/**
 * OS-95：给套件 iframe 用的令牌样式表（具体 px，不依赖父文档变量继承）。
 * 插件页 link 它即可获得与宿主一致的配色/字号/间距/圆角。
 * 档位取标准档（紧凑/大/特大由宿主设置驱动；iframe 内按标准档下发，
 * 因为插件页通常只有少量表单，跨档缩放的收益小于一致性）。
 */
export function suiteTokensCss({ dark = false } = {}) {
  const bg = dark ? '#1c1b1a' : '#ffffff'
  const ink = dark ? '#f2efe9' : '#222222'
  const soft = dark ? '#242321' : '#faf9f7'
  const ink2 = dark ? '#d8d3ca' : '#3d3a36'
  const muted = dark ? '#a39d94' : '#6f6a63'
  const meta = dark ? '#7a746c' : '#a39d94'
  const line = dark ? '#3a3733' : '#e7e3dd'
  const hair = dark ? '#2e2b28' : '#f0ede8'
  return `/* OpenStory UI tokens for suite iframes (OS-95)${dark ? ' · dark' : ''} */
:root {
  --ui-scale: 1;
  --ui-fs-2xs: 10px; --ui-fs-xs: 11px; --ui-fs-sm: 12px; --ui-fs-md: 13px;
  --ui-fs-base: 14px; --ui-fs-lg: 16px; --ui-fs-xl: 18px; --ui-fs-2xl: 22px;
  --ui-lh-tight: 1.35; --ui-lh-normal: 1.6; --ui-lh-loose: 1.75;
  --ui-ctl-h: 32px; --ui-ctl-px: 12px; --ui-row-py: 6px;
  --ui-gap-3xs: 2px; --ui-gap-2xs: 4px; --ui-gap-xs: 6px; --ui-gap-sm: 8px;
  --ui-gap-md: 12px; --ui-gap-lg: 16px; --ui-gap-xl: 20px; --ui-gap-2xl: 24px;
  --bg: ${bg}; --soft: ${soft};
  --ink: ${ink}; --ink-2: ${ink2}; --muted: ${muted}; --meta: ${meta};
  --line: ${line}; --hair: ${hair};
  --accent: #ff385c; --accent-hover: #e31c5f; --accent-soft: ${dark ? '#2b1f22' : '#fff1f3'};
  --ok: #008a05; --danger: #c13515; --warn: #c48a00; --warn-ink: #a06a00;
  --on-accent: #ffffff;
  --radius: 10px; --radius-md: 14px; --radius-lg: 20px; --pill: 999px;
  --sans: -apple-system, BlinkMacSystemFont, "Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif;
  --serif: "Noto Serif SC", "Songti SC", Georgia, serif;
  --mono: "SF Mono", "Cascadia Code", Consolas, monospace;
}
`
}

/** 套件资产（page 模式自带设置页同源装载）：GET /suite-assets/<id>/<相对路径>，只读＋路径安全化。 */
export async function serveSuiteAsset(req, res, suitesDirs, id, relPath) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `套件资产只支持 GET：${req.method}`)
  }
  const { suites } = loadSuites(suitesDirs)
  const suite = suites.find((item) => item.id === id)
  if (!suite) return sendError(res, API_ERROR_CODES.NOT_FOUND, `货架上没有这个套件：${id}`)
  const resolved = resolveSuiteAssetPath(suite.dir, relPath)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message)
  let stats
  try {
    stats = statSync(resolved.abs)
  } catch {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `套件资产不存在：${relPath}`)
  }
  if (!stats.isFile() || stats.size > SUITE_ASSET_MAX) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `套件资产不是文件或超过 2MB：${relPath}`)
  }
  res.writeHead(200, {
    'content-type': SUITE_ASSET_MIME[extname(resolved.abs).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stats.size,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff'
  })
  createReadStream(resolved.abs).pipe(res)
}

/**
 * daemon 静态托管的 /suite-assets 前缀分流（OS-95 令牌桥＋套件资产两支合一）。
 * 路由形状与拆分前逐字符一致：_tokens.css 特判在前，其余按 /<id>/<路径> 解析。
 */
export async function serveSuiteRequest(req, res, url, suitesDirs) {
  if (url.pathname === '/suite-assets/_tokens.css') {
    // OS-95：跟随宿主当前皮肤——?theme=dark 时下发暗色基底，
    // 否则 iframe 内的深墨文字会落在夜皮的黑底上（实测肉眼看不见）。
    const dark = url.searchParams.get('theme') === 'dark'
    const css = suiteTokensCss({ dark })
    res.writeHead(200, {
      'content-type': 'text/css; charset=utf-8',
      'cache-control': 'no-store'
    })
    res.end(css)
    return
  }
  const rest = url.pathname.slice('/suite-assets/'.length)
  const slash = rest.indexOf('/')
  const suiteId = slash > 0 ? rest.slice(0, slash) : ''
  const relPath = slash > 0 ? rest.slice(slash + 1) : ''
  if (!suiteId || !relPath) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, '套件资产路径形如 /suite-assets/<id>/<文件>')
  }
  return serveSuiteAsset(req, res, suitesDirs, decodeURIComponent(suiteId), decodeURIComponent(relPath))
}
