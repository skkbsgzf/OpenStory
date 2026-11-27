/**
 * Skill 货架（OS-22）——可执行的手艺配方（openstory-skill@1）。
 *
 * 一个 skill ＝ 目录＋SKILL.md（Markdown＋frontmatter）。加载器只做「发现→解析 frontmatter→规整」，
 * 不做执行：执行归 Agent（把 SKILL.md 正文按 category 装进上下文，或当作工具型配方按需调用）。
 * 与套件/体裁/风格包同口径：内置目录＋本机目录（按 name 覆盖）、坏档跳过＋warning。
 *
 * 五类边界（协议见 skills/PROTOCOL.md）：
 *   craft   技法规则 → 可进 instruction 块（过守卫）
 *   review  审阅，只出问题清单，绝不改文件
 *   transform 改写，产物是提案（作者采纳才落盘）
 *   extract 抽取，产结构化数据
 *   operate 项目构建/升级说明书——只读、不产出小说内容、不执行代码；
 *           写操作只能调用声明的官方 MCP 工具（tools＋confirm 级别），
 *           不自动注入 prompt，只能按需 openstory_skills_read 读取。
 */
import { existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { minVersionGate, readAppVersion } from '../protocol/versionGate.mjs'
import { atomicWriteFile } from '../protocol/hostWrite.mjs'
import { courtyardPath } from '../protocol/courtyard.mjs'
import { TOOL_CONFIRM_LEVELS, confirmSatisfies, maxRequiredConfirm, toolSemanticsOf } from '../protocol/mcpToolSemantics.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** OS-140 布局归一：本模块迁到 src/services/——货架数据目录（skills/）仍在仓根。 */
const REPO_ROOT = join(HERE, '..', '..')

export const SKILL_SPEC = 'openstory-skill@1'
export const SKILL_CATEGORIES = Object.freeze(['craft', 'review', 'transform', 'extract', 'operate'])
const NAME_RE = /^[\w-]{1,60}$/u

/** OS-212：确认级别——read 只读 / create 建新 / migrate 结构迁移 / restore 从备份恢复。
 * 唯一真源在安全语义注册表；这里只做 re-export（P1-5：不再各写一遍）。 */
export const SKILL_CONFIRM_LEVELS = TOOL_CONFIRM_LEVELS
/** OS-212：只读类技能（review/extract）不得声明写工具。 */
const READONLY_CATEGORIES = new Set(['review', 'extract'])
/** OS-212：operate 的写工具名——必须从 MCP 注册表来，不许 shell/fs 直写伪装成 MCP 工具。 */
const MCP_TOOL_RE = /^openstory_[a-z][a-z0-9_]*$/u
/** OS-212（P1）：`allowed-tools` 是 agent 能力声明（非 MCP 工具）。白名单只收只读检索
 * 与向作者请示；Bash/Write/Edit 等 shell/fs 直写语义一律 fail-closed 拒绝，不给
 * 「Write/Edit 伪装成 OpenStory 自动写权」的口子。 */
const SAFE_ALLOWED_TOOLS = Object.freeze(['Read', 'Grep', 'Glob', 'AskUserQuestion'])
/** OS-212：operate 说明书引用工具的安全语义必须来自单一注册表（纯数据，零副作用）——
 * 加载器只做形状与语义校验，不持有 MCP 实现，也不靠「工具名前缀」猜写只读。 */

function text(value) {
  return String(value ?? '')
}

/**
 * OS-212：规整并验证 frontmatter 的 tools / confirm 声明——**安全语义违规 fail-closed**。
 *
 * 形状坏、未知/未分类工具、shell/fs 伪装、写工具确认不足、只读类声明写工具/写确认，
 * 一律返回 `ok:false` 拒绝装载，绝不「只 warning 照装」。验证口径只认单一注册表
 * （`mcpToolSemantics`），加载器不靠工具名前缀猜读写。
 *
 * 非 operate 类可以声明只读工具（现有七个 craft/review/extract 技能的历史声明），但：
 *   · 只读类（review/extract）不得声明任何写工具或写确认；
 *   · craft/transform 不得声明写工具（它们只出提案/规则，不获得写权）；
 *   · operate 必须 tools 非空、每个工具都已分类；写工具必须带满足门槛的 confirm。
 */
function toolDeclarations(meta, category, where) {
  const rawTools = meta.tools
  let tools = []
  const reject = (code, message) => ({ ok: false, error: { code, dir: where, message: `${message}：${where}` } })
  if (rawTools === undefined || rawTools === null || rawTools === '') {
    tools = []
  } else if (Array.isArray(rawTools) && rawTools.every((item) => typeof item === 'string' && item.trim())) {
    tools = [...new Set(rawTools.map((item) => item.trim()))]
  } else {
    return reject('SKILL_TOOLS_SHAPE', 'tools 必须是字符串数组')
  }
  if (category === 'operate' && !tools.length) return reject('SKILL_TOOLS_REQUIRED', 'operate 必须声明非空 tools（写操作只能调用声明的官方工具）')

  const rawConfirm = meta.confirm === undefined || meta.confirm === null || meta.confirm === '' ? 'read' : text(meta.confirm).trim()
  const confirm = rawConfirm
  if (!SKILL_CONFIRM_LEVELS.includes(confirm)) return reject('SKILL_CONFIRM_LEVEL', `confirm 只收 ${SKILL_CONFIRM_LEVELS.join('/')}`)

  for (const tool of tools) {
    if (!MCP_TOOL_RE.test(tool)) {
      return reject('SKILL_TOOLS_NOT_MCP', `tools 只收官方 MCP 工具名（openstory_*），shell/fs 伪装一律拒绝：${tool}`)
    }
    const semantics = toolSemanticsOf(tool)
    if (!semantics) {
      return reject('SKILL_TOOL_UNCLASSIFIED', `工具不在 MCP 安全语义注册表（未知/未分类工具）：${tool}`)
    }
    if (semantics.effect !== 'read' && (READONLY_CATEGORIES.has(category) || category === 'craft' || category === 'transform')) {
      return reject('SKILL_READONLY_WRITE', `${category} 类不得声明写工具：${tool}`)
    }
    // P1-4：声明时无法绑定实参，按最坏门槛（含 mutatesWhen 升级）校验，
    // 不能让 confirm:create 的说明书合规带上 reset=true 要 restore 的 deduce_present。
    const needed = maxRequiredConfirm(tool)
    if (semantics.effect !== 'read' && category === 'operate' && !confirmSatisfies(confirm, needed)) {
      return reject('SKILL_WRITE_WITHOUT_CONFIRM', `operate 声明写工具 ${tool} 需要至少 ${needed} 确认，实际 ${confirm}`)
    }
  }
  // OS-212（P0-1）：只有 operate 说明书可以声明写确认；其余四类任何非 read 确认一律拒绝，
  // 与 tools 是否为空无关。之前带 `&& tools.length` 会让 review/extract+confirm:migrate 与
  // craft+confirm:restore（无 tools）被静默接受。
  if (category !== 'operate' && confirm !== 'read') {
    return reject('SKILL_READONLY_WRITE', `${category} 类不得声明写确认：${confirm}（只有 operate 才有写权）`)
  }
  // OS-212（P1）：allowed-tools 必须解析、校验并进 skill 对象；shell/fs 直写能力拒绝装载。
  const rawAllowed = meta['allowed-tools']
  const allowedTools = rawAllowed === undefined || rawAllowed === null || rawAllowed === ''
    ? []
    : Array.isArray(rawAllowed) ? rawAllowed
      : [String(rawAllowed).trim()]
  for (const entry of allowedTools) {
    if (typeof entry !== 'string' || !SAFE_ALLOWED_TOOLS.includes(entry.trim())) {
      return reject('SKILL_ALLOWED_TOOLS_UNSAFE', `allowed-tools 只收只读检索/请示能力（${SAFE_ALLOWED_TOOLS.join('/')}），shell/fs 直写拒绝：${text(entry)}`)
    }
  }
  return { ok: true, tools, confirm, allowedTools: allowedTools.map((entry) => entry.trim()) }
}

export function builtinSkillsDir() {
  return join(REPO_ROOT, 'skills')
}

export function defaultUserSkillsDir(env = process.env) {
  return courtyardPath(env, 'openstory', 'skills')
}

/**
 * 解析 SKILL.md：frontmatter 用极简 YAML 读法（key: value ＋ 方括号数组 ＋ | 块忽略），
 * 正文＝后半段。不引 YAML 库。
 */
export function parseSkillMarkdown(raw, { source, dir, appVersion } = {}) {
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
    // OS-212（P0）：YAML 允许键加引号——`"tools": [...]`、`'confirm': read` 都是合法写法，
    // 任何 YAML 生成器都可能这么 dump。之前直接 slice 出带引号的键，meta 里存成 `"tools"`
    // 而 toolDeclarations 读 `meta.tools` 得 undefined → 默认 []，违规声明被静默洗白且零 warning。
    // 键名统一剥引号后再判重与取用。
    const key = trimmed.slice(0, colon).trim().replace(/^(["'])(.*)\1$/u, '$2').trim()
    // OS-212：重复声明安全相关字段不许后者静默覆盖前者——人眼读第一行会以为这是只读
    // review 技能，第二行却把 category 洗成 operate、confirm 洗成 restore 放行写权。
    // fail-closed 拒绝整个 frontmatter（tools/allowed-tools 原有理由同样是「洗成空」）。
    const DUPLICATE_SENSITIVE = ['tools', 'allowed-tools', 'category', 'confirm']
    if (DUPLICATE_SENSITIVE.includes(key) && Object.hasOwn(meta, key)) {
      return bad('SKILL_TOOLS_DUPLICATE', `frontmatter 重复声明 ${key}，拒绝装载`)
    }
    let value = trimmed.slice(colon + 1).trim()
    // OS-212（P1）：YAML 行内注释（`category: craft   # craft｜review…`）是合法写法——
    // PROTOCOL.md 的模板自己就这么写，照抄模板必须能装载。注释只在 `#` 前有空白且值未被
    // 引号包裹时才生效（与 YAML 一致）；`description: 第3章#tag` 里的 # 不是注释。
    if (value !== '|' && value !== '>' && !/^["']/u.test(value)) {
      value = value.replace(/\s+#.*$/u, '').trim()
    }
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
    // OS-212（P0-2）：标准 YAML 块序列 `tools:` 后跟 `- item` 行——**零缩进**（PyYAML /
    // js-yaml dump 默认形态）与缩进两种都要认。不能静默丢成空串：那会把「声明了写工具」
    // 洗成「无工具」，绕过 fail-closed 校验。注释行跳过；遇到同层 `key:` 新键即结束块。
    if (value === '') {
      const block = []
      let sawItem = false
      for (let follow = index + 1; follow < fmLines.length; follow += 1) {
        const next = fmLines[follow]
        const stripped = next.trim()
        if (!stripped || stripped.startsWith('#')) continue
        if (/^- /u.test(stripped)) {
          block.push(stripped.slice(2).trim().replace(/^["']|["']$/gu, ''))
          sawItem = true
          index = follow
          continue
        }
        break
      }
      if (sawItem) {
        meta[key] = block
        continue
      }
      // OS-212：合法 YAML 折叠纯量 `tools:\n  openstory_x` / `allowed-tools:\n  Bash`
      // 会被 PyYAML/js-yaml 读成字符串。若静默落空串，toolDeclarations 把 '' 当空数组，
      // 等于把写工具声明洗成空、把 Bash 伪装洗掉——fail-closed 直接拒绝整个 frontmatter。
      const scalar = fmLines.slice(index + 1)
        .find((next) => next.trim() && !next.trim().startsWith('#') && !/^\s*-\s/u.test(next.trim()))
      if (scalar && /^\s+/u.test(scalar) && DUPLICATE_SENSITIVE.includes(key)) {
        return bad('SKILL_TOOLS_SHAPE', `${key} 的折叠纯量须用行内数组或 - item 块，拒绝装载：${scalar.trim()}`)
      }
      // `key:` 后一个 `- item` 都没有，且下一行已是同层新键——这是 YAML null，不是数组。
      // 保留空串交给 toolDeclarations 按 fail-closed 判（operate 空 tools 直接拒）。
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
  // 最低应用版本闸（OS-121）：缺字段＝不校验；要求高于当前＝跳过；格式坏＝照常加载＋_BAD warning
  const gate = minVersionGate(meta.minOpenStoryVersion, appVersion ?? readAppVersion(), { prefix: 'SKILL', label: '技能', where })
  if (gate.skip) return bad('SKILL_MIN_VERSION', gate.message)
  const declarations = toolDeclarations(meta, category, where)
  if (!declarations.ok) return bad(declarations.error.code, declarations.error.message)
  const extraWarnings = gate.warning ? [gate.warning] : []
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
      // OS-212：官方 MCP 工具白名单＋确认级别（operate 说明书的写权限声明）
      tools: declarations.tools,
      confirm: declarations.confirm,
      allowedTools: declarations.allowedTools,
      output: text(meta.output).trim(),
      domain: text(meta.domain).trim(),
      source,
      dir: text(dir),
      // 正文：装配时按 category 决定进 instruction 还是参考块
      body,
      chars: body.length
    },
    ...(extraWarnings.length ? { warnings: extraWarnings } : {})
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
    for (const warning of parsed.warnings ?? []) warnings.push(warning)
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
    chars: skill.chars,
    // OS-212（P1-3）：tools/confirm 必须随技能抵达唯一 MCP 读路径。
    // skillsGet/skillGet 都经 skillSummary（src/api/handlers/plugins.mjs:60/72），
    // 这里补上 tools 即可，无需改不在本单 allow 内的 handler。
    // skillGet 另在 :72 覆写 tools（同源同值），保持清单与全文声明一致。
    tools: skill.tools ?? [],
    confirm: skill.confirm,
    allowedTools: skill.allowedTools ?? []
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

/* ---------- Agent 选择链（OS-70）：题材 → 风格词条 → 方法论 ---------- */
/* 灯泡三级选择链的持久层：题材走 brief.json（genres.mjs），风格词条/方法论选在这里。
 * agent-picks.json 形状：{ schemaVersion, style: 'skill名'|'', methods: ['skill名'…], updatedAt }。
 * 约定：style-* 前缀的 craft 技能＝文风词条（写作只能有一种主导文风，单选）；其余 craft＝方法论（可多选）。
 * 裁剪语义：显式 picks 存在＝只注入 picks 里的技能全文；不存在（缺省）＝按体裁 genres 匹配注入、
 * 但**永远剔除 style-* 文风包**——文风必须显式选定，绝不允许 11 个包一起灌进上下文互相打架。 */

export const AGENT_PICKS_SPEC = 'openstory-agent-picks@1'

export function agentPicksPath(root) {
  return join(root, '.openstory', 'agent-picks.json')
}

export function isStyleSkill(skill) {
  return text(skill?.name).startsWith('style-')
}

/** 读库级选择链（无文件/坏档＝null，走缺省裁剪；不拦 Agent 会话）。 */
export async function readAgentPicks(root) {
  let raw
  try {
    raw = await readFile(agentPicksPath(root), 'utf-8')
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    return null
  }
  try {
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return {
      style: text(parsed.style).trim(),
      methods: Array.isArray(parsed.methods) ? parsed.methods.map((item) => text(item).trim()).filter(Boolean) : []
    }
  } catch {
    return null
  }
}

/** 写库级选择链（原子写）。风格/方法都必须是货架上的 craft 技能；风格不在可选集＝400。 */
export async function writeAgentPicks(root, dirs, input = {}) {
  const { skills } = loadSkills(dirs)
  const craftNames = new Set(skills.filter((skill) => skill.category === 'craft').map((skill) => skill.name))
  const style = text(input.style).trim()
  const methods = Array.isArray(input.methods) ? input.methods.map((item) => text(item).trim()).filter(Boolean) : []
  if (style && !craftNames.has(style)) return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个技能：${style}` }
  for (const name of methods) {
    if (!craftNames.has(name)) return { ok: false, code: 'INVALID_ENTRY', message: `货架上没有这个技能：${name}` }
  }
  const now = new Date().toISOString()
  const brief = { schemaVersion: AGENT_PICKS_SPEC, style, methods, updatedAt: now }
  const target = agentPicksPath(root)
  try {
    await mkdir(dirname(target), { recursive: true })
    await atomicWriteFile(target, JSON.stringify(brief, null, 2))
  } catch (error) {
    return { ok: false, code: 'WRITE_PROTOCOL_IO_FAILED', message: `选择链写入失败：${text(error?.message || error)}` }
  }
  return { ok: true, picks: brief, path: target }
}

/** 注入用技能集（裁剪的落点）：
 * - 显式 picks：风格单选全文＋方法多选全文（风格与方法重叠时以 methods 为准去重）；
 * - 缺省：体裁 genres 匹配的 craft（剔除 style-*）；无体裁＝全部非 style 的 craft。 */
export function craftSkillsForPrompt(skills, genreId, picks) {
  const craft = (Array.isArray(skills) ? skills : []).filter((skill) => skill.category === 'craft')
  if (picks) {
    const wanted = new Set()
    if (picks.style) wanted.add(picks.style)
    for (const name of picks.methods) wanted.add(name)
    return craft.filter((skill) => wanted.has(skill.name))
  }
  const matched = skillsForGenre(craft, text(genreId).trim())
  return matched.filter((skill) => !isStyleSkill(skill))
}
