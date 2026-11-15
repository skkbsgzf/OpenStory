import { createOpenStoryHandler } from '../daemon.mjs'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createServer } from 'node:http'
const base = await mkdtemp(join(tmpdir(), 'os18-d-'))
const dir = join(base, 'PinaxNext', 'openstory', 'runtimes')
await mkdir(join(dir, 'fake-cli'), { recursive: true })
await writeFile(join(dir, 'fake-cli', 'manifest.json'), JSON.stringify({ schemaVersion: 'openstory-runtime-kit@1', id: 'fake-cli', name: 'F', kind: 'cli', probe: { cmd: 'node', args: [] }, cliArgs: ['-p','{prompt}'] }), 'utf-8')
const env = { ...process.env, LOCALAPPDATA: base }
const handler = createOpenStoryHandler({ env, logger: { log() {} } })
const server = createServer((req, res) => handler(req, res))
await new Promise((ok) => server.listen(0, '127.0.0.1', ok))
const res = await fetch(`http://127.0.0.1:${server.address().port}/api/agent/runtimes`)
const text = await res.text()
console.log('status:', res.status)
console.log('has fake:', text.includes('fake-cli'))
console.log('body head:', text.slice(0, 260))
server.close()
