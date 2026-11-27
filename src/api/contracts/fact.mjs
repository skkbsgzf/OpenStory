/**
 * OpenStory API 契约——事实域（故事源条目与曲线/推演文游/扮演/语义增补/原生选择器与资源管理器）（OS-130 契约分域）。
 *
 * 本文件是仓根 contracts.mjs 的fact域分片：只含本域端点形状，条目自 contracts.mjs
 * 逐字迁入（路径/method/请求响应形状/错误码未动一字）。纯数据零依赖——不 import 任何模块。
 * 聚合（ENDPOINTS/ENDPOINT_LIST）、错误码词表（API_ERROR_CODES）与校验函数
 * （endpointFor/validateRequest/validateResponse/errorEnvelope/normalize*）仍在仓根 contracts.mjs。
 * 改本域端点的形状只改这里，聚合入口自动跟随，daemon 与测试无感。
 */
export const factEndpoints = {
  nativeReveal: {
    method: 'POST',
    path: '/api/native/reveal',
    // 在资源管理器里打开路径（OS-109）：文件夹＝打开；文件＝选中它。路径不存在如实报 NOT_FOUND。
    request: { body: { path: 'string' } },
    response: { ok: 'true' },
    errors: ['INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED']
  },

  nativePick: {
    method: 'POST',
    path: '/api/native/pick',
    // 原生文件/文件夹选择器（OS-108）：浏览器拿不到绝对路径，daemon 弹 Windows 原生对话框。
    // kind=folder（默认）/file；取消＝200 + ok:false + code:CANCELLED（前端静默）。
    request: { body: { kind: 'string?', title: 'string?', initialDir: 'string?', filter: 'string?' } },
    response: { ok: 'true', path: 'string' },
    errors: ['INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED']
  },

  factEntriesImport: {
    method: 'POST',
    path: '/api/fact/entries/import',
    // 剧本/外部数据 → 故事源条目（OS-78 首次开放 fact 写通道）。
    // 走内核 writeFactFile 的 patch.entries 整份替换（原子写＋revision 自增＋operationId 幂等）。
    // OS-211：patch.entries 逐条过 validateFactEntry——任一条有 errors 整份拒绝、零写入
    // （WRITE_PROTOCOL_VALIDATION_FAILED → 422，details.entries 逐条点名 index/id/errors）；
    // 兄弟 wiki 的 derivedFrom.factRevision 与写完后的主档 revision 一致。
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
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_VALIDATION_FAILED', 'WRITE_PROTOCOL_IO_FAILED']
  },

  deduceImage: {
    method: 'POST',
    path: '/api/deduce/image',
    // 生图（OS-63 预留转正）：调全局配置 image.endpoint（OpenAI 兼容 images/generations），
    // 产物落 扮演/<bookId>/素材/场景/<name>.png。未启用/未配置如实报。
    request: { body: { root: 'string', bookId: 'string?', name: 'string', prompt: 'string', size: 'string?', stylePrompt: 'string?', negative: 'string?' } },
    response: { ok: 'true', name: 'string', path: 'string', size: 'string' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'AGENT_UPSTREAM_ERROR', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  factCurveGet: {
    method: 'GET',
    path: '/api/fact/curve',
    // 分析面板 fact 曲线（对齐故事源线算法）：读库内 故事源/ 的 fact+wiki，返回章级 序列/情绪/剧情点/事件数/伏笔数。
    // bookId 可选（默认取最近修改的一本）；库无故事源数据时 chapters=[] 降级，不报错。
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
    // FACT_EMPTY（OS-150a）＝故事源/ 下一本书都没有——合法空态，故事源页据此摆引导空态。
    // FACT_UNREADABLE（OS-150b）＝有档但全部读不出来（坏档），details.books 逐本给 bookId/file/error——
    // 这是「档坏了」不是「还没有」，前端必须显示告警而不是引导空态。
    request: { query: { root: 'string', bookId: 'string?', layer: 'string?', q: 'string?', offset: 'string?', limit: 'string?' } },
    response: { ok: 'true', bookId: 'string', book: 'object?', revision: 'number', total: 'number', entries: 'array', layers: 'object', warnings: 'array?' },
    errors: ['INVALID_ENTRY', 'NOT_FOUND', 'FACT_EMPTY', 'FACT_UNREADABLE']
  },

  factBooksGet: {
    method: 'GET',
    path: '/api/fact/books',
    // 书目列表：故事源/ 下每本 <id>.json 的 bookId/title/revision/条目数/兄弟 wiki 有无。
    // 单本解析失败只在该书记 error 字段，其余照常返回（坏档不整体失败）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', books: 'array' },
    errors: []
  },

  deducePresent: {
    method: 'POST',
    path: '/api/deduce/present',
    // 推演引擎（本仓自持的确定性 fact 推演链）：开局/续拍 → 局面卡＋候选。
    // 引擎确定性（种子化 2d6）；LLM 只是「戏剧」候选可选来源。worldview 缺失＝WORLD_EMPTY 如实报。
    // seedPrompt（OS-93）＝开局选中的开头（剧情条目 definition）——戏剧候选围绕它锚定。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', pov: 'string?', seed: 'integer?', seedPrompt: 'string?', chapterLimit: 'integer?', reset: 'boolean?', rules: 'object?' } },
    response: { ok: 'true', round: 'integer', sceneCard: 'object', candidates: 'array', tension: 'object?', fronts: 'array?', budget: 'object?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceOpeningGet: {
    method: 'GET',
    path: '/api/deduce/opening',
    // 开局三件套（OS-93，照酒馆：选角色卡 → 选世界书 → 选开头）：
    // books＝故事源书清单（世界书候选，带各类条目数）；characters＝角色卡；openings＝开头
    // （引擎摆局＋每条剧情事实一个可进入的开头，对应酒馆 alternate_greetings）。
    request: { query: { root: 'string' } },
    response: { ok: 'true', books: 'array', characters: 'array', openings: 'array' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceSettle: {
    method: 'POST',
    path: '/api/deduce/settle',
    // 结算一拍：作者选择候选（或 veto 等导演动作）。产出的条目交回客户端，不自动写库。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', candidateId: 'string?', action: 'string?', note: 'string?' } },
    response: { ok: 'true', action: 'string', round: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceSessionGet: {
    method: 'GET',
    path: '/api/deduce/session',
    // 推演会话存储层（OS-61）：读「文游」容器（拍节点＋章缓存区＋归档清单）。
    // 无会话＝session:null（空态合法，不报错）。bookId 缺省＝故事源目录最新一本（与 present 同口径）。
    request: { query: { root: 'string', bookId: 'string?', sessionId: 'string?' } },
    response: { ok: 'true', session: 'object?', activeId: 'string?' },
    errors: ['NO_LIBRARY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceSessionPut: {
    method: 'PUT',
    path: '/api/deduce/session',
    // 整存会话：归一校验（schema 必须是 openstory.deduce-session/v1、nodes 必须是数组），
    // 原子写＋扮演/<bookId>/.history 备份。
    request: { body: { root: 'string', bookId: 'string?', session: 'object' } },
    response: { ok: 'true', session: 'object', backup: 'string?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceArchive: {
    method: 'POST',
    path: '/api/deduce/archive',
    // 归档一章：缓存区的拍整理成 markdown 写 扮演/<bookId>/归档/第N章.md，
    // 记入 archived、清缓存区。无会话＝NOT_FOUND；缓存区空＝INVALID_ENTRY。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', title: 'string?' } },
    response: { ok: 'true', path: 'string', words: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
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
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  roleplayOpeningGet: {
    method: 'POST',
    path: '/api/roleplay/opening',
    // 扮演开场（OS-100）：主持人替世界拉开第一幕——时间/地点/在场/第一眼看见什么＋三条初始分支。
    request: { body: { root: 'string', bookId: 'string?', pov: 'string', premise: 'string?', openingDetail: 'string?', chapterLimit: 'integer?' } },
    response: { ok: 'true', feedback: 'string', options: 'array' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  roleplayTurn: {
    method: 'POST',
    path: '/api/roleplay/turn',
    // 扮演一回合（OS-97）：主持人裁决（谁登场＋本幕指令）→ N 角色各自独立成文 →
    // 主持人收束成对「你」说话的世界反馈。世界书按 chapterLimit 过滤（OS-96）。
    // 会话复用 deduceSession 扮演容器（beats 随节点存）。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', pov: 'string', playerAction: 'string', premise: 'string?', chapterLimit: 'integer?', activation: 'string?' } },
    response: { ok: 'true', beats: 'array', feedback: 'string', options: 'array', node: 'object?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceExport: {
    method: 'POST',
    path: '/api/deduce/export',
    // 导出（OS-94）：整个会话（每拍的决定＋正文＋归档清单）出 markdown，落
    // 扮演/<bookId>/导出/会话-<sid>-<ts>.md。读侧动作，不改会话。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', title: 'string?' } },
    response: { ok: 'true', path: 'string', words: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deducePromote: {
    method: 'POST',
    path: '/api/deduce/promote',
    // 转正（OS-94）：把一拍的正文写进 正文/ 成正式章节——createChapter 自动下一章号＋
    // writeChapterWithBackup 备份通道。prose 为空＝拒绝（先重写或自己写完）。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', nodeId: 'string', title: 'string?' } },
    response: { ok: 'true', file: 'string', chapter: 'object', chars: 'integer' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deducePendingSettle: {
    method: 'POST',
    path: '/api/deduce/pending',
    // 回填闭环（OS-82）：结算产出的 fact 条目先挂会话 pending 队列（待确认卡），
    // 作者确认后这里写进故事源——write 走内核 writeFactFile 单条 upsert（按 id 命中替换、
    // 没有就追加，绝不动别人的条目）；dismiss 只出队不落库。卡不存在＝NOT_FOUND（幂等友好）。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', pendingId: 'string', action: 'string?' } },
    response: { ok: 'true', action: 'string', session: 'object', revision: 'integer?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceSessionsGet: {
    method: 'GET',
    path: '/api/deduce/sessions',
    // 多局并存（OS-86）：主线（legacy session.json，哪怕还没有也占位）＋ sessions/ 全部
    // ＋激活指针。sessionId 缺省＝激活指针的口径与本表所有读端点一致。
    request: { query: { root: 'string', bookId: 'string?' } },
    response: { ok: 'true', bookId: 'string', activeId: 'string', sessions: 'array' },
    errors: ['NO_LIBRARY', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceSessionManage: {
    method: 'POST',
    path: '/api/deduce/session/manage',
    // 多局管理（OS-86）：new＝新建空局（title 缺省「第N局」）并激活；switch＝激活已有局；
    // delete＝非破坏删除（挪 扮演/<bookId>/.deleted/sessions/）——最后一局拒删，清空走「重新开局」。
    request: { body: { root: 'string', bookId: 'string?', action: 'string', sessionId: 'string?', title: 'string?' } },
    response: { ok: 'true', action: 'string', sessionId: 'string?', session: 'object?', activeId: 'string?', sessions: 'array?' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceBranch: {
    method: 'POST',
    path: '/api/deduce/branch',
    // 剧情树分支（OS-61 P3）：从某一拍开新分支——新 branchId、cursor 定位到该拍，
    // 分叉溯源记在分叉节点的 forkBranchIds 上。nodes 全量保留，原子写＋.history 备份。
    request: { body: { root: 'string', bookId: 'string?', sessionId: 'string?', fromNodeId: 'string' } },
    response: { ok: 'true', session: 'object' },
    errors: ['NO_LIBRARY', 'INVALID_ENTRY', 'NOT_FOUND', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceAssets: {
    method: 'GET',
    path: '/api/deduce/assets',
    // 文游素材盘点（OS-61 P4）：扮演/<bookId>/素材/ 下三类可选素材——
    // 角色/<角色名>.png（立绘）、场景/<场景名>.png、bgm/<场景或情绪>.mp3。
    // 目录不存在＝三个空数组（空态合法，不报错）；每项 { name, path }，path 为库内相对路径。
    request: { query: { root: 'string', bookId: 'string?' } },
    response: { ok: 'true', bookId: 'string', characters: 'array', scenes: 'array', bgm: 'array' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },

  deduceAssetFile: {
    method: 'GET',
    path: '/api/deduce/asset',
    // 单个素材本体（OS-61 P4）：path 相对 扮演/<bookId>/素材/，只放行 .png/.mp3。
    // 成功响应是二进制流（image/png 或 audio/mpeg），不是 JSON——前端 <img>/<audio> 直挂。
    request: { query: { root: 'string', bookId: 'string?', path: 'string' } },
    response: { stream: 'string' },
    errors: ['NO_LIBRARY', 'PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
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
}
