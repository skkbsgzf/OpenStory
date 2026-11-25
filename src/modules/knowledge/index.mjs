import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'
import { defaultKbConfigPath } from './knowledgeAdapter.mjs'
import { bootstrapKbHealth } from './knowledgeHealth.mjs'
import { precedentPromptSectionForGenre, resolveCollections } from './knowledgeRouter.mjs'

export const activate = workbenchEntry({
  requires: [{ id: 'agent.runtime', min: 1 }],
  pages: { knowledge: { id: 'knowledge', label: '知识库' } },
  handlers: (context) => createHandlers({ host: context.host }),
  // OS-195a：提示词先例片段与启动探活改由本模块贡献钩子，宿主不再静态 import 知识库实现。
  hooks: {
    promptContext: {
      knowledge: (root, genre, options) => precedentPromptSectionForGenre(genre, options)
    },
    startup: {
      knowledge: ({ env, repoRoot, logger }) => bootstrapKbHealth({
        env, repoRoot, logger, defaultKbConfigPath, resolveCollections
      })
    }
  }
})
