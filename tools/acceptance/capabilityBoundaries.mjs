/**
 * OS-195 边界门禁的纯扫描器：量真实静态耦合，不再按「只准经转供叶」定义出来的零。
 *
 * 四条规则（AGENTS.md R-a～R-d）：
 *   R-a 内核实现只有一个静态入口（实现登记表 capabilityImplementations.mjs）；
 *   R-b 工作台内部实现只许被本模块的 handler 与前端视图触及；
 *   R-c src/protocol/ 零转供叶（export ... from '../modules/...'）；
 *   R-d src/services/ 只留底座服务（本文件给出清单与归属，供 S2.7 如实呈现）。
 *
 * 规则只依赖源码文本，不执行模块；动态 activate 的真实执行由
 * checkModuleActivation.mjs 在独立进程里验证。
 */
import { scanImportSpecs, resolveSpec } from './importScan.mjs'

const RESOURCE_ROOTS = ['suites/', 'styles/', 'runtimes/', 'genres/', 'skills/']
const KERNEL_IDS = ['agent-runtime', 'deduce', 'fact', 'media', 'prose', 'storage', 'text']
/** OS-195：唯一允许静态 import 内核实现的位置——实现登记表。 */
const IMPLEMENTATION_REGISTRY = 'src/protocol/capabilityImplementations.mjs'

const isResource = (dep) => /\.(?:json|md|css|html)$/u.test(dep) && RESOURCE_ROOTS.some((root) => dep.startsWith(root))
export const moduleDirOf = (rel) => {
  const match = /^src\/modules\/([^/]+)\//u.exec(rel)
  return match ? `src/modules/${match[1]}/` : null
}
const kernelIdOf = (rel) => {
  const match = /^src\/modules\/([^/]+)\//u.exec(rel)
  return match && KERNEL_IDS.includes(match[1]) ? match[1] : null
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
 * S2.1（新口径）：直接数静态 import。
 *  · src/modules/** 之内：只许 node:/协议/本模块/套件资源；跨模块、反向依赖宿主/服务＝红；
 *  · src/modules/** 之外：只许实现登记表静态 import 模块内部实现；其余＝红；
 *  · src/protocol/** 里 export ... from '../modules/...' 单独由 auditKernelDirectImports 计。
 */
export function auditCapabilityRoutes(files) {
  const violations = []
  for (const edge of relativeEdges(files)) {
    const { from, to, line } = edge
    if (isResource(to)) continue
    const moduleDir = moduleDirOf(from)
    if (moduleDir) {
      if (to.startsWith('src/protocol/') || to.startsWith(moduleDir)) continue
      if (to.startsWith('src/modules/') || to.startsWith('src/host/') || to.startsWith('src/api/') || to.startsWith('src/services/')) {
        violations.push({ ...edge, reason: '工作台内部实现只许本模块 handler/前端视图触及；跨模块或反向依赖底座＝红（R-b）' })
      }
      continue
    }
    if (to.startsWith('src/modules/')) {
      if (from === IMPLEMENTATION_REGISTRY) continue // 唯一静态入口（R-a）
      violations.push({ ...edge, reason: 'src/modules/** 之外只有实现登记表可静态 import 模块内部实现（R-a/R-b）' })
    }
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

/**
 * S2.11（并入 S2.1/S2.4'/S2.7）：内核↔内核零直连；protocol 零转供叶；
 * services/api/host 对模块内部实现零静态 import。五类计数都必须是 0。
 */
export function auditKernelDirectImports(files) {
  const violations = []
  const counts = { kernelToKernel: 0, servicesToKernel: 0, protocolLeaves: 0, apiToKernel: 0, hostToKernel: 0 }
  for (const edge of relativeEdges(files)) {
    const { from, to, line } = edge
    const fromKernel = kernelIdOf(from)
    const toKernel = kernelIdOf(to)
    if (fromKernel && toKernel && fromKernel !== toKernel) {
      counts.kernelToKernel += 1
      violations.push({ ...edge, reason: '内核件之间只许经 context.resolve 句柄（K2/R-a）' })
    }
    if (from.startsWith('src/services/') && toKernel) {
      counts.servicesToKernel += 1
      violations.push({ ...edge, reason: '底座服务只经实现登记表/句柄取能力；不在顶层持有内核实现（K4）' })
    }
    if (from.startsWith('src/api/') && toKernel) {
      counts.apiToKernel += 1
      violations.push({ ...edge, reason: '契约壳只注册与分派，不得直连内核实现' })
    }
    if (from.startsWith('src/host/') && toKernel) {
      counts.hostToKernel += 1
      violations.push({ ...edge, reason: '宿主只走能力句柄/底座契约，不得直连内核实现' })
    }
    if (from.startsWith('src/protocol/') && to.startsWith('src/modules/')) {
      const sourceLine = (files.find((file) => file.rel === from)?.src ?? '').split('\n')[line - 1] ?? ''
      if (/\bexport\b/u.test(sourceLine)) {
        counts.protocolLeaves += 1
        violations.push({ ...edge, reason: 'src/protocol 零转供叶（R-c）' })
      }
    }
  }
  return { violations, counts }
}

/**
 * S2.4'（新口径）：内核管道件不得反向依赖协议/模块；host 不得直取模块实现；
 * core/vendor 不得回潮；物理原子写只有内核一份实现。不再有转供叶豁免。
 */
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
      violations.push({ ...edge, reason: '底座宿主直引模块实现；OS-195 起无转供叶豁免（R-b）' })
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

/** 提取足够大的函数声明/箭头函数体，用于识别协议是否抄了一份模块实现。 */
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

/** 协议文件不得复制任何模块实现的完整函数体（改名/改箭头也拒绝）；薄 resolver 包装允许。 */
export function auditTransferDuplication(files) {
  const modules = files.filter((file) => file.rel.startsWith('src/modules/'))
  const violations = []
  for (const file of files.filter((item) => item.rel.startsWith('src/protocol/'))) {
    for (const fn of functions(file.src)) {
      const copied = modules.find((target) => functions(target.src).some((candidate) => candidate.body === fn.body))
      if (copied) {
        const candidate = functions(copied.src).find((item) => item.body === fn.body)
        violations.push({ from: file.rel, to: copied.rel, line: 1, reason: `协议复制了模块实现函数 ${fn.name}${candidate.name !== fn.name ? `（目标名 ${candidate.name}）` : ''}，底座契约必须自有实现或纯转供` })
      }
    }
  }
  return violations
}

/**
 * OS-195 四条规则的实测数字（供 S2.7 直接呈现；无白名单）。
 * R-d 用清单+出处说明而不是放行表：src/services/ 里剩下的文件逐个归类为
 * 「底座资源装载」「跨内核底座服务」或「OS-193 遗留兼容叶」。
 */
export function boundaryInventory(files) {
  const direct = auditKernelDirectImports(files)
  const routes = auditCapabilityRoutes(files)
  const base = auditBaseBoundary(files)
  const duplicates = auditTransferDuplication(files)
  const outsideModuleImports = routes.filter((item) => !item.from.startsWith('src/modules/')).length
  const crossModuleImports = routes.filter((item) => item.from.startsWith('src/modules/') && item.to.startsWith('src/modules/')).length
  const apiHostServicesToWorkbench = routes.filter((item) => /^src\/(api|host|services)\//u.test(item.from) && item.to.startsWith('src/modules/') && !KERNEL_IDS.includes(moduleDirOf(item.to)?.split('/').pop())).length
  const serviceFiles = files.filter((file) => file.rel.startsWith('src/services/')).map((file) => file.rel).sort()
  return {
    counts: {
      outsideModuleImports,
      crossModuleImports,
      apiHostServicesToWorkbench,
      protocolLeaves: direct.counts.protocolLeaves,
      kernelToKernel: direct.counts.kernelToKernel,
      servicesToKernel: direct.counts.servicesToKernel,
      apiToKernel: direct.counts.apiToKernel,
      hostToKernel: direct.counts.hostToKernel,
      baseViolations: base.length,
      transferDuplicates: duplicates.length
    },
    serviceFiles,
    violations: [...routes, ...direct.violations, ...base, ...duplicates]
  }
}
