/**
 * OS-121 插件治理：最低应用版本闸（minOpenStoryVersion）用例。
 *
 * 跑法：
 *   node --test test/pluginGovernance.test.mjs
 *
 * 覆盖面：三套规范（suite/skill/runtime-kit）各走「版本不够＝跳过」「等于＝加载」
 * 「缺失＝不校验」「格式坏＝照常加载＋_BAD warning」；外加 satisfiesMinVersion 的逐段比对单元断言。
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadSuites, normalizeSuite, KNOWN_SERVICE_IDS } from '../src/services/suites.mjs'
import { loadSkills, parseSkillMarkdown } from '../src/services/skills.mjs'
import { loadRuntimeKits, normalizeRuntimeKit } from '../src/services/runtimes.mjs'
import { minVersionGate, readAppVersion, satisfiesMinVersion } from '../src/protocol/versionGate.mjs'

const REPO = dirname(dirname(fileURLToPath(import.meta.url)))

/* ---------- 夹具 ---------- */

const SUITE = {
  schemaVersion: 'openstory-suite@2',
  id: 'governed',
  name: '受闸套件',
  version: '0.1.0',
  vendor: 'skkbsgzf'
}

function skillMarkdown({ name = 'governed-skill', extra = '' } = {}) {
  return `---
name: ${name}
description: 受闸技能
category: craft
${extra}---

# 正文

一条规则。
`
}

const KIT = {
  schemaVersion: 'openstory-runtime-kit@1',
  id: 'governed-kit',
  name: '受闸运行时',
  kind: 'endpoint',
  url: 'http://127.0.0.1:9230'
}

async function makeSuiteShelf(base, manifests) {
  const shelf = join(base, 'suites')
  for (const [dirName, manifest] of Object.entries(manifests)) {
    const dir = join(shelf, dirName)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
  }
  return shelf
}

async function makeSkillShelf(base, entries) {
  const shelf = join(base, 'skills')
  for (const [dirName, markdown] of Object.entries(entries)) {
    const dir = join(shelf, dirName)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'SKILL.md'), markdown, 'utf-8')
  }
  return shelf
}

async function makeKitShelf(base, manifests) {
  const shelf = join(base, 'runtimes')
  for (const [dirName, manifest] of Object.entries(manifests)) {
    const dir = join(shelf, dirName)
    await mkdir(dir, { recursive: true })
    await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest), 'utf-8')
  }
  return shelf
}

async function withTemp(fn) {
  const base = await mkdtemp(join(tmpdir(), 'openstory-os121-'))
  try {
    return await fn(base)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

/* ---------- satisfiesMinVersion 单元断言 ---------- */

test('satisfiesMinVersion：逐段按数字比（1.10.0 大于 1.2.3，不能按字符串比）', () => {
  // 字符串比较会把 '1.10.0' 排到 '1.2.3' 前面——这条就是防这个坑
  assert.equal(satisfiesMinVersion('1.10.0', '1.2.3').ok, false)
  assert.equal(satisfiesMinVersion('1.10.0', '1.2.3').reason, 'too-old')
  assert.equal(satisfiesMinVersion('1.2.3', '1.10.0').ok, true)

  assert.equal(satisfiesMinVersion('1.2.3', '1.2.3').ok, true, '相等＝满足')
  assert.equal(satisfiesMinVersion('1.2.3', '1.2.4').ok, true)
  assert.equal(satisfiesMinVersion('1.2.3', '1.2.2').ok, false)
  assert.equal(satisfiesMinVersion('1.2.3', '2.0.0').ok, true)
  assert.equal(satisfiesMinVersion('2.0.0', '1.9.9').ok, false)
  assert.equal(satisfiesMinVersion('0.2.0', '0.1.0').ok, false)
  assert.equal(satisfiesMinVersion('10.0.0', '9.99.99').ok, false, '多位数段：10 > 9')
  assert.equal(satisfiesMinVersion('1.0.0', '1.0.10').ok, true)
})

test('satisfiesMinVersion：任一侧格式非法 → bad-format（不抛错）', () => {
  for (const [required, current] of [
    ['abc', '1.0.0'],
    ['1.0.0', 'abc'],
    ['1.0', '1.0.0'],
    ['1.0.0.0', '1.0.0'],
    ['v1.0.0', '1.0.0'],
    ['1.0.0-beta', '1.0.0'],
    ['^1.0.0', '1.0.0'],
    ['', '1.0.0'],
    ['1.0.0', '']
  ]) {
    const verdict = satisfiesMinVersion(required, current)
    assert.equal(verdict.ok, false, `${required} vs ${current}`)
    assert.equal(verdict.reason, 'bad-format', `${required} vs ${current}`)
  }
})

test('readAppVersion：读仓根 package.json 的 version（当前 0.2.0，OS-135 对齐已发布 tag v0.2.0）', () => {
  assert.equal(readAppVersion(REPO), '0.2.0')
  assert.equal(readAppVersion(join(REPO, 'test')), '', '没有 package.json 的目录＝空串，不抛')
})

/* ---------- 套件：要求高于当前 ---------- */

test('套件：要求版本高于当前 → 跳过加载 + SUITE_MIN_VERSION warning，清单其余项照常', async () => {
  await withTemp(async (base) => {
    const shelf = await makeSuiteShelf(base, {
      // OS-135：应用版本已对齐 v0.2.0，「高于当前」的夹具字面量随之升到 0.3.0（语义不变）
      future: { ...SUITE, id: 'future', minOpenStoryVersion: '0.3.0' },
      now: { ...SUITE, id: 'now' }
    })
    const { suites, warnings } = loadSuites([shelf])
    assert.deepEqual(suites.map((suite) => suite.id), ['now'], '版本不够的套件不进清单，同目录另一套件照常加载')
    const hit = warnings.find((warning) => warning.code === 'SUITE_MIN_VERSION')
    assert.ok(hit, `应有 SUITE_MIN_VERSION warning，实际：${JSON.stringify(warnings)}`)
    assert.match(hit.message, /0\.3\.0/)
    assert.match(hit.message, /0\.2\.0/)
  })
})

test('套件：要求版本等于当前 → 正常加载（无版本闸 warning）', async () => {
  await withTemp(async (base) => {
    const shelf = await makeSuiteShelf(base, { same: { ...SUITE, minOpenStoryVersion: '0.1.0' } })
    const { suites, warnings } = loadSuites([shelf])
    assert.deepEqual(suites.map((suite) => suite.id), ['governed'])
    assert.equal(warnings.length, 0)
  })
})

test('套件：字段缺失 → 正常加载，不校验', async () => {
  const normalized = normalizeSuite(SUITE, { source: '内置', dir: 'D:/s/governed' })
  assert.equal(normalized.ok, true)
  assert.equal(normalized.warnings, undefined, '没有版本闸问题就不带 warnings 字段')
})

test('套件：格式非法（abc）→ 照常加载 + SUITE_MIN_VERSION_BAD warning', async () => {
  await withTemp(async (base) => {
    const shelf = await makeSuiteShelf(base, { broken: { ...SUITE, minOpenStoryVersion: 'abc' } })
    const { suites, warnings } = loadSuites([shelf])
    assert.deepEqual(suites.map((suite) => suite.id), ['governed'], '格式坏不阻断加载')
    const hit = warnings.find((warning) => warning.code === 'SUITE_MIN_VERSION_BAD')
    assert.ok(hit, `应有 SUITE_MIN_VERSION_BAD warning，实际：${JSON.stringify(warnings)}`)
    assert.match(hit.message, /abc/)
  })
})

/* ---------- 技能：三态同口径 ---------- */

test('技能：高于当前跳过；等于/缺失照常；格式坏照常＋SKILL_MIN_VERSION_BAD', async () => {
  await withTemp(async (base) => {
    const shelf = await makeSkillShelf(base, {
      // OS-135：应用版本已对齐 v0.2.0，「高于当前」的夹具字面量随之升到 0.3.0（语义不变）
      'future-skill': skillMarkdown({ name: 'future-skill', extra: "minOpenStoryVersion: '0.3.0'\n" }),
      'same-skill': skillMarkdown({ name: 'same-skill', extra: "minOpenStoryVersion: '0.1.0'\n" }),
      'plain-skill': skillMarkdown({ name: 'plain-skill' }),
      'broken-skill': skillMarkdown({ name: 'broken-skill', extra: 'minOpenStoryVersion: abc\n' })
    })
    const { skills, warnings } = loadSkills([shelf])
    assert.deepEqual(skills.map((skill) => skill.name).sort(), ['broken-skill', 'plain-skill', 'same-skill'])

    const skip = warnings.find((warning) => warning.code === 'SKILL_MIN_VERSION')
    assert.ok(skip, `应有 SKILL_MIN_VERSION warning，实际：${JSON.stringify(warnings)}`)
    assert.match(skip.message, /0\.3\.0/)

    const malformed = warnings.find((warning) => warning.code === 'SKILL_MIN_VERSION_BAD')
    assert.ok(malformed, `应有 SKILL_MIN_VERSION_BAD warning，实际：${JSON.stringify(warnings)}`)
  })
})

test('技能：显式 appVersion 生效（解析层单测，不读盘）', () => {
  const src = skillMarkdown({ extra: "minOpenStoryVersion: '0.3.0'\n" })
  assert.equal(parseSkillMarkdown(src, { source: '内置', dir: 'd', appVersion: '0.1.0' }).ok, false)
  const atNewer = parseSkillMarkdown(src, { source: '内置', dir: 'd', appVersion: '0.3.0' })
  assert.equal(atNewer.ok, true)
  assert.equal(atNewer.warnings, undefined)
})

/* ---------- 运行时 kit：三态同口径 ---------- */

test('运行时：高于当前跳过；等于/缺失照常；格式坏照常＋RUNTIME_KIT_MIN_VERSION_BAD', async () => {
  await withTemp(async (base) => {
    const shelf = await makeKitShelf(base, {
      // OS-135：应用版本已对齐 v0.2.0，「高于当前」的夹具字面量随之升到 0.3.0（语义不变）
      'future-kit': { ...KIT, id: 'future-kit', minOpenStoryVersion: '0.3.0' },
      'same-kit': { ...KIT, id: 'same-kit', minOpenStoryVersion: '0.1.0' },
      'plain-kit': { ...KIT, id: 'plain-kit' },
      'broken-kit': { ...KIT, id: 'broken-kit', minOpenStoryVersion: '1.0' }
    })
    const { kits, warnings } = loadRuntimeKits([shelf])
    assert.deepEqual(kits.map((kit) => kit.id).sort(), ['broken-kit', 'plain-kit', 'same-kit'])

    const skip = warnings.find((warning) => warning.code === 'RUNTIME_KIT_MIN_VERSION')
    assert.ok(skip, `应有 RUNTIME_KIT_MIN_VERSION warning，实际：${JSON.stringify(warnings)}`)
    assert.match(skip.message, /0\.3\.0/)

    const malformed = warnings.find((warning) => warning.code === 'RUNTIME_KIT_MIN_VERSION_BAD')
    assert.ok(malformed, `应有 RUNTIME_KIT_MIN_VERSION_BAD warning，实际：${JSON.stringify(warnings)}`)

    // 端到端形状：被拦下的 kit 一个字段都不该露出去
    assert.equal(normalizeRuntimeKit({ ...KIT, minOpenStoryVersion: '9.9.9' }, { source: '内置', dir: 'd' }).ok, false)
  })
})

/* ---------- 共用闸门的小单测 ---------- */

test('minVersionGate：缺失不校验／格式坏 fail-open／不够才 skip', () => {
  assert.deepEqual(minVersionGate('', '0.1.0', { prefix: 'X', label: 'X' }), { skip: false, warning: null, message: '' })
  assert.equal(minVersionGate(undefined, '0.1.0', { prefix: 'X' }).skip, false)

  const malformed = minVersionGate('abc', '0.1.0', { prefix: 'X', label: '某件', where: 'w' })
  assert.equal(malformed.skip, false, '格式坏不等于版本不够，不许拦')
  assert.equal(malformed.warning.code, 'X_MIN_VERSION_BAD')

  const old = minVersionGate('0.2.0', '0.1.0', { prefix: 'X', label: '某件' })
  assert.equal(old.skip, true)
  assert.equal(old.warning, null)
})

test('minVersionGate：应用版本读不到时，_BAD 文案不甩锅给插件字段', () => {
  const gate = minVersionGate('0.2.0', '', { prefix: 'X', label: '某件', where: 'w' })
  assert.equal(gate.skip, false, '读不到应用版本也绝不拦插件')
  assert.equal(gate.warning.code, 'X_MIN_VERSION_BAD')
  assert.match(gate.warning.message, /读不到应用版本/)
})

/* ══ OS-122 依赖闸：requires → 拓扑序 / 缺依赖 / 环 ══ */

import { resolveSuiteDependencies } from '../src/protocol/dependencyGraph.mjs'
import { listSuitesPublic } from '../src/services/suites.mjs'

test('依赖闸：缺依赖 → 该套件 blocked，missing 列出缺谁，其余照常', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dep-'))
  try {
    const mk = async (id, requires) => {
      const d = join(root, id)
      await mkdir(d, { recursive: true })
      await writeFile(join(d, 'manifest.json'), JSON.stringify({
        schemaVersion: 'openstory-suite@2', id, name: id, version: '0.1.0', vendor: 'x', description: 'y',
        ...(requires ? { requires } : {}),
        capabilities: { settings: { mode: 'page', entry: 'settings.html' } }
      }), 'utf-8')
      await writeFile(join(d, 'settings.html'), 'x', 'utf-8')
    }
    await mk('standalone')
    await mk('needy', ['openstory.suite.ghost'])
    const r = await listSuitesPublic([root], join(root, 'state.json'))
    const needy = r.suites.find((s) => s.id === 'needy')
    const standalone = r.suites.find((s) => s.id === 'standalone')
    assert.equal(needy.blocked, true)
    assert.match(needy.blockedReason, /缺依赖/)
    assert.deepEqual(needy.missingDependencies, ['openstory.suite.ghost'])
    assert.equal(standalone.blocked, undefined, '无 requires 的套件完全不受影响')
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('依赖闸：依赖齐 → 拓扑序依赖在前，无 unmet 无环', () => {
  const graph = resolveSuiteDependencies([
    { id: 'app', enabled: true, requires: ['lib', 'core'] },
    { id: 'lib', enabled: true, requires: ['core'] },
    { id: 'core', enabled: true }
  ])
  assert.equal(graph.ok, true)
  assert.deepEqual(graph.unmet, [])
  assert.deepEqual(graph.cycles, [])
  assert.equal(graph.enabled.indexOf('core'), 0, '被依赖者排最前')
  assert.ok(graph.enabled.indexOf('lib') < graph.enabled.indexOf('app'), 'lib 在 app 之前')
})

test('依赖闸：环（A↔B）→ cycles 报出且不进 enabled；下游不误报成环', () => {
  const graph = resolveSuiteDependencies([
    { id: 'a', enabled: true, requires: ['b'] },
    { id: 'b', enabled: true, requires: ['a'] },
    { id: 'downstream', enabled: true, requires: ['a'] },
    { id: 'plain', enabled: true }
  ])
  assert.equal(graph.ok, false)
  assert.equal(graph.cycles.length, 1)
  assert.deepEqual([...graph.cycles[0]].sort(), ['a', 'b'])
  assert.ok(!graph.enabled.includes('a') && !graph.enabled.includes('b'), '环成员不可启用')
  assert.ok(!graph.enabled.includes('downstream'), '环的下游也不可启用')
  assert.ok(graph.enabled.includes('plain'), '无关套件照常')
})

test('依赖闸：自依赖 → 归入 cycles；停用套件不算可用依赖', () => {
  const selfLoop = resolveSuiteDependencies([{ id: 'solo', enabled: true, requires: ['solo'] }])
  assert.equal(selfLoop.cycles.length, 1)
  assert.deepEqual(selfLoop.cycles[0], ['solo'])

  const disabledDep = resolveSuiteDependencies([
    { id: 'user', enabled: true, requires: ['off'] },
    { id: 'off', enabled: false }
  ])
  assert.equal(disabledDep.ok, false)
  assert.deepEqual(disabledDep.unmet, [{ id: 'user', needs: ['off'] }], '停用的依赖＝缺依赖')
})

test('依赖闸：requires 里的非法项被丢弃并记 SUITE_REQUIRES warning', async () => {
  const root = await mkdtemp(join(tmpdir(), 'reqbad-'))
  try {
    const d = join(root, 'sloppy')
    await mkdir(d, { recursive: true })
    await writeFile(join(d, 'manifest.json'), JSON.stringify({
      schemaVersion: 'openstory-suite@2', id: 'sloppy', name: 'sloppy', version: '0.1.0', vendor: 'x', description: 'y',
      requires: ['good-id', 'x'.repeat(90), ''],
      capabilities: { settings: { mode: 'page', entry: 'settings.html' } }
    }), 'utf-8')
    await writeFile(join(d, 'settings.html'), 'x', 'utf-8')
    const r = await listSuitesPublic([root], join(root, 'state.json'))
    assert.ok(r.warnings.some((w) => w.code === 'SUITE_REQUIRES'), '非法项要有 warning')
    const sloppy = r.suites.find((s) => s.id === 'sloppy')
    assert.equal(sloppy.blocked, true, 'good-id 不在货架＝缺依赖，照常标 blocked')
    assert.deepEqual(sloppy.missingDependencies, ['good-id'], '非法项已丢弃，missing 里只剩合法项')
  } finally { await rm(root, { recursive: true, force: true }) }
})

/* ══ OS-129 服务白名单：services id 对齐宿主真实实现（warning 不拒载） ══ */

test('服务白名单：已知 id（KNOWN_SERVICE_IDS 全部）→ 照常登记，零 warning', async () => {
  assert.ok(Object.isFrozen(KNOWN_SERVICE_IDS), '白名单必须是冻结数组')
  await withTemp(async (base) => {
    const shelf = await makeSuiteShelf(base, {
      wired: {
        ...SUITE, id: 'wired',
        capabilities: { pages: [], services: KNOWN_SERVICE_IDS.map((id) => ({ id, description: `${id} 通道` })) }
      }
    })
    const { suites, warnings } = loadSuites([shelf])
    assert.deepEqual(suites.map((suite) => suite.id), ['wired'])
    assert.equal(warnings.length, 0, `宿主真的会理的 id 不该有 warning，实际：${JSON.stringify(warnings)}`)
    assert.deepEqual(suites[0].capabilities.services.map((service) => service.id), [...KNOWN_SERVICE_IDS], '白名单 id 全部照常登记')
  })
})

test('服务白名单：未知 id → SUITE_SERVICE_UNKNOWN warning，但套件照常加载、声明照常登记', async () => {
  await withTemp(async (base) => {
    const shelf = await makeSuiteShelf(base, {
      dreamer: {
        ...SUITE, id: 'dreamer',
        capabilities: { pages: [], services: [{ id: 'quantum-teleport', description: '宿主还没这能力' }, { id: 'state-data', description: '这个宿主会理' }] }
      }
    })
    const { suites, warnings } = loadSuites([shelf])
    assert.deepEqual(suites.map((suite) => suite.id), ['dreamer'], '未知服务 id 不拒载——白名单是提示，不是权限闸')
    const hit = warnings.find((warning) => warning.code === 'SUITE_SERVICE_UNKNOWN')
    assert.ok(hit, `应有 SUITE_SERVICE_UNKNOWN warning，实际：${JSON.stringify(warnings)}`)
    assert.match(hit.message, /quantum-teleport/)
    const registered = suites[0].capabilities.services.map((service) => service.id)
    assert.deepEqual(registered, ['quantum-teleport', 'state-data'], '未知 id 照常登记，不丢声明')
    assert.equal(warnings.filter((warning) => warning.code === 'SUITE_SERVICE_UNKNOWN').length, 1, '已知 id（state-data）不捎 warning')
  })
})

test('服务白名单：services 缺省（无 capabilities／空对象）→ 无 warning', () => {
  const noCaps = normalizeSuite(SUITE, { source: '内置', dir: 'D:/s/governed' })
  assert.equal(noCaps.ok, true)
  assert.equal(noCaps.warnings, undefined, '整个 capabilities 缺省＝不涉服务声明，零 warning')

  const emptyCaps = normalizeSuite({ ...SUITE, capabilities: {} }, { source: '内置', dir: 'D:/s/governed' })
  assert.equal(emptyCaps.ok, true)
  assert.equal(emptyCaps.warnings, undefined, 'capabilities 空对象（services 缺省）也零 warning')
  assert.deepEqual(emptyCaps.suite.capabilities.services, [], 'services 规整为空数组')
})
