/**
 * 模块覆盖面口径（OS-165 / G5d）——测试与验收门禁共用的一份真源。
 *
 * 「内核收缩到协议＋宿主＋fact 链，其余皆插件」不是口号：
 *   · src/modules/ 下每个目录必须有合法 manifest，@2 不得残留 core 字段；
 *   · 每个 handler 端点要么被某模块独占，要么在下面的宿主白名单里（逐组写明理由）；
 *   · 每个未退场页签要么归属某模块，要么是宿主保留页。
 *
 * 白名单只增不减是有意的：新增端点若既无模块归属、又没在这里写下理由，门禁与测试同时红。
 */
import { readdirSync, existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ENDPOINTS } from '../../src/api/contracts.mjs'
import {
  MODULE_MANIFESTS, MODULE_SOURCES, MODULE_SOURCE_GROUPS, MODULE_SPEC,
  CAPABILITY_SNAPSHOT, validateModuleManifest
} from '../../src/protocol/modules.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const MODULES_DIR = join(REPO, 'src', 'modules')

/** 宿主自己拥有的端点：分组列出，每组一行理由（逐条可追溯到理由）。 */
export const HOST_OWNED_ENDPOINTS = Object.freeze({
  '库管理与通用文件通道（库目录是数据而非工作面；文件/目录浏览是宿主能力）': [
    'libraries', 'libraryDiagnose', 'libraryCreate', 'libraryScan', 'libraryImport', 'libraryPrimary',
    'dirCreate', 'filesGet', 'fsBrowse'
  ],
  '修改痕迹（OS-89 立宪：跨模块统一 diff/.history，不属于任何单一工作面）': [
    'changeLogGet', 'changeLogEntry', 'changeLogRestore', 'changeLogSummary', 'draftPut'
  ],
  'fact 共享读与拆解链（多方共用，停用任一模块都不该让事实链消失）': [
    'factCurveGet', 'factEntriesGet', 'factBooksGet', 'factEntriesImport',
    'enrichRun', 'enrichStatus', 'enrichGraph', 'syncCheck'
  ],
  '本机原生选择器（弹系统对话框/资源管理器，无库上下文）': ['nativePick', 'nativeReveal'],
  'Agent 栏与会话（宿主自带对话面，Agent 模块未插件化）': [
    'agentConfigGet', 'agentConfigPut', 'agentRuntimesGet', 'agentRuntimePut', 'agentRuntimeSetup',
    'agentDshModelsGet', 'agentPicksGet', 'agentPicksPut', 'agentSessions', 'agentSessionCreate',
    'agentSessionGet', 'agentSessionRename', 'agentSessionDelete', 'agentChat',
    'agentCardCreate', 'agentCardAdopt', 'agentCardReject'
  ],
  '写作规则资源（风格包/技能/体裁是宿主静态资产，不是工作面）': [
    'stylesGet', 'skillsGet', 'skillGet', 'genresGet'
  ],
  '插件系统自身（插件货架/套件状态不能被插件自己管）': [
    'pluginsGet', 'suitesGet', 'suiteSettingsPut', 'suiteStatePut'
  ],
  '本机模块根信任表（OS-196：机器级授权，未登记不扫描；只能由宿主治理）': [
    'moduleRootsGet', 'moduleRootsPreview', 'moduleRootsAdd', 'moduleRootsRemove', 'moduleRootsRefresh'
  ],
  '进程、配置与后台任务（daemon 本机设施，与库/插件无关）': [
    'healthGet', 'configGet', 'configPut', 'configProbe', 'jobsGet', 'jobCancel', 'jobsClear'
  ],
  '项目简报与界面状态（跨页签的库内设置，不属于单个模块）': [
    'briefGet', 'briefPut', 'uiStateGet', 'uiStatePut', 'uiPreferencesGet', 'uiPreferencesPut'
  ]
})

/** 宿主保留页签：理由逐条写明。 */
export const HOST_OWNED_TABS = Object.freeze({
  log: 'OS-89 修改痕迹自检索——跨模块统一日志，不属于任何单一工作面',
  settings: '宿主本体设置（主题字号/引擎与存储/插件中心），设置页自己不插件化'
})

/**
 * 「仍在 app.js 的渲染函数」宿主保留清单：只收真正的装配壳/通用路由，
 * 模块本体必须已迁 public/views/（由 test/moduleCoverage.test.mjs 的薄壳断言保证）。
 */
export const HOST_KEPT_RENDERERS = Object.freeze({
  writeHtml: '正文页装配壳：章节加载状态机＋逐块编辑提交留在宿主，纯视图已拆 views/chapterLoad.mjs',
  dirViewHtml: '通用目录页路由：write/script/storySource/log 四类共用同一入口，按 state.view 分派',
  deduceHtml: '三行路由壳：引擎/Agent 两分支的状态机留在宿主，纯 HTML 构造在 views/deduceViews.mjs',
  settingsHtml: '宿主设置页本体（内核设置只读区＋插件中心聚合），不插件化'
})

export function hostOwnedEndpointIds() {
  return new Set(Object.values(HOST_OWNED_ENDPOINTS).flat())
}

/** 生成覆盖面报告（纯数据；门禁与测试共用）。 */
export function coverageReport() {
  const manifestIssues = []
  const dirs = readdirSync(MODULES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
    .map((entry) => entry.name)
  const noManifest = []
  const rawManifests = []
  for (const dir of dirs) {
    const file = join(MODULES_DIR, dir, 'module.manifest.json')
    if (!existsSync(file)) { noManifest.push(dir); continue }
    let raw
    try { raw = JSON.parse(readFileSync(file, 'utf-8')) } catch (error) {
      manifestIssues.push(`${dir}: manifest 读不了（${error?.message || error}）`); continue
    }
    rawManifests.push(raw)
    // C6 运行态只认 C 阶段完整形状；B 的缺 class/core 兼容不再作为当前事实。
    const checked = validateModuleManifest(raw, { dirName: dir, stage: 'C' })
    if (!checked.ok) manifestIssues.push(`${dir}: ${checked.errors.join('；')}`)
    else if (checked.manifest.spec !== MODULE_SPEC) manifestIssues.push(`${dir}: spec 非 ${MODULE_SPEC}`)
  }
  const hostEndpoints = hostOwnedEndpointIds()
  const endpointOwners = new Map()
  const endpointOwnerIssues = []
  for (const manifest of rawManifests) {
    for (const endpoint of manifest.endpoints ?? []) {
      const owner = endpointOwners.get(endpoint)
      if (owner && owner !== manifest.id) endpointOwnerIssues.push(`${endpoint}: ${owner}/${manifest.id} 重复独占`)
      endpointOwners.set(endpoint, manifest.id)
    }
  }
  const kernelUiIssues = rawManifests.filter((manifest) => manifest.class === 'kernel')
    .filter((manifest) => ['endpoints', 'pages', 'slots', 'settings', 'settingsHint', 'settingsJump']
      .some((key) => Object.prototype.hasOwnProperty.call(manifest, key) && (Array.isArray(manifest[key]) ? manifest[key].length > 0 : manifest[key] !== undefined)))
    .map((manifest) => manifest.id)
  const workbenchContractIssues = rawManifests.filter((manifest) => manifest.class === 'workbench')
    .filter((manifest) => !manifest.entry || !(manifest.requires?.length > 0) || !(manifest.slots?.length > 0))
    .map((manifest) => manifest.id)
  const claimed = new Set(MODULE_MANIFESTS.flatMap((manifest) => manifest.endpoints))
  const uncoveredEndpoints = Object.keys(ENDPOINTS)
    .filter((id) => !claimed.has(id) && !hostEndpoints.has(id))
  // OS-198：页签归属只看 manifest 的 slots——每个 tab 位置必须落到本模块声明的 page 上。
  const uncoveredTabs = MODULE_MANIFESTS
    .filter((manifest) => manifest.class === 'workbench')
    .flatMap((manifest) => (manifest.slots ?? [])
      .filter((placement) => placement.slot === 'tab')
      .map((placement) => ({ module: manifest.id, page: placement.page })))
    .filter(({ module, page }) => {
      const manifest = MODULE_MANIFESTS.find((item) => item.id === module)
      return !(manifest?.pages ?? []).some((item) => item.id === page)
    })
    .map(({ module, page }) => `${module}:${page}`)
  return {
    moduleDirs: dirs,
    manifestIds: MODULE_MANIFESTS.map((manifest) => manifest.id),
    coreFieldOwners: MODULE_MANIFESTS.filter((manifest) => Object.prototype.hasOwnProperty.call(manifest, 'core')).map((manifest) => manifest.id),
    sourceGroups: MODULE_SOURCE_GROUPS,
    sourceIssues: MODULE_SOURCES.filter((source) => source.source !== 'builtin'
      || source.sourceDir !== `src/modules/${source.id}`
      || !/^[a-f0-9]{64}$/u.test(source.manifestSha256)).map((source) => source.id),
    noManifest,
    manifestIssues,
    kernelUiIssues,
    workbenchContractIssues,
    endpointOwnerIssues,
    capabilityGraphIssues: CAPABILITY_SNAPSHOT.issues.map((issue) => `${issue.code}:${issue.module ?? issue.details?.capability ?? ''}`),
    endpointCount: Object.keys(ENDPOINTS).length,
    claimedEndpointCount: claimed.size,
    hostEndpointCount: hostEndpoints.size,
    uncoveredEndpoints,
    uncoveredTabs
  }
}
