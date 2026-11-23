/**
 * OS-142 Host API 入口护栏——src/protocol/index.mjs 的版本字面量、冻结与键清单快照。
 *
 * 跑法：node --test test/hostApi.test.mjs（npm test 全量的一分子）
 *
 * 键清单快照的约定：index.mjs 增删任何命名空间成员，本文件的 SNAPSHOT 必须同步改——
 * 改快照这个动作本身就是「显式确认」；破坏性变更（删成员/改签名）还要升 HOST_API_VERSION
 * 到 host-api@2（见 src/protocol/README.md 版本约定）。
 *
 * 装载序说明：本文件先 import index.mjs（index→pinaxAdapter→library fork 点方向）；
 * 反方向（fork 点先装）用子进程单独起一趟——node --test 每个文件各起一个进程，同进程内
 * ESM 模块表不能倒序重放，而循环边（fork 点↔adapter↔协议叶子）必须两个方向都真跑过
 * （与 test/decoupleStep2/Step3 的双向冒烟同一手法）。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import {
  HOST_API_VERSION,
  fact,
  prose,
  changelog,
  jobs,
  events,
  plugins,
  guard
} from '../src/protocol/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('HOST_API_VERSION 是字面量 host-api@1', () => {
  assert.equal(HOST_API_VERSION, 'host-api@1')
  assert.equal(typeof HOST_API_VERSION, 'string')
})

const NAMESPACES = { fact, prose, changelog, jobs, events, plugins, guard }

test('七个能力命名空间全部导出且为冻结对象', () => {
  assert.deepEqual(Object.keys(NAMESPACES).sort(), ['changelog', 'events', 'fact', 'guard', 'jobs', 'plugins', 'prose'])
  for (const [name, ns] of Object.entries(NAMESPACES)) {
    assert.ok(ns && typeof ns === 'object', `${name} 应是对象`)
    assert.equal(Object.isFrozen(ns), true, `${name} 应冻结（Object.freeze）——插件不许改写宿主能力面`)
  }
})

/* 键清单快照（2026-11-23 OS-142 建档，键序为字母序）。增删 index.mjs 的命名空间成员必须同步改这里。 */
const SNAPSHOT = {
  fact: ['deduce', 'enrich', 'factStore', 'fail', 'ok', 'projectImport', 'projectMeta', 'writeFileAtomic'],
  prose: ['HISTORY_KEEP_DEFAULT', 'chapterFileName', 'createChapter', 'deleteChapter', 'historyBackupPath', 'listChapters', 'mapWriteErrorCode', 'moduleOfPath', 'nextChapterNumber', 'parseChapterName', 'pruneHistoryBackups', 'renameChapter', 'resolveHistoryKeepPerFile', 'sanitizeChapterTitle', 'writeChapterWithBackup'],
  changelog: ['LOG_DIR', 'contentHash', 'findRestoreCandidate', 'hasLog', 'logFilePath', 'logSummary', 'readChange', 'readLatestByFile', 'readLog', 'recordChange', 'safeModuleName', 'unifiedDiff'],
  jobs: ['activeCount', 'cancelJob', 'clearSettled', 'getJob', 'listJobs', 'submitJob', 'subscribe'],
  events: ['AGENT_EVENT_AGUI_KINDS', 'AGENT_EVENT_TYPES', 'AGENT_EVENT_TYPES_SSE', 'encodeForAgui', 'projectLegacyFrame'],
  plugins: ['KIND_LABELS', 'PLUGIN_KINDS', 'listAllPlugins', 'listBlockedPlugins', 'minVersionGate', 'pluginDetail', 'pluginHealth', 'readAppVersion', 'resetAppVersionCache', 'resolveSuiteDependencies', 'satisfiesMinVersion', 'suiteAssetPath'],
  guard: ['CONTEXT_SOURCE', 'PROSE_DIRECT_READS', 'allowProseDirectRead', 'factHealth', 'loadFactContext', 'loadFactDerived', 'resetProseAudit']
}

test('命名空间键清单快照（增删导出必须改本快照＝显式确认）', () => {
  for (const [name, expected] of Object.entries(SNAPSHOT)) {
    assert.deepEqual(
      Object.keys(NAMESPACES[name]).sort(),
      expected.sort(),
      `${name} 键清单与快照不符——若是有意增删，请同步本快照与 src/protocol/README.md 能力清单；破坏性变更须升 host-api@2`
    )
  }
})

test('快照覆盖全部命名空间（快照本身不许漏命名空间）', () => {
  assert.deepEqual(Object.keys(SNAPSHOT).sort(), Object.keys(NAMESPACES).sort())
})

test('fact 命名空间与 pinaxAdapter 五组出口同源（转出不换实现）', async () => {
  const adapter = await import('../src/kernel/pinaxAdapter.mjs')
  assert.equal(fact.factStore, adapter.factStore)
  assert.equal(fact.deduce, adapter.deduce)
  assert.equal(fact.enrich, adapter.enrich)
  assert.equal(fact.projectMeta, adapter.projectMeta)
  assert.equal(fact.projectImport, adapter.projectImport)
  assert.equal(fact.ok, adapter.ok)
  assert.equal(fact.fail, adapter.fail)
  assert.equal(fact.writeFileAtomic, adapter.writeFileAtomic)
})

test('冻结是真冻结：改写命名空间成员静默失效（严格模式抛错）', () => {
  assert.throws(() => { ' infect' && (fact.deduce = null) }, TypeError)
  assert.throws(() => { jobs.submitJob = () => {} }, TypeError)
  assert.throws(() => { prose.HISTORY_KEEP_DEFAULT = 0 }, TypeError)
})

test('反方向装载序冒烟：library fork 点先于 index 装载（子进程，独立模块表）', () => {
  const loader = `
import assert from 'node:assert/strict'
const projectDoc = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'src/modules/library/projectDoc.mjs')).href)})
const mod = await import(${JSON.stringify(pathToFileURL(join(ROOT, 'src/protocol/index.mjs')).href)})
assert.equal(mod.HOST_API_VERSION, 'host-api@1')
for (const name of ['fact', 'prose', 'changelog', 'jobs', 'events', 'plugins', 'guard']) {
  assert.equal(Object.isFrozen(mod[name]), true, name)
}
assert.equal(mod.fact.projectMeta.writeProjectDocument, projectDoc.writeProjectDocument, 'fact 转出与 fork 点同源')
console.log('reverse-order ok')
`
  const r = spawnSync(process.execPath, ['--input-type=module', '--eval', loader], { encoding: 'utf-8', cwd: ROOT })
  assert.equal(r.status, 0, `反方向装载失败：${r.stderr || r.stdout}`)
  assert.ok(r.stdout.includes('reverse-order ok'))
})
