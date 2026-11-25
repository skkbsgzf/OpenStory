import { generateImage } from './generate.mjs'
import { describeImage, visionPrompt } from './describe.mjs'
import { probeImageConfig, probeVisionConfig } from './probe.mjs'
import { applyWorkflowInputs, generateViaComfy, probeComfy } from './comfyEngine.mjs'

export const mediaCapability = Object.freeze({
  'media.generate': Object.freeze({
    generate: generateImage, probeConfig: probeImageConfig,
    // OS-193：Comfy 工作流原语经能力句柄供生图工作台取用（实现不换）。
    applyWorkflowInputs, generateViaComfy, probeComfy
  }),
  'media.describe': Object.freeze({ describe: describeImage, visionPrompt, probeConfig: probeVisionConfig })
})

export async function activate(context) {
  context.resolve('base.contract', { min: 1 })
  return { capabilities: mediaCapability }
}
