/**
 * 本机模块 import 图静态扫描（OS-196 G3；OS-196a 降级为预览提示）。
 *
 * 纯函数：吃 `{ path, source }`（path 为相对包目录的 posix 路径），不读盘、不执行代码。
 * 这条扫描**不是边界门的唯一依据**：真正的强制在 src/host/moduleBoundaryHooks.mjs 的
 * 运行期解析钩子里（realpath 比对，越界在加载那一刻抛错）。本扫描只在预览里点名可疑行，
 * 并且能识别「字符串藏注释符吃 import」「createRequire 改名」「eval 的 unicode 转义」
 * 「间接 eval」「裸 Function/AsyncFunction 构造器」「getBuiltinModule 取 node:module」
 * 「node:module 命名空间取 createRequire」这些静态绕法。
 *
 * 注意：登记的模块与本进程同权限，这不是沙箱——eval/Function 直接摸 process、
 * node:fs 等内置模块都是允许的。钩子只管住「import/require 解析到包外」这一件事。
 */
const IMPORT_RE = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/gu
const NON_LITERAL_IMPORT_RE = /\bimport\s*\(\s*(?!['"])/gu
const FORBIDDEN_CALL_RE = /\b(?:createRequire|eval|Function|AsyncFunction|getBuiltinModule)\s*\(|\(\s*0\s*,\s*eval\s*\)\s*\(|\.\s*constructor\s*\(|\bgetPrototypeOf\s*\(\s*async\s+function/gu
const CODE_EXT_RE = /\.(?:mjs|js|cjs)$/u
const DATA_EXT_RE = /\.(?:json|css|txt)$/u

const text = (value) => String(value ?? '')
const posix = (value) => text(value).replaceAll('\\', '/')

/**
 * 剥注释但保留字符串/模板字面量原样——绕法1 就是把 `/*` 放进字符串，让后面的
 * 越界 import 被朴素的正则剥成注释。这里按词法状态跳过字符串内部。
 */
function withoutComments(source) {
  const src = text(source)
  let out = ''
  let index = 0
  while (index < src.length) {
    const ch = src[index]
    if (ch === '/' && src[index + 1] === '*') {
      index += 2
      while (index < src.length && !(src[index] === '*' && src[index + 1] === '/')) index += 1
      index += 2
      out += ' '
      continue
    }
    if (ch === '/' && src[index + 1] === '/') {
      while (index < src.length && src[index] !== '\n') index += 1
      out += '\n'
      continue
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch
      out += ch
      index += 1
      while (index < src.length) {
        if (src[index] === '\\') { out += src.slice(index, index + 2); index += 2; continue }
        out += src[index]
        index += 1
        if (src[index - 1] === quote) break
      }
      continue
    }
    out += ch
    index += 1
  }
  return out
}

/** 把 `\u0061` 这类标识符转义解码后再匹配——绕法3 的 ev\u0061l 才能点名。 */
function decodeEscapes(source) {
  return text(source).replace(/\\u([0-9a-fA-F]{4})/gu, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
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
 * @param {Array<{path:string, source:string}>} files 包内文件（入口＋候选依赖，含 JSON 数据）
 * @param {{entry?:string, entries?:string[]}} options 入口相对路径；entries 给定时取代单个 entry
 * @returns {{ok:boolean, violations:Array, visited:Array<{path:string, source:string}>}}
 */
export function scanModuleImportGraph(files = [], { entry = 'index.mjs', entries = [] } = {}) {
  const list = (Array.isArray(files) ? files : [])
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ path: posix(item.path).replace(/^\.\//u, ''), source: text(item.source) }))
  const byPath = new Map(list.map((item) => [item.path, item]))
  // OS-197a：模块入口与 migrations[].entry 都是会在本进程执行的可执行依赖，
  // 两者都作为图的根——迁移入口及其传递依赖同样进摘要、同样过边界扫描。
  const starts = Array.isArray(entries) && entries.length ? entries : [entry]
  const queue = []
  const violations = []
  for (const value of starts) {
    const key = posix(value).replace(/^\.\//u, '')
    if (!key || key.split('/').some((part) => !part || part === '.' || part === '..')) {
      violations.push(violation(key || text(value), 1, text(value), 'ENTRY_NOT_FOUND'))
    } else if (!byPath.has(key)) {
      violations.push(violation(key, 1, key, 'ENTRY_NOT_FOUND'))
    } else if (!queue.includes(key)) {
      queue.push(key)
    }
  }
  const visited = []
  const seen = new Set()
  while (queue.length) {
    const path = queue.shift()
    if (seen.has(path)) continue
    seen.add(path)
    const file = byPath.get(path)
    if (!file) continue
    visited.push({ path: file.path, source: file.source })
    if (!CODE_EXT_RE.test(path)) continue // JSON/CSS 数据依赖只进摘要，不扫 import
    const source = decodeEscapes(withoutComments(file.source))
    for (const match of source.matchAll(IMPORT_RE)) {
      const spec = match[2]
      const line = source.slice(0, match.index).split('\n').length
      if (spec.startsWith('node:')) {
        // node:module 的 createRequire 是包外 require 的入口，静态点名；运行期钩子也会挡真实的 require。
        if (spec === 'node:module') violations.push(violation(path, line, spec, 'FORBIDDEN_MODULE_API'))
        continue
      }
      if (spec.includes('\\') || /^[a-zA-Z]:\//u.test(spec) || /^[a-z][a-z\d+.-]*:/iu.test(spec)) {
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
      if (!byPath.has(target)) {
        violations.push(violation(path, line, spec, DATA_EXT_RE.test(target) ? 'DATA_DEPENDENCY_MISSING' : 'IMPORT_TARGET_MISSING'))
        continue
      }
      if (!seen.has(target)) queue.push(target)
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

/** 一句话报告，供 /api/plugins 的 gate reason 和预览提示直接显示。 */
export function describeBoundaryViolation(item) {
  const at = `${item.file}:${item.line}`
  if (item.reason === 'OUT_OF_PACKAGE_IMPORT') return `${at} import 越出包目录：${item.spec}`
  if (item.reason === 'BARE_SPECIFIER') return `${at} 不许裸包名：${item.spec}`
  if (item.reason === 'DYNAMIC_IMPORT_NOT_LITERAL') return `${at} 动态 import 必须是字面量`
  if (item.reason === 'FORBIDDEN_RUNTIME_EVAL') return `${at} 不许 createRequire/eval/Function/getBuiltinModule 等运行期取道（含转义、间接调用、构造器绕法）`
  if (item.reason === 'FORBIDDEN_MODULE_API') return `${at} 不许 import node:module 取 createRequire（运行期 require 越界）`
  if (item.reason === 'IMPORT_TARGET_MISSING') return `${at} 包内依赖不存在：${item.spec}`
  if (item.reason === 'DATA_DEPENDENCY_MISSING') return `${at} 包内数据依赖不存在：${item.spec}`
  if (item.reason === 'ABSOLUTE_SPECIFIER') return `${at} 不许绝对路径/URL import：${item.spec}`
  if (item.reason === 'ENTRY_NOT_FOUND') return `${at} 入口文件不存在`
  return `${at} ${item.reason}`
}
