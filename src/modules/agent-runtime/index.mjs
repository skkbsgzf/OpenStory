import * as config from './config.mjs'
import * as dsh from './dsh-cli.mjs'
import * as cli from './cli-bridge.mjs'
import * as bridge from './dsh-bridge.mjs'
import * as upstream from './chatUpstream.mjs'
import * as embedding from './embeddingPaths.mjs'
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
    text: config.text,
    maskApiKey,
    dshModelSelection: dsh.dshModelSelection,
    parseDshFrame: dsh.parseDshFrame,
    dshFrameText: dsh.dshFrameText,
    runDshStdio: dsh.runDshStdio,
    // OS-193：上游通道与 embedding 归位后由 agent.runtime 统一暴露。
    composeCliPrompt: cli.composeCliPrompt,
    buildCliArgs: cli.buildCliArgs,
    runCliChat: cli.runCliChat,
    resolveOnPath: bridge.resolveOnPath,
    spawnCommand: bridge.spawnCommand,
    pickChatBase: bridge.pickChatBase,
    detectDshCli: bridge.detectDshCli,
    detectDshModels: bridge.detectDshModels,
    detectDshAny: bridge.detectDshAny,
    detectDsh: bridge.detectDsh,
    probeDshStack: bridge.probeDshStack,
    setupDshStack: bridge.setupDshStack,
    resolveDshRun: bridge.resolveDshRun,
    resolveDshChat: bridge.resolveDshChat,
    DSH_INSPECTOR_PORT: bridge.DSH_INSPECTOR_PORT,
    resolveChatUpstream: upstream.resolveChatUpstream,
    chatCompleteViaUpstream: upstream.chatCompleteViaUpstream,
    resolveUpstreamSafe: upstream.resolveUpstreamSafe,
    resolveEmbeddingPaths: embedding.resolveEmbeddingPaths,
    resolveRepoRoot: embedding.resolveRepoRoot
  })
})

export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  context.resolve('base.contract', { min: 1 })
  return { capabilities: agentRuntimeCapability }
}
