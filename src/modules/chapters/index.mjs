import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'prose.write', min: 1 }, { id: 'fact.store', min: 3 }],
  pages: { chapters: { id: 'chapters', label: '正文' } },
  handlers: (context) => createHandlers({
    host: context.host,
    prose: context.resolve('prose.write', { min: 1 })
  })
})
