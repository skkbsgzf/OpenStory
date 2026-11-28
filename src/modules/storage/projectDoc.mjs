/**
 * OS-124 解耦②：建库自持（fork 点，不再与上游同步）。
 * `.openstory/project.json` 使用 OpenStory 自有合同；旧库由 libraryUpgrade 一次性迁移。
 *
 * 逐字拷贝归并自旧版库谱系（脚本按行切片原文件拼接，非手抄；具名出处与
 * 上游路径见 docs/kernel-provenance.md）：
 *   · next/kernel/projectSkeleton.mjs → PROJECT_KINDS / isKnownKind / skeletonDirs /
 *     allSkeletonDirs / ensureSkeleton；
 *   · next/project/projectManifest.mjs → validateProjectDocument / buildProjectDocument /
 *     buildBareProjectDocument / normalizeCarriers / nextCarriers / projectMarkerPath /
 *     readProjectDocument / writeProjectDocument / PROJECT_DOC_FIELDS；
 *   · next/shell/library/wizardKit.mjs → describeOpenFailure / validateLibraryName / folderName；
 *   · next/project/createProject.mjs → createProject / initBareProject / prepareRoot /
 *     makeMetadataDirs / makeProjectId。
 * 载体表 CARRIERS 与 vendor 清单（next/carriers/{novel,script}/manifest.mjs）同形，
 * 两载体 requires 均为 []，resolveClosure 在其上退化为恒等。
 * plumber 经协议层叶子 protocol/kernelPlumber.mjs 取用；出处见 docs/kernel-provenance.md。
 * 护栏测试：test/decoupleStep2.test.mjs。
 */
import { mkdirSync } from 'node:fs'
import { mkdir, readFile, readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { fail, ok, writeFileAtomic } from '../../protocol/kernelPlumber.mjs'
import { namingEntry } from '../../protocol/naming.mjs'
import { LEGACY_PROJECT_SPECS, normalizeCarrierId } from '../../protocol/libraryUpgrade.mjs'
export { LEGACY_PROJECT_SPECS }

const STORAGE = namingEntry('libraryStorage')
const NOVEL_CARRIER = `${STORAGE.carrierPrefix}novel`
const SCRIPT_CARRIER = `${STORAGE.carrierPrefix}script`

/* ---------- 载体表（本仓自持；值与 vendor 清单逐字一致，OpenStory 只建库不装实现） ---------- */

export const CARRIERS = Object.freeze({
  [NOVEL_CARRIER]: Object.freeze({
    projectKind: 'novel',
    dataDirs: Object.freeze({ manuscript: '正文' })
  }),
  [SCRIPT_CARRIER]: Object.freeze({
    projectKind: 'screenplay',
    dataDirs: Object.freeze({ script: '剧本' })
  })
})

/** 载体标题（vendor 清单逐字）：createProject 失败文案与 list().id 并用时要用。 */
const CARRIER_TITLES = Object.freeze({
  [NOVEL_CARRIER]: '小说',
  [SCRIPT_CARRIER]: '剧本'
})

/* ---------- 固化中文项目骨架（vendor projectSkeleton 逐字切片） ---------- */
/**
 * 固化中文项目骨架（R1 已裁：中文目录是物理真源）。
 * 历史来源对照：server/services/localMirrorService.js 的 KIND_TEMPLATES；fork 时两边的
 * 一致性由 next/tests/skeleton-contract.test.mjs 钉住。自本仓自持后由
 * test/decoupleStep2.test.mjs 守卫，不再依赖 Next 或 Express 轨。
 */
/**
 * OpenStory 项目合同 @4。旧 @1–@3 只作为迁移输入接受，写回一律 @4。
 */
export const PROJECT_SPEC = STORAGE.projectSpec
export const METADATA_DIR = STORAGE.metadataDir
/**
 * 新建库骨架：世界书只有一个正名目录；四个已退场目录不再随新库落盘。
 */
export const PROJECT_KINDS = Object.freeze({
  novel: Object.freeze(['正文', '世界书', '日志']),
  screenplay: Object.freeze(['剧本', '人物', '场景', '世界书', '日志']),
  generic: Object.freeze(['文档', '日志'])
})
export function isKnownKind(kind) {
  return Object.prototype.hasOwnProperty.call(PROJECT_KINDS, String(kind || ''))
}

export function skeletonDirs(kind) {
  return PROJECT_KINDS[kind] ?? null
}

/** 全部骨架目录的并集，用于判定「这块地盘是框架的还是外来的」。 */
export function allSkeletonDirs() {
  const set = new Set()
  for (const dirs of Object.values(PROJECT_KINDS)) for (const dir of dirs) set.add(dir)
  return [...set]
}
/** 骨架落盘：只建缺失的目录，绝不删除、绝不覆盖已有文件。 */
export function ensureSkeleton(kind, root, fsImpl = { mkdirSync: (target) => mkdirRecursive(target) }) {
  const dirs = skeletonDirs(kind)
  if (!dirs) return fail('INVALID_INPUT', `未知项目类型：${kind}`)
  const created = []
  for (const dir of dirs) {
    const target = join(root, dir)
    try {
      fsImpl.mkdirSync(target)
      created.push(dir)
    } catch (error) {
      if (error?.code !== 'EEXIST') {
        return fail('IO_FAILED', `创建骨架目录失败：${dir}`, { dir, cause: String(error?.message || error) })
      }
    }
  }
  return ok({ kind, dirs, created })
}
function mkdirRecursive(target) {
  mkdirSync(target, { recursive: true })
}

/* ---------- .openstory/project.json 单一合同 ---------- */
/**
 * `.openstory/project.json` 是库身份真源。@4 使用 OpenStory 载体 id；旧 @1–@3
 * 读侧兼容并归一为 @4，实际目录与谱系名迁移由 libraryUpgrade 完成。
 */
export const PROJECT_DOC_FIELDS = Object.freeze([
  'spec', 'schemaVersion', 'projectId', 'name', 'kind', 'createdAt', 'updatedAt', 'carriers'
])

export function validateProjectDocument(input) {
  if (!isPlainObject(input)) return fail('INVALID_INPUT', 'project.json 必须是对象')
  const doc = input
  if (doc.spec !== PROJECT_SPEC && !LEGACY_PROJECT_SPECS.includes(doc.spec)) {
    return fail('INVALID_INPUT', `项目范式 ${String(doc.spec)} 不在支持范围（${[...LEGACY_PROJECT_SPECS, PROJECT_SPEC].join(' / ')}）`, {
      got: doc.spec, wanted: PROJECT_SPEC
    })
  }
  const legacy = doc.spec !== PROJECT_SPEC
  const carriers = normalizeCarriers(doc.carriers, { legacy })
  if (!carriers.ok) return carriers

  // D2：kind 缺失/未知不再静默回落成 novel。唯一允许空 kind 的形态是「还没有主载体的裸项目」，
  // 它停在「选一个主载体」这一步，而不是猜一个类型把书跑歪。
  if (!isKnownKind(doc.kind)) {
    if (carriers.value.primary) {
      return fail('PRIMARY_CARRIER_MISSING', `项目声明了主载体 ${carriers.value.primary}，但类型缺失或未知：${String(doc.kind)}`, { kind: doc.kind })
    }
    if (carriers.value.enabled.length) {
      return fail('PRIMARY_CARRIER_MISSING', `项目有启用板块却没有项目类型，请重新选择主载体`, { enabled: carriers.value.enabled })
    }
  }
  if (typeof doc.projectId !== 'string' || !doc.projectId.trim()) return fail('INVALID_INPUT', 'projectId 必填')
  if (typeof doc.name !== 'string' || !doc.name.trim() || doc.name.trim().length > 120) {
    return fail('INVALID_INPUT', '项目名称须是 1–120 字')
  }

  return ok({
    spec: PROJECT_SPEC,
    schemaVersion: 4,
    legacySpec: legacy ? doc.spec : null,
    projectId: doc.projectId.trim(),
    name: doc.name.trim(),
    kind: isKnownKind(doc.kind) ? doc.kind : null,
    createdAt: isoOrNow(doc.createdAt),
    updatedAt: isoOrNow(doc.updatedAt),
    carriers: carriers.value,
    needsPrimary: !carriers.value.primary
  })
}

export function buildProjectDocument({ projectId, name, kind, primaryCarrier, enabled = [], now = new Date().toISOString() }) {
  if (!isKnownKind(kind)) return fail('INVALID_INPUT', `未知项目类型：${String(kind)}`)
  if (!primaryCarrier) return fail('PRIMARY_CARRIER_MISSING', '建项目必须指定主载体（D1）')
  const enabledSet = [...new Set([primaryCarrier, ...enabled.filter((id) => id !== primaryCarrier)])]
  return ok({
    spec: PROJECT_SPEC,
    schemaVersion: 4,
    projectId: String(projectId),
    name: String(name).trim(),
    kind,
    createdAt: now,
    updatedAt: now,
    carriers: { primary: primaryCarrier, enabled: enabledSet, revision: 1 }
  })
}

/** 裸项目（M1 空框架形态）：只有 .openstory/ 与元数据，停在「选主载体」那一步。 */
export function buildBareProjectDocument({ projectId, name, now = new Date().toISOString() }) {
  if (typeof name !== 'string' || !name.trim()) return fail('INVALID_INPUT', '项目名称必填')
  return ok({
    spec: PROJECT_SPEC,
    schemaVersion: 4,
    projectId: String(projectId),
    name: name.trim(),
    kind: null,
    createdAt: now,
    updatedAt: now,
    carriers: { primary: null, enabled: [], revision: 0 }
  })
}

export function normalizeCarriers(value, { legacy = false } = {}) {
  if (value === undefined || value === null) {
    if (legacy) return ok({ primary: null, enabled: [], revision: 0, migrated: true })
    return fail('INVALID_INPUT', `${PROJECT_SPEC} 必须带 carriers（{primary,enabled,revision}）`)
  }
  if (!isPlainObject(value)) return fail('INVALID_INPUT', 'carriers 必须是对象')
  const enabled = Array.isArray(value.enabled) ? value.enabled.filter((id) => typeof id === 'string' && id.trim()).map((id) => normalizeCarrierId(id.trim())) : []
  const primary = typeof value.primary === 'string' && value.primary.trim() ? normalizeCarrierId(value.primary.trim()) : null
  if (primary && !enabled.includes(primary)) {
    return fail('PRIMARY_CARRIER_NOT_ENABLED', `主载体 ${primary} 必须同时处于启用态（C7）`, { primary, enabled })
  }
  const revision = Number.isSafeInteger(value.revision) && value.revision >= 0 ? value.revision : 0
  return ok({ primary, enabled, revision })
}

/** 启停/切主载体的落盘：带 revision 乐观并发，冲突即拒。 */
export function nextCarriers(current, { primary = null, enabled = null, expectedRevision }) {
  const normalized = normalizeCarriers(current)
  if (!normalized.ok) return normalized
  if (Number.isSafeInteger(expectedRevision) && expectedRevision !== normalized.value.revision) {
    return fail('STALE_REVISION', `carriers 已推进到第 ${normalized.value.revision} 版，本次基于第 ${expectedRevision} 版的变更被拒绝`, {
      expected: expectedRevision, actual: normalized.value.revision
    })
  }
  const nextEnabled = Array.isArray(enabled) ? [...new Set(enabled.map((id) => normalizeCarrierId(String(id).trim())).filter(Boolean))] : normalized.value.enabled
  const nextPrimary = primary === null || primary === undefined ? normalized.value.primary : normalizeCarrierId(String(primary).trim())
  if (nextPrimary && !nextEnabled.includes(nextPrimary)) {
    return fail('PRIMARY_CARRIER_NOT_ENABLED', `主载体 ${nextPrimary} 未启用，切换被拒绝`, { primary: nextPrimary, enabled: nextEnabled })
  }
  return ok({ primary: nextPrimary, enabled: nextEnabled, revision: normalized.value.revision + 1 })
}

export function projectMarkerPath(root) {
  return join(resolve(String(root || '')), METADATA_DIR, 'project.json')
}

export async function readProjectDocument(root) {
  let raw
  try {
    raw = await readFile(projectMarkerPath(root), 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return fail('INVALID_INPUT', `目标目录不是 OpenStory 项目（缺 ${METADATA_DIR}/project.json）`)
    return fail('IO_FAILED', `读取 project.json 失败`, { cause: String(error?.message || error) })
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail('INVALID_INPUT', `project.json 不是合法 JSON`, { cause: String(error?.message) })
  }
  return validateProjectDocument(parsed)
}

export async function writeProjectDocument(root, document) {
  const validated = document.spec === PROJECT_SPEC ? ok(document) : validateProjectDocument(document)
  if (!validated.ok) return validated
  const payload = {
    spec: PROJECT_SPEC,
    schemaVersion: 4,
    projectId: validated.value.projectId,
    name: validated.value.name,
    kind: validated.value.kind,
    createdAt: validated.value.createdAt,
    updatedAt: new Date().toISOString(),
    carriers: validated.value.carriers
  }
  try {
    await writeFileAtomic(projectMarkerPath(root), `${JSON.stringify(payload, null, 2)}\n`)
    return ok(payload)
  } catch (error) {
    return fail('IO_FAILED', '写入 project.json 失败', { cause: String(error?.message || error) })
  }
}

function isoOrNow(value) {
  if (typeof value !== 'string') return new Date().toISOString()
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString()
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

/* ---------- 建项目（vendor createProject 除 import 外整文件逐字切片） ---------- */
/**
 * 建项目（D1 主载体显式 ＋ R4 装齐依赖闭包）。
 * 目录 = 固化中文骨架 ∪ 每个启用板块自己认领的文件夹；只建不删。
 */
export async function createProject({ root, name, primaryCarrier, registry, extraEnabled = [], deps = {} }) {
  const prepared = await prepareRoot({ root, name, deps })
  if (!prepared.ok) return prepared
  const { projectRoot, makeDir } = prepared.value

  if (!primaryCarrier) {
    return fail('PRIMARY_CARRIER_MISSING', '建项目必须指定主载体：这个项目要创作小说还是剧本？（D1）')
  }
  const primary = registry.get(primaryCarrier)
  if (!primary) {
    return fail('PRIMARY_CARRIER_MISSING', `主载体插件未安装：${primaryCarrier}`, {
      installed: registry.list().map((item) => item.id),
      hint: registry.rejected.length ? `装载失败的插件：${registry.rejected.map((item) => item.pluginId).join(' / ')}` : null
    })
  }

  const closure = resolveClosure(registry.manifests(), [primaryCarrier, ...extraEnabled])
  if (closure.unresolvable.length) {
    return fail('DEPENDENCY_UNMET', `主载体 ${primary.title} 的依赖闭包装不齐，拒绝建项目（D4：宁可先拦住，也不留下「想玩游戏却没有剧本」的空壳）`, {
      primary: primaryCarrier,
      unresolvable: closure.unresolvable,
      repairs: [...new Set(closure.unresolvable.map((item) => item.fix).filter(Boolean))]
    })
  }

  const skeleton = ensureSkeleton(primary.primary.projectKind, projectRoot, {
    mkdirSync: (target) => makeDir(target, { recursive: true })
  })
  if (!skeleton.ok) return skeleton

  await makeMetadataDirs(projectRoot, makeDir)

  const pluginDirs = []
  for (const id of closure.enabled) {
    for (const dir of Object.values(registry.get(id).dataDirs)) {
      if (skeleton.value.dirs.includes(dir) || pluginDirs.some((item) => item.dir === dir)) continue
      await makeDir(join(projectRoot, dir), { recursive: true })
      pluginDirs.push({ pluginId: id, dir })
    }
  }

  const document = buildProjectDocument({
    projectId: makeProjectId(),
    name: name.trim(),
    kind: primary.primary.projectKind,
    primaryCarrier,
    enabled: closure.enabled
  })
  if (!document.ok) return document
  const written = await writeProjectDocument(projectRoot, document.value)
  if (!written.ok) return written

  return ok({
    root: projectRoot,
    document: written.value,
    dirs: { skeleton: skeleton.value.dirs, pluginRegistered: pluginDirs.map((item) => item.dir) },
    enabled: closure.enabled
  })
}

/** 空框架形态（M1 验收）：只落 .openstory/ 与元数据，停在选主载体那一步，不报错、不猜类型。 */
export async function initBareProject({ root, name, deps = {} }) {
  const prepared = await prepareRoot({ root, name, deps })
  if (!prepared.ok) return prepared
  const { projectRoot, makeDir } = prepared.value
  await makeMetadataDirs(projectRoot, makeDir)
  const document = buildBareProjectDocument({ projectId: makeProjectId(), name: name.trim() })
  if (!document.ok) return document
  const written = await writeProjectDocument(projectRoot, document.value)
  if (!written.ok) return written
  return ok({ root: projectRoot, document: written.value, needsPrimary: true, dirs: { skeleton: [], pluginRegistered: [] } })
}

async function prepareRoot({ root, name, deps }) {
  const projectRoot = resolve(String(root || ''))
  const list = deps.readdir || readdir
  const makeDir = deps.mkdir || mkdir
  if (typeof name !== 'string' || !name.trim()) return fail('INVALID_INPUT', '项目名称必填')
  try {
    const entries = await list(projectRoot)
    if (entries.length > 0) {
      return fail('INVALID_INPUT', `目标目录非空：${projectRoot}。新项目请指向空目录；已有稿子先走导入映射再打开`)
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') return fail('IO_FAILED', '目标目录不可用', { cause: String(error?.message || error) })
    await makeDir(projectRoot, { recursive: true })
  }
  return ok({ projectRoot, makeDir })
}

async function makeMetadataDirs(projectRoot, makeDir) {
  await makeDir(join(projectRoot, METADATA_DIR), { recursive: true })
  await makeDir(join(projectRoot, METADATA_DIR, 'proposals'), { recursive: true })
  await makeDir(join(projectRoot, METADATA_DIR, 'state'), { recursive: true })
}

function makeProjectId() {
  return `proj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

/* ---------- 建库／导库人话（vendor wizardKit 三函数逐字切片） ---------- */
/** 目录路径的最后一段（作为默认库名）。 */
export function folderName(fullPath) {
  return String(fullPath ?? '').split(/[\\/]/).filter(Boolean).pop() ?? ''
}
/** 库名校验（工单 A-4：1–120 字）。返回 null 或人话错误。 */
export function validateLibraryName(name) {
  const text = String(name ?? '').trim()
  if (!text) return '给库起个名字（1–120 字），或者就用文件夹名。'
  if (text.length > 120) return '库名最多 120 字，请缩短后再创建。'
  return null
}

/**
 * 打开失败的错误码 → 人话与修复动作（工单 A-5）。
 * 返回 { title, detail, action }：action ∈ 'create-here'（在此新建库）| 'import-here'（导入这个文件夹）
 * | 'pick-primary'（去选主模块）| 'open-modules'（打开模块管理）| null（无修复动作）。
 * 错误码原文只在 detail 里出现，不上主文案（工单 A-5 明文）。
 * fsInfo＝主进程在打开失败时附带的 { hasMetadata, dirEmpty }（缺省按「未知」处理，给通用动作）。
 */
export function describeOpenFailure(error, fsInfo = {}) {
  const code = String(error?.code ?? '')
  const hasMetadata = fsInfo.hasMetadata
  const dirEmpty = fsInfo.dirEmpty
  if (!hasMetadata && dirEmpty === true) {
    return {
      title: '这个文件夹还不是库',
      detail: '里面没有找到库标记，也没有其他文件。',
      action: 'create-here',
      actionLabel: '在这里新建库'
    }
  }
  if (!hasMetadata && dirEmpty === false) {
    return {
      title: '这个文件夹里已经有稿子',
      detail: '可以新建一个库并把稿子复制进去：原文件夹一个字都不会动。',
      action: 'import-here',
      actionLabel: '导入这个文件夹'
    }
  }
  if (code === 'PRIMARY_CARRIER_MISSING') {
    return {
      title: '这个库还没选主模块',
      detail: '选一个主模块（小说或剧本）就能开始写了。',
      action: 'pick-primary',
      actionLabel: '去选'
    }
  }
  if (code === 'DEPENDENCY_UNMET') {
    return {
      title: '这个库缺一些模块',
      detail: String(error?.message ?? '').replace(/DEPENDENCY_UNMET[:：]?\s*/u, '') || '有模块的依赖没有就位。',
      action: 'open-modules',
      actionLabel: '打开模块管理'
    }
  }
  return {
    title: '这个库打不开',
    detail: String(error?.message ?? '未知原因'),
    action: null,
    actionLabel: null
  }
}

/* ---------- 载体注册表（本仓自持的最小注册面：只装清单声明，impl 空） ---------- */

/**
 * 唯一注册入口（与被删 vendor pluginRegistry 的消费合同对齐：install/get/list/manifests/
 * rejected；装载失败不抛异常、不进启用集，只记进 rejected——M1 的故障隔离语义）。
 */
export function createRegistry(options = {}) {
  const kinds = options.kinds ?? null
  const manifests = new Map()
  const rejected = []

  /** dataDirs 的物理名必须是项目根下的一级目录名（vendor projectSkeleton.validatePhysicalDir 同判）。 */
  function validateDataDirs(dataDirs) {
    if (!dataDirs || typeof dataDirs !== 'object' || Array.isArray(dataDirs)) {
      return fail('INVALID_MANIFEST', 'dataDirs 必须是对象')
    }
    for (const dir of Object.values(dataDirs)) {
      if (typeof dir !== 'string' || !dir.trim()) {
        return fail('INVALID_MANIFEST', 'dataDirs 的物理目录名不能为空')
      }
      if (dir.includes(String.fromCharCode(92)) || dir.includes('/') || dir.includes(':') || dir === '.' || dir === '..' || dir === METADATA_DIR) {
        return fail('INVALID_MANIFEST', 'dataDirs 物理目录必须是项目根下的一级目录名：' + dir, { dir })
      }
    }
    return ok(true)
  }

  return {
    rejected,

    /** 已安装清单（resolveClosure 的闭包按这份算）。 */
    manifests() {
      return manifests
    },

    /** 装载：最小校验（id／projectKind／dataDirs）→ id 查重 → 存清单。 */
    install(manifestInput, impl = {}, meta = {}) {
      void impl
      void meta
      if (!manifestInput || typeof manifestInput !== 'object' || Array.isArray(manifestInput)) {
        const rejection = fail('INVALID_MANIFEST', '载体清单必须是对象')
        rejected.push({ pluginId: '(未命名)', stage: 'manifest', error: rejection.error })
        return rejection
      }
      const pluginId = String(manifestInput.id ?? '')
      if (!pluginId) {
        const rejection = fail('INVALID_MANIFEST', '载体清单必须有非空 id')
        rejected.push({ pluginId: String(manifestInput.title ?? '(未命名)'), stage: 'manifest', error: rejection.error })
        return rejection
      }
      const projectKind = manifestInput.primary?.projectKind
      if (!isKnownKind(projectKind) || (kinds && !kinds.includes(projectKind))) {
        const rejection = fail('INVALID_MANIFEST', '载体清单的 primary.projectKind 不在支持范围：' + String(projectKind), { projectKind })
        rejected.push({ pluginId, stage: 'manifest', error: rejection.error })
        return rejection
      }
      const dirs = validateDataDirs(manifestInput.dataDirs)
      if (!dirs.ok) {
        rejected.push({ pluginId, stage: 'manifest', error: dirs.error })
        return dirs
      }
      if (manifests.has(pluginId)) {
        const duplicate = fail('DUPLICATE_PLUGIN', '载体 id 已注册：' + pluginId, { pluginId })
        rejected.push({ pluginId, stage: 'duplicate', error: duplicate.error })
        return duplicate
      }
      manifests.set(pluginId, manifestInput)
      return ok({ manifest: manifestInput })
    },

    get(pluginId) {
      return manifests.get(pluginId) ?? null
    },

    list() {
      return [...manifests.values()]
    }
  }
}

/** 建库/修主模块共用的载体注册表：从本仓载体表装声明（进程内单例由调用方缓存）。 */
export async function createCarrierRegistry() {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const installed = []
  const skipped = []
  for (const [id, entry] of Object.entries(CARRIERS)) {
    const manifest = {
      id,
      title: CARRIER_TITLES[id] ?? id,
      primary: { projectKind: entry.projectKind },
      dataDirs: { ...entry.dataDirs },
      requires: []
    }
    const result = registry.install(manifest, {}, {})
    if (result && result.ok === false) {
      skipped.push({ id, reason: result.error?.message ?? 'install 拒收' })
      continue
    }
    installed.push(id)
  }
  return { registry, installed, skipped }
}

/**
 * 依赖闭包（vendor capabilityGraph.resolveClosure 在本仓载体表上的退化形）：
 * 两载体 requires 均为 []（vendor 清单逐字一致），闭包＝种子本身——装了的进 enabled
 * （按首次出现序，Set 去重），没装的原样记 unresolvable（种子语义，requiredBy 为 null）。
 */
export function resolveClosure(manifests, seedIds) {
  const resolved = new Set()
  const unresolvable = []
  for (const seed of seedIds) {
    const id = String(seed ?? '')
    if (resolved.has(id)) continue
    if (!manifests.get(id)) {
      unresolvable.push({ id, requiredBy: null, reason: '未安装' })
      continue
    }
    resolved.add(id)
  }
  return { enabled: [...resolved], unresolvable }
}
