/**
 * OS-126 解耦④ 护栏（node:test，零依赖）——vendor 漂移检测的纯比对逻辑。
 * 全程在系统临时目录搭「假 core／假上游」喂纯函数（listCoreFiles/hashFiles/hashUpstream/
 * compareManifest/checkSection/readSections），不触碰本仓 core/ 真文件：
 *   · 无漂移 → ok=true，全 [一致]；
 *   · 本仓内容改动 → [本仓被改]，ok=false；
 *   · 清单缺项（core 下新文件未入锚）→ missingFromManifest 如实报，ok=false；
 *   · 上游内容改动 → [上游已变]，ok=false（本仓不被误报）；
 *   · 上游已移位（OS-132）：锚里有、本仓还在、上游已无 → movedAway，信息级（ok 不受影响）；
 *   · 上游缺失且本仓也没有 → [跳过]，不计漂移（ok 不受影响）；
 *   · 本仓已删而上游仍在 → [本仓被改]；
 *   · 映射规则 core/pinax/<X> ↔ 上游 <X>（next/server/electron 通吃，锚外路径无映射）；
 *   · OS-132：manifest 双段兼容读（旧单段结构 → pinaxNext 段＋pinaxCore 空段）、
 *     pinaxCore 段映射 contracts/<X> ↔ src/domain/<X>、行尾归一化比对（LF vs CRLF 不误报）。
 *
 * 跑法：node --test openstory/test/vendorDrift.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  checkSection,
  compareManifest,
  hashFiles,
  hashText,
  hashUpstream,
  listCoreFiles,
  readSections,
  stripVendoredHeader,
  toUpstreamRel,
  toUpstreamRelContracts,
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
    assert.deepEqual(r.movedAway, [])
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

test('上游已移位（OS-132）：锚里有、本仓还在、上游已无 → [上游已移位]，信息级 ok 不受影响', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, current, upstream } = await makeSandbox(coreRoot, upstreamRoot, {}, {
      'next/kernel/errors.mjs': null, // 上游删掉了（本仓有意携带；历史示例：OS-154 前的 enrich/{metrics,pseudoChapters}.mjs）
    })
    const r = compareManifest(manifestFiles, current, upstream)
    assert.deepEqual(r.movedAway.map((f) => f.rel), ['pinax/next/kernel/errors.mjs'])
    assert.ok(r.movedAway[0].detail.includes('上游已无此文件'))
    assert.equal(r.ok, true, '上游已移位是信息级，不影响退出码')
    assert.deepEqual(r.skipped, [], '本仓还在就不算跳过')
    assert.deepEqual(r.localChanged, [])
    assert.deepEqual(r.upstreamChanged, [])
    assert.deepEqual(r.same.map((f) => f.rel), ['pinax/electron/projects/fsDurability.mjs'])
  })
})

test('上游已无此文件＝本仓已删 → [跳过]，不计漂移（ok 不受影响）', async () => {
  await withSandbox(async (coreRoot, upstreamRoot) => {
    const { manifestFiles, upstream } = await makeSandbox(coreRoot, upstreamRoot, {}, {
      'next/kernel/errors.mjs': null, // 上游删掉了
    })
    await rm(join(coreRoot, 'pinax', 'next', 'kernel', 'errors.mjs')) // 本仓也删了（如 OS-123 删 server 层）
    const current = hashFiles(coreRoot, listCoreFiles(coreRoot))
    const r = compareManifest(manifestFiles, current, upstream)
    assert.deepEqual(r.skipped.map((f) => f.rel), ['pinax/next/kernel/errors.mjs'])
    assert.equal(r.ok, true) // 跳过不算漂移
    assert.deepEqual(r.movedAway, [], '本仓也没有就不算移位')
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

/* ---------- OS-132：双段 manifest 与 pinaxCore 段口径 ---------- */

test('映射：contracts/<X> ↔ pinax-core src/domain/<X>，锚外路径无映射', () => {
  assert.equal(toUpstreamRelContracts('contracts/worldbookFileContract.js'), 'worldbookFileContract.js')
  assert.equal(toUpstreamRelContracts('contracts/PROVENANCE.md'), 'PROVENANCE.md')
  assert.equal(toUpstreamRelContracts('core/pinax-core-0.16.0.tgz'), null, 'vendor/core 凭证不入段')
  assert.equal(toUpstreamRelContracts('README.md'), null)
})

test('hashText：CRLF/LF 行尾归一化后同哈希；hashFiles normalize 口径一致', async () => {
  await withSandbox(async (coreRoot) => {
    await makeTree(coreRoot, {
      'contracts/a.js': 'export const A = 1\n', // LF
      'contracts/b.js': 'export const A = 1\r\n', // CRLF，归一化后与 a 同
    })
    assert.equal(hashText(Buffer.from('x\r\ny\rz\n')), hashText(Buffer.from('x\ny\nz\n')), 'CRLF/CR/LF 归一')
    const norm = hashFiles(coreRoot, ['contracts/a.js', 'contracts/b.js'], true)
    assert.equal(norm['contracts/a.js'], norm['contracts/b.js'], '归一化后 LF 与 CRLF 同哈希')
    const raw = hashFiles(coreRoot, ['contracts/a.js', 'contracts/b.js'], false)
    assert.notEqual(raw['contracts/a.js'], raw['contracts/b.js'], '原始字节可区分（pinaxNext 段口径不变）')
  })
})

test('stripVendoredHeader：剥 VENDORED 出处头，不动上游自有文档头', () => {
  const header = '/**\n * VENDORED（OS-132 收编）——逐字拷贝。\n */\n\n'
  const body = '/**\n * 世界书文件格式契约（上游自己的文档头）。\n */\n\nexport const A = 1\n'
  const stripped = stripVendoredHeader(Buffer.from(header + body, 'utf8'))
  assert.equal(stripped.toString('utf8'), body, 'VENDORED 头＋空行整块剥掉，正文原样')
  assert.equal(stripVendoredHeader(Buffer.from(body, 'utf8')).toString('utf8'), body, '无 VENDORED 标记原样返回')
  // 组合口径：出处头＋CRLF 的本仓文件 ↔ 裸正文＋LF 的上游文件 → 同哈希
  const local = stripVendoredHeader(Buffer.from((header + body).replace(/\n/g, '\r\n'), 'utf8'))
  assert.equal(hashText(local), hashText(Buffer.from(body, 'utf8')), '剥头＋归一化后两侧同哈希')
})

test('readSections：旧单段 manifest 兼容读（pinaxNext 接管、pinaxCore 当空）', () => {
  const legacy = {
    generatedAt: '2026-11-22T18:18:57.238Z',
    upstreamCommit: '70a4f44',
    files: { 'pinax/next/kernel/errors.mjs': 'aa' },
  }
  const r = readSections(legacy)
  assert.deepEqual(r.sections.pinaxNext, { upstreamCommit: '70a4f44', files: { 'pinax/next/kernel/errors.mjs': 'aa' } })
  assert.deepEqual(r.sections.pinaxCore, { upstreamCommit: null, files: {} }, '旧结构没有 pinaxCore 段＝空')
  assert.equal(r.generatedAt, legacy.generatedAt)
})

test('readSections：新双段 manifest 原样规整；缺段当空', () => {
  const fresh = {
    generatedAt: '2026-11-23T00:00:00.000Z',
    sections: {
      pinaxNext: { upstreamCommit: '70a4f44', files: { 'pinax/next/kernel/errors.mjs': 'aa' } },
      pinaxCore: { upstreamCommit: 'e56a0bc', files: { 'contracts/worldbookFileContract.js': 'bb' } },
    },
  }
  const r = readSections(fresh)
  assert.deepEqual(r.sections.pinaxNext.files, fresh.sections.pinaxNext.files)
  assert.deepEqual(r.sections.pinaxCore.files, fresh.sections.pinaxCore.files)
  assert.equal(r.sections.pinaxCore.upstreamCommit, 'e56a0bc')

  const partial = readSections({ sections: { pinaxNext: fresh.sections.pinaxNext } })
  assert.deepEqual(partial.sections.pinaxCore, { upstreamCommit: null, files: {} }, '缺 pinaxCore 段＝空')
  const empty = readSections({})
  assert.deepEqual(empty.sections.pinaxNext, { upstreamCommit: null, files: {} })
  assert.deepEqual(empty.sections.pinaxCore, { upstreamCommit: null, files: {} })
})

test('checkSection（pinaxCore 口径）：出处头＋CRLF 差异不误报，contracts/<X> ↔ src/domain/<X>', async () => {
  await withSandbox(async (vendorRoot, upstreamRoot) => {
    const header = '/**\n * VENDORED（OS-132 收编）——逐字拷贝，出处见 PROVENANCE.md。\n */\n\n'
    const body = '/**\n * 世界书文件格式契约（上游自己的文档头）。\n */\n\nexport const WORLDBOOK_FILE_SCHEMA_VERSION = 1\n'
    // 本仓 vendor/contracts：出处头＋LF（tgz 载体口径，与真实收编件同构）
    await makeTree(vendorRoot, {
      'contracts/worldbookFileContract.js': header + body,
      'contracts/PROVENANCE.md': '# 出处\n',
      'core/pinax-core-0.16.0.tgz': 'binary-ish',
    })
    // 上游 src/domain：裸正文＋CRLF（Windows 检出口径）
    await makeTree(join(upstreamRoot, 'src', 'domain'), {
      'worldbookFileContract.js': body.replace(/\n/g, '\r\n'),
    })
    const cfg = {
      key: 'pinaxCore',
      localRoot: vendorRoot,
      upstreamRoot: join(upstreamRoot, 'src', 'domain'),
      prefix: 'contracts/',
      skip: new Set(['contracts/PROVENANCE.md']),
      mapRel: toUpstreamRelContracts,
      normalize: true,
      stripVendoredHeader: true,
    }
    const anchor = hashText(stripVendoredHeader(Buffer.from(header + body, 'utf8')))
    const part = {
      upstreamCommit: 'e56a0bc',
      files: { 'contracts/worldbookFileContract.js': anchor },
    }
    const r = checkSection(cfg, part)
    assert.equal(r.ok, true, '出处头与 LF/CRLF 行尾差异都不该误报')
    assert.deepEqual(r.same.map((f) => f.rel), ['contracts/worldbookFileContract.js'])
    assert.deepEqual(r.localChanged, [])
    assert.deepEqual(r.upstreamChanged, [])
    assert.deepEqual(r.missingFromManifest, [], 'PROVENANCE.md 在 skip 名单、tgz 在段管辖外')
    assert.deepEqual(r.movedAway, [])
    assert.deepEqual(r.skipped, [])
  })
})

test('checkSection（pinaxCore 口径）：上游已移位与清单缺项照常出档', async () => {
  await withSandbox(async (vendorRoot, upstreamRoot) => {
    await makeTree(vendorRoot, {
      'contracts/worldbookFileContract.js': '/**\n * VENDORED（收编）。\n */\n\nv1\n',
      'contracts/newcomer.js': 'n1\n', // 锚外新文件
    })
    const cfg = {
      key: 'pinaxCore',
      localRoot: vendorRoot,
      upstreamRoot: join(upstreamRoot, 'src', 'domain'),
      prefix: 'contracts/',
      skip: new Set(),
      mapRel: toUpstreamRelContracts,
      normalize: true,
      stripVendoredHeader: true,
    }
    const part = {
      upstreamCommit: 'e56a0bc',
      files: { 'contracts/worldbookFileContract.js': hashText(Buffer.from('v1\n')) },
    }
    const r = checkSection(cfg, part)
    assert.equal(r.ok, false, '清单缺项仍是 exit 1 触发条件')
    assert.deepEqual(r.missingFromManifest.map((f) => f.rel), ['contracts/newcomer.js'])
    assert.deepEqual(r.movedAway.map((f) => f.rel), ['contracts/worldbookFileContract.js'], '上游 src/domain 还没长出该文件＝移位档')
    assert.deepEqual(r.upstreamChanged, [])
  })
})
