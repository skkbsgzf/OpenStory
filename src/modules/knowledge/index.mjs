import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'agent.runtime', min: 1 }],
  pages: { knowledge: { id: 'knowledge', label: '知识库' } },
  handlers: (context) => createHandlers({ host: context.host })
})
