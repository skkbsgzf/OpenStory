/**
 * 参考（reference）载体（OS-44）——库内 `参考/` 目录的索引层。
 *
 * 设计口径（作者）：
 *   · 大纲/资料/构思/约束 统一为「参考」这一个载体，内置 Obsidian 式标签与双链
 *   · 标签体系是「复杂体系」：一篇参考可打多个标签，标签可自定义并带固定描述
 *   · 参考可关联其他参考，也可单向关联小说/剧本等产物
 *   · 小说与小说之间不构成参考关系——只有「参考 → 产物」这一个方向，
 *     确保参考资料不会反向污染正文的上下文
 *
 * 为什么条目（拆解/*.json 的 fact）不搬进来：那是 deduceEngine / wikiDerive /
 * fact/curve 的唯一数据源，且没有写入端点。参考只能「链接」到条目，条目保持只读。
 *
 * 索引不落盘：每次按需重建（本机库规模下毫秒级），避免维护两份真相。
 */
import { existsSync } from 'node:fs'
import { readdir, readFile, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

export const REFERENCE_DIR = '参考'
export const TAG_NOTE_DIR = '标签'
export const REFERENCE_EXTENSIONS = Object.freeze(['.md', '.markdown', '.txt'])

/**
 * 旧目录迁入参考（OS-48）只认这四个——动稿的口子必须收窄。
 * 世界书/日志/正文等不在迁移范围：世界书目录归 worldbook 载体，日志只读，正文是主载体。
 */
// OS-59 口径修正：规则类内容归「习惯」（习惯/habits.json），不再迁入世界书。
// 所以旧目录里只有「创作型条目」类的才可吸收；约束（写作纪律这类规则）留在原地，
// 由作者在习惯页签里录入，避免把规则混进世界书这个纯条目库。
export const ABSORBABLE_DIRS = Object.freeze(['大纲', '构思', '资料'])

/** 标签笔记的 frontmatter 标记（`kind: tag` 才算标签定义）。 */
export const TAG_NOTE_KIND = 'tag'

/* ---------- 小工具 ---------- */

function text(value) {
  return String(value ?? '')
}

/**
 * 掩掉代码围栏与行内码——先掩后扫是 parse 顺序的关键（SiYuan 的 import_obsidian.go 同口径）。
 * 保留等长空白，让后续偏移仍然对得上原文。
 */
export function maskCode(source) {
  const raw = text(source)
  const blank = (chunk) => chunk.replace(/[^\n]/gu, ' ')
  return raw
    // 围栏代码块（``` 或 ~~~），跨行整段掩掉
    .replace(/(^|\n)([ \t]*)(`{3,}|~{3,})[^\n]*\n[\s\S]*?\n\2\3\s*(?=\n|$)/gu, (match) => blank(match))
    // 行内码
    .replace(/`[^`\n]+`/gu, (match) => blank(match))
}

/* ---------- 标签 ---------- */

/**
 * Obsidian 的行内标签 tokenizer（照 obsidian.asar 逆出的正则）。
 *   · `#` 前必须是行首或空白——所以 `foo#tag` 不算
 *   · 标签体禁空白、禁一批 ASCII 标点、禁 Unicode 通用标点区
 *   · 纯数字不行（`#123` 不算标签，防 hex 色号 #fff 误判）
 */
const TAG_BODY = /^#[^\u2000-\u206F\u2E00-\u2E7F'!"#$%&()*+,.:;<=>?@^`{|}~[\]\\\s]+/u

/** 从一段文本里抽出行内标签（已掩码）。 */
export function extractInlineTags(source) {
  const masked = maskCode(source)
  const found = new Set()
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] !== '#') continue
    // 前一个字符必须是行首或空白
    if (index > 0 && !/\s/u.test(masked[index - 1])) continue
    const match = TAG_BODY.exec(masked.slice(index))
    if (!match) continue
    const body = match[0].slice(1)
    if (!body) continue
    if (/^\d+$/u.test(body)) continue // #123 不是标签
    found.add(body)
    index += match[0].length - 1
  }
  return [...found]
}

/**
 * frontmatter 解析（只认最小的 YAML 子集：`key: value`、flow 数组、块状数组）。
 * 不引 yaml 库——本仓零 npm，且参考笔记的 frontmatter 由我们自己写。
 */
/**
 * OS-75：把 frontmatter 对象序列化回 YAML（只支持本仓用到的标量/flow 数组/块数组）。
 * 用于世界书回填图片路径——写盘走既有 writeChapterWithBackup，不另造写协议。
 */
export function serializeFrontmatter(data) {
  const lines = ['---']
  for (const [key, value] of Object.entries(data || {})) {
    if (!/^[A-Za-z_][\w-]*$/u.test(key)) continue
    if (Array.isArray(value)) {
      const items = value.map((v) => text(v).trim()).filter(Boolean)
      if (!items.length) continue
      // 短列表用 flow，长列表用块状
      if (items.every((x) => !/[,:\x5b\x5d{}]/u.test(x)) && items.join(', ').length < 60) {
        lines.push(`${key}: [${items.join(', ')}]`)
      } else {
        lines.push(`${key}:`)
        for (const item of items) lines.push(`  - ${item}`)
      }
      continue
    }
    if (value === null || value === undefined) continue
    const s2 = text(value).trim()
    if (!s2) continue
    // 含冒号/井号等 YAML 敏感字符时加引号
    lines.push(/[:#\x5b\x5d{}]/u.test(s2) ? `${key}: "${s2.replace(/"/g, '\\"')}"` : `${key}: ${s2}`)
  }
  lines.push('---')
  return lines.join('\n')
}

export function parseFrontmatter(source) {
  const raw = text(source).replace(/\r\n?/gu, '\n')
  if (!raw.startsWith('---\n')) return { data: {}, body: raw, endLine: 0 }
  const end = raw.indexOf('\n---', 4)
  if (end === -1) return { data: {}, body: raw, endLine: 0 }
  const block = raw.slice(4, end)
  const body = raw.slice(raw.indexOf('\n', end + 1) + 1 || raw.length)
  const data = {}
  const lines = block.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i]
    const match = /^([A-Za-z_][\w-]*)\s*:\s*(.*)$/u.exec(line)
    if (!match) continue
    const key = match[1]
    const value = match[2].trim()
    if (value === '') {
      // 块状数组：后续 `- item` 行
      const items = []
      for (let j = i + 1; j < lines.length; j += 1) {
        const item = /^\s*-\s+(.*)$/u.exec(lines[j])
        if (!item) break
        items.push(unquote(item[1].trim()))
        i = j
      }
      data[key] = items
      continue
    }
    // flow 数组 [a, b]
    if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',').map((part) => unquote(part.trim())).filter(Boolean)
      continue
    }
    data[key] = unquote(value)
  }
  return { data, body, endLine: block.split('\n').length + 1 }
}

function unquote(value) {
  const raw = text(value).trim()
  if ((raw.startsWith('"') && raw.endsWith('"')) || (raw.startsWith("'") && raw.endsWith("'"))) {
    return raw.slice(1, -1)
  }
  return raw
}

/** frontmatter 里的 tags（flow/块状/单字符串三种形态都认）。 */
export function frontmatterTags(data) {
  const value = data?.tags ?? data?.tag
  if (!value) return []
  const list = Array.isArray(value) ? value : [value]
  return list
    .flatMap((item) => text(item).split(/[,，]/u))
    .map((item) => text(item).trim().replace(/^#/u, ''))
    .filter(Boolean)
}

/* ---------- 双链 ---------- */

/**
 * `[[目标]]` / `[[目标|显示]]` / `[[目标#标题]]` / `![[嵌入]]`。
 * 同样先掩码再扫。
 */
export function extractWikiLinks(source) {
  const masked = maskCode(source)
  const links = []
  for (const match of masked.matchAll(/!?\[\[([^\]\n]+)\]\]/gu)) {
    const inner = match[1]
    const pipe = inner.indexOf('|')
    const targetPart = pipe === -1 ? inner : inner.slice(0, pipe)
    const display = pipe === -1 ? '' : inner.slice(pipe + 1)
    const hash = targetPart.indexOf('#')
    const target = (hash === -1 ? targetPart : targetPart.slice(0, hash)).trim()
    const anchor = hash === -1 ? '' : targetPart.slice(hash + 1).trim()
    if (!target && !anchor) continue
    links.push({
      target,
      ...(anchor ? { anchor } : {}),
      ...(display ? { display: display.trim() } : {}),
      embed: match[0].startsWith('!'),
      raw: match[0]
    })
  }
  return links
}

/* ---------- 扫描 ---------- */

async function walk(dir, base, out, depth = 0) {
  if (depth > 4) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walk(abs, base, out, depth + 1)
      continue
    }
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (!REFERENCE_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue
    out.push(relative(base, abs).split(sep).join('/'))
  }
}

/** 参考标题：frontmatter.title → 首个 H1 → 文件名去扩展名。 */
function titleOf(frontmatter, body, relPath) {
  const fromMeta = text(frontmatter?.title).trim()
  if (fromMeta) return fromMeta
  const heading = /^#\s+(.+)$/mu.exec(text(body))
  if (heading) return heading[1].trim()
  return relPath.split('/').pop().replace(/\.(?:md|markdown|txt)$/iu, '')
}

/**
 * OS-75：从 frontmatter 提取图片引用（cover / portrait / images[] / refImages[]）。
 * 返回去重后的字符串数组，保持声明顺序（第一张即封面）。
 * 只认非空字符串——不解析、不校验可达性（渲染时按站内/外链分派）。
 */
function imagesOf(data) {
  const out = []
  const push = (value) => {
    if (Array.isArray(value)) { value.forEach(push); return }
    const s = text(value).trim()
    if (s && !out.includes(s)) out.push(s)
  }
  push(data.cover)
  push(data.portrait)
  push(data.images)
  push(data.refImages)
  push(data.ref_images)
  return out
}

/** 摘要：取正文第一段非空非标题文字，截 120 字。 */
function excerptOf(body) {
  const lines = text(body).split('\n')
  const chunks = []
  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#') || trimmed.startsWith('>') || trimmed.startsWith('```')) continue
    chunks.push(trimmed.replace(/^[-*+]\s+/u, ''))
    if (chunks.join(' ').length > 120) break
  }
  const joined = chunks.join(' ').replace(/\s+/gu, ' ').trim()
  return joined.length > 120 ? `${joined.slice(0, 120)}…` : joined
}

/**
 * 按首次出现章节筛词条（OS-96）：firstChapter ≤ currentChapter 才放行——
 * 0＝原生共识（开篇就成立），恒放行。currentChapter=null＝不过滤（世界书编辑视角要看全量）。
 * @param {Array<{firstChapter?:number}>} notes
 * @param {number|null} currentChapter 当前写到第几章；null＝全量
 */
export function notesVisibleAt(notes, currentChapter) {
  const limit = Number(currentChapter)
  if (!Number.isFinite(limit) || limit <= 0) return Array.isArray(notes) ? notes.slice() : []
  return (Array.isArray(notes) ? notes : []).filter((note) => (Number(note?.firstChapter) || 0) <= limit)
}

/**
 * 建参考索引。
 * @returns {Promise<{ok:true, notes:Array, tags:Array, tagNotes:Object, stats:Object}>}
 */
export async function scanReferences(root, { currentChapter = null } = {}) {
  const base = join(root, REFERENCE_DIR)
  if (!existsSync(base)) {
    return { ok: true, notes: [], tags: [], tagNotes: {}, stats: { notes: 0, tags: 0, links: 0, exists: false } }
  }
  const rels = []
  await walk(base, base, rels)
  const notes = []
  for (const rel of rels.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))) {
    const abs = join(base, rel.split('/').join(sep))
    let raw = ''
    let info = null
    try {
      raw = await readFile(abs, 'utf-8')
      info = await stat(abs)
    } catch {
      continue
    }
    const { data, body } = parseFrontmatter(raw)
    const inline = extractInlineTags(body)
    const fromMeta = frontmatterTags(data)
    const tags = [...new Set([...fromMeta, ...inline])]
    const links = extractWikiLinks(body)
    const isTagNote = text(data.kind).trim().toLowerCase() === TAG_NOTE_KIND
    // OS-75：消费图片字段（cover 单图 / images 多图 / portrait 人物肖像）。
    // 值可以是站内相对路径（相对库根）或 http(s) URL；空值/非字符串一律丢。
    const images = imagesOf(data)
    notes.push({
      path: `${REFERENCE_DIR}/${rel}`,
      rel,
      title: titleOf(data, body, rel),
      tags,
      links,
      // OS-96：首次出现章节（frontmatter.firstChapter，缺省 0＝原生共识——开篇就成立的知识）
      firstChapter: Number.isFinite(Number(data.firstChapter)) && Number(data.firstChapter) >= 0 ? Number(data.firstChapter) : 0,
      images,
      ...(images.length ? { cover: images[0] } : {}),
      excerpt: excerptOf(body),
      mtime: info.mtime.toISOString(),
      chars: body.replace(/\s/gu, '').length,
      ...(isTagNote ? {
        isTagNote: true,
        tagName: text(data.tag || data.name || titleOf(data, body, rel)).trim().replace(/^#/u, ''),
        description: text(data.description).trim(),
        color: text(data.color).trim()
      } : {})
    })
  }

  // 标签定义表：来自 kind:tag 的笔记
  const tagNotes = {}
  for (const note of notes) {
    if (!note.isTagNote || !note.tagName) continue
    tagNotes[note.tagName] = {
      description: note.description,
      color: note.color,
      path: note.path
    }
  }

  // 标签清单：出现过的全部标签（含未定义的），带计数
  const counter = new Map()
  for (const note of notes) {
    if (note.isTagNote) continue // 标签笔记本身不算该标签的使用者
    for (const tag of note.tags) counter.set(tag, (counter.get(tag) || 0) + 1)
  }
  for (const [tag, def] of Object.entries(tagNotes)) {
    if (!counter.has(tag)) counter.set(tag, counter.get(tag) || 0)
    void def
  }
  const tags = [...counter.entries()]
    .map(([name, count]) => ({
      name,
      count,
      ...(tagNotes[name]?.description ? { description: tagNotes[name].description } : {}),
      ...(tagNotes[name]?.color ? { color: tagNotes[name].color } : {})
    }))
    .sort((left, right) => right.count - left.count || left.name.localeCompare(right.name, 'zh-Hans-CN'))

  const linkTotal = notes.reduce((sum, note) => sum + note.links.length, 0)
  return {
    ok: true,
    notes,
    tags,
    tagNotes,
    stats: { notes: notes.length, tags: tags.length, links: linkTotal, exists: true }
  }
}

/* ---------- 图谱 ---------- */

/**
 * 从索引构图。
 *
 * 单向原则：边只从「参考」出发指向产物。正文里的 `[[某参考]]` 只作为正文的出边，
 * 不会让参考反向拿到正文内容——这是作者要求的「参考不污染正文上下文」。
 *
 * 节点 kind：reference / chapter / artifact / entry（只读）/ tag
 * 边权照 Pinax worldbookFileContract 的口径：link=2、mention=min(n,3)、tag=1。
 */
export function buildReferenceGraph(index, { entries = [] } = {}) {
  const notes = Array.isArray(index?.notes) ? index.notes : []
  const nodes = new Map()
  const edges = new Map()

  const ensureNode = (id, patch) => {
    if (!nodes.has(id)) nodes.set(id, { id, ...patch })
    else Object.assign(nodes.get(id), patch)
    return nodes.get(id)
  }
  const addEdge = (a, b, src, weight) => {
    if (!a || !b || a === b) return
    const [left, right] = a < b ? [a, b] : [b, a]
    const key = `${left}\u0000${right}`
    const prev = edges.get(key)
    if (prev) {
      prev.weight += weight
      if (!prev.sources.includes(src)) prev.sources.push(src)
      return
    }
    edges.set(key, { a: left, b: right, weight, sources: [src] })
  }

  // 参考节点
  for (const note of notes) {
    if (note.isTagNote) continue
    ensureNode(note.path, {
      kind: 'reference',
      label: note.title,
      tags: note.tags,
      excerpt: note.excerpt,
      chars: note.chars
    })
  }

  // 标签节点 + 参考→标签边
  for (const note of notes) {
    if (note.isTagNote) continue
    for (const tag of note.tags) {
      ensureNode(`tag:${tag}`, {
        kind: 'tag',
        label: `#${tag}`,
        ...(index.tagNotes?.[tag]?.description ? { excerpt: index.tagNotes[tag].description } : {})
      })
      addEdge(note.path, `tag:${tag}`, 'tag', 1)
    }
  }

  // 参考 ↔ 参考（双链）：只在参考之间双向，仍是「参考域内」
  const byTitle = new Map()
  for (const note of notes) {
    if (note.isTagNote) continue
    byTitle.set(note.title, note.path)
    byTitle.set(note.rel.replace(/\.(?:md|markdown|txt)$/iu, ''), note.path)
    byTitle.set(note.rel, note.path)
  }
  for (const note of notes) {
    if (note.isTagNote) continue
    for (const link of note.links) {
      const target = text(link.target).trim()
      if (!target) continue
      // 条目链接：[[条目:id]]
      const entryMatch = /^条目[:：](.+)$/u.exec(target)
      if (entryMatch) {
        const entryId = entryMatch[1].trim()
        const found = (Array.isArray(entries) ? entries : []).find((entry) => text(entry?.id) === entryId)
        if (found) {
          ensureNode(`entry:${entryId}`, {
            kind: 'entry',
            label: text(found.name) || entryId,
            readonly: true,
            layer: text(found.layer),
            excerpt: text(found.definition || found.summary).slice(0, 120)
          })
          addEdge(note.path, `entry:${entryId}`, 'link', 2)
        }
        continue
      }
      // 产物链接：[[正文/003-倒带.md]] 或 [[剧本/xxx.md]]
      if (/^(?:正文|剧本|人物|场景|大纲|素材|漫画|视频|体验|联机|资料|约束|构思)[\\/]/u.test(target)) {
        const path = target.replaceAll('\\', '/')
        ensureNode(path, { kind: 'artifact', label: path.split('/').pop(), readonly: true })
        addEdge(note.path, path, 'link', 2)
        continue
      }
      // 参考互链（按标题或相对路径）
      const hit = byTitle.get(target) || byTitle.get(target.replace(/\.(?:md|markdown|txt)$/iu, ''))
      if (hit) addEdge(note.path, hit, 'link', 2)
    }
  }

  const nodeList = [...nodes.values()]
  const edgeList = [...edges.values()]
  const isolated = nodeList.filter((node) => !edgeList.some((edge) => edge.a === node.id || edge.b === node.id)).length
  return {
    nodes: nodeList,
    edges: edgeList,
    tags: Array.isArray(index?.tags) ? index.tags : [],
    stats: {
      nodes: nodeList.length,
      edges: edgeList.length,
      isolated,
      byKind: nodeList.reduce((acc, node) => {
        acc[node.kind] = (acc[node.kind] || 0) + 1
        return acc
      }, {})
    }
  }
}

/**
 * 反链：哪些参考链接到了这篇笔记。
 * 只统计参考域内的入边——正文里的 [[...]] 不参与（单向原则）。
 */
export function backlinksOf(index, targetPath) {
  const notes = Array.isArray(index?.notes) ? index.notes : []
  const target = notes.find((note) => note.path === targetPath)
  if (!target) return { linked: [], unlinked: [] }
  const names = new Set([target.title, target.rel.replace(/\.(?:md|markdown|txt)$/iu, '')])
  const linked = []
  const unlinked = []
  for (const note of notes) {
    if (note.isTagNote || note.path === targetPath) continue
    const hit = note.links.some((link) => names.has(text(link.target).trim()) || names.has(text(link.target).trim().replace(/\.(?:md|markdown|txt)$/iu, '')))
    if (hit) {
      linked.push({ path: note.path, title: note.title, excerpt: note.excerpt })
      continue
    }
    // unlinked：正文里提到了标题但没建链接
    for (const name of names) {
      if (name.length < 2) continue
      if (text(note.excerpt).includes(name)) {
        unlinked.push({ path: note.path, title: note.title, excerpt: note.excerpt })
        break
      }
    }
  }
  return { linked, unlinked }
}

/* ---------- 旧目录迁入参考（OS-48）---------- */

/** 通用递归列文件（供迁移规划用；参考扫描的 walk 绑死了 参考/ 基目录）。 */
async function walkPlain(dir, base, out, depth, fspImpl) {
  if (depth > 4) return
  let entries
  try {
    entries = await fspImpl.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const abs = join(dir, entry.name)
    if (entry.isDirectory()) {
      await walkPlain(abs, base, out, depth + 1, fspImpl)
      continue
    }
    if (!entry.isFile()) continue
    const lower = entry.name.toLowerCase()
    if (!REFERENCE_EXTENSIONS.some((ext) => lower.endsWith(ext))) continue
    out.push(relative(base, abs).split(sep).join('/'))
  }
}

/**
 * 迁移规划（OS-48）：列出「旧目录 → 参考/<原名>/」要搬哪些文件，目标已存在则记 skipped 不覆盖。
 * 只规划不落盘——真搬运由 daemon 路由编排（原子写目标 + 源文件进 .history），fsImpl 可注入便于单测。
 * @returns {{ ok: boolean, moves: {fromRel,toRel}[], skipped: {path,reason}[], dirs: string[] }}
 */
export async function absorbLegacyDirs(root, dirs = [], fsImpl = { readdir, stat }) {
  const wanted = [...new Set((Array.isArray(dirs) ? dirs : []).map((item) => text(item).trim()))]
    .filter((item) => ABSORBABLE_DIRS.includes(item))
  if (!wanted.length) {
    return { ok: false, code: 'INVALID_ENTRY', message: `只接受这些目录：${ABSORBABLE_DIRS.join('、')}`, moves: [], skipped: [], dirs: [] }
  }
  const moves = []
  const skipped = []
  for (const dir of wanted) {
    const rels = []
    await walkPlain(join(root, dir), join(root, dir), rels, 0, fsImpl)
    if (!rels.length) continue
    for (const rel of rels.sort((left, right) => left.localeCompare(right, 'zh-Hans-CN'))) {
      const fromRel = `${dir}/${rel}`
      const toRel = `${REFERENCE_DIR}/${dir}/${rel}`
      try {
        await fsImpl.stat(join(root, ...toRel.split('/')))
        skipped.push({ path: fromRel, reason: `目标已存在：${toRel}（不覆盖）` })
        continue
      } catch { /* 目标不存在，正常搬运 */ }
      moves.push({ fromRel, toRel })
    }
  }
  return { ok: true, moves, skipped, dirs: wanted }
}
