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
import { createReadStream, existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { copyFile, mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises'
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
  configPublic,
  createSession,
  createSseDeltaParser,
  defaultAgentConfigPath,
  defaultSessionsDir,
  deleteSession,
  fileSnapshot,
  lastSessionId,
  listSessions,
  loadAgentConfig,
  newCardId,
  newMessageId,
  patchSessionMeta,
  readSession,
  renameSession,
  saveAgentConfig,
  snapshotsMatch,
  updateCard
} from './agentStore.mjs'
import {
  builtinStylesDir,
  defaultUserStylesDir,
  loadStylePacks
} from './stylePacks.mjs'
import { isHexColor, wikiHtmlDocument } from './wikiHtml.mjs'
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
  skillSummary,
  skillsForGenre
} from './skills.mjs'
import { precedentPromptSectionForGenre } from './kbRouter.mjs'
import { bootstrapKbHealth, collectKbStatus, kbServiceState } from './kbHealth.mjs'
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
import { runDshStdio } from './dsh-cli.mjs'
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
import {
  createLibrary,
  diagnoseLibrary,
  importLibrary,
  scanLibrary,
  setPrimaryCarrier
} from './libraryManage.mjs'
import { createFactFileStore } from './core/pinax/next/kernel/factFileStore.mjs'
import { absorbLegacyDirs, backlinksOf, buildReferenceGraph, REFERENCE_DIR, scanReferences } from './referenceStore.mjs'
import { deducePresent, deduceSettle } from './deduceEngine.mjs'
import { factHealth } from './factGuard.mjs'
import { enrichBook, enrichGraph } from './enrichEngine.mjs'

const enrichJobs = new Map()
const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_PORT = 8807
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
    'cache-control': 'no-cache'
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
async function writeChapterWithBackup(root, file, newText) {
  const resolved = resolveInsideRoot(root, file)
  if (!resolved.ok) return { ok: false, code: resolved.code, message: resolved.message, details: resolved.details }
  try {
    await mkdir(dirname(resolved.path), { recursive: true })
    let backupRelative = null
    if (existsSync(resolved.path)) {
      // v1 粗保护：写前把原内容复制到同目录 .history/。OpenStory 与 Electron 同时写同一库时，
      // 这里不拦冲突（不做跨进程 revision 闸），只保证「上一版还能捞回来」。
      // 待确认卡另有快照闸（卡创建→采纳窗口），见 agentStore.fileSnapshot/snapshotsMatch。
      const backup = historyBackupPath(root, file)
      if (!backup.ok) return { ok: false, code: backup.code, message: backup.message, details: backup.details }
      await mkdir(dirname(backup.path), { recursive: true })
      await copyFile(resolved.path, backup.path)
      backupRelative = backup.relative
    }
    const tmp = `${resolved.path}.tmp-${randomUUID()}`
    await writeFile(tmp, newText, 'utf-8')
    await rename(tmp, resolved.path)
    return { ok: true, chars: newText.length, savedAt: new Date().toISOString(), ...(backupRelative ? { backup: backupRelative } : {}) }
  } catch (error) {
    return { ok: false, code: API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, message: `正文写入失败：${text(error?.message || error)}`, details: { file } }
  }
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

async function handleApi(req, res, url, context) {
  const endpointId = endpointFor(req.method, url.pathname)
  if (!endpointId) {
    return sendError(res, API_ERROR_CODES.NOT_FOUND, `没有这个端点：${req.method} ${url.pathname}`)
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
  if (endpointId === 'kbStatusGet') {
    const status = await collectKbStatus({
      configPath: defaultKbConfigPath(context.env ?? process.env),
      services: kbServiceState.lastCheck ? kbServiceState : null
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
      return sendJson(res, 200, { ok: true, bookId: '', title: '', words: 0, chapters: [], books: files.map((name) => name.replace(/\.json$/, '')) })
    }
    const bookId = basename(pickPath).replace(/\.json$/, '')
    let document = null
    try { document = JSON.parse(readFileSync(pickPath, 'utf8')) } catch { document = null }
    if (!document) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `拆解文件读不了：${bookId}`)
    const { readFactWiki } = await import('./core/pinax/next/kernel/factFileStore.mjs')
    const { wiki } = readFactWiki({ root: authorized.root, id: bookId, document })
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
    return sendJson(res, 200, {
      ok: true,
      bookId,
      title: text(document.book?.title ?? ''),
      words: Number(document.book?.word_count ?? 0),
      chapters,
      books: files.map((name) => name.replace(/\.json$/, ''))
    })
  }

  if (endpointId === 'skillsGet') {
    const loaded = loadSkills(context.skillsDirs)
    const filtered = request.genre ? skillsForGenre(loaded.skills, request.genre) : loaded.skills
    return sendJson(res, 200, {
      ok: true,
      skills: filtered.map(skillSummary),
      warnings: loaded.warnings
    })
  }

  if (endpointId === 'skillGet') {
    const loaded = loadSkills(context.skillsDirs)
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
  if (endpointId === 'deducePresent') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await deducePresent({
      root: authorized.root,
      bookId: text(request.bookId || 'default'),
      pov: text(request.pov),
      seed: Number.isSafeInteger(request.seed) ? request.seed : null,
      reset: request.reset === true
    })
    if (!result.ok) return sendError(res, result.code === 'WORLD_EMPTY' ? API_ERROR_CODES.INVALID_ENTRY : (result.code ?? API_ERROR_CODES.INVALID_ENTRY), result.message)
    return sendJson(res, 200, result)
  }

  if (endpointId === 'deduceSettle') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const result = await deduceSettle({
      root: authorized.root,
      bookId: text(request.bookId || 'default'),
      candidateId: text(request.candidateId),
      action: text(request.action || 'choose'),
      note: text(request.note)
    })
    if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
    return sendJson(res, 200, result)
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
    return sendJson(res, 200, { ok: true, styles: packs.styles, warnings: packs.warnings })
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
    return sendJson(res, 200, { ok: true, ...index })
  }

  if (endpointId === 'referenceGraphGet') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const index = await scanReferences(authorized.root)
    // 条目作为只读节点参与图谱（不搬进参考，只被链接）
    let entries = []
    try {
      const store = createFactFileStore({ root: authorized.root })
      const listed = store.list({ offset: 0, limit: 500 })
      entries = Array.isArray(listed?.entries) ? listed.entries : []
    } catch { /* 没拆解目录就只有参考节点 */ }
    const graph = buildReferenceGraph(index, { entries })
    return sendJson(res, 200, { ok: true, ...graph })
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
  const store = createFactFileStore({ root })

  if (endpointId === 'entries') {
    const result = store.list({
      layer: request.layer,
      offset: request.offset,
      limit: request.limit
    })
    if (!result.ok) {
      return sendError(res, mapReadErrorCode(result.error?.code), text(result.error?.message || '条目清单读取失败'), result.error?.details)
    }
    return sendJson(res, 200, {
      ok: true,
      entries: result.entries,
      total: result.total,
      warnings: [...loaded.warnings, ...(result.warnings ?? [])]
    })
  }

  if (endpointId === 'entry') {
    const result = store.get({ id: request.id })
    if (!result.ok) {
      return sendError(res, mapReadErrorCode(result.error?.code), text(result.error?.message || '条目读取失败'), result.error?.details)
    }
    return sendJson(res, 200, { ok: true, entry: result.entry, revision: result.revision })
  }

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
      ...(health ? { factStale: health.stale, factEntries: health.entries } : {})
    })
  }

  // FACT-FIRST 供给端（叙事架构 v2 第一期）：语义增补异步 job ＋ 因果图读取。
  if (endpointId === 'enrichRun') {
    const authorized = authorizeRoot(allowlist, request.root)
    if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
    const bookId = text(request.bookId).trim()
    if (!bookId) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'bookId 必填')
    const { config } = await loadAgentConfig(context.agentConfigPath)
    const upstream = await resolveChatUpstream(config, context)
    if (!upstream.ok) return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, upstream.message)
    if (upstream.execute) {
      // cli/dsh 型上游是一次性子进程/stdio 会话，没有可编程的 completion 入口——
      // enrich 每窗都要结构化 JSON 回包，硬套会全军覆没。如实报错让作者换 endpoint 型运行时。
      return sendError(res, API_ERROR_CODES.AGENT_UPSTREAM_ERROR, `enrich 需要 endpoint 型运行时（OpenAI 兼容 chat）；当前 ${upstream.runtimeName} 是 ${upstream.execute} 型，不支持`)
    }
    // llmPort：把 runtime kit 的 chat 端点包成引擎要的形状（prompt → text）。单次调用 180s 上限。
    const llmPort = async ({ prompt, maxTokens = 2000 }) => {
      const response = await fetch(upstream.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...upstream.headers },
        body: JSON.stringify({ model: upstream.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.4, stream: false }),
        signal: AbortSignal.timeout(180_000)
      })
      if (!response.ok) throw new Error(`LLM HTTP ${response.status}`)
      const data = await response.json()
      return { text: data.choices?.[0]?.message?.content ?? '' }
    }
    const jobId = `enrich-${bookId}-${Date.now().toString(36)}`
    // 事实条目与书元数据：factFileStore 取 entries（与 /api/entries 同源），book 从拆解文件读
    const store = createFactFileStore({ root: authorized.root })
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

  if (endpointId === 'wiki') {
    const result = store.wikiGet({ bookId: request.bookId })
    if (!result.ok) {
      return sendError(res, mapReadErrorCode(result.error?.code), text(result.error?.message || 'wiki 读取失败'), result.error?.details)
    }
    return sendJson(res, 200, { ok: true, wiki: result.wiki, derivedFrom: result.derivedFrom })
  }

  if (endpointId === 'wikiHtmlGet') {
    const result = store.wikiGet({ bookId: request.bookId })
    if (!result.ok) {
      return sendError(res, mapReadErrorCode(result.error?.code), text(result.error?.message || 'wiki 读取失败'), result.error?.details)
    }
    for (const key of ['accent', 'bg', 'ink']) {
      if (isMissingColor(request[key])) {
        return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `${key} 只收 #rgb/#rrggbb 十六进制色`, { [key]: request[key] })
      }
    }
    const html = wikiHtmlDocument(result.wiki, { accent: request.accent, bg: request.bg, ink: request.ink })
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'"
    })
    return res.end(html)
  }

  if (endpointId === 'wikiDerive') {
    const result = await store.wikiDerive({ bookId: request.bookId, operationId: request.operationId })
    if (!result.ok) {
      const code = mapWriteErrorCode(result.error?.code)
      return sendError(res, code, text(result.error?.message || 'wiki 派生失败'), result.error?.details)
    }
    return sendJson(res, 200, {
      ok: true,
      wiki: result.wiki,
      derivedFrom: result.derivedFrom,
      revision: result.revision,
      duplicate: result.duplicate === true
    })
  }

  return sendError(res, API_ERROR_CODES.NOT_FOUND, `端点未实现：${endpointId}`)
}

const ENDPOINT_HAS_QUERY = new Set(['entries', 'entry', 'chapterGet', 'wiki', 'agentSessions', 'agentSessionGet', 'agentSessionDelete', 'wikiHtmlGet', 'libraryDiagnose', 'filesGet', 'chaptersGet', 'chapterDelete', 'artifactsGet', 'suiteStateDataGet', 'briefGet', 'skillsGet', 'skillGet', 'enrichStatus', 'enrichGraph', 'kbStatusGet', 'agentDshModelsGet', 'factCurveGet', 'referenceGet', 'referenceGraphGet', 'referenceNoteGet'])

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

async function systemPromptFor(root, libraries, genresDirs, skillsDirs, { canReadFiles = false, chineseReasoning = false } = {}) {
  const key = rootKey(root)
  const record = (Array.isArray(libraries) ? libraries : []).find((library) => rootKey(library.path) === key)
  const name = record?.name || basename(root) || '未命名库'
  // 生效清单（OS-43）：这轮提示词里到底塞了哪些东西，回报给界面做标注
  const applied = { canReadFiles, chineseReasoning, craftSkills: [], genre: '', brief: false, kb: false }
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
    // 中文推理（OS-43，默认开）：中文创作的中文讨论用中文思考更贴题，代价是可能损失部分推理性能
    ...(chineseReasoning
      ? ['- 请用中文思考（推理过程也用中文）。对中文写作讨论更贴切；如果遇到需要精确形式推理的环节，可以内部切换思维语言再切回。']
      : [])
  ]
  // OS-19：项目简报（体裁/篇幅/分章）是一等约束——注入体裁策略段
  try {
    const loaded = await readBrief(root, genresDirs)
    if (loaded.ok && loaded.brief) {
      const { genres } = loadGenres(genresDirs)
      const genre = genres.find((item) => item.id === loaded.brief.genre) ?? null
      const section = briefPromptSection(loaded.brief, genre)
      if (section) lines.push('', section)
      // OS-22：按体裁选 craft 类技能（技法规则）注入——只取 craft，review/transform/extract 不注入
      const loadedSkills = loadSkills(skillsDirs)
      const matched = skillsForGenre(loadedSkills.skills, loaded.brief.genre)
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
      const notes = (Array.isArray(index.notes) ? index.notes : []).filter((note) => !note.isTagNote)
      if (notes.length) {
        // 图谱：把「参考 ↔ 章节」的关系也算出来，好告诉 Agent 当前这一章挂着哪些参考
        let entries = []
        try {
          const store = createFactFileStore({ root })
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
          '这个库有一套参考资料（作者的设定、素材、想法）。下面是**索引，不是全文**：',
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

function sseFrame(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`)
}

async function handleAgentConfigGet(res, context) {
  const { config } = await loadAgentConfig(context.agentConfigPath)
  return sendJson(res, 200, configPublic(config, context.agentConfigPath))
}

/** 运行时货架：Pi 兜底（内置伪条目）＋各 kit（内置/本机）。userDir 供设置页展示。 */
async function handleAgentRuntimesGet(res, context) {
  const { config } = await loadAgentConfig(context.agentConfigPath)
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
      status: text(config.endpoint).trim() ? 'ready' : 'unconfigured',
      description: '直连 OpenAI 兼容端点（下方字段）；没装任何 kit 时的原生兜底，也是默认运行时'
    },
    ...enriched
  ]
  const userDir = Array.isArray(context.runtimesDirs) && context.runtimesDirs[1] ? context.runtimesDirs[1] : ''
  return sendJson(res, 200, { ok: true, active: text(config.runtime).trim(), runtimes, ...(userDir ? { userDir } : {}) })
}

async function handleAgentRuntimePut(res, request, context) {
  const id = text(request.id).trim()
  if (id) {
    const { kits } = loadRuntimeKits(context.runtimesDirs)
    if (!kits.some((kit) => kit.id === id)) {
      return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `货架上没有这个运行时套件：${id}`)
    }
  }
  const config = await saveAgentConfig(context.agentConfigPath, { runtime: id })
  return sendJson(res, 200, { ok: true, active: text(config.runtime).trim() })
}

async function handleAgentConfigPut(res, request, context) {
  const config = await saveAgentConfig(context.agentConfigPath, request)
  return sendJson(res, 200, configPublic(config, context.agentConfigPath))
}

/**
 * 上游解析（OS-9）：活动 kit 优先（sidecar 拉起/endpoint 直连），不可达且 Pi 有配置＝兜底＋notice；
 * 无 kit 或选了 Pi＝走 daemon 本机端点配置。凭据只在本机，不回显。
 */
function piUpstream(config) {
  const endpoint = text(config.endpoint).trim()
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
    headers: config.apiKey ? { authorization: `Bearer ${config.apiKey}` } : {},
    model: text(config.model).trim(),
    runtimeName: 'Pi 兜底'
  }
}

function fallbackToPi(config, reason) {
  const pi = piUpstream(config)
  if (pi.ok) return { ...pi, notice: `${reason}——本次用 Pi 兜底` }
  return { ok: false, code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: `${reason}，且 Pi 兜底也没有可用端点（${pi.message}）` }
}

async function resolveChatUpstream(config, context) {
  const activeKitId = text(config.runtime).trim()
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
    const reasoningEffort = text(kit.reasoningEffort || config.reasoningEffort).trim()
    if (run.mode === 'cli') {
      // CLI stdio（od 协议）：一 run 一进程
      return { ok: true, execute: 'dsh-cli', dshRun: run, kit, model: kit.model, reasoningEffort, runtimeName: kit.name }
    }
    return { ok: true, url: run.url, headers, model: kit.model, runtimeName: kit.name }
  }
  const up = await ensureSidecar(kit, { env: context.env })
  if (!up.ok) return fallbackToPi(config, `运行时 ${kit.name} 起不来（${up.message}）`)
  return { ok: true, url: `http://127.0.0.1:${up.port}${kit.chatPath}`, headers, model: kit.model, runtimeName: kit.name }
}

/**
 * Agent 对话（OS-4/9）：会话 JSONL ＋ 活动运行时（kit 优先，Pi 兜底）流式转发。
 * 帧协议（daemon 自有）：notice? → start（回填 sessionId）→ delta* → done；出错发 error 帧。
 * 凭据只来自本机配置/kit manifest，不回显、不进日志；上游失败如实报，不伪造回答。
 */
async function handleAgentChat(req, res, request, context, root, libraries) {
  const { config } = await loadAgentConfig(context.agentConfigPath)
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
  const promptBundle = await systemPromptFor(root, libraries, context.genresDirs, context.skillsDirs)
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
      chineseReasoning: config.chineseReasoning !== false
    })
    const systemPrompt = promptBundle.prompt
    const applied = promptBundle.applied
    // start 帧带上「这轮生效了什么」（运行时/技能/体裁/KB），界面据此标注
    sseFrame(res, { type: 'start', sessionId, runtime: upstream.runtimeName, applied })
    if (upstream.notice) sseFrame(res, { type: 'notice', text: upstream.notice })
    // 断连守卫：连接已关就别再往 res 里写（否则 ERR_STREAM_WRITE_AFTER_END）
    const safeSend = (frame) => {
      if (clientGone || res.writableEnded) return
      try { sseFrame(res, frame) } catch { /* 连接已断，静默 */ }
    }
    const dshModel = text(upstream.model).trim()
    // resume 前置：模型/cwd 变了就作废（DSH 侧会话与运行环境绑定）
    const stitched = await resolveDshResume({ sessionsDir, root, session: loaded?.session, ephemeral, model: dshModel })
    const resumeSessionId = stitched.resumeSessionId
    if (stitched.notice) safeSend({ type: 'notice', text: stitched.notice })

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
      safeSend({ type: 'thinking', text: piece })
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
      safeSend({ type: 'tool', phase: 'call', ...call })
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
      safeSend({ type: 'tool', phase: 'result', ...outcome })
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
        safeSend({ type: 'delta', text: piece })
      },
      onThinking: onThinkingPiece,
      onToolCall: onToolCallFrame,
      onToolResult: onToolResultFrame,
      onUsage: (usage) => safeSend({ type: 'usage', ...usage })
    })

    // resume 被 DSH 拒（会话过期/被清理）：清指纹，用全量历史冷重启一次
    if (!result.ok && result.resumeRejected && !ephemeral) {
      safeSend({ type: 'notice', text: '上轮 DSH 会话已失效，已无缝重开一段。' })
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
          safeSend({ type: 'delta', text: piece })
        },
        onThinking: onThinkingPiece,
        onToolCall: onToolCallFrame,
        onToolResult: onToolResultFrame,
        onUsage: (usage) => safeSend({ type: 'usage', ...usage })
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
      safeSend({
        type: 'done',
        sessionId,
        chars: result.text.length,
        ms: Date.now() - startedAt,
        ...(result.truncated ? { truncated: true, stopReason: result.stopReason } : {})
      })
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
      safeSend({ type: 'error', error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: result.message ?? 'DSH 无输出' } })
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
    sseFrame(res, { type: 'start', sessionId, runtime: upstream.runtimeName })
    if (upstream.notice) sseFrame(res, { type: 'notice', text: upstream.notice })
    const cli = await runCliChat(upstream.kit, upstreamMessages)
    if (cli.ok) {
      sseFrame(res, { type: 'delta', text: cli.text })
      if (!ephemeral) {
        await appendSession(sessionsDir, root, sessionId, [{
          t: 'msg', id: newMessageId(), role: 'assistant', content: cli.text, at: new Date().toISOString()
        }])
      }
      sseFrame(res, { type: 'done', sessionId, chars: cli.text.length })
    } else {
      sseFrame(res, { type: 'error', error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: cli.message } })
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
  sseFrame(res, { type: 'start', sessionId, runtime: upstream.runtimeName })
  if (upstream.notice) sseFrame(res, { type: 'notice', text: upstream.notice })

  const decoder = new TextDecoder()
  let full = ''
  const parser = createSseDeltaParser((piece) => {
    full += piece
    if (!res.writableEnded) sseFrame(res, { type: 'delta', text: piece })
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
      sseFrame(res, { type: 'error', error: { code: API_ERROR_CODES.AGENT_UPSTREAM_ERROR, message: upstreamError } })
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
    sseFrame(res, { type: 'done', sessionId, chars: full.length })
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
    ...(written.backup ? { backup: written.backup } : {})
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
        return await handleApi(req, res, url, { preferencesPath, extraRoots, defaultRoot, agentConfigPath: resolvedConfigPath, agentSessionsDir: resolvedSessionsDir, stylesDirs: resolvedStylesDirs, runtimesDirs: resolvedRuntimesDirs, suitesDirs: resolvedSuitesDirs, suiteStatePath: resolvedSuiteStatePath, genresDirs: resolvedGenresDirs, skillsDirs: resolvedSkillsDirs, env })
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
      if (logger?.log) {
        logger.log(`OpenStory daemon → http://127.0.0.1:${actualPort}`)
        if (root) logger.log(`直接进入库：${resolve(root)}`)
      }
      // KB-ARCH P1：知识库服务自愈探活——kb-config 存在才管（测试临时环境无配置＝不启动），close 时停表不留悬挂定时器
      let kbHealthStop = null
      try {
        const health = bootstrapKbHealth({ env, repoRoot: HERE, logger })
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
  startDaemon({
    port: options.port,
    root: options.root,
    preferencesPath: options.preferencesPath || undefined
  }).then((daemon) => {
    const shutdown = () => {
      daemon.close().finally(() => process.exit(0))
    }
    process.on('SIGINT', shutdown)
    process.on('SIGTERM', shutdown)
  }).catch((error) => {
    console.error(`OpenStory daemon 启动失败：${text(error?.message || error)}`)
    process.exit(1)
  })
}
