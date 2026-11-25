import { imagesGenerationsUrl } from './generate.mjs'
import { probeComfy } from './comfyEngine.mjs'

const text = (value) => String(value ?? '')
const VISION_PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEklEQVR4nGP4z8CAFWEXHbQSACj/P8Fu7N9hAAAAAElFTkSuQmCC'

function timeoutError(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || error?.code === 'ABORT_ERR'
}

async function snippet(response) {
  try { return (await response.text()).slice(0, 200) } catch { return '' }
}

async function probeJson(block, url, body, validate) {
  const started = Date.now()
  const fail = (error, detail) => ({
    reachable: false,
    latencyMs: Date.now() - started,
    error,
    ...(detail ? { detail: text(detail) } : {}),
    ...(block.model ? { model: block.model } : {})
  })
  try {
    const parsed = new URL(url)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return fail('INVALID_ENDPOINT', 'endpoint 只支持 http/https')
  } catch {
    return fail('INVALID_ENDPOINT', `endpoint 不是有效 URL：${text(block.endpoint)}`)
  }
  let response
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(block.apiKey ? { authorization: `Bearer ${block.apiKey}` } : {}) },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000)
    })
  } catch (error) {
    return timeoutError(error) ? fail('TIMEOUT', '15 秒内没有响应') : fail('UNREACHABLE', text(error?.message || error))
  }
  if (!response.ok) return fail(`HTTP_${response.status}`, await snippet(response))
  let payload = null
  try { payload = await response.json() } catch { return fail('BAD_RESPONSE', '返回的不是 JSON') }
  const checked = validate(payload)
  if (checked?.code) return fail(checked.code, checked.message)
  return { reachable: true, latencyMs: Date.now() - started, model: block.model, ...(checked?.detail ? { detail: checked.detail } : {}) }
}

export async function probeImageConfig(block = {}) {
  if (block.backend === 'comfyui') {
    if (!text(block.comfyUrl).trim()) return { reachable: false, latencyMs: 0, error: 'NOT_CONFIGURED', detail: '还没有填 ComfyUI 地址（如 http://127.0.0.1:8188）' }
    return probeComfy(block.comfyUrl)
  }
  if (!text(block.endpoint).trim()) return { reachable: false, latencyMs: 0, error: 'NOT_CONFIGURED', detail: '还没有填 endpoint', ...(block.model ? { model: block.model } : {}) }
  return probeJson(block, imagesGenerationsUrl(block.endpoint), {
    model: block.model, prompt: 'a red dot', size: '256x256', n: 1, response_format: 'b64_json'
  }, (payload) => payload?.data?.[0]?.b64_json ? null : { code: 'NO_IMAGE', message: '返回里没有 b64_json 图片数据' })
}

export async function probeVisionConfig(block = {}) {
  if (!text(block.endpoint).trim()) return { reachable: false, latencyMs: 0, error: 'NOT_CONFIGURED', detail: '还没有填 endpoint', ...(block.model ? { model: block.model } : {}) }
  const raw = text(block.endpoint).trim().replace(/\/+$/u, '')
  const url = /\/chat\/completions$/u.test(raw) ? raw : /\/v\d+(?:\.\d+)?$/u.test(raw) ? `${raw}/chat/completions` : `${raw}/v1/chat/completions`
  return probeJson(block, url, {
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
  }, (payload) => {
    const reply = text(payload?.choices?.[0]?.message?.content).trim()
    return reply ? { detail: reply.slice(0, 40) } : { code: 'EMPTY_REPLY', message: '模型没有回复内容' }
  })
}
