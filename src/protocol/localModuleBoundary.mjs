/**
 * 本机模块 import 图静态扫描（OS-196 G3）。
 *
 * 纯函数：吃 `{ path, source }`（path 为相对包目录的 posix 路径），不读盘、不执行代码。
 * 规则只有一条主线：本机模块只许 import node: 内置模块与自己包内的相对路径；
 * 越出包目录、裸包名、非字面量动态 import、createRequire/eval/new Function 一律拒装。
 *
 * 扫描从 entry 开始，沿包内相对路径闭包推进——「入口＋传递依赖」都在面内，
 * 包里没人 import 的坏文件不算越界（信任边界是可执行图，不是目录清单）。
 */
const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/gu
const NON_LITERAL_IMPORT_RE = /\bimport\s*\(\s*(?!['"])/gu
const FORBIDDEN_CALL_RE = /\b(?:createRequire\s*\(|eval\s*\(|new\s+Function\s*\()/gu
const CODE_EXT_RE = /\.(?:mjs|js)$/u
const DATA_EXT_RE = /\.(?:json|css|txt)$/u

const text = (value) => String(value ?? '')
const posix = (value) => text(value).replaceAll('\\', '/')

function withoutComments(source) {
  return text(source)
    .replace(/\/\*[\s\S]*?\*\//gu, '')
    .replace(/^\s*\/\/.*$/gmu, '')
}

/** 相对说明符解析：解析不出的（越出包根）返回 null。 */
function resolveRelative(fromPath, spec) {
  const parts = posix(fromPath).split('/').slice(0, -1)
  for (const segment of posix(spec).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      if (!parts.length) return null
      parts.pop()
    } else if (segment.includes(':')) return null
    else parts.push(segment)
  }
  return parts.join('/')
}

function violation(file, line, spec, reason) {
  return { file: text(file), line: Number(line) || 1, spec: text(spec), reason }
}

/**
 * @param {Array<{path:string, source:string}>} files 包内文件（入口＋候选依赖）
 * @param {{entry?:string}} options 入口相对路径，缺省 index.mjs
 * @returns {{ok:boolean, violations:Array, visited:Array<{path:string, source:string}>}}
 */
export function scanModuleImportGraph(files = [], { entry = 'index.mjs' } = {}) {
  const list = (Array.isArray(files) ? files : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ path: posix(item.path).replace(/^\.\//u, ''), source: text(item.source) }))
  const byPath = new Map(list.map((item) => [item.path, item]))
  const start = posix(entry).replace(/^\.\//u, '')
  const entryFile = byPath.get(start)
  const violations = []
  if (!entryFile) {
    return {
      ok: false,
      violations: [violation(start, 1, start, 'ENTRY_NOT_FOUND')],
      visited: []
    }
  }
  const visited = []
  const seen = new Set()
  const queue = [start]
  while (queue.length) {
    const path = queue.shift()
    if (seen.has(path)) continue
    seen.add(path)
    const file = byPath.get(path)
    if (!file) continue
    visited.push({ path: file.path, source: file.source })
    const source = withoutComments(file.source)
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[2]
      const line = source.slice(0, match.index).split('\n').length
      if (spec.startsWith('node:')) continue
      if (spec.includes('\\') || /^[a-zA-Z]:\//u.test(spec)) {
        violations.push(violation(path, line, spec, 'ABSOLUTE_SPECIFIER'))
        continue
      }
      if (!spec.startsWith('./') && !spec.startsWith('../')) {
        violations.push(violation(path, line, spec, 'BARE_SPECIFIER'))
        continue
      }
      const target = resolveRelative(path, spec)
      if (!target) {
        violations.push(violation(path, line, spec, 'OUT_OF_PACKAGE_IMPORT'))
        continue
      }
      if (!byPath.has(target) && !DATA_EXT_RE.test(target)) {
        violations.push(violation(path, line, spec, 'IMPORT_TARGET_MISSING'))
        continue
      }
      if (CODE_EXT_RE.test(target) && !seen.has(target)) queue.push(target)
    }
    for (const match of source.matchAll(NON_LITERAL_IMPORT_RE)) {
      violations.push(violation(path, source.slice(0, match.index).split('\n').length, '', 'DYNAMIC_IMPORT_NOT_LITERAL'))
    }
    for (const match of source.matchAll(FORBIDDEN_CALL_RE)) {
      violations.push(violation(path, source.slice(0, match.index).split('\n').length, '', 'FORBIDDEN_RUNTIME_EVAL'))
    }
  }
  visited.sort((left, right) => left.path.localeCompare(right.path))
  return { ok: violations.length === 0, violations, visited }
}

/** 一句话报告，供 /api/plugins 的 gate reason 直接显示。 */
export function describeBoundaryViolation(item) {
  const at = `${item.file}:${item.line}`
  if (item.reason === 'OUT_OF_PACKAGE_IMPORT') return `${at} import 越出包目录：${item.spec}`
  if (item.reason === 'BARE_SPECIFIER') return `${at} 不许裸包名：${item.spec}`
  if (item.reason === 'DYNAMIC_IMPORT_NOT_LITERAL') return `${at} 动态 import 必须是字面量`
  if (item.reason === 'FORBIDDEN_RUNTIME_EVAL') return `${at} 不许 createRequire/eval/new Function`
  if (item.reason === 'IMPORT_TARGET_MISSING') return `${at} 包内依赖不存在：${item.spec}`
  if (item.reason === 'ABSOLUTE_SPECIFIER') return `${at} 不许绝对路径 import：${item.spec}`
  if (item.reason === 'ENTRY_NOT_FOUND') return `${at} 入口文件不存在`
  return `${at} ${item.reason}`
}
