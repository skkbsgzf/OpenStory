/** 知识库单库 manifest 校验（OS-226），纯函数。 */
export const KNOWLEDGE_BASE_SPEC = 'openstory.knowledge-base@1'
const VERSION_RE = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/u
const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const SECRET_KEY = /(?:api[-_]?key|token|password|secret|credential)/iu
const ALLOWED_LICENSES = new Set(['MIT', 'Apache-2.0', 'CC0-1.0', 'CC-BY-4.0', 'CC-BY-SA-4.0', 'UNLICENSED'])

function fail(message, details) { return { ok: false, errors: [message], ...(details ? { details } : {}) } }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function strings(value) { return Array.isArray(value) && value.every((item) => typeof item === 'string' && item.trim()) }
function safeRelative(value) {
  const raw = String(value ?? '').trim().replaceAll('\\', '/')
  return Boolean(raw) && !raw.includes('\0') && !/^[a-z][a-z0-9+.-]*:/iu.test(raw) && !raw.startsWith('/')
    && !/^[a-z]:/iu.test(raw) && raw.split('/').every((part) => part && part !== '.' && part !== '..')
}
function mapping(value) {
  return object(value) && Object.values(value).every((item) => typeof item === 'string')
}

export function validateKnowledgeBaseManifest(raw) {
  if (!object(raw)) return fail('manifest 必须是对象')
  const errors = []
  if (raw.schema !== KNOWLEDGE_BASE_SPEC) errors.push(`schema 必须是 ${KNOWLEDGE_BASE_SPEC}`)
  if (raw.schemaVersion !== 1) errors.push('schemaVersion 必须是 1')
  if (typeof raw.id !== 'string' || !ID_RE.test(raw.id)) errors.push('id 必须是稳定小写 slug')
  if (typeof raw.name !== 'string' || !raw.name.trim()) errors.push('name 必填')
  if (typeof raw.version !== 'string' || !VERSION_RE.test(raw.version)) errors.push('version 必须是三段版本号')
  if (typeof raw.vendor !== 'string' || !raw.vendor.trim()) errors.push('vendor 必填')
  if (typeof raw.license !== 'string' || !ALLOWED_LICENSES.has(raw.license)) errors.push('license 不在公开许可白名单')
  if (!safeRelative(raw.documentEntry) || !/\.(?:md|markdown)$/iu.test(String(raw.documentEntry))) errors.push('documentEntry 必须是库内 Markdown 相对路径')
  if (!strings(raw.formats) || !raw.formats.every((item) => /^\.[a-z0-9]+$/iu.test(item))) errors.push('formats 必须是扩展名数组')
  if (!strings(raw.exclude) || !raw.exclude.every(safeRelative)) errors.push('exclude 必须是安全相对路径/glob')
  const retrieval = raw.retrievalDefaults
  if (!object(retrieval) || !Number.isInteger(retrieval.topK) || retrieval.topK < 1 || retrieval.topK > 50
    || !Number.isFinite(retrieval.minScore) || retrieval.minScore < 0 || retrieval.minScore > 1
    || !Number.isInteger(retrieval.budgetChars) || retrieval.budgetChars < 1) errors.push('retrievalDefaults 形状或范围非法')
  for (const key of ['tagMap', 'nodeMap', 'edgeMap']) if (!mapping(raw[key])) errors.push(`${key} 必须是字符串映射`)
  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_KEY.test(key)) errors.push(`manifest 不得含凭据字段 ${key}`)
    if (typeof value === 'string' && /(?:oc_sk_|sk-[A-Za-z0-9]{12,})/u.test(value)) errors.push(`manifest 字段 ${key} 疑似明文凭据`)
  }
  return errors.length ? { ok: false, errors } : {
    ok: true,
    manifest: Object.freeze({
      schema: KNOWLEDGE_BASE_SPEC, schemaVersion: 1,
      id: raw.id, name: raw.name.trim(), version: raw.version, vendor: raw.vendor.trim(), license: raw.license,
      documentEntry: String(raw.documentEntry).replaceAll('\\', '/'),
      formats: [...raw.formats], exclude: [...raw.exclude],
      retrievalDefaults: Object.freeze({ ...retrieval }),
      tagMap: Object.freeze({ ...raw.tagMap }), nodeMap: Object.freeze({ ...raw.nodeMap }), edgeMap: Object.freeze({ ...raw.edgeMap })
    })
  }
}
