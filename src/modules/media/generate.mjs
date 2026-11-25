import { generateViaComfy } from './comfyEngine.mjs'

export const DEFAULT_IMAGE_STYLE = '2D彩漫风格'
export const DEFAULT_IMAGE_NEGATIVE = 'lowres, blurry, watermark, text, 3d render, photorealistic'

const text = (value) => String(value ?? '')

export function imagesGenerationsUrl(endpoint) {
  const raw = text(endpoint).trim().replace(/\/+$/u, '')
  if (!raw) return ''
  if (/\/images\/generations$/u.test(raw)) return raw
  return `${raw}/images/generations`
}

/** OpenAI 兼容生图：真实执行 images/generations，不把协议解析留给工作台。 */
export async function generateViaOpenAI({ endpoint, model = '', apiKey = '', prompt, size = '1024x1024' }) {
  if (!text(endpoint).trim()) return { ok: false, error: '未配置生图端点' }
  try {
    const response = await fetch(imagesGenerationsUrl(endpoint), {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}) },
      body: JSON.stringify({ model: text(model), prompt, size, n: 1, response_format: 'b64_json' }),
      signal: AbortSignal.timeout(300_000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} · ${(await response.text()).slice(0, 200)}`)
    const payload = await response.json()
    const b64 = payload?.data?.[0]?.b64_json
    if (!b64) throw new Error('端点没返回 b64_json')
    return { ok: true, b64, backend: 'openai' }
  } catch (error) {
    return { ok: false, error: `生图端点失败：${text(error?.message || error)}` }
  }
}

/** media.generate@1：按已保存配置选择真实后端，风格与负向词在此归一。 */
export async function generateImage({ image, root = '', prompt, stylePrompt = '', negative = '', size = '1024x1024' } = {}) {
  const stylePrefix = text(stylePrompt).trim() || text(image?.stylePrompt).trim() || DEFAULT_IMAGE_STYLE
  const styledPrompt = `${stylePrefix}，${text(prompt)}。无文字。`
  if (image?.backend === 'comfyui') {
    if (!text(image.comfyUrl).trim()) return { ok: false, error: '未配置 ComfyUI 地址' }
    const generated = await generateViaComfy({
      comfyUrl: image.comfyUrl,
      workflowPath: image.comfyWorkflow,
      root,
      nodeMap: image.comfyNodeMap,
      prompt: styledPrompt,
      negative: text(negative).trim() || DEFAULT_IMAGE_NEGATIVE,
      size
    })
    if (!generated.ok) return { ok: false, error: `ComfyUI 生图失败：${generated.error}` }
    return { ...generated, backend: 'comfyui' }
  }
  return generateViaOpenAI({
    endpoint: image?.endpoint,
    model: image?.model,
    apiKey: image?.apiKey,
    prompt: styledPrompt,
    size
  })
}
