/**
 * Agent 栏存储出口：实现自 OS-195 起在底座契约 `src/protocol/agentStore.mjs`
 * （Agent 会话 JSONL 与凭据掩码是宿主组合面的共享设施，不是工作台内部实现）。
 * 本模块只转供，不复制实现；凭据掩码真源在 protocol/agentCredentials.mjs。
 */
export * from '../../protocol/agentStore.mjs'
