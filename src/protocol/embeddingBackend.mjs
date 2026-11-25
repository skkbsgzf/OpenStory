/**
 * OS-193：embedding 运行时的外部依赖加载口。
 * 只把既有的 @xenova/transformers 动态装载挪出内核模块（S2.1 模块只许 node:/相对说明符），
 * 不新增任何 npm 依赖；实现与模型选择仍在 src/modules/agent-runtime/embedding-server.mjs。
 */
export async function loadEmbeddingBackend() {
  return import('@xenova/transformers')
}
