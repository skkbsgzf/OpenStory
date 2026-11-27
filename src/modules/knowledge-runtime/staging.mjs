import { createHash, randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { knowledgeError, KNOWLEDGE_ERRORS } from './errors.mjs'

const INDEX_FORMAT = 'hypergraphrag-index@1'
const text = (value) => String(value ?? '')
const sha256 = (value) => createHash('sha256').update(value).digest('hex')
const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function invalid(message) { return knowledgeError(KNOWLEDGE_ERRORS.INVALID_REQUEST, message) }
function isInside(root, target) {
  const rel = resolve(target).slice(resolve(root).length)
  return rel === '' || (rel.startsWith('/') || rel.startsWith('\\'))
}

async function digestTree(root) {
  const rows = []
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
      const path = join(dir, entry.name)
      if (entry.isSymbolicLink()) rows.push(`${path.slice(root.length)}\0symlink\0`)
      else if (entry.isDirectory()) await walk(path)
      else if (entry.isFile()) rows.push(`${path.slice(root.length)}\0file\0${sha256(await readFile(path))}\0`)
    }
  }
  await walk(root)
  return sha256(rows.join('\n'))
}

async function atomicWrite(path, value) {
  await mkdir(dirname(path), { recursive: true })
  const temp = `${path}.${randomUUID()}.tmp`
  const handle = await open(temp, 'wx')
  try {
    await handle.writeFile(value, 'utf8')
    await handle.sync()
  } finally { await handle.close() }
  await rename(temp, path)
}

async function removeIfExists(path) {
  try { await rm(path, { recursive: true, force: true }) } catch { /* staging cleanup is best effort */ }
}

function stagingLayout({ cacheRoot, libraryId, operationId } = {}) {
  if (!text(cacheRoot).trim() || !text(libraryId).trim()) return invalid('indexRoot/cacheRoot 与 libraryId 必填')
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(libraryId)) return invalid('libraryId 必须是稳定小写 slug')
  if (!/^[A-Za-z0-9_-]+$/u.test(operationId)) return invalid('operationId 只允许字母、数字、下划线与连字符')
  const root = join(cacheRoot, libraryId)
  const operation = join(root, 'operations', operationId)
  return {
    ok: true,
    root,
    operation,
    input: join(operation, 'input'),
    output: join(operation, 'output'),
    logs: join(operation, 'logs'),
    indexes: join(root, 'indexes'),
    currentPath: join(root, 'current.json')
  }
}

function checkedDocuments(documents, snapshotRoot) {
  if (!Array.isArray(documents) || !documents.length) return invalid('至少需要一个文档快照')
  const refs = new Set()
  for (const document of documents) {
    if (!document || typeof document !== 'object' || Array.isArray(document)) return invalid('文档快照形状非法')
    const ref = text(document.documentRef || document.ref)
    if (!/\.(?:md|markdown)$/iu.test(ref) || ref.includes('\\') || ref.includes('\0') || /^[A-Za-z]:/u.test(ref) || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(ref) || ref.startsWith('/') || ref.split('/').some((part) => !part || part === '.' || part === '..')) return invalid(`documentRef 越界：${ref}`)
    if (refs.has(ref)) return invalid(`documentRef 重复：${ref}`)
    refs.add(ref)
    if (typeof document.content !== 'string') return invalid(`文档 ${ref} 缺少 content`)
    const target = resolve(snapshotRoot, ...ref.split('/'))
    if (!isInside(resolve(snapshotRoot), target)) return invalid(`documentRef 越界：${ref}`)
    if (document.contentHash && document.contentHash !== sha256(Buffer.from(document.content, 'utf8'))) return invalid(`文档 contentHash 不一致：${ref}`)
  }
  return { ok: true }
}

async function copyReadOnlySnapshot(sourceRoot, snapshotRoot, documents) {
  await mkdir(snapshotRoot, { recursive: true })
  await access(sourceRoot, constants.R_OK)
  for (const document of documents) {
    const ref = text(document.documentRef || document.ref)
    const source = resolve(sourceRoot, ...ref.split('/'))
    if (!isInside(resolve(sourceRoot), source)) return invalid(`源 documentRef 越界：${ref}`)
    const target = resolve(snapshotRoot, ...ref.split('/'))
    await mkdir(dirname(target), { recursive: true })
    await copyFile(source, target, constants.COPYFILE_EXCL)
    await access(target, constants.R_OK)
  }
  return { ok: true }
}

export async function createKnowledgeStaging({ cacheRoot, libraryId, operationId = randomUUID(), documents, sourceRoot } = {}) {
  const layout = stagingLayout({ cacheRoot, libraryId, operationId })
  if (!layout.ok) return layout
  if (!text(sourceRoot).trim()) return invalid('sourceRoot 必填；不允许从缓存目录复制源文档')
  const checked = checkedDocuments(documents, layout.input)
  if (!checked.ok) return checked
  const beforeHash = await digestTree(sourceRoot)
  const snapshot = await copyReadOnlySnapshot(sourceRoot, layout.input, documents)
  if (!snapshot.ok) return snapshot
  const afterHash = await digestTree(sourceRoot)
  if (beforeHash !== afterHash) return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, '只读快照期间源目录发生变化，拒绝构建')
  const snapshotHash = await digestTree(layout.input)
  await mkdir(layout.output, { recursive: true })
  await mkdir(layout.logs, { recursive: true })
  return {
    ok: true,
    operationId,
    libraryId,
    cacheRoot,
    ...layout,
    sourceHashBefore: beforeHash,
    snapshotHash,
    documents: documents.map((document) => ({ ...document, documentRef: text(document.documentRef || document.ref) }))
  }
}

function indexIdentity(input) {
  const { contentRevision, manifestHash, customizationHash, runtimeCommit, runtimeLockSha256, profileVersion, engineVersion } = input
  for (const [key, value] of Object.entries({ contentRevision, manifestHash, customizationHash, runtimeCommit, runtimeLockSha256, engineVersion })) {
    if (!text(value).trim()) return invalid(`indexHash 缺少 ${key}`)
  }
  if (text(runtimeCommit) !== 'e01d2f2a5f3d1e80415b933c10fa7d14587cf811') return invalid('indexHash 只接受固定 HyperGraphRAG commit')
  if (text(profileVersion || '1').trim()) {
    // Profile is part of identity even when it is the default.
  }
  return { ok: true, profileVersion: text(profileVersion || '1') }
}

function pointerValue({ libraryId, operationId, indexHash, contentRevision, snapshotHash, documents }) {
  return {
    schema: 'openstory.knowledge-index-pointer@1',
    schemaVersion: 1,
    libraryId,
    operationId,
    indexHash,
    contentRevision,
    snapshotHash,
    format: INDEX_FORMAT,
    indexPath: `indexes/${indexHash}`,
    documents: documents.map((document) => text(document.documentRef || document.ref)),
    publishedAt: new Date().toISOString()
  }
}

async function ensureIndexReady(staging) {
  const marker = join(staging.output, 'hypergraphrag.ready.json')
  let ready
  try { ready = JSON.parse(await readFile(marker, 'utf8')) } catch { return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, '构建输出缺少 hypergraphrag.ready.json') }
  if (!ready || typeof ready !== 'object' || ready.schema !== 'openstory.hypergraphrag-ready@1' || ready.schemaVersion !== 1) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, '构建就绪标记不符合契约')
  if (text(ready.operationId) !== staging.operationId || text(ready.libraryId) !== staging.libraryId) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, '构建就绪标记与 operationId/libraryId 不匹配')
  if (text(ready.indexHash) !== staging.indexHash) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, '构建输出 indexHash 与发布身份不一致')
  return { ok: true, ready }
}

async function syncDirectory(root) {
  const handle = await open(root, 'r')
  try { await handle.sync() } catch { /* Windows directory fsync is unsupported */ } finally { await handle.close() }
}

async function publishOperation({ cacheRoot, libraryId, operationId, contentRevision, manifestHash, customizationHash = '', runtimeCommit, runtimeLockSha256, engineVersion, profileVersion = '1' } = {}) {
  const layout = stagingLayout({ cacheRoot, libraryId, operationId })
  if (!layout.ok) return layout
  const identity = indexIdentity({ contentRevision, manifestHash, customizationHash, runtimeCommit, runtimeLockSha256, engineVersion, profileVersion })
  if (!identity.ok) return identity
  let inputJson
  try { inputJson = JSON.parse(await readFile(join(layout.input, 'snapshot.json'), 'utf8')) } catch { return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, 'staging input/snapshot.json 缺失或损坏') }
  const expectedHash = sha256(JSON.stringify({
    schema: INDEX_FORMAT,
    contentRevision,
    manifestHash,
    customizationHash,
    runtimeCommit,
    runtimeLockSha256,
    engineVersion,
    profileVersion: identity.profileVersion,
    snapshotHash: inputJson.snapshotHash
  }))
  if (!inputJson.indexHash || inputJson.indexHash !== expectedHash) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, 'staging indexHash 与发布身份不一致')
  if (inputJson.operationId !== operationId || inputJson.libraryId !== libraryId || inputJson.contentRevision !== contentRevision) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, 'staging 输入身份不匹配')
  const staging = { ...layout, ...inputJson, indexHash: inputJson.indexHash }
  const published = join(layout.indexes, staging.indexHash)
  if (!text(staging.indexHash).match(/^[a-f0-9]{64}$/u)) return invalid('indexHash 格式非法')
  const alreadyPublished = await stat(published).then(() => true, () => false)
  if (alreadyPublished) {
    if (!text(inputJson.indexHash).match(/^[a-f0-9]{64}$/u)) return invalid('indexHash 格式非法')
    const pointer = pointerValue({ libraryId, operationId, indexHash: inputJson.indexHash, contentRevision, snapshotHash: inputJson.snapshotHash, documents: inputJson.documents })
    return { ...pointer, ok: true, published: false, alreadyPublished: true }
  }
  const ready = await ensureIndexReady(staging)
  if (!ready.ok) return ready
  await mkdir(dirname(published), { recursive: true })
  const pending = `${published}.${randomUUID()}.publishing`
  await rename(layout.output, pending)
  let moved = false
  try {
    await rename(pending, published)
    moved = true
    const pointer = pointerValue({ libraryId, operationId, indexHash: staging.indexHash, contentRevision, snapshotHash: inputJson.snapshotHash, documents: inputJson.documents })
    await atomicWrite(layout.currentPath, `${JSON.stringify(pointer, null, 2)}\n`)
    await syncDirectory(layout.indexes)
    await syncDirectory(layout.root)
    return { ok: true, published: true, ...pointer }
  } catch (error) {
    if (moved) await removeIfExists(published)
    else {
      await rename(layout.output, pending).catch(() => {})
      await rename(pending, layout.output).catch(() => {})
    }
    return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, `索引发布失败：${text(error?.message || error)}`)
  }
}

export async function publishKnowledgeIndex(input) {
  try { return await publishOperation(input) } catch (error) {
    if (error?.code && Object.hasOwn(KNOWLEDGE_ERRORS, error.code)) return knowledgeError(error.code, text(error.message))
    return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, `索引发布失败：${text(error?.message || error)}`)
  }
}

export async function readKnowledgeIndex({ cacheRoot, libraryId, contentRevision } = {}) {
  const layout = stagingLayout({ cacheRoot, libraryId, operationId: 'read' })
  if (!layout.ok) return layout
  let pointer
  try { pointer = JSON.parse(await readFile(layout.currentPath, 'utf8')) } catch (error) {
    if (error?.code === 'ENOENT') return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, '知识库尚未发布索引')
    return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, 'current.json 损坏，拒绝猜测索引')
  }
  if (pointer.schema !== 'openstory.knowledge-index-pointer@1' || pointer.schemaVersion !== 1 || pointer.libraryId !== libraryId || !/^[a-f0-9]{64}$/u.test(text(pointer.indexHash)) || !text(pointer.indexPath).match(/^indexes\/[a-f0-9]{64}$/u)) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, 'current.json 形状非法')
  const published = resolve(layout.root, pointer.indexPath)
  if (!isInside(resolve(layout.indexes), published) || published !== join(layout.indexes, pointer.indexHash)) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, 'current.json 索引路径越界')
  if (contentRevision && pointer.contentRevision !== contentRevision) return knowledgeError(KNOWLEDGE_ERRORS.STALE_INDEX, `索引内容版本陈旧：当前 ${text(pointer.contentRevision)}，请求 ${text(contentRevision)}`)
  let manifest
  try { manifest = JSON.parse(await readFile(join(published, 'index.json'), 'utf8')) } catch { return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, '已发布索引缺少 index.json') }
  if (manifest.schema !== INDEX_FORMAT || manifest.schemaVersion !== 1 || manifest.libraryId !== libraryId || manifest.indexHash !== pointer.indexHash || manifest.contentRevision !== pointer.contentRevision) return knowledgeError(KNOWLEDGE_ERRORS.INDEX_NOT_READY, '已发布索引身份不匹配')
  return { ok: true, ...pointer, indexPath: published, manifest, stagingRoot: layout.operation, inputDir: layout.input, logsDir: layout.logs }
}

export async function cleanupKnowledgeStaging({ cacheRoot, libraryId, operationId } = {}) {
  const layout = stagingLayout({ cacheRoot, libraryId, operationId })
  if (!layout.ok) return layout
  await removeIfExists(layout.operation)
  return { ok: true, operationId }
}

export async function createIndexStaging(options = {}) {
  const { cacheRoot, libraryId, operationId } = options
  const layout = stagingLayout({ cacheRoot, libraryId, operationId })
  if (!layout.ok) return layout
  const indexRoot = text(options.indexRoot || cacheRoot)
  if (indexRoot !== cacheRoot) return invalid('indexRoot 与 cacheRoot 必须一致，避免源目录与缓存目录混淆')
  const identity = indexIdentity(options)
  if (!identity.ok) return identity
  const created = await createKnowledgeStaging(options)
  if (!created.ok) return created
  const indexHash = sha256(JSON.stringify({
    schema: INDEX_FORMAT,
    contentRevision: text(options.contentRevision),
    manifestHash: text(options.manifestHash),
    customizationHash: text(options.customizationHash || ''),
    runtimeCommit: text(options.runtimeCommit),
    runtimeLockSha256: text(options.runtimeLockSha256),
    engineVersion: text(options.engineVersion),
    profileVersion: identity.profileVersion,
    snapshotHash: created.snapshotHash
  }))
  const snapshot = {
    schema: 'openstory.knowledge-snapshot@1',
    schemaVersion: 1,
    operationId: created.operationId,
    libraryId: created.libraryId,
    contentRevision: text(options.contentRevision),
    manifestHash: text(options.manifestHash),
    customizationHash: text(options.customizationHash || ''),
    runtimeCommit: text(options.runtimeCommit),
    runtimeLockSha256: text(options.runtimeLockSha256),
    engineVersion: text(options.engineVersion),
    profileVersion: identity.profileVersion,
    snapshotHash: created.snapshotHash,
    indexHash,
    documents: created.documents.map((document) => document.documentRef)
  }
  const manifestLines = created.documents.map((document) => JSON.stringify({ documentRef: document.documentRef, title: text(document.title || document.documentRef), tags: Array.isArray(document.tags) ? document.tags.map(text) : [] }))
  await atomicWrite(join(created.input, 'documents.jsonl'), `${manifestLines.join('\n')}${manifestLines.length ? '\n' : ''}`)
  try { await atomicWrite(join(created.input, 'snapshot.json'), `${JSON.stringify(snapshot, null, 2)}\n`) } catch (error) { return knowledgeError(KNOWLEDGE_ERRORS.RUNTIME_CRASHED, `staging 输入写入失败：${text(error?.message || error)}`) }
  return { ok: true, ...created, ...snapshot, inputDir: created.input, outputDir: created.output, logsDir: created.logs, indexPath: join(created.indexes, indexHash) }
}
