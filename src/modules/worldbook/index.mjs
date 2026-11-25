import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'fact.store', min: 3 }],
  pages: { worldbook: { id: 'worldbook', label: '世界书' } },
  handlers: (context) => createHandlers({
    host: context.host,
    factStore: context.resolve('fact.store', { min: 3 }),
    prose: context.resolve('prose.write', { min: 1 })
  })
})
