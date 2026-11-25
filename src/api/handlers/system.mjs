/**
 * system 域 handler（OS-141 daemon 拆分）——22 端点，与 contracts/system.mjs 一一对应：
 * configGet/configPut/configProbe（全局模型配置）、jobsGet/jobCancel/jobsClear（全局任务中心）、
 * fsBrowse/nativePick/nativeReveal（本机文件面）、filesGet/artifactsGet/dirCreate（库内文件面）、
 * habitsGet/habitsPut（写作习惯）、briefGet/briefPut（项目简报）、uiStateGet/uiStatePut（界面状态）、
 * kbConfigGet/kbConfigPut/kbTest/kbStatusGet（知识库）、visionDescribe（DSH 识图）、healthGet（进程事实）。
 *
 * 统一签名 `async handler(ctx)`，ctx = { req, res, url, request, context, allowlist, loaded }：
 *   · 契约校验（validateRequest）已由 daemon 路由层完成，handler 从 ctx.request 拿规整后的值；
 *   · 需要库的端点第一件事做 root 授权（authorizeRoot）；config、kb、jobs、fsBrowse 一类
 *     本机端点不碰库文件，不做 root 校验（与拆分前一致）。
 * handler 文件之间不许互相 import；共用逻辑走 src/host/*、src/services/*、src/protocol/*。
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { API_ERROR_CODES, isPlainObject, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot, RESERVED_LIB_DIRS } from '../../host/authorize.mjs'
import { loadGenres, readBrief, writeBrief } from '../../services/genres.mjs'
import { listJobs, cancelJob, clearSettled, activeCount } from '../../services/jobCenter.mjs'
import { readBrowseMemory, writeBrowseMemory, defaultBrowseRoot } from '../../services/nativePicker.mjs'
import { loadConfigV2, saveConfigV2, configPublicV2, validateConfigPatch, normalizeConfigBlock, probeTextConfig } from '../../services/agentConfig.mjs'
import { resolveMediaCapability } from '../../host/capabilityBindings.mjs'
import { listLibraryFiles } from '../../protocol/libraryInventory.mjs'
import { readUiState, writeUiState } from '../../protocol/libState.mjs'
import { BASE_GRAPH, MODULE_MANIFESTS, deriveModuleStateChange } from '../../protocol/modules.mjs'
import { defaultUiPreferencesPath, readUiPreferences, writeUiSkin } from '../../services/uiPreferences.mjs'

/* OS-127 健康端点：免 root 授权（不碰库清单、不落任何库信息，只报进程事实），
 * 放在最前面——探活要轻，而且这是「还没授权 root」时唯一有用的 API。
 * daemon 在输入解析之前就把 healthGet 接走（ctx 无 request）。 */
export async function healthGet(ctx) {
  const { res, context } = ctx
  const runtime = context.runtime
  const payload = {
    ok: true,
    pid: process.pid,
    port: context.port ?? context.currentPort(),
    generation: runtime.generation,
    startedAt: runtime.startedAt,
    uptimeMs: Math.round(process.uptime() * 1000)
  }
  const healthChecked = validateResponse('healthGet', payload)
  if (!healthChecked.ok) {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '健康响应形状不符合契约', { errors: healthChecked.errors })
  }
  return sendJson(res, 200, payload)
}

/* Agent 配置与风格包清单不碰库文件，不做 root 校验。 */
export async function configGet(ctx) {
  const { res, context } = ctx
  const { config } = await loadConfigV2(context.agentConfigPath)
  const payload = configPublicV2(config, context.agentConfigPath)
  const checked = validateResponse('configGet', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '配置响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

export async function configPut(ctx) {
  const { res, request, context } = ctx
  const errors = validateConfigPatch(request)
  if (errors.length) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '配置不符合契约', { errors })
  const config = await saveConfigV2(context.agentConfigPath, request)
  const payload = configPublicV2(config, context.agentConfigPath)
  const checked = validateResponse('configPut', payload)
  if (!checked.ok) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '配置响应形状不符合契约', { errors: checked.errors })
  return sendJson(res, 200, payload)
}

// OS-80：全局后台任务中心（跨插件共用）
export async function jobsGet(ctx) {
  const { res, request } = ctx
  const root = text(request.root).trim()
  const jobs = listJobs({
    root,
    kind: text(request.kind).trim(),
    state: text(request.state).trim(),
    limit: request.limit
  })
  return sendJson(res, 200, { ok: true, jobs, active: activeCount({ root }) })
}

export async function jobCancel(ctx) {
  const { res, request } = ctx
  const id = text(request.id).trim()
  if (!id) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, 'id 必填')
  const result = cancelJob(id)
  if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.NOT_FOUND, result.message)
  return sendJson(res, 200, { ok: true })
}

export async function jobsClear(ctx) {
  const { res, request } = ctx
  const result = clearSettled({ root: text(request.root).trim() })
  return sendJson(res, 200, result)
}

export async function configProbe(ctx) {
  const { res, request, context } = ctx
  const kind = text(request.kind).trim()
  if (kind !== 'text' && kind !== 'image' && kind !== 'vision') {
    return sendError(res, API_ERROR_CODES.INVALID_ENTRY, `kind 只能是 text / image / vision：${text(request.kind)}`)
  }
  const { config } = await loadConfigV2(context.agentConfigPath)
  // overrides：用未保存的块值试连（只认同块字段，其余丢弃）
  const block = normalizeConfigBlock(kind, isPlainObject(request.overrides) ? { ...config[kind], ...request.overrides } : config[kind])
  let probed
  if (kind === 'text') {
    probed = await probeTextConfig(block)
  } else {
    const capabilityId = kind === 'image' ? 'media.generate' : 'media.describe'
    const resolved = await resolveMediaCapability('', capabilityId)
    if (!resolved.ok) return sendError(res, API_ERROR_CODES.PLUGIN_DEGRADED, resolved.message, resolved.details)
    probed = await resolved.capability.probeConfig(block)
  }
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

/* ---------- OS-97：知识库配置（可读可写可测，不再只是只读状态牌） ---------- */

export async function briefGet(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const loaded = await readBrief(authorized.root, context.genresDirs)
  if (!loaded.ok) return sendError(res, loaded.code ?? API_ERROR_CODES.INVALID_ENTRY, loaded.message)
  const genre = loaded.brief ? loadGenres(context.genresDirs).genres.find((item) => item.id === loaded.brief.genre) ?? null : null
  return sendJson(res, 200, { ok: true, brief: loaded.brief ?? null, genre: genre ?? null, path: loaded.path })
}

export async function briefPut(ctx) {
  const { res, request, context, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const written = await writeBrief(authorized.root, context.genresDirs, request)
  if (!written.ok) return sendError(res, written.code ?? API_ERROR_CODES.INVALID_ENTRY, written.message)
  const genre = loadGenres(context.genresDirs).genres.find((item) => item.id === written.brief.genre) ?? null
  return sendJson(res, 200, { ok: true, brief: written.brief, genre, path: written.path })
}

export async function uiStateGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const result = await readUiState(authorized.root)
  return sendJson(res, 200, { ok: true, state: result.state ?? {} })
}

export async function uiStatePut(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const current = await readUiState(authorized.root)
  const graphChange = deriveModuleStateChange({
    manifests: MODULE_MANIFESTS,
    base: BASE_GRAPH,
    state: current.state,
    patch: request.state
  })
  if (!graphChange.ok) return sendError(res, graphChange.code, graphChange.message, graphChange.details)
  const result = await writeUiState(authorized.root, request.state)
  if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
  return sendJson(res, 200, { ok: true, state: result.state, ...(result.backup ? { backup: result.backup } : {}) })
}

/* OS-158：机器级界面偏好（皮肤）——不碰库、不做 root 校验（与 config/jobs 同属本机端点）。
 * 路径只从 services/uiPreferences 解析一次，env 注入保证测试隔离。 */
export async function uiPreferencesGet(ctx) {
  const { res, context } = ctx
  const target = defaultUiPreferencesPath(context.env ?? process.env)
  const { preferences } = readUiPreferences(target)
  return sendJson(res, 200, { ok: true, preferences, path: target })
}

export async function uiPreferencesPut(ctx) {
  const { res, request, context } = ctx
  const target = defaultUiPreferencesPath(context.env ?? process.env)
  const result = await writeUiSkin(target, request.skin)
  if (!result.ok) return sendError(res, result.code === 'INVALID_SKIN' ? API_ERROR_CODES.INVALID_ENTRY : API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, result.message)
  return sendJson(res, 200, { ok: true, preferences: result.preferences, path: target })
}

export async function dirCreate(ctx) {
  const { res, request, allowlist } = ctx
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

export async function filesGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const listed = await listLibraryFiles(authorized.root, request.dir)
  if (!listed.ok) return sendError(res, listed.code ?? API_ERROR_CODES.INVALID_ENTRY, listed.message, listed.details)
  const payload = { ok: true, files: listed.files, ...(listed.dirs ? { dirs: listed.dirs } : {}), ...(listed.warnings?.length ? { warnings: listed.warnings } : {}) }
  return sendJson(res, 200, payload)
}

export async function fsBrowse(ctx) {
  const { res, request, context } = ctx
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

/** system 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {

  healthGet,
  configGet,
  configPut,
  configProbe,
  jobsGet,
  jobCancel,
  jobsClear,
  briefGet,
  briefPut,
  uiStateGet,
  uiStatePut,
  uiPreferencesGet,
  uiPreferencesPut,
  dirCreate,
  filesGet,
  fsBrowse,
}
