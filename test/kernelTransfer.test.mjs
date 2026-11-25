import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { KERNEL_CAPABILITIES as K } from '../src/protocol/capabilityImplementations.mjs'
import * as factBooks from '../src/modules/fact/fact/books.mjs'
import * as cliBridge from '../src/modules/agent-runtime/cli-bridge.mjs'
import * as dshCli from '../src/modules/agent-runtime/dsh-cli.mjs'
import * as embeddingPaths from '../src/modules/agent-runtime/embeddingPaths.mjs'
import * as styleCheck from '../src/modules/text/lint.mjs'

/**
 * OS-193 K3 / OS-195a：内核实现住在自己的模块目录里，底座服务只留七个底座服务。
 * 判据是同一入参下模块实现与能力句柄给出逐字相同的结果——没有第二份实现；
 * 兼容转供叶已删，不再存在「转供叶 vs 句柄」的对照。
 */
test('fact.books：模块实现与 fact 内核句柄同结果', () => {
  for (const name of ['isFactBookFileName', 'factOffsetOf', 'factLimitOf']) {
    for (const input of ['', '001-风起.md', '12', -3, null]) {
      assert.deepEqual(factBooks[name](input), K.factBooks[name](input), `${name}(${String(input)})`)
    }
  }
})

test('agent.runtime：CLI/DSH/embedding 模块实现与内核句柄同结果', () => {
  assert.deepEqual(
    cliBridge.composeCliPrompt([{ role: 'user', content: '你好' }]),
    K.agentRuntime.composeCliPrompt([{ role: 'user', content: '你好' }])
  )
  assert.deepEqual(
    cliBridge.buildCliArgs(['--model', 'm'], '提示', '模型'),
    K.agentRuntime.buildCliArgs(['--model', 'm'], '提示', '模型')
  )
  assert.deepEqual(dshCli.parseDshFrame('{"v":1,"type":"text","content":"甲"}'), K.agentRuntime.parseDshFrame('{"v":1,"type":"text","content":"甲"}'))
  assert.equal(dshCli.dshFrameText({ type: 'text', content: '乙' }), K.agentRuntime.dshFrameText({ type: 'text', content: '乙' }))
  assert.deepEqual(embeddingPaths.resolveEmbeddingPaths('/repo'), K.agentRuntime.resolveEmbeddingPaths('/repo'))
})

test('text.analyze：文风指纹模块实现与 text 内核句柄同结果', () => {
  const sample = '他抬头看去。风起了，街上的灯一盏盏亮起来。他没有回头，只是继续往前走。'
  assert.deepEqual(styleCheck.measure(sample), K.textAnalyze.measure(sample))
  assert.deepEqual(styleCheck.listFingerprintPacks(), K.textAnalyze.listFingerprintPacks())
  assert.deepEqual(styleCheck.fingerprintHint('不存在的文风包'), K.textAnalyze.fingerprintHint('不存在的文风包'))
  assert.deepEqual(styleCheck.runStyleCheck(sample, '不存在的文风包'), K.textAnalyze.runStyleCheck(sample, '不存在的文风包'))
})

test('services 终态：只留五个货架装载＋systemPrompt＋syncCheck，内核兼容叶全删', async () => {
  const files = readdirSync(join(process.cwd(), 'src', 'services')).filter((name) => name.endsWith('.mjs')).sort()
  assert.deepEqual(files, [
    'genres.mjs', 'runtimes.mjs', 'skills.mjs', 'stylePacks.mjs', 'suites.mjs',
    'syncCheck.mjs', 'systemPrompt.mjs'
  ])
  // 模块实现只在 src/modules/，services 与 protocol 都不许再复制一份。
  for (const rel of [
    'src/modules/fact/fact/books.mjs', 'src/modules/agent-runtime/dsh-cli.mjs',
    'src/modules/agent-runtime/embeddingPaths.mjs', 'src/modules/text/lint.mjs'
  ]) {
    const source = readFileSync(join(process.cwd(), rel), 'utf-8')
    assert.doesNotMatch(source, /protocol\/capabilityImplementations\.mjs/u, `${rel} 是实现本体，不转供`)
  }
})
