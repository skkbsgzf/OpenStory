/**
 * 番茄头部书下载驱动（蒸馏流水线第②步·扩采口）。
 *
 * 走 Tomato-Novel-Downloader 的 Web API（--server 模式，默认 http://127.0.0.1:18423）：
 *   /api/preview/:book_id 验书 → POST /api/jobs 建下载（串行，一次一个活跃 job）→ GET /api/jobs 轮询。
 *
 * 用法：
 *   node tools/distill/fanqie-fetch.mjs --ids 7231424472606051384,7616151491132279832 [--range-end 300] [--server http://127.0.0.1:18423]
 *   书单 id 从榜单缓存圈（D:\\私人语料库\\cache\\fanqie_read_*_.json——标题有字体混淆不可信，id 可靠）。
 *   产物落在下载器 save_dir（novel_format: txt）。
 */
import { appendFileSync } from 'node:fs'

const args = process.argv.slice(2)
const argOf = (name, fallback = '') => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const SERVER = argOf('--server', 'http://127.0.0.1:18423')
const RANGE_END = Number(argOf('--range-end', '0')) || 0 // 0＝全量
const LOG = argOf('--log', '')
const IDS = argOf('--ids', '').split(',').map((s) => s.trim()).filter(Boolean)
if (!IDS.length) {
  console.error('用法：node fanqie-fetch.mjs --ids <book_id[,book_id…]> [--range-end 300] [--server url] [--log path]')
  process.exit(1)
}

const log = (msg) => {
  const line = `[${new Date().toISOString().slice(11, 19)}] ${msg}`
  console.log(line)
  if (LOG) appendFileSync(LOG, line + '\n', 'utf-8')
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

for (const id of IDS) {
  const pv = await (await fetch(`${SERVER}/api/preview/${id}`)).json()
  const title = pv.title ?? pv.book_name ?? pv.raw?.book_name ?? '?'
  const total = pv.chapters?.length ?? pv.raw?.chapter_count ?? pv.total_chapters ?? 0
  log(`预览 ${id}: 《${title}》 总章数 ${total}`)

  const body = { book_id: id }
  const end = RANGE_END > 0 && total > 0 ? Math.min(RANGE_END, total) : undefined
  if (end) { body.range_start = 1; body.range_end = end }
  const cr = await fetch(`${SERVER}/api/jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!cr.ok) {
    log(`建 job 失败 ${id}: ${cr.status} ${await cr.text()}`)
    continue
  }
  const job = await cr.json()
  log(`job ${job.id} 已建：章节 1-${end ?? '全部'}`)

  for (let i = 0; i < 240; i++) {
    await sleep(15000)
    const jobs = await (await fetch(`${SERVER}/api/jobs`)).json()
    const mine = (jobs.items ?? []).find((x) => x.id === job.id)
    const state = String(mine?.state ?? mine?.status ?? '?').toLowerCase()
    if (['done', 'completed', 'success', 'finished'].includes(state)) { log(`✓ 完成 ${id}`); break }
    if (['failed', 'error'].includes(state)) { log(`✗ 失败 ${id}: ${JSON.stringify(mine).slice(0, 200)}`); break }
    if (i % 4 === 0) log(`  ${id} state=${state} ${mine?.progress?.saved_chapters ?? ''}/${mine?.progress?.chapter_total ?? ''}`)
  }
}
log('全部队列走完')
