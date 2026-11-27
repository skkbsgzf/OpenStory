/** OS-214：浏览器/daemon 共享纯模块的精确静态路由。 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { withTempDaemon } from './helpers/tempDaemon.mjs'

test('OS-214 共享剧本纯模块可被浏览器加载，且不暴露其它 src/ 文件', async () => {
  await withTempDaemon(async (fx) => {
    for (const path of ['/src/modules/script/scriptParse.mjs', '/src/modules/script/scriptFact.mjs']) {
      const response = await fetch(`${fx.origin}${path}`)
      assert.equal(response.status, 200, path)
      assert.match(response.headers.get('content-type') || '', /javascript|text\/plain/u)
      assert.match(response.headers.get('cache-control') || '', /no-store/u)
      assert.ok((await response.text()).includes('export '), `${path} 应是 ESM 纯模块`)
    }
    for (const path of [
      '/src/modules/roleplay/handlers.mjs',
      '/src/host/daemon.mjs',
      '/src/modules/script/module.manifest.json',
      '/src/modules/script/../../package.json'
    ]) {
      const response = await fetch(`${fx.origin}${path}`)
      assert.ok([400, 403, 404].includes(response.status), `${path} 不应暴露，实得 ${response.status}`)
    }
  })
})
