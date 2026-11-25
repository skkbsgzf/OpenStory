/**
 * fact 曲线端点用例（OS-41·分析对齐故事源线）——章级序列/情绪/剧情点/事件数，无故事源数据降级。
 * 跑法：node --test test/fact-curve.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { startDaemon } from '../src/host/daemon.mjs'
import { validateResponse } from '../src/api/contracts.mjs'
import { writeE2eBookFixture } from './fixtures/osE2eBook.mjs'

async function makeLibrary(base, name) {
  const root = join(base, name)
  await mkdir(join(root, '正文'), { recursive: true })
  const preferencesPath = join(base, `${name}-prefs.json`)
  await writeFile(preferencesPath, JSON.stringify({ schemaVersion: 1, libraries: [{ path: root, name }] }), 'utf-8')
  return { root, preferencesPath }
}

test('fact 曲线：无故事源数据 → chapters 空 books 空，降级 200', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-factcurve-'))
  try {
    const { root, preferencesPath } = await makeLibrary(base, '无故事源库')
    const daemon = await startDaemon({ port: 0, preferencesPath, env: { ...process.env, LOCALAPPDATA: base }, logger: { log() {} } })
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.port}/api/fact/curve?${new URLSearchParams({ root }).toString()}`)
      assert.equal(res.status, 200)
      const payload = await res.json()
      assert.equal(payload.ok, true)
      assert.equal(payload.bookId, '')
      assert.deepEqual(payload.chapters, [])
      assert.equal(validateResponse('factCurveGet', payload).ok, true)
    } finally {
      await daemon.close()
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('fact 曲线：e2e 夹具库 → 三章序列（功能/情绪/剧情点/事件数），bookId 缺省取唯一一本', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os-factcurve2-'))
  try {
    const { root, preferencesPath } = await makeLibrary(base, '夹具库')
    // 复用 e2e fact 夹具（故事源/ 三章 fact）——OS-135② 起夹具真相收编进 fixtures/osE2eBook.mjs，
    // 写进本用例的临时目录（不再 cp 未跟踪的 test/fixtures/os-e2e 残留）
    await writeE2eBookFixture(root)
    const daemon = await startDaemon({ port: 0, preferencesPath, env: { ...process.env, LOCALAPPDATA: base }, logger: { log() {} } })
    try {
      const res = await fetch(`http://127.0.0.1:${daemon.port}/api/fact/curve?${new URLSearchParams({ root }).toString()}`)
      assert.equal(res.status, 200)
      const payload = await res.json()
      assert.equal(payload.ok, true)
      assert.equal(payload.bookId, 'e2e-book')
      assert.equal(payload.chapters.length >= 2, true, '至少两章才能成曲线')
      const first = payload.chapters[0]
      assert.equal(Number.isInteger(first.no), true)
      assert.equal(typeof first.emotion, 'string')
      assert.equal(Number.isInteger(first.beats), true)
      assert.equal(Number.isInteger(first.events), true)
      assert.equal(validateResponse('factCurveGet', payload).ok, true)
      // bookId 显式指定也可
      const res2 = await fetch(`http://127.0.0.1:${daemon.port}/api/fact/curve?${new URLSearchParams({ root, bookId: 'e2e-book' }).toString()}`)
      const payload2 = await res2.json()
      assert.equal(payload2.bookId, 'e2e-book')
    } finally {
      await daemon.close()
    }
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
