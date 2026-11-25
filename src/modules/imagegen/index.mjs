import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'media.generate', min: 1 }, { id: 'media.describe', min: 1 }],
  pages: { imagegen: { id: 'imagegen', label: '生图与识图' } },
  handlers: (context) => createHandlers({
    host: context.host,
    factBooks: context.resolve('fact.books', { min: 1 }),
    agentRuntime: context.resolve('agent.runtime', { min: 1 }),
    mediaGenerate: context.resolve('media.generate', { min: 1 }),
    mediaDescribe: context.resolve('media.describe', { min: 1 }),
    prose: context.resolve('prose.write', { min: 1 })
  })
})
