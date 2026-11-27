/** 知识库源扫描与 revision（OS-226）。源目录只读，输出内存索引与 hash。 */
import { createHash } from 'node:crypto'
import { readdir, readFile, lstat, realpath } from 'node:fs/promises'
import { extname, join, relative, resolve } from 'node:path'
import { canonicalKnowledgeRoot, normalizeDocumentRef } from './knowledgePaths.mjs'
import { validateKnowledgeBaseManifest } from './knowledgeManifest.mjs'

const MAX_DEPTH = 12
const MAX_FILES = 5000
const MAX_FILE_BYTES = 2 * 1024 * 1024
const MAX_TOTAL_BYTES = 64 * 1024 * 1024

export function sha256(value) { return createHash('sha256').update(value).digest('hex') }
export function documentContentHash(bytes) { return sha256(bytes) }
export function contentRevision(files) {
  const rows = [...files].sort((a, b) => a.ref.localeCompare(b.ref, 'en'))
  return sha256(rows.map((file) => `${file.ref}\0${file.contentHash}\0`).join(''))
}
export function computeIndexHash({ contentRevision: revision, manifestHash, customizationHash = '', runtimeVersion = '', profileVersion = '1' }) {
  return sha256(JSON.stringify({ revision, manifestHash, customizationHash, runtimeVersion, profileVersion, schema: 'knowledge-index@1' }))
}

function excluded(ref, rules) {
  return rules.some((rule) => {
    const normalized = rule.replaceAll('\\', '/').replace(/\/$/u, '')
    if (normalized.endsWith('/**')) return ref.startsWith(`${normalized.slice(0, -3)}/`)
    if (normalized.includes('*')) {
      const regex = normalized.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('.*')
      return new RegExp(`^${regex}$`, 'u').test(ref)
    }
    return ref === normalized || ref.startsWith(`${normalized}/`)
  })
}

function parseFrontmatter(source) {
  const normalized = source.replace(/\r\n?/gu, '\n')
  if (!normalized.startsWith('---\n')) return { data: {}, body: normalized, bodyOffset: 0 }
  const end = normalized.indexOf('\n---', 4)
  if (end < 0) return { data: {}, body: normalized, bodyOffset: 0 }
  const lines = normalized.slice(4, end).split('\n')
  const data = {}
  let current = ''
  for (const line of lines) {
    const match = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/u)
    if (!match) continue
    const [, key, raw] = match
    current = key
    if (raw.startsWith('[') && raw.endsWith(']')) data[key] = raw.slice(1, -1).split(',').map((item) => item.trim().replace(/^["']|["']$/gu, '')).filter(Boolean)
    else if (!raw) data[key] = []
    else data[key] = raw.replace(/^["']|["']$/gu, '')
  }
  if (Array.isArray(data.tags)) {
    const tags = []
    for (const line of lines) {
      const item = line.match(/^\s+-\s+(.+)$/u)
      if (item && current === 'tags') tags.push(item[1].trim().replace(/^["']|["']$/gu, ''))
    }
    if (tags.length) data.tags = tags
  }
  const bodyStart = normalized.indexOf('\n', end + 1) + 1
  return { data, body: normalized.slice(bodyStart), bodyOffset: bodyStart }
}

function inlineTags(body) {
  const masked = body.replace(/```[\s\S]*?```/gu, (block) => block.replace(/[^\n]/gu, ' ')).replace(/`[^`]*`/gu, (block) => block.replace(/[^\n]/gu, ' '))
  return [...new Set([...masked.matchAll(/(?:^|\s)#([^\s#]+)/gu)].map((match) => match[1]))]
}

function wikiLinks(body) {
  return [...body.matchAll(/(!?)\[\[([^\]\n]+)\]\]/gu)].map((match) => {
    const inner = match[2]
    const [targetPart, display = ''] = inner.split('|')
    const [target, anchor = ''] = targetPart.split('#')
    return { target: target.trim(), anchor: anchor.trim(), display: display.trim(), embed: match[1] === '!' }
  })
}

function titleOf(ref, body, data) {
  return String(data.title || body.match(/^\s*#\s+(.+)$/mu)?.[1] || ref.split('/').pop().replace(/\.(?:md|markdown)$/iu, ''))
}

function excerptOf(body) {
  return body.replace(/```[\s\S]*?```/gu, ' ').replace(/^\s*#{1,6}\s+/gmu, '').replace(/[*_`>[\]()|]/gu, ' ')
    .replace(/\s+/gu, ' ').trim().slice(0, 240)
}

export async function scanKnowledgeDocuments(root, manifest, customization = {}) {
  const formats = new Set(manifest.formats.map((item) => item.toLowerCase()))
  const excludes = [...manifest.exclude, ...(Array.isArray(customization.exclude) ? customization.exclude : [])]
  const files = []
  const errors = []
  let totalBytes = 0
  async function walk(dir, depth) {
    if (depth > MAX_DEPTH || files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) return
    let entries
    try { entries = await readdir(dir, { withFileTypes: true }) } catch (error) { errors.push({ path: relative(root, dir), message: error.message }); return }
    for (const entry of entries) {
      if (files.length >= MAX_FILES || totalBytes >= MAX_TOTAL_BYTES) return
      const ref = relative(root, resolve(dir, entry.name)).replaceAll('\\', '/')
      if (excluded(ref, excludes)) continue
      if (entry.isSymbolicLink()) { errors.push({ path: ref, code: 'PATH_ESCAPE', message: '源树含符号链接，已拒绝' }); continue }
      if (entry.isDirectory()) { await walk(resolve(dir, entry.name), depth + 1); continue }
      if (!entry.isFile() || !formats.has(extname(entry.name).toLowerCase())) continue
      try {
        const info = await lstat(resolve(dir, entry.name))
        if (info.size > MAX_FILE_BYTES || totalBytes + info.size > MAX_TOTAL_BYTES) { errors.push({ path: ref, code: 'INVALID_ENTRY', message: '文件或总字节超限' }); continue }
        const bytes = await readFile(resolve(dir, entry.name))
        totalBytes += bytes.length
        const parsed = parseFrontmatter(bytes.toString('utf8'))
        const tags = [...new Set([...(Array.isArray(parsed.data.tags) ? parsed.data.tags : []), ...inlineTags(parsed.body)])]
        const links = wikiLinks(parsed.body)
        files.push({
          ref, path: ref, title: titleOf(ref, parsed.body, parsed.data), tags, links,
          excerpt: excerptOf(parsed.body), text: parsed.body, chars: parsed.body.length,
          contentHash: documentContentHash(bytes), bodyOffset: parsed.bodyOffset
        })
      } catch (error) { errors.push({ path: ref, message: error.message }) }
    }
  }
  await walk(root, 0)
  const revision = contentRevision(files)
  const byTitle = new Map(files.map((file) => [file.title.toLowerCase(), file]))
  const byRef = new Map(files.map((file) => [file.ref, file]))
  const backlinks = Object.fromEntries(files.map((file) => [file.ref, { linked: [], unlinked: [] }]))
  for (const source of files) {
    for (const link of source.links) {
      const target = byTitle.get(link.target.toLowerCase()) || byRef.get(link.target.replace(/\.md$/iu, '')) || byRef.get(`${link.target}.md`)
      if (target) backlinks[target.ref].linked.push({ id: source.id, ref: source.ref, title: source.title, excerpt: source.excerpt })
      else backlinks[source.ref].unlinked.push({ ref: link.target })
    }
    for (const other of files) {
      if (other.ref === source.ref || backlinks[source.ref].linked.some((item) => item.ref === other.ref)) continue
      if (other.title.includes(source.title)) backlinks[source.ref].unlinked.push({ ref: other.ref, title: other.title, excerpt: other.excerpt })
    }
  }
  const tagMap = new Map()
  for (const file of files) for (const tag of file.tags) {
    const row = tagMap.get(tag) || { name: tag, count: 0, description: '', color: '' }
    row.count += 1
    tagMap.set(tag, row)
  }
  const nodes = files.map((file) => ({ id: file.ref, kind: 'document', label: file.title, tags: file.tags, excerpt: file.excerpt, chars: file.chars, ref: file.ref }))
  const edges = []
  for (const file of files) {
    for (const tag of file.tags) edges.push({ a: file.ref, b: `tag:${tag}`, type: 'tag', sources: ['tag'], weight: 1 })
    for (const link of file.links) {
      const target = byTitle.get(link.target.toLowerCase()) || byRef.get(`${link.target}.md`)
      if (target) edges.push({ a: file.ref, b: target.ref, type: 'reference', sources: ['link'], weight: 2 })
    }
  }
  for (const tag of tagMap.keys()) nodes.push({ id: `tag:${tag}`, kind: 'tag', label: tag, tags: [tag] })
  return { ok: errors.length === 0, files, revision, tags: [...tagMap.values()], backlinks, graph: { nodes, edges, stats: { nodes: nodes.length, edges: edges.length } }, errors }
}

export async function loadKnowledgeManifest(root, manifestRef = 'knowledge.base.json') {
  const base = await canonicalKnowledgeRoot(root)
  if (!base.ok) return base
  const rawRef = String(manifestRef || 'knowledge.base.json').replaceAll('\\', '/')
  const checked = normalizeDocumentRef(rawRef.replace(/\.json$/iu, '.md'))
  if (!checked.ok) return checked
  const target = resolve(base.realRoot, rawRef)
  try {
    const info = await lstat(target)
    if (info.isSymbolicLink() || !info.isFile()) return { ok: false, code: 'PATH_ESCAPE', message: 'manifest 不能是符号链接或非文件' }
    const real = await realpath(target)
    const rel = relative(base.realRoot, real)
    if (rel.startsWith('..')) return { ok: false, code: 'PATH_ESCAPE', message: 'manifest realpath 越界' }
    const bytes = await readFile(target)
    const raw = JSON.parse(bytes.toString('utf8'))
    const validated = validateKnowledgeBaseManifest(raw)
    if (!validated.ok) return { ok: false, code: 'INVALID_ENTRY', message: validated.errors.join('；') }
    return { ok: true, path: target, bytes, hash: documentContentHash(bytes), manifest: validated.manifest }
  } catch (error) {
    return { ok: false, code: error?.code === 'ENOENT' ? 'NOT_FOUND' : 'INVALID_ENTRY', message: `manifest 读取失败：${error?.message || error}` }
  }
}
