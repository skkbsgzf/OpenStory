/**
 * 导入导出域契约（OS-162 / G7）：pedia/v1 ↔ fact.data/v3 薄适配。
 * 纯数据零依赖；新端点先进这里，再进 handlers/exchange.mjs，最后进 registry。
 */

export const exchangeEndpoints = {
  exchangeImport: {
    method: 'POST',
    path: '/api/exchange/import',
    // 导入：pedia/v1（或 jsonl 逐行）→ 适配 fact.data/v3 → 逐条 validateFactEntry →
    // 经 factEntriesImport 抽出的同一写入函数落盘。dryRun=true 只预览不落盘。
    request: { body: { root: 'string', bookId: 'string', format: 'string', text: 'string', dryRun: 'boolean?' } },
    response: { ok: 'true', dryRun: 'boolean', entries: 'integer', errors: 'array', warnings: 'array', skipped: 'array', written: 'object?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  exchangeExport: {
    method: 'POST',
    path: '/api/exchange/export',
    // 导出：经既有 fact 读通道取条目 → factEntryToPedia → 返回 + 丢失字段清单。
    // save=true 时存到库内「导入导出/」（宿主写协议：原子写＋.history＋修改痕迹）；默认只读不存。
    request: { body: { root: 'string', bookId: 'string', format: 'string', save: 'boolean?' } },
    response: { ok: 'true', bookId: 'string', entries: 'array', lost: 'array', file: 'string?' },
    errors: ['NO_LIBRARY', 'NOT_FOUND', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  }
}
