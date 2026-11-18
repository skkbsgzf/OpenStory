/**
 * Skill 货架（OS-22）——可执行的手艺配方（openstory-skill@1）。
 *
 * 一个 skill ＝ 目录＋SKILL.md（Markdown＋frontmatter）。加载器只做「发现→解析 frontmatter→规整」，
 * 不做执行：执行归 Agent（把 SKILL.md 正文按 category 装进上下文，或当作工具型配方按需调用）。
 * 与套件/体裁/风格包同口径：内置目录＋本机目录（按 name 覆盖）、坏档跳过＋warning。
 *
 * 三类边界（协议见 skills/PROTOCOL.md）：
 *   craft   技法规则 → 可进 instruction 块（过守卫）
 *   review  审阅，只出问题清单，绝不改文件
 *   transform 改写，产物是提案（作者采纳才落盘）
 *   extract 抽取，产结构化数据
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))

export const SKILL_SPEC = 'openstory-skill@1'
export const SKILL_CATEGORIES = Object.freeze(['craft', 'review', 'transform', 'extract'])
const NAME_RE = /^[\w-]{1,60}$/u

function text(value) {
  return String(value ?? '')
}

export function builtinSkillsDir() {
  return join(HERE, 'skills')
}

export function defaultUserSkillsDir(env = process.env) {
  const base = text(env.LOCALAPPDATA || env.APPDATA).trim()
  return base ? join(base, 'PinaxNext', 'openstory', 'skills') : ''
}

/**
 * 解析 SKILL.md：frontmatter 用极简 YAML 读法（key: value ＋ 方括号数组 ＋ | 块忽略），
 * 正文＝后半段。不引 YAML 库。
 */
export function parseSkillMarkdown(raw, { source, dir } = {}) {
  const where = `${source}·${text(dir)}`
  const bad = (code, message) => ({ ok: false, warning: { code, dir: where, message: `${message}：${where}` } })
  const src = text(raw)
  if (!src.trim()) return bad('SKILL_EMPTY', 'SKILL.md 是空的')
  const lines = src.split(/\r?\n/)
  let start = -1
  for (let index = 0; index < lines.length; index += 1) {
    if (lines[index].trim()) { start = index; break }
  }
  if (start < 0 || lines[start].trim() !== '---') return bad('SKILL_NO_FRONTMATTER', '缺 YAML frontmatter（--- 开头）')
  let end = -1
  for (let index = start + 1; index < lines.length; index += 1) {
    if (lines[index].trim() === '---') { end = index; break }
  }
  if (end < 0) return bad('SKILL_FRONTMATTER_UNCLOSED', 'frontmatter 没有闭合的 ---')

  const meta = {}
  const fmLines = lines.slice(start + 1, end)
  for (let index = 0; index < fmLines.length; index += 1) {
    const trimmed = fmLines[index].trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const colon = trimmed.indexOf(':')
    if (colon <= 0) continue
    const key = trimmed.slice(0, colon).trim()
    let value = trimmed.slice(colon + 1).trim()
    // YAML 块标量（description: | 后跟缩进行）：把后续更深的缩进行拼成一段
    if (value === '|' || value === '>') {
      const block = []
      for (let follow = index + 1; follow < fmLines.length; follow += 1) {
        const next = fmLines[follow]
        if (!next.trim()) { block.push(''); continue }
        if (!/^\s+/u.test(next)) break
        block.push(next.trim())
        index = follow
      }
      meta[key] = block.join(value === '>' ? ' ' : '\n').trim()
      continue
    }
    if (value.startsWith('[') && value.endsWith(']')) {
      const inner = value.slice(1, -1).trim()
      meta[key] = inner ? inner.split(',').map((item) => item.trim().replace(/^["']|["']$/gu, '')).filter(Boolean) : []
      continue
    }
    value = value.replace(/^["']|["']$/gu, '')
    meta[key] = value
  }
  const body = lines.slice(end + 1).join('\n').trim()

  const name = text(meta.name).trim()
  if (!NAME_RE.test(name)) return bad('SKILL_NAME', `name 非法（只许字母数字-_，≤60 字）：${name}`)
  const description = text(meta.description).trim()
  if (!description) return bad('SKILL_DESCRIPTION', '缺 description（Agent 靠它选技能）')
  const category = text(meta.category).trim()
  if (!SKILL_CATEGORIES.includes(category)) {
    return bad('SKILL_CATEGORY', `category 只收 ${SKILL_CATEGORIES.join('/')}：${category || '(空)'}`)
  }
  const genres = Array.isArray(meta.genres) && meta.genres.length ? meta.genres : ['*']
  const version = text(meta.version).trim() || '0.0.0'
  return {
    ok: true,
    skill: {
      name,
      description,
      category,
      genres,
      version,
      vendor: text(meta.vendor).trim(),
      stage: text(meta.stage).trim(),
      // 工具型字段（Pinax 老 frontmatter）：原样带出，供将来工具接线
      tools: Array.isArray(meta.tools) ? meta.tools : [],
      output: text(meta.output).trim(),
      domain: text(meta.domain).trim(),
      source,
      dir: text(dir),
      // 正文：装配时按 category 决定进 instruction 还是参考块
      body,
      chars: body.length
    }
  }
}

/** 目录扫描（子目录里有 SKILL.md 才算 skill）。 */
function scanSkillDir(dir, source, warnings) {
  const skills = []
  if (!text(dir).trim() || !existsSync(dir)) return skills
  let names = []
  try {
    names = readdirSync(dir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name)
  } catch (error) {
    warnings.push({ code: 'SKILL_DIR_UNREADABLE', dir, message: `技能目录读不了：${dir}（${text(error?.message || error)}）` })
    return skills
  }
  for (const name of names) {
    const file = join(dir, name, 'SKILL.md')
    if (!existsSync(file)) continue
    let raw
    try {
      raw = readFileSync(file, 'utf-8')
    } catch (error) {
      warnings.push({ code: 'SKILL_UNREADABLE', file: `${source}·${name}`, message: `SKILL.md 读不了：${source}·${name}（${text(error?.message || error)}）` })
      continue
    }
    const parsed = parseSkillMarkdown(raw, { source, dir: join(dir, name) })
    if (!parsed.ok) {
      warnings.push(parsed.warning)
      continue
    }
    if (parsed.skill.name !== name) {
      warnings.push({ code: 'SKILL_NAME_MISMATCH', file: `${source}·${name}`, message: `frontmatter name（${parsed.skill.name}）与目录名（${name}）不一致` })
      continue
    }
    skills.push(parsed.skill)
  }
  return skills
}

/** 合并装载：内置＋本机（按 name 覆盖）。 */
export function loadSkills(dirs = []) {
  const warnings = []
  const byName = new Map()
  dirs.forEach((dir, index) => {
    // 目录项可以是 { dir, source }（套件捆绑：source＝套件名）或纯字符串（内置/本机）
    const source = typeof dir === 'object' && dir !== null ? text(dir.source) || `套件${index}` : (index === 0 ? '内置' : '本机')
    const real = typeof dir === 'object' && dir !== null ? text(dir.dir) : dir
    for (const skill of scanSkillDir(real, source, warnings)) byName.set(skill.name, skill)
  })
  return { skills: [...byName.values()], warnings }
}

/** 启用中套件的捆绑技能目录（OS-68）：套件目录下的 skills/ 子目录随套件启停生效。
 * 启停状态在 suite-state.json（不在 manifest）——loadSuites 拿货架，state 只判 enabled。 */
export function suiteSkillDirs(suitesDirs = [], suiteStatePath = '', env = process.env) {
  const out = []
  // state 缺失/读不了＝还没有停用记录，契约是 enabled 缺省 true——全部视为启用
  let enabledMap = {}
  if (text(suiteStatePath).trim() && existsSync(suiteStatePath)) {
    try {
      const state = JSON.parse(readFileSync(suiteStatePath, 'utf-8'))
      if (state && typeof state === 'object' && state.suites && typeof state.suites === 'object') enabledMap = state.suites
    } catch { enabledMap = {} }
  }
  // 本机货架（第一个出现的用户目录）按 id 覆盖内置——与 loadSuites 同口径
  const shelves = (suitesDirs || []).filter((dir) => typeof dir === 'string' && text(dir).trim() && existsSync(dir))
  const byId = new Map()
  for (const shelf of shelves) {
    let ids = []
    try { ids = readdirSync(shelf, { withFileTypes: true }).filter((item) => item.isDirectory() && !item.name.startsWith('.')).map((item) => item.name) } catch { continue }
    for (const id of ids) {
      const manifestPath = join(shelf, id, 'manifest.json')
      if (!existsSync(manifestPath)) continue
      let manifest = null
      try { manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) } catch { continue }
      if (manifest && typeof manifest === 'object') byId.set(text(manifest.id).trim() || id, { shelf, id, manifest })
    }
  }
  for (const [id, { shelf, manifest }] of byId) {
    const entry = enabledMap[id]
    if (entry && typeof entry === 'object' && entry.enabled === false) continue
    const dir = join(shelf, id, 'skills')
    if (existsSync(dir)) out.push({ dir, source: `套件·${text(manifest.name).trim() || id}` })
  }
  return out
}

/** 按体裁过滤（genres 含 "*" 或命中即兼容）。 */
export function skillsForGenre(skills, genreId) {
  const wanted = text(genreId).trim()
  if (!wanted) return skills
  return skills.filter((skill) => skill.genres.includes('*') || skill.genres.includes(wanted))
}

/** 对外清单形状（不带正文，省流量；正文按需 getSkill）。 */
export function skillSummary(skill) {
  return {
    name: skill.name,
    description: skill.description,
    category: skill.category,
    genres: skill.genres,
    version: skill.version,
    vendor: skill.vendor,
    stage: skill.stage,
    source: skill.source,
    chars: skill.chars
  }
}

/**
 * 装配用：把选中的 craft 类技能正文拼成 instruction 段（过守卫后由调用方注入）。
 * review/transform/extract 不在此拼——它们是工具型配方，按需单次调用。
 */
export function craftInstructionBlock(skills) {
  const craft = (Array.isArray(skills) ? skills : []).filter((skill) => skill.category === 'craft' && skill.body.trim())
  if (!craft.length) return ''
  return craft.map((skill) => `【技法·${skill.name}】\n${skill.body.trim()}`).join('\n\n')
}
