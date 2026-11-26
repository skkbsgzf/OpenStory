/**
 * OpenStory API 契约——插件域（风格包/技能货架/体裁/统一插件清单/业务套件设置与启停）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的plugins域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const pluginsEndpoints = {
  stylesGet: {
    method: 'GET',
    path: '/api/styles',
    request: { query: {} },
    // 风格包清单：内置目录＋本机目录合并（本机按 id 覆盖内置）。
    response: { ok: 'true', styles: 'array', warnings: 'array' , dirs: 'array?' },
    errors: []
  },

  skillsGet: {
    method: 'GET',
    path: '/api/skills',
    // 技能货架（openstory-skill@1）：craft 技法／review 审阅／transform 改写提案／extract 抽取。
    // genre 可选：按体裁兼容过滤。
    request: { query: { genre: 'string?' } },
    response: { ok: 'true', skills: 'array', warnings: 'array' },
    errors: []
  },

  skillGet: {
    method: 'GET',
    path: '/api/skill',
    // 单个技能全文（含正文，供装配/执行时取用）。
    request: { query: { name: 'string' } },
    response: { ok: 'true', skill: 'object' },
    errors: ['NOT_FOUND']
  },

  genresGet: {
    method: 'GET',
    path: '/api/genres',
    // 体裁货架（openstory-genre@1）：六类内置（前三类 tier=primary），本机 genres/ 可覆盖或新增形制。
    request: { query: {} },
    response: { ok: 'true', genres: 'array', warnings: 'array?' },
    errors: []
  },

  pluginsGet: {
    method: 'GET',
    path: '/api/plugins',
    // 插件统一清单（OS-120）：把 suites / skills / runtimes 三套 spec 投影成同一形状。
    // 只读聚合，不改任何一套的落盘格式；上层据此回答「我装了什么」而不必翻三个地方。
    // blocked/missingDependencies 由版本闸与依赖闸填充（未落地时是安全空值）。
    // OS-145：modules＝工作面模块插件清单（manifest 的 id/name/description/pages/settings），
    // 设置页「模块」组按它渲染自报设置项；启停状态仍按库内 ui-state 判定（不在响应里写死）。
    // OS-200：modules[] 逐件补 requires/optionalRequires/capabilities/enabled/status/statusReasons/
    // missing/optionalMissing/dependents/impact/toggleCheck；顶层 moduleGraph 是能力图，
    // suites 四键把套件货架并入同一响应（GET /api/suites 原样保留，前端后续改读此处）。
    request: { query: { root: 'string?' } },
    response: { ok: 'true', plugins: 'array', byKind: 'object', byGroup: 'object?', overrides: 'array?', stats: 'object', modules: 'array?', moduleManifestWarnings: 'array?', moduleManifestNotices: 'array?', moduleSourceGroups: 'object?', moduleGraph: 'object?', suites: 'array?', suiteOverrides: 'array?', suiteUserDir: 'string?', suiteWarnings: 'array?', capabilityReport: 'object?', warnings: 'array?' },
    errors: []
  },

  // OS-196：本机可执行模块根的机器级治理（与库无关；登记即信任）。
  // 五个端点只是「预览 → 确认 → 生效 → 刷新 → 移除」的显式流程，不提供扫描任意目录的捷径。
  moduleRootsGet: {
    method: 'GET',
    path: '/api/module-roots',
    request: { query: {} },
    response: {
      ok: 'true', roots: 'array', localModules: 'array', slotPlacements: 'object',
      warnings: 'array', path: 'string', blocked: 'object?'
    },
    errors: []
  },

  moduleRootsPreview: {
    method: 'POST',
    path: '/api/module-roots/preview',
    // 只读预览：列模块的名/版本/类别/能力/依赖/摘要＋风险说明，不写表、不装载。
    request: { body: { path: 'string' } },
    response: { ok: 'true', path: 'string', modules: 'array', risk: 'string', warnings: 'array' },
    errors: ['INVALID_ENTRY']
  },

  moduleRootsAdd: {
    method: 'POST',
    path: '/api/module-roots/add',
    // confirm:true 是作者亲眼看过预览后的明确确认；没有它绝不登记。
    request: { body: { path: 'string', confirm: 'true' } },
    response: { ok: 'true', path: 'string', roots: 'array', localModules: 'array', warnings: 'array' },
    errors: ['INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },

  moduleRootsRemove: {
    method: 'POST',
    path: '/api/module-roots/remove',
    request: { body: { path: 'string' } },
    response: { ok: 'true', path: 'string', roots: 'array', localModules: 'array', warnings: 'array' },
    errors: ['INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },

  moduleRootsRefresh: {
    method: 'POST',
    path: '/api/module-roots/refresh',
    // 只重建快照、不改登记摘要：同版本改代码后报告「内容已变」并让新代码生效。
    request: { body: {} },
    response: { ok: 'true', id: 'string', roots: 'array', localModules: 'array', warnings: 'array', blocked: 'object?' },
    errors: []
  },

  suitesGet: {
    method: 'GET',
    path: '/api/suites',
    // 业务套件（插件）货架：版本/归属/域/启停/按 schema 归一的当前值。套件不常驻——停用＝规则退回默认。
    // userDir＝本机套件目录（设置页展示）。OS-160：root 可选——带库就读写库内 suite-state，不带读写机器级缺省。
    request: { query: { root: 'string?' } },
    response: { ok: 'true', suites: 'array', overrides: 'array?', userDir: 'string?', warnings: 'array?' },
    errors: []
  },

  suiteSettingsPut: {
    method: 'PUT',
    path: '/api/suite/settings',
    // 保存某套件的设置值：按 manifest settings schema 校验（未知键丢弃，坏值 400）。
    request: { body: { id: 'string', values: 'object', root: 'string?' } },
    response: { ok: 'true', values: 'object' },
    errors: ['INVALID_ENTRY', 'NO_LIBRARY']
  },

  suiteStatePut: {
    method: 'PUT',
    path: '/api/suite/state',
    // 启停（非常驻开关）：停用不清值——套件的规则退回内置默认，值保留。
    request: { body: { id: 'string', enabled: 'boolean', root: 'string?' } },
    response: { ok: 'true', enabled: 'boolean' },
    errors: ['INVALID_ENTRY', 'NO_LIBRARY']
  },

  // OS-192：suiteStateDataGet/Put（legacy page 模式）已退役，端点数随之减二。
}
