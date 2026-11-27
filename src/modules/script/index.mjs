import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'prose.write', min: 1 }, { id: 'fact.store', min: 3 }],
  pages: { script: { id: 'script', label: '剧本' } },
  // OS-214：剧本↔fact 互转下沉为服务端能力（原来只在 public/scriptFact.mjs）。
  handlers: (context) => createHandlers({
    host: context.host,
    factStore: context.resolve('fact.store', { min: 3 })
  })
})
