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
    request: { query: { root: 'string?' } },
    response: { ok: 'true', plugins: 'array', byKind: 'object', stats: 'object', modules: 'array?', moduleManifestWarnings: 'array?', moduleManifestNotices: 'array?', moduleSourceGroups: 'object?', capabilityReport: 'object?', warnings: 'array?' },
    errors: []
  },

  suitesGet: {
    method: 'GET',
    path: '/api/suites',
    // 业务套件（插件）货架：版本/归属/域/启停/按 schema 归一的当前值。套件不常驻——停用＝规则退回默认。
    // userDir＝本机套件目录（设置页展示）。OS-160：root 可选——带库就读写库内 suite-state，不带读写机器级缺省。
    request: { query: { root: 'string?' } },
    response: { ok: 'true', suites: 'array', userDir: 'string?', warnings: 'array?' },
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

  suiteStateDataGet: {
    method: 'GET',
    path: '/api/suite/state-data',
    // page 模式套件的原始配置读取（值＝任意 JSON 对象，宿主不校验形状——形状归套件自己的设置页）。
    request: { query: { id: 'string', root: 'string?' } },
    response: { ok: 'true', id: 'string', values: 'object' },
    errors: ['INVALID_ENTRY', 'NO_LIBRARY']
  },

  suiteStateDataPut: {
    method: 'PUT',
    path: '/api/suite/state-data',
    // page 模式套件的原始配置保存（整对象替换）。宿主只存；形状归套件。
    request: { body: { id: 'string', values: 'object', root: 'string?' } },
    response: { ok: 'true', values: 'object' },
    errors: ['INVALID_ENTRY', 'NO_LIBRARY']
  },
}
