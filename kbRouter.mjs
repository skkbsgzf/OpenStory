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
  if (!configPath || !existsSync(configPath)) return { ok: false, error: 'kb-config 不存在', map: {} }
  try {
    const cfg = JSON.parse(readFileSync(configPath, 'utf-8'))
    const map = cfg.collections && typeof cfg.collections === 'object' ? { ...cfg.collections } : {}
    if (!cfg.baseUrl || !cfg.apiKey) return { ok: false, error: 'kb-config 缺 baseUrl/apiKey', map }
    return { ok: true, baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, map }
  } catch (error) {
    return { ok: false, error: `kb-config 解析失败：${error.message}`, map: {} }
  }
}

/**
 * 检索结果 → 提示段。hits: [{source, title, text, score}]，按 source 分块装配：
 *   【技法·name】【文风·name】【案例·《title》】【信号·…】
 * 确定性拼装（无 LLM、无改写）：只做裁剪（每块 maxChars）与排序；空命中返回 ''。
 */
export function knowledgePromptSection(hits, { maxChars = 1800 } = {}) {
  const list = (Array.isArray(hits) ? hits : []).filter((h) => h && typeof h.text === 'string' && h.text.trim())
  if (!list.length) return ''
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

/* ---------- daemon 接线（v1：先例检索，带缓存与超时降级） ---------- */

const PRECEDENT_CACHE = new Map()

/**
 * 按题材标签检索「同题材先例」，返回可直接注入的提示段（失败/无配置返回 ''，绝不阻塞对话）。
 * genreLabel: 体裁中文名（如 短剧/长篇连载）；configPath: kb-config.json 路径。
 */
export async function precedentPromptSectionForGenre(genreLabel, { configPath, timeoutMs = 6000, minScore = PRECEDENT_MIN } = {}) {
  const key = String(genreLabel || '').trim()
  if (!key) return ''
  if (PRECEDENT_CACHE.has(key)) return PRECEDENT_CACHE.get(key)
  let section = ''
  try {
    const cfg = resolveCollections(configPath)
    if (cfg.ok) {
      const ids = ['案例库', '套路库'].map((alias) => cfg.map[alias]).filter(Boolean)
      if (ids.length) {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), timeoutMs)
        const r = await fetch(`${cfg.baseUrl}/api/v1/knowledge-search`, {
          method: 'POST',
          signal: ctrl.signal,
          headers: { 'X-API-Key': cfg.apiKey, 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: key, knowledge_base_ids: ids, match_count: 2 })
        })
        clearTimeout(timer)
        const d = await r.json()
        const hits = (Array.isArray(d.data) ? d.data : [])
          .filter((c) => Number(c.score ?? 0) >= minScore)
          .map((c) => ({ source: 'precedent', title: c.knowledge_title ?? '', text: c.content ?? '', score: c.score }))
        section = knowledgePromptSection(hits, { maxChars: 1200 })
      }
    }
  } catch { /* KB 不可用＝静默降级，不注入 */ }
  PRECEDENT_CACHE.set(key, section)
  return section
}
