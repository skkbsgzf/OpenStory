import { factCapability } from '../modules/fact/index.mjs'
import { proseCapability } from '../modules/prose/index.mjs'
import { storageCapability, projectMeta } from '../modules/storage/index.mjs'
import { textCapability } from '../modules/text/index.mjs'
import { agentRuntimeCapability } from '../modules/agent-runtime/index.mjs'
import { mediaCapability } from '../modules/media/index.mjs'
import { deduceCapabilities } from '../modules/deduce/deduceCapability.mjs'

export const MODULE_IMPLEMENTATIONS = Object.freeze({
  fact: factCapability,
  prose: proseCapability,
  storage: storageCapability,
  text: textCapability,
  'agent-runtime': agentRuntimeCapability,
  media: mediaCapability,
  deduce: deduceCapabilities
})

/**
 * OS-193 K1：src/** 里唯一允许静态持有内核实现的对象。
 * KERNEL_CAPABILITIES 只把上面七个模块的实现登记项摊平成具名能力句柄，
 * 供底座服务与兼容转供件按需取用；新增内核方法先改这里，不许另开静态 import 口子。
 */
export const KERNEL_CAPABILITIES = Object.freeze({
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
  deduceEngine: deduceCapabilities['deduce.engine']
})
