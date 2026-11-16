/** E2E 用 daemon 启动器：fixture 库 + fixture agent-config（endpoint 型 → mock LLM）。 */
import { startDaemon } from '../daemon.mjs'
import { resolve } from 'node:path'

const ROOT = resolve('test/fixtures/os-e2e')
await startDaemon({
  port: 8811,
  root: ROOT,
  preferencesPath: resolve('test/fixtures/os-e2e-prefs.json'),
  agentConfigPath: resolve('test/fixtures/os-e2e-agent-config.json')
})
