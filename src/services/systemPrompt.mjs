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
import { habitsForPrompt } from '../host/moduleHooks.mjs'
import { loadGenres, readBrief, briefPromptSection } from './genres.mjs'
import { loadSkills, craftSkillsForPrompt, craftInstructionBlock, readAgentPicks, suiteSkillDirs } from './skills.mjs'
import { precedentPromptSectionForGenre } from '../protocol/knowledgeRouter.mjs'
import { scanReferences, notesVisibleAt, buildReferenceGraph } from '../protocol/referenceStore.mjs'
import { factStore } from '../protocol/factStore.mjs'
import { listChapters } from '../protocol/chapters.mjs'
import { courtyardPath } from '../protocol/courtyard.mjs'

/** 生效技能目录（OS-68）：内置＋本机之外，再叠加启用中套件捆绑的 skills/。 */
export function effectiveSkillsDirs({ skillsDirs, suitesDirs, suiteStatePath, env }) {
  return [...(skillsDirs || []), ...suiteSkillDirs(suitesDirs || [], suiteStatePath || '', env)]
}

export async function systemPromptFor(root, libraries, genresDirs, skillsDirs, { canReadFiles = false, chineseReasoning = false, suitesDirs = null, suiteStatePath = '', env = process.env } = {}) {
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
      const kbSection = await precedentPromptSectionForGenre(genre?.name ?? loaded.brief.genre, {
        configPath: courtyardPath(process.env, 'openstory', 'kb-config.json')
      })
      if (kbSection) {
        lines.push('', kbSection)
        applied.kb = true
      }
    }
  } catch { /* 简报读不到不影响对话 */ }

  // 世界书索引（OS-45）：**只暴露链接清单，不塞全文**。
  // 作者口径：把世界书全量丢进上下文会污染判断——模型会在几十篇笔记里迷路。
  // 正确做法是给它一份「目录 + 它自己能读的路径」，需要时用文件工具按需取。
  if (canReadFiles) {
    try {
      const index = await scanReferences(root)
      // OS-96：按当前章强制过滤——firstChapter>当前章的词条不进索引（写得再好也是剧透）。
      // 当前章号从正文清单推（最大章号；没有正文＝0＝全量共识）。
      let currentChapter = 0
      try {
        const listing = await listChapters(root, '正文')
        if (listing.ok) currentChapter = (listing.chapters || []).reduce((max, ch) => Math.max(max, Number(ch?.no) || 0), 0)
      } catch { /* 无正文＝0 */ }
      const allNotes = (Array.isArray(index.notes) ? index.notes : []).filter((note) => !note.isTagNote)
      const notes = notesVisibleAt(allNotes, currentChapter)
      const hiddenCount = allNotes.length - notes.length
      if (notes.length) {
        // 图谱：把「世界书 ↔ 章节」的关系也算出来，好告诉 Agent 当前这一章挂着哪些世界书
        let entries = []
        try {
          const store = factStore.createFactFileStore({ root })
          const listed = store.list({ offset: 0, limit: 500 })
          entries = Array.isArray(listed?.entries) ? listed.entries : []
        } catch { /* 没故事源就只有世界书节点 */ }
        const graph = buildReferenceGraph(index, { entries })
        // 反向索引：章节路径 → 关联的世界书笔记路径
        const refsByArtifact = new Map()
        for (const edge of graph.edges) {
          const a = graph.nodes.find((node) => node.id === edge.a)
          const b = graph.nodes.find((node) => node.id === edge.b)
          if (!a || !b) continue
          const ref = a.kind === 'worldbook' ? a : (b.kind === 'worldbook' ? b : null)
          const artifact = a.kind === 'artifact' ? a : (b.kind === 'artifact' ? b : null)
          if (!ref || !artifact) continue
          if (!refsByArtifact.has(artifact.id)) refsByArtifact.set(artifact.id, [])
          refsByArtifact.get(artifact.id).push(ref.id)
        }
        applied.referenceGraph = {
          pairs: [...refsByArtifact.entries()].slice(0, 40).map(([artifact, refs]) => ({ artifact, refs: refs.slice(0, 12) }))
        }
        // 严格口径（OS-45）：**只给路径 + 标题 + 标签**，一个字的正文都不给。
        // 摘要看着无害，实际上会把「判断依据」提前塞进上下文——模型会拿摘要当结论，
        // 而不是真去读原文。要读就让它读。
        const lines2 = notes.slice(0, 60).map((note) => {
          const tags = note.tags.length ? `（${note.tags.map((tag) => `#${tag}`).join(' ')}）` : ''
          return `- ${note.path} ｜「${note.title}」${tags}`
        })
        const linked = [...refsByArtifact.entries()].slice(0, 20)
          .map(([artifact, refs]) => `- ${artifact} ← ${refs.join('、')}`)
        lines.push(
          '',
          '【世界书索引】',
          `这个库有一套世界书（作者的设定、素材、想法）。下面是**索引，不是全文**：${hiddenCount > 0 ? `（已按当前进度第 ${currentChapter} 章过滤——${hiddenCount} 条「首次出现」在更后面的词条没有列出，那些是未来才成立的知识，不要提前使用）` : ''}`,
          ...lines2,
          notes.length > 60 ? `（还有 ${notes.length - 60} 篇没列出）` : '',
          ...(linked.length ? ['', '【世界书与章节的关联】', ...linked] : []),
          '',
          '规矩：',
          '- 需要某篇的具体内容时，**用你的文件读取工具按上面的路径去读**（都在 cwd 下），不要凭空猜。',
          '- 不要一次读一堆世界书；先按标题、标签和上面的关联关系判断哪些相关，再读那几篇。',
          '- 世界书是作者的私有笔记，只能读，不要改（改正文要走待确认卡，世界书也不在你的写权限里）。'
        )
        applied.referenceCount = notes.length
      }
    } catch { /* 没有世界书目录就不注入（不打扰） */ }
  }
  return { prompt: lines.join('\n'), applied }
}
