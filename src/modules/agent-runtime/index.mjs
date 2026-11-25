import * as config from './config.mjs'
import * as dsh from './dsh-cli.mjs'
import { maskApiKey } from './credentials.mjs'

export const agentRuntimeCapability = Object.freeze({
  'agent.runtime': Object.freeze({
    emptyConfigV2: config.emptyConfigV2,
    normalizeConfigV2: config.normalizeConfigV2,
    normalizeConfigBlock: config.normalizeConfigBlock,
    validateConfigPatch: config.validateConfigPatch,
    loadConfigV2: config.loadConfigV2,
    saveConfigV2: config.saveConfigV2,
    configPublicV2: config.configPublicV2,
    configPublicLegacy: config.configPublicLegacy,
    configTextBlock: config.configTextBlock,
    configAgentBlock: config.configAgentBlock,
    chatCompletionsUrl: config.chatCompletionsUrl,
    probeTextConfig: config.probeTextConfig,
    maskApiKey,
    dshModelSelection: dsh.dshModelSelection,
    runDshStdio: dsh.runDshStdio
  })
})

export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  context.resolve('base.contract', { min: 1 })
  return { capabilities: agentRuntimeCapability }
}
