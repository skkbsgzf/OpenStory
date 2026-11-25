/** 兼容转供叶：ComfyUI 执行器已归 media 内核件；工作台不再拥有实现（OS-193 经唯一静态入口取）。 */
import { KERNEL_CAPABILITIES as K } from '../../protocol/capabilityImplementations.mjs'

export const { applyWorkflowInputs, generateViaComfy, probeComfy } = K.mediaGenerate
