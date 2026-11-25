/**
 * OpenStory OS-11 用例（node:test，零依赖）——产物盘点（全库只读分组）。
 *
 * 跑法：
 *   node --test openstory/test/artifacts.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import { listArtifacts } from '../src/host/daemon.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os11-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '导入导出'), { recursive: true })
  await mkdir(join(root, '故事源'), { recursive: true })
  await mkdir(join(root, '.openstory'), { recursive: true })
  await mkdir(join(root, '正文', '.history'), { recursive: true })
  await writeFile(join(root, '正文', '001-雨停.md'), '雨到傍晚才停。', 'utf-8')
  await writeFile(join(root, '正文', '002-渡口.md'), '雾从水面漫上来。', 'utf-8')
  await writeFile(join(root, '导入导出', '总导出.md'), '三幕。', 'utf-8')
  await writeFile(join(root, '故事源', 'book-1.json'), '{"entries":[]}', 'utf-8')
  await writeFile(join(root, '故事源', 'book-1.wiki.json'), '{}', 'utf-8')
  await writeFile(join(root, '.openstory', 'project.json'), '{"secret":"不该出现在盘点里"}', 'utf-8')
  // 历史档：001 的旧版（bak）＋002 的删除档（deleted）——按原文件归组
  await writeFile(join(root, '正文', '.history', '001-雨停.md.bak-2026-11-15T10-00-00-000Z'), '雨到傍晚才停。（旧版）', 'utf-8')
  await writeFile(join(root, '正文', '.history', '002-渡口.md.deleted-2026-11-15T11-00-00-000Z'), '雾从水面漫上来。（被删）', 'utf-8')
  await writeFile(join(root, '图片.png'), 'binary', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    schemaVersion: 1, libraries: [{ path: root, name: '夹具库', at: '2026-11-15T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath }
}

test('盘点：顶层分组、.openstory/非文本不进清单、历史档按原文件归组、totals 记账', async () => {
  const { base, root } = await makeFixture()
  try {
    const inventory = await listArtifacts(root)
    assert.equal(inventory.ok, true)
    const dirs = inventory.groups.map((group) => group.dir)
    assert.deepEqual(dirs, ['导入导出', '故事源', '正文'], 'zh-Hans-CN 拼音序')
    const zhengwen = inventory.groups.find((group) => group.dir === '正文')
    assert.deepEqual(zhengwen.files.map((file) => file.name), ['001-雨停.md', '002-渡口.md'])
    // 版本与历史：.history 档按原文件归组（bak/deleted 都认）
    assert.equal(zhengwen.history.length, 2)
    const bak = zhengwen.history.find((item) => item.kind === 'bak')
    assert.equal(bak.original, '正文/001-雨停.md')
    assert.equal(bak.originalName, '001-雨停.md')
    const deleted = zhengwen.history.find((item) => item.kind === 'deleted')
    assert.equal(deleted.original, '正文/002-渡口.md')
    assert.ok(!JSON.stringify(inventory).includes('不该出现在盘点里'), '.openstory 不进盘点')
    assert.ok(!JSON.stringify(inventory).includes('图片.png'), '非文本不进盘点')
    assert.equal(inventory.totals.files, 5)
    assert.equal(inventory.totals.histories, 2)
    assert.ok(inventory.totals.bytes > 0)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('契约：artifactsGet 形状', () => {
  assert.equal(validateRequest('artifactsGet', {}).ok, false)
  assert.equal(validateRequest('artifactsGet', { root: 'r' }).ok, true)
  assert.equal(validateResponse('artifactsGet', { ok: true, groups: [], totals: { files: 0, bytes: 0 } }).ok, true)
  assert.equal(validateResponse('artifactsGet', { ok: true, groups: [] }).ok, false, 'totals 必有')
})

test('daemon 端到端：/api/artifacts 分组盘点；白名单外 403', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({ port: 0, preferencesPath: fixture.preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  try {
    const payload = await (await fetch(`${origin}/api/artifacts?root=${encodeURIComponent(fixture.root)}`)).json()
    assert.equal(payload.ok, true)
    assert.equal(payload.groups.length, 3)
    assert.equal(payload.totals.files, 5)
    const outside = await fetch(`${origin}/api/artifacts?root=${encodeURIComponent(join(fixture.base, '别的库'))}`)
    assert.equal(outside.status, 403)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
