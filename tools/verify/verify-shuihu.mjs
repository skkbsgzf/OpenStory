/**
 * 水浒传第一章全链路验证（OS-107 第二项）：
 * 每项产物读一遍，确认转换关系在真实数据上真的通。
 */
const BASE = process.env.OPENSTORY_BASE || 'http://127.0.0.1:8807'
const ROOT = process.env.OPENSTORY_ROOT || ''
if (!ROOT) {
  console.error('请用 OPENSTORY_ROOT 指向临时水浒夹具库；本脚本会写扮演会话，绝不直接写仓库样例或作者真库。')
  process.exit(2)
}

const get = async (p) => {
  const r = await fetch(BASE + p)
  return { status: r.status, data: await r.json().catch(() => null) }
}
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => null) }
}

const results = []
const check = (name, ok, detail) => { results.push({ name, ok, detail }); console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ' — ' + detail : ''}`) }
const enc = encodeURIComponent

console.log('=== 水浒传第一章全链路验证 ===\n')

// ① 正文第一章
const chapters = await get('/api/chapters?root=' + enc(ROOT) + '&dir=' + enc('正文'))
const first = chapters.data?.chapters?.[0]
check('① 正文章节清单', chapters.data?.ok && !!first, first ? `${first.file}（${first.chars} 字）` : '无章节')

// ② 故事源条目（fact）
const entries = await get('/api/fact/entries?root=' + enc(ROOT))
check('② 故事源事实条目', entries.data?.ok && entries.data.total > 0, `${entries.data?.total} 条 · ${JSON.stringify(entries.data?.layers)}`)

// ③ 世界书笔记
const ref = await get('/api/reference?root=' + enc(ROOT))
check('③ 世界书笔记', ref.data?.ok && ref.data.notes.length > 0, `${ref.data?.notes?.length} 篇 · ${ref.data?.tags?.length} 标签 · ${ref.data?.stats?.links} 链接`)

// ④ 世界书图谱（笔记＋词条）
const graph = await get('/api/reference/graph?root=' + enc(ROOT))
const graphKinds = (graph.data?.nodes || []).reduce((acc, n) => { acc[n.kind] = (acc[n.kind] || 0) + 1; return acc }, {})
check('④ 关系图谱', graph.data?.ok && graph.data.nodes.length > 0, `${graph.data?.nodes?.length} 节点 ${graph.data?.edges?.length} 边 · ${JSON.stringify(graphKinds)}`)

// ⑤ 故事源三形态
const curve = await get('/api/fact/curve?root=' + enc(ROOT))
check('⑤ 故事源·章纲数据', curve.data?.ok, `${curve.data?.chapters?.length} 章 · ${curve.data?.foreshadows?.length ?? 0} 伏笔`)

// ⑥ 剧本
const files = await get('/api/files?root=' + enc(ROOT) + '&dir=' + enc('剧本'))
check('⑥ 剧本目录可读', files.data?.ok, `${(files.data?.files || []).length} 个剧本文件（小说样板允许为空）`)

// ⑦ 扮演会话
const sessions = await get('/api/deduce/sessions?root=' + enc(ROOT))
check('⑦ 扮演会话', sessions.data?.ok, `activeId=${sessions.data?.activeId} · ${sessions.data?.sessions?.length ?? 0} 局`)

// ⑧ 扮演开场（真调一次，验证 fact→扮演 底座）
console.log('\n--- ⑧ 扮演开场实测（可能要 10s）---')
const opening = await post('/api/roleplay/opening', {
  root: ROOT,
  pov: (entries.data?.entries || []).find((e) => e.layer === 'character')?.name || '洪信',
  openingDetail: '第一回 张天师祈禳瘟疫'
})
check('⑧ 扮演开场（fact→扮演底座）', opening.data?.ok && (opening.data?.feedback || '').length > 50,
  opening.data?.ok ? `${opening.data.feedback.length} 字 · ${opening.data.options?.length ?? 0} 分支` : (opening.data?.error?.message || '失败'))

// ⑨ firstChapter 过滤（世界书按章筛）
const fc1 = await get('/api/reference?root=' + enc(ROOT) + '&currentChapter=1')
check('⑨ firstChapter 过滤', fc1.data?.ok, `第1章视角可见 ${fc1.data?.notes?.length} / ${ref.data?.notes?.length} 篇`)

// ⑩ 台账/日志
const log = await get('/api/log?root=' + enc(ROOT))
check('⑩ 变更日志', log.status === 200, log.data?.ok === false ? '（端点存在但无记录）' : 'ok')

console.log('\n=== 汇总 ===')
const ok = results.filter((r) => r.ok).length
console.log(`${ok}/${results.length} 通过`)
const failed = results.filter((r) => !r.ok)
if (failed.length) { console.log('失败项：'); failed.forEach((f) => console.log('  ✗ ' + f.name + ' — ' + f.detail)) }
process.exitCode = failed.length ? 1 : 0
