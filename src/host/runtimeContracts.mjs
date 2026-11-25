/**
 * OS-196a：静态契约表与本机模块自带契约的合并视图。
 *
 * 内置端点形状仍是 src/api/contracts.mjs 唯一真源；本机模块在 activate() 贡献的
 * `contracts` 只登记进当前层（src/host/moduleRuntime.mjs），分派、请求校验与错误
 * 信封都复用宿主的同一套纯函数——不另造第二套协议。
 */
import { ENDPOINTS, endpointFor as staticEndpointFor, validateRequestShape } from '../api/contracts.mjs'
import { runtimeContractsFor } from './moduleRuntime.mjs'

/** endpointId → 当前生效契约（本机自带优先，静态表兜底）。 */
export async function contractFor(endpointId, env = process.env) {
  const runtime = await runtimeContractsFor(env)
  return runtime[endpointId] ?? ENDPOINTS[endpointId] ?? null
}

/** 方法＋路径 → 端点 id：先查运行期自带契约，再查静态契约表。 */
export async function endpointFor(method, pathname, env = process.env) {
  const wantedMethod = String(method ?? '').toUpperCase()
  const wantedPath = String(pathname ?? '').replace(/\/+$/u, '') || '/'
  const runtime = await runtimeContractsFor(env)
  for (const [id, contract] of Object.entries(runtime)) {
    if (contract.method === wantedMethod && String(contract.path ?? '').replace(/\/+$/u, '') === wantedPath) return id
  }
  return staticEndpointFor(wantedMethod, wantedPath)
}

/** 请求校验：与内置端点同一套 validateRequestShape（含 query 数字规整）。 */
export async function validateRequest(endpointId, input = {}, env = process.env) {
  const contract = await contractFor(endpointId, env)
  if (!contract) return { ok: false, errors: [{ field: 'endpoint', message: `未知端点 ${endpointId}` }], value: {} }
  return validateRequestShape(contract, input)
}
