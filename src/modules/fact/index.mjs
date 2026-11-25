import * as factStore from './fact/factFileStore.mjs'
import { buildFactPack } from './fact/factPack.mjs'
import { derivePseudoChapters, hasRealChapters } from './enrich/pseudoChapters.mjs'
import { causalSummary } from './enrich/metrics.mjs'

export const factCapability = Object.freeze({
  'fact.store': Object.freeze({
    createFactFileStore: factStore.createFactFileStore,
    writeFactFile: factStore.writeFactFile,
    readFactWiki: factStore.readFactWiki,
    FACT_DIR_NAME: factStore.FACT_DIR_NAME
  }),
  'fact.pack': Object.freeze({ buildFactPack }),
  'fact.enrich': Object.freeze({ derivePseudoChapters, hasRealChapters, causalSummary })
})

export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  context.resolve('base.naming', { min: 1 })
  return { capabilities: factCapability }
}
