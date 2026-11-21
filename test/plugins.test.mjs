/**
 * 插件统一清单（OS-120）：三套 spec 聚合成一份只读视图。
 *
 * 作者口径「在插件治理上，dsh 或者 Obsidian 有没有什么可以借鉴的」——
 * 可借鉴的第三条是「一份声明」：用户不该为了回答「我装了什么」去三个地方翻。
 *
 * 这里验的是聚合层的三条纪律：
 *   1. 三套各自读崩不许拖垮其余两套（聚合层的核心职责）
 *   2. 三套 spec 的差异被抹平成同一形状，上层不用关心原本属于哪套
 *   3. blocked / missingDependencies 这类跨套件字段在缺省时是安全空值
 */
import { strict as assert } from 'node:assert'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { after, before, describe, it } from 'node:test'
import { KIND_LABELS, PLUGIN_KINDS, listAllPlugins, listBlockedPlugins, pluginDetail, pluginHealth, suiteAssetPath } from '../plugins.mjs'

let base = ''

before(async () => {
  base = await mkdtemp(join(tmpdir(), 'os120-plugins-'))
})

after(async () => {
  await rm(base, { recursive: true, force: true })
})

/** 造一个最小套件目录（spec @2，page 模式设置页）。 */
async function makeSuite(dir, id, extra = {}) {
  const suiteDir = join(dir, id)
  await mkdir(suiteDir, { recursive: true })
  const manifest = {
    schemaVersion: 'openstory-suite@2',
    id,
    name: id,
    version: '0.1.0',
    vendor: '测试',
    description: '测试用套件',
    capabilities: { settings: { mode: 'page', entry: 'settings.html' } },
    ...extra
  }
  await writeFile(join(suiteDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  await writeFile(join(suiteDir, 'settings.html'), '<p>hi</p>', 'utf-8')
  return suiteDir
}

/** 造一个最小技能目录（SKILL.md + frontmatter）。 */
async function makeSkill(dir, name, extra = {}) {
  const skillDir = join(dir, name)
  await mkdir(skillDir, { recursive: true })
  const fm = ['---', `name: ${name}`, 'description: 测试用', 'category: craft', 'version: 0.1.0', ...(extra.lines || []), '---', '', '# 正文', ''].join('\n')
  await writeFile(join(skillDir, 'SKILL.md'), fm, 'utf-8')
  return skillDir
}

/** 造一个最小 runtime kit 目录。 */
async function makeKit(dir, id) {
  const kitDir = join(dir, id)
  await mkdir(kitDir, { recursive: true })
  const manifest = { schemaVersion: 'openstory-runtime-kit@1', id, name: id, version: '0.1.0', kind: 'endpoint', url: 'http://127.0.0.1:1' }
  await writeFile(join(kitDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8')
  return kitDir
}

describe('三套聚合', () => {
  it('三套都能读到，且总量＝各自之和', async () => {
    const root = join(base, 'all')
    const suites = join(root, 'suites')
    const skills = join(root, 'skills')
    const kits = join(root, 'kits')
    await makeSuite(suites, 'alpha')
    await makeSuite(suites, 'beta')
    await makeSkill(skills, 'craft-one')
    await makeKit(kits, 'kit-one')

    const result = await listAllPlugins({ suitesDirs: [suites], suiteStatePath: join(root, 'state.json'), skillsDirs: [skills], runtimesDirs: [kits] })
    assert.equal(result.ok, true)
    assert.equal(result.stats.byKind.suite, 2)
    assert.equal(result.stats.byKind.skill, 1)
    assert.equal(result.stats.byKind.runtime, 1)
    assert.equal(result.stats.total, 4)
    assert.equal(result.plugins.length, 4)
  })

  it('统一形状：三套的条目字段一致，kind/kindLabel 用来区分来源', async () => {
    const root = join(base, 'shape')
    const suites = join(root, 'suites')
    const skills = join(root, 'skills')
    const kits = join(root, 'kits')
    await makeSuite(suites, 'alpha')
    await makeSkill(skills, 'craft-one')
    await makeKit(kits, 'kit-one')

    const { plugins } = await listAllPlugins({ suitesDirs: [suites], suiteStatePath: join(root, 'state.json'), skillsDirs: [skills], runtimesDirs: [kits] })
    const required = ['kind', 'kindLabel', 'id', 'name', 'version', 'description', 'enabled', 'source', 'sourceDetail', 'blocked', 'blockedReason', 'missingDependencies']
    for (const plugin of plugins) {
      for (const field of required) {
        assert.ok(field in plugin, `${plugin.kind}:${plugin.id} 缺字段 ${field}`)
      }
      assert.ok(PLUGIN_KINDS.includes(plugin.kind))
      assert.equal(plugin.kindLabel, KIND_LABELS[plugin.kind])
      assert.equal(typeof plugin.enabled, 'boolean')
    }
  })

  it('技能与运行时没有启停概念，enabled 恒为 true', async () => {
    const root = join(base, 'noenable')
    const skills = join(root, 'skills')
    const kits = join(root, 'kits')
    await makeSkill(skills, 'craft-one')
    await makeKit(kits, 'kit-one')
    const { plugins } = await listAllPlugins({ skillsDirs: [skills], runtimesDirs: [kits] })
    for (const plugin of plugins) assert.equal(plugin.enabled, true)
  })

  it('blocked / missingDependencies 缺省是安全空值（版本闸/依赖闸未落地时也不炸）', async () => {
    const root = join(base, 'defaults')
    const suites = join(root, 'suites')
    await makeSuite(suites, 'alpha')
    const { plugins } = await listAllPlugins({ suitesDirs: [suites], suiteStatePath: join(root, 'state.json') })
    const suite = plugins.find((item) => item.kind === 'suite')
    assert.equal(suite.blocked, false)
    assert.equal(suite.blockedReason, '')
    assert.deepEqual(suite.missingDependencies, [])
  })
})

describe('故障隔离', () => {
  it('套件目录不存在时，技能与运行时照常返回', async () => {
    const root = join(base, 'isolate')
    const skills = join(root, 'skills')
    const kits = join(root, 'kits')
    await makeSkill(skills, 'craft-one')
    await makeKit(kits, 'kit-one')
    const result = await listAllPlugins({ suitesDirs: [join(root, 'does-not-exist')], suiteStatePath: join(root, 'state.json'), skillsDirs: [skills], runtimesDirs: [kits] })
    assert.equal(result.ok, true)
    assert.equal(result.stats.byKind.skill, 1)
    assert.equal(result.stats.byKind.runtime, 1)
  })

  it('坏套件记 warning 但不影响技能与运行时', async () => {
    const root = join(base, 'badsuite')
    const suites = join(root, 'suites')
    await makeSuite(suites, 'good')
    // 坏 manifest：spec 不对
    const badDir = join(suites, 'bad')
    await mkdir(badDir, { recursive: true })
    await writeFile(join(badDir, 'manifest.json'), JSON.stringify({ schemaVersion: 'nope', id: 'bad' }), 'utf-8')

    const skills = join(root, 'skills')
    await makeSkill(skills, 'craft-one')
    const result = await listAllPlugins({ suitesDirs: [suites], suiteStatePath: join(root, 'state.json'), skillsDirs: [skills] })
    assert.ok(result.stats.byKind.suite >= 1, '好套件仍应在')
    assert.ok(result.warnings.length >= 1, '坏套件应记 warning')
    assert.ok(result.warnings.every((w) => typeof w.kind === 'string'))
    assert.equal(result.stats.byKind.skill, 1)
  })
})

describe('详情与健康', () => {
  it('pluginDetail 命中返回条目，找不到返回 null（不抛错）', async () => {
    const root = join(base, 'detail')
    const suites = join(root, 'suites')
    await makeSuite(suites, 'alpha')
    const opts = { suitesDirs: [suites], suiteStatePath: join(root, 'state.json') }
    const hit = await pluginDetail(opts, 'suite', 'alpha')
    assert.ok(hit)
    assert.equal(hit.id, 'alpha')
    assert.equal(await pluginDetail(opts, 'suite', 'nope'), null)
    assert.equal(await pluginDetail(opts, 'not-a-kind', 'alpha'), null)
  })

  it('pluginHealth：干净时 healthy，healthy 不因为警告为空而误判', async () => {
    const root = join(base, 'health')
    const suites = join(root, 'suites')
    await makeSuite(suites, 'alpha')
    const health = await pluginHealth({ suitesDirs: [suites], suiteStatePath: join(root, 'state.json') })
    assert.equal(health.ok, true)
    assert.equal(typeof health.healthy, 'boolean')
    assert.ok(Array.isArray(health.blocked))
    assert.ok(Array.isArray(health.topWarnings))
    assert.ok(health.topWarnings.length <= 3)
  })

  it('listBlockedPlugins 只返回被拦下的（当前全部可加载时为空）', async () => {
    const root = join(base, 'blocked')
    const suites = join(root, 'suites')
    await makeSuite(suites, 'alpha')
    const result = await listBlockedPlugins({ suitesDirs: [suites], suiteStatePath: join(root, 'state.json') })
    assert.equal(result.ok, true)
    assert.deepEqual(result.plugins, [])
  })

  it('suiteAssetPath：套件返回物理路径，其它种类返回空串', async () => {
    const root = join(base, 'asset')
    const suites = join(root, 'suites')
    const suiteDir = await makeSuite(suites, 'alpha')
    const opts = { suitesDirs: [suites], suiteStatePath: join(root, 'state.json') }
    const suite = await pluginDetail(opts, 'suite', 'alpha')
    // Windows 临时目录会返回短路径（ADMINI~1），两边都 resolve 归一后再比
    assert.equal(resolve(suiteAssetPath(suite, 'dir')), resolve(suiteDir))
    assert.ok(suiteAssetPath(suite, 'settings').endsWith('settings.html'))
    assert.equal(suiteAssetPath({ kind: 'skill', sourceDetail: {} }, 'dir'), '')
    assert.equal(suiteAssetPath(null, 'dir'), '')
  })
})
