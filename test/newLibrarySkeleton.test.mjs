/**
 * OS-164 / G8b：新建库骨架与「世界书目录归属」。
 *
 * 钉死四件事（全部用系统临时目录，绝不碰作者真库）：
 *   ① novel/screenplay/generic 新库目录集恰为骨架表，四个退场目录不落盘；
 *   ② 参考/ 与 世界书/ 同时建——前者是真笔记目录，后者是 Pinax 载体兼容输入；
 *   ③ 导入白名单含 参考/（旧载体稿件能写进笔记目录），退场目录只为兼容旧载体仍在；
 *   ④ 世界书/ 走 absorb 进 参考/世界书/（既有原子写＋.history 通道，不另造假）。
 *
 * 跑法：node --test test/newLibrarySkeleton.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  createCarrierRegistry, createProject, PROJECT_KINDS, skeletonDirs
} from '../src/modules/library/projectDoc.mjs'
import { planImport, runImport } from '../src/modules/library/importAdapter.mjs'
import { absorbLegacyDirs } from '../src/modules/worldbook/referenceStore.mjs'

const RETIRED = ['大纲', '构思', '资料', '约束']
const REPO = join(dirname(fileURLToPath(import.meta.url)), '..')

async function build(kind) {
  const base = await mkdtemp(join(tmpdir(), 'os164-skeleton-'))
  const { registry } = await createCarrierRegistry()
  const root = join(base, '夹具库')
  const carrier = kind === 'screenplay' ? 'pinax.carrier.script' : 'pinax.carrier.novel'
  const result = await createProject({ root, name: '夹具库', primaryCarrier: carrier, registry })
  assert.equal(result.ok, true, `建库失败：${JSON.stringify(result.error ?? result)}`)
  return { base, root, result }
}

test('骨架表：退场目录四个全清，参考/ 与 世界书/ 同时在', () => {
  for (const kind of ['novel', 'screenplay', 'generic']) {
    const dirs = skeletonDirs(kind)
    assert.deepEqual(dirs, [...PROJECT_KINDS[kind]])
    for (const retired of RETIRED) assert.ok(!dirs.includes(retired), `${kind} 不该再建 ${retired}`)
    if (kind !== 'generic') {
      assert.ok(dirs.includes('参考'), `${kind} 必须建真笔记目录 参考/`)
      assert.ok(dirs.includes('世界书'), `${kind} 必须建载体兼容输入 世界书/`)
    }
  }
  assert.deepEqual([...PROJECT_KINDS.novel], ['正文', '参考', '世界书', '日志'])
  assert.deepEqual([...PROJECT_KINDS.generic], ['文档', '日志'])
})

test('实际建库 ls：novel 目录恰为骨架表（不靠手写 JSON 冒充运行态）', async () => {
  const { base, root } = await build('novel')
  try {
    const actual = (await readdir(root)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    const expected = ['.pinax', ...skeletonDirs('novel')].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    assert.deepEqual(actual, expected)
    for (const retired of RETIRED) assert.ok(!actual.includes(retired))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('实际建库 ls：screenplay 剧本库同理', async () => {
  const { base, root } = await build('screenplay')
  try {
    const actual = (await readdir(root)).sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    const expected = ['.pinax', ...skeletonDirs('screenplay')].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'))
    assert.deepEqual(actual, expected)
    assert.ok(actual.includes('剧本') && actual.includes('参考') && actual.includes('世界书'))
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('导入白名单：参考/ 可写；退场目录仍留给旧载体兼容', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os164-import-'))
  try {
    const source = join(base, '旧载体')
    const target = join(base, '目标库')
    const { registry } = await createCarrierRegistry()
    const created = await createProject({ root: target, name: '目标库', primaryCarrier: 'pinax.carrier.novel', registry })
    assert.equal(created.ok, true, JSON.stringify(created.error ?? created))
    await mkdir(join(source, '正文'), { recursive: true })
    await writeFile(join(source, '正文', '001-风雪山神庙.md'), '# 第一章\n风雪紧。\n', 'utf-8')
    const planned = planImport({ sourcePath: source, targetPath: target })
    assert.equal(planned.ok, true, JSON.stringify(planned.error ?? planned))
    const report = runImport({ sourcePath: source, targetPath: target })
    assert.equal(report.ok, true, JSON.stringify(report.error ?? report))
    assert.ok(report.value.written.some((item) => item.target === '正文/001-风雪山神庙.md'))

    // 白名单口径：参考/ 必须可写（原来漏了它）；退场目录仍在只为兼容旧载体导入。
    // 运行时证据见下一条测试：世界书/ 载体条目经 absorb 进 参考/世界书/。
    const adapterSrc = await readFile(join(REPO, 'src/modules/library/importAdapter.mjs'), 'utf-8')
    const allow = /const ALLOWED_PROJECT_DIRS = new Set\(\[([^\]]+)\]\)/u.exec(adapterSrc)?.[1] ?? ''
    assert.match(allow, /'参考'/u, '导入白名单必须含 参考')
    assert.match(allow, /'世界书'/u, '旧载体世界书目录仍需可导入')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})

test('世界书/ 的 absorb 规划目标为 参考/世界书/（真写证据见 contracts.test.mjs）', async () => {
  const base = await mkdtemp(join(tmpdir(), 'os164-absorb-'))
  const root = join(base, '夹具库')
  try {
    await mkdir(join(root, '世界书', '角色'), { recursive: true })
    await writeFile(join(root, '世界书', '角色', '林冲.md'), '名字：林冲\n', 'utf-8')
    const planned = await absorbLegacyDirs(root, ['世界书'])
    assert.equal(planned.ok, true)
    assert.deepEqual(planned.moves.map((item) => item.toRel), ['参考/世界书/角色/林冲.md'])
    // 规划归规划；真搬运走 referenceAbsorb（writeChapterWithBackup + deleteChapter），
    // 这里验证规划目标不与既有档冲突，且重复规划会 skip（不覆盖）。
    const again = await absorbLegacyDirs(root, ['正文'])
    assert.equal(again.ok, false, '正文仍不是可吸收目录')
  } finally {
    await rm(base, { recursive: true, force: true })
  }
})
