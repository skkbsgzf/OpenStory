import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'text.analyze', min: 1 }],
  pages: { habits: { id: 'habits', label: '习惯' } }
})
