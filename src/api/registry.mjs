/**
 * API handler 注册表（OS-141 daemon 拆分）——把七个域的 handler 合成一张表（键＝endpointId）。
 *
 * 契约分域（OS-130）的执行面：contracts/<域>.mjs 声明形状，handlers/<域>.mjs 实现行为，
 * 两个七件套一一对应——新增端点必须先进 contracts（域分片），再进对应域的 handler 文件，
 * 注册表把两侧接起来。daemon 路由只问这张表：
 *   endpointFor（契约解析）→ validateRequest（契约校验）→ HANDLERS[endpointId]（取 handler）→ 调用。
 * 本表键集合与 ENDPOINTS 键集合完全相等（不多不少），test/apiRegistry.test.mjs 钉死这条。
 */
import { handlers as libraryHandlers } from './handlers/library.mjs'
import { handlers as chaptersHandlers } from './handlers/chapters.mjs'
import { handlers as factHandlers } from './handlers/fact.mjs'
import { handlers as referenceHandlers } from './handlers/reference.mjs'
import { handlers as agentHandlers } from './handlers/agent.mjs'
import { handlers as pluginsHandlers } from './handlers/plugins.mjs'
import { handlers as systemHandlers } from './handlers/system.mjs'
import { handlers as exchangeHandlers } from './handlers/exchange.mjs'
import { MODULE_ENDPOINT_OWNERS, MODULE_MANIFESTS } from '../protocol/modules.mjs'

/** endpointId → handler（统一签名 `async handler(ctx)`，ctx = { req, res, url, request, context, allowlist, loaded }）。 */
export const HANDLERS = Object.freeze({
  ...libraryHandlers,
  ...chaptersHandlers,
  ...factHandlers,
  ...referenceHandlers,
  ...agentHandlers,
  ...pluginsHandlers,
  ...systemHandlers,
  ...exchangeHandlers
})

/**
 * manifest 来源标记（OS-144）：endpointId → 声明它的模块 id。
 * 只登记**独占**端点——共用端点（如 fact 读）没有归属，任何模块停用都不影响它。
 * 这张表是「端点随插件走」的数据基础；daemon 路由用它做停用闸（isModuleDisabledFor）。
 */
export const ENDPOINT_MODULES = MODULE_ENDPOINT_OWNERS

/** 模块清单的只读投影（排错与测试用：哪些模块声明了哪些端点）。 */
export const HANDLER_MODULE_SOURCES = Object.freeze(
  MODULE_MANIFESTS.map((manifest) => Object.freeze({ id: manifest.id, name: manifest.name, endpoints: manifest.endpoints }))
)
