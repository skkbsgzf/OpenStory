import { workbenchEntry } from '../../protocol/moduleEntry.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'media.generate', min: 1 }, { id: 'media.describe', min: 1 }],
  pages: { 'image-settings': { id: 'image-settings', label: '生图与识图' } }
})
