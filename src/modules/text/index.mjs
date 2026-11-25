import { analyzeChapter, splitSentences } from './analysis.mjs'
import { measure, listFingerprintPacks, fingerprintHint, runStyleCheck } from './lint.mjs'

export { analyzeChapter, splitSentences }

/** text.analyze@1：零依赖、零 DOM、零存储的确定性文本分析＋文风指纹门禁能力。 */
export const textCapability = Object.freeze({
  'text.analyze': Object.freeze({
    analyzeChapter, splitSentences,
    // OS-193：style-check 归位，指纹 lint 并入 text.analyze（实现不换）。
    measure, listFingerprintPacks, fingerprintHint, runStyleCheck
  })
})

export async function activate(context) {
  context.resolve('base.naming', { min: 1 })
  return { capabilities: textCapability }
}
