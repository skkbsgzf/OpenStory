/**
 * KB 服务健康（KB-ARCH P1）——WeKnora(8080) 与本地 embedding(8808) 的探活、自愈与状态聚合。
 *
 * 职责：
 *   probeServices({weknoraUrl, embedUrl})       并行探活两服务
 *   ensureEmbedding({repoRoot, embedUrl})       embedding 不可达且 backend=weknora 时自动拉起
 *   watchServices({...})                        递归 setTimeout 循环重探（模块级状态）
 *   collectKbStatus({configPath})               设置面板聚合：六库文档数/解析状态＋服务健康
 *
 * 设计：全部调用降级不抛——KB 挂了设置面板显示 down，对话链路静默跳过（kbRouter 已兜）。
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const WATCH_INTERVAL_MS = 60_000
const PROBE_TIMEOUT_MS = 3_000

/** 模块级状态：watchServices 的实时快照（daemon 与 kbStatusGet 共读）。 */
export const kbServiceState = {
  weknora: { up: false, version: '', edition: '' },
  embedding: { up: false, model: '', dim: null },
  lastCheck: null,
  autoStarted: false,
  watching: false
}

async function fetchJson(url, timeoutMs, apiKey = '') {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const headers = apiKey ? { 'X-API-Key': apiKey } : {}
    const r = await fetch(url, { signal: ctrl.signal, headers })
    if (!r.ok) return null
    return await r.json()
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** 并行探活两服务（WeKnora 的 system/info 需 X-API-Key，没配置时裸探也能通的老版本则不受影响）。结果写入并返回 kbServiceState 快照。 */
export async function probeServices({ weknoraUrl = 'http://127.0.0.1:8080', embedUrl = 'http://127.0.0.1:8808', timeoutMs = PROBE_TIMEOUT_MS, weknoraApiKey = '' } = {}) {
  const [weknora, embedding] = await Promise.all([
    fetchJson(`${weknoraUrl}/api/v1/system/info`, timeoutMs, weknoraApiKey),
    fetchJson(`${embedUrl}/health`, timeoutMs)
  ])
  kbServiceState.weknora = {
    up: !!(weknora && weknora.data),
    version: String(weknora?.data?.version ?? ''),
    edition: String(weknora?.data?.edition ?? '')
  }
  kbServiceState.embedding = {
    up: !!(embedding && embedding.ok),
    model: String(embedding?.model ?? ''),
    dim: Number.isInteger(embedding?.dim) ? embedding.dim : (embedding?.dim ?? null)
  }
  kbServiceState.lastCheck = new Date().toISOString()
  return kbServiceState
}

/** embedding 不可达时自动拉起（仅 backend=weknora 才管），至多等 readyMs。返回是否已就绪。
 * 依赖注入（OS-67 可插拔）：resolveCollections 由调用方（daemon）传入，本模块不直接 import kbRouter。 */
export async function ensureEmbedding({ repoRoot, embedUrl = 'http://127.0.0.1:8808', configPath, readyMs = 30_000, logger = () => {}, resolveCollections } = {}) {
  const first = await fetchJson(`${embedUrl}/health`, PROBE_TIMEOUT_MS)
  if (first && first.ok) return true
  if (typeof resolveCollections !== 'function') return false
  const cfg = resolveCollections(configPath)
  if (!cfg.ok) return false // 没接知识库就不越权拉服务
  const script = join(repoRoot, 'embedding-server.mjs')
  if (!existsSync(script)) return false
  try {
    const child = spawn(process.execPath, [script], { detached: true, stdio: 'ignore', cwd: repoRoot })
    child.unref()
    kbServiceState.autoStarted = true
    logger(`[kbHealth] embedding 未响应，已自动拉起（pid ${child.pid}）`)
  } catch (error) {
    logger(`[kbHealth] embedding 拉起失败：${error.message}`)
    return false
  }
  const deadline = Date.now() + readyMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500))
    const h = await fetchJson(`${embedUrl}/health`, PROBE_TIMEOUT_MS)
    if (h && h.ok) return true
  }
  return false
}

/** 启动循环探活（递归 setTimeout，非阻塞；重复调用幂等）。返回 stop() 停表句柄（daemon close 时调用，不留悬挂定时器）。
 * opts.onEmbeddingDown：探到 embedding 掉线时的自愈回调（限频 2 分钟，防抖）。 */
export function watchServices(opts = {}) {
  if (kbServiceState.watching) return () => {}
  kbServiceState.watching = true
  let stopped = false
  let lastHealAttempt = 0
  const tick = async () => {
    if (stopped) return
    try {
      const snap = await probeServices(opts)
      if (!snap.embedding.up && typeof opts.onEmbeddingDown === 'function' && Date.now() - lastHealAttempt > 120_000) {
        lastHealAttempt = Date.now()
        try { opts.onEmbeddingDown() } catch { /* 自愈回调永不抛 */ }
      }
    } catch { /* 探活永不抛 */ }
    if (!stopped) {
      const timer = setTimeout(tick, WATCH_INTERVAL_MS)
      if (typeof timer.unref === 'function') timer.unref()
    }
  }
  tick()
  return () => {
    stopped = true
    kbServiceState.watching = false
  }
}

/** daemon 启动引导：kb-config 存在才自愈 embedding＋开循环探活；无配置返回 null（KB 功能未启用）。
 * 依赖注入（OS-67 可插拔）：defaultKbConfigPath / resolveCollections 由调用方传入。 */
export function bootstrapKbHealth({ env = process.env, repoRoot, logger = console, defaultKbConfigPath, resolveCollections } = {}) {
  if (typeof defaultKbConfigPath !== 'function' || typeof resolveCollections !== 'function') return null
  const configPath = defaultKbConfigPath(env)
  const cfg = resolveCollections(configPath)
  if (!cfg.ok) return null
  const log = (msg) => logger.log?.(msg) ?? logger(msg)
  // 自愈不阻塞启动：异步拉起，探活循环随后接管状态
  ensureEmbedding({ repoRoot, configPath, logger: log, resolveCollections }).catch(() => {})
  const watchOpts = {
    weknoraApiKey: cfg.apiKey,
    onEmbeddingDown: () => ensureEmbedding({ repoRoot, configPath, logger: log, resolveCollections }).catch(() => {})
  }
  return watchServices(watchOpts)
}

/** 单库文档统计：GET knowledge 列表，数总数与已解析数（降级 null）。 */
async function collectCollection(baseUrl, apiKey, kbId, timeoutMs) {
  const d = await fetchJson(`${baseUrl}/api/v1/knowledge-bases/${kbId}/knowledge?page=1&page_size=100`, timeoutMs, apiKey)
  const items = Array.isArray(d?.data) ? d.data : null
  if (!items) return { docs: null, parsed: null }
  return {
    docs: items.length,
    parsed: items.filter((k) => k.parse_status === 'completed').length
  }
}

/**
 * 设置面板聚合：服务健康＋六库文档数/解析状态＋配置路径。
 * 一切失败降级为 null/false，返回形状恒定（契约见 contracts.mjs kbStatusGet）。
 */
export async function collectKbStatus({ configPath, weknoraUrl = 'http://127.0.0.1:8080', embedUrl = 'http://127.0.0.1:8808', timeoutMs = 5_000, services = null, resolveCollections } = {}) {
  if (typeof resolveCollections !== 'function') {
    return { ok: true, configured: false, backend: '', configPath: String(configPath ?? ''), configError: '', services: { weknora: { up: false, version: '', edition: '' }, embedding: { up: false, model: '', dim: 0, autoStarted: false } }, lastCheck: kbServiceState.lastCheck, collections: [] }
  }
  const cfg = resolveCollections(configPath)
  const svc = services ?? await probeServices({ weknoraUrl, embedUrl, timeoutMs, weknoraApiKey: cfg.ok ? cfg.apiKey : '' })
  const out = {
    ok: true,
    configured: !!cfg.ok,
    backend: '',
    configPath: String(configPath ?? ''),
    configError: cfg.ok ? '' : String(cfg.error ?? ''),
    services: {
      weknora: { up: svc.weknora.up, version: svc.weknora.version, edition: svc.weknora.edition },
      embedding: { up: svc.embedding.up, model: svc.embedding.model, dim: svc.embedding.dim, autoStarted: svc.autoStarted }
    },
    lastCheck: svc.lastCheck,
    collections: []
  }
  if (!cfg.ok) return out
  out.backend = 'weknora'
  const base = String(cfg.baseUrl ?? '').replace(/\/$/, '')
  const entries = await Promise.all(
    Object.entries(cfg.map).map(async ([alias, id]) => {
      const stat = await collectCollection(base, cfg.apiKey, id, timeoutMs)
      return { alias, id, docs: stat.docs, parsed: stat.parsed }
    })
  )
  out.collections = entries
  return out
}
