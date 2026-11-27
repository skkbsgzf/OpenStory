/**
 * OS-214：剧本 ↔ fact 互转的服务端端点（真实临时 daemon HTTP）。
 *
 * 为什么单独立测：互转算法原来只住在 public/scriptFact.mjs，是浏览器私有逻辑——HTTP/MCP
 * 都调不到。下沉到 src/modules/script/ 之后，必须证明「经 daemon 走」与「前端同一份算法」
 * 结果一致，且不写盘、不调模型。
 *
 * 跑法：node --test test/os214ScriptFactEndpoints.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

const SCRIPT = [
  '# 第一幕 雨前',
  '',
  '*〔场景：茶馆内，午后〕*',
  '',
  '**沈岚**（低声）：你终于来了。',
  '',
  '**陈守一**：路上有人跟。',
  '',
  '# 第二幕 收网',
  '',
  '*〔场景：后巷〕*',
  '',
  '**沈岚**：动手。',
  ''
].join('\n')

const post = async (fx, path, body) => {
  const response = await fx.json(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ root: fx.root, ...body })
  })
  return { status: response.status, payload: response.payload }
}

test('OS-214 剧本→fact：真实 daemon 返回 v3 条目骨架，且与前端纯函数结果一致', async () => {
  await withTempDaemon(async (fx) => {
    const { status, payload } = await post(fx, '/api/script/to-fact', { text: SCRIPT, bookId: 'screenplay' })
    assert.equal(status, 200, JSON.stringify(payload))
    assert.equal(payload.ok, true)
    assert.ok(Array.isArray(payload.entries) && payload.entries.length > 0, '必须产出条目')
    assert.ok(payload.wiki && typeof payload.wiki === 'object', '必须带 wiki 骨架')
    assert.ok(payload.stats && typeof payload.stats === 'object', '必须带统计')

    // 与前端同一份算法逐条对比（真源已下沉，public/scriptFact.mjs 只是转发）
    const { scriptToFact } = await import('../src/modules/script/scriptFact.mjs')
    const direct = await scriptToFact(SCRIPT, { bookId: 'screenplay' })
    assert.deepEqual(payload.entries, direct.entries, '服务端端点与纯函数必须逐条一致')
    assert.equal(payload.stats.acts, direct.stats.acts, '幕数一致')

    // 纯结构映射：不落盘（故事源目录不该因这次调用多出文件）
    const sourceDir = await readdir(join(fx.root, '故事源')).catch(() => [])
    assert.ok(!sourceDir.some((name) => name.includes('screenplay')), '互转端点不得自己写故事源')

    // 负向：text 不是字符串
    const bad = await post(fx, '/api/script/to-fact', { text: 123 })
    assert.equal(bad.status, 400, 'text 非字符串应 400')
    assert.equal(bad.payload?.error?.code, 'INVALID_ENTRY')
  })
})

test('OS-214 fact→剧本：从故事源现档渲染，且 entries 显式传入时同源', async () => {
  await withTempDaemon(async (fx) => {
    // 先用 to-fact 造一份条目，再喂给 from-fact（不回写库，走显式 entries）
    const forward = await post(fx, '/api/script/to-fact', { text: SCRIPT, bookId: 'screenplay' })
    assert.equal(forward.status, 200, JSON.stringify(forward.payload))
    const entries = forward.payload.entries

    const backward = await post(fx, '/api/script/from-fact', { entries })
    assert.equal(backward.status, 200, JSON.stringify(backward.payload))
    assert.equal(backward.payload.ok, true)
    assert.ok(typeof backward.payload.text === 'string' && backward.payload.text.length > 0, '必须渲染出剧本文本')

    // 双向不丢：往返后幕数与角色台词数应与原文一致
    const { scriptToFact, factToScript } = await import('../src/modules/script/scriptFact.mjs')
    const roundtrip = await scriptToFact(backward.payload.text, { bookId: 'screenplay' })
    assert.equal(roundtrip.stats.acts, forward.payload.stats.acts, '往返后幕数一致')
    assert.ok(factToScript(entries) !== null, 'factToScript 对同一批条目可重复调用')

    // 负向：显式传空数组 → 报错（不渲染空剧本冒充成功）。
    // 注：临时库自带水浒样本故事源，所以「库内空」这条路径要用显式 entries:[] 触发。
    const empty = await post(fx, '/api/script/from-fact', { entries: [] })
    assert.equal(empty.status, 400, '空条目应 400 而不是渲染空剧本')
    assert.equal(empty.payload?.error?.code, 'INVALID_ENTRY', JSON.stringify(empty.payload))
  })
})

test('OS-214 两个端点都受模块闸：剧本模块停用 → 409 MODULE_DISABLED', async () => {
  await withTempDaemon(async (fx) => {
    const disabled = await fx.json('/api/ui-state', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ root: fx.root, state: { 'modules.enabled.script': false } })
    })
    assert.equal(disabled.status, 200)
    try {
      for (const [path, body] of [['/api/script/to-fact', { text: SCRIPT }], ['/api/script/from-fact', { entries: [] }]]) {
        const { status, payload } = await post(fx, path, body)
        assert.equal(status, 409, `${path} 停用后应 409，实得 ${status}`)
        assert.equal(payload?.error?.code, 'MODULE_DISABLED')
      }
    } finally {
      await fx.json('/api/ui-state', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ root: fx.root, state: { 'modules.enabled.script': true } })
      })
    }
    // 恢复后不再 409
    const restored = await post(fx, '/api/script/to-fact', { text: SCRIPT })
    assert.notEqual(restored.status, 409, '恢复后不应仍 MODULE_DISABLED')
  })
})

test('OS-214 前端只剩转发层：public/ 不再持有互转算法本体', async () => {
  const pub = await readFile(join(import.meta.dirname, '..', 'public', 'scriptFact.mjs'), 'utf-8')
  assert.match(pub, /export \{[^}]*scriptToFact[^}]*\} from '\.\.\/src\/modules\/script\/scriptFact\.mjs'/u,
    'public/scriptFact.mjs 必须是 re-export，不得再有实现')
  assert.ok(!pub.includes('parseScript('), '转发层里不该再出现解析调用')
  const src = await readFile(join(import.meta.dirname, '..', 'src', 'modules', 'script', 'scriptFact.mjs'), 'utf-8')
  assert.ok(src.includes('export async function scriptToFact'), '服务端真源必须持有实现')
})
