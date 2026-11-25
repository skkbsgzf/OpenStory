import { analyzeChapter, splitSentences } from './analysis.mjs'

export { analyzeChapter, splitSentences }

/** text.analyze@1：零依赖、零 DOM、零存储的确定性文本分析能力。 */
export const textCapability = Object.freeze({
  'text.analyze': Object.freeze({ analyzeChapter, splitSentences })
})

export async function activate(context) {
  context.resolve('base.naming', { min: 1 })
  return { capabilities: textCapability }
}
