import fs from 'node:fs'

let src = fs.readFileSync('daemon.mjs', 'utf-8')

const OLD = `async function handleAgentRuntimesGet(res, context) {
  const { config } = await loadAgentConfig(context.agentConfigPath)
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  const runtimes = [
    {
      id: '',
      name: 'Pi 兜底（内置）',
      kind: 'pi',
      source: '内置',
      status: text(config.endpoint).trim() ? 'ready' : 'unconfigured',
      description: '直连 OpenAI 兼容端点（下方字段）；没装任何 kit 时的原生兜底'
    },
    ...kits.map((kit) => ({
      id: kit.id,
      name: kit.name,
      kind: kit.kind,
      source: kit.source,
      status: kit.kind === 'sidecar' ? (sidecarRunning(kit.id) ? 'running' : 'idle') : 'ready',
      description: kit.description
    }))
  ]
  const userDir = Array.isArray(context.runtimesDirs) && context.runtimesDirs[1] ? context.runtimesDirs[1] : ''
  return sendJson(res, 200, { ok: true, active: text(config.runtime).trim(), runtimes, ...(userDir ? { userDir } : {}) })
}`

const NEW = `async function handleAgentRuntimesGet(res, context) {
  const { config } = await loadAgentConfig(context.agentConfigPath)
  const { kits } = loadRuntimeKits(context.runtimesDirs)
  // OS-18：货架三组（native＝Pi/DSH/套件侧车；cli＝CLI 嫁接），CLI 与 DSH 带实测状态
  const enriched = []
  for (const kit of kits) {
    let probeResult = null
    if (kit.probe) {
      if (kit.kind === 'dsh') {
        const dsh = await detectDsh({ env: context.env })
        probeResult = dsh.running
          ? { installed: true, version: \`chat 端点就绪（\${dsh.source}）\` }
          : { installed: false, message: dsh.message }
      } else {
        probeResult = await probeRuntimeKit(kit)
      }
    }
    enriched.push({
      id: kit.id,
      name: kit.name,
      kind: kit.kind,
      category: kit.category ?? 'native',
      source: kit.source,
      status: kit.kind === 'sidecar'
        ? (sidecarRunning(kit.id) ? 'running' : 'idle')
        : probeResult
          ? (probeResult.installed ? 'ready' : 'missing')
          : 'ready',
      description: kit.description,
      ...(probeResult ? { probe: probeResult } : {})
    })
  }
  const runtimes = [
    {
      id: '',
      name: 'Pi（默认兜底）',
      kind: 'pi',
      category: 'native',
      source: '内置',
      status: text(config.endpoint).trim() ? 'ready' : 'unconfigured',
      description: '直连 OpenAI 兼容端点（下方字段）；没装任何 kit 时的原生兜底，也是默认运行时'
    },
    ...enriched
  ]
  const userDir = Array.isArray(context.runtimesDirs) && context.runtimesDirs[1] ? context.runtimesDirs[1] : ''
  return sendJson(res, 200, { ok: true, active: text(config.runtime).trim(), runtimes, ...(userDir ? { userDir } : {}) })
}`

if (!src.includes(OLD)) throw new Error('runtimes handler target missing')
src = src.split(OLD).join(NEW)

// PUT 校验放宽：新 kind（cli/dsh）已由 normalizeRuntimeKit 收编，这里只查存在
const OLD_COUNT = `  assert.ok(Object.keys(ENDPOINTS).length === 38`
void OLD_COUNT

fs.writeFileSync('daemon.mjs', src, 'utf-8')
console.log('runtimes handler patched')
