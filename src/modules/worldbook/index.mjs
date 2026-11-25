import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'fact.store', min: 3 }],
  pages: { worldbook: { id: 'worldbook', label: '世界书' } }
})
