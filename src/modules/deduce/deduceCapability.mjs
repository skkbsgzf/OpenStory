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
  turnNodeWords
})

export const deduceCapabilities = Object.freeze({ 'deduce.engine': deduceCapability })
