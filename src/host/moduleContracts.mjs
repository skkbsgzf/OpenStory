/**
 * OS-196a：本机模块 activate() 自带的运行期端点契约校验。
 *
 * 形状语言沿用 src/api/contracts.mjs（string/integer/number/boolean/object/array/
 * messages/true，末尾 `?` 表示可选）；这里只校验「自带契约没越权」：
 *   · 键必须来自 manifest.endpoints（与 handler 双向同一口径）；
 *   · 路径必须在 /api/modules/<模块 id>/… 之下；
 *   · method/request/response/errors 形状合法。
 * 分派、请求校验与错误信封仍走宿主那一套（src/host/runtimeContracts.mjs）。
 */
import { isPlainObject } from '../api/contracts.mjs'

const METHODS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'])
const TYPES = new Set(['string', 'integer', 'number', 'boolean', 'object', 'array', 'messages', 'true'])

const text = (value) => String(value ?? '')

function validShape(shape) {
  return isPlainObject(shape) && Object.values(shape).every((type) => {
    const bare = text(type).replace(/\?$/u, '')
    return TYPES.has(bare)
  })
}

export function contractPathPrefix(moduleId) {
  return `/api/modules/${moduleId}/`
}

/** @returns {{ok:boolean, errors:string[]}} */
export function validateModuleContracts(manifest, contracts) {
  if (contracts === undefined) return { ok: true, errors: [] }
  if (!isPlainObject(contracts)) return { ok: false, errors: ['contracts 必须是对象'] }
  const errors = []
  const declared = new Set(manifest?.endpoints ?? [])
  const prefix = contractPathPrefix(text(manifest?.id))
  const paths = new Map()
  for (const [id, contract] of Object.entries(contracts)) {
    if (!declared.has(id)) errors.push(`契约 ${id} 未在 manifest endpoints 声明`)
    if (!isPlainObject(contract)) { errors.push(`契约 ${id} 必须是对象`); continue }
    const method = text(contract.method).toUpperCase()
    if (!METHODS.has(method)) errors.push(`契约 ${id}.method 非法：${text(contract.method)}`)
    const path = text(contract.path)
    if (!path.startsWith(prefix) || path.length <= prefix.length) {
      errors.push(`契约 ${id}.path 必须在 ${prefix} 之下`)
    }
    const seen = paths.get(path)
    if (seen && seen !== id) errors.push(`契约 ${id} 与 ${seen} 复用路径 ${path}`)
    paths.set(path, id)
    if (contract.request !== undefined && !isPlainObject(contract.request)) {
      errors.push(`契约 ${id}.request 必须是对象`)
    } else if (isPlainObject(contract.request)) {
      for (const key of Object.keys(contract.request)) {
        if (!['query', 'body'].includes(key)) errors.push(`契约 ${id}.request 只允许 query/body`)
        else if (!validShape(contract.request[key])) errors.push(`契约 ${id}.request.${key} 含未知契约类型`)
      }
    }
    if (contract.response !== undefined && !validShape(contract.response)) {
      errors.push(`契约 ${id}.response 含未知契约类型`)
    }
    if (contract.errors !== undefined && !Array.isArray(contract.errors)) {
      errors.push(`契约 ${id}.errors 必须是数组`)
    }
  }
  return { ok: errors.length === 0, errors }
}
