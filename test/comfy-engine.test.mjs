/**
 * ComfyUI 生图适配器用例（OS-74）
 * 跑法：node --test test/comfy-engine.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { applyWorkflowInputs, probeComfy } from '../src/modules/media/comfyEngine.mjs'

const DEAD_URL = 'http://127.0.0.1:9'

/** 最小可用的 ComfyUI workflow（API 格式）。 */
const WORKFLOW = {
  3: { class_type: 'KSampler', inputs: { seed: 0, steps: 20, width: 512, height: 512, denoise: 1 }, _meta: { title: 'KSampler' } },
  5: { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 }, _meta: { title: 'EmptyLatentImage' } },
  6: { class_type: 'CLIPTextEncode', inputs: { text: 'old positive' }, _meta: { title: 'Positive' } },
  7: { class_type: 'CLIPTextEncode', inputs: { text: 'old negative' }, _meta: { title: 'Negative' } }
}

test('节点注入：按 title 自动猜，正向/负向/尺寸/种子都写进去', () => {
  const graph = applyWorkflowInputs(WORKFLOW, { prompt: '雾中的巨型怪物', negative: 'blurry', size: '768x1024' })
  const nodes = graph.prompt ?? graph
  assert.equal(nodes[6].inputs.text, '雾中的巨型怪物')
  assert.equal(nodes[7].inputs.text, 'blurry')
  assert.equal(nodes[5].inputs.width, 768)
  assert.equal(nodes[5].inputs.height, 1024)
  assert.equal(nodes[3].inputs.width, 768)
  assert.equal(nodes[3].inputs.height, 1024)
  assert.ok(Number.isFinite(nodes[3].inputs.seed), 'seed 应被重写为数字')
})

test('节点注入：nodeMap 显式指定优先于 title 猜测', () => {
  const custom = {
    10: { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: '提示词' } },
    11: { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: '反向词' } }
  }
  const graph = applyWorkflowInputs(custom, { prompt: '雨夜码头', negative: 'lowres', nodeMap: { positive: '10', negative: '11' } })
  const nodes = graph.prompt ?? graph
  assert.equal(nodes[10].inputs.text, '雨夜码头')
  assert.equal(nodes[11].inputs.text, 'lowres')
})

test('节点注入：不改原 workflow（深拷贝）', () => {
  const before = JSON.stringify(WORKFLOW)
  applyWorkflowInputs(WORKFLOW, { prompt: 'x' })
  assert.equal(JSON.stringify(WORKFLOW), before)
})

test('节点注入：缺节点不抛（工作流可能没有 Negative）', () => {
  const noNeg = { 6: { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: 'Positive' } } }
  const graph = applyWorkflowInputs(noNeg, { prompt: '只有正向' })
  assert.equal(graph[6].inputs.text, '只有正向')
})

test('探测：不可达端口返回 reachable:false，不抛', async () => {
  const result = await probeComfy(DEAD_URL, 1500)
  assert.equal(result.reachable, false)
  assert.ok(result.error, '应有错误说明')
  assert.ok(Number.isFinite(result.latencyMs))
})

test('探测：空地址直接失败', async () => {
  const result = await probeComfy('')
  assert.equal(result.reachable, false)
  assert.match(result.error, /为空/u)
})

test('端到端：工作流文件缺失时如实报错（不抛）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-comfy-'))
  try {
    const { generateViaComfy } = await import('../src/modules/media/comfyEngine.mjs')
    const result = await generateViaComfy({
      comfyUrl: DEAD_URL,
      workflowPath: 'nope.json',
      root: base,
      prompt: '测试'
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /工作流文件不存在|工作流 JSON/u)
  } finally { await rm(base, { recursive: true, force: true }) }
})

test('端到端：ComfyUI 连不上时如实报错（不抛）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-comfy2-'))
  try {
    await mkdir(join(base, '世界书'), { recursive: true })
    await writeFile(join(base, '世界书', 'wf.json'), JSON.stringify(WORKFLOW), 'utf-8')
    const { generateViaComfy } = await import('../src/modules/media/comfyEngine.mjs')
    const result = await generateViaComfy({
      comfyUrl: DEAD_URL,
      workflowPath: '世界书/wf.json',
      root: base,
      prompt: '测试',
      timeoutMs: 3000
    })
    assert.equal(result.ok, false)
    assert.match(result.error, /连不上|提交失败/u)
  } finally { await rm(base, { recursive: true, force: true }) }
})
