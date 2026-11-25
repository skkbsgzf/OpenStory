/**
 * 宿主 HTTP 管线（OS-141 daemon 拆分）——daemon 与七个域 handler 共用的响应/解析工具。
 *
 * 只收「管线」不收业务：sendJson/sendError（契约错误信封＋状态码映射）、
 * readBody/readJson（带 16MB 上限的请求体读取）。来源防护四道闸与静态托管仍归
 * src/host/daemon.mjs（OS-136 的闸是服务器框架的一部分，不是 handler 的）。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { errorEnvelope } from '../api/contracts.mjs'

export function text(value) {
  return String(value ?? '')
}

/** daemon 默认端口（reference 异步生图回环调用也用它兜底，故落共享层）。 */
export const DEFAULT_PORT = 8807

/** JSON 请求体上限：16MB（故事源整包导入一类的大负载够用，再大就该走文件通道）。 */
export const MAX_JSON_BODY = 16 * 1024 * 1024

/** 契约错误码 → HTTP 状态码（未识别的码一律 500，不假装是客户端错）。 */
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
  AGENT_UPSTREAM_ERROR: 502,
  FORBIDDEN_ORIGIN: 403,
  UNSUPPORTED_MEDIA_TYPE: 400,
  // 模块插件停用（OS-144）：请求本身合法，但所属工作面被作者关掉——冲突而非客户端错误
  MODULE_DISABLED: 409,
  CAPABILITY_MISSING: 503,
  CAPABILITY_CONFLICT: 503,
  CAPABILITY_IN_USE: 409,
  OVERRIDE_REJECTED: 400,
  PLUGIN_DEGRADED: 503,
  MIGRATION_FAILED: 500,
  // 回退保护（OS-197）：数据已是新格式，旧供给者/消费者不可静默读——冲突而非坏请求
  DATA_VERSION_AHEAD: 409,
  // 故事源空库（OS-150a）：还没有故事源条目＝可预期的空态（不是坏档），404 让调用方走空态分支
  FACT_EMPTY: 404,
  // 故事源坏档（OS-150b）：有档但全部读不出来＝数据面故障，不是客户端的错
  FACT_UNREADABLE: 500,
  // 运行时套件（OS-150b）：请求的套件是测试夹具，不是可选产品运行时
  AGENT_RUNTIME_FIXTURE: 400
})

function statusFor(code) {
  return STATUS_BY_CODE[code] ?? 500
}

export function sendJson(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  })
  res.end(body)
}

export function sendError(res, code, message, details) {
  sendJson(res, statusFor(code), errorEnvelope(code, message, details))
}

export function readBody(req, limit = MAX_JSON_BODY) {
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

export async function readJson(req) {
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
