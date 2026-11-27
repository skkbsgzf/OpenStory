/**
 * OS-212：MCP 工具安全语义**单一注册表**（纯数据、零副作用、零 I/O）。
 *
 * 为什么要有这一张表：operate 说明书可以声明「写操作只能调用哪些官方工具、要什么确认级别」，
 * 但加载器不能靠工具名前缀猜读写，Agent 也不能靠自然语言自己判断。于是把每个 MCP 工具的
 * `effect`（读/建/写/删/重置）与 `requiredConfirm`（read/create/migrate/restore）钉在一处：
 *   · `src/services/skills.mjs` 装载时用它做 fail-closed 校验（未知/未分类工具直接拒收）；
 *   · `src/host/mcp.mjs` 用它做双向校验（工具表 ↔ 注册表，多一个少一个都拒绝启动）；
 *   · `test/mcp.test.mjs` 拿它核对 tools/list，防止声明不存在的工具或伪装成 MCP 工具的 shell/fs。
 *
 * 约定：`requiredConfirm` 是**最低**确认门槛，不是精确值；`confirm` 级别按
 * read < create < migrate < restore 递增，满足或高于门槛即可。
 * `deduce_present` 正常续拍只保存会话状态（写），`reset:true` 会清掉局面——必须升级到 restore；
 * 无法参数化的工具整体按写工具算，不给「这次可能是只读」的侥幸口子。
 */

/** 效果分类：只读 / 新建 / 写入（覆盖写、改表）/ 删除（进 .history）/ 重置（清会话态）。 */
export const TOOL_EFFECTS = Object.freeze(['read', 'create', 'write', 'delete', 'reset'])
/** 写效果集合——只读类 skill（review/extract）与非 operate skill 一律不得声明。 */
export const WRITE_EFFECTS = Object.freeze(TOOL_EFFECTS.filter((effect) => effect !== 'read'))
/** 作者确认级别（低 → 高）——MCP 工具 schema 的 confirm enum 只许从这条 re-export 取，不许再手抄一遍。 */
export const TOOL_CONFIRM_LEVELS = Object.freeze(['read', 'create', 'migrate', 'restore'])
/** 工具 schema 中承载作者确认级别的字段名（单一真源；mcp.mjs 的 properties 与闸都取这里）。 */
export const CONFIRM_PARAM = 'confirm'

const CONFIRM_RANK = Object.freeze(Object.fromEntries(TOOL_CONFIRM_LEVELS.map((level, index) => [level, index])))

/** 确认级别是否满足工具的最低门槛。 */
export function confirmSatisfies(actual, required) {
  const a = CONFIRM_RANK[actual]
  const r = CONFIRM_RANK[required]
  if (a === undefined || r === undefined) return false
  return a >= r
}

const read = Object.freeze({ effect: 'read', requiredConfirm: 'read' })
const create = (extra) => Object.freeze({ effect: 'create', requiredConfirm: 'create', ...extra })
const write = (extra) => Object.freeze({ effect: 'write', requiredConfirm: 'create', ...extra })
const erase = (extra) => Object.freeze({ effect: 'delete', requiredConfirm: 'restore', ...extra })

/**
 * 24 个现有 MCP 工具的语义表（与 src/host/mcp.mjs 的 tools 数组逐名对应；
 * 后续工单新增工具必须同步这里，否则 mcp.mjs 启动即 fail-closed）。
 */
export const MCP_TOOL_SEMANTICS = Object.freeze({
  /* ===== meta ===== */
  openstory_libraries: read,
  openstory_files: read,

  /* ===== novel ===== */
  openstory_novel_list_chapters: read,
  openstory_novel_read_chapter: read,
  openstory_novel_write_chapter: write(),
  openstory_novel_new_chapter: create(),
  openstory_novel_delete_chapter: erase(),

  /* ===== reference ===== */
  openstory_reference_index: read,
  openstory_reference_graph: read,
  openstory_reference_read_note: read,
  openstory_reference_write_note: write(),
  openstory_habits_read: read,
  openstory_habits_put: write(),
  openstory_vision_describe: read,
  openstory_image_generate: write(),

  /* ===== deduce + enrich + fact ===== */
  // 正常续拍也保存会话状态；reset=true 清盘，确认门槛升到 restore。
  openstory_deduce_present: write({
    mutatesWhen: Object.freeze({ parameter: 'reset', equals: true, effect: 'reset', requiredConfirm: 'restore' }),
    parameterEffects: Object.freeze({ reset: 'reset' })
  }),
  openstory_deduce_settle: write(),
  openstory_enrich_run: write(),
  openstory_enrich_status: read,
  openstory_enrich_graph: read,
  openstory_fact_curve: read,

  /* ===== analysis（本地纯计算） ===== */
  openstory_analysis_chapter: read,

  /* ===== 技能货架 ===== */
  openstory_skills_list: read,
  openstory_skills_read: read,

  /* ===== OS-213 建库原语 ===== */
  // 建库：在作者给定的绝对路径创建库并登记（写盘＋注册）→ create。
  openstory_library_create: create(),
  // 只读诊断：不触发升级、不写业务文件。
  openstory_library_diagnose: read,
  // 扫描旧源：只产计划，零写入。
  openstory_library_scan: read,
  // 导入旧源：真搬文件，覆盖前有 plan 与备份 → write。
  openstory_library_import: write(),
  // 主载体切换：改 project.json → write。
  openstory_library_primary: write(),

  /* ===== OS-213 套件原语 ===== */
  openstory_suites: read,
  openstory_suite_enable: write(),
  openstory_suite_settings: write(),

  /* ===== OS-213 fact 原语 ===== */
  openstory_fact_books: read,
  openstory_fact_entries: read,
  // 整份替换事实链条目：有备份，但语义是覆盖写。
  openstory_fact_entries_import: write(),

  /* ===== OS-213 exchange 原语 ===== */
  // 导出缺省只返回数据（读）；save=true 才落盘 → 条件写。
  openstory_exchange_export: Object.freeze({
    effect: 'read',
    requiredConfirm: 'read',
    mutatesWhen: Object.freeze({ parameter: 'save', equals: true, effect: 'write', requiredConfirm: 'create' })
  }),
  // 导入：缺省（不传 dryRun）就是真写——这是默认路径，不能因为「可能传了 dryRun」就放行。
  // 注册表的 mutatesWhen 只能「命中参数才升级」，无法表达「参数缺省即写」，所以整体按写工具：
  // 即使 dryRun:true 也要 confirm（宁严不宽；dryRun 的零写入由实现保证）。
  openstory_exchange_import: write(),

  /* ===== OS-215 剧本/扮演构建原语 II ===== */
  openstory_script_to_fact: read,
  openstory_script_from_fact: read,
  openstory_chapters_rename: write(),

  openstory_sessions: read,
  openstory_session_get: read,
  openstory_session_new: create(),
  openstory_session_switch: write(),
  openstory_session_delete: erase(),
  openstory_session_put: write(),

  openstory_roleplay_turn: write(),
  openstory_roleplay_archive: create(),
  openstory_roleplay_export: create(),
  openstory_roleplay_promote: write(),
  openstory_roleplay_pending: write(),
  openstory_roleplay_branch: create(),

  openstory_assets: read,
  openstory_asset_read: read,
  openstory_deduce_image: write()
})

/** 取一个工具的语义；未分类/未知一律 null（调用方必须 fail-closed，不许回落成 read）。 */
export function toolSemanticsOf(name) {
  const key = typeof name === 'string' ? name : ''
  return Object.hasOwn(MCP_TOOL_SEMANTICS, key) ? MCP_TOOL_SEMANTICS[key] : null
}

/** 该工具是否写工具（含 create/write/delete/reset）。 */
export function isWriteTool(name) {
  const semantics = toolSemanticsOf(name)
  return Boolean(semantics && semantics.effect !== 'read')
}

/**
 * 按实参解析真实语义：命中 mutatesWhen 时升到参数指定的效果与确认门槛；
 * 没有参数化声明的工具整体按注册表语义算（无法参数化＝整体写工具）。
 */
export function semanticsForCall(name, args = {}) {
  const semantics = toolSemanticsOf(name)
  if (!semantics) return null
  const rule = semantics.mutatesWhen
  if (rule && args && typeof args === 'object' && args[rule.parameter] === rule.equals) {
    return Object.freeze({ effect: rule.effect, requiredConfirm: rule.requiredConfirm })
  }
  return semantics
}

/**
 * 工具的最坏确认门槛（基础语义 + 所有 mutatesWhen 升级中的最高者）。
 * P1-4：skill 声明 tools 时**无法绑定实参**（没有参数绑定语法），按工单「无法参数化时整体按写工具」
 * 口径，声明该工具的 operate 说明书必须满足它的最坏门槛——否则一份 `confirm:create` 的说明书
 * 就能合规带上可在 reset=true 时清盘的 deduce_present，等于放行 restore 级写操作无人拦。
 */
export function maxRequiredConfirm(name) {
  const semantics = toolSemanticsOf(name)
  if (!semantics) return null
  let highest = semantics.requiredConfirm
  const rule = semantics.mutatesWhen
  if (rule && TOOL_CONFIRM_LEVELS.includes(rule.requiredConfirm)
    && CONFIRM_RANK[rule.requiredConfirm] > CONFIRM_RANK[highest]) highest = rule.requiredConfirm
  return highest
}

/**
 * 工具 schema 参数真源：由 `validateSemanticsRegistry(tools)` 在启动时从真实
 * `tools[].inputSchema.properties` 注入（只认已经过双向校验的工具表，不再手抄第二份）。
 * 注入前为空集——此时 semanticsEntryMalformed 对任何带 mutatesWhen 的条目报 malformed，
 * 防止注册表在没接上真实 schema 时被静默接受。
 */
const TOOL_PARAM_NAMES_INTERNAL = new Map()

/** 供校验/测试读取的参数名投影（只读副本；真源是注入的 schema）。 */
export function toolParamNames(name) {
  return Object.freeze([...(TOOL_PARAM_NAMES_INTERNAL.get(name) ?? [])])
}

/** 单条语义的形状校验（含嵌套 mutatesWhen/parameterEffects）——纯函数，可独立反证。
 * `params` 可由调用方传入（校验临时 schema），缺省取真实注入值。 */
export function semanticsEntryMalformed(name, semantics, params = TOOL_PARAM_NAMES_INTERNAL.get(name) ?? []) {
  if (!semantics || typeof semantics !== 'object' || Array.isArray(semantics)) return true
  if (!TOOL_EFFECTS.includes(semantics.effect) || !TOOL_CONFIRM_LEVELS.includes(semantics.requiredConfirm)) return true
  const rule = semantics.mutatesWhen
  if (rule !== undefined) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return true
    if (!TOOL_EFFECTS.includes(rule.effect) || !TOOL_CONFIRM_LEVELS.includes(rule.requiredConfirm)) return true
    if (typeof rule.parameter !== 'string' || !rule.parameter || !params.includes(rule.parameter)) return true
  }
  const effects = semantics.parameterEffects
  if (effects !== undefined) {
    if (!effects || typeof effects !== 'object' || Array.isArray(effects)) return true
    for (const [parameter, effect] of Object.entries(effects)) {
      if (!params.includes(parameter) || !TOOL_EFFECTS.includes(effect)) return true
      // P1：parameterEffects 与 mutatesWhen 描述同一参数时必须一致——
      // 否则「单一真源」内部自相矛盾（mutatesWhen 说 reset→reset，parameterEffects 却写 write）。
      if (rule && parameter === rule.parameter && effect !== rule.effect) return true
    }
  }
  return false
}

/**
 * 双向校验：MCP 工具表与注册表必须逐名相等，且 mutatesWhen/parameterEffects 指向的参数
 * 必须在真实 `inputSchema.properties` 里存在。
 * `tools` 项形如 `{ name, inputSchema }`；也兼容只传名字数组（此时拿不到 schema，
 * 带参数语义的条目一律 malformed，fail-closed 不放行）。
 */
export function validateSemanticsRegistry(tools) {
  const entries = Array.isArray(tools) ? tools : []
  const names = entries.map((tool) => String(typeof tool === 'string' ? tool : tool?.name ?? ''))
  const registered = Object.keys(MCP_TOOL_SEMANTICS)
  const nameSet = new Set(names)
  const registeredSet = new Set(registered)
  const missing = names.filter((name) => !registeredSet.has(name))
  const extra = registered.filter((name) => !nameSet.has(name))
  const schemas = new Map(entries
    .filter((tool) => tool && typeof tool === 'object')
    .map((tool) => [String(tool.name ?? ''), Object.keys(tool.inputSchema?.properties ?? {})]))
  const paramsFor = (name) => (schemas.get(name) ?? TOOL_PARAM_NAMES_INTERNAL.get(name) ?? [])
  const malformed = registered.filter((name) => semanticsEntryMalformed(name, MCP_TOOL_SEMANTICS[name], paramsFor(name)))
  const paramMismatch = [...schemas].filter(([name, params]) => {
    const semantics = MCP_TOOL_SEMANTICS[name]
    if (!semantics) return false
    const referenced = [semantics.mutatesWhen?.parameter, ...Object.keys(semantics.parameterEffects ?? {})].filter(Boolean)
    return referenced.some((parameter) => !params.includes(parameter))
  }).map(([name]) => name)
  // 只在本次校验全绿时提交 schema 真值（一次同步赋值），反证用的临时 schema 不污染已装载值。
  const ok = !missing.length && !extra.length && !malformed.length && !paramMismatch.length
  if (ok) for (const [name, params] of schemas) TOOL_PARAM_NAMES_INTERNAL.set(name, params)
  return { ok, missing, extra, malformed, paramMismatch, count: names.length }
}
