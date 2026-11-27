/** Stable capability error codes for knowledge.retrieval@1. */
export const KNOWLEDGE_ERRORS = Object.freeze({
  RUNTIME_MISSING: 'RUNTIME_MISSING',
  RUNTIME_VERSION_MISMATCH: 'RUNTIME_VERSION_MISMATCH',
  INDEX_NOT_READY: 'INDEX_NOT_READY',
  STALE_INDEX: 'STALE_INDEX',
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',
  INDEX_BUILD_TIMEOUT: 'INDEX_BUILD_TIMEOUT',
  RUNTIME_CRASHED: 'RUNTIME_CRASHED',
  REQUEST_CANCELLED: 'REQUEST_CANCELLED',
  PROTOCOL_MISMATCH: 'PROTOCOL_MISMATCH',
  INVALID_REQUEST: 'INVALID_REQUEST'
})

export function knowledgeError(code, message, details) {
  return { ok: false, code, message, ...(details ? { details } : {}) }
}

export function isKnowledgeError(error) {
  return Boolean(error && typeof error === 'object' && Object.hasOwn(KNOWLEDGE_ERRORS, error.code))
}
