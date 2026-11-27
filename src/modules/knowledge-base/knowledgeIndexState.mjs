/** 知识库索引五态（OS-226/227），纯函数。 */
export const KNOWLEDGE_INDEX_STATES = Object.freeze(['never-indexed', 'building', 'fresh', 'stale', 'failed'])
export function emptyKnowledgeIndex() {
  return { status: 'never-indexed', contentRevision: null, indexHash: null, runtimeVersion: null, builtAt: null, error: null }
}
export function deriveKnowledgeIndexState(index = emptyKnowledgeIndex(), { contentRevision, runtimeVersion = null, runtimeAvailable = true } = {}) {
  if (!runtimeAvailable) return { ...index, status: index.status === 'failed' ? 'failed' : 'stale', error: index.error || 'RUNTIME_MISSING' }
  if (index.status === 'building') return { ...index }
  if (index.status === 'failed') return { ...index }
  if (!index.indexHash || !index.contentRevision) return { ...emptyKnowledgeIndex() }
  if (index.contentRevision !== contentRevision) return { ...index, status: 'stale' }
  if (runtimeVersion && index.runtimeVersion !== runtimeVersion) return { ...index, status: 'stale' }
  return { ...index, status: 'fresh' }
}
export function validateKnowledgeIndexState(value) {
  return value && KNOWLEDGE_INDEX_STATES.includes(value.status)
}
