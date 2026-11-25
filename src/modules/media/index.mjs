import { generateImage } from './generate.mjs'
import { describeImage, visionPrompt } from './describe.mjs'
import { probeImageConfig, probeVisionConfig } from './probe.mjs'

export const mediaCapability = Object.freeze({
  'media.generate': Object.freeze({ generate: generateImage, probeConfig: probeImageConfig }),
  'media.describe': Object.freeze({ describe: describeImage, visionPrompt, probeConfig: probeVisionConfig })
})

export async function activate(context) {
  context.resolve('base.contract', { min: 1 })
  return { capabilities: mediaCapability }
}
