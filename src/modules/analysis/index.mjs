import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'text.analyze', min: 1 }],
  pages: { analysis: { id: 'analysis', label: '分析' } }
})
