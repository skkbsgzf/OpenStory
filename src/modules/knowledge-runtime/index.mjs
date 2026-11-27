/** OS-228 knowledge-runtime kernel: no UI, no endpoint, no protocol re-export. */
import * as sidecar from './sidecar.mjs'
import * as staging from './staging.mjs'

function runtimeManager(options = {}) {
  const resolved = sidecar.getKnowledgeSidecar(options)
  if (!resolved.ok) throw Object.assign(new Error(resolved.message), { code: resolved.code })
  return resolved.manager
}

function callRuntime(method, payload, options) {
  return runtimeManager(options?.runtime)[method](payload, options)
}

export const knowledgeRuntimeCapability = Object.freeze({
  'knowledge.retrieval': Object.freeze({
    insert: (payload, options) => callRuntime('insert', payload, options),
    query: (payload, options) => callRuntime('query', payload, options),
    read: (payload, options) => callRuntime('read', payload, options),
    health: (options) => runtimeManager(options?.runtime).health(),
    indexStatus: (payload, options) => callRuntime('indexStatus', payload, options),
    stop: () => sidecar.stopAllKnowledgeSidecars(),
    createIndexStaging: staging.createIndexStaging,
    publishIndex: staging.publishKnowledgeIndex,
    readIndex: staging.readKnowledgeIndex,
    cleanupStaging: staging.cleanupKnowledgeStaging,
    KnowledgeSidecar: sidecar.KnowledgeSidecar,
    SidecarManager: sidecar.SidecarManager,
    stopAllSidecars: sidecar.stopAllKnowledgeSidecars,
    ...sidecar,
    ...staging
  })
})

export async function activate(context) {
  return { capabilities: knowledgeRuntimeCapability }
}
