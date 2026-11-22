/**
 * OpenStory API 契约——库域（库清单/形态诊断/建库/导入预览与执行/载体修缺）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的library域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const libraryEndpoints = {
  libraries: {
    method: 'GET',
    path: '/api/libraries',
    request: { query: {} },
    response: {
      ok: 'true',
      libraries: 'array',
      warnings: 'array',
      preferencesPath: 'string?',
      defaultRoot: 'string?'
    },
    errors: []
  },

  libraryDiagnose: {
    method: 'GET',
    path: '/api/library/diagnose',
    // 库形态四件套（exists/dirEmpty/hasPinax/project）＋ A-5 verdict（与 Electron wizardKit 同口径）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', shape: 'object', verdict: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },

  libraryCreate: {
    method: 'POST',
    path: '/api/library/create',
    // primaryCarrier 缺省＝空壳（needsPrimary:true）。成功即登记进库清单（next-preferences.json）。
    request: { body: { path: 'string', name: 'string', primaryCarrier: 'string?' } },
    response: {
      ok: 'true',
      root: 'string',
      document: 'object',
      enabled: 'array?',
      needsPrimary: 'boolean',
      registered: 'object'
    },
    errors: ['INVALID_ENTRY', 'PATH_ESCAPE', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },

  libraryScan: {
    method: 'POST',
    path: '/api/library/scan',
    // 导入预览：planImport 只读源目录、不落盘。sourcePath 必须绝对且存在（源在库外是导入的本意）。
    request: { body: { root: 'string', sourcePath: 'string' } },
    response: { ok: 'true', plan: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'PATH_ESCAPE']
  },

  libraryImport: {
    method: 'POST',
    path: '/api/library/import',
    // 执行导入：runImport 按计划落盘到目标库标准目录（只新增不覆盖；源目录永远只读）。
    request: { body: { root: 'string', sourcePath: 'string' } },
    response: { ok: 'true', report: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'PATH_ESCAPE', 'WRITE_PROTOCOL_IO_FAILED']
  },

  libraryPrimary: {
    method: 'POST',
    path: '/api/library/primary',
    // 修「缺主模块」：依赖闭包装不齐＝拒绝；expectedRevision 给了就按乐观并发闸（STALE_REVISION→REVISION_MISMATCH）。
    request: { body: { root: 'string', primaryCarrier: 'string', expectedRevision: 'integer?' } },
    response: { ok: 'true', document: 'object', enabled: 'array?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'REVISION_MISMATCH', 'WRITE_PROTOCOL_IO_FAILED']
  },
}
