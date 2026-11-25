/**
 * OS-188 / D4 收口：底座进程服务的单一映射面（`base.process`）。
 *
 * 进程事实（代际／启动时刻／health）、任务中心、Agent 事件词表与 SSE 帧工具都在这里
 * 汇成一张只读句柄，插件经 `base.process` 取用，不直接 import host 实现。
 * 全部是进程内服务：重启即清，不落盘；锁文件只读探测，不在这里抢占或改写。
 */
import * as jobCenter from './jobCenter.mjs'
import * as agentEvents from '../protocol/agentEvents.mjs'
import { sseFrame, sseOpen } from './sse.mjs'

/** OS-127 进程治理：本 daemon 进程的代际与启动时刻，/api/health 与 base.process 读同一份。 */
export const PROCESS_RUNTIME = { generation: 0, startedAt: '', booted: false }

export function processHealth() {
  return Object.freeze({
    ok: true,
    pid: process.pid,
    uptimeMs: Math.round(process.uptime() * 1000),
    generation: PROCESS_RUNTIME.generation,
    startedAt: PROCESS_RUNTIME.startedAt
  })
}

/** 只读锁探测：锁路径与解析口径仍归 daemon（唯一写锁者），这里只取当前档。 */
export async function processLock(env = process.env) {
  const { daemonLockPath, readDaemonLock } = await import('./daemon.mjs')
  const path = daemonLockPath(env)
  if (!path) return Object.freeze({ path: '', lock: null })
  return Object.freeze({ path, lock: readDaemonLock(path) })
}

export const PROCESS_JOBS = Object.freeze({
  submitJob: jobCenter.submitJob,
  getJob: jobCenter.getJob,
  listJobs: jobCenter.listJobs,
  cancelJob: jobCenter.cancelJob,
  clearSettled: jobCenter.clearSettled,
  activeCount: jobCenter.activeCount,
  subscribe: jobCenter.subscribe
})

export const PROCESS_EVENTS = Object.freeze({
  AGENT_EVENT_TYPES: agentEvents.AGENT_EVENT_TYPES,
  AGENT_EVENT_TYPES_SSE: agentEvents.AGENT_EVENT_TYPES_SSE,
  AGENT_EVENT_AGUI_KINDS: agentEvents.AGENT_EVENT_AGUI_KINDS,
  encodeForAgui: agentEvents.encodeForAgui,
  projectLegacyFrame: agentEvents.projectLegacyFrame
})

export const PROCESS_SSE = Object.freeze({ open: sseOpen, frame: sseFrame })