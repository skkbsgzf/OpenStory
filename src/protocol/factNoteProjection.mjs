/**
 * 事实链条目 → 世界书笔记 投影（D6b，纯函数）。
 *
 * 为什么是纯函数：笔记的「内容形状」（frontmatter、层级目录、双链、分节）是可测的
 * 确定性规则，不该藏在 handler 的 I/O 里。handler 只负责读 fact、调这里、落盘。
 *
 * 映射口径（与现有世界书笔记的写法对齐）：
 *   · 层 → 目录：character→人物 / plot→事件 / worldview→设定
 *   · 标题取条目 name；frontmatter tags 带层名与 domain
 *   · 正文分节：定义/事实 → 「概述」，events → 「事件流」，castRole → 「剧情作用」
 *   · 双链：只对同库里出现过的其它条目名做 `[[名字]]`，不臆造指向
 */

const LAYER_DIR = Object.freeze({
  character: '人物',
  plot: '事件',
  worldview: '设定'
})

const LAYER_LABEL = Object.freeze({
  character: '人物',
  plot: '事件',
  worldview: '设定'
})

/** 文件名安全化：去掉路径分隔符与 Windows 保留字符，保留中文。 */
export function safeNoteName(name) {
  return String(name ?? '')
    .replace(/[\\/:*?"<>|]/gu, '')
    .replace(/^\.+/u, '')
    .trim()
    .slice(0, 80)
}

function line(value) {
  return String(value ?? '').trim()
}

/** 收集可做双链的条目名集合（排除自身），用于正文里自动挂链。 */
function linkable(names, self) {
  return (value) => line(value).replace(new RegExp(names.filter((n) => n && n !== self).sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')).join('|') || '\u0000', 'gu'), (hit) => `[[${hit}]]`)
}

/**
 * 单条 fact → 一篇笔记。
 * @returns {{ref:string, title:string, text:string, layer:string}}
 */
export function factEntryToNote(entry, context = {}) {
  const name = line(entry?.name) || '未命名'
  const layer = line(entry?.layer) || 'worldview'
  const dir = LAYER_DIR[layer] || '设定'
  const names = Array.isArray(context.names) ? context.names : []
  const link = linkable(names, name)

  const tags = [LAYER_LABEL[layer] || dir]
  if (line(entry?.domain)) tags.push(line(entry.domain))
  if (layer === 'character' && line(entry?.identity)) tags.push('身份')

  const sections = []
  const summary = line(entry?.definition) || line(entry?.fact) || ''
  if (summary) sections.push(`## 概述\n\n${link(summary)}`)

  // character：身份 / 目标 / 剧情作用
  if (layer === 'character') {
    const identity = line(entry?.identity)
    const goal = line(entry?.castRole?.goal)
    const fn = line(entry?.castRole?.plotFunction)
    if (identity) sections.push(`## 身份\n\n${link(identity)}`)
    if (goal || fn) {
      const rows = [goal ? `- 目标：${link(goal)}` : '', fn ? `- 剧情作用：${link(fn)}` : ''].filter(Boolean).join('\n')
      sections.push(`## 剧情作用\n\n${rows}`)
    }
  }

  // plot：事件流
  const events = Array.isArray(entry?.events) ? entry.events : []
  if (events.length) {
    const rows = events.map((event) => {
      const who = line(event?.who)
      const content = line(event?.content)
      return `- ${who ? `${who}：` : ''}${link(content)}`
    }).join('\n')
    sections.push(`## 事件流\n\n${rows}`)
  }

  // 出处：回目
  const chapters = Array.isArray(entry?.provenance?.chapters) ? entry.provenance.chapters : []
  if (chapters.length) sections.push(`## 出处\n\n第 ${chapters.join('、')} 回`)

  const fm = `---\ntags: [${tags.join(', ')}]\ntitle: ${name}\n---\n`
  const body = `# ${name}\n\n${sections.join('\n\n')}\n`
  return { ref: `世界书/${dir}/${safeNoteName(name)}.md`, title: name, layer, text: `${fm}${body}` }
}

/**
 * 整份 fact 数据集 → 笔记计划（纯函数，不碰磁盘）。
 * @param {{entries:array}} dataset
 * @param {{layers?:string[]}} options
 */
export function planNotesFromFact(dataset, options = {}) {
  const entries = Array.isArray(dataset?.entries) ? dataset.entries : []
  const wanted = Array.isArray(options.layers) && options.layers.length ? new Set(options.layers.map(String)) : null
  const names = entries.map((entry) => line(entry?.name)).filter(Boolean)
  const planned = []
  const seen = new Set()
  for (const entry of entries) {
    const layer = line(entry?.layer)
    if (wanted && !wanted.has(layer)) continue
    if (!LAYER_DIR[layer]) continue
    const note = factEntryToNote(entry, { names })
    // 同名条目（不同层）会撞同一个文件名：后者加层后缀，绝不静默覆盖。
    let ref = note.ref
    if (seen.has(ref)) {
      ref = ref.replace(/\.md$/u, `-${LAYER_LABEL[layer] || layer}.md`)
      if (seen.has(ref)) continue
    }
    seen.add(ref)
    planned.push({ ...note, ref })
  }
  return planned
}
