import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { loadSuites, loadSuiteState } from '../services/suites.mjs'

export async function loadDeduceRules({ suitesDirs = [], suiteStatePath = '', root = '' } = {}) {
  const { suites } = loadSuites(suitesDirs)
  const suite = suites.find((item) => item.id === 'deduce-rules')
  if (!suite) return { ok: true, rules: null, source: 'builtin-default' }
  const { state } = await loadSuiteState(suiteStatePath, root)
  if (state.suites?.[suite.id]?.enabled === false) return { ok: true, rules: null, source: 'disabled-default' }
  try {
    const entry = suite.entries?.['deduce-rule'] ?? 'rules.json'
    const rules = JSON.parse(await readFile(join(suite.dir, ...entry.split('/')), 'utf8'))
    return { ok: true, rules, source: suite.id }
  } catch (error) {
    return { ok: false, code: 'INVALID_ENTRY', message: `推演规则包读取失败：${error?.message ?? error}` }
  }
}
