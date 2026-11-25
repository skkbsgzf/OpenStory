import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'fact.store', min: 3 }, { id: 'fact.domain', min: 1 }, { id: 'storage.roots', min: 1 }, { id: 'prose.write', min: 1 }],
  pages: { exchange: { id: 'exchange', label: '导入导出' } },
  handlers: (context) => createHandlers({
    host: context.host,
    factStore: context.resolve('fact.store', { min: 3 }),
    factWrite: context.resolve('fact.write', { min: 1 }),
    factDomain: context.resolve('fact.domain', { min: 1 })
  })
})
