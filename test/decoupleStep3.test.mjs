/**
 * OS-125 解耦③ 护栏（node:test，零依赖）——内核公开面（OS-157 起 adapter 已解散）。
 *
 *   · 全仓断言：src/ 树（递归）的全部 .mjs ＋仓根两个入口垫片里**没有任何** import `core/`
 *     下模块（静态 from ＋动态 import()）——OS-156 起内核全树已转自有，与门禁 S2.4'
 *     （tools/acceptance/acceptance.mjs）同口径，这里锁测试侧副本
 *     （OS-140 起扫描范围随布局归一改为 src/ 树）；
 *   · 四组能力出口形状锁：factStore/enrich/projectMeta/projectImport 成员一个不差
 *     （OS-155 起 `deduce` 已退出——推演端子归扮演模块，形状锁移到
 *     `src/modules/deduce/engine/index.mjs`，见本文件同名用例）；
 *   · 每组真跑一条行为冒烟（各端子真实调用，不是只验 typeof）；
 *   · plumber 转供锁：ok/fail/writeFileAtomic 由内核公开面直出，
 *     fail 的错误码映射（无前缀内核字符串）是与内核共见的契约，锁死。
 *
 * 加载序说明：OS-157 后依赖面无环；本文件先 import 内核公开面，反向装载序由
 * test/decoupleStep2.test.mjs（先 import projectDoc.mjs）在独立进程里覆盖。
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
import { ok, fail, writeFileAtomic } from '../src/kernel/index.mjs'
import { factCapability } from '../src/modules/fact/index.mjs'
const factStore = factCapability['fact.store']
const enrich = factCapability['fact.enrich']
import { projectMeta } from '../src/modules/storage/index.mjs'
import { projectImport } from '../src/modules/library/index.mjs'
import * as deduceEngine from '../src/modules/deduce/engine/index.mjs'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

test('core/** 进口面为零：src/ 模块与仓根垫片均无 core/ 说明符（S2.4\' 同口径）', () => {
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
  assert.deepEqual(violators, [], `core/** 已退役（OS-156），任何模块都不许再引 core/**，违规：${violators.join('; ')}`)
  // 反向断言：内核公开面仍从自持件组装出口（公开面是真装配，不是空壳）
  const kernelSrc = readFileSync(join(ROOT, 'src/kernel/index.mjs'), 'utf-8')
  assert.doesNotMatch(kernelSrc, /from '\.\/fact\//, 'fact 链已降级为独立内核件')
  const factSrc = readFileSync(join(ROOT, 'src/modules/fact/index.mjs'), 'utf-8')
  assert.match(factSrc, /from '\.\/fact\/factFileStore\.mjs'/, 'fact.store 组指 fact 内核件实现')
  assert.doesNotMatch(kernelSrc, /(?:from\s+|import\(\s*)['"](?:\.\.?\/)+core\//, '内核已无 core 可引（OS-156）')
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
  assert.equal(factStore.FACT_DIR_NAME, '故事源')
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
  assert.equal(invalid.error.code, 'INVALID_INPUT', '错误码映射是内核共见契约')
  const current = { primary: 'openstory.carrier.novel', enabled: ['openstory.carrier.novel'], revision: 1 }
  const advanced = projectMeta.nextCarriers(current, { expectedRevision: 1 })
  assert.equal(advanced.ok, true)
  assert.equal(advanced.value.revision, 2)
  const stale = projectMeta.nextCarriers(current, { expectedRevision: 0 })
  assert.equal(stale.ok, false)
  assert.equal(stale.error.code, 'STALE_REVISION')
})

test('projectImport 冒烟：中文数字章节号＋入参校验拒空稿源', () => {
  assert.equal(projectImport.parseChapterNumber('一百二十三'), 123)
  assert.equal(projectImport.parseChapterNumber('两'), 2)
  assert.equal(projectImport.parseChapterNumber('abc'), null)
  const noSource = projectImport.planImport({ targetPath: 'D:/nowhere' })
  assert.equal(noSource.ok, false, '缺 sourcePath 必须在计划阶段就拒')
})

test('plumber 转供锁：ok/fail/writeFileAtomic 由内核公开面直出供 projectDoc/importAdapter', () => {
  assert.equal(typeof ok, 'function')
  assert.equal(typeof writeFileAtomic, 'function')
  assert.deepEqual(ok(42), { ok: true, value: 42 })
  const rejection = fail('STALE_REVISION', '过期')
  assert.equal(rejection.ok, false)
  assert.equal(rejection.error.code, 'STALE_REVISION', '码值映射经内核 KERNEL_ERROR_CODES，不许在本仓复刻一份')
  assert.equal(fail('不存在的码', 'x').error.code, 'INVALID_INPUT', '未知码回落 INVALID_INPUT')
})
