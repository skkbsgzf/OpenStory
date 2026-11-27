/**
 * OS-220：升级计划纯核心（零 I/O、零写盘）。
 *
 * 只做三件事，全部是纯函数：
 *   · 把「本次升级/迁移会碰到的文件与迁移器」收成 bindings（路径＋sha256），
 *     planId 由 bindings 与语义化后的分节内容算出——相同输入得到相同 planId；
 *   · 把计划里所有时间派生命名（`.upgrade-<stamp>`、`.retired-<stamp>`、
 *     `.history/upgrade-<stamp>`、`capability-…-<stamp>`）与 ISO 时间值归一，
 *     让预览时刻不影响计划语义；
 *   · 执行前漂移比对：plan 记录的是预览时的哈希，重算后逐条对不上即漂移。
 *
 * 真正的读盘由 `libraryUpgrade.diagnoseUpgrade` 与
 * `capabilityMigration.planCapabilityMigrations` 完成（两者都只读）：
 * 本文件不 import `node:fs`，协议层「文件清单与 README 逐一对上」的门禁按纯契约登记。
 */
import { createHash } from 'node:crypto'

export const UPGRADE_PLAN_SPEC = 'openstory.upgrade-plan/v1'
export const PLAN_ID_PREFIX = 'plan-'

/** 时间派生命名：stampOf() 的输出形态（ISO 去掉冒号与点）。 */
const STAMP_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z/gu
/** ISO 时间值（改写后字节里可能出现，比如 project.json 的 updatedAt）。 */
const ISO_PATTERN = /\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z/gu

/** 计划里随时间变化、不参与语义比较的键。 */
const VOLATILE_KEYS = new Set([
  'previewedAt', 'predictedBackupPath', 'predictedPath', 'predictedDir', 'stamp', 'now', 'at',
  'startedAt', 'finishedAt', 'recoveredAt', 'backupPath'
])

export function posixPath(value) {
  return String(value ?? '').replaceAll('\\', '/')
}

export function sha256(value) {
  const hash = createHash('sha256')
  if (value instanceof Uint8Array) hash.update(value)
  else hash.update(String(value ?? ''))
  return hash.digest('hex')
}

/** 键序稳定的 JSON，供 planId 与语义比较使用。 */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value === undefined) return 'null'
  if (!value || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`
}

/** 库根授权指纹：计划只对这一个 root 有效（换路径即换 planId）。 */
export function rootFingerprint(rootPath) {
  return sha256(`openstory-root/v1:${posixPath(rootPath)}`)
}

/** 时间派生命名 → `<stamp>`，ISO 时间值 → `<iso>`；用于语义比较。 */
export function normalizeTimeText(value) {
  return String(value ?? '').replace(STAMP_PATTERN, '<stamp>').replace(ISO_PATTERN, '<iso>')
}

/** 深层时间归一（不丢键）：计划里「改写后字节」的摘要跨两次预览必须一致。 */
export function normalizeTimeDeep(value) {
  if (typeof value === 'string') return normalizeTimeText(value)
  if (Array.isArray(value)) return value.map(normalizeTimeDeep)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, child] of Object.entries(value)) out[key] = normalizeTimeDeep(child)
  return out
}

function prune(value) {
  if (typeof value === 'string') return normalizeTimeText(value)
  if (Array.isArray(value)) return value.map(prune)
  if (!value || typeof value !== 'object') return value
  const out = {}
  for (const [key, child] of Object.entries(value)) {
    if (VOLATILE_KEYS.has(key)) continue
    out[key] = prune(child)
  }
  return out
}

/** 去掉时间戳与时间派生命名的计划投影：相同输入必须得到同一份。 */
export function semanticPlan(plan) {
  return prune(plan)
}

export function sortBindings(bindings = []) {
  return [...bindings].sort((left, right) => String(left?.id).localeCompare(String(right?.id)))
}

function uniqueBindings(bindings) {
  const map = new Map()
  for (const binding of bindings) {
    if (!binding?.id || !binding.path) continue
    map.set(binding.id, binding)
  }
  return sortBindings([...map.values()])
}

/**
 * planId：spec/kind/root 指纹/bindings/sections 的稳定哈希。
 * bindings 含受影响文件与迁移器摘要——任一文件或迁移器一变，planId 就变。
 */
export function computePlanId(plan) {
  const core = {
    spec: plan?.spec ?? UPGRADE_PLAN_SPEC,
    kind: plan?.kind ?? '',
    root: plan?.root?.fingerprint ?? null,
    bindings: uniqueBindings(plan?.bindings ?? []),
    sections: prune(plan?.sections ?? {})
  }
  return `${PLAN_ID_PREFIX}${sha256(stableJson(core)).slice(0, 32)}`
}

export function summarizeSections(sections = {}) {
  const library = sections.libraryUpgrade ?? {}
  const capability = Array.isArray(sections.capabilityMigrations) ? sections.capabilityMigrations : []
  const libraryConflicts = Array.isArray(library.conflicts) ? library.conflicts : []
  const capabilityBlocking = capability.flatMap((item) => (item?.conflicts ?? []).filter((row) => row?.blocking))
  return {
    libraryNeeded: library.needed === true,
    directoryOps: Array.isArray(library.operations) ? library.operations.length : 0,
    rewrites: Array.isArray(library.rewrites) ? library.rewrites.length : 0,
    conflicts: libraryConflicts.length + capability.reduce((sum, item) => sum + (item?.conflicts?.length ?? 0), 0),
    blocking: libraryConflicts.filter((item) => item?.blocking).length + capabilityBlocking.length,
    skipped: (library.skipped?.length ?? 0) + capability.reduce((sum, item) => sum + (item?.skipped?.length ?? 0), 0),
    capabilityMigrations: capability.length,
    capabilityPending: capability.filter((item) => item?.status === 'pending' || item?.status === 'recover').length,
    dataAhead: Array.isArray(sections.dataAhead) ? sections.dataAhead.length : 0
  }
}

/**
 * 组装计划。`writes:false` 是给调用方与作者看的硬事实：本模块产出的计划从不落盘。
 * 计划本身不做 I/O，分节内容由 diagnose / plan 两个只读入口填。
 */
export function buildPlan({ kind, rootPath, sections, risks = [], bindings = [], now = new Date() }) {
  const plan = {
    spec: UPGRADE_PLAN_SPEC,
    kind: String(kind ?? ''),
    root: { path: posixPath(rootPath), fingerprint: rootFingerprint(rootPath) },
    previewedAt: (now instanceof Date ? now : new Date(now)).toISOString(),
    writes: false,
    sections,
    bindings: uniqueBindings(bindings),
    risks: [...risks],
    summary: summarizeSections(sections),
    planId: ''
  }
  plan.planId = computePlanId(plan)
  return plan
}

/** 逐条比对绑定摘要；`actualById` 里缺失的 id 也算漂移（文件被删/改名）。 */
export function diffPlanBindings(plan, actualById = {}) {
  const drift = []
  for (const binding of plan?.bindings ?? []) {
    if (!Object.hasOwn(actualById, binding.id)) {
      drift.push({ id: binding.id, path: binding.path, expected: binding.sha256, actual: undefined, reason: 'missing' })
      continue
    }
    if (actualById[binding.id] !== binding.sha256) {
      drift.push({ id: binding.id, path: binding.path, expected: binding.sha256, actual: actualById[binding.id], reason: 'changed' })
    }
  }
  return drift
}
