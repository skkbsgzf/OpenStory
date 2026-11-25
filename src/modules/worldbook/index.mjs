import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'fact.store', min: 3 }],
  pages: { reference: { id: 'reference', label: '世界书' } }
})
