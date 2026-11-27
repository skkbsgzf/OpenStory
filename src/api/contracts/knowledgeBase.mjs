export const knowledgeBaseEndpoints = {
  knowledgeLibrariesGet: {
    method: 'GET', path: '/api/knowledge/libraries',
    request: { query: {} },
    response: { ok: 'true', libraries: 'array', activeLibraryId: 'string?' },
    errors: ['KNOWLEDGE_LIBRARY_CORRUPT', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeLibraryPreview: {
    method: 'POST', path: '/api/knowledge/library/preview',
    request: { body: { root: 'string', id: 'string?', name: 'string?', description: 'string?', manifest: 'string?', customization: 'object?' } },
    response: { ok: 'true', previewId: 'string', fingerprint: 'string', preview: 'object' },
    errors: ['PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'KNOWLEDGE_LIBRARY_CORRUPT', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeLibraryRegister: {
    method: 'POST', path: '/api/knowledge/library/register',
    request: { body: { previewId: 'string', confirm: 'boolean' } },
    response: { ok: 'true', library: 'object', operationId: 'string' },
    errors: ['CONFIRM_REQUIRED', 'PLAN_NOT_FOUND', 'PLAN_STALE', 'INVALID_ENTRY', 'KNOWLEDGE_LIBRARY_CORRUPT', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeLibraryCreate: {
    method: 'POST', path: '/api/knowledge/library/create',
    request: { body: { id: 'string', name: 'string?', root: 'string' } },
    response: { ok: 'true', library: 'object', operationId: 'string' },
    errors: ['PATH_ESCAPE', 'INVALID_ENTRY', 'NOT_FOUND', 'KNOWLEDGE_LIBRARY_CORRUPT', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeLibraryStatePut: {
    method: 'PUT', path: '/api/knowledge/library/state',
    request: { body: { libraryId: 'string', enabled: 'boolean?', activate: 'boolean?' } },
    response: { ok: 'true', library: 'object', activeLibraryId: 'string?' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'KNOWLEDGE_LIBRARY_CORRUPT', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeLibraryCustomizationPut: {
    method: 'PUT', path: '/api/knowledge/library/customization',
    request: { body: { libraryId: 'string', customization: 'object' } },
    response: { ok: 'true', library: 'object' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'KNOWLEDGE_LIBRARY_CORRUPT', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeDocumentsGet: {
    method: 'GET', path: '/api/knowledge/documents',
    request: { query: { libraryId: 'string' } },
    response: { ok: 'true', libraryId: 'string', documents: 'array', tags: 'array', contentRevision: 'string', indexStatus: 'string', graph: 'object' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'PATH_ESCAPE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeDocumentGet: {
    method: 'GET', path: '/api/knowledge/document',
    request: { query: { libraryId: 'string', documentRef: 'string' } },
    response: { ok: 'true', document: 'object', backlinks: 'object' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'PATH_ESCAPE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeGraphGet: {
    method: 'GET', path: '/api/knowledge/graph',
    request: { query: { libraryId: 'string' } },
    response: { ok: 'true', graph: 'object' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'PATH_ESCAPE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeSearch: {
    method: 'POST', path: '/api/knowledge/search',
    request: { body: { libraryId: 'string?', query: 'string', topK: 'integer?', minScore: 'number?', budgetChars: 'integer?' } },
    response: { ok: 'true', hits: 'array', provenance: 'object', provider: 'string' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'PLUGIN_DEGRADED', 'RUNTIME_MISSING', 'RUNTIME_VERSION_MISMATCH', 'INDEX_NOT_READY', 'STALE_INDEX', 'QUERY_TIMEOUT', 'REQUEST_CANCELLED', 'RUNTIME_CRASHED', 'MODULE_DISABLED']
  },
  knowledgeIndexStatusGet: {
    method: 'GET', path: '/api/knowledge/index/status',
    request: { query: { libraryId: 'string' } },
    response: { ok: 'true', libraryId: 'string', index: 'object', contentRevision: 'string', runtime: 'object' },
    errors: ['NOT_FOUND', 'INVALID_ENTRY', 'PATH_ESCAPE', 'MODULE_DISABLED', 'PLUGIN_DEGRADED']
  },
  knowledgeIndexSync: {
    method: 'POST', path: '/api/knowledge/index/sync',
    request: { body: { libraryId: 'string', confirm: 'boolean' } },
    response: { ok: 'true', operationId: 'string', index: 'object' },
    errors: ['CONFIRM_REQUIRED', 'NOT_FOUND', 'INVALID_ENTRY', 'PLUGIN_DEGRADED', 'RUNTIME_MISSING', 'RUNTIME_VERSION_MISMATCH', 'STALE_INDEX', 'INDEX_BUILD_TIMEOUT', 'REQUEST_CANCELLED', 'RUNTIME_CRASHED', 'WRITE_PROTOCOL_IO_FAILED', 'MODULE_DISABLED']
  }
}
