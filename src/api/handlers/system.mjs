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
import { existsSync, readFileSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { API_ERROR_CODES, isPlainObject, validateResponse } from '../contracts.mjs'
import { sendError, sendJson, text } from '../../host/http.mjs'
import { authorizeRoot, resolveInsideRoot, RESERVED_LIB_DIRS } from '../../host/authorize.mjs'
import { readHabits, normalizeHabits, writeHabitsWithBackup } from '../../services/habits.mjs'
import { loadGenres, readBrief, writeBrief } from '../../services/genres.mjs'
import { readAgentPicks, writeAgentPicks } from '../../services/skills.mjs'
import { getSuiteStateData, saveSuiteStateData } from '../../services/suites.mjs'
import { loadStylePacks } from '../../services/stylePacks.mjs'
import { defaultKbConfigPath } from '../../services/kbAdapter.mjs'
import { collectKbStatus, kbServiceState, probeServices } from '../../services/kbHealth.mjs'
import { resolveCollections } from '../../services/kbRouter.mjs'
import { listJobs, cancelJob, clearSettled, activeCount } from '../../services/jobCenter.mjs'
import {
  pickFile,
  pickFolder,
  readBrowseMemory,
  writeBrowseMemory,
  defaultBrowseRoot
} from '../../services/nativePicker.mjs'
import {
  loadConfigV2,
  saveConfigV2,
  configPublicV2,
  validateConfigPatch,
  normalizeConfigBlock,
  probeConfigKind
} from '../../services/agentConfig.mjs'
import { runDshStdio, dshModelSelection } from '../../services/dsh-cli.mjs'
import { listArtifacts, listLibraryFiles } from '../../modules/library/inventory.mjs'
import { readUiState, writeUiState } from '../../protocol/libState.mjs'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'

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

/* ---------- OS-97：知识库配置（可读可写可测，不再只是只读状态牌） ---------- */

export async function kbConfigGet(ctx) {
  const { res, context } = ctx
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

export async function kbConfigPut(ctx) {
  const { res, request, context } = ctx
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
    await atomicWriteFile(configPath, JSON.stringify(next, null, 2))
  } catch (err) {
    return sendError(res, API_ERROR_CODES.WRITE_PROTOCOL_IO_FAILED, `知识库配置写入失败：${text(err?.message || err)}`)
  }
  // 写后立刻重探
  await probeServices({ weknoraUrl: next.baseUrl, weknoraApiKey: next.apiKey }).catch(() => {})
  const status = await collectKbStatus({ configPath, services: kbServiceState, resolveCollections })
  return sendJson(res, 200, { ok: true, status })
}

export async function kbTest(ctx) {
  const { res, request, context } = ctx
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

export async function kbStatusGet(ctx) {
  const { res, context } = ctx
  const status = await collectKbStatus({
    configPath: defaultKbConfigPath(context.env ?? process.env),
    services: kbServiceState.lastCheck ? kbServiceState : null,
    resolveCollections
  })
  return sendJson(res, 200, status)
}

export async function habitsGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  return sendJson(res, 200, { ok: true, habits: readHabits(authorized.root) })
}

export async function habitsPut(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const habits = normalizeHabits(request.habits)
  if (!habits) return sendError(res, API_ERROR_CODES.INVALID_ENTRY, '习惯表形状不对：需要 { tone, style, bannedWords, preferredWords, bannedPatterns, bannedRhetoric, formulas }')
  const backup = await writeHabitsWithBackup(authorized.root, habits)
  return sendJson(res, 200, { ok: true, habits, backup })
}

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
  const result = await writeUiState(authorized.root, request.state)
  if (!result.ok) return sendError(res, result.code ?? API_ERROR_CODES.INVALID_ENTRY, result.message)
  return sendJson(res, 200, { ok: true, state: result.state, ...(result.backup ? { backup: result.backup } : {}) })
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

export async function artifactsGet(ctx) {
  const { res, request, allowlist } = ctx
  const authorized = authorizeRoot(allowlist, request.root)
  if (!authorized.ok) return sendError(res, authorized.code, authorized.message, authorized.details)
  const inventory = await listArtifacts(authorized.root)
  if (!inventory.ok) return sendError(res, inventory.code ?? API_ERROR_CODES.INVALID_ENTRY, inventory.message)
  return sendJson(res, 200, { ok: true, groups: inventory.groups, totals: inventory.totals })
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

export async function visionDescribe(ctx) {
  const { res, request, context, allowlist } = ctx
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

/** system 域端点 → handler 注册表片段（registry.mjs 聚合）。 */
export const handlers = {
  healthGet,
  configGet,
  configPut,
  configProbe,
  jobsGet,
  jobCancel,
  jobsClear,
  kbConfigGet,
  kbConfigPut,
  kbTest,
  kbStatusGet,
  habitsGet,
  habitsPut,
  briefGet,
  briefPut,
  uiStateGet,
  uiStatePut,
  dirCreate,
  filesGet,
  artifactsGet,
  fsBrowse,
  visionDescribe
}
