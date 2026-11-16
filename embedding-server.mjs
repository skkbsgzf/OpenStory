#!/usr/bin/env node
/**
 * 本地 Embedding 服务（OS-20）——把 BGE 模型包成 OpenAI 兼容的 /v1/embeddings。
 *
 * 为什么不用 Ollama：本机下载完整 Ollama 包约 700MB+（含 CUDA），网络太慢；
 * transformers.js 是纯 JS/ONNX 推理，模型约 25MB（bge-small-zh-v1.5 量化版），
 * 且直接说 OpenAI 兼容协议——WeKnora 的 embedding 模型配 base_url 就能用。
 *
 * 用法：
 *   node embedding-server.mjs [--port 8808] [--model Xenova/bge-small-zh-v1.5]
 * 环境：
 *   EMBED_MODEL        模型 id（默认 Xenova/bge-small-zh-v1.5）
 *   HF_ENDPOINT        模型源镜像（默认 https://hf-mirror.com）
 * 端点：
 *   GET  /health                  → {ok, model, dim}
 *   POST /v1/embeddings           → {object:'list', data:[{embedding:[...],index}], model, usage}
 *   POST /api/embeddings          → Ollama 风格兼容（prompt → embedding）
 * 只监听 127.0.0.1。
 */
import { createServer } from 'node:http'

const args = process.argv.slice(2)
function argValue(name, fallback) {
  const index = args.indexOf(`--${name}`)
  return index >= 0 ? args[index + 1] : fallback
}

const PORT = Number(argValue('port', process.env.EMBED_PORT || 8808))
const MODEL = argValue('model', process.env.EMBED_MODEL || 'Xenova/bge-small-zh-v1.5')
process.env.HF_ENDPOINT = process.env.HF_ENDPOINT || 'https://hf-mirror.com'
process.env.TRANSFORMERS_CACHE = process.env.TRANSFORMERS_CACHE || 'D:/OpenStory/.cache/models'

// 强制 WASM 后端（本机装 native onnxruntime-node 失败：预编译二进制下载被墙）
process.env.ORT_WASM_PATH = 'D:/OpenStory/node_modules/@xenova/transformers/dist/'
const { pipeline, env } = await import('@xenova/transformers')
env.backends.onnx.wasm.wasmPaths = 'D:/OpenStory/node_modules/@xenova/transformers/dist/'
env.backends.onnx.wasm.numThreads = 1
env.remoteHost = process.env.HF_ENDPOINT || 'https://hf-mirror.com'
env.remotePathTemplate = '{model}/resolve/{revision}/'
env.allowRemoteModels = false
env.allowLocalModels = true
env.useBrowserCache = false
// 关闭图像处理（sharp 的 native 二进制在本机装不上；本项目只做文本 embedding）
env.backends.onnx.wasm.proxy = false

console.log(`[embedding] 加载模型 ${MODEL}（源 ${process.env.HF_ENDPOINT}）…`)
const started = Date.now()
// 本地模型：transformers 会把 model id 拼到 env.localModelPath 下，所以给根目录＋相对 id
env.localModelPath = 'D:/OpenStory/.cache/models/'
env.allowRemoteModels = false
const extractor = await pipeline('feature-extraction', 'Xenova/bge-small-zh-v1.5', { quantized: true })
console.log(`[embedding] 模型就绪（${Date.now() - started}ms）`)

/** 文本 → 归一化向量（BGE 用 cls pooling + L2 norm）。 */
async function embed(texts) {
  const output = await extractor(texts, { pooling: 'cls', normalize: true })
  const dim = output.dims[output.dims.length - 1]
  const flat = Array.from(output.data)
  const vectors = []
  for (let index = 0; index < texts.length; index += 1) {
    vectors.push(flat.slice(index * dim, (index + 1) * dim))
  }
  return { vectors, dim }
}

let cachedDim = 0

function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

function readBody(req) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > 8 * 1024 * 1024) {
        rejectPromise(new Error('请求体超过 8MB'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => resolvePromise(Buffer.concat(chunks).toString('utf8')))
    req.on('error', rejectPromise)
  })
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', 'http://127.0.0.1')
  if (req.method === 'GET' && url.pathname === '/health') {
    return sendJson(res, 200, { ok: true, model: MODEL, dim: cachedDim || null, backend: 'transformers.js' })
  }
  if (req.method === 'GET' && url.pathname === '/v1/models') {
    return sendJson(res, 200, { object: 'list', data: [{ id: MODEL, object: 'model', owned_by: 'local' }] })
  }
  if (req.method !== 'POST') {
    return sendJson(res, 404, { error: { message: `没有这个端点：${req.method} ${url.pathname}`, type: 'not_found' } })
  }
  let payload = {}
  try {
    payload = JSON.parse(await readBody(req) || '{}')
  } catch (error) {
    return sendJson(res, 400, { error: { message: `请求体不是 JSON：${error.message}`, type: 'invalid_request_error' } })
  }
  // OpenAI 兼容 /v1/embeddings：input 可以是字符串或字符串数组
  if (url.pathname === '/v1/embeddings') {
    const input = Array.isArray(payload.input) ? payload.input.map((item) => String(item)) : [String(payload.input ?? '')]
    if (process.env.EMBED_LOG === '1') console.log(`[embedding] ← /v1/embeddings ×${input.length}: ${input.map((t) => t.slice(0, 40).replace(/\s+/g, ' ')).join(' ‖ ').slice(0, 200)}`)
    if (!input.length || input.every((item) => !item.trim())) {
      return sendJson(res, 400, { error: { message: 'input 不能为空', type: 'invalid_request_error' } })
    }
    try {
      const { vectors, dim } = await embed(input)
      cachedDim = dim
      const tokens = input.reduce((sum, item) => sum + Math.ceil(item.length / 1.5), 0)
      return sendJson(res, 200, {
        object: 'list',
        data: vectors.map((embedding, index) => ({ object: 'embedding', index, embedding })),
        model: MODEL,
        usage: { prompt_tokens: tokens, total_tokens: tokens }
      })
    } catch (error) {
      return sendJson(res, 500, { error: { message: `embedding 失败：${error.message}`, type: 'server_error' } })
    }
  }
  // Ollama 风格兼容（WeKnora 的 local source 走这个）
  if (url.pathname === '/api/embeddings') {
    const prompt = String(payload.prompt ?? payload.input ?? '')
    if (process.env.EMBED_LOG === '1') console.log(`[embedding] ← /api/embeddings: ${prompt.slice(0, 60).replace(/\s+/g, ' ')}`)
    try {
      const { vectors, dim } = await embed([prompt])
      cachedDim = dim
      return sendJson(res, 200, { embedding: vectors[0] })
    } catch (error) {
      return sendJson(res, 500, { error: `embedding 失败：${error.message}` })
    }
  }
  if (url.pathname === '/api/tags') {
    return sendJson(res, 200, { models: [{ name: MODEL, model: MODEL, size: 0, details: { family: 'bge' } }] })
  }
  return sendJson(res, 404, { error: { message: `没有这个端点：${url.pathname}`, type: 'not_found' } })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[embedding] → http://127.0.0.1:${PORT}（OpenAI 兼容 /v1/embeddings ＋ Ollama 兼容 /api/embeddings）`)
})
