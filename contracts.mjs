/**
 * OpenStory API 契约（OS-2）——纯数据＋纯函数，零依赖。
 *
 * 这份文件是 daemon 与工作台的**唯一契约源**：改请求/响应形状只改这里，两端一起跟。
 * 不 import node:path / node:fs，任何环境（浏览器、Node、测试）都能直接载入。
 *
 * 形状描述用「字段 → 类型串」的扁平对象，看懂即可，不引 schema 库：
 *   string / integer / number / boolean / object / array / messages / true
 *   末尾 `?` 表示可选（undefined、null、空串都算没给）。
 *
 * 错误码词表分两层：
 *   · 壳层：NO_LIBRARY / PATH_ESCAPE / NOT_FOUND / INVALID_ENTRY / REVISION_MISMATCH；
 *   · 写协议：WRITE_PROTOCOL_* 由 S2（writeFactFile）的端口码透传改名，不另造语义。
 * 失败响应统一 `{ ok:false, error:{ code, message, details? } }`。
 */

/** 错误码词表（daemon 只从这里取码；测试按这里校验）。 */
export const API_ERROR_CODES = Object.freeze({
  NO_LIBRARY: 'NO_LIBRARY',
  PATH_ESCAPE: 'PATH_ESCAPE',
  NOT_FOUND: 'NOT_FOUND',
  INVALID_ENTRY: 'INVALID_ENTRY',
  REVISION_MISMATCH: 'REVISION_MISMATCH',
  WRITE_PROTOCOL_OPERATION_ID_REQUIRED: 'WRITE_PROTOCOL_OPERATION_ID_REQUIRED',
  WRITE_PROTOCOL_VALIDATION_FAILED: 'WRITE_PROTOCOL_VALIDATION_FAILED',
  WRITE_PROTOCOL_INVALID_INPUT: 'WRITE_PROTOCOL_INVALID_INPUT',
  WRITE_PROTOCOL_NOT_FOUND: 'WRITE_PROTOCOL_NOT_FOUND',
  WRITE_PROTOCOL_IO_FAILED: 'WRITE_PROTOCOL_IO_FAILED',
  // Agent 通道（OS-4）：没配端点/模型就发对话；上游不可达/非 2xx 不冒充模型回答。
  AGENT_NOT_CONFIGURED: 'AGENT_NOT_CONFIGURED',
  AGENT_UPSTREAM_ERROR: 'AGENT_UPSTREAM_ERROR'
})

/** 8 个端点的形状合同。`path` 不含 query；query 字段在 request.query 里单列。 */
export const ENDPOINTS = Object.freeze({
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
  entries: {
    method: 'GET',
    path: '/api/entries',
    request: {
      query: {
        root: 'string',
        layer: 'string?',
        offset: 'integer?',
        limit: 'integer?'
      }
    },
    response: { ok: 'true', entries: 'array', total: 'integer', warnings: 'array' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY']
  },
  entry: {
    method: 'GET',
    path: '/api/entry',
    request: { query: { root: 'string', id: 'string' } },
    response: { ok: 'true', entry: 'object', revision: 'integer' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  chapterGet: {
    method: 'GET',
    path: '/api/chapter',
    request: { query: { root: 'string', file: 'string' } },
    response: { ok: 'true', name: 'string', text: 'string', chars: 'integer' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  chapterPut: {
    method: 'PUT',
    path: '/api/chapter',
    request: { body: { root: 'string', file: 'string', text: 'string' } },
    response: { ok: 'true', chars: 'integer', savedAt: 'string', backup: 'string?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  wiki: {
    method: 'GET',
    path: '/api/wiki',
    request: { query: { root: 'string', bookId: 'string' } },
    response: { ok: 'true', wiki: 'object?', derivedFrom: 'object?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  wikiDerive: {
    method: 'POST',
    path: '/api/wiki/derive',
    request: { body: { root: 'string', bookId: 'string', operationId: 'string' } },
    response: { ok: 'true', wiki: 'object?', derivedFrom: 'object?', revision: 'integer?', duplicate: 'boolean?' },
    errors: [
      'NO_LIBRARY',
      'PATH_ESCAPE',
      'INVALID_ENTRY',
      'NOT_FOUND',
      'REVISION_MISMATCH',
      'WRITE_PROTOCOL_OPERATION_ID_REQUIRED',
      'WRITE_PROTOCOL_VALIDATION_FAILED',
      'WRITE_PROTOCOL_INVALID_INPUT',
      'WRITE_PROTOCOL_IO_FAILED'
    ]
  },
  agentConfigGet: {
    method: 'GET',
    path: '/api/agent/config',
    request: { query: {} },
    // 凭据红线：apiKeyMasked 只有尾号掩码，完整 key 永不出 daemon。
    // runtime＝活动运行时套件 id（空＝Pi 兜底）。
    response: {
      ok: 'true',
      configured: 'boolean',
      endpoint: 'string?',
      model: 'string?',
      apiKeyMasked: 'string?',
      runtime: 'string?',
      configPath: 'string'
    },
    errors: []
  },
  agentConfigPut: {
    method: 'PUT',
    path: '/api/agent/config',
    // 字段缺省＝保留原值；空串＝清除（endpoint 清空即回到未配置）。
    request: { body: { endpoint: 'string?', model: 'string?', apiKey: 'string?', runtime: 'string?' } },
    response: {
      ok: 'true',
      configured: 'boolean',
      endpoint: 'string?',
      model: 'string?',
      apiKeyMasked: 'string?',
      runtime: 'string?',
      configPath: 'string'
    },
    errors: ['INVALID_ENTRY']
  },
  agentRuntimesGet: {
    method: 'GET',
    path: '/api/agent/runtimes',
    // 运行时货架：Pi 兜底（内置）＋各 kit（内置/本机目录）。status：ready/idle/running/unconfigured；
    // userDir＝本机套件目录（设置页展示）。
    request: { query: {} },
    response: { ok: 'true', active: 'string?', runtimes: 'array', userDir: 'string?' },
    errors: []
  },
  agentRuntimePut: {
    method: 'PUT',
    path: '/api/agent/runtime',
    // 选活动运行时：id 空串/缺省＝回到 Pi 兜底；未知 id 拒收。
    request: { body: { id: 'string?' } },
    response: { ok: 'true', active: 'string?' },
    errors: ['INVALID_ENTRY']
  },
  agentSessions: {
    method: 'GET',
    path: '/api/agent/sessions',
    request: { query: { root: 'string' } },
    response: { ok: 'true', sessions: 'array' },
    errors: ['NO_LIBRARY']
  },
  agentSessionCreate: {
    method: 'POST',
    path: '/api/agent/sessions',
    request: { body: { root: 'string', title: 'string?' } },
    response: { ok: 'true', session: 'object' },
    errors: ['NO_LIBRARY']
  },
  agentSessionGet: {
    method: 'GET',
    path: '/api/agent/session',
    request: { query: { root: 'string', id: 'string' } },
    response: { ok: 'true', session: 'object', items: 'array' },
    errors: ['NO_LIBRARY', 'NOT_FOUND']
  },
  agentSessionRename: {
    method: 'POST',
    path: '/api/agent/session/rename',
    request: { body: { root: 'string', id: 'string', title: 'string' } },
    response: { ok: 'true', session: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  agentSessionDelete: {
    method: 'DELETE',
    path: '/api/agent/session',
    request: { query: { root: 'string', id: 'string' } },
    response: { ok: 'true' },
    errors: ['NO_LIBRARY', 'NOT_FOUND']
  },
  agentChat: {
    method: 'POST',
    path: '/api/agent/chat',
    // 成功响应是 text/event-stream，不是 JSON。帧协议（daemon 自有，非上游透传）：
    //   data:{"type":"delta","text":"…"}   增量
    //   data:{"type":"done","sessionId":"…","chars":N}  结束（sessionId 在新建会话时回填给工作台）
    //   data:{"type":"error","error":{code,message}}    上游失败/中断，如实报
    // 消息由 daemon 从会话 JSONL 组装；端点/密钥只来自 daemon 本机配置，请求不带 key。
    request: {
      body: {
        root: 'string',
        sessionId: 'string?',
        content: 'string',
        model: 'string?'
      }
    },
    response: { stream: 'string' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'AGENT_NOT_CONFIGURED', 'AGENT_UPSTREAM_ERROR']
  },
  agentCardCreate: {
    method: 'POST',
    path: '/api/agent/cards',
    // 卡创建即取目标正文快照（exists/chars/sha256）——「卡创建→采纳」窗口的修订闸。
    request: { body: { root: 'string', sessionId: 'string', file: 'string', text: 'string', note: 'string?' } },
    response: { ok: 'true', card: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  agentCardAdopt: {
    method: 'POST',
    path: '/api/agent/cards/adopt',
    // 采纳＝重读正文比对快照，一致才走与 PUT /api/chapter 同一条原子写＋.history 备份。
    request: { body: { root: 'string', sessionId: 'string', id: 'string' } },
    response: { ok: 'true', card: 'object', chars: 'integer', savedAt: 'string', backup: 'string?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'REVISION_MISMATCH', 'WRITE_PROTOCOL_IO_FAILED']
  },
  agentCardReject: {
    method: 'POST',
    path: '/api/agent/cards/reject',
    request: { body: { root: 'string', sessionId: 'string', id: 'string' } },
    response: { ok: 'true', card: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  stylesGet: {
    method: 'GET',
    path: '/api/styles',
    request: { query: {} },
    // 风格包清单：内置目录＋本机目录合并（本机按 id 覆盖内置）。
    response: { ok: 'true', styles: 'array', warnings: 'array' },
    errors: []
  },
  wikiHtmlGet: {
    method: 'GET',
    path: '/api/wiki/html',
    // 成功响应是 text/html 文档本身（内联 CSS＋CSP default-src 'none'），不是 JSON 包络；
    // wiki 数据仍走 GET /api/wiki（「数据」对照态用）。色参只收 #rgb/#rrggbb。
    request: {
      query: {
        root: 'string',
        bookId: 'string',
        accent: 'string?',
        bg: 'string?',
        ink: 'string?'
      }
    },
    response: { html: 'string' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
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
  filesGet: {
    method: 'GET',
    path: '/api/files',
    // 列库内文件：无 dir＝顶层扫描（dirs＋files）；带 dir（单段目录名）＝递归文本文件清单
    // （深度≤3，跳过 .pinax/.history/隐藏，只收 md/txt/markdown/json，≤500 个）。
    // 读/写文件本体仍走 GET/PUT /api/chapter（任何库内文本路径都通）。
    request: { query: { root: 'string', dir: 'string?' } },
    response: { ok: 'true', dirs: 'array?', files: 'array', warnings: 'array?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  chaptersGet: {
    method: 'GET',
    path: '/api/chapters',
    // 章节清单：文件名 NNN-标题.md／第N章… 解析（parseChapterNumber 同源），无号=null 排尾，字数现算。
    request: { query: { root: 'string', dir: 'string' } },
    response: { ok: 'true', chapters: 'array', warnings: 'array?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY']
  },
  chaptersCreate: {
    method: 'POST',
    path: '/api/chapters',
    // 新建章节：自动下一号（最大+1 三位补零）＋标题安全化；title 缺省时由写作套件的
    // 「新建章节默认标题」补（套件停用且无标题＝拒绝）；目录不存在自动建；空文件落盘。
    request: { body: { root: 'string', dir: 'string', title: 'string?' } },
    response: { ok: 'true', chapter: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  chaptersRename: {
    method: 'POST',
    path: '/api/chapters/rename',
    // 保号重命名：只换标题段；目标已存在拒绝。
    request: { body: { root: 'string', file: 'string', title: 'string' } },
    response: { ok: 'true', chapter: 'object', previousFile: 'string?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  chapterDelete: {
    method: 'DELETE',
    path: '/api/chapter',
    // 非破坏删除：挪进同目录 .history/<file>.deleted-<时间戳>。
    request: { query: { root: 'string', file: 'string' } },
    response: { ok: 'true', backup: 'string' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  artifactsGet: {
    method: 'GET',
    path: '/api/artifacts',
    // 产物中心的全库只读盘点：按顶层目录分组的文本文件清单（深度≤3，跳过 .pinax/隐藏，≤1000 个）
    // ＋版本与历史（groups[].history：.history/ 的 bak/deleted 档按原文件归组）＋totals（files/bytes/histories）。
    // 只看不写——写归各工作面；恢复版本＝客户端 GET 历史档＋PUT 原文件（chapter 通道）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', groups: 'array', totals: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY']
  },
  genresGet: {
    method: 'GET',
    path: '/api/genres',
    // 体裁货架（openstory-genre@1）：六类内置（前三类 tier=primary），本机 genres/ 可覆盖或新增形制。
    request: { query: {} },
    response: { ok: 'true', genres: 'array', warnings: 'array?' },
    errors: []
  },
  briefGet: {
    method: 'GET',
    path: '/api/brief',
    // 项目简报（openstory-brief@1）：<库根>/.openstory/brief.json。未声明＝brief:null（不报错）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', brief: 'object?', genre: 'object?', path: 'string' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },
  briefPut: {
    method: 'PUT',
    path: '/api/brief',
    // 声明项目体裁与篇幅（一等约束）：体裁必须进货架；篇幅明显越界或分章缺每章目标＝400。
    request: { body: { root: 'string', genre: 'string', deliverables: 'array?', length: 'object?' } },
    response: { ok: 'true', brief: 'object', genre: 'object?', path: 'string' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },
  suitesGet: {
    method: 'GET',
    path: '/api/suites',
    // 业务套件（插件）货架：版本/归属/域/启停/按 schema 归一的当前值。套件不常驻——停用＝规则退回默认。
    // userDir＝本机套件目录（设置页展示）。
    request: { query: {} },
    response: { ok: 'true', suites: 'array', userDir: 'string?', warnings: 'array?' },
    errors: []
  },
  suiteSettingsPut: {
    method: 'PUT',
    path: '/api/suite/settings',
    // 保存某套件的设置值：按 manifest settings schema 校验（未知键丢弃，坏值 400）。
    request: { body: { id: 'string', values: 'object' } },
    response: { ok: 'true', values: 'object' },
    errors: ['INVALID_ENTRY']
  },
  suiteStatePut: {
    method: 'PUT',
    path: '/api/suite/state',
    // 启停（非常驻开关）：停用不清值——套件的规则退回内置默认，值保留。
    request: { body: { id: 'string', enabled: 'boolean' } },
    response: { ok: 'true', enabled: 'boolean' },
    errors: ['INVALID_ENTRY']
  },
  suiteStateDataGet: {
    method: 'GET',
    path: '/api/suite/state-data',
    // page 模式套件的原始配置读取（值＝任意 JSON 对象，宿主不校验形状——形状归套件自己的设置页）。
    request: { query: { id: 'string' } },
    response: { ok: 'true', id: 'string', values: 'object' },
    errors: ['INVALID_ENTRY']
  },
  agentRuntimeSetup: {
    method: 'POST',
    path: '/api/agent/runtime/setup',
    // 一键修复（od 口径：Setup is always explicit on the first incompatible selection）：
    // 只在作者显式触发时建 profile / 装 runtime 组件；不静默改动 Harness 设置。
    request: { body: { id: 'string', runtimeTarball: 'string?' } },
    response: { ok: 'true', state: 'string', steps: 'array', message: 'string?' },
    errors: ['INVALID_ENTRY']
  },
  suiteStateDataPut: {
    method: 'PUT',
    path: '/api/suite/state-data',
    // page 模式套件的原始配置保存（整对象替换）。宿主只存；形状归套件。
    request: { body: { id: 'string', values: 'object' } },
    response: { ok: 'true', values: 'object' },
    errors: ['INVALID_ENTRY']
  }
})

export const ENDPOINT_LIST = Object.freeze(Object.values(ENDPOINTS))

/** 方法＋路径 → 端点 id；容忍结尾斜杠。找不到给 null（daemon 回 404）。 */
export function endpointFor(method, pathname) {
  const wantedMethod = String(method ?? '').toUpperCase()
  const wantedPath = String(pathname ?? '').replace(/\/+$/u, '') || '/'
  for (const [id, endpoint] of Object.entries(ENDPOINTS)) {
    if (endpoint.method === wantedMethod && endpoint.path === wantedPath) return id
  }
  return null
}

export function isPlainObject(value) {
  return Object.prototype.toString.call(value) === '[object Object]'
}

function text(value) {
  return String(value ?? '')
}

function isMissing(value) {
  return value === undefined || value === null || (typeof value === 'string' && value.trim() === '')
}

/** 将 query 里的数字串规整成数字；非法就保持原值交给类型校验报错。 */
function coerceType(type, value) {
  if (type === 'integer' || type === 'number') {
    if (typeof value !== 'string' || value.trim() === '') return value
    const number = Number(value)
    return Number.isFinite(number) ? number : value
  }
  return value
}

function checkOne(type, value, field, errors) {
  let kind = type
  let optional = false
  if (kind.endsWith('?')) {
    optional = true
    kind = kind.slice(0, -1)
  }
  if (isMissing(value)) {
    if (!optional) errors.push({ field, message: `${field} 必填（${type}）` })
    return
  }
  switch (kind) {
    case 'true':
      if (value !== true) errors.push({ field, message: `${field} 必须是 true` })
      return
    case 'string':
      if (typeof value !== 'string') errors.push({ field, message: `${field} 必须是字符串` })
      return
    case 'integer':
      if (!Number.isSafeInteger(value)) errors.push({ field, message: `${field} 必须是整数` })
      return
    case 'number':
      if (typeof value !== 'number' || !Number.isFinite(value)) errors.push({ field, message: `${field} 必须是数字` })
      return
    case 'boolean':
      if (typeof value !== 'boolean') errors.push({ field, message: `${field} 必须是布尔值` })
      return
    case 'object':
      if (!isPlainObject(value)) errors.push({ field, message: `${field} 必须是对象` })
      return
    case 'array':
      if (!Array.isArray(value)) errors.push({ field, message: `${field} 必须是数组` })
      return
    case 'messages':
      if (!Array.isArray(value) || value.length === 0) {
        errors.push({ field, message: `${field} 必须是非空消息数组` })
        return
      }
      value.forEach((item, index) => {
        if (!isPlainObject(item) || typeof item.role !== 'string' || typeof item.content !== 'string') {
          errors.push({ field: `${field}[${index}]`, message: '每条消息必须是 { role:string, content:string }' })
        }
      })
      return
    default:
      errors.push({ field, message: `${field} 的契约类型 ${type} 未定义` })
  }
}

function validateShape(shape, input, errors, options = {}) {
  const value = isPlainObject(input) ? input : {}
  for (const [field, type] of Object.entries(shape)) {
    const given = options.coerce ? coerceType(type.replace(/\?$/u, ''), value[field]) : value[field]
    checkOne(type, given, field, errors)
    if (options.coerce) value[field] = given
  }
  return value
}

/**
 * 请求校验：query 端点允许全是字符串（HTTP query 本来就是字符串），会把 integer 规整成数字；
 * body 端点按 JSON 原类型校验。返回 `{ ok, errors, value }`，value 是规整后的副本。
 */
export function validateRequest(endpointId, input = {}) {
  const endpoint = ENDPOINTS[endpointId]
  if (!endpoint) return { ok: false, errors: [{ field: 'endpoint', message: `未知端点 ${endpointId}` }], value: {} }
  const errors = []
  if (endpoint.request.query) {
    const value = validateShape(endpoint.request.query, input, errors, { coerce: true })
    return { ok: errors.length === 0, errors, value }
  }
  const value = validateShape(endpoint.request.body, input, errors)
  return { ok: errors.length === 0, errors, value }
}

/** 响应校验：daemon 发出去之前、测试断言形状时共用。 */
export function validateResponse(endpointId, payload = {}) {
  const endpoint = ENDPOINTS[endpointId]
  if (!endpoint) return { ok: false, errors: [{ field: 'endpoint', message: `未知端点 ${endpointId}` }] }
  const errors = []
  validateShape(endpoint.response, payload, errors)
  return { ok: errors.length === 0, errors }
}

/** 失败载荷（daemon 与测试共用一套形状）。 */
export function errorEnvelope(code, message, details) {
  const error = { code: String(code), message: text(message) }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

/** 库记录规整：recentProjects 只保底 path，其余字段缺了就补人话默认值。 */
export function normalizeLibraryRecord(value) {
  if (!isPlainObject(value)) return null
  const path = text(value.path).trim()
  if (!path) return null
  const fallbackName = path.replace(/[\\/]+$/u, '').split(/[\\/]/u).pop() || path
  return {
    path,
    name: text(value.name).trim() || fallbackName,
    kind: text(value.kind).trim() || '未分类',
    count: Number.isSafeInteger(Number(value.count)) && Number(value.count) >= 0 ? Number(value.count) : 0,
    at: text(value.at).trim()
  }
}

/** 清单规整：坏条跳过、按路径去重（Windows 大小写不敏感），保留先出现的（即较新的）。 */
export function normalizeLibraries(raw) {
  const libraries = []
  const warnings = []
  if (!Array.isArray(raw)) return { libraries, warnings }
  const seen = new Set()
  raw.forEach((item, index) => {
    const record = normalizeLibraryRecord(item)
    if (!record) {
      warnings.push({ code: 'LIBRARY_ENTRY_SKIPPED', index, message: '库里有一条记录没有 path，已跳过' })
      return
    }
    const key = record.path.replaceAll('\\', '/').replace(/\/+$/u, '').toLowerCase()
    if (seen.has(key)) {
      warnings.push({ code: 'LIBRARY_ENTRY_DUPLICATE', path: record.path, message: '同一路径重复登记，保留先出现的一条' })
      return
    }
    seen.add(key)
    libraries.push(record)
  })
  return { libraries, warnings }
}
