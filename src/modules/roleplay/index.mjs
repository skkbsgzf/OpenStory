import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'deduce.engine', min: 1 }, { id: 'fact.store', min: 3 }, { id: 'prose.write', min: 1 }, { id: 'text.analyze', min: 1 }],
  pages: { roleplay: { id: 'roleplay', label: '扮演' } }
})
