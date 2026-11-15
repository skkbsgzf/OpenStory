import { startDaemon } from '../daemon.mjs'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const base = await mkdtemp(join(tmpdir(), 'os18-dbg-'))
const runtimeDir = join(base, 'PinaxNext', 'openstory', 'runtimes', 'fake-cli')
await mkdir(runtimeDir, { recursive: true })
await writeFile(join(runtimeDir, 'manifest.json'), JSON.stringify({
  schemaVersion: 'openstory-runtime-kit@1', id: 'fake-cli', name: '假 CLI', kind: 'cli',
  probe: { cmd: process.execPath, args: ['--version'] }, cliArgs: ['-p', '{prompt}']
}), 'utf-8')
const prefs = join(base, 'p.json')
await writeFile(prefs, JSON.stringify({ recentProjects: [] }), 'utf-8')
const daemon = await startDaemon({ port: 0, preferencesPath: prefs, env: { ...process.env, LOCALAPPDATA: base }, logger: { log() {} } })
const shelves = await (await fetch(`http://127.0.0.1:${daemon.port}/api/agent/runtimes`)).json()
console.log('runtime ids:', shelves.runtimes.map((r) => r.id).join(','))
console.log('userDir:', shelves.userDir)
await daemon.close()
await rm(base, { recursive: true, force: true })
