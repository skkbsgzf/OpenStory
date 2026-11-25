/**
 * 验收门禁共用 import 扫描器（OS-150b）。
 *
 * 为什么抽成模块：S2.1（src/ 模块纪律）与 S2.2（public/ 前端模块隔离）必须用**同一份**
 * 说明符扫描逻辑——两份正则一旦分叉，动态 `import('./x.mjs')` 这类写法就会在某一侧漏检
 * （OS-150a 复核实证：S2.2 只看静态 `from`，analysisModules.mjs 的惰性 import 一直绿着）。
 *
 * 扫描面（只许更严，不许放松）：
 *   · 静态 `import ... from 'x'` / `export ... from 'x'`；
 *   · 动态 `import('x')`（含跨行空白）；
 *   · 副作用导入 `import 'x'`；
 *   · 单双引号说明符一视同仁；`.js` 与 `.mjs` 都在扫描面（指不指向仓内文件由调用方判定）。
 *
 * 不做的事：不剥注释、不剥字符串字面量。宁可多报（注释里写一行 import 也算依赖）
 * 也不放过真实依赖——门禁误报只需在豁免表登记一行，漏报则会让真耦合长期潜伏。
 *
 * 纯函数、零依赖：Node 测试可直接 import（test/importScan.test.mjs）。
 */

/** 说明符扫描：返回 [{ spec, index, line }]，line 从 1 起。 */
export function scanImportSpecs(src) {
  const source = String(src ?? '')
  const out = []
  // 三个入口前面都要求 import/from 关键字边界，避免把 `transform '+x'` 一类标识符当依赖。
  // from 后必须有空白：对象字段 `from: 'x'`、`from, 'x'` 不是 import 说明符。
  const re = /(?:\bfrom\s+|\bimport\s*\(\s*|\bimport\s+)(['"])([^'"\n]+)\1/gu
  for (const match of source.matchAll(re)) {
    out.push({
      spec: match[2],
      index: match.index,
      line: source.slice(0, match.index).split('\n').length
    })
  }
  return out
}

/** 相对说明符 → 仓内路径（`public/views/a.mjs` + `./b.mjs` ＝ `public/views/b.mjs`）。 */
export function resolveSpec(fileRel, spec) {
  const parts = fileRel.includes('/') ? fileRel.slice(0, fileRel.lastIndexOf('/')).split('/') : []
  for (const seg of String(spec).split('/')) {
    if (seg === '.') continue
    else if (seg === '..') parts.pop()
    else parts.push(seg)
  }
  return parts.join('/')
}

/**
 * 前端模块边的显式豁免表（OS-150b：按**边**登记，不按目标文件全局放行）。
 *
 * 每条 = 一个已审过的 `(源文件, 目标文件)` 边 ＋ 一行理由。新增边必须登记，否则 S2.2 红；
 * 登记了但仓里已不存在的边，S2.6 也会红（防豁免表腐化）。理由要写「为什么不是模块耦合」。
 */
export const PUBLIC_EDGE_ALLOW = Object.freeze([
  Object.freeze({
    edge: 'scriptFact.mjs -> script.mjs',
    reason: '剧本解析/渲染协议：scriptFact 只取 parseScript（纯解析），script.mjs 零 DOM、零 import，与 md.mjs 同级共享协议'
  }),
  Object.freeze({
    edge: 'analysisModules.mjs -> analysis.mjs',
    reason: '分析引擎是浏览器/Node 双用的纯函数（analysis.mjs 零依赖、零 DOM，后端 roleplayEngine 也引它）；analysisModules 只在调用方没注入引擎时惰性 import 取 analyzeChapter，属共享引擎边而非模块耦合'
  }),
  Object.freeze({
    edge: 'referenceStore.mjs -> views/registry.mjs',
    reason: '世界书存储层只读命名真源表的 worldbook.dir；registry 不反向引存储层、不执行 DOM 或视图渲染，此边不形成模块耦合或循环依赖'
  })
])

const allowSetOf = (rows) => new Set(rows.map((row) => row.edge))

/** public/ 下的相对 import 边：files = [{ rel, src }]（rel 形如 `public/views/a.mjs`）。 */
export function publicModuleEdges(files) {
  const out = []
  for (const { rel, src } of files) {
    for (const { spec, line } of scanImportSpecs(src)) {
      if (!spec.startsWith('./') && !spec.startsWith('../')) continue
      const dep = resolveSpec(rel, spec)
      if (dep === rel) continue
      out.push({
        from: rel,
        to: dep,
        spec,
        line,
        tag: `${rel.replace(/^public\//u, '')} -> ${dep.replace(/^public\//u, '')}`
      })
    }
  }
  return out
}

/**
 * 门禁判定（S2.2 数据面）：
 *   violations ＝ 没登记的边（红）；
 *   stale      ＝ 登记了却不存在/没写理由的边（红——豁免表只许反映真实合法边）。
 */
export function auditPublicEdges(files, allow = PUBLIC_EDGE_ALLOW) {
  const edges = publicModuleEdges(files)
  const allowSet = allowSetOf(allow)
  const seen = new Set(edges.map((edge) => edge.tag))
  const violations = edges.filter((edge) => !allowSet.has(edge.tag))
  const stale = allow.filter((row) => !row.reason || !row.reason.trim() || !seen.has(row.edge))
  return { edges, violations, stale }
}
