import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { NAMING_TABLE, TAB_REGISTRY } from '../public/views/registry.mjs'
import { auditAgentName, auditLineageNames, auditNamingConsistency } from '../tools/verify/verify-os172-naming.mjs'

const TOOL_SKILLS = [
  'fact-consistency', 'fact-extract', 'outline-restructure', 'scene-expand',
  'worldbook-refactor', 'continuity-check', 'chapter-rewrite'
]

function put(root, rel, content) {
  const path = join(root, rel)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, content)
}

function lineageFixture() {
  const root = mkdtempSync(join(tmpdir(), 'openstory-os172-naming-'))
  for (const dir of ['src', 'public', 'genres', 'skills', 'suites']) mkdirSync(join(root, dir), { recursive: true })
  put(root, 'package.json', JSON.stringify({ author: 'skkbsgzf <59155174+skkbsgzf@users.noreply.github.com>' }))
  put(root, 'src/main.mjs', 'export const product = "OpenStory"\n')
  put(root, 'suites/demo/manifest.json', JSON.stringify({ vendor: 'skkbsgzf' }))
  put(root, 'suites/demo/skills/demo/SKILL.md', '---\nvendor: skkbsgzf\n---\n')
  for (const name of TOOL_SKILLS) put(root, `skills/${name}/SKILL.md`, '---\nvendor: skkbsgzf\n---\n')
  return root
}

test('OS-172 当前命名表、页签与模块显示名四向一致', () => {
  const result = auditNamingConsistency()
  assert.equal(result.ok, true, result.violations.join('; '))
  // OS-190 分类补齐：页面 id＝slug、12 工作台齐备、manifest name＝正名、Agent 栏三名一致
  const agent = auditAgentName()
  assert.equal(agent.ok, true, agent.violations.join('; '))
  const ids = NAMING_TABLE.map((row) => row.id)
  assert.ok(ids.includes('imagegen') && ids.includes('knowledge'))
  assert.ok(!ids.includes('vision') && !ids.includes('kb'), '散布的旧概念 id 已删')
  // OS-190a 反证：页签视图键退回旧名，门禁必须红（正例已由上面的 audit 覆盖）。
  const badTabs = TAB_REGISTRY.map((entry) => entry.id === 'worldbook' ? { ...entry, view: 'reference' } : entry)
  const tabResult = auditNamingConsistency({ tabs: badTabs })
  assert.equal(tabResult.ok, false)
  assert.ok(tabResult.violations.includes('TAB_REGISTRY:worldbook: view「reference」≠ id'))
})

test('OS-172 目录名退回旧名时四名一致门禁必须报红', () => {
  const naming = NAMING_TABLE.map((row) => row.id === 'worldbook' ? { ...row, tab: '参考' } : row)
  const result = auditNamingConsistency({ naming })
  assert.equal(result.ok, false)
  assert.ok(result.violations.includes('worldbook: 目录与页签/入口名不一致'))
})

test('OS-189 谱系门禁：整文件豁免已取消，出处逐行放行、一次性升级单独放行，其余旧名报红', () => {
  const root = lineageFixture()
  try {
    assert.equal(auditLineageNames(root).ok, true)

    // 反证 (a)：src 里新写 pinax_xxx，门禁必须红。
    put(root, 'src/bad.mjs', 'pinax_xxx\n')
    let result = auditLineageNames(root)
    assert.equal(result.ok, false)
    assert.ok(result.violations.includes('src/bad.mjs:1: pinax_xxx'))
    rmSync(join(root, 'src', 'bad.mjs'))

    // 反证 (b)：升级器之外写旧目录名常量，门禁必须红。
    put(root, 'src/compat.mjs', "export const LEGACY_DIR = '.pinax'\n")
    result = auditLineageNames(root)
    assert.equal(result.ok, false)
    assert.ok(result.violations.some((line) => line.startsWith('src/compat.mjs:1:')))
    rmSync(join(root, 'src', 'compat.mjs'))

    // 唯一例外：一次性升级器与逐行出处声明。
    put(root, 'src/protocol/libraryUpgrade.mjs', 'export const legacy = ".pinax"\n')
    put(root, 'src/kernel/index.mjs', ' * 谱系：由 Pinax-next 转自有\n')
    assert.equal(auditLineageNames(root).ok, true, auditLineageNames(root).violations.join('; '))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
