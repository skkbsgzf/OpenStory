/**
 * OpenStory API 契约——剧本域（剧本 ↔ fact 互转）（OS-214 新增）。
 *
 * 为什么要有这两个端点：剧本↔fact 互转的确定性算法原来只住在 `public/scriptFact.mjs`，
 * 是浏览器私有逻辑——HTTP/MCP 都调不到，等于「唯一生产路径是前端」。OS-214 把它下沉到
 * `src/modules/script/scriptFact.mjs`（纯函数、无 DOM），由本域端点对外暴露。
 *
 * 纯数据零依赖——不 import 任何模块。聚合入口仍是仓根 contracts.mjs。
 */
export const scriptEndpoints = {
  scriptToFact: {
    method: 'POST',
    path: '/api/script/to-fact',
    // 剧本全文 → fact 条目骨架。纯结构映射，不调模型、不写盘；写库由调用方另走
    // /api/fact/entries/import（那里才有 schema 校验、revision、operationId 与备份）。
    request: { body: { root: 'string', text: 'string', bookId: 'string?', domain: 'string?' } },
    response: { ok: 'true', entries: 'array', wiki: 'object', stats: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  scriptFromFact: {
    method: 'POST',
    path: '/api/script/from-fact',
    // fact 条目（可为 bookId 指向的现档，或显式 entries）→ 剧本文本。纯渲染不写盘。
    request: { body: { root: 'string', bookId: 'string?', entries: 'array?', wiki: 'object?' } },
    response: { ok: 'true', text: 'string', stats: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'FACT_EMPTY', 'FACT_UNREADABLE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  }
}
