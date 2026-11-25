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
      const payload = await daemon('/api/chapter', { method: 'PUT', body: { root, file: args.file, text: args.text } })
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
        reset: { type: 'boolean', description: '重置推演状态' }
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
      const { KERNEL_CAPABILITIES } = await import('../protocol/capabilityImplementations.mjs')
      const { analyzeChapter } = KERNEL_CAPABILITIES.textAnalyze
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
    description: '列出本机技能货架的**全部手艺配方**（31 个：技法/审阅/改写/抽取四类，含文风包）。返回 name/description/category/genres/stage/version/vendor。开工前先看清单，再用 openstory_skills_read 读全文——选技能靠 description，别凭名字猜。可按体裁过滤。',
    inputSchema: {
      type: 'object',
      properties: {
        genre: { type: 'string', description: '体裁 id（如 long-serial / short-story / screenplay）；不传＝全部' },
        category: { type: 'string', enum: ['craft', 'review', 'transform', 'extract'], description: '只列某一类' }
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
    description: '读一个技能的 SKILL.md 全文（含 frontmatter 之外的正文、附属 tools/output 声明）。这是「怎么做事」的真源——craft 类是技法规则可直接遵循，review 类只出问题清单不改文件，transform 类产提案，extract 类产数据。**动手前先读这一篇，别只凭 description 发挥**。',
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
  }
]

/* ---------- 小工具 ---------- */

function invalidArgs(what) {
  const err = new Error(`缺少或非法参数：${what}`)
  err.code = 'E_INVALID_ARGS'
  return err
}

/** 去掉 undefined/空串的 body（deduce 的可选参数都不污染请求）。 */
function cleanBody(args) {
  const body = {}
  for (const [key, value] of Object.entries(args || {})) {
    if (value !== undefined && value !== null && value !== '') body[key] = value
  }
  return body
}

const toolsByName = new Map(tools.map((tool) => [tool.name, tool]))

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
    const result = await tool.run(args || {})
    return { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }], isError: false }
  } catch (error) {
    const code = error.code || 'E_TOOL_FAILED'
    return { content: [{ type: 'text', text: `${code} · ${error.message}` }], isError: true }
  }
}

/* ---------- stdio JSON-RPC 2.0 ---------- */

const SERVER_INFO = { name: 'openstory-local', version: '0.1.0' }
const INSTRUCTIONS = [
  'OpenStory 本地 MCP：小说（正文读写，写有 .history 备份）/ 世界书（Obsidian 式标签双链笔记，定位＝本项目的创作型条目管理知识库）/',
  '推演（种子化 2d6 拍循环＋enrich 富化）／数据分析（本地引擎，秒回）四模块。',
  '先 openstory_libraries 拿 root；读自由，写有备份；absorb 不开（显式动稿）。',
  '世界书只单向链小说：世界书可 [[正文/...]]，正文不要回挂世界书。',
  '模块级使用说明见仓 docs/mcp/*.md（novel / reference / deduce / analysis）。'
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
        // 参数形状校验：required 缺失 → -32602（沿用历史协议口径）
        const schema = toolsByName.get(name).inputSchema
        const missing = (schema?.required || []).filter((key) => {
          const value = params?.arguments?.[key]
          return value === undefined || value === null || value === ''
        })
        if (missing.length) {
          send({ jsonrpc: '2.0', id, error: { code: -32602, message: `缺少必填参数：${missing.join(', ')}` } })
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
