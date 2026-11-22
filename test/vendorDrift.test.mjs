/**
 * OS-126 解耦④ 护栏（node:test，零依赖）——vendor 漂移检测的纯比对逻辑。
 * 全程在系统临时目录搭「假 core／假上游」喂纯函数（listCoreFiles/hashFiles/hashUpstream/
 * compareManifest），不触碰本仓 core/ 真文件：
 *   · 无漂移 → ok=true，全 [一致]；
 *   · 本仓内容改动 → [本仓被改]，ok=false；
 *   · 清单缺项（core 下新文件未入锚）→ missingFromManifest 如实报，ok=false；
 *   · 上游内容改动 → [上游已变]，ok=false（本仓不被误报）；
 *   · 上游已无此文件＝本仓已删 → [跳过]，不计漂移（ok 不受影响）；
 *   · 本仓已删而上游仍在 → [本仓被改]；
 *   · 映射规则 core/pinax/<X> ↔ 上游 <X>（next/server/electron 通吃，锚外路径无映射）。
 *
 * 跑法：node --test openstory/test/vendorDrift.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  compareManifest,
  hashFiles,
  hashUpstream,
  listCoreFiles,
  toUpstreamRel,
} from '../scripts/vendor-drift.mjs'

/* ---------- 夹具 ---------- */

/** 在 base 下按 {posix相对路径: 内容} 建文件树；值为 null ＝ 不落盘。 */
async function makeTree(base, files) {
  for (const [rel, content] of Object.entries(files)) {
    if (content === null) continue
    const abs = join(base, ...rel.split('/'))
    await mkdir(dirname(abs), { recursive: true })
    await writeFile(abs, content)
  }
}

/** 临时双目录：coreRoot（vendor 面）＋ upstreamRoot（上游同位置）。返回后自清理。 */
async function withSandbox(run) {
  const base = await mkdtemp(join(tmpdir(), 'vendor-drift-'))
  const coreRoot = join(base, 'core')
  const upstreamRoot = join(base, 'upstream')
  try {
    return await run(coreRoot, upstreamRoot)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

const BASE_FILES = {
  'pinax/next/kernel/errors.mjs': 'export const ERR = 1\n',
  'pinax/electron/projects/fsDurability.mjs': 'export const fsync = 1\n',
}

/**
 * 标准夹具：先按基线内容落 core 与上游两侧并生成锚（模拟 snapshot），
 * 再施加漂移——coreOverride 只改本仓侧、upstreamOverride 只改上游侧（null＝该侧删文件）。
 * 返回：{ rels, manifestFiles, current, upstream }。
 */
async function makeSandbox(coreRoot, upstreamRoot, coreOverride = {}, upstreamOverride = {}) {
  // 1) 基线落盘 → 生成锚（等价 snapshot）
  const upstreamBase = {}
  for (const [rel, content] of Object.entries(BASE_FILES)) {
    const upRel = toUpstreamRel(rel)
    if (upRel) upstreamBase[upRel] = content
  }
  await makeTree(coreRoot, BASE_FILES)
  await makeTree(upstreamRoot, upstreamBase)
  const rels = listCoreFiles(coreRoot)
  const manifestFiles = hashFiles(coreRoot, rels)
  // 2) 施加漂移（覆盖写；null＝删文件）
  await makeTree(coreRoot, coreOverride)
  await makeTree(upstreamRoot, upstreamOverride)
  for (const [rel, content] of Object.entries(coreOverride)) {
    if (content === null) await rm(join(coreRoot, ...rel.split('/')), { force: true })
  }
  for (const [rel, content] of Object.entries(upstreamOverride)) {
    if (content === null) await rm(join(upstreamRoot, ...rel.split('/')), { force: true })
  }
  return {
    rels,
    manifestFiles,
    current: hashFiles(coreRoot, rels),
    upstream: hashUpstream(upstreamRoot, rels),
  }
}

/* ---------- 映射规则 ---------- */

test('映射：core/pinax/<X> ↔ 上游 <X>，锚外路径无映射', () => {
  assert.equal(toUpstreamRel('pinax/next/fact/domain/schema.js'), 'next/fact/domain/schema.js')
  assert.equal(toUpstreamRel('pinax/server/mcp/projectImport.js'), 'server/mcp/projectImport.js')
  assert.equal(toUpstreamRel('pinax/electron/projects/fsDurability.mjs'), 'electron/projects/fsDurability.mjs')
  assert.equal(toUpstreamRel('VENDORED.md'), null)
  assert.equal(toUpstreamRel('README.md'), null)
})

/* ---------- snapshot 遍历口径 ---------- */

test('snapshot 遍历排除锚自身与 VENDORED.md', async () => {
  await withSandbox(async (coreRoot) => {
    await makeTree(coreRoot, {
      '.vendored-manifest.json': '{"files":{}}\n',
      'VENDORED.md': '# 出处\n',
      'pinax/next/kernel/errors.mjs': 'x\n',
      'pinax/README.md': 'y\n',
    })
    assert.deepEqual(listCoreFiles(coreRoot), ['pinax/README.md', 'pinax/next/kernel/errors.mjs'])
  })
})

/* ---------- 五类比对 ---------- */

test('无漂移：全 [一致]，ok=true', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, current, upstream } = await makeSandbox(coreRoot, upstreamRoot)
    const r = compareManifest(manifestFiles, current, upstream)
    assert.equal(r.ok, true)
    assert.deepEqual(r.same.map((f) => f.rel), [
      'pinax/electron/projects/fsDurability.mjs',
      'pinax/next/kernel/errors.mjs',
    ])
    assert.deepEqual(r.localChanged, [])
    assert.deepEqual(r.upstreamChanged, [])
    assert.deepEqual(r.missingFromManifest, [])
    assert.deepEqual(r.skipped, [])
  })
})

test('本仓内容改动 → [本仓被改]，ok=false', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, current, upstream } = await makeSandbox(coreRoot, upstreamRoot, {
      'pinax/next/kernel/errors.mjs': 'export const ERR = 2\n', // 只改本仓侧
    })
    const r = compareManifest(manifestFiles, current, upstream)
    assert.equal(r.ok, false)
    assert.deepEqual(r.localChanged.map((f) => f.rel), ['pinax/next/kernel/errors.mjs'])
    assert.ok(r.localChanged[0].detail.includes('与指纹不符'))
    // 上游没动，只有本仓动：上游已变清单为空，一致清单里不再有它
    assert.deepEqual(r.upstreamChanged, [])
    assert.deepEqual(r.same.map((f) => f.rel), ['pinax/electron/projects/fsDurability.mjs'])
  })
})

test('清单缺项：core 下锚外新文件如实报，ok=false', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, upstream } = await makeSandbox(coreRoot, upstreamRoot)
    // 锚生成之后 core 又长出新文件（且上游有同名）——锚过时
    await makeTree(coreRoot, { 'pinax/next/kernel/newcomer.mjs': 'export const N = 1\n' })
    const current2 = hashFiles(coreRoot, listCoreFiles(coreRoot))
    const r = compareManifest(manifestFiles, current2, upstream)
    assert.equal(r.ok, false)
    assert.deepEqual(r.missingFromManifest.map((f) => f.rel), ['pinax/next/kernel/newcomer.mjs'])
    // 其余判定不受影响
    assert.deepEqual(r.localChanged, [])
    assert.deepEqual(r.same.map((f) => f.rel), ['pinax/electron/projects/fsDurability.mjs', 'pinax/next/kernel/errors.mjs'])
  })
})

test('上游内容改动 → [上游已变]，ok=false（本仓不被误报）', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, current, upstream } = await makeSandbox(coreRoot, upstreamRoot, {}, {
      'next/kernel/errors.mjs': 'export const ERR = upstream-新的实现\n',
    })
    const r = compareManifest(manifestFiles, current, upstream)
    assert.equal(r.ok, false)
    assert.deepEqual(r.upstreamChanged.map((f) => f.rel), ['pinax/next/kernel/errors.mjs'])
    assert.deepEqual(r.localChanged, [])
    assert.deepEqual(r.same.map((f) => f.rel), ['pinax/electron/projects/fsDurability.mjs'])
  })
})

test('上游已无此文件＝本仓已删 → [跳过]，不计漂移（ok 不受影响）', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, current, upstream } = await makeSandbox(coreRoot, upstreamRoot, {}, {
      'next/kernel/errors.mjs': null, // 上游删掉了（如 OS-123 删 server 层）
    })
    const r = compareManifest(manifestFiles, current, upstream)
    assert.deepEqual(r.skipped.map((f) => f.rel), ['pinax/next/kernel/errors.mjs'])
    assert.equal(r.ok, true) // 跳过不算漂移
    assert.deepEqual(r.localChanged, [])
    assert.deepEqual(r.upstreamChanged, [])
    assert.deepEqual(r.same.map((f) => f.rel), ['pinax/electron/projects/fsDurability.mjs'])
  })
})

test('本仓已删而上游仍在 → [本仓被改]', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, upstream } = await makeSandbox(coreRoot, upstreamRoot)
    await rm(join(coreRoot, 'pinax', 'next', 'kernel', 'errors.mjs'))
    const current2 = hashFiles(coreRoot, listCoreFiles(coreRoot))
    const r = compareManifest(manifestFiles, current2, upstream)
    assert.equal(r.ok, false)
    assert.deepEqual(r.localChanged.map((f) => f.rel), ['pinax/next/kernel/errors.mjs'])
    assert.ok(r.localChanged[0].detail.includes('本仓已删'))
    assert.deepEqual(r.same.map((f) => f.rel), ['pinax/electron/projects/fsDurability.mjs'])
  })
})
