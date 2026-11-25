import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'agent.runtime', min: 1 }],
  pages: { knowledge: { id: 'knowledge', label: '知识库' } }
})
