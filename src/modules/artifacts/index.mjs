import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'storage.roots', min: 1 }],
  pages: { artifacts: { id: 'artifacts', label: '产物' } },
  handlers: (context) => createHandlers({ host: context.host })
})
