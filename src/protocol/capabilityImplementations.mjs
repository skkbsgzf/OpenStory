import { factCapability } from '../modules/fact/index.mjs'
import { proseCapability } from '../modules/prose/index.mjs'
import { storageCapability } from '../modules/storage/index.mjs'
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
