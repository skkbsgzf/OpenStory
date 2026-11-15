import { createOpenStoryHandler } from '../daemon.mjs'
import { loadRuntimeKits, defaultUserRuntimesDir, builtinRuntimesDir } from '../runtimes.mjs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const base = await mkdtemp(join(tmpdir(), 'os18-c-'))
const dir = join(base, 'PinaxNext', 'openstory', 'runtimes')
await mkdir(join(dir, 'fake-cli'), { recursive: true })
await writeFile(join(dir, 'fake-cli', 'manifest.json'), JSON.stringify({ schemaVersion: 'openstory-runtime-kit@1', id: 'fake-cli', name: 'F', kind: 'cli', probe: { cmd: 'node', args: [] }, cliArgs: ['-p','{prompt}'] }), 'utf-8')
const env = { ...process.env, LOCALAPPDATA: base }
console.log('builtin:', builtinRuntimesDir())
console.log('resolved dirs:', [builtinRuntimesDir(), defaultUserRuntimesDir(env)])
const { kits } = loadRuntimeKits([builtinRuntimesDir(), defaultUserRuntimesDir(env)])
console.log('kits direct:', kits.map(k => k.id).join(','))
