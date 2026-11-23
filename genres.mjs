/**
 * 体裁与形制（OS-19）——项目级一等约束。
 *
 * 一份体裁＝一个 JSON（openstory-genre@1），声明：交付物 / 必需与可选载体 / 篇幅与分章分集 /
 * Agent 策略（节奏、开篇、审查重点、禁忌）。内置六类（genres/），本机可取同名覆盖（社区自备形制）。
 *
 * 项目简报 brief.json（openstory-brief@1）落 `<库根>/.openstory/brief.json`：
 * 体裁选定后的实例化结果，是页签裁剪与 Agent 策略注入的唯一依据。
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { atomicWriteFile } from './hostWrite.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

export const GENRE_SPEC = 'openstory-genre@1'
export const BRIEF_SPEC = 'openstory-brief@1'
export const BRIEF_DIR = '.openstory'
export const BRIEF_FILE = 'brief.json'
const DELIVERABLES = new Set(['novel', 'script', 'comic', 'game'])
const UNITS = new Set(['chars', 'episodes', 'minutes'])
const DIVIDE_BY = new Set(['chapter', 'episode', 'scene', 'none'])

function text(value) {
  return String(value ?? '')
}

export function builtinGenresDir() {
  return join(HERE, 'genres')
}

export function defaultUserGenresDir(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'genres') : ''
}

function range(value) {
  if (!value || typeof value !== 'object') return null
  const min = Number(value.min)
  const target = Number(value.target)
  const max = Number(value.max)
  if (![min, target, max].every((n) => Number.isFinite(n) && n > 0)) return null
  return { min, target, max }
}

/** 单体裁规整：schema/id/交付物/载体/篇幅联动逐项把门。 */
export function normalizeGenre(raw, { source, file } = {}) {
  const where = `${source}·${text(file)}`
  const bad = (code, message) => ({ ok: false, warning: { code, file: where, message: `${message}：${where}` } })
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return bad('GENRE_SHAPE', '体裁声明不是对象')
  if (text(raw.schemaVersion).trim() !== GENRE_SPEC) return bad('GENRE_SPEC', `schemaVersion 必须是 ${GENRE_SPEC}`)
  const id = text(raw.id).trim()
  if (!/^[\w-]{1,40}$/u.test(id)) return bad('GENRE_ID', 'id 非法（只许字母数字-_）')
  const name = text(raw.name).trim()
  if (!name) return bad('GENRE_NAME', '缺 name')
  const deliverables = (Array.isArray(raw.deliverables) ? raw.deliverables : []).map((item) => text(item).trim()).filter(Boolean)
  if (!deliverables.length) return bad('GENRE_DELIVERABLES', 'deliverables 至少一项')
  for (const item of deliverables) if (!DELIVERABLES.has(item)) return bad('GENRE_DELIVERABLES', `交付物只收 novel/script/comic/game：${item}`)

  const lengthRaw = raw.length && typeof raw.length === 'object' ? raw.length : {}
  const unit = text(lengthRaw.unit).trim() || 'chars'
  if (!UNITS.has(unit)) return bad('GENRE_LENGTH_UNIT', 'length.unit 只收 chars/episodes/minutes')
  const divideBy = text(lengthRaw.divideBy).trim() || 'none'
  if (!DIVIDE_BY.has(divideBy)) return bad('GENRE_DIVIDE', 'length.divideBy 只收 chapter/episode/scene/none')
  const total = range(lengthRaw.total)
  const perUnit = range(lengthRaw.perUnit)
  if (divideBy !== 'none' && !perUnit) return bad('GENRE_PER_UNIT', `divideBy=${divideBy} 时必须给 perUnit 区间`)

  const structureRaw = raw.structure && typeof raw.structure === 'object' ? raw.structure : {}
  const policyRaw = raw.agentPolicy && typeof raw.agentPolicy === 'object' ? raw.agentPolicy : {}
  return {
    ok: true,
    genre: {
      id,
      name,
      tier: text(raw.tier).trim() === 'primary' ? 'primary' : 'extended',
      summary: text(raw.summary).trim(),
      deliverables,
      requiredCarriers: (Array.isArray(raw.requiredCarriers) ? raw.requiredCarriers : []).map((c) => text(c).trim()).filter(Boolean),
      optionalCarriers: (Array.isArray(raw.optionalCarriers) ? raw.optionalCarriers : []).map((c) => text(c).trim()).filter(Boolean),
      excludedPages: (Array.isArray(raw.excludedPages) ? raw.excludedPages : []).map((p) => text(p).trim()).filter(Boolean),
      length: { unit, total, perUnit, divideBy },
      structure: {
        numbering: text(structureRaw.numbering).trim() || null,
        chapterHook: structureRaw.chapterHook === true
      },
      agentPolicy: {
        pacing: text(policyRaw.pacing).trim(),
        openHook: text(policyRaw.openHook).trim(),
        reviewFocus: (Array.isArray(policyRaw.reviewFocus) ? policyRaw.reviewFocus : []).map((x) => text(x).trim()).filter(Boolean),
        forbidden: (Array.isArray(policyRaw.forbidden) ? policyRaw.forbidden : []).map((x) => text(x).trim()).filter(Boolean)
      },
      knowledgePacks: (Array.isArray(raw.knowledgePacks) ? raw.knowledgePacks : []).map((p) => text(p).trim()).filter(Boolean),
      compatStyles: (Array.isArray(raw.compatStyles) ? raw.compatStyles : ['*']).map((s) => text(s).trim()).filter(Boolean),
      source
    }
  }
}

/** 货架装载：内置＋本机（本机按 id 覆盖内置）。坏档跳过＋warning。 */
export function loadGenres(dirs = []) {
  const warnings = []
  const byId = new Map()
  dirs.forEach((dir, index) => {
    const source = index === 0 ? '内置' : '本机'
    if (!text(dir).trim() || !existsSync(dir)) return
    let names = []
    try {
      names = readdirSync(dir).filter((name) => name.endsWith('.json'))
    } catch (error) {
      warnings.push({ code: 'GENRE_DIR_UNREADABLE', dir, message: `体裁目录读不了：${dir}（${text(error?.message || error)}）` })
      return
    }
    for (const name of names) {
      let raw
      try {
        raw = JSON.parse(readFileSync(join(dir, name), 'utf-8'))
      } catch (error) {
        warnings.push({ code: 'GENRE_UNREADABLE', file: `${source}·${name}`, message: `体裁读不了：${source}·${name}（${text(error?.message || error)}）` })
        continue
      }
      const normalized = normalizeGenre(raw, { source, file: name })
      if (!normalized.ok) {
        warnings.push(normalized.warning)
        continue
      }
      byId.set(normalized.genre.id, normalized.genre)
    }
  })
  const genres = [...byId.values()].sort((left, right) => {
    if (left.tier !== right.tier) return left.tier === 'primary' ? -1 : 1
    return left.name.localeCompare(right.name, 'zh-Hans-CN')
  })
  return { genres, warnings }
}

/* ---------- 项目简报（brief.json，一等约束的实例化） ---------- */

export function briefPath(root) {
  return join(text(root), BRIEF_DIR, BRIEF_FILE)
}

function validBrief(raw, genres) {
  if (!raw || typeof raw !== 'object') return null
  if (text(raw.schemaVersion) !== BRIEF_SPEC) return null
  const genre = genres.find((item) => item.id === text(raw.genre))
  if (!genre) return null
  const lengthRaw = raw.length && typeof raw.length === 'object' ? raw.length : {}
  return {
    schemaVersion: BRIEF_SPEC,
    genre: genre.id,
    deliverables: Array.isArray(raw.deliverables) && raw.deliverables.length
      ? raw.deliverables.map((x) => text(x)).filter((x) => DELIVERABLES.has(x))
      : [...genre.deliverables],
    length: {
      unit: UNITS.has(text(lengthRaw.unit)) ? text(lengthRaw.unit) : genre.length.unit,
      total: Number.isFinite(Number(lengthRaw.total)) ? Number(lengthRaw.total) : (genre.length.total?.target ?? null),
      perUnit: Number.isFinite(Number(lengthRaw.perUnit)) ? Number(lengthRaw.perUnit) : (genre.length.perUnit?.target ?? null),
      divideBy: DIVIDE_BY.has(text(lengthRaw.divideBy)) ? text(lengthRaw.divideBy) : genre.length.divideBy
    },
    createdAt: text(raw.createdAt),
    updatedAt: text(raw.updatedAt)
  }
}

/** 读项目简报：没有＝null（未声明体裁，属「未初始化」态，不报错）。 */
export async function readBrief(root, dirs) {
  const target = briefPath(root)
  let raw
  try {
    raw = await readFile(target, 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, brief: null, path: target }
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `简报读取失败：${text(error?.message || error)}`, path: target }
  }
  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return { ok: false, code: 'INVALID_ENTRY', message: `简报不是合法 JSON：${text(error?.message || error)}`, path: target }
  }
  const { genres } = loadGenres(dirs)
  const brief = validBrief(parsed, genres)
  if (!brief) return { ok: false, code: 'INVALID_ENTRY', message: '简报体裁未知或形状不对（先重新声明体裁）', path: target }
  return { ok: true, brief, path: target }
}

/** 写项目简报（原子写）。体裁必须进货架，篇幅落在体裁区间内（超界＝400）。 */
export async function writeBrief(root, dirs, input = {}) {
  const { genres } = loadGenres(dirs)
  const genre = genres.find((item) => item.id === text(input.genre).trim())
  if (!genre) return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个体裁：${text(input.genre)}` }
  const deliverables = Array.isArray(input.deliverables) && input.deliverables.length
    ? input.deliverables.map((x) => text(x).trim()).filter((x) => DELIVERABLES.has(x))
    : [...genre.deliverables]
  if (!deliverables.length || deliverables.some((item) => !genre.deliverables.includes(item))) {
    return { ok: false, code: 'INVALID_ENTRY', message: `交付物必须是该体裁允许的：${genre.deliverables.join('／')}` }
  }
  const lengthInput = input.length && typeof input.length === 'object' ? input.length : {}
  const divideBy = DIVIDE_BY.has(text(lengthInput.divideBy)) ? text(lengthInput.divideBy) : genre.length.divideBy
  const totalTarget = Number(lengthInput.total)
  const perUnitTarget = Number(lengthInput.perUnit)
  const total = Number.isFinite(totalTarget) && totalTarget > 0 ? totalTarget : (genre.length.total?.target ?? null)
  const perUnit = Number.isFinite(perUnitTarget) && perUnitTarget > 0 ? perUnitTarget : (genre.length.perUnit?.target ?? null)
  // 篇幅是硬约束的软边界：只挡明显越界（低于 min 的 50% 或高于 max 的 2 倍），不卡死创作
  if (total !== null && genre.length.total) {
    if (total < genre.length.total.min * 0.5 || total > genre.length.total.max * 2) {
      return { ok: false, code: 'INVALID_ENTRY', message: `总篇幅 ${total} 超出体裁「${genre.name}」的合理区间（${genre.length.total.min}–${genre.length.total.max}）` }
    }
  }
  if (divideBy !== 'none' && perUnit === null && genre.length.perUnit) {
    return { ok: false, code: 'INVALID_ENTRY', message: `体裁「${genre.name}」要求分${divideBy}，请给每单位篇幅目标` }
  }
  const now = new Date().toISOString()
  const existing = await readBrief(root, dirs)
  const brief = {
    schemaVersion: BRIEF_SPEC,
    genre: genre.id,
    deliverables,
    length: { unit: genre.length.unit, total, perUnit, divideBy },
    createdAt: existing.brief?.createdAt || now,
    updatedAt: now
  }
  const target = briefPath(root)
  try {
    await mkdir(dirname(target), { recursive: true })
    await atomicWriteFile(target, JSON.stringify(brief, null, 2))
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `简报写入失败：${text(error?.message || error)}` }
  }
  return { ok: true, brief, path: target }
}

/** Agent 策略段：把 brief＋体裁展开成 system prompt 的一段（没有 brief ＝空串）。 */
export function briefPromptSection(brief, genre) {
  if (!brief || !genre) return ''
  const lengthParts = []
  if (brief.length.total) lengthParts.push(`总篇幅目标约 ${brief.length.total} ${unitLabel(brief.length.unit)}`)
  if (brief.length.divideBy !== 'none' && brief.length.perUnit) {
    lengthParts.push(`按${divideLabel(brief.length.divideBy)}推进，每${divideLabel(brief.length.divideBy)}约 ${brief.length.perUnit} ${unitLabel(brief.length.unit)}`)
  }
  const lines = [
    `【作品体裁】${genre.name}（交付物：${brief.deliverables.map(deliverableLabel).join('／')}）`,
    lengthParts.length ? `【篇幅与结构】${lengthParts.join('；')}` : '',
    genre.agentPolicy.pacing ? `【节奏】${genre.agentPolicy.pacing}` : '',
    genre.agentPolicy.openHook ? `【开篇要求】${genre.agentPolicy.openHook}` : '',
    genre.agentPolicy.reviewFocus.length ? `【审阅重点】${genre.agentPolicy.reviewFocus.join('、')}` : '',
    genre.agentPolicy.forbidden.length ? `【禁忌】${genre.agentPolicy.forbidden.join('、')}` : ''
  ].filter(Boolean)
  return lines.join('\n')
}

export function unitLabel(unit) {
  return unit === 'episodes' ? '集' : unit === 'minutes' ? '分钟' : '字'
}

export function divideLabel(divideBy) {
  return divideBy === 'chapter' ? '章' : divideBy === 'episode' ? '集' : divideBy === 'scene' ? '场' : '段'
}

export function deliverableLabel(deliverable) {
  return deliverable === 'novel' ? '小说' : deliverable === 'script' ? '剧本' : deliverable === 'comic' ? '漫画' : '游戏'
}

/** 页签裁剪：体裁 excludedPages ∩ 实际目录 → 允许出的目录清单。 */
const PAGE_TO_DIR = Object.freeze({
  write: '正文', entries: '世界书', worldbook: '世界书', outline: '大纲', notes: '构思',
  material: '资料', dossier: '资料', constraint: '约束', script: '剧本', comic: '漫画',
  video: '视频', experience: '体验', online: '联机', wiki: '世界书', wikiHtml: '世界书'
})

/** excludedPages（页签/人话名）→ 实际目录名集合 */
export function excludedDirNames(genre) {
  const names = new Set()
  for (const page of genre?.excludedPages ?? []) names.add(PAGE_TO_DIR[page] ?? page)
  return names
}

export function allowedDirs(brief, genre, libDirs) {
  const dirs = Array.isArray(libDirs) ? libDirs : []
  if (!brief || !genre) return dirs // 未声明体裁＝不裁剪（保持 OS-8 行为）
  const excluded = excludedDirNames(genre)
  return dirs.filter((dir) => !excluded.has(dir))
}
