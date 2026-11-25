/**
 * OS-193：运行时货架转供叶——agent-runtime 内核件消费 model runtime 的只读能力。
 * 只转不复制；实现真源 src/services/runtimes.mjs（OS-195 前不归内核）。
 */
export { loadRuntimeKits, probeRuntimeKit, ensureSidecar } from '../services/runtimes.mjs'
