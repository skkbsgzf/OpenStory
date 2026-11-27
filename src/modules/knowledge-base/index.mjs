import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'
import { KnowledgeSearchService } from './knowledgeSearchService.mjs'

let activeService = null

export function workbenchKnowledgeService() { return activeService }

export const activate = workbenchEntry({
  requires: [{ id: 'base.write', min: 1 }],
  pages: { 'knowledge-base': { id: 'knowledge-base', label: '知识库' } },
  handlers: (context) => {
    let runtime = null
    try { runtime = context.resolve('knowledge.retrieval', { min: 1, maxExclusive: 2 }) } catch { runtime = null }
    activeService = new KnowledgeSearchService({ env: context.host?.env, host: context.host, resolveCapability: () => runtime })
    return createHandlers({ host: context.host, service: activeService, runtimeProvider: () => runtime })
  },
  hooks: {
    promptContext: {
      knowledgeBase: async (root, genre, options = {}) => {
        if (!activeService || !text(options?.query ?? options?.brief ?? genre).trim()) return null
        const result = await activeService.search({ query: options.query ?? options.brief ?? genre, ...options })
        return result.ok ? result.hits : null
      }
    },
    startup: {
      knowledgeBase: () => () => { activeService?.invalidate(); activeService = null }
    }
  }
})

function text(value) { return String(value ?? '') }
