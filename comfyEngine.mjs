/* ComfyUI 生图适配器（OS-74）
 *
 * 为什么单独成模块：生图后端有两种形态（OpenAI 兼容 API / 本地 ComfyUI），
 * 它们的工作流完全不同（HTTP 一请求 vs 提交 prompt→轮询 history→取 image），
 * 混在 daemon 里会让 deduceImage 变成一坨 if。
 *
 * 契约：
 *   generateViaComfy({ comfyUrl, workflowPath, nodeMap, prompt, size, negative, timeoutMs })
 *     → { ok:true, b64, latencyMs, promptId } | { ok:false, error }
 *
 * ComfyUI 的 API 形状（/prompt 提交 + /history/{id} 轮询 + /view 取图）：
 *   1. POST {comfyUrl}/prompt  body: { prompt: <workflow graph>, client_id }
 *      → { prompt_id }
 *   2. GET  {comfyUrl}/history/{prompt_id}  → 轮询直到有 outputs
 *   3. GET  {comfyUrl}/view?filename=..&subfolder=..&type=output  → 图片二进制
 *
 * nodeMap 说明（把作者的工作流接上我们的入参）：
 *   { positive: "6", negative: "7", seed: "3", width: "5", height: "5", steps: "3" }
 *   值是 workflow JSON 里的节点 id；缺省时按常见节点 title 猜（Positive/Negative/KSampler）。
 */
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { join, isAbsolute } from 'node:path'

const PROMPT_POLL_INTERVAL_MS = 800
const DEFAULT_TIMEOUT_MS = 300_000

function str(value) {
  return String(value ?? '')
}

/** 把 workflow JSON 里的节点按 nodeMap / title 找出来，塞入 prompt/size。返回新图，不改原对象。 */
export function applyWorkflowInputs(workflow, { prompt, negative = '', size = '1024x1024', nodeMap = {} }) {
  const graph = JSON.parse(JSON.stringify(workflow))
  const [w, h] = str(size).split('x').map((n) => Number(n))
  const width = Number.isFinite(w) && w > 0 ? w : 1024
  const height = Number.isFinite(h) && h > 0 ? h : 1024

  const nodes = graph?.prompt ?? graph
  if (!nodes || typeof nodes !== 'object') return graph

  // 找节点：优先 nodeMap，其次按 _meta.title 猜
  const findNode = (key, matchers) => {
    const mapped = str(nodeMap[key]).trim()
    if (mapped && nodes[mapped]) return nodes[mapped]
    for (const [id, node] of Object.entries(nodes)) {
      const title = str(node?._meta?.title).toLowerCase()
      const cls = str(node?.class_type).toLowerCase()
      if (matchers.some((m) => title.includes(m) || cls.includes(m))) return nodes[id]
    }
    return null
  }

  const positive = findNode('positive', ['positive', 'clip text encode'])
  if (positive?.inputs) positive.inputs.text = prompt
  const negNode = findNode('negative', ['negative'])
  // 正向和负向可能是同一个 CLIPTextEncode 的两份——按 title 区分，避免把正向覆盖成负向
  if (negNode && negNode !== positive && negNode.inputs) negNode.inputs.text = negative

  const sampler = findNode('seed', ['ksampler', 'sampler'])
  if (sampler?.inputs) {
    if ('seed' in sampler.inputs) sampler.inputs.seed = Math.floor(Math.random() * 1e15)
    if ('width' in sampler.inputs) sampler.inputs.width = width
    if ('height' in sampler.inputs) sampler.inputs.height = height
    if ('steps' in sampler.inputs && nodeMap.steps) sampler.inputs.steps = Number(nodeMap.steps) || sampler.inputs.steps
  }

  // 有些工作流把尺寸放在 EmptyLatentImage（独立节点）
  const latent = findNode('width', ['emptylatentimage', 'latent'])
  if (latent?.inputs) {
    if ('width' in latent.inputs) latent.inputs.width = width
    if ('height' in latent.inputs) latent.inputs.height = height
  }

  return graph
}

/** 从 history 里挖出第一张图的 { filename, subfolder, type }。 */
function firstImageOf(historyEntry) {
  const outputs = historyEntry?.outputs ?? {}
  for (const nodeOut of Object.values(outputs)) {
    const images = nodeOut?.images
    if (Array.isArray(images) && images.length) {
      const img = images[0]
      if (img?.filename) {
        return { filename: str(img.filename), subfolder: str(img.subfolder ?? ''), type: str(img.type ?? 'output') }
      }
    }
  }
  return null
}

/**
 * ComfyUI 生图主流程。
 * @returns {Promise<{ok:true,b64:string,latencyMs:number,promptId:string}|{ok:false,error:string}>}
 */
export async function generateViaComfy({
  comfyUrl,
  workflowPath,
  root = '',
  nodeMap = {},
  prompt,
  negative = '',
  size = '1024x1024',
  timeoutMs = DEFAULT_TIMEOUT_MS
} = {}) {
  const started = Date.now()
  const base = str(comfyUrl).trim().replace(/\/+$/u, '')
  if (!base) return { ok: false, error: 'ComfyUI 地址为空' }
  if (!str(prompt).trim()) return { ok: false, error: 'prompt 为空' }

  const wfPath = str(workflowPath).trim()
  if (!wfPath) return { ok: false, error: '未配置 ComfyUI 工作流 JSON 路径' }
  const abs = isAbsolute(wfPath) ? wfPath : join(root || '.', wfPath)
  if (!existsSync(abs)) return { ok: false, error: `工作流文件不存在：${abs}` }

  let workflow
  try {
    workflow = JSON.parse(await readFile(abs, 'utf-8'))
  } catch (error) {
    return { ok: false, error: `工作流 JSON 解析失败：${str(error?.message || error)}` }
  }

  const graph = applyWorkflowInputs(workflow, { prompt, negative, size, nodeMap })
  const clientId = `openstory-${Date.now().toString(36)}`

  // 1) 提交
  let promptId = ''
  try {
    const response = await fetch(`${base}/prompt`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt: graph?.prompt ?? graph, client_id: clientId }),
      signal: AbortSignal.timeout(60_000)
    })
    const payload = await response.json().catch(() => null)
    if (!response.ok) {
      const detail = payload?.error?.message ?? payload?.node_errors ? JSON.stringify(payload.node_errors).slice(0, 300) : `HTTP ${response.status}`
      return { ok: false, error: `ComfyUI 提交失败：${detail}` }
    }
    promptId = str(payload?.prompt_id)
    if (!promptId) return { ok: false, error: 'ComfyUI 没回 prompt_id' }
  } catch (error) {
    return { ok: false, error: `ComfyUI 连不上（${base}）：${str(error?.message || error)}` }
  }

  // 2) 轮询
  const deadline = Date.now() + timeoutMs
  let imageRef = null
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, PROMPT_POLL_INTERVAL_MS))
    try {
      const response = await fetch(`${base}/history/${encodeURIComponent(promptId)}`, { signal: AbortSignal.timeout(20_000) })
      if (!response.ok) continue
      const history = await response.json().catch(() => null)
      const entry = history?.[promptId]
      if (!entry) continue
      // ComfyUI 执行失败时 status.status_str === 'error'
      const statusStr = str(entry?.status?.status_str).toLowerCase()
      if (statusStr === 'error') {
        const msg = str(entry?.status?.messages?.[0]?.[1]?.exception_message ?? 'ComfyUI 执行报错')
        return { ok: false, error: msg.slice(0, 300) }
      }
      const found = firstImageOf(entry)
      if (found) { imageRef = found; break }
    } catch { /* 轮询失败继续等 */ }
  }
  if (!imageRef) return { ok: false, error: `ComfyUI 超时（${Math.round(timeoutMs / 1000)}s）没产出图片` }

  // 3) 取图
  try {
    const query = new URLSearchParams({ filename: imageRef.filename, subfolder: imageRef.subfolder, type: imageRef.type })
    const response = await fetch(`${base}/view?${query.toString()}`, { signal: AbortSignal.timeout(120_000) })
    if (!response.ok) return { ok: false, error: `取图失败：HTTP ${response.status}` }
    const buf = Buffer.from(await response.arrayBuffer())
    if (!buf.length) return { ok: false, error: '取图返回空数据' }
    return { ok: true, b64: buf.toString('base64'), latencyMs: Date.now() - started, promptId }
  } catch (error) {
    return { ok: false, error: `取图失败：${str(error?.message || error)}` }
  }
}

/** ComfyUI 连通性探测：GET /system_stats（最轻的只读端点）。 */
export async function probeComfy(comfyUrl, timeoutMs = 8_000) {
  const started = Date.now()
  const base = str(comfyUrl).trim().replace(/\/+$/u, '')
  if (!base) return { reachable: false, latencyMs: 0, error: 'ComfyUI 地址为空' }
  try {
    const response = await fetch(`${base}/system_stats`, { signal: AbortSignal.timeout(timeoutMs) })
    if (!response.ok) return { reachable: false, latencyMs: Date.now() - started, error: `HTTP ${response.status}` }
    const payload = await response.json().catch(() => null)
    const device = payload?.devices?.[0]
    const detail = device ? `ComfyUI ${str(payload?.system?.comfyui_version || '')} · ${str(device.name)}` : 'ComfyUI 可达'
    return { reachable: true, latencyMs: Date.now() - started, detail: detail.trim() }
  } catch (error) {
    return { reachable: false, latencyMs: Date.now() - started, error: str(error?.message || error).slice(0, 200) }
  }
}
