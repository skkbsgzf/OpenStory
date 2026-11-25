/**
 * Agent 系统提示组装（OS-43/45/57，OS-141 daemon 拆分落位）——每轮对话把
 * 库名/能力边界/中文推理/习惯表/项目简报/技法技能/KB 先例/世界书索引拼成 system prompt。
 *
 * 硬口径（作者裁定，逐字保留）：
 *   · 按运行时区分能力，别对模型说假话——DSH 看到「你读不到文件」却手里有工具时，
 *     会花大段推理纠结「这自相矛盾」，白白烧 token：
 *     canReadFiles=false（Pi/纯 HTTP）：作者手动贴上下文；
 *     canReadFiles=true （DSH 原生）：可以自己读，但改正文必须走待确认卡。
 *   · 世界书索引只暴露链接清单，不塞全文——把世界书全量丢进上下文会污染判断，
 *     模型会在几十篇笔记里迷路；要读就让它按路径自己读。
 * 全仓只此一份定义；handler 一律从这里 import，不许复制。
 */
import { basename, join } from 'node:path'
import { rootKey, text } from '../host/authorize.mjs'
// OS-195a：习惯/知识/世界书都经宿主贡献表取钩子，服务本体不持有任何模块实现引用。
import { habitsForPrompt, precedentPromptSection, worldbookPromptSection } from '../host/moduleHooks.mjs'
import { loadGenres, readBrief, briefPromptSection } from './genres.mjs'
import { loadSkills, craftSkillsForPrompt, craftInstructionBlock, readAgentPicks, suiteSkillDirs } from './skills.mjs'
import { courtyardPath } from '../protocol/courtyard.mjs'

/** 生效技能目录（OS-68）：内置＋本机之外，再叠加启用中套件捆绑的 skills/。 */
export function effectiveSkillsDirs({ skillsDirs, suitesDirs, suiteStatePath, env }) {
  return [...(skillsDirs || []), ...suiteSkillDirs(suitesDirs || [], suiteStatePath || '', env)]
}

/**
 * OS-193/195 K4：跨内核底座服务不持有实现、也不在模块顶层引用实现登记表。
 * fact/prose 能力由调用方在请求入口 `resolveFactCapability(root, 'fact.store')` /
 * `resolveProseCapability(root)` 取句柄后显式传入；测试钩子由 host 入口注入同一份句柄。
 */
export async function systemPromptFor(root, libraries, genresDirs, skillsDirs, { canReadFiles = false, chineseReasoning = false, suitesDirs = null, suiteStatePath = '', env = process.env, factStore, prose } = {}) {
  const key = rootKey(root)
  const record = (Array.isArray(libraries) ? libraries : []).find((library) => rootKey(library.path) === key)
  const name = record?.name || basename(root) || '未命名库'
  // 生效清单（OS-43）：这轮提示词里到底塞了哪些东西，回报给界面做标注
  const applied = { canReadFiles, chineseReasoning, craftSkills: [], genre: '', brief: false, kb: false, habits: 0 }
  const lines = [
    `你是 OpenStory 工作台的写作助手，正在协助作者创作《${name}》（本机磁盘上的一个 OpenStory 库）。`,
    '- 用中文回复。',
    '- 作者可以把你的回复转成「待确认卡」并采纳写进正文文件：给出正文片段时，请给完整、可直接粘贴的文本，不要只给修改说明。',
    '- 给出可采纳的正文时，请用代码块（```）把正文整段包起来，并在正文之外说明它要写进哪个文件（例如「正文/003-倒带.md」）。这样工作台才知道这段可以采纳。',
    canReadFiles
      ? '- 你可以读这个库里的文件（工作目录就是库根）。需要原文、目录结构时直接读，不要凭空猜测内容。'
      : '- 你读不到库里的文件；作者会把需要的上下文粘贴给你，不要假装读过文件。',
    ...(canReadFiles
      ? ['- 但改正文必须走「待确认卡」流程：不要直接用写文件工具改 .md 正文，把改好的片段写在回复里，让作者确认。']
      : []),
    // 中文推理（OS-43，默认开；OS-72 加强）：旧版一句话太软，实测 flash/v4-pro 仍全程英文思考。
    // 加强手段＝放在最强的位置（首条）＋给出明确反例＋要求逐句检查，不靠「请」。
    ...(chineseReasoning
      ? ['- 【思考语言：中文】你的推理/思考过程（reasoning）必须用中文书写，一个字都不要用英文——包括分析、比价、列举、自问自答等全部环节。只有在引用英文原文或代码时才可以出现英文。每次思考前先确认自己在用中文；如果发现自己在写英文，立即改用中文重写。']
      : [])
  ]
  // 习惯表（OS-57）：作者定义的写作习惯——Agent 成文前必须逐条遵循。规则唯一来源。
  // OS-161：经宿主模块钩子取——习惯模块停用（钩子返回 null）＝整段不注入。
  try {
    const habits = await habitsForPrompt(root)
    if (habits) {
      const habitLines = []
      if (habits.style) habitLines.push(`- 文风：${habits.style}`)
      if (habits.bannedWords?.length) habitLines.push(`- 禁用词（出现即改）：${habits.bannedWords.join('、')}`)
      if (habits.preferredWords?.length) habitLines.push(`- 惯用词（优先使用）：${habits.preferredWords.join('、')}`)
      if (habits.bannedPatterns?.length) habitLines.push(`- 禁用句式：${habits.bannedPatterns.join('；')}`)
      if (habits.bannedRhetoric?.length) habitLines.push(`- 禁用修辞：${habits.bannedRhetoric.join('；')}`)
      if (habits.formulas?.length) habitLines.push(`- 喜好的描述公式：${habits.formulas.join('；')}`)
      if (habitLines.length) {
        lines.push('', '【本库写作习惯】（作者自定义，产出任何成文文字前必须逐条遵循）：', ...habitLines)
        applied.habits = habitLines.length
      }
    }
  } catch { /* 习惯表读不到就不注入，不拦聊天 */ }
  // OS-19：项目简报（体裁/篇幅/分章）是一等约束——注入体裁策略段
  try {
    const loaded = await readBrief(root, genresDirs)
    if (loaded.ok && loaded.brief) {
      const { genres } = loadGenres(genresDirs)
      const genre = genres.find((item) => item.id === loaded.brief.genre) ?? null
      const section = briefPromptSection(loaded.brief, genre)
      if (section) lines.push('', section)
      // OS-22：按体裁选 craft 类技能（技法规则）注入——只取 craft，review/transform/extract 不注入
      const loadedSkills = loadSkills(effectiveSkillsDirs({ skillsDirs, suitesDirs, suiteStatePath, env }))
      const picks = await readAgentPicks(root)
      const matched = craftSkillsForPrompt(loadedSkills.skills, loaded.brief.genre, picks)
      const craft = craftInstructionBlock(matched)
      if (craft) lines.push('', craft)
      // 生效清单（OS-43）：把「这轮用到了哪些技能」回报给界面，让作者知道 AI 手里有什么
      applied.craftSkills = matched.map((skill) => ({
        name: text(skill.name),
        description: text(skill.description),
        category: text(skill.category)
      })).filter((skill) => skill.name)
      applied.genre = text(genre?.name || loaded.brief.genre)
      applied.brief = true
      // KB-ARCH P0：同题材先例检索（案例库＋套路库）——kb-config 缺失或 KB 不可用时静默降级，不阻塞对话
      const kbSection = await precedentPromptSection(root, genre?.name ?? loaded.brief.genre, {
        configPath: courtyardPath(process.env, 'openstory', 'kb-config.json')
      })
      if (kbSection) {
        lines.push('', kbSection)
        applied.kb = true
      }
    }
  } catch { /* 简报读不到不影响对话 */ }

  // 世界书索引（OS-45）：由世界书模块以 promptContext 钩子贡献；停用＝不注入。
  try {
    const section = await worldbookPromptSection(root, { canReadFiles, factStore, prose })
    if (section) {
      lines.push(...section.lines)
      Object.assign(applied, section.applied)
    }
  } catch { /* 没有世界书目录就不注入（不打扰） */ }
  return { prompt: lines.join('\n'), applied }
}
