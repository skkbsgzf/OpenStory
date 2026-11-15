import fs from 'node:fs'

let src = fs.readFileSync('public/app.js', 'utf-8')

const OLD = `function settingsRuntimeSectionHtml() {
  const runtimeCards = (agent.runtimeList || []).map((runtime) => \`
    <button class="big-opt\${runtime.id === agent.runtime ? ' on' : ''}" data-runtime-id="\${esc(runtime.id)}">
      <b>\${esc(runtime.name)}<span class="src">\${esc(runtime.source)}</span></b>
      <span>\${esc(runtime.description || '')}\${runtime.status && runtime.status !== 'ready' ? \` · 状态：\${esc(runtime.status)}\` : ''}</span>
    </button>\`).join('')`

const NEW = `// 运行时状态标（OS-18：货架三组＋实测状态）
const RUNTIME_STATUS_LABEL = {
  ready: '就绪', idle: '待拉起', running: '运行中', unconfigured: '未配置', missing: '不可用'
}

function runtimeCard(runtime) {
  const on = runtime.id === agent.runtime
  const status = RUNTIME_STATUS_LABEL[runtime.status] ?? runtime.status ?? ''
  const probe = runtime.probe ?? null
  const probeNote = probe?.version ? \` · \${esc(probe.version)}\` : probe?.message ? \` · \${esc(probe.message)}\` : ''
  return \`<button class="big-opt\${on ? ' on' : ''}\${runtime.status === 'missing' ? ' is-missing' : ''}" data-runtime-id="\${esc(runtime.id)}">
    <b>\${esc(runtime.name)}<span class="src">\${esc(runtime.source)}</span><span class="rt-status \${esc(runtime.status || '')}">\${esc(status)}</span></b>
    <span>\${esc(runtime.description || '')}\${probeNote}</span>
  </button>\`
}

function settingsRuntimeSectionHtml() {
  const groups = [
    { key: 'native', label: '原生 / 套件' },
    { key: 'dsh', label: 'DSH 原生' },
    { key: 'cli', label: 'CLI 服务（嫁接）' }
  ]
  const runtimeCards = groups.map((group) => {
    const items = (agent.runtimeList || []).filter((runtime) => (runtime.category ?? 'native') === group.key)
    if (items.length === 0) return ''
    return \`<div class="runtime-group"><div class="runtime-group-head">\${esc(group.label)}</div><div class="big-opts">\${items.map(runtimeCard).join('')}</div></div>\`
  }).join('')`

if (!src.includes(OLD)) throw new Error('runtime section target missing')
src = src.split(OLD).join(NEW)
fs.writeFileSync('public/app.js', src, 'utf-8')
console.log('runtime shelf UI patched')
