import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'agent.runtime', min: 1 }],
  pages: { 'kb-settings': { id: 'kb-settings', label: '知识库' } }
})
