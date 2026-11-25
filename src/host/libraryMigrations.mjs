/**
 * OS-197：能力迁移进入真实链路——按库执行一次、失败剔除覆盖者、已落新格式可查。
 *
 * 这里是唯一的生产调用口（由 moduleRuntime 的快照路径调用）：
 *   · 声明来自当前层 manifests（本机覆盖者的 `migrations`），包目录按层内 source 记录解析；
 *   · 该库启用中的覆盖者才迁移；dormant 的声明不碰数据；
 *   · 幂等由 `capabilityMigration.runCapabilityMigrations` 的 journal `done` 负责；
 *   · 失败结果缓存到下一次层／启停变化或 daemon 重启，期间覆盖者从该库快照剔除。
 */
import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { readModuleEnabled } from '../protocol/capabilityGraph.mjs'
import { declaredCapabilityMigrations, runCapabilityMigrations } from '../protocol/capabilityMigration.mjs'
import { readUiState } from '../protocol/libState.mjs'
import { METADATA_DIR, canonicalRoot } from '../protocol/rootPath.mjs'

const text = (value) => String(value ?? '')
const states = new Map()

function migrationPackageDir(source, id) {
  if (source?.source !== 'local') return null
  const root = text(source.sourceDir).trim()
  return root ? join(root, id) : null
}

async function readDataVersions(root) {
  const dir = join(canonicalRoot(root), METADATA_DIR, 'migrations')
  const out = []
  let capabilities = []
  try {
    capabilities = await readdir(dir, { withFileTypes: true })
  } catch {
    return out
  }
  for (const capabilityDir of capabilities) {
    if (!capabilityDir.isDirectory()) continue
    let entries = []
    try {
      entries = await readdir(join(dir, capabilityDir.name), { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const journal = JSON.parse(await readFile(join(dir, capabilityDir.name, entry.name), 'utf8'))
        if (journal?.state !== 'done' || !Number.isInteger(journal.to)) continue
        out.push({
          capability: text(journal.capability) || capabilityDir.name,
          from: journal.from,
          to: journal.to,
          plugin: text(journal.plugin),
          journalPath: join(dir, capabilityDir.name, entry.name),
          finishedAt: text(journal.finishedAt),
          files: Array.isArray(journal.files) ? journal.files.map((file) => text(file?.path)).filter(Boolean) : []
        })
      } catch { /* 坏 journal 不当作已迁格式 */ }
    }
  }
  out.sort((left, right) => left.capability.localeCompare(right.capability) || left.to - right.to)
  return out
}

async function enabledMap(root, manifests) {
  if (!manifests.some((manifest) => (manifest?.migrations ?? []).length)) return {}
  try {
    const { state } = await readUiState(root)
    return Object.fromEntries(manifests.map((manifest) => [manifest.id, readModuleEnabled(state ?? {}, manifest.id)]))
  } catch {
    return Object.fromEntries(manifests.map((manifest) => [manifest.id, true]))
  }
}

async function execute(root, layer, enabled, declared) {
  const result = await runCapabilityMigrations({ root, migrations: declared })
  return {
    ok: result.ok,
    root,
    ran: result.ran,
    skipped: result.skipped,
    failures: result.failures,
    excluded: result.disable,
    migrations: declared.map((item) => ({
      plugin: item.plugin,
      capability: item.capability,
      from: item.from,
      to: item.to,
      entry: item.entry
    })),
    dataVersions: await readDataVersions(root),
    fresh: false
  }
}

function cacheKey(rootKey, layer, enabled) {
  return [rootKey, layer.id, JSON.stringify(enabled)].join('\u0000')
}

/**
 * 准备某库的迁移状态。同一根＋同一层＋同一启停组合只跑一次；层或启停一变就重算
 * （失败后作者停用覆盖者、或下一次 daemon 重开时按 journal 恢复重试）。
 */
export async function prepareLibraryMigrations(root, layer) {
  if (!root) return { ok: true, root: '', ran: [], skipped: [], failures: [], excluded: [], migrations: [], dataVersions: [], fresh: false }
  const rootKey = canonicalRoot(root)
  const enabled = await enabledMap(rootKey, layer.manifests ?? [])
  const sources = new Map((layer.sources ?? []).map((source) => [source.id, source]))
  const declared = declaredCapabilityMigrations(
    (layer.manifests ?? []).filter((manifest) => enabled[manifest.id] !== false),
    (id) => migrationPackageDir(sources.get(id), id)
  )
  // 没有声明就不缓存：已迁数据的取数必须反映当前 journal（比如覆盖者刚被移除）。
  if (!declared.length) {
    const prefix = `${rootKey}\u0000${layer.id}\u0000`
    for (const stale of states.keys()) if (stale.startsWith(prefix)) states.delete(stale)
    return {
      ok: true, root: rootKey, ran: [], skipped: [], failures: [], excluded: [],
      migrations: [], dataVersions: await readDataVersions(rootKey), fresh: false
    }
  }
  const key = cacheKey(rootKey, layer, enabled)
  const existing = states.get(key)
  if (existing?.promise) return { ...(await existing.promise), fresh: false }
  if (existing) return { ...existing, fresh: false }
  const layerPrefix = `${rootKey}\u0000${layer.id}\u0000`
  for (const stale of states.keys()) {
    if (stale.startsWith(layerPrefix) && stale !== key) states.delete(stale)
  }
  const entry = { promise: execute(rootKey, layer, enabled, declared) }
  states.set(key, entry)
  const base = await entry.promise
  states.set(key, { ...base, key })
  return { ...base, fresh: true }
}

/** 测试与重启口径：清掉某库（或全部）的迁移状态缓存。 */
export function resetLibraryMigrations(root = '') {
  if (!root) {
    states.clear()
    return
  }
  const prefix = `${canonicalRoot(root)}\u0000`
  for (const key of states.keys()) if (key.startsWith(prefix)) states.delete(key)
}