/**
 * 全局模型配置服务（S4，OS-141 daemon 拆分落位）——text / image / vision / agent 四块。
 *
 * 旧格式（顶层 endpoint/model/apiKey）读到即迁移到 text.*，并把新格式写回磁盘；
 * 旧端点 GET/PUT /api/agent/config 保留，内部转发到 text 块与旧形状（MCP/旧前端还在用）。
 * apiKey 只在本机文件里；对外一律走 maskApiKey 尾号掩码（凭据不出本机的红线）。
 * probe：真发一个最小请求，15 秒超时，不抛——「可行」必须实测，不猜。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { atomicWriteFile } from '../protocol/hostWrite.mjs'
import { API_ERROR_CODES, isPlainObject } from '../api/contracts.mjs'
import { maskApiKey } from '../modules/agentbar/agentStore.mjs'
import { probeComfy } from './comfyEngine.mjs'

export function text(value) {
  return String(value ?? '')
}

/** OS-75：生图默认风格与负向词（作者裁定：默认 2D 彩漫风格，可自定义覆盖）。 */
export const DEFAULT_IMAGE_STYLE = '2D彩漫风格'
export const DEFAULT_IMAGE_NEGATIVE = 'lowres, blurry, watermark, text, 3d render, photorealistic'

export const CONFIG_BLOCK_FIELDS = Object.freeze({
  text: ['endpoint', 'model', 'apiKey', 'runtime', 'reasoningEffort', 'chineseReasoning'],
  image: ['enabled', 'backend', 'endpoint', 'model', 'apiKey', 'comfyUrl', 'comfyWorkflow', 'comfyNodeMap', 'stylePrompt'],
  vision: ['enabled', 'endpoint', 'model', 'apiKey', 'profile'],
  agent: ['defaultModel', 'subagentModel', 'profile']
})

export function emptyConfigV2() {
  return {
    text: { endpoint: '', model: '', apiKey: '', runtime: '', reasoningEffort: '', chineseReasoning: true },
    image: { enabled: false, backend: 'openai', endpoint: '', model: '', apiKey: '', comfyUrl: '', comfyWorkflow: '', comfyNodeMap: {}, stylePrompt: '' },
    vision: { enabled: false, endpoint: '', model: '', apiKey: '', profile: '' },
    agent: { defaultModel: '', subagentModel: '', profile: '' }
  }
}

/** 单块规整：只认自己那几个人（未知键丢弃）；enabled 只有明确的 true 才算开。 */
export function normalizeConfigBlock(kind, raw) {
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

export function normalizeConfigV2(raw) {
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

/** 原子写回（OS-138 归一 hostWrite.atomicWriteFile），带 updatedAt。写失败时临时文件由写协议统一收场，不留垃圾。 */
async function writeConfigV2(configPath, config) {
  await mkdir(join(configPath, '..'), { recursive: true })
  await atomicWriteFile(configPath, JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2))
}

/** 读配置：缺档＝全默认（不算错）；坏档＝全默认＋warning，不拦启动；旧格式＝迁移并写回。 */
export async function loadConfigV2(configPath) {
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
export async function saveConfigV2(configPath, patch = {}) {
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
export function validateConfigPatch(input) {
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
export function configPublicV2(config, configPath) {
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
export function configPublicLegacy(config, configPath) {
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
export function configTextBlock(config) {
  if (isPlainObject(config) && isPlainObject(config.text)) return config.text
  return normalizeConfigBlock('text', config)
}

/** 取 agent 块（默认档）：text.model 没填时用它兜底。 */
export function configAgentBlock(config) {
  if (isPlainObject(config) && isPlainObject(config.agent)) return config.agent
  return normalizeConfigBlock('agent', config)
}

/* ---------- 可行性校验（probe）：真发一个最小请求，15 秒超时，不抛 ---------- */

const PROBE_TIMEOUT_MS = 15_000
// 8×8 纯红 PNG（75 字节）——识图探针的内联图，不读磁盘、不联网取图。
const VISION_PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

/** endpoint → chat/completions 完整地址（容忍已给完整路径、只给 /v1、或只给主机）。 */
export function chatCompletionsUrl(endpoint) {
  const raw = text(endpoint).trim().replace(/\/+$/u, '')
  if (!raw) return ''
  if (/\/chat\/completions$/u.test(raw)) return raw
  if (/\/v\d+(?:\.\d+)?$/u.test(raw)) return `${raw}/chat/completions`
  return `${raw}/v1/chat/completions`
}

/** endpoint → images/generations 完整地址（设置页填到 /v1 为止，也容忍完整路径）。 */
export function imagesGenerationsUrl(endpoint) {
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
export async function probeConfigKind(kind, block) {
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
