import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { activate as activateRuntime, agentRuntimeCapability } from '../src/modules/agent-runtime/index.mjs'
import { activate as activateMedia, mediaCapability } from '../src/modules/media/index.mjs'
import { KERNEL_CAPABILITIES as K } from '../src/protocol/capabilityImplementations.mjs'
import { resolveMediaCapability } from '../src/host/capabilityBindings.mjs'

const runtimeCapability = K.agentRuntime
import { moduleManifest, validateModuleManifest } from '../src/protocol/modules.mjs'
import { startDaemon } from '../src/host/daemon.mjs'
import { writeNodeShim } from './fixtures/platformShim.mjs'

async function listen(server) {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${server.address().port}`
}

async function close(server) {
  await new Promise((resolve) => server.close(resolve))
}

test('C4/C5：两个平级 kernel manifest 与 activate 返回真实能力对象', () => {
  for (const [id, activate, capabilities] of [
    ['agent-runtime', activateRuntime, agentRuntimeCapability],
    ['media', activateMedia, mediaCapability]
  ]) {
    const manifest = moduleManifest(id)
    const checked = validateModuleManifest(manifest, { dirName: id, stage: 'C' })
    assert.equal(checked.ok, true, checked.errors.join('；'))
    assert.equal(manifest.class, 'kernel')
    assert.equal(manifest.entry, 'index.mjs')
    assert.deepEqual(manifest.endpoints, [])
    assert.ok(Object.keys(capabilities).every((key) => manifest.capabilities.some((item) => item.id === key)))
  }
  assert.deepEqual(moduleManifest('agent-runtime').capabilities, [{ id: 'agent.runtime', version: 1, golden: 'agent-runtime-v1' }])
  assert.deepEqual(moduleManifest('media').capabilities, [
    { id: 'media.generate', version: 1, golden: 'media-generate-v1' },
    { id: 'media.describe', version: 1, golden: 'media-describe-v1' }
  ])
})

test('agent-runtime-v1 / media-describe-v1 金样：配置骨架与识图提示词逐字确定', () => {
  const hash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex')
  assert.equal(hash(runtimeCapability.emptyConfigV2()), 'c07b3b4e03fcc71de5a27ee1ab4c864df8738a52564aab6b70e599b3af5f576b')
  assert.equal(hash(mediaCapability['media.describe'].visionPrompt({
    imagePath: '世界书/甲.png', target: 'scene', focus: '雨', habitContext: '短句'
  })), '953c1525d8343de572d15cc76e9423843f15956d3796353273071ccc58933f00')
})

test('C4/C5：activate 只解析底座能力，不伪造未声明贡献', async () => {
  for (const activate of [activateRuntime, activateMedia]) {
    const resolved = []
    const result = await activate({ resolve: (id, range) => { resolved.push([id, range]); return { ok: true } } })
    assert.deepEqual(Object.keys(result), ['capabilities'])
    assert.ok(resolved.every(([id]) => id.startsWith('base.')))
  }
})

test('依赖方向：runtime 不引工作台，media 不反向引 runtime', async () => {
  const runtimeConfig = await readFile(new URL('../src/modules/agent-runtime/config.mjs', import.meta.url), 'utf8')
  assert.doesNotMatch(runtimeConfig, /modules\/(?:comfyui|agentbar)|agent-runtime\/media|\.\.\/media/u)
  for (const file of ['index.mjs', 'generate.mjs', 'describe.mjs', 'probe.mjs', 'comfyEngine.mjs']) {
    const source = await readFile(new URL(`../src/modules/media/${file}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /agent-runtime|modules\/agentbar|\.\.\/services\//u, file)
  }
})

test('agent.runtime：配置只落临时本机文件，公开形状仍只回掩码', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-runtime-config-'))
  const configPath = join(base, 'agent-config.json')
  try {
    const config = await runtimeCapability.saveConfigV2(configPath, {
      text: { endpoint: 'http://127.0.0.1:9/v1', model: 'fixture', apiKey: 'sk-fixture-1234' },
      image: { enabled: true, endpoint: 'http://127.0.0.1:9/v1', model: 'image' }
    })
    const publicConfig = runtimeCapability.configPublicV2(config, configPath)
    assert.equal(publicConfig.text.apiKeyMasked, '••••1234')
    assert.equal(JSON.stringify(publicConfig).includes('sk-fixture-1234'), false)
    assert.equal(JSON.parse(await readFile(configPath, 'utf8')).text.apiKey, 'sk-fixture-1234')
    assert.equal(runtimeCapability.maskApiKey('short'), '••••')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('media.generate：OpenAI 真实请求由内核执行，参数与图片输出不变', async () => {
  let received
  const upstream = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      received = { url: req.url, authorization: req.headers.authorization, body: JSON.parse(raw) }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }))
    })
  })
  const endpoint = await listen(upstream)
  try {
    const resolved = await resolveMediaCapability('', 'media.generate')
    assert.equal(resolved.ok, true)
    const result = await resolved.capability.generate({
      image: { backend: 'openai', endpoint: `${endpoint}/v1`, model: 'img', apiKey: 'secret' },
      prompt: '雨夜', stylePrompt: '水墨', size: '768x1024'
    })
    assert.deepEqual(result, { ok: true, b64: 'aW1hZ2U=', backend: 'openai' })
    assert.equal(received.url, '/v1/images/generations')
    assert.equal(received.authorization, 'Bearer secret')
    assert.equal(received.body.prompt, '水墨，雨夜。无文字。')
    assert.equal(received.body.size, '768x1024')
    assert.equal(received.body.response_format, 'b64_json')
  } finally {
    await close(upstream)
  }
})

test('media.generate：ComfyUI 提交、轮询、取图真实链路归 media', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-media-comfy-'))
  const workflow = {
    1: { class_type: 'KSampler', inputs: { seed: 1, steps: 20, width: 512, height: 512 } },
    2: { class_type: 'CLIPTextEncode', inputs: { text: '' }, _meta: { title: 'Positive' } }
  }
  await writeFile(join(base, 'workflow.json'), JSON.stringify(workflow), 'utf8')
  let submitted
  const upstream = createServer((req, res) => {
    if (req.url === '/prompt') {
      let raw = ''
      req.on('data', (chunk) => { raw += chunk })
      req.on('end', () => {
        submitted = JSON.parse(raw)
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ prompt_id: 'p-1' }))
      })
      return
    }
    if (req.url === '/history/p-1') {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ 'p-1': { outputs: { 9: { images: [{ filename: 'out.png', subfolder: '', type: 'output' }] } } } }))
      return
    }
    if (req.url.startsWith('/view?')) {
      res.writeHead(200, { 'content-type': 'image/png' })
      res.end(Buffer.from('fixture-image'))
      return
    }
    res.writeHead(404)
    res.end()
  })
  const endpoint = await listen(upstream)
  try {
    const result = await mediaCapability['media.generate'].generate({
      image: { backend: 'comfyui', comfyUrl: endpoint, comfyWorkflow: 'workflow.json' },
      root: base, prompt: '旧港', negative: '模糊', size: '640x480', timeoutMs: 3000
    })
    assert.equal(result.ok, true)
    assert.equal(result.b64, Buffer.from('fixture-image').toString('base64'))
    assert.equal(result.promptId, 'p-1')
    assert.equal(submitted.prompt['2'].inputs.text, '2D彩漫风格，旧港。无文字。')
    assert.equal(submitted.prompt['1'].inputs.width, 640)
  } finally {
    await close(upstream)
    await rm(base, { recursive: true, force: true })
  }
})

test('media.describe：提示词与 DSH 调用归 media，运行时端口显式注入', async () => {
  let received
  const runtime = {
    ...runtimeCapability,
    runDshStdio: async (options) => {
      received = options
      options.onText('月光落在')
      options.onText('青石上。')
      return { ok: true, text: '' }
    }
  }
  const result = await mediaCapability['media.describe'].describe({
    imagePath: 'D:/fixture/image.png', root: 'D:/fixture', vision: { enabled: true, model: 'provider/model' },
    target: 'scene', focus: '潮气', habitContext: '短句', env: { DSH_PROFILE: 'fixture' }, runtime
  })
  assert.deepEqual(result, { ok: true, text: '月光落在青石上。', chars: 8, model: 'provider/model' })
  assert.equal(received.cwd, 'D:/fixture')
  assert.deepEqual(received.model, { provider: 'provider', id: 'model' })
  assert.match(received.prompt, /图片路径：D:\/fixture\/image\.png/u)
  assert.match(received.prompt, /这次特别留意：潮气/u)
  assert.match(received.prompt, /作者习惯（必须遵守）：短句/u)
})

test('外部端点：生图与识图路径、响应形状和本机配置掩码保持不变', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-media-endpoints-'))
  const root = join(base, '夹具库')
  const localAppData = join(base, 'localappdata')
  const home = join(base, 'home')
  const configPath = join(localAppData, 'OpenStory', 'openstory', 'agent-config.json')
  await mkdir(join(root, '世界书', '人物'), { recursive: true })
  await mkdir(join(root, '故事源'), { recursive: true })
  await mkdir(join(root, '扮演'), { recursive: true })
  await mkdir(home, { recursive: true })
  await writeFile(join(root, '世界书', '人物', '林砚.md'), '---\ntitle: 林砚\nkind: character\n---\n雨夜中的青年。', 'utf8')
  await writeFile(join(root, '世界书', '人物', 'ref.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]), 'utf8')
  await writeFile(join(root, '故事源', 'book-1.json'), JSON.stringify({ book: { id: 'book-1', title: '夹具书' }, entries: [], revision: 1 }), 'utf8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库', source: 'imported', addedAt: '2026-01-01T00:00:00.000Z' }] }), 'utf8')
  const fakeDsh = join(base, 'fake-dsh.mjs')
  const dshShim = await writeNodeShim(base, 'dsh', join(base, 'fake-dsh.mjs'))
  await writeFile(fakeDsh, `
import { createInterface } from 'node:readline'
const out = (frame) => process.stdout.write(JSON.stringify(frame) + '\\n')
out({ v: 1, type: 'ready' })
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', (line) => {
  const command = JSON.parse(line)
  if (command.type !== 'execute') return
  out({ v: 1, type: 'text', request_id: command.request_id, content: '青石上的月光。' })
  out({ v: 1, type: 'result', request_id: command.request_id, status: 'completed', output: '' })
  process.exit(0)
})
`, 'utf8')

  const upstream = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      assert.equal(req.url, '/v1/images/generations')
      assert.equal(JSON.parse(raw).response_format, 'b64_json')
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ data: [{ b64_json: 'aW1hZ2U=' }] }))
    })
  })
  const endpoint = await listen(upstream)
  const daemon = await startDaemon({
    port: 0, preferencesPath, agentConfigPath: configPath,
    env: { ...process.env, LOCALAPPDATA: localAppData, USERPROFILE: home, HOME: home, DSH_CLI: dshShim, DSH_PROFILE: 'fixture' },
    logger: { log() {} }
  })
  const origin = `http://127.0.0.1:${daemon.port}`
  const send = (path, body, method = 'POST') => fetch(origin + path, { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  try {
    const configured = await (await send('/api/config', {
      image: { enabled: true, backend: 'openai', endpoint: `${endpoint}/v1`, model: 'img', apiKey: 'sk-endpoint-9876' },
      vision: { enabled: true, model: 'fixture/vision', profile: 'fixture' }
    }, 'PUT')).json()
    assert.equal(configured.ok, true, JSON.stringify(configured))
    assert.equal(configured.image.apiKeyMasked, '••••9876')
    assert.equal(JSON.stringify(configured).includes('sk-endpoint-9876'), false)

    const scene = await send('/api/deduce/image', { root, bookId: 'book-1', name: '雨夜', prompt: '旧港' })
    const scenePayload = await scene.json()
    assert.equal(scene.status, 200, JSON.stringify(scenePayload))
    assert.deepEqual(scenePayload, { ok: true, name: '雨夜', path: '扮演/book-1/素材/场景/雨夜.png', size: '1024x1024' })
    assert.equal((await readFile(join(root, '扮演', 'book-1', '素材', '场景', '雨夜.png'))).toString(), 'image')

    const reference = await send('/api/reference/image', { root, path: '世界书/人物/林砚.md', prompt: '青年' })
    assert.equal(reference.status, 200)
    const referencePayload = await reference.json()
    assert.equal(referencePayload.ok, true)
    assert.equal(referencePayload.path, '世界书/人物/林砚.md')
    assert.equal(referencePayload.imagePath, '世界书/人物/assets/林砚.png')
    assert.equal(referencePayload.frontmatter.cover, referencePayload.imagePath)

    const vision = await send('/api/vision/describe', { root, image: '世界书/人物/ref.png', target: 'scene' })
    assert.equal(vision.status, 200)
    assert.deepEqual(await vision.json(), { ok: true, text: '青石上的月光。', chars: 7, model: 'fixture/vision' })
  } finally {
    await daemon.close()
    await close(upstream)
    await rm(base, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 })
  }
})

test('media 停用后按库薄代理解析为 CAPABILITY_MISSING', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-media-disabled-'))
  try {
    await mkdir(join(base, '.openstory'), { recursive: true })
    await writeFile(join(base, '.openstory', 'ui-state.json'), JSON.stringify({ 'modules.enabled.media': false }))
    const resolved = await resolveMediaCapability(base, 'media.generate')
    assert.equal(resolved.ok, false)
    assert.equal(resolved.code, 'CAPABILITY_MISSING')
    assert.equal(resolved.details.reason, 'CAPABILITY_NOT_REGISTERED')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
