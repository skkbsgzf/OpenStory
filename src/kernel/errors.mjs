/**
 * OpenStory 内核 · 统一错误码（openstory-kernel@1）。
 *
 * 约定：所有内核拒绝都带 code + 人话 message + 可机读 details；插件不得自造码。
 * 2026-11-24（OS-157，作者裁定 C）：25 个码值去掉旧前缀，与宿主词表同一命名法；
 * 旧码→新码对照见 docs/error-code-rename.md。落盘格式与错误语义不变。
 */
export const KERNEL_ERROR_CODES = Object.freeze({
  INVALID_MANIFEST: 'INVALID_MANIFEST',
  DUPLICATE_PLUGIN: 'DUPLICATE_PLUGIN',
  KERNEL_INCOMPATIBLE: 'KERNEL_INCOMPATIBLE',
  RESERVED_SLOT: 'RESERVED_SLOT',
  TOOL_CONFLICT: 'TOOL_CONFLICT',
  UNKNOWN_CAPABILITY: 'UNKNOWN_CAPABILITY',
  DIR_CONFLICT: 'DIR_CONFLICT',
  SCOPE_NOT_GRANTED: 'SCOPE_NOT_GRANTED',
  SCOPE_OUTSIDE_OWNER: 'SCOPE_OUTSIDE_OWNER',
  RESERVED_VIEW_TYPE: 'RESERVED_VIEW_TYPE',
  UNKNOWN_SUBSCRIPTION: 'UNKNOWN_SUBSCRIPTION',
  INVALID_ENTRY: 'INVALID_ENTRY',
  INVALID_SERVICE: 'INVALID_SERVICE',
  INVALID_MCP: 'INVALID_MCP',
  // 批次51：效应合同的两种拒绝——setup 没交回 disposer（注册了但没法拆）／
  // 向已卸载的 owner 继续注册（等价 Cordis 的 INACTIVE_EFFECT）。
  INVALID_EFFECT: 'INVALID_EFFECT',
  EFFECT_ON_DISPOSED: 'EFFECT_ON_DISPOSED',
  PATH_OUTSIDE_PROJECT: 'PATH_OUTSIDE_PROJECT',
  STALE_REVISION: 'STALE_REVISION',
  DEPENDENCY_UNMET: 'DEPENDENCY_UNMET',
  PRIMARY_CARRIER_MISSING: 'PRIMARY_CARRIER_MISSING',
  PRIMARY_CARRIER_NOT_ENABLED: 'PRIMARY_CARRIER_NOT_ENABLED',
  IO_FAILED: 'IO_FAILED',
  INVALID_INPUT: 'INVALID_INPUT',
  // S1 拆解数据接线（factFileStore）。命名沿用 HISTORY_* 的「族名_原因」风格：
  //   · FACT_NOT_FOUND —— fact:get 按 id 查不到条目（只读查询的 NOT_FOUND 语义）。
  //   · WRITE_PROTOCOL_NOT_STARTED —— S1 阶段 save/remove 只做到校验；真落盘归 S2 的
  //     writeFactFile（tmp + os.replace + operationId 旁路日志）。这不是「写失败」，是「写协议还没开」。
  FACT_NOT_FOUND: 'FACT_NOT_FOUND',
  WRITE_PROTOCOL_NOT_STARTED: 'WRITE_PROTOCOL_NOT_STARTED'
})

export function ok(value) {
  return { ok: true, value }
}

export function fail(code, message, details) {
  const error = { code: KERNEL_ERROR_CODES[code] ?? KERNEL_ERROR_CODES.INVALID_INPUT, message }
  if (details && Object.keys(details).length) error.details = details
  return { ok: false, error }
}

/** 把 fail() 的载荷抛成 Error，供 async 出口统一使用。 */
export function throwFailure(result) {
  const error = new Error(result.error?.message ?? 'OpenStory operation failed')
  error.code = result.error?.code ?? KERNEL_ERROR_CODES.INVALID_INPUT
  error.details = result.error?.details ?? null
  throw error
}
