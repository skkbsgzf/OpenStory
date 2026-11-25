/**
 * OS-160 样例库「打开即复现」＋套件状态库级化用例（node:test）。
 *
 * 钉死四件事：
 *   ① 样例库自带的 ui-state.json / 插件 suite-state.json 在版本库里（随库走）；
 *   ② 把样例库拷到临时目录并登记后，经真实 API 读到的界面状态/套件状态与样例文件逐项相等；
 *   ③ 两个库可以有不同套件启停（库级化），没开库时读写机器级且不污染任何库；
 *   ④ 库内套件状态文件坏档时如实报错并回落，不静默吞掉。
 *
 * 夹具纪律：LOCALAPPDATA 临时注入；绝不碰 D:/Projects 作者真库；跑完清临时目录。
 * 跑法：node --test test/sampleConfig.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtempSync, cpSync, mkdirSync, writeFileSync, rmSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  resolveSuiteStatePath,
  loadSuiteState,
  saveSuiteSettings,
  setSuiteEnabled
} from '../src/services/suites.mjs'
import { defaultSuiteStatePath } from '../src/services/suites.mjs'

const HERE = join(fileURLToPath(import.meta.url), '..', '..')
const SAMPLE = join(HERE, 'samples', '水浒传')
const BUILTIN_SUITES = join(HERE, 'suites')
const dirs = [BUILTIN_SUITES]
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

function fixture() {
  const base = mkdtempSync(join(tmpdir(), 'os160-sample-'))
  const env = { ...process.env, LOCALAPPDATA: base, APPDATA: base }
  return { base, env, cleanup: () => rmSync(base, { recursive: true, force: true }) }
}

test('样例库自带配置在版本库里，形状与值可解析', () => {
  const uiPath = join(SAMPLE, '.openstory', 'ui-state.json')
  const suitePath = join(SAMPLE, '.openstory', 'plugins', 'suite-state.json')
  assert.equal(existsSync(uiPath), true, '样例库应有 .openstory/ui-state.json')
  assert.equal(existsSync(suitePath), true, '样例库应有 .openstory/plugins/suite-state.json')
  const project = JSON.parse(readFileSync(join(SAMPLE, '.openstory', 'project.json'), 'utf-8'))
  assert.equal(project.spec, 'openstory-project@4')
  assert.equal(project.schemaVersion, 4)
  for (const dir of ['正文', '世界书', '故事源', '扮演', '习惯']) {
    assert.equal(existsSync(join(SAMPLE, dir)), true, `样例库应有 ${dir}/`)
  }
  for (const dir of ['.pinax', '参考', '拆解', '推演', '导出']) {
    assert.equal(existsSync(join(SAMPLE, dir)), false, `样例库不应残留 ${dir}/`)
  }
  const ui = JSON.parse(readFileSync(uiPath, 'utf-8'))
  const state = JSON.parse(readFileSync(suitePath, 'utf-8'))
  assert.equal(typeof ui, 'object')
  assert.equal(state.suites?.writing?.enabled, true)
  assert.equal(state.suites.writing.values.newChapterTitle, '第{N}章')
})

test('路径单一入口：库内有文件用库内，否则回落机器级；写开着库就写库内', async () => {
  const f = fixture()
  try {
    const machine = defaultSuiteStatePath(f.env)
    const root = join(f.base, 'lib-a')
    mkdirSync(root, { recursive: true })
    // 库内没有 → 读回落机器级
    assert.deepEqual(resolveSuiteStatePath({ root, machinePath: machine, mode: 'read' }), { path: machine, scope: 'machine' })
    // 写：开着库就写库内（没有也建）
    const w = await saveSuiteSettings(dirs, machine, 'writing', { newChapterTitle: '库A章', deduceBranches: 3 }, root)
    assert.equal(w.ok, true)
    const libFile = join(root, '.openstory', 'plugins', 'suite-state.json')
    assert.equal(existsSync(libFile), true, '写应落库内')
    assert.equal(existsSync(machine), false, '没开库才写机器级——开着库不该碰机器级文件')
    // 库内有文件 → 读用库内
    assert.deepEqual(resolveSuiteStatePath({ root, machinePath: machine, mode: 'read' }), { path: libFile, scope: 'library' })
    const loaded = await loadSuiteState(machine, root)
    assert.equal(loaded.state.suites.writing.values.newChapterTitle, '库A章')
  } finally { f.cleanup() }
})

test('两个库套件启停互不影响；没开库写机器级且不污染库', async () => {
  const f = fixture()
  try {
    const machine = defaultSuiteStatePath(f.env)
    const rootA = join(f.base, 'lib-a')
    const rootB = join(f.base, 'lib-b')
    mkdirSync(rootA, { recursive: true })
    mkdirSync(rootB, { recursive: true })
    await setSuiteEnabled(dirs, machine, 'writing', false, rootA)
    await setSuiteEnabled(dirs, machine, 'writing', true, rootB)
    const a = await loadSuiteState(machine, rootA)
    const b = await loadSuiteState(machine, rootB)
    assert.equal(a.state.suites.writing.enabled, false)
    assert.equal(b.state.suites.writing.enabled, true)
    // 没开库（root 空）写机器级
    await setSuiteEnabled(dirs, machine, 'writing', false, '')
    assert.equal(existsSync(machine), true)
    const global = await loadSuiteState(machine, '')
    assert.equal(global.state.suites.writing.enabled, false)
    // 机器级改动没回头污染两个库
    assert.equal((await loadSuiteState(machine, rootB)).state.suites.writing.enabled, true)
  } finally { f.cleanup() }
})

test('库内套件状态坏档：如实报 warning 并回落空状态，不静默', async () => {
  const f = fixture()
  try {
    const machine = defaultSuiteStatePath(f.env)
    const root = join(f.base, 'lib-bad')
    const libFile = join(root, '.openstory', 'plugins', 'suite-state.json')
    mkdirSync(join(root, '.openstory', 'plugins'), { recursive: true })
    writeFileSync(libFile, '{坏档', 'utf-8')
    const loaded = await loadSuiteState(machine, root)
    assert.deepEqual(loaded.state, { suites: {} })
    assert.ok(loaded.warnings.length > 0, '坏档必须有 warning，不能静默吞掉')
  } finally { f.cleanup() }
})

test('打开即复现：临时登记样例库副本，经真实 API 读到的配置与样例文件逐项相等', async () => {
  const f = fixture()
  const port = 21000 + Math.floor(Math.random() * 5000)
  const root = join(f.base, '水浒传')
  // 只拷点名的两个配置文件到临时库根——daemon 带 --root 启动不要求库内有稿件；
  // 整库 cpSync 会带上 mp3/png 二进制（本环境 cpSync 二进制曾段错误），测试用不到它们。
  mkdirSync(join(root, '.openstory'), { recursive: true })
  mkdirSync(join(root, '.openstory', 'plugins'), { recursive: true })
  cpSync(join(SAMPLE, '.openstory', 'ui-state.json'), join(root, '.openstory', 'ui-state.json'))
  cpSync(join(SAMPLE, '.openstory', 'plugins', 'suite-state.json'), join(root, '.openstory', 'plugins', 'suite-state.json'))
  let child = null
  try {
    child = spawn(process.execPath, ['src/host/daemon.mjs', `--port=${port}`, `--root=${root}`], {
      cwd: HERE, env: f.env, stdio: 'ignore'
    })
    let up = false
    // OS-169：并发全量下 daemon 启动实测可到 12.9s，原 60×200ms=12s 预算会假红；
    // 放宽到 90×200ms=18s（只放宽等待，不放宽任何配置断言）。
    for (let i = 0; i < 90; i += 1) {
      await wait(200)
      try {
        const r = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(1000) })
        if (r.ok) { up = true; break }
      } catch { /* 等 */ }
    }
    assert.ok(up, '临时 daemon 应能起')

    const q = `root=${encodeURIComponent(root)}`
    const suites = await (await fetch(`http://127.0.0.1:${port}/api/suites?${q}`)).json()
    const ui = await (await fetch(`http://127.0.0.1:${port}/api/ui-state?${q}`)).json()
    const expectedSuite = JSON.parse(readFileSync(join(SAMPLE, '.openstory', 'plugins', 'suite-state.json'), 'utf-8'))
    const expectedUi = JSON.parse(readFileSync(join(SAMPLE, '.openstory', 'ui-state.json'), 'utf-8'))
    const writing = suites.suites.find((s) => s.id === 'writing')
    assert.equal(writing.enabled, expectedSuite.suites.writing.enabled)
    assert.equal(writing.values.newChapterTitle, expectedSuite.suites.writing.values.newChapterTitle)
    assert.equal(writing.values.deduceBranches, expectedSuite.suites.writing.values.deduceBranches)
    assert.deepEqual(ui.state, expectedUi)
  } finally {
    if (child) { try { child.kill('SIGTERM') } catch { /* 已退 */ } }
    await wait(300)
    f.cleanup()
  }
})
