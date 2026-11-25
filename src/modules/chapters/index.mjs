import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'prose.write', min: 1 }, { id: 'fact.store', min: 3 }],
  pages: { write: { id: 'write', label: '正文' } }
})
