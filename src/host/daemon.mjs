#!/usr/bin/env node
/**
 * OpenStory daemon（OS-1/4）——轻 Node HTTP 服务，OpenStory 工作台的唯一磁盘层。
 *
 * 四件事：
 *   1) 静态托管 `openstory/public/`（index.html ＋ app.js）＋套件资产（OS-95）；
 *   2) 文件绑定 API（库 / 条目 / 正文 / wiki）——端点行为在 src/api/handlers/ 八域文件
 *      （OS-141 拆分：与 contracts/ 八域一一对应，src/api/registry.mjs 合成一张表），
 *      读走 S1 `factFileStore`，写走 hostWrite/chapterWrite（本文件不重写任何写协议）；
 *   3) Agent 通道（OS-4）：会话 JSONL（`agentStore.mjs`）＋ OpenAI 兼容上游流式转发
 *      （实现在 handlers/agent.mjs）；端点/模型/key 只存 daemon 本机配置，任何响应不回显完整 key；
 *   4) daemon 不做工具循环：模型读不到库文件，除非作者粘贴（v1 边界，诚实标注）。
 *
 * 本文件只留服务器框架（OS-141 收缩）：路由分派（endpointFor → validateRequest → 取
 * handler → 调用）、请求解析与来源防护（OS-136 四道闸）、单实例锁与 stamp 与 health、
 * 静态托管。共享管线在 src/host/{http,authorize,sse}.mjs，全仓只此一份定义。
 *
 * 三条硬边界：
 *   · 只绑 127.0.0.1（不监外网，对齐 OpenDesign sidecar）；不做 HTTPS/隧道/多用户。
 *     OS-136 来源防护四层闸：Host（全局）／Origin／Sec-Fetch-Site（/api）只认本机回环，
 *     带 body 必须 application/json——作者浏览器里的任意网页都写不进本机 daemon。
 *   · `root` 必须命中库清单（`%LOCALAPPDATA%/OpenStory/libraries.json` 的 libraries）
 *     或启动时显式 `--root=` 授权；文件路径 resolve 后必须落在 root 内（照 S2 的路径逃逸拒收写法）。
 *   · 正文写入不做 revision 闸（v1 边界）：OpenStory 与 Electron 同时写同一库时，只有写前
 *     `.history/<file>.bak-<时间戳>` 这层粗保护。真正的冲突保护归后续写协议接入。
 *
 * 启动：`node src/host/daemon.mjs [--port=8807] [--root=<库路径>]`（OS-159 起仓根零垫片）
 */
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, statSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  API_ERROR_CODES,
  ENDPOINTS,
  endpointFor,
  isPlainObject,
  validateRequest
} from '../api/contracts.mjs'
import { HANDLERS } from '../api/registry.mjs'
import { sendError, sendJson, readJson, text, DEFAULT_PORT } from './http.mjs'
import { canonicalRoot, createRootAllowlist, loadLibraries, resolveInsideRoot } from './authorize.mjs'
import { serveSuiteRequest } from '../services/suiteAssets.mjs'
import { defaultAgentConfigPath, defaultSessionsDir } from '../protocol/agentStore.mjs'
import { builtinStylesDir, defaultUserStylesDir } from '../services/stylePacks.mjs'
import { builtinRuntimesDir, defaultUserRuntimesDir, stopAllSidecars } from '../services/runtimes.mjs'
import { builtinSuitesDir, defaultSuiteStatePath, defaultUserSuitesDir } from '../services/suites.mjs'
import { builtinGenresDir, defaultUserGenresDir } from '../services/genres.mjs'
import { builtinSkillsDir, defaultUserSkillsDir } from '../services/skills.mjs'
import { bootstrapKbHealth } from '../protocol/knowledgeHealth.mjs'
import { defaultKbConfigPath } from '../protocol/knowledgeAdapter.mjs'
import { resolveCollections } from '../protocol/knowledgeRouter.mjs'
import { isModuleDisabledFor, moduleDegradationFor, moduleManifest } from '../protocol/modules.mjs'
import { ensureLibraryUpgraded } from '../protocol/libraryUpgrade.mjs'

/* ---------- 测试/工具面的再出口（OS-140 垫片契约）：实现迁走了，符号从原处继续拿 ---------- */
export { browseMemoryPath, defaultBrowseRoot } from '../services/nativePicker.mjs'
export { defaultPreferencesPath, loadLibraries, createRootAllowlist, resolveInsideRoot } from './authorize.mjs'
export { listArtifacts, listLibraryFiles } from '../protocol/libraryInventory.mjs'
export {
  historyBackupPath,
  mapWriteErrorCode,
  moduleOfPath,
  HISTORY_KEEP_DEFAULT,
  pruneHistoryBackups,
  resolveHistoryKeepPerFile
} from '../protocol/chapterWrite.mjs'
export { lintHabits } from '../protocol/habits.mjs'
export { resolveSuiteAssetPath } from '../services/suiteAssets.mjs'
import { systemPromptFor } from '../services/systemPrompt.mjs'
import { courtyardPath } from './courtyard.mjs'
/** 测试钩子（OS-45）：把 systemPromptFor 暴露给单测，验「世界书只给链接不给全文」。 */
export const __test = { systemPromptFor }

/** OS-140 布局归一：本文件从仓根迁到 src/host/——HERE＝本文件目录（src/host），
 * REPO_ROOT＝仓根（public/ 与货架数据目录、kb-config 都以仓根定位）。 */
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = join(HERE, '..', '..')
export { DEFAULT_PORT }
export const DEFAULT_PUBLIC_DIR = join(REPO_ROOT, 'public')
/** C5b：浏览器兼容叶只精确转供这一份 src 纯引擎，不开放整个 src/ 静态树。 */
const TEXT_ENGINE_URL = '/src/modules/text/analysis.mjs'
const TEXT_ENGINE_FILE = join(REPO_ROOT, 'src', 'modules', 'text', 'analysis.mjs')
/** OS-80：当前监听的真实端口（port=0 时由系统分配）——handler 里要拼回环 URL 用。
 * 由 startDaemon 的 listen 回调写，handler 读。 */
let __currentPort = DEFAULT_PORT
function currentPort() { return __currentPort }
/** OS-127 进程治理：本 daemon 进程的代际与启动时刻，/api/health 读这里。
 * CLI 启动序列的单实例闸会覆写成锁里的值（generation≥1）；测试内嵌 startDaemon()
 * 不走闸，generation 保持 0（整数即可过契约），startedAt 用 listen 成功时刻兜底。
 * OS-188：运行时对象归 processServices，base.process 与 health 读同一份。 */
import { PROCESS_RUNTIME as DAEMON_RUNTIME } from './processServices.mjs'
const MAX_STATIC_BYTES = 8 * 1024 * 1024

const MIME = Object.freeze({
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2'
})

/* ---------- OS-127 进程治理：单实例锁（对标 @open-design/sidecar 最小集） ----------
 * 背景事故 OS-93：多 daemon 竞听 8807，页面拿到混合包、卡片点不了。
 * 闸门三步：启动前读锁探活（活着→友好退出）／陈旧→抢占（generation=旧值+1）／
 * 监听成功后回写 stamp（boundPort）；SIGINT/SIGTERM/beforeExit 清掉 pid 占位。
 * 边界（诚实标注）：本闸挡的是「先后起两个 daemon」（双开、Electron 重启叠加），
 * 不承诺同毫秒并发起跑的互斥——那需要 O_EXCL 抢锁，超出本最小集。 */

/** 锁文件路径：%LOCALAPPDATA%/OpenStory/openstory/daemon.lock（本机一级，与库无关，
 *  与 agent-config.json 同院）。env 注入是为了测试隔离（子进程换 LOCALAPPDATA 不碰真机锁）。 */
export function daemonLockPath(env = process.env) {
  return courtyardPath(env, 'openstory', 'daemon.lock')
}

/** pid 探活（signal 0）：不存在→ESRCH；存在但没权限→EPERM（也算活着）。
 * pid 非正整数一律视为死（清锁后的占位 pid=0 走这条）。 */
function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return error?.code === 'EPERM'
  }
}

/** 读锁：缺档/坏档/形状不对一律当无锁（previous=null），由调用方按首启或抢占处理。 */
export function readDaemonLock(lockPath) {
  try {
    const parsed = JSON.parse(readFileSync(lockPath, 'utf-8'))
    if (isPlainObject(parsed) && Number.isInteger(parsed.pid)) return parsed
  } catch { /* 缺档或坏档＝无有效锁 */ }
  return null
}

function writeDaemonLock(lockPath, lock) {
  mkdirSync(dirname(lockPath), { recursive: true })
  writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n', 'utf-8')
}

/**
 * 单实例闸：CLI 启动序列最前面调（isMain 块，startDaemon 之前）。
 *  · 锁活着 → { ok:false, lock }——调用方打印「已在运行」并 exit(0)（友好退出，不是报错崩栈）；
 *  · 锁陈旧（pid 死了）→ 抢占，generation = 旧值+1；
 *  · 无锁/坏档 → 首启 generation = 1（坏档不继承旧代际：内容不可信就从头数）；
 *  · 连 LOCALAPPDATA 都没有 → 无处落锁，放行启动并在 stderr 喊一声（不治理但留痕）。
 * 锁写失败（盘只读等）同样放行：治理是尽力而为的护栏，不能反过来挡住 daemon 起来。
 */
export function acquireDaemonLock({ env = process.env, port = DEFAULT_PORT } = {}) {
  const lockPath = daemonLockPath(env)
  if (!lockPath) {
    console.error('[daemon.lock] 找不到 LOCALAPPDATA，无处落单实例锁，跳过进程治理闸')
    return { ok: true, lock: null, lockPath: '', preempted: false }
  }
  const previous = readDaemonLock(lockPath)
  if (previous && pidAlive(previous.pid)) {
    return { ok: false, lock: previous, lockPath, preempted: false }
  }
  const generation = previous && Number.isInteger(previous.generation) && previous.generation > 0
    ? previous.generation + 1
    : 1
  const lock = { pid: process.pid, port, generation, startedAt: new Date().toISOString() }
  try {
    writeDaemonLock(lockPath, lock)
  } catch (error) {
    console.error(`[daemon.lock] 写锁失败，跳过单实例闸：${text(error?.message || error)}`)
    return { ok: true, lock: null, lockPath, preempted: false }
  }
  return { ok: true, lock, lockPath, preempted: Boolean(previous) }
}

/** 监听成功后回写 stamp（boundPort＝真实端口；--port=0 由系统分配时，锁里也有端口可查）。 */
export function stampDaemonLock({ env = process.env, port, lock }) {
  const lockPath = daemonLockPath(env)
  if (!lockPath || !lock) return false
  try {
    writeDaemonLock(lockPath, { ...lock, boundPort: port })
    return true
  } catch (error) {
    console.error(`[daemon.lock] 回写 stamp 失败：${text(error?.message || error)}`)
    return false
  }
}

/**
 * 清锁（SIGINT/SIGTERM/beforeExit 调）：清的是 pid 占位（pid→0），generation 与
 * startedAt 留在档上——下一次启动读到「pid 不活」的锁才能继承 generation+1；
 * 若这里直接删文件，代际就断了（重启永远回到 1），多代识别（OS-127 的目标）落空。
 */
export function clearDaemonLock(env = process.env) {
  const lockPath = daemonLockPath(env)
  const lock = lockPath ? readDaemonLock(lockPath) : null
  if (!lock || lock.pid === 0) return false
  try {
    writeDaemonLock(lockPath, { ...lock, pid: 0 })
    return true
  } catch {
    return false
  }
}

/* ---------- 来源防护（OS-136）---------- */

/**
 * 四层纵深闸，堵「作者浏览器里的任意网页向 127.0.0.1:8807 跨站盲写」的洞
 * （text/plain 表单 PUT/POST 属于 CORS 简单请求，不过预检就能把 body 送进来，
 * 只是读不到响应；再叠加 DNS 重绑定可以让恶意页面「读得到」）：
 *   ① Host 闸（全局，含静态资源）：只认回环名＋实际绑定端口
 *      （127.0.0.1:端口 / localhost:端口 / [::1]:端口），否则 403——防 DNS 重绑定；
 *   ② Origin 闸（/api）：带 Origin 头且不是本机回环源（含 `Origin: null`）→ 403；
 *      不带 Origin 的放行（node fetch、curl、mcp.mjs 这类 stdio 进程调 daemon）；
 *   ③ Sec-Fetch-Site 闸（/api）：带头且值不是 same-origin / none → 403；
 *   ④ content-type 闸（/api）：带 body 的请求必须是 application/json
 *      （允许 charset 等参数后缀），否则 400——application/json 不在 CORS 安全清单里，
 *      跨站带它会触发预检，而 daemon 不回任何 CORS 头，预检必死。
 * 同源页面四层天然全过：GET 不带 Origin，POST/PUT 带同源 Origin＋same-origin 标。
 */
/** 请求是否真的带了 body（有 content-length>0 或 transfer-encoding 才算）。 */
function requestHasBody(req) {
  const contentLength = Number(req.headers['content-length'])
  if (Number.isSafeInteger(contentLength) && contentLength > 0) return true
  return Boolean(text(req.headers['transfer-encoding']).trim())
}

/** ① Host 闸：DNS 重绑定会把任意域名解析到 127.0.0.1，Host 一眼就能看穿。 */
function hostGateFail(req, port) {
  const host = text(req.headers.host).trim().toLowerCase()
  if (host === `127.0.0.1:${port}` || host === `localhost:${port}` || host === `[::1]:${port}`) return null
  return {
    code: API_ERROR_CODES.FORBIDDEN_ORIGIN,
    message: `Host 不在回环白名单（只认 127.0.0.1 / localhost / [::1] 加本服务端口 ${port}）：${host || '（缺失）'}`
  }
}

/** ② Origin 闸：浏览器跨站请求必带 Origin（或 null）；本机进程不带 Origin，不受影响。 */
function originGateFail(req, port) {
  const origin = text(req.headers.origin).trim()
  if (!origin) return null
  if (origin === `http://127.0.0.1:${port}` || origin === `http://localhost:${port}`) return null
  return {
    code: API_ERROR_CODES.FORBIDDEN_ORIGIN,
    message: `Origin 非本机回环源（http://127.0.0.1:${port} / http://localhost:${port} 之外一律拒）：${origin}`
  }
}

/** ③ Sec-Fetch-Site 闸：浏览器自带的请求上下文标，cross-site / same-site 都不放行。 */
function secFetchSiteGateFail(req) {
  const site = text(req.headers['sec-fetch-site']).trim().toLowerCase()
  if (!site) return null
  if (site === 'same-origin' || site === 'none') return null
  return {
    code: API_ERROR_CODES.FORBIDDEN_ORIGIN,
    message: `Sec-Fetch-Site 非同源（只放行 same-origin / none）：${site}`
  }
}

/** ④ content-type 闸：text/plain / multipart 等简单请求通道就此关闭。 */
function contentTypeGateFail(req) {
  if (!requestHasBody(req)) return null
  const mediaType = text(req.headers['content-type']).trim().toLowerCase().split(';')[0].trim()
  if (mediaType === 'application/json') return null
  return {
    code: API_ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
    message: `带 body 的请求必须 content-type: application/json（收到：${mediaType || '（缺失）'}）`
  }
}

/* ---------- 静态托管 ---------- */

async function serveStatic(req, res, url, publicDir) {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '静态路径编码不合法')
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  const resolved = pathname === TEXT_ENGINE_URL
    ? { ok: true, path: TEXT_ENGINE_FILE }
    : resolveInsideRoot(publicDir, pathname.replace(/^\/+/u, ''), { allowMetadata: true })
  if (!resolved.ok) {
    return sendError(res, API_ERROR_CODES.PATH_ESCAPE, '静态文件路径越界')
  }
  let stats
  try {
    stats = statSync(resolved.path)
  } catch {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `静态文件不存在：${pathname}`)
  }
  if (stats.isDirectory()) {
    return serveStatic(req, res, { pathname: `${pathname.replace(/\/+$/u, '')}/index.html` }, publicDir)
  }
  if (stats.size > MAX_STATIC_BYTES) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '静态文件过大')
  }
  res.writeHead(200, {
    'content-type': MIME[extname(resolved.path).toLowerCase()] ?? 'application/octet-stream',
    'content-length': stats.size,
    // no-store：代码/页面永远fresh——迭代批次密集时浏览器拿旧包会让作者看到「老的东西」
    'cache-control': /\.(html|js|css|mjs)$/iu.test(resolved.path) ? 'no-store' : 'no-cache'
  })
  createReadStream(resolved.path).pipe(res)
}

/* ---------- 路由分派（OS-141：契约解析 → 契约校验 → 取 handler → 调用）---------- */

/** 这些端点从 HTTP query 取参（其余读 JSON body）。与契约 request.query 不完全重合
 *  （jobsGet 一类 GET 端点契约写了 query、实现仍读 body——拆分前即如此，原样保留）。 */
// query 端点从契约自动推导（OS-160）：任何端点声明 request.query 就走 URL query 解析，
// 不再手抄一份集合——OS-160 给 suitesGet 加 root 时曾漏登记，读不到库级套件状态。
const ENDPOINT_HAS_QUERY = new Set(Object.entries(ENDPOINTS).filter(([, e]) => e.request && e.request.query).map(([id]) => id))

async function handleApi(req, res, url, context) {
  const endpointId = endpointFor(req.method, url.pathname)
  if (!endpointId) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `没有这个端点：${req.method} ${url.pathname}`)
  }

  // 免输入解析的早退端点（与拆分前同序）：
  //   healthGet——OS-127 探活要轻，先于库清单读取（这是「还没授权 root」时唯一有用的 API）；
  //   libraries——直接用下面读好的库清单，不收请求体。
  if (endpointId === 'healthGet') {
    return HANDLERS.healthGet({ req, res, url, context })
  }

  const loaded = loadLibraries({ preferencesPath: context.preferencesPath, env: context.env })
  const allowlist = createRootAllowlist(loaded.libraries, context.extraRoots)

  if (endpointId === 'libraries') {
    return HANDLERS.libraries({ req, res, url, context, loaded })
  }

  let input
  if (ENDPOINT_HAS_QUERY.has(endpointId)) {
    input = Object.fromEntries(url.searchParams.entries())
  } else {
    try {
      input = await readJson(req)
    } catch (error) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, text(error?.message || error))
    }
  }

  const checked = validateRequest(endpointId, input)
  if (!checked.ok) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '请求参数不符合契约', { errors: checked.errors })
  }

  const handler = HANDLERS[endpointId]
  if (!handler) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `端点未实现：${endpointId}`)
  }
  // OS-172：旧库必须在模块开关（会读 ui-state）与任何业务 handler 之前完成一次性升级。
  // 只迁移请求显式指定且已授权的 root，不顺手碰默认库或清单里的其它库。
  const requestedRoot = typeof checked.value?.root === 'string' ? allowlist.resolve(checked.value.root.trim()) : null
  let libraryUpgrade = null
  if (requestedRoot) {
    libraryUpgrade = await ensureLibraryUpgraded(requestedRoot)
    if (!libraryUpgrade.ok) {
      return sendError(res, API_ERROR_CODES.LIBRARY_UPGRADE_FAILED, libraryUpgrade.message, {
        phase: libraryUpgrade.phase, rolledBack: libraryUpgrade.rolledBack, rollbackErrors: libraryUpgrade.rollbackErrors
      })
    }
  }
  // OS-144 模块插件闸：独占端点所属模块被停用 → MODULE_DISABLED（共用端点没有归属，照常放行）。
  // 库根取法（OS-146）：请求 root（已授权）优先——多库时按调用方自己的库判定；
  // 启动默认库/库清单第一条只是没带 root 时的兜底，不是语义。一个库都没有时无法判定，按启用处理。
  const owner = await isModuleDisabledFor(endpointId, moduleGateRoot(checked.value, context, allowlist))
  if (owner) {
    const label = moduleManifest(owner)?.name ?? owner
    return sendError(res, API_ERROR_CODES.MODULE_DISABLED, `「${label}」模块已停用——重新启用后可用，已存的值与数据都还在`)
  }
  const degraded = await moduleDegradationFor(endpointId, moduleGateRoot(checked.value, context, allowlist))
  if (degraded) {
    const label = moduleManifest(degraded.module)?.name ?? degraded.module
    return sendError(res, API_ERROR_CODES.PLUGIN_DEGRADED, `「${label}」缺少所需能力，当前不可用`, degraded)
  }
  return handler({ req, res, url, request: checked.value, context, allowlist, loaded, libraryUpgrade })
}

/** 模块停用闸的库根解析（ui-state 是库内状态，没有库就只有缺省启用）。
 *  ① 请求里的 root（本机库清单之内才算数）＝**语义**：多库时按调用方所在的库判定；
 *  ② 请求没带 root 才落到「启动默认库 ＞ 库清单第一条」——这是**兜底**（老调用/命令行），
 *     不代表「按某个库的意思」；新调用方（kb 四端点等）一律带 root，别依赖兜底。 */
function moduleGateRoot(request, context, allowlist) {
  const given = typeof request?.root === 'string' ? request.root.trim() : ''
  if (given) return allowlist.resolve(given) || ''
  const fallback = context.defaultRoot ? allowlist.resolve(context.defaultRoot) : null
  return fallback || allowlist.roots[0] || ''
}

/* ---------- 服务器 ---------- */

export function createOpenStoryHandler({
  publicDir = DEFAULT_PUBLIC_DIR,
  preferencesPath,
  extraRoots = [],
  defaultRoot = '',
  agentConfigPath = null,
  agentSessionsDir = null,
  stylesDirs = null,
  runtimesDirs = null,
  suitesDirs = null,
  suiteStatePath = null,
  genresDirs = null,
  skillsDirs = null,
  env = process.env
} = {}) {
  // 默认路径在体内解析（不能用参数默认值——那里的 env 还是调用方进程的，注入覆盖会失效）。
  const resolvedConfigPath = agentConfigPath ?? defaultAgentConfigPath(env)
  const resolvedSessionsDir = agentSessionsDir ?? defaultSessionsDir(env)
  const resolvedStylesDirs = stylesDirs ?? [builtinStylesDir(), defaultUserStylesDir(env)]
  const resolvedRuntimesDirs = runtimesDirs ?? [builtinRuntimesDir(), defaultUserRuntimesDir(env)]
  const resolvedSuitesDirs = suitesDirs ?? [builtinSuitesDir(), defaultUserSuitesDir(env)]
  const resolvedSuiteStatePath = suiteStatePath ?? defaultSuiteStatePath(env)
  const resolvedGenresDirs = genresDirs ?? [builtinGenresDir(), defaultUserGenresDir(env)]
  const resolvedSkillsDirs = skillsDirs ?? [builtinSkillsDir(), defaultUserSkillsDir(env)]
  return async function handler(req, res, boundPort = null) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    /* OS-136：端口以「收到这个请求的 server 实例实际绑定的端口」为准（同一进程嵌多个
     * daemon 的测试里，模块级 __currentPort 只记最后一个，不能当闸的依据）。 */
    const port = Number.isSafeInteger(boundPort) && boundPort > 0 ? boundPort : currentPort()
    try {
      /* OS-136 ① Host 闸（全局，含静态资源与套件资产）：回环名＋实际绑定端口之外一律 403。
       * 放在最前面——DNS 重绑定对静态资源同样成立（读得到 app.js 就读得到一切）。 */
      const hostFail = hostGateFail(req, port)
      if (hostFail) return sendError(res, hostFail.code, hostFail.message)
      /* OS-95：套件前端令牌桥与资产同源装载（实现在 services/suiteAssets.mjs）。 */
      if (url.pathname === '/suite-assets/_tokens.css' || url.pathname.startsWith('/suite-assets/')) {
        return await serveSuiteRequest(req, res, url, resolvedSuitesDirs)
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        /* OS-136 ②③④ /api 来源闸：Origin → Sec-Fetch-Site → content-type，过了才进契约分派。 */
        const gateFail = originGateFail(req, port)
          ?? secFetchSiteGateFail(req)
          ?? contentTypeGateFail(req)
        if (gateFail) return sendError(res, gateFail.code, gateFail.message)
        return await handleApi(req, res, url, {
          port,
          preferencesPath,
          extraRoots,
          defaultRoot,
          agentConfigPath: resolvedConfigPath,
          agentSessionsDir: resolvedSessionsDir,
          stylesDirs: resolvedStylesDirs,
          runtimesDirs: resolvedRuntimesDirs,
          suitesDirs: resolvedSuitesDirs,
          suiteStatePath: resolvedSuiteStatePath,
          genresDirs: resolvedGenresDirs,
          skillsDirs: resolvedSkillsDirs,
          env,
          // 进程事实（OS-127 healthGet 与 reference 异步生图回环用）：代际/启动时刻＋真实端口
          runtime: DAEMON_RUNTIME,
          currentPort
        })
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        return sendError(res, API_ERROR_CODES.NOT_FOUND, `静态托管只支持 GET/HEAD：${req.method}`)
      }
      return await serveStatic(req, res, url, publicDir)
    } catch (error) {
      if (res.headersSent) {
        res.end()
        return
      }
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `daemon 内部错误：${text(error?.message || error)}`)
    }
  }
}

export function startDaemon({
  port = DEFAULT_PORT,
  host = '127.0.0.1',
  root = '',
  publicDir = DEFAULT_PUBLIC_DIR,
  preferencesPath,
  extraRoots = [],
  agentConfigPath = null,
  agentSessionsDir = null,
  stylesDirs = null,
  runtimesDirs = null,
  suitesDirs = null,
  suiteStatePath = null,
  genresDirs = null,
  skillsDirs = null,
  env = process.env,
  logger = console
} = {}) {
  // 硬约束：只绑回环地址。传其他 host 也不接受，避免误开外网。
  const bindHost = host === '127.0.0.1' || host === 'localhost' ? '127.0.0.1' : '127.0.0.1'
  const authorizedExtras = [...extraRoots, ...(root ? [root] : [])]
  const handler = createOpenStoryHandler({
    publicDir,
    preferencesPath,
    extraRoots: authorizedExtras,
    defaultRoot: root ? canonicalRoot(root) : '',
    agentConfigPath,
    agentSessionsDir,
    stylesDirs,
    runtimesDirs,
    suitesDirs,
    suiteStatePath,
    genresDirs,
    skillsDirs,
    env
  })
  const server = createServer((req, res) => {
    // OS-136：请求到来时 server 必在监听，address() 就是本实例的真实端口（--port=0 也准）
    handler(req, res, server.address()?.port ?? null)
  })
  return new Promise((resolvePromise, rejectPromise) => {
    server.once('error', rejectPromise)
    server.listen(port, bindHost, () => {
      const actualPort = server.address().port
      __currentPort = actualPort
      // OS-127：CLI 闸已在启动前写好 generation/startedAt；测试内嵌 startDaemon 没走闸，
      // 这里兜底（generation 保持 0，startedAt 记 listen 成功时刻），/api/health 仍有整数可回。
      if (!DAEMON_RUNTIME.booted) {
        DAEMON_RUNTIME.startedAt = new Date().toISOString()
      }
      if (logger?.log) {
        logger.log(`OpenStory daemon → http://127.0.0.1:${actualPort}`)
        if (root) logger.log(`直接进入库：${resolve(root)}`)
      }
      // KB-ARCH P1：知识库服务自愈探活——kb-config 存在才管（测试临时环境无配置＝不启动），close 时停表不留悬挂定时器
      let kbHealthStop = null
      try {
        const health = bootstrapKbHealth({ env, repoRoot: REPO_ROOT, logger, defaultKbConfigPath, resolveCollections })
        if (health) kbHealthStop = health
      } catch { /* 不阻塞启动 */ }
      resolvePromise({
        server,
        port: actualPort,
        host: bindHost,
        close: () => new Promise((done) => {
          if (kbHealthStop) kbHealthStop()
          stopAllSidecars()
          server.close(() => done())
          // 关停不等客户端把响应读完：本地 daemon 的「停」就是立刻停。
          // 没读走的大响应（如 350KB 的 app.js）会把 keep-alive 连接留在 busy 态，
          // 光靠 server.close 会一直等——这里主动收掉空闲与在途连接。
          server.closeIdleConnections?.()
          server.closeAllConnections?.()
        })
      })
    })
  })
}

/* ---------- CLI ---------- */

export function parseArgs(argv = []) {
  const options = { port: DEFAULT_PORT, root: '', preferencesPath: '', help: false }
  const args = [...argv]
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index]
    if (arg === '--help' || arg === '-h') {
      options.help = true
      continue
    }
    if (arg.startsWith('--port=')) {
      options.port = Number(arg.slice('--port='.length))
      continue
    }
    if (arg === '--port') {
      options.port = Number(args[index + 1])
      index += 1
      continue
    }
    if (arg.startsWith('--root=')) {
      options.root = arg.slice('--root='.length)
      continue
    }
    if (arg === '--root') {
      options.root = args[index + 1] ?? ''
      index += 1
      continue
    }
    if (arg.startsWith('--preferences=')) {
      options.preferencesPath = arg.slice('--preferences='.length)
      continue
    }
  }
  if (!Number.isInteger(options.port) || options.port < 0 || options.port > 65535) {
    options.port = DEFAULT_PORT
  }
  return options
}

/* OS-140 布局归一：CLI 启动序列收成可导出的 main(argv)——本文件即启动入口（OS-159 起
 * 仓根零垫片），直跑判定（下方 isMain）走到这里；被纯 import 时只装载、不起服务。 */
export function main(argv = []) {
  const options = parseArgs(argv)
  if (options.help) {
    console.log('用法：node src/host/daemon.mjs [--port=8807] [--root=<库路径>] [--preferences=<libraries.json>]')
    process.exit(0)
  }
  /* OS-127 单实例闸（启动序列最前面，对标 @open-design/sidecar 最小集）：
   * 锁活着 → 打印在跑的 pid/端口/代际后 exit(0)（友好退出，不是报错崩栈）；
   * 锁陈旧 → 抢占，generation = 旧值+1。背景事故 OS-93：多 daemon 竞听 8807，
   * 页面拿到混合包——现在第二个实例根本起不来，-generation 让旧代可被识别。 */
  const lockGate = acquireDaemonLock({ env: process.env, port: options.port })
  if (!lockGate.ok) {
    const busy = lockGate.lock
    console.log(`OpenStory daemon 已在运行（pid ${busy.pid} · 端口 ${text(busy.boundPort ?? busy.port)} · generation ${busy.generation}）`)
    process.exit(0)
  }
  const activeLock = lockGate.lock
  if (activeLock) {
    DAEMON_RUNTIME.generation = activeLock.generation
    DAEMON_RUNTIME.startedAt = activeLock.startedAt
    DAEMON_RUNTIME.booted = true
    console.log(`OpenStory daemon 启动：pid ${process.pid} · generation ${activeLock.generation}${lockGate.preempted ? '（抢占陈旧锁）' : ''}`)
  }
  startDaemon({
    port: options.port,
    root: options.root,
    preferencesPath: options.preferencesPath || undefined
  }).then((daemon) => {
    // OS-127 stamp：监听成功后回写真实端口（--port=0 时与锁里 port 不同，boundPort 才是真相）
    if (activeLock) stampDaemonLock({ env: process.env, port: daemon.port, lock: activeLock })
    const shutdown = () => {
      // 先清 pid 占位再关服务：清完之后哪怕 close 卡住，新 daemon 也能立刻接位
      if (activeLock) clearDaemonLock(process.env)
      daemon.close().finally(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
    // 事件循环自然排空（罕见但存在）也清占位；process.exit() 不触发 beforeExit，
    // 与 shutdown 不构成双清。注意：Windows 下 child.kill() 是硬杀（TerminateProcess），
    // 这两个信号处理器不会跑——锁留着死 pid，靠下一轮「陈旧抢占」自愈（generation 照样 +1）。
    process.on('beforeExit', () => {
      if (activeLock) clearDaemonLock(process.env)
    })
  }).catch((error) => {
    // 监听失败（典型：EADDRINUSE，端口被一个没写锁的老 daemon 占着）：不用清锁——
    // 本进程写的 pid 马上就是死 pid，下一轮启动按陈旧抢占自愈。
    console.error(`OpenStory daemon 启动失败：${text(error?.message || error)}`)
    process.exit(1)
  })
}

/* 直跑判定（同款口径，OS-140 迁移前就在）：node 直接执行本文件时走 main（OS-159 起
 * 这是唯一入口，npm start 也指这里）。 */
const isMain = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (isMain) main(process.argv.slice(2))
