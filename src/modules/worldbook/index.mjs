import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'
import { scanReferences } from './referenceStore.mjs'
import { worldbookPromptSection } from './promptContext.mjs'

export const activate = workbenchEntry({
  requires: [
    { id: 'fact.store', min: 3 },
    { id: 'media.generate', min: 1 },
    { id: 'agent.runtime', min: 1 }
  ],
  pages: { worldbook: { id: 'worldbook', label: '世界书' } },
  handlers: (context) => createHandlers({
    host: context.host,
    factStore: context.resolve('fact.store', { min: 3 }),
    prose: context.resolve('prose.write', { min: 1 }),
    mediaGenerate: context.resolve('media.generate', { min: 1 }),
    agentRuntime: context.resolve('agent.runtime', { min: 1 })
  }),
  // OS-195a：Agent 上下文里的世界书索引与宿主同源检查的索引，均由本模块贡献钩子。
  hooks: (context) => {
    const factStore = context.resolve('fact.store', { min: 3 })
    const prose = context.resolve('prose.write', { min: 1 })
    return {
      promptContext: {
        worldbook: (root, options) => worldbookPromptSection(root, { ...options, factStore, prose })
      },
      referenceIndex: { worldbook: (root) => scanReferences(root) }
    }
  }
})
