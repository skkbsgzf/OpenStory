/**
 * 底座·载体清单 bootstrap（OpenStory 独立仓）。
 *
 * 以 pinax-core 为原型的底座：载体清单（manifest 声明）随底座走，实现（tools）不上底座——
 * OpenStory 只用清单做建库（projectKind/dataDirs/依赖闭包），从不调用载体工具实现。
 * 11 份清单从 Pinax-next@70a4f44 逐字 vendor（见 scripts/vendor-core.mjs 与 core/VENDORED.md）。
 */
import { createRegistry } from './pinax/next/kernel/pluginRegistry.mjs'
import { PROJECT_KINDS } from './pinax/next/kernel/projectSkeleton.mjs'

export const CARRIER_IDS = Object.freeze([
  'pinax.carrier.novel',
  'pinax.carrier.script',
  'pinax.carrier.outline',
  'pinax.carrier.notes',
  'pinax.carrier.worldbook',
  'pinax.carrier.dossier',
  'pinax.carrier.material',
  'pinax.carrier.comic',
  'pinax.carrier.video',
  'pinax.carrier.experience',
  'pinax.carrier.online'
])

const ID_TO_DIR = Object.freeze(Object.fromEntries(CARRIER_IDS.map((id) => [id, id.split('.').pop()])))

/** 底座载体注册表：只装清单声明（impl 空——OpenStory 不调载体工具）。进程内单例由调用方缓存。 */
export async function createCarrierRegistry() {
  const registry = createRegistry({ kinds: Object.keys(PROJECT_KINDS) })
  const installed = []
  const skipped = []
  for (const id of CARRIER_IDS) {
    const mod = await import(`./pinax/next/carriers/${ID_TO_DIR[id]}/manifest.mjs`)
    const manifest = mod.manifest ?? mod.default
    if (!manifest) {
      skipped.push({ id, reason: 'manifest.mjs 没有 manifest 导出' })
      continue
    }
    const result = registry.install(manifest, {}, {})
    if (result && result.ok === false) {
      skipped.push({ id, reason: result.error?.message ?? 'install 拒收' })
      continue
    }
    installed.push(id)
  }
  return { registry, installed, skipped }
}
