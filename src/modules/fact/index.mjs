import * as factStore from './fact/factFileStore.mjs'
import * as domain from './fact/domain/index.mjs'
import { createAliasIndex } from './fact/domain/aliases.js'
import { buildFactPack } from './fact/factPack.mjs'
import * as books from './fact/books.mjs'
import { writeFactEntries } from './fact/importWrite.mjs'
import { derivePseudoChapters, hasRealChapters } from './enrich/pseudoChapters.mjs'
import { causalSummary } from './enrich/metrics.mjs'
import { enrichBook, enrichGraph } from './enrich/engine.mjs'

const domainHandle = Object.freeze({
  ...domain,
  createAliasIndex,
  buildFactPack,
  // 能力句柄只暴露函数；词表常量经取值函数转出，保证 resolve() 后仍可消费。
  factSchema: () => domain.FACT_SCHEMA,
  factSource: () => domain.FACT_SOURCE
})

export const factCapability = Object.freeze({
  'fact.store': Object.freeze({
    createFactFileStore: factStore.createFactFileStore,
    writeFactFile: factStore.writeFactFile,
    readFactWiki: factStore.readFactWiki,
    FACT_DIR_NAME: factStore.FACT_DIR_NAME
  }),
  'fact.pack': Object.freeze({ buildFactPack }),
  // fact.enrich@1 是金样出口（decoupleStep3 形状锁）：三个只读度量成员一字不动。
  'fact.enrich': Object.freeze({ derivePseudoChapters, hasRealChapters, causalSummary }),
  // OS-193 归位后的富化运行入口独立成组，不动金样形状。
  'fact.engine': Object.freeze({ enrichBook, enrichGraph }),
  'fact.books': Object.freeze({ ...books }),
  'fact.write': Object.freeze({ writeFactEntries }),
  'fact.domain': domainHandle
})

export async function activate(context) {
  context.resolve('base.write', { min: 1 })
  context.resolve('base.naming', { min: 1 })
  return { capabilities: factCapability }
}
