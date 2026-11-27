/**
 * OS-217：MCP-only clean-room 构建器的回归用例。
 * 跑法：node --test test/os217McpBuildE2e.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SHUIHU_RECIPE, semanticDigest } from '../tools/samples/shuihu-recipe.mjs'
import { buildShuihuWithMcp } from '../tools/samples/build-shuihu-mcp.mjs'

test('OS-217 受控配方：7 条 fact 全部过 v3，稳定 id 可重复', () => {
  assert.equal(SHUIHU_RECIPE.facts.length, 7)
  assert.equal(new Set(SHUIHU_RECIPE.facts.map((entry) => entry.id)).size, 7)
  assert.equal(semanticDigest(SHUIHU_RECIPE), semanticDigest(SHUIHU_RECIPE), 'digest 必须确定')
  assert.match(semanticDigest(SHUIHU_RECIPE), /^[0-9a-f]{64}$/u)
})

test('OS-217 clean-room：真实 MCP 从空库建到导出，审计无正文全文且 digest 稳定', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os217-test-'))
  try {
    const first = await buildShuihuWithMcp({ baseDir: join(base, 'a'), root: join(base, 'a', '水浒传'), keep: false, cleanup: true })
    assert.equal(first.ok, true, JSON.stringify(first.error))
    assert.equal(first.stats.calls, 52)
    assert.equal(first.stats.semanticModelVerified, false)
    assert.equal(first.snapshot.factWikiRevision.fact, first.snapshot.factWikiRevision.wiki)
    assert.equal(first.audit.filter((item) => item.tool === 'openstory_fact_entries_import').length, 1)
    assert.equal(first.audit.filter((item) => item.tool === 'openstory_asset_put').length, 3)
    const serialized = JSON.stringify(first.audit)
    assert.ok(!serialized.includes('洪太尉不听真人劝阻，强开上清宫后殿'), '审计不得保存正文全文')
    assert.ok(serialized.includes('sha256'), '审计必须用 hash 摘要代替正文')
    assert.equal(first.digest, '6b64b0198448721becd096b3e3bc44fe93454dcb8e92af36373de42ab8473f5b')

    const second = await buildShuihuWithMcp({ baseDir: join(base, 'b'), root: join(base, 'b', '水浒传'), keep: false, cleanup: true })
    assert.equal(second.ok, true, JSON.stringify(second.error))
    assert.equal(second.digest, first.digest, '独立两次 clean-room 的语义 digest 必须一致')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('OS-217 缺任一必需 MCP 原语：构建必须红', async () => {
  for (const tool of ['openstory_library_create', 'openstory_fact_entries_import', 'openstory_reference_write_note', 'openstory_asset_put']) {
    const base = await mkdtemp(join(tmpdir(), 'os217-negative-'))
    try {
      const result = await buildShuihuWithMcp({
        baseDir: base,
        root: join(base, '水浒传'),
        omittedTools: [tool],
        keep: false,
        cleanup: true
      })
      assert.equal(result.ok, false, `移除 ${tool} 后不应成功`)
      assert.match(result.error.message, /MCP_TOOL_UNAVAILABLE/u)
    } finally {
      await rm(base, { recursive: true, force: true })
    }
  }
})
