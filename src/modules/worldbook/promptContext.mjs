/**
 * worldbook → Agent 上下文的钩子实现（OS-45/96，OS-195a 从 services/systemPrompt.mjs 归位）。
 *
 * 作者口径逐字保留：世界书索引**只暴露链接清单，不塞全文**。把世界书全量丢进上下文
 * 会污染判断——模型会在几十篇笔记里迷路；要读就让它按路径自己读。
 *
 * 由 worldbook 的 activate() 作为 promptContext 钩子贡献给宿主；模块停用＝不注入。
 */
import { buildReferenceGraph, notesVisibleAt, scanReferences } from './referenceStore.mjs'

export async function worldbookPromptSection(root, { canReadFiles = false, factStore, prose } = {}) {
  if (!canReadFiles) return null
  const index = await scanReferences(root)
  // OS-96：按当前章强制过滤——firstChapter>当前章的词条不进索引（写得再好也是剧透）。
  let currentChapter = 0
  try {
    const listing = await prose.listChapters(root, '正文')
    if (listing.ok) currentChapter = (listing.chapters || []).reduce((max, ch) => Math.max(max, Number(ch?.no) || 0), 0)
  } catch { /* 无正文＝0 */ }
  const allNotes = (Array.isArray(index.notes) ? index.notes : []).filter((note) => !note.isTagNote)
  const notes = notesVisibleAt(allNotes, currentChapter)
  const hiddenCount = allNotes.length - notes.length
  if (!notes.length) return null

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
  const applied = {
    referenceGraph: {
      pairs: [...refsByArtifact.entries()].slice(0, 40).map(([artifact, refs]) => ({ artifact, refs: refs.slice(0, 12) }))
    },
    referenceCount: notes.length
  }
  // 严格口径（OS-45）：**只给路径 + 标题 + 标签**，一个字的正文都不给。
  // 摘要看着无害，实际上会把「判断依据」提前塞进上下文——模型会拿摘要当结论，
  // 而不是真去读原文。要读就让它读。
  const noteLines = notes.slice(0, 60).map((note) => {
    const tags = note.tags.length ? `（${note.tags.map((tag) => `#${tag}`).join(' ')}）` : ''
    return `- ${note.path} ｜「${note.title}」${tags}`
  })
  const linked = [...refsByArtifact.entries()].slice(0, 20)
    .map(([artifact, refs]) => `- ${artifact} ← ${refs.join('、')}`)
  const lines = [
    '',
    '【世界书索引】',
    `这个库有一套世界书（作者的设定、素材、想法）。下面是**索引，不是全文**：${hiddenCount > 0 ? `（已按当前进度第 ${currentChapter} 章过滤——${hiddenCount} 条「首次出现」在更后面的词条没有列出，那些是未来才成立的知识，不要提前使用）` : ''}`,
    ...noteLines,
    notes.length > 60 ? `（还有 ${notes.length - 60} 篇没列出）` : '',
    ...(linked.length ? ['', '【世界书与章节的关联】', ...linked] : []),
    '',
    '规矩：',
    '- 需要某篇的具体内容时，**用你的文件读取工具按上面的路径去读**（都在 cwd 下），不要凭空猜。',
    '- 不要一次读一堆世界书；先按标题、标签和上面的关联关系判断哪些相关，再读那几篇。',
    '- 世界书是作者的私有笔记，只能读，不要改（改正文要走待确认卡，世界书也不在你的写权限里）。'
  ]
  return { lines, applied }
}
