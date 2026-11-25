/**
 * OS-195b：生图工作台的 media.* 句柄装配口——`media.generate`／`media.describe`
 * 由 imagegen.activate(context) 经 context.resolve 取到后传入，不再在模块顶层
 * 持有实现登记表。函数是句柄本身，不复制实现、不换实现。
 */
export function createMediaEngine({ mediaGenerate, mediaDescribe }) {
  if (!mediaGenerate || !mediaDescribe) {
    throw new Error('createMediaEngine 需要 media.generate 与 media.describe 句柄')
  }
  return Object.freeze({
    mediaGenerate,
    mediaDescribe,
    applyWorkflowInputs: mediaGenerate.applyWorkflowInputs,
    generateViaComfy: mediaGenerate.generateViaComfy,
    probeComfy: mediaGenerate.probeComfy
  })
}
