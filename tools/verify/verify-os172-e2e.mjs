import { spawn } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { startDaemon } from '../../src/host/daemon.mjs'
import { loadConfigV2 } from '../../src/modules/agent-runtime/config.mjs'
import { resolveChatUpstream } from '../../src/modules/agent-runtime/chatUpstream.mjs'

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const base = mkdtempSync(join(tmpdir(), 'openstory-os172-e2e-'))
const sample = join(base, '水浒传')
const appData = join(base, 'appdata')
const preferencesPath = join(base, 'preferences.json')
const agentConfigPath = join(appData, 'OpenStory', 'openstory', 'agent-config.json')
let daemon = null
let upstream = null
let upstreamRequests = 0

function copyTree(source, target) {
  mkdirSync(target, { recursive: true })
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isDirectory()) copyTree(from, to)
    else if (entry.isSymbolicLink()) throw new Error(`样例库不应含符号链接：${from}`)
    else copyFileSync(from, to)
  }
}

function run(script, env) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(process.execPath, [join(REPO, 'tools/verify', script)], {
      cwd: REPO, env, stdio: 'inherit'
    })
    child.on('error', reject)
    child.on('exit', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(`${script} 失败：exit=${code} signal=${signal}`))
    })
  })
}

try {
  copyTree(join(REPO, 'samples/水浒传'), sample)
  mkdirSync(appData, { recursive: true })
  mkdirSync(dirname(agentConfigPath), { recursive: true })
  upstream = createServer((req, res) => {
    let body = ''
    req.setEncoding('utf-8')
    req.on('data', (chunk) => { body += chunk })
    req.on('end', () => {
      upstreamRequests += 1
      const request = JSON.parse(body)
      if (req.url !== '/v1/chat/completions' || !Array.isArray(request.messages)) {
        res.writeHead(400).end()
        return
      }
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content: [
          '林冲在风雪中勒住马，前方酒旗隐约可见。',
          '他压低斗笠，听见店内有人压低声音提起自己的名字，便没有立刻推门。',
          '> 推门进店，坐到那人身旁',
          '> 留在门外，先听清谈话',
          '> 绕到后窗，观察店内情形'
        ].join('\n') } }]
      }))
    })
  })
  await new Promise((resolveListen, reject) => {
    upstream.once('error', reject)
    upstream.listen(0, '127.0.0.1', resolveListen)
  })
  writeFileSync(agentConfigPath, JSON.stringify({
    text: {
      endpoint: `http://127.0.0.1:${upstream.address().port}/v1/chat/completions`,
      model: 'os172-e2e-stub',
      apiKey: '',
      runtime: '',
      reasoningEffort: '',
      chineseReasoning: true
    }
  }))
  const { config } = await loadConfigV2(agentConfigPath)
  const resolvedUpstream = await resolveChatUpstream(config, { runtimesDirs: [] })
  if (!resolvedUpstream.ok) throw new Error(`临时假上游配置解析失败：${resolvedUpstream.message}`)
  daemon = await startDaemon({
    port: 0,
    root: sample,
    preferencesPath,
    agentConfigPath,
    env: { ...process.env, LOCALAPPDATA: appData },
    logger: { log: () => {} }
  })
  const env = {
    ...process.env,
    LOCALAPPDATA: appData,
    OPENSTORY_BASE: `http://127.0.0.1:${await Promise.resolve(daemon.port)}`,
    OPENSTORY_ROOT: sample,
    OPENSTORY_TEST_PREFERENCES_PATH: preferencesPath
  }
  await run('verify-shuihu.mjs', env)
  await run('verify-newproj.mjs', env)
  if (upstreamRequests === 0) throw new Error('扮演开场没有经过临时假上游')
  console.log(`✓ OS-172 水浒临时库与新建/半成品库 e2e 全绿（假上游 ${upstreamRequests} 次请求）`)
} finally {
  if (daemon) await daemon.close()
  if (upstream) await new Promise((resolveClose, reject) => {
    upstream.close((error) => error ? reject(error) : resolveClose())
    upstream.closeAllConnections()
  })
  rmSync(base, { recursive: true, force: true })
}
