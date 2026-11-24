/**
 * OpenStory 库管理写操作（OS-7）——新建/登记/诊断/修主模块/扫描/导入。
 *
 * 复用面（两条壳一个真源）：
 *   · 建库：projectDoc.mjs（OS-124 解耦②收编为本仓自持；骨架／project.json 合同／
 *     createProject/initBareProject／载体表与注册表逐字归并自 vendor next/{kernel,project,shell}/，
 *     金样护栏 test/decoupleStep2.test.mjs）；其中库标记读写走模块内组合的 projectMeta；
 *   · 导入：projectImport.planImport/runImport（模块内组合，转引本仓 importAdapter.mjs——
 *     OS-123 解耦①收编为本仓自持；承诺：源目录只读、目标只新增不覆盖、认不出的不猜）；
 *   · 人话：projectDoc.mjs 的 describeOpenFailure/validateLibraryName/folderName
 *     （纯函数无 Vue，A-5 四类失败与 Electron 同一份口径）。
 *
 * 偏好文件纪律：next-preferences.json 只做「读→内存追加/去重→原子写回」；
 * 读不了/坏档＝拒绝登记并如实报，绝不覆盖重写作者电子侧的库清单。
 */
import { existsSync, statSync } from 'node:fs'
import { mkdir, readdir, readFile } from 'node:fs/promises'
import { dirname, isAbsolute, resolve } from 'node:path'
import { atomicWriteFile } from '../../protocol/hostWrite.mjs'
import {
  createRegistry,
  createCarrierRegistry,
  createProject,
  initBareProject,
  PROJECT_KINDS,
  resolveClosure,
  describeOpenFailure,
  validateLibraryName,
  folderName
} from './projectDoc.mjs'
import { projectMeta, projectImport } from './index.mjs' // OS-157：pinaxAdapter 解散后，两组能力由库管理模块内组合（S2.1 ③ 允许）

function text(value) {
  return String(value ?? '')
}

/* ---------- 载体注册表（进程内单例） ---------- */

let registryPromise = null

/** 建库/修主模块共用的载体注册表：装载失败如实抛，不造残废注册表。 */
export function getCarrierRegistry() {
  if (!registryPromise) {
    registryPromise = (async () => {
      // 底座只装清单声明（OpenStory 不调载体工具实现）；实现层随各业务套件上线。
      const { registry } = await createCarrierRegistry()
      return registry
    })()
  }
  return registryPromise
}

/** 测试钩子：清掉单例（改了货架/环境后重建）。 */
export function resetCarrierRegistry() {
  registryPromise = null
}

/** 主载体选择面（OpenStory v1 内嵌修复只给两大主载体，其余指路 Pinax）。 */
export const PRIMARY_CHOICES = Object.freeze([
  { id: 'pinax.carrier.novel', title: '小说', detail: '正文/ 大纲/ 世界书/ 构思/… 骨架' },
  { id: 'pinax.carrier.script', title: '剧本', detail: '剧本/ 人物/ 场景/ 大纲/… 骨架' }
])

/* ---------- 偏好文件登记 ---------- */

function sameLibraryPath(a, b) {
  return text(a).replace(/[\\/]+$/u, '').toLowerCase() === text(b).replace(/[\\/]+$/u, '').toLowerCase()
}

/**
 * 把新库追加进库清单（与 Electron 同一份文件）。已登记＝原样返回 duplicate:true，不重写；
 * 清单文件不存在＝从 {recentProjects:[]} 起一份；坏档＝拒绝（绝不覆盖重写）。
 */
export async function registerLibrary(preferencesPath, root, name) {
  const target = text(preferencesPath).trim()
  if (!target) return { ok: false, code: 'INVALID_ENTRY', message: '没有可写的库清单路径（preferencesPath 为空）' }
  let document = { recentProjects: [] }
  let existed = false
  try {
    document = JSON.parse(await readFile(target, 'utf-8'))
    existed = true
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      return { ok: false, code: 'INVALID_ENTRY', message: `库清单读不了/不是合法 JSON，拒绝登记（不覆盖重写）：${text(error?.message || error)}` }
    }
  }
  if (!document || typeof document !== 'object' || !Array.isArray(document.recentProjects)) {
    return { ok: false, code: 'INVALID_ENTRY', message: '库清单形状不对（缺 recentProjects 数组），拒绝登记（不覆盖重写）' }
  }
  const existing = document.recentProjects.find((item) => item && sameLibraryPath(item.path, root))
  if (existing) {
    return { ok: true, duplicate: true, existed, libraries: document.recentProjects }
  }
  const record = {
    path: resolve(text(root)),
    name: text(name).trim() || folderName(root),
    kind: '未分类',
    count: 0,
    at: new Date().toISOString()
  }
  const recentProjects = [record, ...document.recentProjects]
  await mkdir(dirname(target), { recursive: true })
  await atomicWriteFile(target, JSON.stringify({ ...document, recentProjects }, null, 2))
  return { ok: true, duplicate: false, existed, libraries: recentProjects }
}

/* ---------- 内核失败 → OpenStory 契约失败 ---------- */

/** 内核码（KERNEL_ERROR_CODES）→ OpenStory 契约码；原文进 message/cause，不吞语义。OS-157 起码值已无前缀。 */
export function mapManageError(error) {
  const rawCode = String(error?.code || '')
  const code = rawCode
  const message = text(error?.message || error)
  if (code === 'STALE_REVISION') return { ok: false, code: 'REVISION_MISMATCH', message }
  if (code === 'PATH_OUTSIDE_PROJECT' || code === 'ERR_SOURCE_PATH' || code === 'ERR_TARGET_PATH') {
    return { ok: false, code: 'PATH_ESCAPE', message }
  }
  if (code === 'ENOENT') return { ok: false, code: 'NOT_FOUND', message }
  if (code === 'IO_FAILED') return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message }
  return { ok: false, code: 'INVALID_ENTRY', message, details: rawCode ? { cause: rawCode } : undefined }
}

/* ---------- 建库 ---------- */

/**
 * 新建库：主载体给定走 createProject（骨架＋project.json@3＋依赖闭包）；
 * 缺省走 initBareProject（空壳，needsPrimary:true，停在选主模块那一步）。
 * 成功即登记进库清单。
 */
export async function createLibrary({ path: targetPath, name, primaryCarrier = '', preferencesPath }) {
  const nameError = validateLibraryName(name)
  if (nameError) return { ok: false, code: 'INVALID_ENTRY', message: nameError }
  const rawPath = text(targetPath).trim()
  if (!rawPath || !isAbsolute(rawPath)) {
    return { ok: false, code: 'INVALID_ENTRY', message: '库位置必须是绝对路径（例如 D:\\写作\\长夜）' }
  }
  const registry = await getCarrierRegistry()
  const result = primaryCarrier
    ? await createProject({ root: rawPath, name: text(name).trim(), primaryCarrier, registry })
    : await initBareProject({ root: rawPath, name: text(name).trim() })
  if (!result.ok) {
    return { ...mapManageError(result.error ?? result), details: { ...(result.error?.details ?? result.details ?? {}), cause: String(result.error?.code ?? '') } }
  }
  const registered = await registerLibrary(preferencesPath, result.value.root, text(name).trim())
  if (!registered.ok) {
    // 库已建好、登记失败：如实报「建好了但没进清单」，作者重开 daemon 或手动登记都能救。
    return {
      ok: false,
      code: registered.code,
      message: `库已建成（${result.value.root}），但登记进库清单失败：${registered.message}`
    }
  }
  return {
    ok: true,
    root: result.value.root,
    document: result.value.document,
    ...(result.value.enabled ? { enabled: result.value.enabled } : {}),
    needsPrimary: result.value.needsPrimary === true,
    registered: { duplicate: registered.duplicate === true }
  }
}

/* ---------- 诊断 ---------- */

/**
 * 库形态四件套 → A-5 verdict。verdict.ok＝形态健康（有标记且有主模块）；
 * 其余按 wizardKit.describeOpenFailure 给人话与修复动作。
 */
export async function diagnoseLibrary(root) {
  const target = resolve(text(root))
  const shape = { exists: false, dirEmpty: null, hasPinax: false, project: null }
  let entries = []
  try {
    const stats = statSync(target)
    if (!stats.isDirectory()) {
      return {
        ok: true,
        shape,
        verdict: { ok: false, title: '这个路径不是文件夹', detail: `${target} 是个文件，不是库目录。`, action: null, actionLabel: null }
      }
    }
    shape.exists = true
  } catch {
    return {
      ok: true,
      shape,
      verdict: { ok: false, title: '路径还不存在', detail: `${target} 还没有这个文件夹：新建流会帮你建出来。`, action: 'create-here', actionLabel: '在这里新建库' }
    }
  }
  entries = await readdir(target).catch(() => [])
  shape.dirEmpty = entries.length === 0
  shape.hasPinax = entries.some((name) => name === '.pinax')
  if (!shape.hasPinax) {
    const verdict = describeOpenFailure({}, { hasPinax: false, dirEmpty: shape.dirEmpty })
    return { ok: true, shape, verdict: { ...verdict, ok: false } }
  }
  const document = await projectMeta.readProjectDocument(target)
  if (!document.ok) {
    return {
      ok: true,
      shape,
      verdict: { ok: false, title: '库标记读不了', detail: `.pinax/project.json ${text(document.error?.message || document.error)}`, action: null, actionLabel: null }
    }
  }
  const carriers = document.value.carriers ?? {}
  shape.project = {
    spec: text(document.value.spec),
    kind: text(document.value.kind),
    name: text(document.value.name),
    primary: text(carriers.primary),
    enabled: Array.isArray(carriers.enabled) ? carriers.enabled : []
  }
  if (!shape.project.primary) {
    const verdict = describeOpenFailure({ code: 'PRIMARY_CARRIER_MISSING' }, {})
    return { ok: true, shape, verdict: { ...verdict, ok: false } }
  }
  return {
    ok: true,
    shape,
    verdict: { ok: true, title: '库形态正常', detail: `${shape.project.name || shape.project.kind} · 主模块 ${shape.project.primary}`, action: null, actionLabel: null }
  }
}

/* ---------- 缺主模块修复 ---------- */

/** 裸项目 → 设主模块：依赖闭包装不齐＝拒绝（不造空壳）；revision 乐观并发可选。 */
export async function setPrimaryCarrier({ root, primaryCarrier, expectedRevision }) {
  const registry = await getCarrierRegistry()
  const primary = registry.get(primaryCarrier)
  if (!primary) {
    return { ok: false, code: 'INVALID_ENTRY', message: `主载体插件未安装：${text(primaryCarrier)}` }
  }
  const document = await projectMeta.readProjectDocument(root)
  if (!document.ok) {
    return { ok: false, code: 'NOT_FOUND', message: `读不到库标记：${text(document.error?.message || document.error)}` }
  }
  const projectKind = primary.primary?.projectKind
  if (!projectKind) {
    return { ok: false, code: 'INVALID_ENTRY', message: `主载体没有声明项目类型：${text(primaryCarrier)}` }
  }
  // 换类型＝换骨架，不是本修复该做的事；裸库（kind 空）才允许连类型一起落。
  const existingKind = text(document.value.kind).trim()
  if (existingKind && existingKind !== projectKind) {
    return { ok: false, code: 'INVALID_ENTRY', message: `这个库的类型是「${existingKind}」，与所选主模块的类型「${projectKind}」不一致：换类型去 Pinax 里处理` }
  }
  const closure = resolveClosure(registry.manifests(), [primaryCarrier])
  if (closure.unresolvable.length) {
    return {
      ok: false,
      code: 'INVALID_ENTRY',
      message: `主载体的依赖闭包装不齐，拒绝设主模块：${closure.unresolvable.join(' / ')}`
    }
  }
  const carriers = projectMeta.nextCarriers(document.value.carriers, {
    primary: primaryCarrier,
    enabled: closure.enabled,
    ...(Number.isSafeInteger(expectedRevision) ? { expectedRevision } : {})
  })
  if (!carriers.ok) return mapManageError(carriers.error ?? carriers)
  const next = { ...document.value, kind: projectKind, carriers: carriers.value }
  const written = await projectMeta.writeProjectDocument(root, next)
  if (!written.ok) return mapManageError(written.error ?? written)
  return { ok: true, document: written.value, enabled: carriers.value.enabled }
}

/* ---------- 扫描与导入（源目录只读） ---------- */

function assertSourcePath(sourcePath) {
  const raw = text(sourcePath).trim()
  if (!raw || !isAbsolute(raw)) {
    return { ok: false, code: 'INVALID_ENTRY', message: '源目录必须是绝对路径（例如 D:\\旧稿\\长夜）' }
  }
  if (!existsSync(raw) || !statSync(raw).isDirectory()) {
    return { ok: false, code: 'NOT_FOUND', message: `源目录不存在或不是文件夹：${raw}` }
  }
  return { ok: true }
}

/** 导入预览：只生成计划不落盘。root 由 daemon 侧过库清单白名单。 */
export async function scanLibrary({ root, sourcePath }) {
  const source = assertSourcePath(sourcePath)
  if (!source.ok) return source
  const plan = projectImport.planImport({ sourcePath: text(sourcePath).trim(), targetPath: resolve(text(root)) })
  if (!plan.ok) return mapManageError(plan.error ?? plan)
  return { ok: true, plan: plan.value }
}

/** 执行导入：按计划落盘到目标库的标准目录（只新增不覆盖）。 */
export async function importLibrary({ root, sourcePath }) {
  const source = assertSourcePath(sourcePath)
  if (!source.ok) return source
  const report = projectImport.runImport({ sourcePath: text(sourcePath).trim(), targetPath: resolve(text(root)) })
  if (!report.ok) return mapManageError(report.error ?? report)
  return { ok: true, report: report.value }
}
