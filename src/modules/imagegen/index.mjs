import { workbenchEntry } from '../../protocol/moduleEntry.mjs'
import { createHandlers } from './handlers.mjs'
import { createMediaEngine } from './imagegenEngine.mjs'

export const activate = workbenchEntry({
  requires: [
    { id: 'deduce.engine', min: 1 },
    { id: 'media.generate', min: 1 },
    { id: 'media.describe', min: 1 }
  ],
  pages: { imagegen: { id: 'imagegen', label: '生图与识图' } },
  handlers: (context) => {
    // OS-195b：media.* 经句柄装配，engine 不再持有实现登记表。
    const engine = createMediaEngine({
      mediaGenerate: context.resolve('media.generate', { min: 1 }),
      mediaDescribe: context.resolve('media.describe', { min: 1 })
    })
    return createHandlers({
      host: context.host,
      deduce: context.resolve('deduce.engine', { min: 1 }),
      factBooks: context.resolve('fact.books', { min: 1 }),
      agentRuntime: context.resolve('agent.runtime', { min: 1 }),
      mediaGenerate: engine.mediaGenerate,
      mediaDescribe: engine.mediaDescribe,
      prose: context.resolve('prose.write', { min: 1 })
    })
  }
})
