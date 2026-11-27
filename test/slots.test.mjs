/**
 * OS-188 / D4：底座 slot 注册表与稳定编排。
 *
 * slot 是跨插件共同语言，只能由底座登记；插件 manifest 自造 slot 一律校验失败。
 * slotPlacements 给装载器一份稳定序（装载序＋page id），停用模块不出现。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SLOT_IDS, SLOT_REGISTRY, SLOT_SPEC, isRegisteredSlot, slotEntry, slotPlacements } from '../src/protocol/slots.mjs'
import { MODULE_MANIFESTS, validateModuleManifest } from '../src/protocol/modules.mjs'
import { baseCapabilities } from '../src/host/baseCapabilities.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

test('slot 注册表：底座五个初始位、id 唯一、整体冻结', () => {
  assert.equal(SLOT_SPEC, 'openstory-slots@1')
  assert.deepEqual([...SLOT_IDS], ['tab', 'right', 'sidebar', 'host-actions', 'settings'])
  assert.equal(new Set(SLOT_IDS).size, SLOT_IDS.length)
  assert.ok(Object.isFrozen(SLOT_REGISTRY))
  for (const item of SLOT_REGISTRY) {
    assert.ok(Object.isFrozen(item))
    assert.ok(item.label && item.description)
    assert.equal(item.scope, 'workbench')
    assert.equal(slotEntry(item.id), item)
  }
  assert.equal(isRegisteredSlot('tab'), true)
  assert.equal(isRegisteredSlot(' panel '), false)
  assert.equal(slotEntry('nope'), null)
})

test('base.naming 只读投影带 slots：与协议注册表同一份数据', () => {
  const naming = baseCapabilities['base.naming']
  assert.equal(naming.SLOT_REGISTRY, SLOT_REGISTRY)
  assert.equal(naming.isRegisteredSlot, isRegisteredSlot)
  assert.equal(naming.slotEntry('right').label, '右栏')
})

test('manifest 校验：未注册 slot 拒绝，已注册 slot 必须引用本 manifest 的 page', async () => {
  const raw = JSON.parse(await readFile(join(ROOT, 'src', 'modules', 'chapters', 'module.manifest.json'), 'utf8'))
  const valid = validateModuleManifest(raw, { dirName: 'chapters', stage: 'C' })
  assert.equal(valid.ok, true)

  const fabricated = validateModuleManifest({
    ...raw,
    slots: [{ slot: 'panel', page: raw.pages[0].id }]
  }, { dirName: 'chapters', stage: 'C' })
  assert.equal(fabricated.ok, false)
  assert.ok(fabricated.errors.some((message) => /slot 未注册/u.test(message)))

  const dangling = validateModuleManifest({
    ...raw,
    slots: [{ slot: 'tab', page: 'absent-page' }]
  }, { dirName: 'chapters', stage: 'C' })
  assert.equal(dangling.ok, false)
  assert.ok(dangling.errors.some((message) => /page 不存在/u.test(message)))
})

test('slot 编排：装载序优先、同 slot 稳定排序、停用模块不出现', () => {
  const placements = slotPlacements(MODULE_MANIFESTS)
  // OS-198：九个工作台页签按 manifest 显式 order 排（artifacts 10 … roleplay 80），
  // 不退回按 page id 字典序——那是没有 order 时的兜底，不是作者的页签顺序。
  assert.deepEqual(placements.tab.map((item) => item.page), ['artifacts', 'chapters', 'knowledge-base', 'worldbook', 'script', 'log', 'storysource', 'habits', 'roleplay'])
  assert.deepEqual(placements.right.map((item) => item.page), ['analysis'])
  assert.deepEqual(placements['host-actions'].map((item) => item.page), ['exchange'])
  assert.deepEqual(placements.settings.map((item) => item.page).sort(), ['imagegen', 'knowledge'])
  assert.ok(Object.isFrozen(placements))
  assert.ok(Object.isFrozen(placements.tab))

  const withoutChapters = slotPlacements(MODULE_MANIFESTS, { chapters: false })
  assert.ok(!withoutChapters.tab.some((item) => item.module === 'chapters'))
  assert.equal(withoutChapters.tab[0].page, 'artifacts')

  const synthetic = slotPlacements([
    { id: 'zeta', class: 'workbench', slots: [{ slot: 'tab', page: 'b-page' }, { slot: 'tab', page: 'a-page' }] },
    { id: 'alpha', class: 'workbench', slots: [{ slot: 'tab', page: 'z-page' }] },
    { id: 'kernel-ish', class: 'kernel', slots: [{ slot: 'tab', page: 'ignored' }] },
    { id: 'broken', class: 'workbench', slots: [{ slot: 'panel', page: 'ghost' }] }
  ])
  assert.deepEqual(synthetic.tab.map((item) => item.page), ['a-page', 'b-page', 'z-page'], '同模块按 page id 稳定排；跨模块按装载序')
  assert.deepEqual(Object.keys(synthetic), ['tab'], '未注册 slot 的声明不进入编排')
})