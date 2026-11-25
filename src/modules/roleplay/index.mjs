import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [
    { id: 'deduce.engine', min: 1 },
    { id: 'fact.store', min: 3 },
    { id: 'prose.write', min: 1 },
    { id: 'text.analyze', min: 1 }
  ],
  pages: { roleplay: { id: 'roleplay', label: '扮演' } },
  handlers: (context) => createHandlers({
    host: context.host,
    deduce: context.resolve('deduce.engine', { min: 1 }),
    factStore: context.resolve('fact.store', { min: 3 }),
    factBooks: context.resolve('fact.books', { min: 1 }),
    prose: context.resolve('prose.write', { min: 1 }),
    agentRuntime: context.resolve('agent.runtime', { min: 1 }),
    textAnalyze: context.resolve('text.analyze', { min: 1 })
  })
})
