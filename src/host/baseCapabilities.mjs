import { endpointFor, errorEnvelope } from '../api/contracts.mjs'
import { atomicWriteFile } from '../protocol/hostWrite.mjs'
import { NAMING_TABLE, LOG_MODULES, namingEntry, logModuleForDir } from '../protocol/naming.mjs'
import { CAPABILITY_SNAPSHOT, MODULE_MANIFESTS, MODULE_SOURCES } from '../protocol/modules.mjs'
import { SLOT_REGISTRY, isRegisteredSlot, slotEntry } from '../protocol/slots.mjs'

import { PROCESS_EVENTS, PROCESS_JOBS, PROCESS_SSE, PROCESS_RUNTIME, processHealth, processLock } from './processServices.mjs'

export const baseCapabilities = Object.freeze({
  'base.process': Object.freeze({
    health: processHealth,
    generation: () => PROCESS_RUNTIME.generation,
    startedAt: () => PROCESS_RUNTIME.startedAt,
    lock: processLock,
    // 能力句柄只暴露函数（薄代理契约）：子服务以零参函数取冻结对象。
    jobs: () => PROCESS_JOBS,
    events: () => PROCESS_EVENTS,
    sse: () => PROCESS_SSE
  }),
  'base.loader': Object.freeze({
    snapshot: () => CAPABILITY_SNAPSHOT,
    manifests: () => MODULE_MANIFESTS,
    sources: () => MODULE_SOURCES,
    activate: (options) => import('./moduleLoader.mjs').then((module) => module.activateModules(options))
  }),
  'base.contract': Object.freeze({ endpointFor, errorEnvelope }),
  'base.write': Object.freeze({ atomicWriteFile }),
  'base.naming': Object.freeze({ NAMING_TABLE, LOG_MODULES, namingEntry, logModuleForDir, SLOT_REGISTRY, isRegisteredSlot, slotEntry })
})
