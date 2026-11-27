/**
 * KB 路由层（KB-ARCH P0）——把「体裁×意图」翻译成 WeKnora 库路由与知识块装配。
 *
 * 职责：
 *   routeQuery({genre, intent}) → {collectionIds, rationale}   库路由（kb-config.collections 的别名）
 *   knowledgePromptSection(hits) → string                      检索结果 → 可注入的提示段（过守卫的确定性拼装，无 LLM）
 *
 * 设计口径：
 *   - 库别名与 kb-config.json collections 对齐（技法库/文风库/套路库/信号库/案例库/素材库）。
 *   - intent：style=写成什么样（文风库）；precedent=同型先例（案例库＋套路库）；signal=读者为什么吃（信号库）；
 *     recipe=怎么做（技法库）；all=按体裁全查。
 *   - 案例先例弱命中自动丢弃（score < PRECEDENT_MIN）：短篇案例卡对长篇任务不强塞。
 */
import { readFileSync, existsSync } from 'node:fs'

export const KB_INTENTS = Object.freeze(['style', 'precedent', 'signal', 'recipe', 'all'])
export const PRECEDENT_MIN = 0.45

const ROUTE = {
  style: ['文风库'],
  precedent: ['案例库', '套路库'],
  signal: ['信号库'],
  recipe: ['技法库'],
  all: ['文风库', '案例库', '套路库', '信号库', '技法库']
}

/** 库路由：返回 kb-config.collections 里的别名集合。 */
export function routeQuery({ genre = '', intent = 'all' } = {}) {
  const wanted = String(intent || 'all').trim()
  if (!KB_INTENTS.includes(wanted)) {
    return { ok: false, error: `未知意图：${wanted}（可选 ${KB_INTENTS.join('/')}）` }
  }
  const collections = ROUTE[wanted]
  return {
    ok: true,
    intent: wanted,
    genre: String(genre || '').trim(),
    collectionIds: [...collections],
    rationale: `intent=${wanted} → ${collections.join('+')}${genre ? `（genre=${genre}）` : ''}`
  }
}

/** 从 kb-config.json 读别名→真实 KB id（不存在/缺配置时返回空映射，调用方降级）。 */
export function resolveCollections(configPath) {
  if (!configPath || !existsSync(configPath)) return { ok: false, code: 'KB_NOT_CONFIGURED', error: 'kb-config 不存在', map: {} }
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
    if (!cfg || typeof cfg !== 'object' || Array.isArray(cfg)) {
      return { ok: false, code: 'KB_CONFIG_CORRUPT', error: 'kb-config 不是合法 JSON 对象', map: {} }
    }
    const map = cfg.collections && typeof cfg.collections === 'object' && !Array.isArray(cfg.collections) ? { ...cfg.collections } : {}
    if (!cfg.baseUrl || !cfg.apiKey) return { ok: false, code: 'KB_NOT_CONFIGURED', error: 'kb-config 缺 baseUrl/apiKey', map }
    return { ok: true, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, map }
  } catch {
    // Node 的 JSON 解析错误会回显配置片段；边界只回稳定类型，避免密钥/内容进入日志。
    return { ok: false, code: 'KB_CONFIG_CORRUPT', error: 'kb-config 不可读或不是合法 JSON', map: {} }
  }
}

function canonicalProvenance(hit, meta) {
  const source = hit?.provenance && typeof hit.provenance === 'object' ? hit.provenance : {}
  const knowledgeId = textOf(hit?.knowledgeId ?? hit?.knowledge_id ?? meta.knowledgeId ?? source.knowledgeId)
  const knowledgeBaseId = textOf(hit?.knowledgeBaseId ?? hit?.knowledge_base_id ?? meta.knowledgeBaseId ?? source.knowledgeBaseId)
  const chunkIndex = hit?.chunkIndex ?? hit?.chunk_index ?? meta.chunkIndex ?? source.chunkIndex
  const chunkId = textOf(hit?.chunkId ?? hit?.chunk_id ?? meta.chunkId ?? source.chunkId)
  const documentRef = textOf(hit?.ref ?? hit?.documentRef ?? meta.documentRef ?? source.documentRef)
  return {
    ...source,
    documentRef,
    chunkId,
    locator: textOf(hit?.locator ?? meta.locator ?? source.locator ?? chunkId ?? (chunkIndex !== undefined ? `chunk:${chunkIndex}` : '')),
    documentHash: textOf(hit?.hash ?? hit?.documentHash ?? meta.documentHash ?? source.documentHash),
    ...(knowledgeId ? { knowledgeId } : {}),
    ...(knowledgeBaseId ? { knowledgeBaseId } : {}),
    ...(chunkIndex !== undefined ? { chunkIndex } : {})
  }
}

function textOf(value) {
  return String(value ?? '')
}

/**
 * 统一 hit 的纯 canonical 化：保留文档/chunk 身份与 provenance，供后续 service 复用。
 * source/title 只是展示字段，不能替代 knowledgeId/knowledgeBaseId/chunkIndex。
 */
export function canonicalizeHit(hit, context = {}) {
  const meta = hit?.meta && typeof hit.meta === 'object' ? hit.meta : {}
  const provenance = canonicalProvenance(hit, meta)
  const chunkIndex = hit?.chunkIndex ?? hit?.chunk_index ?? meta.chunkIndex ?? provenance.chunkIndex
  return {
    ...hit,
    libraryId: textOf(hit?.libraryId ?? hit?.library_id ?? context.libraryId),
    ref: textOf(hit?.ref ?? hit?.documentRef ?? provenance.documentRef),
    title: textOf(hit?.title ?? hit?.knowledge_title ?? hit?.source ?? hit?.ref ?? provenance.documentRef),
    text: textOf(hit?.text ?? hit?.content),
    score: Number(hit?.score ?? hit?.similarity ?? 0) || 0,
    source: textOf(hit?.source ?? hit?.knowledge_title ?? hit?.title ?? context.provider ?? hit?.knowledgeBaseId ?? hit?.knowledge_base_id),
    hash: textOf(hit?.hash ?? hit?.documentHash ?? meta.documentHash ?? provenance.documentHash),
    tags: Array.isArray(hit?.tags) ? hit.tags.map(textOf) : [],
    provenance,
    knowledgeId: textOf(hit?.knowledgeId ?? hit?.knowledge_id ?? meta.knowledgeId ?? provenance.knowledgeId),
    knowledgeBaseId: textOf(hit?.knowledgeBaseId ?? hit?.knowledge_base_id ?? meta.knowledgeBaseId ?? provenance.knowledgeBaseId),
    ...(chunkIndex !== undefined ? { chunkIndex } : {})
  }
}

/** 统一命中集合：按真实身份去重，并对 text 施加总字符预算（不是每块预算）。 */
export function canonicalizeAndBudgetHits(hits, { budgetChars = 6000 } = {}) {
  const budget = Number.isFinite(budgetChars) ? Math.max(0, Math.floor(budgetChars)) : 6000
  const seen = new Set()
  const output = []
  let used = 0
  for (const raw of Array.isArray(hits) ? hits : []) {
    const hit = canonicalizeHit(raw)
    if (!hit.text) continue
    const identity = hit.libraryId || hit.ref || hit.knowledgeBaseId || hit.knowledgeId || hit.hash || hit.title
    const chunk = hit.provenance.chunkId || hit.provenance.locator || (hit.chunkIndex !== undefined ? `chunk:${hit.chunkIndex}` : hit.id || hit.text)
    const key = `${identity}\0${chunk}`
    if (seen.has(key)) continue
    seen.add(key)
    const remaining = budget - used
    if (remaining <= 0) break
    const text = hit.text.length > remaining ? hit.text.slice(0, remaining) : hit.text
    used += text.length
    output.push({ ...hit, text })
  }
  return output
}

/** 总预算的纯入口；供后续 service 在不装配提示段时复用同一口径。 */
export function applyHitBudget(hits, budgetChars = 6000) {
  return canonicalizeAndBudgetHits(hits, { budgetChars })
}

/**
 * 检索结果 → 提示段。hits: [{source, title, text, score}]，按 source 分块装配：
 *   【技法·name】【文风·name】【案例·《title》】【信号·…】
 * 确定性拼装（无 LLM、无改写）：只做裁剪（每块 maxChars）与排序；空命中返回 ''。
 */
export function knowledgePromptSection(hits, { maxChars = 1800, budgetChars } = {}) {
  const ordered = (Array.isArray(hits) ? hits : []).filter((h) => h && typeof h.text === 'string' && h.text.trim())
  if (!ordered.length) return ''
  const list = budgetChars === undefined ? ordered : applyHitBudget(ordered, budgetChars)
  const ORDER = { style: 0, recipe: 1, precedent: 2, signal: 3 }
  const sorted = [...list].sort((a, b) => (ORDER[a.source] ?? 9) - (ORDER[b.source] ?? 9))
  const parts = []
  for (const hit of sorted) {
    const bareTitle = String(hit.title ?? '').replace(/^《|》$/g, '')
    const label = bareTitle ? `${hit.source === 'precedent' ? `案例·《${bareTitle}》` : `${hit.source}·${bareTitle}`}` : `${hit.source}·未命名`
    const body = hit.text.trim().slice(0, maxChars)
    parts.push(`【${label}】\n${body}`)
  }
  return parts.join('\n\n')
}

/**
 * 装配「检索增强写作」的完整指令块（评测与 daemon 共用口径）。
 * task: 写作任务描述；kbHits: knowledgePromptSection 的输入；requirements: 追加要求。
 */
export function buildAugmentedPrompt(task, kbHits, { requirements = [] } = []) {
  const lines = [`【写作任务】\n${String(task || '').trim()}`]
  const kb = knowledgePromptSection(kbHits)
  if (kb) lines.push(kb)
  const reqs = [
    '正文即小说排版：不使用任何 Markdown 语法（不用 #、*、>、列表）；小节号/章节号单独成行。',
    '对白一律用中文弯引号“”包裹、一句一行（不用「」、不用直引号、不写「我说，……」式无引号对白）。',
    '按以上技法与指纹写作，不得复述原文语句。',
    ...(requirements.length ? requirements : [])
  ]
  lines.push(`【要求】\n- ${reqs.join('\n- ')}`)
  return lines.join('\n\n')
}

/* ---------- Agent 先例钩子（OS-229：统一 service 接线前的显式空态） ---------- */

/**
 * 暂时明确返回空串：不再用 genre-only 缓存，也不再直连 WeKnora 旁路。
 * 这不是“已检索但无命中”；统一 KnowledgeSearchService 接线前不得注入假先例。
 * 保留 async 签名与既有调用方，待 service 提供同源 hits 后在此装配。
 */
export async function precedentPromptSectionForGenre(genreLabel, { configPath: _configPath, timeoutMs: _timeoutMs, minScore: _minScore } = {}) {
  void genreLabel
  return ''
}
