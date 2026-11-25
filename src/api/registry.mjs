/**
 * API 契约壳的**宿主端点**执行表（OS-194 起）。
 *
 * 契约层只注册与分派：ENDPOINTS 在 contracts/ 八域分片声明形状；宿主自有端点（health、
 * 本机偏好、原生选择器、货架/插件清单、ui-state、共享 fact 读通道……）的实现留在
 * src/api/handlers/，由本文件合成 HOST_HANDLERS。
 *
 * 模块声明的端点不再进这张静态表——它们的 handler 体已搬进 src/modules/<id>/handlers.mjs，
 * 经 activate(context) 的 handlers 贡献登记；daemon 按库快照取贡献分派（src/host/handlerTable.mjs）。
 * 贡献键与 manifest.endpoints 双向对齐由 validateModuleContribution 钉死。
 */
import { handlers as libraryHandlers } from './handlers/library.mjs'
import { handlers as chaptersHandlers } from './handlers/chapters.mjs'
import { handlers as factHandlers } from './handlers/fact.mjs'
import { handlers as referenceHandlers } from './handlers/reference.mjs'
import { handlers as agentHandlers } from './handlers/agent.mjs'
import { handlers as pluginsHandlers } from './handlers/plugins.mjs'
import { handlers as systemHandlers } from './handlers/system.mjs'
import { MODULE_ENDPOINT_OWNERS, MODULE_MANIFESTS } from '../protocol/modules.mjs'

/** endpointId → 宿主 handler（统一签名 `async handler(ctx)`，冻结表）。 */
export const HOST_HANDLERS = Object.freeze({
  ...libraryHandlers,
  ...chaptersHandlers,
  ...factHandlers,
  ...referenceHandlers,
  ...agentHandlers,
  ...pluginsHandlers,
  ...systemHandlers
})

/**
 * manifest 来源标记：endpointId → 声明它的模块 id（只登记独占端点）。
 * daemon 路由用它做停用闸（isModuleDisabledFor），也是「端点随插件走」的数据基础。
 */
export const ENDPOINT_MODULES = MODULE_ENDPOINT_OWNERS

/** 模块清单的只读投影（排错与测试用：哪些模块声明了哪些端点）。 */
export const HANDLER_MODULE_SOURCES = Object.freeze(
  MODULE_MANIFESTS.map((manifest) => Object.freeze({ id: manifest.id, name: manifest.name, endpoints: manifest.endpoints }))
)
