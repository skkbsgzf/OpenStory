/**
 * 新建项目验证（OS-107 第三项）：从零新建 / 半成品导入，确认都不出问题。
 * 全程临时目录，不碰作者真库；结束从库清单摘除测试库。
 *
 * 关键认知：daemon 三条硬边界——root 必须命中库清单（next-preferences.json 的
 * recentProjects）或 --root= 授权。所以「半成品库」也必须先走 libraryCreate 登记，
 * 再往里塞不规整文件——这才是真实用户路径（导入稿件 / 新建库都会登记）。
 */
import { mkdtemp, mkdir, writeFile, rm, readFile, writeFile as wf } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const BASE = 'http://127.0.0.1:8807'
const post = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const get = async (p) => {
  const r = await fetch(BASE + p)
  return { status: r.status, data: await r.json().catch(() => null) }
}
const put = async (p, body) => {
  const r = await fetch(BASE + p, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, data: await r.json().catch(() => null) }
}
const enc = encodeURIComponent
const results = []
const check = (n, ok, d) => { results.push({ n, ok, d }); console.log(`${ok ? '✓' : '✗'} ${n}${d ? ' — ' + d : ''}`) }

const base = await mkdtemp(join(tmpdir(), 'openstory-newproj-'))
const created = []

try {
  // ── A. 从零新建 ──
  console.log('=== A. 从零新建 ===')
  const rootA = join(base, '零起点库')
  await mkdir(rootA, { recursive: true })
  const createA = await post('/api/library/create', { path: rootA, name: '零起点库', primaryCarrier: 'pinax.carrier.novel' })
  created.push(rootA)
  check('A1 新建库（自动登记）', createA.data?.ok, createA.data?.ok ? 'ok' : (createA.data?.error?.message || '失败'))

  const chA = await post('/api/chapters', { root: rootA, dir: '正文', title: '第一章' })
  check('A2 建第一章', chA.data?.ok, chA.data?.chapter?.file || chA.data?.error?.message)

  if (chA.data?.ok) {
    const w = await put('/api/chapter', { root: rootA, file: chA.data.chapter.file, text: '# 第一章\n\n他睁开眼，屋里有股旧木头味。' })
    check('A3 写正文', w.data?.ok, w.data?.ok ? 'ok' : w.data?.error?.message)
  }

  await mkdir(join(rootA, '参考', '人物'), { recursive: true })
  await writeFile(join(rootA, '参考', '人物', '主角.md'), '---\ntags: [人物]\ntitle: 主角\nfirstChapter: 1\n---\n\n# 主角\n\n一个刚醒来的男人。\n', 'utf-8')
  const refA = await get('/api/reference?root=' + enc(rootA))
  check('A4 世界书笔记可读', refA.data?.ok && (refA.data.notes || []).length === 1, `${refA.data?.notes?.length ?? 0} 篇 · fc=${refA.data?.notes?.[0]?.firstChapter}`)

  const entriesA = await get('/api/fact/entries?root=' + enc(rootA))
  check('A5 无拆解时事实条目有明确响应', entriesA.data?.ok !== undefined, entriesA.data?.ok ? '空清单' : `明确报 ${entriesA.data?.error?.code}`)
  const curveA = await get('/api/fact/curve?root=' + enc(rootA))
  check('A6 无拆解时曲线优雅', curveA.data?.ok !== undefined, curveA.data?.ok ? 'ok' : curveA.data?.error?.code)
  const graphA = await get('/api/reference/graph?root=' + enc(rootA))
  check('A7 图谱不炸', graphA.status === 200 && graphA.data?.ok, `${graphA.data?.nodes?.length ?? 0} 节点`)
  const sessionsA = await get('/api/deduce/sessions?root=' + enc(rootA))
  check('A8 空库会话清单', sessionsA.data?.ok, `${sessionsA.data?.sessions?.length ?? 0} 局`)

  // ── B. 半成品（先登记，再塞不规整文件）──
  console.log('\n=== B. 半成品（登记后塞不规整文件）===')
  const rootB = join(base, '半成品库')
  await mkdir(rootB, { recursive: true })
  const createB = await post('/api/library/create', { path: rootB, name: '半成品库', primaryCarrier: 'pinax.carrier.novel' })
  created.push(rootB)
  check('B0 半成品库登记', createB.data?.ok, createB.data?.ok ? 'ok' : (createB.data?.error?.message || '失败'))

  await mkdir(join(rootB, '正文'), { recursive: true })
  await writeFile(join(rootB, '正文', '001-无元数据章.md'), '纯文本，没有任何 frontmatter 和标题层级。\n\n第二段。', 'utf-8')
  await mkdir(join(rootB, '参考'), { recursive: true })
  await writeFile(join(rootB, '参考', '裸笔记.md'), '没有 frontmatter 的笔记。\n\n带 #标签 和 [[裸笔记]]。', 'utf-8')

  const chaptersB = await get('/api/chapters?root=' + enc(rootB) + '&dir=' + enc('正文'))
  check('B1 无 frontmatter 章节可解析', chaptersB.data?.ok && (chaptersB.data.chapters || []).length === 1, `${chaptersB.data?.chapters?.[0]?.file ?? '无'}`)
  const refB = await get('/api/reference?root=' + enc(rootB))
  check('B2 裸笔记可索引', refB.data?.ok && (refB.data.notes || []).length === 1, `${refB.data?.notes?.length ?? 0} 篇 · 标签 ${refB.data?.tags?.length ?? 0}`)
  const graphB = await get('/api/reference/graph?root=' + enc(rootB))
  check('B3 半成品图谱不炸', graphB.status === 200 && graphB.data?.ok, `${graphB.data?.nodes?.length ?? 0} 节点`)

  const openingB = await post('/api/roleplay/opening', { root: rootB, pov: '主角' })
  check('B4 无拆解库扮演明确报错', openingB.data?.ok === false && !!openingB.data?.error?.code, openingB.data?.error?.code || '（意外成功）')

  console.log('\n=== 汇总 ===')
  const ok = results.filter((r) => r.ok).length
  console.log(`${ok}/${results.length} 通过`)
  results.filter((r) => !r.ok).forEach((r) => console.log('  ✗ ' + r.n + ' — ' + r.d))
} finally {
  try {
    const prefsPath = process.env.LOCALAPPDATA + '/PinaxNext/next-preferences.json'
    const prefs = JSON.parse(await readFile(prefsPath, 'utf-8'))
    const before = (prefs.recentProjects || []).length
    prefs.recentProjects = (prefs.recentProjects || []).filter((p) => !created.some((c) => p.path === c))
    await wf(prefsPath, JSON.stringify(prefs, null, 2), 'utf-8')
    console.log(`\n（已从库清单摘除 ${before - prefs.recentProjects.length} 个测试库）`)
  } catch (e) { console.log('\n（摘除失败）', e.message) }
  await rm(base, { recursive: true, force: true })
  console.log('（临时目录已清理）')
}
