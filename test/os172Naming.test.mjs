import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { NAMING_TABLE } from '../public/views/registry.mjs'
import { auditLineageNames, auditNamingConsistency } from '../tools/verify/verify-os172-naming.mjs'

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
})

test('OS-172 目录名退回旧名时四名一致门禁必须报红', () => {
  const naming = NAMING_TABLE.map((row) => row.id === 'worldbook' ? { ...row, tab: '参考' } : row)
  const result = auditNamingConsistency({ naming })
  assert.equal(result.ok, false)
  assert.ok(result.violations.includes('worldbook: 目录与页签/入口名不一致'))
})

test('OS-172 谱系门禁允许迁移兼容文件，其余旧工具名必须报红', () => {
  const root = lineageFixture()
  try {
    assert.equal(auditLineageNames(root).ok, true)
    put(root, 'src/protocol/libraryUpgrade.mjs', 'export const legacy = ".pinax"\n')
    assert.equal(auditLineageNames(root).ok, true)
    put(root, 'public/bad.mjs', 'pinax_xxx\n')
    const result = auditLineageNames(root)
    assert.equal(result.ok, false)
    assert.ok(result.violations.includes('public/bad.mjs:1: pinax_xxx'))
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
