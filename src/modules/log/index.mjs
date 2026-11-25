import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'prose.write', min: 1 }],
  pages: { log: { id: 'log', label: '日志' } }
})
