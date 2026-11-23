/**
 * 全局配置 v2 用例（S4，node:test，零依赖）。
 *
 * 覆盖四件事：
 *   ① 旧格式迁移：顶层 endpoint/model/apiKey 读到即落成 text 块，值不丢，磁盘写回新格式；
 *   ② 凭据红线：apiKey 只回尾号，完整 key 不出 daemon；
 *   ③ 可行性校验 probe：不可达 endpoint 回 reachable:false 不抛；overrides 能用未保存的值试连；
 *   ④ 分块写：只传 image 不改 text。
 *
 * 跑法：node .zcode/run-gate.mjs（会 chdir 到仓根后跑全量）
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeEnv() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-config-'))
  const configPath = join(base, 'agent-config.json')
  const preferencesPath = join(base, 'next-preferences.json')
  await writeFile(preferencesPath, JSON.stringify({ recentProjects: [] }), 'utf-8')
  const daemon = await startDaemon({ port: 0, preferencesPath, agentConfigPath: configPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  return {
    base,
    configPath,
    origin,
    get: (path) => fetch(origin + path),
    send: (method, path, body) => fetch(origin + path, {
      method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }),
    async close() {
      await daemon.close()
      await rm(base, { recursive: true, force: true })
    }
  }
}

test('配置：旧格式读到即迁移到 text 块，值不丢且磁盘写回新格式', async () => {
  const env = await makeEnv()
  try {
    // 旧格式：顶层 endpoint/model/apiKey/runtime/reasoningEffort/chineseReasoning ＋ imageEndpoint
    await writeFile(env.configPath, JSON.stringify({
      endpoint: 'https://api.example.com/v1/chat/completions',
      model: 'old-model',
      apiKey: 'sk-legacy-9876',
      runtime: 'dsh',
      reasoningEffort: 'high',
      chineseReasoning: false,
      imageEndpoint: { url: 'https://api.example.com/v1', model: 'img-1', apiKey: 'sk-img-1234' }
    }), 'utf-8')

    const payload = await (await env.get('/api/config')).json()
    assert.equal(payload.ok, true)
    assert.equal(payload.text.endpoint, 'https://api.example.com/v1/chat/completions')
    assert.equal(payload.text.model, 'old-model')
    assert.equal(payload.text.runtime, 'dsh')
    assert.equal(payload.text.reasoningEffort, 'high')
    assert.equal(payload.text.chineseReasoning, false)
    assert.equal(payload.text.apiKeyMasked, '••••9876')
    assert.equal(payload.image.endpoint, 'https://api.example.com/v1', '旧 imageEndpoint.url 迁进 image.endpoint')
    assert.equal(payload.image.enabled, true, '旧 imageEndpoint 有 url＝视为启用')
    assert.equal(payload.configPath, env.configPath)

    // 磁盘已写回新格式：有 text 块、没有顶层 endpoint
    const onDisk = JSON.parse(await readFile(env.configPath, 'utf-8'))
    assert.equal(onDisk.text.model, 'old-model')
    assert.equal(onDisk.text.apiKey, 'sk-legacy-9876', 'key 仍在本机文件里')
    assert.equal(onDisk.endpoint, undefined, '旧顶层字段不再留')
    assert.ok(onDisk.updatedAt, '写回带 updatedAt')

    // 旧端点仍返回旧形状（MCP/旧前端兼容）
    const legacy = await (await env.get('/api/agent/config')).json()
    assert.equal(legacy.endpoint, 'https://api.example.com/v1/chat/completions')
    assert.equal(legacy.model, 'old-model')
    assert.equal(legacy.configured, true)
    assert.equal(legacy.chineseReasoning, false)
  } finally {
    await env.close()
  }
})

test('配置：apiKey 只回尾号，完整 key 不出现在任何响应里', async () => {
  const env = await makeEnv()
  try {
    const saved = await (await env.send('PUT', '/api/config', {
      text: { endpoint: 'http://127.0.0.1:9/v1', model: 'm', apiKey: 'sk-abcdef-4321' }
    })).json()
    assert.equal(saved.ok, true)
    assert.equal(saved.text.apiKeyMasked, '••••4321')
    assert.ok(!JSON.stringify(saved).includes('sk-abcdef-4321'), 'PUT 响应不回显完整 key')

    const got = await (await env.get('/api/config')).json()
    assert.ok(!JSON.stringify(got).includes('sk-abcdef-4321'), 'GET 响应不回显完整 key')
    assert.equal(got.text.apiKeyMasked, '••••4321')

    // 旧端点同样只回尾号
    const legacy = await (await env.get('/api/agent/config')).json()
    assert.equal(legacy.apiKeyMasked, '••••4321')
    assert.ok(!JSON.stringify(legacy).includes('sk-abcdef-4321'))
  } finally {
    await env.close()
  }
})

test('配置：probe 对不可达 endpoint 回 reachable:false 不抛；坏 kind 400', async () => {
  const env = await makeEnv()
  try {
    await env.send('PUT', '/api/config', { text: { endpoint: 'http://127.0.0.1:9/v1', model: 'm' } })
    const res = await env.send('POST', '/api/config/probe', { kind: 'text' })
    assert.equal(res.status, 200, '不可达不是 5xx——如实回探测结果')
    const payload = await res.json()
    assert.equal(payload.ok, true)
    assert.equal(payload.kind, 'text')
    assert.equal(payload.reachable, false)
    assert.equal(typeof payload.latencyMs, 'number')
    assert.ok(payload.error, '要带原因（UNREACHABLE/TIMEOUT）')

    // 没填 endpoint 的块：同样如实回，不抛
    const empty = await (await env.send('POST', '/api/config/probe', { kind: 'vision' })).json()
    assert.equal(empty.reachable, false)
    assert.equal(empty.error, 'NOT_CONFIGURED')

    const bad = await env.send('POST', '/api/config/probe', { kind: 'audio' })
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error.code, 'INVALID_ENTRY')
  } finally {
    await env.close()
  }
})

test('配置：probe 支持 overrides（用未保存的值试连）且三种 kind 都能报可达', async () => {
  const env = await makeEnv()
  const seen = []
  const upstream = createServer((req, res) => {
    let raw = ''
    req.on('data', (chunk) => { raw += chunk })
    req.on('end', () => {
      seen.push({ url: req.url, body: raw ? JSON.parse(raw) : null })
      res.writeHead(200, { 'content-type': 'application/json' })
      if (req.url.includes('/images/generations')) {
        res.end(JSON.stringify({ data: [{ b64_json: 'aGVsbG8=' }] }))
        return
      }
      const body = raw ? JSON.parse(raw) : {}
      const isVision = Array.isArray(body.messages?.[0]?.content)
      res.end(JSON.stringify({ choices: [{ message: { content: isVision ? '红色' : 'pong' } }] }))
    })
  })
  await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${upstream.address().port}`
  try {
    // 磁盘里的 text 是不可达的；overrides 指向夹具上游 → 可达
    await env.send('PUT', '/api/config', { text: { endpoint: 'http://127.0.0.1:9/v1', model: 'saved' } })
    const overridden = await (await env.send('POST', '/api/config/probe', {
      kind: 'text', overrides: { endpoint: `${base}/v1`, model: 'probe-model' }
    })).json()
    assert.equal(overridden.reachable, true)
    assert.equal(overridden.model, 'probe-model')
    assert.equal(seen.at(-1).url, '/v1/chat/completions')
    assert.equal(seen.at(-1).body.messages[0].content, 'ping')
    assert.equal(seen.at(-1).body.max_tokens, 1)

    // 生图：拿得到 b64_json 即可达
    const image = await (await env.send('POST', '/api/config/probe', {
      kind: 'image', overrides: { endpoint: `${base}/v1`, model: 'img-probe' }
    })).json()
    assert.equal(image.reachable, true)
    assert.equal(seen.at(-1).url, '/v1/images/generations')
    assert.equal(seen.at(-1).body.size, '256x256')
    assert.equal(seen.at(-1).body.response_format, 'b64_json')

    // 识图：内联 PNG 问颜色，有回复即可达
    const vision = await (await env.send('POST', '/api/config/probe', {
      kind: 'vision', overrides: { endpoint: `${base}/v1`, model: 'vision-probe' }
    })).json()
    assert.equal(vision.reachable, true)
    const content = seen.at(-1).body.messages[0].content
    assert.ok(Array.isArray(content), '识图探针发多模态 content')
    assert.match(content[1].image_url.url, /^data:image\/png;base64,/u)

    // 已保存的 text 没被 overrides 改掉
    const got = await (await env.get('/api/config')).json()
    assert.equal(got.text.endpoint, 'http://127.0.0.1:9/v1')
    assert.equal(got.text.model, 'saved')
  } finally {
    await new Promise((resolve) => upstream.close(resolve))
    await env.close()
  }
})

test('配置：configPut 分块写——只传 image 不改 text；坏类型 400', async () => {
  const env = await makeEnv()
  try {
    await env.send('PUT', '/api/config', {
      text: { endpoint: 'https://api.example.com/v1/chat/completions', model: 'keep-me', apiKey: 'sk-keep-7777' }
    })
    const saved = await (await env.send('PUT', '/api/config', {
      image: { enabled: true, endpoint: 'https://img.example.com/v1', model: 'gpt-image-1', apiKey: 'sk-img-5555' }
    })).json()
    assert.equal(saved.ok, true)
    assert.equal(saved.image.enabled, true)
    assert.equal(saved.image.endpoint, 'https://img.example.com/v1')
    assert.equal(saved.image.apiKeyMasked, '••••5555')
    assert.equal(saved.text.model, 'keep-me', '只传 image 时 text 原样保留')
    assert.equal(saved.text.apiKeyMasked, '••••7777')

    // 块内缺省＝保留；空串＝清除
    const patched = await (await env.send('PUT', '/api/config', { text: { model: 'new-model' } })).json()
    assert.equal(patched.text.model, 'new-model')
    assert.equal(patched.text.endpoint, 'https://api.example.com/v1/chat/completions')
    const cleared = await (await env.send('PUT', '/api/config', { image: { endpoint: '' } })).json()
    assert.equal(cleared.image.endpoint, '')
    assert.equal(cleared.image.model, 'gpt-image-1', '未传的字段保留')

    // 坏类型：image.enabled 不是布尔 → 400
    const bad = await env.send('PUT', '/api/config', { image: { enabled: 'yes' } })
    assert.equal(bad.status, 400)
    assert.equal((await bad.json()).error.code, 'INVALID_ENTRY')
  } finally {
    await env.close()
  }
})
