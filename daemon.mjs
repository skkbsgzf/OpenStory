#!/usr/bin/env node
/**
 * OpenStory daemon（OS-1/4）——轻 Node HTTP 服务，OpenStory 工作台的唯一磁盘层。
 *
 * 四件事：
 *   1) 静态托管 `openstory/public/`（index.html ＋ app.js）；
 *   2) 文件绑定 API（库 / 条目 / 正文 / wiki），读走 S1 `factFileStore`，写走 S2 `writeFactFile`
 *      （经 store 的 save/wikiDerive 转调，本文件不重写任何写协议）；
 *   3) Agent 通道（OS-4）：会话 JSONL（`agentStore.mjs`）＋ OpenAI 兼容上游流式转发；
 *      端点/模型/key 只存 daemon 本机配置（%LOCALAPPDATA%/PinaxNext/openstory/agent-config.json），
 *      任何响应不回显完整 key；待确认卡采纳走正文快照闸（创建→采纳窗口）＋与手工保存同一条原子写。
 *   4) daemon 不做工具循环：模型读不到库文件，除非作者粘贴（v1 边界，诚实标注）。
 *
 * 三条硬边界：
 *   · 只绑 127.0.0.1（不监外网，对齐 OpenDesign sidecar）；不做 HTTPS/隧道/多用户。
 *   · `root` 必须命中库清单（`%LOCALAPPDATA%/PinaxNext/next-preferences.json` 的 recentProjects）
 *     或启动时显式 `--root=` 授权；文件路径 resolve 后必须落在 root 内（照 S2 的路径逃逸拒收写法）。
 *   · 正文写入不做 revision 闸（v1 边界）：OpenStory 与 Electron 同时写同一库时，只有写前
 *     `.history/<file>.bak-<时间戳>` 这层粗保护。真正的冲突保护归后续写协议接入。
 *
 * 启动：`node openstory/daemon.mjs [--port=8807] [--root=<库路径>]`
 */
import { randomUUID } from 'node:crypto'
import { createReadStream, existsSync, mkdirSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import {
  API_ERROR_CODES,
  endpointFor,
  errorEnvelope,
  isPlainObject,
  normalizeLibraries,
  validateRequest,
  validateResponse
} from './contracts.mjs'
import {
  appendSession,
  buildUpstreamMessages,
  createSession,
  createSseDeltaParser,
  defaultAgentConfigPath,
  defaultSessionsDir,
  deleteSession,
  fileSnapshot,
  lastSessionId,
  listSessions,
  maskApiKey,
  newCardId,
  newMessageId,
  patchSessionMeta,
  readSession,
  renameSession,
  snapshotsMatch,
  updateCard
} from './agentStore.mjs'
import {
  builtinStylesDir,
  defaultUserStylesDir,
  loadStylePacks
} from './stylePacks.mjs'
import { isHexColor } from './stylePacks.mjs'
import {
  createChapter,
  deleteChapter,
  listChapters,
  renameChapter
} from './chapters.mjs'
import {
  builtinRuntimesDir,
  defaultUserRuntimesDir,
  ensureSidecar,
  loadRuntimeKits,
  probeRuntimeKit,
  sidecarRunning,
  stopAllSidecars
} from './runtimes.mjs'
import {
  builtinSkillsDir,
  craftInstructionBlock,
  defaultUserSkillsDir,
  loadSkills,
  suiteSkillDirs,
  readAgentPicks,
  writeAgentPicks,
  craftSkillsForPrompt,
  skillSummary,
  skillsForGenre
} from './skills.mjs'
import { precedentPromptSectionForGenre, resolveCollections } from './kbRouter.mjs'
import { bootstrapKbHealth, collectKbStatus, kbServiceState, probeServices } from './kbHealth.mjs'
import { defaultKbConfigPath } from './kbAdapter.mjs'
import {
  allowedDirs,
  briefPromptSection,
  builtinGenresDir,
  defaultUserGenresDir,
  loadGenres,
  readBrief,
  writeBrief
} from './genres.mjs'
import { runCliChat } from './cli-bridge.mjs'
import { detectDsh, detectDshAny, detectDshModels, probeDshStack, resolveDshChat, resolveDshRun, setupDshStack } from './dsh-bridge.mjs'
import { dshModelSelection, runDshStdio } from './dsh-cli.mjs'
import { projectLegacyFrame } from './agentEvents.mjs'
import {
  builtinSuitesDir,
  defaultSuiteStatePath,
  defaultUserSuitesDir,
  getSuiteStateData,
  listSuitesPublic,
  loadSuites,
  saveSuiteSettings,
  saveSuiteStateData,
  setSuiteEnabled,
  suiteValue
} from './suites.mjs'
import { listAllPlugins } from './plugins.mjs'
import {
  createLibrary,
  diagnoseLibrary,
  importLibrary,
  scanLibrary,
  setPrimaryCarrier
} from './libraryManage.mjs'
import { factStore } from './pinaxAdapter.mjs' // OS-125：内核唯一进口（S2.4），本仓其余模块不许直引 core/**
import { readChange, readLatestByFile, readLog, logSummary, recordChange, contentHash } from './changelog.mjs'
import { checkSameSource, snapshotAndDiff } from './syncCheck.mjs'
import { dropDraft, listDrafts, loadDraft, readUiState, saveDraft, writeUiState } from './libState.mjs'
import { absorbLegacyDirs, backlinksOf, buildReferenceGraph, REFERENCE_DIR, notesVisibleAt, scanReferences } from './referenceStore.mjs'
import { deduceOpening, deducePresent, deduceSettle, deduceStatePath, loadEntries } from './deduceEngine.mjs'
import { buildRoleplayMemory, compressMemory, deAiPass, roleplayOpening, roleplayTurn, shouldSummarize } from './roleplayEngine.mjs'
import { safeDeduceBookId } from './deduceSession.mjs'
import {
  appendNode,
  archiveChapter,
  createDeduceSession,
  DEDUCE_SESSION_SCHEMA,
  deleteDeduceSession,
  importLegacyDeduce,
  listDeduceSessions,
  loadDeduceSession,
  normalizeDeduceSession,
  readActiveSessionId,
  saveDeduceSession,
  writeActiveSessionId
} from './deduceSession.mjs'
import { factHealth } from './factGuard.mjs'
import { enrichBook, enrichGraph } from './enrichEngine.mjs'
import { generateViaComfy, probeComfy } from './comfyEngine.mjs'
import { pickFile, pickFolder, revealPath } from './nativePicker.mjs'
import { activeCount, cancelJob, clearSettled, getJob, listJobs, submitJob } from './jobCenter.mjs'

const enrichJobs = new Map()
const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PORT = 8807
/** OS-80：当前监听的真实端口（port=0 时由系统分配）——handler 里要拼回环 URL 用。
 * 由 startDaemon 的 listen 回调写，handler 读。 */
let __currentPort = DEFAULT_PORT
function currentPort() { return __currentPort }
/** OS-127 进程治理：本 daemon 进程的代际与启动时刻，/api/health 读这里。
 * CLI 启动序列的单实例闸会覆写成锁里的值（generation≥1）；测试内嵌 startDaemon()
 * 不走闸，generation 保持 0（整数即可过契约），startedAt 用 listen 成功时刻兜底。 */
const DAEMON_RUNTIME = { generation: 0, startedAt: '', booted: false }
export const DEFAULT_PUBLIC_DIR = join(HERE, 'public')
const MAX_JSON_BODY = 16 * 1024 * 1024
const MAX_STATIC_BYTES = 8 * 1024 * 1024
const METADATA_DIR = '.pinax'

/** 库内不许当页签目录的名字：元数据与备份目录。 */
const RESERVED_LIB_DIRS = new Set([METADATA_DIR, '.history', '.openstory', 'node_modules'])

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

const STATUS_BY_CODE = Object.freeze({
  NO_LIBRARY: 403,
  PATH_ESCAPE: 403,
  NOT_FOUND: 404,
  INVALID_ENTRY: 400,
  REVISION_MISMATCH: 409,
  WRITE_PROTOCOL_OPERATION_ID_REQUIRED: 400,
  WRITE_PROTOCOL_VALIDATION_FAILED: 422,
  WRITE_PROTOCOL_INVALID_INPUT: 400,
  WRITE_PROTOCOL_NOT_FOUND: 404,
  WRITE_PROTOCOL_IO_FAILED: 500,
  AGENT_NOT_CONFIGURED: 400,
  AGENT_UPSTREAM_ERROR: 502
})

function text(value) {
  return String(value ?? '')
}

/** OS-119：目录浏览器「上次选的文件夹」记忆（本机偏好，与库无关）。
 *  为什么放全局而不是库内 ui-state：新建库时还没有库可写，而「浏览」按钮在
 *  建库表单里就要用——所以只能落本机 %LOCALAPPDATA%/PinaxNext/openstory/。 */
export function browseMemoryPath(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'fs-browse.json') : ''
}

function readBrowseMemory(env = process.env) {
  const target = browseMemoryPath(env)
  if (!target) return { lastPicked: '', nativeDialog: '' }
  try {
    const raw = JSON.parse(readFileSync(target, 'utf-8'))
    return {
      lastPicked: text(raw?.lastPicked).trim(),
      // 原生框能力判定（OS-119）：本机这台机器上「上次试的结果」，跨 daemon 重启复用
      nativeDialog: text(raw?.nativeDialog).trim()
    }
  } catch {
    return { lastPicked: '', nativeDialog: '' }
  }
}

function writeBrowseMemory(patch, env = process.env) {
  const target = browseMemoryPath(env)
  if (!target) return
  try {
    const next = { ...readBrowseMemory(env), ...patch }
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, JSON.stringify(next, null, 2) + '\n', 'utf-8')
  } catch (error) {
    // 记不住不算错（浏览器照常能用），但要留痕——静默失败排查过一次就够
    console.error('[fs-browse] 记忆写入失败:', text(error?.message || error))
  }
}

/** 默认根：C 盘用户目录下的 OpenStory（作者口径「默认目录始终选择用户 C 盘的
 *  openstory project」）。不存在就建出来，省得每次从头选。 */
export function defaultBrowseRoot(env = process.env) {
  const home = text(env.USERPROFILE || env.HOME).trim()
  return home ? join(home, 'OpenStory') : ''
}

/* ---------- OS-127 进程治理：单实例锁（对标 @open-design/sidecar 最小集） ----------
 * 背景事故 OS-93：多 daemon 竞听 8807，页面拿到混合包、卡片点不了。
 * 闸门三步：启动前读锁探活（活着→友好退出）／陈旧→抢占（generation=旧值+1）／
 * 监听成功后回写 stamp（boundPort）；SIGINT/SIGTERM/beforeExit 清掉 pid 占位。
 * 边界（诚实标注）：本闸挡的是「先后起两个 daemon」（双开、Electron 重启叠加），
 * 不承诺同毫秒并发起跑的互斥——那需要 O_EXCL 抢锁，超出本最小集。 */

/** 锁文件路径：%LOCALAPPDATA%/PinaxNext/openstory/daemon.lock（本机一级，与库无关，
 *  与 agent-config.json 同院）。env 注入是为了测试隔离（子进程换 LOCALAPPDATA 不碰真机锁）。 */
export function daemonLockPath(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'daemon.lock') : ''
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
function readDaemonLock(lockPath) {
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

/* ---------- 库清单与 root 白名单 ---------- */

/** 与 Electron 库管理器同一份数据：%LOCALAPPDATA%/PinaxNext/next-preferences.json。 */
export function defaultPreferencesPath(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'next-preferences.json') : ''
}

/**
 * 读库清单。坏档/缺档不拦启动：按空清单回，并记一条 warning 让工作台摆空态。
 * `recentProjects` 真实形状只保底 path/name/at；kind/count 缺了补默认值。
 */
export function loadLibraries({ preferencesPath, env = process.env } = {}) {
  const target = text(preferencesPath || env.PINAX_OS_PREFERENCES || defaultPreferencesPath(env)).trim()
  const warnings = []
  if (!target) {
    return {
      libraries: [],
      warnings: [{ code: 'PREFERENCES_PATH_UNKNOWN', message: '找不到 LOCALAPPDATA，无法定位 next-preferences.json' }],
      preferencesPath: ''
    }
  }
  let raw
  try {
    raw = readFileSync(target, 'utf-8')
  } catch (error) {
    warnings.push({
      code: error?.code === 'ENOENT' ? 'PREFERENCES_MISSING' : 'PREFERENCES_UNREADABLE',
      path: target,
      message: error?.code === 'ENOENT'
        ? '库清单文件还不存在：先在 Pinax 里打开一个库'
        : `库清单文件读不了：${text(error?.message || error)}`
    })
    return { libraries: [], warnings, preferencesPath: target }
  }
  let document
  try {
    document = JSON.parse(raw)
  } catch (error) {
    warnings.push({ code: 'PREFERENCES_CORRUPT', path: target, message: `库清单不是有效 JSON：${text(error?.message || error)}` })
    return { libraries: [], warnings, preferencesPath: target }
  }
  if (!isPlainObject(document) || !Array.isArray(document.recentProjects)) {
    warnings.push({ code: 'PREFERENCES_SHAPE', path: target, message: '库清单缺少 recentProjects 数组' })
    return { libraries: [], warnings, preferencesPath: target }
  }
  const normalized = normalizeLibraries(document.recentProjects)
  return {
    libraries: normalized.libraries,
    warnings: [...warnings, ...normalized.warnings],
    preferencesPath: target
  }
}

function canonicalRoot(value) {
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

function rootKey(value) {
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

/* ---------- 路径安全 ---------- */

function pathFail(message, path) {
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

/** 写前备份路径：同目录 `.history/<file>.bak-<时间戳>`（不覆盖旧备份）。 */
export function historyBackupPath(root, file, now = new Date()) {
  const resolved = resolveInsideRoot(root, file)
  if (!resolved.ok) return resolved
  const stamp = now.toISOString().replace(/[:.]/gu, '-')
  return {
    ok: true,
    path: join(dirname(resolved.path), '.history', `${basename(resolved.path)}.bak-${stamp}`),
    relative: `${dirname(resolved.relative)}/.history/${basename(resolved.relative)}.bak-${stamp}`.replace(/^\.\//u, '')
  }
}

/* ---------- 写协议错误码透传 ---------- */

/**
 * S2 的失败码 → OpenStory 契约码。writeFail 会把内核码表里的码解析成 `PINAX_*`，
 * 这里剥前缀后按语义归并；未识别的写失败统一 WRITE_PROTOCOL_IO_FAILED（不假装成功）。
 */
export function mapWriteErrorCode(code) {
  const upper = text(code).trim().replace(/^PINAX_/u, '').toUpperCase()
  if (upper.includes('OPERATION_ID_REQUIRED')) return API_ERROR_CODES.WRITE_PROTOCOL_OPERATION_ID_REQUIRED
  if (upper.includes('VALIDATION_FAILED')) return API_ERROR_CODES.WRITE_PROTOCOL_VALIDATION_FAILED
  if (upper.includes('REVISION_MISMATCH')) return API_ERROR_CODES.REVISION_MISMATCH
  if (upper.includes('NOT_FOUND')) return API_ERROR_CODES.WRITE_PROTOCOL_NOT_FOUND
  if (upper.includes('INVALID_INPUT')) return API_ERROR_CODES.WRITE_PROTOCOL_INVALID_INPUT
  if (upper.includes('INVALID_ENTRY')) return API_ERROR_CODES.WRITE_PROTOCOL_VALIDATION_FAILED
  return API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED
}

function mapReadErrorCode(code) {
  const upper = text(code).trim().replace(/^PINAX_/u, '').toUpperCase()
  if (upper.includes('NOT_FOUND')) return API_ERROR_CODES.NOT_FOUND
  return API_ERROR_CODES.INVALID_ENTRY
}

/* ---------- HTTP 工具 ---------- */

function statusFor(code) {
  return STATUS_BY_CODE[code] ?? 500
}

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  res.end(body)
}

function sendError(res, code, message, details) {
  sendJson(res, statusFor(code), errorEnvelope(code, message, details))
}

function readBody(req, limit = MAX_JSON_BODY) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) {
        const error = new Error('请求体超过上限')
        error.code = 'BODY_TOO_LARGE'
        rejectPromise(error)
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectPromise)
  })
}

async function readJson(req) {
  const raw = await readBody(req)
  if (!raw.trim()) return {}
  try {
    return JSON.parse(raw)
  } catch (error) {
    const failure = new Error(`请求体不是有效 JSON：${text(error?.message || error)}`)
    failure.code = 'INVALID_JSON'
    throw failure
  }
}

async function serveStatic(req, res, url, publicDir) {
  let pathname
  try {
    pathname = decodeURIComponent(url.pathname)
  } catch {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '静态路径编码不合法')
  }
  if (pathname === '/' || pathname === '') pathname = '/index.html'
  const resolved = resolveInsideRoot(publicDir, pathname.replace(/^\/+/u, ''), { allowMetadata: true })
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

/* ---------- 业务处理 ---------- */

function mergeLibraryRoots(libraries, extraRoots) {
  const list = [...libraries]
  const seen = new Set(libraries.map((library) => rootKey(library.path)))
  for (const extra of extraRoots) {
    const root = canonicalRoot(extra)
    if (!root) continue
    const key = rootKey(root)
    if (seen.has(key)) continue
    seen.add(key)
    // --root 显式授权的库不在 recentProjects 里时也上屏，作者才能点得到。
    list.push({ path: root, name: basename(root) || root, kind: '未分类', count: 0, at: '' })
  }
  return list
}

function authorizeRoot(allowlist, requested) {
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

/**
 * 正文原子写（tmp＋rename）＋写前 .history 备份。`PUT /api/chapter`（手工保存）与
 * 待确认卡采纳共用同一条实现，保证两条路的落盘行为完全一致。
 */
/* ---------- 习惯表（OS-57）：本库的写作习惯——正向＋负向词条，Agent 成文前必读 ----------
 * 定位（作者口径）：原「参考/约束」里的规则类内容移到这里。世界书只管创作型条目
 * （人物/场景/事件），规则归习惯。
 * 形态：描述性自定义表单。必含正向（惯用词/描述公式）与负向（禁用词/禁用句式/禁用修辞）。
 * 存储：习惯/habits.json（库内），原子写＋.history 备份（与正文同一可逆语义）。
 */
const HABITS_SCHEMA = 'openstory.habits/v1'
const HABITS_DEFAULT = {
  schema: HABITS_SCHEMA,
  tone: 'direct',
  style: '',
  bannedWords: [],
  preferredWords: [],
  bannedPatterns: [],
  bannedRhetoric: [],
  formulas: []
}

function habitsPath(root) {
  return join(root, '习惯', 'habits.json')
}

function readHabitsRaw(root) {
  try {
    const parsed = JSON.parse(readFileSync(habitsPath(root), 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

function readHabits(root) {
  const raw = readHabitsRaw(root)
  if (!raw) return { ...HABITS_DEFAULT }
  const merged = { ...HABITS_DEFAULT }
  for (const key of Object.keys(HABITS_DEFAULT)) {
    if (raw[key] !== undefined) merged[key] = raw[key]
  }
  return merged
}

const HABIT_LIST_KEYS = ['bannedWords', 'preferredWords', 'bannedPatterns', 'bannedRhetoric', 'formulas']

function normalizeHabits(input) {
  if (!input || typeof input !== 'object') return null
  const out = { schema: HABITS_SCHEMA, tone: input.tone === 'gentle' ? 'gentle' : 'direct', style: text(input.style).slice(0, 400) }
  for (const key of HABIT_LIST_KEYS) {
    const list = Array.isArray(input[key]) ? input[key].map((item) => text(item).trim().slice(0, 60)).filter(Boolean) : []
    out[key] = [...new Set(list)].slice(0, 60)
  }
  return out
}

/** 习惯 lint（OS-59）：对一段将要落盘的文本跑禁用词/句式检测，返回命中清单。
 * 只报不拦——是否仍要采纳由作者定；Agent 只做提醒（习惯表是作者自己的规矩）。 */
export function lintHabits(text$input, habits) {
  const body = text(text$input)
  const hits = []
  if (!body.trim() || !habits) return hits
  for (const word of Array.isArray(habits.bannedWords) ? habits.bannedWords : []) {
    const count = body.split(word).length - 1
    if (count > 0) hits.push({ kind: 'bannedWord', pattern: word, count, message: `禁用词「${word}」出现 ${count} 次` })
  }
  for (const pattern of Array.isArray(habits.bannedPatterns) ? habits.bannedPatterns : []) {
    const parts = text(pattern).split('…').filter(Boolean)
    let count = 0
    if (parts.length > 1) {
      const escaped = parts.map((part) => part.replace(/[\.*+?^${}()|[\]\\]/gu, '\\$&')).join('[\\s\\S]{0,12}')
      try { count = [...body.matchAll(new RegExp(escaped, 'gu'))].length } catch { count = 0 }
    } else {
      count = body.split(pattern).length - 1
    }
    if (count > 0) hits.push({ kind: 'bannedPattern', pattern, count, message: `禁用句式「${pattern}」出现 ${count} 次` })
  }
  return hits
}

async function writeHabitsWithBackup(root, habits) {
  const path = habitsPath(root)
  await mkdir(dirname(path), { recursive: true })
  let backup = null
  let beforeText = ''
  let existed = false
  try {
    const prev = readFileSync(path)
    beforeText = prev.toString('utf-8')
    existed = true
    backup = join(dirname(path), '.history', `habits-${Date.now()}.json`)
    await mkdir(dirname(backup), { recursive: true })
    await writeFile(backup, prev)
  } catch { /* 首次没有旧稿 */ }
  const tmp = `${path}.tmp-${Date.now()}`
  const nextText = JSON.stringify(habits, null, 2)
  await writeFile(tmp, nextText, 'utf-8')
  await rename(tmp, path)
  // OS-89：习惯表修改也留 diff + log（AGENTS.md 第 10 条）
  await recordChange({
    root, module: '习惯', file: '习惯/habits.json',
    op: existed ? 'update' : 'create',
    before: beforeText, after: nextText, actor: 'author'
  }).catch(() => {})
  return backup
}

async function writeChapterWithBackup(root, file, newText, logOptions = {}) {
  const resolved = resolveInsideRoot(root, file)
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message, details: resolved.details }
  try {
    await mkdir(dirname(resolved.path), { recursive: true })
    let backupRelative = null
    let beforeText = ''
    let existed = false
    if (existsSync(resolved.path)) {
      // v1 粗保护：写前把原内容复制到同目录 .history/。OpenStory 与 Electron 同时写同一库时，
      // 这里不拦冲突（不做跨进程 revision 闸），只保证「上一版还能捞回来」。
      // 待确认卡另有快照闸（卡创建→采纳窗口），见 agentStore.fileSnapshot/snapshotsMatch。
      const backup = historyBackupPath(root, file)
      if (!backup.ok) return { ok: false, code: backup.code, message: backup.message, details: backup.details }
      await mkdir(dirname(backup.path), { recursive: true })
      await copyFile(resolved.path, backup.path)
      backupRelative = backup.relative
      // OS-89：读旧内容用于算 diff（.history 只是二进制快照，日志要的是可读差异）
      try { beforeText = await readFile(resolved.path, 'utf-8') } catch { beforeText = '' }
      existed = true
    }
    const tmp = `${resolved.path}.tmp-${randomUUID()}`
    await writeFile(tmp, newText, 'utf-8')
    await rename(tmp, resolved.path)
    // OS-89：每一次修改都留 diff + log（AGENTS.md 第 10 条）。日志失败不影响写盘结果，
    // 但要如实回传给调用方，不能假装记上了。
    const logged = await recordChange({
      root,
      module: logOptions.module || moduleOfPath(file),
      file,
      op: existed ? 'update' : 'create',
      before: beforeText,
      after: newText,
      actor: logOptions.actor || 'author',
      meta: logOptions.meta || null,
      backup: backupRelative || ''   // OS-90：恢复时直接按这个路径取上一版
    })
    return {
      ok: true,
      chars: newText.length,
      savedAt: new Date().toISOString(),
      ...(backupRelative ? { backup: backupRelative } : {}),
      ...(logged.ok === false ? { logError: logged.message } : {}),
      ...(logged.record ? { changeId: `${logged.path}#${logged.record.afterHash}` } : {})
    }
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `正文写入失败：${text(error?.message || error)}`, details: { file } }
  }
}

/**
 * OS-89：从库内相对路径推模块名（'参考/人物/李逵.md' → '参考'）。
 * 写通道的调用方大多不必显式传 module，靠这个默认推断即可。
 */
export function moduleOfPath(file) {
  const first = text(file).split('/')[0] || ''
  if (first === '拆解') return '故事源'
  return first || 'misc'
}

/* ---------- 产物盘点（OS-11：全库只读，按顶层目录分组）---------- */

const ARTIFACT_LIMIT = 1000

/**
 * 全库盘点（OS-12 升级）：顶层目录分组（组内递归文本文件）＋版本与历史——
 * .history/ 里的 bak/deleted 档按原文件归组（file/name/original/kind/size/mtime）。
 * .pinax 与隐藏目录照旧绝不进清单。
 */
export async function listArtifacts(root) {
  const base = canonicalRoot(root)
  if (!base) return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '盘点需要一个项目根（root）' }
  const groups = new Map()
  let bytes = 0
  let count = 0
  let histories = 0
  const groupOf = (topDir) => {
    if (!groups.has(topDir)) groups.set(topDir, { files: [], history: [] })
    return groups.get(topDir)
  }
  /** .history 档 → 版本记录：name 形如 <原文件名>.bak-<ts> / .deleted-<ts>。 */
  const collectHistory = async (historyDir, topDir, parentRel) => {
    let entries
    try {
      entries = await readdir(historyDir, { withFileTypes: true })
    } catch { /* 读不了就跳过这组历史 */ return }
    for (const entry of entries) {
      if (!entry.isFile() || count + histories >= ARTIFACT_LIMIT) continue
      const kind = entry.name.includes('.deleted-') ? 'deleted' : entry.name.includes('.bak-') ? 'bak' : null
      if (!kind) continue
      const originalName = entry.name.split('.bak-')[0].split('.deleted-')[0]
      const childAbs = join(historyDir, entry.name)
      let stats
      try {
        stats = statSync(childAbs)
      } catch { continue }
      const file = relative(base, childAbs).split(sep).join('/')
      const original = parentRel ? `${parentRel}/${originalName}` : originalName
      groupOf(topDir).history.push({ file, name: entry.name, original, originalName, kind, size: stats.size, mtime: stats.mtime.toISOString() })
      histories += 1
    }
  }
  const walk = async (current, depth) => {
    if (depth > FILE_LIST_DEPTH || count >= ARTIFACT_LIMIT) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return
      throw error
    }
    const relDir = relative(base, current).split(sep).join('/')
    const topDir = relDir === '.' ? '' : relDir.split('/')[0]
    const parentRel = relDir === '.' ? '' : relDir
    for (const entry of entries) {
      if (count >= ARTIFACT_LIMIT) return
      if (entry.name === METADATA_DIR || entry.name.startsWith('.')) {
        if (entry.name === '.history' && entry.isDirectory()) {
          await collectHistory(join(current, entry.name), topDir, parentRel)
        }
        continue
      }
      const childAbs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(childAbs, depth + 1)
        continue
      }
      if (!entry.isFile() || !FILE_TEXT_EXT.test(entry.name)) continue
      let stats
      try {
        stats = statSync(childAbs)
      } catch { /* 竞态跳过 */ continue }
      const file = relative(base, childAbs).split(sep).join('/')
      groupOf(topDir).files.push({ file, name: entry.name, size: stats.size, mtime: stats.mtime.toISOString() })
      count += 1
      bytes += stats.size
    }
  }
  try {
    await walk(base, 0)
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `盘点失败：${text(error?.message || error)}` }
  }
  const groupList = [...groups.entries()]
    .map(([dir, group]) => ({
      dir,
      files: group.files.sort((left, right) => left.file.localeCompare(right.file, 'zh-Hans-CN')),
      ...(group.history.length ? { history: group.history.sort((left, right) => right.mtime.localeCompare(left.mtime)) } : {})
    }))
    .sort((left, right) => left.dir.localeCompare(right.dir, 'zh-Hans-CN'))
  return { ok: true, groups: groupList, totals: { files: count, bytes, histories } }
}

/* ---------- 目录清单（OS-8：业务页的「列」拼图；读/写文件本体仍走 chapter 通道）---------- */

const FILE_DIR_NAME = /^[\p{Script=Han}A-Za-z0-9][\p{Script=Han}A-Za-z0-9._ -]{0,30}$/u
const FILE_TEXT_EXT = /\.(?:md|txt|markdown|json)$/iu
const FILE_LIST_LIMIT = 500
const FILE_LIST_DEPTH = 3

function fileEntry(root, absPath, stats) {
  const file = relative(root, absPath).split(sep).join('/')
  return { file, name: basename(absPath), size: stats.size, mtime: stats.mtime.toISOString() }
}

/**
 * 列库内文本文件。dir 缺省＝顶层扫描（dirs＋files）；dir＝单段目录名，递归深度≤3。
 * 跳过 `.` 开头/`.pinax`/`.history`；只收 md/txt/markdown/json；≤500 个。
 * 目录不存在＝空清单＋warning（空目录是合法形态，不报错）。
 */
export async function listLibraryFiles(root, dir = '') {
  const base = canonicalRoot(root)
  if (!base) return { ok: false, code: API_ERROR_CODES.NO_LIBRARY, message: '列文件需要一个项目根（root）' }
  const rawDir = text(dir).trim()
  const warnings = []
  if (!rawDir) {
    let topLevel
    try {
      topLevel = await readdir(base, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') return { ok: true, dirs: [], files: [], warnings: [{ code: 'DIR_MISSING', message: `库根还不存在：${base}` }] }
      return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `顶层扫描失败：${text(error?.message || error)}` }
    }
    const dirs = []
    const files = []
    for (const entry of topLevel) {
      if (entry.name.startsWith('.') || entry.name === METADATA_DIR) continue
      if (entry.isDirectory()) dirs.push(entry.name)
      else if (entry.isFile() && FILE_TEXT_EXT.test(entry.name)) {
        try {
          files.push(fileEntry(base, join(base, entry.name), statSync(join(base, entry.name))))
        } catch { /* 竞态消失的文件跳过 */ }
      }
    }
    return { ok: true, dirs: dirs.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN')), files }
  }
  if (rawDir.includes('/') || rawDir.includes('\\') || rawDir === '.' || rawDir === '..' || rawDir === METADATA_DIR || !FILE_DIR_NAME.test(rawDir)) {
    return pathFail(`目录名必须是单段合法目录名：${rawDir}`, rawDir)
  }
  const dirAbs = join(base, rawDir)
  const rel = relative(base, dirAbs)
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
    return pathFail(`目录解析后落在库根之外：${rawDir}`, rawDir)
  }
  const files = []
  const walk = async (current, depth) => {
    if (files.length >= FILE_LIST_LIMIT || depth > FILE_LIST_DEPTH) return
    let entries
    try {
      entries = await readdir(current, { withFileTypes: true })
    } catch (error) {
      if (error?.code === 'ENOENT') {
        if (current === dirAbs) warnings.push({ code: 'DIR_MISSING', message: `目录还不存在（保存新文件会自动建出）：${rawDir}` })
        return
      }
      throw error
    }
    for (const entry of entries) {
      if (files.length >= FILE_LIST_LIMIT) return
      if (entry.name.startsWith('.') || entry.name === METADATA_DIR || entry.name === '.history') continue
      const childAbs = join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(childAbs, depth + 1)
      } else if (entry.isFile() && FILE_TEXT_EXT.test(entry.name)) {
        try {
          files.push(fileEntry(base, childAbs, statSync(childAbs)))
        } catch { /* 竞态跳过 */ }
      }
    }
  }
  try {
    await walk(dirAbs, 0)
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `目录扫描失败：${text(error?.message || error)}` }
  }
  files.sort((left, right) => left.file.localeCompare(right.file, 'zh-Hans-CN'))
  return { ok: true, files, ...(warnings.length ? { warnings } : {}) }
}

/** 正文扫描深度与数量上限（OS-113）。必须在 handleApi 之外：
 *  端点处理块先于函数定义求值，写在函数体内会 TDZ。 */
/** OS-118：本进程能否弹原生对话框。首次真正试一次（8 秒超时），判定 NO_DESKTOP 后
 *  记住，后续请求立刻返回——不再让用户每次白等 8 秒。daemon 重启会重试一次
 *  （万一是被正常终端启动的，就恢复原生框）。 */
let NATIVE_DIALOG_UNUSABLE = false
/** 已知有桌面 → 用户真要动手选，超时必须放宽；否则 8 秒就掐掉了正常操作。
 *  未知 → 8 秒探测（失败即判无桌面）。 */
let NATIVE_DIALOG_TIMEOUT_MS = 8_000

const SYNC_SCAN_DEPTH = 4
const SYNC_SCAN_LIMIT = 500

async function handleApi(req, res, url, context) {
  const endpointId = endpointFor(req.method, url.pathname)
  if (!endpointId) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `没有这个端点：${req.method} ${url.pathname}`)
  }

  // OS-127 健康端点：免 root 授权（不碰库清单、不落任何库信息，只报进程事实），
  // 放在最前面——探活要轻，而且这是「还没授权 root」时唯一有用的 API。
  if (endpointId === 'healthGet') {
    const payload = {
      ok: true,
      pid: process.pid,
      port: currentPort(),
      generation: DAEMON_RUNTIME.generation,
      startedAt: DAEMON_RUNTIME.startedAt,
      uptimeMs: Math.round(process.uptime() * 1000)
    }
    const healthChecked = validateResponse('healthGet', payload)
    if (!healthChecked.ok) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '健康响应形状不符合契约', { errors: healthChecked.errors })
    }
    return sendJson(res, 200, payload)
  }

  const loaded = loadLibraries({ preferencesPath: context.preferencesPath, env: context.env })
  const allowlist = createRootAllowlist(loaded.libraries, context.extraRoots)

  if (endpointId === 'libraries') {
    const libraries = mergeLibraryRoots(loaded.libraries, context.extraRoots)
    const defaultRecord = context.defaultRoot
      ? libraries.find((library) => rootKey(library.path) === rootKey(context.defaultRoot))
      : null
    const payload = {
      ok: true,
      libraries,
      warnings: loaded.warnings,
      preferencesPath: loaded.preferencesPath,
      ...(context.defaultRoot ? { defaultRoot: defaultRecord?.path ?? context.defaultRoot } : {})
    }
    const checked = validateResponse('libraries', payload)
    if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '库清单响应形状不符合契约', { errors: checked.errors })
    return sendJson(res, 200, payload)
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
  const request = checked.value

  // Agent 配置与风格包清单不碰库文件，不做 root 校验。
  if (endpointId === 'configGet') return handleConfigGet(res, context)
  if (endpointId === 'configPut') return handleConfigPut(res, request, context)
  // OS-80：全局后台任务中心（跨插件共用）
  if (endpointId === 'jobsGet') {
    const root = text(request.root).trim()
    const jobs = listJobs({
      root,
      kind: text(request.kind).trim(),
      state: text(request.state).trim(),
      limit: request.limit
    })
    return sendJson(res, 200, { ok: true, jobs, active: activeCount({ root }) })
  }
  if (endpointId === 'jobCancel') {
    const id = text(request.id).trim()
    if (!id) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'id 必填')
    const result = cancelJob(id)
    if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.NOT_FOUND, result.message)
    return sendJson(res, 200, { ok: true })
  }
  if (endpointId === 'jobsClear') {
    const result = clearSettled({ root: text(request.root).trim() })
    return sendJson(res, 200, result)
  }
  if (endpointId === 'configProbe') return handleConfigProbe(res, request, context)
  if (endpointId === 'agentConfigGet') return handleAgentConfigGet(res, context)
  if (endpointId === 'agentConfigPut') return handleAgentConfigPut(res, request, context)
  if (endpointId === 'agentRuntimesGet') return handleAgentRuntimesGet(res, context)
  if (endpointId === 'agentDshModelsGet') {
    const profile = text(request.profile).trim() || text(context.env?.DSH_PROFILE || 'openstory').trim()
    const probed = await detectDshModels({ env: context.env, profile })
    return sendJson(res, 200, {
      ok: true,
      models: probed.models ?? [],
      ...(probed.ok ? {} : { message: probed.message })
    })
  }
  if (endpointId === 'agentRuntimePut') return handleAgentRuntimePut(res, request, context)
  /* ---------- OS-97：知识库配置（可读可写可测，不再只是只读状态牌） ---------- */

  if (endpointId === 'kbConfigGet') {
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    let config = {}
    let error = ''
    try {
      if (existsSync(configPath)) config = JSON.parse(readFileSync(configPath, 'utf-8'))
    } catch (err) { error = text(err?.message || err) }
    // 密钥只回掩码：sk-abc…xyz
    const rawKey = text(config.apiKey)
    const masked = rawKey ? `${rawKey.slice(0, 6)}…${rawKey.slice(-4)}` : ''
    return sendJson(res, 200, {
      ok: true,
      configPath,
      config: {
        backend: text(config.backend) || 'weknora',
        baseUrl: text(config.baseUrl) || 'http://127.0.0.1:8080',
        apiKeyMasked: masked,
        spaceId: text(config.spaceId),
        collections: config.collections && typeof config.collections === 'object' ? config.collections : {}
      },
      ...(error ? { configError: error } : {})
    })
  }

  if (endpointId === 'kbConfigPut') {
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    let current = {}
    try { if (existsSync(configPath)) current = JSON.parse(readFileSync(configPath, 'utf-8')) } catch { current = {} }
    // apiKey 传 __KEEP__ ＝保留原值（前端不回传明文）
    const incomingKey = text(request.apiKey)
    const apiKey = incomingKey === '__KEEP__' ? text(current.apiKey) : incomingKey
    const next = {
      ...current,
      backend: text(request.backend) || text(current.backend) || 'weknora',
      baseUrl: text(request.baseUrl) || text(current.baseUrl) || 'http://127.0.0.1:8080',
      apiKey,
      spaceId: request.spaceId !== undefined ? text(request.spaceId) : text(current.spaceId),
      collections: request.collections && typeof request.collections === 'object'
        ? request.collections
        : (current.collections ?? {})
    }
    try {
      await mkdir(dirname(configPath), { recursive: true })
      const tmp = `${configPath}.tmp-${Date.now()}`
      await writeFile(tmp, JSON.stringify(next, null, 2), 'utf-8')
      await rename(tmp, configPath)
    } catch (err) {
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `知识库配置写入失败：${text(err?.message || err)}`)
    }
    // 写后立刻重探
    await probeServices({ weknoraUrl: next.baseUrl, weknoraApiKey: next.apiKey }).catch(() => {})
    const status = await collectKbStatus({ configPath, services: kbServiceState, resolveCollections })
    return sendJson(res, 200, { ok: true, status })
  }

  if (endpointId === 'kbTest') {
    const configPath = defaultKbConfigPath(context.env ?? process.env)
    let saved = {}
    try { if (existsSync(configPath)) saved = JSON.parse(readFileSync(configPath, 'utf-8')) } catch { saved = {} }
    const baseUrl = text(request.baseUrl) || text(saved.baseUrl) || 'http://127.0.0.1:8080'
    const apiKey = text(request.apiKey) && text(request.apiKey) !== '__KEEP__' ? text(request.apiKey) : text(saved.apiKey)
    await probeServices({ weknoraUrl: baseUrl, weknoraApiKey: apiKey }).catch(() => {})
    const status = await collectKbStatus({ configPath, services: kbServiceState, resolveCollections })
    return sendJson(res, 200, {
      ok: true,
      weknora: kbServiceState.weknora ?? { up: false },
      embedding: kbServiceState.embedding ?? { up: false },
      collections: status.collections ?? []
    })
  }

  if (endpointId === 'kbStatusGet') {
    const status = await collectKbStatus({
      configPath: defaultKbConfigPath(context.env ?? process.env),
      services: kbServiceState.lastCheck ? kbServiceState : null,
      resolveCollections
    })
    return sendJson(res, 200, status)
  }

  // 分析面板 fact 曲线（KB-ARCH 对齐拆解线算法）：读库内 拆解/ 的 fact+wiki，给章级曲线数据。
  // 无拆解数据时返回 ok:true + chapters:[]（前端降级到本地词典近似），绝不报错。
  if (endpointId === 'factCurveGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const dir = join(authorized.root, '拆解')
    let files = []
    try {
      files = (await readdir(dir)).filter((name) => name.endsWith('.json')
        && !name.endsWith('.wiki.json') && !name.includes('.operations')
        && name !== '拆解汇总.json' && name !== '拆解索引.json')
    } catch { files = [] }
    const wanted = text(request.bookId).trim()
    const pickPath = wanted
      ? (files.find((name) => name.replace(/\.json$/, '') === wanted) ? join(dir, wanted + '.json') : null)
      : files.map((name) => ({ path: join(dir, name), mtime: statSync(join(dir, name)).mtimeMs }))
        .sort((left, right) => right.mtime - left.mtime)[0]?.path ?? null
    if (!pickPath) {
      return sendJson(res, 200, { ok: true, bookId: '', title: '', words: 0, chapters: [], foreshadows: [], books: files.map((name) => name.replace(/\.json$/, '')) })
    }
    const bookId = basename(pickPath).replace(/\.json$/, '')
    let document = null
    try { document = JSON.parse(readFileSync(pickPath, 'utf8')) } catch { document = null }
    if (!document) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `拆解文件读不了：${bookId}`)
    const { wiki } = factStore.readFactWiki({ root: authorized.root, id: bookId, document })
    // 事件密度：plot 条目按 provenance.chapters 首章归组计数
    const eventsByChapter = new Map()
    for (const entry of document.entries ?? []) {
      if ((entry.layer ?? entry.type) !== 'plot') continue
      const no = Number(entry.provenance?.chapters?.[0] ?? 0)
      if (!no) continue
      eventsByChapter.set(no, (eventsByChapter.get(no) ?? 0) + (entry.events?.length ?? 1))
    }
    const foreshadowsByChapter = new Map()
    for (const f of wiki?.foreshadows ?? []) {
      const no = Number(f.chapter ?? 0)
      if (!no) continue
      foreshadowsByChapter.set(no, (foreshadowsByChapter.get(no) ?? 0) + 1)
    }
    const chapters = (wiki?.chapterSummaries ?? []).map((c) => ({
      no: Number(c.chapter ?? 0),
      title: text(c.title ?? ''),
      summary: text(c.summary ?? '').slice(0, 120),
      function: text(c.function ?? ''),
      emotion: text(c.emotion ?? ''),
      beats: Number(c.beats ?? 0),
      events: eventsByChapter.get(Number(c.chapter ?? 0)) ?? 0,
      foreshadows: foreshadowsByChapter.get(Number(c.chapter ?? 0)) ?? 0
    }))
    // OS-74：伏笔明细透传（埋/收/未收）——前端「伏笔回收」图需要 plantedAt/payoffAt 才能画点，
    // 只有每章计数画不出埋-收连线。字段宽松：老数据没有 plantedAt 就只用 chapter 归章。
    const foreshadowList = (wiki?.foreshadows ?? []).map((f, index) => ({
      id: text(f.id) || `f-${index}`,
      text: text(f.text),
      chapter: Number(f.chapter ?? 0) || null,
      plantedAt: Number.isFinite(Number(f.plantedAt)) ? Number(f.plantedAt) : null,
      payoffAt: Number.isFinite(Number(f.payoffAt)) ? Number(f.payoffAt) : null,
      status: text(f.status) || 'unresolved',
      note: text(f.note)
    }))
    return sendJson(res, 200, {
      ok: true,
      bookId,
      title: text(document.book?.title ?? ''),
      words: Number(document.book?.word_count ?? 0),
      chapters,
      foreshadows: foreshadowList,
      books: files.map((name) => name.replace(/\.json$/, ''))
    })
  }

  // 故事源条目层（S1）：条目本体＋溯源＋层筛选。数据只经内核 createFactFileStore().list() 读，
  // 不在这里 readdir+JSON.parse 绕过内核（FACT-FIRST 规则 1）；过滤与分页全在服务端。
  if (endpointId === 'factEntriesGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const books = await listFactBooks(authorized.root)
    const wantedBookId = text(request.bookId).trim()
    let book = null
    if (wantedBookId) {
      book = books.find((item) => item.bookId === wantedBookId) ?? null
      if (!book) return sendError(res, API_ERROR_CODES.NOT_FOUND, `拆解里没有这本书：${wantedBookId}`)
    } else {
      // 缺省书＝mtime 最新的可读一本（坏档不参与兜底，免得兜底到一本永远读不出条目的书）。
      book = books.filter((item) => !item.error).sort((left, right) => right.mtime - left.mtime)[0] ?? null
    }
    const listed = factStore.createFactFileStore({ root: authorized.root }).list({})
    if (!listed.ok) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, listed?.error?.message ?? '拆解数据读不了', listed?.error?.details)
    }
    // 书的身份按文件名算（与 factCurveGet／推演同口径）；条目溯源里 file 是内核透传的原档名，
    // bookId 可能来自档内 book.id 而与文件名不同——两种都对得上才收进这本书。
    const scoped = book
      ? listed.entries.filter((entry) => (entry.sourceFile
        ? text(entry.sourceFile) === book.file
        : text(entry.bookId) === book.bookId))
      : []
    // layers 是「层/q 过滤前」的全量计数（前端层筛选器的数字来源）。
    const layers = {}
    for (const entry of scoped) {
      const key = text(entry.layer).trim()
      if (!key) continue
      layers[key] = (layers[key] ?? 0) + 1
    }
    const layer = text(request.layer).trim()
    const needle = text(request.q).trim().toLowerCase()
    const filtered = scoped.filter((entry) => {
      if (layer && text(entry.layer).trim() !== layer) return false
      if (needle && !text(entry.name).toLowerCase().includes(needle)) return false
      return true
    })
    const offset = factOffsetOf(request.offset)
    const limit = factLimitOf(request.limit)
    const payload = {
      ok: true,
      bookId: book?.bookId ?? '',
      ...(isPlainObject(book?.book) ? { book: book.book } : {}),
      revision: book?.revision ?? 0,
      total: filtered.length,
      entries: filtered.slice(offset, offset + limit),
      layers,
      ...(listed.warnings?.length ? { warnings: listed.warnings } : {})
    }
    const checked = validateResponse('factEntriesGet', payload)
    if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '条目清单响应形状不符合契约', { errors: checked.errors })
    return sendJson(res, 200, payload)
  }

  if (endpointId === 'factBooksGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const books = await listFactBooks(authorized.root)
    const payload = {
      ok: true,
      books: books.map((item) => ({
        bookId: item.bookId,
        title: item.title,
        revision: item.revision,
        entries: item.entries,
        hasWiki: item.hasWiki,
        ...(item.error ? { error: item.error } : {})
      }))
    }
    const checked = validateResponse('factBooksGet', payload)
    if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '书目清单响应形状不符合契约', { errors: checked.errors })
    return sendJson(res, 200, payload)
  }

  /* ---------- OS-89：变更日志 / 界面状态 / 草稿（全部落库内本地文件） ---------- */

  if (endpointId === 'changeLogGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await readLog({
      root: authorized.root,
      module: text(request.module),
      file: text(request.file),
      limit: Number(request.limit) || 50
    })
    return sendJson(res, 200, { ok: true, entries: result.entries ?? [], truncated: result.truncated === true })
  }

  if (endpointId === 'changeLogEntry') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await readChange({
      root: authorized.root,
      module: text(request.module),
      at: text(request.at),
      afterHash: text(request.afterHash)
    })
    if (!result.ok) return sendError(res, API_ERROR_CODES.NOT_FOUND, '找不到这条变更记录')
    return sendJson(res, 200, { ok: true, entry: result.entry })
  }

  if (endpointId === 'changeLogRestore') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const found = await readChange({
      root: authorized.root,
      module: text(request.module),
      at: text(request.at),
      afterHash: text(request.afterHash)
    })
    if (!found.ok) return sendError(res, API_ERROR_CODES.NOT_FOUND, '找不到这条变更记录')
    const entry = found.entry
    if (!entry?.backup) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY,
        '这条变更没有留下可恢复的备份（新建类变更回退不了）')
    }
    // 1) 读备份内容
    const backupAbs = resolveInsideRoot(authorized.root, entry.backup, { allowMetadata: true })
    if (!backupAbs.ok) return sendError(res, backupAbs.code, backupAbs.message, backupAbs.details)
    let beforeText
    try { beforeText = await readFile(backupAbs.path, 'utf-8') } catch (error) {
      return sendError(res, API_ERROR_CODES.NOT_FOUND, `备份文件读不到：${text(error?.message || error)}`)
    }
    // 2) 先给当前内容做一次安全备份（这次恢复本身也要可回退），再写回
    const written = await writeChapterWithBackup(authorized.root, entry.file, beforeText, {
      module: entry.module,
      actor: 'author',
      meta: { restoredFrom: entry.backup, restoredAt: entry.at }
    })
    if (!written.ok) return sendError(res, written.code, written.message, written.details)
    return sendJson(res, 200, {
      ok: true,
      file: entry.file,
      restoredFrom: entry.backup,
      ...(written.backup ? { safetyBackup: written.backup } : {})
    })
  }

  if (endpointId === 'changeLogSummary') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await logSummary(authorized.root)
    return sendJson(res, 200, { ok: true, modules: result.modules ?? [] })
  }

  if (endpointId === 'uiStateGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await readUiState(authorized.root)
    return sendJson(res, 200, { ok: true, state: result.state ?? {} })
  }

  if (endpointId === 'uiStatePut') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await writeUiState(authorized.root, request.state)
    if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
    return sendJson(res, 200, { ok: true, state: result.state, ...(result.backup ? { backup: result.backup } : {}) })
  }

  if (endpointId === 'draftGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const mod = text(request.module)
    if (!mod) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'module 必填')
    const wantedId = text(request.id)
    if (wantedId) {
      const result = await loadDraft(authorized.root, mod, wantedId)
      return sendJson(res, 200, { ok: true, draft: result.draft ?? null })
    }
    const listed = await listDrafts(authorized.root, mod)
    return sendJson(res, 200, { ok: true, drafts: listed.drafts ?? [] })
  }

  if (endpointId === 'draftPut') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const mod = text(request.module)
    const id = text(request.id)
    if (!mod || !id) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'module 与 id 必填')
    if (request.delete === true) {
      const dropped = await dropDraft(authorized.root, mod, id)
      if (!dropped.ok) return sendError(res, dropped.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, dropped.message)
      return sendJson(res, 200, { ok: true, draft: null })
    }
    const saved = await saveDraft(authorized.root, { module: mod, id, text: text(request.text), meta: request.meta })
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, draft: saved.draft })
  }

  if (endpointId === 'syncCheck') {
    // OS-107：同源版本检查 ＋ 外部变更检测。一次读盘回答两件事：
    //   ① fact revision 与兄弟 wiki 的 derivedFrom.factRevision 是否同源（wikiStale）；
    //   ② 正文文件的 hash/mtime 与 changelog 对照，捞出绕过写通道的外部改动。
    // 检查本身会刷新 .pinax/sync-state.json 快照（POST 而非 GET 的原因）。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root

    // ① 拆解：最新一本书的主档 revision ＋ 兄弟 wiki 的派生基准（两代兼容走 readFactWiki）
    let bookId = await resolveFactBookId(root, '')
    // resolveFactBookId 挑「最新 .json」时会把兄弟 `<id>.wiki.json` 也算进去（同样以 .json 结尾）。
    // 同源检查要的是主档：命中派生档就退回同 id 的主档（主档存在时）。
    if (/\.wiki$/u.test(bookId) && existsSync(join(root, '拆解', `${bookId.slice(0, -'.wiki'.length)}.json`))) {
      bookId = bookId.slice(0, -'.wiki'.length)
    }
    let document = null
    try { document = JSON.parse(await readFile(join(root, '拆解', `${bookId}.json`), 'utf-8')) } catch { document = null }
    if (document && !isPlainObject(document)) document = null
    const entries = Array.isArray(document?.entries) ? document.entries : []
    const rawRevision = Number(document?.revision)
    const factRevision = Number.isSafeInteger(rawRevision) && rawRevision >= 0 ? rawRevision : null
    const wikiRead = factStore.readFactWiki({ root, id: bookId, document })
    // 旧信封里的 wiki 没有 derivedFrom（内嵌形态）——按「无派生档」如实报，不编基准版本。
    const wikiDerivedFrom = isPlainObject(wikiRead.derivedFrom) ? wikiRead.derivedFrom : null

    // OS-114：时间戳对齐——revision 是内核计数器，作者看不懂「差几版」；
    // 真实写作频繁小改，要的是「谁比谁新」。三个时间戳：
    //   factAt      = 拆解主档文件的 mtime（最后一次写盘时间）
    //   wikiAt      = 派生档的 generated_at（生成时刻；没有就退文件 mtime）
    //   chaptersAt  = 正文最新一个文件的 mtime
    let factAt = null
    try {
      factAt = statSync(join(root, '拆解', `${bookId}.json`)).mtime.toISOString()
    } catch { factAt = null }
    let wikiAt = null
    try {
      const wikiPath = join(root, '拆解', `${bookId}.wiki.json`)
      const wikiDoc = JSON.parse(await readFile(wikiPath, 'utf-8'))
      // generated_at 是 enrich 写的权威生成时刻；没有就退文件 mtime
      wikiAt = text(wikiDoc?.generated_at) || statSync(wikiPath).mtime.toISOString()
    } catch { wikiAt = null }

    // ② 参考笔记最新 mtime（scanReferences 已导出，索引里就是 ISO 串）
    const referenceIndex = await scanReferences(root)
    const refsMtimeMax = (Array.isArray(referenceIndex.notes) ? referenceIndex.notes : [])
      .map((note) => text(note?.mtime))
      .filter(Boolean)
      .sort()
      .pop() ?? null

    // ③ 正文快照 ＋ 每个文件最近一条变更日志的时间（判定「改动走没走写通道」的依据）
    // 不按 module 过滤：同一文件可能被别的通道（剧本转正/迁移）以不同模块名记过，
    // 只看 '正文' 会把那些正常写入误判成外部改动。files 白名单已经收窄了范围。
    const prose = await scanProseFiles(root)
    // 正文最新改动时刻（OS-114）：与 factAt 比，判断「正文改了但拆解没跟上」
    const chaptersAt = prose
      .map((item) => text(item?.mtime))
      .filter(Boolean)
      .sort()
      .pop() ?? null
    const logged = await readLatestByFile({ root, files: prose.map((item) => item.path) })
    if (!logged.ok) {
      return sendError(res, logged.code ?? API_ERROR_CODES.INVALID_ENTRY, '读变更日志失败：同源检查没法判定哪些改动没留痕')
    }
    const snapshot = prose.map((item) => ({
      path: item.path,
      hash: item.hash,
      mtime: item.mtime,
      loggedAt: text(logged.latest?.[item.path]) || null
    }))

    let external
    try {
      external = await snapshotAndDiff({ root, files: snapshot })
    } catch (error) {
      return sendError(res, error?.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, text(error?.message || error))
    }

    const sameSource = checkSameSource({
      root,
      factMtime: factAt,
      wikiGeneratedAt: wikiAt,
      refsMtimeMax,
      chaptersMtimeMax: chaptersAt,
      factRevision: factRevision ?? (entries.length ? 1 : 0),
      wikiDerivedFrom,
      entries
    })
    const payload = {
      ok: true,
      sameSource,
      external,
      factRevision: sameSource.factRevision
    }
    const checked = validateResponse('syncCheck', payload)
    if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '同源检查响应形状不符合契约', { errors: checked.errors })
    return sendJson(res, 200, payload)
  }

  if (endpointId === 'habitsGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    return sendJson(res, 200, { ok: true, habits: readHabits(authorized.root) })
  }

  if (endpointId === 'habitsPut') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const habits = normalizeHabits(request.habits)
    if (!habits) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '习惯表形状不对：需要 { tone, style, bannedWords, preferredWords, bannedPatterns, bannedRhetoric, formulas }')
    const backup = await writeHabitsWithBackup(authorized.root, habits)
    return sendJson(res, 200, { ok: true, habits, backup })
  }

  if (endpointId === 'skillsGet') {
    const loaded = loadSkills(effectiveSkillsDirs(context))
    const filtered = request.genre ? skillsForGenre(loaded.skills, request.genre) : loaded.skills
    return sendJson(res, 200, {
      ok: true,
      skills: filtered.map(skillSummary),
      warnings: loaded.warnings
    })
  }

  if (endpointId === 'skillGet') {
    const loaded = loadSkills(effectiveSkillsDirs(context))
    const skill = loaded.skills.find((item) => item.name === request.name)
    if (!skill) return sendError(res, API_ERROR_CODES.NOT_FOUND, `货架上没有这个技能：${request.name}`)
    return sendJson(res, 200, {
      ok: true,
      skill: { ...skillSummary(skill), body: skill.body, tools: skill.tools, output: skill.output, domain: skill.domain }
    })
  }

  if (endpointId === 'genresGet') {
    const loaded = loadGenres(context.genresDirs)
    return sendJson(res, 200, { ok: true, genres: loaded.genres, warnings: loaded.warnings })
  }

  if (endpointId === 'briefGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const loaded = await readBrief(authorized.root, context.genresDirs)
    if (!loaded.ok) return sendError(res, loaded.code ?? API_ERROR_CODES.INVALID_ENTRY, loaded.message)
    const genre = loaded.brief ? loadGenres(context.genresDirs).genres.find((item) => item.id === loaded.brief.genre) ?? null : null
    return sendJson(res, 200, { ok: true, brief: loaded.brief ?? null, genre: genre ?? null, path: loaded.path })
  }

  if (endpointId === 'briefPut') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const written = await writeBrief(authorized.root, context.genresDirs, request)
    if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.INVALID_ENTRY, written.message)
    const genre = loadGenres(context.genresDirs).genres.find((item) => item.id === written.brief.genre) ?? null
    return sendJson(res, 200, { ok: true, brief: written.brief, genre, path: written.path })
  }

  if (endpointId === 'agentPicksGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const picks = await readAgentPicks(authorized.root)
    return sendJson(res, 200, { ok: true, picks: picks ?? null, explicit: picks !== null })
  }

  if (endpointId === 'agentPicksPut') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const written = await writeAgentPicks(authorized.root, context.skillsDirs, request)
    if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.INVALID_ENTRY, written.message)
    return sendJson(res, 200, { ok: true, picks: written.picks, path: written.path })
  }

  if (endpointId === 'pluginsGet') {
    // OS-120：三套 spec 的统一视图（只读聚合）。一套读崩不拖垮其余两套——聚合层内部已隔离。
    const listed = await listAllPlugins({
      suitesDirs: context.suitesDirs,
      suiteStatePath: context.suiteStatePath,
      skillsDirs: context.skillsDirs,
      runtimesDirs: context.runtimesDirs
    })
    return sendJson(res, 200, {
      ok: true,
      plugins: listed.plugins,
      byKind: listed.byKind,
      stats: listed.stats,
      ...(listed.warnings.length ? { warnings: listed.warnings } : {})
    })
  }
  if (endpointId === 'suitesGet') {
    const listed = await listSuitesPublic(context.suitesDirs, context.suiteStatePath)
    const suitesUserDir = Array.isArray(context.suitesDirs) && context.suitesDirs[1] ? context.suitesDirs[1] : ''
    return sendJson(res, 200, { ok: true, suites: listed.suites, ...(suitesUserDir ? { userDir: suitesUserDir } : {}), ...(listed.warnings?.length ? { warnings: listed.warnings } : {}) })
  }
  if (endpointId === 'suiteSettingsPut') {
    const saved = await saveSuiteSettings(context.suitesDirs, context.suiteStatePath, request.id, request.values)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.INVALID_ENTRY, saved.message)
    return sendJson(res, 200, { ok: true, values: saved.values })
  }
  if (endpointId === 'suiteStatePut') {
    const set = await setSuiteEnabled(context.suitesDirs, context.suiteStatePath, request.id, request.enabled)
    if (!set.ok) return sendError(res, set.code ?? API_ERROR_CODES.INVALID_ENTRY, set.message)
    return sendJson(res, 200, { ok: true, enabled: set.enabled })
  }
/* ---------- 故事源条目层（S1 工单）：条目本体／书目盘点 ---------- */

/** 拆解目录里可当书的文件名：排除 wiki 派生、操作日志、汇总/索引旁路档。 */
function isFactBookFileName(name) {
  const lower = String(name).toLowerCase()
  if (!lower.endsWith('.json')) return false
  if (lower.endsWith('.wiki.json')) return false
  if (lower.includes('.operations')) return false
  return name !== '拆解汇总.json' && name !== '拆解索引.json'
}

/**
 * 书目盘点（factBooksGet／factEntriesGet 共用）：拆解/ 下每本 <id>.json 读顶层
 * book/revision/entries.length，并查兄弟 <id>.wiki.json 是否存在。
 * 坏档只在那一本记 error，其余照常返回——「坏档不整体失败」是内核与作者同一口径。
 */
async function listFactBooks(root) {
  const dir = join(root, '拆解')
  let names = []
  try {
    names = (await readdir(dir)).filter(isFactBookFileName).sort()
  } catch {
    return []
  }
  const books = []
  for (const name of names) {
    const bookId = name.replace(/\.json$/u, '')
    const path = join(dir, name)
    let mtime = 0
    try { mtime = statSync(path).mtimeMs } catch { mtime = 0 }
    let hasWiki = false
    try { hasWiki = statSync(join(dir, `${bookId}.wiki.json`)).isFile() } catch { hasWiki = false }
    let document = null
    try {
      document = JSON.parse(await readFile(path, 'utf-8'))
    } catch (error) {
      books.push({ bookId, file: name, title: bookId, revision: 0, entries: 0, hasWiki, mtime, error: `拆解文件读不了：${String(error?.message || error)}` })
      continue
    }
    if (!isPlainObject(document) || !Array.isArray(document.entries)) {
      books.push({ bookId, file: name, title: bookId, revision: 0, entries: 0, hasWiki, mtime, error: '拆解文件形状不对：顶层不是对象或 entries 不是数组' })
      continue
    }
    const revision = Number.isSafeInteger(Number(document.revision)) && Number(document.revision) >= 1 ? Number(document.revision) : 1
    const rawBook = isPlainObject(document.book) ? document.book : null
    books.push({
      bookId,
      file: name,
      title: text(rawBook?.title).trim() || text(rawBook?.id).trim() || bookId,
      revision,
      entries: document.entries.length,
      hasWiki,
      mtime,
      book: rawBook
    })
  }
  return books
}

/** 分页参数：非法/负数回落默认值（offset 0，limit 100），limit 上限 500（超限 clamp 不报错）。 */
function factOffsetOf(value) {
  const number = Number(value)
  return Number.isSafeInteger(number) && number > 0 ? number : 0
}

function factLimitOf(value) {
  const DEFAULT_LIMIT = 100
  const MAX_LIMIT = 500
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number <= 0) return DEFAULT_LIMIT
  return Math.min(number, MAX_LIMIT)
}

/**
 * 推演书缺省解析（OS-54）：显式传了 bookId 就用它；没传＝拆解目录里 mtime 最新那份。
 * 与 factCurveGet 的选书口径一致——剔除条目页签后前端不再持有 bookId。
 */
async function resolveFactBookId(root, wanted) {
  const wantedText = text(wanted).trim()
  if (wantedText) return wantedText
  const dir = join(root, '拆解')
  let files = []
  try { files = (await readdir(dir)).filter((name) => name.endsWith('.json')) } catch { files = [] }
  const pick = files
    .map((name) => ({ name, mtime: statSync(join(dir, name)).mtimeMs }))
    .sort((left, right) => right.mtime - left.mtime)[0]
  return pick ? pick.name.replace(/\.json$/u, '') : 'default'
}

/* ---------- 同源检查（OS-107）：正文快照 ---------- */

/**
 * 扫 `<库>/正文/` 下所有 .md，给每个文件现算 `{ path, hash, mtime }`（库内相对路径，正斜杠）。
 * 跳过 `.history/` 与隐藏目录（备份快照不是稿子，算进来会天天误报外部改动）。
 * hash 走 `changelog.mjs` 的 contentHash（与写通道留痕同一个指纹口径）。
 */
async function scanProseFiles(root) {
  const base = join(root, '正文')
  if (!existsSync(base)) return []
  const out = []
  const walk = async (current, depth) => {
    if (out.length >= SYNC_SCAN_LIMIT || depth > SYNC_SCAN_DEPTH) return
    let entries
    try { entries = await readdir(current, { withFileTypes: true }) } catch { return }
    for (const entry of entries) {
      if (out.length >= SYNC_SCAN_LIMIT) return
      if (entry.name.startsWith('.') || entry.name === '.history') continue
      const abs = join(current, entry.name)
      if (entry.isDirectory()) { await walk(abs, depth + 1); continue }
      if (!entry.isFile() || !/\.md$/iu.test(entry.name)) continue
      try {
        const stats = statSync(abs)
        out.push({
          path: relative(root, abs).split(sep).join('/'),
          hash: contentHash(await readFile(abs)),
          mtime: stats.mtime.toISOString()
        })
      } catch { /* 竞态消失的文件跳过 */ }
    }
  }
  await walk(base, 0)
  out.sort((left, right) => left.path.localeCompare(right.path, 'zh-Hans-CN'))
  return out
}

/** 素材单文件上限：立绘/BGM 都是本机小文件，16MB 足够且防误挂大档。 */
const DEDUCE_ASSET_MAX = 16 * 1024 * 1024

/** 素材三类目录 → 响应字段与扩展名（约定见 deduceAssets 处理块注释）。 */
const DEDUCE_ASSET_KINDS = Object.freeze([
  { dir: '角色', field: 'characters', ext: '.png' },
  { dir: '场景', field: 'scenes', ext: '.png' },
  { dir: 'bgm', field: 'bgm', ext: '.mp3' }
])

/** 盘点 推演/<bookId>/素材/：目录不存在＝空数组；隐藏文件/子目录/异扩展名跳过。 */
async function listDeduceAssets(root, bookId) {
  const base = resolveInsideRoot(root, `推演/${bookId}/素材`)
  if (!base.ok) return base
  const result = { ok: true, characters: [], scenes: [], bgm: [] }
  for (const kind of DEDUCE_ASSET_KINDS) {
    let entries = []
    try {
      entries = await readdir(join(base.path, kind.dir), { withFileTypes: true })
    } catch {
      continue
    }
    result[kind.field] = entries
      .filter((entry) => entry.isFile() && !entry.name.startsWith('.') && extname(entry.name).toLowerCase() === kind.ext)
      .map((entry) => ({
        name: entry.name.slice(0, -kind.ext.length),
        path: `推演/${bookId}/素材/${kind.dir}/${entry.name}`
      }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
  }
  return result
}

  if (endpointId === 'deduceOpeningGet') {
    // OS-93 开局三件套（照酒馆：选角色卡 → 选世界书 → 选开头）
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = deduceOpening({ root: authorized.root })
    if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
    return sendJson(res, 200, result)
  }

  if (endpointId === 'deducePresent') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await deducePresent({
      root: authorized.root,
      bookId: await resolveFactBookId(authorized.root, request.bookId),
      pov: text(request.pov),
      seed: Number.isSafeInteger(request.seed) ? request.seed : null,
      reset: request.reset === true,
      peek: request.peek === true,
      // OS-93：选中的开头（剧情骨架段 definition）——戏剧候选围绕它锚定
      seedPrompt: text(request.seedPrompt),
      // OS-96：扮演底座按章节筛世界书（写到30章的库不给31章以后的知识）
      chapterLimit: Number.isFinite(Number(request.chapterLimit)) && Number(request.chapterLimit) > 0 ? Number(request.chapterLimit) : null,
      sessionId: text(request.sessionId).trim() || readActiveSessionId(authorized.root, await resolveFactBookId(authorized.root, request.bookId)),
      // OS-82：戏剧候选接全局文本模型（没配模型＝null，必然/命运照常）
      llmPort: await buildDeduceLlmPort({ context })
    })
    // peek 且无会话：不是错误——前端维持空态
    if (!result.ok && result.code === 'NO_DEDUCE_SESSION') return sendJson(res, 200, { ok: false, code: 'NO_DEDUCE_SESSION', message: result.message })
    if (!result.ok) return sendError(res, result.code === 'WORLD_EMPTY' ? API_ERROR_CODES.INVALID_ENTRY : (result.code ?? API_ERROR_CODES.INVALID_ENTRY), result.message)
    return sendJson(res, 200, result)
  }

  if (endpointId === 'deduceSettle') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await deduceSettle({
      root: authorized.root,
      bookId: await resolveFactBookId(authorized.root, request.bookId),
      candidateId: text(request.candidateId),
      action: text(request.action || 'choose'),
      note: text(request.note),
      sessionId: text(request.sessionId).trim() || readActiveSessionId(authorized.root, await resolveFactBookId(authorized.root, request.bookId))
    })
    if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
    return sendJson(res, 200, result)
  }

  // 推演会话存储层（OS-61）：「文游」容器——读/整存会话、归档一章。
/** 读旧引擎推演状态（.openstory/deduce/<bookId>.json）——桥接用，只读。 */
function readLegacyDeduceState(root, bookId) {
  try {
    const path = deduceStatePath(root, bookId)
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf-8'))
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

  if (endpointId === 'deduceSessionGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveFactBookId(authorized.root, request.bookId)
    // OS-86：sessionId 缺省＝激活指针（回落主线）——前端不用管「现在在哪局」
    const wanted = text(request.sessionId).trim()
    const sid = wanted || readActiveSessionId(authorized.root, bookId)
    let session = loadDeduceSession(authorized.root, bookId, sid)
    // 自动桥接（OS-62）：新层还没有节点、但旧引擎层推过拍 → 把最后一面导入成首节点。
    // 老库升级后剧情树不再空白；旧档不动，重复读幂等。只桥主线——多局是 OS-86 之后的产物。
    if ((!session || !(session.nodes || []).length) && (sid === 'main' || !wanted)) {
      const legacy = readLegacyDeduceState(authorized.root, bookId)
      if (legacy) {
        const merged = importLegacyDeduce({ legacyState: legacy, session, bookId })
        if (merged.ok && merged.imported) {
          const saved = await saveDeduceSession(authorized.root, bookId, merged.session)
          session = saved.ok ? merged.session : merged.session
        } else if (merged.ok) {
          session = merged.session
        }
      }
    }
    return sendJson(res, 200, { ok: true, session, activeId: sid })
  }

  if (endpointId === 'deduceSessionPut') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveFactBookId(authorized.root, request.bookId)
    // OS-86：sessionId 随会话对象走（main＝legacy 路径，其余 sessions/<sid>.json）
    const session = normalizeDeduceSession(request.session, bookId, text(request.session?.sessionId))
    if (!session) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `推演会话形状不对：schema 必须是 ${DEDUCE_SESSION_SCHEMA}，nodes 必须是数组`)
    }
    const saved = await saveDeduceSession(authorized.root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, session, ...(saved.backup ? { backup: saved.backup } : {}) })
  }

  if (endpointId === 'deduceSessionsGet') {
    // OS-86 多局并存：主线（legacy）＋ sessions/ 全部＋激活指针。列表轻量读全文取 meta。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveFactBookId(authorized.root, request.bookId)
    const listed = listDeduceSessions(authorized.root, bookId)
    return sendJson(res, 200, { ok: true, bookId, ...listed })
  }

  if (endpointId === 'deduceSessionManage') {
    // OS-86 多局管理：new＝新建空局并激活；switch＝激活已有局；delete＝非破坏删除（挪 .deleted）。
    // 最后一局不能删（推演页不能开天窗，清空走「重新开局」）。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveFactBookId(authorized.root, request.bookId)
    const action = text(request.action || '').trim()
    if (action === 'new') {
      const created = await createDeduceSession(authorized.root, bookId, { title: text(request.title) })
      if (!created.ok) return sendError(res, created.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, created.message ?? '新局创建失败')
      const listed = listDeduceSessions(authorized.root, bookId)
      return sendJson(res, 200, { ok: true, action: 'new', sessionId: created.sessionId, session: created.session, ...listed })
    }
    const sid = text(request.sessionId).trim()
    if (action === 'switch') {
      if (!sid) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'sessionId 必填')
      const session = loadDeduceSession(authorized.root, bookId, sid)
      if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${sid}`)
      const active = await writeActiveSessionId(authorized.root, bookId, sid)
      if (!active.ok) return sendError(res, active.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, active.message)
      return sendJson(res, 200, { ok: true, action: 'switch', sessionId: sid, session })
    }
    if (action === 'delete') {
      if (!sid) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'sessionId 必填')
      const removed = await deleteDeduceSession(authorized.root, bookId, sid)
      if (!removed.ok) return sendError(res, removed.code ?? API_ERROR_CODES.INVALID_ENTRY, removed.message)
      const listed = listDeduceSessions(authorized.root, bookId)
      const session = loadDeduceSession(authorized.root, bookId, listed.activeId)
      return sendJson(res, 200, { ok: true, action: 'delete', sessionId: sid, session, ...listed })
    }
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'action 只认 new / switch / delete')
  }

  if (endpointId === 'deduceArchive') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveFactBookId(authorized.root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(authorized.root, bookId)
    const session = loadDeduceSession(authorized.root, bookId, sid)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
    const archived = await archiveChapter(authorized.root, session, { title: text(request.title) })
    if (!archived.ok) return sendError(res, archived.code ?? API_ERROR_CODES.INVALID_ENTRY, archived.message)
    return sendJson(res, 200, { ok: true, path: archived.path, words: archived.words })
  }

  // 推演回合层（OS-61 P2）：选候选/自定义 → 结算 → 成文草稿 → 拍进会话缓存区。
  // regenerate:true 只重写最后一拍的正文（覆盖 node.prose），不结算、不新增节点。
  if (endpointId === 'deduceTurn') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveFactBookId(root, request.bookId)
    // OS-86：局跟 sessionId 走——引擎状态（候选桥接/结算）与会话存储必须同一局
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const customText = text(request.customText).trim()
    const choiceId = text(request.choiceId).trim()
    const session = loadDeduceSession(root, bookId, sid)
      ?? normalizeDeduceSession({ schema: DEDUCE_SESSION_SCHEMA, nodes: [] }, bookId, sid)
    const branchId = session.branchId || 'main'
    const branchNodes = session.nodes.filter((node) => (text(node?.branchId) || 'main') === branchId)

    if (request.regenerate === true) {
      const last = branchNodes[branchNodes.length - 1]
      if (!last) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '还没有可重写的拍：先选一条候选或自己写一拍')
      const previous = branchNodes[branchNodes.length - 2]
      const gen = await generateTurnProse({ context, root, node: last, previousProse: previous?.prose })
      // 模型不可用时不毁旧稿：prose 保持原样，proseError 如实报
      if (gen.prose) {
        last.prose = gen.prose
        const buffered = (session.buffer?.nodes ?? []).find((node) => node.id === last.id)
        if (buffered) buffered.prose = gen.prose
        if (session.buffer) session.buffer.words = (session.buffer.nodes ?? []).reduce((sum, node) => sum + turnNodeWords(node), 0)
      }
      const saved = await saveDeduceSession(root, bookId, session)
      if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
      return sendJson(res, 200, { ok: true, node: last, session, prose: text(last.prose), ...(gen.proseError ? { proseError: gen.proseError } : {}) })
    }

    if (!customText && !choiceId) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '选一条候选（choiceId）或自己写（customText）再结算')
    }
    let settled
    if (customText) {
      settled = await deduceSettle({ root, bookId, action: 'inject', note: customText, sessionId: sid })
    } else {
      const bridged = await bridgeDeduceCandidates(root, bookId, sid)
      if (!bridged.ok) return sendError(res, bridged.code ?? API_ERROR_CODES.INVALID_ENTRY, bridged.message)
      settled = await deduceSettle({ root, bookId, candidateId: choiceId, action: 'choose', sessionId: sid })
    }
    if (!settled.ok) return sendError(res, settled.code ?? API_ERROR_CODES.INVALID_ENTRY, settled.message)
    // OS-82 回填闭环：结算产出的 fact 条目不自动落库——挂会话 pending 队列（待确认卡），
    // 作者点「写入拆解」才走 writeFactFile 单条 upsert；点「忽略」只出队。
    const settledEntry = settled.result?.entry ?? null

    // 局面与候选取自引擎最后一面（present 存的 lastTurn）；自定义拍补一条「作者」候选
    let lastTurn = null
    try { lastTurn = JSON.parse(readFileSync(deduceStatePath(root, bookId, sid), 'utf-8')).lastTurn ?? null } catch { lastTurn = null }
    const sceneCard = lastTurn?.sceneCard ?? {}
    const candidates = (Array.isArray(lastTurn?.candidates) ? lastTurn.candidates : [])
      .map((candidate) => ({ id: text(candidate?.id), source: text(candidate?.source), text: text(candidate?.text) }))
    if (customText) candidates.push({ id: 'custom', source: '作者', text: customText })
    const draft = {
      round: settled.round,
      choiceId: customText ? 'custom' : choiceId,
      scene: {
        who: Array.isArray(sceneCard.who) ? sceneCard.who.filter(Boolean).join('、') : text(sceneCard.who),
        where: text(sceneCard.where),
        tension: text(sceneCard.tension),
        hook: text(sceneCard.hook)
      },
      candidates,
      prose: ''
    }
    const previous = branchNodes[branchNodes.length - 1]
    // 剧情树父链（OS-61 P3）：接本分支上一拍；新分支第一拍没有上一拍＝溯源到分叉节点
    let parentId = text(previous?.id)
    if (!parentId && branchId !== 'main') {
      const fork = session.nodes.find((node) => Array.isArray(node?.forkBranchIds) && node.forkBranchIds.includes(branchId))
      parentId = text(fork?.id)
    }
    draft.parentId = parentId
    const gen = await generateTurnProse({ context, root, node: draft, previousProse: previous?.prose })
    draft.prose = gen.prose
    const node = appendNode(session, draft)
    if (settledEntry) {
      session.pending = Array.isArray(session.pending) ? session.pending : []
      session.pending.push({
        id: `pd-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        nodeId: text(node.id),
        round: Number(settled.round) || 0,
        decidedBy: text(settledEntry.provenance?.decidedBy),
        entry: settledEntry,
        addedAt: new Date().toISOString()
      })
    }
    const saved = await saveDeduceSession(root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, node, session, prose: node.prose, ...(gen.proseError ? { proseError: gen.proseError } : {}) })
  }

  if (endpointId === 'roleplayOpeningGet') {
    // OS-100 扮演开场：主持人替世界拉开第一幕（时间/地点/在场/第一眼）＋三条初始分支。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveFactBookId(root, request.bookId)
    const loaded = loadEntries(root)
    if (!loaded.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, loaded.message)
    // OS-107 修：空事实包不能开局——扮演底座必须有世界书/拆解条目，否则模型凭空编造
    if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这个库还没有事实包（拆解条目/世界书词条）——先补世界书或跑 enrich，再开始扮演')
    }
    const chapterLimit = Number.isFinite(Number(request.chapterLimit)) && Number(request.chapterLimit) > 0 ? Number(request.chapterLimit) : null
    const entries = chapterLimit == null
      ? loaded.entries
      : loaded.entries.filter((entry) => {
          const fc = Number(entry?.firstChapter)
          if (Number.isFinite(fc) && fc >= 0) return fc <= chapterLimit
          const chapters = Array.isArray(entry?.chapters) ? entry.chapters.filter(Number.isInteger) : []
          return chapters.length ? Math.min(...chapters) <= chapterLimit : true
        })
    const cast = entries
      .filter((entry) => text(entry?.layer).toLowerCase() === 'character')
      .map((entry) => ({
        name: text(entry?.name).trim(),
        identity: text(entry?.identity) || text(entry?.definition),
        archetype: text(entry?.archetype)
      }))
      .filter((c) => c.name)
    const pov = text(request.pov).trim()
    if (!pov) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '先选你要扮演谁（pov）')
    const upstream = await resolveUpstreamSafe({ context })
    const chatComplete = async (prompt, opts = {}) => {
      const out = await chatCompleteViaUpstream({ upstream, system: prompt, maxTokens: opts.maxTokens ?? 700, temperature: 0.9, cwd: root })
      if (out.error) throw new Error(out.error)
      return out.text ?? ''
    }
    const result = await roleplayOpening({
      chatComplete,
      entries,
      premise: text(request.premise),
      cast,
      pov,
      openingDetail: text(request.openingDetail),
      chapterLimit
    })
    if (!result.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, result.error ?? '开场没有产出')
    // OS-102：开场也过 AI 味闸（超阈重写一次；只换文风不动事实）
    const gated = await deAiPass({ chatComplete, prose: result.feedback })
    return sendJson(res, 200, {
      ok: true,
      feedback: gated.text,
      options: result.options ?? [],
      ...(gated.rewritten ? { deAiSmell: gated.before?.score ?? null } : {})
    })
  }

  if (endpointId === 'roleplayTurn') {
    // OS-97 扮演一回合：主持人裁决 → N 角色各自成文 → 主持人收束（对「你」说话）。
    // 世界书按 chapterLimit 过滤（OS-96）；玩家可以扮演任意角色或「主持人」。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveFactBookId(root, request.bookId)
    const loaded = loadEntries(root)
    if (!loaded.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, loaded.message)
    // OS-107 修：空事实包不能演——与开场同口径
    if (!Array.isArray(loaded.entries) || loaded.entries.length === 0) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这个库还没有事实包——扮演需要世界书/拆解条目作底座')
    }
    // 世界书按章过滤（OS-96）：chapterLimit 给了＝晚于该章成立的词条不存在
    const chapterLimit = Number.isFinite(Number(request.chapterLimit)) && Number(request.chapterLimit) > 0 ? Number(request.chapterLimit) : null
    const entries = chapterLimit == null
      ? loaded.entries
      : loaded.entries.filter((entry) => {
          const fc = Number(entry?.firstChapter)
          if (Number.isFinite(fc) && fc >= 0) return fc <= chapterLimit
          const chapters = Array.isArray(entry?.chapters) ? entry.chapters.filter(Number.isInteger) : []
          return chapters.length ? Math.min(...chapters) <= chapterLimit : true
        })
    const cast = entries
      .filter((entry) => text(entry?.layer).toLowerCase() === 'character')
      .map((entry) => ({
        name: text(entry?.name).trim(),
        identity: text(entry?.identity) || text(entry?.definition),
        archetype: text(entry?.archetype),
        personality: Array.isArray(entry?.personality) ? entry.personality.filter(Boolean).slice(0, 5) : []
      }))
      .filter((c) => c.name)
    const pov = text(request.pov).trim()
    const playerAction = text(request.playerAction).trim() || text(request.customText).trim()
    if (!pov) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '先选你要扮演谁（pov）')
    if (!playerAction) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这一幕你做什么/说什么（playerAction）必填')
    // 最近几拍摘要（会话层复用 deduceSession——扮演与推演共用容器）
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const session = loadDeduceSession(root, bookId, sid)
    // OS-102 长期记忆：滚动摘要（长期）＋最近几拍明细（短期）——跑长了 agent 不会忘前情
    const mem = buildRoleplayMemory(session, { recentLimit: 3 })
    const recent = [mem.summaryText, mem.recentText].filter(Boolean).join('\n\n')
    const upstream = await resolveUpstreamSafe({ context })
    const chatComplete = async (prompt, opts = {}) => {
      const out = await chatCompleteViaUpstream({ upstream, system: prompt, maxTokens: opts.maxTokens ?? 600, temperature: 0.85, cwd: root })
      if (out.error) throw new Error(out.error)
      return out.text ?? ''
    }
    const result = await roleplayTurn({
      chatComplete,
      entries,
      premise: text(request.premise),
      cast,
      playerAction,
      pov,
      recent,
      activation: text(request.activation) || 'mention',
      chapterLimit
    })
    if (!result.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, result.error ?? '本幕没有产出')
    // OS-102：世界反馈落稿前过 AI 味闸（角色演绎 beats 保持原样——那是演员的口吻）
    const gated = await deAiPass({ chatComplete, prose: result.feedback })
    result.feedback = gated.text
    // 会话落一行节点（复用 deduceSession 容器；kind 标 roleplay）
    const draft = {
      round: (Number(session?.cursor) || 0) + 1,
      choiceId: 'custom',
      scene: { who: result.beats.map((b) => b.name).join('、'), where: '', tension: '', hook: '' },
      candidates: [{ id: 'custom', source: '作者', text: playerAction }],
      prose: result.feedback
    }
    draft.beats = result.beats
    let savedSession = session
    if (savedSession) {
      const node = appendNode(savedSession, draft)
      const saved = await saveDeduceSession(root, bookId, savedSession)
      if (!saved.ok) { /* 会话写失败不吞本幕结果——如实带回 */ savedSession = null; var sessionSaveError = saved.message }
      else var savedNode = node
    }
    // OS-102：回合完成后检查是否该压缩记忆——异步跑，不拖慢响应；失败静默（下次再压）
    if (session && shouldSummarize(session, { every: 6 })) {
      ;(async () => {
        try {
          const fresh = loadDeduceSession(root, bookId, sid)
          if (!fresh) return
          const compressed = await compressMemory({ chatComplete, session: fresh, batch: 6 })
          if (!compressed.ok) return
          fresh.rollingSummary = compressed.rollingSummary
          await saveDeduceSession(root, bookId, fresh)
        } catch { /* 压缩失败不影响扮演 */ }
      })()
    }
    return sendJson(res, 200, {
      ok: true,
      beats: result.beats,
      feedback: result.feedback,
      options: result.options ?? [],
      ...(savedNode ? { node: savedNode } : {}),
      ...(sessionSaveError ? { sessionError: sessionSaveError } : {})
    })
  }

  if (endpointId === 'deduceExport') {
    // OS-94：推演导出——整个会话（每拍的决定＋正文＋归档清单）出 markdown，
    // 落 推演/<bookId>/导出/会话-<sid>-<ts>.md。读侧动作，不改会话。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveFactBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
    const nodes = Array.isArray(session.nodes) ? session.nodes : []
    const lines = [`# 推演会话 · ${text(session.title)}`, '']
    lines.push(`> 导出于 ${new Date().toISOString().slice(0, 19).replace('T', ' ')} · ${bookId} · 局「${text(session.title)}」（${sid}） · 共 ${nodes.length} 拍`, '')
    for (const node of nodes) {
      const chosen = (Array.isArray(node.candidates) ? node.candidates : []).find((c) => text(c.id) === text(node.choiceId))
      lines.push(`## 第${Number(node?.round) || 0}拍`, '')
      if (chosen && text(chosen.text)) lines.push(`> **你的决定**：${text(chosen.text)}`, '')
      const prose = text(node.prose).trim()
      lines.push(prose || '（本拍没有正文）', '')
    }
    if (Array.isArray(session.archived) && session.archived.length) {
      lines.push('## 已归档章节', '', ...session.archived.map((a) => `- ${text(a.path)}（${Number(a.words) || 0} 字）`), '')
    }
    const exportDir = join(root, '推演', safeDeduceBookId(bookId), '导出')
    await mkdir(exportDir, { recursive: true })
    const fileName = `会话-${safeDeduceBookId(bookId)}-${sid}-${Date.now().toString(36)}.md`
    const outPath = join(exportDir, fileName)
    await writeFile(outPath, lines.join('\n'), 'utf-8')
    return sendJson(res, 200, { ok: true, path: `推演/${safeDeduceBookId(bookId)}/导出/${fileName}`, words: lines.join('\n').length })
  }

  if (endpointId === 'deducePromote') {
    // OS-94：转正——把一拍的正文写进 正文/ 成正式章节（createChapter 自动下一章号＋
    // writeChapterWithBackup 备份通道）。prose 为空＝拒绝（先重写或自己写完）。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveFactBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
    const nodeId = text(request.nodeId).trim()
    const node = (Array.isArray(session.nodes) ? session.nodes : []).find((n) => text(n?.id) === nodeId)
    if (!node) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话里没有这一拍：${nodeId}`)
    const prose = text(node.prose).trim()
    if (!prose) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '这一拍还没有正文——先「重写」出稿或自己写完，再转正')
    const created = await createChapter(root, '正文', text(request.title).trim() || `推演第${Number(node.round) || 0}拍`)
    if (!created.ok) return sendError(res, created.code ?? API_ERROR_CODES.INVALID_ENTRY, created.message ?? '章节创建失败')
    const written = await writeChapterWithBackup(root, created.chapter.file, prose)
    if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, written.message ?? '章节写入失败')
    return sendJson(res, 200, { ok: true, file: created.chapter.file, chapter: created.chapter, chars: prose.length })
  }

  if (endpointId === 'deducePendingSettle') {
    // OS-82 回填闭环：待确认卡落库（write）/丢弃（dismiss）。写走内核 writeFactFile 的
    // 单条 upsert（entry 形态：按 id 命中替换、没有就追加）——推演一拍只进一条事件，
    // 绝不动拆解文件里其他条目（与 factEntriesImport 的整份替换是两回事）。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveFactBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const pendingId = text(request.pendingId).trim()
    const action = text(request.action || 'write')
    if (!pendingId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'pendingId 必填')
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, '这个库还没有推演会话')
    const index = (Array.isArray(session.pending) ? session.pending : []).findIndex((item) => text(item?.id) === pendingId)
    if (index < 0) return sendError(res, API_ERROR_CODES.NOT_FOUND, '这条待确认卡已不存在（可能已写入或已忽略）——刷新会话即可')
    const item = session.pending[index]
    if (action === 'dismiss') {
      session.pending.splice(index, 1)
      const saved = await saveDeduceSession(root, bookId, session)
      if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
      return sendJson(res, 200, { ok: true, action: 'dismiss', session })
    }
    if (action !== 'write' || !item.entry || typeof item.entry !== 'object') {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'action 只认 write/dismiss，卡上要有结算产出的条目')
    }
    // 写前重读 revision 走乐观并发（与 factEntriesImport 同口径），避免覆盖别人刚写的拆解
    let expectedRevision = null
    let beforeFactRaw = '' // OS-107：写前原文（写后就读不到旧内容了）——变更日志的 diff 靠它
    try {
      const factPath = join(root, '拆解', `${bookId}.json`)
      if (existsSync(factPath)) {
        beforeFactRaw = await readFile(factPath, 'utf-8')
        const existing = JSON.parse(beforeFactRaw)
        const rev = Number(existing?.revision)
        if (Number.isSafeInteger(rev) && rev >= 1) expectedRevision = rev
      }
    } catch { /* 读不到就当新建 */ }
    const entryExisted = beforeFactRaw !== ''
    const written = await factStore.writeFactFile({
      root,
      bookId,
      entry: item.entry,
      operationId: `deduce-backfill-${pendingId}`,
      ...(expectedRevision !== null ? { expectedRevision } : {})
    })
    if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, written.message ?? '写入拆解失败', written.details)
    // OS-107：fact 落盘即留痕（AGENTS.md 第 10 条）。失败分支已提前 return，这里是最窄的
    // 「写成功即记」点；日志写失败不阻断主写入，但要如实回传给调用方。
    let factLogError = ''
    try {
      const factRel = `拆解/${bookId}.json`
      const afterFactRaw = await readFile(join(root, '拆解', `${bookId}.json`), 'utf-8')
      const logged = await recordChange({
        root,
        module: '拆解',
        file: factRel,
        op: entryExisted ? 'update' : 'create',
        before: beforeFactRaw,
        after: afterFactRaw,
        actor: 'agent',
        meta: {
          pendingId,
          bookId,
          entryId: text(item.entry.id),
          operationId: `deduce-backfill-${pendingId}`,
          ...(Number(written.revision) ? { revision: Number(written.revision) } : {})
        }
      })
      if (logged.ok === false) factLogError = logged.message
    } catch (error) {
      factLogError = `读回拆解档失败：${text(error?.message || error)}`
    }
    session.pending.splice(index, 1)
    const saved = await saveDeduceSession(root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, {
      ok: true,
      action: 'write',
      session,
      ...(Number(written.revision) ? { revision: Number(written.revision) } : {}),
      ...(factLogError ? { logError: factLogError } : {})
    })
  }

  // 剧情树分支（OS-61 P3）：从某一拍开新分支。只动 branchId/cursor 与分叉溯源，
  // nodes 全量保留；缓存区沿用 switchBranch 语义不动（归档仍按缓存区里的拍走）。
  if (endpointId === 'deduceImage') {
    // 生图（OS-63 预留转正）：调全局配置的 image 块（OpenAI 兼容 images/generations），
    // 产物落 推演/<bookId>/素材/场景/<name>.png。没开开关/没填端点＝如实报，不假装生成。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const { config } = await loadConfigV2(context.agentConfigPath)
    const image = config.image
    if (!image.enabled) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '生图没启用——设置 · 模型 · 生图里打开开关并填 OpenAI 兼容 images API 的地址与模型后可用')
    }
    const name = text(request.name).trim().slice(0, 40)
    const prompt = text(request.prompt).trim()
    if (!name || !prompt) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'name 与 prompt 必填')
    if (/[\/]|\.\./u.test(name)) return sendError(res, API_ERROR_CODES.PATH_ESCAPE, 'name 不能含路径分隔符')
    const size = text(request.size).trim() || '1024x1024'
    // OS-74：双后端——openai（同步 images/generations）或 comfyui（提交→轮询→取图）
    let b64 = ''
    if (image.backend === 'comfyui') {
      if (!text(image.comfyUrl).trim()) {
        return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置 ComfyUI 地址——设置 · 模型 · 生图里切到 ComfyUI 并填端口')
      }
      // 风格提示词优先级：请求覆盖 > 设置里的 stylePrompt > 内置默认「2D彩漫风格」
      const stylePrefix = text(request.stylePrompt).trim() || text(image.stylePrompt).trim() || DEFAULT_IMAGE_STYLE
      const comfy = await generateViaComfy({
        comfyUrl: image.comfyUrl,
        workflowPath: image.comfyWorkflow,
        root: authorized.root,
        nodeMap: image.comfyNodeMap,
        prompt: `${stylePrefix}，${prompt}。无文字。`,
        negative: text(request.negative).trim() || DEFAULT_IMAGE_NEGATIVE,
        size
      })
      if (!comfy.ok) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `ComfyUI 生图失败：${comfy.error}`)
      b64 = comfy.b64
    } else {
      if (!image.endpoint) {
        return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置生图端点——设置 · 模型 · 生图里填 OpenAI 兼容 images API 的地址与模型后可用')
      }
      const stylePrefix = text(request.stylePrompt).trim() || text(image.stylePrompt).trim() || DEFAULT_IMAGE_STYLE
      const body = JSON.stringify({ model: text(image.model), prompt: `${stylePrefix}，${prompt}。无文字。`, size, n: 1, response_format: 'b64_json' })
      let payload = null
      try {
        const response = await fetch(imagesGenerationsUrl(image.endpoint), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(image.apiKey ? { authorization: `Bearer ${image.apiKey}` } : {}) },
          body, signal: AbortSignal.timeout(300_000)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status} · ${(await response.text()).slice(0, 200)}`)
        payload = await response.json()
      } catch (error) {
        return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `生图端点失败：${text(error?.message || error)}`)
      }
      b64 = payload?.data?.[0]?.b64_json
      if (!b64) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '生图端点没有返回图片数据（b64_json 为空）')
    }
    const dir = join(authorized.root, '推演', safeDeduceBookId(bookId), '素材', '场景')
    await mkdir(dir, { recursive: true })
    const path = join(dir, `${name}.png`)
    const tmp = `${path}.tmp-${Date.now()}`
    await writeFile(tmp, Buffer.from(b64, 'base64'))
    await rename(tmp, path)
    return sendJson(res, 200, { ok: true, name, path: `推演/${safeDeduceBookId(bookId)}/素材/场景/${name}.png`, size })
  }

  if (endpointId === 'deduceBranch') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const root = authorized.root
    const bookId = await resolveFactBookId(root, request.bookId)
    const sid = text(request.sessionId).trim() || readActiveSessionId(root, bookId)
    const fromNodeId = text(request.fromNodeId).trim()
    if (!fromNodeId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '指明从哪一拍开分支（fromNodeId）')
    const session = loadDeduceSession(root, bookId, sid)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `还没有推演会话：${bookId}`)
    const fromNode = session.nodes.find((node) => text(node?.id) === fromNodeId)
    if (!fromNode) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话里没有这一拍：${fromNodeId}`)
    const existing = new Set(session.nodes.map((node) => text(node?.branchId).trim() || 'main'))
    existing.add(text(session.branchId).trim() || 'main')
    let seq = 2
    while (existing.has(`branch-${seq}`)) seq += 1
    const branchId = `branch-${seq}`
    // 分叉溯源记在节点上（会话归一层只认固定顶层字段，节点原样透传）
    if (!Array.isArray(fromNode.forkBranchIds)) fromNode.forkBranchIds = []
    if (!fromNode.forkBranchIds.includes(branchId)) fromNode.forkBranchIds.push(branchId)
    session.branchId = branchId
    session.cursor = Number.isSafeInteger(Number(fromNode.round)) ? Number(fromNode.round) : 0
    const saved = await saveDeduceSession(root, bookId, session)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, saved.message)
    return sendJson(res, 200, { ok: true, session })
  }

  /* ---------- 文游素材（OS-61 P4）：立绘/BGM 占位骨架 ----------
   * 素材绑定约定（全部可选，缺失时前端用渐变占位块，不同 kind 不同色）：
   *   推演/<bookId>/素材/角色/<角色名>.png   —— 人物立绘/头像（按局面卡 who 匹配）
   *   推演/<bookId>/素材/场景/<场景名>.png   —— 场景立绘（按局面卡 where 匹配）
   *   推演/<bookId>/素材/bgm/<场景或情绪>.mp3 —— 背景乐（按场景名或张力情绪匹配）
   * 素材到位后无需改代码：盘点端点现扫目录，前端按名字对上就换真图。
   *
   * 生图接口预留（暂未启用——只留形状，不读不写任何配置）：
   * IMAGE_ENDPOINT_CONFIG = {
   *   endpoint: string,   // OpenAI 兼容 /v1/images/generations 完整地址
   *   model: string,      // 生图模型 id（如 gpt-image-1）
   *   size: string,       // '1024x1024' | '1536x1024' | '1024x1536'
   *   apiKey: string      // 只存 daemon 本机配置，任何响应不回显完整 key（与 agent-config 同红线）
   * }
   * 未来实现时：生成结果落上面的素材约定路径，前端零改动换真图。
   */
  if (endpointId === 'deduceAssets') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveFactBookId(authorized.root, request.bookId)
    const listed = await listDeduceAssets(authorized.root, bookId)
    if (!listed.ok) return sendError(res, listed.code, listed.message)
    return sendJson(res, 200, { ok: true, bookId, characters: listed.characters, scenes: listed.scenes, bgm: listed.bgm })
  }

  if (endpointId === 'deduceAssetFile') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = await resolveFactBookId(authorized.root, request.bookId)
    // 盘符注入闸：相对路径段里混进 `C:` 这类盘符会在 Windows 上改指向，直接按逃逸拒收
    if (text(request.path).includes(':')) {
      return sendError(res, API_ERROR_CODES.PATH_ESCAPE, `素材路径不许带盘符：${text(request.path)}`)
    }
    const resolved = resolveInsideRoot(authorized.root, `推演/${bookId}/素材/${text(request.path)}`)
    if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
    const ext = extname(resolved.path).toLowerCase()
    if (ext !== '.png' && ext !== '.mp3') {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `素材只收 .png（立绘）与 .mp3（BGM）：${text(request.path)}`)
    }
    let stats
    try {
      stats = statSync(resolved.path)
    } catch {
      return sendError(res, API_ERROR_CODES.NOT_FOUND, `素材不存在：${text(request.path)}`)
    }
    if (!stats.isFile() || stats.size > DEDUCE_ASSET_MAX) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `素材不是文件或超过 16MB：${text(request.path)}`)
    }
    res.writeHead(200, {
      'content-type': ext === '.png' ? 'image/png' : 'audio/mpeg',
      'content-length': stats.size,
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    })
    createReadStream(resolved.path).pipe(res)
    return
  }

  if (endpointId === 'agentRuntimeSetup') {
    const { kits } = loadRuntimeKits(context.runtimesDirs)
    const kit = kits.find((item) => item.id === text(request.id).trim())
    if (!kit) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `货架上没有这个运行时套件：${text(request.id)}`)
    if (kit.kind !== 'dsh') {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '只有 DSH 原生支持一键修复（CLI 服务请按货架提示自行安装）')
    }
    const tarball = text(request.runtimeTarball || kit.setup?.runtimeTarball || context.env.DSH_RUNTIME_TARBALL)
    const fixed = await setupDshStack({ env: context.env, dshCmd: text(context.env.DSH_CLI || 'dsh'), runtimeTarball: tarball })
    if (!fixed.ok) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, fixed.message, { steps: fixed.steps })
    }
    return sendJson(res, 200, { ok: true, state: fixed.state ?? 'ready', steps: fixed.steps, message: fixed.message })
  }

  if (endpointId === 'suiteStateDataGet') {
    const loaded = await getSuiteStateData(context.suitesDirs, context.suiteStatePath, request.id)
    if (!loaded.ok) return sendError(res, loaded.code ?? API_ERROR_CODES.INVALID_ENTRY, loaded.message)
    return sendJson(res, 200, { ok: true, id: loaded.id, values: loaded.values })
  }
  if (endpointId === 'suiteStateDataPut') {
    const saved = await saveSuiteStateData(context.suitesDirs, context.suiteStatePath, request.id, request.values)
    if (!saved.ok) return sendError(res, saved.code ?? API_ERROR_CODES.INVALID_ENTRY, saved.message)
    return sendJson(res, 200, { ok: true, values: saved.values })
  }
  if (endpointId === 'stylesGet') {
    const packs = await loadStylePacks(context.stylesDirs)
    // OS-109：带上真实目录——前端「本机路径」要显示绝对路径并能一键打开
    return sendJson(res, 200, { ok: true, styles: packs.styles, warnings: packs.warnings, dirs: (context.stylesDirs || []).filter(Boolean) })
  }

  if (endpointId === 'libraryDiagnose') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const diagnosed = await diagnoseLibrary(authorized.root)
    if (!diagnosed.ok) return sendError(res, diagnosed.code ?? API_ERROR_CODES.INVALID_ENTRY, diagnosed.message)
    return sendJson(res, 200, { ok: true, shape: diagnosed.shape, verdict: diagnosed.verdict })
  }

  if (endpointId === 'filesGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const listed = await listLibraryFiles(authorized.root, request.dir)
    if (!listed.ok) return sendError(res, listed.code ?? API_ERROR_CODES.INVALID_ENTRY, listed.message, listed.details)
    const payload = { ok: true, files: listed.files, ...(listed.dirs ? { dirs: listed.dirs } : {}), ...(listed.warnings?.length ? { warnings: listed.warnings } : {}) }
    return sendJson(res, 200, payload)
  }

  if (endpointId === 'referenceGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const index = await scanReferences(authorized.root)
    // OS-96：currentChapter 给了＝只回该章节前可见的词条（世界书按首次出现章节过滤，防剧透）
    const currentChapter = Number(request.currentChapter)
    const notes = Number.isFinite(currentChapter) && currentChapter > 0 ? notesVisibleAt(index.notes, currentChapter) : index.notes
    return sendJson(res, 200, { ok: true, ...index, notes, filtered: Number.isFinite(currentChapter) && currentChapter > 0 })
  }

  if (endpointId === 'referenceGraphGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const index = await scanReferences(authorized.root)
    // 条目作为只读节点参与图谱（不搬进参考，只被链接）
    let entries = []
    try {
      const store = factStore.createFactFileStore({ root: authorized.root })
      const listed = store.list({ offset: 0, limit: 500 })
      entries = Array.isArray(listed?.entries) ? listed.entries : []
    } catch { /* 没拆解目录就只有参考节点 */ }
    const graph = buildReferenceGraph(index, { entries })
    return sendJson(res, 200, { ok: true, ...graph })
  }

  if (endpointId === 'factEntriesImport') {
    // OS-78：剧本/外部数据 → 拆解条目。走内核 writeFactFile 的唯一写入口
    // （原子写 + revision 自增 + operationId 幂等 + 写前重读复核）。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = text(request.bookId).trim()
    if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
    const entries = Array.isArray(request.entries) ? request.entries : null
    if (!entries || !entries.length) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'entries 必须是非空数组')
    // operationId：调用方没给就由 daemon 生成（来源前缀 + bookId + 时间），满足内核幂等键要求
    const operationId = text(request.operationId).trim() || `screenplay-import-${bookId}-${Date.now().toString(36)}`
    // 已存在就带 expectedRevision 走乐观并发（避免覆盖别人刚写的）
    let expectedRevision = null
    let beforeFactRaw = '' // OS-107：写前原文（写后读不到旧内容）——变更日志的 before 靠它
    try {
      const documentPath = join(authorized.root, '拆解', `${bookId}.json`)
      if (existsSync(documentPath)) {
        beforeFactRaw = await readFile(documentPath, 'utf-8')
        const existing = JSON.parse(beforeFactRaw)
        const rev = Number(existing?.revision)
        if (Number.isSafeInteger(rev) && rev >= 1) expectedRevision = rev
      }
    } catch { /* 读不到就当新建 */ }
    const documentExisted = existsSync(factPath)  // OS-113 修：0 字节文件也算已存在（用 existsSync 而非内容非空）
    // 书元数据：写进 patch 的 book 字段（内核要求 patch 顶层浅合并）
    const patch = {
      book: { id: bookId, title: text(request.title).trim() || bookId },
      entries
    }
    const written = await factStore.writeFactFile({
      root: authorized.root,
      bookId,
      patch,
      operationId,
      ...(expectedRevision !== null ? { expectedRevision } : {})
    })
    if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, written.message ?? '写入拆解失败', written.details)
    // 兄弟 wiki 文件（章摘要/角色档/伏笔）——与 fact 主档一起落
    const wiki = request.wiki
    let wikiError = ''
    if (wiki && typeof wiki === 'object') {
      try {
        const wikiPath = join(authorized.root, '拆解', `${bookId}.wiki.json`)
        const tmpWiki = `${wikiPath}.tmp-${Date.now()}`
        await writeFile(tmpWiki, JSON.stringify({
          derivedFrom: { factRevision: Number(written.revision) || 1, schema: 'pinax-wiki-derived@1' },
          ...wiki
        }, null, 2), 'utf-8')
        await rename(tmpWiki, wikiPath)
      } catch (error) {
        // wiki 写失败不影响 fact 主档——但既然要记日志，就得让作者知道这次是同源档缺了一角
        wikiError = `兄弟 wiki 写失败：${text(error?.message || error)}`
      }
    }
    // OS-107：一次导入只留一条日志，并把兄弟 wiki 也算进同一次变更（这里是 wiki 块之后、
    // 响应之前）——before 用写前补读的原文，after 用写后重读的原文（含主档/wiki 的真实落盘结果）。
    let factLogError = ''
    try {
      const factRel = `拆解/${bookId}.json`
      const afterFactRaw = await readFile(join(authorized.root, '拆解', `${bookId}.json`), 'utf-8')
      const logged = await recordChange({
        root: authorized.root,
        module: '拆解',
        file: factRel,
        op: documentExisted ? 'update' : 'create',
        before: beforeFactRaw,
        after: afterFactRaw,
        actor: 'author',
        meta: {
          bookId,
          operationId,
          entryCount: entries.length,
          ...(wiki && typeof wiki === 'object' ? { wikiTouched: true } : {}),
          ...(Number(written.revision) ? { revision: Number(written.revision) } : {})
        }
      })
      if (logged.ok === false) factLogError = logged.message
    } catch (error) {
      factLogError = `读回拆解档失败：${text(error?.message || error)}`
    }
    return sendJson(res, 200, {
      ok: true,
      bookId,
      entries: entries.length,
      ...(Number(written.revision) ? { revision: Number(written.revision) } : {}),
      ...(written.backup ? { backup: written.backup } : {}),
      ...(factLogError ? { logError: factLogError } : {}),
      ...(wikiError ? { wikiError } : {})
    })
  }

  if (endpointId === 'visionDescribe') {
    // OS-76：识图走 DSH 子 agent（不是 LLM API）——DSH 有内置 read_image 工具，
    // 子 agent 用「设置里指定的 vision 模型」读图，按预设提示词写文学白描。
    // 这样不引入额外模型变量，跑动记录与 DSH 自己的会话一致。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const imageRel = text(request.image).trim().replaceAll('\x5c', '/')
    if (!imageRel) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'image 必填（库内图片相对路径）')
    if (!/\.(png|jpe?g|webp|gif|avif)$/iu.test(imageRel)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `不是图片：${imageRel}`)
    }
    const resolvedImage = resolveInsideRoot(authorized.root, imageRel, { allowMetadata: false })
    if (!resolvedImage.ok) return sendError(res, resolvedImage.code ?? API_ERROR_CODES.PATH_ESCAPE, resolvedImage.message)
    if (!existsSync(resolvedImage.path)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `图片不存在：${imageRel}`)
    }

    const { config } = await loadConfigV2(context.agentConfigPath)
    const vision = config.vision
    if (!vision.enabled) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '识图没启用——设置 · 模型 · 识图里打开开关并选模型')
    }

    // target 决定白描口径
    const target = text(request.target).trim() || 'character'
    const targetGuide = {
      character: '这是一个角色。写他的外形与气质：身形/衣着的具体质感、面容里最抓人的一处、姿态透出的性格。',
      scene: '这是一个场景。写氛围：光线从哪来、空气里有什么、什么地方冷、什么地方暖。',
      creature: '这是一个非人形象（怪物/异兽）。写它的体量与压迫感：尺度对比、不该有的细节、让人不敢直视的那一处。',
      item: '这是一个道具。写质感与来历感：材质、磨损、拿在手里的分量。'
    }[target] || '写这个画面的文学白描。'
    const focus = text(request.focus).trim()
    const habitContext = text(request.habitContext).trim()

    // ★ 预设提示词（作者口径：不让人现编，固定这套）
    const prompt = [
      '你有 read_image 工具。先读这张图，然后用文学语言写一段可直接进小说正文的白描。',
      '',
      `图片路径：${resolvedImage.path}`,
      '',
      '硬规矩：',
      '1. 只写看得见、能推理的。图上没有的身份/来历/情绪成因不编。',
      '2. 动词优先于形容词：「袍角扫过门槛」而不是「他穿着很长的袍子」。',
      '3. 不要写构图（「左侧是…」），换成小说里能出现的说法。',
      '4. 不要写风格词（「2D彩漫风格」），那是生图提示词不是正文。',
      '5. 150–300 字，只输出白描正文，不要标题、不要解释、不要 markdown 围栏。',
      '',
      targetGuide,
      focus ? `\n这次特别留意：${focus}` : '',
      habitContext ? `\n作者习惯（必须遵守）：${habitContext}` : ''
    ].filter(Boolean).join('\n')

    // 模型：设置里 vision.model（形如 provider/id）优先；没选＝用 DSH 默认
    const modelSelection = dshModelSelection(text(vision.model))
    const profile = text(vision.profile || context.env?.DSH_PROFILE || 'openstory').trim()
    let collected = ''
    const run = await runDshStdio({
      dshCmd: context.env?.DSH_CLI || 'dsh',
      profile,
      cwd: authorized.root,
      prompt,
      ...(modelSelection ? { model: modelSelection } : {}),
      inactivityMs: 180_000,
      timeoutMs: 600_000,
      onText: (piece) => { collected += piece }
    })
    if (!run.ok) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `DSH 识图失败：${text(run.message || run.code || 'unknown')}`)
    }
    const out = text(collected || run.text || '').trim()
    if (!out) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, 'DSH 子 agent 没有返回文本（模型可能不支持读图）')
    return sendJson(res, 200, {
      ok: true,
      text: out,
      chars: out.length,
      ...(modelSelection ? { model: `${modelSelection.provider}/${modelSelection.id}` } : {})
    })
  }

  if (endpointId === 'referenceAssetGet') {
    // OS-75：世界书图片本体（只读，只放行 参考/ 下的图片扩展名）。
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const assetPath = text(request.path).trim().replaceAll('\x5c', '/')
    if (!assetPath.startsWith(`${REFERENCE_DIR}/`)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `只放行参考目录下的图片：${assetPath}`)
    }
    if (!/\.(png|jpe?g|webp|gif|avif)$/iu.test(assetPath)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `不是图片扩展名：${assetPath}`)
    }
    const resolvedAsset = resolveInsideRoot(authorized.root, assetPath, { allowMetadata: false })
    if (!resolvedAsset.ok) return sendError(res, resolvedAsset.code ?? API_ERROR_CODES.PATH_ESCAPE, resolvedAsset.message)
    let buf
    try { buf = await readFile(resolvedAsset.path) } catch (error) {
      if (error?.code === 'ENOENT') return sendError(res, API_ERROR_CODES.NOT_FOUND, `图片不存在：${assetPath}`)
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `读图失败：${text(error?.message || error)}`)
    }
    const ext = assetPath.split('.').pop().toLowerCase()
    const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'webp' ? 'image/webp' : ext === 'gif' ? 'image/gif' : ext === 'avif' ? 'image/avif' : 'image/png'
    res.writeHead(200, { 'content-type': mime, 'cache-control': 'no-cache', 'content-length': buf.length })
    return res.end(buf)
  }

  if (endpointId === 'referenceImageGenerate') {
    // OS-80：生图改异步——先提交到全局任务中心（立刻返回 jobId），任务后台跑。
    // 作者口径：「切走再回来不应丢状态」，进度要能跨页面看到。
    // async:true 时走任务中心；不带 async 保留原同步行为（MCP / 兼容用）。
    if (request.async === true) {
      const authorized0 = authorizeRoot(allowlist, request.root)
      if (!authorized0.ok) return sendError(res, authorized0.code, authorized0.message, authorized0.details)
      const reqPath = text(request.path).trim()
      const title = reqPath.split('/').pop().replace(/\.md$/u, '')
      const port = context.port || DEFAULT_PORT
      const job = submitJob({
        kind: 'image',
        label: `生成设定图：${title}`,
        root: authorized0.root,
        run: async ({ update, signal }) => {
          update('正在生图（ComfyUI 约 2–3 分钟）…')
          // 同进程回环调用同步端点：逻辑与 MCP/界面点「生成」完全一致，只有一份实现
          const resp = await fetch(`http://127.0.0.1:${port}/api/reference/image`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ ...request, async: undefined }),
            signal: signal ?? undefined
          })
          const payload = await resp.json().catch(() => null)
          if (!resp.ok || payload?.ok === false) {
            throw new Error(payload?.error?.message || `生图失败（HTTP ${resp.status}）`)
          }
          update(`已生成：${payload.imagePath}`)
          return payload
        }
      })
      return sendJson(res, 200, { ok: true, jobId: job.id, async: true })
    }
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const requested = text(request.path).trim().replaceAll('\\', '/')
    if (!requested.startsWith(`${REFERENCE_DIR}/`)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `只给参考目录下的条目生图：${requested}`)
    }
    const resolved = resolveInsideRoot(authorized.root, requested, { allowMetadata: false })
    if (!resolved.ok) return sendError(res, resolved.code ?? API_ERROR_CODES.PATH_ESCAPE, resolved.message)

    const { config } = await loadConfigV2(context.agentConfigPath)
    const image = config.image
    if (!image.enabled) {
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '生图没启用——设置 · 模型 · 生图里打开开关')
    }

    // 读条目原文，拿 title / 正文摘要 作为生图描述（作者可显式传 prompt 覆盖）
    let noteRaw = ''
    try { noteRaw = await readFile(resolved.path, 'utf-8') } catch (error) {
      return sendError(res, API_ERROR_CODES.NOT_FOUND, `条目读不了：${text(error?.message || error)}`)
    }
    const { parseFrontmatter, serializeFrontmatter } = await import('./referenceStore.mjs')
    const parsed = parseFrontmatter(noteRaw)
    const noteTitle = text(parsed.data?.title).trim() || text(requested).split('/').pop().replace(/\.md$/u, '')
    const noteKind = text(request.kind).trim() || text(parsed.data?.kind).trim() || 'character'
    const bodyExcerpt = text(parsed.body).split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#')).slice(0, 3).join(' ').slice(0, 200)

    const describe = text(request.prompt).trim()
      || `${noteKind === 'scene' ? '场景' : noteKind === 'item' ? '道具' : '人物'}设定图：${noteTitle}。${bodyExcerpt || '（按条目名想象）'}`
    const stylePrefix = text(request.stylePrompt).trim() || text(image.stylePrompt).trim() || DEFAULT_IMAGE_STYLE
    const size = text(request.size).trim() || '1024x1024'

    let b64 = ''
    if (image.backend === 'comfyui') {
      if (!text(image.comfyUrl).trim()) {
        return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置 ComfyUI 地址')
      }
      const comfy = await generateViaComfy({
        comfyUrl: image.comfyUrl,
        workflowPath: image.comfyWorkflow,
        root: authorized.root,
        nodeMap: image.comfyNodeMap,
        prompt: `${stylePrefix}，${describe}。无文字。`,
        negative: DEFAULT_IMAGE_NEGATIVE,
        size
      })
      if (!comfy.ok) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `ComfyUI 生图失败：${comfy.error}`)
      b64 = comfy.b64
    } else {
      if (!image.endpoint) {
        return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, '未配置生图端点')
      }
      try {
        const response = await fetch(imagesGenerationsUrl(image.endpoint), {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...(image.apiKey ? { authorization: `Bearer ${image.apiKey}` } : {}) },
          body: JSON.stringify({ model: text(image.model), prompt: `${stylePrefix}，${describe}。无文字。`, size, n: 1, response_format: 'b64_json' }),
          signal: AbortSignal.timeout(300_000)
        })
        if (!response.ok) throw new Error(`HTTP ${response.status} · ${(await response.text()).slice(0, 200)}`)
        const payload = await response.json()
        b64 = payload?.data?.[0]?.b64_json
        if (!b64) throw new Error('端点没返回 b64_json')
      } catch (error) {
        return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `生图端点失败：${text(error?.message || error)}`)
      }
    }

    // 落盘：参考/<条目目录>/assets/<条目名>.png（安全名）
    const safeName = noteTitle.replace(/[\\/:*?"<>|]/gu, '_').slice(0, 40) || 'image'
    const noteDir = requested.split('/').slice(0, -1).join('/')
    const imageRel = `${noteDir}/assets/${safeName}.png`
    const imageAbs = resolveInsideRoot(authorized.root, imageRel, { allowMetadata: false })
    if (!imageAbs.ok) return sendError(res, imageAbs.code ?? API_ERROR_CODES.PATH_ESCAPE, imageAbs.message)
    await mkdir(dirname(imageAbs.path), { recursive: true })
    const tmpImage = `${imageAbs.path}.tmp-${Date.now()}`
    await writeFile(tmpImage, Buffer.from(b64, 'base64'))
    await rename(tmpImage, imageAbs.path)

    // 回填 frontmatter：cover 指向新图，images 数组追加（去重，保留最近 6 张）
    const nextData = { ...parsed.data }
    const images = Array.isArray(nextData.images) ? nextData.images.map((x) => text(x).trim()).filter(Boolean) : []
    if (!images.includes(imageRel)) images.unshift(imageRel)
    nextData.images = images.slice(0, 6)
    if (!text(nextData.cover).trim()) nextData.cover = imageRel
    const nextRaw = `${serializeFrontmatter(nextData)}\n${parsed.body}`
    const written = await writeChapterWithBackup(authorized.root, requested, nextRaw)
    if (!written.ok) return sendError(res, written.code, written.message, written.details)

    return sendJson(res, 200, {
      ok: true,
      path: requested,
      imagePath: imageRel,
      frontmatter: nextData,
      chars: nextRaw.length
    })
  }

  if (endpointId === 'referenceNoteGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const requested = text(request.path).trim().replaceAll('\\', '/')
    if (!requested.startsWith(`${REFERENCE_DIR}/`)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `只读参考目录下的笔记：${requested}`)
    }
    let raw
    try {
      const resolved = resolveInsideRoot(authorized.root, requested, { allowMetadata: false })
      if (!resolved.ok) return sendError(res, resolved.code ?? API_ERROR_CODES.PATH_ESCAPE, resolved.message)
      raw = await readFile(resolved.path, 'utf-8')
    } catch (error) {
      if (error?.code === 'ENOENT') return sendError(res, API_ERROR_CODES.NOT_FOUND, `笔记不存在：${requested}`)
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `读笔记失败：${text(error?.message || error)}`)
    }
    const index = await scanReferences(authorized.root)
    const note = index.notes.find((item) => item.path === requested) ?? null
    const backlinks = backlinksOf(index, requested)
    return sendJson(res, 200, {
      ok: true,
      note: { ...(note || { path: requested, title: requested.split('/').pop() }), text: raw },
      backlinks
    })
  }

  if (endpointId === 'referenceAbsorb') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    // OS-48：旧目录迁入参考。规划（哪些搬、哪些目标冲突）在 referenceStore，真搬运走
    // writeChapterWithBackup（原子写目标）+ deleteChapter（源进 .history，可逆）这两条既有通道。
    const planned = await absorbLegacyDirs(authorized.root, Array.isArray(request.dirs) ? request.dirs : [])
    if (!planned.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, planned.message)
    const moved = []
    const skipped = [...planned.skipped]
    for (const item of planned.moves) {
      let content
      try {
        const src = resolveInsideRoot(authorized.root, item.fromRel, { allowMetadata: false })
        if (!src.ok) {
          skipped.push({ path: item.fromRel, reason: src.message })
          continue
        }
        content = await readFile(src.path, 'utf-8')
      } catch (error) {
        skipped.push({ path: item.fromRel, reason: `读不到：${text(error?.message || error)}` })
        continue
      }
      const written = await writeChapterWithBackup(authorized.root, item.toRel, content)
      if (!written.ok) {
        skipped.push({ path: item.fromRel, reason: written.message })
        continue
      }
      const removed = await deleteChapter(authorized.root, item.fromRel)
      if (!removed.ok) {
        skipped.push({ path: item.fromRel, reason: `目标已写入，但删源失败（旧文件保留原位）：${removed.message}` })
        continue
      }
      moved.push({ from: item.fromRel, to: item.toRel, backup: removed.backup })
    }
    return sendJson(res, 200, { ok: true, moved, skipped })
  }

  if (endpointId === 'dirCreate') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const name = String(request.name ?? '').trim()
    // 单段目录名：禁分隔符、禁 . / .. / 隐藏名、禁库内保留目录，字符集收紧到常见可写名字
    if (!name) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '目录名不能为空')
    if (/[\\/:*?"<>|]/u.test(name) || name.startsWith('.') || name.length > 64) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '目录名不能含路径分隔符或特殊字符，也不能以 . 开头')
    }
    if (RESERVED_LIB_DIRS.has(name)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `${name}/ 是库内保留目录，请换一个名字`)
    }
    const abs = join(authorized.root, name)
    try {
      if (!existsSync(abs)) {
        await mkdir(abs, { recursive: false })
        return sendJson(res, 200, { ok: true, name, created: true })
      }
      const stat = statSync(abs)
      if (!stat.isDirectory()) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `${name} 已存在且不是目录`)
      return sendJson(res, 200, { ok: true, name, created: false })
    } catch (error) {
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `建目录失败：${error?.message ?? error}`)
    }
  }

  if (endpointId === 'chaptersGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const listed = await listChapters(authorized.root, request.dir)
    if (!listed.ok) return sendError(res, listed.code ?? API_ERROR_CODES.INVALID_ENTRY, listed.message, listed.details)
    return sendJson(res, 200, { ok: true, chapters: listed.chapters, ...(listed.warnings?.length ? { warnings: listed.warnings } : {}) })
  }

  if (endpointId === 'artifactsGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const inventory = await listArtifacts(authorized.root)
    if (!inventory.ok) return sendError(res, inventory.code ?? API_ERROR_CODES.INVALID_ENTRY, inventory.message)
    return sendJson(res, 200, { ok: true, groups: inventory.groups, totals: inventory.totals })
  }

  if (endpointId === 'chaptersCreate') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    // title 缺省＝用写作套件的「新建章节默认标题」（套件停用＝无默认，createChapter 自行拒绝）
    const defaultTitle = text(request.title).trim()
      || text(await suiteValue(context.suitesDirs, context.suiteStatePath, 'writing', 'newChapterTitle', ''))
    const created = await createChapter(authorized.root, request.dir, defaultTitle)
    if (!created.ok) return sendError(res, created.code ?? API_ERROR_CODES.INVALID_ENTRY, created.message, created.details)
    return sendJson(res, 200, { ok: true, chapter: created.chapter })
  }

  if (endpointId === 'chaptersRename') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const renamed = await renameChapter(authorized.root, request.file, request.title)
    if (!renamed.ok) return sendError(res, renamed.code ?? API_ERROR_CODES.INVALID_ENTRY, renamed.message, renamed.details)
    return sendJson(res, 200, { ok: true, chapter: renamed.chapter, ...(renamed.previousFile ? { previousFile: renamed.previousFile } : {}) })
  }

  if (endpointId === 'chapterDelete') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const deleted = await deleteChapter(authorized.root, request.file)
    if (!deleted.ok) return sendError(res, deleted.code ?? API_ERROR_CODES.INVALID_ENTRY, deleted.message, deleted.details)
    return sendJson(res, 200, { ok: true, backup: deleted.backup })
  }

  if (endpointId === 'nativePick') {
    // OS-108：原生选择器——浏览器拿不到绝对路径，由 daemon 弹 Windows 原生对话框。
    // kind: 'folder'（默认）/ 'file'；取消＝ok:false + CANCELLED（前端静默处理）。
    // 不读库、不写盘，纯对话框；非 Windows 如实报 UNSUPPORTED_PLATFORM。
    const kind = text(request.kind || 'folder').trim()
    const title = text(request.title).trim() || (kind === 'file' ? '选择文件' : '选择文件夹')
    const initialDir = text(request.initialDir).trim()
    // OS-118/119：本机上次已判定弹不出原生框——立刻降级，不让前端白等探测超时。
    // 判定落在 fs-browse.json（跨 daemon 重启复用）：删掉那行 nativeDialog 即可重试。
    if (NATIVE_DIALOG_UNUSABLE || readBrowseMemory(context.env).nativeDialog === 'NO_DESKTOP') {
      NATIVE_DIALOG_UNUSABLE = true
      return sendJson(res, 400, { ok: false, error: { code: 'NO_DESKTOP', message: '服务进程没有交互桌面，显示内建浏览器' } })
    }
    const result = kind === 'file'
      ? await pickFile({ title, initialDir, filter: text(request.filter).trim() || undefined, timeoutMs: NATIVE_DIALOG_TIMEOUT_MS })
      : await pickFolder({ title, initialDir, timeoutMs: NATIVE_DIALOG_TIMEOUT_MS })
    if (!result.ok) {
      // 取消不是错误：200 + ok:false + code，前端据此静默
      if (result.code === 'CANCELLED') return sendJson(res, 200, { ok: false, code: 'CANCELLED', message: '已取消' })
      // NO_DESKTOP：服务进程没有交互桌面（被后台/子进程启动）——400 并把 code 透传，
      // 前端据此提示「请手动启动 daemon 或手填路径」，而不是当成服务器故障
      if (result.code === 'NO_DESKTOP') {
        // 记住：本进程＋本机后续请求直接降级，不再等超时
        NATIVE_DIALOG_UNUSABLE = true
        writeBrowseMemory({ nativeDialog: 'NO_DESKTOP' }, context.env)
        return sendJson(res, 400, { ok: false, error: { code: 'NO_DESKTOP', message: result.message } })
      }
      return sendError(res, result.code === 'UNSUPPORTED_PLATFORM' ? API_ERROR_CODES.INVALID_ENTRY : API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, result.message)
    }
    // 真弹出了（说明有桌面）→ 清掉「弹不出」的记忆，下次 daemon 重启也照样走原生框
    if (readBrowseMemory(context.env).nativeDialog) writeBrowseMemory({ nativeDialog: '' }, context.env)
    return sendJson(res, 200, { ok: true, path: result.path })
  }

  if (endpointId === 'fsBrowse') {
    // OS-110 兜底：无桌面环境（后台启动的 daemon 弹不出模态对话框）时，
    // 前端用这个端点自建目录浏览器——列盘符/子目录，不影响任何写操作。
    const wanted = text(request.path).trim()
    // 空路径＝「默认根」：%USERPROFILE%\OpenStory（OS-119 作者口径「默认目录始终选择
    // 用户 C 盘的 openstory project」）。不存在就建出来——建库大多落这里，省得每次从头选。
    if (!wanted) {
      const env = context.env || process.env
      const home = text(env.USERPROFILE || env.HOME).trim()
      const defaultRoot = defaultBrowseRoot(env)
      // 上次选过的目录：只作「一键回到」的快捷入口，不改变默认起点（作者要「始终」）
      const memory = readBrowseMemory(env)
      const lastPicked = memory.lastPicked && existsSync(memory.lastPicked) ? memory.lastPicked.replace(/\\/gu, '/') : ''
      if (defaultRoot) {
        try { if (!existsSync(defaultRoot)) await mkdir(defaultRoot, { recursive: true }) } catch { /* 建不出就退盘符 */ }
        if (existsSync(defaultRoot)) {
          let items = []
          try { items = await readdir(defaultRoot, { withFileTypes: true }) } catch { items = [] }
          const entries = items
            .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
            .map((item) => ({ name: item.name, path: `${defaultRoot.replace(/\\/gu, '/')}/${item.name}`, kind: 'dir' }))
            .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
          // defaultRoot 让前端知道「这是默认起始位置」，上一级回到用户目录
          return sendJson(res, 200, {
            ok: true,
            path: defaultRoot.replace(/\\/gu, '/'),
            parent: home.replace(/\\/gu, '/'),
            entries,
            isDefaultRoot: true,
            defaultRoot: defaultRoot.replace(/\\/gu, '/'),
            lastPicked
          })
        }
      }
      // 退路：列盘符
      const drives = []
      for (const letter of 'CDEFGHIJKLMNOPQRSTUVWXYZ') {
        const root = `${letter}:\\`
        try { if (existsSync(root)) drives.push({ name: `${letter}:`, path: `${letter}:/`, kind: 'drive' }) } catch { /* 跳过 */ }
      }
      return sendJson(res, 200, { ok: true, path: '', parent: null, entries: drives })
    }
    // 规范化：允许 D:\foo / D:/foo
    const target = wanted.replaceAll('\\', '/')
    if (!existsSync(target)) return sendError(res, API_ERROR_CODES.NOT_FOUND, `目录不存在：${wanted}`)
    let items = []
    try {
      items = await readdir(target, { withFileTypes: true })
    } catch (error) {
      return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `读目录失败：${text(error?.message || error)}`)
    }
    const entries = items
      .filter((item) => item.isDirectory() && !item.name.startsWith('.'))
      .map((item) => ({ name: item.name, path: `${target.replace(/\/+$/u, '')}/${item.name}`, kind: 'dir' }))
      .sort((left, right) => left.name.localeCompare(right.name, 'zh-Hans-CN'))
    // 父目录（盘符根没有父级可回）
    const parent = /^[A-Za-z]:\/?$/u.test(target) ? '' : target.replace(/\/[^/]+\/?$/u, '') || ''
    // OS-119：用户「选了这个文件夹」时才记——单纯浏览不留痕，免得记忆被瞎逛带跑
    if (request.remember === true) writeBrowseMemory({ lastPicked: target }, context.env || process.env)
    const defaultRootNow = defaultBrowseRoot(context.env || process.env)
    return sendJson(res, 200, {
      ok: true, path: target, parent: parent || '', entries,
      lastPicked: readBrowseMemory(context.env || process.env).lastPicked,
      defaultRoot: defaultRootNow ? defaultRootNow.replace(/\\/gu, '/') : '',
      isDefaultRoot: false
    })
  }

  if (endpointId === 'nativeReveal') {
    // OS-109：在资源管理器里打开路径（文件夹＝打开；文件＝选中）。路径不存在如实报。
    const p = text(request.path).trim()
    if (!p) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'path 必填')
    const result = await revealPath(p)
    if (!result.ok) {
      const code = result.code === 'NOT_FOUND' ? API_ERROR_CODES.NOT_FOUND : API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED
      return sendError(res, code, result.message)
    }
    return sendJson(res, 200, { ok: true })
  }

  if (endpointId === 'libraryCreate') {
    const created = await createLibrary({ ...request, preferencesPath: loaded.preferencesPath })
    if (!created.ok) {
      return sendError(res, created.code ?? API_ERROR_CODES.INVALID_ENTRY, created.message, created.details)
    }
    return sendJson(res, 200, created)
  }

  if (endpointId === 'libraryScan') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const scanned = await scanLibrary({ root: authorized.root, sourcePath: request.sourcePath })
    if (!scanned.ok) return sendError(res, scanned.code ?? API_ERROR_CODES.INVALID_ENTRY, scanned.message, scanned.details)
    return sendJson(res, 200, { ok: true, plan: scanned.plan })
  }

  if (endpointId === 'libraryImport') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const imported = await importLibrary({ root: authorized.root, sourcePath: request.sourcePath })
    if (!imported.ok) return sendError(res, imported.code ?? API_ERROR_CODES.INVALID_ENTRY, imported.message, imported.details)
    return sendJson(res, 200, { ok: true, report: imported.report })
  }

  if (endpointId === 'libraryPrimary') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const set = await setPrimaryCarrier({ root: authorized.root, primaryCarrier: request.primaryCarrier, expectedRevision: request.expectedRevision })
    if (!set.ok) return sendError(res, set.code ?? API_ERROR_CODES.INVALID_ENTRY, set.message, set.details)
    return sendJson(res, 200, { ok: true, document: set.document, ...(set.enabled ? { enabled: set.enabled } : {}) })
  }

  if (endpointId === 'agentChat') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    return handleAgentChat(req, res, request, context, authorized.root, loaded.libraries)
  }

  // enrichStatus 在兜底 root 闸之前接走：job 即身份（内存 Map），契约只声明 NOT_FOUND，不校验 root。
  if (endpointId === 'enrichStatus') {
    const job = enrichJobs.get(text(request.jobId))
    if (!job) return sendError(res, API_ERROR_CODES.NOT_FOUND, `job 不存在：${request.jobId}`)
    return sendJson(res, 200, { ok: true, jobId: job.jobId, state: job.state, progress: job.progress, summary: job.summary, error: job.error })
  }

  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const root = authorized.root
  const store = factStore.createFactFileStore({ root })

  if (endpointId === 'chapterGet') {
    const resolved = resolveInsideRoot(root, request.file)
    if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
    let body
    try {
      const stats = statSync(resolved.path)
      if (!stats.isFile()) return sendError(res, API_ERROR_CODES.NOT_FOUND, '正文路径不是文件', { file: request.file })
      body = await readFile(resolved.path, 'utf-8')
    } catch (error) {
      if (error?.code === 'ENOENT') return sendError(res, API_ERROR_CODES.NOT_FOUND, `正文文件不存在：${request.file}`, { file: request.file })
      return sendError(res, API_ERROR_CODES.NOT_FOUND, `正文读取失败：${text(error?.message || error)}`, { file: request.file })
    }
    return sendJson(res, 200, { ok: true, name: basename(resolved.path), text: body, chars: body.length })
  }

  if (endpointId === 'chapterPut') {
    const written = await writeChapterWithBackup(root, request.file, request.text)
    if (!written.ok) return sendError(res, written.code, written.message, written.details)
    // FACT-FIRST 规则 5：正文写入**不**隐式触发事实链重建（重建要跑模型、要花钱），
    // 但必须如实告诉调用方「这本书的事实链已落后于正文」，由 UI 决定提示还是自动重跑。
    const health = await factHealth(root).catch(() => null)
    return sendJson(res, 200, {
      ok: true,
      chars: written.chars,
      savedAt: written.savedAt,
      ...(written.backup ? { backup: written.backup } : {}),
      // OS-89：把变更 id 透传给前端（有 diff 就有 id，可用于「查看这次改了什么」）
      ...(written.changeId ? { changeId: written.changeId } : {}),
      ...(written.logError ? { logError: written.logError } : {}),
      ...(health ? { factStale: health.stale, factEntries: health.entries } : {})
    })
  }

  // FACT-FIRST 供给端（叙事架构 v2 第一期）：语义增补异步 job ＋ 因果图读取。
  if (endpointId === 'enrichRun') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = text(request.bookId).trim()
    if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
    const { config } = await loadConfigV2(context.agentConfigPath)
    const upstream = await resolveChatUpstream(config, context)
    if (!upstream.ok) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, upstream.message)
    // llmPort：把「活动运行时」包成引擎要的 prompt→text 形状（OS-58）。
    // 作者裁定：**不接受接口直接接入**，统一走 CLI 子 agent 模式。
    // 三种上游都收敛到同一次「单发单收」调用：
    //   · endpoint  → HTTP chat/completions（保留：本机 sidecar 一类也算 endpoint，但不是主路径）
    //   · cli       → 一次性子进程（cli-bridge.runCliChat），stdout 即回包
    //   · dsh-cli   → 一 run 一进程（dsh-cli.runDshStdio），收 delta 拼成回包
    // enrich 每窗都要结构化 JSON，所以这里对子 agent 额外下硬约束：只输出 JSON。
    const llmPort = async ({ prompt, maxTokens = 2000 }) => {
      const strict = `${prompt}\n\n【输出约束】只输出符合要求的 JSON，不要 markdown 代码围栏，不要任何解释文字。`
      if (upstream.execute === 'cli') {
        const run = await runCliChat(upstream.kit, [{ role: 'user', content: strict }], { model: upstream.model })
        if (!run.ok) throw new Error(`CLI 子 agent 失败：${run.message}`)
        return { text: text(run.text) }
      }
      if (upstream.execute === 'dsh-cli') {
        let collected = ''
        const result = await runDshStdio({
          dshCmd: upstream.dshRun.dshCmd,
          profile: upstream.dshRun.profile,
          cwd: root,
          prompt: strict,
          ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
          // CLI/DSH 子 agent 单窗可能想很久（深析世界要素时尤甚），给足 10 分钟
          inactivityMs: 180_000,
          timeoutMs: 600_000,
          onText: (piece) => { collected += piece }
        })
        if (!result.ok) throw new Error(`DSH 子 agent 失败：${result.message || result.code || 'unknown'}`)
        return { text: text(collected || result.text || '') }
      }
      // endpoint（含 sidecar）：HTTP 单发
      const response = await fetch(upstream.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...upstream.headers },
        body: JSON.stringify({ model: upstream.model, messages: [{ role: 'user', content: strict }], max_tokens: maxTokens, temperature: 0.4, stream: false }),
        signal: AbortSignal.timeout(180_000)
      })
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
      const data = await response.json()
      return { text: data.choices?.[0]?.message?.content ?? '' }
    }
    const jobId = `enrich-${bookId}-${Date.now().toString(36)}`
    // 事实条目与书元数据：factFileStore 取 entries（与 /api/entries 同源），book 从拆解文件读
    const store = factStore.createFactFileStore({ root: authorized.root })
    const listed = await store.list({})
    if (!listed.ok || !listed.entries.length) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '事实链为空——先跑抽取（pinax_extract_*）再 enrich')
    }
    let book = { id: bookId, title: bookId }
    try {
      const dataset = JSON.parse(readFileSync(join(authorized.root, '拆解', `${bookId}.json`), 'utf8'))
      if (dataset.book) book = dataset.book
    } catch { /* 元数据缺失就用 bookId 兜底 */ }
    const job = { jobId, bookId, root: authorized.root, state: 'running', progress: [], summary: null, error: null, startedAt: new Date().toISOString() }
    enrichJobs.set(jobId, job)
    // 异步跑：HTTP 立即回 jobId；进度走 enrichStatus 轮询（6 窗逐窗更新）。
    enrichBook({
      root: authorized.root,
      bookId,
      entries: listed.entries,
      book,
      llmPort,
      onProgress: (note) => job.progress.push(note),
    }).then((result) => {
      job.state = result.ok ? 'done' : 'failed'
      job.summary = result.summary ?? null
      job.error = result.ok ? null : (result.failures?.map((f) => `${f.stage}:${f.reason}`).join('；') || 'failed')
    }).catch((error) => {
      job.state = 'failed'
      job.error = text(error?.message ?? error)
    })
    return sendJson(res, 200, { ok: true, jobId })
  }

  if (endpointId === 'enrichGraph') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = text(request.bookId).trim()
    if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
    const result = await enrichGraph({ root: authorized.root, bookId })
    if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
    return sendJson(res, 200, { ok: true, ...result })
  }

  if (endpointId === 'agentSessions') {
    const sessions = await listSessions(context.agentSessionsDir, root)
    return sendJson(res, 200, { ok: true, sessions })
  }

  if (endpointId === 'agentSessionCreate') {
    const session = await createSession(context.agentSessionsDir, root, request.title)
    return sendJson(res, 200, { ok: true, session })
  }

  if (endpointId === 'agentSessionGet') {
    const loaded = await readSession(context.agentSessionsDir, root, request.id)
    if (!loaded) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
    return sendJson(res, 200, { ok: true, session: loaded.session, items: loaded.items })
  }

  if (endpointId === 'agentSessionRename') {
    const session = await renameSession(context.agentSessionsDir, root, request.id, request.title)
    if (!session) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
    return sendJson(res, 200, { ok: true, session })
  }

  if (endpointId === 'agentSessionDelete') {
    const removed = await deleteSession(context.agentSessionsDir, root, request.id)
    if (!removed) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.id}`)
    return sendJson(res, 200, { ok: true })
  }

  if (endpointId === 'agentCardCreate') {
    return handleAgentCardCreate(res, request, context, root)
  }

  if (endpointId === 'agentCardAdopt') {
    return handleAgentCardAdopt(res, request, context, root)
  }

  if (endpointId === 'agentCardReject') {
    return handleAgentCardReject(res, request, context, root)
  }

  return sendError(res, API_ERROR_CODES.NOT_FOUND, `端点未实现：${endpointId}`)
}

const ENDPOINT_HAS_QUERY = new Set(['referenceAssetGet', 'habitsGet', 'chapterGet', 'agentSessions', 'agentSessionGet', 'agentSessionDelete', 'libraryDiagnose', 'filesGet', 'chaptersGet', 'chapterDelete', 'artifactsGet', 'suiteStateDataGet', 'agentPicksGet', 'briefGet', 'skillsGet', 'skillGet', 'enrichStatus', 'enrichGraph', 'kbStatusGet', 'agentDshModelsGet', 'factCurveGet', 'factEntriesGet', 'factBooksGet', 'referenceGet', 'referenceGraphGet', 'referenceNoteGet', 'deduceSessionGet', 'deduceSessionsGet', 'deduceOpeningGet', 'deduceAssets', 'deduceAssetFile', 'changeLogGet', 'changeLogEntry', 'changeLogSummary', 'uiStateGet', 'draftGet'])

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
function suiteTokensCss({ dark = false } = {}) {
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
`;
}

/** 套件资产（page 模式自带设置页同源装载）：GET /suite-assets/<id>/<相对路径>，只读＋路径安全化。 */
async function serveSuiteAsset(req, res, suitesDirs, id, relPath) {
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

/** wiki HTML 色参：没给＝空（渲染器用默认）；给了就必须是 #rgb/#rrggbb。 */
function isMissingColor(value) {
  const raw = text(value).trim()
  return raw !== '' && !isHexColor(raw)
}

/* ---------- Agent 通道（OS-4/9：会话 JSONL＋运行时 kit 货架，Pi 兜底）---------- */

/**
 * DSH 单条 prompt 组装（DSH 只有「一条 prompt」通道，系统提示也得拼进去）。
 * - systemPrompt 放最前，用明确分隔线与对话历史隔开
 * - 已采纳的 card 也带上（文件＋摘要）——只收 kind==='msg' 会把这一段上下文丢掉
 * - 截断时插显式标记，不再静默砍头
 * - onlyTail：resume 时只发最后一轮（DSH 自己有前文，重复发会翻倍算 token）
 */
function composeDshPrompt(items, { systemPrompt = '', maxMessages = 24, maxChars = 48000, onlyTail = false } = {}) {
  const all = (Array.isArray(items) ? items : [])
    .filter((item) => item?.kind === 'msg' || item?.kind === 'card')
    .map((item) => {
      if (item.kind === 'card') {
        const body = text(item.text).trim()
        if (!body) return null
        return { role: 'card', content: `【已采纳的稿：${text(item.file) || '正文'}】\n${body}` }
      }
      return { role: item.role === 'assistant' ? 'assistant' : 'user', content: text(item.content) }
    })
    .filter((message) => message && message.content.trim())

  let picked = all
  let dropped = 0
  if (onlyTail) {
    // resume 模式：DSH 自己记得前文，这里只发本轮新问的那句。
    // 关键：绝不能在这里补「更早的对话已省略 N 条」——DSH 会照字面以为自己失忆了。
    picked = all.slice(-1)
  } else {
    const budgeted = []
    let used = 0
    for (let index = all.length - 1; index >= 0 && budgeted.length < maxMessages; index -= 1) {
      const message = all[index]
      if (used + message.content.length > maxChars && budgeted.length > 0) { dropped = index + 1; break }
      budgeted.unshift(message)
      used += message.content.length
    }
    picked = budgeted
    dropped = Math.max(dropped, all.length - budgeted.length)
  }

  const lines = picked.map((message) => {
    if (message.role === 'card') return message.content
    return message.role === 'assistant' ? `【助手】${message.content}` : `【作者】${message.content}`
  })
  const head = []
  if (systemPrompt.trim()) {
    head.push(systemPrompt.trim())
    head.push('---')
  }
  if (dropped > 0) head.push(`【更早的对话已省略 ${dropped} 条】`)
  return [...head, ...lines].join('\n\n')
}

/**
 * 这个本地会话对应的 DSH 会话指纹是否还可用。
 * 模型或 cwd 变了就作废——DSH 侧会话跟运行环境绑定，硬 resume 会报 mismatch。
 */
async function resolveDshResume({ sessionsDir, root, session, ephemeral, model }) {
  if (ephemeral) return { resumeSessionId: '', notice: '' }
  const dshSessionId = text(session?.dshSessionId)
  if (!dshSessionId) return { resumeSessionId: '', notice: '' }
  const prevModel = text(session?.dshModel)
  const prevCwd = text(session?.dshCwd)
  const modelChanged = Boolean(prevModel) && Boolean(model) && prevModel !== model
  const cwdChanged = Boolean(prevCwd) && prevCwd !== root
  if (modelChanged || cwdChanged) {
    await patchSessionMeta(sessionsDir, root, session.id, { dshSessionId: '', dshModel: '', dshCwd: '' })
    const why = modelChanged ? '模型换了' : '库路径变了'
    return { resumeSessionId: '', notice: `${why}，DSH 会话已重开（前文仍在本条会话里）。` }
  }
  return { resumeSessionId: dshSessionId, notice: '' }
}

/**
 * 系统提示（按运行时区分能力，别对模型说假话——DSH 看到「你读不到文件」
 * 却手里有工具时，会花大段推理纠结「这自相矛盾」，白白烧 token）。
 *   canReadFiles=false（Pi/纯 HTTP）：作者手动贴上下文
 *   canReadFiles=true （DSH 原生）：可以自己读，但改正文必须走待确认卡
 */
/** 测试钩子（OS-45）：把 systemPromptFor 暴露给单测，验「参考只给链接不给全文」。 */
export const __test = { systemPromptFor }

/** 生效技能目录（OS-68）：内置＋本机之外，再叠加启用中套件捆绑的 skills/。 */
function effectiveSkillsDirs({ skillsDirs, suitesDirs, suiteStatePath, env }) {
  return [...(skillsDirs || []), ...suiteSkillDirs(suitesDirs || [], suiteStatePath || '', env)]
}

async function systemPromptFor(root, libraries, genresDirs, skillsDirs, { canReadFiles = false, chineseReasoning = false, suitesDirs = null, suiteStatePath = '', env = process.env } = {}) {
  const key = rootKey(root)
  const record = (Array.isArray(libraries) ? libraries : []).find((library) => rootKey(library.path) === key)
  const name = record?.name || basename(root) || '未命名库'
  // 生效清单（OS-43）：这轮提示词里到底塞了哪些东西，回报给界面做标注
  const applied = { canReadFiles, chineseReasoning, craftSkills: [], genre: '', brief: false, kb: false, habits: 0 }
  const lines = [
    `你是 OpenStory 工作台的写作助手，正在协助作者创作《${name}》（本机磁盘上的一个 Pinax 库）。`,
    '- 用中文回复。',
    '- 作者可以把你的回复转成「待确认卡」并采纳写进正文文件：给出正文片段时，请给完整、可直接粘贴的文本，不要只给修改说明。',
    '- 给出可采纳的正文时，请用代码块（```）把正文整段包起来，并在正文之外说明它要写进哪个文件（例如「正文/003-倒带.md」）。这样工作台才知道这段可以采纳。',
    canReadFiles
      ? '- 你可以读这个库里的文件（工作目录就是库根）。需要原文、目录结构时直接读，不要凭空猜测内容。'
      : '- 你读不到库里的文件；作者会把需要的上下文粘贴给你，不要假装读过文件。',
    ...(canReadFiles
      ? ['- 但改正文必须走「待确认卡」流程：不要直接用写文件工具改 .md 正文，把改好的片段写在回复里，让作者确认。']
      : []),
    // 中文推理（OS-43，默认开；OS-72 加强）：旧版一句话太软，实测 flash/v4-pro 仍全程英文思考。
    // 加强手段＝放在最强的位置（首条）＋给出明确反例＋要求逐句检查，不靠「请」。
    ...(chineseReasoning
      ? ['- 【思考语言：中文】你的推理/思考过程（reasoning）必须用中文书写，一个字都不要用英文——包括分析、比价、列举、自问自答等全部环节。只有在引用英文原文或代码时才可以出现英文。每次思考前先确认自己在用中文；如果发现自己在写英文，立即改用中文重写。']
      : [])
  ]
  // 习惯表（OS-57）：作者定义的写作习惯——Agent 成文前必须逐条遵循。规则唯一来源。
  try {
    const habits = readHabits(root)
    const habitLines = []
    if (habits.style) habitLines.push(`- 文风：${habits.style}`)
    if (habits.bannedWords?.length) habitLines.push(`- 禁用词（出现即改）：${habits.bannedWords.join('、')}`)
    if (habits.preferredWords?.length) habitLines.push(`- 惯用词（优先使用）：${habits.preferredWords.join('、')}`)
    if (habits.bannedPatterns?.length) habitLines.push(`- 禁用句式：${habits.bannedPatterns.join('；')}`)
    if (habits.bannedRhetoric?.length) habitLines.push(`- 禁用修辞：${habits.bannedRhetoric.join('；')}`)
    if (habits.formulas?.length) habitLines.push(`- 喜好的描述公式：${habits.formulas.join('；')}`)
    if (habitLines.length) {
      lines.push('', '【本库写作习惯】（作者自定义，产出任何成文文字前必须逐条遵循）：', ...habitLines)
      applied.habits = habitLines.length
    }
  } catch { /* 习惯表读不到就不注入，不拦聊天 */ }
  // OS-19：项目简报（体裁/篇幅/分章）是一等约束——注入体裁策略段
  try {
    const loaded = await readBrief(root, genresDirs)
    if (loaded.ok && loaded.brief) {
      const { genres } = loadGenres(genresDirs)
      const genre = genres.find((item) => item.id === loaded.brief.genre) ?? null
      const section = briefPromptSection(loaded.brief, genre)
      if (section) lines.push('', section)
      // OS-22：按体裁选 craft 类技能（技法规则）注入——只取 craft，review/transform/extract 不注入
      const loadedSkills = loadSkills(effectiveSkillsDirs({ skillsDirs, suitesDirs, suiteStatePath, env }))
      const picks = await readAgentPicks(root)
      const matched = craftSkillsForPrompt(loadedSkills.skills, loaded.brief.genre, picks)
      const craft = craftInstructionBlock(matched)
      if (craft) lines.push('', craft)
      // 生效清单（OS-43）：把「这轮用到了哪些技能」回报给界面，让作者知道 AI 手里有什么
      applied.craftSkills = matched.map((skill) => ({
        name: text(skill.name),
        description: text(skill.description),
        category: text(skill.category)
      })).filter((skill) => skill.name)
      applied.genre = text(genre?.name || loaded.brief.genre)
      applied.brief = true
      // KB-ARCH P0：同题材先例检索（案例库＋套路库）——kb-config 缺失或 KB 不可用时静默降级，不阻塞对话
      const kbSection = await precedentPromptSectionForGenre(genre?.name ?? loaded.brief.genre, {
        configPath: join(process.env.LOCALAPPDATA || process.env.APPDATA || '', 'PinaxNext', 'openstory', 'kb-config.json')
      })
      if (kbSection) {
        lines.push('', kbSection)
        applied.kb = true
      }
    }
  } catch { /* 简报读不到不影响对话 */ }

  // 参考索引（OS-45）：**只暴露链接清单，不塞全文**。
  // 作者口径：把参考全量丢进上下文会污染判断——模型会在几十篇笔记里迷路。
  // 正确做法是给它一份「目录 + 它自己能读的路径」，需要时用文件工具按需取。
  if (canReadFiles) {
    try {
      const index = await scanReferences(root)
      // OS-96：按当前章强制过滤——firstChapter>当前章的词条不进索引（写得再好也是剧透）。
      // 当前章号从正文清单推（最大章号；没有正文＝0＝全量共识）。
      let currentChapter = 0
      try {
        const listing = await listChapters(root, '正文')
        if (listing.ok) currentChapter = (listing.chapters || []).reduce((max, ch) => Math.max(max, Number(ch?.no) || 0), 0)
      } catch { /* 无正文＝0 */ }
      const allNotes = (Array.isArray(index.notes) ? index.notes : []).filter((note) => !note.isTagNote)
      const notes = notesVisibleAt(allNotes, currentChapter)
      const hiddenCount = allNotes.length - notes.length
      if (notes.length) {
        // 图谱：把「参考 ↔ 章节」的关系也算出来，好告诉 Agent 当前这一章挂着哪些参考
        let entries = []
        try {
          const store = factStore.createFactFileStore({ root })
          const listed = store.list({ offset: 0, limit: 500 })
          entries = Array.isArray(listed?.entries) ? listed.entries : []
        } catch { /* 没拆解就只有参考节点 */ }
        const graph = buildReferenceGraph(index, { entries })
        // 反向索引：章节路径 → 关联的参考笔记路径
        const refsByArtifact = new Map()
        for (const edge of graph.edges) {
          const a = graph.nodes.find((node) => node.id === edge.a)
          const b = graph.nodes.find((node) => node.id === edge.b)
          if (!a || !b) continue
          const ref = a.kind === 'reference' ? a : (b.kind === 'reference' ? b : null)
          const artifact = a.kind === 'artifact' ? a : (b.kind === 'artifact' ? b : null)
          if (!ref || !artifact) continue
          if (!refsByArtifact.has(artifact.id)) refsByArtifact.set(artifact.id, [])
          refsByArtifact.get(artifact.id).push(ref.id)
        }
        applied.referenceGraph = {
          pairs: [...refsByArtifact.entries()].slice(0, 40).map(([artifact, refs]) => ({ artifact, refs: refs.slice(0, 12) }))
        }
        // 严格口径（OS-45）：**只给路径 + 标题 + 标签**，一个字的正文都不给。
        // 摘要看着无害，实际上会把「判断依据」提前塞进上下文——模型会拿摘要当结论，
        // 而不是真去读原文。要读就让它读。
        const lines2 = notes.slice(0, 60).map((note) => {
          const tags = note.tags.length ? `（${note.tags.map((tag) => `#${tag}`).join(' ')}）` : ''
          return `- ${note.path} ｜「${note.title}」${tags}`
        })
        const linked = [...refsByArtifact.entries()].slice(0, 20)
          .map(([artifact, refs]) => `- ${artifact} ← ${refs.join('、')}`)
        lines.push(
          '',
          '【参考资料索引】',
          `这个库有一套参考资料（作者的设定、素材、想法）。下面是**索引，不是全文**：${hiddenCount > 0 ? `（已按当前进度第 ${currentChapter} 章过滤——${hiddenCount} 条「首次出现」在更后面的词条没有列出，那些是未来才成立的知识，不要提前使用）` : ''}`,
          ...lines2,
          notes.length > 60 ? `（还有 ${notes.length - 60} 篇没列出）` : '',
          ...(linked.length ? ['', '【参考与章节的关联】', ...linked] : []),
          '',
          '规矩：',
          '- 需要某篇的具体内容时，**用你的文件读取工具按上面的路径去读**（都在 cwd 下），不要凭空猜。',
          '- 不要一次读一堆参考；先按标题、标签和上面的关联关系判断哪些相关，再读那几篇。',
          '- 参考是作者的私有笔记，只能读，不要改（改正文要走待确认卡，参考也不在你的写权限里）。'
        )
        applied.referenceCount = notes.length
      }
    } catch { /* 没有参考目录就不注入（不打扰） */ }
  }
  return { prompt: lines.join('\n'), applied }
}

/* ---------- 全局配置（S4）：text / image / vision / agent 四块 ---------- */

/**
 * 配置 v2：四块各管一摊——text（对话）/ image（生图）/ vision（识图）/ agent（默认档）。
 * 旧格式（顶层 endpoint/model/apiKey）读到即迁移到 text.*，并把新格式写回磁盘；
 * 旧端点 GET/PUT /api/agent/config 保留，内部转发到 text 块与旧形状（MCP/旧前端还在用）。
 * apiKey 只在本机文件里；对外一律走 maskApiKey 尾号掩码。
 */
/** OS-75：生图默认风格与负向词（作者裁定：默认 2D 彩漫风格，可自定义覆盖）。 */
const DEFAULT_IMAGE_STYLE = '2D彩漫风格'
const DEFAULT_IMAGE_NEGATIVE = 'lowres, blurry, watermark, text, 3d render, photorealistic'

const CONFIG_BLOCK_FIELDS = Object.freeze({
  text: ['endpoint', 'model', 'apiKey', 'runtime', 'reasoningEffort', 'chineseReasoning'],
  image: ['enabled', 'backend', 'endpoint', 'model', 'apiKey', 'comfyUrl', 'comfyWorkflow', 'comfyNodeMap', 'stylePrompt'],
  vision: ['enabled', 'endpoint', 'model', 'apiKey', 'profile'],
  agent: ['defaultModel', 'subagentModel', 'profile']
})

function emptyConfigV2() {
  return {
    text: { endpoint: '', model: '', apiKey: '', runtime: '', reasoningEffort: '', chineseReasoning: true },
    image: { enabled: false, backend: 'openai', endpoint: '', model: '', apiKey: '', comfyUrl: '', comfyWorkflow: '', comfyNodeMap: {}, stylePrompt: '' },
    vision: { enabled: false, endpoint: '', model: '', apiKey: '', profile: '' },
    agent: { defaultModel: '', subagentModel: '', profile: '' }
  }
}

/** 单块规整：只认自己那几个人（未知键丢弃）；enabled 只有明确的 true 才算开。 */
function normalizeConfigBlock(kind, raw) {
  const source = isPlainObject(raw) ? raw : {}
  if (kind === 'text') {
    return {
      endpoint: text(source.endpoint).trim(),
      model: text(source.model).trim(),
      apiKey: text(source.apiKey).trim(),
      runtime: text(source.runtime).trim(),
      reasoningEffort: text(source.reasoningEffort).trim(),
      chineseReasoning: source.chineseReasoning !== false
    }
  }
  if (kind === 'image') {
    const backend = text(source.backend).trim() === 'comfyui' ? 'comfyui' : 'openai'
    return {
      enabled: source.enabled === true,
      backend,
      endpoint: text(source.endpoint).trim(),
      model: text(source.model).trim(),
      apiKey: text(source.apiKey).trim(),
      // ComfyUI：端口（如 http://127.0.0.1:8188）+ 工作流 JSON 相对路径 + 节点映射
      comfyUrl: text(source.comfyUrl).trim(),
      comfyWorkflow: text(source.comfyWorkflow).trim(),
      comfyNodeMap: isPlainObject(source.comfyNodeMap) ? source.comfyNodeMap : {},
      // OS-75：默认风格提示词（留空＝用内置「2D彩漫风格」）。用户可在设置里改，
      // 也可在推演引擎/世界书的单次生图里覆盖（请求体 stylePrompt）。
      stylePrompt: text(source.stylePrompt).trim()
    }
  }
  if (kind === 'vision') {
    // OS-76：识图走 DSH 子 agent——只认 enabled + model（provider/id）+ profile，
    // endpoint/apiKey 保留字段位（兼容旧配置），但不再使用。
    return {
      enabled: source.enabled === true,
      endpoint: text(source.endpoint).trim(),
      model: text(source.model).trim(),
      apiKey: text(source.apiKey).trim(),
      profile: text(source.profile).trim()
    }
  }
  return {
    defaultModel: text(source.defaultModel).trim(),
    subagentModel: text(source.subagentModel).trim(),
    profile: text(source.profile).trim()
  }
}

function normalizeConfigV2(raw) {
  const source = isPlainObject(raw) ? raw : {}
  return {
    text: normalizeConfigBlock('text', source.text),
    image: normalizeConfigBlock('image', source.image),
    vision: normalizeConfigBlock('vision', source.vision),
    agent: normalizeConfigBlock('agent', source.agent)
  }
}

/** 旧格式判定：顶层有 endpoint/model/apiKey 且没有 text 块。 */
function isLegacyConfig(raw) {
  if (!isPlainObject(raw) || isPlainObject(raw.text)) return false
  return 'endpoint' in raw || 'model' in raw || 'apiKey' in raw
}

/** 旧格式 → 新结构。imageEndpoint（旧生图字段）一并迁进 image 块，别的沿用默认。 */
function migrateLegacyConfig(raw) {
  const legacyImage = isPlainObject(raw.imageEndpoint)
    ? { enabled: Boolean(text(raw.imageEndpoint.url).trim()), endpoint: text(raw.imageEndpoint.url), model: text(raw.imageEndpoint.model), apiKey: text(raw.imageEndpoint.apiKey) }
    : null
  return {
    text: {
      endpoint: raw.endpoint,
      model: raw.model,
      apiKey: raw.apiKey,
      runtime: raw.runtime,
      reasoningEffort: raw.reasoningEffort,
      chineseReasoning: raw.chineseReasoning
    },
    ...(isPlainObject(raw.image) ? { image: raw.image } : legacyImage ? { image: legacyImage } : {}),
    ...(isPlainObject(raw.vision) ? { vision: raw.vision } : {}),
    ...(isPlainObject(raw.agent) ? { agent: raw.agent } : {})
  }
}

/** 原子写回（tmp＋rename），带 updatedAt。rename 失败（Windows 上文件被占用）要收掉 tmp，不留垃圾。 */
async function writeConfigV2(configPath, config) {
  await mkdir(join(configPath, '..'), { recursive: true })
  const tmp = `${configPath}.tmp-${randomUUID()}`
  await writeFile(tmp, JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2), 'utf-8')
  try {
    await rename(tmp, configPath)
  } catch (error) {
    await rm(tmp, { force: true }).catch(() => {})
    throw error
  }
}

/** 读配置：缺档＝全默认（不算错）；坏档＝全默认＋warning，不拦启动；旧格式＝迁移并写回。 */
async function loadConfigV2(configPath) {
  const empty = { config: emptyConfigV2(), warnings: [], migrated: false }
  if (!text(configPath).trim()) return empty
  let raw
  try {
    raw = await readFile(configPath, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return empty
    return { ...empty, warnings: [{ code: 'AGENT_CONFIG_UNREADABLE', message: `配置读不了：${text(error?.message || error)}` }] }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ...empty, warnings: [{ code: 'AGENT_CONFIG_CORRUPT', message: `配置不是有效 JSON：${text(error?.message || error)}` }] }
  }
  const legacy = isLegacyConfig(parsed)
  const config = normalizeConfigV2(legacy ? migrateLegacyConfig(parsed) : parsed)
  if (!legacy) return { config, warnings: [], migrated: false }
  try {
    await writeConfigV2(configPath, config)
  } catch (error) {
    return { config, warnings: [{ code: 'AGENT_CONFIG_MIGRATE_FAILED', message: `旧配置迁移写回失败：${text(error?.message || error)}` }], migrated: false }
  }
  return { config, warnings: [], migrated: true }
}

/** 分块写：块内字段缺省＝保留原值；空串＝清除；enabled 必须是布尔。 */
async function saveConfigV2(configPath, patch = {}) {
  const { config } = await loadConfigV2(configPath)
  const next = { ...config }
  for (const kind of Object.keys(CONFIG_BLOCK_FIELDS)) {
    if (!isPlainObject(patch[kind])) continue
    const merged = { ...config[kind] }
    for (const field of CONFIG_BLOCK_FIELDS[kind]) {
      if (patch[kind][field] === undefined) continue
      merged[field] = patch[kind][field]
    }
    next[kind] = normalizeConfigBlock(kind, merged)
  }
  await writeConfigV2(configPath, next)
  return next
}

/** 分块写请求校验：块必须是对象、字段类型必须对；坏值 400（未知键忽略）。 */
function validateConfigPatch(input) {
  const errors = []
  const source = isPlainObject(input) ? input : {}
  const STRING_FIELDS = new Set(['endpoint', 'model', 'apiKey', 'runtime', 'reasoningEffort', 'defaultModel', 'subagentModel', 'profile'])
  for (const kind of Object.keys(CONFIG_BLOCK_FIELDS)) {
    if (source[kind] === undefined) continue
    if (!isPlainObject(source[kind])) {
      errors.push({ field: kind, message: `${kind} 必须是对象` })
      continue
    }
    for (const [field, value] of Object.entries(source[kind])) {
      if (!CONFIG_BLOCK_FIELDS[kind].includes(field)) continue
      if (value === undefined || value === null) continue
      if (field === 'enabled') {
        if (typeof value !== 'boolean') errors.push({ field: `${kind}.${field}`, message: `${kind}.${field} 必须是布尔值` })
        continue
      }
      if (field === 'chineseReasoning') {
        if (typeof value !== 'boolean') errors.push({ field: `${kind}.${field}`, message: `${kind}.${field} 必须是布尔值` })
        continue
      }
      if (STRING_FIELDS.has(field) && typeof value !== 'string') {
        errors.push({ field: `${kind}.${field}`, message: `${kind}.${field} 必须是字符串` })
      }
    }
  }
  return errors
}

/** 脱敏公开形状（新端点用）：apiKey 只回尾号。 */
function configPublicV2(config, configPath) {
  const textBlock = config.text
  return {
    ok: true,
    text: {
      endpoint: textBlock.endpoint,
      model: textBlock.model,
      apiKeyMasked: textBlock.apiKey ? maskApiKey(textBlock.apiKey) : '',
      runtime: textBlock.runtime,
      reasoningEffort: textBlock.reasoningEffort,
      chineseReasoning: textBlock.chineseReasoning,
      configured: Boolean(textBlock.endpoint || textBlock.runtime)
    },
    image: {
      enabled: config.image.enabled,
      // OS-75：ComfyUI 后端字段一并回显（前端要据此切表单/显示状态）
      backend: config.image.backend || 'openai',
      endpoint: config.image.endpoint,
      model: config.image.model,
      apiKeyMasked: config.image.apiKey ? maskApiKey(config.image.apiKey) : '',
      comfyUrl: config.image.comfyUrl || '',
      comfyWorkflow: config.image.comfyWorkflow || '',
      comfyNodeMap: config.image.comfyNodeMap || {},
      stylePrompt: config.image.stylePrompt || '',
      // ComfyUI 后端只要填了地址就算已配置（不要求 endpoint）
      configured: config.image.backend === 'comfyui'
        ? Boolean(config.image.comfyUrl)
        : Boolean(config.image.endpoint)
    },
    vision: {
      enabled: config.vision.enabled,
      endpoint: config.vision.endpoint,
      model: config.vision.model,
      apiKeyMasked: config.vision.apiKey ? maskApiKey(config.vision.apiKey) : '',
      profile: config.vision.profile || '',
      // OS-76：走 DSH 子 agent，选了模型即算已配置（不需要 endpoint）
      configured: Boolean(config.vision.model)
    },
    agent: {
      defaultModel: config.agent.defaultModel,
      subagentModel: config.agent.subagentModel,
      profile: config.agent.profile
    },
    configPath: text(configPath)
  }
}

/** 旧端点形状（GET/PUT /api/agent/config）：完全照旧，内部由 text 块供值。 */
function configPublicLegacy(config, configPath) {
  const textBlock = config.text
  return {
    ok: true,
    configured: Boolean(textBlock.endpoint || textBlock.runtime),
    endpoint: textBlock.endpoint,
    model: textBlock.model,
    ...(textBlock.apiKey ? { apiKeyMasked: maskApiKey(textBlock.apiKey) } : {}),
    ...(textBlock.runtime ? { runtime: textBlock.runtime } : {}),
    ...(textBlock.reasoningEffort ? { reasoningEffort: textBlock.reasoningEffort } : {}),
    chineseReasoning: textBlock.chineseReasoning,
    configPath: text(configPath)
  }
}

/** 取 text 块（兼容旧扁平形状：万一有调用方塞进来的是旧 config）。 */
function configTextBlock(config) {
  if (isPlainObject(config) && isPlainObject(config.text)) return config.text
  return normalizeConfigBlock('text', config)
}

/** 取 agent 块（默认档）：text.model 没填时用它兜底。 */
function configAgentBlock(config) {
  if (isPlainObject(config) && isPlainObject(config.agent)) return config.agent
  return normalizeConfigBlock('agent', config)
}

/* ---------- 可行性校验（probe）：真发一个最小请求，15 秒超时，不抛 ---------- */

const PROBE_TIMEOUT_MS = 15_000
// 8×8 纯红 PNG（75 字节）——识图探针的内联图，不读磁盘、不联网取图。
const VISION_PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

/** endpoint → chat/completions 完整地址（容忍已给完整路径、只给 /v1、或只给主机）。 */
function chatCompletionsUrl(endpoint) {
  const raw = text(endpoint).trim().replace(/\/+$/u, '')
  if (!raw) return ''
  if (/\/chat\/completions$/u.test(raw)) return raw
  if (/\/v\d+(?:\.\d+)?$/u.test(raw)) return `${raw}/chat/completions`
  return `${raw}/v1/chat/completions`
}

/** endpoint → images/generations 完整地址（设置页填到 /v1 为止，也容忍完整路径）。 */
function imagesGenerationsUrl(endpoint) {
  const raw = text(endpoint).trim().replace(/\/+$/u, '')
  if (!raw) return ''
  if (/\/images\/generations$/u.test(raw)) return raw
  return `${raw}/images/generations`
}

function isTimeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

async function readSnippet(response) {
  try {
    const raw = await response.text()
    return raw.slice(0, 200)
  } catch {
    return ''
  }
}

/**
 * 真发一个最小请求：
 *   text   → POST chat/completions，messages:[ping]，max_tokens:1，200 即可达；
 *   image  → POST images/generations，prompt:'a red dot'，256x256，b64_json 有值即可达（会真花钱）；
 *   vision → 内联 8×8 红图问颜色，200＋有回复即可达。
 * 连不上/超时/非 2xx 一律回 reachable:false＋error，绝不抛。
 */
async function probeConfigKind(kind, block) {
  const started = Date.now()
  const fail = (error, detail) => ({
    reachable: false,
    latencyMs: Date.now() - started,
    error,
    ...(detail ? { detail: text(detail) } : {}),
    ...(block.model ? { model: block.model } : {})
  })
  // OS-74：生图后端是 ComfyUI 时，probe 走 /system_stats（不走 OpenAI 兼容路径）
  if (kind === 'image' && block.backend === 'comfyui') {
    if (!text(block.comfyUrl).trim()) return fail('NOT_CONFIGURED', '还没有填 ComfyUI 地址（如 http://127.0.0.1:8188）')
    const comfy = await probeComfy(block.comfyUrl)
    return {
      reachable: comfy.reachable,
      latencyMs: comfy.latencyMs,
      ...(comfy.detail ? { detail: comfy.detail } : {}),
      ...(comfy.error ? { error: comfy.error } : {})
    }
  }
  if (!text(block.endpoint).trim()) return fail('NOT_CONFIGURED', '还没有填 endpoint')

  const headers = { 'content-type': 'application/json', ...(block.apiKey ? { authorization: `Bearer ${block.apiKey}` } : {}) }
  let url = ''
  let body = null
  if (kind === 'text') {
    url = chatCompletionsUrl(block.endpoint)
    if (!url) return fail('NOT_CONFIGURED', 'endpoint 不是有效地址')
    body = JSON.stringify({ model: block.model, messages: [{ role: 'user', content: 'ping' }], max_tokens: 1, stream: false })
  } else if (kind === 'image') {
    url = imagesGenerationsUrl(block.endpoint)
    if (!url) return fail('NOT_CONFIGURED', 'endpoint 不是有效地址')
    body = JSON.stringify({ model: block.model, prompt: 'a red dot', size: '256x256', n: 1, response_format: 'b64_json' })
  } else {
    url = chatCompletionsUrl(block.endpoint)
    if (!url) return fail('NOT_CONFIGURED', 'endpoint 不是有效地址')
    body = JSON.stringify({
      model: block.model,
      max_tokens: 16,
      stream: false,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: '这张图是什么颜色？只回答颜色名。' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${VISION_PROBE_PNG}` } }
        ]
      }]
    })
  }

  let response
  try {
    // 只发 http/https：file:、data: 一类不进探测（fetch 也会拒，但这里给个人话原因）
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return fail('INVALID_ENDPOINT', 'endpoint 只支持 http/https')
    }
  } catch {
    return fail('INVALID_ENDPOINT', `endpoint 不是有效 URL：${text(block.endpoint)}`)
  }
  try {
    response = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) })
  } catch (error) {
    if (isTimeoutError(error)) return fail('TIMEOUT', `${PROBE_TIMEOUT_MS / 1000} 秒内没有响应`)
    return fail('UNREACHABLE', text(error?.message || error))
  }
  if (!response.ok) return fail(`HTTP_${response.status}`, await readSnippet(response))

  if (kind === 'image') {
    let payload = null
    try { payload = await response.json() } catch { return fail('BAD_RESPONSE', '返回的不是 JSON') }
    const b64 = payload?.data?.[0]?.b64_json
    if (!b64) return fail('NO_IMAGE', '返回里没有 b64_json 图片数据')
    return { reachable: true, latencyMs: Date.now() - started, model: block.model }
  }

  let payload = null
  try { payload = await response.json() } catch { return fail('BAD_RESPONSE', '返回的不是 JSON') }
  const reply = text(payload?.choices?.[0]?.message?.content).trim()
  if (!reply) return fail('EMPTY_REPLY', '模型没有回复内容')
  return { reachable: true, latencyMs: Date.now() - started, model: block.model, detail: kind === 'vision' ? reply.slice(0, 40) : 'ok' }
}

async function handleConfigGet(res, context) {
  const { config } = await loadConfigV2(context.agentConfigPath)
  const payload = configPublicV2(config, context.agentConfigPath)
  const checked = validateResponse('configGet', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '配置响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

async function handleConfigPut(res, request, context) {
  const errors = validateConfigPatch(request)
  if (errors.length) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '配置不符合契约', { errors })
  const config = await saveConfigV2(context.agentConfigPath, request)
  const payload = configPublicV2(config, context.agentConfigPath)
  const checked = validateResponse('configPut', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '配置响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

async function handleConfigProbe(res, request, context) {
  const kind = text(request.kind).trim()
  if (kind !== 'text' && kind !== 'image' && kind !== 'vision') {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `kind 只能是 text / image / vision：${text(request.kind)}`)
  }
  const { config } = await loadConfigV2(context.agentConfigPath)
  // overrides：用未保存的块值试连（只认同块字段，其余丢弃）
  const block = normalizeConfigBlock(kind, isPlainObject(request.overrides) ? { ...config[kind], ...request.overrides } : config[kind])
  const probed = await probeConfigKind(kind, block)
  const payload = {
    ok: true,
    kind,
    reachable: probed.reachable,
    latencyMs: probed.latencyMs,
    ...(probed.model ? { model: probed.model } : {}),
    ...(probed.detail ? { detail: probed.detail } : {}),
    ...(probed.error ? { error: probed.error } : {})
  }
  const checked = validateResponse('configProbe', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '探测响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

function sseFrame(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function handleAgentConfigGet(res, context) {
  // 旧端点保留（MCP/旧前端还在用）：返回旧形状，值来自 text 块。
  const { config } = await loadConfigV2(context.agentConfigPath)
  return sendJson(res, 200, configPublicLegacy(config, context.agentConfigPath))
}

/** 运行时货架：Pi 兜底（内置伪条目）＋各 kit（内置/本机）。userDir 供设置页展示。 */
async function handleAgentRuntimesGet(res, context) {
  const { config } = await loadConfigV2(context.agentConfigPath)
  const textBlock = config.text
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  // OS-18：货架三组（native＝Pi/DSH/套件侧车；cli＝CLI 嫁接），CLI 与 DSH 带实测状态
  const enriched = []
  for (const kit of kits) {
    let probeResult = null
    if (kit.probe) {
      if (kit.kind === 'dsh') {
        // od 口径分层：CLI → profile → runtime 组件 → 就绪；每层都带「下一步」
        const stack = await probeDshStack({ env: context.env })
        if (stack.state === 'ready') {
          probeResult = { installed: true, version: `就绪（${stack.version ?? 'dsh'} · profile ${stack.profile}）`, state: 'ready' }
        } else {
          const http = await detectDshAny({ env: context.env })
          probeResult = http.running && http.mode === 'http'
            ? { installed: true, version: `chat 端点就绪（${http.source}）`, state: 'ready', mode: 'http' }
            : { installed: false, state: stack.state, message: stack.message, commands: stack.commands ?? [] }
        }
      } else {
        probeResult = await probeRuntimeKit(kit)
      }
    }
    enriched.push({
      id: kit.id,
      name: kit.name,
      kind: kit.kind,
      category: kit.category ?? 'native',
      source: kit.source,
      status: kit.kind === 'sidecar'
        ? (sidecarRunning(kit.id) ? 'running' : 'idle')
        : probeResult
          ? (probeResult.installed ? 'ready' : 'missing')
          : 'ready',
      description: kit.description,
      // OS-74：CLI kit 的模型清单透传给设置页（下拉选项来源）
      ...(Array.isArray(kit.models) && kit.models.length ? { models: kit.models } : {}),
      ...(kit.defaultModel ? { defaultModel: kit.defaultModel } : {}),
      ...(probeResult ? { probe: probeResult } : {})
    })
  }
  const runtimes = [
    {
      id: '',
      name: 'Pi（默认兜底）',
      kind: 'pi',
      category: 'native',
      source: '内置',
      status: text(textBlock.endpoint).trim() ? 'ready' : 'unconfigured',
      description: '直连 OpenAI 兼容端点（下方字段）；没装任何 kit 时的原生兜底，也是默认运行时'
    },
    ...enriched
  ]
  const userDir = Array.isArray(context.runtimesDirs) && context.runtimesDirs[1] ? context.runtimesDirs[1] : ''
  return sendJson(res, 200, { ok: true, active: text(textBlock.runtime).trim(), runtimes, ...(userDir ? { userDir } : {}) })
}

async function handleAgentRuntimePut(res, request, context) {
  const id = text(request.id).trim()
  if (id) {
    const { kits } = loadRuntimeKits(context.runtimesDirs)
    if (!kits.some((kit) => kit.id === id)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `货架上没有这个运行时套件：${id}`)
    }
  }
  const config = await saveConfigV2(context.agentConfigPath, { text: { runtime: id } })
  return sendJson(res, 200, { ok: true, active: text(config.text.runtime).trim() })
}

async function handleAgentConfigPut(res, request, context) {
  // 旧端点保留：请求是旧的扁平字段，写进 text 块，响应回旧形状。
  const config = await saveConfigV2(context.agentConfigPath, { text: { ...request } })
  return sendJson(res, 200, configPublicLegacy(config, context.agentConfigPath))
}

/**
 * 上游解析（OS-9）：活动 kit 优先（sidecar 拉起/endpoint 直连），不可达且 Pi 有配置＝兜底＋notice；
 * 无 kit 或选了 Pi＝走 daemon 本机端点配置。凭据只在本机，不回显。
 */
function piUpstream(config) {
  const textBlock = configTextBlock(config)
  const endpoint = text(textBlock.endpoint).trim()
  if (!endpoint) {
    return { ok: false, code: API_ERROR_CODES.AGENT_NOT_CONFIGURED, message: '还没配置模型端点：点 Agent 列右上角的齿轮，填 OpenAI 兼容端点，或选一个运行时套件' }
  }
  try {
    const url = new URL(endpoint)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { ok: false, code: API_ERROR_CODES.INVALID_ENTRY, message: '模型端点只支持 http/https' }
    }
  } catch {
    return { ok: false, code: API_ERROR_CODES.INVALID_ENTRY, message: `配置的模型端点不是有效 URL：${endpoint}` }
  }
  return {
    ok: true,
    url: endpoint,
    headers: textBlock.apiKey ? { authorization: `Bearer ${textBlock.apiKey}` } : {},
    // 模型：对话模型优先，留空回落到 Agent 默认档（「OpenStory 默认模型」）
    model: text(textBlock.model || configAgentBlock(config).defaultModel).trim(),
    runtimeName: 'Pi 兜底'
  }
}

function fallbackToPi(config, reason) {
  const pi = piUpstream(config)
  if (pi.ok) return { ...pi, notice: `${reason}——本次用 Pi 兜底` }
  return { ok: false, code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: `${reason}，且 Pi 兜底也没有可用端点（${pi.message}）` }
}

async function resolveChatUpstream(config, context) {
  const textBlock = configTextBlock(config)
  const activeKitId = text(textBlock.runtime).trim()
  if (!activeKitId) return piUpstream(config)
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  const kit = kits.find((item) => item.id === activeKitId)
  if (!kit) return fallbackToPi(config, `运行时套件 ${activeKitId} 不在货架上了`)
  const headers = kit.apiKey ? { authorization: `Bearer ${kit.apiKey}` } : {}
  if (kit.kind === 'endpoint') {
    return { ok: true, url: `${kit.url}${kit.chatPath}`, headers, model: kit.model, runtimeName: kit.name }
  }
  if (kit.kind === 'cli') {
    // CLI 嫁接：不走 HTTP——上游是一次性子进程（handleAgentChat 里 execute）
    const probed = await probeRuntimeKit(kit)
    if (probed.installed !== true) {
      return fallbackToPi(config, `CLI 不可用：${kit.name}（${probed.message ?? '未安装'}）`)
    }
    return { ok: true, execute: 'cli', kit, model: kit.model, runtimeName: kit.name }
  }
  if (kit.kind === 'dsh') {
    const run = await resolveDshRun(kit, { env: context.env })
    if (!run.ok) return fallbackToPi(config, `DSH 不可用：${run.message}`)
    // 推理深度（OS-39）：kit manifest / 本机配置里给了才发；不给＝用 DSH 自己的默认档
    const reasoningEffort = text(kit.reasoningEffort || textBlock.reasoningEffort).trim()
    // 模型（S4）：设置页选的 DSH 模型（provider/id）优先；没选＝用 kit manifest 的缺省档
    const model = text(textBlock.model || configAgentBlock(config).defaultModel).trim() || kit.model
    if (run.mode === 'cli') {
      // CLI stdio（od 协议）：一 run 一进程
      return { ok: true, execute: 'dsh-cli', dshRun: run, kit, model, reasoningEffort, runtimeName: kit.name }
    }
    return { ok: true, url: run.url, headers, model, runtimeName: kit.name }
  }
  const up = await ensureSidecar(kit, { env: context.env })
  if (!up.ok) return fallbackToPi(config, `运行时 ${kit.name} 起不来（${up.message}）`)
  return { ok: true, url: `http://127.0.0.1:${up.port}${kit.chatPath}`, headers, model: kit.model, runtimeName: kit.name }
}

/* ---------- 推演回合层（OS-61 P2）：结算桥接＋叙述体成文 ---------- */

/**
 * 候选结算桥接：deducePresent 把本拍候选存在 state.lastTurn.candidates（id 已重映射），
 * 而 deduceSettle 的 choose 读的是 state.lastCandidates——两者从没接上，choose 恒报
 * 「候选不在本拍里」。根因在 deduceEngine.mjs（本工单允许文件之外），这里在结算前把
 * lastTurn 的候选同步进 lastCandidates（同一份数据、同一套 id，不是伪造候选）。
 */
async function bridgeDeduceCandidates(root, bookId, sessionId = '') {
  const path = deduceStatePath(root, bookId, sessionId)
  if (!existsSync(path)) return { ok: false, code: 'NOT_FOUND', message: '还没有推演会话：先呈现一拍' }
  let state
  try { state = JSON.parse(readFileSync(path, 'utf-8')) } catch {
    return { ok: false, code: 'INVALID_ENTRY', message: '推演会话文件读不了：重新开局再试' }
  }
  const presented = Array.isArray(state?.lastTurn?.candidates) ? state.lastTurn.candidates : []
  if (!presented.length) return { ok: false, code: 'INVALID_ENTRY', message: '这一拍没有候选：先呈现一拍' }
  if (JSON.stringify(state.lastCandidates ?? null) === JSON.stringify(presented)) return { ok: true }
  state.lastCandidates = presented
  try {
    const backupPath = join(dirname(path), '.history', `${basename(path)}.bak-${Date.now()}`)
    await mkdir(dirname(backupPath), { recursive: true })
    await writeFile(backupPath, readFileSync(path))
    const tmp = `${path}.tmp-${Date.now()}`
    await writeFile(tmp, JSON.stringify(state, null, 2), 'utf-8')
    await rename(tmp, path)
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `推演会话写入失败：${text(error?.message || error)}` }
  }
  return { ok: true }
}

/** 一拍的字数（与 deduceSession.nodeWords 同口径）：有正文算正文，没正文算候选摘要。 */
function turnNodeWords(node) {
  const prose = text(node?.prose)
  if (prose.trim()) return prose.length
  return (Array.isArray(node?.candidates) ? node.candidates : [])
    .reduce((sum, candidate) => sum + text(candidate?.text).length, 0)
}

/** 成文 system 提示：小说叙述体——与推演提议体（DEDUCE_DRAMA_SYSTEM_PROMPT）绝不共用。 */
const DEDUCE_PROSE_SYSTEM = '你是世界本身——推演主持人的叙述声。用小说叙述体对玩家说话：玩家就是 POV 角色本人，一律称「你」——写你看到什么、听到什么、身体有什么感受，其他角色做了什么、说了什么，世界发生了什么变化（OS-92：文字是世界给玩家的反馈，不是角色的第一人称自述）。玩家刚拍板的行动照写过程与直接后果，但不要替玩家决定下一步行动或内心盘算。细节具体，对话自然贴人物。只输出这一拍的反馈（200–400 字），不要标题、不要候选列表、不要解释、不要 markdown 围栏。'

function turnProsePrompt(node, previousProse) {
  const scene = node?.scene ?? {}
  const candidates = Array.isArray(node?.candidates) ? node.candidates : []
  const chosen = candidates.find((candidate) => candidate.id === text(node?.choiceId))
  const lines = [
    '【当前局面】',
    `在场：${text(scene.who) || '未标记'}`,
    `地点：${text(scene.where) || '未标记'}`,
    `张力：${text(scene.tension) || '平缓'}`,
    `钩子：${text(scene.hook) || '无'}`,
    `【本拍选定】${text(chosen?.text) || text(node?.choiceId)}`
  ]
  const others = candidates.filter((candidate) => candidate.id !== text(node?.choiceId) && candidate.text)
  if (others.length) lines.push(`【其他候选（参照，不要写成选项）】${others.map((candidate) => candidate.text).join('；')}`)
  const tail = text(previousProse).trim().slice(-200)
  if (tail) lines.push(`【上一拍正文结尾（自然衔接，不要重复）】……${tail}`)
  lines.push('把这一拍写成 200–400 字的小说正文。')
  return lines.join('\n')
}

/**
 * 这一拍的正文草稿：复用 enrich 的 llmPort 手法（OS-58）——endpoint/cli/dsh 三路
 * 都收敛到单发单收。模型不可用/调用失败/回空＝{ prose:'', proseError:'模型不可用' }，
 * 绝不伪造正文。
 */
/** 三通道对话补全（cli / dsh-cli / http）——返回 { text } 或 { error }，不抛。
 *  OS-82：从 generateTurnProse 抽出来共用——推演「戏剧」候选（llmPort.complete）与
 *  成文走同一份上游解析与通道，不引入第二套模型配置。剥代码围栏对 prose 与 JSON 提议都无害。 */
async function chatCompleteViaUpstream({ upstream, system, user = '', maxTokens = 1500, temperature = 0.7, cwd = '' }) {
  if (!upstream?.ok) return { error: '模型不可用' }
  const prompt = user ? `${system}\n\n${user}` : system
  try {
    let raw = ''
    if (upstream.execute === 'cli') {
      const run = await runCliChat(upstream.kit, [{ role: 'user', content: prompt }], { model: upstream.model })
      if (!run.ok) throw new Error(run.message)
      raw = text(run.text)
    } else if (upstream.execute === 'dsh-cli') {
      let collected = ''
      const result = await runDshStdio({
        dshCmd: upstream.dshRun.dshCmd,
        profile: upstream.dshRun.profile,
        ...(cwd ? { cwd } : {}),
        prompt,
        ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
        inactivityMs: 180_000,
        timeoutMs: 600_000,
        onText: (piece) => { collected += piece }
      })
      if (!result.ok) throw new Error(result.message || result.code || 'unknown')
      raw = text(collected || result.text || '')
    } else {
      const response = await fetch(upstream.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...upstream.headers },
        body: JSON.stringify({
          model: upstream.model,
          messages: [{ role: 'system', content: system }, ...(user ? [{ role: 'user', content: user }] : [])],
          max_tokens: maxTokens,
          temperature,
          stream: false
        }),
        signal: AbortSignal.timeout(180_000)
      })
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
      const data = await response.json()
      raw = text(data.choices?.[0]?.message?.content ?? '')
    }
    const out = raw.replace(/^```[^\n]*\n/u, '').replace(/\n```$/u, '').trim()
    if (!out) return { error: '模型返回为空' }
    return { text: out }
  } catch (error) {
    return { error: text(error?.message || error) || '模型不可用' }
  }
}

/** 解析全局文本模型上游（读不到/没配返回 null）。 */
async function resolveUpstreamSafe({ context }) {
  try {
    const { config } = await loadConfigV2(context.agentConfigPath)
    const upstream = await resolveChatUpstream(config, context)
    return upstream?.ok ? upstream : null
  } catch { return null }
}

async function generateTurnProse({ context, root, node, previousProse }) {
  const upstream = await resolveUpstreamSafe({ context })
  const out = await chatCompleteViaUpstream({
    upstream,
    system: DEDUCE_PROSE_SYSTEM,
    user: turnProsePrompt(node, previousProse),
    maxTokens: 1500,
    temperature: 0.7,
    cwd: root
  })
  if (out.error || !out.text) return { prose: '', proseError: '模型不可用' }
  return { prose: out.text, proseError: '' }
}

/** OS-82：推演戏剧候选的 llmPort——从全局文本模型配置构建；没配模型返回 null
 *  （vendor 的 dramaCandidates 对 null/异常自己兜底：戏剧层缺席不阻塞必然/命运）。 */
async function buildDeduceLlmPort({ context }) {
  const upstream = await resolveUpstreamSafe({ context })
  if (!upstream) return null
  return {
    complete: async ({ system = '', maxTokens = 400 } = {}) => {
      // OS-90/91 游玩口径：vendor 提议器产出第三人称剧情走向，玩家要的是「我这个角色
      // 现在怎么做」的眼前情境分支选项。本 port 只服务戏剧候选，追加游玩指令。
      const playSystem = `${system}\n游玩口径：每条 text 一律写成 POV 角色第一人称的行动选择（「我现在怎么做」），基于眼前的情境给分支——像「前面有一座山，是进山还是绕行」「遇到一个人，是上前搭话还是默默观察」。动作要具体、当下、可执行，以动词开头；每条之间方向明显不同；不要第三人称剧情梗概，不要替世界写结果——世界怎么回应由下一拍决定。`
      const out = await chatCompleteViaUpstream({ upstream, system: playSystem, maxTokens })
      if (out.error) throw new Error(out.error)
      return { text: out.text ?? '' }
    }
  }
}

/**
 * Agent 对话（OS-4/9）：会话 JSONL ＋ 活动运行时（kit 优先，Pi 兜底）流式转发。
 * 帧协议（daemon 自有）：notice? → start（回填 sessionId）→ delta* → done；出错发 error 帧。
 * 凭据只来自本机配置/kit manifest，不回显、不进日志；上游失败如实报，不伪造回答。
 */
async function handleAgentChat(req, res, request, context, root, libraries) {
  const { config } = await loadConfigV2(context.agentConfigPath)
  const upstream = await resolveChatUpstream(config, context)
  if (!upstream.ok) {
    return sendError(res, upstream.code ?? API_ERROR_CODES.AGENT_UPSTREAM_ERROR, upstream.message)
  }
  const targetUrl = upstream.url ? new URL(upstream.url) : null

  // ephemeral：一次性工具调用（润笔/讨论/单段分析）——不建会话、不落档、不留痕。
  // 否则每润一次笔就在会话列表里多一条「【润笔请求】…」，作者的真会话会被淹没。
  const ephemeral = request.ephemeral === true

  // 会话：显式给了就用它（不存在就如实报）；没给则优先「接着上次聊」，真没有才新建。
  // newSession:true ＝作者主动点了「＋新会话」，强制开新的，不吃 lastSessionId。
  const sessionsDir = context.agentSessionsDir
  const wantNew = request.newSession === true
  const requestedId = text(request.sessionId)
  let loaded = requestedId ? await readSession(sessionsDir, root, requestedId) : null
  if (requestedId && !loaded) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${requestedId}`)
  }
  let sessionId = ''
  let history = { items: [] }
  if (ephemeral) {
    // 一次性调用：只带这一条，不读也不写任何会话文件
    history = { items: [{ kind: 'msg', role: 'user', content: request.content, at: new Date().toISOString() }] }
  } else {
    if (!loaded && !wantNew) {
      // 默认会话：接着这个库上次聊的那条（作者口径：不要每次进来都是新会话）
      const last = await lastSessionId(sessionsDir, root)
      if (last) loaded = await readSession(sessionsDir, root, last)
    }
    if (!loaded) {
      const title = text(request.content).replace(/\s+/gu, ' ').trim().slice(0, 24) || '新会话'
      const created = await createSession(sessionsDir, root, title)
      loaded = { session: created, items: [] }
    }
    sessionId = loaded.session.id
    await appendSession(sessionsDir, root, sessionId, [{
      t: 'msg', id: newMessageId(), role: 'user', content: request.content, at: new Date().toISOString()
    }])
    history = await readSession(sessionsDir, root, sessionId)
  }
  const promptBundle = await systemPromptFor(root, libraries, context.genresDirs, context.skillsDirs, { suitesDirs: context.suitesDirs, suiteStatePath: context.suiteStatePath, env: context.env })
  const upstreamMessages = buildUpstreamMessages(promptBundle.prompt, history.items)
  const model = text(request.model || upstream.model).trim()

  const headers = { 'content-type': 'application/json', accept: 'text/event-stream', ...upstream.headers }

  const controller = new AbortController()
  let clientGone = false
  // res 'close'＝连接提前断开（工作台点了停止/关页）；正常结束后 res 的 close 不触发 abort。
  res.on('close', () => {
    if (!res.writableEnded) {
      clientGone = true
      controller.abort()
    }
  })

  if (upstream.execute === 'dsh-cli') {
    // DSH stdio（od 协议）：start → (thinking|tool|usage|delta)* → done
    // 会话连续性：resume_session_id 换 DSH 侧真会话；续上了才有跨轮记忆、才会触发 DSH 自己的上下文压缩。
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    // DSH 带完整工具链 + cwd=库根：告诉它「你能读，但改正文要走卡」，别再说假话
    const promptBundle = await systemPromptFor(root, libraries, context.genresDirs, context.skillsDirs, {
      canReadFiles: true,
      chineseReasoning: configTextBlock(config).chineseReasoning !== false,
      suitesDirs: context.suitesDirs,
      suiteStatePath: context.suiteStatePath,
      env: context.env
    })
    const systemPrompt = promptBundle.prompt
    const applied = promptBundle.applied
    // start 帧带上「这轮生效了什么」（运行时/技能/体裁/KB），界面据此标注。
    // OS-131：先构造 canonical 事件再投影成旧帧——线上字节与改前逐字符一致。
    sseFrame(res, projectLegacyFrame({ type: 'agent_started', sessionId, runtime: upstream.runtimeName, applied }))
    if (upstream.notice) sseFrame(res, projectLegacyFrame({ type: 'notice', text: upstream.notice }))
    // 断连守卫：连接已关就别再往 res 里写（否则 ERR_STREAM_WRITE_AFTER_END）
    const safeSend = (frame) => {
      if (clientGone || res.writableEnded) return
      try { sseFrame(res, frame) } catch { /* 连接已断，静默 */ }
    }
    const dshModel = text(upstream.model).trim()
    // resume 前置：模型/cwd 变了就作废（DSH 侧会话与运行环境绑定）
    const stitched = await resolveDshResume({ sessionsDir, root, session: loaded?.session, ephemeral, model: dshModel })
    const resumeSessionId = stitched.resumeSessionId
    if (stitched.notice) safeSend(projectLegacyFrame({ type: 'notice', text: stitched.notice }))

    // resume 时 DSH 自己记得前文，只发最新一轮；冷启才发全量历史
    const dshPrompt = resumeSessionId
      ? composeDshPrompt(history.items, { systemPrompt, onlyTail: true })
      : composeDshPrompt(history.items, { systemPrompt })

    let collected = ''
    let sawText = false
    // 过程留痕（OS-42）：思考轨迹与工具调用单独收，跟最终答案分开落档。
    // 不做的话刷新一次这些过程就全丢了，作者回头看不到「它当时在想什么、查了什么」。
    let thinkingBuf = ''
    const toolTrace = []
    const toolStarted = new Map()
    const traceStart = Date.now()
    const onThinkingPiece = (piece) => {
      thinkingBuf += piece
      safeSend(projectLegacyFrame({ type: 'thinking', text: piece }))
    }
    const onToolCallFrame = (call) => {
      // 调用当下就记一条（有些工具 DSH 只发 tool_call、不发 tool_result——
      // 结果直接喂给模型了，界面就再也等不到返回帧）。这样至少能保留「调了什么」。
      const key = call.id || call.name
      toolStarted.set(key, { at: Date.now(), name: call.name, input: call.input })
      toolTrace.push({
        id: call.id,
        name: call.name || 'tool',
        input: call.input ?? null,
        output: '',
        isError: false,
        elapsedMs: 0
      })
      safeSend(projectLegacyFrame({
        type: 'tool_call',
        toolName: call.name,
        args: call.input,
        callId: call.id,
        status: 'call'
      }))
    }
    const onToolResultFrame = (outcome) => {
      const started = toolStarted.get(outcome.id || '')
      // 回填刚才那条（有就更新，没有就补一条）
      const existing = toolTrace.find((tool) => tool.id && tool.id === outcome.id)
      if (existing) {
        existing.output = outcome.output
        existing.isError = outcome.isError === true
        existing.elapsedMs = started ? Date.now() - started.at : 0
      } else {
        toolTrace.push({
          id: outcome.id,
          name: started?.name || outcome.name || 'tool',
          input: started?.input ?? null,
          output: outcome.output,
          isError: outcome.isError === true,
          elapsedMs: started ? Date.now() - started.at : 0
        })
      }
      safeSend(projectLegacyFrame({
        type: 'tool_call',
        callId: outcome.id,
        status: 'result',
        result: outcome.output,
        resultIsError: outcome.isError
      }))
    }
    const startedAt = Date.now()
    let result = await runDshStdio({
      dshCmd: upstream.dshRun.dshCmd,
      profile: upstream.dshRun.profile,
      cwd: root,
      prompt: dshPrompt,
      resumeSessionId,
      ...(dshModel ? { model: dshModel } : {}),
      ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
      signal: controller.signal,
      inactivityMs: 90000,
      timeoutMs: 600000,
      onText: (piece) => {
        sawText = true
        collected += piece
        safeSend(projectLegacyFrame({ type: 'message_chunk', text: piece }))
      },
      onThinking: onThinkingPiece,
      onToolCall: onToolCallFrame,
      onToolResult: onToolResultFrame,
      onUsage: (usage) => safeSend(projectLegacyFrame({
        type: 'usage',
        input: usage.input,
        output: usage.output,
        cachedRead: usage.cachedRead,
        cachedWrite: usage.cachedWrite,
        total: usage.total
      }))
    })

    // resume 被 DSH 拒（会话过期/被清理）：清指纹，用全量历史冷重启一次
    if (!result.ok && result.resumeRejected && !ephemeral) {
      safeSend(projectLegacyFrame({ type: 'notice', text: '上轮 DSH 会话已失效，已无缝重开一段。' }))
      await patchSessionMeta(sessionsDir, root, sessionId, { dshSessionId: '', dshModel: '', dshCwd: '' })
      const coldPrompt = composeDshPrompt(history.items, { systemPrompt })
      collected = ''
      sawText = false
      thinkingBuf = ''
      toolTrace.length = 0
      toolStarted.clear()
      result = await runDshStdio({
        dshCmd: upstream.dshRun.dshCmd,
        profile: upstream.dshRun.profile,
        cwd: root,
        prompt: coldPrompt,
        ...(dshModel ? { model: dshModel } : {}),
        ...(upstream.reasoningEffort ? { reasoningEffort: upstream.reasoningEffort } : {}),
        signal: controller.signal,
        inactivityMs: 90000,
        timeoutMs: 600000,
        onText: (piece) => {
          sawText = true
          collected += piece
          safeSend(projectLegacyFrame({ type: 'message_chunk', text: piece }))
        },
        onThinking: onThinkingPiece,
        onToolCall: onToolCallFrame,
        onToolResult: onToolResultFrame,
        onUsage: (usage) => safeSend(projectLegacyFrame({
          type: 'usage',
          input: usage.input,
          output: usage.output,
          cachedRead: usage.cachedRead,
          cachedWrite: usage.cachedWrite,
          total: usage.total
        }))
      })
    }

    if (result.ok && result.text.trim()) {
      if (!ephemeral) {
        // 先落过程再落答案：读回来时 process 行紧挨在 assistant 之前，
        // 前端 threadHtml 靠这个相邻关系把过程挂到对应消息上。
        if (thinkingBuf.trim() || toolTrace.length) {
          await appendSession(sessionsDir, root, sessionId, [{
            t: 'process',
            id: newMessageId(),
            at: new Date().toISOString(),
            thinking: thinkingBuf,
            tools: toolTrace,
            elapsedMs: Date.now() - traceStart
          }])
        }
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'msg', id: newMessageId(), role: 'assistant', content: result.text,
          at: new Date().toISOString(),
          // 用量/截断/生效清单一起落档：刷新后 reloadThread 才不会把这些冲掉
          ...(result.usage ? { usage: result.usage } : {}),
          ...(result.truncated ? { truncated: true } : {}),
          ...(applied ? { applied } : {})
        }])
        // 记住 DSH 会话指纹：下一轮靠它续上
        if (result.sessionId) {
          await patchSessionMeta(sessionsDir, root, sessionId, {
            dshSessionId: result.sessionId,
            dshModel,
            dshCwd: root
          })
        }
      }
      safeSend(projectLegacyFrame({
        type: 'run_end',
        status: 'completed',
        sessionId,
        chars: result.text.length,
        ms: Date.now() - startedAt,
        ...(result.truncated ? { truncated: true, stopReason: result.stopReason } : {})
      }))
    } else {
      // 中断/失败：已收到的部分回答要落档（partial），否则 reloadThread 会把它冲掉
      if (!ephemeral && sawText && collected.trim()) {
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'msg', id: newMessageId(), role: 'assistant', content: collected,
          at: new Date().toISOString(), partial: true
        }])
      }
      // 过程也要留：即使没出正文，「它想了什么、查了什么」也是有价值的记录
      if (!ephemeral && (thinkingBuf.trim() || toolTrace.length)) {
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'process',
          id: newMessageId(),
          at: new Date().toISOString(),
          thinking: thinkingBuf,
          tools: toolTrace,
          elapsedMs: Date.now() - traceStart
        }])
      }
      safeSend(projectLegacyFrame({
        type: 'run_end',
        status: 'error',
        error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: result.message ?? 'DSH 无输出' }
      }))
    }
    if (!clientGone && !res.writableEnded) res.end()
    return
  }

  if (upstream.execute === 'cli') {
    // CLI 嫁接：一次性子进程 → 整段一片 SSE（daemon 自有帧协议不变）
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no'
    })
    sseFrame(res, projectLegacyFrame({ type: 'agent_started', sessionId, runtime: upstream.runtimeName }))
    if (upstream.notice) sseFrame(res, projectLegacyFrame({ type: 'notice', text: upstream.notice }))
    const cli = await runCliChat(upstream.kit, upstreamMessages, { model: upstream.model })
    if (cli.ok) {
      sseFrame(res, projectLegacyFrame({ type: 'message_chunk', text: cli.text }))
      if (!ephemeral) {
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'msg', id: newMessageId(), role: 'assistant', content: cli.text, at: new Date().toISOString()
        }])
      }
      sseFrame(res, projectLegacyFrame({ type: 'run_end', status: 'completed', sessionId, chars: cli.text.length }))
    } else {
      sseFrame(res, projectLegacyFrame({
        type: 'run_end',
        status: 'error',
        error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: cli.message }
      }))
    }
    return res.end()
  }

  let upstreamRes
  try {
    upstreamRes = await fetch(targetUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ...(model ? { model } : {}), messages: upstreamMessages, stream: true }),
      signal: controller.signal
    })
  } catch (error) {
    if (clientGone) return
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `模型端点连不上：${text(error?.message || error)}`)
  }

  if (!upstreamRes.ok) {
    if (clientGone) return
    const detail = text(await upstreamRes.text().catch(() => '')).slice(0, 500)
    return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `模型端点返回 ${upstreamRes.status}`, { status: upstreamRes.status, detail })
  }

  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no'
  })
  sseFrame(res, projectLegacyFrame({ type: 'agent_started', sessionId, runtime: upstream.runtimeName }))
  if (upstream.notice) sseFrame(res, projectLegacyFrame({ type: 'notice', text: upstream.notice }))

  const decoder = new TextDecoder()
  let full = ''
  const parser = createSseDeltaParser((piece) => {
    full += piece
    if (!res.writableEnded) sseFrame(res, projectLegacyFrame({ type: 'message_chunk', text: piece }))
  })

  let upstreamError = ''
  try {
    if (upstreamRes.body) {
      for await (const chunk of upstreamRes.body) {
        parser.feed(decoder.decode(chunk, { stream: true }))
      }
      parser.feed(decoder.decode())
    }
    parser.end()
  } catch (error) {
    if (!clientGone && !controller.signal.aborted) {
      upstreamError = text(error?.message || error)
      sseFrame(res, projectLegacyFrame({
        type: 'run_end',
        status: 'error',
        error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: upstreamError }
      }))
    }
  }

  // 落档：完整回答、或被停止/中断的部分回答，partial 如实标；空回答不落（错误帧已如实报）。
  // ephemeral（润笔这类一次性调用）不落档。
  if (!ephemeral && full.trim()) {
    const partial = controller.signal.aborted || Boolean(upstreamError)
    await appendSession(sessionsDir, root, sessionId, [{
      t: 'msg', id: newMessageId(), role: 'assistant', content: full,
      at: new Date().toISOString(), ...(partial ? { partial: true } : {})
    }])
  }
  if (!clientGone && !res.writableEnded) {
    sseFrame(res, projectLegacyFrame({ type: 'run_end', status: 'completed', sessionId, chars: full.length }))
  }
  res.end()
}

/** 待确认卡：创建即取目标正文快照——「卡创建→采纳」窗口的修订闸从这里起算。 */
async function handleAgentCardCreate(res, request, context, root) {
  const loaded = await readSession(context.agentSessionsDir, root, request.sessionId)
  if (!loaded) return sendError(res, API_ERROR_CODES.NOT_FOUND, `会话不存在：${request.sessionId}`)
  const resolved = resolveInsideRoot(root, request.file)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  let snapshot
  try {
    snapshot = fileSnapshot(resolved.path)
  } catch (error) {
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `目标文件快照失败：${text(error?.message || error)}`, { file: request.file })
  }
  const note = text(request.note).trim()
  const card = {
    t: 'card',
    id: newCardId(),
    state: 'open',
    file: resolved.relative,
    text: request.text,
    ...(note ? { note } : {}),
    chars: request.text.length,
    snapshot,
    createdAt: new Date().toISOString()
  }
  await appendSession(context.agentSessionsDir, root, request.sessionId, [card])
  return sendJson(res, 200, {
    ok: true,
    card: {
      kind: 'card',
      id: card.id,
      state: card.state,
      file: card.file,
      text: card.text,
      ...(card.note ? { note: card.note } : {}),
      chars: card.chars,
      snapshot: card.snapshot,
      createdAt: card.createdAt
    }
  })
}

async function findOpenCard(context, root, sessionId, cardId) {
  const loaded = await readSession(context.agentSessionsDir, root, sessionId)
  if (!loaded) return { error: { code: API_ERROR_CODES.NOT_FOUND, message: `会话不存在：${sessionId}` } }
  const card = loaded.items.find((item) => item.kind === 'card' && item.id === cardId)
  if (!card) return { error: { code: API_ERROR_CODES.NOT_FOUND, message: `待确认卡不存在：${cardId}` } }
  if (card.state !== 'open') {
    return { error: { code: API_ERROR_CODES.INVALID_ENTRY, message: `这张卡已处理过（${card.state === 'adopted' ? '已采纳' : '已拒绝'}），不能再改` } }
  }
  return { card }
}

async function handleAgentCardAdopt(res, request, context, root) {
  const found = await findOpenCard(context, root, request.sessionId, request.id)
  if (found.error) return sendError(res, found.error.code, found.error.message)
  const card = found.card
  const resolved = resolveInsideRoot(root, card.file)
  if (!resolved.ok) return sendError(res, resolved.code, resolved.message, resolved.details)
  let current
  try {
    current = fileSnapshot(resolved.path)
  } catch (error) {
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `正文快照失败：${text(error?.message || error)}`, { file: card.file })
  }
  if (!snapshotsMatch(current, card.snapshot)) {
    return sendError(res, API_ERROR_CODES.REVISION_MISMATCH,
      `正文在卡片创建后被改过（创建时 ${card.snapshot.exists ? `${card.snapshot.chars} 字` : '不存在'}，现在 ${current.exists ? `${current.chars} 字` : '不存在'}），拒绝覆盖。请重新创建待确认卡。`,
      { file: card.file, expected: card.snapshot, actual: current })
  }
  // 习惯 lint（OS-59）：采纳前对产物跑禁用词/句式检测。命中且未确认 → 409 让前端弹确认；
  // 作者确认后带 confirm:true 再来一次。只提醒不阻断（习惯表是作者自己的规矩）。
  const habits = readHabits(root)
  const habitHits = lintHabits(card.text, habits)
  if (habitHits.length && request.confirm !== true) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY,
      `这段产物命中了你的习惯表：${habitHits.map((hit) => hit.message).join('；')}。确认仍要采纳？`,
      { habitHits, needsConfirm: true, file: card.file })
  }
  const written = await writeChapterWithBackup(root, card.file, card.text)
  if (!written.ok) return sendError(res, written.code, written.message, written.details)
  const updated = await updateCard(context.agentSessionsDir, root, request.sessionId, request.id, {
    state: 'adopted',
    resolvedAt: new Date().toISOString(),
    ...(written.backup ? { backup: written.backup } : {})
  })
  return sendJson(res, 200, {
    ok: true,
    card: updated,
    chars: written.chars,
    savedAt: written.savedAt,
    ...(written.backup ? { backup: written.backup } : {}),
    ...(habitHits.length ? { habitHits } : {})
  })
}

async function handleAgentCardReject(res, request, context, root) {
  const found = await findOpenCard(context, root, request.sessionId, request.id)
  if (found.error) return sendError(res, found.error.code, found.error.message)
  const updated = await updateCard(context.agentSessionsDir, root, request.sessionId, request.id, {
    state: 'rejected',
    resolvedAt: new Date().toISOString()
  })
  return sendJson(res, 200, { ok: true, card: updated })
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
  return async function handler(req, res) {
    const url = new URL(req.url || '/', 'http://127.0.0.1')
    try {
      /* OS-95：套件前端令牌桥。
       * 插件设置页跑在同源 iframe 里，**拿不到父文档的 CSS 变量**（iframe 不继承）。
       * 所以宿主要主动下发一套：插件页只需 <link rel="stylesheet" href="/suite-assets/_tokens.css">
       * 就能用 --ui-fs-* / --ui-gap-* / --ui-scale / --radius / --accent… 全套令牌。
       * 保留 _ 前缀避免与任何套件 id 冲突（套件 id 规定 [\w-]，不含下划线开头）。
       * 令牌值在此转写成**具体 px**（iframe 内没有 --ui-scale 的继承链，宿主按当前档位算好再下发）。 */
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
      if (url.pathname.startsWith('/suite-assets/')) {
        const rest = url.pathname.slice('/suite-assets/'.length)
        const slash = rest.indexOf('/')
        const suiteId = slash > 0 ? rest.slice(0, slash) : ''
        const relPath = slash > 0 ? rest.slice(slash + 1) : ''
        if (!suiteId || !relPath) {
          return sendError(res, API_ERROR_CODES.NOT_FOUND, '套件资产路径形如 /suite-assets/<id>/<文件>')
        }
        return await serveSuiteAsset(req, res, resolvedSuitesDirs, decodeURIComponent(suiteId), decodeURIComponent(relPath))
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        return await handleApi(req, res, url, { port: currentPort(), preferencesPath, extraRoots, defaultRoot, agentConfigPath: resolvedConfigPath, agentSessionsDir: resolvedSessionsDir, stylesDirs: resolvedStylesDirs, runtimesDirs: resolvedRuntimesDirs, suitesDirs: resolvedSuitesDirs, suiteStatePath: resolvedSuiteStatePath, genresDirs: resolvedGenresDirs, skillsDirs: resolvedSkillsDirs, env })
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
    handler(req, res)
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
        const health = bootstrapKbHealth({ env, repoRoot: HERE, logger, defaultKbConfigPath, resolveCollections })
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

const isMain = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (isMain) {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    console.log('用法：node openstory/daemon.mjs [--port=8807] [--root=<库路径>] [--preferences=<next-preferences.json>]')
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
