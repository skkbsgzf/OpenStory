/* 全局后台任务中心（OS-80）
 *
 * 作者口径：「如果有生成任务，应该在全局范围内有一个类似后台任务中心/进度中心的悬浮球，
 * 并且这个任务中心应该由全局范围内所有的插件共用」。
 *
 * 设计：
 *   · 单一进程内注册表（Map）——任务不跨 daemon 重启存活，这是有意的：
 *     重启后任务已知失效，不该留下「幽灵进度条」。
 *   · 每个任务一条记录：{ id, kind, label, root, state, progress[], result, error, startedAt, endedAt }
 *     kind    谁提交的（image / vision / enrich / screenplay-import / …），用于前端分组与图标
 *     label   人话标题（「生成设定图：李逵」），不是 id
 *     state   queued | running | done | failed | cancelled
 *     progress  [{ at, message }] 逐条追加，前端按序显示
 *     result  完成时的产物（路径/id 等），失败时为 null
 *   · 任务执行器由调用方给（async 函数，收 (job) 自己 update）；
 *     本模块只管登记 / 查询 / 取消标记，不碰业务逻辑。
 *   · 取消：置 state='cancelled' + 给 AbortController；执行器自己响应 signal。
 *     引擎类任务（ComfyUI 轮询）每轮检查 signal.aborted 退出。
 */
import { randomUUID } from 'node:crypto'

const MAX_JOBS = 100
const MAX_PROGRESS = 200

/** 内存注册表（进程内，重启即清空）。 */
const jobs = new Map()

/** 订阅者：任务状态变化时回调（给 SSE 用；当前没接 SSE，留口子）。 */
const listeners = new Set()

function notify(job) {
  for (const fn of listeners) {
    try { fn(job) } catch { /* 订阅者异常不影响任务 */ }
  }
}

function prune() {
  if (jobs.size <= MAX_JOBS) return
  // 先删最老的已终态任务
  const done = [...jobs.values()].filter((j) => ['done', 'failed', 'cancelled'].includes(j.state))
    .sort((a, b) => (a.endedAt ?? a.startedAt).localeCompare(b.endedAt ?? b.startedAt))
  for (const job of done) {
    if (jobs.size <= MAX_JOBS) break
    jobs.delete(job.id)
  }
}

/**
 * 提交一个后台任务。
 * @param {object} opts
 * @param {string} opts.kind    任务类型（image / vision / enrich / import / …）
 * @param {string} opts.label   人话标题
 * @param {string} [opts.root]  所属库（跨库任务中心按库分组用）
 * @param {(job:{id,update,setResult,fail})=>Promise<any>} opts.run 执行器
 * @returns {{ id: string, state: string }}
 */
export function submitJob({ kind = 'task', label = '', root = '', run } = {}) {
  const id = `job-${randomUUID().slice(0, 8)}`
  const controller = new AbortController()
  const job = {
    id,
    kind: String(kind),
    label: String(label || kind),
    root: String(root || ''),
    state: 'running',
    progress: [],
    result: null,
    error: null,
    startedAt: new Date().toISOString(),
    endedAt: null,
    signal: controller.signal,
    __controller: controller
  }
  jobs.set(id, job)
  listeners.size && notify(job)

  const update = (message) => {
    if (job.state !== 'running') return
    job.progress.push({ at: new Date().toISOString(), message: String(message ?? '') })
    if (job.progress.length > MAX_PROGRESS) job.progress = job.progress.slice(-MAX_PROGRESS)
    listeners.size && notify(job)
  }
  const setResult = (result) => { job.result = result ?? null }
  const fail = (message) => { job.error = String(message ?? '未知错误') }

  // 异步执行（不 await——提交即返回）
  Promise.resolve()
    .then(() => run?.({ id, update, setResult, fail, signal: controller.signal }))
    .then(() => {
      if (job.state === 'cancelled') return
      job.state = 'done'
      job.endedAt = new Date().toISOString()
      listeners.size && notify(job)
    })
    .catch((error) => {
      if (job.state === 'cancelled') return
      job.state = 'failed'
      job.error = job.error || String(error?.message ?? error)
      job.endedAt = new Date().toISOString()
      listeners.size && notify(job)
    })
    .finally(() => prune())

  return { id, state: 'running' }
}

/** 单任务快照（去掉 signal——不可序列化）。 */
function publicJob(job) {
  if (!job) return null
  const { signal, __controller, ...rest } = job
  return {
    ...rest,
    progress: job.progress.map((p) => ({ at: p.at, message: p.message }))
  }
}

/** 查一个任务。 */
export function getJob(id) {
  return publicJob(jobs.get(String(id ?? '')))
}

/** 列任务（可按 root / kind / state 过滤）；默认按开始时间倒序。 */
export function listJobs({ root = '', kind = '', state = '', limit = 50 } = {}) {
  const all = [...jobs.values()]
    .filter((j) => (!root || j.root === root))
    .filter((j) => (!kind || j.kind === kind))
    .filter((j) => (!state || j.state === state))
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))
    .slice(0, Math.max(1, Math.min(200, Number(limit) || 50)))
  return all.map(publicJob)
}

/** 取消任务：置 cancelled + abort；执行器应自行响应 signal。 */
export function cancelJob(id) {
  const job = jobs.get(String(id ?? ''))
  if (!job) return { ok: false, code: 'NOT_FOUND', message: `任务不存在：${id}` }
  if (['done', 'failed', 'cancelled'].includes(job.state)) {
    return { ok: false, code: 'ALREADY_SETTLED', message: `任务已结束（${job.state}）` }
  }
  job.state = 'cancelled'
  job.endedAt = new Date().toISOString()
  try { job.__controller?.abort() } catch { /* 忽略 */ }
  listeners.size && notify(job)
  return { ok: true, job: publicJob(job) }
}

/** 清理已终态任务（前端「清空已完成」按钮）。 */
export function clearSettled({ root = '' } = {}) {
  let removed = 0
  for (const [id, job] of [...jobs.entries()]) {
    if (root && job.root !== root) continue
    if (['done', 'failed', 'cancelled'].includes(job.state)) { jobs.delete(id); removed++ }
  }
  return { ok: true, removed }
}

/** 活跃任务计数（给悬浮球气泡用）。 */
export function activeCount({ root = '' } = {}) {
  let n = 0
  for (const job of jobs.values()) {
    if (root && job.root !== root) continue
    if (job.state === 'running' || job.state === 'queued') n++
  }
  return n
}

/** 订阅（SSE 用；当前前端用轮询，这口子留给以后）。 */
export function subscribe(fn) {
  listeners.add(fn)
  return () => listeners.delete(fn)
}
