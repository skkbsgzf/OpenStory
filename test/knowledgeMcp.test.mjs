/** OS-229 MCP 独立知识库只读工具：真实临时 daemon + stdio MCP，不连 8807。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withTempDaemon } from './helpers/tempDaemon.mjs'
import { previewKnowledgeLibrary, registerKnowledgeLibrary } from '../src/modules/knowledge-base/knowledgeLibraryStore.mjs'

function startMcp(port, env) {
  const child = spawn(process.execPath, [join(import.meta.dirname, '..', 'src', 'host', 'mcp.mjs')], { stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env, ...env, OPENSTORY_PORT: String(port) } })
  let buffer = '', nextId = 1
  const pending = new Map()
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1)
      if (!line) continue
      const message = JSON.parse(line)
      if (message.id !== undefined && pending.has(message.id)) { pending.get(message.id)(message); pending.delete(message.id) }
    }
  })
  return {
    request(method, params) {
      const id = nextId++
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`MCP timeout ${method}`)) }, 15000)
        pending.set(id, (message) => { clearTimeout(timer); resolve(message) })
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) }) + '\n')
      })
    },
    async close() { if (child.exitCode === null) { child.kill(); await new Promise((done) => child.once('exit', done)) } }
  }
}

const payload = (result) => JSON.parse(result.content[0].text)
async function call(mcp, name, args) {
  const reply = await mcp.request('tools/call', { name, arguments: args })
  assert.equal(reply.error, undefined, JSON.stringify(reply.error))
  return reply.result
}

async function fixtureKb(base) {
  const root = join(base, 'mcp-kb')
  await mkdir(join(root, 'docs'), { recursive: true })
  await writeFile(join(root, 'knowledge.base.json'), JSON.stringify({ schema: 'openstory.knowledge-base@1', schemaVersion: 1, id: 'mcp-kb', name: 'MCP 知识库', version: '1.0.0', vendor: 'OpenStory', license: 'MIT', documentEntry: 'docs/index.md', formats: ['.md'], exclude: [], retrievalDefaults: { topK: 6, minScore: 0.3, budgetChars: 6000 }, tagMap: {}, nodeMap: {}, edgeMap: {} }))
  await writeFile(join(root, 'docs/index.md'), '# 索引\n\nMCP 知识。')
  return root
}

test('OS-229 MCP：知识库 list/read 成功；search 在 runtime 未就绪时类型化降级', async () => {
  await withTempDaemon(async (fx) => {
    const source = await fixtureKb(fx.base)
    const preview = await previewKnowledgeLibrary({ root: source }, fx.env)
    await registerKnowledgeLibrary({ previewId: preview.previewId, confirm: true }, fx.env)
    const mcp = startMcp(fx.daemon.port, fx.env)
    try {
      const listed = payload(await call(mcp, 'openstory_knowledge_libraries', {}))
      assert.equal(listed.libraries.length, 1)
      assert.equal(listed.libraries[0].root, undefined)
      const read = payload(await call(mcp, 'openstory_knowledge_read', { libraryId: 'mcp-kb', documentRef: 'docs/index.md' }))
      assert.equal(read.document.ref, 'docs/index.md')
      const search = await call(mcp, 'openstory_knowledge_search', { query: '知识' })
      assert.equal(search.isError, true)
      assert.match(search.content[0].text, /PLUGIN_DEGRADED|RUNTIME_MISSING|INDEX_NOT_READY/u)
      const escape = await call(mcp, 'openstory_knowledge_read', { libraryId: 'mcp-kb', documentRef: '../secret.md' })
      assert.equal(escape.isError, true)
      assert.match(escape.content[0].text, /PATH_ESCAPE/u)
      const invalid = await mcp.request('tools/call', { name: 'openstory_knowledge_search', arguments: {} })
      assert.equal(invalid.error.code, -32602)
    } finally { await mcp.close() }
  })
})

void rm
