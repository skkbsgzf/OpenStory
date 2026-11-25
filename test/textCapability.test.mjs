/**
 * C5b：text.analyze@1 内核件、协议转供与浏览器兼容静态路由。
 * 所有库/机器态夹具均落系统临时目录，不读真实用户目录。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { activate, analyzeChapter, splitSentences, textCapability } from '../src/modules/text/index.mjs'
import * as textProtocol from '../src/protocol/text.mjs'
import { createCapabilityResolver } from '../src/protocol/capabilityResolver.mjs'
import { CAPABILITY_SNAPSHOT, moduleManifest, validateModuleManifest } from '../src/protocol/modules.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ENGINE_PATH = join(ROOT, 'src', 'modules', 'text', 'analysis.mjs')
const SHIM_PATH = join(ROOT, 'public', 'analysis.mjs')

const GOLDEN_SOURCE = `雨停了。她说：「走吧。」

他不禁微微颤抖。然而，他仍然没有回头。`

test('text manifest：kernel、entry、base.naming@1 与 text.analyze@1 金样契约', () => {
  const manifest = moduleManifest('text')
  assert.equal(manifest.class, 'kernel')
  assert.equal(manifest.entry, 'index.mjs')
  assert.deepEqual(manifest.requires, [{ id: 'base.naming', min: 1 }])
  assert.deepEqual(manifest.capabilities, [{ id: 'text.analyze', version: 1, golden: 'text-analyze-v1' }])
  assert.deepEqual(manifest.endpoints, [])
  assert.equal(validateModuleManifest(manifest, { dirName: 'text', stage: 'C' }).ok, true)
  assert.deepEqual(CAPABILITY_SNAPSHOT.routes['text.analyze'], {
    provider: 'text', version: 1, builtin: true, golden: 'text-analyze-v1'
  })
})

test('activate：只解析 base.naming，返回冻结的 textCapability', async () => {
  const calls = []
  const activated = await activate({ resolve: (...args) => { calls.push(args); return { ok: true } } })
  assert.deepEqual(calls, [['base.naming', { min: 1 }]])
  assert.equal(activated.capabilities, textCapability)
  assert.ok(Object.isFrozen(textCapability))
  assert.ok(Object.isFrozen(textCapability['text.analyze']))
  assert.deepEqual(Object.keys(textCapability['text.analyze']), ['analyzeChapter', 'splitSentences'])
})

test('协议转供与内核入口同源，能力薄代理透传两个纯函数', async () => {
  assert.equal(textProtocol.analyzeChapter, analyzeChapter)
  assert.equal(textProtocol.splitSentences, splitSentences)
  assert.equal(textProtocol.textCapability, textCapability)
  const resolved = createCapabilityResolver({
    snapshot: CAPABILITY_SNAPSHOT,
    implementations: { text: textCapability }
  }).resolve('text.analyze', { min: 1 })
  assert.equal(resolved.ok, true)
  assert.equal(resolved.capability.provider, 'text')
  assert.deepEqual(resolved.capability.splitSentences('一。二！'), ['一。', '二！'])
  assert.equal(resolved.capability.analyzeChapter('很短。').confidence, 'low')
})

test('text-analyze-v1 金样：固定输入输出逐字确定', () => {
  const golden = createHash('sha256').update(JSON.stringify(analyzeChapter(GOLDEN_SOURCE))).digest('hex')
  assert.equal(golden, '53ab65c2bd8dbba478d6353fe9a18df7d54440c2f6d611ee513f96092403022a')
})

test('浏览器兼容叶只转供，不复制分析实现', async () => {
  const shim = await readFile(SHIM_PATH, 'utf8')
  assert.match(shim, /export \{ analyzeChapter, splitSentences \} from '\/src\/modules\/text\/analysis\.mjs'/u)
  assert.doesNotMatch(shim, /export function analyzeChapter/u)
  assert.doesNotMatch(shim, /const POSITIVE/u)
})

test('daemon 精确托管 text 引擎给浏览器，不开放其余 src 文件', async () => {
  const base = await mkdtemp(join(tmpdir(), 'openstory-c5b-static-'))
  const publicDir = join(base, 'public')
  const preferencesPath = join(base, 'libraries.json')
  let daemon = null
  try {
    await mkdir(publicDir, { recursive: true })
    await writeFile(join(publicDir, 'analysis.mjs'), await readFile(SHIM_PATH, 'utf8'), 'utf8')
    await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [] }), 'utf8')
    const { startDaemon } = await import('../src/host/daemon.mjs')
    daemon = await startDaemon({
      port: 0,
      publicDir,
      preferencesPath,
      env: { LOCALAPPDATA: base, APPDATA: base },
      logger: { log() {} }
    })
    const origin = `http://127.0.0.1:${daemon.port}`
    const engine = await fetch(`${origin}/src/modules/text/analysis.mjs`)
    assert.equal(engine.status, 200)
    assert.match(engine.headers.get('content-type'), /^text\/javascript/u)
    assert.equal(engine.headers.get('cache-control'), 'no-store')
    assert.equal(await engine.text(), await readFile(ENGINE_PATH, 'utf8'))

    const shim = await fetch(`${origin}/analysis.mjs`)
    assert.equal(shim.status, 200)
    assert.match(await shim.text(), /from '\/src\/modules\/text\/analysis\.mjs'/u)

    for (const path of [
      '/src/modules/text/index.mjs',
      '/src/protocol/text.mjs',
      '/src/modules/text/%2e%2e/%2e%2e/protocol/text.mjs'
    ]) {
      const response = await fetch(origin + path)
      assert.equal(response.status, 404, `${path} 不得开放`)
    }
  } finally {
    await daemon?.close()
    await rm(base, { recursive: true, force: true })
  }
})
