import {
  deduceOpening,
  deducePresent,
  deduceSettle,
  loadEntries,
  readLastTurn
} from './deduceEngine.mjs'
import {
  bridgeDeduceCandidates,
  buildDeduceLlmPort,
  generateTurnProse,
  readLegacyDeduceState,
  turnNodeWords
} from './turnProse.mjs'
import {
  appendNode,
  archiveChapter,
  createDeduceSession,
  DEDUCE_SESSION_SCHEMA,
  deduceSessionFile,
  deduceSessionPath,
  deleteDeduceSession,
  importLegacyDeduce,
  listDeduceSessions,
  loadDeduceSession,
  normalizeDeduceSession,
  readActiveSessionId,
  safeDeduceBookId,
  saveDeduceSession,
  writeActiveSessionId
} from './deduceSession.mjs'

export const deduceCapability = Object.freeze({
  deduceOpening,
  deducePresent,
  deduceSettle,
  loadEntries,
  readLastTurn,
  readLegacyDeduceState,
  bridgeDeduceCandidates,
  buildDeduceLlmPort,
  generateTurnProse,
  turnNodeWords,
  // OS-195a：会话容器读写收进 deduce 能力面，roleplay/imagegen 经 context.resolve 取句柄。
  deduceSessionSchema: () => DEDUCE_SESSION_SCHEMA,
  deduceSessionPath,
  deduceSessionFile,
  safeDeduceBookId,
  normalizeDeduceSession,
  loadDeduceSession,
  readActiveSessionId,
  writeActiveSessionId,
  listDeduceSessions,
  createDeduceSession,
  deleteDeduceSession,
  saveDeduceSession,
  appendNode,
  importLegacyDeduce,
  archiveChapter
})

export const deduceCapabilities = Object.freeze({ 'deduce.engine': deduceCapability })
