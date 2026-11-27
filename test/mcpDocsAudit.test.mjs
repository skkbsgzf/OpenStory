/**
 * OS-219：docs/mcp 双向审计的反例测试。
 * 只测试纯函数与真实注册表消费，不启动 daemon、不连接 8807、不读作者真库。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { MCP_TOOL_NAMES } from '../src/host/mcp.mjs'
import { auditMcpDocs } from '../tools/acceptance/mcpDocsAudit.mjs'

const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')
const doc = (file, text) => ({ file, text })
const overview = (count, body = '') => doc('OVERVIEW.md', `OpenStory 提供 ${count} 个工具。\n${body}`)

test('OS-219：完整工具名一致且 OVERVIEW 数字严格相等时通过', () => {
  const result = auditMcpDocs({
    toolNames: ['openstory_read', 'openstory_write'],
    docs: [overview(2, '`openstory_read`\n`openstory_write`')]
  })
  assert.equal(result.ok, true, result.issues.join('\n'))
  assert.equal(result.actualCount, 2)
  assert.equal(result.documentedCount, 2)
  assert.deepEqual(result.ghostTools, [])
  assert.deepEqual(result.missingTools, [])
  assert.deepEqual(result.overviewCounts, [2])
})

test('OS-219：文档声明不存在的幽灵工具必须红', () => {
  const result = auditMcpDocs({
    toolNames: ['openstory_read'],
    docs: [overview(1, '`openstory_read`\n`openstory_ghost_tool`')]
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.ghostTools, ['openstory_ghost_tool'])
  assert.deepEqual(result.missingTools, [])
  assert.ok(result.issues.some((issue) => issue.includes('文档声明不存在的工具 openstory_ghost_tool')))
})

test('OS-219：真实工具未在任何 docs/mcp 文档出现必须红', () => {
  const result = auditMcpDocs({
    toolNames: ['openstory_read', 'openstory_write'],
    docs: [overview(2, '`openstory_read`')]
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.ghostTools, [])
  assert.deepEqual(result.missingTools, ['openstory_write'])
  assert.ok(result.issues.some((issue) => issue.includes('真实工具未在任何 docs/mcp 文档出现：openstory_write')))
})

for (const declared of [1, 3]) {
  test(`OS-219：OVERVIEW 工具数 ${declared} 与真实 2 相差 1 也必须红`, () => {
    const result = auditMcpDocs({
      toolNames: ['openstory_read', 'openstory_write'],
      docs: [overview(declared, '`openstory_read`\n`openstory_write`')]
    })
    assert.equal(result.ok, false)
    assert.deepEqual(result.ghostTools, [])
    assert.deepEqual(result.missingTools, [])
    assert.ok(result.issues.some((issue) => issue.includes(`声明 ${declared} 个工具，真实注册表为 2，必须严格相等`)))
  })
}

test('OS-219：OVERVIEW 无工具数声明不能静默通过', () => {
  const result = auditMcpDocs({
    toolNames: ['openstory_read'],
    docs: [doc('OVERVIEW.md', '工具完整名单：`openstory_read`')]
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.overviewCounts, [])
  assert.ok(result.issues.some((issue) => issue.includes('未声明「N 个工具」数量')))
})

test('OS-219：同一 OVERVIEW 有多个数量声明时每个都必须严格相等', () => {
  const result = auditMcpDocs({
    toolNames: ['openstory_read', 'openstory_write'],
    docs: [doc('OVERVIEW.md', '共 2 个工具；按当前表共 3 个工具。\n`openstory_read`\n`openstory_write`')]
  })
  assert.equal(result.ok, false)
  assert.deepEqual(result.overviewCounts, [2, 3])
  assert.ok(result.issues.some((issue) => issue.includes('声明 3 个工具')))
})

test('OS-219：审计消费真实 MCP_TOOL_NAMES；当前 docs/mcp 必须全覆盖', () => {
  const docs = readdirSync(join(REPO, 'docs', 'mcp'))
    .filter((file) => file.endsWith('.md'))
    .sort()
    .map((file) => doc(file, readFileSync(join(REPO, 'docs', 'mcp', file), 'utf8')))
  const result = auditMcpDocs({ toolNames: MCP_TOOL_NAMES, docs })
  assert.equal(result.actualCount, MCP_TOOL_NAMES.length)
  assert.equal(result.ok, true, result.issues.join('\n'))
  assert.deepEqual(result.ghostTools, [])
  assert.deepEqual(result.missingTools, [])
})
