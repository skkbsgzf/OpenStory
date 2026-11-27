/**
 * OS-219：docs/mcp 对外材料与真实 MCP 工具表的双向纯函数审计。
 *
 * 工具名真源由调用方从 src/host/mcp.mjs 的 MCP_TOOL_NAMES（tools/list 同源导出）传入；
 * 这里不读文件、不启 daemon、不数源码。docs 形如 [{ file, text }]。
 *
 * 口径：
 *   · 完整 `openstory_*` 名称双向校验——文档幽灵名、真实但全文未出现的工具都红；
 *   · OVERVIEW.md 若用「N 个工具」声明数量，每个声明都必须严格等于真实数量；
 *   · OVERVIEW.md 必须存在且声明数量，不能以「无数字即过」或 ±2 容差绕过。
 */

const TOOL_NAME_RE = /\bopenstory_[a-z][a-z0-9_]*\b/gu
const TOOL_COUNT_RE = /(\d+)\s*个工具/gu

function lineAt(text, index) {
  return String(text ?? '').slice(0, index).split('\n').length
}

/**
 * @param {{ toolNames: string[], docs: Array<{ file: string, text: string }> }} input
 * @returns {{
 *   ok: boolean, issues: string[], ghostTools: string[], missingTools: string[],
 *   overviewCounts: number[], actualCount: number, documentedCount: number
 * }}
 */
export function auditMcpDocs({ toolNames, docs } = {}) {
  const actualNames = [...new Set((Array.isArray(toolNames) ? toolNames : [])
    .map((name) => String(name ?? '').trim())
    .filter((name) => /^openstory_[a-z][a-z0-9_]*$/u.test(name)))].sort()
  const actualSet = new Set(actualNames)
  const actualCount = actualNames.length
  const documents = (Array.isArray(docs) ? docs : [])
    .map((doc) => ({ file: String(doc?.file ?? ''), text: String(doc?.text ?? '') }))
  const documentedTools = new Map()
  const overview = documents.find((doc) => doc.file === 'OVERVIEW.md')
  const issues = []

  if (actualCount === 0) issues.push('真实 MCP 工具表为空或没有合法 openstory_* 名称')
  if (!overview) issues.push('docs/mcp 缺 OVERVIEW.md')

  for (const doc of documents) {
    if (!doc.file) issues.push('docs/mcp 文档缺 file 名称')
    for (const match of doc.text.matchAll(TOOL_NAME_RE)) {
      const name = match[0]
      if (!documentedTools.has(name)) documentedTools.set(name, [])
      documentedTools.get(name).push(`${doc.file || '?'}:${lineAt(doc.text, match.index)}`)
    }
  }

  const ghostTools = [...documentedTools.keys()].filter((name) => !actualSet.has(name)).sort()
  for (const name of ghostTools) {
    issues.push(`文档声明不存在的工具 ${name}（${documentedTools.get(name).join(', ')}）`)
  }

  const missingTools = actualNames.filter((name) => !documentedTools.has(name))
  for (const name of missingTools) {
    issues.push(`真实工具未在任何 docs/mcp 文档出现：${name}`)
  }

  let overviewCounts = []
  if (overview) {
    overviewCounts = [...overview.text.matchAll(TOOL_COUNT_RE)].map((match) => Number(match[1]))
    if (overviewCounts.length === 0) {
      issues.push('OVERVIEW.md 未声明「N 个工具」数量（无数字不算通过）')
    }
    for (const match of overview.text.matchAll(TOOL_COUNT_RE)) {
      const declared = Number(match[1])
      if (declared !== actualCount) {
        issues.push(`OVERVIEW.md:${lineAt(overview.text, match.index)} 声明 ${declared} 个工具，真实注册表为 ${actualCount}，必须严格相等`)
      }
    }
  }

  return {
    ok: issues.length === 0,
    issues,
    ghostTools,
    missingTools,
    overviewCounts,
    actualCount,
    documentedCount: documentedTools.size
  }
}
