/** 兼容转供叶：DSH stdio 实现已归 agent.runtime 内核件（OS-193 起经唯一静态入口转供）。 */
import { KERNEL_CAPABILITIES as K } from '../protocol/capabilityImplementations.mjs'

const of = () => K.agentRuntime
export const resolveOnPath = (...a) => of().resolveOnPath(...a)
export const spawnCommand = (...a) => of().spawnCommand(...a)
export const parseDshFrame = (...a) => of().parseDshFrame(...a)
export const dshFrameText = (...a) => of().dshFrameText(...a)
export const dshModelSelection = (...a) => of().dshModelSelection(...a)
export const runDshStdio = (...a) => of().runDshStdio(...a)
