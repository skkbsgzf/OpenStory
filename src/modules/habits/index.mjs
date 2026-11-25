import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'
import { lintHabits, readHabits } from './habits.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'text.analyze', min: 1 }],
  pages: { habits: { id: 'habits', label: '习惯' } },
  handlers: (context) => createHandlers({ host: context.host }),
  // OS-195a：宿主写前 lint 与提示词习惯段改由本模块贡献，停用即钩子消失。
  hooks: {
    beforeWrite: { habitsLint: (root, text) => lintHabits(text, readHabits(root)) },
    promptContext: { habits: (root) => readHabits(root) }
  }
})
