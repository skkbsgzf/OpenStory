/**
 * OpenStory API 契约——Agent 域（模型配置/运行时货架与 kit 安装/会话/对话流/采纳卡/风格选择链）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的agent域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const agentEndpoints = {
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
    // reasoningEffort：DSH 的 reasoning_effort（low/medium/high…），空＝用 DSH 自己的默认档。
    // chineseReasoning：让模型用中文推理（默认 true）——中文写作讨论更贴题，代价是可能损失部分推理性能。
    request: { body: { endpoint: 'string?', model: 'string?', apiKey: 'string?', runtime: 'string?', reasoningEffort: 'string?', chineseReasoning: 'boolean?' } },
    response: {
      ok: 'true',
      configured: 'boolean',
      endpoint: 'string?',
      model: 'string?',
      apiKeyMasked: 'string?',
      runtime: 'string?',
      reasoningEffort: 'string?',
      chineseReasoning: 'boolean',
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

  agentDshModelsGet: {
    method: 'GET',
    path: '/api/agent/dsh/models',
    // DSH 模型与推理深度选项（`dsh --profile <p> --models` 的解析结果，服务端缓存 5 分钟）。
    // 设置页「推理深度」下拉的选项来源；DSH 没装时如实报，不伪造列表。
    request: { query: { profile: 'string?' } },
    response: { ok: 'true', models: 'array' },
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
    //   data:{"type":"start","sessionId":"…","runtime":"…"}      开始（sessionId 回填给工作台）
    //   data:{"type":"notice","text":"…"}                        提示（降级/会话重开等）
    //   data:{"type":"thinking","text":"…"}                      推理片段（DSH；不进正文）
    //   data:{"type":"tool","phase":"call","id","name","input"}   工具调用
    //   data:{"type":"tool","phase":"result","id","output","isError"}  工具返回
    //   data:{"type":"usage","input":N,"output":N,"total":N}      本轮 token 用量
    //   data:{"type":"delta","text":"…"}                         正文增量
    //   data:{"type":"done","sessionId":"…","chars":N,"truncated"?}  结束（被长度上限截断时带 truncated）
    //   data:{"type":"error","error":{code,message}}             上游失败/中断/取消，如实报
    // 会话：sessionId 缺省＝接着该库最近一条会话；newSession:true ＝强制新开一条。
    // 消息由 daemon 从会话 JSONL 组装；端点/密钥只来自 daemon 本机配置，请求不带 key。
    request: {
      body: {
        root: 'string',
        sessionId: 'string?',
        content: 'string',
        model: 'string?',
        // ephemeral=true＝一次性调用（润笔这类工具动作）：
        // 不建会话、不落档、不出现在会话列表里，只在本次响应里回结果。
        ephemeral: 'boolean?',
        // newSession=true＝作者主动点了「＋新会话」：忽略服务端的「接着上次聊」
        newSession: 'boolean?'
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

  agentPicksGet: {
    method: 'GET',
    path: '/api/agent-picks',
    // 库级选择链（OS-70）：灯泡三级链的持久层——风格词条（单选）/方法论（多选）。
    // picks:null＋explicit:false ＝ 未做过显式选择（注入走体裁缺省裁剪）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', picks: 'object?', explicit: 'true|false' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },

  agentPicksPut: {
    method: 'PUT',
    path: '/api/agent-picks',
    // 写选择链：style 为空串＝不指定文风包；style/methods 都必须是货架上的 craft 技能。
    request: { body: { root: 'string', style: 'string', methods: 'array' } },
    response: { ok: 'true', picks: 'object', path: 'string' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
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
}
