import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadDeduceRules } from '../src/protocol/deduceRules.mjs'
import { builtinSuitesDir } from '../src/services/suites.mjs'

const REPO = join(fileURLToPath(new URL('..', import.meta.url)))

async function fixture(run) {
  const base = await mkdtemp(join(tmpdir(), 'openstory-deduce-rules-'))
  try {
    await run(base)
  } finally {
    await rm(base, { recursive: true, force: true })
  }
}

test('规则包：内置默认数据可读且与引擎导入的 JSON 同源', async () => {
  const loaded = await loadDeduceRules({ suitesDirs: [builtinSuitesDir()] })
  assert.equal(loaded.ok, true)
  assert.equal(loaded.source, 'deduce-rules')
  assert.deepEqual(loaded.rules, JSON.parse(await readFile(join(REPO, 'suites/deduce-rules/rules.json'), 'utf8')))
  assert.deepEqual(loaded.rules.dice, { count: 2, sides: 6, successThreshold: 7, label: '2d6' })
})

test('规则包：缺货架时回退内置默认，不伪造外部规则', async () => {
  await fixture(async (base) => {
    const dir = join(base, 'empty')
    await mkdir(dir)
    assert.deepEqual(await loadDeduceRules({ suitesDirs: [dir] }), {
      ok: true, rules: null, source: 'builtin-default'
    })
  })
})

test('规则包：本机同 id 覆盖内置；库级停用保留状态并回退默认', async () => {
  await fixture(async (base) => {
    const userDir = join(base, 'suites', 'deduce-rules')
    const root = join(base, '库')
    const statePath = join(base, 'suite-state.json')
    await mkdir(userDir, { recursive: true })
    await mkdir(join(root, '.openstory', 'plugins'), { recursive: true })
    const overrideManifest = JSON.parse(await readFile(join(builtinSuitesDir(), 'deduce-rules', 'manifest.json'), 'utf8'))
    await writeFile(join(userDir, 'manifest.json'), JSON.stringify({ ...overrideManifest, builtin: false }))
    const rules = {
      dice: { count: 1, sides: 6, successThreshold: 4, label: '1d6' },
      limits: { necessity: 2, fate: 1, drama: 2, mixed: 4, minimum: 2 }
    }
    await writeFile(join(userDir, 'rules.json'), JSON.stringify(rules))
    const options = { suitesDirs: [builtinSuitesDir(), join(base, 'suites')], suiteStatePath: statePath, root }
    assert.deepEqual(await loadDeduceRules(options), { ok: true, rules, source: 'deduce-rules' })

    await writeFile(join(root, '.openstory', 'plugins', 'suite-state.json'), JSON.stringify({
      suites: { 'deduce-rules': { enabled: false, values: { retained: true } } }
    }))
    assert.deepEqual(await loadDeduceRules(options), { ok: true, rules: null, source: 'disabled-default' })
    assert.equal(JSON.parse(await readFile(join(root, '.openstory', 'plugins', 'suite-state.json'), 'utf8'))
      .suites['deduce-rules'].values.retained, true)
  })
})

test('规则包：覆盖包 JSON 损坏时明确拒绝，不静默使用别的规则', async () => {
  await fixture(async (base) => {
    const suiteDir = join(base, 'suites', 'deduce-rules')
    await mkdir(suiteDir, { recursive: true })
    const overrideManifest = JSON.parse(await readFile(join(builtinSuitesDir(), 'deduce-rules', 'manifest.json'), 'utf8'))
    await writeFile(join(suiteDir, 'manifest.json'), JSON.stringify({ ...overrideManifest, builtin: false }))
    await writeFile(join(suiteDir, 'rules.json'), '{bad json')
    const loaded = await loadDeduceRules({ suitesDirs: [builtinSuitesDir(), join(base, 'suites')] })
    assert.equal(loaded.ok, false)
    assert.equal(loaded.code, 'INVALID_ENTRY')
    assert.match(loaded.message, /推演规则包读取失败/u)
  })
})
