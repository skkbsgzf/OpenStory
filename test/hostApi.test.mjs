/**
 * OS-142 Host API 入口护栏（OS-195b 接替）——`host-api@2` 第二套入口已退役，
 * 断言等价迁到**能力面**：唯一静态登记表 `src/protocol/capabilityImplementations.mjs`
 * 的键清单快照、冻结形状，以及「转出不换实现」的逐键同一性。
 *
 * 跑法：node --test test/hostApi.test.mjs（npm test 全量的一分子）
 *
 * 快照约定：登记表增删任何具名句柄，本文件的 SNAPSHOT 必须同步改——改快照这个动作
 * 本身就是「显式确认」；句柄改指向另一份实现（转出换实现）则被下面的 identity 断言钉死。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  KERNEL_CAPABILITIES as K,
  MODULE_IMPLEMENTATIONS
} from '../src/protocol/capabilityImplementations.mjs'
import { factCapability } from '../src/modules/fact/index.mjs'
import { proseCapability } from '../src/modules/prose/index.mjs'
import { storageCapability, projectMeta } from '../src/modules/storage/index.mjs'
import { textCapability } from '../src/modules/text/index.mjs'
import { agentRuntimeCapability } from '../src/modules/agent-runtime/index.mjs'
import { mediaCapability } from '../src/modules/media/index.mjs'
import { deduceCapabilities } from '../src/modules/deduce/deduceCapability.mjs'
import { knowledgeRuntimeCapability } from '../src/modules/knowledge-runtime/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('host-api@2 第二套入口已退役（协议层只留能力面，不再有命名空间门面）', () => {
  assert.equal(existsSync(join(ROOT, 'src', 'protocol', 'index.mjs')), false)
})

/** 登记表键清单快照（逐字对齐 capabilityImplementations.mjs 的 KERNEL_CAPABILITIES）。 */
const SNAPSHOT = [
  'agentRuntime', 'deduceEngine', 'factBooks', 'factDomain', 'factEngine', 'factEnrich',
  'factPack', 'factStore', 'factWrite', 'knowledgeRetrieval', 'mediaDescribe', 'mediaGenerate', 'projectMeta',
  'proseWrite', 'storageInventory', 'storageRoots', 'storageScaffold', 'textAnalyze'
]

test('登记表键清单快照（增删句柄必须改本快照＝显式确认）', () => {
  assert.deepEqual(Object.keys(K).sort(), SNAPSHOT)
  assert.deepEqual(Object.keys(MODULE_IMPLEMENTATIONS).sort(),
    ['agent-runtime', 'deduce', 'fact', 'knowledge-runtime', 'media', 'prose', 'storage', 'text'])
  assert.equal(Object.isFrozen(K), true)
  assert.equal(Object.isFrozen(MODULE_IMPLEMENTATIONS), true)
})

/** 转出不换实现：每个具名句柄必须与模块能力面的原始对象引用相等。 */
const IMPLEMENTATION_BINDINGS = Object.freeze({
  factStore: factCapability['fact.store'],
  factPack: factCapability['fact.pack'],
  factEnrich: factCapability['fact.enrich'],
  factEngine: factCapability['fact.engine'],
  factBooks: factCapability['fact.books'],
  factWrite: factCapability['fact.write'],
  factDomain: factCapability['fact.domain'],
  proseWrite: proseCapability['prose.write'],
  storageRoots: storageCapability['storage.roots'],
  storageScaffold: storageCapability['storage.scaffold'],
  storageInventory: storageCapability['storage.inventory'],
  projectMeta,
  textAnalyze: textCapability['text.analyze'],
  agentRuntime: agentRuntimeCapability['agent.runtime'],
  mediaGenerate: mediaCapability['media.generate'],
  mediaDescribe: mediaCapability['media.describe'],
  deduceEngine: deduceCapabilities['deduce.engine'],
  knowledgeRetrieval: knowledgeRuntimeCapability['knowledge.retrieval']
})

test('转出不换实现：登记表每项指向模块能力面的同一对象', () => {
  assert.deepEqual(Object.keys(IMPLEMENTATION_BINDINGS).sort(), SNAPSHOT)
  for (const [name, implementation] of Object.entries(IMPLEMENTATION_BINDINGS)) {
    assert.equal(K[name], implementation, `${name} 被换成另一份实现`)
    assert.equal(Object.isFrozen(implementation), true, `${name} 实现面必须冻结`)
  }
})

test('模块实现表按 id 指向八个内核能力面（不再另立第二张表）', () => {
  assert.equal(MODULE_IMPLEMENTATIONS.fact, factCapability)
  assert.equal(MODULE_IMPLEMENTATIONS.prose, proseCapability)
  assert.equal(MODULE_IMPLEMENTATIONS.storage, storageCapability)
  assert.equal(MODULE_IMPLEMENTATIONS.text, textCapability)
  assert.equal(MODULE_IMPLEMENTATIONS['agent-runtime'], agentRuntimeCapability)
  assert.equal(MODULE_IMPLEMENTATIONS.media, mediaCapability)
  assert.equal(MODULE_IMPLEMENTATIONS.deduce, deduceCapabilities)
})

test('冻结是真冻结：改写登记表成员静默失效（严格模式抛错）', () => {
  assert.throws(() => { K.factStore = null }, TypeError)
  assert.throws(() => { MODULE_IMPLEMENTATIONS.fact = null }, TypeError)
})

test('反方向装载序冒烟：library fork 点先于登记表装载（子进程，独立模块表）', () => {
  const loader = `
import assert from 'node:assert/strict'
const projectDoc = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'src/modules/storage/projectDoc.mjs')).href)})
const mod = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'src/protocol/capabilityImplementations.mjs')).href)})
assert.equal(Object.isFrozen(mod.KERNEL_CAPABILITIES), true)
assert.equal(mod.KERNEL_CAPABILITIES.factStore.FACT_DIR_NAME, '故事源', '登记表与存储实现同源')
assert.equal(typeof projectDoc.writeProjectDocument, 'function', 'fork 点先装仍可独立工作')
console.log('reverse-order ok')
`
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', loader], { encoding: 'utf-8', cwd: ROOT })
  assert.equal(r.status, 0, `反方向装载失败：${r.stderr || r.stdout}`)
  assert.ok(r.stdout.includes('reverse-order ok'))
})
