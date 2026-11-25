/**
 * C6 能力路由与底座边界的纯扫描器。
 *
 * 规则只依赖源码文本，不执行模块；动态 activate 的真实执行由
 * checkModuleActivation.mjs 在独立进程里验证，避免门禁自身被导入环拖死。
 */
import { scanImportSpecs, resolveSpec } from './importScan.mjs'

const RESOURCE_ROOTS = ['suites/', 'styles/', 'runtimes/', 'genres/', 'skills/']
const KERNEL_IDS = ['agent-runtime', 'deduce', 'fact', 'media', 'prose', 'storage', 'text']

/** 兼容转供叶：只登记“谁可以转供哪一块实现”，不按整个 modules 目录放行。 */
export const TRANSFER_LEAVES = Object.freeze({
  'src/protocol/index.mjs': ['src/modules/fact/'],
  'src/protocol/factStore.mjs': ['src/modules/fact/'],
  'src/protocol/factDomain.mjs': ['src/modules/fact/'],
  'src/protocol/chapters.mjs': ['src/modules/prose/'],
  'src/protocol/chapterWrite.mjs': ['src/modules/prose/'],
  'src/protocol/text.mjs': ['src/modules/text/'],
  'src/protocol/media.mjs': ['src/modules/media/'],
  'src/protocol/agentRuntime.mjs': ['src/modules/agent-runtime/'],
  'src/protocol/worldbookContract.mjs': ['src/modules/worldbook/'],
  // C6 兼容转供叶逐文件点名；叶内只允许 re-export/显式绑定，复制实现由下方审计拒绝。
  'src/protocol/agentStore.mjs': ['src/modules/agentbar/agentStore.mjs'],
  'src/protocol/courtyard.mjs': ['src/modules/storage/courtyard.mjs'],
  'src/protocol/deduceSession.mjs': ['src/modules/deduce/deduceSession.mjs'],
  'src/protocol/habits.mjs': ['src/modules/habits/habits.mjs'],
  'src/protocol/kbAdapter.mjs': ['src/modules/kb/kbAdapter.mjs'],
  'src/protocol/kbHealth.mjs': ['src/modules/kb/kbHealth.mjs'],
  'src/protocol/kbRouter.mjs': ['src/modules/kb/kbRouter.mjs'],
  'src/protocol/libraryImport.mjs': ['src/modules/library/index.mjs'],
  'src/protocol/libraryInventory.mjs': ['src/modules/library/inventory.mjs'],
  'src/protocol/pediaAdapter.mjs': ['src/modules/exchange/pediaAdapter.mjs'],
  'src/protocol/referenceStore.mjs': ['src/modules/worldbook/referenceStore.mjs'],
  'src/protocol/roleplayEngine.mjs': ['src/modules/roleplay/roleplayEngine.mjs'],
  'src/protocol/capabilityImplementations.mjs': KERNEL_IDS.map((id) => `src/modules/${id}/`),
  // 能力句柄组合根与旧院子纯转供叶是显式兼容点，不放开其它 host 文件。
  'src/host/capabilityBindings.mjs': KERNEL_IDS.map((id) => `src/modules/${id}/`),
  'src/host/courtyard.mjs': ['src/modules/storage/']
})

const startsWithAny = (value, prefixes) => prefixes.some((prefix) => value.startsWith(prefix))
const isResource = (dep) => /\.(?:json|md|css|html)$/u.test(dep) && startsWithAny(dep, RESOURCE_ROOTS)
const moduleDirOf = (rel) => {
  const match = /^src\/modules\/([^/]+)\//u.exec(rel)
  return match ? `src/modules/${match[1]}/` : null
}

function relativeEdges(files) {
  const edges = []
  for (const { rel, src } of files) {
    for (const { spec, line } of scanImportSpecs(src)) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue
      edges.push({ from: rel, to: resolveSpec(rel, spec), spec, line })
    }
  }
  return edges
}

/**
 * S2.1：模块只能 node/protocol/本模块；API、服务、宿主消费模块必须经协议或能力句柄。
 * 协议只允许上表转供；动态 import() 与静态 from/export 使用同一扫描器。
 */
export function auditCapabilityRoutes(files) {
  const violations = []
  for (const edge of relativeEdges(files)) {
    const { from, to, line } = edge
    if (isResource(to)) continue
    const moduleDir = moduleDirOf(from)
    if (moduleDir) {
      if (to.startsWith('src/protocol/') || to.startsWith(moduleDir)) continue
      violations.push({ ...edge, reason: '模块跨层/跨模块直引；改经 protocol 或能力句柄' })
      continue
    }
    if (!to.startsWith('src/modules/')) continue
    const allowed = TRANSFER_LEAVES[from]
    if (allowed && startsWithAny(to, allowed)) continue
    violations.push({ ...edge, reason: '底座/契约/服务/协议直引模块实现；改经协议转供或能力句柄' })
  }
  for (const { rel, src } of files) {
    if (!rel.startsWith('src/modules/')) continue
    for (const { spec, line } of scanImportSpecs(src)) {
      if (spec.startsWith('node:') || spec.startsWith('./') || spec.startsWith('../')) continue
      violations.push({ from: rel, to: spec, spec, line, reason: '模块只许 node: 内置与仓内相对说明符' })
    }
  }
  return violations
}

/** S2.4'：内核管道件不得反向依赖协议/模块；宿主不得直取模块实现；core/vendor 不得回潮。 */
export function auditBaseBoundary(files) {
  const violations = []
  for (const edge of relativeEdges(files)) {
    const { from, to, line } = edge
    if (/(?:^|\/)core\/|(?:^|\/)vendor\//u.test(to)) {
      violations.push({ ...edge, reason: 'core/vendor 已退役，不得出现陈旧路径' })
    }
    if (from.startsWith('src/kernel/') && !to.startsWith('src/kernel/')) {
      violations.push({ ...edge, reason: 'src/kernel 管道件只能依赖 node: 与内核内部文件' })
    }
    if (from.startsWith('src/host/') && to.startsWith('src/modules/')) {
      const allowed = TRANSFER_LEAVES[from]
      if (!allowed || !startsWithAny(to, allowed)) {
        violations.push({ ...edge, reason: '底座宿主直引模块实现；动态装载/能力句柄/显式转供叶以外均拒绝' })
      }
    }
    if (from.startsWith('src/host/') && to.startsWith('public/')) {
      violations.push({ ...edge, reason: '底座不得反向依赖前端' })
    }
  }
  for (const { rel, src } of files.filter((file) => !file.rel.startsWith('src/kernel/'))) {
    if (/\bfunction\s+writeFileAtomic\s*\(/u.test(src)) {
      violations.push({ from: rel, to: 'writeFileAtomic', line: 1, reason: '物理原子写实现只能留在 src/kernel/' })
    }
  }
  return violations
}

/** 提取足够大的函数声明/箭头函数体，用于识别兼容叶是否抄了一份实现而不是 re-export。 */
function functions(src) {
  const out = []
  const re = /\b(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{|(?:^|[;\n])\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*\{/gmu
  for (const match of src.matchAll(re)) {
    const open = match.index + match[0].length - 1
    let depth = 0
    let close = open
    for (; close < src.length; close++) {
      if (src[close] === '{') depth++
      else if (src[close] === '}' && --depth === 0) break
    }
    const body = src.slice(open + 1, close)
    if (body.length < 120) continue
    out.push({ name: match[1] || match[2], body: body.replace(/\s+/gu, ' ').trim() })
  }
  return out
}

/** 转供叶不得出现与目标实现相同的完整函数体（改名/函数改箭头也不能绕过）；薄 resolver 包装允许存在。 */
export function auditTransferDuplication(files) {
  const byRel = new Map(files.map((file) => [file.rel, file.src]))
  const violations = []
  for (const [leaf, prefixes] of Object.entries(TRANSFER_LEAVES).filter(([rel]) => rel.startsWith('src/protocol/'))) {
    const source = byRel.get(leaf)
    if (!source) continue
    const targets = files.filter((file) => startsWithAny(file.rel, prefixes))
    for (const fn of functions(source)) {
      const copied = targets.find((target) => functions(target.src).some((candidate) => candidate.body === fn.body))
      if (copied) {
        const candidate = functions(copied.src).find((item) => item.body === fn.body)
        violations.push({ from: leaf, to: copied.rel, line: 1, reason: `转供叶复制了实现函数 ${fn.name}${candidate.name !== fn.name ? `（目标名 ${candidate.name}）` : ''}，必须 re-export` })
      }
    }
  }
  return violations
}
