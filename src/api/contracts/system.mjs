/**
 * OpenStory API 契约——系统域（全局设置与连通性探测/健康端点/目录与文件浏览/产物盘点/任务中心/习惯与简报与知识库/界面状态/识图）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的system域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const systemEndpoints = {
  configGet: {
    method: 'GET',
    path: '/api/config',
    // 全局配置聚合读（S4）：text（对话）/ image（生图）/ vision（识图）/ agent（默认档）四块。
    // 凭据红线：只回 apiKeyMasked 尾号，完整 key 永不出 daemon。
    // 读旧格式（顶层 endpoint/model/apiKey）时自动迁移到 text.*，并写回新格式。
    request: { query: {} },
    response: {
      ok: 'true',
      text: 'object',
      image: 'object',
      vision: 'object',
      agent: 'object',
      configPath: 'string'
    },
    errors: []
  },

  configPut: {
    method: 'PUT',
    path: '/api/config',
    // 分块写：body 只传要改的块（text/image/vision/agent），块内字段缺省＝保留原值、空串＝清除。
    // 未知键丢弃（与套件设置同口径）；坏类型 400。
    request: { body: { text: 'object?', image: 'object?', vision: 'object?', agent: 'object?' } },
    response: {
      ok: 'true',
      text: 'object',
      image: 'object',
      vision: 'object',
      agent: 'object',
      configPath: 'string'
    },
    errors: ['INVALID_ENTRY']
  },

  configProbe: {
    method: 'POST',
    path: '/api/config/probe',
    // 可行性校验：真发一个最小请求（text=chat/completions max_tokens:1；image=images/generations
    // 一张 256x256 小图——会真花钱；vision=内联 8×8 红色 PNG 问颜色）。
    // 15 秒超时；连不上/超时都回 reachable:false，不抛。overrides＝用未保存的块值试连。
    request: { body: { kind: 'string', overrides: 'object?' } },
    response: { ok: 'true', kind: 'string', reachable: 'boolean', latencyMs: 'number', model: 'string?', detail: 'string?', error: 'string?' },
    errors: ['INVALID_ENTRY']
  },

  fsBrowse: {
    method: 'POST',
    path: '/api/fs/browse',
    // 目录浏览（OS-110 兜底）：无桌面环境时前端自建选择器用。空 path＝默认根
    // （OS-119：%USERPROFILE%/OpenStory，不存在自动创建；建不出才退列盘符）；
    // 给了 path＝列子目录（只回目录，不回文件）。remember:true 才记忆这次选的目录。
    request: { body: { path: 'string?', remember: 'boolean?' } },
    response: {
      ok: 'true', path: 'string', parent: 'string?', entries: 'array',
      isDefaultRoot: 'boolean?', defaultRoot: 'string?', lastPicked: 'string?'
    },
    errors: ['NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },

  filesGet: {
    method: 'GET',
    path: '/api/files',
    // 列库内文件：无 dir＝顶层扫描（dirs＋files）；带 dir（单段目录名）＝递归文本文件清单
    // （深度≤3，跳过 .openstory/.history/隐藏，只收 md/txt/markdown/json，≤500 个）。
    // 读/写文件本体仍走 GET/PUT /api/chapter（任何库内文本路径都通）。
    request: { query: { root: 'string', dir: 'string?' } },
    response: { ok: 'true', dirs: 'array?', files: 'array', warnings: 'array?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },

  jobsGet: {
    method: 'GET',
    path: '/api/jobs',
    // 全局后台任务中心（OS-80）：所有插件的长任务都登记在这里，前端悬浮球轮询它。
    // 任务不跨 daemon 重启存活（重启即清空，不留幽灵进度）。
    request: { query: { root: 'string?', kind: 'string?', state: 'string?', limit: 'string?' } },
    response: { ok: 'true', jobs: 'array', active: 'number' },
    errors: []
  },

  jobCancel: {
    method: 'POST',
    path: '/api/jobs/cancel',
    // 取消任务：置 cancelled + abort。执行器需自己响应 signal（引擎类任务每轮检查）。
    request: { body: { id: 'string' } },
    response: { ok: 'true' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'ALREADY_SETTLED']
  },

  jobsClear: {
    method: 'POST',
    path: '/api/jobs/clear',
    // 清空已终态任务（done/failed/cancelled），按 root 可选。
    request: { body: { root: 'string?' } },
    response: { ok: 'true', removed: 'number' },
    errors: []
  },

  visionDescribe: {
    method: 'POST',
    path: '/api/vision/describe',
    // 识图写作（OS-75）：读库内图片 → 调 vision provider（OpenAI 兼容 chat/completions
    // 多模态）→ 返回文学化白描。未配置 vision 时如实报。
    request: {
      body: {
        root: 'string',
        image: 'string',
        target: 'string?',
        focus: 'string?',
        habitContext: 'string?'
      }
    },
    response: { ok: 'true', text: 'string', chars: 'number', model: 'string?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'AGENT_UPSTREAM_ERROR', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  habitsGet: {
    method: 'GET',
    path: '/api/habits',
    // 习惯表（OS-57）：本库写作习惯——正向（惯用词/描述公式）＋负向（禁用词/句式/修辞）。
    // Agent 成文前必读；分析引擎的 verdict 也按它参数化。
    request: { query: { root: 'string' } },
    response: { ok: 'true', habits: 'object' },
    errors: ['NO_LIBRARY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  habitsPut: {
    method: 'PUT',
    path: '/api/habits',
    // 保存习惯表：按 schema 归一（未知键丢弃、列表去重限长）；原子写＋.history 备份。
    request: { body: { root: 'string', habits: 'object' } },
    response: { ok: 'true', habits: 'object', backup: 'string?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  dirCreate: {
    method: 'POST',
    path: '/api/dir',
    // 新建库内顶层目录（页签栏「＋」用）：单段目录名，禁路径分隔符与保留目录；
    // 已存在＝幂等成功（幂等不报错，前端刷新目录清单即可）。不写任何文件。
    request: { body: { root: 'string', name: 'string' } },
    response: { ok: 'true', name: 'string', created: 'boolean' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },

  artifactsGet: {
    method: 'GET',
    path: '/api/artifacts',
    // 产物的全库只读盘点：按顶层目录分组的文本文件清单（深度≤3，跳过 .openstory/隐藏，≤1000 个）
    // ＋版本与历史（groups[].history：.history/ 的 bak/deleted 档按原文件归组）＋totals（files/bytes/histories）。
    // 只看不写——写归各工作面；恢复版本＝客户端 GET 历史档＋PUT 原文件（chapter 通道）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', groups: 'array', totals: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  kbStatusGet: {
    method: 'GET',
    path: '/api/kb/status',
    // KB-ARCH P1：知识库状态聚合——WeKnora/embedding 健康灯＋六库文档数/解析状态。KB 未配置时 configured=false 降级，不报错。
    // OS-146：root 可选——带上就按该库的模块开关判定（多库时不再被「另一个库停用了 kb」误拦）；不带＝daemon 兜底。
    request: { query: { root: 'string?' } },
    response: { ok: 'true', configured: 'boolean', backend: 'string?', configPath: 'string', configError: 'string?', services: 'object', lastCheck: 'string?', collections: 'array' },
    errors: ['MODULE_DISABLED', 'PLUGIN_DEGRADED']
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

  kbConfigGet: {
    method: 'GET',
    path: '/api/kb/config',
    // OS-97：读知识库配置（apiKey 掩码返回，不回明文）
    // OS-146：root 可选——模块闸按该库判定（同 kbStatusGet）
    request: { query: { root: 'string?' } },
    response: { ok: 'true', config: 'object', configPath: 'string', masked: 'boolean' },
    errors: ['MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  kbConfigPut: {
    method: 'PUT',
    path: '/api/kb/config',
    // OS-97：写知识库配置（backend/baseUrl/apiKey/collections），写后立即重探服务
    // apiKey 传 '__KEEP__' 表示保留原值（前端不改密钥时不回传明文）
    // OS-146：root 可选——模块闸按该库判定（多库时不被别的库的停用误拦）
    request: { body: { root: 'string?', backend: 'string?', baseUrl: 'string?', apiKey: 'string?', spaceId: 'string?', collections: 'object?' } },
    response: { ok: 'true', status: 'object' },
    errors: ['INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  kbTest: {
    method: 'POST',
    path: '/api/kb/test',
    // OS-97：连接测试——用当前配置探一次 WeKnora + embedding，返回逐项结果（不写盘）
    // OS-146：root 可选——模块闸按该库判定（同 kbConfigPut）
    request: { body: { root: 'string?', baseUrl: 'string?', apiKey: 'string?' } },
    response: { ok: 'true', weknora: 'object', embedding: 'object', collections: 'array' },
    errors: ['MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  uiStateGet: {
    method: 'GET',
    path: '/api/ui-state',
    // OS-89：界面状态落库内（.openstory/ui-state.json），不再用浏览器 localStorage。
    // 换机器 / 清缓存后重新打开库必须完全复原（AGENTS.md 第 8 条）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', state: 'object' },
    errors: ['NO_LIBRARY']
  },

  uiStatePut: {
    method: 'PUT',
    path: '/api/ui-state',
    // 整对象合并写（浅合并，undefined 不覆盖）。原子写 + .history 备份。
    request: { body: { root: 'string', state: 'object' } },
    response: { ok: 'true', state: 'object', backup: 'string?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED', 'CAPABILITY_MISSING', 'CAPABILITY_CONFLICT', 'CAPABILITY_IN_USE', 'OVERRIDE_REJECTED']
  },

  uiPreferencesGet: {
    method: 'GET',
    path: '/api/ui-preferences',
    // OS-158：机器级界面偏好（当前只有皮肤）——落本机院子 ui-preferences.json，不随库走、
    // 不进浏览器存储。任何端口打开同一项目读同一份；文件缺失/坏档回空对象（前端取缺省皮肤）。
    request: { query: {} },
    response: { ok: 'true', preferences: 'object', path: 'string' },
    errors: []
  },

  uiPreferencesPut: {
    method: 'PUT',
    path: '/api/ui-preferences',
    // OS-158：写机器级界面偏好（皮肤）。skin 空＝清除回缺省；未知键丢弃；原子写。
    request: { body: { skin: 'string?' } },
    response: { ok: 'true', preferences: 'object', path: 'string' },
    errors: ['INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },

  healthGet: {
    method: 'GET',
    path: '/api/health',
    // OS-127 进程治理（对标 @open-design/sidecar 最小集）：免 root 授权的健康端点。
    // 只报 daemon 进程自身的事实（pid/端口/代际/启动时刻/存活时长），不碰任何库文件，
    // 也不回库路径——前端与外部探针同源探测「daemon 活着＋连的是第几代」
    // （OS-93 事故：多 daemon 竞听 8807，页面拿到混合包；generation 让旧代可被识别）。
    request: { query: {} },
    // OS-204：appVersion 取自 package.json，daemon 启动时读一次；其余进程事实字段不动。
    response: { ok: 'true', pid: 'integer', port: 'integer', generation: 'integer', startedAt: 'string', uptimeMs: 'integer', appVersion: 'string' },
    errors: []
  }
}
