/**
 * OS-125 解耦③ 护栏（node:test，零依赖）——内核唯一进口（pinaxAdapter）。
 *
 *   · 全仓断言：src/ 树（递归）的全部 .mjs ＋仓根两个入口垫片里 import `core/` 下模块
 *     （静态 from ＋动态 import()）的只剩 src/kernel/pinaxAdapter.mjs——
 *     与门禁 S2.4（tools/acceptance/acceptance.mjs）同口径，这里锁测试侧副本
 *     （OS-140 起扫描范围随布局归一改为 src/ 树）；
 *   · 四组能力出口形状锁：factStore/enrich/projectMeta/projectImport 成员一个不差
 *     （OS-155 起 `deduce` 已退出——推演端子归扮演模块，形状锁移到
 *     `src/modules/deduce/engine/index.mjs`，见本文件同名用例）；
 *   · 每组真跑一条行为冒烟（内核端子真实调用，不是只验 typeof）；
 *   · plumber 转供锁：ok/fail/writeFileAtomic 经 adapter 转供 projectDoc/importAdapter，
 *     fail 的错误码映射（PINAX_* 字符串）是与内核共见的契约，锁死。
 *
 * 加载序说明：本文件先 import pinaxAdapter（adapter→projectDoc 方向的循环序）；
 * projectDoc→adapter 方向由 test/decoupleStep2.test.mjs（先 import projectDoc.mjs）在
 * 独立进程里覆盖——node --test 每个文件各起一个进程，两个方向都真跑过。
 *
 * 跑法：node --test openstory/test/decoupleStep3.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { factStore, enrich, projectMeta, projectImport, ok, fail, writeFileAtomic } from '../src/kernel/pinaxAdapter.mjs'
import * as deduceEngine from '../src/modules/deduce/engine/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('全仓唯一进口：src/ 模块里 import core/** 的只有 src/kernel/pinaxAdapter.mjs（S2.4 同口径）', () => {
  // OS-140 布局归一：自持模块全部收进 src/，扫描范围从「仓根 *.mjs」改为「src/**/*.mjs
  // ＋仓根两个入口垫片」（同口径迁移，覆盖面只增不减）。
  const coreImportRe = /(?:from\s+|import\(\s*)['"](?:\.\.?\/)+(core\/[^'"]+)['"]/g
  const violators = []
  const walk = (dir, prefix) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name)
      const rel = prefix ? `${prefix}/${name}` : name
      const st = statSync(full)
      if (st.isDirectory()) { walk(full, rel); continue }
      if (!name.endsWith('.mjs')) continue
      const src = readFileSync(full, 'utf-8')
      if (rel === 'src/kernel/pinaxAdapter.mjs') continue
      for (const m of src.matchAll(coreImportRe)) violators.push(`${rel} -> ${m[1]}`)
    }
  }
  walk(join(ROOT, 'src'), 'src')
  // 仓根只剩两个入口垫片（布局宪法），只扫顶层 .mjs 文件、不递归
  for (const name of readdirSync(ROOT).filter((n) => n.endsWith('.mjs'))) {
    for (const m of readFileSync(join(ROOT, name), 'utf-8').matchAll(coreImportRe)) {
      violators.push(`${name} -> ${m[1]}`)
    }
  }
  assert.deepEqual(violators, [], `core/** 只许 src/kernel/pinaxAdapter.mjs 引，违规：${violators.join('; ')}`)
  // 反向断言：adapter 自己确实在引内核（唯一进口是真进口，不是空壳）
  const adapterSrc = readFileSync(join(ROOT, 'src/kernel/pinaxAdapter.mjs'), 'utf-8')
  assert.match(adapterSrc, /from '\.\.\/\.\.\/core\/pinax\/next\/kernel\/factFileStore\.mjs'/)
})

test('四组能力出口形状锁（成员与顺序都是接触面契约）', () => {
  assert.deepEqual([...Object.keys(factStore)], ['createFactFileStore', 'writeFactFile', 'readFactWiki', 'FACT_DIR_NAME'])
  assert.deepEqual([...Object.keys(enrich)], ['derivePseudoChapters', 'hasRealChapters', 'causalSummary'])
  assert.deepEqual([...Object.keys(projectMeta)], ['readProjectDocument', 'writeProjectDocument', 'nextCarriers', 'validateProjectDocument'])
  assert.deepEqual([...Object.keys(projectImport)], ['planImport', 'runImport', 'parseChapterNumber'])
  // 四组对象冻结：消费方不许（也不能）往出口上挂私货
  for (const group of [factStore, enrich, projectMeta, projectImport]) assert.equal(Object.isFrozen(group), true)
})

test('推演端子形状锁（OS-155 归扮演模块：四端子名字一字不改，模块命名空间不可改写）', () => {
  assert.deepEqual(Object.keys(deduceEngine), ['applyDirectorAction', 'openDeduceSession', 'presentTurn', 'settleChoice'])
  for (const name of Object.keys(deduceEngine)) assert.equal(typeof deduceEngine[name], 'function', name)
  // 模块命名空间：sealed（可读不可增删），严格模式下改写抛 TypeError——与冻结对象同等不可篡改
  assert.equal(Object.isSealed(deduceEngine), true)
  assert.throws(() => { deduceEngine.presentTurn = null }, TypeError)
})

test('factStore 冒烟：FACT_DIR_NAME 口径不变＋list 真读内核', async () => {
  assert.equal(factStore.FACT_DIR_NAME, '拆解')
  const root = await mkdtemp(join(tmpdir(), 'os125-factstore-'))
  try {
    const listed = factStore.createFactFileStore({ root }).list({})
    assert.equal(listed.ok, true, `内核 list 失败：${JSON.stringify(listed.error ?? listed)}`)
    assert.deepEqual(listed.entries ?? [], [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('deduce 冒烟：空世界书如实拒开局（WORLD_EMPTY）＋最小世界书能开局', () => {
  assert.throws(() => deduceEngine.openDeduceSession({ entries: [] }), (error) => error.code === 'WORLD_EMPTY')
  const opened = deduceEngine.openDeduceSession({
    entries: [
      { id: 'w1', layer: 'worldview', status: 'adopted', name: '世界', content: '…' },
      { id: 'c1', layer: 'character', status: 'adopted', name: '我', content: '…' }
    ],
    pov: '我',
    runId: 'os125-smoke'
  })
  assert.equal(opened.session.runId, 'os125-smoke')
  assert.equal(opened.povEntry.name, '我')
})

test('enrich 冒烟：真章判定＋因果图三指标（闭环率/耦合度/断点敏感度）', () => {
  assert.equal(enrich.hasRealChapters([{ validity: { from: 1 } }, { validity: { from: 2 } }]), true, 'distinct validity.from > 1 即真章')
  assert.equal(enrich.hasRealChapters([{ validity: { from: 1 } }, { validity: null }]), false)
  const summary = enrich.causalSummary({
    nodes: [{ id: 'a', chapter: 1, event: '起', kind: 'cause' }, { id: 'b', chapter: 2, event: '承', kind: 'effect' }],
    edges: [{ from: 'a', to: 'b', type: 'causes', strength: 3, evidence: '因为所以' }],
    threads: [{ id: 't1', name: '主线', nodes: ['a', 'b'], closed: true }]
  })
  assert.equal(typeof summary, 'object')
  assert.deepEqual(Object.keys(summary).sort(), ['closedRate', 'coupling', 'edgeCount', 'hasCycles', 'maxImpact', 'nodeCount', 'threadCount'], '汇总读数字段与设计稿 C1 对齐，三指标经 causalSummary 单点出')
  assert.equal(summary.closedRate, 1, '唯一 thread 已闭环 → 闭环率 1')
})

test('projectMeta 冒烟：合同校验拒空对象＋nextCarriers 推进/冲突两路', () => {
  const invalid = projectMeta.validateProjectDocument({})
  assert.equal(invalid.ok, false)
  assert.equal(invalid.error.code, 'PINAX_INVALID_INPUT', '错误码映射是内核共见契约')
  const current = { primary: 'pinax.carrier.novel', enabled: ['pinax.carrier.novel'], revision: 1 }
  const advanced = projectMeta.nextCarriers(current, { expectedRevision: 1 })
  assert.equal(advanced.ok, true)
  assert.equal(advanced.value.revision, 2)
  const stale = projectMeta.nextCarriers(current, { expectedRevision: 0 })
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'PINAX_STALE_REVISION')
})

test('projectImport 冒烟：中文数字章节号＋入参校验拒空稿源', () => {
  assert.equal(projectImport.parseChapterNumber('一百二十三'), 123)
  assert.equal(projectImport.parseChapterNumber('两'), 2)
  assert.equal(projectImport.parseChapterNumber('abc'), null)
  const noSource = projectImport.planImport({ targetPath: 'D:/nowhere' })
  assert.equal(noSource.ok, false, '缺 sourcePath 必须在计划阶段就拒')
})

test('plumber 转供锁：ok/fail/writeFileAtomic 经 adapter 供 projectDoc/importAdapter', () => {
  assert.equal(typeof ok, 'function')
  assert.equal(typeof writeFileAtomic, 'function')
  assert.deepEqual(ok(42), { ok: true, value: 42 })
  const rejection = fail('STALE_REVISION', '过期')
  assert.equal(rejection.ok, false)
  assert.equal(rejection.error.code, 'PINAX_STALE_REVISION', '码值映射经内核 NEXT_ERROR_CODES，不许在本仓复刻一份')
  assert.equal(fail('不存在的码', 'x').error.code, 'PINAX_INVALID_INPUT', '未知码回落 INVALID_INPUT（vendor 行为）')
})
