/**
 * OpenStory OS-8 用例（node:test，零依赖）——filesGet 列目录：顶层/子目录/安全/空目录。
 *
 * 跑法：
 *   node --test openstory/test/files.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { validateRequest, validateResponse } from '../src/api/contracts.mjs'
import { listLibraryFiles } from '../src/host/daemon.mjs'
import { startDaemon } from '../src/host/daemon.mjs'

async function makeFixture() {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os8-'))
  const root = join(base, '夹具库')
  await mkdir(join(root, '大纲'), { recursive: true })
  await mkdir(join(root, '大纲', '卷一'), { recursive: true })
  await mkdir(join(root, '正文'), { recursive: true })
  await mkdir(join(root, '日志'), { recursive: true })
  await mkdir(join(root, '.pinax'), { recursive: true })
  await mkdir(join(root, '.history'), { recursive: true })
  await writeFile(join(root, '大纲', '总大纲.md'), '# 总大纲\n\n三幕。', 'utf-8')
  await writeFile(join(root, '大纲', '卷一', '细纲.md'), '第一章：雨停。', 'utf-8')
  await writeFile(join(root, '大纲', '图片.png'), 'binary-ish', 'utf-8')
  await writeFile(join(root, '正文', '001-雨停.md'), '雨到傍晚才停。', 'utf-8')
  await writeFile(join(root, '日志', 'run.md'), '运行日志', 'utf-8')
  await writeFile(join(root, '顶层笔记.md'), '顶层文本', 'utf-8')
  await writeFile(join(root, '顶层二进制.bin'), 'xxx', 'utf-8')
  await writeFile(join(root, '.history', '不该出现.md'), '秘密', 'utf-8')
  const preferencesPath = join(base, 'libraries.json')
  await writeFile(preferencesPath, JSON.stringify({
    recentProjects: [{ path: root, name: '夹具库', at: '2026-11-15T00:00:00.000Z' }]
  }), 'utf-8')
  return { base, root, preferencesPath }
}

test('filesGet 顶层：dirs 收录目录、files 只收文本扩展名、隐藏与元数据不出现', async () => {
  const { base, root } = await makeFixture()
  try {
    const top = await listLibraryFiles(root)
    assert.equal(top.ok, true)
    assert.deepEqual(top.dirs, ['大纲', '日志', '正文'], 'zh-Hans-CN 拼音序')
    assert.deepEqual(top.files.map((file) => file.file), ['顶层笔记.md'])
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('filesGet 带目录：递归文本清单（深度内）、非文本与 .history 跳过', async () => {
  const { base, root } = await makeFixture()
  try {
    const outline = await listLibraryFiles(root, '大纲')
    assert.equal(outline.ok, true)
    assert.deepEqual(outline.files.map((file) => file.file), ['大纲/卷一/细纲.md', '大纲/总大纲.md'])
    assert.ok(outline.files[0].mtime)

    const logs = await listLibraryFiles(root, '日志')
    assert.equal(logs.files.length, 1)

    const missing = await listLibraryFiles(root, '构思')
    assert.equal(missing.ok, true)
    assert.deepEqual(missing.files, [])
    assert.ok(missing.warnings.some((warning) => warning.code === 'DIR_MISSING'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('filesGet 安全：路径逃逸/.pinax/多段目录名全部拒收', async () => {
  const { base, root } = await makeFixture()
  try {
    assert.equal((await listLibraryFiles(root, '../secret')).ok, false)
    assert.equal((await listLibraryFiles(root, '.pinax')).ok, false)
    assert.equal((await listLibraryFiles(root, '大纲/卷一')).ok, false, 'dir 必须单段')
    assert.equal((await listLibraryFiles(root, '大纲\\卷一')).ok, false)
    assert.equal((await listLibraryFiles(root, '.')).ok, false)
    assert.equal((await listLibraryFiles(root, '')).ok, true)
    const noRoot = await listLibraryFiles('')
    assert.equal(noRoot.ok, false)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('契约：filesGet 形状', () => {
  assert.equal(validateRequest('filesGet', {}).ok, false, 'root 必填')
  assert.equal(validateRequest('filesGet', { root: 'r' }).ok, true)
  assert.equal(validateRequest('filesGet', { root: 'r', dir: '大纲' }).ok, true)
  assert.equal(validateResponse('filesGet', { ok: true, files: [] }).ok, true)
  assert.equal(validateResponse('filesGet', { ok: true, dirs: [], files: [] }).ok, true)
  assert.equal(validateResponse('filesGet', { ok: true }).ok, false, 'files 必有')
})

test('daemon 端到端：/api/files 顶层与子目录、白名单外拒收', async () => {
  const fixture = await makeFixture()
  const daemon = await startDaemon({ port: 0, preferencesPath: fixture.preferencesPath, logger: { log() {} } })
  const origin = `http://127.0.0.1:${daemon.port}`
  const root = encodeURIComponent(fixture.root)
  try {
    const top = await (await fetch(`${origin}/api/files?root=${root}`)).json()
    assert.equal(top.ok, true)
    assert.deepEqual(top.dirs, ['大纲', '日志', '正文'])

    const outline = await (await fetch(`${origin}/api/files?root=${root}&dir=${encodeURIComponent('大纲')}`)).json()
    assert.equal(outline.ok, true)
    assert.equal(outline.files.length, 2)

    const unregistered = await fetch(`${origin}/api/files?root=${encodeURIComponent(join(fixture.base, '别的库'))}`)
    assert.equal(unregistered.status, 403)

    const escape = await fetch(`${origin}/api/files?root=${root}&dir=${encodeURIComponent('../x')}`)
    assert.equal(escape.status, 403)
  } finally {
    await daemon.close()
    await rm(fixture.base, { recursive: true, force: true })
  }
})
