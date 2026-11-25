/** OS-193 兼容转供叶：DSH 原生适配实现已归 agent-runtime 内核件。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

export const resolveOnPath = (...a) => K.agentRuntime.resolveOnPath(...a)
export const spawnCommand = (...a) => K.agentRuntime.spawnCommand(...a)
export const pickChatBase = (...a) => K.agentRuntime.pickChatBase(...a)
export const detectDshCli = (...a) => K.agentRuntime.detectDshCli(...a)
export const detectDshModels = (...a) => K.agentRuntime.detectDshModels(...a)
export const detectDshAny = (...a) => K.agentRuntime.detectDshAny(...a)
export const detectDsh = (...a) => K.agentRuntime.detectDsh(...a)
export const probeDshStack = (...a) => K.agentRuntime.probeDshStack(...a)
export const setupDshStack = (...a) => K.agentRuntime.setupDshStack(...a)
export const resolveDshRun = (...a) => K.agentRuntime.resolveDshRun(...a)
export const resolveDshChat = (...a) => K.agentRuntime.resolveDshChat(...a)
export const DSH_INSPECTOR_PORT = 9230
