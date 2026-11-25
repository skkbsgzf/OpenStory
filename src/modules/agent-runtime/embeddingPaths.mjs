/**
 * Embedding 服务路径解析（OS-139）——从 embedding-server.mjs 抽出的纯函数。
 *
 * 为什么独立成模块：embedding-server.mjs 是常驻服务（import 即装模型＋listen），
 * 测试不许真起服务，故把无副作用的路径解析放这里供单测直接 import。
 */
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/* * 仓根＝本模块目录三层上溯（OS-193 归位后本文件与 embedding-server.mjs 同在
 * src/modules/agent-runtime/，package.json 仍在仓根——默认参数保持零参数调用返回仓根的契约，
 * test/embeddingPaths.test.mjs 钉死）。 */
export function resolveRepoRoot(importMetaUrl = import.meta.url) {
  return join(dirname(fileURLToPath(importMetaUrl)), '..', '..', '..')
}

/**
 * 由仓根解析 embedding-server 需要的路径（纯函数：不碰文件系统、无副作用）：
 *   cacheDir          模型缓存目录（.cache/models；TRANSFORMERS_CACHE 与 localModelPath 共用）
 *   transformersDist  @xenova/transformers 发行目录（ORT 的 wasm 文件在此）
 */
export function resolveEmbeddingPaths(repoRoot) {
  return {
    cacheDir: join(repoRoot, '.cache', 'models'),
    transformersDist: join(repoRoot, 'node_modules', '@xenova', 'transformers', 'dist')
  }
}
