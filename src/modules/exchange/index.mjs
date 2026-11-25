import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'fact.store', min: 3 }, { id: 'storage.roots', min: 1 }, { id: 'prose.write', min: 1 }],
  pages: { 'exchange-actions': { id: 'exchange-actions', label: '导入导出' } }
})
