/**
 * Embedding 路径解析用例（OS-139）——resolveEmbeddingPaths 纯函数＋仓内真实目录＋去硬编码守卫。
 * 跑法：node --test test/embeddingPaths.test.mjs
 * 注意：不 import embedding-server.mjs——那是常驻服务（import 即装模型＋listen），测试不许真起。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync, statSync } from 'node:fs'
import { isAbsolute, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveEmbeddingPaths, resolveRepoRoot } from '../src/services/embeddingPaths.mjs'

test('纯函数：任意仓根 → 缓存目录与 transformers 发行目录，绝对路径、无副作用', () => {
  const fakeRoot = join(fileURLToPath(new URL('.', import.meta.url)), 'fixtures')
  const paths = resolveEmbeddingPaths(fakeRoot)
  assert.equal(paths.cacheDir, join(fakeRoot, '.cache', 'models'))
  assert.equal(paths.transformersDist, join(fakeRoot, 'node_modules', '@xenova', 'transformers', 'dist'))
  assert.equal(isAbsolute(paths.cacheDir), true)
  assert.equal(isAbsolute(paths.transformersDist), true)
  // 输入仓根不存在也不抛——纯函数不碰文件系统
  assert.doesNotThrow(() => resolveEmbeddingPaths('Z:/no-such-repo'))
})

test('真实仓：resolveRepoRoot 指向仓根（package.json 所在目录），解析路径指向仓内真实存在的目录', () => {
  const repoRoot = resolveRepoRoot()
  assert.equal(existsSync(join(repoRoot, 'package.json')), true)
  const paths = resolveEmbeddingPaths(repoRoot)
  for (const [name, path] of Object.entries(paths)) {
    assert.equal(path.startsWith(repoRoot + sep), true, `${name} 应在仓内：${path}`)
    assert.equal(existsSync(path), true, `${name} 应真实存在：${path}`)
    assert.equal(statSync(path).isDirectory(), true, `${name} 应是目录：${path}`)
  }
})

test('守卫：embedding-server.mjs 不再含硬编码仓根字面量（D:/OpenStory）', () => {
  // OS-140 布局归一：embedding-server 实现迁到 src/services/（断言字面量随事实更新）
  const source = readFileSync(join(resolveRepoRoot(), 'src', 'services', 'embedding-server.mjs'), 'utf-8')
  assert.equal(source.includes('D:/OpenStory'), false, 'embedding-server.mjs 仍含硬编码 D:/OpenStory')
  assert.equal(source.includes('resolveEmbeddingPaths'), true, 'embedding-server.mjs 应改用 embeddingPaths 的解析')
})
