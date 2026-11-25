import test from 'node:test'
import assert from 'node:assert/strict'
import { KERNEL_CAPABILITIES as K } from '../src/protocol/capabilityImplementations.mjs'
import * as factBooksShim from '../src/services/factBooks.mjs'
import * as cliBridgeShim from '../src/services/cli-bridge.mjs'
import * as dshCliShim from '../src/services/dsh-cli.mjs'
import * as embeddingPathsShim from '../src/services/embeddingPaths.mjs'
import * as styleCheckShim from '../src/services/style-check.mjs'

/**
 * OS-193 K3：src/services/ 里的内核代码搬到内核模块，"转出不换实现"。
 * 判据不是函数身份（底座转供经能力句柄调用时才解引用，避免装载环），
 * 而是同一入参下转供叶与内核能力句柄给出逐字相同的结果——没有第二份实现。
 */
test('fact.books：转供叶与 fact 内核句柄同结果', () => {
  for (const name of ['isFactBookFileName', 'factOffsetOf', 'factLimitOf']) {
    for (const input of ['', '001-风起.md', '12', -3, null]) {
      assert.deepEqual(factBooksShim[name](input), K.factBooks[name](input), `${name}(${String(input)})`)
    }
  }
})

test('agent.runtime：CLI/DSH/embedding 转供叶与内核句柄同结果', () => {
  assert.deepEqual(
    cliBridgeShim.composeCliPrompt([{ role: 'user', content: '你好' }]),
    K.agentRuntime.composeCliPrompt([{ role: 'user', content: '你好' }])
  )
  assert.deepEqual(
    cliBridgeShim.buildCliArgs(['--model', 'm'], '提示', '模型'),
    K.agentRuntime.buildCliArgs(['--model', 'm'], '提示', '模型')
  )
  assert.deepEqual(dshCliShim.parseDshFrame('{"v":1,"type":"text","content":"甲"}'), K.agentRuntime.parseDshFrame('{"v":1,"type":"text","content":"甲"}'))
  assert.equal(dshCliShim.dshFrameText({ type: 'text', content: '乙' }), K.agentRuntime.dshFrameText({ type: 'text', content: '乙' }))
  assert.deepEqual(embeddingPathsShim.resolveEmbeddingPaths('/repo'), K.agentRuntime.resolveEmbeddingPaths('/repo'))
})

test('text.analyze：文风指纹转供叶与 text 内核句柄同结果', () => {
  const sample = '他抬头看去。风起了，街上的灯一盏盏亮起来。他没有回头，只是继续往前走。'
  assert.deepEqual(styleCheckShim.measure(sample), K.textAnalyze.measure(sample))
  assert.deepEqual(styleCheckShim.listFingerprintPacks(), K.textAnalyze.listFingerprintPacks())
  assert.deepEqual(styleCheckShim.fingerprintHint('不存在的文风包'), K.textAnalyze.fingerprintHint('不存在的文风包'))
  assert.deepEqual(styleCheckShim.runStyleCheck(sample, '不存在的文风包'), K.textAnalyze.runStyleCheck(sample, '不存在的文风包'))
})

test('唯一静态入口：底座转供叶只经 KERNEL_CAPABILITIES，不直引内核模块实现', async () => {
  const { readFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  for (const rel of [
    'src/services/factBooks.mjs', 'src/services/enrichEngine.mjs', 'src/services/factImportWrite.mjs',
    'src/services/cli-bridge.mjs', 'src/services/dsh-bridge.mjs', 'src/services/chatUpstream.mjs',
    'src/services/embeddingPaths.mjs', 'src/services/style-check.mjs',
    'src/services/agentConfig.mjs', 'src/services/dsh-cli.mjs'
  ]) {
    const source = readFileSync(join(process.cwd(), rel), 'utf-8')
    const code = source.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/\/\/[^\n]*/gu, '')
    assert.doesNotMatch(code, /(?:from|import)\s*['"][^'"]*(?:\.\.\/)+modules\//u, `${rel} 不得静态直引内核实现`)
    assert.match(source, /protocol\/capabilityImplementations\.mjs/u, `${rel} 必须经唯一静态入口`)
  }
})
