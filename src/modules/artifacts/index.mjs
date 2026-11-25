import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'storage.roots', min: 1 }],
  pages: { artifacts: { id: 'artifacts', label: '产物' } }
})
