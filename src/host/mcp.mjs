/**
 * OpenStory MCP server（OS-55）——零依赖 stdio JSON-RPC 2.0。
 *
 * 为什么自写而不用 @modelcontextprotocol/sdk：本仓零 npm 依赖（内核与世界书契约均已
 * 转本仓自持，出处见 docs/kernel-provenance.md；tgz 依赖已移除）。
 * MCP stdio 传输就是
 * newline-delimited JSON-RPC 2.0（官方 spec：消息以 \n 分隔、不得内嵌换行），
 * 服务端只需要 initialize / tools/list / tools/call 三个方法，自写约 200 行。
 *
 * 协议口径（沿用历史本地 MCP，作者约定）：
 *   · 业务错误＝ result.isError: true + 文本里带 ERR_* code（不是 JSON-RPC error）
 *   · 参数缺失/形状错＝ JSON-RPC error -32602
 *   · 未知工具＝ -32601；未知方法＝ -32601
 *   · 工具返回一律结构化 JSON 字符串（content[0].text）
 *
 * 与 daemon 的关系：MCP 是**薄适配层**——所有数据操作走本机 daemon HTTP
 * （127.0.0.1，OPENSTORY_PORT 环境变量，默认 8807），协议与闸门在 daemon
 * 已测试过；唯一的例外是 analysis：分析能力是纯函数内核件（text.analyze@1，
 * 真源在 src/modules/text/），MCP 经协议转供叶直接 import 本地计算，不需要 daemon。
 *
 * 读写分级（对外分发的红线，skills/*.md 里逐条展开）：
 *   · 读＝自由：清单/正文/世界书/图谱/反链/分析，随便调
 *   · 写＝有备份语义：正文与世界书写入都会先把原稿挪进 .history（可逆）；
 *     删除＝挪进 .history 不是真删；absorb（旧目录迁入世界书）**不开 MCP**——
 *     它是显式动稿按钮，作者口径「绝不自动调用」
 *   · Agent 对话/待确认卡不开 MCP：外部 agent 自己就是 agent，不套娃
 */

import { createRequire } from 'node:module'
import { pathToFileURL } from 'node:url'
import { resolve } from 'node:path'
import { isModuleEnabled } from '../protocol/modules.mjs'
import { namingEntry } from '../protocol/naming.mjs'
import { CONFIRM_PARAM, TOOL_CONFIRM_LEVELS, confirmSatisfies, semanticsForCall, toolSemanticsOf, validateSemanticsRegistry } from '../protocol/mcpToolSemantics.mjs'
import { SKILL_CATEGORIES } from '../services/skills.mjs'
import { resolveCapability } from './capabilityBindings.mjs'

const require = createRequire(import.meta.url)
const PORT = Number(process.env.OPENSTORY_PORT) || 8807
const BASE = `http://127.0.0.1:${PORT}`

/* ---------- daemon HTTP 客户端 ---------- */

/** 业务错误（daemon 返回 { ok:false, error:{code,message} }）→ 带 code 的异常。 */
async function daemon(path, { method = 'GET', body, query } = {}) {
  let url = `${BASE}${path}`
  if (query) {
    const qs = new URLSearchParams()
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null && value !== '') qs.set(key, String(value))
    }
    const q = qs.toString()
    if (q) url += `?${q}`
  }
  let response
  try {
    response = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined
    })
  } catch (error) {
    const err = new Error(`DAEMON_UNREACHABLE · 连不上 OpenStory daemon（${BASE}）：先启动它（npm start）。原始错误：${error.message}`)
    err.code = 'DAEMON_UNREACHABLE'
    throw err
  }
  let payload = null
  try { payload = await response.json() } catch { payload = null }
  if (!response.ok || payload?.ok === false) {
    const code = payload?.error?.code || `HTTP_${response.status}`
    const message = payload?.error?.message || `请求失败（HTTP ${response.status}）`
    const err = new Error(`${code} · ${message}`)
    err.code = code
    throw err
  }
  return payload
}

/* ---------- 工具实现 ---------- */

/** 习惯 lint（OS-59，与 daemon 同规则）：对将写入的文本跑禁用词/句式检测。 */
function lintHabits(body, habits) {
  const text$ = String(body ?? '')
  const hits = []
  if (!text$.trim() || !habits) return hits
  for (const word of Array.isArray(habits.bannedWords) ? habits.bannedWords : []) {
    const count = text$.split(word).length - 1
    if (count > 0) hits.push({ kind: 'bannedWord', pattern: word, count })
  }
  for (const pattern of Array.isArray(habits.bannedPatterns) ? habits.bannedPatterns : []) {
    const parts = String(pattern).split('…').filter(Boolean)
    let count = 0
    if (parts.length > 1) {
      const escaped = parts.map((part) => part.replace(/[\.*+?^${}()|[\]\\]/gu, '\\$&')).join('[\\s\\S]{0,12}')
      try { count = [...text$.matchAll(new RegExp(escaped, 'gu'))].length } catch { count = 0 }
    } else {
      count = text$.split(pattern).length - 1
    }
    if (count > 0) hits.push({ kind: 'bannedPattern', pattern, count })
  }
  return hits
}

const requireRoot = (args) => {
  const root = String(args.root ?? '').trim()
  if (!root) {
    const err = new Error("缺少必填参数 root（库的绝对路径，先 openstory_libraries 查）")
    err.code = 'E_INVALID_ARGS'
    throw err
  }
  return root
}

/**
 * 模块开关判定用的库根（OS-144 / OS-146 修正口径）：**只认显式 root**。
 *   · 给了 root → 按该库的 ui-state 判定（该库停用分析＝MODULE_DISABLED）；
 *   · 没给 root → 没有库上下文，不做模块闸（分析工具吃的是纯文本，本来不绑定库）。
 *
 * 绝不回落到「本机库清单第一条」：那会让工具行为随本机装了几个库、哪个排在前面漂移，
 * 测试也就不再 hermetic（OS-146 复核实测过：本机任一库停用分析，MCP 测试直接红）。
 */
function moduleRootOf(args) {
  return String(args.root ?? '').trim()
}

const tools = [
  /* ===== meta ===== */
  {
    name: 'openstory_libraries',
    title: '列出本机库',
    description: '列出本机所有 OpenStory 库（小说/剧本等项目的根目录）。任何操作前先调它拿 root。',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    async run() {
      const payload = await daemon('/api/libraries')
      return { libraries: payload.libraries || [] }
    }
  },
  {
    name: 'openstory_files',
    title: '列库内文件',
    description: '列出库内某目录的文件（含子目录完整相对路径与大小）。dir 可省略＝顶层概览。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: '库根目录绝对路径' }, dir: { type: 'string', description: '子目录，如 正文 / 世界书 / 故事源' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/files', { query: { root, dir: args.dir } })
      return { files: payload.files || [] }
    }
  },

  /* ===== novel ===== */
  {
    name: 'openstory_novel_list_chapters',
    title: '章节清单',
    description: '列出小说的章节清单（编号/标题/字数，按 NNN- 前缀解析）。写正文前先看这里定位章号。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/chapters', { query: { root, dir: '正文' } })
      return { chapters: payload.chapters || [], warnings: payload.warnings || [] }
    }
  },
  {
    name: 'openstory_novel_read_chapter',
    title: '读章节正文',
    description: '读一章的完整正文（md 源文）。file 形如 正文/001-标题.md——编号与标题以清单为准。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, file: { type: 'string', description: '正文/001-xxx.md' } },
      required: ['root', 'file'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.file) throw invalidArgs('file')
      // chapterGet 响应形状是 { ok, name, text, chars }——没有 chapter 包裹
      const payload = await daemon('/api/chapter', { query: { root, file: args.file } })
      return { file: args.file, name: payload.name, text: payload.text, chars: payload.chars }
    }
  },
  {
    name: 'openstory_novel_write_chapter',
    title: '写章节正文',
    description: '整章覆盖写入。**会先把原稿备份进 .history（可逆）**；写入后返回事实链健康度（factStale=true 说明正文比故事源事实新，建议跑 enrich 同步）。慎用：外部 agent 没有人工确认环节，写前先 read 确认目标章。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, file: { type: 'string' }, text: { type: 'string', description: '完整章节 md 源文（整章覆盖，不是增量）' } },
      required: ['root', 'file', 'text'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.file) throw invalidArgs('file')
      if (typeof args.text !== 'string' || !args.text.trim()) throw invalidArgs('text（完整章节内容）')
      const payload = await daemon('/api/chapter', { method: 'PUT', body: { root, file: args.file, text: args.text } })
      // 习惯回显（OS-59）：写入照常进行（MCP 无人工确认环节），但把命中如实回报，
      // 让上游 agent 自己决定要不要重写——习惯表是作者的规矩，外部 agent 必须知情。
      let habits = null
      try { habits = (await daemon('/api/habits', { query: { root } })).habits } catch { habits = null }
      const habitHits = lintHabits(args.text, habits)
      return {
        ok: true, chars: payload.chars, savedAt: payload.savedAt, backup: payload.backup,
        factStale: payload.factStale ?? null,
        ...(habitHits.length ? { habitHits, habitWarning: '这段正文命中了作者习惯表，建议按提示改写后重写一次' } : {})
      }
    }
  },
  {
    name: 'openstory_novel_new_chapter',
    title: '新建章节',
    description: '自动编号新建空章（最大号+1，三位补零）。title 缺省时用写作套件的默认标题（未配置会拒绝）。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, title: { type: 'string', description: '章标题（可省略，走套件默认）' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/chapters', { method: 'POST', body: { root, dir: '正文', ...(args.title ? { title: args.title } : {}) } })
      return { chapter: payload.chapter }
    }
  },
  {
    name: 'openstory_novel_delete_chapter',
    title: '删除章节',
    description: '删除一章——**不是真删**：原稿挪进 .history 备份（返回 backup 路径，可人工找回）。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, file: { type: 'string' } },
      required: ['root', 'file'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.file) throw invalidArgs('file')
      const payload = await daemon('/api/chapter', { method: 'DELETE', query: { root, file: args.file } })
      return { ok: true, backup: payload.backup }
    }
  },

  /* ===== reference ===== */
  {
    name: 'openstory_reference_index',
    title: '世界书索引',
    description: '世界书（创作型条目知识库）索引：全部笔记（标题/路径/标签/摘要）＋标签清单（含描述）＋统计。找世界书条目先调它。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/reference', { query: { root } })
      return { notes: payload.notes || [], tags: payload.tags || [], stats: payload.stats || null }
    }
  },
  {
    name: 'openstory_reference_graph',
    title: '世界书图谱',
    description: '世界书关系图谱：节点（reference/tag/artifact/entry）＋带权边（link=双链、tag=标签、mention=提及）＋统计。理解「谁关联谁」用这个，不要一个个读文件。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/reference/graph', { query: { root } })
      return { nodes: payload.nodes || [], edges: payload.edges || [], stats: payload.stats || {} }
    }
  },
  {
    name: 'openstory_reference_read_note',
    title: '读世界书笔记',
    description: '读一篇世界书笔记的完整内容（含 frontmatter 标签/双链解析）＋双段反链（谁链接它/谁提到它没建链）。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, path: { type: 'string', description: '世界书/人物/宋江.md 这类完整相对路径' } },
      required: ['root', 'path'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.path) throw invalidArgs('path')
      const payload = await daemon('/api/reference/note', { query: { root, path: args.path } })
      return { note: payload.note, backlinks: payload.backlinks }
    }
  },
  {
    name: 'openstory_reference_write_note',
    title: '写世界书笔记',
    description: '整篇写入世界书笔记（file 给 世界书/子目录/标题.md）。**会先备份原稿进 .history**。规范：frontmatter 带 tags 数组；内部互链用 [[标题]]；链接正文用 [[正文/001-xxx.md|别名]]。单向原则：世界书可以链小说，正文不要回挂世界书。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, file: { type: 'string', description: '世界书/子目录/标题.md' }, text: { type: 'string', description: '完整笔记 md（含 frontmatter tags）' } },
      required: ['root', 'file', 'text'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.file) throw invalidArgs('file')
      if (!String(args.file).startsWith(namingEntry('worldbook').dir + '/')) throw invalidArgs(`file 必须以 ${namingEntry('worldbook').dir}/ 开头（世界书系统只管 ${namingEntry('worldbook').dir}/ 目录）`)
      if (typeof args.text !== 'string' || !args.text.trim()) throw invalidArgs('text')
      // OS-211：走世界书专用写端点（referenceNotePut，归属 worldbook 模块）——
      // 通用章节端点已收窄到载体目录，不再承担世界书写入；写实现仍是同一份 writeChapterWithBackup。
      const payload = await daemon('/api/reference/note', { method: 'PUT', body: { root, path: args.file, text: args.text } })
      let habits2 = null
      try { habits2 = (await daemon('/api/habits', { query: { root } })).habits } catch { habits2 = null }
      const habitHits2 = lintHabits(args.text, habits2)
      return {
        ok: true, chars: payload.chars, backup: payload.backup ?? null,
        ...(habitHits2.length ? { habitHits: habitHits2 } : {})
      }
    }
  },

  {
    name: 'openstory_habits_read',
    title: '读习惯表',
    description: '读本库作者自定义的写作习惯表：文风自述、禁用词、惯用词、禁用句式、禁用修辞、描述公式、口吻参数。**写正文/世界书前必读**——产出必须逐条遵循（这是作者亲自定的规矩，优先级高于一切默认风格）。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/habits', { query: { root } })
    }
  },
  {
    name: 'openstory_habits_put',
    title: '写习惯表',
    description: '写本库作者自定义的写作习惯表（整表覆盖，daemon 侧自动 .history 备份）。只在作者明确要求调整习惯表时使用；改完回读确认。写正文时若产出命中禁用词/句式，优先改产出而不是删规矩。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        habits: { type: 'object', description: '完整习惯表对象（结构同 openstory_habits_read 返回的 habits 字段）' }
      },
      required: ['root', 'habits'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.habits || typeof args.habits !== 'object' || Array.isArray(args.habits)) throw invalidArgs('habits 必须是习惯表对象')
      const payload = await daemon('/api/habits', { method: 'PUT', body: { root, habits: args.habits } })
      return payload
    }
  },

  {
    name: 'openstory_vision_describe',
    title: '看图写作',
    description: '读库内一张世界书图片，用文学语言写一段可复用的人物/场景白描（150–300 字）。给角色写肖像、给场景写氛围、给怪物写道体。**不是**技术性图像描述——产出可直接进世界书正文，也能当生图提示词底稿。配套 skill：skills/visual-describe。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        image: { type: 'string', description: '库内图片相对路径，如 世界书/人物/assets/沈小楼.png' },
        target: { type: 'string', description: 'character / scene / creature / item' },
        focus: { type: 'string', description: '这次特别想抓的点，如「手部」「雨中的光」' }
      },
      required: ['root', 'image'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.image) throw invalidArgs('image')
      const payload = await daemon('/api/vision/describe', {
        method: 'POST',
        body: { root, image: args.image, target: args.target, focus: args.focus }
      })
      return payload
    }
  },
  {
    name: 'openstory_image_generate',
    title: '生图（世界书条目）',
    description: '给世界书条目生成设定图（走设置里的生图后端：OpenAI 兼容 或 ComfyUI）。图片落条目旁 assets/，路径自动回填 frontmatter 的 cover/images。默认风格「2D彩漫风格」，可用 stylePrompt 覆盖。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        path: { type: 'string', description: '世界书/ 下的条目路径，如 世界书/人物/沈小楼.md' },
        prompt: { type: 'string', description: '显式画面描述（留空＝按条目名＋正文摘要自动推）' },
        stylePrompt: { type: 'string', description: '风格覆盖（留空＝设置里的默认风格）' },
        size: { type: 'string' }
      },
      required: ['root', 'path'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.path) throw invalidArgs('path')
      const payload = await daemon('/api/reference/image', {
        method: 'POST',
        body: { root, path: args.path, prompt: args.prompt, stylePrompt: args.stylePrompt, size: args.size }
      })
      return payload
    }
  },

  /* ===== deduce + enrich + fact ===== */
  {
    name: 'openstory_deduce_present',
    title: '推演·开局/续拍',
    description: '推演引擎（种子化 2d6，确定性）：出局面卡＋候选拍包。LLM 只在「戏剧候选」里可选出现。worldview 缺失会如实报 WORLD_EMPTY。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        bookId: { type: 'string', description: '故事源 bookId（如 shuihu），缺省用主 book' },
        pov: { type: 'string', description: '视角角色 id（可选）' },
        seed: { type: 'integer', description: '随机种子（可选，复现用）' },
        reset: { type: 'boolean', description: '重置推演状态（受控重置，需 confirm:restore）' },
        [CONFIRM_PARAM]: { type: 'string', enum: [...TOOL_CONFIRM_LEVELS], description: '作者确认级别（reset:true 时需要 restore，其余写调用按注册表门槛）' }
      },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/deduce/present', { method: 'POST', body: cleanBody(args) })
      return payload
    }
  },
  {
    name: 'openstory_deduce_settle',
    title: '推演·结算',
    description: '结算一拍：action=choose+candidateId 选候选 / veto 等导演动作。产出的条目**只交回调用方，不自动写库**——要落库走 enrich 或世界书写。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        bookId: { type: 'string' },
        candidateId: { type: 'string' },
        action: { type: 'string', description: 'choose / veto / …（以局面卡说明为准）' },
        note: { type: 'string', description: '导演备注' }
      },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/deduce/settle', { method: 'POST', body: cleanBody(args) })
      return payload
    }
  },
  {
    name: 'openstory_enrich_run',
    title: '故事源富化·启动',
    description: '语义增补全量重算（六槽位＋因果图＋需求层级＋台账，写旁挂 wiki）。**长任务 2–6 分钟**：立即返回 jobId，用 openstory_enrich_status 查进度。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' } },
      required: ['root', 'bookId'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.bookId) throw invalidArgs('bookId')
      const payload = await daemon('/api/enrich/run', { method: 'POST', body: { root, bookId: args.bookId } })
      return { jobId: payload.jobId }
    }
  },
  {
    name: 'openstory_enrich_status',
    title: '故事源富化·进度',
    description: '查 enrich 长任务进度（jobId 来自 openstory_enrich_run）。',
    inputSchema: {
      type: 'object',
      properties: { jobId: { type: 'string' } },
      required: ['jobId'],
      additionalProperties: false
    },
    async run(args) {
      if (!args.jobId) throw invalidArgs('jobId')
      return await daemon('/api/enrich/status', { query: { jobId: args.jobId } })
    }
  },
  {
    name: 'openstory_enrich_graph',
    title: '知识图谱',
    description: '读富化产出的知识图谱（事件/场景/人物关系，wiki 词条）。分析「谁和谁有关系、因果链」用这个。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' } },
      required: ['root', 'bookId'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.bookId) throw invalidArgs('bookId')
      return await daemon('/api/enrich/graph', { query: { root, bookId: args.bookId } })
    }
  },
  {
    name: 'openstory_fact_curve',
    title: '剧情曲线（fact）',
    description: '读故事源产出的章级剧情曲线（情绪/事件密度/功能段）。分析全书节奏与起伏用这个。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/fact/curve', { query: { root, bookId: args.bookId } })
    }
  },

  /* ===== analysis（本地计算，不经 daemon） ===== */
  {
    name: 'openstory_analysis_chapter',
    title: '本章分析',
    description: '对一段文本跑分析引擎（纯本地计算，秒回）：stats（字数/段/句/对白比）+ rhythm（逐段字数）+ emotion（逐段情绪强度）+ style（句长/段长变异系数、套话、连接词）+ aiSmell（AI 味评分与四因子）+ issues（可定位到段落的问题清单）。配合 novel_read_chapter 用：读正文 → 丢进来分析。',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: '要分析的正文 md 源文' }, root: { type: 'string', description: '可选：库根路径——给了就按该库的模块开关判定（该库停用分析＝MODULE_DISABLED）；不给＝不做模块闸（分析吃纯文本，不绑定库）' } },
      required: ['text'],
      additionalProperties: false
    },
    async run(args) {
      if (typeof args.text !== 'string' || !args.text.trim()) throw invalidArgs('text')
      // OS-144 / OS-146：分析模块停用 → 工具回 MODULE_DISABLED（与 daemon 同一判定入口）。
      // 只有显式给了 root 才有库上下文；没给 root 就不判定，绝不回落到本机库清单。
      const moduleRoot = moduleRootOf(args)
      if (moduleRoot && !(await isModuleEnabled(moduleRoot, 'analysis'))) {
        throw Object.assign(new Error('「分析」模块已停用——在设置里重新启用后再调这个工具'), { code: 'MODULE_DISABLED' })
      }
      // OS-195b：宿主经能力解析取句柄，不在模块顶层持有实现登记表。
      const resolved = await resolveCapability(moduleRoot ?? '', 'text.analyze', { min: 1 })
      if (!resolved.ok) throw Object.assign(new Error(resolved.message), { code: resolved.code })
      const { analyzeChapter } = resolved.capability
      const paragraphs = args.text.split(/\n+/u).map((block) => block.trim()).filter(Boolean)
      const result = analyzeChapter(args.text, { paragraphs })
      return { editorial: result.editorial, stats: result.stats, style: result.style, aiSmell: { score: result.aiSmell?.score, factors: result.aiSmell?.factors }, issues: result.issues, emotion: result.emotion, rhythm: result.rhythm }
    }
  },

  /* ---------- 技能货架（OS-91）：让外部 Agent 也能发现并读取 31 个手艺配方 ----------
   * 之前 skills 只经 /api/skills 暴露给左侧 Agent 的选择器，MCP 侧零暴露——
   * 外部 Agent（Claude/Qoder/CodeBuddy…）完全看不到这套技能库。这里补两个工具。 */
  {
    name: 'openstory_skills_list',
    title: '技能清单',
    description: '列出本机技能货架的全部配方（33 个内置＋2 套件捆绑：技法 craft/审阅 review/改写 transform/抽取 extract/操作说明书 operate 五类，含文风包）。返回 name/description/category/genres/stage/version/vendor。开工前先看清单，再用 openstory_skills_read 读全文——选技能靠 description，别凭名字猜。可按体裁过滤。operate 是只读说明书，不自动注入 prompt，写操作只按其声明的官方 MCP 工具＋确认级别执行。',
    inputSchema: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: '体裁 id（如 long-serial / short-story / screenplay）；不传＝全部' },
        category: { type: 'string', enum: [...SKILL_CATEGORIES], description: '只列某一类' }
      },
      additionalProperties: false
    },
    async run(args) {
      const query = args.genre ? { genre: String(args.genre) } : {}
      const payload = await daemon('/api/skills', { query })
      let skills = payload.skills || []
      if (args.category) skills = skills.filter((item) => item.category === args.category)
      return {
        ok: true,
        total: skills.length,
        skills: skills.map((item) => ({
          name: item.name,
          description: item.description,
          category: item.category,
          genres: item.genres,
          stage: item.stage || null,
          version: item.version || null,
          vendor: item.vendor || null
        })),
        ...(payload.warnings?.length ? { warnings: payload.warnings } : {})
      }
    }
  },
  {
    name: 'openstory_skills_read',
    title: '读技能全文',
    description: '读一个技能的 SKILL.md 全文（含 frontmatter 之外的正文、附属 tools/confirm/output 声明）。这是「怎么做事」的真源——craft 类是技法规则可直接遵循，review 类只出问题清单不改文件，transform 类产提案，extract 类产数据，operate 类只读项目构建/升级说明书（不产出小说内容、不执行代码，写操作只准按其声明的官方 MCP 工具＋confirm 级别执行）。**动手前先读这一篇，别只凭 description 发挥**。',
    inputSchema: {
      type: 'object',
      properties: { name: { type: 'string', description: '技能 id（openstory_skills_list 返回的 name）' } },
      required: ['name'],
      additionalProperties: false
    },
    async run(args) {
      if (typeof args.name !== 'string' || !args.name.trim()) throw invalidArgs('name')
      return await daemon('/api/skill', { query: { name: String(args.name).trim() } })
    }
  },

  /* ---------- 建库原语（OS-213）：从空目录到可写库 ----------
   * 全部走现有 daemon HTTP，本层只做薄适配（不复制任何业务逻辑）。
   * diagnose/scan 只读；create/import/primary 会写盘，故注册表标为写工具，
   * 调用需带满足门槛的 confirm。 */
  {
    name: 'openstory_library_create',
    title: '新建库',
    description: '在一个**绝对路径**下新建 OpenStory 库（写 .openstory/project.json 并登记到本机库列表）。path 必须是绝对路径且目录可写；name 是显示名；primaryCarrier 可选（正文/剧本等主载体 id，缺省按库类型默认）。**会写盘**，调用需 confirm:create。建完先 openstory_library_diagnose 确认形状。',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '库根目录绝对路径（不存在会被创建）' },
        name: { type: 'string', description: '库显示名' },
        primaryCarrier: { type: 'string', description: '主载体 id（可选；缺省用库类型默认）' }
      },
      required: ['path', 'name'],
      additionalProperties: false
    },
    async run(args) {
      if (typeof args.path !== 'string' || !args.path.trim()) throw invalidArgs('path')
      if (typeof args.name !== 'string' || !args.name.trim()) throw invalidArgs('name')
      const payload = await daemon('/api/library/create', {
        method: 'POST',
        body: cleanBody({ path: args.path.trim(), name: args.name.trim(), primaryCarrier: args.primaryCarrier })
      })
      return {
        root: payload.root,
        document: payload.document,
        enabled: payload.enabled ?? [],
        needsPrimary: payload.needsPrimary === true,
        registered: payload.registered
      }
    }
  },
  {
    name: 'openstory_library_diagnose',
    title: '诊断库形状',
    description: '只读诊断一个库当前的形状与版本判定（shape/verdict）：目录结构、project.json 是否可读、是否旧版待升级、缺哪些目录。**不写盘、不触发升级**——判断「这个库能不能直接用」先调它。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: '库根目录绝对路径' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/library/diagnose', { query: { root } })
      return { shape: payload.shape, verdict: payload.verdict }
    }
  },
  {
    name: 'openstory_library_scan',
    title: '扫描旧源出计划',
    description: '扫描一个外部旧稿目录，产出**导入计划**（会搬什么、跳过什么、冲突什么），零写入。sourcePath 是旧稿目录绝对路径。看完计划再调 openstory_library_import 执行。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '目标库根目录绝对路径' },
        sourcePath: { type: 'string', description: '旧稿目录绝对路径' }
      },
      required: ['root', 'sourcePath'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.sourcePath !== 'string' || !args.sourcePath.trim()) throw invalidArgs('sourcePath')
      const payload = await daemon('/api/library/scan', { method: 'POST', body: { root, sourcePath: args.sourcePath.trim() } })
      return { plan: payload.plan }
    }
  },
  {
    name: 'openstory_library_import',
    title: '导入旧稿',
    description: '按 openstory_library_scan 的计划真正导入旧稿到库（搬文件、留 .history 备份、写日志）。**会写盘**，调用需 confirm:create。先 scan 再 import——不要跳过计划直接搬。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '目标库根目录绝对路径' },
        sourcePath: { type: 'string', description: '旧稿目录绝对路径' }
      },
      required: ['root', 'sourcePath'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.sourcePath !== 'string' || !args.sourcePath.trim()) throw invalidArgs('sourcePath')
      const payload = await daemon('/api/library/import', { method: 'POST', body: { root, sourcePath: args.sourcePath.trim() } })
      return { report: payload.report }
    }
  },
  {
    name: 'openstory_library_primary',
    title: '设主载体',
    description: '切换库的主载体（正文/剧本等）。**会改 project.json**，调用需 confirm:create。expectedRevision 可选：传了就做乐观锁，版本不符拒绝覆盖。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        primaryCarrier: { type: 'string', description: '主载体 id' },
        expectedRevision: { type: 'integer', description: '可选乐观锁：当前 project.json revision' }
      },
      required: ['root', 'primaryCarrier'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.primaryCarrier !== 'string' || !args.primaryCarrier.trim()) throw invalidArgs('primaryCarrier')
      const payload = await daemon('/api/library/primary', {
        method: 'POST',
        body: cleanBody({ root, primaryCarrier: args.primaryCarrier.trim(), expectedRevision: args.expectedRevision })
      })
      return { document: payload.document, enabled: payload.enabled ?? [] }
    }
  },

  /* ---------- OS-222：升级确认链（diagnose→plan→confirm→apply→status/backup verify） ---------- */
  {
    name: 'openstory_upgrade_diagnose',
    title: '只读升级诊断',
    description: '诊断一个库的旧布局/能力迁移现状（会动哪些文件、冲突、备份范围、风险）。**零写入**：不升级、不建备份、不写 journal。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: '库根目录绝对路径' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/library/upgrade-diagnose', { query: { root } })
      return { spec: payload.spec, root: payload.root, section: payload.section, writes: payload.writes }
    }
  },
  {
    name: 'openstory_upgrade_plan',
    title: '只读升级计划',
    description: '产出整库升级计划（planId ＋ 文件/迁移器摘要绑定），零写入；planId 供 openstory_upgrade_apply 复核。文件一变 planId 即失效，需重新出计划。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: '库根目录绝对路径' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/library/upgrade-plan', { method: 'POST', body: { root } })
      return { plan: payload.plan, planId: payload.planId, writes: payload.writes }
    }
  },
  {
    name: 'openstory_upgrade_apply',
    title: '确认执行升级',
    description: '按已预览的 planId 执行升级/能力迁移。必须 planId + confirm:\'migrate\'；服务端复核 root/文件/迁移器摘要，复用既有备份/journal/回滚；确认后零写入豁免失效。失败如实报 rolledBack。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '库根目录绝对路径' },
        planId: { type: 'string', description: 'openstory_upgrade_plan 产出的 planId' },
        operationId: { type: 'string', description: '可选：调用方标识，仅原样回填进返回结果，服务端不据此判重；planId 一次性，重放需重新 plan' }
      },
      required: ['root', 'planId'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.planId !== 'string' || !args.planId.trim()) throw invalidArgs('planId')
      // MCP 级确认闸已在 callTool 用注册表门槛（migrate）验过 confirm 实参；
      // 这里转成 daemon apply 契约要求的布尔 confirm:true（confirm 不转发给 daemon）。
      const body = cleanBody({ root, planId: args.planId.trim(), operationId: args.operationId, confirm: true })
      const payload = await daemon('/api/library/upgrade-apply', { method: 'POST', body })
      return {
        spec: payload.spec, outcome: payload.outcome, planId: payload.planId,
        libraryUpgrade: payload.libraryUpgrade ?? null, capabilityMigrations: payload.capabilityMigrations ?? [],
        journals: payload.journals, backups: payload.backups, rolledBack: payload.rolledBack,
        rollbackErrors: payload.rollbackErrors, message: payload.message
      }
    }
  },
  {
    name: 'openstory_upgrade_status',
    title: '升级/迁移状态',
    description: '只读查升级标记、能力 journal、dataVersions、DATA_VERSION_AHEAD、失败/回滚与备份路径。不写盘、不跑迁移；坏档以 issues 如实报出。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: '库根目录绝对路径' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/library/migration-status', { query: { root } })
      return { status: payload }
    }
  },
  {
    name: 'openstory_upgrade_backup_verify',
    title: '备份校验',
    description: '只读校验 .history 下升级/能力备份：逐文件 sha256/大小，与 journal 写前哈希核对，缺备份/哈希不符如实报 issues。可给 backup 只看一份（库内相对路径）。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string', description: '库根目录绝对路径' },
        backup: { type: 'string', description: '可选：库内 .history/… 相对路径，只校验这一份备份' }
      },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/library/migration-backups', { query: { root, backup: args.backup } })
      return { healthy: payload.healthy, backups: payload.backups, issues: payload.issues, writes: payload.writes }
    }
  },

  /* ---------- 套件原语（OS-213）：建库后配齐写作/编剧套件 ---------- */
  {
    name: 'openstory_suites',
    title: '列套件与状态',
    description: '列出可用套件（写作/编剧等）及每个套件的启用状态与设置。带 root＝按该库的启停状态与覆盖；不带＝本机默认。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: '库根目录（可选；带则按该库状态）' } },
      additionalProperties: false
    },
    async run(args) {
      const payload = await daemon('/api/suites', { query: args.root ? { root: String(args.root).trim() } : {} })
      return {
        suites: payload.suites || [],
        overrides: payload.overrides ?? [],
        ...(payload.userDir ? { userDir: payload.userDir } : {}),
        ...(payload.warnings?.length ? { warnings: payload.warnings } : {})
      }
    }
  },
  {
    name: 'openstory_suite_enable',
    title: '启停套件',
    description: '启用或停用一个套件（id 从 openstory_suites 取）。带 root 改该库状态，不带改本机默认。**会写状态文件**，调用需 confirm:create。启停即时反映到模块投影。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '套件 id' },
        enabled: { type: 'boolean', description: 'true＝启用，false＝停用' },
        root: { type: 'string', description: '库根目录（可选）' }
      },
      required: ['id', 'enabled'],
      additionalProperties: false
    },
    async run(args) {
      if (typeof args.id !== 'string' || !args.id.trim()) throw invalidArgs('id')
      if (typeof args.enabled !== 'boolean') throw invalidArgs('enabled')
      const payload = await daemon('/api/suite/state', {
        method: 'PUT',
        body: cleanBody({ id: args.id.trim(), enabled: args.enabled, root: args.root })
      })
      return { enabled: payload.enabled }
    }
  },
  {
    name: 'openstory_suite_settings',
    title: '写套件设置',
    description: '改一个套件的设置项（如写作套件的新建章节默认标题）。id 从 openstory_suites 取，values 是键值对象（只覆盖传入的键）。**会写设置文件**，调用需 confirm:create。',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: '套件 id' },
        values: { type: 'object', description: '要写入的设置键值（只覆盖传入键）' },
        root: { type: 'string', description: '库根目录（可选）' }
      },
      required: ['id', 'values'],
      additionalProperties: false
    },
    async run(args) {
      if (typeof args.id !== 'string' || !args.id.trim()) throw invalidArgs('id')
      if (!args.values || typeof args.values !== 'object' || Array.isArray(args.values)) throw invalidArgs('values')
      const payload = await daemon('/api/suite/settings', {
        method: 'PUT',
        body: cleanBody({ id: args.id.trim(), values: args.values, root: args.root })
      })
      return { values: payload.values }
    }
  },

  /* ---------- fact 原语（OS-213）：事实链读写与导入 ---------- */
  {
    name: 'openstory_fact_books',
    title: '列事实书',
    description: '列一个库里的全部事实书（bookId/标题/条目数/revision）。任何 fact 操作前先调它拿 bookId。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' } },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/fact/books', { query: { root } })
      return { books: payload.books || [] }
    }
  },
  {
    name: 'openstory_fact_entries',
    title: '读事实条目',
    description: '读一个事实书的条目（可按 layer 过滤、按 q 全文搜、分页）。返回 bookId/revision/total/entries/layers。写正文前后用它核对事实链。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        bookId: { type: 'string', description: '事实书 id（可选；缺省用主事实书）' },
        layer: { type: 'string', description: '只取某一层（worldview/character/plot 等）' },
        q: { type: 'string', description: '全文搜索词' },
        offset: { type: 'string', description: '分页起点（数字字符串）' },
        limit: { type: 'string', description: '每页条数（数字字符串）' }
      },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      const payload = await daemon('/api/fact/entries', {
        query: cleanBody({ root, bookId: args.bookId, layer: args.layer, q: args.q, offset: args.offset, limit: args.limit })
      })
      return {
        bookId: payload.bookId,
        ...(payload.book ? { book: payload.book } : {}),
        revision: payload.revision,
        total: payload.total,
        entries: payload.entries || [],
        layers: payload.layers || {},
        ...(payload.warnings?.length ? { warnings: payload.warnings } : {})
      }
    }
  },
  {
    name: 'openstory_fact_entries_import',
    title: '导入事实条目',
    description: '把一份**完整的**条目数组写进一个事实书——这是**整份替换**，不是合并：传进来的 entries 就是这本书之后的全部条目。每条都会过 fact schema 校验，任一条不合法整份拒绝零写入。**会覆盖主档**（写前备份、留 operationId 幂等日志），调用需 confirm:create。operationId 相同＝幂等重放不重复写。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        bookId: { type: 'string', description: '事实书 id' },
        entries: { type: 'array', description: '完整条目数组（整份替换，不是增量）' },
        title: { type: 'string', description: '事实书标题（可选）' },
        wiki: { type: 'object', description: '派生的 wiki 结构（可选；derivedFrom 由内核按写后 revision 覆盖）' },
        operationId: { type: 'string', description: '幂等键（可选；同 id 重放不重复写）' }
      },
      required: ['root', 'bookId', 'entries'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.bookId !== 'string' || !args.bookId.trim()) throw invalidArgs('bookId')
      if (!Array.isArray(args.entries)) throw invalidArgs('entries')
      const payload = await daemon('/api/fact/entries/import', {
        method: 'POST',
        body: cleanBody({
          root, bookId: args.bookId.trim(), entries: args.entries,
          title: args.title, wiki: args.wiki, operationId: args.operationId
        })
      })
      return {
        bookId: payload.bookId,
        entries: payload.entries,
        ...(payload.revision !== undefined ? { revision: payload.revision } : {}),
        ...(payload.backup ? { backup: payload.backup } : {})
      }
    }
  },

  /* ---------- exchange 原语（OS-213）：fact 与外部格式互转 ---------- */
  {
    name: 'openstory_exchange_export',
    title: '导出事实书',
    description: '把一个事实书导出成外部格式（format 如 jsonl/csv/markdown）。save 缺省 false＝只返回数据不落盘；save:true 会写文件（需 confirm:create）。返回 entries 与 lost（导出会丢的字段，说明格式装不下的信息）。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        bookId: { type: 'string' },
        format: { type: 'string', description: '导出格式：jsonl / csv / markdown' },
        save: { type: 'boolean', description: 'true＝落盘；缺省只回数据' }
      },
      required: ['root', 'bookId', 'format'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.bookId !== 'string' || !args.bookId.trim()) throw invalidArgs('bookId')
      if (typeof args.format !== 'string' || !args.format.trim()) throw invalidArgs('format')
      const payload = await daemon('/api/exchange/export', {
        method: 'POST',
        body: cleanBody({ root, bookId: args.bookId.trim(), format: args.format.trim(), save: args.save })
      })
      return {
        bookId: payload.bookId,
        entries: payload.entries || [],
        lost: payload.lost || [],
        ...(payload.file ? { file: payload.file } : {})
      }
    }
  },
  {
    name: 'openstory_exchange_import',
    title: '导入外部格式',
    description: '把外部格式文本导入一个事实书。dryRun:true＝只解析并报告（entries/errors/warnings/skipped，零写入）；缺省或 false＝真写（需 confirm:create，写前备份）。总是先 dryRun 看报告再真导。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        bookId: { type: 'string' },
        format: { type: 'string', description: '导出格式：jsonl / csv / markdown' },
        text: { type: 'string', description: '外部格式原文' },
        dryRun: { type: 'boolean', description: 'true＝只解析不写；缺省真写' }
      },
      required: ['root', 'bookId', 'format', 'text'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.bookId !== 'string' || !args.bookId.trim()) throw invalidArgs('bookId')
      if (typeof args.format !== 'string' || !args.format.trim()) throw invalidArgs('format')
      if (typeof args.text !== 'string') throw invalidArgs('text')
      const payload = await daemon('/api/exchange/import', {
        method: 'POST',
        body: cleanBody({ root, bookId: args.bookId.trim(), format: args.format.trim(), text: args.text, dryRun: args.dryRun })
      })
      return {
        dryRun: payload.dryRun === true,
        entries: payload.entries ?? 0,
        errors: payload.errors || [],
        warnings: payload.warnings || [],
        skipped: payload.skipped || [],
        ...(payload.written ? { written: payload.written } : {})
      }
    }
  },

  /* ---------- 剧本 / 会话 / 扮演构建原语（OS-215）----------
   * 只做薄适配：业务实现与备份/幂等/错误语义都在 daemon 端点。
   * 不开放 absorb、Agent 对话、待确认卡的**创建**；pending 只结算既有卡。 */
  {
    name: 'openstory_script_to_fact',
    title: '剧本转事实',
    description: '把完整剧本文本转成 fact 条目骨架（幕/角色/场景），纯结构映射、不写盘、不调模型。返回 entries、wiki、stats；先 dry-run 看结果，再调 openstory_fact_entries_import 落库（那里才做 schema/revision/备份）。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, text: { type: 'string', description: '完整剧本文本' },
        bookId: { type: 'string' }, domain: { type: 'string' }
      },
      required: ['root', 'text'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.text !== 'string') throw invalidArgs('text')
      return await daemon('/api/script/to-fact', {
        method: 'POST',
        body: cleanBody({ root, text: args.text, bookId: args.bookId, domain: args.domain })
      })
    }
  },
  {
    name: 'openstory_script_from_fact',
    title: '事实转剧本',
    description: '把 fact 条目渲染成剧本文本（可传 entries，或按 bookId 读现档）。纯渲染不写盘、不调模型。返回 text 与 stats；空条目是错误，不渲染空剧本冒充成功。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, bookId: { type: 'string' },
        entries: { type: 'array', description: '可选：显式条目；省略则按 bookId 读现档' },
        wiki: { type: 'object', description: '可选：派生 wiki 结构' }
      },
      required: ['root'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/script/from-fact', {
        method: 'POST',
        body: cleanBody({ root, bookId: args.bookId, entries: args.entries, wiki: args.wiki })
      })
    }
  },
  {
    name: 'openstory_chapters_rename',
    title: '章节重命名',
    description: '保号重命名章节：只换标题段，目标已存在拒绝。**会改文件名并留日志**，调用需 confirm:create。正文/剧本载体外的路径一律拒绝。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, file: { type: 'string' }, title: { type: 'string', description: '新标题（不含 NNN- 前缀）' } },
      required: ['root', 'file', 'title'],
      additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.file !== 'string' || !args.file.trim()) throw invalidArgs('file')
      if (typeof args.title !== 'string' || !args.title.trim()) throw invalidArgs('title')
      return await daemon('/api/chapters/rename', {
        method: 'POST', body: { root, file: args.file.trim(), title: args.title.trim() }
      })
    }
  },

  /* ---------- 多局会话：list / get / new / switch / delete / 整存 ---------- */
  {
    name: 'openstory_sessions',
    title: '列多局会话',
    description: '列一个事实书下的全部推演/扮演会话（主线＋分局）与激活指针。返回 bookId/activeId/sessions。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' } },
      required: ['root'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/deduce/sessions', { query: cleanBody({ root, bookId: args.bookId }) })
    }
  },
  {
    name: 'openstory_session_get',
    title: '读会话',
    description: '读一个会话全文（可显式 sessionId；省略走 activeId）。返回 session/activeId。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' } },
      required: ['root'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/deduce/session', { query: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId }) })
    }
  },
  {
    name: 'openstory_session_new',
    title: '新建会话',
    description: '在事实书下新建一个空会话并设为激活。**会写会话盘**，调用需 confirm:create。返回 sessionId/session/activeId/sessions。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, title: { type: 'string' } },
      required: ['root'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/deduce/session/manage', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, action: 'new', title: args.title })
      })
    }
  },
  {
    name: 'openstory_session_switch',
    title: '切换会话',
    description: '激活一个已存在的会话。**会改 activeId 指针**，调用需 confirm:create。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' } },
      required: ['root', 'sessionId'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.sessionId !== 'string' || !args.sessionId.trim()) throw invalidArgs('sessionId')
      return await daemon('/api/deduce/session/manage', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, action: 'switch', sessionId: args.sessionId.trim() })
      })
    }
  },
  {
    name: 'openstory_session_delete',
    title: '删除会话',
    description: '非破坏删除一个会话（挪成 .deleted，不是真删）。**最后一局不能删**；调用需 confirm:restore。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' } },
      required: ['root', 'sessionId'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.sessionId !== 'string' || !args.sessionId.trim()) throw invalidArgs('sessionId')
      return await daemon('/api/deduce/session/manage', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, action: 'delete', sessionId: args.sessionId.trim() })
      })
    }
  },
  {
    name: 'openstory_session_put',
    title: '整存会话',
    description: '用完整 session 对象覆盖一个会话（会先备份）。**会写盘**，调用需 confirm:create；日常推进优先用 turn/pending 等细粒度工具，不要把整存当补丁用。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, session: { type: 'object' } },
      required: ['root', 'session'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.session || typeof args.session !== 'object' || Array.isArray(args.session)) throw invalidArgs('session')
      return await daemon('/api/deduce/session', {
        method: 'PUT', body: cleanBody({ root, bookId: args.bookId, session: args.session })
      })
    }
  },

  /* ---------- 扮演 / 推演动作 ---------- */
  {
    name: 'openstory_roleplay_turn',
    title: '推进一回合',
    description: '推进一个扮演/推演回合：选候选 choiceId 或给自定义 customText，可 regenerate 只重写最后一拍。**会保存会话状态**，调用需 confirm:create；模型不可用返回 AGENT_NOT_CONFIGURED/上游错误，不伪造成功。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' },
        choiceId: { type: 'string' }, customText: { type: 'string' }, regenerate: { type: 'boolean' }
      },
      required: ['root'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/deduce/turn', {
        method: 'POST',
        body: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId, choiceId: args.choiceId, customText: args.customText, regenerate: args.regenerate })
      })
    }
  },
  {
    name: 'openstory_roleplay_archive',
    title: '归档一章',
    description: '把当前会话的缓存区归档成扮演/归档下的 md 文件。**会写盘**，调用需 confirm:create。返回 path/words。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' }, title: { type: 'string' } },
      required: ['root'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/deduce/archive', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId, title: args.title })
      })
    }
  },
  {
    name: 'openstory_roleplay_export',
    title: '导出会话',
    description: '把当前会话导出成扮演/导出下的 md 文件。**会写盘**，调用需 confirm:create。返回 path/words。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' }, title: { type: 'string' } },
      required: ['root'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/deduce/export', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId, title: args.title })
      })
    }
  },
  {
    name: 'openstory_roleplay_promote',
    title: '节点转正文',
    description: '把一个推演节点转成正文章节（复用章节写通道，写前备份）。**会写正文**，调用需 confirm:create；不自动 absorb、不创建待确认卡。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' }, nodeId: { type: 'string' }, title: { type: 'string' } },
      required: ['root', 'nodeId'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.nodeId !== 'string' || !args.nodeId.trim()) throw invalidArgs('nodeId')
      return await daemon('/api/deduce/promote', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId, nodeId: args.nodeId.trim(), title: args.title })
      })
    }
  },
  {
    name: 'openstory_roleplay_pending',
    title: '结算待确认卡',
    description: '结算一张**已存在**的待确认卡：write＝单条 upsert 进 fact（不整份替换），dismiss＝丢弃。**会写会话或事实链**，调用需 confirm:create；重复 pendingId 返回 NOT_FOUND。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' },
        pendingId: { type: 'string' }, action: { type: 'string', enum: ['write', 'dismiss'] }
      },
      required: ['root', 'pendingId'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.pendingId !== 'string' || !args.pendingId.trim()) throw invalidArgs('pendingId')
      return await daemon('/api/deduce/pending', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId, pendingId: args.pendingId.trim(), action: args.action })
      })
    }
  },
  {
    name: 'openstory_roleplay_branch',
    title: '从节点开分支',
    description: '从某个节点开一个新会话分支（保留全量节点与分叉溯源）。**会写会话态**，调用需 confirm:create。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' }, fromNodeId: { type: 'string' } },
      required: ['root', 'fromNodeId'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.fromNodeId !== 'string' || !args.fromNodeId.trim()) throw invalidArgs('fromNodeId')
      return await daemon('/api/deduce/branch', {
        method: 'POST', body: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId, fromNodeId: args.fromNodeId.trim() })
      })
    }
  },

  /* ---------- 素材与推演生图 ---------- */
  {
    name: 'openstory_assets',
    title: '列素材',
    description: '盘点一个事实书下的扮演素材（角色/场景/BGM），返回 characters/scenes/bgm 三个数组。目录不存在是合法空态。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' } },
      required: ['root'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      return await daemon('/api/deduce/assets', { query: cleanBody({ root, bookId: args.bookId }) })
    }
  },
  {
    name: 'openstory_asset_read',
    title: '读素材',
    description: '读一个素材本体（.png/.mp3，≤16MB）。MCP 以 base64 返回 dataUrl 与 mediaType；路径越界/盘符/异扩展名/缺档均明确拒绝。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string' }, bookId: { type: 'string' }, path: { type: 'string', description: '素材相对路径，如 角色/沈岚.png' } },
      required: ['root', 'path'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.path !== 'string' || !args.path.trim()) throw invalidArgs('path')
      const query = new URLSearchParams({ root, path: args.path.trim(), ...(args.bookId ? { bookId: args.bookId } : {}) })
      const response = await fetch(`${BASE}/api/deduce/asset?${query}`).catch((cause) => {
        const err = new Error(`DAEMON_UNREACHABLE · 素材读取失败：${cause.message}`); err.code = 'DAEMON_UNREACHABLE'; throw err
      })
      if (!response.ok) {
        const payload = await response.json().catch(() => null)
        const err = new Error(payload?.error?.message || `素材读取失败（HTTP ${response.status}）`)
        err.code = payload?.error?.code || `HTTP_${response.status}`
        throw err
      }
      const mediaType = response.headers.get('content-type') || 'application/octet-stream'
      const buffer = Buffer.from(await response.arrayBuffer())
      return {
        path: args.path.trim(), mediaType, bytes: buffer.length,
        dataUrl: `data:${mediaType};base64,${buffer.toString('base64')}`
      }
    }
  },
  {
    name: 'openstory_deduce_image',
    title: '推演生图',
    description: '为当前推演局面生成一张素材图并落到扮演/素材。**会写文件**，调用需 confirm:create；模型不可用返回 AGENT_NOT_CONFIGURED/上游错误，不伪造成功。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, bookId: { type: 'string' },
        name: { type: 'string' }, prompt: { type: 'string' },
        size: { type: 'string' }, stylePrompt: { type: 'string' }, negative: { type: 'string' }
      },
      required: ['root', 'name', 'prompt'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.name !== 'string' || !args.name.trim()) throw invalidArgs('name')
      if (typeof args.prompt !== 'string' || !args.prompt.trim()) throw invalidArgs('prompt')
      return await daemon('/api/deduce/image', {
        method: 'POST',
        body: cleanBody({ root, bookId: args.bookId, name: args.name.trim(), prompt: args.prompt.trim(), size: args.size, stylePrompt: args.stylePrompt, negative: args.negative })
      })
    }
  },

  /* ---------- OS-217 clean-room 前置原语 ---------- */
  {
    name: 'openstory_asset_put',
    title: '写入素材',
    description: '把一个 base64 编码的 PNG/MP3 素材写进 扮演/<bookId>/素材/{角色,场景,bgm}。只收对应扩展名与真实文件签名，≤16MB；默认不覆盖，overwrite:true 会先把旧档备份进 .history，并记录二进制 hash 日志。**会写文件**，调用需 confirm:create。不是任意文件写通道。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, bookId: { type: 'string' },
        path: { type: 'string', description: '素材库内相对路径，如 角色/沈岚.png' },
        dataBase64: { type: 'string', description: '素材字节的严格 base64' },
        overwrite: { type: 'boolean', description: 'true＝覆盖前备份；缺省不覆盖' }
      },
      required: ['root', 'path', 'dataBase64'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.path !== 'string' || !args.path.trim()) throw invalidArgs('path')
      if (typeof args.dataBase64 !== 'string' || !args.dataBase64.trim()) throw invalidArgs('dataBase64')
      return await daemon('/api/deduce/asset', {
        method: 'PUT',
        body: cleanBody({ root, bookId: args.bookId, path: args.path.trim(), dataBase64: args.dataBase64.trim(), overwrite: args.overwrite })
      })
    }
  },
  {
    name: 'openstory_plugins',
    title: '读插件与模块投影',
    description: '读本机/当前库的完整插件投影：plugins、modules、moduleGraph、slots、套件状态与能力报告。只读，不触发模块启停或升级。clean-room 构建后用它在 MCP 内验证模块归属与能力图。',
    inputSchema: {
      type: 'object',
      properties: { root: { type: 'string', description: '可选；带则按该库状态投影' } },
      additionalProperties: false
    },
    async run(args) {
      return await daemon('/api/plugins', { query: args.root ? { root: String(args.root).trim() } : {} })
    }
  },
  {
    name: 'openstory_roleplay_opening',
    title: '多角色扮演开场',
    description: '调用真实多角色扮演引擎生成开场（主持人＋演员，需可用模型）。会保存 roleplay 会话节点；**不是** openstory_deduce_present 的确定性推演。无模型/空回包明确失败，调用需 confirm:create。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, bookId: { type: 'string' }, pov: { type: 'string' },
        premise: { type: 'string' }, openingDetail: { type: 'string' }, chapterLimit: { type: 'integer' }
      },
      required: ['root', 'pov'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.pov !== 'string' || !args.pov.trim()) throw invalidArgs('pov')
      return await daemon('/api/roleplay/opening', {
        method: 'POST',
        body: cleanBody({ root, bookId: args.bookId, pov: args.pov.trim(), premise: args.premise, openingDetail: args.openingDetail, chapterLimit: args.chapterLimit })
      })
    }
  },
  {
    name: 'openstory_roleplay_scene_turn',
    title: '多角色扮演一回合',
    description: '调用真实多角色扮演引擎推进一回合（主持人裁决→各角色成文→收束），需要可用模型。会保存 roleplay 节点；与 openstory_roleplay_turn（/api/deduce/turn 推演）不同。无模型/空回包明确失败，调用需 confirm:create。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' }, bookId: { type: 'string' }, sessionId: { type: 'string' },
        pov: { type: 'string' }, playerAction: { type: 'string' }, premise: { type: 'string' },
        chapterLimit: { type: 'integer' }, activation: { type: 'string' }
      },
      required: ['root', 'pov', 'playerAction'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (typeof args.pov !== 'string' || !args.pov.trim()) throw invalidArgs('pov')
      if (typeof args.playerAction !== 'string' || !args.playerAction.trim()) throw invalidArgs('playerAction')
      return await daemon('/api/roleplay/turn', {
        method: 'POST',
        body: cleanBody({ root, bookId: args.bookId, sessionId: args.sessionId, pov: args.pov.trim(), playerAction: args.playerAction.trim(), premise: args.premise, chapterLimit: args.chapterLimit, activation: args.activation })
      })
    }
  },
  {
    name: 'openstory_ui_state',
    title: '写库界面状态',
    description: '合并写入一个库的 ui-state（模块开关、界面选择、排版等）。经宿主能力图事务校验并留备份；**会写状态文件**，调用需 confirm:create。不是绕过模块治理的任意状态写入口。',
    inputSchema: {
      type: 'object',
      properties: {
        root: { type: 'string' },
        state: { type: 'object', description: '要合并进 ui-state 的键值（不是整份替换）' }
      },
      required: ['root', 'state'], additionalProperties: false
    },
    async run(args) {
      const root = requireRoot(args)
      if (!args.state || typeof args.state !== 'object' || Array.isArray(args.state)) throw invalidArgs('state')
      return await daemon('/api/ui-state', { method: 'PUT', body: { root, state: args.state } })
    }
  }
]

/* ---------- 小工具 ---------- */

function invalidArgs(what) {
  const err = new Error(`缺少或非法参数：${what}`)
  err.code = 'E_INVALID_ARGS'
  return err
}

/** JSON Schema 子集：required、type、enum、additionalProperties。 */
function validateToolArgs(schema, args) {
  if (!schema || schema.type !== 'object') return []
  if (!args || typeof args !== 'object' || Array.isArray(args)) return ['arguments 必须是对象']
  const errors = []
  const valueMissing = (value) => value === undefined || value === null || value === ''
  for (const key of schema.required ?? []) if (valueMissing(args[key])) errors.push(`缺少必填参数：${key}`)
  const properties = schema.properties ?? {}
  for (const [key, spec] of Object.entries(properties)) {
    const value = args[key]
    if (value === undefined || value === null) continue
    const type = spec?.type ?? spec
    const ok = type === 'integer' ? Number.isSafeInteger(value)
      : type === 'number' ? (typeof value === 'number' && Number.isFinite(value))
      : type === 'boolean' ? typeof value === 'boolean'
      : type === 'string' ? typeof value === 'string'
      : type === 'array' ? Array.isArray(value)
      : type === 'object' ? (value && typeof value === 'object' && !Array.isArray(value))
      : true
    if (!ok) errors.push(`${key} 必须是 ${type}`)
    if (Array.isArray(spec?.enum) && !spec.enum.includes(value)) errors.push(`${key} 必须是 ${spec.enum.join('/')}`)
  }
  if (schema.additionalProperties === false) {
    for (const key of Object.keys(args)) if (!(key in properties)) errors.push(`未知参数：${key}`)
  }
  return errors
}

/** 去掉 undefined/空串的 body（deduce 的可选参数都不污染请求）。 */
function cleanBody(args) {
  const body = {}
  for (const [key, value] of Object.entries(args || {})) {
    if (value !== undefined && value !== null && value !== '') body[key] = value
  }
  return body
}

/** OS-212：confirm 参数声明挂到每个工具的 inputSchema.properties——写工具调用可带
 * 作者确认级别，不再被 additionalProperties:false 的 -32602 打挂；enum 取自单一注册表，
 * 不在 mcp.mjs 手抄第二份。deduce_present 已经声明过同名字段，赋值同一份即可。 */
const CONFIRM_SCHEMA = { type: 'string', enum: [...TOOL_CONFIRM_LEVELS], description: `作者确认级别（${TOOL_CONFIRM_LEVELS.join('/')}）；写工具按注册表门槛要求，读工具可省略` }
for (const tool of tools) tool.inputSchema.properties[CONFIRM_PARAM] = CONFIRM_SCHEMA

const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))

/** OS-212：对外工具名注册表（只读快照）——operate skill 的 tools 声明必须来自这里。
 * 门禁/测试拿它做白名单，避免说明书声明不存在的工具或伪装成 MCP 工具的 shell/fs 直写。 */
export const MCP_TOOL_NAMES = Object.freeze(tools.map((tool) => tool.name))

/** OS-212：MCP 工具表 ↔ 安全语义注册表双向校验——fail-closed。
 * 工具多一个没分类、注册表多一个假工具、或语义形状坏，都让 MCP 进程启动失败，
 * 不允许 operate 说明书引用一个不存在/未分类的工具，也不允许 shell/fs 伪装混进来。 */
const SEMANTICS_CHECK = validateSemanticsRegistry(tools)
if (!SEMANTICS_CHECK.ok) {
  throw new Error(`MCP 工具语义注册表失配（OS-212 fail-closed）：missing=${JSON.stringify(SEMANTICS_CHECK.missing)} extra=${JSON.stringify(SEMANTICS_CHECK.extra)} malformed=${JSON.stringify(SEMANTICS_CHECK.malformed)} paramMismatch=${JSON.stringify(SEMANTICS_CHECK.paramMismatch)}`)
}
/** 供门禁/测试核对的校验结果（只读）。 */
export const MCP_SEMANTICS_CHECK = Object.freeze({ ...SEMANTICS_CHECK })

/** 工具列表的 MCP 形状（inputSchema 原样透出）。 */
function toolsForList() {
  return tools.map((tool) => ({
    name: tool.name,
    title: tool.title,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}

/** 调一个工具：业务错误 → isError:true 文本（不是 -32602）。 */
async function callTool(name, args) {
  const tool = toolsByName.get(name)
  if (!tool) {
    const err = new Error(`未知工具：${name}（tools/list 看可用清单）`)
    err.code = 'E_UNKNOWN_TOOL'
    throw err
  }
  try {
    // OS-212/213：确认闸——所需级别来自 mcpToolSemantics 单一注册表。
    // · 无条件写工具（create/write/delete/reset）**每次调用都要求**满足门槛的 confirm：
    //   调用它本身就是触发写，不存在「这次不写」的分支，缺 confirm 即 fail-closed 拒绝。
    // · 条件写工具（注册表声明 effect:'read' + mutatesWhen）：只在参数命中升级时要求 confirm，
    //   未命中时按读放行——这是工单「不触发写时放行」的唯一适用情形。
    // · 所有工具都接受 confirm 实参，照声明传参不再被 additionalProperties 的 -32602 打挂。
    const callArgs = args || {}
    const base = toolSemanticsOf(name)
    const effective = semanticsForCall(name, callArgs)
    const needed = effective?.requiredConfirm
    const actual = callArgs[CONFIRM_PARAM]
    const upgraded = Boolean(base && effective && (effective.requiredConfirm !== base.requiredConfirm || effective.effect !== base.effect))
    const isUnconditionalWrite = Boolean(base && base.effect !== 'read')
    const requiresConfirm = Boolean(needed) && (isUnconditionalWrite || upgraded)
    if (requiresConfirm && !confirmSatisfies(String(actual ?? 'read'), needed)) {
      const rule = base?.mutatesWhen
      const err = new Error(upgraded && !isUnconditionalWrite
        ? `该调用触发条件写语义（${rule?.parameter ?? '参数'}=${String(rule?.equals)}），需 ${needed} 确认：${name}`
        : `该工具是写工具（${effective?.effect ?? base?.effect}），必须带 ${needed} 级 confirm 才执行：${name}`)
      err.code = 'CONFIRM_REQUIRED'
      throw err
    }
    // confirm 不是业务参数，不转发给 daemon。
    const forwarded = callArgs[CONFIRM_PARAM] === undefined ? callArgs : Object.fromEntries(Object.entries(callArgs).filter(([key]) => key !== CONFIRM_PARAM))
    const result = await tool.run(forwarded)
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false }
  } catch (error) {
    const code = error.code || 'E_TOOL_FAILED'
    return { content: [{ type: 'text', text: `${code} · ${error.message}` }], isError: true }
  }
}

/* ---------- stdio JSON-RPC 2.0 ---------- */

const SERVER_INFO = { name: 'openstory-local', version: '0.1.0' }
const INSTRUCTIONS = [
  'OpenStory 本地 MCP：小说（正文/剧本读写，写有 .history 备份）/ 世界书（Obsidian 式标签双链笔记，定位＝本项目的创作型条目管理知识库）/ 建库与套件 / fact 与 exchange / 多局与推演 / 数据分析。',
  '先 openstory_libraries 拿 root；空目录用 openstory_library_create；读自由，写有备份，absorb 不开（显式动稿）。',
  '世界书只单向链小说：世界书可 [[正文/...]]，正文不要回挂世界书。',
  '技能货架用 openstory_skills_list/read 按需读取：craft 可注入 prompt；operate 是只读操作说明书，不注入、不执行代码，写操作只准调用其声明的官方 MCP 工具并按 confirm 级别经作者确认。',
  '从空目录建项目先 openstory_skills_read {name:"build-project"}：它是基于当前 tools/list 的官方构建说明书，含 60 工具速查表、写红线、幂等与失败恢复。',
  '升级/迁移既有项目先 openstory_skills_read {name:"update-project"}：只读诊断→计划→作者确认→apply→状态/备份核对；只声明升级五工具，apply 需 confirm:"migrate"，禁止 shell/fs 改稿、跳过确认或自动降级。',
  '模块级使用说明见仓 docs/mcp/*.md；工具参数、确认与错误语义以 tools/list 为准。'
].join('\n')

/* OS-140 布局归一：stdio 通道装配＋就绪 banner 收成可导出的 main(argv)——本文件即入口
 * （OS-159 起仓根零垫片），文件尾 isMain 走到这里；被纯 import 时只装载工具表，
 * 不挂 stdio、不写 banner（测试/工具面不起服务）。 */
export function main(_argv = []) {
  let buffer = ''
  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk) => {
    buffer += chunk
    let index
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim()
      buffer = buffer.slice(index + 1)
      if (line) handleMessage(line)
    }
  })
  process.stdin.on('end', () => process.exit(0))
  // banner 走 stderr——stdout 是协议通道，一个字都不能混
  process.stderr.write(`OpenStory MCP → stdio 已就绪（daemon: ${BASE}，工具 ${tools.length} 个）\n`)
}

function handleMessage(line) {
  let message
  try { message = JSON.parse(line) } catch {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
    return
  }
  if (message.jsonrpc !== '2.0') return
  const { id, method, params } = message
  // 通知（无 id）不回包
  if (id === undefined || id === null) return

  try {
    switch (method) {
      case 'initialize':
        send({
          jsonrpc: '2.0', id,
          result: {
            protocolVersion: params?.protocolVersion || '2024-11-05',
            capabilities: { tools: { listChanged: false } },
            serverInfo: SERVER_INFO,
            instructions: INSTRUCTIONS
          }
        })
        return
      case 'notifications/initialized':
        return
      case 'ping':
        send({ jsonrpc: '2.0', id, result: {} })
        return
      case 'tools/list':
        send({ jsonrpc: '2.0', id, result: { tools: toolsForList() } })
        return
      case 'tools/call': {
        const name = String(params?.name || '')
        if (!toolsByName.has(name)) {
          send({ jsonrpc: '2.0', id, error: { code: -32601, message: `未知工具：${name}` } })
          return
        }
        // 参数形状校验：required/type/enum/additionalProperties 全部在协议层拒绝。
        const schema = toolsByName.get(name).inputSchema
        const argErrors = validateToolArgs(schema, params?.arguments)
        if (argErrors.length) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: argErrors.join('；') } })
          return
        }
        callTool(name, params?.arguments).then((result) => send({ jsonrpc: '2.0', id, result }))
        return
      }
      default:
        send({ jsonrpc: '2.0', id, error: { code: -32601, message: `方法不存在：${method}` } })
    }
  } catch (error) {
    send({ jsonrpc: '2.0', id, error: { code: -32603, message: error.message || 'Internal error' } })
  }
}

function send(message) {
  process.stdout.write(JSON.stringify(message) + '\n')
}

/* 直跑判定（OS-140）：node 直接执行本文件时走 main（OS-159 起这是唯一 MCP 入口）。 */
const isMain = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false

if (isMain) main(process.argv.slice(2))
