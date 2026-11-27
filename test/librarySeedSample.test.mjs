/**
 * OS-232：官方样例库首次启动登记。
 *
 * 背景：仓库自带 samples/水浒传，但产品此前没有任何一步把它登记进本机库清单，
 * 清空/首次安装后打开就是「还没有库」。这里钉死四条行为：
 *   ① 清单缺失 → 登记一条 source=openstory 的样例；
 *   ② 已有清单 → 绝不再塞回（作者删掉 sample 是明确意图）；
 *   ③ 样例目录不是本产品库 → 跳过；
 *   ④ OPENSTORY_SEED_SAMPLE=0 → 关闭。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { seedOfficialSample, SAMPLE_DIR_NAME } from '../src/modules/library/seedSample.mjs'
import {
  readLibraryManifest, resolveLibraryManifestPath, writeLibraryManifest
} from '../src/modules/storage/libraryManifest.mjs'

const deps = { readLibraryManifest, writeLibraryManifest, resolveLibraryManifestPath }

async function fixture({ withSample = true, productMarker = true } = {}) {
  const base = await mkdtemp(join(tmpdir(), 'openstory-seed-'))
  const repoRoot = join(base, 'repo')
  const sample = join(repoRoot, 'samples', SAMPLE_DIR_NAME)
  if (withSample) {
    await mkdir(join(sample, '.openstory'), { recursive: true })
    if (productMarker) {
      await writeFile(join(sample, '.openstory', 'project.json'),
        JSON.stringify({ spec: 'openstory-project@4', schemaVersion: 4, name: SAMPLE_DIR_NAME }))
    }
  }
  const env = { LOCALAPPDATA: join(base, 'local'), APPDATA: join(base, 'local') }
  return { base, repoRoot, sample, env }
}

test('清单缺失时登记官方样例副本（不登记源码树），且只写一条 source=openstory', async () => {
  const fx = await fixture()
  try {
    const result = await seedOfficialSample({ repoRoot: fx.repoRoot, env: fx.env, ...deps })
    assert.equal(result.ok, true)
    assert.equal(result.seeded, true)
    // 关键：登记的是院子里的副本，不是仓库源码树——否则 daemon 会把 ui-state/日志写进仓库。
    const expected = join(fx.base, 'local', 'OpenStory', 'samples', SAMPLE_DIR_NAME)
    assert.equal(result.samplePath, expected)
    assert.notEqual(result.samplePath, fx.sample)
    const written = JSON.parse(await readFile(result.path, 'utf-8'))
    assert.equal(written.schemaVersion, 1)
    assert.equal(written.libraries.length, 1)
    assert.equal(written.libraries[0].path, expected)
    assert.equal(written.libraries[0].name, SAMPLE_DIR_NAME)
    assert.equal(written.libraries[0].source, 'openstory')
    // 副本必须是可打开的库（带 project.json）
    await readFile(join(expected, '.openstory', 'project.json'), 'utf-8')
    // 再读一次必须能被正常识别（不是坏档）
    const reread = readLibraryManifest({ preferencesPath: '', env: fx.env })
    assert.equal(reread.warnings.length, 0)
    assert.equal(reread.libraries.length, 1)
  } finally { await rm(fx.base, { recursive: true, force: true }) }
})

test('样例副本已存在时复用，不覆盖作者改过的那份', async () => {
  const fx = await fixture()
  try {
    const target = join(fx.base, 'local', 'OpenStory', 'samples', SAMPLE_DIR_NAME)
    await mkdir(join(target, '.openstory'), { recursive: true })
    await writeFile(join(target, '.openstory', 'project.json'),
      JSON.stringify({ spec: 'openstory-project@4', schemaVersion: 4, name: SAMPLE_DIR_NAME }))
    await writeFile(join(target, '作者改动.md'), '# 作者自己写的\n')
    const result = await seedOfficialSample({ repoRoot: fx.repoRoot, env: fx.env, ...deps })
    assert.equal(result.seeded, true)
    assert.equal(result.samplePath, target)
    // 作者的文件必须还在
    assert.equal(await readFile(join(target, '作者改动.md'), 'utf-8'), '# 作者自己写的\n')
  } finally { await rm(fx.base, { recursive: true, force: true }) }
})

test('已有清单时不再塞回样例（作者删掉是明确意图）', async () => {
  const fx = await fixture()
  try {
    const target = resolveLibraryManifestPath({ preferencesPath: '', env: fx.env })
    await mkdir(join(fx.base, 'local', 'OpenStory'), { recursive: true })
    await writeFile(target, JSON.stringify({
      schemaVersion: 1,
      libraries: [{ path: join(fx.base, 'other'), name: '别的库', addedAt: '', source: 'imported' }]
    }))
    const result = await seedOfficialSample({ repoRoot: fx.repoRoot, env: fx.env, ...deps })
    assert.equal(result.seeded, false)
    assert.equal(result.reason, 'manifest-exists')
    const after = JSON.parse(await readFile(target, 'utf-8'))
    assert.equal(after.libraries.length, 1, '不许追加样例')
    assert.equal(after.libraries[0].name, '别的库')
  } finally { await rm(fx.base, { recursive: true, force: true }) }
})

test('样例缺失或不是本产品库时跳过，不写清单', async () => {
  for (const options of [{ withSample: false }, { withSample: true, productMarker: false }]) {
    const fx = await fixture(options)
    try {
      const result = await seedOfficialSample({ repoRoot: fx.repoRoot, env: fx.env, ...deps })
      assert.equal(result.ok, true)
      assert.equal(result.seeded, false)
      assert.equal(result.reason, 'sample-missing')
      const target = resolveLibraryManifestPath({ preferencesPath: '', env: fx.env })
      const reread = readLibraryManifest({ preferencesPath: '', env: fx.env })
      assert.equal(reread.libraries.length, 0)
      assert.ok(reread.warnings.some((item) => item.code === 'PREFERENCES_MISSING'), `不应写清单：${target}`)
    } finally { await rm(fx.base, { recursive: true, force: true }) }
  }
})

test('显式清单路径（测试/--preferences）时不播种——不往夹具院子塞样例副本', async () => {
  const fx = await fixture()
  try {
    const explicit = join(fx.base, 'explicit-libraries.json')
    const result = await seedOfficialSample({ repoRoot: fx.repoRoot, env: fx.env, preferencesPath: explicit, ...deps })
    assert.equal(result.seeded, false)
    assert.equal(result.reason, 'explicit-manifest')
    const reread = readLibraryManifest({ preferencesPath: explicit, env: fx.env })
    assert.equal(reread.libraries.length, 0)
  } finally { await rm(fx.base, { recursive: true, force: true }) }
})

test('OPENSTORY_SEED_SAMPLE=0 关闭播种', async () => {
  const fx = await fixture()
  try {
    const result = await seedOfficialSample({
      repoRoot: fx.repoRoot, env: { ...fx.env, OPENSTORY_SEED_SAMPLE: '0' }, ...deps
    })
    assert.equal(result.seeded, false)
    assert.equal(result.reason, 'disabled')
  } finally { await rm(fx.base, { recursive: true, force: true }) }
})
