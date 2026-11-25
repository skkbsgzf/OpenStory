import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'fact.store', min: 3 }, { id: 'fact.enrich', min: 1 }],
  pages: { storysource: { id: 'storysource', label: '故事源' } }
})
