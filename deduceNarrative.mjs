/* 推演叙事上下文构建（OS-79）
 *
 * 作者口径：现在的推演是「裸跑团」——给了局面但没告诉玩家：
 *   我是谁 / 我在哪 / 前面发生了什么 / 我现在该做什么决策
 *
 * 本模块从库里已有的数据（wiki + fact 条目 + 推演会话历史）拼出这三层，
 * 让推演页能像 galgame 那样开场：先有场景与身份，再有选择。
 *
 * 数据来源（全部只读，不改任何文件）：
 *   · wiki.storySummary        → 前情提要（整本书讲了什么）
 *   · wiki.chapterSummaries    → 到当前进度为止的章节回顾
 *   · wiki.characterProfiles   → POV 角色的身份/目标/性格
 *   · fact character 条目      → 角色的 identity / anchors.speech
 *   · 推演会话 nodes           → 前几拍实际发生了什么（最近 3 拍正文）
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const text = (v) => String(v ?? '')

/** 读兄弟 wiki 文件（<bookId>.wiki.json）；没有就返回 null。 */
export function readWikiSafe(root, bookId) {
  const p = join(root, '拆解', `${bookId}.wiki.json`)
  if (!existsSync(p)) return null
  try { return JSON.parse(readFileSync(p, 'utf-8')) } catch { return null }
}

/** 从 fact 条目里挑出某个角色的档案。 */
function findCharacterEntry(entries, name) {
  const wanted = text(name).trim()
  if (!wanted) return null
  return (Array.isArray(entries) ? entries : [])
    .find((e) => text(e?.layer).toLowerCase() === 'character' && text(e?.name).trim() === wanted) ?? null
}

/** wiki 里的角色档（enrich 产出，字段更全）。 */
function findProfile(wiki, name) {
  const wanted = text(name).trim()
  if (!wanted) return null
  return (Array.isArray(wiki?.characterProfiles) ? wiki.characterProfiles : [])
    .find((p) => text(p?.name).trim() === wanted) ?? null
}

/**
 * 构建「我是谁」——POV 角色的身份卡。
 * 优先 wiki 角色档（identity/goal/personality），回落 fact 条目（identity/anchors）。
 */
export function buildIdentity({ entries, wiki, pov }) {
  const name = text(pov).trim()
  if (!name) return null
  const profile = findProfile(wiki, name)
  const entry = findCharacterEntry(entries, name)
  const identity = text(profile?.identity) || text(entry?.identity) || ''
  const goal = text(profile?.goal) || ''
  const personality = Array.isArray(profile?.personality) ? profile.personality.filter(Boolean) : []
  const archetype = text(profile?.archetype) || ''
  const speech = Array.isArray(entry?.anchors?.speech) ? entry.anchors.speech.filter(Boolean).slice(0, 3) : []
  const summary = text(profile?.summary) || text(entry?.definition) || ''
  if (!identity && !goal && !personality.length && !summary) {
    // 什么档案都没有——至少给名字，别让玩家猜自己是谁
    return { name, identity: '', goal: '', personality: [], archetype: '', speech: [], summary: '', missing: true }
  }
  return { name, identity, goal, personality, archetype, speech, summary, missing: false }
}

/**
 * 构建「前情提要」——三段：
 *   · story  整本书讲了什么（wiki.storySummary，压到 160 字）
 *   · soFar  到当前进度为止发生了什么（chapterSummaries 里 ≤ 当前章的摘要）
 *   · recent 最近几拍实际正文（推演会话 nodes，取最近 3 拍的 prose 首句）
 */
export function buildRecap({ wiki, session, currentChapter = 0, recentLimit = 3 }) {
  const story = text(wiki?.storySummary).slice(0, 220)
  const chapters = Array.isArray(wiki?.chapterSummaries) ? wiki.chapterSummaries : []
  const soFar = chapters
    .filter((c) => Number(c?.chapter) <= Math.max(1, Number(currentChapter) || 1))
    .map((c) => ({ chapter: Number(c.chapter) || 0, title: text(c.title), summary: text(c.summary) }))
    .filter((c) => c.summary)
  // 最近几拍：从会话 nodes 里取带 prose 的，按 round 倒序取 N 条，再正序返回
  const nodes = Array.isArray(session?.nodes) ? session.nodes : []
  const withProse = nodes
    .filter((n) => text(n?.prose).trim())
    .sort((a, b) => (Number(b.round) || 0) - (Number(a.round) || 0))
    .slice(0, Math.max(0, Number(recentLimit) || 0))
    .map((n) => ({
      round: Number(n.round) || 0,
      branchId: text(n.branchId) || 'main',
      excerpt: text(n.prose).replace(/\s+/gu, ' ').trim().slice(0, 100)
    }))
    .reverse()
  return { story, soFar, recent: withProse }
}

/**
 * 构建「我看见什么」——场景卡的人话版。
 * 引擎给的 sceneCard 只有 who/where/tension/hook 四个字段，这里把它翻译成一段可读的场景描写 +
 * 在场人物的身份提示（从条目里取 identity，让人知道「面前这人是谁」）。
 */
export function buildScene({ sceneCard, entries, wiki, pov }) {
  const card = sceneCard ?? {}
  const who = Array.isArray(card.who) ? card.who.filter(Boolean) : []
  const where = text(card.where)
  const whereKnown = where && where !== '未标记地点'
  const tension = text(card.tension)
  const hook = text(card.hook)
  const hookKnown = hook && hook !== '……'
  // 在场人物档案（除 POV 自己）
  const others = who
    .filter((name) => text(name) !== text(pov))
    .map((name) => {
      const p = findProfile(wiki, name)
      const e = findCharacterEntry(entries, name)
      return {
        name,
        identity: text(p?.identity) || text(e?.identity) || '',
        archetype: text(p?.archetype) || ''
      }
    })
  // 场景描写：没有真立绘也能读——用地点 + 在场 + 张力拼一句人话
  const sceneText = [
    whereKnown ? `你在${where}。` : '',
    who.length ? `${who.join('、')}${who.length > 1 ? '都在场' : '在场'}。` : '四下无人。',
    tension ? `气氛${tension.includes('顺遂') ? '暂且松下来' : tension.includes('受阻') ? '紧了起来' : '悬着'}。` : '',
    hookKnown ? `${hook}` : ''
  ].filter(Boolean).join('')
  return { where: whereKnown ? where : '', who, others, tension, hook: hookKnown ? hook : '', text: sceneText }
}

/**
 * 总装：一次拼齐 galgame 开场需要的所有上下文。
 * @returns {{identity, recap, scene, pov, ready:boolean, missing:string[]}}
 */
export function buildNarrativeContext({ entries, wiki, session, sceneCard, pov, currentChapter }) {
  const identity = buildIdentity({ entries, wiki, pov })
  const recap = buildRecap({ wiki, session, currentChapter })
  const scene = buildScene({ sceneCard, entries, wiki, pov })
  const missing = []
  if (!identity) missing.push('pov')
  else if (identity.missing) missing.push('character-profile')
  if (!scene.where) missing.push('location')
  if (!recap.story && !recap.soFar.length) missing.push('recap')
  return {
    pov: text(pov),
    identity,
    recap,
    scene,
    ready: missing.length === 0,
    missing
  }
}
