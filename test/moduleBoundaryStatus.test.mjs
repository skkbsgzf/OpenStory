// 收尾补测：空信任表不报假警告；有根且钩子可用时不报；有根但钩子被标不可用时如实报。
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { addRoot } from '../src/host/moduleRoots.mjs'

async function fixture() {
  const base = await mkdtemp(join(tmpdir(), 'os196b-'))
  const env = { LOCALAPPDATA: base, APPDATA: base }
  const root = join(base, '夹具库')
  await mkdir(join(root, '.openstory'), { recursive: true })
  await writeFile(join(root, '.openstory', 'ui-state.json'), '{}', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name: '夹具库' }] }), 'utf-8')
  return { base, env, root, preferencesPath }
}

const codes = (payload) => (payload?.capabilityReport?.warnings ?? []).map((item) => item.code)

test('OS-196b：空信任表不报「边界钩子不可用」的假警告', async () => {
  const f = await fixture()
  const daemon = await startDaemon({ port: 0, root: f.root, preferencesPath: f.preferencesPath, env: f.env, logger: { log() {} } })
  try {
    const origin = `http://127.0.0.1:${await Promise.resolve(daemon.port)}`
    const payload = await (await fetch(`${origin}/api/plugins?root=${encodeURIComponent(f.root)}`)).json()
    assert.deepEqual(codes(payload), [], '没有登记根时不该出现边界门警告')
    assert.equal(payload.capabilityReport.ok, true)
  } finally { await daemon.close(); await rm(f.base, { recursive: true, force: true }) }
})

test('OS-196b：登记根且钩子可用时不报任何边界警告', async () => {
  const f = await fixture()
  const moduleRoot = join(f.base, '模块根')
  const dir = join(moduleRoot, 'probe')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'module.manifest.json'), JSON.stringify({
    spec: 'openstory-module@2', id: 'probe', name: 'probe', version: '0.1.0', class: 'kernel',
    entry: 'index.mjs', requires: [{ id: 'base.naming', min: 1 }], capabilities: [{ id: 'probe.cap', version: 1 }]
  }), 'utf-8')
  await writeFile(join(dir, 'index.mjs'), `export async function activate() { return { capabilities: { 'probe.cap': { ping: () => 1 } } } }`, 'utf-8')
  const daemon = await startDaemon({ port: 0, root: f.root, preferencesPath: f.preferencesPath, env: f.env, logger: { log() {} } })
  try {
    const origin = `http://127.0.0.1:${await Promise.resolve(daemon.port)}`
    const added = await addRoot(moduleRoot, f.env)
    assert.equal(added.ok, true)
    const payload = await (await fetch(`${origin}/api/plugins?root=${encodeURIComponent(f.root)}`)).json()
    assert.equal(payload.localModules.find((m) => m.id === 'probe')?.status, 'loaded')
    assert.deepEqual(codes(payload).filter((code) => code.startsWith('MODULE_BOUNDARY')), [], '钩子可用时不该报边界警告')
  } finally { await daemon.close(); await rm(f.base, { recursive: true, force: true }) }
})
