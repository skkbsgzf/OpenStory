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
    // FACT-FIRST：写入后如实回报事实链健康度（stale=正文比事实链新），UI 据此提示重跑。
    response: { ok: 'true', chars: 'integer', savedAt: 'string', backup: 'string?', factStale: 'boolean?', factEntries: 'integer?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
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
  stylesGet: {
    method: 'GET',
    path: '/api/styles',
    request: { query: {} },
    // 风格包清单：内置目录＋本机目录合并（本机按 id 覆盖内置）。
    response: { ok: 'true', styles: 'array', warnings: 'array' },
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
  referenceGet: {
    method: 'GET',
    path: '/api/reference',
    // 参考载体索引（OS-44）：扫描 参考/ 目录，解析每篇的 frontmatter／标签／双链。
    // 不落盘（每次重建，避免两份真相）。标签清单一并返回（带计数与描述）。
    // currentChapter（OS-96）：给了＝notes 只回 firstChapter≤该章的词条（防剧透筛选）
    request: { query: { root: 'string', currentChapter: 'integer?' } },
    response: { ok: 'true', notes: 'array', tags: 'array', tagNotes: 'object', stats: 'object', filtered: 'boolean?' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE']
  },
  referenceGraphGet: {
    method: 'GET',
    path: '/api/reference/graph',
    // 参考图谱：节点=参考/标签/章节产物/条目(只读)，边权 link=2 / mention=min(n,3) / tag=1。
    // 单向原则：边只从参考出发指向产物，正文不反向进入参考的上下文。
    request: { query: { root: 'string' } },
    response: { ok: 'true', nodes: 'array', edges: 'array', tags: 'array', stats: 'object' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE']
  },
  referenceNoteGet: {
    method: 'GET',
    path: '/api/reference/note',
    // 单篇参考：返回原文＋解析后的 frontmatter／标签／双链＋双段反链（linked / unlinked）。
    request: { query: { root: 'string', path: 'string' } },
    response: { ok: 'true', note: 'object', backlinks: 'object' },
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
  factEntriesImport: {
    method: 'POST',
    path: '/api/fact/entries/import',
    // 剧本/外部数据 → 拆解条目（OS-78 首次开放 fact 写通道）。
    // 走内核 writeFactFile 的 patch.entries 整份替换（原子写＋revision 自增＋operationId 幂等）。
    // 同时写兄弟 wiki 文件（章摘要/角色档/伏笔）。
    request: {
      body: {
        root: 'string',
        bookId: 'string',
        title: 'string?',
        entries: 'array',
        wiki: 'object?',
        operationId: 'string?'
      }
    },
    response: { ok: 'true', bookId: 'string', entries: 'number', revision: 'number?', backup: 'string?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
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
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'AGENT_UPSTREAM_ERROR']
  },
  referenceAssetGet: {
    method: 'GET',
    path: '/api/reference/asset',
    // 世界书条目的图片本体（OS-75）：path 相对库根，只放行 参考/ 下图片扩展名。
    // 成功响应是二进制流（image/png 等），不是 JSON——前端 <img> 直挂。
    request: { query: { root: 'string', path: 'string' } },
    response: { ok: 'true' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'NOT_FOUND', 'INVALID_ENTRY']
  },
  referenceImageGenerate: {
    method: 'POST',
    path: '/api/reference/image',
    // 世界书条目生图（OS-75）：按条目名＋描述生成设定图，落
    // 参考/<条目目录>/assets/<条目名>.png，并把相对路径回填进该条目的 frontmatter cover/images。
    // 后端走全局配置 image 块（OpenAI 兼容 或 ComfyUI）；stylePrompt 缺省＝「2D彩漫风格」。
    request: {
      body: {
        root: 'string',
        path: 'string',
        prompt: 'string?',
        stylePrompt: 'string?',
        size: 'string?',
        kind: 'string?'
      }
    },
    response: { ok: 'true', path: 'string', imagePath: 'string', frontmatter: 'object', chars: 'number' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'AGENT_UPSTREAM_ERROR', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deduceImage: {
    method: 'POST',
    path: '/api/deduce/image',
    // 生图（OS-63 预留转正）：调全局配置 image.endpoint（OpenAI 兼容 images/generations），
    // 产物落 推演/<bookId>/素材/场景/<name>.png。未启用/未配置如实报。
    request: { body: { root: 'string', bookId: 'string?', name: 'string', prompt: 'string', size: 'string?', stylePrompt: 'string?', negative: 'string?' } },
    response: { ok: 'true', name: 'string', path: 'string', size: 'string' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'AGENT_UPSTREAM_ERROR']
  },
  habitsGet: {
    method: 'GET',
    path: '/api/habits',
    // 习惯表（OS-57）：本库写作习惯——正向（惯用词/描述公式）＋负向（禁用词/句式/修辞）。
    // Agent 成文前必读；分析引擎的 verdict 也按它参数化。
    request: { query: { root: 'string' } },
    response: { ok: 'true', habits: 'object' },
    errors: ['NO_LIBRARY']
  },
  habitsPut: {
    method: 'PUT',
    path: '/api/habits',
    // 保存习惯表：按 schema 归一（未知键丢弃、列表去重限长）；原子写＋.history 备份。
    request: { body: { root: 'string', habits: 'object' } },
    response: { ok: 'true', habits: 'object', backup: 'string?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },
  referenceAbsorb: {
    method: 'POST',
    path: '/api/reference/absorb',
    // 旧目录迁入参考（OS-48）：只接受 大纲/构思/资料/约束，逐文件搬进 参考/<原名>/。
    // 显式动稿：目标已存在＝skip 不覆盖；目标原子写＋源文件挪进 .history（.deleted-<ts>，可逆）。
    // 返回 moved（含备份路径）与 skipped（带原因），绝不自动调用——前端弹窗确认后才发。
    request: { body: { root: 'string', dirs: 'array' } },
    response: { ok: 'true', moved: 'array', skipped: 'array' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
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
  kbStatusGet: {
    method: 'GET',
    path: '/api/kb/status',
    // KB-ARCH P1：知识库状态聚合——WeKnora/embedding 健康灯＋六库文档数/解析状态。KB 未配置时 configured=false 降级，不报错。
    request: { query: {} },
    response: { ok: 'true', configured: 'boolean', backend: 'string?', configPath: 'string', configError: 'string?', services: 'object', lastCheck: 'string?', collections: 'array' },
    errors: []
  },
  factCurveGet: {
    method: 'GET',
    path: '/api/fact/curve',
    // 分析面板 fact 曲线（对齐拆解线算法）：读库内 拆解/ 的 fact+wiki，返回章级 序列/情绪/剧情点/事件数/伏笔数。
    // bookId 可选（默认取最近修改的一本）；库无拆解数据时 chapters=[] 降级，不报错。
    request: { query: { root: 'string', bookId: 'string?' } },
    response: { ok: 'true', bookId: 'string?', title: 'string?', words: 'number', chapters: 'array', foreshadows: 'array', books: 'array' },
    errors: ['INVALID_ENTRY']
  },
  factEntriesGet: {
    method: 'GET',
    path: '/api/fact/entries',
    // 条目级读（故事源的数据底座）：条目本体＋溯源，按 bookId/layer/q 过滤，服务端分页。
    // bookId 缺省＝mtime 最新的可读书（与 factCurveGet 同向）；offset 默认 0，limit 默认 100／上限 500。
    // layers＝过滤前的层计数表（前端做层筛选器）；坏档在 warnings[] 记一条，不整体失败。
    request: { query: { root: 'string', bookId: 'string?', layer: 'string?', q: 'string?', offset: 'string?', limit: 'string?' } },
    response: { ok: 'true', bookId: 'string', book: 'object?', revision: 'number', total: 'number', entries: 'array', layers: 'object', warnings: 'array?' },
    errors: ['INVALID_ENTRY', 'NOT_FOUND']
  },
  factBooksGet: {
    method: 'GET',
    path: '/api/fact/books',
    // 书目列表：拆解/ 下每本 <id>.json 的 bookId/title/revision/条目数/兄弟 wiki 有无。
    // 单本解析失败只在该书记 error 字段，其余照常返回（坏档不整体失败）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', books: 'array' },
    errors: []
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
  deducePresent: {
    method: 'POST',
    path: '/api/deduce/present',
    // 推演引擎（Pinax fact 推演链 vendor 进 core/）：开局/续拍 → 局面卡＋候选。
    // 引擎确定性（种子化 2d6）；LLM 只是「戏剧」候选可选来源。worldview 缺失＝WORLD_EMPTY 如实报。
    // seedPrompt（OS-93）＝开局选中的开头（剧情条目 definition）——戏剧候选围绕它锚定。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', pov: 'string?', seed: 'integer?', seedPrompt: 'string?', chapterLimit: 'integer?', reset: 'boolean?' } },
    response: { ok: 'true', round: 'integer', sceneCard: 'object', candidates: 'array', tension: 'object?', fronts: 'array?', budget: 'object?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },
  deduceOpeningGet: {
    method: 'GET',
    path: '/api/deduce/opening',
    // 开局三件套（OS-93，照酒馆：选角色卡 → 选世界书 → 选开头）：
    // books＝拆解书清单（世界书候选，带各类条目数）；characters＝角色卡；openings＝开头
    // （引擎摆局＋每条剧情事实一个可进入的开头，对应酒馆 alternate_greetings）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', books: 'array', characters: 'array', openings: 'array' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY']
  },
  deduceSettle: {
    method: 'POST',
    path: '/api/deduce/settle',
    // 结算一拍：作者选择候选（或 veto 等导演动作）。产出的条目交回客户端，不自动写库。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', candidateId: 'string?', action: 'string?', note: 'string?' } },
    response: { ok: 'true', action: 'string', round: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  deduceSessionGet: {
    method: 'GET',
    path: '/api/deduce/session',
    // 推演会话存储层（OS-61）：读「文游」容器（拍节点＋章缓存区＋归档清单）。
    // 无会话＝session:null（空态合法，不报错）。bookId 缺省＝拆解目录最新一本（与 present 同口径）。
    request: { query: { root: 'string', bookId: 'string?', sessionId: 'string?' } },
    response: { ok: 'true', session: 'object?', activeId: 'string?' },
    errors: ['NO_LIBRARY']
  },
  deduceSessionPut: {
    method: 'PUT',
    path: '/api/deduce/session',
    // 整存会话：归一校验（schema 必须是 openstory.deduce-session/v1、nodes 必须是数组），
    // 原子写＋推演/<bookId>/.history 备份。
    request: { body: { root: 'string', bookId: 'string?', session: 'object' } },
    response: { ok: 'true', session: 'object', backup: 'string?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deduceArchive: {
    method: 'POST',
    path: '/api/deduce/archive',
    // 归档一章：缓存区的拍整理成 markdown 写 推演/<bookId>/归档/第N章.md，
    // 记入 archived、清缓存区。无会话＝NOT_FOUND；缓存区空＝INVALID_ENTRY。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', title: 'string?' } },
    response: { ok: 'true', path: 'string', words: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deduceTurn: {
    method: 'POST',
    path: '/api/deduce/turn',
    // 推演回合层（OS-61 P2）：choiceId 走既有结算（choose）；customText 非空＝作者自定义
    // 直接结算（inject）。结算后生成这一拍的正文草稿（小说叙述体，endpoint/cli/dsh 三路），
    // 拍进会话缓存区。模型不可用＝prose:''＋proseError，不伪造。
    // regenerate:true＝只重写最后一拍的正文（覆盖 node.prose），不结算、不新增节点。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', choiceId: 'string?', customText: 'string?', regenerate: 'boolean?' } },
    // prose 用 string?：契约语义里空串＝没给，而模型不可用时 prose:'' 正是合法形状
    response: { ok: 'true', node: 'object', session: 'object', prose: 'string?', proseError: 'string?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deduceExport: {
    method: 'POST',
    path: '/api/deduce/export',
    // 导出（OS-94）：整个会话（每拍的决定＋正文＋归档清单）出 markdown，落
    // 推演/<bookId>/导出/会话-<sid>-<ts>.md。读侧动作，不改会话。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', title: 'string?' } },
    response: { ok: 'true', path: 'string', words: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deducePromote: {
    method: 'POST',
    path: '/api/deduce/promote',
    // 转正（OS-94）：把一拍的正文写进 正文/ 成正式章节——createChapter 自动下一章号＋
    // writeChapterWithBackup 备份通道。prose 为空＝拒绝（先重写或自己写完）。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', nodeId: 'string', title: 'string?' } },
    response: { ok: 'true', file: 'string', chapter: 'object', chars: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deducePendingSettle: {
    method: 'POST',
    path: '/api/deduce/pending',
    // 回填闭环（OS-82）：结算产出的 fact 条目先挂会话 pending 队列（待确认卡），
    // 作者确认后这里写进拆解——write 走内核 writeFactFile 单条 upsert（按 id 命中替换、
    // 没有就追加，绝不动别人的条目）；dismiss 只出队不落库。卡不存在＝NOT_FOUND（幂等友好）。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', pendingId: 'string', action: 'string?' } },
    response: { ok: 'true', action: 'string', session: 'object', revision: 'integer?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deduceSessionsGet: {
    method: 'GET',
    path: '/api/deduce/sessions',
    // 多局并存（OS-86）：主线（legacy session.json，哪怕还没有也占位）＋ sessions/ 全部
    // ＋激活指针。sessionId 缺省＝激活指针的口径与本表所有读端点一致。
    request: { query: { root: 'string', bookId: 'string?' } },
    response: { ok: 'true', bookId: 'string', activeId: 'string', sessions: 'array' },
    errors: ['NO_LIBRARY']
  },
  deduceSessionManage: {
    method: 'POST',
    path: '/api/deduce/session/manage',
    // 多局管理（OS-86）：new＝新建空局（title 缺省「第N局」）并激活；switch＝激活已有局；
    // delete＝非破坏删除（挪 推演/<bookId>/.deleted/sessions/）——最后一局拒删，清空走「重新开局」。
    request: { body: { root: 'string', bookId: 'string?', action: 'string', sessionId: 'string?', title: 'string?' } },
    response: { ok: 'true', action: 'string', sessionId: 'string?', session: 'object?', activeId: 'string?', sessions: 'array?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deduceBranch: {
    method: 'POST',
    path: '/api/deduce/branch',
    // 剧情树分支（OS-61 P3）：从某一拍开新分支——新 branchId、cursor 定位到该拍，
    // 分叉溯源记在分叉节点的 forkBranchIds 上。nodes 全量保留，原子写＋.history 备份。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', fromNodeId: 'string' } },
    response: { ok: 'true', session: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },
  deduceAssets: {
    method: 'GET',
    path: '/api/deduce/assets',
    // 文游素材盘点（OS-61 P4）：推演/<bookId>/素材/ 下三类可选素材——
    // 角色/<角色名>.png（立绘）、场景/<场景名>.png、bgm/<场景或情绪>.mp3。
    // 目录不存在＝三个空数组（空态合法，不报错）；每项 { name, path }，path 为库内相对路径。
    request: { query: { root: 'string', bookId: 'string?' } },
    response: { ok: 'true', bookId: 'string', characters: 'array', scenes: 'array', bgm: 'array' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE']
  },
  deduceAssetFile: {
    method: 'GET',
    path: '/api/deduce/asset',
    // 单个素材本体（OS-61 P4）：path 相对 推演/<bookId>/素材/，只放行 .png/.mp3。
    // 成功响应是二进制流（image/png 或 audio/mpeg），不是 JSON——前端 <img>/<audio> 直挂。
    request: { query: { root: 'string', bookId: 'string?', path: 'string' } },
    response: { stream: 'string' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND']
  },
  enrichRun: {
    method: 'POST',
    path: '/api/enrich/run',
    // 语义增补（FACT-FIRST 供给端）：六槽位＋因果图＋需求层级＋台账，全量重算并写旁挂 wiki。
    // 长任务（12–35 次模型调用，2–6 分钟）：立即返回 jobId，进度查 enrichStatus。
    // LLM 走活动运行时（OS-58）：endpoint / CLI / DSH 都行——clI/dsh 走一次性子进程，
    // 强制「只输出 JSON」，引擎侧有围栏与前后文容错。
    // llm 走活动 runtime kit（endpoint 型）；cli/dsh 型上游不支持，如实报错。
    request: { body: { root: 'string', bookId: 'string' } },
    response: { ok: 'true', jobId: 'string' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'LLM_UPSTREAM_UNSUPPORTED', 'ENRICH_FAILED']
  },
  enrichStatus: {
    method: 'GET',
    path: '/api/enrich/status',
    // enrich 异步 job 的进度（stage 逐窗更新）。
    request: { query: { jobId: 'string' } },
    response: { ok: 'true', jobId: 'string', state: 'string', progress: 'array', summary: 'object?', error: 'string?' },
    errors: ['NOT_FOUND']
  },
  enrichGraph: {
    method: 'GET',
    path: '/api/enrich/graph',
    // 因果图＋指标＋需求层级（FACT-FIRST 派生层读取，同步、零模型）。
    request: { query: { root: 'string', bookId: 'string' } },
    response: { ok: 'true', bookId: 'string', causalGraph: 'object?', metrics: 'object?', needs: 'array', slots: 'object?', ledger: 'object?', failures: 'array' },
    errors: ['NO_LIBRARY', 'NOT_FOUND', 'ENRICH_GRAPH_FAILED']
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
  },
  changeLogGet: {
    method: 'GET',
    path: '/api/log',
    // OS-89：模块自检索变更日志（AGENTS.md 第 10 条）。
    // 每个模块加载时调一次，拿自己相关的近期修改（含 unified diff）。
    // module 缺省＝跨模块概览；file 缺省＝该模块全部文件。
    request: { query: { root: 'string', module: 'string?', file: 'string?', limit: 'string?' } },
    response: { ok: 'true', entries: 'array', truncated: 'boolean' },
    errors: ['NO_LIBRARY']
  },
  changeLogSummary: {
    method: 'GET',
    path: '/api/log/summary',
    // 每模块最近一条变更（库总览用）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', modules: 'array' },
    errors: ['NO_LIBRARY']
  },
  changeLogEntry: {
    method: 'GET',
    path: '/api/log/entry',
    // OS-90：读单条变更的完整记录（含完整 diff）——日志卡点开就用它。
    request: { query: { root: 'string', module: 'string', at: 'string', afterHash: 'string' } },
    response: { ok: 'true', entry: 'object' },
    errors: ['NO_LIBRARY', 'NOT_FOUND']
  },
  changeLogRestore: {
    method: 'POST',
    path: '/api/log/restore',
    // OS-90：把某个文件恢复到某次变更之前的状态。
    // 先给当前内容做一次备份（保证这次恢复本身也可回退），再从该次变更记下的 backup 拷回。
    request: { body: { root: 'string', module: 'string', at: 'string', afterHash: 'string' } },
    response: { ok: 'true', file: 'string', restoredFrom: 'string', safetyBackup: 'string?' },
    errors: ['NO_LIBRARY', 'NOT_FOUND', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },
  uiStateGet: {
    method: 'GET',
    path: '/api/ui-state',
    // OS-89：界面状态落库内（.pinax/ui-state.json），不再用浏览器 localStorage。
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
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },
  draftGet: {
    method: 'GET',
    path: '/api/draft',
    // OS-89：未保存的编辑草稿落库内 .pinax/drafts/<module>/<id>.json。
    // 作者还没点保存的内容也必须落本地（AGENTS.md 第 11 条）。
    request: { query: { root: 'string', module: 'string', id: 'string?' } },
    response: { ok: 'true', draft: 'object?', drafts: 'array?' },
    errors: ['NO_LIBRARY']
  },
  draftPut: {
    method: 'PUT',
    path: '/api/draft',
    // 存草稿：给 module＋id 就 upsert；给 module 不给 id 就列全部（见 draftGet）。
    // 删除＝text 传空且 delete:true。
    request: { body: { root: 'string', module: 'string', id: 'string', text: 'string?', meta: 'object?', delete: 'boolean?' } },
    response: { ok: 'true', draft: 'object?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
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
